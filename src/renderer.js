/* material-ffmpeg renderer — runtime state only; this process never executes a shell. */
'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const bounded = (value, max = 500) => String(value ?? '').slice(0, max);
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const displayPrivacy = window.DisplayPrivacy;
if (!displayPrivacy || typeof displayPrivacy.displayText !== 'function' || typeof displayPrivacy.displayValue !== 'function') {
  throw new Error('The renderer display-privacy boundary is unavailable.');
}
const displayText = (value, role = 'local file') => displayPrivacy.displayText(value, role);
const displayValue = (value, role = 'local file') => displayPrivacy.displayValue(value, role);
const HANDLE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const DERIVED_OUTPUT_MARKER = '__DERIVED_OUTPUT__';
const LOUDNORM_PENDING_KEY = 'material-ffmpeg.loudnorm-pending';
const LOUDNORM_PENDING_VERSION = 1;
const LOUDNORM_MAX_PENDING = 32;
const LOUDNORM_MAX_STORED_BYTES = 64 * 1024;
const LOUDNORM_MAX_LOG_LINES = 500;
const LOUDNORM_MAX_LOG_CHARS = 200000;
const LOUDNORM_CODECS = new Set(['flac', 'aac', 'libopus', 'pcm_s24le']);
const LOUDNORM_TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'interrupted']);
const loudnormEnqueueing = new Set();
const loudnormSessionId = (() => {
  const key = 'material-ffmpeg.loudnorm-session';
  try {
    const existing = sessionStorage.getItem(key);
    if (existing && HANDLE_RE.test(existing)) return existing;
    const created = crypto.randomUUID();
    sessionStorage.setItem(key, created);
    return created;
  } catch (_) { return crypto.randomUUID(); }
})();
const COMPOSER_TEXT_LIMIT = 8000;
const COMPOSER_PREVIEW_LIMIT = 12000;
const COMPOSER_OPTION_LIMIT = 120;
const COMPOSER_FORMATS = Object.freeze({
  mp4: { extension: 'mp4', extensions: ['mp4'], label: 'MP4 video' },
  matroska: { extension: 'mkv', extensions: ['mkv'], label: 'Matroska media' },
  webm: { extension: 'webm', extensions: ['webm'], label: 'WebM media' },
  mov: { extension: 'mov', extensions: ['mov'], label: 'QuickTime media' },
  mpegts: { extension: 'ts', extensions: ['ts', 'm2ts'], label: 'MPEG transport stream' },
  mp3: { extension: 'mp3', extensions: ['mp3'], label: 'MP3 audio' },
  flac: { extension: 'flac', extensions: ['flac'], label: 'FLAC audio' },
  wav: { extension: 'wav', extensions: ['wav'], label: 'WAV audio' },
  ogg: { extension: 'ogg', extensions: ['ogg', 'oga'], label: 'Ogg media' },
  opus: { extension: 'opus', extensions: ['opus'], label: 'Opus audio' },
  gif: { extension: 'gif', extensions: ['gif'], label: 'GIF image' },
  image2: { extension: 'png', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'], label: 'Single image' }
});
const MAX_CONVERTER_FILES = 64;
const CONVERTER_TARGETS = Object.freeze({
  mp4: Object.freeze({ adapter: 'video/mp4-h264-aac', label: 'MP4 (H.264 + AAC)', requirement: 'a video stream' }),
  mkv: Object.freeze({ adapter: 'video/mkv-copy', label: 'MKV (stream copy)', requirement: 'an audio or video stream' }),
  webm: Object.freeze({ adapter: 'video/webm-vp9-opus', label: 'WebM (VP9 + Opus)', requirement: 'a video stream' }),
  mp3: Object.freeze({ adapter: 'audio/mp3', label: 'MP3 audio', requirement: 'an audio stream' }),
  flac: Object.freeze({ adapter: 'audio/flac', label: 'FLAC audio', requirement: 'an audio stream' }),
  wav: Object.freeze({ adapter: 'audio/wav-pcm-s24le', label: 'WAV (24-bit PCM)', requirement: 'an audio stream' }),
  png: Object.freeze({ adapter: 'image/png', label: 'PNG still image', requirement: 'a video stream' }),
  jpg: Object.freeze({ adapter: 'image/jpeg', label: 'JPEG still image', requirement: 'a video stream' })
});
const store = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem(`material-ffmpeg.${key}`)) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(`material-ffmpeg.${key}`, JSON.stringify(value)); } catch { } }
};

const DEFAULT_TABS = [
  { id: 'overview', label: 'Overview', icon: 'dashboard', pinned: true, group: 'Home' },
  { id: 'convert', label: 'Convert', icon: 'sync_alt', pinned: false, group: 'Media' },
  { id: 'filters', label: 'Filtergraph', icon: 'account_tree', pinned: false, group: 'Media' },
  { id: 'jobs', label: 'Jobs & logs', icon: 'receipt_long', pinned: false, group: 'Home' }
];

const SUPPORTED_ICON_LIGATURES = new Set([
  'account_tree', 'bookmarks', 'check', 'check_circle', 'content_cut', 'dashboard', 'database',
  'developer_board', 'draft', 'east', 'error', 'folder_zip', 'gif_box', 'graphic_eq', 'grid_on',
  'info', 'keep', 'keyboard_command_key', 'lan', 'light_mode', 'memory', 'menu', 'movie',
  'notifications', 'open_in_full', 'output', 'podcasts', 'published_with_changes', 'receipt_long',
  'search_insights', 'settings', 'swap_horiz', 'sync_alt', 'tab', 'terminal', 'tune', 'upload_file',
  'videocam'
]);
const normalizeTabIcon = (value) => {
  const icon = String(value ?? '').trim();
  return SUPPORTED_ICON_LIGATURES.has(icon) ? icon : 'tab';
};
const normalizeTabs = (value) => (Array.isArray(value) ? value : DEFAULT_TABS).filter((tab) => tab && typeof tab === 'object').map((tab) => ({
  ...tab,
  icon: normalizeTabIcon(tab.icon)
}));

const FUNNY_LEVEL_DEFAULT = 5;
const AUDIO_EXTRACTION_FORMATS = Object.freeze({
  'mka-copy': Object.freeze({ label: 'Matroska audio · stream copy', extension: 'mka', codec: 'copy', bitrates: Object.freeze([]), defaultBitrate: '' }),
  m4a: Object.freeze({ label: 'M4A · AAC', extension: 'm4a', codec: 'aac', bitrates: Object.freeze(['96k', '128k', '192k', '256k', '320k']), defaultBitrate: '192k' }),
  mp3: Object.freeze({ label: 'MP3', extension: 'mp3', codec: 'libmp3lame', bitrates: Object.freeze(['96k', '128k', '192k', '256k', '320k']), defaultBitrate: '192k' }),
  opus: Object.freeze({ label: 'Ogg Opus', extension: 'opus', codec: 'libopus', bitrates: Object.freeze(['64k', '96k', '128k', '160k', '192k', '256k']), defaultBitrate: '128k' }),
  flac: Object.freeze({ label: 'FLAC · lossless', extension: 'flac', codec: 'flac', bitrates: Object.freeze([]), defaultBitrate: '' }),
  wav: Object.freeze({ label: 'WAV · 24-bit PCM', extension: 'wav', codec: 'pcm_s24le', bitrates: Object.freeze([]), defaultBitrate: '' })
});
const AUDIO_SAMPLE_RATES = Object.freeze(['source', '44100', '48000', '96000', '192000']);
const AUDIO_CHANNEL_COUNTS = Object.freeze(['source', '1', '2']);
const DEFAULT_SETTINGS = Object.freeze({
  parallel: 2,
  preferHardware: true,
  keepPassLogs: false,
  notifyComplete: true,
  englishFunny: FUNNY_LEVEL_DEFAULT,
  cantoneseFunny: FUNNY_LEVEL_DEFAULT
});
const normalizeFunnyLevel = (value) => {
  const level = Number(value);
  return Number.isInteger(level) && level >= 1 && level <= 5 ? level : FUNNY_LEVEL_DEFAULT;
};
const normalizeSettings = (value) => {
  const input = value && typeof value === 'object' ? value : {};
  return Object.assign({}, DEFAULT_SETTINGS, input, {
    parallel: clamp(input.parallel ?? DEFAULT_SETTINGS.parallel, 1, 4),
    preferHardware: input.preferHardware !== false,
    keepPassLogs: Boolean(input.keepPassLogs),
    notifyComplete: input.notifyComplete !== false,
    englishFunny: normalizeFunnyLevel(input.englishFunny),
    cantoneseFunny: normalizeFunnyLevel(input.cantoneseFunny)
  });
};

const filtergraphCatalog = window.FFmpegCommandBuilders?.filtergraphCatalog || {};
const filterDefinition = (kind, name) => filtergraphCatalog?.[kind]?.[name] || null;
const defaultFilterOptions = (kind, name) => Object.assign({}, filterDefinition(kind, name)?.defaults || {});
const legacyFilterOptions = (kind, name, value) => {
  if (typeof value !== 'string') return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const text = value.trim();
  let match;
  if (kind === 'video' && name === 'scale' && (match = /^(-?\d+):(-?\d+)(?::flags=([a-z_]+))?$/u.exec(text))) {
    return { width: Number(match[1]), height: Number(match[2]), flags: match[3] || 'lanczos' };
  }
  if (kind === 'video' && name === 'crop' && (match = /^(\d+):(\d+)(?::(\d+):(\d+))?$/u.exec(text))) {
    return { width: Number(match[1]), height: Number(match[2]), x: Number(match[3] || 0), y: Number(match[4] || 0) };
  }
  if (kind === 'video' && name === 'fps' && /^\d{1,6}(?:\/\d{1,6}|\.\d{1,6})?$/u.test(text)) return { rate: text };
  if (kind === 'audio' && name === 'atempo' && /^\d+(?:\.\d+)?$/u.test(text)) return { tempo: Number(text) };
  if (kind === 'audio' && name === 'loudnorm') {
    const values = Object.fromEntries(text.split(':').map((part) => part.split('=', 2)));
    if (values.I !== undefined && values.LRA !== undefined && values.TP !== undefined) {
      return { integrated: Number(values.I), lra: Number(values.LRA), truePeak: Number(values.TP) };
    }
  }
  return {};
};
const normalizeFilterNode = (value) => {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const inferredKind = ['loudnorm', 'atempo'].includes(source.name) ? 'audio' : 'video';
  const kind = source.kind === 'audio' || source.kind === 'video' ? source.kind : inferredKind;
  const names = Object.keys(filtergraphCatalog[kind] || {});
  const name = names.includes(source.name) ? source.name : names[0];
  const definition = filterDefinition(kind, name);
  const supplied = legacyFilterOptions(kind, name, source.options);
  const options = defaultFilterOptions(kind, name);
  for (const field of definition?.fields || []) {
    if (!Object.prototype.hasOwnProperty.call(supplied, field.key)) continue;
    if (field.type === 'checkbox') options[field.key] = Boolean(supplied[field.key]);
    else if (field.type === 'number') {
      const numeric = Number(supplied[field.key]);
      if (Number.isFinite(numeric)) options[field.key] = numeric;
    } else if (field.type === 'select') {
      if (field.values.includes(String(supplied[field.key]))) options[field.key] = String(supplied[field.key]);
    } else options[field.key] = bounded(supplied[field.key], field.maxLength || 200);
  }
  return { kind, name, options };
};
const normalizeFilters = (value) => {
  const nodes = Array.isArray(value) ? value.slice(0, 64).map(normalizeFilterNode) : [];
  return nodes.length ? nodes : [normalizeFilterNode({ kind: 'video', name: 'scale' })];
};

const state = {
  view: 'overview', theme: store.get('theme', 'dark'), logo: store.get('logo', { glyph: 'M', image: '' }),
  runtime: {
    available: false, loading: true, version: '', ffmpegVersion: '', ffprobeVersion: '',
    ffmpegVersionFull: '', ffprobeVersionFull: '', configuration: '', ffmpegAvailable: false,
    ffprobeAvailable: false, origin: '', locationMode: '', locationRootId: '', locationsChecked: 0,
    reasonId: '', error: ''
  }, runtimeCatalog: {},
  jobs: [], selectedJobs: new Set(), selectedJobId: '', queueError: '', queueConcurrency: 2,
  catalogs: {}, catalogErrors: {}, catalogLoading: {}, catalogMeta: {}, catalogQueries: {}, catalogRequestEpoch: {},
  inputs: {}, outputs: {}, probe: null, probeError: '', probeExportError: '', probeExportFormat: '',
  audioProbeError: '', audioStreams: [], audioInspecting: false, audioInspectionRequest: 0,
  filters: normalizeFilters(store.get('filters', [{ kind: 'video', name: 'scale', options: { width: 1920, height: -2, flags: 'lanczos' } }])), selectedFilter: 0,
  presets: store.get('presets', []), converterFiles: [], converterBusy: false, converterSummary: null,
  tabs: normalizeTabs(store.get('tabs', DEFAULT_TABS)),
  notifications: store.get('notifications', []),
  settings: normalizeSettings(store.get('settings', {})),
  loudnormPending: {}, loudnormRecoveryNotice: '', loudnormRecoveryPending: false,
  form: Object.assign({
    codec: 'libx264', container: 'mp4', crf: 20, preset: 'medium', tune: 'none', width: 1920, height: -2, fps: '',
    trimStart: '00:00:00.000', trimEnd: '', trimDuration: '00:00:10.000', trimMode: 'copy', trimContainer: 'mp4', avoidNegative: true,
    trimVideoCodec: 'libx264', trimAudioCodec: 'aac', trimCrf: 20, trimPreset: 'medium',
    loudness: -16, lra: 11, truePeak: -1.5, loudnormCodec: 'flac', audioCodec: 'copy', audioStream: '0:a:0',
    audioFormat: 'mka-copy', audioBitrate: '192k', audioSampleRate: 'source', audioChannels: 'source',
    gifStart: '00:00:00.000', gifDuration: '00:00:05.000', gifFps: 15, gifWidth: 640, gifHeight: -2,
    gifScaler: 'lanczos', gifColors: 128, gifStatsMode: 'full', gifDither: 'sierra2_4a', gifBayerScale: 2, gifLoop: 0,
    thumbTime: '00:00:00.000', thumbFormat: 'jpg', thumbWidth: 1280, thumbHeight: -2, thumbScaler: 'lanczos', thumbQuality: 2,
    streamMode: 'hls', streamTarget: '', hlsTime: 6, hlsList: 6, hlsPlaylistType: 'live', hlsSegmentType: 'mpegts',
    streamVideoBitrate: '4500k', streamAudioBitrate: '128k', streamResolution: 'source', streamFps: 'source', streamGop: 60,
    streamRealtime: true, streamLowLatency: true,
    composerFormat: 'mp4', composerGlobalArgs: '', composerInputArgs: '',
    composerArgs: '-c:v\nlibx264\n-c:a\naac', converterTarget: 'mp4'
  }, store.get('form', {}))
};
// Streaming URLs can contain deployment identifiers even when the UI refuses
// explicit credentials. Keep this field session-only and discard values saved
// by older versions before rendering the first view.
state.form.streamTarget = '';
if (!Object.hasOwn(COMPOSER_FORMATS, state.form.composerFormat)) state.form.composerFormat = 'mp4';

const normalizeAudioExtractionState = () => {
  if (!AUDIO_EXTRACTION_FORMATS[state.form.audioFormat]) state.form.audioFormat = 'mka-copy';
  const format = AUDIO_EXTRACTION_FORMATS[state.form.audioFormat];
  if (format.bitrates.length && !format.bitrates.includes(String(state.form.audioBitrate))) state.form.audioBitrate = format.defaultBitrate;
  if (!AUDIO_SAMPLE_RATES.includes(String(state.form.audioSampleRate))) state.form.audioSampleRate = 'source';
  if (!AUDIO_CHANNEL_COUNTS.includes(String(state.form.audioChannels))) state.form.audioChannels = 'source';
};
normalizeAudioExtractionState();

const saveUi = () => {
  store.set('theme', state.theme); store.set('logo', state.logo); store.set('tabs', state.tabs);
  store.set('presets', state.presets); store.set('filters', state.filters);
  store.set('settings', state.settings); store.set('form', Object.assign({}, state.form, { streamTarget: '' }));
};

const GROUPS = {
  overview: { title: 'Home', items: [['overview', 'dashboard', 'Overview'], ['jobs', 'receipt_long', 'Jobs & logs'], ['settings', 'settings', 'Settings']] },
  media: { title: 'Media', items: [['convert', 'sync_alt', 'Convert'], ['trim', 'content_cut', 'Trim & clip'], ['filters', 'account_tree', 'Filtergraph'], ['audio', 'graphic_eq', 'Audio'], ['gif', 'gif_box', 'GIF & thumbs'], ['presets', 'bookmarks', 'Presets'], ['inspector', 'search_insights', 'Inspector']] },
  registry: { title: 'Registry', items: [['codecs', 'memory', 'Codecs'], ['encoders', 'output', 'Encoders'], ['decoders', 'movie', 'Decoders'], ['formats', 'folder_zip', 'Formats'], ['filtersCatalog', 'account_tree', 'Filters'], ['protocols', 'lan', 'Protocols'], ['bsf', 'swap_horiz', 'Bitstream filters'], ['devices', 'videocam', 'Devices'], ['pixelFormats', 'grid_on', 'Pixel formats'], ['sampleFormats', 'graphic_eq', 'Sample formats'], ['channelLayouts', 'podcasts', 'Channel layouts'], ['matrix', 'grid_on', 'Capability matrix']] },
  system: { title: 'System', items: [['hwaccel', 'developer_board', 'Hardware accel'], ['streaming', 'podcasts', 'Streaming'], ['composer', 'terminal', 'Composer'], ['converter', 'published_with_changes', 'File converter']] }
};

const funnyPreview = (language, rawLevel) => {
  const level = normalizeFunnyLevel(rawLevel);
  const englishFact = 'Job failures show the exact exit status and recovery action.';
  const cantoneseFact = '工作失敗會顯示確實退出狀態同復原方法。';
  const englishVoice = [
    '',
    ' No mystery, no interpretive dance.',
    ' Even the codec gremlins leave a receipt.',
    ' The codec gremlins leave a receipt and tidy the cables.',
    ' Maximum mischief, zero missing facts: the codec gremlins file the receipt in triplicate.'
  ];
  const cantoneseVoice = [
    '',
    ' 唔使估估下，資料照單全收。',
    ' 編碼小精靈搞事都要留低收據。',
    ' 編碼小精靈搞完事，仲要執返好條線。',
    ' 玩到最盡都唔走數：編碼小精靈要交三份收據，少一張都唔得。'
  ];
  return language === 'cantonese' ? cantoneseFact + cantoneseVoice[level - 1] : englishFact + englishVoice[level - 1];
};
const RAIL = [['overview', 'dashboard', 'Home'], ['media', 'movie', 'Media'], ['registry', 'database', 'Registry'], ['system', 'developer_board', 'System']];
const CATALOG_KINDS = Object.freeze({
  codecs: 'codecs', encoders: 'encoders', decoders: 'decoders', formats: 'formats', filtersCatalog: 'filters',
  protocols: 'protocols', bsf: 'bsfs', devices: 'devices', pixelFormats: 'pixelFormats', sampleFormats: 'sampleFormats',
  channelLayouts: 'channelLayouts', hwaccel: 'hwaccels'
});
const CATALOG_KIND_SET = new Set(Object.values(CATALOG_KINDS));
const CATALOG_RESULT_LIMIT = 500;
const groupFor = (view) => Object.keys(GROUPS).find((key) => GROUPS[key].items.some((item) => item[0] === view)) || 'overview';

const apiCall = async (path, ...args) => {
  let target = window.api;
  for (const segment of path.split('.')) target = target?.[segment];
  if (typeof target !== 'function') throw new Error(`Runtime API unavailable: ${path}`);
  return target(...args);
};

const normalizeFiles = (result) => (Array.isArray(result) ? result : result ? [result] : []).slice(0, 500).map((item, index) => {
  if (!item || typeof item !== 'object' || Array.isArray(item) || !HANDLE_RE.test(String(item.handle || ''))) return null;
  const kind = item.kind === 'input' || item.kind === 'output' ? item.kind : '';
  if (!kind) return null;
  return {
    handle: String(item.handle),
    name: bounded(item.name || `Selected file ${index + 1}`, 240),
    kind,
    details: bounded(item.details || '', 300),
    supported: item.supported !== false
  };
}).filter(Boolean);

const currentConverterTarget = () => Object.hasOwn(CONVERTER_TARGETS, state.form.converterTarget) ? state.form.converterTarget : 'mp4';
const refreshConverterCompatibility = (file) => {
  const target = currentConverterTarget();
  const inspected = file.status === 'ready';
  file.supported = inspected && Array.isArray(file.supportedTargets) && file.supportedTargets.includes(target);
  file.statusLabel = file.status === 'inspection-failed' ? 'INSPECTION FAILED'
    : file.supported ? 'READY' : file.status === 'unsupported' ? 'UNSUPPORTED' : 'NOT COMPATIBLE';
  file.supportReason = file.supported || file.status === 'inspection-failed' || file.status === 'unsupported'
    ? ''
    : `${CONVERTER_TARGETS[target].label} requires ${CONVERTER_TARGETS[target].requirement}.`;
  return file;
};
const normalizeConverterItems = (value) => (Array.isArray(value) ? value : []).slice(0, MAX_CONVERTER_FILES).map((item, index) => {
  if (!item || typeof item !== 'object' || Array.isArray(item) || !HANDLE_RE.test(String(item.handle || '')) || item.kind !== 'input') return null;
  const supportedTargets = Array.isArray(item.supportedTargets)
    ? [...new Set(item.supportedTargets.filter((target) => Object.hasOwn(CONVERTER_TARGETS, target)))].slice(0, Object.keys(CONVERTER_TARGETS).length)
    : [];
  const status = ['ready', 'unsupported', 'inspection-failed'].includes(item.status) ? item.status : 'inspection-failed';
  return refreshConverterCompatibility({
    handle: String(item.handle),
    name: bounded(item.name || `Selected file ${index + 1}`, 240),
    kind: 'input',
    details: bounded(item.details || item.error || 'Media inspection returned no details.', 500),
    error: bounded(item.error || '', 500),
    status,
    supportedTargets,
    streams: item.streams && typeof item.streams === 'object' ? {
      video: clamp(item.streams.video, 0, 512),
      audio: clamp(item.streams.audio, 0, 512),
      subtitle: clamp(item.streams.subtitle, 0, 512)
    } : { video: 0, audio: 0, subtitle: 0 }
  });
}).filter(Boolean);

async function pickFile(slot, options = {}) {
  try {
    const files = normalizeFiles(await apiCall('files.open', options));
    if (slot && files.length) state.inputs[slot] = files[0];
    if (files.length) render();
    return files;
  } catch (error) { notify('File picker failed', error.message, 'error'); return []; }
}

async function chooseOutput(slot, options = {}) {
  try {
    const result = await apiCall('files.save', options);
    const file = normalizeFiles(result)[0];
    if (!file) return null;
    state.outputs[slot] = file; render(); return file;
  } catch (error) { notify('Output picker failed', error.message, 'error'); return null; }
}

const quotePreview = (arg) => /[\s"']/u.test(arg) ? `"${String(arg).replace(/["\\]/g, '\\$&')}"` : String(arg);
const commandPreview = (argv) => ['ffmpeg', ...(Array.isArray(argv) ? argv : [])].map((arg) => quotePreview(displayText(arg, 'selected file'))).join(' ');
const derivedOutput = (file, suffix) => {
  if (!file || file.kind !== 'output' || !HANDLE_RE.test(file.handle)) throw new Error('Choose a valid output destination first.');
  if (typeof suffix !== 'string' || !/^[A-Za-z0-9._%()=-]{1,180}$/u.test(suffix)) throw new Error('Derived output suffix is invalid.');
  return `${file.handle}${DERIVED_OUTPUT_MARKER}${suffix}`;
};
const splitDerivedOutput = (value) => {
  if (typeof value !== 'string') return null;
  const marker = value.indexOf(DERIVED_OUTPUT_MARKER);
  if (marker < 0) return null;
  const handle = value.slice(0, marker), suffix = value.slice(marker + DERIVED_OUTPUT_MARKER.length);
  return HANDLE_RE.test(handle) && /^[A-Za-z0-9._%()=-]{1,180}$/u.test(suffix) ? { handle, suffix } : null;
};
const previewArgs = (argv) => {
  const names = new Map(allFiles().map((file) => [file.handle, file.name]));
  return argv.map((arg) => {
    const derived = splitDerivedOutput(arg);
    return derived && names.has(derived.handle) ? `${names.get(derived.handle)}${derived.suffix}` : names.get(arg) || arg;
  });
};
function build(kind, values) {
  const builders = window.FFmpegCommandBuilders || window.commandBuilders || {};
  const fn = builders[kind] || (builders.build && ((v) => builders.build(kind, v)));
  if (typeof fn !== 'function') throw new Error(`Command builder unavailable: ${kind}`);
  const result = fn(Object.assign({ overwrite: true }, values, { progress: false })); const argv = Array.isArray(result) ? result : result?.argv;
  if (!Array.isArray(argv) || argv.some((arg) => typeof arg !== 'string')) throw new Error(`Invalid ${kind} command result`);
  if (argv.length > 256) throw new Error(`${kind} produced more than 256 arguments.`);
  return argv.map((arg) => bounded(arg, 4096));
}
const allFiles = () => [...Object.values(state.inputs), ...Object.values(state.outputs), ...state.converterFiles].filter(Boolean);
const runtimeArgs = (argv, selectedFiles = allFiles()) => {
  const handles = new Map(selectedFiles.map((file) => [file.handle, file]));
  return argv.map((arg) => {
    const derived = splitDerivedOutput(arg);
    if (derived) {
      const file = handles.get(derived.handle);
      if (!file || file.kind !== 'output') throw new Error('A derived output no longer has a valid selected destination.');
      return { fileHandle: file.handle, kind: 'output', suffix: derived.suffix };
    }
    const file = handles.get(arg);
    return file ? { fileHandle: file.handle, kind: file.kind === 'output' || Object.values(state.outputs).some((value) => value?.handle === file.handle) ? 'output' : 'input' } : arg;
  });
};
const fileStem = (file, fallback = 'output') => bounded(file?.name || fallback, 180).replace(/\.[^.]+$/u, '').replace(/[\\/:*?"<>|]/gu, '_') || fallback;
const TRIM_CONTAINERS = new Set(['mp4','mkv','mov','webm','m4v','ts']);
const selectedTrimContainer = () => {
  const container = bounded(state.form.trimContainer || 'mp4', 12).toLowerCase();
  return TRIM_CONTAINERS.has(container) ? container : 'mp4';
};
const composerOutputDefinition = () => COMPOSER_FORMATS[state.form.composerFormat] || COMPOSER_FORMATS.mp4;
const audioExtractionFormat = () => AUDIO_EXTRACTION_FORMATS[state.form.audioFormat] || AUDIO_EXTRACTION_FORMATS['mka-copy'];
const audioExtractionStreamOptions = () => state.audioStreams.map((stream) => {
  const facts = [stream.codec ? stream.codec.toUpperCase() : 'unknown codec'];
  if (stream.channels) facts.push(`${stream.channels} channel${stream.channels === 1 ? '' : 's'}`);
  if (stream.sampleRate) facts.push(`${stream.sampleRate} Hz`);
  if (stream.language) facts.push(stream.language);
  return [stream.id, `${stream.id} · ${facts.join(' · ')}`];
});
const validatedAudioChoice = (value, choices, label) => {
  const text = String(value ?? '');
  if (!choices.includes(text)) throw new Error(`${label} must be selected from the available choices.`);
  return text;
};
const outputOptions = (slot) => {
  const selectedInput = state.inputs[slot];
  const extractionFormat = audioExtractionFormat();
  const definitions = {
    convert: { extension: state.form.container, label: state.form.container.toUpperCase() },
    trim: { extension: selectedTrimContainer(), label: `${selectedTrimContainer().toUpperCase()} media` },
    filters: { extension: 'mp4', label: 'MP4 video' },
    'audio-normalize': { extension: state.form.loudnormCodec === 'aac' ? 'm4a' : state.form.loudnormCodec === 'libopus' ? 'opus' : state.form.loudnormCodec.startsWith('pcm_') ? 'wav' : state.form.loudnormCodec, label: 'Normalized audio' },
    'audio-extract': { extension: extractionFormat.extension, label: extractionFormat.label },
    gif: { extension: 'gif', label: 'GIF image' },
    thumbs: state.form.thumbFormat === 'png' ? { extension: 'png', label: 'PNG image' } : { extension: 'jpg', label: 'JPEG image' },
    streaming: { extension: 'm3u8', label: 'HLS playlist' },
    composer: composerOutputDefinition()
  };
  const definition = definitions[slot] || { extension: 'mp4', label: 'Media output' };
  const source = slot.startsWith('audio-') ? state.inputs.audio : selectedInput;
  return {
    suggestedName: `${fileStem(source)}-${slot.replace(/^audio-/u, '')}.${definition.extension}`,
    filters: [{ name: definition.label, extensions: definition.extensions || [definition.extension] }]
  };
};
const outputExtension = (file) => file?.name?.includes('.') ? file.name.split('.').pop().toLowerCase() : '';
const requireExtension = (file, extensions, label) => {
  if (!file) throw new Error(`Choose the ${label} destination first.`);
  const accepted = new Set(extensions.map((extension) => extension.toLowerCase()));
  if (!accepted.has(outputExtension(file))) throw new Error(`${label} must use ${[...accepted].map((extension) => `.${extension}`).join(' or ')}.`);
  return file;
};
const requireTrimSelection = (file, kind, label) => {
  if (!file || file.kind !== kind || !HANDLE_RE.test(String(file.handle || ''))) {
    throw new Error(`Choose a valid ${label} through the file picker first.`);
  }
  return file;
};
const loudnormTarget = (value, minimum, maximum, label) => {
  if (value === '' || value === null || value === undefined) throw new Error(`${label} is required.`);
  const result = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(result) || result < minimum || result > maximum) {
    throw new Error(`${label} must be a finite number from ${minimum} through ${maximum}.`);
  }
  return result;
};
const loudnormSelection = (file, kind, label) => {
  if (!file || file.kind !== kind || !HANDLE_RE.test(String(file.handle || ''))) {
    throw new Error(`Choose a valid ${label} ${kind === 'input' ? 'file' : 'destination'} first.`);
  }
  return { handle: String(file.handle), kind, name: bounded(file.name || label, 240) };
};
const loudnormValues = () => {
  const input = loudnormSelection(state.inputs.audio, 'input', 'audio input');
  const output = loudnormSelection(
    requireExtension(state.outputs['audio-normalize'], [outputOptions('audio-normalize').filters[0].extensions[0]], 'normalized audio output'),
    'output',
    'normalized audio output'
  );
  if (input.handle === output.handle) throw new Error('The normalized output must be a separate selected destination.');
  const stream = bounded(state.form.audioStream, 24);
  if (!/^0:a(?::\d{1,4})?\??$/u.test(stream)) throw new Error('Audio stream must select an audio stream from input 0.');
  const audioCodec = bounded(state.form.loudnormCodec, 24);
  if (!LOUDNORM_CODECS.has(audioCodec)) throw new Error('Normalized output codec is not supported by this workflow.');
  return {
    input,
    output,
    stream,
    integrated: loudnormTarget(state.form.loudness, -70, -5, 'Integrated loudness'),
    lra: loudnormTarget(state.form.lra, 1, 50, 'Loudness range'),
    truePeak: loudnormTarget(state.form.truePeak, -9, 0, 'True peak'),
    audioCodec
  };
};
const loudnormAnalysisSpec = (values) => ({
  input: values.input.handle,
  phase: 'analysis',
  stream: values.stream,
  integrated: values.integrated,
  lra: values.lra,
  truePeak: values.truePeak
});
const loudnormLabelPart = (value, fallback) => bounded(value || fallback, 100).replace(/[\0\r\n]/gu, ' ').trim() || fallback;
const loudnormApplyLabel = (pending) => bounded(`Normalize · ${loudnormLabelPart(pending.output.name, 'audio')} · pass 2 ${pending.analysisJobId.slice(0, 8)}`, 160);

function normalizeLoudnormPendingRecord(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate) || !HANDLE_RE.test(String(candidate.analysisJobId || ''))) {
    throw new Error('Saved loudness workflow identifier is invalid.');
  }
  const input = loudnormSelection(candidate.input, 'input', 'saved audio input');
  const output = loudnormSelection(candidate.output, 'output', 'saved normalized output');
  if (input.handle === output.handle) throw new Error('Saved loudness workflow reuses its input as its output.');
  const stream = bounded(candidate.stream, 24);
  if (!/^0:a(?::\d{1,4})?\??$/u.test(stream)) throw new Error('Saved loudness workflow stream is invalid.');
  const audioCodec = bounded(candidate.audioCodec, 24);
  if (!LOUDNORM_CODECS.has(audioCodec)) throw new Error('Saved loudness workflow codec is invalid.');
  const createdAt = typeof candidate.createdAt === 'string' && Number.isFinite(Date.parse(candidate.createdAt))
    ? new Date(candidate.createdAt).toISOString()
    : new Date().toISOString();
  if (!HANDLE_RE.test(String(candidate.sessionId || ''))) throw new Error('Saved loudness workflow session is invalid.');
  return {
    analysisJobId: String(candidate.analysisJobId),
    input,
    output,
    stream,
    integrated: loudnormTarget(candidate.integrated, -70, -5, 'Saved integrated loudness'),
    lra: loudnormTarget(candidate.lra, 1, 50, 'Saved loudness range'),
    truePeak: loudnormTarget(candidate.truePeak, -9, 0, 'Saved true peak'),
    audioCodec,
    createdAt,
    sessionId: String(candidate.sessionId)
  };
}

function restoreLoudnormPending() {
  const raw = localStorage.getItem(LOUDNORM_PENDING_KEY);
  if (raw === null) return;
  let discarded = 0;
  try {
    if (raw.length > LOUDNORM_MAX_STORED_BYTES) throw new Error('Saved loudness workflow state exceeds its size limit.');
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== LOUDNORM_PENDING_VERSION || !Array.isArray(parsed.workflows) || parsed.workflows.length > LOUDNORM_MAX_PENDING) {
      throw new Error('Saved loudness workflow state has an unsupported shape.');
    }
    for (const candidate of parsed.workflows) {
      try {
        const pending = normalizeLoudnormPendingRecord(candidate);
        if (state.loudnormPending[pending.analysisJobId]) throw new Error('Saved loudness workflow identifier is duplicated.');
        state.loudnormPending[pending.analysisJobId] = pending;
      } catch (_) { discarded += 1; }
    }
    state.loudnormRecoveryPending = Object.keys(state.loudnormPending).length > 0;
    if (discarded) {
      state.loudnormRecoveryNotice = `${discarded} invalid saved loudness workflow record${discarded === 1 ? ' was' : 's were'} discarded without starting pass 2.`;
      saveLoudnormPending();
    }
  } catch (error) {
    state.loudnormRecoveryNotice = `${error.message} No saved loudness workflow was resumed.`;
    state.loudnormPending = {};
    localStorage.removeItem(LOUDNORM_PENDING_KEY);
  }
}

function saveLoudnormPending(required = false) {
  try {
    const workflows = Object.values(state.loudnormPending).slice(0, LOUDNORM_MAX_PENDING);
    if (!workflows.length) {
      localStorage.removeItem(LOUDNORM_PENDING_KEY);
      return;
    }
    const payload = JSON.stringify({ version: LOUDNORM_PENDING_VERSION, workflows });
    if (payload.length > LOUDNORM_MAX_STORED_BYTES) throw new Error('Pending loudness workflow state exceeds its storage limit.');
    localStorage.setItem(LOUDNORM_PENDING_KEY, payload);
  } catch (error) {
    if (required) throw error;
    try { localStorage.removeItem(LOUDNORM_PENDING_KEY); } catch (_) { /* The runtime error notification remains authoritative. */ }
  }
}
const convertValues = () => ({
  input: state.inputs.convert?.handle, output: requireExtension(state.outputs.convert, [state.form.container], 'conversion output').handle,
  videoCodec: state.form.codec, audioCodec: state.form.codec === 'copy' ? 'copy' : 'aac',
  crf: state.form.codec === 'copy' ? undefined : state.form.crf, preset: state.form.codec === 'copy' ? undefined : state.form.preset,
  tune: state.form.codec === 'copy' ? undefined : state.form.tune,
  width: state.form.codec === 'copy' ? undefined : state.form.width,
  height: state.form.codec === 'copy' ? undefined : state.form.height,
  fps: state.form.codec === 'copy' ? undefined : state.form.fps || undefined,
  faststart: state.form.container === 'mp4', hwaccel: 'none'
});
const trimValues = () => {
  const input = requireTrimSelection(state.inputs.trim, 'input', 'trim input');
  const output = requireTrimSelection(state.outputs.trim, 'output', 'trim output');
  const container = selectedTrimContainer();
  return {
    input: input.handle,
    output: requireExtension(output, [container], 'trim output').handle,
    start: state.form.trimStart || undefined,
    end: state.form.trimEnd || undefined,
    duration: state.form.trimEnd ? undefined : state.form.trimDuration || undefined,
    mode: state.form.trimMode,
    videoCodec: state.form.trimMode === 'reencode' ? state.form.trimVideoCodec : undefined,
    audioCodec: state.form.trimMode === 'reencode' ? state.form.trimAudioCodec : undefined,
    crf: state.form.trimMode === 'reencode' ? state.form.trimCrf : undefined,
    preset: state.form.trimMode === 'reencode' ? state.form.trimPreset : undefined,
    avoidNegativeTs: state.form.avoidNegative ? 'make_zero' : 'disabled'
  };
};
const filtergraphValues = () => {
  const nodes = state.filters.map((node) => ({ kind: node.kind, name: node.name, options: Object.assign({}, node.options) }));
  const hasVideo = nodes.some((node) => node.kind === 'video');
  const hasAudio = nodes.some((node) => node.kind === 'audio');
  return {
    input: state.inputs.filters?.handle,
    output: requireExtension(state.outputs.filters, ['mp4','mkv','mov'], 'filtergraph output').handle,
    nodes,
    videoCodec: hasVideo ? 'libx264' : 'copy',
    audioCodec: hasAudio ? 'aac' : 'copy',
    crf: hasVideo ? state.form.crf : undefined,
    preset: hasVideo ? state.form.preset : undefined
  };
};
const extractValues = () => {
  if (!state.inputs.audio) throw new Error('Choose an input file before extracting audio.');
  if (state.audioInspecting) throw new Error('Wait for audio stream inspection to finish.');
  if (state.audioProbeError) throw new Error(state.audioProbeError);
  if (!state.audioStreams.length) throw new Error('The selected input has no detected audio streams.');
  const stream = state.audioStreams.find((entry) => entry.id === state.form.audioStream);
  if (!stream) throw new Error('Choose one of the detected audio streams.');
  const format = audioExtractionFormat();
  const output = requireExtension(state.outputs['audio-extract'], [format.extension], 'extracted audio output');
  const definition = { selector: stream.id, output: output.handle, codec: format.codec };
  if (format.codec !== 'copy') {
    if (format.bitrates.length) definition.bitrate = validatedAudioChoice(state.form.audioBitrate, format.bitrates, 'Audio bitrate');
    const sampleRate = validatedAudioChoice(state.form.audioSampleRate, AUDIO_SAMPLE_RATES, 'Sample rate');
    const channels = validatedAudioChoice(state.form.audioChannels, AUDIO_CHANNEL_COUNTS, 'Channel count');
    if (sampleRate !== 'source') definition.sampleRate = Number(sampleRate);
    if (channels !== 'source') definition.channels = Number(channels);
  }
  return { input: state.inputs.audio.handle, streams: [definition] };
};
const gifValues = () => ({
  input: state.inputs.gif?.handle,
  output: requireExtension(state.outputs.gif, ['gif'], 'GIF output').handle,
  start: state.form.gifStart || undefined,
  duration: state.form.gifDuration || undefined,
  fps: state.form.gifFps,
  width: state.form.gifWidth,
  height: state.form.gifHeight,
  scaler: state.form.gifScaler,
  maxColors: state.form.gifColors,
  statsMode: state.form.gifStatsMode,
  dither: state.form.gifDither,
  bayerScale: state.form.gifDither === 'bayer' ? state.form.gifBayerScale : undefined,
  loop: state.form.gifLoop
});
const thumbnailValues = () => {
  const format = state.form.thumbFormat === 'png' ? 'png' : 'jpg';
  return {
    input: state.inputs.thumbs?.handle,
    outputPattern: requireExtension(state.outputs.thumbs, format === 'png' ? ['png'] : ['jpg', 'jpeg'], 'thumbnail output').handle,
    start: state.form.thumbTime,
    mode: 'single',
    count: 1,
    width: state.form.thumbWidth,
    height: state.form.thumbHeight,
    scaler: state.form.thumbScaler,
    quality: format === 'jpg' ? state.form.thumbQuality : undefined
  };
};
const streamingEncodingValues = () => {
  const resolution = String(state.form.streamResolution || 'source');
  const match = /^(\d{2,5})x(\d{2,5})$/u.exec(resolution);
  if (resolution !== 'source' && !match) throw new Error('Choose a supported streaming resolution.');
  const fps = String(state.form.streamFps || 'source');
  if (fps !== 'source' && !new Set(['24', '25', '30', '50', '60']).has(fps)) throw new Error('Choose a supported streaming frame rate.');
  return {
    videoCodec: 'libx264',
    audioCodec: 'aac',
    videoBitrate: state.form.streamVideoBitrate,
    audioBitrate: state.form.streamAudioBitrate,
    width: match ? Number(match[1]) : undefined,
    height: match ? Number(match[2]) : undefined,
    fps: fps === 'source' ? undefined : fps,
    gop: state.form.streamGop,
    preset: 'veryfast'
  };
};
const streamingValues = () => {
  const encoding = streamingEncodingValues();
  if (state.form.streamMode === 'hls') {
    const output = requireExtension(state.outputs.streaming, ['m3u8'], 'HLS playlist');
    const fmp4 = state.form.hlsSegmentType === 'fmp4';
    return Object.assign({}, encoding, {
      input: state.inputs.streaming?.handle,
      output: output.handle,
      hlsTime: state.form.hlsTime,
      listSize: state.form.hlsList,
      playlistType: state.form.hlsPlaylistType,
      segmentType: state.form.hlsSegmentType,
      segmentFilename: derivedOutput(output, fmp4 ? '.segment-%05d.m4s' : '.segment-%05d.ts'),
      initFilename: fmp4 ? derivedOutput(output, '.init.mp4') : undefined,
      flags: ['independent_segments', 'temp_file']
    });
  }
  return Object.assign({}, encoding, {
    input: state.inputs.streaming?.handle,
    target: state.form.streamTarget,
    mode: state.form.streamMode,
    format: state.form.streamMode === 'rtmp' ? 'flv' : 'mpegts',
    realtime: Boolean(state.form.streamRealtime),
    lowLatency: Boolean(state.form.streamLowLatency)
  });
};
const workflowPreview = (kind, values) => {
  try { return commandPreview(previewArgs(build(kind, typeof values === 'function' ? values() : values))); }
  catch (error) { return bounded(displayText(error.message, 'command detail'), 1000); }
};
const convertPreview = () => workflowPreview('convert', convertValues);
const currentWorkflow = () => {
  if (state.view === 'trim') return ['trim', trimValues];
  if (state.view === 'filters') return ['filtergraph', filtergraphValues];
  if (state.view === 'audio') return ['extract', extractValues];
  if (state.view === 'gif') return ['gif', gifValues];
  if (state.view === 'streaming') return [state.form.streamMode === 'hls' ? 'hls' : 'stream', streamingValues];
  if (state.view === 'composer') return ['composer', composerValues];
  return ['convert', convertValues];
};
const livePreview = () => { const [kind, values] = currentWorkflow(); return workflowPreview(kind, values); };

async function enqueue(kind, values, label) {
  try {
    if (!state.runtime.available) throw new Error(state.runtime.error || 'The bundled FFmpeg runtime is unavailable.');
    const resolvedValues = typeof values === 'function' ? values() : values;
    const argv = build(kind, resolvedValues);
    await apiCall('jobs.enqueue', { label: bounded(label || kind, 160), args: runtimeArgs(argv) });
    notify('Job queued', bounded(label ?? kind, 160)); state.view = 'jobs'; await refreshJobs();
  } catch (error) { notify('Could not queue job', error.message, 'error'); }
}

async function queueTrim() {
  try {
    if (!state.runtime.available) throw new Error(state.runtime.error || 'The bundled FFmpeg runtime is unavailable.');
    const argv = build('trim', trimValues());
    const args = runtimeArgs(argv);
    const selectedInputs = args.filter((arg) => arg && typeof arg === 'object' && arg.kind === 'input');
    const selectedOutputs = args.filter((arg) => arg && typeof arg === 'object' && arg.kind === 'output');
    if (selectedInputs.length !== 1 || selectedOutputs.length !== 1) {
      throw new Error('The trim command did not preserve exactly one trusted input and one trusted output selection.');
    }
    const label = bounded(state.outputs.trim?.name || 'Trim', 160);
    const job = await apiCall('jobs.enqueue', { label, args });
    if (!job || typeof job !== 'object' || !HANDLE_RE.test(String(job.id || '')) || !['queued', 'running'].includes(job.status)) {
      throw new Error('The job queue did not return a valid queued or running trim job.');
    }
    notify('Trim queued', `${label} · ${job.status}`);
    state.view = 'jobs';
    await refreshJobs();
  } catch (error) {
    notify('Trim not queued', bounded(error?.message || 'The trim request was refused without an error detail.', 1000), 'error');
  }
}

const normalizeJob = (job, index) => {
  const status = bounded(job.status ?? 'queued', 30).toLowerCase();
  const rawProgress = job.progress && typeof job.progress === 'object' ? job.progress : {};
  const reportedPercent = Number(rawProgress.percent ?? job.percent);
  const progress = Number.isFinite(reportedPercent) ? clamp(reportedPercent, 0, 100) : status === 'completed' ? 100 : null;
  const progressFacts = [
    rawProgress.out_time ? `media ${bounded(rawProgress.out_time, 40)}` : '',
    rawProgress.frame !== undefined ? `frame ${bounded(rawProgress.frame, 30)}` : '',
    rawProgress.total_size !== undefined ? `${bounded(rawProgress.total_size, 30)} bytes` : '',
    rawProgress.speed ? `speed ${bounded(rawProgress.speed, 30)}` : '',
    rawProgress.progress ? bounded(rawProgress.progress, 30) : ''
  ].filter(Boolean).join(' · ');
  const outputError = job.outputValidation && job.outputValidation.valid === false ? job.outputValidation.error : '';
  const outputValidation = job.outputValidation && typeof job.outputValidation === 'object' ? {
    valid: job.outputValidation.valid === true,
    mode: bounded(job.outputValidation.mode || '', 30),
    error: bounded(job.outputValidation.error || '', 1000),
    outputs: Array.isArray(job.outputValidation.outputs) ? job.outputValidation.outputs.slice(0, 2000).map((output) => ({
      name: bounded(output?.name || 'output', 255),
      bytes: Number.isSafeInteger(output?.bytes) && output.bytes >= 0 ? output.bytes : 0
    })) : []
  } : null;
  return {
    id: String(job.id ?? job.jobId ?? index),
    label: bounded(job.label ?? job.name ?? `Job ${index + 1}`, 200),
    kind: bounded(job.kind ?? 'ffmpeg', 60),
    status,
    progress,
    progressText: bounded(progressFacts, 240),
    speed: bounded(rawProgress.speed ?? job.speed ?? '', 50),
    exitCode: Number.isInteger(job.exitCode) ? job.exitCode : null,
    argv: Array.isArray(job.argv || job.args) ? (job.argv || job.args).map((arg) => bounded(typeof arg === 'string' ? arg : arg?.name || '[selected file]', 4096)).slice(0, 512) : [],
    logs: Array.isArray(job.logs) ? job.logs.slice(-1000).map((line) => bounded(line, 4000)) : [],
    error: bounded(job.error || outputError || '', 1000),
    createdAt: bounded(job.createdAt || '', 40),
    updatedAt: bounded(job.updatedAt || '', 40),
    startedAt: bounded(job.startedAt || '', 40),
    finishedAt: bounded(job.finishedAt || '', 40),
    cancelRequested: job.cancelRequested === true,
    outputValidation
  };
};

function reconcileJobs(jobs) {
  state.jobs = jobs.slice(0, 1000);
  const retained = new Set(state.jobs.map((job) => job.id));
  state.selectedJobs = new Set([...state.selectedJobs].filter((id) => retained.has(id)));
  if (state.selectedJobId && !retained.has(state.selectedJobId)) state.selectedJobId = '';
  if (!state.selectedJobId && state.jobs.length) state.selectedJobId = state.jobs[0].id;
}

async function refreshJobs() {
  try {
    const result = await apiCall('jobs.list');
    reconcileJobs((Array.isArray(result) ? result : result?.jobs || []).slice(0, 1000).map(normalizeJob));
    state.queueError = '';
    render();
    await reconcileLoudnormJobs();
  } catch (error) {
    state.queueError = bounded(error.message, 1000);
    render();
  }
}

const jobRows = (selectable = false) => state.jobs.length ? state.jobs.map((job) => `<div class="list-item job-row" data-job-id="${esc(job.id)}">
  ${selectable ? `<input class="job-select" type="checkbox" data-job-id="${esc(job.id)}"${state.selectedJobs.has(job.id) ? ' checked' : ''}>` : ''}
  <span class="ms">${job.status === 'completed' ? 'check_circle' : job.status === 'failed' ? 'error' : 'movie'}</span>
  <span style="flex:1;min-width:0"><b>${esc(displayText(job.label, 'job'))}</b><br><small class="mono">${esc(job.argv.length ? commandPreview(job.argv) : displayText(job.progressText || job.kind, 'job detail'))}</small>${job.error ? `<br><small style="color:var(--danger)">${esc(displayText(job.error, 'job error'))}</small>` : ''}</span>
  <span class="tag${['completed', 'cancelled', 'failed', 'interrupted'].includes(job.status) ? ' idle' : ''}">${esc(job.status.toUpperCase())}</span>
  <b class="mono" style="font-size:11px;color:var(--muted)">${esc(job.speed || (job.exitCode != null ? `exit ${job.exitCode}` : ''))}</b>
  <button class="job-focus" data-job-id="${esc(job.id)}" title="Open job log"><span class="ms">receipt_long</span></button>
  <div class="progress-track" style="grid-column:1/-1" role="progressbar"${job.progress === null ? ` aria-valuetext="${esc(job.progressText || job.status)}"` : ` aria-valuemin="0" aria-valuemax="100" aria-valuenow="${job.progress}"`}><span style="width:${job.progress === null ? 0 : job.progress}%"></span></div></div>`).join('') : '<div class="empty-state"><b>No jobs yet</b><br><small>Choose a real input and output, then queue an operation.</small></div>';

const field = (label, control) => `<label class="field"><span>${esc(label)}</span>${control}</label>`;
const input = (id, value, type = 'text', extra = '') => `<input id="${id}" type="${type}" value="${esc(value)}" ${extra}>`;
const select = (id, values, selected) => `<select id="${id}">${values.map((value) => `<option value="${esc(value)}"${String(value) === String(selected) ? ' selected' : ''}>${esc(value)}</option>`).join('')}</select>`;
const filterOptionControl = (node, definition, option) => {
  const id = `filter-option-${option.key}`;
  const value = node.options?.[option.key] ?? definition.defaults?.[option.key] ?? '';
  if (option.type === 'checkbox') return `<label class="check-row"><input id="${id}" type="checkbox"${value ? ' checked' : ''}> ${esc(option.label)}</label>`;
  if (option.type === 'select') return field(option.label, select(id, option.values, value));
  const attributes = [
    option.min !== undefined ? `min="${esc(option.min)}"` : '',
    option.max !== undefined ? `max="${esc(option.max)}"` : '',
    option.step !== undefined ? `step="${esc(option.step)}"` : '',
    option.maxLength !== undefined ? `maxlength="${esc(option.maxLength)}"` : '',
    option.placeholder ? `placeholder="${esc(option.placeholder)}"` : '',
  ].filter(Boolean).join(' ');
  return field(option.label, input(id, value, option.type === 'number' ? 'number' : 'text', attributes));
};
const filterNodeSummary = (node) => {
  const definition = filterDefinition(node.kind, node.name);
  return (definition?.fields || []).map((option) => `${option.label}: ${node.options?.[option.key] ?? ''}`).join(' · ');
};
const filterChain = (kind, label) => {
  const entries = state.filters.map((node, index) => ({ node, index })).filter((entry) => entry.node.kind === kind);
  const chain = entries.length ? entries.map(({ node, index }) => `<button type="button" class="node${index === state.selectedFilter ? ' sel' : ''}" data-filter-index="${index}"><b>${esc(filterDefinition(node.kind, node.name)?.label || node.name)}</b><br><small>${esc(filterNodeSummary(node))}</small></button>`).join('<span class="ms" aria-hidden="true">east</span>') : '<div class="empty-state">No nodes in this chain.</div>';
  return `<section class="filter-lane" aria-label="${esc(label)}"><div class="filter-lane-head"><h3>${esc(label)}</h3><span>${entries.length} ordered node${entries.length === 1 ? '' : 's'}</span></div><div class="filter-chain">${chain}</div></section>`;
};
const selectOptions = (id, options, selected, extra = '') => `<select id="${id}" ${extra}>${options.map(([value, label]) => `<option value="${esc(value)}"${String(value) === String(selected) ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select>`;
const pageHead = (eyebrow, title, description, actions = '') => `<div class="page-head"><div><p class="eyebrow">${esc(eyebrow)}</p><h1>${esc(title)}</h1><p class="lede">${esc(description)}</p></div><div class="head-actions">${actions}</div></div>`;
const displayFile = (file, empty) => file ? esc(displayText(file.name, file.kind === 'output' ? 'output file' : 'input file')) : `<span class="hint">${esc(empty)}</span>`;
const pickerCard = (slot, label, output = false) => `<div class="list-item"><span class="ms">${output ? 'output' : 'movie'}</span><span style="flex:1;min-width:0"><b>${esc(label)}</b><br><small class="mono">${displayFile(output ? state.outputs[slot] : state.inputs[slot], output ? 'Choose an output destination' : 'Choose an input file')}</small></span><button class="tonal ${output ? 'pick-output' : 'pick-input'}" data-slot="${slot}">${output ? 'Choose' : 'Browse'}</button></div>`;

const runtimeCard = () => {
  const runtime = state.runtime;
  const value = runtime.loading ? 'Loading' : runtime.available ? runtime.ffmpegVersion || runtime.version || 'Ready' : 'Unavailable';
  const location = [runtime.locationMode, runtime.locationRootId].filter(Boolean).join(' · ') || 'Not reported';
  const rows = [
    ['FFmpeg', runtime.ffmpegAvailable ? `Available · ${runtime.ffmpegVersion || runtime.version || 'version unavailable'}` : 'Unavailable'],
    ['ffprobe', runtime.ffprobeAvailable ? `Available · ${runtime.ffprobeVersion || 'version unavailable'}` : 'Unavailable'],
    ['Origin', runtime.origin || 'Not reported'],
    ['Location', location],
    ['Checked', `${Number(runtime.locationsChecked) || 0} trusted location${Number(runtime.locationsChecked) === 1 ? '' : 's'}`],
    ['Status', runtime.reasonId || (runtime.available ? 'Ready' : 'Unavailable')]
  ];
  const fullFacts = [
    ['FFmpeg build', runtime.ffmpegVersionFull],
    ['ffprobe build', runtime.ffprobeVersionFull],
    ['Configuration', runtime.configuration]
  ].filter(([, fact]) => fact);
  return `<div class="card span3 runtime-card"><small>Runtime</small><div class="stat runtime-stat">${esc(value)}</div><small>${esc(displayText(runtime.error || 'Bundled FFmpeg status', 'runtime detail'))}</small>
    <details class="runtime-meta"><summary>Runtime details</summary>${rows.map(([label, fact]) => `<div class="runtime-meta-row"><span class="runtime-meta-label">${esc(label)}</span><span class="runtime-meta-value">${esc(fact)}</span></div>`).join('')}
    ${fullFacts.map(([label, fact]) => `<div class="runtime-meta-row"><span class="runtime-meta-label">${esc(label)}</span><code class="runtime-meta-value${label === 'Configuration' ? ' runtime-configuration' : ''}">${esc(fact)}</code></div>`).join('')}</details></div>`;
};

const jobTime = (value) => {
  if (!value) return 'Not reported';
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString() : 'Invalid timestamp';
};
const byteSize = (value) => {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return 'Unknown size';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
};

const VIEWS = {
  overview: () => {
    const counts = state.runtimeCatalog.counts || {};
    const running = state.jobs.filter((job) => ['running', 'encoding'].includes(job.status)).length;
    const queued = state.jobs.filter((job) => job.status === 'queued').length;
    const cards = [
      ['Codecs', counts.codecs ?? '—', counts.codecs == null ? 'Load from the bundled runtime' : 'Reported by this build'],
      ['Filters', counts.filters ?? '—', counts.filters == null ? 'Load from the bundled runtime' : 'Reported by this build'],
      ['Queue', `${running} + ${queued}`, 'running + queued']
    ];
    return `${pageHead('Media control plane', 'Overview', 'Live state from the bundled FFmpeg runtime and durable job queue.', '<button class="filled" data-go="convert">New job</button><button class="tonal" data-go="composer">Command composer</button>')}
      <div class="grid">${runtimeCard()}${cards.map(([label, value, sub]) => `<div class="card span3"><small>${esc(label)}</small><div class="stat">${esc(value)}</div><small>${esc(sub)}</small></div>`).join('')}
      <div class="card span8"><div class="section-head"><h2>Active queue</h2><button class="tonal" data-go="jobs">All jobs</button></div><div class="list">${jobRows()}</div></div>
      <div class="card span4"><h2>Quick actions</h2><div class="list">${[['sync_alt','Convert a file','convert'],['content_cut','Trim a clip','trim'],['graphic_eq','Normalize audio','audio'],['search_insights','Inspect media','inspector']].map(([icon,label,view]) => `<button class="list-item" data-go="${view}"><span class="ms">${icon}</span>${label}</button>`).join('')}</div></div></div>`;
  },

  convert: () => `${pageHead('Transcode', 'Convert', 'Choose real files and generate a structured FFmpeg argument vector.', '<button class="outlined" id="save-convert-preset">Save as preset</button><button class="filled" id="queue-convert">Queue job</button>')}
    <div class="grid"><div class="card span7"><h2>Video encoding</h2><div class="two-col">
      ${field('Encoder', select('convert-codec', ['libx264','libx265','libsvtav1','libvpx-vp9','copy'], state.form.codec))}
      ${field('Container', select('convert-container', ['mp4','mkv','webm','mov','mpegts'], state.form.container))}
      ${field('CRF', input('convert-crf', state.form.crf, 'number', 'min="0" max="63"'))}
      ${field('Preset', select('convert-preset', ['ultrafast','veryfast','fast','medium','slow','slower','veryslow'], state.form.preset))}
      ${field('Tune', select('convert-tune', ['none','film','animation','grain','stillimage','fastdecode','zerolatency'], state.form.tune))}
      ${field('Frame rate (blank keeps source)', input('convert-fps', state.form.fps, 'text', 'placeholder="24000/1001"'))}
      ${field('Width', input('convert-width', state.form.width, 'number'))}${field('Height (-2 keeps aspect)', input('convert-height', state.form.height, 'number'))}
    </div></div><div class="span5" style="display:grid;gap:14px"><div class="card"><h2>Input → output</h2><div class="list">${pickerCard('convert','Input')}${pickerCard('convert','Output',true)}</div></div>
    <div class="card"><h2>Live command</h2><pre class="cmd-pre" id="cmd-pre">${esc(convertPreview())}</pre><button class="tonal" id="copy-current-command">Copy preview</button></div></div></div>`,

  trim: () => `${pageHead('Cut or re-encode', 'Trim & clip', 'Type exact timecodes and choose stream copy or frame-accurate output.', '<button class="filled" id="queue-trim">Queue trim</button>')}
    <div class="grid"><div class="card span7"><div class="list">${pickerCard('trim','Input')}${pickerCard('trim','Output',true)}</div><div class="two-col" style="margin-top:14px">
      ${field('In point (-ss)', input('trim-start', state.form.trimStart, 'text', 'placeholder="00:00:00.000"'))}
      ${field('Out point (source time; overrides duration)', input('trim-end', state.form.trimEnd, 'text', 'placeholder="00:00:10.000"'))}
      ${field('Clip duration (-t, used when out point is blank)', input('trim-duration', state.form.trimDuration, 'text', 'placeholder="00:00:10.000"'))}
      ${field('Mode', select('trim-mode', ['copy','reencode'], state.form.trimMode))}
      ${field('Output container', select('trim-container', ['mp4','mkv','mov','webm','m4v','ts'], state.form.trimContainer))}
      <label class="check-row"><input id="trim-negative" type="checkbox"${state.form.avoidNegative ? ' checked' : ''}> Avoid negative timestamps</label>
    </div><fieldset${state.form.trimMode === 'copy' ? ' disabled' : ''} style="margin-top:14px"><legend>Re-encode settings</legend><div class="two-col">
      ${field('Video encoder',select('trim-video-codec',['libx264','libx265','libsvtav1','libvpx-vp9'],state.form.trimVideoCodec))}
      ${field('Audio encoder',select('trim-audio-codec',['aac','flac','libopus','pcm_s24le'],state.form.trimAudioCodec))}
      ${field('CRF',input('trim-crf',state.form.trimCrf,'number','min="0" max="63"'))}
      ${field('Preset',select('trim-preset',['ultrafast','veryfast','fast','medium','slow','slower','veryslow'],state.form.trimPreset))}
    </div></fieldset><p class="hint">Re-encode controls are unavailable in copy mode because stream copy does not consume them. An out point is converted to a positive clip duration after the selected start time.</p></div><div class="card span5"><h2>Command preview</h2><pre class="cmd-pre" id="trim-command-preview">${esc(workflowPreview('trim',trimValues))}</pre></div></div>`,

  filters: () => {
    const node = state.filters[state.selectedFilter];
    const definition = node ? filterDefinition(node.kind, node.name) : null;
    const sameKindIndices = node ? state.filters.map((entry, index) => entry.kind === node.kind ? index : -1).filter((index) => index >= 0) : [];
    const chainPosition = sameKindIndices.indexOf(state.selectedFilter);
    const editor = node && definition ? `${field('Media stream',select('filter-kind',['video','audio'],node.kind))}${field('Filter', select('filter-name',Object.keys(filtergraphCatalog[node.kind] || {}),node.name))}<div class="two-col">${definition.fields.map((option) => filterOptionControl(node, definition, option)).join('')}</div><div class="dialog-actions"><button class="outlined" id="filter-earlier"${chainPosition <= 0 ? ' disabled' : ''}>Move earlier</button><button class="outlined" id="filter-later"${chainPosition < 0 || chainPosition >= sameKindIndices.length - 1 ? ' disabled' : ''}>Move later</button></div><div class="dialog-actions"><button class="tonal" id="update-filter">Update node</button><button class="outlined" id="remove-filter">Remove node</button></div>` : '<div class="empty-state">Select or add a node.</div>';
    return `${pageHead('Filtergraph', 'Node graph', 'Build validated ordered video and audio chains, then queue them through the trusted runtime.', '<button class="outlined" id="add-video-filter">Add video node</button><button class="outlined" id="add-audio-filter">Add audio node</button><button class="filled" id="queue-filtergraph">Apply & queue</button>')}
      <div class="grid"><div class="card span7"><div class="list">${pickerCard('filters','Input')}${pickerCard('filters','Output',true)}</div><div class="graph" style="margin-top:14px">${filterChain('video','Video chain')}${filterChain('audio','Audio chain')}</div></div>
      <div class="card span5"><h2>Selected node</h2>${editor}<p class="hint">Only the listed filters and guided option ranges are accepted. Video and audio nodes keep their own visible order and compile into separate chains.</p><h3>Command preview</h3><pre class="cmd-pre">${esc(workflowPreview('filtergraph',filtergraphValues))}</pre></div></div>`;
  },

  audio: () => {
    const format = audioExtractionFormat();
    const streamOptions = audioExtractionStreamOptions();
    const inspectionState = !state.inputs.audio
      ? '<p class="notice">Choose an input file to inspect its real audio streams.</p>'
      : state.audioInspecting
        ? '<p class="notice">Inspecting audio streams with the bundled FFprobe runtime…</p>'
        : state.audioProbeError
          ? `<p class="notice error"><b>Audio inspection failed.</b><br>${esc(displayText(state.audioProbeError, 'runtime detail'))}</p>`
          : streamOptions.length
            ? `<p class="notice">Detected ${streamOptions.length} audio stream${streamOptions.length === 1 ? '' : 's'}. Choose exactly one for this extraction job.</p>`
            : '<p class="notice error"><b>No audio streams detected.</b><br>Choose a media file that contains an audio stream.</p>';
    const bitrateControl = format.bitrates.length
      ? field('Audio bitrate', selectOptions('audio-bitrate', format.bitrates.map((value) => [value, value]), format.bitrates.includes(state.form.audioBitrate) ? state.form.audioBitrate : format.defaultBitrate))
      : '';
    const transformControls = format.codec === 'copy'
      ? '<p class="hint">Stream copy keeps the encoded audio unchanged. Bitrate, sample-rate, and channel conversion are unavailable in this mode.</p>'
      : `<div class="two-col">${bitrateControl}${field('Sample rate',selectOptions('audio-sample-rate',AUDIO_SAMPLE_RATES.map((value) => [value,value === 'source' ? 'Keep source rate' : `${value} Hz`]),state.form.audioSampleRate))}${field('Channels',selectOptions('audio-channels',AUDIO_CHANNEL_COUNTS.map((value) => [value,value === 'source' ? 'Keep source layout' : value === '1' ? 'Mono' : 'Stereo']),state.form.audioChannels))}</div>`;
    return `${pageHead('Audio', 'Extraction & loudness', 'Inspect real streams, normalize with measured loudness, or extract one selected stream.', '')}
      <div class="grid"><div class="card span6"><h2>Two-pass loudness</h2><div class="list">${pickerCard('audio','Input')}${pickerCard('audio-normalize','Normalized output',true)}</div>
        <div class="two-col" style="margin-top:14px">${field('Integrated loudness (LUFS)', input('audio-lufs',state.form.loudness,'number','min="-70" max="-5" step="0.1"'))}${field('Loudness range',input('audio-lra',state.form.lra,'number','min="1" max="50" step="0.1"'))}${field('True peak (dBTP)',input('audio-tp',state.form.truePeak,'number','min="-9" max="0" step="0.1"'))}${field('Normalized output codec',select('loudnorm-codec',['flac','aac','libopus','pcm_s24le'],state.form.loudnormCodec))}</div><button class="filled" id="queue-loudnorm">Queue measured two-pass normalization</button><p class="hint">${Object.keys(state.loudnormPending).length ? `${Object.keys(state.loudnormPending).length} pass 1 job${Object.keys(state.loudnormPending).length === 1 ? ' is' : 's are'} waiting for a confirmed result.` : 'Pass 2 is queued only after pass 1 completes with bounded loudnorm measurements. Restarted workflows stop visibly if their trusted selections are no longer available.'}</p><pre class="cmd-pre">${esc(workflowPreview('loudnorm', () => loudnormAnalysisSpec(loudnormValues())))}</pre></div>
      <div class="card span6"><h2>Extract stream</h2><div class="list">${pickerCard('audio','Input')}${pickerCard('audio-extract','Extracted output',true)}</div>${inspectionState}${field('Stream',selectOptions('audio-stream',streamOptions.length ? streamOptions : [['','No detected audio streams']],state.form.audioStream,streamOptions.length ? '' : 'disabled'))}${field('Output format',selectOptions('audio-format',Object.entries(AUDIO_EXTRACTION_FORMATS).map(([value,definition]) => [value,definition.label]),state.form.audioFormat))}${transformControls}<button class="filled" id="queue-extract">Queue extraction</button><p class="hint">The output path comes from a native save dialog. The renderer submits only opaque selected-file handles and a bounded argument vector to the trusted queue.</p></div></div>`;
  },

  gif: () => `${pageHead('Stills & loops', 'GIF & thumbnails', 'Queue a bounded palette-based GIF or one exact timestamped still through the trusted job queue.', '')}<div class="grid">
    <div class="card span6"><h2>GIF export</h2><div class="list">${pickerCard('gif','Input')}${pickerCard('gif','GIF output',true)}</div><div class="two-col">
      ${field('Start time',input('gif-start',state.form.gifStart,'text','placeholder="00:00:00.000"'))}
      ${field('Duration',input('gif-duration',state.form.gifDuration,'text','placeholder="00:00:05.000"'))}
      ${field('FPS',input('gif-fps',state.form.gifFps,'number','min="1" max="60" step="1"'))}
      ${field('Width',input('gif-width',state.form.gifWidth,'number','min="16" max="8192" step="1"'))}
      ${field('Height (-2 keeps aspect)',input('gif-height',state.form.gifHeight,'number','min="-2" max="8192" step="1"'))}
      ${field('Scaler',select('gif-scaler',['lanczos','bicubic','bilinear','area','neighbor'],state.form.gifScaler))}
      ${field('Palette colors',input('gif-colors',state.form.gifColors,'number','min="4" max="256" step="1"'))}
      ${field('Palette statistics',select('gif-stats',['full','diff','single'],state.form.gifStatsMode))}
      ${field('Dither',select('gif-dither',['sierra2_4a','sierra2','floyd_steinberg','heckbert','bayer','none'],state.form.gifDither))}
      ${state.form.gifDither === 'bayer' ? field('Bayer scale',input('gif-bayer-scale',state.form.gifBayerScale,'number','min="0" max="5" step="1"')) : ''}
      ${field('Loop count (0 = forever)',input('gif-loop',state.form.gifLoop,'number','min="-1" max="65535" step="1"'))}
    </div><h3>Command preview</h3><pre class="cmd-pre" id="gif-preview">${esc(workflowPreview('gif',gifValues))}</pre><button class="filled" id="queue-gif">Queue GIF</button><p class="hint">Single-frame palette statistics regenerate the palette for each frame. Bayer scale is accepted only when Bayer dithering is selected.</p></div>
    <div class="card span6"><h2>Thumbnail</h2><div class="list">${pickerCard('thumbs','Input')}${pickerCard('thumbs',state.form.thumbFormat === 'png' ? 'PNG output' : 'JPEG output',true)}</div><div class="two-col">
      ${field('Timestamp',input('thumb-time',state.form.thumbTime,'text','placeholder="00:00:10.000"'))}
      ${field('Format',select('thumb-format',['jpg','png'],state.form.thumbFormat))}
      ${field('Width',input('thumb-width',state.form.thumbWidth,'number','min="16" max="8192" step="1"'))}
      ${field('Height (-2 keeps aspect)',input('thumb-height',state.form.thumbHeight,'number','min="-2" max="8192" step="1"'))}
      ${field('Scaler',select('thumb-scaler',['lanczos','bicubic','bilinear','area','neighbor'],state.form.thumbScaler))}
      ${state.form.thumbFormat === 'png' ? '' : field('JPEG quality (1 best, 31 smallest)',input('thumb-quality',state.form.thumbQuality,'number','min="1" max="31" step="1"'))}
    </div><h3>Command preview</h3><pre class="cmd-pre" id="thumb-preview">${esc(workflowPreview('thumbnails',thumbnailValues))}</pre><button class="filled" id="queue-thumbs">Queue thumbnail</button><p class="hint">This flow seeks to the selected timestamp and writes exactly one nonempty still. It does not run a representative-frame batch or pretend one save destination is a sequence folder.</p></div></div>`,

  presets: () => `${pageHead('Reusable settings', 'Presets', 'Saved locally from real configured operations.', '<button class="filled" id="new-preset">Save current convert settings</button>')}<div class="card"><div class="list">${state.presets.length ? state.presets.map((preset,index) => `<div class="list-item"><span class="ms">bookmarks</span><span style="flex:1"><b>${esc(preset.name)}</b><br><small class="mono">${esc(JSON.stringify(preset.values).slice(0,300))}</small></span><button class="tonal preset-use" data-index="${index}">Use</button><button class="outlined preset-edit" data-index="${index}">Rename</button><button class="preset-delete" data-index="${index}" style="color:var(--danger)">Delete</button></div>`).join('') : '<div class="empty-state"><b>No presets saved</b><br><small>Configure Convert, then save a named preset.</small></div>'}</div></div>`,

  inspector: () => `${pageHead('ffprobe', 'Media inspector', 'Inspect a real file and export the exact bounded result.', '<button class="outlined" id="inspect-pick">Choose file</button><button class="filled" id="inspect-run">Inspect</button>')}<div class="grid"><div class="card span4"><h2>Source</h2>${state.inputs.inspector ? `<b>${esc(displayText(state.inputs.inspector.name, 'input file'))}</b>` : '<div class="empty-state">No file selected.</div>'}${state.probeError ? `<div class="notice" style="color:var(--danger)">${esc(displayText(state.probeError, 'inspection error'))}</div>` : ''}${state.probeExportError ? `<div class="notice" style="color:var(--danger)">${esc(displayText(state.probeExportError, 'export error'))}</div>` : ''}<div class="dialog-actions"><button class="tonal probe-export" data-format="json" ${!state.probe || state.probeExportFormat ? 'disabled' : ''}>${state.probeExportFormat === 'json' ? 'Exporting JSON…' : 'JSON'}</button><button class="tonal probe-export" data-format="csv" ${!state.probe || state.probeExportFormat ? 'disabled' : ''}>${state.probeExportFormat === 'csv' ? 'Exporting CSV…' : 'CSV'}</button><button class="tonal probe-export" data-format="xml" ${!state.probe || state.probeExportFormat ? 'disabled' : ''}>${state.probeExportFormat === 'xml' ? 'Exporting XML…' : 'XML'}</button></div><p class="hint">JSON preserves the nested inspection result. CSV and XML use a complete row-per-node table with JSON Pointer paths. All formats are UTF-8 and limited to 32 MiB.</p></div>
    <div class="card span8"><h2>Probe result</h2><pre class="cmd-pre" id="probe-result">${state.probe ? esc(JSON.stringify(displayValue(state.probe, 'inspected file'),null,2).slice(0,200000)) : 'Nothing inspected yet.'}</pre></div></div>`,

  hwaccel: () => {
    const methods = state.catalogs.hwaccels || [];
    return `${pageHead('Runtime inventory', 'Hardware acceleration', 'Only methods reported by this bundled FFmpeg build are shown.', '<button class="tonal" id="refresh-runtime">Refresh</button>')}<div class="card"><div class="list">${methods.length ? methods.slice(0,200).map((item) => `<div class="list-item"><span class="ms">developer_board</span><b>${esc(typeof item === 'string' ? item : item.name)}</b><small>${esc(displayText(typeof item === 'object' ? item.details || item.description || '' : '', 'hardware detail'))}</small></div>`).join('') : `<div class="empty-state"><b>${state.runtime.loading ? 'Loading hardware inventory…' : 'No hardware method reported'}</b><br><small>${esc(displayText(state.runtime.error || 'This is not inferred from the computer name or graphics vendor.', 'runtime detail'))}</small></div>`}</div></div>`;
  },

  streaming: () => `${pageHead('Live output', 'Streaming', 'Build a validated HLS, RTMP, or SRT job. A queued job is not a connection verdict.', '<button class="filled" id="queue-stream">Queue stream</button>')}<div class="grid"><div class="card span6"><h2>Source and destination</h2><div class="list">${pickerCard('streaming','Input')}${state.form.streamMode === 'hls' ? pickerCard('streaming','HLS playlist',true) : ''}</div>${field('Mode',select('stream-mode',['hls','rtmp','srt'],state.form.streamMode))}${state.form.streamMode === 'hls' ? '<p class="notice">The playlist, media segments, and fMP4 initialization file are derived from the selected playlist handle and written beside it. The renderer never receives their filesystem paths.</p>' : `${field(state.form.streamMode === 'rtmp' ? 'RTMP or RTMPS URL' : 'SRT URL with port',input('stream-target',state.form.streamTarget,'text',state.form.streamMode === 'rtmp' ? 'placeholder="rtmp://host/application (no credentials or stream keys)" autocomplete="off" spellcheck="false"' : 'placeholder="srt://host:port (no passphrase or secret query)" autocomplete="off" spellcheck="false"'))}<p class="hint">The URL is validated for the selected mode and is not saved across restarts. Do not enter credentials, stream keys, passphrases, tokens, or secret query values.</p>`}</div>
    <div class="card span6"><h2>Encoding</h2><div class="two-col">${field('Video bitrate',input('stream-video-bitrate',state.form.streamVideoBitrate,'text','placeholder="4500k" inputmode="text"'))}${field('Audio bitrate',input('stream-audio-bitrate',state.form.streamAudioBitrate,'text','placeholder="128k" inputmode="text"'))}${field('Resolution',select('stream-resolution',['source','1920x1080','1280x720','854x480'],state.form.streamResolution))}${field('Frame rate',select('stream-fps',['source','24','25','30','50','60'],String(state.form.streamFps)))}</div>${field('Keyframe interval (frames)',input('stream-gop',state.form.streamGop,'number','min="1" max="1000000" step="1"'))}<p class="hint">The workflow uses H.264 video, AAC audio, and the veryfast encoder preset for broad HLS, RTMP, and MPEG-TS/SRT compatibility.</p></div>
    ${state.form.streamMode === 'hls' ? `<div class="card span6"><h2>HLS playlist</h2><div class="two-col">${field('Segment seconds',input('hls-time',state.form.hlsTime,'number','min="1" max="60" step="0.1"'))}${field('Playlist entries',input('hls-list',state.form.hlsList,'number','min="0" max="10000" step="1"'))}${field('Playlist type',select('hls-playlist-type',['live','event','vod'],state.form.hlsPlaylistType))}${field('Segment container',select('hls-segment-type',['mpegts','fmp4'],state.form.hlsSegmentType))}</div><p class="hint">Live keeps a rolling list of the selected size. Event and VOD ask FFmpeg for a complete playlist; use 0 entries when every segment must remain listed.</p></div>` : `<div class="card span6"><h2>Transport behavior</h2><label class="check-row"><input id="stream-realtime" type="checkbox"${state.form.streamRealtime ? ' checked' : ''}> Read the selected input at its native pace</label><label class="check-row"><input id="stream-low-latency" type="checkbox"${state.form.streamLowLatency ? ' checked' : ''}> Apply low-latency encoder and muxer options</label><p class="notice">Queue submission only starts FFmpeg. Connection, authentication, reachability, and server acceptance are reported by the resulting job logs and status.</p></div>`}</div>`,

  jobs: () => {
    const selected = state.jobs.find((job) => job.id === state.selectedJobId) || state.jobs[0];
    const logs = selected?.logs || [];
    const selectedJobs = state.jobs.filter((job) => state.selectedJobs.has(job.id));
    const canPause = selectedJobs.some((job) => job.status === 'running');
    const canResume = selectedJobs.some((job) => job.status === 'paused');
    const canCancel = selectedJobs.some((job) => !['completed', 'failed', 'cancelled', 'interrupted'].includes(job.status));
    const canReorder = selectedJobs.some((job) => job.status === 'queued');
    const validation = selected?.outputValidation;
    const outputs = validation?.outputs || [];
    return `${pageHead('Durable queue', 'Jobs & logs', 'Live process state, progress facts, exit status, output validation, and bounded logs.', '<button class="outlined" id="refresh-jobs">Refresh</button><button class="outlined" id="clear-finished">Clear finished</button>')}
      ${state.queueError ? `<p class="notice queue-error" role="alert"><b>Queue update unavailable:</b> ${esc(displayText(state.queueError, 'queue error'))}</p>` : ''}
      <div class="card bulk-bar"><b>${state.selectedJobs.size} selected</b><span class="tag idle">${state.queueConcurrency} parallel</span><button id="jobs-select-all">Select all</button><button id="jobs-select-none">Clear</button><button id="jobs-pause"${canPause ? '' : ' disabled'}>Pause running</button><button id="jobs-resume"${canResume ? '' : ' disabled'}>Resume paused</button><button id="jobs-back"${canReorder ? '' : ' disabled'}>Move queued to back</button><button id="jobs-cancel" style="color:var(--danger)"${canCancel ? '' : ' disabled'}>Cancel active</button></div>
      <div class="list">${jobRows(true)}</div><div class="card job-detail" style="margin-top:14px"><div class="section-head"><h2>${selected ? esc(displayText(selected.label, 'job')) : 'Job log'}</h2><div class="head-actions"><input id="log-search" placeholder="Filter log lines"><button class="builder-button" type="button" title="Open regex builder">.*</button></div></div>
      ${selected ? `<div class="job-facts"><span><b>Status</b>${esc(selected.status)}</span><span><b>Created</b>${esc(jobTime(selected.createdAt))}</span><span><b>Started</b>${esc(jobTime(selected.startedAt))}</span><span><b>Finished</b>${esc(jobTime(selected.finishedAt))}</span><span><b>Exit</b>${selected.exitCode == null ? 'Not reported' : esc(String(selected.exitCode))}</span><span><b>Progress</b>${esc(selected.progressText || (selected.progress == null ? 'No percentage reported' : `${selected.progress}%`))}</span></div>` : ''}
      ${selected?.error ? `<p class="notice queue-error"><b>Failure:</b> ${esc(displayText(selected.error, 'job error'))}</p>` : ''}
      ${validation ? `<div class="notice ${validation.valid ? 'queue-validation-ok' : 'queue-error'}"><b>Output validation: ${validation.valid ? 'passed' : 'failed'}</b>${validation.error ? `<br>${esc(displayText(validation.error, 'output validation error'))}` : ''}${outputs.length ? `<ul>${outputs.map((output) => `<li>${esc(displayText(output.name, 'output file'))} · ${esc(byteSize(output.bytes))}</li>`).join('')}</ul>` : '<br>No file outputs were declared for this stream job.'}</div>` : ''}
      <div class="log-pane" id="log-pane">${logs.length ? logs.map((line) => `<div>${esc(displayText(line, 'job file'))}</div>`).join('') : '<div>No log lines available.</div>'}</div></div>`;
  },

  composer: () => {
    const preview = composerPreviewState();
    return `${pageHead('Structured argv', 'Command composer', 'Build one bounded FFmpeg argument vector without entering an executable, shell command, or local path.', '<button class="filled" id="queue-composer">Queue command</button>')}<div class="grid"><div class="card span5"><h2>Trusted files and output</h2><div class="list">${pickerCard('composer','Input')}${pickerCard('composer','Output',true)}</div>${field('Output format', select('composer-format', Object.keys(COMPOSER_FORMATS), state.form.composerFormat))}<p class="notice">The format selector owns <code>-f</code>. The native pickers own <code>-i</code> and the final output. Those managed arguments cannot be typed below.</p><p class="hint">Blank lines are ignored. Executable names, shell operators, protocols, local paths, path-reading options, and implicit file outputs are rejected before enqueueing.</p></div><div class="card span7"><h2>Scoped option rows</h2><p class="hint">Enter one option name per line, followed by its scalar value on the next line. A flag needs no value.</p><div class="two-col">${field('Global options',`<textarea id="composer-global-args" class="mono" rows="6" maxlength="${COMPOSER_TEXT_LIMIT}" placeholder="-loglevel&#10;warning">${esc(state.form.composerGlobalArgs)}</textarea>`)}${field('Input options',`<textarea id="composer-input-args" class="mono" rows="6" maxlength="${COMPOSER_TEXT_LIMIT}" placeholder="-ss&#10;00:00:05.000">${esc(state.form.composerInputArgs)}</textarea>`)}</div>${field('Output options',`<textarea id="composer-args" class="mono" rows="8" maxlength="${COMPOSER_TEXT_LIMIT}" placeholder="-c:v&#10;libx264">${esc(state.form.composerArgs)}</textarea>`)}<h2>Bounded preview</h2><p class="notice" id="composer-error" role="alert"${preview.error ? '' : ' hidden'}>${esc(preview.error)}</p><pre class="cmd-pre" id="composer-preview">${esc(preview.text)}</pre><small id="composer-preview-facts">${esc(preview.facts)}</small></div></div>`;
  },

  converter: () => {
    const target = currentConverterTarget();
    const eligible = state.converterFiles.filter((file) => file.supported).length;
    const busy = state.converterBusy ? ' disabled' : '';
    const summary = state.converterSummary;
    return `${pageHead('Media conversion', 'File converter', 'Select a bounded batch, inspect each file through FFprobe, choose one target and one destination folder, then queue every eligible item.', `<button class="outlined" id="converter-add"${busy}>${state.converterBusy ? 'Inspecting…' : 'Add files'}</button><button class="filled" id="queue-converter"${busy || !eligible ? ' disabled' : ''}>Choose folder & queue ${eligible}</button>`)}<div class="grid"><div class="card span7"><div class="section-head"><h2>Inspected inputs</h2><span class="tag">${state.converterFiles.length}/${MAX_CONVERTER_FILES}</span></div><div class="list">${state.converterFiles.length ? state.converterFiles.map((file,index) => `<div class="list-item"><span class="ms">draft</span><span style="flex:1"><b>${esc(displayText(file.name, 'input file'))}</b><br><small>${esc(displayText(file.details || 'Media inspection returned no details.', 'file detail'))}${file.supportReason ? `<br>${esc(file.supportReason)}` : ''}</small></span><span class="tag${file.supported ? '' : ' idle'}">${esc(file.statusLabel)}</span><button class="converter-remove" data-index="${index}" aria-label="Remove ${esc(displayText(file.name, 'input file'))}"${busy}>×</button></div>`).join('') : '<div class="empty-state"><b>No files added</b><br><small>Native selection returns opaque handles. Up to 64 inputs are inspected four at a time; extensions alone never decide support.</small></div>'}</div></div><div class="card span5"><h2>Target and destination</h2>${field('Output type',select('converter-target',Object.keys(CONVERTER_TARGETS),target))}<p class="hint"><b>${esc(CONVERTER_TARGETS[target].label)}</b> requires ${esc(CONVERTER_TARGETS[target].requirement)}. ${eligible} of ${state.converterFiles.length} selected files are eligible.</p><p class="notice">Choose one output folder when queueing. Unique output names are planned inside that folder, existing files are not overwritten, originals stay untouched, and each completed job validates its output.</p>${summary ? `<p class="notice"><b>Last batch:</b> ${summary.queued} queued, ${summary.failed} failed to queue, ${summary.skipped} skipped as unsupported${summary.destinationName ? ` · destination ${esc(displayText(summary.destinationName, 'output folder'))}` : ''}.</p>` : ''}</div></div>`;
  },

  settings: () => `${pageHead('Application', 'Settings', 'Execution, appearance, and message voice preferences persist locally.', '')}<div class="grid"><div class="card span6"><h2>Appearance</h2><div class="seg"><button id="theme-dark" class="${state.theme === 'dark' ? 'active' : ''}">Dark</button><button id="theme-light" class="${state.theme === 'light' ? 'active' : ''}">Light</button></div><button class="tonal" id="logo-settings" style="margin-top:14px">Customize app logo</button></div>
    <div class="card span6"><h2>Execution</h2>${field('Parallel jobs (1–4)',input('setting-parallel',state.settings.parallel,'number','min="1" max="4"'))}<p class="hint">Saving applies this limit immediately to the trusted job scheduler. Running jobs continue; newly available slots start queued work.</p><label class="check-row"><input id="setting-hardware" type="checkbox"${state.settings.preferHardware ? ' checked' : ''}> Prefer hardware encoders reported by runtime</label><label class="check-row"><input id="setting-passlogs" type="checkbox"${state.settings.keepPassLogs ? ' checked' : ''}> Keep intermediate two-pass logs</label><label class="check-row"><input id="setting-notify" type="checkbox"${state.settings.notifyComplete ? ' checked' : ''}> Notify on job completion</label></div>
    <div class="card full"><h2>Funny levels</h2><p class="hint">English and Cantonese keep independent voice levels from 1 (fully serious) to 5 (maximum playfulness). New and reset profiles start at 5. Voice can change; file names, exit status, affected data, and recovery actions never do.</p><div class="two-col">
      <div><label class="field"><span>English — level <output id="setting-funny-en-output">${state.settings.englishFunny}</output></span><input id="setting-funny-en" type="range" min="1" max="5" step="1" value="${state.settings.englishFunny}" aria-describedby="setting-funny-en-preview"></label><p class="notice" id="setting-funny-en-preview">${esc(funnyPreview('english', state.settings.englishFunny))}</p></div>
      <div><label class="field"><span lang="zh-HK">廣東話 — 程度 <output id="setting-funny-yue-output">${state.settings.cantoneseFunny}</output></span><input id="setting-funny-yue" type="range" min="1" max="5" step="1" value="${state.settings.cantoneseFunny}" aria-describedby="setting-funny-yue-preview"></label><p class="notice" id="setting-funny-yue-preview" lang="zh-HK">${esc(funnyPreview('cantonese', state.settings.cantoneseFunny))}</p></div>
    </div><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="tonal" id="reset-funny-levels">Reset both to level 5</button><button class="filled" id="save-settings">Save settings</button></div></div></div>`
};

const catalogView = (view) => {
  const kind = CATALOG_KINDS[view], rows = state.catalogs[kind] || [], error = state.catalogErrors[kind], loading = state.catalogLoading[kind], meta = state.catalogMeta[kind] || {};
  const label = [...GROUPS.registry.items, ...GROUPS.system.items].find((item) => item[0] === view)?.[2] || view;
  const query = state.catalogQueries[kind] || '';
  const needle = query.toLocaleLowerCase();
  const matchesQuery = (entry) => {
    const item = typeof entry === 'string' ? { name: entry } : entry;
    return !needle || `${item?.name || item?.id || item?.key || ''} ${item?.description || item?.details || item?.flags || ''}`.toLocaleLowerCase().includes(needle);
  };
  const visibleCount = rows.filter(matchesQuery).length;
  const countCopy = `${query ? `${visibleCount} shown · ` : ''}${rows.length} loaded${meta.truncated ? ` · limited to ${meta.limit || CATALOG_RESULT_LIMIT}` : ''}${Number.isFinite(meta.total) && meta.total > rows.length ? ` · at least ${meta.total} reported` : ''}`;
  return `${pageHead('Bundled runtime inventory', label, 'Entries come directly from the bundled FFmpeg executable through a bounded trusted request.', `<input id="catalog-search" value="${esc(query)}" placeholder="Search this inventory"><button class="builder-button" type="button" title="Open regex builder">.*</button><button class="tonal" id="catalog-panel">Open help panel</button><button class="tonal" id="catalog-refresh">Refresh</button>`)}<div id="catalog-results" class="registry-grid">${loading ? '<div class="empty-state">Loading runtime inventory…</div>' : error ? `<div class="empty-state"><b>Inventory unavailable</b><br><small>${esc(displayText(error, 'inventory error'))}</small></div>` : rows.length ? rows.map((entry,index) => { const item = typeof entry === 'string' ? { name: entry } : entry; const helpTarget = catalogHelpTarget(kind, item); return `<button class="registry-row" data-catalog-index="${index}" title="${helpTarget ? 'Read bundled FFmpeg help' : 'Component help is not available for this inventory kind'}"${matchesQuery(entry) ? '' : ' hidden'}><b>${esc(item.name || item.id || item.key || '')}</b><span class="desc">${esc(displayText(item.description || item.details || item.flags || '', 'inventory detail'))}</span><span class="tag">${esc(item.mediaType || item.type || kind)}</span><span class="ms">${helpTarget ? 'tune' : 'info'}</span></button>`; }).join('') : '<div class="empty-state"><b>No entries reported</b><br><small>The app does not substitute a fabricated registry.</small></div>'}</div><p class="hint" id="catalog-count">${esc(countCopy)}. Search filters only this local bounded result.</p>`;
};
Object.keys(CATALOG_KINDS).forEach((view) => { VIEWS[view] = () => catalogView(view); });
VIEWS.matrix = () => `${pageHead('Capability inputs', 'Capability matrix', 'Browse the real codec and container inventories together; compatibility is never guessed.', '<input id="matrix-search" placeholder="Filter both inventories">')}<div class="grid"><div class="card span6"><h2>Codecs reported by build</h2><div id="matrix-codecs" class="list">${(state.catalogs.codecs||[]).slice(0,250).map((entry)=>`<div class="list-item matrix-entry"><b>${esc(typeof entry==='string'?entry:entry.name||entry.id||'')}</b><small>${esc(typeof entry==='object'?entry.description||entry.flags||'':'')}</small></div>`).join('')||'<div class="empty-state">Loading codecs…</div>'}</div></div><div class="card span6"><h2>Formats reported by build</h2><div id="matrix-formats" class="list">${(state.catalogs.formats||[]).slice(0,250).map((entry)=>`<div class="list-item matrix-entry"><b>${esc(typeof entry==='string'?entry:entry.name||entry.id||'')}</b><small>${esc(typeof entry==='object'?entry.description||entry.flags||'':'')}</small></div>`).join('')||'<div class="empty-state">Loading formats…</div>'}</div></div></div>`;

function bindFunnyLevelControl(inputId, outputId, previewId, language) {
  const control = $(inputId), output = $(outputId), preview = $(previewId);
  if (!control || !output || !preview) return;
  control.addEventListener('input', () => {
    const level = normalizeFunnyLevel(control.value);
    output.textContent = String(level);
    preview.textContent = funnyPreview(language, level);
  });
}

function render() {
  const group = groupFor(state.view);
  $('#rail').innerHTML = RAIL.map(([id,icon,label]) => `<button class="rail-item${id === group ? ' active' : ''}" data-group="${id}"><span class="ms">${icon}</span><b>${label}</b></button>`).join('') + '<div class="rail-spacer"></div><button class="rail-item" id="palette-open"><span class="ms">keyboard_command_key</span><b>Commands</b></button>';
  const version = state.runtime.loading ? 'Checking runtime…' : state.runtime.available ? `FFmpeg ${state.runtime.ffmpegVersion || state.runtime.version || 'ready'}` : 'FFmpeg unavailable';
  const runtimeNote = state.runtime.error || (state.runtime.ffprobeVersion ? `ffprobe ${state.runtime.ffprobeVersion} · bundled runtime` : 'Bundled runtime');
  $('#subnav').innerHTML = `<p class="eyebrow">${esc(GROUPS[group].title)}</p><div style="display:grid;gap:3px">${GROUPS[group].items.map(([id,icon,label]) => `<button class="subnav-item${id === state.view ? ' active' : ''}" data-go="${id}"><span class="ms">${icon}</span><span>${esc(label)}</span></button>`).join('')}</div><div class="build-note"><b>${esc(version)}</b><br><span>${esc(displayText(runtimeNote, 'runtime detail'))}</span></div>`;
  $('#tabs').innerHTML = state.tabs.map((tab) => `<button class="tab${(tab.view || tab.id) === state.view ? ' active' : ''}" data-go="${esc(tab.view || tab.id)}" role="tab" data-tab-id="${esc(tab.id)}"><span class="ms">${esc(normalizeTabIcon(tab.icon))}</span><span>${esc(tab.label)}</span>${tab.pinned ? '<span class="ms">keep</span>' : ''}</button>`).join('') + '<button id="tab-add" title="Open current view as a tab">+</button><button id="tab-list"><span class="ms">menu</span></button><div class="palette-hint" id="palette-open-2">Search everything <b>Ctrl+Shift+F</b></div>';
  $('#content').innerHTML = (VIEWS[state.view] || VIEWS.overview)(); $('#live-command').textContent = livePreview();
  document.body.classList.toggle('light', state.theme === 'light');
  const logo = $('#logo-open'); logo.textContent = state.logo.image ? '' : state.logo.glyph || 'M'; logo.style.backgroundImage = state.logo.image ? `url(${state.logo.image})` : ''; logo.style.backgroundSize = 'cover'; logo.style.backgroundPosition = 'center';
  applyAppearance();
  saveUi(); wireView();
  if (CATALOG_KINDS[state.view] && !state.catalogs[CATALOG_KINDS[state.view]] && !state.catalogLoading[CATALOG_KINDS[state.view]]) loadCatalog(CATALOG_KINDS[state.view]);
  if (state.view === 'hwaccel' && !state.catalogs.hwaccels && !state.catalogLoading.hwaccels) loadCatalog('hwaccels');
  if (state.view === 'matrix') ['codecs','formats'].forEach((kind)=>{if(!state.catalogs[kind]&&!state.catalogLoading[kind])loadCatalog(kind);});
}

const updateForm = (id, key, numeric = false) => {
  const element = $(`#${id}`); if (!element) return;
  const handler = () => { state.form[key] = numeric ? Number(element.value) : element.value; saveUi(); updatePreviews(); };
  element.addEventListener(element.type === 'text' || element.tagName === 'TEXTAREA' ? 'input' : 'change', handler);
};
function updatePreviews() {
  const preview = $('#cmd-pre'); if (preview) preview.textContent = convertPreview(); $('#live-command').textContent = livePreview();
  const gifPreview = $('#gif-preview'); if (gifPreview) gifPreview.textContent = workflowPreview('gif', gifValues);
  const thumbnailPreview = $('#thumb-preview'); if (thumbnailPreview) thumbnailPreview.textContent = workflowPreview('thumbnails', thumbnailValues);
  const trimPreview = $('#trim-command-preview'); if (trimPreview) trimPreview.textContent = workflowPreview('trim', trimValues);
  const composer = $('#composer-preview'); if (composer) {
    const result = composerPreviewState(), error = $('#composer-error'), facts = $('#composer-preview-facts');
    composer.textContent = result.text;
    if (error) { error.textContent = result.error; error.hidden = !result.error; }
    if (facts) facts.textContent = result.facts;
  }
}

function parseComposerOptions(value, scope) {
  const text = String(value ?? '');
  if (text.length > COMPOSER_TEXT_LIMIT) throw new Error(`${scope} options exceed ${COMPOSER_TEXT_LIMIT} characters.`);
  const lines = text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  const options = [];
  const optionName = /^-{1,2}[A-Za-z0-9][A-Za-z0-9_.:+-]{0,127}$/u;
  for (let index = 0; index < lines.length; index += 1) {
    const name = lines[index];
    if (/^(?:ffmpeg|ffprobe|cmd|powershell|pwsh|bash|sh|zsh|wsl)(?:\.exe)?$/iu.test(name) || /(?:[|&;`<>]|\$\(|\$\{)/u.test(name)) {
      throw new Error(`${scope} accepts option rows, not executable names or shell syntax.`);
    }
    if (!optionName.test(name)) throw new Error(`${scope} expected an FFmpeg option name on row ${index + 1}.`);
    const next = lines[index + 1];
    const nextIsOption = next && optionName.test(next) && !/^-\d+(?:\.\d+)?$/u.test(next);
    options.push({ name, value: next && !nextIsOption ? (index += 1, next) : true });
  }
  return options;
}

function composerValues() {
  const input = state.inputs.composer;
  if (!input || input.kind !== 'input' || !HANDLE_RE.test(input.handle)) throw new Error('Choose a valid composer input with the native file picker.');
  const definition = composerOutputDefinition();
  const output = requireExtension(state.outputs.composer, definition.extensions, 'composer output');
  const globalOptions = parseComposerOptions(state.form.composerGlobalArgs, 'Global options');
  const inputOptions = parseComposerOptions(state.form.composerInputArgs, 'Input options');
  const outputOptions = parseComposerOptions(state.form.composerArgs, 'Output options');
  const optionCount = globalOptions.length + inputOptions.length + outputOptions.length;
  if (optionCount > COMPOSER_OPTION_LIMIT) throw new Error(`Composer accepts at most ${COMPOSER_OPTION_LIMIT} option rows across all scopes.`);
  return {
    globalOptions,
    inputs: [{ source: input.handle, options: inputOptions }],
    outputs: [{ target: output.handle, format: state.form.composerFormat, options: outputOptions }]
  };
}

function composerPreviewState() {
  try {
    const argv = build('composer', composerValues());
    const command = commandPreview(previewArgs(argv));
    const clipped = command.length > COMPOSER_PREVIEW_LIMIT;
    return {
      text: clipped ? `${command.slice(0, COMPOSER_PREVIEW_LIMIT)}…` : command,
      error: '',
      facts: `${argv.length} structured arguments · ${Math.min(command.length, COMPOSER_PREVIEW_LIMIT).toLocaleString()} preview characters${clipped ? ' · preview truncated at the documented limit' : ''}`
    };
  } catch (error) {
    return {
      text: 'Preview unavailable until every required selection and option is valid.',
      error: bounded(displayText(error.message, 'command detail'), 1000),
      facts: `Preview limit: ${COMPOSER_PREVIEW_LIMIT.toLocaleString()} characters · option limit: ${COMPOSER_OPTION_LIMIT}`
    };
  }
}

async function queueComposer() {
  try {
    if (!state.runtime.available) throw new Error(state.runtime.error || 'The bundled FFmpeg runtime is unavailable.');
    const spec = composerValues();
    build('composer', spec);
    await apiCall('composer.enqueue', { label: bounded(state.outputs.composer?.name || 'Composed command', 160), spec });
    notify('Command queued', state.outputs.composer?.name || 'Composed command');
    state.view = 'jobs';
    await refreshJobs();
  } catch (error) {
    notify('Could not queue composed command', error.message, 'error');
    updatePreviews();
  }
}

async function queueLoudnormAnalysis() {
  try {
    if (!state.runtime.available) throw new Error(state.runtime.error || 'The bundled FFmpeg runtime is unavailable.');
    if (Object.keys(state.loudnormPending).length >= LOUDNORM_MAX_PENDING) throw new Error(`At most ${LOUDNORM_MAX_PENDING} two-pass workflows may wait for analysis at once.`);
    let values = loudnormValues();
    const retained = await apiCall('loudnorm.retainSelections', { inputHandle: values.input.handle, outputHandle: values.output.handle });
    values = Object.assign({}, values, {
      input: loudnormSelection(retained?.input, 'input', 'retained audio input'),
      output: loudnormSelection(retained?.output, 'output', 'retained normalized output')
    });
    const argv = build('loudnorm', loudnormAnalysisSpec(values));
    const label = bounded(`Analyze loudness · ${loudnormLabelPart(values.input.name, 'audio')}`, 160);
    const result = await apiCall('jobs.enqueue', { label, args: runtimeArgs(argv, [values.input]) });
    const analysis = result && typeof result === 'object' && !Array.isArray(result) ? result : null;
    if (!analysis?.id || !HANDLE_RE.test(String(analysis.id))) throw new Error('The analysis job was queued without a valid identifier.');
    state.loudnormPending[analysis.id] = normalizeLoudnormPendingRecord({
      analysisJobId: analysis.id,
      input: values.input,
      output: values.output,
      stream: values.stream,
      integrated: values.integrated,
      lra: values.lra,
      truePeak: values.truePeak,
      audioCodec: values.audioCodec,
      createdAt: new Date().toISOString(),
      sessionId: loudnormSessionId
    });
    try {
      saveLoudnormPending(true);
    } catch (storageError) {
      delete state.loudnormPending[analysis.id];
      let cancellation = 'The queued analysis could not be cancelled automatically.';
      try {
        const cancelled = await apiCall('jobs.cancel', String(analysis.id));
        cancellation = `The analysis job is now ${bounded(cancelled?.status || 'cancelling', 30)}.`;
      } catch (_) { /* The explicit cancellation limitation is reported below. */ }
      throw new Error(`Pass 1 was queued but its pass-2 handoff could not be stored: ${storageError.message} ${cancellation}`);
    }
    notify('Two-pass normalization started','Pass 1 is measuring the selected stream. Pass 2 waits for confirmed completion and valid measurements.'); state.view='jobs'; await refreshJobs();
  } catch (error) { notify('Could not queue loudness analysis',error.message,'error'); }
}

function loudnormMeasurements(logs) {
  if (!Array.isArray(logs)) throw new Error('Pass 1 did not return a bounded log list.');
  const selected = logs.slice(-LOUDNORM_MAX_LOG_LINES);
  const lines = [];
  let characters = 0;
  for (let index = selected.length - 1; index >= 0 && characters < LOUDNORM_MAX_LOG_CHARS; index -= 1) {
    const line = bounded(selected[index], 4000);
    const remaining = LOUDNORM_MAX_LOG_CHARS - characters;
    lines.push(line.slice(Math.max(0, line.length - remaining)));
    characters += Math.min(line.length, remaining) + 1;
  }
  const text = lines.reverse().join('\n');
  const candidates = text.match(/\{[^{}]{1,8000}\}/gu) || [];
  const fields = [
    ['input_i', 'inputI', -99, 0],
    ['input_lra', 'inputLra', 0, 99],
    ['input_tp', 'inputTp', -99, 99],
    ['input_thresh', 'inputThresh', -99, 0],
    ['target_offset', 'targetOffset', -99, 99]
  ];
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(candidates[index]);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
      const measurements = {};
      for (const [source, target, minimum, maximum] of fields) {
        if (!Object.prototype.hasOwnProperty.call(parsed, source)) throw new Error(`Missing ${source}.`);
        const raw = parsed[source];
        if (typeof raw !== 'number' && (typeof raw !== 'string' || !/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu.test(raw.trim()))) {
          throw new Error(`Invalid ${source}.`);
        }
        const value = Number(raw);
        if (!Number.isFinite(value) || value < minimum || value > maximum) throw new Error(`Out-of-range ${source}.`);
        measurements[target] = value;
      }
      return measurements;
    } catch { }
  }
  throw new Error('Pass 1 completed without valid bounded loudnorm JSON measurements.');
}

async function reconcileLoudnormJob(job, recovered = false) {
  const pending = state.loudnormPending[job.id];
  if (!pending || loudnormEnqueueing.has(job.id)) return;
  if (job.status !== 'completed' || job.exitCode !== 0 || job.error) {
    if (!LOUDNORM_TERMINAL_STATUSES.has(job.status)) {
      if (pending.sessionId === loudnormSessionId) {
        if (recovered) notify('Two-pass workflow restored', `Pass 1 is ${job.status}. Pass 2 will proceed only after confirmed completion.`);
        return;
      }
      let cancellation = 'The stale analysis cancellation request could not be confirmed.';
      try {
        const cancelled = await apiCall('jobs.cancel', job.id);
        cancellation = `The stale analysis job is now ${bounded(cancelled?.status || 'cancelling', 30)}.`;
      } catch (_) { /* The explicit cancellation limitation is reported below. */ }
      delete state.loudnormPending[job.id];
      saveLoudnormPending();
      notify('Two-pass recovery stopped', `The application restarted, so its opaque selections are no longer valid and pass 2 was not started. ${cancellation}`, 'error');
      return;
    }
    delete state.loudnormPending[job.id];
    saveLoudnormPending();
    const detail = job.error || (job.exitCode === null ? `Pass 1 ended as ${job.status}.` : `Pass 1 ended as ${job.status} with exit ${job.exitCode}.`);
    notify('Two-pass normalization stopped', detail, 'error');
    return;
  }
  if (pending.sessionId !== loudnormSessionId) {
    delete state.loudnormPending[job.id];
    saveLoudnormPending();
    notify('Two-pass recovery stopped', 'Pass 1 completed in an earlier application session, but its opaque selections expired. Pass 2 was not started; reselect the input and output.', 'error');
    return;
  }
  const applyLabel = loudnormApplyLabel(pending);
  if (state.jobs.some((candidate) => candidate.id !== job.id && candidate.label === applyLabel)) {
    delete state.loudnormPending[job.id];
    saveLoudnormPending();
    notify('Two-pass workflow reconciled', 'The matching pass 2 job already exists, so no duplicate was queued.');
    return;
  }
  loudnormEnqueueing.add(job.id);
  try {
    const values = { input:pending.input.handle, output:pending.output.handle, phase:'apply', stream:pending.stream, integrated:pending.integrated, lra:pending.lra, truePeak:pending.truePeak, measurements:loudnormMeasurements(job.logs), audioCodec:pending.audioCodec };
    const argv = build('loudnorm', values);
    const result = await apiCall('jobs.enqueue', { label: applyLabel, args: runtimeArgs(argv, [pending.input, pending.output]) });
    if (!result || typeof result !== 'object' || Array.isArray(result) || !HANDLE_RE.test(String(result.id || ''))) {
      throw new Error('Pass 2 was queued without a valid job identifier.');
    }
    delete state.loudnormPending[job.id];
    saveLoudnormPending();
    notify('Pass 2 queued','Confirmed pass 1 measurements were applied to the normalized output job.');
    await refreshJobs();
  } catch (error) {
    delete state.loudnormPending[job.id];
    try { saveLoudnormPending(); } catch (_) { /* The visible failure below remains authoritative. */ }
    notify('Two-pass normalization stopped', `${error.message} Reselect the input and output to start a new measured workflow.`, 'error');
  } finally {
    loudnormEnqueueing.delete(job.id);
  }
}

async function reconcileLoudnormJobs() {
  const recovered = state.loudnormRecoveryPending;
  state.loudnormRecoveryPending = false;
  for (const id of Object.keys(state.loudnormPending)) {
    const job = state.jobs.find((candidate) => candidate.id === id);
    if (!job) {
      delete state.loudnormPending[id];
      saveLoudnormPending();
      notify('Two-pass recovery stopped', 'The saved pass 1 job is no longer present in the queue, so pass 2 was not started.', 'error');
      continue;
    }
    await reconcileLoudnormJob(job, recovered);
  }
}

function addFilterNode(kind) {
  if (state.filters.length >= 64) return notify('Filter node not added', 'A filtergraph is limited to 64 ordered nodes.', 'error');
  const name = Object.keys(filtergraphCatalog[kind] || {})[0];
  if (!name) return notify('Filter node not added', `No ${kind} filters are available.`, 'error');
  state.filters.push({ kind, name, options: defaultFilterOptions(kind, name) });
  state.selectedFilter = state.filters.length - 1;
  saveUi();
  render();
}

function readFilterDraft() {
  const current = state.filters[state.selectedFilter];
  if (!current) throw new Error('Select a filter node first.');
  const kind = $('#filter-kind')?.value;
  const name = $('#filter-name')?.value;
  const definition = filterDefinition(kind, name);
  if (!definition) throw new Error('Choose a supported filter.');
  const options = {};
  for (const option of definition.fields) {
    const control = $(`#filter-option-${option.key}`);
    if (!control) throw new Error(`The ${option.label} control is unavailable.`);
    if (option.type === 'checkbox') options[option.key] = control.checked;
    else if (option.type === 'number') options[option.key] = control.value.trim() === '' ? undefined : Number(control.value);
    else options[option.key] = control.value;
  }
  return { kind, name, options };
}

function validateFilterDraft(node) {
  const hasVideo = node.kind === 'video';
  build('filtergraph', {
    input: '00000000-0000-4000-8000-000000000001',
    output: '00000000-0000-4000-8000-000000000002',
    nodes: [node],
    videoCodec: hasVideo ? 'libx264' : 'copy',
    audioCodec: hasVideo ? 'copy' : 'aac'
  });
}

function moveSelectedFilter(offset) {
  const node = state.filters[state.selectedFilter];
  if (!node) return;
  const indices = state.filters.map((entry, index) => entry.kind === node.kind ? index : -1).filter((index) => index >= 0);
  const position = indices.indexOf(state.selectedFilter);
  const targetPosition = position + offset;
  if (position < 0 || targetPosition < 0 || targetPosition >= indices.length) return;
  const targetIndex = indices[targetPosition];
  [state.filters[state.selectedFilter], state.filters[targetIndex]] = [state.filters[targetIndex], state.filters[state.selectedFilter]];
  state.selectedFilter = targetIndex;
  saveUi();
  render();
}

function wireView() {
  $$('[data-go]').forEach((button) => button.onclick = () => go(button.dataset.go));
  $$('[data-group]').forEach((button) => button.onclick = () => go(GROUPS[button.dataset.group].items[0][0]));
  $$('#palette-open,#palette-open-2').forEach((button) => button.onclick = openPalette);
  $$('.pick-input').forEach((button) => button.onclick = async () => { const files = await pickFile(button.dataset.slot, { multiple: false, purpose: button.dataset.slot }); if (files.length && ['audio','inspector'].includes(button.dataset.slot)) inspectSelected(button.dataset.slot); });
  $$('.pick-output').forEach((button) => button.onclick = () => chooseOutput(button.dataset.slot, Object.assign({ purpose: button.dataset.slot }, outputOptions(button.dataset.slot))));
  [['convert-codec','codec'],['convert-container','container'],['convert-crf','crf',true],['convert-preset','preset'],['convert-tune','tune'],['convert-fps','fps'],['convert-width','width',true],['convert-height','height',true],['trim-start','trimStart'],['trim-end','trimEnd'],['trim-duration','trimDuration'],['trim-container','trimContainer'],['trim-video-codec','trimVideoCodec'],['trim-audio-codec','trimAudioCodec'],['trim-crf','trimCrf',true],['trim-preset','trimPreset'],['audio-lufs','loudness',true],['audio-lra','lra',true],['audio-tp','truePeak',true],['loudnorm-codec','loudnormCodec'],['audio-stream','audioStream'],['audio-bitrate','audioBitrate'],['audio-sample-rate','audioSampleRate'],['audio-channels','audioChannels'],['gif-start','gifStart'],['gif-duration','gifDuration'],['gif-fps','gifFps',true],['gif-width','gifWidth',true],['gif-height','gifHeight',true],['gif-scaler','gifScaler'],['gif-colors','gifColors',true],['gif-stats','gifStatsMode'],['gif-dither','gifDither'],['gif-bayer-scale','gifBayerScale',true],['gif-loop','gifLoop',true],['thumb-time','thumbTime'],['thumb-width','thumbWidth',true],['thumb-height','thumbHeight',true],['thumb-scaler','thumbScaler'],['thumb-quality','thumbQuality',true],['stream-target','streamTarget'],['stream-video-bitrate','streamVideoBitrate'],['stream-audio-bitrate','streamAudioBitrate'],['stream-resolution','streamResolution'],['stream-fps','streamFps'],['stream-gop','streamGop',true],['hls-time','hlsTime',true],['hls-list','hlsList',true],['hls-playlist-type','hlsPlaylistType'],['hls-segment-type','hlsSegmentType']].forEach(([id,key,numeric]) => updateForm(id,key,numeric));
  const audioFormat = $('#audio-format'); if (audioFormat) audioFormat.onchange = () => {
    const priorExtension = audioExtractionFormat().extension;
    state.form.audioFormat = AUDIO_EXTRACTION_FORMATS[audioFormat.value] ? audioFormat.value : 'mka-copy';
    normalizeAudioExtractionState();
    const nextExtension = audioExtractionFormat().extension;
    if (state.outputs['audio-extract'] && priorExtension !== nextExtension) {
      delete state.outputs['audio-extract'];
      notify('Choose a new extraction destination', `The output format changed to .${nextExtension}, so the prior destination was cleared.`);
    }
    saveUi(); render();
  };
  const gifDither = $('#gif-dither'); if (gifDither) gifDither.onchange = () => { state.form.gifDither = gifDither.value; saveUi(); render(); };
  const thumbnailFormat = $('#thumb-format'); if (thumbnailFormat) thumbnailFormat.onchange = () => {
    state.form.thumbFormat = thumbnailFormat.value === 'png' ? 'png' : 'jpg';
    const expected = state.form.thumbFormat === 'png' ? new Set(['png']) : new Set(['jpg', 'jpeg']);
    if (state.outputs.thumbs && !expected.has(outputExtension(state.outputs.thumbs))) delete state.outputs.thumbs;
    saveUi(); render();
  };
  const trimMode = $('#trim-mode'); if (trimMode) trimMode.onchange = () => { state.form.trimMode = trimMode.value; saveUi(); render(); };
  const streamMode = $('#stream-mode'); if (streamMode) streamMode.onchange = () => { state.form.streamMode = streamMode.value; saveUi(); render(); };
  const streamRealtime = $('#stream-realtime'); if (streamRealtime) streamRealtime.onchange = () => { state.form.streamRealtime = streamRealtime.checked; saveUi(); updatePreviews(); };
  const streamLowLatency = $('#stream-low-latency'); if (streamLowLatency) streamLowLatency.onchange = () => { state.form.streamLowLatency = streamLowLatency.checked; saveUi(); updatePreviews(); };
  const trimNegative = $('#trim-negative'); if (trimNegative) trimNegative.onchange = () => { state.form.avoidNegative = trimNegative.checked; saveUi(); };

  $('#queue-convert')?.addEventListener('click', () => enqueue('convert', convertValues, state.outputs.convert?.name || 'Convert'));
  $('#queue-trim')?.addEventListener('click', queueTrim);
  $('#queue-filtergraph')?.addEventListener('click', () => enqueue('filtergraph', filtergraphValues, state.outputs.filters?.name || 'Filtergraph'));
  $('#queue-loudnorm')?.addEventListener('click', queueLoudnormAnalysis);
  $('#queue-extract')?.addEventListener('click', () => enqueue('extract', extractValues, state.outputs['audio-extract']?.name || 'Extract audio'));
  $('#queue-gif')?.addEventListener('click', () => enqueue('gif', gifValues, state.outputs.gif?.name || 'GIF'));
  $('#queue-thumbs')?.addEventListener('click', () => enqueue('thumbnails', thumbnailValues, state.outputs.thumbs?.name || 'Thumbnail'));
  $('#queue-stream')?.addEventListener('click', () => enqueue(state.form.streamMode === 'hls' ? 'hls' : 'stream', streamingValues, `${state.form.streamMode.toUpperCase()} output`));

  $('#add-video-filter')?.addEventListener('click', () => addFilterNode('video'));
  $('#add-audio-filter')?.addEventListener('click', () => addFilterNode('audio'));
  $$('[data-filter-index]').forEach((button) => button.onclick = () => { state.selectedFilter = Number(button.dataset.filterIndex); render(); });
  const filterKind = $('#filter-kind'); if (filterKind) filterKind.onchange = () => { const node = state.filters[state.selectedFilter]; if (!node) return; const kind = filterKind.value; const name = Object.keys(filtergraphCatalog[kind] || {})[0]; state.filters[state.selectedFilter] = { kind, name, options: defaultFilterOptions(kind, name) }; saveUi(); render(); };
  const filterName = $('#filter-name'); if (filterName) filterName.onchange = () => { const node = state.filters[state.selectedFilter]; if (!node) return; node.name = filterName.value; node.options = defaultFilterOptions(node.kind, node.name); saveUi(); render(); };
  $('#update-filter')?.addEventListener('click', () => { try { const draft = readFilterDraft(); validateFilterDraft(draft); state.filters[state.selectedFilter] = draft; saveUi(); render(); notify('Filter node updated', 'The validated options are now part of this ordered chain.'); } catch (error) { notify('Filter node not updated', error.message, 'error'); } });
  $('#filter-earlier')?.addEventListener('click', () => moveSelectedFilter(-1));
  $('#filter-later')?.addEventListener('click', () => moveSelectedFilter(1));
  $('#remove-filter')?.addEventListener('click', () => { state.filters.splice(state.selectedFilter,1); state.selectedFilter = clamp(state.selectedFilter,0,Math.max(0,state.filters.length-1)); saveUi(); render(); });

  $('#save-convert-preset')?.addEventListener('click', savePreset); $('#new-preset')?.addEventListener('click', savePreset);
  $$('.preset-use').forEach((button) => button.onclick = () => { Object.assign(state.form,state.presets[Number(button.dataset.index)]?.values || {}); go('convert'); });
  $$('.preset-edit').forEach((button) => button.onclick = () => { const preset = state.presets[Number(button.dataset.index)]; if (!preset) return; const name = prompt('Preset name',preset.name); if (name?.trim()) { preset.name = bounded(name.trim(),100); render(); } });
  $$('.preset-delete').forEach((button) => button.onclick = () => openConfirm('Delete this preset?', 'This removes the selected local preset.', () => { state.presets.splice(Number(button.dataset.index),1); render(); }));

  $('#inspect-pick')?.addEventListener('click', async () => { const files = await pickFile('inspector',{multiple:false,purpose:'probe'}); if (files.length) inspectSelected('inspector'); });
  $('#inspect-run')?.addEventListener('click', () => inspectSelected('inspector')); $$('.probe-export').forEach((button) => button.onclick = () => exportProbe(button.dataset.format));
  $('#refresh-runtime')?.addEventListener('click', refreshRuntime); $('#refresh-jobs')?.addEventListener('click', refreshJobs);
  $('#catalog-refresh')?.addEventListener('click', () => loadCatalog(CATALOG_KINDS[state.view],true)); $('#catalog-search')?.addEventListener('input', filterCatalog);
  $('#catalog-panel')?.addEventListener('click', () => window.optionGuides?.openCatalog?.({ kind: CATALOG_KINDS[state.view], emitSelection: false, closeOnSelect: false }));
  $('#matrix-search')?.addEventListener('input',(event)=>{$$('.matrix-entry').forEach((row)=>{row.hidden=!row.textContent.toLowerCase().includes(event.target.value.toLowerCase());});});
  $$('[data-catalog-index]').forEach((button) => button.onclick = () => openCatalogHelp(CATALOG_KINDS[state.view],Number(button.dataset.catalogIndex)));
  $$('.builder-button', $('#content')).forEach((button) => button.onclick = (event) => { event.preventDefault(); openRegex(); });

  $$('.job-select').forEach((check) => check.onchange = () => { check.checked ? state.selectedJobs.add(check.dataset.jobId) : state.selectedJobs.delete(check.dataset.jobId); render(); });
  $$('.job-focus').forEach((button) => button.onclick = () => { state.selectedJobId = button.dataset.jobId; render(); });
  $('#jobs-select-all')?.addEventListener('click', () => { state.jobs.forEach((job) => state.selectedJobs.add(job.id)); render(); }); $('#jobs-select-none')?.addEventListener('click', () => { state.selectedJobs.clear(); render(); });
  $('#jobs-pause')?.addEventListener('click', () => runJobAction('pause')); $('#jobs-resume')?.addEventListener('click', () => runJobAction('resume'));
  $('#jobs-cancel')?.addEventListener('click', () => openConfirm('Cancel selected jobs?', 'Running processes will receive a graceful cancellation request.', () => runJobAction('cancel')));
  $('#jobs-back')?.addEventListener('click', moveSelectedToBack); $('#clear-finished')?.addEventListener('click', clearFinished); $('#log-search')?.addEventListener('input', filterLogs);

  [['composer-global-args','composerGlobalArgs'],['composer-input-args','composerInputArgs'],['composer-args','composerArgs']].forEach(([id,key]) => {
    const control = $(`#${id}`);
    if (control) control.oninput = () => { state.form[key] = control.value.slice(0, COMPOSER_TEXT_LIMIT); saveUi(); updatePreviews(); };
  });
  const composerFormat = $('#composer-format'); if (composerFormat) composerFormat.onchange = () => { state.form.composerFormat = composerFormat.value; saveUi(); render(); };
  if ($('#composer-preview')) updatePreviews();
  $('#queue-composer')?.addEventListener('click', queueComposer);
  const converterTarget = $('#converter-target');
  if (converterTarget) converterTarget.onchange = () => {
    state.form.converterTarget = Object.hasOwn(CONVERTER_TARGETS, converterTarget.value) ? converterTarget.value : 'mp4';
    state.converterFiles.forEach(refreshConverterCompatibility);
    state.converterSummary = null;
    saveUi();
    render();
  };
  $('#converter-add')?.addEventListener('click', addConverterFiles); $('#queue-converter')?.addEventListener('click', queueConverterFiles);
  $$('.converter-remove').forEach((button) => button.onclick = async () => {
    const [removed] = state.converterFiles.splice(Number(button.dataset.index), 1);
    if (removed?.handle) {
      try { await apiCall('converter.releaseHandles', [removed.handle]); } catch { }
    }
    state.converterSummary = null;
    render();
  });

  $('#copy-current-command')?.addEventListener('click', () => navigator.clipboard.writeText(convertPreview()).then(() => notify('Copied','Command preview copied.')).catch((error) => notify('Copy failed',error.message,'error')));
  $('#theme-dark')?.addEventListener('click', () => { state.theme = 'dark'; render(); }); $('#theme-light')?.addEventListener('click', () => { state.theme = 'light'; render(); }); $('#logo-settings')?.addEventListener('click', openLogo);
  bindFunnyLevelControl('#setting-funny-en', '#setting-funny-en-output', '#setting-funny-en-preview', 'english');
  bindFunnyLevelControl('#setting-funny-yue', '#setting-funny-yue-output', '#setting-funny-yue-preview', 'cantonese');
  $('#reset-funny-levels')?.addEventListener('click', () => {
    state.settings.englishFunny = FUNNY_LEVEL_DEFAULT;
    state.settings.cantoneseFunny = FUNNY_LEVEL_DEFAULT;
    saveUi();
    notify('Funny levels reset', 'English and Cantonese are both set to level 5. Message facts remain unchanged.');
    render();
  });
  $('#save-settings')?.addEventListener('click', async () => {
    const requestedParallel = clamp($('#setting-parallel').value, 1, 4);
    try {
      const appliedParallel = await apiCall('jobs.setConcurrency', requestedParallel);
      state.settings.parallel = clamp(appliedParallel, 1, 4);
      state.settings.preferHardware = $('#setting-hardware').checked;
      state.settings.keepPassLogs = $('#setting-passlogs').checked;
      state.settings.notifyComplete = $('#setting-notify').checked;
      state.settings.englishFunny = normalizeFunnyLevel($('#setting-funny-en').value);
      state.settings.cantoneseFunny = normalizeFunnyLevel($('#setting-funny-yue').value);
      saveUi();
      notify('Settings saved', `The trusted scheduler now allows ${state.settings.parallel} parallel job${state.settings.parallel === 1 ? '' : 's'}.`);
      render();
    } catch (error) {
      notify('Settings not saved', error.message, 'error');
    }
  });
}

const go = (view) => { state.view = VIEWS[view] ? view : 'overview'; render(); };
function savePreset() {
  const name = prompt('Preset name', `Convert ${state.form.codec}`); if (!name?.trim()) return;
  const values = ['codec','container','crf','preset','tune','width','height','fps'].reduce((result,key) => { result[key] = state.form[key]; return result; },{});
  state.presets.push({ id: crypto.randomUUID?.() || String(Date.now()), name: bounded(name.trim(),100), values }); state.presets = state.presets.slice(-200); render();
}

async function inspectSelected(slot) {
  const file = state.inputs[slot]; if (!file) return notify('Choose a file','A real input is required before inspection.','error');
  const request = ++state.audioInspectionRequest;
  if (slot === 'audio') {
    state.audioProbeError = '';
    state.audioInspecting = true;
    state.audioStreams = [];
    render();
  } else {
    state.probe = null;
    state.probeError = '';
    state.probeExportError = '';
    render();
  }
  try {
    const result = await apiCall('probe.inspect', file.handle);
    if (request !== state.audioInspectionRequest || state.inputs[slot]?.handle !== file.handle) return;
    const streams = Array.isArray(result?.streams) ? result.streams : [];
    if (slot === 'audio') {
      state.audioStreams = streams.filter((stream) => stream.codec_type === 'audio').slice(0,128).map((stream,index) => ({
        id: stream.specifier || `0:a:${index}`,
        codec: bounded(stream.codec_name || '', 40),
        channels: Number.isInteger(Number(stream.channels)) ? clamp(Number(stream.channels), 1, 32) : 0,
        sampleRate: /^\d{1,6}$/u.test(String(stream.sample_rate || '')) ? Number(stream.sample_rate) : 0,
        language: bounded(stream.tags?.language || '', 24)
      }));
      if (!state.audioStreams.length) state.audioProbeError = 'The selected input contains no detected audio streams.';
      else if (!state.audioStreams.some((stream) => stream.id === state.form.audioStream)) state.form.audioStream = state.audioStreams[0].id;
    } else state.probe = result;
  } catch (error) {
    if (request !== state.audioInspectionRequest || state.inputs[slot]?.handle !== file.handle) return;
    if (slot === 'audio') state.audioProbeError = error.message;
    else { state.probe = null; state.probeError = error.message; }
  } finally {
    if (request === state.audioInspectionRequest) {
      if (slot === 'audio') state.audioInspecting = false;
      render();
    }
  }
}
async function exportProbe(format) {
  if (!state.probe || !state.inputs.inspector) return notify('Nothing to export','Inspect a file first.','error');
  if (!['json','csv','xml'].includes(format) || state.probeExportFormat) return;
  state.probeExportFormat = format; state.probeExportError = ''; render();
  try {
    const destination = normalizeFiles(await apiCall('files.save',{suggestedName:`ffprobe-inspection.${format}`,filters:[{name:`FFprobe ${format.toUpperCase()}`,extensions:[format]}]}))[0]; if (!destination) return;
    const result = await apiCall('probe.export', { fileHandle: state.inputs.inspector.handle, destinationHandle: destination.handle, format });
    notify('Export complete',`${format.toUpperCase()} inspection snapshot saved (${Number(result?.bytes) || 0} UTF-8 bytes).`);
  }
  catch (error) { state.probeExportError = bounded(error.message, 1000); notify('Export failed',state.probeExportError,'error'); }
  finally { state.probeExportFormat = ''; render(); }
}
async function loadCatalog(kind, force = false) {
  if (!CATALOG_KIND_SET.has(kind) || (state.catalogLoading[kind] && !force)) return;
  const available = Array.isArray(state.runtimeCatalog.kinds) ? new Set(state.runtimeCatalog.kinds) : null;
  if (available && !available.has(kind)) {
    state.catalogErrors[kind] = `The bundled runtime does not declare the ${kind} inventory.`;
    state.catalogs[kind] = [];
    state.catalogLoading[kind] = false;
    render();
    return;
  }
  const request = (state.catalogRequestEpoch[kind] || 0) + 1;
  state.catalogRequestEpoch[kind] = request;
  state.catalogLoading[kind] = true;
  delete state.catalogErrors[kind];
  render();
  try {
    const result = await apiCall('catalog.list', kind, { limit: CATALOG_RESULT_LIMIT, refresh: force });
    if (state.catalogRequestEpoch[kind] !== request) return;
    const source = Array.isArray(result) ? result : result?.entries || result?.items || [];
    state.catalogs[kind] = source.slice(0, CATALOG_RESULT_LIMIT);
    state.catalogMeta[kind] = {
      total: Number.isFinite(result?.total) ? result.total : source.length,
      limit: Number.isInteger(result?.limit) ? result.limit : CATALOG_RESULT_LIMIT,
      truncated: result?.truncated === true || source.length > CATALOG_RESULT_LIMIT
    };
    state.runtimeCatalog.counts = Object.assign({}, state.runtimeCatalog.counts, {
      [kind]: state.catalogMeta[kind].truncated ? `${state.catalogs[kind].length}+` : state.catalogs[kind].length
    });
  } catch (error) {
    if (state.catalogRequestEpoch[kind] !== request) return;
    state.catalogErrors[kind] = bounded(error.message, 1000);
    state.catalogs[kind] = [];
    state.catalogMeta[kind] = { total: 0, limit: CATALOG_RESULT_LIMIT, truncated: false };
  } finally {
    if (state.catalogRequestEpoch[kind] === request) {
      state.catalogLoading[kind] = false;
      render();
    }
  }
}
function filterCatalog() {
  const kind = CATALOG_KINDS[state.view];
  const input = $('#catalog-search');
  if (!kind || !input) return;
  const query = bounded(input.value, 500);
  state.catalogQueries[kind] = query;
  let shown = 0;
  $$('.registry-row','#catalog-results').forEach((row) => {
    row.hidden = !row.textContent.toLocaleLowerCase().includes(query.toLocaleLowerCase());
    if (!row.hidden) shown += 1;
  });
  const count = $('#catalog-count');
  if (count) count.textContent = `${shown} shown · ${(state.catalogs[kind] || []).length} loaded${state.catalogMeta[kind]?.truncated ? ` · bounded to ${state.catalogMeta[kind].limit || CATALOG_RESULT_LIMIT}` : ''}. Search filters only this local result.`;
}
function catalogHelpTarget(kind, entry) {
  const item = entry && typeof entry === 'object' ? entry : {};
  const direct = { encoders: 'encoder', decoders: 'decoder', filters: 'filter', protocols: 'protocol', bsfs: 'bsf' }[kind];
  if (direct) return { kind: direct, name: item.name };
  if (kind === 'codecs') {
    if (Array.isArray(item.encoders) && item.encoders[0]) return { kind: 'encoder', name: item.encoders[0] };
    if (Array.isArray(item.decoders) && item.decoders[0]) return { kind: 'decoder', name: item.decoders[0] };
    if (item.canEncode) return { kind: 'encoder', name: item.name };
    if (item.canDecode) return { kind: 'decoder', name: item.name };
  }
  if (kind === 'formats' || kind === 'devices') {
    if (item.muxing || String(item.flags || '').includes('E')) return { kind: 'muxer', name: item.name };
    if (item.demuxing || String(item.flags || '').includes('D')) return { kind: 'demuxer', name: item.name };
  }
  return null;
}
async function openCatalogHelp(kind,index) {
  const entry = state.catalogs[kind]?.[index], name = typeof entry === 'string' ? entry : entry?.name || entry?.id || entry?.key; if (!name) return;
  const target = catalogHelpTarget(kind, typeof entry === 'string' ? { name: entry } : entry);
  if (!target?.kind || !target.name) return notify('Help unavailable',`This FFmpeg inventory does not expose component help for ${kind}.`);
  try {
    const result = await apiCall('catalog.help', target.kind, target.name, { maxChars: 64 * 1024 });
    if (window.optionGuides?.openRuntimeHelp) return window.optionGuides.openRuntimeHelp({ kind:target.kind, name:target.name, help: result });
    if (window.optionGuides?.openCatalog) return window.optionGuides.openCatalog({ kind, helpKind:target.kind, initialItem:target.name, initialHelp:result, emitSelection:false, closeOnSelect:false });
    notify(target.name,bounded(typeof result === 'string' ? result : result?.text || JSON.stringify(result),500));
  } catch (error) { notify('Help unavailable',error.message,'error'); }
}
async function runJobAction(action) {
  const selected = state.jobs.filter((job) => state.selectedJobs.has(job.id));
  if (!selected.length) return notify('No jobs selected','Select at least one job.','error');
  const eligibleStatus = { pause: new Set(['running']), resume: new Set(['paused']), cancel: new Set(['queued', 'running', 'paused', 'cancelling', 'stopping']) }[action];
  if (!eligibleStatus) return notify('Job action unavailable',`The ${action} action is not supported.`,'error');
  const eligible = selected.filter((job) => eligibleStatus.has(job.status));
  const skipped = selected.filter((job) => !eligibleStatus.has(job.status));
  const results = await Promise.all(eligible.map(async (job) => {
    try { await apiCall(`jobs.${action}`,job.id); return { job, ok:true, error:'' }; }
    catch (error) { return { job, ok:false, error:bounded(error.message,300) }; }
  }));
  const succeeded = results.filter((result) => result.ok);
  const failed = results.filter((result) => !result.ok);
  state.selectedJobs = new Set([...skipped.map((job) => job.id), ...failed.map((result) => result.job.id)]);
  const summary = [`${succeeded.length} succeeded`, `${failed.length} failed`, `${skipped.length} skipped because their current state does not allow ${action}`];
  if (failed.length) summary.push(`Failures: ${failed.slice(0,5).map((result) => `${result.job.label}: ${result.error}`).join('; ')}`);
  notify(failed.length || skipped.length ? `${action} incomplete` : `${action} complete`, summary.join(' · '), failed.length ? 'error' : 'info');
  await refreshJobs();
}
async function moveSelectedToBack() {
  const selected = new Set(state.selectedJobs); if (!selected.size) return notify('No jobs selected','Select at least one job.','error');
  const selectedQueued = state.jobs.filter((job) => selected.has(job.id) && job.status === 'queued');
  const skipped = state.jobs.filter((job) => selected.has(job.id) && job.status !== 'queued');
  if (!selectedQueued.length) return notify('Nothing moved',`${skipped.length} selected job${skipped.length === 1 ? '' : 's'} cannot move because only queued jobs are reorderable.`,'error');
  const queuedSlots = state.jobs.map((job,index) => job.status === 'queued' ? index : -1).filter((index) => index >= 0);
  const queued = state.jobs.filter((job) => job.status === 'queued');
  const reorderedQueued = [...queued.filter((job) => !selected.has(job.id)), ...queued.filter((job) => selected.has(job.id))];
  const order = state.jobs.map((job) => job.id);
  queuedSlots.forEach((slot,index) => { order[slot] = reorderedQueued[index].id; });
  try {
    await apiCall('jobs.reorder',order);
    state.selectedJobs = new Set(skipped.map((job) => job.id));
    notify(skipped.length ? 'Reorder partially complete' : 'Queued jobs moved',`${selectedQueued.length} queued job${selectedQueued.length === 1 ? '' : 's'} moved to the back${skipped.length ? `; ${skipped.length} non-queued selection${skipped.length === 1 ? ' was' : 's were'} left in place` : ''}.`);
    await refreshJobs();
  } catch (error) { notify('Reorder failed',error.message,'error'); }
}
async function clearFinished() {
  const ids = state.jobs.filter((job) => ['completed','failed','cancelled','interrupted'].includes(job.status)).map((job) => job.id);
  if (!ids.length) return notify('Nothing to clear','No finished jobs are present.');
  openConfirm('Clear finished jobs?',`${ids.length} finished job records will be removed.`,async () => { try { await apiCall('jobs.clear',ids); notify('Finished jobs cleared',`${ids.length} finished job record${ids.length === 1 ? '' : 's'} removed.`); await refreshJobs(); } catch (error) { notify('Clear failed',error.message,'error'); } });
}
function filterLogs() {
  const selected = state.jobs.find((job) => job.id === state.selectedJobId) || state.jobs[0], query = $('#log-search').value.toLowerCase();
  $('#log-pane').replaceChildren(...(selected?.logs || []).filter((line) => line.toLowerCase().includes(query)).map((line) => { const div = document.createElement('div'); div.textContent = displayText(line, 'job file'); return div; }));
}
async function addConverterFiles() {
  if (state.converterBusy) return;
  if (!state.runtime.available) return notify('Bundled runtime unavailable',state.runtime.error || 'The bundled FFmpeg and FFprobe runtime is unavailable.','error');
  state.converterBusy = true;
  state.converterSummary = null;
  render();
  try {
    const result = await apiCall('converter.selectInputs');
    if (result?.canceled) return;
    const inspected = normalizeConverterItems(result?.items);
    const remaining = Math.max(0, MAX_CONVERTER_FILES - state.converterFiles.length);
    const accepted = inspected.slice(0, remaining);
    const overflow = inspected.slice(remaining);
    state.converterFiles.push(...accepted);
    const rejected = Array.isArray(result?.rejected) ? result.rejected.length : 0;
    if (overflow.length) {
      try { await apiCall('converter.releaseHandles', overflow.map((file) => file.handle)); } catch { }
    }
    const inspectionFailures = accepted.filter((file) => file.status === 'inspection-failed').length;
    const notMedia = accepted.filter((file) => file.status === 'unsupported').length;
    const omitted = rejected + overflow.length;
    if (inspectionFailures || notMedia || omitted) {
      notify('Batch inspection completed', `${accepted.length} added; ${inspectionFailures} inspection failures, ${notMedia} unsupported inputs, and ${omitted} selections omitted.`, 'error');
    } else if (accepted.length) {
      notify('Batch inspection completed', `${accepted.length} files were inspected through the bounded FFprobe route.`);
    }
  } catch (error) {
    notify('Batch selection failed',error.message,'error');
  } finally {
    state.converterBusy = false;
    render();
  }
}
async function queueConverterFiles() {
  if (state.converterBusy) return;
  const files = state.converterFiles.filter((file) => file.supported); if (!files.length) return notify('No supported files','Add at least one inspected file compatible with the selected target.','error');
  if (!state.runtime.available) return notify('Bundled runtime unavailable',state.runtime.error || 'The bundled FFmpeg runtime is unavailable.','error');
  const target = currentConverterTarget();
  const definition = CONVERTER_TARGETS[target];
  state.converterBusy = true;
  state.converterSummary = null;
  render();
  try {
    const prepared = await apiCall('converter.prepareOutputs', { target, inputHandles: files.map((file) => file.handle) });
    if (prepared?.canceled) {
      notify('Batch not queued','No destination folder was selected; the queue and original files were unchanged.');
      return;
    }
    if (prepared?.target !== target || prepared?.adapter !== definition.adapter) throw new Error('The prepared converter target did not match the selected adapter.');
    const preparedOutputs = Array.isArray(prepared.outputs) ? prepared.outputs : [];
    const outputByInput = new Map();
    for (const entry of preparedOutputs) {
      if (!entry || !HANDLE_RE.test(String(entry.inputHandle || ''))) continue;
      const output = normalizeFiles(entry.output)[0];
      if (output?.kind === 'output') outputByInput.set(String(entry.inputHandle), output);
    }

    const succeeded = new Set();
    const failures = [];
    const outputHandles = [];
    for (const file of files) {
      const output = outputByInput.get(file.handle);
      if (!output) {
        const preparedFailure = Array.isArray(prepared.failures) ? prepared.failures.find((entry) => entry?.inputHandle === file.handle) : null;
        failures.push({ file, error: bounded(preparedFailure?.error || 'No trusted output handle was prepared for this input.', 500) });
        continue;
      }
      outputHandles.push(output.handle);
      const outputKey = `converter-${file.handle}`;
      state.outputs[outputKey] = output;
      try {
        const argv = build('converter',{ input:file.handle, output:output.handle, adapter:definition.adapter, overwrite:false });
        await apiCall('jobs.enqueue',{label:`${file.name} → ${target}`,args:runtimeArgs(argv)});
        succeeded.add(file.handle);
      } catch (error) {
        failures.push({ file, error: bounded(error.message, 500) });
      } finally {
        delete state.outputs[outputKey];
      }
    }

    try { await apiCall('converter.releaseHandles', [...outputHandles, ...succeeded]); } catch { }
    const skipped = state.converterFiles.length - files.length;
    state.converterFiles = state.converterFiles.filter((file) => !succeeded.has(file.handle));
    state.converterFiles.forEach(refreshConverterCompatibility);
    state.converterSummary = {
      target,
      destinationName: bounded(prepared.destinationName || '', 255),
      queued: succeeded.size,
      failed: failures.length,
      skipped
    };
    if (failures.length || skipped) {
      const firstFailure = failures[0];
      const detail = firstFailure ? ` First failure: ${displayText(firstFailure.file.name, 'input file')}: ${displayText(firstFailure.error, 'job error')}` : '';
      notify('Batch partially queued',`${succeeded.size} queued, ${failures.length} failed to queue, and ${skipped} unsupported files were skipped.${detail}`,'error');
    } else {
      notify('Batch queued',`${succeeded.size} conversion jobs were added without overwriting existing files.`);
    }
    if (succeeded.size && !failures.length && !skipped) state.view = 'jobs';
    await refreshJobs();
  } catch (error) {
    notify('Batch queueing failed',error.message,'error');
  } finally {
    state.converterBusy = false;
    render();
  }
}
async function refreshRuntime() {
  state.runtime.loading = true; state.runtime.error = ''; render();
  try {
    const [status,catalog] = await Promise.all([apiCall('runtime.status'),apiCall('runtime.catalog')]);
    state.runtime = {
      available: status?.ready === true,
      loading: false,
      version: bounded(status?.version || status?.ffmpegVersion || '', 100),
      ffmpegVersion: bounded(status?.ffmpegVersion || status?.version || '', 100),
      ffprobeVersion: bounded(status?.ffprobeVersion || '', 100),
      ffmpegVersionFull: String(status?.ffmpegVersionFull || ''),
      ffprobeVersionFull: String(status?.ffprobeVersionFull || ''),
      configuration: String(status?.configuration || ''),
      ffmpegAvailable: status?.ffmpegAvailable === true,
      ffprobeAvailable: status?.ffprobeAvailable === true,
      origin: bounded(status?.origin || '', 100),
      locationMode: bounded(status?.locationMode || '', 100),
      locationRootId: bounded(status?.locationRootId || '', 100),
      locationsChecked: Number.isInteger(status?.locationsChecked) ? status.locationsChecked : 0,
      reasonId: bounded(status?.reasonId || '', 200),
      error: bounded(status?.error || (!status?.ready ? 'Bundled FFmpeg or ffprobe is unavailable.' : ''), 500)
    };
    state.runtimeCatalog = catalog && typeof catalog === 'object' ? catalog : {};
  } catch (error) {
    state.runtime = Object.assign({}, state.runtime, { available: false, loading: false, version: '', ffmpegVersion: '', ffprobeVersion: '', error: bounded(error.message, 500) });
  }
  render();
}

function notify(title,body,type='info') {
  const item = { id: String(Date.now()) + Math.random().toString(16).slice(2), title:bounded(displayText(title, 'notification'),100), body:bounded(displayText(body, 'notification detail'),1000), type, at:new Date().toISOString() };
  state.notifications.unshift(item); state.notifications = state.notifications.slice(0,200); store.set('notifications',state.notifications);
  const toast = document.createElement('div'); toast.className = 'toast'; const heading = document.createElement('b'); heading.textContent = item.title; const copy = document.createElement('small'); copy.textContent = item.body; toast.append(heading,copy); $('#toast-zone').append(toast); setTimeout(() => toast.remove(), type === 'error' ? 12000 : 6000);
}
function openNotifications() {
  const list = $('#notification-list'), search = $('#notification-search');
  const draw = () => {
    const query = search.value.toLowerCase(); list.replaceChildren(); const items = state.notifications.filter((item) => `${displayText(item.title, 'notification')} ${displayText(item.body, 'notification detail')}`.toLowerCase().includes(query));
    if (!items.length) { const empty=document.createElement('p'); empty.className='hint'; empty.textContent='No matching notifications.'; list.append(empty); return; }
    items.forEach((item) => { const row=document.createElement('div'); row.className='list-item'; const text=document.createElement('span'); text.style.flex='1'; const title=document.createElement('b'); title.textContent=displayText(item.title, 'notification'); const body=document.createElement('small'); body.textContent=displayText(item.body, 'notification detail'); const at=document.createElement('small'); at.textContent=item.at; text.append(title,document.createElement('br'),body,document.createElement('br'),at); row.append(text); list.append(row); });
  };
  search.value=''; search.oninput=draw; draw(); $('#notification-clear').onclick=()=>openConfirm('Clear notification history?','All locally stored notifications will be removed.',()=>{state.notifications=[];store.set('notifications',[]);draw();}); $('#notification-dialog').showModal();
}
function openPalette() {
  const items = Object.values(GROUPS).flatMap((group) => group.items.map(([id,,label]) => ({label:`Go to ${label}`,sub:group.title,run:()=>go(id)})));
  items.push({label:'Toggle theme',sub:'Setting',run:()=>{state.theme=state.theme==='dark'?'light':'dark';render();}},{label:'Customize app logo',sub:'Setting',run:openLogo},{label:'Refresh runtime',sub:'Action',run:refreshRuntime});
  const list=$('#command-list'), search=$('#command-search');
  const draw=()=>{const q=search.value.toLowerCase(), matches=items.filter((item)=>`${item.label} ${item.sub}`.toLowerCase().includes(q)); list.replaceChildren(...matches.map((item)=>{const button=document.createElement('button');button.className='command';button.type='button';const label=document.createElement('b');label.textContent=item.label;const sub=document.createElement('small');sub.textContent=item.sub;button.append(label,document.createElement('br'),sub);button.onclick=()=>{$('#command-dialog').close();item.run();};return button;}));};
  search.value=''; search.oninput=draw; draw(); $('#command-dialog').showModal(); search.focus();
}

let confirmAction = null;
function openConfirm(title,copy,onConfirm) {
  const dialog=$('#confirm-dialog'), keys={a:false,l:false}, slider=$('#confirm-slider'), goButton=$('#confirm-go'); confirmAction=onConfirm;
  $('#confirm-title').textContent=title; $('#confirm-copy').textContent=copy; slider.value=0; slider.disabled=true; goButton.disabled=true; $('#confirm-progress').style.width='0%';
  $$('.key-row button',dialog).forEach((button)=>{button.classList.remove('ready');button.onclick=()=>{keys[button.dataset.key]=true;button.classList.add('ready');slider.disabled=!(keys.a&&keys.l);};});
  slider.oninput=()=>{$('#confirm-progress').style.width=`${slider.value}%`;goButton.disabled=Number(slider.value)<100;};
  goButton.onclick=(event)=>{event.preventDefault();dialog.close();const action=confirmAction;confirmAction=null;if(action)action();}; dialog.showModal();
}
function openLogo() {
  const presets=$('#logo-presets'); presets.replaceChildren(...['M','F','▶','◆'].map((glyph)=>{const button=document.createElement('button');button.type='button';button.textContent=glyph;button.className='logo-preset';button.onclick=()=>{state.logo={glyph,image:''};render();openLogo();};return button;}));
  $('#logo-upload').onchange=async(event)=>{const file=event.target.files?.[0];if(!file)return;if(file.size>1048576||!['image/png','image/svg+xml'].includes(file.type))return notify('Logo rejected','Choose a PNG or SVG no larger than 1 MB.','error');const reader=new FileReader();reader.onload=()=>{state.logo={glyph:'',image:String(reader.result)};render();notify('Logo applied','The local image now appears in app chrome.');};reader.onerror=()=>notify('Logo failed','The selected file could not be read.','error');reader.readAsDataURL(file);};
  $('#logo-reset').onclick=(event)=>{event.preventDefault();state.logo={glyph:'M',image:''};render();openLogo();}; $('#logo-dialog').showModal();
}
function applyAppearance() {
  const appearance=state.settings.appearance||{};const root=document.documentElement;
  root.style.setProperty('--accent',appearance.accent||'');root.style.fontSize=`${clamp(appearance.scale||1,.9,1.3)*14}px`;document.body.style.fontFamily=appearance.font||'';document.body.style.fontWeight=String(clamp(appearance.weight||400,300,700));
}
function openAppearance(target='Application') {
  const appearance=state.settings.appearance||{};$('#appearance-target').textContent=`Target: ${target}`;$('#appearance-theme').value=state.theme;$('#appearance-accent').value=appearance.accent||'#82d5cc';$('#appearance-font').value=appearance.font||'Segoe UI';$('#appearance-scale').value=appearance.scale||1;$('#appearance-weight').value=appearance.weight||400;$('#appearance-dialog').showModal();
}
function openTabManager() {
  const list=$('#tab-manager-list');
  const draw=()=>{const query=$('#tab-current-search').value.toLowerCase();list.replaceChildren();state.tabs.filter((tab)=>`${tab.label} ${tab.group}`.toLowerCase().includes(query)).forEach((tab)=>{const row=document.createElement('div');row.className='list-item';const label=document.createElement('b');label.textContent=tab.label;label.style.flex='1';const pin=document.createElement('button');pin.textContent=tab.pinned?'Unpin':'Pin';pin.onclick=()=>{tab.pinned=!tab.pinned;saveUi();draw();};const group=document.createElement('input');group.value=tab.group||'';group.setAttribute('aria-label',`Group for ${tab.label}`);group.onchange=()=>{tab.group=bounded(group.value,80);saveUi();};const close=document.createElement('button');close.textContent='×';close.disabled=tab.pinned;close.onclick=()=>{state.tabs=state.tabs.filter((item)=>item.id!==tab.id);saveUi();draw();render();};row.append(label,group,pin,close);list.append(row);});};
  $('#tab-current-search').value='';$('#tab-current-search').oninput=draw;$('#tab-master-search').oninput=draw;draw();
  const containing=$('#tab-close-containing'), excluding=$('#tab-close-not-containing'), preview=$('#tab-close-preview'), apply=$('#apply-tab-close'); let previewIds=[];
  $('#preview-tab-close').onclick=()=>{const inc=containing.value.trim().toLowerCase(),exc=excluding.value.trim().toLowerCase();previewIds=state.tabs.filter((tab)=>!tab.pinned&&((inc&&tab.label.toLowerCase().includes(inc))||(exc&&!tab.label.toLowerCase().includes(exc)))).map((tab)=>tab.id);preview.textContent=`${previewIds.length} unpinned tabs would close.`;apply.disabled=!previewIds.length;};
  apply.onclick=()=>openConfirm('Close previewed tabs?',`${previewIds.length} unpinned tabs will close.`,()=>{state.tabs=state.tabs.filter((tab)=>!previewIds.includes(tab.id));saveUi();draw();render();});
  $('#tab-dialog').showModal();
}

const REGEX_TOKENS = ['\\d','\\w','\\s','[a-z]','^','$','+','*','?','{2,4}','|','()','(?:)','\\b','.','\\.'];
function openRegex() {
  const dialog=$('#regex-dialog'), pattern=$('#regex-pattern'), flags=$('#regex-flags'), sample=$('#regex-sample'), preview=$('#regex-preview');
  $('#regex-tokens').replaceChildren(...REGEX_TOKENS.map((token)=>{const button=document.createElement('button');button.type='button';button.className='tok-btn';button.textContent=token;button.onclick=()=>{pattern.value+=token;update();};return button;}));
  $('#regex-recipes').replaceChildren(); $('#regex-flag-btns').replaceChildren(...['i','g','m','u'].map((flag)=>{const button=document.createElement('button');button.type='button';button.className=`flag-btn${flags.value.includes(flag)?' active':''}`;button.textContent=flag;button.onclick=()=>{flags.value=flags.value.includes(flag)?flags.value.replace(flag,''):flags.value+flag;openRegex();};return button;}));
  const update=()=>{try{const re=new RegExp(pattern.value,flags.value.replace('g',''));const words=sample.value.split(/\s+/).filter((word)=>re.test(word));preview.textContent=words.length?`Matches: ${words.join(', ')}`:'No matches in sample.';$('#regex-explain').textContent='Pattern is valid and evaluated locally.';}catch(error){preview.textContent=`Invalid pattern: ${error.message}`;$('#regex-explain').textContent='Fix the pattern before applying it.';}};
  pattern.oninput=update;sample.oninput=update;update();if(!dialog.open)dialog.showModal();
}

function filterJobEvent(payload) {
  if (!payload) return;
  if (payload.type === 'state-error') {
    state.queueError = bounded(payload.error || 'The saved queue state could not be loaded.', 1000);
    notify('Queue state unavailable', state.queueError, 'error');
    render();
    return;
  }
  if (payload.type === 'concurrency-changed') {
    state.queueConcurrency = clamp(payload.concurrency, 1, 4);
    if (state.view === 'jobs' || state.view === 'overview') render();
    return;
  }
  if (Array.isArray(payload.jobs)) {
    reconcileJobs(payload.jobs.slice(0,1000).map(normalizeJob));
    void reconcileLoudnormJobs();
  }
  else if (payload.type === 'cleared' && Array.isArray(payload.ids)) {
    const cleared=new Set(payload.ids.map(String));
    reconcileJobs(state.jobs.filter((job)=>!cleared.has(job.id)));
    const abandoned=[...cleared].filter((id)=>state.loudnormPending[id]);
    abandoned.forEach((id)=>delete state.loudnormPending[id]);
    if(abandoned.length){saveLoudnormPending();notify('Two-pass normalization stopped',`${abandoned.length} saved pass 1 job${abandoned.length===1?' was':'s were'} cleared before pass 2 could start.`,'error');}
  }
  else if (payload.job && typeof payload.job === 'object') {
    const normalized=normalizeJob(payload.job,0), jobs=[...state.jobs], index=jobs.findIndex((job)=>job.id===normalized.id);
    if(index>=0) jobs[index]=normalized; else jobs.push(normalized);
    reconcileJobs(jobs);
    void reconcileLoudnormJob(normalized);
  }
  else return;
  state.queueError = '';
  const raw=payload.job;
  if(state.settings.notifyComplete&&raw&&['completed','failed','cancelled','interrupted'].includes(raw.status)) {
    const failure = raw.error || (Number.isInteger(raw.exitCode) ? `exit ${raw.exitCode}` : 'no additional failure detail was reported');
    notify('Job updated',`${raw.label||'Job'}: ${raw.status}${raw.status === 'failed' ? ` · ${failure}` : ''}`,raw.status==='failed'?'error':'info');
  }
  render();
}

$('#theme-toggle').onclick=()=>{state.theme=state.theme==='dark'?'light':'dark';render();}; $('#notification-open').onclick=openNotifications; $('#logo-open').onclick=openLogo; $('#open-composer').onclick=()=>go('composer');
$('#copy-command').onclick=()=>navigator.clipboard.writeText($('#live-command').textContent).then(()=>notify('Copied','Command preview copied.')).catch((error)=>notify('Copy failed',error.message,'error'));
$$('.title-actions [data-window]').forEach((button)=>button.onclick=()=>window.api?.window?.[button.dataset.window]?.());
document.addEventListener('click',(event)=>{if(event.target.closest('#tab-list'))openTabManager();if(event.target.closest('#tab-add')){const current=Object.values(GROUPS).flatMap((group)=>group.items).find((item)=>item[0]===state.view);if(current&&!state.tabs.some((tab)=>tab.id===state.view)){state.tabs.push({id:state.view,label:current[2],icon:current[1],pinned:false,group:GROUPS[groupFor(state.view)].title});render();}}});
let tabContextMenuActions = [];
function closeTabContextMenu() {
  const menu = $('#ctx-menu');
  menu.hidden = true;
  tabContextMenuActions = [];
}
function openArchiveContextMenu(event, title, actions) {
  event.preventDefault();
  event.stopPropagation();
  const menu = $('#ctx-menu');
  tabContextMenuActions = actions;
  menu.replaceChildren();
  const header = document.createElement('header');
  header.textContent = title || 'Element';
  menu.append(header);
  tabContextMenuActions.forEach((action, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.contextAction = String(index);
    button.textContent = action.label;
    menu.append(button);
  });
  menu.hidden = false;
  menu.style.left = `${Math.max(0, event.clientX)}px`;
  menu.style.top = `${Math.max(0, event.clientY)}px`;
  requestAnimationFrame(() => menu.dispatchEvent(new CustomEvent('archive-context-menu-opened')));
}
document.addEventListener('contextmenu', (event) => {
  const tab = event.target.closest('.tab');
  if (tab) {
    const id = tab.dataset.tabId;
    const item = state.tabs.find((entry) => entry.id === id);
    if (!item) return;
    return openArchiveContextMenu(event, item.label, [
      { label: 'Pin or unpin', run: () => { item.pinned = !item.pinned; render(); } },
      { label: 'Duplicate', run: () => { if (!state.tabs.some((entry) => entry.id === `${id}-copy`)) state.tabs.push({ ...item, id: `${id}-copy`, view: item.view || item.id, label: `${item.label} copy`, pinned: false }); render(); } },
      { label: 'Move to group', run: openTabManager }, { label: 'Edit appearance', run: () => openAppearance(item.label) },
      { label: 'Close', run: () => { if (!item.pinned) { state.tabs = state.tabs.filter((entry) => entry !== item); render(); } } }
    ]);
  }
  const registryRow = event.target.closest('.registry-row');
  if (registryRow) {
    const index = Number(registryRow.dataset.catalogIndex);
    const title = registryRow.querySelector('b')?.textContent || 'Registry entry';
    return openArchiveContextMenu(event, title, [
      { label: 'Open option details', run: () => Number.isInteger(index) && openCatalogHelp(CATALOG_KINDS[state.view], index) },
      { label: 'Copy name', run: () => navigator.clipboard.writeText(title).catch(() => notify('Copy failed', 'The registry name could not be copied.', 'error')) },
      { label: 'Edit appearance', run: () => openAppearance(title) }
    ]);
  }
  const jobRow = event.target.closest('.job-row');
  if (jobRow) {
    const id = jobRow.dataset.jobId;
    const job = state.jobs.find((entry) => entry.id === id);
    if (!job) return;
    return openArchiveContextMenu(event, displayText(job.label, 'job'), [
      { label: 'Open job log', run: () => { state.selectedJobId = job.id; go('jobs'); } },
      { label: 'Move queued job to back', run: () => { if (job.status === 'queued') { state.selectedJobs = new Set([job.id]); moveSelectedToBack(); } } },
      { label: 'Edit appearance', run: () => openAppearance(displayText(job.label, 'job')) }
    ]);
  }
  const host = event.target.closest('button,label,h1,h2,h3,pre,input,select,.card,.list-item') || event.target;
  const title = ((host.innerText || host.value || host.tagName || 'Element').trim().split('\n')[0] || 'Element').slice(0, 42);
  openArchiveContextMenu(event, title, [{ label: 'Edit appearance', run: () => openAppearance(title) }]);
});
$('#ctx-menu').addEventListener('pointerdown', (event) => event.stopPropagation());
$('#ctx-menu').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-context-action]');
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  const action = tabContextMenuActions[Number(button.dataset.contextAction)];
  closeTabContextMenu();
  action?.run();
});
document.addEventListener('pointerdown', (event) => {
  if (!event.target.closest('#ctx-menu')) closeTabContextMenu();
});
window.addEventListener('resize', closeTabContextMenu);
$('#ctx-menu').addEventListener('archive-context-menu-opened', () => {
  const menu = $('#ctx-menu');
  const bounds = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(0, Math.min(bounds.left, innerWidth - bounds.width))}px`;
  menu.style.top = `${Math.max(0, Math.min(bounds.top, innerHeight - bounds.height))}px`;
});
$$('.builder-button').forEach((button)=>button.onclick=(event)=>{event.preventDefault();openRegex();});
$('#appearance-apply').onclick=(event)=>{event.preventDefault();state.theme=$('#appearance-theme').value;state.settings.appearance={accent:$('#appearance-accent').value,font:$('#appearance-font').value,scale:Number($('#appearance-scale').value),weight:Number($('#appearance-weight').value),radius:Number($('#appearance-radius').value)};saveUi();$('#appearance-dialog').close();render();};
$('#appearance-reset').onclick=()=>{delete state.settings.appearance;saveUi();applyAppearance();$('#appearance-dialog').close();render();};
window.addEventListener('keydown',(event)=>{if(event.ctrlKey&&event.shiftKey&&event.key.toLowerCase()==='f'){event.preventDefault();openPalette();}});

async function initialize() {
  restoreLoudnormPending();
  render();
  if (state.loudnormRecoveryNotice) notify('Saved loudness workflow state was not fully restored', state.loudnormRecoveryNotice, 'error');
  try { const unsubscribe=window.api?.jobs?.onEvent?.(filterJobEvent); if(typeof unsubscribe==='function')window.addEventListener('beforeunload',unsubscribe,{once:true}); }
  catch(error){state.queueError=bounded(error.message,1000);notify('Live job updates unavailable',error.message,'error');}
  try { state.settings.parallel = clamp(await apiCall('jobs.setConcurrency', state.settings.parallel), 1, 4); saveUi(); }
  catch(error){notify('Parallel-job setting unavailable',error.message,'error');}
  await Promise.all([refreshRuntime(),refreshJobs()]);
}
window.state=state; window.save=saveUi; window.render=render; window.openRegex=openRegex; initialize();
