'use strict';

const fs = require('fs');
const path = require('path');
const { collectProcess, executableStatus } = require('./safe-process');
const { normalizeHelpText, parseInventory, parseProbeJson } = require('./ffmpeg-parsers');

const INVENTORY_ARGS = Object.freeze({
  codecs: ['-hide_banner', '-codecs'],
  formats: ['-hide_banner', '-formats'],
  protocols: ['-hide_banner', '-protocols'],
  bsfs: ['-hide_banner', '-bsfs'],
  devices: ['-hide_banner', '-devices'],
  filters: ['-hide_banner', '-filters'],
  hwaccels: ['-hide_banner', '-hwaccels']
});
const HELP_KINDS = new Set(['encoder', 'decoder', 'filter', 'muxer', 'demuxer', 'protocol', 'bsf']);
const NAME_RE = /^[a-z0-9_.+-]{1,128}$/i;
const CACHE_MS = 5 * 60 * 1000;

class RuntimeService {
  constructor({ executables, fileRegistry }) {
    this.executables = executables;
    this.fileRegistry = fileRegistry;
    this.cache = new Map();
  }

  async status() {
    const installed = executableStatus(this.executables);
    let version = null;
    let error = null;
    if (installed.ffmpeg) {
      try {
        const result = await collectProcess(this.executables.ffmpeg, ['-version'], { maxBytes: 256 * 1024, timeoutMs: 10_000 });
        version = result.stdout.split(/\r?\n/, 1)[0]?.trim() || null;
      } catch (caught) {
        error = caught.message;
      }
    }
    return {
      ready: installed.ready && !error,
      ffmpegAvailable: installed.ffmpeg,
      ffprobeAvailable: installed.ffprobe,
      origin: 'bundled',
      version,
      error
    };
  }

  async catalog() {
    const status = await this.status();
    return { status, kinds: Object.keys(INVENTORY_ARGS) };
  }

  async list(kind) {
    if (typeof kind !== 'string' || !Object.hasOwn(INVENTORY_ARGS, kind)) throw new TypeError('Unsupported FFmpeg inventory kind.');
    const cached = this.cache.get(`list:${kind}`);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
    const result = await collectProcess(this.executables.ffmpeg, INVENTORY_ARGS[kind], { maxBytes: 16 * 1024 * 1024, timeoutMs: 30_000 });
    const value = parseInventory(kind, result.stdout || result.stderr);
    this.cache.set(`list:${kind}`, { at: Date.now(), value });
    return value;
  }

  async help(kind, name) {
    if (typeof kind !== 'string' || !HELP_KINDS.has(kind)) throw new TypeError('Unsupported FFmpeg help kind.');
    if (typeof name !== 'string' || !NAME_RE.test(name)) throw new TypeError('Invalid FFmpeg component name.');
    const key = `help:${kind}:${name}`;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
    const result = await collectProcess(this.executables.ffmpeg, ['-hide_banner', '-h', `${kind}=${name}`], { maxBytes: 4 * 1024 * 1024, timeoutMs: 20_000 });
    const value = { kind, name, text: normalizeHelpText(result.stdout || result.stderr) };
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }

  async inspect(fileHandle) {
    const inputPath = this.fileRegistry.resolve(fileHandle, 'input');
    const result = await collectProcess(this.executables.ffprobe, [
      '-v', 'error', '-show_format', '-show_streams', '-show_chapters', '-show_programs', '-of', 'json', inputPath
    ], { maxBytes: 16 * 1024 * 1024, timeoutMs: 60_000 });
    return parseProbeJson(result.stdout);
  }

  async exportProbe(spec) {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new TypeError('Probe export specification must be an object.');
    const inputPath = this.fileRegistry.resolve(spec.fileHandle, 'input');
    const outputPath = this.fileRegistry.resolve(spec.destinationHandle, 'output');
    const format = normalizeExportFormat(spec.format);
    const result = await collectProcess(this.executables.ffprobe, [
      '-v', 'error', '-show_format', '-show_streams', '-show_chapters', '-show_programs', '-of', format.writer, inputPath
    ], { maxBytes: 32 * 1024 * 1024, timeoutMs: 60_000 });
    const output = result.stdout;
    if (!output.trim()) throw new Error('ffprobe produced no export data.');
    atomicWrite(outputPath, output);
    return { name: path.basename(outputPath), format: format.name, bytes: Buffer.byteLength(output, 'utf8') };
  }
}

function normalizeExportFormat(value) {
  if (value === 'json') return { name: 'json', writer: 'json' };
  if (value === 'csv') return { name: 'csv', writer: 'csv' };
  if (value === 'xml') return { name: 'xml', writer: 'xml' };
  throw new TypeError('Probe export format must be json, csv, or xml.');
}

function atomicWrite(destination, body) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, body, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  try {
    fs.renameSync(temporary, destination);
  } catch (error) {
    try { fs.rmSync(destination, { force: true }); fs.renameSync(temporary, destination); }
    catch (_) { try { fs.rmSync(temporary, { force: true }); } catch (_) { /* Best effort cleanup. */ } throw error; }
  }
}

module.exports = { RuntimeService };
