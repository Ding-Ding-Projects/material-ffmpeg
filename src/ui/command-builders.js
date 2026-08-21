/* Deterministic FFmpeg argument builders for the browser renderer. */
(function exposeCommandBuilders(root) {
  'use strict';

  const API_VERSION = 1;
  const MAX_PATH_LENGTH = 4096;
  const MAX_TOKEN_LENGTH = 8192;
  const MAX_FILTER_LENGTH = 32768;
  const MAX_COLLECTION_LENGTH = 128;
  const FORBIDDEN_ROOT_KEYS = new Set(['bin', 'binary', 'command', 'executable', 'shell']);
  const VIDEO_CODECS = new Set(['copy', 'libx264', 'libx265', 'libsvtav1', 'libvpx-vp9', 'prores_ks', 'h264_nvenc', 'hevc_nvenc', 'av1_nvenc', 'h264_qsv', 'hevc_qsv', 'av1_qsv']);
  const AUDIO_CODECS = new Set(['copy', 'aac', 'libopus', 'libmp3lame', 'flac', 'pcm_s16le', 'pcm_s24le', 'pcm_f32le', 'vorbis']);
  const PRESETS = new Set(['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow', 'placebo', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7']);
  const TUNES = new Set(['film', 'animation', 'grain', 'stillimage', 'fastdecode', 'zerolatency', 'psnr', 'ssim', 'hq', 'll', 'ull', 'lossless']);
  const SCALERS = new Set(['fast_bilinear', 'bilinear', 'bicubic', 'experimental', 'neighbor', 'area', 'bicublin', 'gauss', 'sinc', 'lanczos', 'spline']);
  const HLS_FLAGS = new Set(['delete_segments', 'independent_segments', 'append_list', 'temp_file', 'program_date_time', 'omit_endlist', 'split_by_time', 'discont_start', 'single_file', 'round_durations']);
  const STREAM_PROTOCOLS = new Set(['rtmp:', 'rtmps:', 'srt:', 'udp:', 'tcp:', 'rtsp:']);
  const COMPOSER_BLOCKED_OPTIONS = new Set(['-i', '-progress', '-nostdin', '-stdin', '-y', '-n', '-report', '-filter_script', '-filter_complex_script', '-vstats_file', '-passlogfile']);

  function fail(field, message) {
    throw new TypeError(`${field}: ${message}`);
  }

  function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function object(value, field, allowedKeys) {
    if (!isPlainObject(value)) fail(field, 'must be an object');
    for (const key of Object.keys(value)) {
      if (FORBIDDEN_ROOT_KEYS.has(key)) fail(`${field}.${key}`, 'executable and shell overrides are not accepted');
      if (allowedKeys && !allowedKeys.has(key)) fail(`${field}.${key}`, 'is not supported');
    }
    return value;
  }

  function boolean(value, fallback, field) {
    if (value === undefined) return fallback;
    if (typeof value !== 'boolean') fail(field, 'must be a boolean');
    return value;
  }

  function number(value, fallback, min, max, field, integer) {
    if (value === undefined) return fallback;
    if (typeof value !== 'number' || !Number.isFinite(value)) fail(field, 'must be a finite number');
    if (integer && !Number.isInteger(value)) fail(field, 'must be an integer');
    if (value < min || value > max) fail(field, `must be between ${min} and ${max}`);
    return Object.is(value, -0) ? 0 : value;
  }

  function requiredNumber(value, min, max, field, integer) {
    if (value === undefined) fail(field, 'is required');
    return number(value, undefined, min, max, field, integer);
  }

  function token(value, field, options) {
    const settings = Object.assign({ required: true, maxLength: MAX_TOKEN_LENGTH, allowLeadingDash: true }, options);
    if (value === undefined || value === null || value === '') {
      if (settings.required) fail(field, 'is required');
      return undefined;
    }
    if (typeof value !== 'string' && typeof value !== 'number') fail(field, 'must be a string or number');
    const result = String(value).trim();
    if (!result && settings.required) fail(field, 'is required');
    if (result.length > settings.maxLength) fail(field, `exceeds ${settings.maxLength} characters`);
    if (/\0|[\r\n\u0000-\u001f\u007f]/u.test(result)) fail(field, 'contains a control character');
    if (!settings.allowLeadingDash && result.startsWith('-')) fail(field, 'must not begin with a dash');
    return result;
  }

  function localPath(value, field, options) {
    const result = token(value, field, { maxLength: MAX_PATH_LENGTH, allowLeadingDash: false });
    const settings = Object.assign({ allowPattern: false }, options);
    if (result === '-' || /^pipe:/iu.test(result)) fail(field, 'pipe targets are not accepted');
    if (/^(?:concat|crypto|data|subfile):/iu.test(result)) fail(field, 'virtual and data protocols are not accepted as file paths');
    if (/^[a-z][a-z0-9+.-]*:/iu.test(result) && !/^[a-z]:[\\/]/iu.test(result)) fail(field, 'must be a local file path');
    if (!settings.allowPattern && /%(?:\d+)?d/u.test(result)) fail(field, 'sequence patterns are not accepted here');
    return result;
  }

  function outputPath(value, field, allowPattern) {
    return localPath(value, field, { allowPattern: Boolean(allowPattern) });
  }

  function enumValue(value, fallback, values, field) {
    const result = value === undefined ? fallback : token(value, field);
    if (!values.has(result)) fail(field, `must be one of: ${[...values].join(', ')}`);
    return result;
  }

  function codec(value, fallback, values, field, allowNone) {
    const accepted = allowNone ? new Set([...values, 'none']) : values;
    return enumValue(value, fallback, accepted, field);
  }

  function bitrate(value, fallback, field) {
    const result = value === undefined ? fallback : token(value, field);
    if (result === undefined) return undefined;
    if (!/^(?:[1-9]\d{0,8})(?:[kKmM])?$/u.test(result)) fail(field, 'must be a positive integer with an optional k or M suffix');
    return result.toLowerCase();
  }

  function rational(value, fallback, field) {
    const result = value === undefined ? fallback : value;
    if (typeof result === 'number') {
      const checked = number(result, undefined, 0.001, 1000, field, false);
      return String(checked);
    }
    const text = token(result, field);
    const match = /^(\d{1,6})(?:\/(\d{1,6})|\.(\d{1,6}))?$/u.exec(text);
    if (!match) fail(field, 'must be a positive decimal or rational value');
    if (match[2] && Number(match[2]) === 0) fail(field, 'must not have a zero denominator');
    const numeric = match[2] ? Number(match[1]) / Number(match[2]) : Number(text);
    if (!(numeric > 0 && numeric <= 1000)) fail(field, 'must be greater than 0 and at most 1000');
    return text;
  }

  function dimension(value, fallback, field) {
    const result = value === undefined ? fallback : value;
    if (result === -1 || result === -2) return result;
    return number(result, undefined, 2, 32768, field, true);
  }

  function timeValue(value, field, optional) {
    if (value === undefined || value === null || value === '') {
      if (optional) return undefined;
      fail(field, 'is required');
    }
    if (typeof value === 'number') return String(number(value, undefined, 0, 315360000, field, false));
    const result = token(value, field);
    if (/^\d+(?:\.\d{1,9})?$/u.test(result)) return result;
    const match = /^(\d{1,6}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?$/u.exec(result);
    if (!match || Number(match[2]) > 59 || Number(match[3]) > 59) fail(field, 'must be seconds or HH:MM:SS[.fraction]');
    // Keep the textual form and validate it against the same ten-year bound as
    // numeric times. Without this check a six-digit hour value could bypass the
    // bound and make ffmpeg accept an effectively unbounded seek or duration.
    const seconds = (Number(match[1]) * 3600) + (Number(match[2]) * 60) + Number(match[3]) + (match[4] ? Number(`0.${match[4]}`) : 0);
    if (!Number.isFinite(seconds) || seconds > 315360000) fail(field, 'must be at most 315360000 seconds');
    return result;
  }

  function timeAsSeconds(value) {
    if (!value.includes(':')) return Number(value);
    const parts = value.split(':');
    return (Number(parts[0]) * 3600) + (Number(parts[1]) * 60) + Number(parts[2]);
  }

  function streamSelector(value, fallback, field) {
    const result = value === undefined ? fallback : token(value, field);
    if (!/^0:(?:[vasdt](?::\d{1,4})?|\d{1,4})\??$/u.test(result)) fail(field, 'must select a stream from input 0');
    return result;
  }

  function filter(value, field) {
    const result = token(value, field, { maxLength: MAX_FILTER_LENGTH });
    if (!result) fail(field, 'must not be empty');
    return result;
  }

  function filterList(value, field) {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > MAX_COLLECTION_LENGTH) fail(field, `must be an array of at most ${MAX_COLLECTION_LENGTH} filters`);
    return value.map((entry, index) => filter(entry, `${field}[${index}]`));
  }

  function uniqueStrings(value, field, allowed, maximum) {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > maximum) fail(field, `must be an array of at most ${maximum} values`);
    const result = value.map((entry, index) => enumValue(entry, undefined, allowed, `${field}[${index}]`));
    if (new Set(result).size !== result.length) fail(field, 'must not contain duplicates');
    return result;
  }

  function commonArgs(spec) {
    const args = ['-hide_banner', '-nostdin', boolean(spec.overwrite, false, 'overwrite') ? '-y' : '-n'];
    if (boolean(spec.progress, true, 'progress')) args.push('-progress', 'pipe:1', '-nostats');
    return args;
  }

  function addTimingBeforeInput(args, spec) {
    const start = timeValue(spec.start, 'start', true);
    if (start !== undefined) args.push('-ss', start);
  }

  function addTimingAfterInput(args, spec) {
    const duration = timeValue(spec.duration, 'duration', true);
    if (duration !== undefined) args.push('-t', duration);
  }

  function addMaps(args, maps) {
    if (maps === undefined) return;
    if (!Array.isArray(maps) || maps.length > 64) fail('maps', 'must be an array of at most 64 stream selectors');
    maps.forEach((entry, index) => args.push('-map', streamSelector(entry, undefined, `maps[${index}]`)));
  }

  function freezeArgv(args) {
    return Object.freeze(args.map((entry) => String(entry)));
  }

  const CONVERT_KEYS = new Set(['input', 'output', 'overwrite', 'progress', 'start', 'duration', 'maps', 'videoCodec', 'audioCodec', 'crf', 'preset', 'tune', 'profile', 'level', 'pixelFormat', 'width', 'height', 'fps', 'scaler', 'aspectRatio', 'videoBitrate', 'audioBitrate', 'faststart', 'shortest', 'threads', 'videoFilters', 'audioFilters', 'hwaccel']);
  function convert(inputSpec) {
    const spec = object(inputSpec, 'convert', CONVERT_KEYS);
    const input = localPath(spec.input, 'input');
    const output = outputPath(spec.output, 'output', false);
    const videoCodec = codec(spec.videoCodec, 'libx264', VIDEO_CODECS, 'videoCodec', true);
    const audioCodec = codec(spec.audioCodec, 'aac', AUDIO_CODECS, 'audioCodec', true);
    if (videoCodec === 'none' && audioCodec === 'none') fail('codecs', 'at least one output stream must be enabled');
    const args = commonArgs(spec);
    const hwaccel = enumValue(spec.hwaccel, 'none', new Set(['none', 'auto', 'cuda', 'qsv', 'd3d11va', 'dxva2', 'vulkan']), 'hwaccel');
    if (hwaccel !== 'none') args.push('-hwaccel', hwaccel);
    addTimingBeforeInput(args, spec);
    args.push('-i', input);
    addTimingAfterInput(args, spec);
    addMaps(args, spec.maps);

    const videoFilters = filterList(spec.videoFilters, 'videoFilters');
    if (spec.width !== undefined || spec.height !== undefined) {
      const width = dimension(spec.width, -2, 'width');
      const height = dimension(spec.height, -2, 'height');
      const scaler = enumValue(spec.scaler, 'bicubic', SCALERS, 'scaler');
      let scale = `scale=${width}:${height}:flags=${scaler}`;
      const aspect = enumValue(spec.aspectRatio, 'disable', new Set(['disable', 'decrease', 'increase']), 'aspectRatio');
      if (aspect !== 'disable') scale += `:force_original_aspect_ratio=${aspect}`;
      videoFilters.unshift(scale);
    }
    if (spec.fps !== undefined) videoFilters.push(`fps=${rational(spec.fps, undefined, 'fps')}`);
    if (videoCodec === 'copy' && videoFilters.length) fail('videoFilters', 'cannot be used with stream-copy video');
    if (videoFilters.length) args.push('-vf', videoFilters.join(','));
    const audioFilters = filterList(spec.audioFilters, 'audioFilters');
    if (audioCodec === 'copy' && audioFilters.length) fail('audioFilters', 'cannot be used with stream-copy audio');
    if (audioFilters.length) args.push('-af', audioFilters.join(','));

    if (videoCodec === 'none') args.push('-vn');
    else {
      args.push('-c:v', videoCodec);
      if (videoCodec !== 'copy') {
        if (spec.crf !== undefined) args.push('-crf', String(number(spec.crf, undefined, 0, 63, 'crf', true)));
        if (spec.preset !== undefined) args.push('-preset', enumValue(spec.preset, undefined, PRESETS, 'preset'));
        if (spec.tune !== undefined && spec.tune !== 'none') args.push('-tune', enumValue(spec.tune, undefined, TUNES, 'tune'));
        if (spec.profile !== undefined && spec.profile !== 'auto') args.push('-profile:v', token(spec.profile, 'profile'));
        if (spec.level !== undefined && spec.level !== 'auto') args.push('-level:v', token(spec.level, 'level'));
        if (spec.pixelFormat !== undefined) args.push('-pix_fmt', token(spec.pixelFormat, 'pixelFormat'));
        const videoBitrate = bitrate(spec.videoBitrate, undefined, 'videoBitrate');
        if (videoBitrate) args.push('-b:v', videoBitrate);
      }
    }
    if (audioCodec === 'none') args.push('-an');
    else {
      args.push('-c:a', audioCodec);
      const audioBitrate = bitrate(spec.audioBitrate, undefined, 'audioBitrate');
      if (audioBitrate && audioCodec !== 'copy') args.push('-b:a', audioBitrate);
    }
    if (boolean(spec.faststart, false, 'faststart')) args.push('-movflags', '+faststart');
    if (boolean(spec.shortest, false, 'shortest')) args.push('-shortest');
    if (spec.threads !== undefined) args.push('-threads', String(number(spec.threads, undefined, 1, 256, 'threads', true)));
    args.push(output);
    return freezeArgv(args);
  }

  const TRIM_KEYS = new Set(['input', 'output', 'overwrite', 'progress', 'start', 'end', 'duration', 'mode', 'videoCodec', 'audioCodec', 'crf', 'preset', 'avoidNegativeTs', 'maps']);
  function trim(inputSpec) {
    const spec = object(inputSpec, 'trim', TRIM_KEYS);
    const input = localPath(spec.input, 'input');
    const output = outputPath(spec.output, 'output', false);
    const start = timeValue(spec.start, 'start', true);
    const end = timeValue(spec.end, 'end', true);
    const duration = timeValue(spec.duration, 'duration', true);
    if (end === undefined && duration === undefined) fail('trim', 'requires end or duration');
    if (end !== undefined && duration !== undefined) fail('trim', 'accepts end or duration, not both');
    if (start !== undefined && end !== undefined && timeAsSeconds(end) <= timeAsSeconds(start)) fail('end', 'must be later than start');
    const args = commonArgs(spec);
    if (start !== undefined) args.push('-ss', start);
    args.push('-i', input);
    if (end !== undefined) args.push('-to', end);
    else args.push('-t', duration);
    addMaps(args, spec.maps);
    const mode = enumValue(spec.mode, 'copy', new Set(['copy', 'reencode']), 'mode');
    if (mode === 'copy') args.push('-c', 'copy');
    else {
      const videoCodec = codec(spec.videoCodec, 'libx264', VIDEO_CODECS, 'videoCodec', false);
      const audioCodec = codec(spec.audioCodec, 'aac', AUDIO_CODECS, 'audioCodec', false);
      args.push('-c:v', videoCodec, '-c:a', audioCodec);
      if (spec.crf !== undefined && videoCodec !== 'copy') args.push('-crf', String(number(spec.crf, undefined, 0, 63, 'crf', true)));
      if (spec.preset !== undefined && videoCodec !== 'copy') args.push('-preset', enumValue(spec.preset, undefined, PRESETS, 'preset'));
    }
    const avoidNegativeTs = enumValue(spec.avoidNegativeTs, 'make_zero', new Set(['disabled', 'make_non_negative', 'make_zero', 'auto']), 'avoidNegativeTs');
    if (avoidNegativeTs !== 'disabled') args.push('-avoid_negative_ts', avoidNegativeTs);
    args.push(output);
    return freezeArgv(args);
  }

  const FILTERGRAPH_KEYS = new Set(['input', 'output', 'overwrite', 'progress', 'start', 'duration', 'maps', 'videoGraph', 'audioGraph', 'complexGraph', 'videoCodec', 'audioCodec', 'crf', 'preset', 'audioBitrate', 'pixelFormat', 'shortest']);
  function filtergraph(inputSpec) {
    const spec = object(inputSpec, 'filtergraph', FILTERGRAPH_KEYS);
    const graphCount = [spec.videoGraph, spec.audioGraph, spec.complexGraph].filter((entry) => entry !== undefined).length;
    if (!graphCount) fail('filtergraph', 'requires videoGraph, audioGraph, or complexGraph');
    if (spec.complexGraph !== undefined && (spec.videoGraph !== undefined || spec.audioGraph !== undefined)) fail('filtergraph', 'complexGraph cannot be combined with videoGraph or audioGraph');
    const args = commonArgs(spec);
    addTimingBeforeInput(args, spec);
    args.push('-i', localPath(spec.input, 'input'));
    addTimingAfterInput(args, spec);
    if (spec.complexGraph !== undefined) args.push('-filter_complex', filter(spec.complexGraph, 'complexGraph'));
    if (spec.videoGraph !== undefined) args.push('-vf', filter(spec.videoGraph, 'videoGraph'));
    if (spec.audioGraph !== undefined) args.push('-af', filter(spec.audioGraph, 'audioGraph'));
    addMaps(args, spec.maps);
    const videoCodec = codec(spec.videoCodec, 'libx264', VIDEO_CODECS, 'videoCodec', true);
    const audioCodec = codec(spec.audioCodec, 'aac', AUDIO_CODECS, 'audioCodec', true);
    if (videoCodec === 'none' && audioCodec === 'none') fail('codecs', 'at least one output stream must be enabled');
    if (videoCodec === 'copy' && (spec.videoGraph !== undefined || spec.complexGraph !== undefined)) fail('videoCodec', 'cannot copy video while applying a video or complex filtergraph');
    if (audioCodec === 'copy' && (spec.audioGraph !== undefined || spec.complexGraph !== undefined)) fail('audioCodec', 'cannot copy audio while applying an audio or complex filtergraph');
    if (videoCodec === 'none') args.push('-vn');
    else args.push('-c:v', videoCodec);
    if (audioCodec === 'none') args.push('-an');
    else args.push('-c:a', audioCodec);
    if (spec.crf !== undefined && !['none', 'copy'].includes(videoCodec)) args.push('-crf', String(number(spec.crf, undefined, 0, 63, 'crf', true)));
    if (spec.preset !== undefined && !['none', 'copy'].includes(videoCodec)) args.push('-preset', enumValue(spec.preset, undefined, PRESETS, 'preset'));
    if (spec.audioBitrate !== undefined && !['none', 'copy'].includes(audioCodec)) args.push('-b:a', bitrate(spec.audioBitrate, undefined, 'audioBitrate'));
    if (spec.pixelFormat !== undefined && videoCodec !== 'none') args.push('-pix_fmt', token(spec.pixelFormat, 'pixelFormat'));
    if (boolean(spec.shortest, false, 'shortest')) args.push('-shortest');
    args.push(outputPath(spec.output, 'output', false));
    return freezeArgv(args);
  }

  const LOUDNORM_KEYS = new Set(['input', 'output', 'overwrite', 'progress', 'phase', 'stream', 'integrated', 'lra', 'truePeak', 'linear', 'dualMono', 'measurements', 'audioCodec', 'audioBitrate', 'sampleRate']);
  function loudnormFilter(spec, measurements, printFormat) {
    const values = [
      `I=${number(spec.integrated, -16, -70, -5, 'integrated', false)}`,
      `LRA=${number(spec.lra, 11, 1, 50, 'lra', false)}`,
      `TP=${number(spec.truePeak, -1.5, -9, 0, 'truePeak', false)}`,
    ];
    if (measurements) {
      const measured = object(measurements, 'measurements', new Set(['inputI', 'inputLra', 'inputTp', 'inputThresh', 'targetOffset']));
      values.push(
        `measured_I=${requiredNumber(measured.inputI, -99, 0, 'measurements.inputI', false)}`,
        `measured_LRA=${requiredNumber(measured.inputLra, 0, 99, 'measurements.inputLra', false)}`,
        `measured_TP=${requiredNumber(measured.inputTp, -99, 99, 'measurements.inputTp', false)}`,
        `measured_thresh=${requiredNumber(measured.inputThresh, -99, 0, 'measurements.inputThresh', false)}`,
        `offset=${requiredNumber(measured.targetOffset, -99, 99, 'measurements.targetOffset', false)}`,
      );
    }
    values.push(`linear=${boolean(spec.linear, true, 'linear') ? 'true' : 'false'}`);
    values.push(`dual_mono=${boolean(spec.dualMono, false, 'dualMono') ? 'true' : 'false'}`);
    values.push(`print_format=${printFormat}`);
    return `loudnorm=${values.join(':')}`;
  }

  function loudnormAnalysis(inputSpec) {
    const spec = object(inputSpec, 'loudnormAnalysis', LOUDNORM_KEYS);
    if (spec.phase !== undefined && spec.phase !== 'analysis') fail('phase', 'must be analysis');
    if (spec.output !== undefined) fail('output', 'is not used by the analysis pass');
    if (spec.measurements !== undefined) fail('measurements', 'are not accepted by the analysis pass');
    const args = commonArgs(spec);
    args.push('-i', localPath(spec.input, 'input'));
    args.push('-map', streamSelector(spec.stream, '0:a:0', 'stream'));
    args.push('-vn', '-sn', '-dn', '-af', loudnormFilter(spec, null, 'json'), '-f', 'null', '-');
    return freezeArgv(args);
  }

  function loudnormApply(inputSpec) {
    const spec = object(inputSpec, 'loudnormApply', LOUDNORM_KEYS);
    if (spec.phase !== undefined && !['apply', 'single'].includes(spec.phase)) fail('phase', 'must be apply or single');
    const phase = spec.phase || 'apply';
    if (phase === 'apply' && spec.measurements === undefined) fail('measurements', 'are required for the apply pass');
    if (phase === 'single' && spec.measurements !== undefined) fail('measurements', 'are not accepted by a single pass');
    const args = commonArgs(spec);
    args.push('-i', localPath(spec.input, 'input'));
    args.push('-map', streamSelector(spec.stream, '0:a:0', 'stream'), '-vn', '-sn', '-dn');
    args.push('-af', loudnormFilter(spec, phase === 'apply' ? spec.measurements : null, 'summary'));
    const audioCodec = codec(spec.audioCodec, 'aac', AUDIO_CODECS, 'audioCodec', false);
    if (audioCodec === 'copy') fail('audioCodec', 'cannot use stream copy while applying loudnorm');
    args.push('-c:a', audioCodec);
    if (spec.audioBitrate !== undefined && audioCodec !== 'copy') args.push('-b:a', bitrate(spec.audioBitrate, undefined, 'audioBitrate'));
    if (spec.sampleRate !== undefined) args.push('-ar', String(number(spec.sampleRate, undefined, 8000, 384000, 'sampleRate', true)));
    args.push(outputPath(spec.output, 'output', false));
    return freezeArgv(args);
  }

  function loudnorm(inputSpec) {
    const spec = object(inputSpec, 'loudnorm', LOUDNORM_KEYS);
    const phase = enumValue(spec.phase, 'apply', new Set(['analysis', 'apply', 'single']), 'phase');
    return phase === 'analysis' ? loudnormAnalysis(spec) : loudnormApply(spec);
  }

  const EXTRACT_KEYS = new Set(['input', 'overwrite', 'progress', 'streams']);
  const EXTRACT_STREAM_KEYS = new Set(['selector', 'output', 'codec', 'bitrate', 'sampleRate', 'channels']);
  function extract(inputSpec) {
    const spec = object(inputSpec, 'extract', EXTRACT_KEYS);
    if (!Array.isArray(spec.streams) || spec.streams.length < 1 || spec.streams.length > 64) fail('streams', 'must contain 1 to 64 output stream definitions');
    const args = commonArgs(spec);
    args.push('-i', localPath(spec.input, 'input'));
    const destinations = new Set();
    spec.streams.forEach((entry, index) => {
      const stream = object(entry, `streams[${index}]`, EXTRACT_STREAM_KEYS);
      const destination = outputPath(stream.output, `streams[${index}].output`, false);
      const destinationKey = destination.toLocaleLowerCase('en-US');
      if (destinations.has(destinationKey)) fail(`streams[${index}].output`, 'duplicates another destination');
      destinations.add(destinationKey);
      const audioCodec = codec(stream.codec, 'copy', AUDIO_CODECS, `streams[${index}].codec`, false);
      args.push('-map', streamSelector(stream.selector, `0:a:${index}`, `streams[${index}].selector`));
      args.push('-vn', '-sn', '-dn', '-c:a', audioCodec);
      if (stream.bitrate !== undefined && audioCodec !== 'copy') args.push('-b:a', bitrate(stream.bitrate, undefined, `streams[${index}].bitrate`));
      if (stream.sampleRate !== undefined) args.push('-ar', String(number(stream.sampleRate, undefined, 8000, 384000, `streams[${index}].sampleRate`, true)));
      if (stream.channels !== undefined) args.push('-ac', String(number(stream.channels, undefined, 1, 32, `streams[${index}].channels`, true)));
      args.push(destination);
    });
    return freezeArgv(args);
  }

  const GIF_KEYS = new Set(['input', 'output', 'overwrite', 'progress', 'start', 'duration', 'fps', 'width', 'height', 'scaler', 'maxColors', 'statsMode', 'dither', 'bayerScale', 'loop']);
  function gif(inputSpec) {
    const spec = object(inputSpec, 'gif', GIF_KEYS);
    const args = commonArgs(spec);
    addTimingBeforeInput(args, spec);
    args.push('-i', localPath(spec.input, 'input'));
    addTimingAfterInput(args, spec);
    const fps = rational(spec.fps, '15', 'fps');
    const width = dimension(spec.width, 480, 'width');
    const height = dimension(spec.height, -2, 'height');
    const scaler = enumValue(spec.scaler, 'lanczos', SCALERS, 'scaler');
    const maxColors = number(spec.maxColors, 256, 4, 256, 'maxColors', true);
    const statsMode = enumValue(spec.statsMode, 'full', new Set(['full', 'diff', 'single']), 'statsMode');
    const dither = enumValue(spec.dither, 'sierra2_4a', new Set(['none', 'bayer', 'heckbert', 'floyd_steinberg', 'sierra2', 'sierra2_4a']), 'dither');
    const bayerScale = number(spec.bayerScale, 2, 0, 5, 'bayerScale', true);
    const paletteUse = dither === 'bayer' ? `paletteuse=dither=bayer:bayer_scale=${bayerScale}` : `paletteuse=dither=${dither}`;
    const graph = `fps=${fps},scale=${width}:${height}:flags=${scaler},split[v0][v1];[v0]palettegen=max_colors=${maxColors}:stats_mode=${statsMode}[p];[v1][p]${paletteUse}`;
    args.push('-filter_complex', graph, '-loop', String(number(spec.loop, 0, -1, 65535, 'loop', true)));
    args.push(outputPath(spec.output, 'output', false));
    return freezeArgv(args);
  }

  const THUMBNAIL_KEYS = new Set(['input', 'outputPattern', 'overwrite', 'progress', 'start', 'duration', 'mode', 'intervalSeconds', 'batchSize', 'fps', 'width', 'height', 'scaler', 'count', 'quality']);
  function thumbnails(inputSpec) {
    const spec = object(inputSpec, 'thumbnails', THUMBNAIL_KEYS);
    const outputPattern = outputPath(spec.outputPattern, 'outputPattern', true);
    const count = spec.count === undefined ? undefined : number(spec.count, undefined, 1, 1000000, 'count', true);
    if (count !== 1 && !/%(?:\d+)?d/u.test(outputPattern)) fail('outputPattern', 'must include a %d sequence placeholder when producing multiple files');
    const args = commonArgs(spec);
    addTimingBeforeInput(args, spec);
    args.push('-i', localPath(spec.input, 'input'));
    addTimingAfterInput(args, spec);
    const mode = enumValue(spec.mode, 'interval', new Set(['interval', 'iframes', 'thumbnail', 'fps']), 'mode');
    const filters = [];
    if (mode === 'interval') filters.push(`fps=1/${number(spec.intervalSeconds, 60, 0.001, 86400, 'intervalSeconds', false)}`);
    if (mode === 'iframes') filters.push("select='eq(pict_type\\,I)'");
    if (mode === 'thumbnail') filters.push(`thumbnail=${number(spec.batchSize, 100, 2, 10000, 'batchSize', true)}`);
    if (mode === 'fps') filters.push(`fps=${rational(spec.fps, '1', 'fps')}`);
    if (spec.width !== undefined || spec.height !== undefined) {
      filters.push(`scale=${dimension(spec.width, -2, 'width')}:${dimension(spec.height, -2, 'height')}:flags=${enumValue(spec.scaler, 'lanczos', SCALERS, 'scaler')}`);
    }
    args.push('-vf', filters.join(','), '-vsync', 'vfr');
    if (count !== undefined) args.push('-frames:v', String(count));
    if (spec.quality !== undefined) args.push('-q:v', String(number(spec.quality, undefined, 1, 31, 'quality', true)));
    args.push(outputPattern);
    return freezeArgv(args);
  }

  const HLS_KEYS = new Set(['input', 'output', 'overwrite', 'progress', 'start', 'duration', 'hlsTime', 'listSize', 'segmentType', 'flags', 'segmentFilename', 'masterPlaylist', 'initFilename', 'videoCodec', 'audioCodec', 'videoBitrate', 'audioBitrate', 'crf', 'preset', 'gop', 'fps', 'width', 'height', 'scaler', 'variants']);
  const HLS_VARIANT_KEYS = new Set(['name', 'width', 'height', 'videoCodec', 'audioCodec', 'videoBitrate', 'audioBitrate', 'maxRate', 'bufferSize', 'crf', 'preset', 'fps']);
  function appendHlsOptions(args, spec, hasVariants) {
    args.push('-f', 'hls');
    args.push('-hls_time', String(number(spec.hlsTime, 6, 0.1, 86400, 'hlsTime', false)));
    args.push('-hls_list_size', String(number(spec.listSize, 0, 0, 1000000, 'listSize', true)));
    args.push('-hls_segment_type', enumValue(spec.segmentType, 'mpegts', new Set(['mpegts', 'fmp4']), 'segmentType'));
    const flags = uniqueStrings(spec.flags, 'flags', HLS_FLAGS, HLS_FLAGS.size);
    if (flags.length) args.push('-hls_flags', flags.join('+'));
    if (spec.segmentFilename !== undefined) {
      const pattern = outputPath(spec.segmentFilename, 'segmentFilename', true);
      if (hasVariants && !pattern.includes('%v')) fail('segmentFilename', 'must include %v for multiple variants');
      args.push('-hls_segment_filename', pattern);
    }
    if (spec.masterPlaylist !== undefined) args.push('-master_pl_name', token(spec.masterPlaylist, 'masterPlaylist', { allowLeadingDash: false }));
    if (spec.initFilename !== undefined) {
      const initFilename = token(spec.initFilename, 'initFilename', { allowLeadingDash: false });
      if (hasVariants && !initFilename.includes('%v')) fail('initFilename', 'must include %v for multiple variants');
      args.push('-hls_fmp4_init_filename', initFilename);
    }
  }

  function appendVideoAudioEncoding(args, spec, suffix) {
    const videoCodec = codec(spec.videoCodec, 'libx264', VIDEO_CODECS, 'videoCodec', false);
    const audioCodec = codec(spec.audioCodec, 'aac', AUDIO_CODECS, 'audioCodec', false);
    const videoSuffix = suffix === undefined ? '' : `:${suffix}`;
    const audioSuffix = suffix === undefined ? '' : `:${suffix}`;
    args.push(`-c:v${videoSuffix}`, videoCodec, `-c:a${audioSuffix}`, audioCodec);
    if (spec.videoBitrate !== undefined && videoCodec !== 'copy') args.push(`-b:v${videoSuffix}`, bitrate(spec.videoBitrate, undefined, 'videoBitrate'));
    if (spec.audioBitrate !== undefined && audioCodec !== 'copy') args.push(`-b:a${audioSuffix}`, bitrate(spec.audioBitrate, undefined, 'audioBitrate'));
    if (spec.crf !== undefined && videoCodec !== 'copy') args.push(`-crf${videoSuffix}`, String(number(spec.crf, undefined, 0, 63, 'crf', true)));
    if (spec.preset !== undefined && videoCodec !== 'copy') args.push(`-preset${videoSuffix}`, enumValue(spec.preset, undefined, PRESETS, 'preset'));
    if (spec.gop !== undefined && videoCodec !== 'copy') args.push(`-g${videoSuffix}`, String(number(spec.gop, undefined, 1, 1000000, 'gop', true)));
  }

  function hls(inputSpec) {
    const spec = object(inputSpec, 'hls', HLS_KEYS);
    const output = outputPath(spec.output, 'output', false);
    const args = commonArgs(spec);
    addTimingBeforeInput(args, spec);
    args.push('-i', localPath(spec.input, 'input'));
    addTimingAfterInput(args, spec);
    const variants = spec.variants;
    if (variants !== undefined) {
      if (!Array.isArray(variants) || variants.length < 2 || variants.length > 8) fail('variants', 'must contain 2 to 8 variant definitions');
      if (!output.includes('%v')) fail('output', 'must include %v for multiple variants');
      const names = new Set();
      const splitInputs = variants.map((_, index) => `[v${index}in]`).join('');
      const graph = [`[0:v]split=${variants.length}${splitInputs}`];
      const varMap = [];
      variants.forEach((entry, index) => {
        const variant = object(entry, `variants[${index}]`, HLS_VARIANT_KEYS);
        const name = token(variant.name, `variants[${index}].name`, { allowLeadingDash: false, maxLength: 64 });
        if (!/^[A-Za-z0-9_][A-Za-z0-9_-]*$/u.test(name)) fail(`variants[${index}].name`, 'must use letters, numbers, underscores, or hyphens');
        if (names.has(name)) fail(`variants[${index}].name`, 'must be unique');
        names.add(name);
        const width = dimension(variant.width, undefined, `variants[${index}].width`);
        if (width === undefined) fail(`variants[${index}].width`, 'is required');
        const height = dimension(variant.height, -2, `variants[${index}].height`);
        const scaler = enumValue(spec.scaler, 'lanczos', SCALERS, 'scaler');
        let scale = `[v${index}in]scale=${width}:${height}:flags=${scaler}`;
        if (variant.fps !== undefined) scale += `,fps=${rational(variant.fps, undefined, `variants[${index}].fps`)}`;
        graph.push(`${scale}[v${index}out]`);
        args.push('-map', `[v${index}out]`, '-map', '0:a:0?');
        appendVideoAudioEncoding(args, {
          videoCodec: variant.videoCodec,
          audioCodec: variant.audioCodec,
          videoBitrate: variant.videoBitrate,
          audioBitrate: variant.audioBitrate,
          crf: variant.crf,
          preset: variant.preset,
          gop: spec.gop,
        }, index);
        if (variant.maxRate !== undefined) args.push(`-maxrate:v:${index}`, bitrate(variant.maxRate, undefined, `variants[${index}].maxRate`));
        if (variant.bufferSize !== undefined) args.push(`-bufsize:v:${index}`, bitrate(variant.bufferSize, undefined, `variants[${index}].bufferSize`));
        varMap.push(`v:${index},a:${index},name:${name}`);
      });
      args.splice(args.indexOf('-map'), 0, '-filter_complex', graph.join(';'));
      args.push('-var_stream_map', varMap.join(' '));
      appendHlsOptions(args, spec, true);
    } else {
      if (spec.width !== undefined || spec.height !== undefined || spec.fps !== undefined) {
        const filters = [];
        if (spec.width !== undefined || spec.height !== undefined) filters.push(`scale=${dimension(spec.width, -2, 'width')}:${dimension(spec.height, -2, 'height')}:flags=${enumValue(spec.scaler, 'lanczos', SCALERS, 'scaler')}`);
        if (spec.fps !== undefined) filters.push(`fps=${rational(spec.fps, undefined, 'fps')}`);
        args.push('-vf', filters.join(','));
      }
      appendVideoAudioEncoding(args, spec);
      appendHlsOptions(args, spec, false);
    }
    args.push(output);
    return freezeArgv(args);
  }

  const STREAM_KEYS = new Set(['input', 'target', 'overwrite', 'progress', 'start', 'duration', 'format', 'videoCodec', 'audioCodec', 'videoBitrate', 'audioBitrate', 'crf', 'preset', 'gop', 'fps', 'width', 'height', 'scaler', 'realtime', 'lowLatency']);
  function stream(inputSpec) {
    const spec = object(inputSpec, 'stream', STREAM_KEYS);
    const target = token(spec.target, 'target', { allowLeadingDash: false, maxLength: MAX_PATH_LENGTH });
    let url;
    try { url = new URL(target); } catch { fail('target', 'must be an absolute streaming URL'); }
    if (!STREAM_PROTOCOLS.has(url.protocol)) fail('target', `protocol ${url.protocol || '(none)'} is not supported`);
    if (url.username || url.password) fail('target', 'must not embed credentials');
    for (const name of url.searchParams.keys()) {
      if (/^(?:passphrase|password|token|key)$/iu.test(name)) fail('target', 'must not embed secret query parameters');
    }
    const args = commonArgs(spec);
    if (boolean(spec.realtime, false, 'realtime')) args.push('-re');
    addTimingBeforeInput(args, spec);
    args.push('-i', localPath(spec.input, 'input'));
    addTimingAfterInput(args, spec);
    const filters = [];
    if (spec.width !== undefined || spec.height !== undefined) filters.push(`scale=${dimension(spec.width, -2, 'width')}:${dimension(spec.height, -2, 'height')}:flags=${enumValue(spec.scaler, 'lanczos', SCALERS, 'scaler')}`);
    if (spec.fps !== undefined) filters.push(`fps=${rational(spec.fps, undefined, 'fps')}`);
    if (filters.length) args.push('-vf', filters.join(','));
    appendVideoAudioEncoding(args, spec);
    if (boolean(spec.lowLatency, false, 'lowLatency')) args.push('-tune', 'zerolatency', '-fflags', 'nobuffer');
    const inferredFormat = ['rtmp:', 'rtmps:'].includes(url.protocol) ? 'flv' : url.protocol === 'rtsp:' ? 'rtsp' : 'mpegts';
    const format = enumValue(spec.format, inferredFormat, new Set(['flv', 'mpegts', 'rtsp']), 'format');
    args.push('-f', format, target);
    return freezeArgv(args);
  }

  const OPTION_KEYS = new Set(['name', 'value']);
  const COMPOSER_INPUT_KEYS = new Set(['source', 'options']);
  const COMPOSER_OUTPUT_KEYS = new Set(['target', 'options']);
  const COMPOSER_KEYS = new Set(['overwrite', 'progress', 'globalOptions', 'inputs', 'outputs']);
  function appendStructuredOptions(args, entries, field) {
    if (entries === undefined) return;
    if (!Array.isArray(entries) || entries.length > MAX_COLLECTION_LENGTH) fail(field, `must be an array of at most ${MAX_COLLECTION_LENGTH} option entries`);
    entries.forEach((entry, index) => {
      const option = object(entry, `${field}[${index}]`, OPTION_KEYS);
      const name = token(option.name, `${field}[${index}].name`);
      if (!/^-{1,2}[A-Za-z0-9][A-Za-z0-9_.:+-]{0,127}$/u.test(name)) fail(`${field}[${index}].name`, 'must be one FFmpeg option name');
      if (COMPOSER_BLOCKED_OPTIONS.has(name)) fail(`${field}[${index}].name`, 'is managed by the runtime and cannot be overridden');
      if (option.value === false || option.value === undefined || option.value === null) return;
      args.push(name);
      if (option.value !== true) {
        if (Array.isArray(option.value) || isPlainObject(option.value)) fail(`${field}[${index}].value`, 'must be a scalar token');
        args.push(token(option.value, `${field}[${index}].value`));
      }
    });
  }

  function composer(inputSpec) {
    const spec = object(inputSpec, 'composer', COMPOSER_KEYS);
    if (!Array.isArray(spec.inputs) || spec.inputs.length < 1 || spec.inputs.length > 32) fail('inputs', 'must contain 1 to 32 structured inputs');
    if (!Array.isArray(spec.outputs) || spec.outputs.length < 1 || spec.outputs.length > 32) fail('outputs', 'must contain 1 to 32 structured outputs');
    const args = commonArgs(spec);
    appendStructuredOptions(args, spec.globalOptions, 'globalOptions');
    spec.inputs.forEach((entry, index) => {
      const input = object(entry, `inputs[${index}]`, COMPOSER_INPUT_KEYS);
      appendStructuredOptions(args, input.options, `inputs[${index}].options`);
      args.push('-i', localPath(input.source, `inputs[${index}].source`));
    });
    const destinations = new Set();
    spec.outputs.forEach((entry, index) => {
      const output = object(entry, `outputs[${index}]`, COMPOSER_OUTPUT_KEYS);
      appendStructuredOptions(args, output.options, `outputs[${index}].options`);
      const destination = outputPath(output.target, `outputs[${index}].target`, true);
      const key = destination.toLocaleLowerCase('en-US');
      if (destinations.has(key)) fail(`outputs[${index}].target`, 'duplicates another output');
      destinations.add(key);
      args.push(destination);
    });
    return freezeArgv(args);
  }

  const CONVERTER_KEYS = new Set(['input', 'output', 'adapter', 'overwrite', 'progress', 'start', 'duration', 'crf', 'quality', 'videoBitrate', 'audioBitrate', 'sampleRate', 'channels', 'width', 'height']);
  const ADAPTERS = Object.freeze({
    'video/mp4-h264-aac': Object.freeze({ category: 'Video', extension: 'mp4', videoCodec: 'libx264', audioCodec: 'aac', faststart: true }),
    'video/mkv-copy': Object.freeze({ category: 'Video', extension: 'mkv', videoCodec: 'copy', audioCodec: 'copy' }),
    'video/webm-vp9-opus': Object.freeze({ category: 'Video', extension: 'webm', videoCodec: 'libvpx-vp9', audioCodec: 'libopus' }),
    'audio/flac': Object.freeze({ category: 'Audio', extension: 'flac', videoCodec: 'none', audioCodec: 'flac' }),
    'audio/wav-pcm-s24le': Object.freeze({ category: 'Audio', extension: 'wav', videoCodec: 'none', audioCodec: 'pcm_s24le' }),
    'audio/mp3': Object.freeze({ category: 'Audio', extension: 'mp3', videoCodec: 'none', audioCodec: 'libmp3lame' }),
    'audio/opus': Object.freeze({ category: 'Audio', extension: 'opus', videoCodec: 'none', audioCodec: 'libopus' }),
    'image/png': Object.freeze({ category: 'Images', extension: 'png', videoCodec: 'none', audioCodec: 'none', imageCodec: 'png' }),
    'image/jpeg': Object.freeze({ category: 'Images', extension: 'jpg', videoCodec: 'none', audioCodec: 'none', imageCodec: 'mjpeg' }),
  });

  function converter(inputSpec) {
    const spec = object(inputSpec, 'converter', CONVERTER_KEYS);
    const adapterId = token(spec.adapter, 'adapter');
    const adapter = ADAPTERS[adapterId];
    if (!adapter) fail('adapter', `is not bundled; available adapters: ${Object.keys(ADAPTERS).join(', ')}`);
    const output = outputPath(spec.output, 'output', false);
    const extension = output.split(/[\\/]/u).pop().split('.').pop().toLocaleLowerCase('en-US');
    const acceptedExtensions = adapter.extension === 'jpg' ? new Set(['jpg', 'jpeg']) : new Set([adapter.extension]);
    if (!acceptedExtensions.has(extension)) fail('output', `must use the .${adapter.extension} extension for ${adapterId}`);
    if (adapter.imageCodec) {
      for (const field of ['crf', 'videoBitrate', 'audioBitrate', 'sampleRate', 'channels']) {
        if (spec[field] !== undefined) fail(field, `is not supported by ${adapterId}`);
      }
      const args = commonArgs(spec);
      addTimingBeforeInput(args, spec);
      args.push('-i', localPath(spec.input, 'input'));
      addTimingAfterInput(args, spec);
      if (spec.width !== undefined || spec.height !== undefined) args.push('-vf', `scale=${dimension(spec.width, -2, 'width')}:${dimension(spec.height, -2, 'height')}:flags=lanczos`);
      args.push('-frames:v', '1', '-c:v', adapter.imageCodec);
      if (spec.quality !== undefined && adapter.imageCodec === 'mjpeg') args.push('-q:v', String(number(spec.quality, undefined, 1, 31, 'quality', true)));
      args.push(output);
      return freezeArgv(args);
    }
    if (spec.quality !== undefined) fail('quality', `is not supported by ${adapterId}`);
    if (adapter.videoCodec === 'none') {
      for (const field of ['crf', 'videoBitrate', 'width', 'height']) {
        if (spec[field] !== undefined) fail(field, `is not supported by ${adapterId}`);
      }
    }
    if (adapter.videoCodec === 'copy' || adapter.audioCodec === 'copy') {
      for (const field of ['crf', 'videoBitrate', 'audioBitrate', 'sampleRate', 'channels', 'width', 'height']) {
        if (spec[field] !== undefined) fail(field, `is not supported by the stream-copy adapter ${adapterId}`);
      }
    }
    return convert({
      input: spec.input,
      output,
      overwrite: spec.overwrite,
      progress: spec.progress,
      start: spec.start,
      duration: spec.duration,
      videoCodec: adapter.videoCodec,
      audioCodec: adapter.audioCodec,
      crf: spec.crf,
      videoBitrate: spec.videoBitrate,
      audioBitrate: spec.audioBitrate,
      faststart: adapter.faststart || false,
      width: spec.width,
      height: spec.height,
      audioFilters: spec.sampleRate === undefined && spec.channels === undefined ? undefined : [
        spec.sampleRate === undefined ? null : `aresample=${number(spec.sampleRate, undefined, 8000, 384000, 'sampleRate', true)}`,
        spec.channels === undefined ? null : (() => {
          const channels = number(spec.channels, undefined, 1, 8, 'channels', true);
          return `aformat=channel_layouts=${channels === 1 ? 'mono' : channels === 2 ? 'stereo' : `${channels}c`}`;
        })(),
      ].filter(Boolean),
    });
  }

  const BUILDERS = Object.freeze({ convert, trim, filtergraph, loudnorm, extract, gif, thumbnails, hls, stream, composer, converter });
  function build(kind, spec) {
    const name = token(kind, 'kind');
    const builder = BUILDERS[name];
    if (!builder) fail('kind', `must be one of: ${Object.keys(BUILDERS).join(', ')}`);
    return builder(spec);
  }

  const api = Object.freeze({
    version: API_VERSION,
    adapters: ADAPTERS,
    build,
    convert,
    trim,
    filtergraph,
    loudnorm,
    loudnormAnalysis,
    loudnormApply,
    extract,
    gif,
    thumbnails,
    hls,
    stream,
    composer,
    converter,
  });

  Object.defineProperty(root, 'FFmpegCommandBuilders', {
    configurable: false,
    enumerable: true,
    writable: false,
    value: api,
  });
}(typeof window === 'object' ? window : globalThis));
