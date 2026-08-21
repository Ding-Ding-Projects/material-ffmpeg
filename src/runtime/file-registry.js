'use strict';

const path = require('path');
const { randomUUID } = require('crypto');

const HANDLE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = new Set(['input', 'output']);
const DEFAULT_TTL_MS = 30 * 60 * 1000;
const MIN_TTL_MS = 1;
const MAX_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 2_048;
const MAX_NAME_LENGTH = 255;
const MAX_PATH_LENGTH = 32_767;

class FileRegistry {
  constructor(options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('File registry options must be an object.');
    }
    this._now = typeof options.now === 'function' ? options.now : Date.now;
    this._setTimeout = typeof options.setTimeout === 'function' ? options.setTimeout : setTimeout;
    this._clearTimeout = typeof options.clearTimeout === 'function' ? options.clearTimeout : clearTimeout;
    this._ttlMs = boundedInteger(options.ttlMs, DEFAULT_TTL_MS, MIN_TTL_MS, MAX_TTL_MS, 'File handle lifetime');
    this._maxEntries = boundedInteger(options.maxEntries, DEFAULT_MAX_ENTRIES, 1, DEFAULT_MAX_ENTRIES, 'File registry capacity');
    this._entries = new Map();
    this._cleanupTimer = null;
  }

  register(filePath, kind = 'input') {
    if (typeof filePath !== 'string' || !filePath || filePath.length > MAX_PATH_LENGTH || /\0/.test(filePath) || !path.isAbsolute(filePath)) {
      throw new TypeError('A selected file must have an absolute path.');
    }
    if (!KINDS.has(kind)) {
      throw new TypeError('File handle kind must be input or output.');
    }

    this._cleanupExpired();
    if (this._entries.size >= this._maxEntries) {
      throw new Error('The file handle registry is full; release an unused selection before trying again.');
    }

    const normalizedPath = path.normalize(filePath);
    const name = path.basename(normalizedPath);
    if (!name || name.length > MAX_NAME_LENGTH) {
      throw new TypeError('The selected file name is invalid.');
    }

    const createdAt = this._now();
    const expiresAt = createdAt + this._ttlMs;
    const handle = randomUUID();
    this._entries.set(handle, {
      path: normalizedPath,
      kind,
      name,
      createdAt,
      expiresAt
    });
    this._scheduleCleanup();
    return this.describe(handle);
  }

  describe(handle) {
    const entry = this._get(handle);
    return Object.freeze({
      handle,
      kind: entry.kind,
      name: entry.name,
      createdAt: toIso(entry.createdAt),
      expiresAt: toIso(entry.expiresAt)
    });
  }

  resolve(handle, expectedKind) {
    this._validateHandle(handle);
    if (!KINDS.has(expectedKind)) {
      throw new TypeError('A file handle kind is required when resolving a selection.');
    }
    const entry = this._get(handle);
    if (entry.kind !== expectedKind) {
      throw new Error(`The selected file handle is not an ${expectedKind} handle.`);
    }
    return entry.path;
  }

  retain(handle, expectedKind, ttlMs = MAX_TTL_MS) {
    this._validateHandle(handle);
    if (!KINDS.has(expectedKind)) {
      throw new TypeError('A file handle kind is required when retaining a selection.');
    }
    const lifetime = boundedInteger(ttlMs, MAX_TTL_MS, MIN_TTL_MS, MAX_TTL_MS, 'Retained file handle lifetime');
    const entry = this._get(handle);
    if (entry.kind !== expectedKind) {
      throw new Error(`The selected file handle is not an ${expectedKind} handle.`);
    }
    entry.expiresAt = Math.max(entry.expiresAt, this._now() + lifetime);
    this._scheduleCleanup();
    return this.describe(handle);
  }

  release(handle) {
    this._validateHandle(handle);
    const released = this._entries.delete(handle);
    this._scheduleCleanup();
    return released;
  }

  clear() {
    const count = this._entries.size;
    this._entries.clear();
    this._cancelCleanup();
    return count;
  }

  dispose() {
    this.clear();
  }

  _get(handle) {
    this._validateHandle(handle);
    const entry = this._entries.get(handle);
    if (!entry) throw new Error('The selected file handle is no longer available.');
    if (entry.expiresAt <= this._now()) {
      this._entries.delete(handle);
      this._scheduleCleanup();
      throw new Error('The selected file handle has expired.');
    }
    return entry;
  }

  _validateHandle(handle) {
    if (typeof handle !== 'string' || !HANDLE_RE.test(handle)) {
      throw new TypeError('Invalid file handle.');
    }
  }

  _cleanupExpired() {
    const now = this._now();
    for (const [handle, entry] of this._entries) {
      if (entry.expiresAt <= now) this._entries.delete(handle);
    }
  }

  _scheduleCleanup() {
    this._cancelCleanup();
    if (!this._entries.size) return;
    let nextExpiry = Infinity;
    for (const entry of this._entries.values()) nextExpiry = Math.min(nextExpiry, entry.expiresAt);
    const delay = Math.max(0, nextExpiry - this._now());
    this._cleanupTimer = this._setTimeout(() => {
      this._cleanupTimer = null;
      this._cleanupExpired();
      this._scheduleCleanup();
    }, delay);
    this._cleanupTimer?.unref?.();
  }

  _cancelCleanup() {
    if (!this._cleanupTimer) return;
    this._clearTimeout(this._cleanupTimer);
    this._cleanupTimer = null;
  }
}

function boundedInteger(value, fallback, minimum, maximum, label) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function toIso(value) {
  return new Date(value).toISOString();
}

module.exports = {
  DEFAULT_MAX_ENTRIES,
  DEFAULT_TTL_MS,
  FileRegistry,
  MAX_TTL_MS,
  MIN_TTL_MS
};
