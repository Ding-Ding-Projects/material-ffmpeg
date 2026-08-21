'use strict';

const { StringDecoder } = require('node:string_decoder');

const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor', 'raw']);
const SIMPLE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.+\-]*$/;
const PROGRESS_KEY = /^[A-Za-z][A-Za-z0-9_.\-]*$/;

function parserError(code, message, ErrorType = Error) {
  const error = new ErrorType(message);
  error.code = code;
  return error;
}

function limit(value, fallback, hardMaximum) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > hardMaximum) {
    throw parserError('INVALID_LIMIT', `Parser limit must be an integer from 1 to ${hardMaximum}.`, RangeError);
  }
  return value;
}

function safeRecord() {
  return Object.create(null);
}

function inputText(value, maxBytes, label) {
  if (typeof value !== 'string' && !Buffer.isBuffer(value) && !(value instanceof Uint8Array)) {
    throw parserError('INVALID_INPUT', `${label} must be a string or byte buffer.`, TypeError);
  }

  const bytes = typeof value === 'string' ? Buffer.byteLength(value, 'utf8') : value.byteLength;
  if (bytes > maxBytes) {
    throw parserError('INPUT_TOO_LARGE', `${label} exceeds the ${maxBytes}-byte limit.`, RangeError);
  }

  return typeof value === 'string'
    ? value
    : Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('utf8');
}

function stripTerminalControls(text) {
  return text
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/gu, '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '');
}

function coerceProgressValue(key, value) {
  const integerKey = key === 'frame'
    || key === 'total_size'
    || key === 'out_time_us'
    || key === 'out_time_ms'
    || key === 'dup_frames'
    || key === 'drop_frames';
  const decimalKey = key === 'fps' || /^stream_\d+_\d+_q$/u.test(key);

  if (integerKey && /^-?\d+$/u.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : value;
  }
  if (decimalKey && /^-?(?:\d+\.?\d*|\.\d+)$/u.test(value)) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : value;
  }
  return value;
}

/**
 * Parse FFmpeg's `-progress pipe:1` key/value protocol incrementally.
 * `push` returns every completed block and also invokes `onProgress` for it.
 */
function createProgressParser(onProgress, options = {}) {
  if (onProgress !== undefined && onProgress !== null && typeof onProgress !== 'function') {
    throw parserError('INVALID_CALLBACK', 'onProgress must be a function when provided.', TypeError);
  }
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw parserError('INVALID_OPTIONS', 'Progress parser options must be an object.', TypeError);
  }

  const maxChunkBytes = limit(options.maxChunkBytes, 1024 * 1024, 16 * 1024 * 1024);
  const maxLineChars = limit(options.maxLineChars, 8192, 1024 * 1024);
  const maxKeyChars = limit(options.maxKeyChars, 64, 256);
  const maxValueChars = limit(options.maxValueChars, 4096, 1024 * 1024);
  const maxBlockFields = limit(options.maxBlockFields, 128, 4096);
  const decoder = new StringDecoder('utf8');

  let ended = false;
  let line = '';
  let droppingLine = false;
  let previousWasCarriageReturn = false;
  let values = safeRecord();
  let raw = safeRecord();
  let fieldCount = 0;

  function emitBlock(output) {
    if (fieldCount === 0) return;
    const block = values;
    block.raw = raw;
    values = safeRecord();
    raw = safeRecord();
    fieldCount = 0;
    output.push(block);
    if (onProgress) onProgress(block);
  }

  function consumeLine(output) {
    if (droppingLine) {
      line = '';
      droppingLine = false;
      return;
    }

    const completed = line;
    line = '';
    if (completed.trim() === '') {
      emitBlock(output);
      return;
    }

    const separator = completed.indexOf('=');
    if (separator < 1) return;
    const key = completed.slice(0, separator).trim();
    const value = completed.slice(separator + 1);
    if (key.length > maxKeyChars || value.length > maxValueChars) return;
    if (!PROGRESS_KEY.test(key) || UNSAFE_KEYS.has(key)) return;

    if (fieldCount < maxBlockFields || key === 'progress') {
      if (!Object.prototype.hasOwnProperty.call(raw, key)) fieldCount += 1;
      raw[key] = value;
      values[key] = coerceProgressValue(key, value);
    }

    if (key === 'progress' && (value === 'continue' || value === 'end')) {
      emitBlock(output);
    }
  }

  function consume(text, output) {
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (character === '\n') {
        if (previousWasCarriageReturn) {
          previousWasCarriageReturn = false;
          continue;
        }
        consumeLine(output);
        continue;
      }
      if (character === '\r') {
        consumeLine(output);
        previousWasCarriageReturn = true;
        continue;
      }

      previousWasCarriageReturn = false;
      if (droppingLine) continue;
      if (line.length >= maxLineChars) {
        line = '';
        droppingLine = true;
        continue;
      }
      line += character;
    }
  }

  function push(chunk) {
    if (ended) throw parserError('PARSER_ENDED', 'Cannot push progress after the parser has ended.');
    if (typeof chunk !== 'string' && !Buffer.isBuffer(chunk) && !(chunk instanceof Uint8Array)) {
      throw parserError('INVALID_CHUNK', 'Progress chunks must be strings or byte buffers.', TypeError);
    }

    const chunkBytes = typeof chunk === 'string' ? Buffer.byteLength(chunk, 'utf8') : chunk.byteLength;
    if (chunkBytes > maxChunkBytes) {
      throw parserError('CHUNK_TOO_LARGE', `Progress chunk exceeds the ${maxChunkBytes}-byte limit.`, RangeError);
    }

    const output = [];
    const text = typeof chunk === 'string'
      ? chunk
      : decoder.write(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength));
    consume(text, output);
    return output;
  }

  function end() {
    if (ended) return [];
    ended = true;
    const output = [];
    consume(decoder.end(), output);
    if (line.length || droppingLine) consumeLine(output);
    emitBlock(output);
    return output;
  }

  return Object.freeze({ push, end });
}

function cloneProbeValue(value, state, depth) {
  if (depth > state.maxDepth) {
    throw parserError('PROBE_TOO_DEEP', 'ffprobe JSON exceeds the nesting-depth limit.', RangeError);
  }
  state.nodes += 1;
  if (state.nodes > state.maxNodes) {
    throw parserError('PROBE_TOO_COMPLEX', 'ffprobe JSON exceeds the value-count limit.', RangeError);
  }

  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    if (value.length > state.maxStringChars) {
      throw parserError('PROBE_STRING_TOO_LARGE', 'ffprobe JSON contains an oversized string.', RangeError);
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > state.maxArrayItems) {
      throw parserError('PROBE_ARRAY_TOO_LARGE', 'ffprobe JSON contains an oversized array.', RangeError);
    }
    return value.map((item) => cloneProbeValue(item, state, depth + 1));
  }
  if (!value || typeof value !== 'object') {
    throw parserError('INVALID_PROBE_VALUE', 'ffprobe JSON contains an unsupported value.', TypeError);
  }

  const keys = Object.keys(value);
  if (keys.length > state.maxObjectKeys) {
    throw parserError('PROBE_OBJECT_TOO_LARGE', 'ffprobe JSON contains an object with too many keys.', RangeError);
  }
  const copy = safeRecord();
  for (const key of keys) {
    if (UNSAFE_KEYS.has(key)) continue;
    if (key.length > state.maxKeyChars) {
      throw parserError('PROBE_KEY_TOO_LARGE', 'ffprobe JSON contains an oversized key.', RangeError);
    }
    copy[key] = cloneProbeValue(value[key], state, depth + 1);
  }
  return copy;
}

function parseProbeJson(text, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw parserError('INVALID_OPTIONS', 'ffprobe parser options must be an object.', TypeError);
  }
  const maxBytes = limit(options.maxBytes, 8 * 1024 * 1024, 64 * 1024 * 1024);
  const source = inputText(text, maxBytes, 'ffprobe JSON').replace(/^\uFEFF/u, '');
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw parserError('INVALID_PROBE_JSON', `ffprobe returned malformed JSON: ${error.message}`, SyntaxError);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw parserError('INVALID_PROBE_ROOT', 'ffprobe JSON root must be an object.', TypeError);
  }

  const state = {
    maxDepth: limit(options.maxDepth, 24, 64),
    maxNodes: limit(options.maxNodes, 100000, 1000000),
    maxArrayItems: limit(options.maxArrayItems, 20000, 200000),
    maxObjectKeys: limit(options.maxObjectKeys, 4096, 20000),
    maxStringChars: limit(options.maxStringChars, 1024 * 1024, 8 * 1024 * 1024),
    maxKeyChars: limit(options.maxKeyChars, 256, 4096),
    nodes: 0,
  };
  const output = safeRecord();

  if (Object.prototype.hasOwnProperty.call(parsed, 'format')) {
    if (!parsed.format || typeof parsed.format !== 'object' || Array.isArray(parsed.format)) {
      throw parserError('INVALID_PROBE_FORMAT', 'ffprobe format must be an object.', TypeError);
    }
    output.format = cloneProbeValue(parsed.format, state, 1);
  }
  for (const collection of ['streams', 'chapters', 'programs']) {
    if (!Object.prototype.hasOwnProperty.call(parsed, collection)) continue;
    if (!Array.isArray(parsed[collection])) {
      throw parserError('INVALID_PROBE_COLLECTION', `ffprobe ${collection} must be an array.`, TypeError);
    }
    output[collection] = cloneProbeValue(parsed[collection], state, 1);
  }
  return output;
}

function normalizedLines(text, options, label) {
  const maxBytes = limit(options.maxBytes, 4 * 1024 * 1024, 32 * 1024 * 1024);
  const maxLines = limit(options.maxLines, 50000, 500000);
  const maxLineChars = limit(options.maxLineChars, 16384, 1024 * 1024);
  const source = stripTerminalControls(inputText(text, maxBytes, label)).replace(/^\uFEFF/u, '');
  const lines = source.replace(/\r\n?/gu, '\n').split('\n');
  if (lines.length > maxLines) {
    throw parserError('TOO_MANY_LINES', `${label} exceeds the ${maxLines}-line limit.`, RangeError);
  }
  return lines.map((line) => line.slice(0, maxLineChars).replace(/[ \t]+$/u, ''));
}

function addUnique(entries, seen, key, value, maxEntries) {
  const normalized = key.toLocaleLowerCase('en-US');
  if (!normalized || seen.has(normalized) || entries.length >= maxEntries) return;
  seen.add(normalized);
  entries.push(value);
}

function parentheticalNames(description, label) {
  const match = description.match(new RegExp(`\\(${label}:\\s*([^)]*)\\)`, 'iu'));
  return match ? match[1].trim().split(/\s+/u).filter((name) => SIMPLE_NAME.test(name)) : [];
}

function parseCodecs(lines, maxEntries) {
  const entries = [];
  const seen = new Set();
  const mediaTypes = { V: 'video', A: 'audio', S: 'subtitle', D: 'data' };
  for (const line of lines) {
    const match = line.match(/^\s*([D. ])([E. ])([VASD. ])([I. ])([L. ])([S. ])\s+([^\s=]+)\s*(.*)$/u);
    if (!match || !SIMPLE_NAME.test(match[7])) continue;
    const flags = match.slice(1, 7).map((flag) => flag === ' ' ? '.' : flag).join('');
    const description = match[8].trim();
    addUnique(entries, seen, match[7], {
      name: match[7],
      description,
      flags,
      canDecode: flags[0] === 'D',
      canEncode: flags[1] === 'E',
      mediaType: mediaTypes[flags[2]] || 'unknown',
      intraOnly: flags[3] === 'I',
      lossy: flags[4] === 'L',
      lossless: flags[5] === 'S',
      decoders: parentheticalNames(description, 'decoders'),
      encoders: parentheticalNames(description, 'encoders'),
    }, maxEntries);
  }
  return entries;
}

function parseFormats(lines, maxEntries) {
  const entries = [];
  const seen = new Set();
  for (const line of lines) {
    const match = line.match(/^\s*([D. ])([E. ])\s+([^\s=]+)\s*(.*)$/u);
    if (!match) continue;
    const names = match[3].split(',').map((name) => name.trim()).filter((name) => SIMPLE_NAME.test(name));
    if (!names.length) continue;
    const flags = `${match[1] === ' ' ? '.' : match[1]}${match[2] === ' ' ? '.' : match[2]}`;
    addUnique(entries, seen, names.join(','), {
      name: names[0],
      names,
      description: match[4].trim(),
      flags,
      demuxing: flags[0] === 'D',
      muxing: flags[1] === 'E',
    }, maxEntries);
  }
  return entries;
}

function parseProtocols(lines, maxEntries) {
  const entries = [];
  const byName = new Map();
  let direction = null;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (/^Input:$/iu.test(line)) {
      direction = 'input';
      continue;
    }
    if (/^Output:$/iu.test(line)) {
      direction = 'output';
      continue;
    }
    if (!direction || !SIMPLE_NAME.test(line)) continue;
    const identity = line.toLocaleLowerCase('en-US');
    let entry = byName.get(identity);
    if (!entry) {
      if (entries.length >= maxEntries) continue;
      entry = { name: line, input: false, output: false };
      entries.push(entry);
      byName.set(identity, entry);
    }
    entry[direction] = true;
  }
  return entries;
}

function parseNameList(lines, maxEntries) {
  const entries = [];
  const seen = new Set();
  for (const rawLine of lines) {
    const name = rawLine.trim();
    if (!SIMPLE_NAME.test(name)) continue;
    addUnique(entries, seen, name, { name }, maxEntries);
  }
  return entries;
}

function parseFilters(lines, maxEntries) {
  const entries = [];
  const seen = new Set();
  for (const line of lines) {
    const match = line.match(/^\s*([T. ])([S. ])([C. ])\s+([^\s=]+)\s+(\S+?)->(\S+)\s*(.*)$/u);
    if (!match || !SIMPLE_NAME.test(match[4])) continue;
    const flags = match.slice(1, 4).map((flag) => flag === ' ' ? '.' : flag).join('');
    addUnique(entries, seen, match[4], {
      name: match[4],
      description: match[7].trim(),
      flags,
      timeline: flags[0] === 'T',
      sliceThreading: flags[1] === 'S',
      command: flags[2] === 'C',
      input: match[5],
      output: match[6],
    }, maxEntries);
  }
  return entries;
}

function parseHelpOptions(lines, maxEntries) {
  const entries = [];
  const seen = new Set();
  let section = '';
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    if (!trimmed.startsWith('-') && trimmed.endsWith(':')) {
      section = trimmed.slice(0, -1).trim();
      continue;
    }
    if (!trimmed.startsWith('-')) continue;
    const split = trimmed.search(/\s{2,}/u);
    const syntax = (split < 0 ? trimmed : trimmed.slice(0, split)).trim();
    const description = split < 0 ? '' : trimmed.slice(split).trim();
    const nameMatch = syntax.match(/^(-{1,2}[^\s,]+)/u);
    if (!nameMatch) continue;
    addUnique(entries, seen, `${section}\u0000${syntax}`, {
      name: nameMatch[1],
      syntax,
      description,
      section,
    }, maxEntries);
  }
  return entries;
}

function parseInventory(kind, text, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw parserError('INVALID_OPTIONS', 'Inventory parser options must be an object.', TypeError);
  }
  const normalizedKind = String(kind || '').trim().toLocaleLowerCase('en-US').replace(/^-+/u, '');
  const aliases = {
    codec: 'codecs',
    format: 'formats',
    protocol: 'protocols',
    bsf: 'bsfs',
    bitstreamfilters: 'bsfs',
    'bitstream-filters': 'bsfs',
    bitstream_filters: 'bsfs',
    device: 'devices',
    filter: 'filters',
    hwaccel: 'hwaccels',
    hardwareacceleration: 'hwaccels',
    option: 'help',
    options: 'help',
  };
  const canonicalKind = aliases[normalizedKind] || normalizedKind;
  const maxEntries = limit(options.maxEntries, 10000, 100000);
  const lines = normalizedLines(text, options, `FFmpeg ${canonicalKind || 'inventory'}`);

  if (canonicalKind === 'codecs') return parseCodecs(lines, maxEntries);
  if (canonicalKind === 'formats' || canonicalKind === 'devices') return parseFormats(lines, maxEntries);
  if (canonicalKind === 'protocols') return parseProtocols(lines, maxEntries);
  if (canonicalKind === 'bsfs' || canonicalKind === 'hwaccels') return parseNameList(lines, maxEntries);
  if (canonicalKind === 'filters') return parseFilters(lines, maxEntries);
  if (canonicalKind === 'help') return parseHelpOptions(lines, maxEntries);
  throw parserError('UNSUPPORTED_INVENTORY', `Unsupported FFmpeg inventory kind: ${kind}`, RangeError);
}

function normalizeHelpText(text, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw parserError('INVALID_OPTIONS', 'Help text options must be an object.', TypeError);
  }
  const lines = normalizedLines(text, options, 'FFmpeg help text');
  const maxOutputChars = limit(options.maxOutputChars, 4 * 1024 * 1024, 32 * 1024 * 1024);
  while (lines.length && lines[0].trim() === '') lines.shift();
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  const output = lines.join('\n');
  if (output.length > maxOutputChars) {
    throw parserError('HELP_TEXT_TOO_LARGE', `Normalized FFmpeg help exceeds the ${maxOutputChars}-character limit.`, RangeError);
  }
  return output;
}

module.exports = {
  createProgressParser,
  parseProbeJson,
  parseInventory,
  normalizeHelpText,
};
