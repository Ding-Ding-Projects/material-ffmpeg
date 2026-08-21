/* Display-only path privacy helpers. Runtime values remain unchanged. */
(function installDisplayPrivacy(root) {
  'use strict';

  const NON_FILE_URL = /\b(?!file:)[a-z][a-z0-9+.-]*:\/\/[^\s<>"']+/gi;
  const QUOTED_LOCAL_REFERENCE = /(["'])((?:file:(?:(?:\/\/\/[a-z]:[\\/])|(?:\/[a-z]:[\\/])|(?:\/\/[^\/\\\s<>"'`]+[\\/]))|(?:[a-z]:[\\/])|(?:\\\\[^\/\\\s<>"'`]+[\\/][^\/\\\s<>"'`]+))[^\r\n"']*)\1/gi;
  const BARE_LOCAL_REFERENCE = /\bfile:(?:(?:\/\/\/[a-z]:[\\/])|(?:\/[a-z]:[\\/])|(?:\/\/[^\/\\\s<>"'`]+[\\/]))[^\s<>"'`]*|\b[a-z]:[\\/][^\s<>"'`]*|\\\\[^\/\\\s<>"'`]+[\\/][^\/\\\s<>"'`]+(?:[\\/][^\s<>"'`]*)?/gi;
  const SAFE_FILE_BASENAME = /^(?:(?:ffmpeg|ffprobe)(?:[-_.][a-z0-9]+)*|(?:input|output|media|audio|video|image|frame|frames|thumbnail|preview|stream|playlist|manifest|segment|capture|export|converted|result|report|log|temp|tmp|file)(?:[-_.][a-z0-9]+)*)\.[a-z0-9]{1,10}$/i;
  const TRAILING_PUNCTUATION = /[),.;}\]]+$/;

  const ROLE_LABELS = Object.freeze({
    input: 'local input',
    source: 'local input',
    output: 'local output',
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
    path: 'local path',
    log: 'local path',
    error: 'local path'
  });

  const roleLabel = (role) => {
    const key = String(role || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return ROLE_LABELS[key] || 'local item';
  };

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

  const displayValue = (value, role) => typeof value === 'string' ? displayText(value, role) : value;

  const api = Object.freeze({ displayText, displayValue });
  Object.defineProperty(root, 'DisplayPrivacy', {
    configurable: false,
    enumerable: true,
    value: api,
    writable: false
  });
})(window);
