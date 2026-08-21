'use strict';

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { randomUUID } = require('crypto');
const { spawn } = require('child_process');
const { createProgressParser } = require('./ffmpeg-parsers');
const { compileJobArgs } = require('./safe-process');

const STATUSES = new Set(['queued', 'running', 'paused', 'completed', 'failed', 'cancelled', 'interrupted']);
const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'interrupted']);
const MAX_JOBS = 1000;
const MAX_HISTORY = 500;
const MAX_LOG_LINES = 500;
const MAX_LOG_LENGTH = 4000;
const MAX_LABEL_LENGTH = 160;
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
    this._persistTimer = null;
    this._shuttingDown = false;
  }

  initialize() {
    fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
    this._load();
    this._schedule();
  }

  enqueue(spec) {
    if (this.jobs.size >= MAX_JOBS) throw new Error(`The queue is limited to ${MAX_JOBS} retained jobs.`);
    const args = compileJobArgs(spec, this.fileRegistry);
    const outputPaths = spec.args
      .filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry) &&
        this.fileRegistry.describe(entry.fileHandle).kind === 'output')
      .map((entry) => this.fileRegistry.resolve(entry.fileHandle, 'output'));
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
    this._changed(job, 'created', true);
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
    job.cancelRequested = true;
    job.updatedAt = new Date().toISOString();
    if (job.status === 'paused' && child?.pid) {
      await setWindowsProcessSuspended(child.pid, false);
      job.status = 'running';
    }
    this._changed(job, 'cancellation-requested', true);
    if (!child) {
      this._finish(job, 'cancelled', null, null, null);
      return this._publicJob(job);
    }

    try { child.stdin?.write('q\n'); } catch (_) { /* Fall through to the bounded kill timer. */ }
    const timer = setTimeout(() => {
      if (this.processes.get(id) === child) child.kill('SIGKILL');
    }, CANCEL_GRACE_MS);
    timer.unref?.();
    return this._publicJob(job);
  }

  reorder(ids) {
    if (!Array.isArray(ids) || ids.length !== this.order.length || new Set(ids).size !== ids.length) {
      throw new TypeError('Reorder requires every retained job id exactly once.');
    }
    if (ids.some((id) => !this.jobs.has(id))) throw new Error('Reorder contains an unknown job id.');

    const queuedPositions = this.order.filter((id) => this.jobs.get(id)?.status === 'queued');
    const requestedQueued = ids.filter((id) => this.jobs.get(id)?.status === 'queued');
    if (requestedQueued.length !== queuedPositions.length) throw new Error('Running and completed jobs cannot be reordered.');
    let queuedIndex = 0;
    this.order = this.order.map((id) => this.jobs.get(id)?.status === 'queued' ? requestedQueued[queuedIndex++] : id);
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
    this._shuttingDown = true;
    for (const [id, child] of this.processes.entries()) {
      const job = this.jobs.get(id);
      if (job && (job.status === 'running' || job.status === 'paused')) {
        job.status = 'interrupted';
        job.error = 'The application closed before this job finished.';
        job.updatedAt = new Date().toISOString();
        job.finishedAt = job.updatedAt;
      }
      try { child.kill('SIGKILL'); } catch (_) { /* Process is already gone. */ }
    }
    this.processes.clear();
    this._persistNow();
  }

  _schedule() {
    if (this._shuttingDown) return;
    const active = [...this.jobs.values()].filter((job) => job.status === 'running' || job.status === 'paused').length;
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

    const progress = createProgressParser((block) => {
      job.progress = block;
      job.updatedAt = new Date().toISOString();
      this._changed(job, 'progress', false);
    });
    let stderrCarry = '';
    child.stdout.on('data', (chunk) => progress.push(chunk));
    child.stderr.on('data', (chunk) => {
      stderrCarry += chunk.toString('utf8');
      if (stderrCarry.length > MAX_LOG_LENGTH * 4) stderrCarry = stderrCarry.slice(-MAX_LOG_LENGTH * 4);
      const lines = stderrCarry.split(/\r?\n/);
      stderrCarry = lines.pop() || '';
      lines.forEach((line) => this._appendLog(job, line));
    });
    child.once('error', (error) => {
      this.processes.delete(job.id);
      this._finish(job, job.cancelRequested ? 'cancelled' : 'failed', null, null, error.message);
      this._schedule();
    });
    child.once('close', (code, signal) => {
      if (this.processes.get(job.id) !== child) return;
      this.processes.delete(job.id);
      progress.end();
      if (stderrCarry) this._appendLog(job, stderrCarry);
      const status = job.cancelRequested ? 'cancelled' : code === 0 ? 'completed' : 'failed';
      let finalStatus = status;
      let error = status === 'failed' ? `FFmpeg exited with code ${code}${signal ? ` (${signal})` : ''}.` : null;
      if (status === 'completed') {
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
    this._changed(job, status, true);
    this._trimHistory();
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
      for (const candidate of parsed.jobs) {
        if (!isStoredJob(candidate)) continue;
        const job = { ...candidate, progress: { ...(candidate.progress || {}) }, logs: candidate.logs.slice(-MAX_LOG_LINES) };
        if (job.status === 'running' || job.status === 'paused') {
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
    fs.writeFileSync(temporary, body, { encoding: 'utf8', mode: 0o600 });
    try {
      fs.renameSync(temporary, this.stateFile);
    } catch (error) {
      try { fs.rmSync(this.stateFile, { force: true }); fs.renameSync(temporary, this.stateFile); }
      catch (_) { try { fs.rmSync(temporary, { force: true }); } catch (_) { /* Best effort cleanup. */ } throw error; }
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
  return Boolean(job && typeof job === 'object' && /^[0-9a-f-]{36}$/i.test(job.id) &&
    STATUSES.has(job.status) && Array.isArray(job.args) && job.args.length <= 261 && Array.isArray(job.outputPaths || []) &&
    job.args.every((arg) => typeof arg === 'string' && arg.length <= 8192) &&
    Array.isArray(job.logs));
}

function validateOutputs(outputPaths) {
  if (!outputPaths.length) return { valid: true, mode: 'stream', outputs: [], error: null };
  const outputs = [];
  try {
    for (const outputPath of outputPaths) {
      const stats = fs.statSync(outputPath);
      if (!stats.isFile() || stats.size < 1) throw new Error(`Expected output is missing or empty: ${path.basename(outputPath)}`);
      outputs.push({ name: path.basename(outputPath), bytes: stats.size });
    }
    return { valid: true, mode: 'files', outputs, error: null };
  } catch (error) {
    return { valid: false, mode: 'files', outputs, error: error.message };
  }
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
