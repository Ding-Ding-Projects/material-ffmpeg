'use strict';

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { randomUUID } = require('crypto');

const STATE_VERSION = 1;
const DEFAULT_BASE_URL = 'http://127.0.0.1:11434/';
const MAX_STATE_BYTES = 2 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
const MAX_STREAM_LINE_BYTES = 1024 * 1024;
const MAX_OPERATIONS = 250;
const MAX_MODELS = 10_000;
const MAX_MESSAGES = 200;
const MAX_TEXT_BYTES = 1024 * 1024;
const SAFE_MODEL = /^[a-z0-9][a-z0-9._/-]*(?::[a-z0-9][a-z0-9._-]*)?$/i;
const SAFE_OPERATION_ID = /^[0-9a-f-]{36}$/i;
const SAFE_ROLES = new Set(['system', 'user', 'assistant', 'tool']);
const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'interrupted']);

class OllamaService extends EventEmitter {
  constructor({ stateDirectory, baseUrl = DEFAULT_BASE_URL, fetchImpl = globalThis.fetch, concurrency = 2 } = {}) {
    super();
    if (typeof stateDirectory !== 'string' || !path.isAbsolute(stateDirectory)) {
      throw new TypeError('Ollama stateDirectory must be an absolute path.');
    }
    if (typeof fetchImpl !== 'function') throw new Error('This runtime does not provide fetch.');
    this.baseUrl = normalizeLoopbackBase(baseUrl);
    this.fetchImpl = fetchImpl;
    this.concurrency = Math.max(1, Math.min(Number(concurrency) || 2, 4));
    this.stateFile = path.join(stateDirectory, 'runtime', 'ollama-state.json');
    this.history = [];
    this.controllers = new Map();
    this.activeCount = 0;
    this.waiters = [];
    this.closed = false;
  }

  initialize() {
    fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
    this._load();
    const now = new Date().toISOString();
    let changed = false;
    this.history.forEach((entry) => {
      if (!TERMINAL.has(entry.status)) {
        entry.status = 'interrupted';
        entry.updatedAt = now;
        entry.finishedAt = now;
        entry.error = 'The previous application session ended before this operation finished.';
        changed = true;
      }
    });
    if (changed) this._persist();
    return this.operations();
  }

  shutdown() {
    this.closed = true;
    for (const controller of this.controllers.values()) controller.abort('Application shutdown');
    this.controllers.clear();
    while (this.waiters.length) this.waiters.shift().reject(new Error('Ollama service is shutting down.'));
    this._persist();
  }

  async status() {
    try {
      const version = await this.version();
      return { state: 'ready', ready: true, origin: this.baseUrl.origin, version: version.version, error: null };
    } catch (error) {
      return {
        state: classifyAvailability(error),
        ready: false,
        origin: this.baseUrl.origin,
        version: null,
        error: publicError(error)
      };
    }
  }

  version() {
    return this._json('/api/version', { method: 'GET', timeoutMs: 5000, maxBytes: 64 * 1024 })
      .then((value) => ({ version: boundedString(value?.version, 'Ollama version', 128) }));
  }

  async tags() {
    const value = await this._json('/api/tags', { method: 'GET', timeoutMs: 15_000, maxBytes: 16 * 1024 * 1024 });
    return { models: normalizeModels(value?.models, 'installed') };
  }

  async running() {
    const value = await this._json('/api/ps', { method: 'GET', timeoutMs: 15_000, maxBytes: 16 * 1024 * 1024 });
    return { models: normalizeModels(value?.models, 'running') };
  }

  async models() {
    const [installed, running] = await Promise.all([this.tags(), this.running()]);
    const runningByName = new Map(running.models.map((model) => [model.name, model]));
    return {
      installed: installed.models.map((model) => ({ ...model, running: runningByName.has(model.name) })),
      running: running.models
    };
  }

  show(model) {
    return this._json('/api/show', {
      method: 'POST',
      body: { model: normalizeModel(model) },
      timeoutMs: 30_000,
      maxBytes: 16 * 1024 * 1024
    });
  }

  pull(spec, onEvent) {
    const model = normalizeModel(spec?.model);
    return this._start('pull', model, '/api/pull', {
      model,
      stream: true,
      insecure: Boolean(spec?.insecure)
    }, onEvent, 24 * 60 * 60 * 1000);
  }

  async delete(spec) {
    const model = normalizeModel(spec?.model);
    await this._json('/api/delete', { method: 'DELETE', body: { model }, timeoutMs: 30_000, maxBytes: 1024 * 1024 });
    return { model, deleted: true };
  }

  async copy(spec) {
    const source = normalizeModel(spec?.source);
    const destination = normalizeModel(spec?.destination);
    await this._json('/api/copy', {
      method: 'POST', body: { source, destination }, timeoutMs: 60_000, maxBytes: 1024 * 1024
    });
    return { source, destination, copied: true };
  }

  generate(spec, onEvent) {
    const body = normalizeGenerate(spec);
    return this._start('generate', body.model, '/api/generate', body, onEvent, 60 * 60 * 1000);
  }

  chat(spec, onEvent) {
    const body = normalizeChat(spec);
    return this._start('chat', body.model, '/api/chat', body, onEvent, 60 * 60 * 1000);
  }

  cancel(operationId) {
    if (typeof operationId !== 'string' || !SAFE_OPERATION_ID.test(operationId)) throw new TypeError('Invalid Ollama operation id.');
    const controller = this.controllers.get(operationId);
    const entry = this.history.find((candidate) => candidate.id === operationId);
    if (!entry) throw new Error('Ollama operation not found.');
    if (TERMINAL.has(entry.status)) return publicOperation(entry);
    entry.cancelRequested = true;
    entry.updatedAt = new Date().toISOString();
    controller?.abort('Cancelled by user');
    this._changed(entry, 'cancellation-requested');
    return publicOperation(entry);
  }

  operations() {
    return this.history.map(publicOperation);
  }

  _start(kind, model, endpoint, body, onEvent, timeoutMs) {
    if (this.closed) throw new Error('Ollama service is shutting down.');
    if (onEvent !== undefined && typeof onEvent !== 'function') throw new TypeError('Ollama progress callback must be a function.');
    const now = new Date().toISOString();
    const entry = {
      id: randomUUID(), kind, model, status: 'queued', createdAt: now, updatedAt: now,
      startedAt: null, finishedAt: null, progress: {}, error: null, cancelRequested: false
    };
    this.history.push(entry);
    this._trim();
    this._changed(entry, 'created');
    const promise = this._runStream(entry, endpoint, body, onEvent, timeoutMs);
    return { id: entry.id, promise, cancel: () => this.cancel(entry.id) };
  }

  async _runStream(entry, endpoint, body, onEvent, timeoutMs) {
    let release;
    try {
      release = await this._acquire();
      if (entry.cancelRequested) throw abortError('Cancelled by user');
      const controller = new AbortController();
      this.controllers.set(entry.id, controller);
      entry.status = 'running';
      entry.startedAt = new Date().toISOString();
      entry.updatedAt = entry.startedAt;
      this._changed(entry, 'started');

      const result = await this._stream(endpoint, {
        method: 'POST', body, timeoutMs, signal: controller.signal,
        onValue: (value) => {
          entry.progress = progressSummary(value);
          entry.updatedAt = new Date().toISOString();
          this._changed(entry, 'progress', false);
          onEvent?.(boundedEvent(value));
        }
      });
      entry.status = 'completed';
      entry.finishedAt = new Date().toISOString();
      entry.updatedAt = entry.finishedAt;
      entry.progress = progressSummary(result);
      entry.error = null;
      this._changed(entry, 'completed');
      return { operation: publicOperation(entry), result: boundedEvent(result) };
    } catch (error) {
      const cancelled = entry.cancelRequested;
      entry.status = this.closed ? 'interrupted' : cancelled ? 'cancelled' : 'failed';
      entry.finishedAt = new Date().toISOString();
      entry.updatedAt = entry.finishedAt;
      entry.error = cancelled ? null : publicError(error);
      this._changed(entry, entry.status);
      if (cancelled) return { operation: publicOperation(entry), result: null };
      throw error;
    } finally {
      this.controllers.delete(entry.id);
      release?.();
    }
  }

  async _json(endpoint, options) {
    const request = await this._request(endpoint, options);
    try {
      const bytes = await readBounded(request.response.body, options.maxBytes || 4 * 1024 * 1024, request.signal);
      const text = bytes.toString('utf8');
      if (!text.trim()) return {};
      try { return JSON.parse(text); }
      catch (_) { throw new Error('Ollama returned malformed JSON.'); }
    } finally {
      request.cleanup();
    }
  }

  async _stream(endpoint, options) {
    const request = await this._request(endpoint, options);
    const response = request.response;
    if (!response.body?.getReader) {
      request.cleanup();
      throw new Error('Ollama returned no readable response body.');
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let carry = '';
    let bytes = 0;
    let last = {};
    try {
      while (true) {
        if (request.signal.aborted) throw abortError(request.signal.reason);
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_RESPONSE_BYTES) throw new Error('Ollama streamed response exceeded the size limit.');
        carry += decoder.decode(value, { stream: true });
        if (Buffer.byteLength(carry, 'utf8') > MAX_STREAM_LINE_BYTES * 2) throw new Error('Ollama stream line exceeded the size limit.');
        const lines = carry.split(/\r?\n/);
        carry = lines.pop() || '';
        for (const line of lines) last = consumeNdjson(line, options.onValue, last);
      }
      carry += decoder.decode();
      if (carry.trim()) last = consumeNdjson(carry, options.onValue, last);
      return last;
    } finally {
      try { reader.releaseLock(); } catch (_) { /* Reader already released. */ }
      request.cleanup();
    }
  }

  async _request(endpoint, options = {}) {
    const target = endpointUrl(this.baseUrl, endpoint);
    const body = options.body === undefined ? undefined : encodeBody(options.body);
    const timeoutMs = Math.max(1000, Math.min(Number(options.timeoutMs) || 30_000, 24 * 60 * 60 * 1000));
    const timeoutController = new AbortController();
    const relayAbort = () => timeoutController.abort(options.signal?.reason || 'Cancelled');
    options.signal?.addEventListener('abort', relayAbort, { once: true });
    const timer = setTimeout(() => timeoutController.abort('Ollama request timed out'), timeoutMs);
    timer.unref?.();
    const cleanup = () => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', relayAbort);
    };
    let handedOff = false;
    try {
      let response;
      try {
        response = await this.fetchImpl(target, {
          method: options.method || 'GET',
          headers: body === undefined ? { Accept: 'application/json, application/x-ndjson' } : {
            Accept: 'application/json, application/x-ndjson', 'Content-Type': 'application/json'
          },
          body,
          redirect: 'error',
          credentials: 'omit',
          cache: 'no-store',
          signal: timeoutController.signal
        });
      } catch (error) {
        if (timeoutController.signal.aborted) throw abortError(timeoutController.signal.reason);
        const wrapped = new Error('The local Ollama service could not be reached.');
        wrapped.cause = error;
        wrapped.code = error?.cause?.code || error?.code || 'OLLAMA_UNAVAILABLE';
        throw wrapped;
      }
      if (response.redirected || response.url && new URL(response.url).origin !== this.baseUrl.origin) {
        throw new Error('Ollama redirects are not allowed.');
      }
      if (!response.ok) {
        const detail = await readBounded(response.body, 256 * 1024, timeoutController.signal)
          .then((value) => safeServerMessage(value.toString('utf8')))
          .catch(() => '');
        throw new Error(`Ollama returned HTTP ${response.status}${detail ? `: ${detail}` : ''}.`);
      }
      handedOff = true;
      return { response, signal: timeoutController.signal, cleanup };
    } finally {
      if (!handedOff) cleanup();
    }
  }

  _acquire() {
    if (this.activeCount < this.concurrency) {
      this.activeCount += 1;
      return Promise.resolve(() => this._release());
    }
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  _release() {
    const next = this.waiters.shift();
    if (next) next.resolve(() => this._release());
    else this.activeCount = Math.max(0, this.activeCount - 1);
  }

  _changed(entry, type, persist = true) {
    if (persist) this._persist();
    this.emit('event', { type, operation: publicOperation(entry) });
  }

  _trim() {
    const overflow = this.history.length - MAX_OPERATIONS;
    if (overflow <= 0) return;
    const removable = this.history.filter((entry) => TERMINAL.has(entry.status)).slice(0, overflow);
    const remove = new Set(removable.map((entry) => entry.id));
    this.history = this.history.filter((entry) => !remove.has(entry.id));
    if (this.history.length > MAX_OPERATIONS) throw new Error('Too many active Ollama operations.');
  }

  _load() {
    if (!fs.existsSync(this.stateFile)) return;
    try {
      const stats = fs.statSync(this.stateFile);
      if (!stats.isFile() || stats.size > MAX_STATE_BYTES) throw new Error('Ollama state is too large.');
      const parsed = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
      if (!parsed || parsed.version !== STATE_VERSION || !Array.isArray(parsed.operations) || parsed.operations.length > MAX_OPERATIONS) {
        throw new Error('Unsupported Ollama state.');
      }
      this.history = parsed.operations.filter(validStoredOperation).map((entry) => ({ ...entry, progress: { ...(entry.progress || {}) } }));
    } catch (_) {
      try { fs.renameSync(this.stateFile, `${this.stateFile}.invalid-${Date.now()}`); } catch (_) { /* Preserve unreadable input. */ }
      this.history = [];
    }
  }

  _persist() {
    fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
    const temporary = `${this.stateFile}.${process.pid}.${Date.now()}.tmp`;
    const body = JSON.stringify({ version: STATE_VERSION, savedAt: new Date().toISOString(), operations: this.history });
    if (Buffer.byteLength(body, 'utf8') > MAX_STATE_BYTES) throw new Error('Ollama state exceeded the size limit.');
    fs.writeFileSync(temporary, body, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    try { fs.renameSync(temporary, this.stateFile); }
    catch (error) {
      try { fs.rmSync(this.stateFile, { force: true }); fs.renameSync(temporary, this.stateFile); }
      catch (_) { try { fs.rmSync(temporary, { force: true }); } catch (_) { /* Best effort cleanup. */ } throw error; }
    }
  }
}

function normalizeLoopbackBase(value) {
  let url;
  try { url = new URL(value); } catch (_) { throw new TypeError('Ollama base URL is invalid.'); }
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(hostname)) {
    throw new TypeError('Ollama must use a loopback-only HTTP URL.');
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new TypeError('Ollama base URL cannot contain credentials, a path, query, or fragment.');
  }
  url.pathname = '/';
  return url;
}

function endpointUrl(base, endpoint) {
  if (typeof endpoint !== 'string' || !/^\/api\/[a-z]+$/.test(endpoint)) throw new TypeError('Invalid Ollama endpoint.');
  const target = new URL(endpoint, base);
  if (target.origin !== base.origin || target.username || target.password || target.search || target.hash) {
    throw new Error('Ollama request escaped the configured loopback origin.');
  }
  return target.href;
}

function encodeBody(value) {
  validateBoundedJson(value, 0);
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded, 'utf8') > MAX_REQUEST_BYTES) throw new TypeError('Ollama request exceeded the size limit.');
  return encoded;
}

function validateBoundedJson(value, depth) {
  if (depth > 8) throw new TypeError('Ollama request nesting is too deep.');
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('Ollama request contains a non-finite number.');
    return;
  }
  if (typeof value === 'string') {
    if (Buffer.byteLength(value, 'utf8') > MAX_TEXT_BYTES || /\0/.test(value)) throw new TypeError('Ollama request text is invalid or too large.');
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_MODELS) throw new TypeError('Ollama request array is too large.');
    value.forEach((entry) => validateBoundedJson(entry, depth + 1));
    return;
  }
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError('Ollama request contains an unsupported value.');
  }
  const keys = Object.keys(value);
  if (keys.length > 128 || keys.some((key) => key.length > 128 || ['__proto__', 'prototype', 'constructor'].includes(key))) {
    throw new TypeError('Ollama request object is invalid or too large.');
  }
  keys.forEach((key) => validateBoundedJson(value[key], depth + 1));
}

function normalizeGenerate(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new TypeError('Generate request must be an object.');
  const allowed = new Set(['model', 'prompt', 'suffix', 'system', 'template', 'context', 'raw', 'format', 'options', 'keep_alive', 'images']);
  rejectUnknown(spec, allowed, 'generate');
  return {
    ...copyDefined(spec, allowed), model: normalizeModel(spec.model), prompt: boundedString(spec.prompt, 'Prompt', MAX_TEXT_BYTES), stream: true
  };
}

function normalizeChat(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new TypeError('Chat request must be an object.');
  const allowed = new Set(['model', 'messages', 'format', 'options', 'keep_alive', 'tools']);
  rejectUnknown(spec, allowed, 'chat');
  if (!Array.isArray(spec.messages) || spec.messages.length < 1 || spec.messages.length > MAX_MESSAGES) {
    throw new TypeError(`Chat messages must contain between 1 and ${MAX_MESSAGES} entries.`);
  }
  const messages = spec.messages.map((message) => {
    if (!message || typeof message !== 'object' || Array.isArray(message)) throw new TypeError('Chat message is invalid.');
    rejectUnknown(message, new Set(['role', 'content', 'images', 'tool_calls', 'tool_name']), 'chat message');
    if (!SAFE_ROLES.has(message.role)) throw new TypeError('Chat message role is invalid.');
    return { ...copyDefined(message, new Set(['role', 'content', 'images', 'tool_calls', 'tool_name'])), content: boundedString(message.content, 'Message content', MAX_TEXT_BYTES) };
  });
  return { ...copyDefined(spec, allowed), model: normalizeModel(spec.model), messages, stream: true };
}

function rejectUnknown(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw new TypeError(`Unknown ${label} field: ${unknown[0]}.`);
}

function copyDefined(value, allowed) {
  const result = {};
  allowed.forEach((key) => { if (value[key] !== undefined) result[key] = value[key]; });
  return result;
}

function normalizeModel(value) {
  if (typeof value !== 'string' || value.length > 256 || !SAFE_MODEL.test(value)) throw new TypeError('Ollama model name is invalid.');
  return value;
}

function normalizeModels(value, source) {
  if (!Array.isArray(value) || value.length > MAX_MODELS) throw new Error(`Ollama ${source} model list is invalid or too large.`);
  return value.map((model) => {
    if (!model || typeof model !== 'object' || Array.isArray(model)) throw new Error(`Ollama ${source} model record is invalid.`);
    const name = normalizeModel(model.name || model.model);
    return boundedEvent({ ...model, name });
  });
}

function boundedString(value, label, max) {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value, 'utf8') > max || /\0/.test(value)) {
    throw new TypeError(`${label} is missing, invalid, or too large.`);
  }
  return value;
}

function consumeNdjson(line, callback, previous) {
  if (!line.trim()) return previous;
  if (Buffer.byteLength(line, 'utf8') > MAX_STREAM_LINE_BYTES) throw new Error('Ollama stream line exceeded the size limit.');
  let value;
  try { value = JSON.parse(line); } catch (_) { throw new Error('Ollama returned malformed streaming JSON.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Ollama stream event is invalid.');
  if (typeof value.error === 'string' && value.error.trim()) throw new Error(`Ollama operation failed: ${safeServerMessage(value.error)}`);
  const safe = boundedEvent(value);
  callback?.(safe);
  return safe;
}

function boundedEvent(value) {
  validateBoundedJson(value, 0);
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded, 'utf8') > MAX_STREAM_LINE_BYTES) throw new Error('Ollama response event exceeded the size limit.');
  return JSON.parse(encoded);
}

function progressSummary(value) {
  const result = {};
  for (const key of ['status', 'digest', 'total', 'completed', 'done', 'done_reason', 'eval_count', 'eval_duration']) {
    if (typeof value?.[key] === 'string') result[key] = value[key].slice(0, 512);
    else if (typeof value?.[key] === 'number' && Number.isFinite(value[key])) result[key] = value[key];
    else if (typeof value?.[key] === 'boolean') result[key] = value[key];
  }
  return result;
}

async function readBounded(body, maxBytes, signal) {
  if (!body?.getReader) return Buffer.alloc(0);
  const reader = body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      if (signal?.aborted) throw abortError(signal.reason);
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > Math.min(maxBytes, MAX_RESPONSE_BYTES)) throw new Error('Ollama response exceeded the size limit.');
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  } finally {
    try { reader.releaseLock(); } catch (_) { /* Reader already released. */ }
  }
}

function classifyAvailability(error) {
  const code = error?.code || error?.cause?.code || '';
  const message = String(error?.message || '');
  if (/ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|OLLAMA_UNAVAILABLE/.test(code) || /could not be reached/i.test(message)) return 'unavailable';
  if (error?.name === 'AbortError' || /timed out/i.test(message)) return 'unhealthy';
  return 'error';
}

function safeServerMessage(value) {
  return String(value || '').replace(/[\0\r\n\t]+/g, ' ').trim().slice(0, 1000);
}

function publicError(error) {
  return safeServerMessage(error?.message || 'The local Ollama operation failed.');
}

function abortError(reason) {
  const error = new Error(safeServerMessage(reason) || 'Ollama operation was cancelled.');
  error.name = 'AbortError';
  return error;
}

function publicOperation(entry) {
  return {
    id: entry.id, kind: entry.kind, model: entry.model, status: entry.status,
    createdAt: entry.createdAt, updatedAt: entry.updatedAt, startedAt: entry.startedAt,
    finishedAt: entry.finishedAt, progress: { ...(entry.progress || {}) }, error: entry.error,
    cancelRequested: Boolean(entry.cancelRequested)
  };
}

function validStoredOperation(entry) {
  return Boolean(entry && typeof entry === 'object' && SAFE_OPERATION_ID.test(entry.id) &&
    ['pull', 'generate', 'chat'].includes(entry.kind) && SAFE_MODEL.test(entry.model) &&
    ['queued', 'running', 'completed', 'failed', 'cancelled', 'interrupted'].includes(entry.status));
}

module.exports = {
  OllamaService,
  normalizeLoopbackBase
};
