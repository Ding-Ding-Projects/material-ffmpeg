'use strict';

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { randomUUID } = require('crypto');
const { spawn } = require('child_process');
const { createProgressParser } = require('./ffmpeg-parsers');
const { compileJobArgs } = require('./safe-process');

const STATUSES = new Set(['queued', 'running', 'paused', 'cancelling', 'stopping', 'completed', 'failed', 'cancelled', 'interrupted']);
const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'interrupted']);
const MAX_JOBS = 1000;
const MAX_HISTORY = 500;
const MAX_LOG_LINES = 500;
const MAX_LOG_LENGTH = 4000;
const MAX_LABEL_LENGTH = 160;
const MAX_OUTPUT_PATHS = 256;
const MAX_OUTPUT_DIRECTORY_ENTRIES = 10_000;
const MAX_VALIDATED_OUTPUTS = 2_000;
const CANCEL_GRACE_MS = 2500;

class JobManager extends EventEmitter {
  constructor({ ffmpegPath, fileRegistry, stateDirectory, concurrency = 2 }) {
    super();
    this.ffmpegPath = ffmpegPath;
    this.fileRegistry = fileRegistry;
    this.concurrency = Math.max(1, Math.min(Number(concurrency) || 2, 4));
    this.stateFile = path.join(stateDirectory, 'runtime', 'jobs.json');
    this.jobs = new Map();
    this.order = [];
    this.processes = new Map();
    this._stopReasons = new Map();
    this._stopTimers = new Map();
    this._persistTimer = null;
    this._shuttingDown = false;
    this._shutdownPromise = null;
  }

  initialize() {
    fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
    this._load();
    this._schedule();
  }

  enqueue(spec) {
    if (this._shuttingDown) throw new Error('The job queue is shutting down and cannot accept new work.');
    if (this.jobs.size >= MAX_JOBS) throw new Error(`The queue is limited to ${MAX_JOBS} retained jobs.`);
    const args = compileJobArgs(spec, this.fileRegistry);
    const outputPaths = [...new Set(spec.args
      .filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry) &&
        this.fileRegistry.describe(entry.fileHandle).kind === 'output')
      .map((entry) => this.fileRegistry.resolve(entry.fileHandle, 'output')))];
    if (outputPaths.length > MAX_OUTPUT_PATHS) throw new Error(`A job can declare at most ${MAX_OUTPUT_PATHS} output paths.`);
    const now = new Date().toISOString();
    const job = {
      id: randomUUID(),
      label: normalizeLabel(spec.label),
      status: 'queued',
      args,
      outputPaths,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      finishedAt: null,
      exitCode: null,
      signal: null,
      progress: {},
      logs: [],
      error: null,
      outputValidation: null,
      cancelRequested: false
    };
    this.jobs.set(job.id, job);
    this.order.push(job.id);
    try {
      this._changed(job, 'created', true);
    } catch (error) {
      this.jobs.delete(job.id);
      this.order = this.order.filter((id) => id !== job.id);
      throw error;
    }
    this._schedule();
    return this._publicJob(job);
  }

  list() {
    return this.order.map((id) => this.jobs.get(id)).filter(Boolean).map((job) => this._publicJob(job));
  }

  async pause(id) {
    const job = this._requireJob(id);
    const child = this.processes.get(id);
    if (job.status !== 'running' || !child?.pid) throw new Error('Only a running job can be paused.');
    await setWindowsProcessSuspended(child.pid, true);
    job.status = 'paused';
    job.updatedAt = new Date().toISOString();
    this._changed(job, 'paused', true);
    return this._publicJob(job);
  }

  async resume(id) {
    const job = this._requireJob(id);
    const child = this.processes.get(id);
    if (job.status !== 'paused' || !child?.pid) throw new Error('Only a paused job can be resumed.');
    await setWindowsProcessSuspended(child.pid, false);
    job.status = 'running';
    job.updatedAt = new Date().toISOString();
    this._changed(job, 'resumed', true);
    return this._publicJob(job);
  }

  async cancel(id) {
    const job = this._requireJob(id);
    if (TERMINAL.has(job.status)) return this._publicJob(job);
    if (job.status === 'queued') {
      this._finish(job, 'cancelled', null, null, null);
      this._schedule();
      return this._publicJob(job);
    }

    const child = this.processes.get(id);
    if (job.cancelRequested || job.status === 'cancelling') return this._publicJob(job);
    const wasPaused = job.status === 'paused';
    job.cancelRequested = true;
    job.status = 'cancelling';
    job.updatedAt = new Date().toISOString();
    this._changed(job, 'cancellation-requested', true);
    if (!child) {
      this._finish(job, 'cancelled', null, null, null);
      this._schedule();
      return this._publicJob(job);
    }

    this._stopReasons.set(id, { status: 'cancelled', error: null });
    await this._requestGracefulStop(job, child, { resumePaused: wasPaused, keepAlive: false });
    return this._publicJob(job);
  }

  reorder(ids) {
    if (!Array.isArray(ids) || ids.length !== this.order.length || new Set(ids).size !== ids.length) {
      throw new TypeError('Reorder requires every retained job id exactly once.');
    }
    if (ids.some((id) => !this.jobs.has(id))) throw new Error('Reorder contains an unknown job id.');

    for (let index = 0; index < this.order.length; index += 1) {
      const currentId = this.order[index];
      const requestedId = ids[index];
      if (this.jobs.get(currentId)?.status !== 'queued' && requestedId !== currentId) {
        throw new Error('Running and completed jobs must remain in their current positions.');
      }
      if (this.jobs.get(currentId)?.status === 'queued' && this.jobs.get(requestedId)?.status !== 'queued') {
        throw new Error('Only queued jobs can move into queued positions.');
      }
    }
    this.order = [...ids];
    this._persistNow();
    this.emit('event', { type: 'reordered', jobs: this.list() });
    return this.list();
  }

  clear(ids) {
    if (!Array.isArray(ids) || ids.length > MAX_JOBS) throw new TypeError('Clear requires a bounded list of job ids.');
    const unique = [...new Set(ids)];
    for (const id of unique) {
      const job = this._requireJob(id);
      if (!TERMINAL.has(job.status)) throw new Error('Only finished jobs can be cleared.');
    }
    unique.forEach((id) => this.jobs.delete(id));
    this.order = this.order.filter((id) => this.jobs.has(id));
    this._persistNow();
    this.emit('event', { type: 'cleared', ids: unique });
    return this.list();
  }

  shutdown() {
    if (this._shutdownPromise) return this._shutdownPromise;
    this._shuttingDown = true;
    if (this._persistTimer) {
      clearTimeout(this._persistTimer);
      this._persistTimer = null;
    }
    const stops = [];
    for (const [id, child] of this.processes.entries()) {
      const job = this.jobs.get(id);
      if (job && (job.status === 'running' || job.status === 'paused' || job.status === 'cancelling')) {
        const wasPaused = job.status === 'paused';
        job.status = 'stopping';
        job.error = 'The application is closing; FFmpeg is stopping.';
        job.updatedAt = new Date().toISOString();
        job.finishedAt = null;
        job.cancelRequested = false;
        this._stopReasons.set(id, {
          status: 'interrupted',
          error: 'The application closed before this job finished.'
        });
        this._changed(job, 'shutdown-requested', true);
        const exited = new Promise((resolve) => child.once('close', resolve));
        stops.push(Promise.resolve(this._requestGracefulStop(job, child, {
          resumePaused: wasPaused,
          keepAlive: true
        })).then(() => exited));
      }
    }
    this._persistNow();
    this._shutdownPromise = Promise.allSettled(stops).then(() => undefined);
    return this._shutdownPromise;
  }

  _schedule() {
    if (this._shuttingDown) return;
    const active = [...this.jobs.values()].filter((job) =>
      job.status === 'running' || job.status === 'paused' || job.status === 'cancelling' || job.status === 'stopping').length;
    let available = this.concurrency - active;
    for (const id of this.order) {
      if (available <= 0) break;
      const job = this.jobs.get(id);
      if (job?.status === 'queued') {
        available -= 1;
        this._start(job);
      }
    }
  }

  _start(job) {
    const now = new Date().toISOString();
    job.status = 'running';
    job.startedAt = now;
    job.updatedAt = now;
    job.error = null;
    this._changed(job, 'started', true);

    let child;
    try {
      child = spawn(this.ffmpegPath, job.args, {
        windowsHide: true,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (error) {
      this._finish(job, 'failed', null, null, error.message);
      this._schedule();
      return;
    }
    this.processes.set(job.id, child);
    child.stdin?.on('error', () => this._forceStop(job.id, child));

    const progress = createProgressParser((block) => {
      if (TERMINAL.has(job.status)) return;
      job.progress = block;
      job.updatedAt = new Date().toISOString();
      this._changed(job, 'progress', false);
    });
    let stderrCarry = '';
    child.stdout.on('data', (chunk) => {
      try {
        progress.push(chunk);
      } catch (error) {
        this._stopReasons.set(job.id, { status: 'failed', error: `FFmpeg progress output was invalid: ${error.message}` });
        this._forceStop(job.id, child);
      }
    });
    child.stderr.on('data', (chunk) => {
      stderrCarry += chunk.toString('utf8');
      if (stderrCarry.length > MAX_LOG_LENGTH * 4) stderrCarry = stderrCarry.slice(-MAX_LOG_LENGTH * 4);
      const lines = stderrCarry.split(/\r?\n/);
      stderrCarry = lines.pop() || '';
      lines.forEach((line) => this._appendLog(job, line));
    });
    child.once('error', (error) => {
      const requested = this._takeStopReason(job.id);
      this.processes.delete(job.id);
      this._finish(job, requested?.status || (job.cancelRequested ? 'cancelled' : 'failed'), null, null, requested?.error || error.message);
      this._schedule();
    });
    child.once('close', (code, signal) => {
      if (this.processes.get(job.id) !== child) return;
      this.processes.delete(job.id);
      let progressError = null;
      try { progress.end(); } catch (error) { progressError = `FFmpeg progress output was invalid: ${error.message}`; }
      if (stderrCarry) this._appendLog(job, stderrCarry);
      const requested = this._takeStopReason(job.id);
      let finalStatus = requested?.status || (job.cancelRequested ? 'cancelled' : code === 0 ? 'completed' : 'failed');
      let error = requested?.error || progressError || (finalStatus === 'failed'
        ? `FFmpeg exited with code ${code}${signal ? ` (${signal})` : ''}.`
        : null);
      if (finalStatus === 'completed') {
        job.outputValidation = validateOutputs(job.outputPaths);
        if (!job.outputValidation.valid) {
          finalStatus = 'failed';
          error = job.outputValidation.error;
        }
      }
      this._finish(job, finalStatus, code, signal, error);
      this._schedule();
    });
  }

  async _requestGracefulStop(job, child, { resumePaused, keepAlive }) {
    if (this.processes.get(job.id) !== child) return;
    if (resumePaused && child.pid) {
      try {
        await setWindowsProcessSuspended(child.pid, false);
      } catch (error) {
        const requested = this._stopReasons.get(job.id);
        if (requested && !requested.error) requested.error = `FFmpeg could not be resumed before stopping: ${error.message}`;
        this._forceStop(job.id, child);
        return;
      }
    }
    if (this.processes.get(job.id) !== child) return;
    try {
      if (child.stdin && !child.stdin.destroyed && child.stdin.writable) child.stdin.end('q\n');
      else this._forceStop(job.id, child);
    } catch (_) {
      this._forceStop(job.id, child);
    }
    if (this.processes.get(job.id) !== child || this._stopTimers.has(job.id)) return;
    const timer = setTimeout(() => this._forceStop(job.id, child), CANCEL_GRACE_MS);
    if (!keepAlive) timer.unref?.();
    this._stopTimers.set(job.id, timer);
  }

  _forceStop(id, child) {
    if (this.processes.get(id) !== child) return;
    try { child.kill('SIGKILL'); } catch (_) { /* The exact child already exited. */ }
  }

  _takeStopReason(id) {
    const timer = this._stopTimers.get(id);
    if (timer) clearTimeout(timer);
    this._stopTimers.delete(id);
    const requested = this._stopReasons.get(id) || null;
    this._stopReasons.delete(id);
    return requested;
  }

  _appendLog(job, line) {
    const normalized = String(line).trim().slice(0, MAX_LOG_LENGTH);
    if (!normalized) return;
    job.logs.push(normalized);
    if (job.logs.length > MAX_LOG_LINES) job.logs.splice(0, job.logs.length - MAX_LOG_LINES);
    this._changed(job, 'log', false);
  }

  _finish(job, status, exitCode, signal, error) {
    const now = new Date().toISOString();
    job.status = status;
    job.exitCode = Number.isInteger(exitCode) ? exitCode : null;
    job.signal = signal || null;
    job.error = error || null;
    job.finishedAt = now;
    job.updatedAt = now;
    job.cancelRequested = false;
    this._trimHistory();
    this._changed(job, status, true);
  }

  _changed(job, type, immediate) {
    if (immediate) this._persistNow();
    else this._schedulePersist();
    this.emit('event', { type, job: this._publicJob(job) });
  }

  _publicJob(job) {
    return {
      id: job.id,
      label: job.label,
      status: job.status,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      exitCode: job.exitCode,
      signal: job.signal,
      progress: { ...job.progress },
      logs: [...job.logs],
      error: job.error,
      outputValidation: job.outputValidation ? {
        ...job.outputValidation,
        outputs: job.outputValidation.outputs.map((output) => ({ ...output }))
      } : null,
      cancelRequested: Boolean(job.cancelRequested)
    };
  }

  _requireJob(id) {
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) throw new TypeError('Invalid job id.');
    const job = this.jobs.get(id);
    if (!job) throw new Error('Job not found.');
    return job;
  }

  _trimHistory() {
    const terminalIds = this.order.filter((id) => TERMINAL.has(this.jobs.get(id)?.status));
    const removeCount = Math.max(0, terminalIds.length - MAX_HISTORY);
    terminalIds.slice(0, removeCount).forEach((id) => this.jobs.delete(id));
    this.order = this.order.filter((id) => this.jobs.has(id));
  }

  _load() {
    if (!fs.existsSync(this.stateFile)) return;
    try {
      const raw = fs.readFileSync(this.stateFile, 'utf8');
      if (raw.length > 16 * 1024 * 1024) throw new Error('Queue state is too large.');
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.jobs) || parsed.jobs.length > MAX_JOBS) {
        throw new Error('Unsupported queue state.');
      }
      const seen = new Set();
      for (const candidate of parsed.jobs) {
        if (!isStoredJob(candidate)) continue;
        if (seen.has(candidate.id)) continue;
        seen.add(candidate.id);
        const job = sanitizeStoredJob(candidate);
        if (job.status === 'running' || job.status === 'paused' || job.status === 'cancelling' || job.status === 'stopping') {
          job.status = 'interrupted';
          job.finishedAt = new Date().toISOString();
          job.updatedAt = job.finishedAt;
          job.error = 'The previous application session ended before this job finished.';
          job.cancelRequested = false;
        }
        this.jobs.set(job.id, job);
        this.order.push(job.id);
      }
      this._trimHistory();
      this._persistNow();
    } catch (error) {
      const quarantine = `${this.stateFile}.invalid-${Date.now()}`;
      try { fs.renameSync(this.stateFile, quarantine); } catch (_) { /* Leave the unreadable file untouched. */ }
      this.emit('event', { type: 'state-error', error: error.message });
    }
  }

  _schedulePersist() {
    if (this._persistTimer) return;
    this._persistTimer = setTimeout(() => {
      this._persistTimer = null;
      this._persistNow();
    }, 150);
    this._persistTimer.unref?.();
  }

  _persistNow() {
    if (this._persistTimer) {
      clearTimeout(this._persistTimer);
      this._persistTimer = null;
    }
    fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
    const temporary = `${this.stateFile}.${process.pid}.${Date.now()}.tmp`;
    const body = JSON.stringify({
      version: 1,
      savedAt: new Date().toISOString(),
      jobs: this.order.map((id) => this.jobs.get(id)).filter(Boolean)
    });
    let descriptor;
    try {
      descriptor = fs.openSync(temporary, 'wx', 0o600);
      fs.writeFileSync(descriptor, body, { encoding: 'utf8' });
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      fs.renameSync(temporary, this.stateFile);
    } catch (error) {
      if (descriptor !== undefined) {
        try { fs.closeSync(descriptor); } catch (_) { /* The descriptor is already closed. */ }
      }
      try { fs.rmSync(temporary, { force: true }); } catch (_) { /* Keep the previous state file intact. */ }
      throw error;
    }
  }
}

function normalizeLabel(value) {
  if (value === undefined) return 'FFmpeg job';
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_LABEL_LENGTH || /[\0\r\n]/.test(value)) {
    throw new TypeError('Job label is invalid.');
  }
  return value.trim();
}

function isStoredJob(job) {
  try {
    sanitizeStoredJob(job);
    return true;
  } catch (_) {
    return false;
  }
}

function sanitizeStoredJob(job) {
  if (!job || typeof job !== 'object' || Array.isArray(job) || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(job.id)) {
    throw new TypeError('Stored job id is invalid.');
  }
  if (!STATUSES.has(job.status)) throw new TypeError('Stored job status is invalid.');
  const label = normalizeLabel(job.label);
  if (!Array.isArray(job.args) || job.args.length < 6 || job.args.length > 261 ||
    job.args.some((arg) => typeof arg !== 'string' || !arg || arg.length > 8192 || /[\0\r\n]/u.test(arg)) ||
    job.args[0] !== '-hide_banner' || job.args[1] !== '-progress' || job.args[2] !== 'pipe:1' ||
    job.args[3] !== '-stats_period' || job.args[4] !== '0.25') {
    throw new TypeError('Stored job arguments are invalid.');
  }
  if (!Array.isArray(job.outputPaths) || job.outputPaths.length > MAX_OUTPUT_PATHS ||
    job.outputPaths.some((entry) => typeof entry !== 'string' || !path.isAbsolute(entry) ||
      entry.length > 8192 || /[\0\r\n]/u.test(entry))) {
    throw new TypeError('Stored job outputs are invalid.');
  }
  if (!Array.isArray(job.logs) || job.logs.some((line) => typeof line !== 'string')) {
    throw new TypeError('Stored job logs are invalid.');
  }
  const timestamps = ['createdAt', 'updatedAt', 'startedAt', 'finishedAt'];
  if (timestamps.some((key) => job[key] !== null && !isIsoTimestamp(job[key]))) {
    throw new TypeError('Stored job timestamps are invalid.');
  }
  if (job.exitCode !== null && !Number.isInteger(job.exitCode)) throw new TypeError('Stored job exit code is invalid.');
  if (job.signal !== null && (typeof job.signal !== 'string' || job.signal.length > 80)) throw new TypeError('Stored job signal is invalid.');
  if (job.error !== null && (typeof job.error !== 'string' || job.error.length > MAX_LOG_LENGTH)) throw new TypeError('Stored job error is invalid.');
  if (typeof job.cancelRequested !== 'boolean') throw new TypeError('Stored job cancellation state is invalid.');

  return {
    id: job.id,
    label,
    status: job.status,
    args: [...job.args],
    outputPaths: [...new Set(job.outputPaths.map((entry) => path.normalize(entry)))],
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    exitCode: job.exitCode,
    signal: job.signal,
    progress: sanitizeProgress(job.progress),
    logs: job.logs.slice(-MAX_LOG_LINES).map((line) => line.slice(0, MAX_LOG_LENGTH)),
    error: job.error,
    outputValidation: sanitizeOutputValidation(job.outputValidation),
    cancelRequested: job.cancelRequested
  };
}

function sanitizeProgress(value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Stored progress is invalid.');
  const output = {};
  const entries = Object.entries(value);
  if (entries.length > 129) throw new TypeError('Stored progress has too many fields.');
  for (const [key, entry] of entries) {
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u.test(key) && key !== 'raw') continue;
    if (key === 'raw') {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry) || Object.keys(entry).length > 128) continue;
      output.raw = {};
      for (const [rawKey, rawValue] of Object.entries(entry)) {
        if (/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u.test(rawKey) && typeof rawValue === 'string') {
          output.raw[rawKey] = rawValue.slice(0, 4096);
        }
      }
    } else if (typeof entry === 'string') output[key] = entry.slice(0, 4096);
    else if (typeof entry === 'number' && Number.isFinite(entry)) output[key] = entry;
  }
  return output;
}

function sanitizeOutputValidation(value) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.valid !== 'boolean' ||
    (value.mode !== 'stream' && value.mode !== 'files') || !Array.isArray(value.outputs) ||
    value.outputs.length > MAX_VALIDATED_OUTPUTS || (value.error !== null && typeof value.error !== 'string')) {
    throw new TypeError('Stored output validation is invalid.');
  }
  return {
    valid: value.valid,
    mode: value.mode,
    outputs: value.outputs.map((output) => {
      if (!output || typeof output.name !== 'string' || output.name.length > 255 ||
        !Number.isSafeInteger(output.bytes) || output.bytes < 0) throw new TypeError('Stored output metadata is invalid.');
      return { name: output.name, bytes: output.bytes };
    }),
    error: value.error === null ? null : value.error.slice(0, MAX_LOG_LENGTH)
  };
}

function isIsoTimestamp(value) {
  return typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
}

function validateOutputs(outputPaths) {
  if (!outputPaths.length) return { valid: true, mode: 'stream', outputs: [], error: null };
  const outputs = [];
  try {
    for (const outputPath of [...new Set(outputPaths)]) {
      const pattern = outputPattern(outputPath);
      if (!pattern) {
        const stats = fs.statSync(outputPath);
        if (!stats.isFile() || stats.size < 1) throw new Error(`Expected output is missing or empty: ${path.basename(outputPath)}`);
        outputs.push({ name: path.basename(outputPath), bytes: stats.size });
        continue;
      }
      const directory = path.dirname(outputPath);
      const entries = fs.readdirSync(directory, { withFileTypes: true });
      if (entries.length > MAX_OUTPUT_DIRECTORY_ENTRIES) {
        throw new Error(`The output directory contains more than ${MAX_OUTPUT_DIRECTORY_ENTRIES} entries and cannot be validated safely.`);
      }
      const matches = entries.filter((entry) => entry.isFile() && pattern.test(entry.name));
      if (!matches.length) throw new Error(`Expected output pattern produced no files: ${path.basename(outputPath)}`);
      let totalBytes = 0;
      for (const entry of matches) {
        const stats = fs.statSync(path.join(directory, entry.name));
        if (!stats.isFile() || stats.size < 1) throw new Error(`Expected output is empty: ${entry.name}`);
        totalBytes += stats.size;
        if (outputs.length < MAX_VALIDATED_OUTPUTS) outputs.push({ name: entry.name, bytes: stats.size });
      }
      if (outputs.length >= MAX_VALIDATED_OUTPUTS) {
        outputs.length = Math.min(outputs.length, MAX_VALIDATED_OUTPUTS - 1);
        outputs.push({
          name: `${path.basename(outputPath).slice(0, 220)} (${matches.length} files)`,
          bytes: totalBytes
        });
      }
    }
    return { valid: true, mode: 'files', outputs, error: null };
  } catch (error) {
    return { valid: false, mode: 'files', outputs, error: error.message };
  }
}

function outputPattern(outputPath) {
  const name = path.basename(outputPath);
  if (!/%(?:0?\d+)?d|%v/u.test(name)) return null;
  let source = '';
  for (let index = 0; index < name.length;) {
    const token = name.slice(index).match(/^%(?:0?\d+)?d|^%v/u);
    if (token) {
      source += token[0].endsWith('d') ? '\\d+' : '[A-Za-z0-9_-]+';
      index += token[0].length;
      continue;
    }
    source += name[index].replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    index += 1;
  }
  return new RegExp(`^${source}$`, 'u');
}

function setWindowsProcessSuspended(pid, suspended) {
  if (process.platform !== 'win32') return Promise.reject(new Error('Process pause and resume are supported on Windows only.'));
  if (!Number.isSafeInteger(pid) || pid < 1) return Promise.reject(new TypeError('Invalid process id.'));

  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const method = suspended ? 'NtSuspendProcess' : 'NtResumeProcess';
  const script = [
    '$ErrorActionPreference="Stop"',
    "$source='using System; using System.Runtime.InteropServices; public static class NativeProcessState { [DllImport(\"ntdll.dll\")] public static extern int NtSuspendProcess(IntPtr h); [DllImport(\"ntdll.dll\")] public static extern int NtResumeProcess(IntPtr h); }'",
    'Add-Type -TypeDefinition $source',
    '$target=[System.Diagnostics.Process]::GetProcessById([int]$args[0])',
    `$result=[NativeProcessState]::${method}($target.Handle)`,
    'if($result -ne 0){throw "Native process state operation failed: $result"}'
  ].join(';');

  return new Promise((resolve, reject) => {
    const helper = spawn(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script, String(pid)], {
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'ignore', 'pipe']
    });
    let diagnostics = '';
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve();
    };
    helper.stderr.on('data', (chunk) => { diagnostics = (diagnostics + chunk.toString('utf8')).slice(-2000); });
    helper.once('error', finish);
    helper.once('close', (code) => finish(code === 0 ? null : new Error(diagnostics.trim() || `Process state helper exited with code ${code}.`)));
    const timer = setTimeout(() => { helper.kill('SIGKILL'); finish(new Error('Process state helper timed out.')); }, 10_000);
    timer.unref?.();
  });
}

module.exports = { JobManager, setWindowsProcessSuspended };
