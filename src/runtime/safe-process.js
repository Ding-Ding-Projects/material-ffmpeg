'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const MAX_ARGS = 256;
const MAX_ARG_LENGTH = 8192;
const MAX_TOTAL_ARG_LENGTH = 64 * 1024;
const PATH_VALUE_OPTIONS = /^(?:-\/|-filter_script|-filter_complex_script|-attach|-dump_attachment|-hls_segment_filename|-hls_fmp4_init_filename|-segment_list|-passlogfile|-vstats_file|-sdp_file)/i;
const WINDOWS_ABSOLUTE = /^(?:[a-z]:[\\/]|\\\\|\\\\\?\\)/i;

function resolveExecutables(app) {
  const root = app.isPackaged
    ? path.join(process.resourcesPath, 'ffmpeg', 'bin')
    : path.join(__dirname, '..', '..', 'resources', 'ffmpeg', 'bin');
  return Object.freeze({
    root,
    ffmpeg: path.join(root, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'),
    ffprobe: path.join(root, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
  });
}

function executableStatus(executables) {
  return {
    root: executables.root,
    ffmpeg: fs.existsSync(executables.ffmpeg),
    ffprobe: fs.existsSync(executables.ffprobe),
    ready: fs.existsSync(executables.ffmpeg) && fs.existsSync(executables.ffprobe)
  };
}

function escapeFilterPath(value) {
  return value.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

function compileJobArgs(spec, fileRegistry) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new TypeError('Job specification must be an object.');
  }
  if (!Array.isArray(spec.args) || spec.args.length === 0 || spec.args.length > MAX_ARGS) {
    throw new TypeError(`Job args must contain between 1 and ${MAX_ARGS} entries.`);
  }

  let total = 0;
  let hasFileHandle = false;
  const args = spec.args.map((entry) => {
    if (typeof entry === 'string') {
      validateLiteralArg(entry);
      total += entry.length;
      return entry;
    }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new TypeError('Each job argument must be a string or file-handle argument.');
    }

    const keys = Object.keys(entry);
    if (!keys.includes('fileHandle') || keys.some((key) => !['fileHandle', 'kind', 'prefix', 'suffix', 'escape'].includes(key))) {
      throw new TypeError('Invalid file-handle argument.');
    }
    const expectedKind = entry.kind === undefined ? undefined : entry.kind;
    if (expectedKind !== undefined && expectedKind !== 'input' && expectedKind !== 'output') {
      throw new TypeError('File-handle argument kind must be input or output.');
    }
    const resolved = fileRegistry.resolve(entry.fileHandle, expectedKind);
    const prefix = boundedWrapper(entry.prefix, 'prefix');
    const suffix = boundedWrapper(entry.suffix, 'suffix');
    const renderedPath = entry.escape === undefined || entry.escape === 'none'
      ? resolved
      : entry.escape === 'ffmpeg-filter'
        ? escapeFilterPath(resolved)
        : (() => { throw new TypeError('Unsupported file path escaping mode.'); })();
    const value = `${prefix}${renderedPath}${suffix}`;
    if (value.length > MAX_ARG_LENGTH) throw new TypeError('Resolved file argument is too long.');
    total += value.length;
    hasFileHandle = true;
    return value;
  });

  if (!hasFileHandle) throw new TypeError('A job must use at least one selected file handle.');
  if (total > MAX_TOTAL_ARG_LENGTH) throw new TypeError('Job arguments are too large.');
  if (args.some((arg) => arg === '-progress' || arg.startsWith('-progress='))) {
    throw new TypeError('Progress output is managed by the application.');
  }
  for (let index = 0; index < args.length; index += 1) {
    if (PATH_VALUE_OPTIONS.test(args[index]) && typeof spec.args[index + 1] === 'string') {
      throw new TypeError(`The path for ${args[index]} must use a selected file handle.`);
    }
    if (args[index] === '-report' || args[index] === '-vstats') throw new TypeError(`Unsupported implicit file output option: ${args[index]}`);
    if (args[index] === '-i' && typeof spec.args[index + 1] === 'string') {
      const input = args[index + 1];
      if (!/^(?:https?|rtmps?|rtsp|udp|tcp|srt|lavfi):/i.test(input) && input !== '-') {
        throw new TypeError('Local inputs must come from a selected file handle.');
      }
    }
  }

  const outputArgument = spec.args[spec.args.length - 1];
  if (typeof outputArgument === 'string' && outputArgument !== '-' &&
    !/^(?:https?|rtmps?|rtsp|udp|tcp|srt|icecast):/i.test(outputArgument)) {
    throw new TypeError('Local outputs must use a selected output file handle.');
  }
  if (outputArgument && typeof outputArgument === 'object') {
    const description = fileRegistry.describe(outputArgument.fileHandle);
    if (description.kind !== 'output') throw new TypeError('The final job argument must be an output file handle.');
  }

  return ['-hide_banner', '-progress', 'pipe:1', '-stats_period', '0.25', ...args];
}

function boundedWrapper(value, label) {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.length > 1024 || /[\0\r\n]/.test(value)) {
    throw new TypeError(`File argument ${label} is invalid.`);
  }
  return value;
}

function validateLiteralArg(value) {
  if (!value || value.length > MAX_ARG_LENGTH || /[\0\r\n]/.test(value)) {
    throw new TypeError('Job argument is empty, too long, or contains a forbidden character.');
  }
  if (WINDOWS_ABSOLUTE.test(value) || path.posix.isAbsolute(value) || /^file:/i.test(value)) {
    throw new TypeError('Local paths must come from a selected file handle.');
  }
}

function collectProcess(executable, args, options = {}) {
  const maxBytes = Math.max(1024, Math.min(Number(options.maxBytes) || 4 * 1024 * 1024, 32 * 1024 * 1024));
  const timeoutMs = Math.max(1000, Math.min(Number(options.timeoutMs) || 30_000, 120_000));

  return new Promise((resolve, reject) => {
    if (!fs.existsSync(executable)) {
      reject(new Error(`Bundled executable is missing: ${path.basename(executable)}`));
      return;
    }
    const child = spawn(executable, args, {
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    const append = (chunks, chunk, currentBytes, streamName) => {
      const next = currentBytes + chunk.length;
      if (next > maxBytes) {
        child.kill('SIGKILL');
        finish(new Error(`${streamName} exceeded the ${maxBytes}-byte limit.`));
        return currentBytes;
      }
      chunks.push(chunk);
      return next;
    };
    child.stdout.on('data', (chunk) => { stdoutBytes = append(stdout, chunk, stdoutBytes, 'Process output'); });
    child.stderr.on('data', (chunk) => { stderrBytes = append(stderr, chunk, stderrBytes, 'Process diagnostics'); });
    child.once('error', (error) => finish(error));
    child.once('close', (code, signal) => {
      const value = {
        code,
        signal: signal || null,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8')
      };
      if (code !== 0) {
        const detail = value.stderr.trim().slice(-2000);
        finish(new Error(`${path.basename(executable)} exited with code ${code}${detail ? `: ${detail}` : ''}`));
      } else finish(null, value);
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error(`${path.basename(executable)} timed out after ${timeoutMs} ms.`));
    }, timeoutMs);
    timer.unref?.();
  });
}

module.exports = {
  collectProcess,
  compileJobArgs,
  executableStatus,
  resolveExecutables
};
