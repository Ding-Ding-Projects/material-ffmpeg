/* Display-only path privacy helpers. Runtime values remain unchanged. */
(function installDisplayPrivacy(root) {
  'use strict';

  const NON_FILE_URL = /\b(?!file:)[a-z][a-z0-9+.-]*:\/\/[^\s<>"']+/gi;
  const QUOTED_LOCAL_REFERENCE = /(["'])((?:file:(?:(?:\/\/\/[a-z]:[\\/])|(?:\/[a-z]:[\\/])|(?:\/\/[^\/\\\s<>"'`]+[\\/]))|(?:[a-z]:[\\/])|(?:\\\\[^\/\\\s<>"'`]+[\\/][^\/\\\s<>"'`]+))[^\r\n"']*)\1/gi;
  const BARE_LOCAL_REFERENCE = /\bfile:(?:(?:\/\/\/[a-z]:[\\/])|(?:\/[a-z]:[\\/])|(?:\/\/[^\/\\\s<>"'`]+[\\/]))[^\s<>"'`]*|\b[a-z]:[\\/][^\s<>"'`]*|\\\\[^\/\\\s<>"'`]+[\\/][^\/\\\s<>"'`]+(?:[\\/][^\s<>"'`]*)?/gi;
  const SAFE_FILE_BASENAME = /^(?:(?:ffmpeg|ffprobe)(?:[-_.][a-z0-9]+)*|(?:input|output|media|audio|video|image|frame|frames|thumbnail|preview|stream|playlist|manifest|segment|capture|export|converted|result|report|log|temp|tmp|file)(?:[-_.][a-z0-9]+)*)\.[a-z0-9]{1,10}$/i;
  const TRAILING_PUNCTUATION = /[),.;}\]]+$/;
  const MAX_DISPLAY_DEPTH = 8;
  const MAX_DISPLAY_ITEMS = 500;
  const MAX_DISPLAY_KEY_LENGTH = 160;

  const ROLE_LABELS = Object.freeze({
    input: 'local input',
    inputfile: 'local input',
    source: 'local input',
    output: 'local output',
    outputfile: 'local output',
    destination: 'local output',
    target: 'local output',
    executable: 'bundled runtime',
    ffmpeg: 'bundled runtime',
    ffprobe: 'bundled runtime',
    runtime: 'bundled runtime',
    directory: 'local folder',
    folder: 'local folder',
    cwd: 'local folder',
    workingdirectory: 'local folder',
    file: 'local file',
    filename: 'local file',
    selectedfile: 'local file',
    inspectedfile: 'local file',
    jobfile: 'local file',
    filedetail: 'local file',
    path: 'local path',
    log: 'local path',
    error: 'local path',
    joberror: 'local path',
    notificationdetail: 'local path',
    inspectionerror: 'local path',
    inventoryerror: 'local path',
    commanddetail: 'local path',
    runtimedetail: 'bundled runtime'
  });

  const roleKey = (role) => String(role || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const roleLabel = (role) => ROLE_LABELS[roleKey(role)] || 'local item';
  const neutralLabel = (role) => `[${roleLabel(role)}]`;
  const nestedRole = (key, parentRole) => ROLE_LABELS[roleKey(key)] ? key : parentRole;

  const safeBasename = (reference) => {
    const isFileUrl = /^file:/i.test(reference);
    let pathText = reference;

    if (isFileUrl) {
      try {
        const parsed = new URL(reference);
        if (parsed.protocol !== 'file:') return '';
        pathText = parsed.pathname;
      } catch (_error) {
        return '';
      }
    }

    if (!pathText || /[\\/]$/.test(pathText)) return '';
    const parts = pathText.replace(/\\/g, '/').split('/').filter(Boolean);
    if (!parts.length) return '';

    let basename = parts[parts.length - 1];
    if (isFileUrl) {
      try { basename = decodeURIComponent(basename); } catch (_error) { return ''; }
    }

    if (basename.length > 96 || !SAFE_FILE_BASENAME.test(basename)) return '';
    return basename;
  };

  const replacementFor = (reference, role) => {
    const basename = safeBasename(reference);
    const label = roleLabel(role);
    return basename ? `[${label}: ${basename}]` : `[${label}]`;
  };

  const sanitizeLocalReferences = (text, role) => text
    .replace(QUOTED_LOCAL_REFERENCE, (_match, quote, reference) => `${quote}${replacementFor(reference, role)}${quote}`)
    .replace(BARE_LOCAL_REFERENCE, (match) => {
      const punctuation = match.match(TRAILING_PUNCTUATION)?.[0] || '';
      const reference = punctuation ? match.slice(0, -punctuation.length) : match;
      return `${replacementFor(reference, role)}${punctuation}`;
    });

  const displayText = (value, role) => {
    const text = value == null ? '' : String(value);
    let output = '';
    let cursor = 0;

    text.replace(NON_FILE_URL, (url, offset) => {
      output += sanitizeLocalReferences(text.slice(cursor, offset), role);
      output += url;
      cursor = offset + url.length;
      return url;
    });

    return output + sanitizeLocalReferences(text.slice(cursor), role);
  };

  const claimSanitizedKey = (candidate, role, reserved) => {
    const fallback = neutralLabel(role);
    const base = candidate.length <= MAX_DISPLAY_KEY_LENGTH ? candidate : fallback;
    if (!reserved.has(base)) {
      reserved.add(base);
      return base;
    }

    for (let index = 2; index <= MAX_DISPLAY_ITEMS + 1; index += 1) {
      const suffix = ` [${index}]`;
      const key = `${base.slice(0, MAX_DISPLAY_KEY_LENGTH - suffix.length)}${suffix}`;
      if (!reserved.has(key)) {
        reserved.add(key);
        return key;
      }
    }

    return fallback;
  };

  const copyDisplayValue = (value, role, context, depth) => {
    if (typeof value === 'string') return displayText(value, role);
    if (!value || typeof value !== 'object') return value;

    const isArray = Array.isArray(value);
    const isPlainObject = !isArray && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
    if (!isArray && !isPlainObject) return value;
    if (depth >= MAX_DISPLAY_DEPTH || context.seen.has(value)) return neutralLabel(role);

    const entries = isArray ? value : Object.entries(value);
    if (entries.length > context.remaining) return neutralLabel(role);

    context.remaining -= entries.length;
    context.seen.add(value);
    let copy;

    if (isArray) {
      copy = entries.map((entry) => copyDisplayValue(entry, role, context, depth + 1));
    } else {
      const prepared = entries.map(([key, entry]) => {
        const childRole = nestedRole(key, role);
        const displayKey = displayText(key, childRole);
        return { childRole, displayKey, entry, key, sanitized: displayKey !== key };
      });
      const reserved = new Set(prepared.filter((item) => !item.sanitized).map((item) => item.key));
      copy = Object.fromEntries(prepared.map((item) => {
        const key = item.sanitized
          ? claimSanitizedKey(item.displayKey, item.childRole, reserved)
          : item.key;
        return [key, copyDisplayValue(item.entry, item.childRole, context, depth + 1)];
      }));
    }

    context.seen.delete(value);
    return copy;
  };

  const displayValue = (value, role) => copyDisplayValue(value, role, {
    remaining: MAX_DISPLAY_ITEMS,
    seen: new WeakSet()
  }, 0);

  const api = Object.freeze({ displayText, displayValue });
  Object.defineProperty(root, 'DisplayPrivacy', {
    configurable: false,
    enumerable: true,
    value: api,
    writable: false
  });
})(window);
