(function materialFfmpegSecurityFeature(global) {
  'use strict';

  const STORAGE_KEY = 'material-ffmpeg.features.security.v1';
  const SESSION_KEY = 'material-ffmpeg.features.security.sessions.v1';
  const SCHEMA_VERSION = 1;
  const MAX_LOCKS = 2048;
  const MAX_AUTHENTICATORS = 512;
  const MAX_TICKETS = 512;
  const MAX_TEXT = 512;
  const PASSWORD_ITERATIONS = 210000;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const pendingTotpLocks = new Map();
  const registeredElements = new WeakMap();
  const exportSessions = new Map();
  let core = null;

  const QR_IMPORT_STATUS = Object.freeze({
    available: false,
    reason:
      'QR image import is unavailable in this build because a standards-correct local decoder is not bundled. Paste an otpauth URI or enter the secret manually instead.',
  });

  const SUPPORT_DISCLOSURE =
    'Nothing is sent anywhere. No ticket exists outside this device. No network request is made. No data is collected, and nobody is reading it.';

  function blankState() {
    return {
      version: SCHEMA_VERSION,
      locks: [],
      authenticators: [],
      tickets: [],
      authenticatorOrder: [],
    };
  }

  function text(value, max = MAX_TEXT) {
    return String(value == null ? '' : value).trim().slice(0, max);
  }

  function integer(value, min, max, fallback) {
    const number = Number(value);
    return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
  }

  function randomId(prefix) {
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    return `${prefix}_${toBase64Url(bytes)}`;
  }

  function toBase64Url(bytes) {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
  }

  function fromBase64Url(value) {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  function encodeBase32(bytes) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = 0;
    let value = 0;
    let output = '';
    for (const byte of bytes) {
      value = (value << 8) | byte;
      bits += 8;
      while (bits >= 5) {
        output += alphabet[(value >>> (bits - 5)) & 31];
        bits -= 5;
      }
    }
    if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
    return output;
  }

  function decodeBase32(input) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const normalized = text(input, 4096).toUpperCase().replace(/[\s=-]/g, '');
    if (!normalized || /[^A-Z2-7]/u.test(normalized)) {
      throw new Error('The secret must use base32 characters A-Z and 2-7.');
    }
    let bits = 0;
    let value = 0;
    const output = [];
    for (const character of normalized) {
      value = (value << 5) | alphabet.indexOf(character);
      bits += 5;
      if (bits >= 8) {
        output.push((value >>> (bits - 8)) & 255);
        bits -= 8;
      }
    }
    if (output.length < 10 || output.length > 128) {
      throw new Error('The secret must decode to between 10 and 128 bytes.');
    }
    return Uint8Array.from(output);
  }

  function normalizeAlgorithm(value) {
    const algorithm = text(value || 'SHA1', 16).toUpperCase().replace('-', '');
    if (!['SHA1', 'SHA256', 'SHA512'].includes(algorithm)) {
      throw new Error('The TOTP algorithm must be SHA-1, SHA-256, or SHA-512.');
    }
    return algorithm;
  }

  function webCryptoAlgorithm(value) {
    return normalizeAlgorithm(value).replace(/^SHA/u, 'SHA-');
  }

  function normalizeTotpParameters(input = {}) {
    return {
      algorithm: normalizeAlgorithm(input.algorithm),
      digits: integer(input.digits, 6, 8, 6),
      period: integer(input.period, 1, 3600, 30),
    };
  }

  async function generateTotp(secret, options = {}, timestamp = Date.now()) {
    const parameters = normalizeTotpParameters(options);
    const secretBytes = decodeBase32(secret);
    const counter = BigInt(Math.floor(timestamp / 1000 / parameters.period));
    const counterBytes = new Uint8Array(8);
    let remaining = counter;
    for (let index = 7; index >= 0; index -= 1) {
      counterBytes[index] = Number(remaining & 255n);
      remaining >>= 8n;
    }
    const key = await crypto.subtle.importKey(
      'raw',
      secretBytes,
      { name: 'HMAC', hash: webCryptoAlgorithm(parameters.algorithm) },
      false,
      ['sign'],
    );
    const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, counterBytes));
    const offset = signature[signature.length - 1] & 15;
    const value =
      ((signature[offset] & 127) << 24) |
      ((signature[offset + 1] & 255) << 16) |
      ((signature[offset + 2] & 255) << 8) |
      (signature[offset + 3] & 255);
    return String(value % 10 ** parameters.digits).padStart(parameters.digits, '0');
  }

  async function verifyTotp(secret, code, options = {}, timestamp = Date.now(), skew = 1) {
    const parameters = normalizeTotpParameters(options);
    const candidate = text(code, 16).replace(/\s/g, '');
    if (!new RegExp(`^\\d{${parameters.digits}}$`, 'u').test(candidate)) return false;
    const allowedSkew = integer(skew, 0, 2, 1);
    for (let step = -allowedSkew; step <= allowedSkew; step += 1) {
      const expected = await generateTotp(
        secret,
        parameters,
        timestamp + step * parameters.period * 1000,
      );
      if (constantTimeEqual(candidate, expected)) return true;
    }
    return false;
  }

  async function getTotpSnapshot(entry, timestamp = Date.now()) {
    const parameters = normalizeTotpParameters(entry);
    const elapsed = Math.floor(timestamp / 1000) % parameters.period;
    return {
      current: await generateTotp(entry.secret, parameters, timestamp),
      next: await generateTotp(entry.secret, parameters, timestamp + parameters.period * 1000),
      secondsRemaining: parameters.period - elapsed,
      period: parameters.period,
      digits: parameters.digits,
      algorithm: parameters.algorithm,
    };
  }

  function constantTimeEqual(left, right) {
    const a = encoder.encode(String(left));
    const b = encoder.encode(String(right));
    let difference = a.length ^ b.length;
    const length = Math.max(a.length, b.length);
    for (let index = 0; index < length; index += 1) {
      difference |= (a[index % a.length] || 0) ^ (b[index % b.length] || 0);
    }
    return difference === 0;
  }

  async function hashPassword(password, saltBytes) {
    const value = String(password == null ? '' : password);
    if (value.length < 1 || value.length > 1024) throw new Error('Enter a password.');
    const salt = saltBytes || crypto.getRandomValues(new Uint8Array(16));
    const material = await crypto.subtle.importKey('raw', encoder.encode(value), 'PBKDF2', false, [
      'deriveBits',
    ]);
    const derived = new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt, iterations: PASSWORD_ITERATIONS, hash: 'SHA-256' },
        material,
        256,
      ),
    );
    return { salt: toBase64Url(salt), hash: toBase64Url(derived) };
  }

  async function verifyPassword(password, credential) {
    if (!credential || !credential.salt || !credential.hash) return false;
    const computed = await hashPassword(password, fromBase64Url(credential.salt));
    return constantTimeEqual(computed.hash, credential.hash);
  }

  function parseOtpAuthUri(value) {
    let url;
    try {
      url = new URL(text(value, 8192));
    } catch {
      throw new Error('Enter a valid otpauth URI.');
    }
    if (url.protocol !== 'otpauth:' || url.hostname.toLowerCase() !== 'totp') {
      throw new Error('Only otpauth TOTP URIs are supported.');
    }
    const label = decodeURIComponent(url.pathname.replace(/^\//u, '')).slice(0, MAX_TEXT);
    const secret = text(url.searchParams.get('secret'), 4096).replace(/[\s=-]/g, '').toUpperCase();
    decodeBase32(secret);
    const issuerFromLabel = label.includes(':') ? label.split(':', 1)[0] : '';
    const account = label.includes(':') ? label.slice(label.indexOf(':') + 1) : label;
    const parameters = normalizeTotpParameters({
      algorithm: url.searchParams.get('algorithm') || 'SHA1',
      digits: Number(url.searchParams.get('digits') || 6),
      period: Number(url.searchParams.get('period') || 30),
    });
    return {
      secret,
      issuer: text(url.searchParams.get('issuer') || issuerFromLabel || 'Local entry'),
      account: text(account || 'Unnamed account'),
      ...parameters,
    };
  }

  function buildOtpAuthUri(entry) {
    const parameters = normalizeTotpParameters(entry);
    decodeBase32(entry.secret);
    const issuer = text(entry.issuer || 'Local entry');
    const account = text(entry.account || 'Unnamed account');
    const label = `${issuer}:${account}`;
    const query = new URLSearchParams({
      secret: text(entry.secret, 4096).replace(/[\s=-]/g, '').toUpperCase(),
      issuer,
      algorithm: parameters.algorithm,
      digits: String(parameters.digits),
      period: String(parameters.period),
    });
    return `otpauth://totp/${encodeURIComponent(label)}?${query.toString()}`;
  }

  function sanitizeLock(record) {
    if (!record || typeof record !== 'object') return null;
    const method = record.method === 'totp' ? 'totp' : record.method === 'password' ? 'password' : '';
    if (!method) return null;
    const base = {
      id: text(record.id, 128),
      targetId: text(record.targetId, 256),
      targetLabel: text(record.targetLabel),
      method,
      unlockMode: ['surface', 'minutes', 'until-close'].includes(record.unlockMode)
        ? record.unlockMode
        : 'surface',
      unlockMinutes: integer(record.unlockMinutes, 1, 1440, 15),
      createdAt: text(record.createdAt, 64),
    };
    if (!base.id || !base.targetId) return null;
    if (method === 'password') {
      if (!record.credential || !record.credential.salt || !record.credential.hash) return null;
      base.credential = {
        salt: text(record.credential.salt, 128),
        hash: text(record.credential.hash, 128),
      };
    } else {
      try {
        decodeBase32(record.secret);
        Object.assign(base, normalizeTotpParameters(record), {
          secret: text(record.secret, 4096).replace(/[\s=-]/g, '').toUpperCase(),
        });
      } catch {
        return null;
      }
    }
    return base;
  }

  function sanitizeAuthenticator(record) {
    if (!record || typeof record !== 'object') return null;
    try {
      decodeBase32(record.secret);
      const parameters = normalizeTotpParameters(record);
      const id = text(record.id, 128);
      if (!id) return null;
      return {
        id,
        issuer: text(record.issuer || 'Local entry'),
        account: text(record.account || 'Unnamed account'),
        group: text(record.group || 'Ungrouped'),
        secret: text(record.secret, 4096).replace(/[\s=-]/g, '').toUpperCase(),
        createdAt: text(record.createdAt, 64),
        ...parameters,
      };
    } catch {
      return null;
    }
  }

  function sanitizeTicket(record) {
    if (!record || typeof record !== 'object') return null;
    const id = text(record.id, 128);
    if (!id) return null;
    return {
      id,
      number: text(record.number, 64),
      category: text(record.category || 'Access recovery'),
      severity: text(record.severity || 'Routine'),
      description: text(record.description, 4096),
      status: ['Received', 'Investigating locally', 'Resolution ready'].includes(record.status)
        ? record.status
        : 'Received',
      createdAt: text(record.createdAt, 64),
      updatedAt: text(record.updatedAt, 64),
    };
  }

  function loadState() {
    let parsed;
    try {
      parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    } catch {
      return blankState();
    }
    if (!parsed || parsed.version !== SCHEMA_VERSION || typeof parsed !== 'object') return blankState();
    const locks = Array.isArray(parsed.locks)
      ? parsed.locks.slice(0, MAX_LOCKS).map(sanitizeLock).filter(Boolean)
      : [];
    const authenticators = Array.isArray(parsed.authenticators)
      ? parsed.authenticators.slice(0, MAX_AUTHENTICATORS).map(sanitizeAuthenticator).filter(Boolean)
      : [];
    const validIds = new Set(authenticators.map((entry) => entry.id));
    const order = Array.isArray(parsed.authenticatorOrder)
      ? parsed.authenticatorOrder.map((id) => text(id, 128)).filter((id) => validIds.has(id))
      : [];
    for (const id of validIds) if (!order.includes(id)) order.push(id);
    return {
      version: SCHEMA_VERSION,
      locks,
      authenticators,
      tickets: Array.isArray(parsed.tickets)
        ? parsed.tickets.slice(0, MAX_TICKETS).map(sanitizeTicket).filter(Boolean)
        : [],
      authenticatorOrder: order,
    };
  }

  function saveState(state) {
    const safe = {
      version: SCHEMA_VERSION,
      locks: state.locks.slice(0, MAX_LOCKS),
      authenticators: state.authenticators.slice(0, MAX_AUTHENTICATORS),
      tickets: state.tickets.slice(0, MAX_TICKETS),
      authenticatorOrder: state.authenticatorOrder.slice(0, MAX_AUTHENTICATORS),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
    global.dispatchEvent(new CustomEvent('material-ffmpeg-security-change', { detail: publicSummary(safe) }));
    return safe;
  }

  function publicSummary(state = loadState()) {
    return {
      locks: state.locks.length,
      authenticators: state.authenticators.length,
      tickets: state.tickets.length,
      qrImageImport: QR_IMPORT_STATUS,
      storage: 'This browser profile only',
    };
  }

  function targetIdentity(target) {
    if (typeof target === 'string') return { id: text(target, 256), label: text(target) };
    if (!(target instanceof Element)) throw new Error('A target element or target identifier is required.');
    const existing = target.dataset.featureLockId || target.id;
    const id = text(existing || randomId('element'), 256);
    target.dataset.featureLockId = id;
    const label = text(
      target.getAttribute('aria-label') || target.getAttribute('title') || target.textContent || target.tagName,
    );
    return { id, label: label || target.tagName.toLowerCase() };
  }

  function getLockForTarget(target) {
    const identity = targetIdentity(target);
    return loadState().locks.find((lock) => lock.targetId === identity.id) || null;
  }

  async function createPasswordLock(target, password, options = {}) {
    const state = loadState();
    if (state.locks.length >= MAX_LOCKS) throw new Error('The local lock limit has been reached.');
    const identity = targetIdentity(target);
    if (state.locks.some((lock) => lock.targetId === identity.id)) {
      throw new Error('This element already has a lock.');
    }
    const credential = await hashPassword(password);
    const record = sanitizeLock({
      id: randomId('lock'),
      targetId: identity.id,
      targetLabel: identity.label,
      method: 'password',
      credential,
      unlockMode: options.unlockMode,
      unlockMinutes: options.unlockMinutes,
      createdAt: new Date().toISOString(),
    });
    state.locks.push(record);
    saveState(state);
    return redactLock(record);
  }

  function prepareTotpLock(target, options = {}) {
    const identity = targetIdentity(target);
    const state = loadState();
    if (state.locks.some((lock) => lock.targetId === identity.id)) {
      throw new Error('This element already has a lock.');
    }
    const secret = options.secret
      ? text(options.secret, 4096).replace(/[\s=-]/g, '').toUpperCase()
      : encodeBase32(crypto.getRandomValues(new Uint8Array(20)));
    decodeBase32(secret);
    const parameters = normalizeTotpParameters(options);
    const draftId = randomId('totp_draft');
    const draft = {
      draftId,
      targetId: identity.id,
      targetLabel: identity.label,
      secret,
      ...parameters,
      unlockMode: options.unlockMode,
      unlockMinutes: options.unlockMinutes,
      expiresAt: Date.now() + 10 * 60 * 1000,
    };
    pendingTotpLocks.set(draftId, draft);
    return {
      draftId,
      manualSecret: secret.match(/.{1,4}/g).join(' '),
      otpAuthUri: buildOtpAuthUri({
        issuer: options.issuer || 'Material FFmpeg',
        account: identity.label,
        secret,
        ...parameters,
      }),
      qrImageImport: QR_IMPORT_STATUS,
      ...parameters,
    };
  }

  async function confirmTotpLock(draftId, code) {
    const draft = pendingTotpLocks.get(text(draftId, 128));
    if (!draft || draft.expiresAt < Date.now()) {
      pendingTotpLocks.delete(text(draftId, 128));
      throw new Error('The registration attempt expired. Start again.');
    }
    if (!(await verifyTotp(draft.secret, code, draft))) {
      throw new Error('The code did not match. The lock was not created.');
    }
    const state = loadState();
    if (state.locks.length >= MAX_LOCKS) throw new Error('The local lock limit has been reached.');
    if (state.locks.some((lock) => lock.targetId === draft.targetId)) {
      throw new Error('This element already has a lock.');
    }
    const record = sanitizeLock({
      id: randomId('lock'),
      targetId: draft.targetId,
      targetLabel: draft.targetLabel,
      method: 'totp',
      secret: draft.secret,
      algorithm: draft.algorithm,
      digits: draft.digits,
      period: draft.period,
      unlockMode: draft.unlockMode,
      unlockMinutes: draft.unlockMinutes,
      createdAt: new Date().toISOString(),
    });
    state.locks.push(record);
    pendingTotpLocks.delete(draftId);
    saveState(state);
    return redactLock(record);
  }

  function redactLock(lock) {
    const { credential, secret, ...safe } = lock;
    return { ...safe, configured: Boolean(credential || secret) };
  }

  function readSessions() {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(SESSION_KEY) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function writeSessions(sessions) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(sessions));
  }

  function isUnlocked(target) {
    const lock = getLockForTarget(target);
    if (!lock) return true;
    const session = readSessions()[lock.id];
    if (!session) return false;
    if (session.mode === 'surface' || session.mode === 'until-close') return true;
    return session.mode === 'minutes' && Number(session.expiresAt) > Date.now();
  }

  async function unlockTarget(target, answer) {
    const lock = getLockForTarget(target);
    if (!lock) return true;
    const accepted =
      lock.method === 'password'
        ? await verifyPassword(answer, lock.credential)
        : await verifyTotp(lock.secret, answer, lock);
    if (!accepted) return false;
    const sessions = readSessions();
    sessions[lock.id] = {
      mode: lock.unlockMode,
      expiresAt:
        lock.unlockMode === 'minutes' ? Date.now() + lock.unlockMinutes * 60 * 1000 : null,
    };
    writeSessions(sessions);
    return true;
  }

  function relockTarget(target) {
    const lock = getLockForTarget(target);
    if (!lock) return false;
    const sessions = readSessions();
    delete sessions[lock.id];
    writeSessions(sessions);
    return true;
  }

  async function removeLock(target, answer) {
    const lock = getLockForTarget(target);
    if (!lock) return false;
    const accepted =
      lock.method === 'password'
        ? await verifyPassword(answer, lock.credential)
        : await verifyTotp(lock.secret, answer, lock);
    if (!accepted) return false;
    const state = loadState();
    state.locks = state.locks.filter((candidate) => candidate.id !== lock.id);
    saveState(state);
    relockTarget(target);
    return true;
  }

  function addAuthenticator(input = {}) {
    const source = input.otpAuthUri ? parseOtpAuthUri(input.otpAuthUri) : input;
    const record = sanitizeAuthenticator({
      id: randomId('authenticator'),
      issuer: source.issuer,
      account: source.account,
      group: source.group,
      secret: source.secret,
      algorithm: source.algorithm,
      digits: source.digits,
      period: source.period,
      createdAt: new Date().toISOString(),
    });
    if (!record) throw new Error('The authenticator entry is invalid.');
    const state = loadState();
    if (state.authenticators.length >= MAX_AUTHENTICATORS) {
      throw new Error('The local authenticator-entry limit has been reached.');
    }
    state.authenticators.push(record);
    state.authenticatorOrder.push(record.id);
    saveState(state);
    return redactAuthenticator(record);
  }

  function redactAuthenticator(entry) {
    const { secret, ...safe } = entry;
    return { ...safe, configured: Boolean(secret) };
  }

  function listAuthenticators(options = {}) {
    const state = loadState();
    const query = text(options.query || '', 256).toLocaleLowerCase();
    const group = text(options.group || '', 256).toLocaleLowerCase();
    const byId = new Map(state.authenticators.map((entry) => [entry.id, entry]));
    return state.authenticatorOrder
      .map((id) => byId.get(id))
      .filter(Boolean)
      .filter((entry) => !group || entry.group.toLocaleLowerCase() === group)
      .filter(
        (entry) =>
          !query || `${entry.issuer} ${entry.account} ${entry.group}`.toLocaleLowerCase().includes(query),
      )
      .map(redactAuthenticator);
  }

  function reorderAuthenticators(ids) {
    const state = loadState();
    const valid = new Set(state.authenticators.map((entry) => entry.id));
    const next = Array.isArray(ids) ? ids.map((id) => text(id, 128)).filter((id) => valid.has(id)) : [];
    for (const id of valid) if (!next.includes(id)) next.push(id);
    state.authenticatorOrder = next;
    saveState(state);
    return listAuthenticators();
  }

  function exportAuthenticators(ids) {
    const state = loadState();
    const selection = new Set(Array.isArray(ids) ? ids : state.authenticatorOrder);
    const records = state.authenticators
      .filter((entry) => selection.has(entry.id))
      .map(({ secret, ...safe }) => ({ ...safe, secretOmitted: true }));
    return JSON.stringify(
      {
        version: 1,
        exportedAt: new Date().toISOString(),
        disclosure: 'Authenticator secrets are omitted from this ordinary export.',
        records,
      },
      null,
      2,
    );
  }

  function createSensitiveExportSession(ids) {
    const state = loadState();
    const valid = new Set(state.authenticators.map((entry) => entry.id));
    const selection = Array.isArray(ids) ? ids.map((id) => text(id, 128)).filter((id) => valid.has(id)) : [];
    if (!selection.length) throw new Error('Select at least one authenticator entry.');
    const id = randomId('sensitive_export');
    exportSessions.set(id, {
      ids: selection,
      keyOne: false,
      keyTwo: false,
      slider: 0,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });
    return {
      id,
      count: selection.length,
      warning: 'This export contains usable authenticator secrets in clear text.',
      ready: false,
    };
  }

  function updateSensitiveExportSession(id, input = {}) {
    const session = exportSessions.get(text(id, 128));
    if (!session || session.expiresAt < Date.now()) {
      exportSessions.delete(text(id, 128));
      throw new Error('The sensitive export confirmation expired.');
    }
    if ('keyOne' in input) session.keyOne = input.keyOne === true;
    if ('keyTwo' in input) session.keyTwo = input.keyTwo === true;
    if ('slider' in input) session.slider = integer(Number(input.slider), 0, 100, 0);
    const ready = session.keyOne && session.keyTwo && session.slider === 100;
    return { id, count: session.ids.length, ready };
  }

  function completeSensitiveExport(id) {
    const session = exportSessions.get(text(id, 128));
    if (
      !session ||
      session.expiresAt < Date.now() ||
      !session.keyOne ||
      !session.keyTwo ||
      session.slider !== 100
    ) {
      throw new Error('Complete both confirmation keys and move the slider fully to continue.');
    }
    const state = loadState();
    const selection = new Set(session.ids);
    const records = state.authenticators
      .filter((entry) => selection.has(entry.id))
      .map((entry) => ({
        ...entry,
        otpAuthUri: buildOtpAuthUri(entry),
      }));
    exportSessions.delete(id);
    return JSON.stringify(
      {
        version: 1,
        exportedAt: new Date().toISOString(),
        warning: 'This file contains usable authenticator secrets in clear text.',
        records,
      },
      null,
      2,
    );
  }

  function createSupportTicket(input = {}) {
    const state = loadState();
    if (state.tickets.length >= MAX_TICKETS) throw new Error('The local ticket limit has been reached.');
    const now = new Date().toISOString();
    const ticket = sanitizeTicket({
      id: randomId('ticket'),
      number: `LOCAL-${String(Date.now()).slice(-8)}`,
      category: input.category,
      severity: input.severity,
      description: input.description,
      status: 'Received',
      createdAt: now,
      updatedAt: now,
    });
    state.tickets.push(ticket);
    saveState(state);
    return { ...ticket, disclosure: SUPPORT_DISCLOSURE };
  }

  function advanceSupportTicket(id) {
    const state = loadState();
    const ticket = state.tickets.find((candidate) => candidate.id === text(id, 128));
    if (!ticket) throw new Error('The local ticket was not found.');
    ticket.status =
      ticket.status === 'Received'
        ? 'Investigating locally'
        : ticket.status === 'Investigating locally'
          ? 'Resolution ready'
          : 'Resolution ready';
    ticket.updatedAt = new Date().toISOString();
    saveState(state);
    return {
      ...ticket,
      disclosure: SUPPORT_DISCLOSURE,
      resolution:
        ticket.status === 'Resolution ready'
          ? 'Open your browser settings for this site and clear this site\'s stored data manually. This page does not delete anything for you.'
          : null,
    };
  }

  function listSupportTickets() {
    return loadState().tickets.map((ticket) => ({ ...ticket, disclosure: SUPPORT_DISCLOSURE }));
  }

  function resetInstructions() {
    return {
      title: 'Reset local locks and authenticator data',
      steps: [
        'Open the browser settings for stored site data.',
        `Find the entry for ${location.origin}.`,
        'Clear that site data, then reload this page.',
      ],
      warning:
        'Clearing site data removes all local settings, locks, authenticator entries, and fictional support tickets for this site. This page does not perform that deletion.',
      disclosure: SUPPORT_DISCLOSURE,
    };
  }

  function element(tag, properties = {}, children = []) {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(properties)) {
      if (name === 'className') node.className = value;
      else if (name === 'textContent') node.textContent = value;
      else if (name.startsWith('on') && typeof value === 'function') {
        node.addEventListener(name.slice(2).toLowerCase(), value);
      } else if (value !== undefined && value !== null) node.setAttribute(name, String(value));
    }
    for (const child of children) node.append(child);
    return node;
  }

  function closeSurface(surface, focusTarget) {
    surface.remove();
    if (focusTarget instanceof HTMLElement) focusTarget.focus();
  }

  function openUnlockPrompt(target, onUnlocked) {
    const lock = getLockForTarget(target);
    if (!lock || isUnlocked(target)) {
      if (typeof onUnlocked === 'function') onUnlocked();
      return null;
    }
    const answer = element('input', {
      type: lock.method === 'password' ? 'password' : 'text',
      inputmode: lock.method === 'password' ? 'text' : 'numeric',
      autocomplete: 'off',
      'aria-label': lock.method === 'password' ? 'Password' : 'Authenticator code',
    });
    const status = element('p', { role: 'status', 'aria-live': 'polite' });
    const surface = element('aside', {
      className: 'feature-security-surface feature-unlock-surface',
      role: 'dialog',
      'aria-label': `Unlock ${lock.targetLabel}`,
    });
    const verify = element('button', {
      type: 'button',
      textContent: 'Unlock',
      onClick: async () => {
        verify.disabled = true;
        try {
          if (await unlockTarget(target, answer.value)) {
            closeSurface(surface, target);
            if (typeof onUnlocked === 'function') onUnlocked();
          } else {
            status.textContent = `The value did not match. ${resetInstructions().steps.join(' ')}`;
          }
        } finally {
          verify.disabled = false;
        }
      },
    });
    const support = element('button', {
      type: 'button',
      textContent: 'Forgotten your password? Open Support Tickets',
      onClick: () => openSupportTicketsSurface(target),
    });
    const cancel = element('button', {
      type: 'button',
      textContent: 'Cancel',
      onClick: () => closeSurface(surface, target),
    });
    surface.append(
      element('h2', { textContent: `Unlock ${lock.targetLabel}` }),
      element('p', {
        textContent:
          'This is a convenience lock, not security or encryption. Anyone who controls this browser profile can clear its site data.',
      }),
      answer,
      status,
      element('div', { className: 'feature-security-actions' }, [verify, support, cancel]),
    );
    surface.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeSurface(surface, target);
    });
    document.body.append(surface);
    answer.focus();
    return surface;
  }

  function openLockWizard(target) {
    const identity = targetIdentity(target);
    if (getLockForTarget(target)) return openUnlockPrompt(target);
    const surface = element('aside', {
      className: 'feature-security-surface feature-lock-wizard',
      role: 'dialog',
      'aria-label': `Lock ${identity.label}`,
    });
    const method = element('select', { 'aria-label': 'Lock method' }, [
      element('option', { value: 'password', textContent: 'Password' }),
      element('option', { value: 'totp', textContent: 'Authenticator code' }),
    ]);
    const answer = element('input', {
      type: 'password',
      autocomplete: 'new-password',
      'aria-label': 'Password or manual base32 secret',
    });
    const code = element('input', {
      type: 'text',
      inputmode: 'numeric',
      autocomplete: 'one-time-code',
      'aria-label': 'Pairing confirmation code',
    });
    const status = element('p', { role: 'status', 'aria-live': 'polite' });
    const save = element('button', {
      type: 'button',
      textContent: 'Create lock',
      onClick: async () => {
        save.disabled = true;
        try {
          if (method.value === 'password') {
            await createPasswordLock(target, answer.value);
          } else {
            let draftId = surface.dataset.draftId;
            if (!draftId) {
              const draft = prepareTotpLock(target, { secret: answer.value || undefined });
              surface.dataset.draftId = draft.draftId;
              status.textContent = `Manual secret: ${draft.manualSecret}. ${draft.qrImageImport.reason} Enter a current code to confirm pairing.`;
              return;
            }
            await confirmTotpLock(draftId, code.value);
          }
          closeSurface(surface, target);
        } catch (error) {
          status.textContent = error instanceof Error ? error.message : 'The lock could not be created.';
        } finally {
          save.disabled = false;
        }
      },
    });
    method.addEventListener('change', () => {
      answer.type = method.value === 'password' ? 'password' : 'text';
      answer.setAttribute(
        'aria-label',
        method.value === 'password' ? 'Password' : 'Manual base32 secret, or leave empty to generate one',
      );
      code.hidden = method.value !== 'totp';
      surface.dataset.draftId = '';
      status.textContent = '';
    });
    code.hidden = true;
    surface.append(
      element('h2', { textContent: `Lock ${identity.label}` }),
      element('p', {
        textContent:
          'This is a self-imposed convenience lock. It does not secure, protect, or encrypt this element. Clear this site\'s browser data to reset every lock.',
      }),
      method,
      answer,
      code,
      status,
      element('div', { className: 'feature-security-actions' }, [
        save,
        element('button', {
          type: 'button',
          textContent: 'Emergency exit',
          onClick: () => closeSurface(surface, target),
        }),
      ]),
    );
    surface.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeSurface(surface, target);
    });
    document.body.append(surface);
    method.focus();
    return surface;
  }

  function registerLockableElement(target) {
    if (!(target instanceof Element)) throw new Error('A target element is required.');
    if (registeredElements.has(target)) return registeredElements.get(target);
    targetIdentity(target);
    const onContextMenu = (event) => {
      event.preventDefault();
      openLockWizard(target);
    };
    const onKeyDown = (event) => {
      if (event.shiftKey && event.key === 'F10') {
        event.preventDefault();
        openLockWizard(target);
      }
    };
    target.addEventListener('contextmenu', onContextMenu);
    target.addEventListener('keydown', onKeyDown);
    target.dataset.lockable = 'true';
    const registration = {
      unregister() {
        target.removeEventListener('contextmenu', onContextMenu);
        target.removeEventListener('keydown', onKeyDown);
        delete target.dataset.lockable;
        registeredElements.delete(target);
      },
      lock: () => openLockWizard(target),
      unlock: (callback) => openUnlockPrompt(target, callback),
      isUnlocked: () => isUnlocked(target),
    };
    registeredElements.set(target, registration);
    return registration;
  }

  function openSupportTicketsSurface(focusTarget) {
    const surface = element('section', {
      className: 'feature-security-surface feature-support-tickets',
      role: 'dialog',
      'aria-label': 'Support Tickets',
    });
    const category = element('select', { 'aria-label': 'Ticket category' }, [
      element('option', { value: 'Access recovery', textContent: 'Access recovery' }),
      element('option', { value: 'Authenticator setup', textContent: 'Authenticator setup' }),
      element('option', { value: 'Local data', textContent: 'Local data' }),
    ]);
    const severity = element('select', { 'aria-label': 'Severity' }, [
      element('option', { value: 'Routine', textContent: 'Routine' }),
      element('option', { value: 'Dramatic', textContent: 'Dramatic' }),
      element('option', { value: 'The browser has feelings', textContent: 'The browser has feelings' }),
    ]);
    const description = element('textarea', { 'aria-label': 'Description', maxlength: '4096' });
    const list = element('ol', { className: 'feature-ticket-list', 'aria-label': 'Local tickets' });
    const render = () => {
      list.replaceChildren();
      for (const ticket of listSupportTickets()) {
        const advance = element('button', {
          type: 'button',
          textContent: ticket.status === 'Resolution ready' ? 'Resolution ready' : 'Advance local status',
          disabled: ticket.status === 'Resolution ready' ? 'disabled' : null,
          onClick: () => {
            advanceSupportTicket(ticket.id);
            render();
          },
        });
        list.append(
          element('li', {}, [
            element('strong', { textContent: `${ticket.number} — ${ticket.status}` }),
            element('p', { textContent: `${ticket.category}; severity: ${ticket.severity}` }),
            element('p', { textContent: ticket.description || 'No description supplied.' }),
            ticket.status === 'Resolution ready'
              ? element('p', {
                  textContent:
                    'Resolution: open your browser settings and clear this site\'s stored data manually. This page does not delete anything.',
                })
              : advance,
          ]),
        );
      }
    };
    surface.append(
      element('h2', { textContent: 'Support Tickets' }),
      element('p', { className: 'feature-security-disclosure', textContent: SUPPORT_DISCLOSURE }),
      category,
      severity,
      description,
      element('button', {
        type: 'button',
        textContent: 'Create local ticket',
        onClick: () => {
          createSupportTicket({
            category: category.value,
            severity: severity.value,
            description: description.value,
          });
          description.value = '';
          render();
        },
      }),
      list,
      element('button', {
        type: 'button',
        textContent: 'Close',
        onClick: () => closeSurface(surface, focusTarget),
      }),
    );
    surface.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeSurface(surface, focusTarget);
    });
    render();
    document.body.append(surface);
    category.focus();
    return surface;
  }

  function openAuthenticatorSurface(focusTarget) {
    const surface = element('section', {
      className: 'feature-security-surface feature-authenticator',
      role: 'dialog',
      'aria-label': 'Local authenticator',
    });
    const search = element('input', {
      type: 'search',
      placeholder: 'Search issuer, account, or group',
      'aria-label': 'Search authenticator entries',
    });
    const uri = element('input', {
      type: 'text',
      placeholder: 'otpauth://totp/…',
      'aria-label': 'otpauth URI',
    });
    const status = element('p', { role: 'status', 'aria-live': 'polite' });
    const list = element('ol', { className: 'feature-authenticator-list' });
    let timer = null;
    const render = async () => {
      list.replaceChildren();
      const state = loadState();
      const visible = listAuthenticators({ query: search.value });
      const byId = new Map(state.authenticators.map((entry) => [entry.id, entry]));
      for (const publicEntry of visible) {
        const entry = byId.get(publicEntry.id);
        const snapshot = await getTotpSnapshot(entry);
        list.append(
          element('li', {}, [
            element('strong', { textContent: `${entry.issuer} — ${entry.account}` }),
            element('p', {
              textContent: `Current code ${snapshot.current}; next ${snapshot.next}; ${snapshot.secondsRemaining} seconds remaining.`,
              role: 'status',
              'aria-live': 'polite',
            }),
            element('p', {
              textContent: `${entry.algorithm}, ${entry.digits} digits, ${entry.period}-second period; group ${entry.group}.`,
            }),
          ]),
        );
      }
      status.textContent = `${visible.length} local authenticator entr${visible.length === 1 ? 'y' : 'ies'}.`;
    };
    search.addEventListener('input', () => void render());
    surface.append(
      element('h2', { textContent: 'Local authenticator' }),
      element('p', {
        textContent:
          'Entries and secrets stay in this browser profile. There is no account, cloud sync, telemetry, or network request.',
      }),
      element('p', { textContent: QR_IMPORT_STATUS.reason }),
      search,
      uri,
      element('button', {
        type: 'button',
        textContent: 'Register from otpauth URI',
        onClick: () => {
          try {
            addAuthenticator({ otpAuthUri: uri.value });
            uri.value = '';
            void render();
          } catch (error) {
            status.textContent = error instanceof Error ? error.message : 'The entry could not be registered.';
          }
        },
      }),
      status,
      list,
      element('button', {
        type: 'button',
        textContent: 'Close',
        onClick: () => {
          clearInterval(timer);
          closeSurface(surface, focusTarget);
        },
      }),
    );
    surface.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        clearInterval(timer);
        closeSurface(surface, focusTarget);
      }
    });
    document.body.append(surface);
    void render();
    timer = setInterval(() => void render(), 1000);
    search.focus();
    return surface;
  }

  function init(coreApi = {}) {
    core = coreApi;
    if (typeof core.registerFeature === 'function') {
      core.registerFeature({
        id: 'local-security-tools',
        label: 'Local locks, authenticator, and Support Tickets',
        open: () => openAuthenticatorSurface(document.activeElement),
      });
    }
    if (typeof core.registerCommand === 'function') {
      core.registerCommand({
        id: 'security.open-authenticator',
        label: 'Open local authenticator',
        run: () => openAuthenticatorSurface(document.activeElement),
      });
      core.registerCommand({
        id: 'security.open-support-tickets',
        label: 'Open Support Tickets',
        run: () => openSupportTicketsSurface(document.activeElement),
      });
    }
    return publicSummary();
  }

  global.MaterialFFmpegFeaturesSecurity = Object.freeze({
    init,
    getSummary: publicSummary,
    registerLockableElement,
    openLockWizard,
    openUnlockPrompt,
    createPasswordLock,
    prepareTotpLock,
    confirmTotpLock,
    unlockTarget,
    relockTarget,
    removeLock,
    isUnlocked,
    getLockForTarget: (target) => {
      const lock = getLockForTarget(target);
      return lock ? redactLock(lock) : null;
    },
    parseOtpAuthUri,
    buildOtpAuthUri,
    generateTotp,
    verifyTotp,
    getTotpSnapshot,
    addAuthenticator,
    listAuthenticators,
    reorderAuthenticators,
    exportAuthenticators,
    createSensitiveExportSession,
    updateSensitiveExportSession,
    completeSensitiveExport,
    openAuthenticatorSurface,
    createSupportTicket,
    advanceSupportTicket,
    listSupportTickets,
    openSupportTicketsSurface,
    resetInstructions,
    qrImageImport: QR_IMPORT_STATUS,
    supportDisclosure: SUPPORT_DISCLOSURE,
  });
})(window);

(function materialFfmpegSiteFeatures(global) {
  'use strict';

  const STORAGE_KEY = 'material-ffmpeg.features.v1';
  const MAX_STATE_BYTES = 800000;
  const MAX_LOGO_BYTES = 2 * 1024 * 1024;
  const MAX_LOGO_PIXELS = 4096 * 4096;
  const MAX_RECORDS = 1000;
  const SCHEMA_VERSION = 1;
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const TABS = Object.freeze([
    ['appearance', 'Appearance', '◐'],
    ['logo', 'App logo', '◆'],
    ['attention', 'Focus modes', '◎'],
    ['schedules', 'Schedules', '◷'],
    ['notifications', 'Notifications', '◌'],
    ['history', 'Local history', '↺'],
    ['changelog', 'Changelog', '≣'],
    ['exports', 'Exports', '⇩'],
    ['downloads', 'Download surfaces', '⇣'],
    ['security', 'Local locks', '⌑'],
    ['boundaries', 'Browser boundaries', 'ⓘ'],
  ]);
  const CHANGELOG = Object.freeze([
    {
      version: 'Unsigned packaging verification',
      date: '2026-08-21',
      category: 'Packaging',
      text: 'Verified unsigned Windows PE files without relying on optional PowerShell modules.',
      sha: '8a3d84932149e58a419a67dc3acb11842a85bf79',
    },
    {
      version: 'Initial design import',
      date: '2026-08-21',
      category: 'Foundation',
      text: 'Imported the supplied interface reference and pinned the upstream FFmpeg source reference.',
      sha: '5979288b70a98f2e0ad22fa345c111457eb3483c',
    },
    {
      version: 'Website baseline',
      date: '2026-08-21',
      category: 'Website',
      text: 'Published the first mobile-responsive project landing page.',
      sha: 'b110674b715e895a0aaf747c4556c749ed56ef12',
    },
  ]);

  let core = null;
  let root = null;
  let state = null;
  let activeTab = 'appearance';
  let scheduleTimer = 0;
  let appearanceTarget = null;

  function defaultState() {
    return {
      version: SCHEMA_VERSION,
      appearance: {
        theme: 'dark', density: 'comfortable', accent: '#b9c5ff', fontFamily: 'system-ui',
        fontScale: 1, fontWeight: 400, motion: 'full', elementOverrides: {},
      },
      logo: { preset: 'bars', dataUrl: '', mime: '', fit: 'contain', x: 50, y: 50, background: '#202632' },
      attention: {
        lowStimulation: false, timeAwareness: false, oneThing: false, momentum: false, focus: false,
        oneThingLabel: '', oneThingDone: false, momentumCount: 0, momentumSnoozeUntil: '', focusTarget: '',
      },
      schedules: [],
      notifications: [],
      history: [],
      panelGeometry: {},
      selectedRecords: [],
      filtersCollapsed: true,
      commandPaletteSize: 'card',
    };
  }

  function plainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function boundedText(value, max = 512) {
    return String(value == null ? '' : value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '').slice(0, max);
  }

  function boundedNumber(value, min, max, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
  }

  function safeId(prefix = 'item') {
    const bytes = new Uint8Array(9);
    crypto.getRandomValues(bytes);
    return `${prefix}_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  }

  function sanitizeState(candidate) {
    const source = plainObject(candidate);
    const defaults = defaultState();
    const appearance = plainObject(source.appearance);
    const logo = plainObject(source.logo);
    const attention = plainObject(source.attention);
    return {
      version: SCHEMA_VERSION,
      appearance: {
        theme: appearance.theme === 'light' ? 'light' : 'dark',
        density: ['compact', 'comfortable', 'spacious'].includes(appearance.density) ? appearance.density : defaults.appearance.density,
        accent: /^#[0-9a-f]{6}$/iu.test(appearance.accent) ? appearance.accent : defaults.appearance.accent,
        fontFamily: boundedText(appearance.fontFamily || defaults.appearance.fontFamily, 120),
        fontScale: boundedNumber(appearance.fontScale, .75, 1.75, 1),
        fontWeight: boundedNumber(appearance.fontWeight, 100, 900, 400),
        motion: appearance.motion === 'reduced' ? 'reduced' : 'full',
        elementOverrides: Object.fromEntries(Object.entries(plainObject(appearance.elementOverrides)).slice(0, 1000).map(([key, value]) => [boundedText(key, 160), plainObject(value)])),
      },
      logo: {
        preset: ['bars', 'wave', 'frame', 'custom'].includes(logo.preset) ? logo.preset : 'bars',
        dataUrl: typeof logo.dataUrl === 'string' && logo.dataUrl.length <= 2800000 ? logo.dataUrl : '',
        mime: ['image/png', 'image/jpeg', 'image/webp'].includes(logo.mime) ? logo.mime : '',
        fit: ['contain', 'cover', 'fill'].includes(logo.fit) ? logo.fit : 'contain',
        x: boundedNumber(logo.x, 0, 100, 50), y: boundedNumber(logo.y, 0, 100, 50),
        background: /^#[0-9a-f]{6}$/iu.test(logo.background) ? logo.background : defaults.logo.background,
      },
      attention: {
        lowStimulation: Boolean(attention.lowStimulation), timeAwareness: Boolean(attention.timeAwareness),
        oneThing: Boolean(attention.oneThing), momentum: Boolean(attention.momentum), focus: Boolean(attention.focus),
        oneThingLabel: boundedText(attention.oneThingLabel, 160), oneThingDone: Boolean(attention.oneThingDone),
        momentumCount: Math.max(0, Math.floor(boundedNumber(attention.momentumCount, 0, 100000, 0))),
        momentumSnoozeUntil: boundedText(attention.momentumSnoozeUntil, 40), focusTarget: boundedText(attention.focusTarget, 160),
      },
      schedules: Array.isArray(source.schedules) ? source.schedules.slice(0, 128).map(sanitizeSchedule).filter(Boolean) : [],
      notifications: Array.isArray(source.notifications) ? source.notifications.slice(-250).map(sanitizeNotification) : [],
      history: Array.isArray(source.history) ? source.history.slice(-500).map(sanitizeHistory) : [],
      panelGeometry: Object.fromEntries(Object.entries(plainObject(source.panelGeometry)).slice(0, 32)),
      selectedRecords: Array.isArray(source.selectedRecords) ? source.selectedRecords.slice(0, MAX_RECORDS).map((item) => boundedText(item, 120)) : [],
      filtersCollapsed: source.filtersCollapsed !== false,
      commandPaletteSize: source.commandPaletteSize === 'full' ? 'full' : 'card',
    };
  }

  function sanitizeSchedule(item) {
    const source = plainObject(item);
    if (!source.id) return null;
    return {
      id: boundedText(source.id, 100), label: boundedText(source.label || 'Scheduled appearance', 120), enabled: source.enabled !== false,
      startDate: boundedText(source.startDate, 10), endDate: boundedText(source.endDate, 10), startTime: boundedText(source.startTime || '09:00', 5), endTime: boundedText(source.endTime || '17:00', 5),
      weekdays: Array.isArray(source.weekdays) ? source.weekdays.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6).slice(0, 7) : [0, 1, 2, 3, 4, 5, 6],
      setting: ['theme', 'density', 'accent', 'fontScale', 'motion'].includes(source.setting) ? source.setting : 'theme',
      value: boundedText(source.value || 'dark', 120), createdAt: boundedText(source.createdAt || new Date().toISOString(), 40),
    };
  }

  function sanitizeNotification(item) {
    const source = plainObject(item);
    return { id: boundedText(source.id || safeId('notice'), 100), title: boundedText(source.title || 'Notice', 120), body: boundedText(source.body, 600), kind: ['info', 'success', 'warning', 'error', 'progress'].includes(source.kind) ? source.kind : 'info', createdAt: boundedText(source.createdAt || new Date().toISOString(), 40), dismissed: Boolean(source.dismissed) };
  }

  function sanitizeHistory(item) {
    const source = plainObject(item);
    return { id: boundedText(source.id || safeId('history'), 100), action: boundedText(source.action || 'updated', 80), label: boundedText(source.label || 'Updated local state', 180), before: source.before == null ? null : source.before, after: source.after == null ? null : source.after, createdAt: boundedText(source.createdAt || new Date().toISOString(), 40) };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw || raw.length > MAX_STATE_BYTES) return defaultState();
      const parsed = JSON.parse(raw);
      return parsed && parsed.version === SCHEMA_VERSION ? sanitizeState(parsed) : defaultState();
    } catch (_error) {
      return defaultState();
    }
  }

  function persistState() {
    const serialized = JSON.stringify(state);
    if (serialized.length > MAX_STATE_BYTES) throw new Error('Local feature state exceeded the 800,000-character limit. Export and clear older history before saving more data.');
    localStorage.setItem(STORAGE_KEY, serialized);
  }

  function recordHistory(action, label, before, after) {
    const entry = sanitizeHistory({ id: safeId('history'), action, label, before, after, createdAt: new Date().toISOString() });
    state.history.push(entry);
    state.history = state.history.slice(-500);
    try { persistState(); } catch (error) { notify({ title: 'History was not recorded', body: error.message, kind: 'error', persistent: true }, false); }
    return entry;
  }

  function commitState(action, label, updater) {
    const before = JSON.parse(JSON.stringify(state));
    updater(state);
    const after = JSON.parse(JSON.stringify(state));
    recordHistory(action, label, before, after);
    persistState();
    applyGlobalAppearance();
  }

  function element(tag, properties = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(properties)) {
      if (key === 'className') node.className = value;
      else if (key === 'textContent') node.textContent = value;
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
      else if (value !== false && value != null) node.setAttribute(key, value === true ? '' : String(value));
    }
    for (const child of Array.isArray(children) ? children : [children]) if (child != null) node.append(child.nodeType ? child : document.createTextNode(String(child)));
    return node;
  }

  function button(label, handler, options = {}) {
    return element('button', { type: 'button', className: `mff-button${options.primary ? ' primary' : ''}${options.danger ? ' danger' : ''}${options.compact ? ' compact' : ''}`, textContent: label, onClick: handler, disabled: options.disabled || null, 'aria-label': options.ariaLabel || null });
  }

  function control(label, input, explanation, provenance) {
    const wrapper = element('div', { className: 'mff-control' });
    const labelNode = element('label', { textContent: label });
    if (input.id) labelNode.htmlFor = input.id;
    wrapper.append(labelNode, input);
    if (explanation) wrapper.append(element('small', { textContent: explanation }));
    if (provenance) wrapper.append(element('span', { className: 'mff-provenance', textContent: provenance }));
    return wrapper;
  }

  function notify(payload, save = true) {
    const notice = sanitizeNotification({ ...payload, id: safeId('notice'), createdAt: new Date().toISOString() });
    if (save) {
      state.notifications.push(notice);
      state.notifications = state.notifications.slice(-250);
      persistState();
    }
    if (core && typeof core.notify === 'function') core.notify(payload);
    const host = document.querySelector('.mff-notifications') || document.body.appendChild(element('div', { className: 'mff-notifications', 'aria-live': notice.kind === 'error' ? 'assertive' : 'polite' }));
    const toast = element('div', { className: 'mff-toast', role: notice.kind === 'error' ? 'alert' : 'status' }, [element('strong', { textContent: notice.title }), element('span', { textContent: notice.body }), button('Dismiss', () => { notice.dismissed = true; toast.remove(); }, { compact: true })]);
    host.append(toast);
    if (!payload.persistent && notice.kind !== 'error' && notice.kind !== 'warning') setTimeout(() => toast.remove(), state.attention.lowStimulation ? 7000 : 4500);
    return notice;
  }

  function applyGlobalAppearance() {
    document.documentElement.dataset.mffTheme = state.appearance.theme;
    document.documentElement.style.setProperty('--mff-accent', state.appearance.accent);
    document.documentElement.style.setProperty('--mff-font', state.appearance.fontFamily);
    document.documentElement.style.setProperty('--mff-font-scale', String(state.appearance.fontScale));
    document.documentElement.style.setProperty('--mff-density', state.appearance.density);
    document.documentElement.dataset.mffLowStimulation = state.attention.lowStimulation ? 'true' : 'false';
    document.documentElement.dataset.mffMotion = state.appearance.motion;
    if (root) root.querySelectorAll('[data-appearance-id]').forEach(applyElementAppearance);
  }

  function applyElementAppearance(target) {
    const config = plainObject(state.appearance.elementOverrides[target.dataset.appearanceId]);
    const styles = {
      fontFamily: config.fontFamily, fontSize: config.fontSize, fontWeight: config.fontWeight, fontStyle: config.fontStyle,
      textDecorationLine: config.textDecorationLine, textDecorationStyle: config.textDecorationStyle, textDecorationColor: config.textDecorationColor,
      textTransform: config.textTransform, fontVariantCaps: config.fontVariantCaps, verticalAlign: config.verticalAlign,
      color: config.color, background: config.background, WebkitTextStroke: config.outline, textShadow: config.textShadow,
      letterSpacing: config.letterSpacing, wordSpacing: config.wordSpacing, lineHeight: config.lineHeight,
      direction: config.direction, textAlign: config.textAlign, borderRadius: config.borderRadius, padding: config.padding, boxShadow: config.boxShadow,
    };
    for (const [property, value] of Object.entries(styles)) target.style[property] = value || '';
  }

  function hexToRgb(hex) {
    const normalized = String(hex).replace('#', '');
    if (!/^[0-9a-f]{6}$/iu.test(normalized)) throw new Error('Enter a six-digit HEX color.');
    return [0, 2, 4].map((offset) => parseInt(normalized.slice(offset, offset + 2), 16));
  }

  function rgbToHsl(r, g, b) {
    const values = [r, g, b].map((item) => item / 255);
    const max = Math.max(...values), min = Math.min(...values), lightness = (max + min) / 2;
    if (max === min) return [0, 0, lightness * 100];
    const delta = max - min;
    const saturation = delta / (1 - Math.abs(2 * lightness - 1));
    let hue = max === values[0] ? ((values[1] - values[2]) / delta) % 6 : max === values[1] ? (values[2] - values[0]) / delta + 2 : (values[0] - values[1]) / delta + 4;
    hue = Math.round(hue * 60); if (hue < 0) hue += 360;
    return [hue, saturation * 100, lightness * 100];
  }

  function rgbToHsv(r, g, b) {
    const values = [r, g, b].map((item) => item / 255); const max = Math.max(...values), min = Math.min(...values), delta = max - min;
    let hue = 0; if (delta) hue = max === values[0] ? 60 * (((values[1] - values[2]) / delta) % 6) : max === values[1] ? 60 * ((values[2] - values[0]) / delta + 2) : 60 * ((values[0] - values[1]) / delta + 4);
    if (hue < 0) hue += 360; return [hue, max ? delta / max * 100 : 0, max * 100];
  }

  function rgbToLab(r, g, b) {
    const linear = [r, g, b].map((value) => { const channel = value / 255; return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4; });
    const x = (linear[0] * .4124 + linear[1] * .3576 + linear[2] * .1805) / .95047;
    const y = (linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722);
    const z = (linear[0] * .0193 + linear[1] * .1192 + linear[2] * .9505) / 1.08883;
    const f = (value) => value > .008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116;
    return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
  }

  function rgbToOklab(r, g, b) {
    const linear = [r, g, b].map((value) => { const c = value / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; });
    const l = Math.cbrt(.4122214708 * linear[0] + .5363325363 * linear[1] + .0514459929 * linear[2]);
    const m = Math.cbrt(.2119034982 * linear[0] + .6806995451 * linear[1] + .1073969566 * linear[2]);
    const s = Math.cbrt(.0883024619 * linear[0] + .2817188376 * linear[1] + .6299787005 * linear[2]);
    return [.2104542553 * l + .793617785 * m - .0040720468 * s, 1.9779984951 * l - 2.428592205 * m + .4505937099 * s, .0259040371 * l + .7827717662 * m - .808675766 * s];
  }

  function translateColor(hex) {
    const [r, g, b] = hexToRgb(hex); const [h, s, l] = rgbToHsl(r, g, b); const [hv, sv, vv] = rgbToHsv(r, g, b);
    const whiteness = Math.min(r, g, b) / 255 * 100, blackness = (1 - Math.max(r, g, b) / 255) * 100;
    const [labL, labA, labB] = rgbToLab(r, g, b); const labC = Math.hypot(labA, labB), labH = (Math.atan2(labB, labA) * 180 / Math.PI + 360) % 360;
    const [okL, okA, okB] = rgbToOklab(r, g, b); const okC = Math.hypot(okA, okB), okH = (Math.atan2(okB, okA) * 180 / Math.PI + 360) % 360;
    const k = 1 - Math.max(r, g, b) / 255; const c = k === 1 ? 0 : (1 - r / 255 - k) / (1 - k), m = k === 1 ? 0 : (1 - g / 255 - k) / (1 - k), y = k === 1 ? 0 : (1 - b / 255 - k) / (1 - k);
    const f = (value, digits = 1) => Number(value).toFixed(digits);
    return {
      HEX: hex.toUpperCase(), HEX8: `${hex.toUpperCase()}FF`, RGB: `rgb(${r} ${g} ${b})`, RGBA: `rgba(${r}, ${g}, ${b}, 1)`,
      HSL: `hsl(${f(h, 0)} ${f(s)}% ${f(l)}%)`, HSLA: `hsla(${f(h, 0)}, ${f(s)}%, ${f(l)}%, 1)`, HSV: `hsv(${f(hv, 0)} ${f(sv)}% ${f(vv)}%)`,
      HWB: `hwb(${f(hv, 0)} ${f(whiteness)}% ${f(blackness)}%)`, CIELAB: `lab(${f(labL)}% ${f(labA)} ${f(labB)})`, LCH: `lch(${f(labL)}% ${f(labC)} ${f(labH)})`,
      OKLab: `oklab(${f(okL)} ${f(okA, 3)} ${f(okB, 3)})`, OKLCH: `oklch(${f(okL)} ${f(okC, 3)} ${f(okH)})`, CMYK: `cmyk(${f(c * 100)}% ${f(m * 100)}% ${f(y * 100)}% ${f(k * 100)}%)`,
    };
  }

  function downloadText(filename, content, type = 'text/plain;charset=utf-8') {
    const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob); const link = element('a', { href: url, download: filename }); document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function scalar(value) { return value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value); }

  function serializers(records) {
    const data = records.map((record) => plainObject(record)); const keys = Array.from(new Set(data.flatMap((record) => Object.keys(record))));
    const quote = (value, separator) => { const result = scalar(value); return result.includes(separator) || /["\r\n]/u.test(result) ? `"${result.replace(/"/g, '""')}"` : result; };
    const yamlValue = (value) => JSON.stringify(value == null ? null : value);
    const table = (separator) => [keys.join(separator), ...data.map((record) => keys.map((key) => quote(record[key], separator)).join(separator))].join('\r\n');
    return {
      json: JSON.stringify({ schemaVersion: 1, encoding: 'UTF-8', records: data }, null, 2),
      jsonl: data.map((record) => JSON.stringify(record)).join('\n'),
      yaml: `schemaVersion: 1\nrecords:\n${data.map((record) => `  - ${keys.map((key, index) => `${index ? '    ' : ''}${key}: ${yamlValue(record[key])}`).join('\n')}`).join('\n')}`,
      toml: `schemaVersion = 1\n${data.map((record) => `\n[[records]]\n${keys.map((key) => `${key} = ${JSON.stringify(scalar(record[key]))}`).join('\n')}`).join('')}`,
      xml: `<?xml version="1.0" encoding="UTF-8"?>\n<export schemaVersion="1">${data.map((record) => `<record>${keys.map((key) => `<field name="${escapeXml(key)}">${escapeXml(scalar(record[key]))}</field>`).join('')}</record>`).join('')}</export>`,
      csv: table(','), tsv: table('\t'),
      markdown: `| ${keys.join(' | ')} |\n| ${keys.map(() => '---').join(' | ')} |\n${data.map((record) => `| ${keys.map((key) => scalar(record[key]).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>')).join(' | ')} |`).join('\n')}`,
      html: `<!doctype html><meta charset="utf-8"><title>material-ffmpeg local export</title><table><thead><tr>${keys.map((key) => `<th>${escapeXml(key)}</th>`).join('')}</tr></thead><tbody>${data.map((record) => `<tr>${keys.map((key) => `<td>${escapeXml(scalar(record[key]))}</td>`).join('')}</tr>`).join('')}</tbody></table>`,
      sql: `CREATE TABLE records (${keys.map((key) => `"${key.replace(/"/g, '""')}" TEXT`).join(', ')});\n${data.map((record) => `INSERT INTO records (${keys.map((key) => `"${key.replace(/"/g, '""')}"`).join(', ')}) VALUES (${keys.map((key) => `'${scalar(record[key]).replace(/'/g, "''")}'`).join(', ')});`).join('\n')}`,
      javascript: `export const records = ${JSON.stringify(data, null, 2)};\n`, typescript: `export const records: ReadonlyArray<Record<string, unknown>> = ${JSON.stringify(data, null, 2)};\n`,
      python: `import json\nrecords = json.loads(r'''${JSON.stringify(data)}''')\n`,
      go: `package export\n\nvar RecordsJSON = []byte(\`${JSON.stringify(data).replace(/`/g, '\\u0060')}\`)\n`, rust: `pub const RECORDS_JSON: &str = r#"${JSON.stringify(data)}"#;\n`,
      jsonschema: JSON.stringify({ $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'array', items: { type: 'object', properties: Object.fromEntries(keys.map((key) => [key, {}])), additionalProperties: false } }, null, 2),
      protobuf: `syntax = "proto3";\nmessage Record {\n${keys.map((key, index) => `  string ${key.replace(/[^a-z0-9_]/giu, '_')} = ${index + 1};`).join('\n')}\n}\nmessage Export { repeated Record records = 1; }\n`,
    };
  }

  function escapeXml(value) { return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;'); }

  function panelHeader(title, description, actions = []) {
    return element('header', { className: 'mff-panel-head' }, [element('div', {}, [element('h2', { textContent: title }), element('p', { textContent: description })]), element('div', { className: 'mff-actions' }, actions)]);
  }

  function selectInput(id, options, value, onChange) {
    const select = element('select', { id, onChange });
    for (const [optionValue, label] of options) select.append(element('option', { value: optionValue, textContent: label }));
    select.value = value;
    return select;
  }

  function rangeInput(id, min, max, step, value, onInput) {
    return element('input', { id, type: 'range', min, max, step, value, onInput });
  }

  function checkbox(label, checked, onChange, description = '') {
    const input = element('input', { type: 'checkbox', onChange }); input.checked = checked;
    return element('label', { className: 'mff-check' }, [input, element('span', {}, [element('strong', { textContent: label }), description ? element('small', { textContent: description }) : null])]);
  }

  function renderAppearancePanel() {
    const panel = element('section', { className: 'mff-panel', id: 'mff-panel-appearance', role: 'tabpanel', 'aria-labelledby': 'mff-tab-appearance' });
    const theme = selectInput('mff-theme', [['dark', 'Dark'], ['light', 'Light']], state.appearance.theme, (event) => commitState('settings changed', 'Changed site theme', (draft) => { draft.appearance.theme = event.target.value; }));
    const density = selectInput('mff-density', [['compact', 'Compact'], ['comfortable', 'Comfortable'], ['spacious', 'Spacious']], state.appearance.density, (event) => commitState('settings changed', 'Changed control density', (draft) => { draft.appearance.density = event.target.value; }));
    const font = element('input', { id: 'mff-font', type: 'text', value: state.appearance.fontFamily, list: 'mff-fonts', onChange: (event) => commitState('settings changed', 'Changed interface font', (draft) => { draft.appearance.fontFamily = boundedText(event.target.value, 120) || 'system-ui'; }) });
    const fontList = element('datalist', { id: 'mff-fonts' }, [['system-ui', 'System UI'], ['Segoe UI', 'Segoe UI'], ['Arial', 'Arial'], ['Georgia', 'Georgia'], ['Consolas', 'Consolas']].map(([value, label]) => element('option', { value, label })));
    const scaleValue = element('output', { textContent: `${state.appearance.fontScale.toFixed(2)}×` });
    const scale = rangeInput('mff-font-scale', .75, 1.75, .05, state.appearance.fontScale, (event) => { scaleValue.textContent = `${Number(event.target.value).toFixed(2)}×`; commitState('settings changed', 'Changed interface font scale', (draft) => { draft.appearance.fontScale = Number(event.target.value); }); });
    const accentInput = element('input', { id: 'mff-accent', type: 'color', value: state.appearance.accent, onInput: (event) => { commitState('settings changed', 'Changed accent color', (draft) => { draft.appearance.accent = event.target.value; }); renderTranslations(translations, event.target.value); } });
    const translations = element('div', { className: 'mff-code', 'aria-live': 'polite' });
    renderTranslations(translations, state.appearance.accent);
    const reset = button('Reset global appearance', () => openSuperConfirmation({ title: 'Reset global appearance', description: 'This removes the global site appearance values and every per-element appearance override.', actionLabel: 'Reset appearance', onConfirm: () => { commitState('appearance reset', 'Reset global and per-element appearance', (draft) => { draft.appearance = defaultState().appearance; }); rerender(); } }), { danger: true });
    panel.append(panelHeader('Appearance', 'Change the live site theme and open the complete per-element editor from any rendered element.', [button('Edit selected element…', () => openAppearanceEditor(appearanceTarget || panel)), reset]), element('div', { className: 'mff-grid' }, [
      element('article', { className: 'mff-card' }, [element('h3', { textContent: 'Global appearance' }), control('Theme', theme, 'Applies immediately to the website.', `Current source: ${localStorage.getItem(STORAGE_KEY) ? 'stored preference' : 'shipped default: dark'}`), control('Density', density, 'Controls spacing without shrinking touch targets.', `Current value: ${state.appearance.density}`), control('Font family', font, 'Installed browser fonts are used when available; otherwise the system stack is used.', `Requested value: ${state.appearance.fontFamily}`), fontList, control('Font scale', element('div', { className: 'mff-inline' }, [scale, scaleValue]), 'Scales interface text from 0.75× to 1.75×.', `Current value: ${state.appearance.fontScale.toFixed(2)}×`)]),
      element('article', { className: 'mff-card' }, [element('h3', { textContent: 'Continuous color and translator' }), control('Accent color', accentInput, 'The continuous browser color field and exact HEX value stay synchronized.', `Current value: ${state.appearance.accent}`), translations, element('p', { className: 'mff-disclosure', textContent: 'CIELAB, LCH, OKLab, OKLCH, and CMYK values are deterministic browser-side conversions, not measurements from a calibrated display or printer profile.' })]),
    ]));
    return panel;
  }

  function renderTranslations(host, hex) {
    try { const values = translateColor(hex); host.textContent = Object.entries(values).map(([name, value]) => `${name}: ${value}`).join('\n'); } catch (error) { host.textContent = error.message; }
  }

  function openAppearanceEditor(target) {
    if (!target) return;
    appearanceTarget = target;
    if (!target.dataset.appearanceId) target.dataset.appearanceId = safeId('element');
    const id = target.dataset.appearanceId;
    const current = plainObject(state.appearance.elementOverrides[id]);
    const panel = element('section', { className: 'mff-floating-panel', role: 'dialog', 'aria-modal': 'false', 'aria-label': `Edit appearance for ${target.getAttribute('aria-label') || target.textContent.trim().slice(0, 60) || target.tagName}` });
    const body = element('div', { className: 'mff-panel-body' });
    const fields = [
      ['Font family', 'fontFamily', 'text', current.fontFamily || ''], ['Font size', 'fontSize', 'text', current.fontSize || ''], ['Weight', 'fontWeight', 'number', current.fontWeight || ''],
      ['Style', 'fontStyle', 'select', current.fontStyle || '', [['', 'Inherited'], ['normal', 'Normal'], ['italic', 'Italic'], ['oblique', 'Oblique']]],
      ['Underline/strike/overline', 'textDecorationLine', 'select', current.textDecorationLine || '', [['', 'Inherited'], ['underline', 'Underline'], ['line-through', 'Single strikethrough'], ['underline line-through', 'Underline + strikethrough'], ['overline', 'Overline']]],
      ['Decoration style', 'textDecorationStyle', 'select', current.textDecorationStyle || '', [['', 'Inherited'], ['solid', 'Solid'], ['double', 'Double'], ['dotted', 'Dotted'], ['wavy', 'Wavy']]],
      ['Capitalization', 'textTransform', 'select', current.textTransform || '', [['', 'Inherited'], ['none', 'None'], ['uppercase', 'Uppercase'], ['lowercase', 'Lowercase'], ['capitalize', 'Capitalize']]],
      ['Small caps', 'fontVariantCaps', 'select', current.fontVariantCaps || '', [['', 'Inherited'], ['normal', 'Normal'], ['small-caps', 'Small caps'], ['all-small-caps', 'All small caps']]],
      ['Superscript/subscript', 'verticalAlign', 'select', current.verticalAlign || '', [['', 'Inherited'], ['super', 'Superscript'], ['sub', 'Subscript'], ['baseline', 'Baseline']]],
      ['Text color', 'color', 'color', current.color || '#f2f2f8'], ['Highlight', 'background', 'color', current.background || '#202632'], ['Outline', 'outline', 'text', current.outline || ''],
      ['Shadow or glow', 'textShadow', 'text', current.textShadow || ''], ['Character spacing', 'letterSpacing', 'text', current.letterSpacing || ''], ['Word spacing', 'wordSpacing', 'text', current.wordSpacing || ''],
      ['Line height', 'lineHeight', 'text', current.lineHeight || ''], ['Direction', 'direction', 'select', current.direction || '', [['', 'Inherited'], ['ltr', 'Left to right'], ['rtl', 'Right to left']]],
      ['Alignment', 'textAlign', 'select', current.textAlign || '', [['', 'Inherited'], ['left', 'Left'], ['center', 'Center'], ['right', 'Right'], ['justify', 'Justify']]],
      ['Corner radius', 'borderRadius', 'text', current.borderRadius || ''], ['Spacing', 'padding', 'text', current.padding || ''], ['Elevation', 'boxShadow', 'text', current.boxShadow || ''],
    ];
    for (const [label, key, type, value, options] of fields) {
      const input = type === 'select' ? selectInput(`mff-edit-${key}`, options, value, () => {}) : element('input', { id: `mff-edit-${key}`, type, value });
      input.addEventListener('input', () => { const next = { ...plainObject(state.appearance.elementOverrides[id]), [key]: boundedText(input.value, 180) }; commitState('appearance changed', `Changed ${label.toLowerCase()} for ${id}`, (draft) => { draft.appearance.elementOverrides[id] = next; }); applyElementAppearance(target); });
      body.append(control(label, input, `Applies only to ${id}.`, value ? `Stored value: ${value}` : 'Current source: inherited'));
    }
    const actions = element('div', { className: 'mff-actions' }, [button('Reset this element', () => { commitState('appearance reset', `Reset appearance for ${id}`, (draft) => { delete draft.appearance.elementOverrides[id]; }); applyElementAppearance(target); panel.remove(); target.focus?.(); }, { danger: true }), button('Close', () => { panel.remove(); target.focus?.(); })]);
    panel.append(element('div', { className: 'mff-panel-title' }, [element('strong', { textContent: `Edit appearance · ${id}` }), button('×', () => { panel.remove(); target.focus?.(); }, { compact: true, ariaLabel: 'Close appearance editor' })]), body, actions);
    document.body.append(panel); installPanelDrag(panel); panel.querySelector('input,select')?.focus();
  }

  function renderLogoPanel() {
    const panel = element('section', { className: 'mff-panel', id: 'mff-panel-logo', role: 'tabpanel', 'aria-labelledby': 'mff-tab-logo', hidden: true });
    const preview = element('div', { className: 'mff-logo-preview' });
    const renderPreview = () => {
      preview.replaceChildren(); preview.style.setProperty('--mff-logo-bg', state.logo.background); preview.style.setProperty('--mff-logo-fit', state.logo.fit); preview.style.setProperty('--mff-logo-x', `${state.logo.x}%`); preview.style.setProperty('--mff-logo-y', `${state.logo.y}%`);
      if (state.logo.preset === 'custom' && state.logo.dataUrl) preview.append(element('img', { src: state.logo.dataUrl, alt: 'Locally selected app logo preview' }));
      else preview.append(element('div', { className: 'mff-logo-placeholder', textContent: state.logo.preset === 'wave' ? '≈' : state.logo.preset === 'frame' ? '▣' : '▥', 'aria-label': `${state.logo.preset} logo preset preview` }));
    };
    const file = element('input', { id: 'mff-logo-file', type: 'file', accept: '.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp' });
    const status = element('p', { className: 'mff-status', role: 'status', textContent: state.logo.dataUrl ? 'A valid local custom logo is loaded.' : 'No custom logo is loaded.' });
    file.addEventListener('change', async () => { const selected = file.files && file.files[0]; if (!selected) return; status.textContent = 'Validating local image…'; try { const result = await validateLogoFile(selected); commitState('logo changed', 'Loaded a validated local custom logo', (draft) => { draft.logo = { ...draft.logo, preset: 'custom', dataUrl: result.dataUrl, mime: result.mime }; }); status.textContent = `Validated ${result.width}×${result.height} ${result.mime} image. The source stays in this browser.`; renderPreview(); } catch (error) { file.value = ''; status.textContent = error.message; notify({ title: 'Logo was not changed', body: error.message, kind: 'error', persistent: true }); } });
    const fit = selectInput('mff-logo-fit', [['contain', 'Contain'], ['cover', 'Fill and crop'], ['fill', 'Stretch']], state.logo.fit, (event) => { commitState('logo changed', 'Changed logo fit', (draft) => { draft.logo.fit = event.target.value; }); renderPreview(); });
    const x = rangeInput('mff-logo-x', 0, 100, 1, state.logo.x, (event) => { commitState('logo changed', 'Changed logo horizontal focal point', (draft) => { draft.logo.x = Number(event.target.value); }); renderPreview(); });
    const y = rangeInput('mff-logo-y', 0, 100, 1, state.logo.y, (event) => { commitState('logo changed', 'Changed logo vertical focal point', (draft) => { draft.logo.y = Number(event.target.value); }); renderPreview(); });
    const background = element('input', { id: 'mff-logo-background', type: 'color', value: state.logo.background, onInput: (event) => { commitState('logo changed', 'Changed logo preview background', (draft) => { draft.logo.background = event.target.value; }); renderPreview(); } });
    const presets = element('div', { className: 'mff-actions' }, ['bars', 'wave', 'frame'].map((preset) => button(preset[0].toUpperCase() + preset.slice(1), () => { commitState('logo changed', `Selected ${preset} logo preset`, (draft) => { draft.logo.preset = preset; }); renderPreview(); })));
    renderPreview();
    panel.append(panelHeader('App logo', 'Choose a shipped project mark or validate and preview a local image. This changes presentation only.'), element('div', { className: 'mff-grid' }, [element('article', { className: 'mff-card' }, [element('h3', { textContent: 'Preview' }), preview, status, presets]), element('article', { className: 'mff-card' }, [control('Local image', file, 'PNG, JPEG, or still WebP; maximum 2 MiB and 16,777,216 decoded pixels.', state.logo.dataUrl ? 'Source: validated local browser cache' : 'Source: shipped preset'), control('Fit', fit, 'Contain preserves the full mark; Fill and crop uses the focal point; Stretch may distort it.', `Current value: ${state.logo.fit}`), control('Horizontal focal point', x, 'Used when the image is cropped.', `${state.logo.x}%`), control('Vertical focal point', y, 'Used when the image is cropped.', `${state.logo.y}%`), control('Background', background, 'Applies behind transparent pixels in the preview.', state.logo.background), button('Reset to shipped mark', () => openSuperConfirmation({ title: 'Reset app logo', description: 'This removes the local custom image bytes and restores the shipped Bars mark.', actionLabel: 'Reset logo', onConfirm: () => { commitState('logo reset', 'Reset app logo to shipped mark', (draft) => { draft.logo = defaultState().logo; }); rerender(); } }), { danger: true })]) ]));
    return panel;
  }

  async function validateLogoFile(file) {
    if (!(file instanceof File)) throw new Error('Choose a local image file.');
    if (file.size <= 0 || file.size > MAX_LOGO_BYTES) throw new Error('The logo must be larger than 0 bytes and no larger than 2 MiB.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    let mime = '';
    if (bytes.length >= 8 && bytes.slice(0, 8).every((value, index) => value === [137, 80, 78, 71, 13, 10, 26, 10][index])) mime = 'image/png';
    else if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9) mime = 'image/jpeg';
    else if (new TextDecoder('ascii').decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder('ascii').decode(bytes.slice(8, 12)) === 'WEBP') { if (new TextDecoder('ascii').decode(bytes).includes('ANIM')) throw new Error('Animated WebP files are not accepted. Choose a still image.'); mime = 'image/webp'; }
    else throw new Error('The file bytes are not a supported PNG, JPEG, or WebP image.');
    const blob = new Blob([bytes], { type: mime }); const bitmap = await createImageBitmap(blob);
    const width = bitmap.width, height = bitmap.height; bitmap.close();
    if (!width || !height || width * height > MAX_LOGO_PIXELS) throw new Error('The decoded image exceeds the 16,777,216-pixel limit.');
    const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('The browser could not read the selected image.')); reader.readAsDataURL(blob); });
    return { mime, width, height, dataUrl };
  }

  function renderAttentionPanel() {
    const panel = element('section', { className: 'mff-panel', id: 'mff-panel-attention', role: 'tabpanel', 'aria-labelledby': 'mff-tab-attention', hidden: true });
    const clock = element('time', { className: 'mff-status', dateTime: new Date().toISOString(), textContent: new Date().toLocaleTimeString(), 'aria-live': 'off' });
    const updateClock = () => { const now = new Date(); clock.dateTime = now.toISOString(); clock.textContent = now.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' }); };
    const modes = [
      ['lowStimulation', 'Low stimulation', 'Reduces nonessential motion, intensity, and notification turnover without hiding facts.'],
      ['timeAwareness', 'Time awareness', 'Shows exact local timestamps for changes, schedules, notifications, and focus actions.'],
      ['oneThing', 'One thing', 'Keeps one selected task visible across reloads and collapses unrelated detail.'],
      ['momentum', 'Momentum', 'Tracks completed steps and offers a bounded snooze instead of silently dismissing work.'],
      ['focus', 'Focus styling', 'Applies a high-contrast visual target to one selected element without changing its action.'],
    ];
    const modeCard = element('article', { className: 'mff-card' }, [element('h3', { textContent: 'Five independent modes' })]);
    for (const [key, label, description] of modes) modeCard.append(checkbox(label, state.attention[key], (event) => { commitState('attention mode changed', `${event.target.checked ? 'Enabled' : 'Disabled'} ${label}`, (draft) => { draft.attention[key] = event.target.checked; }); rerender(); }, description));
    const task = element('input', { id: 'mff-one-thing', type: 'text', maxlength: 160, value: state.attention.oneThingLabel, placeholder: 'Choose one next action' });
    const done = button(state.attention.oneThingDone ? 'Mark active again' : 'Mark complete', () => { commitState('focus task changed', state.attention.oneThingDone ? 'Returned One Thing task to active' : 'Completed One Thing task', (draft) => { draft.attention.oneThingDone = !draft.attention.oneThingDone; if (draft.attention.oneThingDone) draft.attention.momentumCount += 1; }); rerender(); }, { primary: !state.attention.oneThingDone });
    const saveTask = button('Keep this one thing', () => { commitState('focus task changed', 'Changed the persisted One Thing task', (draft) => { draft.attention.oneThingLabel = boundedText(task.value, 160); draft.attention.oneThingDone = false; }); rerender(); });
    const snooze = selectInput('mff-momentum-snooze', [['', 'No snooze'], ['5', '5 minutes'], ['15', '15 minutes'], ['30', '30 minutes'], ['60', '1 hour']], '', (event) => { if (!event.target.value) return; const until = new Date(Date.now() + Number(event.target.value) * 60000).toISOString(); commitState('momentum snoozed', `Snoozed Momentum until ${new Date(until).toLocaleString()}`, (draft) => { draft.attention.momentumSnoozeUntil = until; }); rerender(); });
    const target = selectInput('mff-focus-target', [['', 'Choose a visible element'], ...Array.from(document.querySelectorAll('[data-appearance-id]')).slice(0, 250).map((node) => [node.dataset.appearanceId, `${node.dataset.appearanceId} · ${(node.getAttribute('aria-label') || node.textContent || node.tagName).trim().slice(0, 55)}`])], state.attention.focusTarget, (event) => { commitState('focus target changed', `Changed focus styling target to ${event.target.value || 'none'}`, (draft) => { draft.attention.focusTarget = event.target.value; }); applyFocusTarget(); });
    panel.append(panelHeader('Focus and attention', 'Five composable local modes support lower stimulation, time awareness, one persistent task, momentum, and visible focus styling.', state.attention.timeAwareness ? [clock] : []), element('div', { className: 'mff-grid' }, [modeCard, element('article', { className: 'mff-card' }, [element('h3', { textContent: 'One Thing and Momentum' }), control('One next action', task, 'The label stays in this browser and does not leave the site.', state.attention.oneThingLabel ? 'Source: stored local preference' : 'Source: empty shipped state'), element('div', { className: 'mff-actions' }, [saveTask, done]), control('Momentum snooze', snooze, 'A snooze expires at an exact local timestamp and never marks work complete.', state.attention.momentumSnoozeUntil ? `Snoozed until ${new Date(state.attention.momentumSnoozeUntil).toLocaleString()}` : 'Not snoozed'), element('p', { className: 'mff-status success', textContent: `${state.attention.momentumCount} completed step${state.attention.momentumCount === 1 ? '' : 's'} recorded.` }), control('Focus styling target', target, 'The selected element receives an additional visible outline and spacing target.', state.attention.focusTarget || 'No target selected')]) ]));
    updateClock(); return panel;
  }

  function applyFocusTarget() {
    document.querySelectorAll('[data-mff-focus-target]').forEach((node) => node.removeAttribute('data-mff-focus-target'));
    if (!state.attention.focus || !state.attention.focusTarget) return;
    const target = document.querySelector(`[data-appearance-id="${CSS.escape(state.attention.focusTarget)}"]`);
    if (target) { target.dataset.mffFocusTarget = 'true'; target.style.outline = `4px solid ${state.appearance.accent}`; target.style.outlineOffset = '5px'; }
  }

  function renderSchedulesPanel() {
    const panel = element('section', { className: 'mff-panel', id: 'mff-panel-schedules', role: 'tabpanel', 'aria-labelledby': 'mff-tab-schedules', hidden: true });
    const list = element('ul', { className: 'mff-list' });
    const renderList = () => {
      list.replaceChildren();
      if (!state.schedules.length) list.append(element('li', { className: 'mff-empty', textContent: 'No local schedule rules yet.' }));
      for (const rule of state.schedules) {
        const enabled = element('input', { type: 'checkbox', 'aria-label': `Enable ${rule.label}`, onChange: (event) => { commitState('schedule changed', `${event.target.checked ? 'Enabled' : 'Disabled'} ${rule.label}`, (draft) => { const item = draft.schedules.find((candidate) => candidate.id === rule.id); if (item) item.enabled = event.target.checked; }); renderList(); } }); enabled.checked = rule.enabled;
        const days = rule.weekdays.length === 7 ? 'Every day' : rule.weekdays.map((day) => WEEKDAYS[day]).join(', ');
        list.append(element('li', { className: 'mff-list-item' }, [enabled, element('div', { className: 'mff-item-copy' }, [element('strong', { textContent: rule.label }), element('small', { textContent: `${days} · ${rule.startTime}–${rule.endTime} · ${rule.setting} = ${rule.value}` })]), button('Remove', () => openSuperConfirmation({ title: 'Remove schedule rule', description: `This permanently removes ${rule.label} from this browser.`, actionLabel: 'Remove rule', onConfirm: () => { commitState('schedule deleted', `Deleted schedule ${rule.label}`, (draft) => { draft.schedules = draft.schedules.filter((item) => item.id !== rule.id); }); renderList(); } }), { danger: true, compact: true })]));
      }
    };
    const form = element('form', { className: 'mff-card' });
    const label = element('input', { id: 'mff-schedule-label', required: true, maxlength: 120, value: 'Evening appearance' });
    const startDate = element('input', { id: 'mff-schedule-start-date', type: 'date' }); const endDate = element('input', { id: 'mff-schedule-end-date', type: 'date' });
    const startTime = element('input', { id: 'mff-schedule-start-time', type: 'time', value: '18:00', required: true }); const endTime = element('input', { id: 'mff-schedule-end-time', type: 'time', value: '23:00', required: true });
    const setting = selectInput('mff-schedule-setting', [['theme', 'Theme'], ['density', 'Density'], ['accent', 'Accent'], ['fontScale', 'Font scale'], ['motion', 'Motion']], 'theme', () => {});
    const value = element('input', { id: 'mff-schedule-value', value: 'dark', required: true });
    const weekdayChecks = WEEKDAYS.map((day, index) => { const input = element('input', { type: 'checkbox', value: index, 'aria-label': day }); input.checked = true; return element('label', { className: 'mff-check' }, [input, day]); });
    form.append(element('h3', { textContent: 'Add local rule' }), control('Rule label', label, 'Use a name that says why the rule exists.', 'New rule'), element('div', { className: 'mff-grid' }, [control('Start date (optional)', startDate, 'Blank means no starting date.', 'Browser local date'), control('End date (optional)', endDate, 'Blank means no ending date.', 'Browser local date'), control('Start time', startTime, 'Interpreted in this browser timezone.', Intl.DateTimeFormat().resolvedOptions().timeZone), control('End time', endTime, 'Cross-midnight windows end on the next selected day. Equal times mean the full selected day.', Intl.DateTimeFormat().resolvedOptions().timeZone)]), element('fieldset', {}, [element('legend', { textContent: 'Weekdays' }), element('div', { className: 'mff-inline' }, weekdayChecks)]), control('Setting', setting, 'Every schedulable site appearance value uses the same local rule contract.', 'Local source only'), control('Value', value, 'Enter the exact setting value shown by its normal control.', 'Validated when applied'), button('Add schedule', () => {}, { primary: true }));
    form.addEventListener('submit', (event) => { event.preventDefault(); if (startDate.value && endDate.value && startDate.value > endDate.value) { notify({ title: 'Schedule was not added', body: 'The end date must be on or after the start date.', kind: 'error', persistent: true }); return; } const weekdays = weekdayChecks.map((wrapper, index) => wrapper.querySelector('input').checked ? index : null).filter((item) => item != null); if (!weekdays.length) { notify({ title: 'Schedule was not added', body: 'Select at least one weekday.', kind: 'error', persistent: true }); return; } const rule = sanitizeSchedule({ id: safeId('schedule'), label: label.value, enabled: true, startDate: startDate.value, endDate: endDate.value, startTime: startTime.value, endTime: endTime.value, weekdays, setting: setting.value, value: value.value, createdAt: new Date().toISOString() }); commitState('schedule created', `Created schedule ${rule.label}`, (draft) => { draft.schedules.push(rule); }); renderList(); });
    panel.append(panelHeader('Scheduled settings', `Rules use ${Intl.DateTimeFormat().resolvedOptions().timeZone} and browser daylight-saving behavior.`), element('div', { className: 'mff-grid' }, [form, element('article', { className: 'mff-card' }, [element('h3', { textContent: 'Rules' }), element('p', { textContent: 'When several rules match, the latest rule in this list wins. Network and Home Assistant sources are unavailable on this static site because it has no privileged credential boundary.' }), list]) ]));
    renderList(); return panel;
  }

  function scheduleMatches(rule, now = new Date()) {
    if (!rule.enabled || !rule.weekdays.includes(now.getDay())) return false;
    const date = now.toISOString().slice(0, 10); if (rule.startDate && date < rule.startDate || rule.endDate && date > rule.endDate) return false;
    const time = now.toTimeString().slice(0, 5); if (rule.startTime === rule.endTime) return true; return rule.startTime < rule.endTime ? time >= rule.startTime && time < rule.endTime : time >= rule.startTime || time < rule.endTime;
  }

  function evaluateSchedules() {
    const matches = state.schedules.filter((rule) => scheduleMatches(rule)); if (!matches.length) return;
    const latest = matches[matches.length - 1];
    const before = state.appearance[latest.setting]; let next = latest.value;
    if (['fontScale'].includes(latest.setting)) next = boundedNumber(next, .75, 1.75, before); if (latest.setting === 'accent' && !/^#[0-9a-f]{6}$/iu.test(next)) return;
    if (before !== next) { state.appearance[latest.setting] = next; persistState(); applyGlobalAppearance(); notify({ title: 'Scheduled setting applied', body: `${latest.label}: ${latest.setting} is now ${next}.`, kind: 'info' }); }
  }

  function renderNotificationsPanel() {
    const panel = element('section', { className: 'mff-panel', id: 'mff-panel-notifications', role: 'tabpanel', 'aria-labelledby': 'mff-tab-notifications', hidden: true });
    const query = element('input', { id: 'mff-notification-search', type: 'search', placeholder: 'Search notifications' });
    const list = element('ul', { className: 'mff-list' });
    const selected = new Set();
    const render = () => { list.replaceChildren(); const matches = searchPredicate(query); const visible = state.notifications.filter((notice) => matches(`${notice.title} ${notice.body} ${notice.kind}`)); if (!visible.length) list.append(element('li', { className: 'mff-empty', textContent: 'No notifications match the current search.' })); for (const notice of visible) { const check = element('input', { type: 'checkbox', 'aria-label': `Select ${notice.title}`, onChange: (event) => event.target.checked ? selected.add(notice.id) : selected.delete(notice.id) }); check.checked = selected.has(notice.id); list.append(element('li', { className: 'mff-list-item' }, [check, element('div', { className: 'mff-item-copy' }, [element('strong', { textContent: notice.title }), element('small', { textContent: `${new Date(notice.createdAt).toLocaleString()} · ${notice.kind} · ${notice.body}` })]), button(notice.dismissed ? 'Restore' : 'Dismiss', () => { commitState('notification changed', `${notice.dismissed ? 'Restored' : 'Dismissed'} ${notice.title}`, (draft) => { const item = draft.notifications.find((candidate) => candidate.id === notice.id); if (item) item.dismissed = !item.dismissed; }); render(); }, { compact: true })])); } };
    query.addEventListener('input', render);
    panel.append(panelHeader('Notifications', 'Corner messages remain factual, searchable, reviewable, and available for scoped bulk actions.', [button('Create sample status', () => { notify({ title: 'Local status notice', body: 'This notification was created locally to exercise the real notification center.', kind: 'info' }); render(); })]), element('article', { className: 'mff-card' }, [control('Search notifications', searchWithBuilder(query), 'Searches titles, body text, and state locally. Plain text is the default.', 'No query stored'), element('div', { className: 'mff-actions' }, [button('Select every match', () => { const matches = searchPredicate(query); state.notifications.filter((notice) => matches(`${notice.title} ${notice.body} ${notice.kind}`)).forEach((notice) => selected.add(notice.id)); render(); }), button('Inverse selection', () => { state.notifications.forEach((notice) => selected.has(notice.id) ? selected.delete(notice.id) : selected.add(notice.id)); render(); }), button('Bulk dismiss', () => { commitState('notifications changed', `Dismissed ${selected.size} selected notifications`, (draft) => { draft.notifications.forEach((notice) => { if (selected.has(notice.id)) notice.dismissed = true; }); }); render(); }), button('Bulk delete…', () => openSuperConfirmation({ title: 'Delete selected notifications', description: `${selected.size} selected notification records will be permanently removed from this browser.`, actionLabel: 'Delete selected', onConfirm: () => { commitState('notifications deleted', `Deleted ${selected.size} notifications`, (draft) => { draft.notifications = draft.notifications.filter((notice) => !selected.has(notice.id)); }); selected.clear(); render(); } }), { danger: true })]), list])); render(); return panel;
  }

  function searchWithBuilder(input) {
    const wrap = element('div', { className: 'mff-search-wrap' }, [input]);
    const trigger = button('.*', () => openRegexBuilder(input, trigger), { compact: true, ariaLabel: `Open regex builder for ${input.getAttribute('aria-label') || input.placeholder || 'search'}` });
    wrap.append(trigger); return wrap;
  }

  function searchPredicate(input) {
    const query = input.value || '';
    if (input.dataset.regexEnabled !== 'true') { const normalized = query.toLocaleLowerCase(); return (value) => String(value).toLocaleLowerCase().includes(normalized); }
    try { const regex = new RegExp(query.slice(0, 512), boundedText(input.dataset.regexFlags || 'iu', 8).replace(/[^dgimsuvy]/gu, '')); return (value) => regex.test(String(value).slice(0, 20000)); } catch (_error) { return () => false; }
  }

  function openRegexBuilder(input, trigger) {
    document.querySelectorAll('.mff-popover[data-regex-builder]').forEach((node) => node.remove());
    const raw = element('input', { id: `${input.id}-regex-raw`, type: 'text', maxlength: 512, value: input.value });
    const flags = element('input', { id: `${input.id}-regex-flags`, type: 'text', maxlength: 8, value: input.dataset.regexFlags || 'iu' });
    const sample = element('textarea', { id: `${input.id}-regex-sample`, maxlength: 20000, rows: 5, placeholder: 'Sample text' });
    const feedback = element('p', { className: 'mff-status', role: 'status', textContent: 'Plain-text search is active.' });
    const builder = element('aside', { className: 'mff-popover', 'data-regex-builder': true, role: 'dialog', 'aria-label': 'Anchored regex builder' });
    const update = () => { try { const validFlags = flags.value.replace(/[^dgimsuvy]/gu, ''); const regex = new RegExp(raw.value.slice(0, 512), validFlags); const matches = Array.from(sample.value.slice(0, 20000).matchAll(regex.global ? regex : new RegExp(regex.source, `${regex.flags}g`))).slice(0, 250); feedback.className = 'mff-status success'; feedback.textContent = `${matches.length} match${matches.length === 1 ? '' : 'es'}; capture groups: ${matches.reduce((count, match) => count + Math.max(0, match.length - 1), 0)}. JavaScript RegExp dialect.`; } catch (error) { feedback.className = 'mff-status error'; feedback.textContent = error.message; } };
    [raw, flags, sample].forEach((field) => field.addEventListener('input', update));
    const insert = (textValue) => { raw.value += textValue; update(); raw.focus(); };
    builder.append(element('h3', { textContent: 'Regex builder' }), element('p', { textContent: 'JavaScript RegExp dialect. Patterns and samples stay in memory and are bounded to protect the page.' }), control('Pattern', raw, 'Raw pattern editor; maximum 512 characters.', 'Not persisted'), control('Flags', flags, 'Supported flags: d g i m s u v y.', 'Default: i u'), element('div', { className: 'mff-actions' }, [['Literal', '\\Qtext\\E'], ['Class', '[A-Za-z0-9]'], ['Anchors', '^$'], ['Group', '(capture)'], ['Alternation', 'one|two'], ['Quantifier', '{1,3}']].map(([label, value]) => button(label, () => insert(value), { compact: true }))), control('Sample text', sample, 'Live evaluation stops after 250 matches.', 'Not persisted'), feedback, element('div', { className: 'mff-actions' }, [button('Use regex', () => { input.value = raw.value; input.dataset.regexEnabled = 'true'; input.dataset.regexFlags = flags.value.replace(/[^dgimsuvy]/gu, ''); builder.remove(); input.dispatchEvent(new Event('input')); input.focus(); }, { primary: true }), button('Use plain text', () => { input.value = raw.value; input.dataset.regexEnabled = 'false'; builder.remove(); input.dispatchEvent(new Event('input')); input.focus(); }), button('Close', () => { builder.remove(); input.focus(); })]));
    document.body.append(builder); const rect = trigger.getBoundingClientRect(); builder.style.left = `${Math.max(8, Math.min(innerWidth - 380, rect.left))}px`; builder.style.top = `${Math.min(innerHeight - 400, rect.bottom + 8)}px`; raw.focus(); update();
  }

  function renderHistoryPanel() {
    const panel = element('section', { className: 'mff-panel', id: 'mff-panel-history', role: 'tabpanel', 'aria-labelledby': 'mff-tab-history', hidden: true });
    const query = element('input', { id: 'mff-history-search', type: 'search', placeholder: 'Search history' }); const start = element('input', { id: 'mff-history-start', type: 'date' }); const end = element('input', { id: 'mff-history-end', type: 'date' });
    const actions = Array.from(new Set(state.history.map((entry) => entry.action))); const actionFilter = selectInput('mff-history-action', [['', 'All recorded actions'], ...actions.map((action) => [action, `${action} (${state.history.filter((entry) => entry.action === action).length})`])], '', () => render());
    const list = element('ul', { className: 'mff-list' });
    const render = () => { list.replaceChildren(); const matches = searchPredicate(query); const visible = state.history.filter((entry) => matches(`${entry.action} ${entry.label}`) && (!actionFilter.value || entry.action === actionFilter.value) && (!start.value || entry.createdAt.slice(0, 10) >= start.value) && (!end.value || entry.createdAt.slice(0, 10) <= end.value)).reverse(); if (!visible.length) list.append(element('li', { className: 'mff-empty', textContent: 'No history entries match the composed filters.' })); for (const entry of visible) list.append(element('li', { className: 'mff-list-item mff-history-entry' }, [element('span', { textContent: '↺', 'aria-hidden': true }), element('div', { className: 'mff-item-copy' }, [element('strong', { textContent: entry.label }), element('small', { textContent: `${entry.action} · ${new Date(entry.createdAt).toLocaleString()}` })]), entry.before ? button('Restore…', () => openSuperConfirmation({ title: 'Restore this local state', description: 'The current state will remain recoverable because the restore creates a new append-only history entry.', actionLabel: 'Restore state', onConfirm: () => { const current = JSON.parse(JSON.stringify(state)); state = sanitizeState(entry.before); recordHistory('restored', `Restored state from ${new Date(entry.createdAt).toLocaleString()}`, current, state); persistState(); rerender(); } }), { compact: true }) : element('span') ])); };
    [query, start, end].forEach((input) => input.addEventListener('input', render));
    panel.append(panelHeader('Local history', 'Every local preference mutation records a bounded append-only entry. Restores create a new entry rather than rewriting history.', [button('Export filtered history', () => { const matches = searchPredicate(query); const rows = state.history.filter((entry) => matches(`${entry.action} ${entry.label}`)).map(({ id, action, label, createdAt }) => ({ id, action, label, createdAt, omitted: 'State snapshots and private records omitted' })); downloadText('material-ffmpeg-history.json', serializers(rows).json, 'application/json'); })]), element('article', { className: 'mff-card' }, [element('div', { className: 'mff-grid three' }, [control('Text search', searchWithBuilder(query), 'Composes with action and date filters.', 'Query not persisted'), control('Start date', start, 'Typed ISO date or browser date picker.', 'No lower bound'), control('End date', end, 'Invalid or partial input remains visible and unapplied.', 'No upper bound'), control('Action', actionFilter, 'Values and counts come from the recorded history.', 'All actions')]), list])); render(); return panel;
  }

  function renderChangelogPanel() {
    const panel = element('section', { className: 'mff-panel', id: 'mff-panel-changelog', role: 'tabpanel', 'aria-labelledby': 'mff-tab-changelog', hidden: true });
    const query = element('input', { id: 'mff-changelog-search', type: 'search', placeholder: 'Search release history' }); const start = element('input', { id: 'mff-changelog-start', type: 'date' }); const end = element('input', { id: 'mff-changelog-end', type: 'date' }); const list = element('ul', { className: 'mff-list' });
    const filtered = () => { const matches = searchPredicate(query); return CHANGELOG.filter((entry) => matches(`${entry.version} ${entry.category} ${entry.text} ${entry.sha}`) && (!start.value || entry.date >= start.value) && (!end.value || entry.date <= end.value)); };
    const render = () => { list.replaceChildren(); for (const entry of filtered()) list.append(element('li', { className: 'mff-list-item' }, [element('span', { className: 'mff-status', textContent: entry.category }), element('div', { className: 'mff-item-copy' }, [element('strong', { textContent: `${entry.version} · ${entry.date}` }), element('small', { textContent: entry.text })]), element('a', { className: 'mff-button compact', href: `https://github.com/Ding-Ding-Projects/material-ffmpeg/commit/${entry.sha}`, textContent: entry.sha.slice(0, 8), 'aria-label': `Open commit ${entry.sha}` })])); if (!list.children.length) list.append(element('li', { className: 'mff-empty', textContent: 'No changelog entries match the current search and date range.' })); };
    [query, start, end].forEach((input) => input.addEventListener('input', render));
    panel.append(panelHeader('Changelog', 'Every recorded entry includes its date and a validated project commit reference.', [button('Copy filtered view', async () => { await navigator.clipboard.writeText(filtered().map((entry) => `${entry.date} ${entry.version} ${entry.sha}\n${entry.text}`).join('\n\n')); notify({ title: 'Changelog copied', body: `${filtered().length} entries were copied.`, kind: 'success' }); }), button('Export Markdown', () => downloadText('material-ffmpeg-changelog.md', filtered().map((entry) => `## ${entry.version} · ${entry.date}\n\n${entry.text}\n\nCommit: ${entry.sha}`).join('\n\n'), 'text/markdown;charset=utf-8'))]), element('article', { className: 'mff-card' }, [element('div', { className: 'mff-grid three' }, [control('Search changelog', searchWithBuilder(query), 'Plain text is the default and the adjacent builder enables bounded regex mode.', 'Query not persisted'), control('From date', start, 'Composes with search.', 'No lower bound'), control('To date', end, 'Composes with search.', 'No upper bound')]), list])); render(); return panel;
  }

  function exportRecordsFor(kind) {
    if (kind === 'notifications') return state.notifications.map(({ id, title, body, kind: noticeKind, createdAt, dismissed }) => ({ id, title, body, kind: noticeKind, createdAt, dismissed }));
    if (kind === 'history') return state.history.map(({ id, action, label, createdAt }) => ({ id, action, label, createdAt, omitted: 'Snapshots and private data omitted' }));
    if (kind === 'schedules') return state.schedules.map((rule) => ({ ...rule, weekdays: rule.weekdays.join(',') }));
    return CHANGELOG.map((entry) => ({ ...entry }));
  }

  function renderExportsPanel() {
    const panel = element('section', { className: 'mff-panel', id: 'mff-panel-exports', role: 'tabpanel', 'aria-labelledby': 'mff-tab-exports', hidden: true });
    const source = selectInput('mff-export-source', [['notifications', 'Notifications'], ['history', 'Local history'], ['schedules', 'Schedules'], ['changelog', 'Changelog']], 'notifications', updatePreview);
    const format = selectInput('mff-export-format', [['json', 'JSON'], ['jsonl', 'JSONL / NDJSON'], ['yaml', 'YAML'], ['toml', 'TOML'], ['xml', 'XML'], ['csv', 'CSV'], ['tsv', 'TSV'], ['markdown', 'Markdown'], ['html', 'HTML'], ['sql', 'SQL'], ['javascript', 'JavaScript'], ['typescript', 'TypeScript'], ['python', 'Python'], ['go', 'Go'], ['rust', 'Rust']], 'json', updatePreview);
    const preview = element('pre', { className: 'mff-code', 'aria-label': 'Export preview' }); const disclosure = element('p', { className: 'mff-disclosure', textContent: 'UTF-8. Private vocabulary data, authenticator secrets, lock credentials, local logo bytes, local paths, and state snapshots are excluded from ordinary exports.' });
    function updatePreview() { const rows = exportRecordsFor(source.value).slice(0, MAX_RECORDS); const output = serializers(rows)[format.value]; preview.textContent = output.slice(0, 12000) + (output.length > 12000 ? '\n… Preview truncated; the downloaded file remains complete.' : ''); }
    panel.append(panelHeader('Export local records', 'Only formats that preserve the selected record shape are offered. Binary archive and media formats stay unavailable on this static website.'), element('div', { className: 'mff-grid' }, [element('article', { className: 'mff-card' }, [control('Record set', source, 'Choose the local list to export.', 'Current browser records'), control('Faithful format', format, 'The preview and downloaded file use the same serializer.', 'UTF-8; CRLF for CSV/TSV'), disclosure, button('Download export', () => { const rows = exportRecordsFor(source.value).slice(0, MAX_RECORDS); const output = serializers(rows)[format.value]; downloadText(`material-ffmpeg-${source.value}.${format.value === 'javascript' ? 'js' : format.value === 'typescript' ? 'ts' : format.value}`, output); notify({ title: 'Export created', body: `${rows.length} ${source.value} records were written as ${format.value}.`, kind: 'success' }); }, { primary: true })]), element('article', { className: 'mff-card' }, [element('h3', { textContent: 'Preview' }), preview]) ])); updatePreview(); return panel;
  }

  function renderDownloadsPanel() {
    const panel = element('section', { className: 'mff-panel', id: 'mff-panel-downloads', role: 'tabpanel', 'aria-labelledby': 'mff-tab-downloads', hidden: true });
    const status = element('div', { className: 'mff-download-window', role: 'status' }, [element('strong', { textContent: 'No simulated transfer is active.' }), element('p', { textContent: 'This browser-only flow generates sample progress. It does not fetch a URL, read a destination path, or claim that a file was transferred.' })]);
    panel.append(panelHeader('Download handoff surfaces', 'Exercise Start download, Downloading, and Download complete as distinct local simulations. Real extension-to-application evidence is still required.'), element('div', { className: 'mff-grid' }, [element('article', { className: 'mff-card' }, [element('h3', { textContent: 'Simulation boundary' }), element('p', { className: 'mff-disclosure', textContent: 'No browser extension message, source request, destination write, or real downloaded file is involved.' }), button('Open Start download', () => openStartDownload(status), { primary: true })]), element('article', { className: 'mff-card' }, [element('h3', { textContent: 'Current surface' }), status]) ])); return panel;
  }

  function openStartDownload(host) {
    openDialog('Start download', 'Proposed file: material-ffmpeg-example.bin\nSource: generated local sample bytes\nDestination: browser download simulation only', [button('Cancel', closeTopDialog), button('Start simulated download', () => { closeTopDialog(); runDownloadSimulation(host); }, { primary: true })]);
  }

  function runDownloadSimulation(host) {
    let progress = 0, paused = false, cancelled = false; host.replaceChildren(); const title = element('strong', { textContent: 'Downloading · material-ffmpeg-example.bin' }); const copy = element('p', { textContent: '0 of 10 MiB · 0 MiB/s · ETA calculating' }); const meter = element('progress', { className: 'mff-progress', max: 100, value: 0, 'aria-label': 'Simulated download progress' });
    const pause = button('Pause', () => { paused = !paused; pause.textContent = paused ? 'Resume' : 'Pause'; copy.textContent = paused ? `${progress}% · paused` : `${progress}% · resumed`; }); const cancel = button('Cancel', () => { cancelled = true; clearInterval(timer); title.textContent = 'Download cancelled'; copy.textContent = `${progress}% of the local simulation completed. No file was written.`; pause.disabled = true; cancel.disabled = true; }); const actions = element('div', { className: 'mff-actions' }, [pause, cancel]); host.append(title, copy, meter, actions);
    const timer = setInterval(() => { if (paused || cancelled) return; progress = Math.min(100, progress + 4); meter.value = progress; copy.textContent = `${(progress / 10).toFixed(1)} of 10 MiB · 4.0 MiB/s · ETA ${Math.max(0, Math.ceil((100 - progress) / 40))}s`; if (progress === 100) { clearInterval(timer); title.textContent = 'Download complete'; copy.textContent = 'The local simulation completed. No real file was transferred or written.'; actions.replaceChildren(button('Dismiss', () => { host.replaceChildren(element('strong', { textContent: 'Simulation dismissed.' })); })); notify({ title: 'Simulated download complete', body: 'No real file was transferred. This completed only the local interaction demonstration.', kind: 'success', persistent: true }); } }, state.attention.lowStimulation ? 500 : 250);
  }

  function renderSecurityPanel() {
    const panel = element('section', { className: 'mff-panel', id: 'mff-panel-security', role: 'tabpanel', 'aria-labelledby': 'mff-tab-security', hidden: true }); const security = global.MaterialFFmpegFeaturesSecurity;
    panel.append(panelHeader('Local locks and authenticator', 'Browser-local convenience locks are not security, encryption, or protection from another user of this browser profile.'), element('div', { className: 'mff-grid' }, [element('article', { className: 'mff-card' }, [element('h3', { textContent: 'Authenticator' }), element('p', { textContent: 'Use otpauth URI or manual Base32 registration. Standards-correct QR image decoding is explicitly unavailable rather than faked.' }), button('Open local authenticator', () => security?.openAuthenticatorSurface(document.activeElement), { primary: true })]), element('article', { className: 'mff-card' }, [element('h3', { textContent: 'Support Tickets' }), element('p', { textContent: security?.supportDisclosure || 'Nothing is sent anywhere. No ticket exists outside this device. No network request is made. No data is collected, and nobody is reading it.' }), button('Open Support Tickets', () => security?.openSupportTicketsSurface(document.activeElement))]), element('article', { className: 'mff-card' }, [element('h3', { textContent: 'Reset route' }), element('p', { textContent: 'Clearing this site’s browser storage removes every lock, authenticator entry, ticket, custom logo, preference, notification, and local history entry.' }), button('Review site-data reset…', () => openSuperConfirmation({ title: 'Clear interactive site data', description: 'This removes every local feature record from this browser. It cannot be undone after the page reloads.', actionLabel: 'Clear site data', onConfirm: () => { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem('material-ffmpeg.features.security.v1'); sessionStorage.clear(); location.reload(); } }), { danger: true })]) ])); return panel;
  }

  function renderBoundariesPanel() {
    const panel = element('section', { className: 'mff-panel', id: 'mff-panel-boundaries', role: 'tabpanel', 'aria-labelledby': 'mff-tab-boundaries', hidden: true });
    const items = ['Execute FFmpeg or FFprobe', 'Install or update the desktop application', 'Read an operating-system credential vault', 'Open an application-data folder or external editor', 'Control Ollama or Home Assistant', 'Receive browser-extension download messages', 'Create real archives, installers, or media outputs'];
    const localList = element('ul', {}, ['Preferences and appearance', 'Local image preview', 'Focus modes and schedules', 'Notifications and redacted history', 'Structured text exports', 'Toy locks and local TOTP', 'Interaction simulations'].map((textValue) => element('li', { textContent: textValue })));
    const unavailableList = element('ul');
    for (const textValue of items) {
      unavailableList.append(element('li', {}, [
        element('button', { type: 'button', className: 'mff-button', textContent: textValue, disabled: true, title: 'Unavailable on the static website; use the installed desktop application.' }),
        element('small', { textContent: ' Unavailable: this static website has no privileged local application boundary.' }),
      ]));
    }
    panel.append(
      panelHeader('Browser-only boundaries', 'Visible unavailable capabilities are labeled with the installed boundary they require. The website never substitutes a fake success.'),
      element('div', { className: 'mff-grid' }, [
        element('article', { className: 'mff-card' }, [element('h3', { textContent: 'Works locally here' }), localList]),
        element('article', { className: 'mff-card' }, [element('h3', { textContent: 'Requires the installed application' }), unavailableList]),
      ]),
    );
    return panel;
  }

  function openDialog(title, description, actions, body = null) {
    const backdrop = element('div', { className: 'mff-dialog-backdrop', role: 'presentation' }); const dialog = element('section', { className: 'mff-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': `mff-dialog-${Date.now()}` });
    const heading = element('h2', { id: dialog.getAttribute('aria-labelledby'), textContent: title }); dialog.append(heading, element('p', { className: 'mff-dialog-copy', textContent: description })); if (body) dialog.append(body); dialog.append(element('div', { className: 'mff-actions' }, actions)); backdrop.append(dialog); document.body.append(backdrop);
    backdrop.addEventListener('keydown', (event) => { if (event.key === 'Escape') { backdrop.remove(); } }); dialog.querySelector('button,input,select')?.focus(); return backdrop;
  }

  function closeTopDialog() { document.querySelector('.mff-dialog-backdrop:last-of-type')?.remove(); }

  function openSuperConfirmation({ title, description, actionLabel, onConfirm }) {
    const keyOne = element('button', { type: 'button', className: 'mff-button', textContent: 'Key one: idle', 'aria-pressed': 'false' }); const keyTwo = element('button', { type: 'button', className: 'mff-button', textContent: 'Key two: idle', 'aria-pressed': 'false' });
    const slider = element('input', { type: 'range', className: 'mff-confirm-slider', min: 0, max: 100, step: 1, value: 0, disabled: true, 'aria-label': `Slide fully to ${actionLabel}` }); const status = element('p', { className: 'mff-status', role: 'status', textContent: 'Operate both keys before the confirmation slider is enabled.' });
    let one = false, two = false; const update = () => { slider.disabled = !(one && two); status.textContent = slider.disabled ? 'Operate both keys before the confirmation slider is enabled.' : 'Both keys are active. Move the slider to 100 to authorize the exact action.'; };
    keyOne.addEventListener('click', () => { one = !one; keyOne.textContent = `Key one: ${one ? 'active' : 'idle'}`; keyOne.setAttribute('aria-pressed', String(one)); update(); }); keyTwo.addEventListener('click', () => { two = !two; keyTwo.textContent = `Key two: ${two ? 'active' : 'idle'}`; keyTwo.setAttribute('aria-pressed', String(two)); update(); });
    slider.addEventListener('input', () => { status.textContent = `${slider.value}% confirmation progress.`; if (Number(slider.value) === 100 && one && two) { status.textContent = `${actionLabel} authorized.`; try { onConfirm(); } finally { setTimeout(closeTopDialog, 350); } } });
    const body = element('div', { className: 'mff-super-confirm' }, [element('p', { className: 'mff-disclosure', textContent: description }), element('div', { className: 'mff-key-row' }, [keyOne, keyTwo]), slider, status]);
    return openDialog(title, 'This action changes or removes local browser data. Review the exact affected data below.', [button('Emergency exit', closeTopDialog)], body);
  }

  function installPanelDrag(panel) {
    const handle = panel.querySelector('.mff-panel-title'); if (!handle) return; let active = false, offsetX = 0, offsetY = 0;
    handle.addEventListener('pointerdown', (event) => { if (event.target.closest('button')) return; active = true; const rect = panel.getBoundingClientRect(); offsetX = event.clientX - rect.left; offsetY = event.clientY - rect.top; handle.setPointerCapture(event.pointerId); });
    handle.addEventListener('pointermove', (event) => { if (!active || innerWidth <= 620) return; panel.style.left = `${Math.max(0, Math.min(innerWidth - panel.offsetWidth, event.clientX - offsetX))}px`; panel.style.top = `${Math.max(0, Math.min(innerHeight - panel.offsetHeight, event.clientY - offsetY))}px`; panel.style.right = 'auto'; panel.style.bottom = 'auto'; });
    handle.addEventListener('pointerup', (event) => { active = false; handle.releasePointerCapture(event.pointerId); });
    panel.addEventListener('keydown', (event) => { if (!event.altKey || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return; event.preventDefault(); const rect = panel.getBoundingClientRect(); const amount = event.shiftKey ? 24 : 8; panel.style.left = `${Math.max(0, Math.min(innerWidth - rect.width, rect.left + (event.key === 'ArrowRight' ? amount : event.key === 'ArrowLeft' ? -amount : 0)))}px`; panel.style.top = `${Math.max(0, Math.min(innerHeight - rect.height, rect.top + (event.key === 'ArrowDown' ? amount : event.key === 'ArrowUp' ? -amount : 0)))}px`; panel.style.right = 'auto'; panel.style.bottom = 'auto'; });
  }

  function renderWorkspace(mount) {
    root = element('section', { className: 'mff-features-root', id: 'interactive-features', 'aria-labelledby': 'mff-features-title' }); const workspace = element('div', { className: 'mff-workspace', 'data-dock': core?.getPreferences?.().dock || 'left' });
    const rail = element('aside', { className: 'mff-tab-rail' }); const tabs = element('div', { className: 'mff-tabs', role: 'tablist', 'aria-orientation': ['top', 'bottom'].includes(workspace.dataset.dock) ? 'horizontal' : 'vertical' }); const tabSearch = element('input', { id: 'mff-feature-tab-search', type: 'search', placeholder: 'Search feature tabs', 'aria-label': 'Search feature tabs' });
    const content = element('div', { className: 'mff-content' });
    const panels = [renderAppearancePanel(), renderLogoPanel(), renderAttentionPanel(), renderSchedulesPanel(), renderNotificationsPanel(), renderHistoryPanel(), renderChangelogPanel(), renderExportsPanel(), renderDownloadsPanel(), renderSecurityPanel(), renderBoundariesPanel()];
    const selectTab = (id, focus = true) => { activeTab = id; tabs.querySelectorAll('[role="tab"]').forEach((tab) => { const selected = tab.dataset.tab === id; tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1; if (selected && focus) tab.focus(); }); content.querySelectorAll('[role="tabpanel"]').forEach((panel) => { panel.hidden = panel.id !== `mff-panel-${id}`; }); };
    for (const [id, label, icon] of TABS) { const tab = element('button', { id: `mff-tab-${id}`, type: 'button', className: 'mff-tab', role: 'tab', 'data-tab': id, 'aria-selected': id === activeTab ? 'true' : 'false', 'aria-controls': `mff-panel-${id}`, title: label, onClick: () => selectTab(id, false) }, [element('span', { className: 'mff-tab-icon', textContent: icon, 'aria-hidden': true }), element('span', { className: 'mff-tab-label', textContent: label })]); tab.tabIndex = id === activeTab ? 0 : -1; tabs.append(tab); }
    tabs.addEventListener('keydown', (event) => { const tabNodes = Array.from(tabs.querySelectorAll('[role="tab"]:not([hidden])')); const index = tabNodes.indexOf(document.activeElement); const vertical = tabs.getAttribute('aria-orientation') === 'vertical'; const delta = event.key === (vertical ? 'ArrowDown' : 'ArrowRight') ? 1 : event.key === (vertical ? 'ArrowUp' : 'ArrowLeft') ? -1 : 0; if (!delta) return; event.preventDefault(); const next = tabNodes[(index + delta + tabNodes.length) % tabNodes.length]; selectTab(next.dataset.tab); });
    tabSearch.addEventListener('input', () => { const matches = searchPredicate(tabSearch); tabs.querySelectorAll('[role="tab"]').forEach((tab) => { tab.hidden = !matches(tab.textContent); }); });
    rail.append(element('div', { className: 'mff-rail-head' }, [element('strong', { id: 'mff-features-title', textContent: 'Interactive features' }), button('⋯', () => openFeatureMenu(workspace), { compact: true, ariaLabel: 'Open feature workspace menu' })]), searchWithBuilder(tabSearch), tabs); panels.forEach((panel) => content.append(panel)); workspace.append(rail, content); root.append(workspace); mount.replaceChildren(root); selectTab(activeTab, false); installEveryElementActions(); applyGlobalAppearance(); applyFocusTarget(); maybeDimSumSurprise();
  }

  function openFeatureMenu(workspace) {
    document.querySelectorAll('.mff-context-menu').forEach((node) => node.remove()); const menu = element('aside', { className: 'mff-context-menu', role: 'menu', 'aria-label': 'Feature workspace menu' }); const filter = element('input', { id: 'mff-feature-menu-filter', type: 'search', placeholder: 'Filter menu commands', 'aria-label': 'Filter menu commands' });
    const commands = [
      ['Edit selected appearance…', 'Shift+F10', () => openAppearanceEditor(appearanceTarget || root)], ['Open local authenticator', '', () => global.MaterialFFmpegFeaturesSecurity?.openAuthenticatorSurface(document.activeElement)], ['Open command palette', 'Ctrl+Shift+F', () => core?.openTab?.('search')],
      ...['left', 'right', 'top', 'bottom'].map((dock) => [`Dock tabs ${dock}`, '', () => { workspace.dataset.dock = dock; core?.setPreference?.('dock', dock); menu.remove(); }]),
    ]; const commandHost = element('div');
    const render = () => { commandHost.replaceChildren(); const matches = searchPredicate(filter); commands.filter(([label]) => matches(label)).forEach(([label, shortcut, run]) => commandHost.append(element('button', { type: 'button', className: 'mff-button', role: 'menuitem', onClick: () => { run(); menu.remove(); } }, [element('span', { textContent: label }), shortcut ? element('span', { className: 'mff-shortcut', textContent: shortcut, 'aria-label': `Keyboard shortcut ${shortcut}` }) : null]))); if (!commandHost.children.length) commandHost.append(element('p', { className: 'mff-empty', textContent: 'No menu commands match.' })); };
    filter.addEventListener('input', render); menu.append(searchWithBuilder(filter), commandHost); document.body.append(menu); menu.style.right = '1rem'; menu.style.top = '5rem'; render(); filter.focus();
  }

  function installEveryElementActions() {
    if (!root) return; let index = 0; root.querySelectorAll('*').forEach((node) => { if (!node.dataset.appearanceId) node.dataset.appearanceId = `site-${node.tagName.toLowerCase()}-${index++}`; });
    root.addEventListener('contextmenu', (event) => { event.preventDefault(); appearanceTarget = event.target.closest('[data-appearance-id]') || root; openElementContextMenu(event.clientX, event.clientY, appearanceTarget); });
    root.addEventListener('keydown', (event) => { if (event.shiftKey && event.key === 'F10') { event.preventDefault(); appearanceTarget = event.target.closest('[data-appearance-id]') || root; const rect = appearanceTarget.getBoundingClientRect(); openElementContextMenu(rect.left, rect.bottom, appearanceTarget); } });
  }

  function openElementContextMenu(x, y, target) {
    document.querySelectorAll('.mff-context-menu').forEach((node) => node.remove()); const menu = element('aside', { className: 'mff-context-menu', role: 'menu', 'aria-label': 'Element actions' }); const filter = element('input', { id: `mff-element-menu-${Date.now()}`, type: 'search', placeholder: 'Filter element actions' });
    const actions = [['Edit appearance…', 'Shift+Enter', () => openAppearanceEditor(target)], ['Lock this element…', '', () => global.MaterialFFmpegFeaturesSecurity?.openLockWizard(target)], ['Focus style this element', '', () => { commitState('focus target changed', `Selected ${target.dataset.appearanceId} as focus target`, (draft) => { draft.attention.focus = true; draft.attention.focusTarget = target.dataset.appearanceId; }); applyFocusTarget(); }]]; const host = element('div');
    const render = () => { host.replaceChildren(); const matches = searchPredicate(filter); actions.filter(([label]) => matches(label)).forEach(([label, shortcut, run]) => host.append(element('button', { type: 'button', className: 'mff-button', role: 'menuitem', onClick: () => { menu.remove(); run(); } }, [element('span', { textContent: label }), shortcut ? element('span', { className: 'mff-shortcut', textContent: shortcut }) : null]))); }; filter.addEventListener('input', render); menu.append(searchWithBuilder(filter), host); document.body.append(menu); menu.style.left = `${Math.min(x, innerWidth - 300)}px`; menu.style.top = `${Math.min(y, innerHeight - 260)}px`; render(); filter.focus();
  }

  function maybeDimSumSurprise() {
    if (sessionStorage.getItem('material-ffmpeg.dim-sum-draw')) return; sessionStorage.setItem('material-ffmpeg.dim-sum-draw', 'complete'); if (crypto.getRandomValues(new Uint32Array(1))[0] / 0x100000000 >= .1) return;
    notify({ title: 'Dim sum surprise', body: 'A public dish photo is not bundled in this offline site build, so the image was omitted rather than replaced with a guessed or generated substitute.', kind: 'info' });
  }

  function rerender() { if (!root) return; const mount = root.parentElement; if (mount) renderWorkspace(mount); }

  function ensureStylesheet() { if (document.querySelector('link[data-mff-features]')) return; document.head.append(element('link', { rel: 'stylesheet', href: 'features.css', 'data-mff-features': true })); }

  function commands() { return TABS.map(([id, label]) => ({ id: `features.${id}`, label: `Open ${label}`, description: 'Interactive website feature', run: () => { activeTab = id; core?.openTab?.('features'); if (root) { const tab = root.querySelector(`[data-tab="${CSS.escape(id)}"]`); tab?.click(); } } })); }

  function init(coreApi = global.MaterialFFmpegSite || {}) {
    if (root) return { status: 'ready', message: 'Interactive browser features are active.', commands: commands() };
    core = coreApi; state = loadState(); ensureStylesheet(); applyGlobalAppearance();
    const securityBridge = { notify: (payload) => notify(payload), registerCommand: (command) => core?.registerCommands?.([command]), registerFeature: (feature) => core?.registerCommands?.([{ id: `feature.${feature.id}`, label: feature.label, run: feature.open }]) }; global.MaterialFFmpegFeaturesSecurity?.init(securityBridge);
    const descriptor = { status: 'ready', message: 'Local appearance, focus, schedules, notifications, history, exports, locks, and interaction surfaces are active.', commands: commands(), mount: renderWorkspace };
    if (typeof core.registerModule === 'function') { core.registerModule('features', descriptor); core.registerModule('social-preview', { status: 'pending', message: 'A genuine social preview remains pending until a real capture of the built application is available.' }); }
    else { const fallback = element('div'); const anchor = document.querySelector('.source-strip') || document.querySelector('footer'); (anchor?.parentElement || document.body).insertBefore(fallback, anchor || null); renderWorkspace(fallback); }
    clearInterval(scheduleTimer); scheduleTimer = setInterval(evaluateSchedules, 60000); evaluateSchedules(); return descriptor;
  }

  global.MaterialFFmpegFeatures = Object.freeze({ init, getState: () => JSON.parse(JSON.stringify(state || loadState())), translateColor, serializers, validateLogoFile, evaluateSchedules });
})(window);
