'use strict';

const fs = require('fs');
const path = require('path');

const MAX_BATCH_FILES = 64;
const INSPECTION_CONCURRENCY = 4;
const MAX_DETAIL_LENGTH = 500;
const MAX_OUTPUT_ATTEMPTS = 1000;

const TARGETS = Object.freeze({
  mp4: Object.freeze({ adapter: 'video/mp4-h264-aac', extension: 'mp4', requires: 'video' }),
  mkv: Object.freeze({ adapter: 'video/mkv-copy', extension: 'mkv', requires: 'media' }),
  webm: Object.freeze({ adapter: 'video/webm-vp9-opus', extension: 'webm', requires: 'video' }),
  mp3: Object.freeze({ adapter: 'audio/mp3', extension: 'mp3', requires: 'audio' }),
  flac: Object.freeze({ adapter: 'audio/flac', extension: 'flac', requires: 'audio' }),
  wav: Object.freeze({ adapter: 'audio/wav-pcm-s24le', extension: 'wav', requires: 'audio' }),
  png: Object.freeze({ adapter: 'image/png', extension: 'png', requires: 'video' }),
  jpg: Object.freeze({ adapter: 'image/jpeg', extension: 'jpg', requires: 'video' })
});

const WINDOWS_RESERVED_STEM = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu;

function normalizeTarget(value) {
  if (typeof value !== 'string' || !Object.hasOwn(TARGETS, value)) {
    throw new TypeError(`Converter target must be one of: ${Object.keys(TARGETS).join(', ')}.`);
  }
  return value;
}

function normalizeHandles(value, fileRegistry) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_BATCH_FILES) {
    throw new TypeError(`A converter batch must contain between 1 and ${MAX_BATCH_FILES} selected files.`);
  }
  const handles = [...new Set(value)];
  if (handles.length !== value.length) throw new TypeError('A converter batch must not contain duplicate file handles.');
  for (const handle of handles) {
    const description = fileRegistry.describe(handle);
    if (description.kind !== 'input') throw new TypeError('Converter inputs must use selected input handles.');
  }
  return handles;
}

async function inspectInputs(handles, { fileRegistry, inspect }) {
  const selected = normalizeHandles(handles, fileRegistry);
  if (typeof inspect !== 'function') throw new TypeError('Converter inspection callback is unavailable.');
  const results = new Array(selected.length);
  let cursor = 0;

  async function worker() {
    while (cursor < selected.length) {
      const index = cursor;
      cursor += 1;
      const handle = selected[index];
      const file = fileRegistry.describe(handle);
      try {
        results[index] = summarizeProbe(file, await inspect(handle));
      } catch (error) {
        results[index] = {
          ...file,
          status: 'inspection-failed',
          details: boundedMessage(error, 'Media inspection failed.'),
          error: boundedMessage(error, 'Media inspection failed.'),
          format: '',
          durationSeconds: null,
          streams: Object.freeze({ audio: 0, video: 0, subtitle: 0 }),
          supportedTargets: Object.freeze([])
        };
      }
    }
  }

  const workerCount = Math.min(INSPECTION_CONCURRENCY, selected.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function summarizeProbe(file, probe) {
  if (!probe || typeof probe !== 'object' || Array.isArray(probe)) throw new Error('FFprobe returned an invalid media description.');
  const streams = Array.isArray(probe.streams) ? probe.streams.slice(0, 512) : [];
  const counts = { audio: 0, video: 0, subtitle: 0 };
  for (const stream of streams) {
    if (!stream || typeof stream !== 'object') continue;
    if (stream.codec_type === 'audio') counts.audio += 1;
    else if (stream.codec_type === 'video') counts.video += 1;
    else if (stream.codec_type === 'subtitle') counts.subtitle += 1;
  }
  const supportedTargets = Object.entries(TARGETS)
    .filter(([, target]) => target.requires === 'media'
      ? counts.audio > 0 || counts.video > 0
      : counts[target.requires] > 0)
    .map(([id]) => id);
  const format = cleanText(probe.format?.format_long_name || probe.format?.format_name || 'Media detected by FFprobe', 180);
  const duration = Number(probe.format?.duration);
  const streamSummary = [
    counts.video ? `${counts.video} video` : '',
    counts.audio ? `${counts.audio} audio` : '',
    counts.subtitle ? `${counts.subtitle} subtitle` : ''
  ].filter(Boolean).join(', ');
  const status = supportedTargets.length ? 'ready' : 'unsupported';
  const details = status === 'ready'
    ? `${format}${streamSummary ? ` · ${streamSummary}` : ''}`
    : `${format} · no convertible audio or video stream was reported`;
  return {
    ...file,
    status,
    details: cleanText(details, MAX_DETAIL_LENGTH),
    error: status === 'ready' ? '' : 'No convertible audio or video stream was reported.',
    format,
    durationSeconds: Number.isFinite(duration) && duration >= 0 ? duration : null,
    streams: Object.freeze(counts),
    supportedTargets: Object.freeze(supportedTargets)
  };
}

function prepareOutputs({ directory, target, inputHandles, fileRegistry }) {
  const targetId = normalizeTarget(target);
  const handles = normalizeHandles(inputHandles, fileRegistry);
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new TypeError('The converter output directory is invalid.');
  const normalizedDirectory = path.normalize(directory);
  const directoryStat = fs.statSync(normalizedDirectory);
  if (!directoryStat.isDirectory()) throw new Error('The selected converter destination is not a directory.');

  const definition = TARGETS[targetId];
  const reserved = new Set();
  const outputs = [];
  const failures = [];
  for (const inputHandle of handles) {
    try {
      const inputPath = fileRegistry.resolve(inputHandle, 'input');
      const stem = safeStem(path.parse(inputPath).name);
      const outputPath = availableOutputPath(normalizedDirectory, stem, definition.extension, reserved);
      const output = fileRegistry.register(outputPath, 'output');
      reserved.add(pathKey(outputPath));
      outputs.push(Object.freeze({ inputHandle, output }));
    } catch (error) {
      failures.push(Object.freeze({ inputHandle, error: boundedMessage(error, 'Output preparation failed.') }));
    }
  }
  return Object.freeze({
    target: targetId,
    adapter: definition.adapter,
    destinationName: path.basename(normalizedDirectory) || 'Selected drive',
    outputs: Object.freeze(outputs),
    failures: Object.freeze(failures)
  });
}

function availableOutputPath(directory, stem, extension, reserved) {
  for (let attempt = 0; attempt < MAX_OUTPUT_ATTEMPTS; attempt += 1) {
    const suffix = attempt === 0 ? '' : ` (${attempt + 1})`;
    const candidate = path.join(directory, `${stem}${suffix}.${extension}`);
    if (path.dirname(candidate) !== directory) throw new Error('The converter output escaped the selected directory.');
    const key = pathKey(candidate);
    if (!reserved.has(key) && !fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`No unused output name was available for ${stem}.${extension}.`);
}

function safeStem(value) {
  let stem = cleanText(value, 180).replace(/[\\/:*?"<>|\u0000-\u001f]/gu, '_').replace(/[ .]+$/gu, '').trim();
  if (!stem) stem = 'output';
  if (WINDOWS_RESERVED_STEM.test(stem)) stem = `_${stem}`;
  return stem.slice(0, 180);
}

function cleanText(value, limit) {
  return String(value ?? '').replace(/[\u0000\r\n]/gu, ' ').trim().slice(0, limit);
}

function boundedMessage(error, fallback) {
  return cleanText(error && error.message ? error.message : fallback, MAX_DETAIL_LENGTH) || fallback;
}

function pathKey(value) {
  return path.normalize(value).toLocaleLowerCase('en-US');
}

module.exports = {
  MAX_BATCH_FILES,
  TARGETS,
  inspectInputs,
  normalizeTarget,
  prepareOutputs
};
