'use strict';

const fs = require('fs');
const path = require('path');
const { collectProcess, executableStatus } = require('./safe-process');
const { normalizeHelpText, parseInventory, parseProbeJson } = require('./ffmpeg-parsers');

const INVENTORY_ARGS = Object.freeze({
  codecs: ['-hide_banner', '-codecs'],
  encoders: ['-hide_banner', '-encoders'],
  decoders: ['-hide_banner', '-decoders'],
  formats: ['-hide_banner', '-formats'],
  protocols: ['-hide_banner', '-protocols'],
  bsfs: ['-hide_banner', '-bsfs'],
  devices: ['-hide_banner', '-devices'],
  filters: ['-hide_banner', '-filters'],
  hwaccels: ['-hide_banner', '-hwaccels'],
  pixelFormats: ['-hide_banner', '-pix_fmts'],
  sampleFormats: ['-hide_banner', '-sample_fmts'],
  channelLayouts: ['-hide_banner', '-layouts']
});
const HELP_KINDS = new Set(['encoder', 'decoder', 'filter', 'muxer', 'demuxer', 'protocol', 'bsf']);
const NAME_RE = /^[a-z0-9_.+-]{1,128}$/i;
const CACHE_MS = 5 * 60 * 1000;
const MAX_PROBE_EXPORT_BYTES = 32 * 1024 * 1024;
const MAX_PROBE_SNAPSHOTS = 64;
const DEFAULT_INVENTORY_LIMIT = 500;
const MAX_INVENTORY_LIMIT = 2000;
const DEFAULT_HELP_LIMIT = 64 * 1024;
const MAX_HELP_LIMIT = 256 * 1024;

class RuntimeService {
  constructor({ executables, fileRegistry }) {
    this.executables = executables;
    this.fileRegistry = fileRegistry;
    this.cache = new Map();
    this.cacheFingerprint = null;
    this.probeSnapshots = new Map();
  }

  async status() {
    const fingerprint = this.refreshCacheFingerprint();
    const installed = executableStatus(this.executables);
    let version = null;
    let ffmpegVersion = null;
    let ffprobeVersion = null;
    let ffmpegVersionFull = null;
    let ffprobeVersionFull = null;
    let configuration = null;
    let error = null;
    if (installed.ffmpeg) {
      try {
        const cached = this.cache.get('status');
        if (cached && cached.fingerprint === fingerprint && Date.now() - cached.at < CACHE_MS) {
          ({ version, ffmpegVersion, ffprobeVersion, ffmpegVersionFull, ffprobeVersionFull, configuration } = cached.value);
        } else {
          const [ffmpegResult, ffprobeResult] = await Promise.all([
            collectProcess(this.executables.ffmpeg, ['-version'], { maxBytes: 256 * 1024, timeoutMs: 10_000 }),
            installed.ffprobe
              ? collectProcess(this.executables.ffprobe, ['-version'], { maxBytes: 256 * 1024, timeoutMs: 10_000 })
              : Promise.resolve({ stdout: '' })
          ]);
          const versionLines = normalizedVersionLines(ffmpegResult.stdout);
          const ffprobeVersionLines = normalizedVersionLines(ffprobeResult.stdout);
          ffmpegVersionFull = versionLines[0] || null;
          ffprobeVersionFull = ffprobeVersionLines[0] || null;
          ffmpegVersion = conciseToolVersion(ffmpegVersionFull, 'ffmpeg');
          ffprobeVersion = conciseToolVersion(ffprobeVersionFull, 'ffprobe');
          version = ffmpegVersion;
          configuration = versionLines.find((line) => line.startsWith('configuration:')) || null;
          this.cache.set('status', {
            at: Date.now(),
            fingerprint,
            value: { version, ffmpegVersion, ffprobeVersion, ffmpegVersionFull, ffprobeVersionFull, configuration }
          });
        }
      } catch (caught) {
        error = caught.message;
      }
    }
    return {
      ready: installed.ready && !error,
      ffmpegAvailable: installed.ffmpeg,
      ffprobeAvailable: installed.ffprobe,
      origin: 'bundled',
      locationMode: installed.mode,
      locationRootId: installed.rootId,
      locationsChecked: installed.locationsChecked,
      reasonId: error ? 'TRUSTED_RUNTIME_EXECUTION_FAILED' : installed.reasonId,
      version,
      ffmpegVersion,
      ffprobeVersion,
      ffmpegVersionFull,
      ffprobeVersionFull,
      configuration,
      error
    };
  }

  async catalog() {
    const status = await this.status();
    return { status, kinds: Object.keys(INVENTORY_ARGS) };
  }

  async list(kind, options = {}) {
    if (typeof kind !== 'string' || !Object.hasOwn(INVENTORY_ARGS, kind)) throw new TypeError('Unsupported FFmpeg inventory kind.');
    const request = normalizeCatalogOptions(options);
    this.assertAvailable('ffmpeg');
    const fingerprint = this.refreshCacheFingerprint();
    const key = `list:${kind}:${request.limit}`;
    const cached = this.cache.get(key);
    if (!request.refresh && cached && cached.fingerprint === fingerprint && Date.now() - cached.at < CACHE_MS) return cached.value;
    const result = await collectProcess(this.executables.ffmpeg, INVENTORY_ARGS[kind], { maxBytes: 16 * 1024 * 1024, timeoutMs: 30_000 });
    const parsed = parseInventory(kind, result.stdout || result.stderr, { maxEntries: request.limit + 1 });
    const value = {
      kind,
      entries: parsed.slice(0, request.limit),
      total: parsed.length,
      limit: request.limit,
      truncated: parsed.length > request.limit
    };
    this.cache.set(key, { at: Date.now(), fingerprint, value });
    return value;
  }

  async help(kind, name, options = {}) {
    if (typeof kind !== 'string' || !HELP_KINDS.has(kind)) throw new TypeError('Unsupported FFmpeg help kind.');
    if (typeof name !== 'string' || !NAME_RE.test(name)) throw new TypeError('Invalid FFmpeg component name.');
    const request = normalizeHelpOptions(options);
    this.assertAvailable('ffmpeg');
    const fingerprint = this.refreshCacheFingerprint();
    const key = `help:${kind}:${name}:${request.maxChars}`;
    const cached = this.cache.get(key);
    if (!request.refresh && cached && cached.fingerprint === fingerprint && Date.now() - cached.at < CACHE_MS) return cached.value;
    const result = await collectProcess(this.executables.ffmpeg, ['-hide_banner', '-h', `${kind}=${name}`], { maxBytes: 4 * 1024 * 1024, timeoutMs: 20_000 });
    const text = normalizeHelpText(result.stdout || result.stderr);
    const value = {
      kind,
      name,
      text: text.slice(0, request.maxChars),
      truncated: text.length > request.maxChars,
      status: text ? 'ready' : 'empty'
    };
    this.cache.set(key, { at: Date.now(), fingerprint, value });
    return value;
  }

  async inspect(fileHandle) {
    this.assertAvailable('ffprobe');
    const inputPath = this.fileRegistry.resolve(fileHandle, 'input');
    this.probeSnapshots.delete(fileHandle);
    const result = await collectProcess(this.executables.ffprobe, [
      '-v', 'error', '-show_format', '-show_streams', '-show_chapters', '-show_programs', '-of', 'json', inputPath
    ], { maxBytes: 16 * 1024 * 1024, timeoutMs: 60_000 });
    const probe = parseProbeJson(result.stdout);
    this.probeSnapshots.set(fileHandle, probe);
    while (this.probeSnapshots.size > MAX_PROBE_SNAPSHOTS) {
      this.probeSnapshots.delete(this.probeSnapshots.keys().next().value);
    }
    return probe;
  }

  async exportProbe(spec) {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new TypeError('Probe export specification must be an object.');
    const outputPath = this.fileRegistry.resolve(spec.destinationHandle, 'output');
    const format = normalizeExportFormat(spec.format);
    const snapshot = this.probeSnapshots.get(spec.fileHandle);
    if (!snapshot) throw new Error('The inspected result is no longer available. Inspect the selected file again before exporting.');
    const serialized = serializeProbeExport(format.name, snapshot);
    atomicWritePreservingExisting(outputPath, serialized.body);
    return {
      name: path.basename(outputPath),
      format: format.name,
      bytes: Buffer.byteLength(serialized.body, 'utf8'),
      records: serialized.records,
      status: 'written',
      truncated: false
    };
  }

  assertAvailable(tool) {
    const installed = executableStatus(this.executables);
    if (!installed[tool]) {
      const error = new Error(`Bundled ${tool} is unavailable.`);
      error.code = tool === 'ffmpeg' ? 'FFMPEG_UNAVAILABLE' : 'FFPROBE_UNAVAILABLE';
      throw error;
    }
  }

  refreshCacheFingerprint() {
    const fingerprint = [fingerprintFile(this.executables.ffmpeg), fingerprintFile(this.executables.ffprobe)].join('|');
    if (this.cacheFingerprint !== fingerprint) {
      this.cache.clear();
      this.cacheFingerprint = fingerprint;
    }
    return fingerprint;
  }
}

function normalizeCatalogOptions(value) {
  if (value === undefined) return { limit: DEFAULT_INVENTORY_LIMIT, refresh: false };
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('FFmpeg inventory options must be an object.');
  const limit = value.limit === undefined ? DEFAULT_INVENTORY_LIMIT : value.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_INVENTORY_LIMIT) {
    throw new TypeError(`FFmpeg inventory limit must be an integer from 1 through ${MAX_INVENTORY_LIMIT}.`);
  }
  return { limit, refresh: value.refresh === true };
}

function normalizeHelpOptions(value) {
  if (value === undefined) return { maxChars: DEFAULT_HELP_LIMIT, refresh: false };
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('FFmpeg help options must be an object.');
  const maxChars = value.maxChars === undefined ? DEFAULT_HELP_LIMIT : value.maxChars;
  if (!Number.isInteger(maxChars) || maxChars < 1 || maxChars > MAX_HELP_LIMIT) {
    throw new TypeError(`FFmpeg help limit must be an integer from 1 through ${MAX_HELP_LIMIT}.`);
  }
  return { maxChars, refresh: value.refresh === true };
}

function normalizeExportFormat(value) {
  if (value === 'json') return { name: 'json' };
  if (value === 'csv') return { name: 'csv' };
  if (value === 'xml') return { name: 'xml' };
  throw new TypeError('Probe export format must be json, csv, or xml.');
}

function serializeProbeExport(format, probe) {
  const normalized = parseProbeJson(JSON.stringify(probe), { maxBytes: MAX_PROBE_EXPORT_BYTES });
  let body;
  let records = 1;
  if (format === 'json') {
    body = `${JSON.stringify(normalized, null, 2)}\n`;
  } else {
    const nodes = flattenProbeNodes(normalized);
    records = nodes.length;
    body = format === 'csv' ? serializeProbeCsv(nodes) : serializeProbeXml(nodes);
  }
  const bytes = Buffer.byteLength(body, 'utf8');
  if (bytes > MAX_PROBE_EXPORT_BYTES) {
    throw new RangeError(`The ${format.toUpperCase()} export exceeds the 32 MiB serialization limit.`);
  }
  return { body, records };
}

function flattenProbeNodes(root) {
  const nodes = [];
  let retainedBytes = 0;
  const add = (node) => {
    retainedBytes += Buffer.byteLength(node.path, 'utf8') + Buffer.byteLength(node.value, 'utf8') + node.type.length + 32;
    if (retainedBytes > MAX_PROBE_EXPORT_BYTES) {
      throw new RangeError('The flattened inspection exceeds the 32 MiB serialization limit. Export JSON instead.');
    }
    nodes.push(node);
  };
  const visit = (value, pointer) => {
    if (Array.isArray(value)) {
      add({ path: pointer, type: 'array', value: '' });
      value.forEach((item, index) => visit(item, `${pointer}/${index}`));
      return;
    }
    if (value && typeof value === 'object') {
      add({ path: pointer, type: 'object', value: '' });
      Object.keys(value).forEach((key) => visit(value[key], `${pointer}/${escapeJsonPointerToken(key)}`));
      return;
    }
    if (value === null) {
      add({ path: pointer, type: 'null', value: '' });
      return;
    }
    const type = typeof value;
    if (!['string', 'number', 'boolean'].includes(type)) throw new TypeError('The inspected result contains an unsupported export value.');
    add({ path: pointer, type, value: scalarProbeValue(value) });
  };
  visit(root, '');
  return nodes;
}

function escapeJsonPointerToken(value) {
  return String(value).replace(/~/gu, '~0').replace(/\//gu, '~1');
}

function scalarProbeValue(value) {
  if (typeof value === 'number' && Object.is(value, -0)) return '-0';
  return String(value);
}

function csvCell(value) {
  return `"${String(value).replace(/"/gu, '""')}"`;
}

function serializeProbeCsv(nodes) {
  const state = { bytes: 0, chunks: [] };
  appendExportChunk(state, 'path,type,value\r\n');
  for (const node of nodes) appendExportChunk(state, `${[node.path, node.type, node.value].map(csvCell).join(',')}\r\n`);
  return state.chunks.join('');
}

function serializeProbeXml(nodes) {
  const state = { bytes: 0, chunks: [] };
  appendExportChunk(state, '<?xml version="1.0" encoding="UTF-8"?>\n<ffprobe-export schema-version="1">\n');
  for (const node of nodes) {
    assertXmlText(node.path);
    assertXmlText(node.value);
    appendExportChunk(state, `  <node path="${escapeXml(node.path)}" type="${node.type}">${escapeXml(node.value)}</node>\n`);
  }
  appendExportChunk(state, '</ffprobe-export>\n');
  return state.chunks.join('');
}

function appendExportChunk(state, chunk) {
  state.bytes += Buffer.byteLength(chunk, 'utf8');
  if (state.bytes > MAX_PROBE_EXPORT_BYTES) throw new RangeError('The export exceeds the 32 MiB serialization limit.');
  state.chunks.push(chunk);
}

function assertXmlText(value) {
  for (const character of String(value)) {
    const codePoint = character.codePointAt(0);
    const allowed = codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d
      || (codePoint >= 0x20 && codePoint <= 0xd7ff)
      || (codePoint >= 0xe000 && codePoint <= 0xfffd)
      || (codePoint >= 0x10000 && codePoint <= 0x10ffff);
    if (!allowed) throw new Error('The inspected result contains a character XML 1.0 cannot represent. Export JSON or CSV instead.');
  }
}

function escapeXml(value) {
  return String(value).replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;').replace(/'/gu, '&apos;');
}

function normalizedVersionLines(value) {
  return String(value || '').replace(/\u0000/g, '').split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).slice(0, 64);
}

function conciseToolVersion(value, tool) {
  const line = String(value || '').trim();
  if (!line) return null;
  const match = line.match(new RegExp(`^${tool}\\s+version\\s+([^\\s]+)`, 'iu'));
  if (!match) return null;
  const release = match[1].match(/\d+(?:\.\d+){1,3}/u);
  return release ? release[0] : match[1].slice(0, 64);
}

function fingerprintFile(filePath) {
  try {
    const stat = fs.statSync(filePath, { bigint: true });
    if (!stat.isFile()) return 'not-file';
    return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}`;
  } catch (error) {
    return `missing:${error && error.code ? error.code : 'unknown'}`;
  }
}

function atomicWritePreservingExisting(destination, body) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  const backup = `${destination}.${process.pid}.${Date.now()}.bak`;
  fs.writeFileSync(temporary, body, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  let movedExisting = false;
  try {
    if (fs.existsSync(destination)) {
      fs.renameSync(destination, backup);
      movedExisting = true;
    }
    fs.renameSync(temporary, destination);
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch (_) { /* Best effort cleanup. */ }
    if (movedExisting && !fs.existsSync(destination)) {
      try { fs.renameSync(backup, destination); }
      catch (restoreError) {
        error.message = `${error.message} The previous destination could not be restored: ${restoreError.message}`;
      }
    }
    throw error;
  }
  if (movedExisting) {
    try { fs.rmSync(backup, { force: true }); } catch (_) { /* A stale backup is safer than losing the completed export. */ }
  }
}

module.exports = { RuntimeService };
