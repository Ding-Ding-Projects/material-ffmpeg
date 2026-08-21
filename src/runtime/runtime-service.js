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

class RuntimeService {
  constructor({ executables, fileRegistry }) {
    this.executables = executables;
    this.fileRegistry = fileRegistry;
    this.cache = new Map();
    this.cacheFingerprint = null;
  }

  async status() {
    const fingerprint = this.refreshCacheFingerprint();
    const installed = executableStatus(this.executables);
    let version = null;
    let ffprobeVersion = null;
    let configuration = null;
    let error = null;
    if (installed.ffmpeg) {
      try {
        const cached = this.cache.get('status');
        if (cached && cached.fingerprint === fingerprint && Date.now() - cached.at < CACHE_MS) {
          ({ version, ffprobeVersion, configuration } = cached.value);
        } else {
          const [ffmpegResult, ffprobeResult] = await Promise.all([
            collectProcess(this.executables.ffmpeg, ['-version'], { maxBytes: 256 * 1024, timeoutMs: 10_000 }),
            installed.ffprobe
              ? collectProcess(this.executables.ffprobe, ['-version'], { maxBytes: 256 * 1024, timeoutMs: 10_000 })
              : Promise.resolve({ stdout: '' })
          ]);
          const versionLines = normalizedVersionLines(ffmpegResult.stdout);
          version = versionLines[0] || null;
          configuration = versionLines.find((line) => line.startsWith('configuration:')) || null;
          ffprobeVersion = normalizedVersionLines(ffprobeResult.stdout)[0] || null;
          this.cache.set('status', { at: Date.now(), fingerprint, value: { version, ffprobeVersion, configuration } });
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
      ffprobeVersion,
      configuration,
      error
    };
  }

  async catalog() {
    const status = await this.status();
    return { status, kinds: Object.keys(INVENTORY_ARGS) };
  }

  async list(kind) {
    if (typeof kind !== 'string' || !Object.hasOwn(INVENTORY_ARGS, kind)) throw new TypeError('Unsupported FFmpeg inventory kind.');
    this.assertAvailable('ffmpeg');
    const fingerprint = this.refreshCacheFingerprint();
    const cached = this.cache.get(`list:${kind}`);
    if (cached && cached.fingerprint === fingerprint && Date.now() - cached.at < CACHE_MS) return cached.value;
    const result = await collectProcess(this.executables.ffmpeg, INVENTORY_ARGS[kind], { maxBytes: 16 * 1024 * 1024, timeoutMs: 30_000 });
    const value = parseInventory(kind, result.stdout || result.stderr);
    this.cache.set(`list:${kind}`, { at: Date.now(), fingerprint, value });
    return value;
  }

  async help(kind, name) {
    if (typeof kind !== 'string' || !HELP_KINDS.has(kind)) throw new TypeError('Unsupported FFmpeg help kind.');
    if (typeof name !== 'string' || !NAME_RE.test(name)) throw new TypeError('Invalid FFmpeg component name.');
    this.assertAvailable('ffmpeg');
    const fingerprint = this.refreshCacheFingerprint();
    const key = `help:${kind}:${name}`;
    const cached = this.cache.get(key);
    if (cached && cached.fingerprint === fingerprint && Date.now() - cached.at < CACHE_MS) return cached.value;
    const result = await collectProcess(this.executables.ffmpeg, ['-hide_banner', '-h', `${kind}=${name}`], { maxBytes: 4 * 1024 * 1024, timeoutMs: 20_000 });
    const text = normalizeHelpText(result.stdout || result.stderr);
    const value = { kind, name, text, truncated: false, status: text ? 'ready' : 'empty' };
    this.cache.set(key, { at: Date.now(), fingerprint, value });
    return value;
  }

  async inspect(fileHandle) {
    this.assertAvailable('ffprobe');
    const inputPath = this.fileRegistry.resolve(fileHandle, 'input');
    const result = await collectProcess(this.executables.ffprobe, [
      '-v', 'error', '-show_format', '-show_streams', '-show_chapters', '-show_programs', '-of', 'json', inputPath
    ], { maxBytes: 16 * 1024 * 1024, timeoutMs: 60_000 });
    return parseProbeJson(result.stdout);
  }

  async exportProbe(spec) {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new TypeError('Probe export specification must be an object.');
    this.assertAvailable('ffprobe');
    const inputPath = this.fileRegistry.resolve(spec.fileHandle, 'input');
    const outputPath = this.fileRegistry.resolve(spec.destinationHandle, 'output');
    const format = normalizeExportFormat(spec.format);
    const result = await collectProcess(this.executables.ffprobe, [
      '-v', 'error', '-show_format', '-show_streams', '-show_chapters', '-show_programs', '-of', format.writer, inputPath
    ], { maxBytes: 32 * 1024 * 1024, timeoutMs: 60_000 });
    const output = result.stdout;
    if (!output.trim()) throw new Error('ffprobe produced no export data.');
    validateProbeExport(format.name, output);
    atomicWritePreservingExisting(outputPath, output);
    return { name: path.basename(outputPath), format: format.name, bytes: Buffer.byteLength(output, 'utf8'), status: 'written', truncated: false };
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

function normalizeExportFormat(value) {
  if (value === 'json') return { name: 'json', writer: 'json' };
  if (value === 'csv') return { name: 'csv', writer: 'csv' };
  if (value === 'xml') return { name: 'xml', writer: 'xml' };
  throw new TypeError('Probe export format must be json, csv, or xml.');
}

function normalizedVersionLines(value) {
  return String(value || '').replace(/\u0000/g, '').split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).slice(0, 64);
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

function validateProbeExport(format, output) {
  if (/\u0000/u.test(output)) throw new Error('ffprobe export contains a forbidden null byte.');
  if (format === 'json') {
    parseProbeJson(output, { maxBytes: 32 * 1024 * 1024 });
    return;
  }
  if (format === 'xml' && !/^\s*(?:<\?xml[^>]*>\s*)?<ffprobe\b/u.test(output)) {
    throw new Error('ffprobe XML export did not contain an ffprobe document root.');
  }
  if (format === 'csv' && !output.split(/\r?\n/u).some((line) => line.trim())) {
    throw new Error('ffprobe CSV export did not contain a record.');
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
