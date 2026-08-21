'use strict';

const path = require('path');
const { randomUUID } = require('crypto');

const HANDLE_RE = /^[0-9a-f-]{36}$/i;

class FileRegistry {
  constructor() {
    this._entries = new Map();
  }

  register(filePath, kind = 'input') {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
      throw new TypeError('A selected file must have an absolute path.');
    }
    if (kind !== 'input' && kind !== 'output') {
      throw new TypeError('File handle kind must be input or output.');
    }

    const handle = randomUUID();
    this._entries.set(handle, {
      path: path.normalize(filePath),
      kind,
      name: path.basename(filePath),
      createdAt: new Date().toISOString()
    });
    return this.describe(handle);
  }

  describe(handle) {
    const entry = this._get(handle);
    return Object.freeze({ handle, kind: entry.kind, name: entry.name });
  }

  resolve(handle, expectedKind) {
    const entry = this._get(handle);
    if (expectedKind && entry.kind !== expectedKind) {
      throw new Error(`The selected file handle is not an ${expectedKind} handle.`);
    }
    return entry.path;
  }

  _get(handle) {
    if (typeof handle !== 'string' || !HANDLE_RE.test(handle)) {
      throw new TypeError('Invalid file handle.');
    }
    const entry = this._entries.get(handle);
    if (!entry) throw new Error('The selected file handle is no longer available.');
    return entry;
  }
}

module.exports = { FileRegistry };
