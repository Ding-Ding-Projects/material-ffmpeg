/* material-ffmpeg renderer — runtime state only; this process never executes a shell. */
'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const bounded = (value, max = 500) => String(value ?? '').slice(0, max);
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const HANDLE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const DERIVED_OUTPUT_MARKER = '__DERIVED_OUTPUT__';
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
    parallel: clamp(input.parallel ?? DEFAULT_SETTINGS.parallel, 1, 8),
    preferHardware: input.preferHardware !== false,
    keepPassLogs: Boolean(input.keepPassLogs),
    notifyComplete: input.notifyComplete !== false,
    englishFunny: normalizeFunnyLevel(input.englishFunny),
    cantoneseFunny: normalizeFunnyLevel(input.cantoneseFunny)
  });
};

const state = {
  view: 'overview', theme: store.get('theme', 'dark'), logo: store.get('logo', { glyph: 'M', image: '' }),
  runtime: { available: false, loading: true, version: '', error: '' }, runtimeCatalog: {},
  jobs: [], selectedJobs: new Set(), selectedJobId: '', catalogs: {}, catalogErrors: {}, catalogLoading: {},
  inputs: {}, outputs: {}, probe: null, probeError: '', audioStreams: [],
  filters: store.get('filters', [{ name: 'scale', options: '1920:-2' }]), selectedFilter: 0,
  presets: store.get('presets', []), converterFiles: [], tabs: normalizeTabs(store.get('tabs', DEFAULT_TABS)),
  notifications: store.get('notifications', []),
  settings: normalizeSettings(store.get('settings', {})),
  loudnormPending: {},
  form: Object.assign({
    codec: 'libx264', container: 'mp4', crf: 20, preset: 'medium', tune: 'none', width: 1920, height: -2, fps: '',
    trimStart: '00:00:00.000', trimEnd: '', trimDuration: '00:00:10.000', trimMode: 'copy', avoidNegative: true,
    trimVideoCodec: 'libx264', trimAudioCodec: 'aac', trimCrf: 20, trimPreset: 'medium',
    loudness: -16, lra: 11, truePeak: -1.5, loudnormCodec: 'flac', audioCodec: 'copy', audioStream: '0:a:0',
    gifFps: 15, gifWidth: 640, gifColors: 128, thumbTime: '00:00:00.000',
    streamMode: 'hls', streamTarget: '', hlsTime: 6, hlsList: 6,
    composerArgs: '-c:v\nlibx264\n-c:a\naac', converterTarget: 'mp4'
  }, store.get('form', {}))
};

const saveUi = () => {
  store.set('theme', state.theme); store.set('logo', state.logo); store.set('tabs', state.tabs);
  store.set('presets', state.presets); store.set('filters', state.filters);
  store.set('settings', state.settings); store.set('form', state.form);
};

const GROUPS = {
  overview: { title: 'Home', items: [['overview', 'dashboard', 'Overview'], ['jobs', 'receipt_long', 'Jobs & logs'], ['settings', 'settings', 'Settings']] },
  media: { title: 'Media', items: [['convert', 'sync_alt', 'Convert'], ['trim', 'content_cut', 'Trim & clip'], ['filters', 'account_tree', 'Filtergraph'], ['audio', 'graphic_eq', 'Audio'], ['gif', 'gif_box', 'GIF & thumbs'], ['presets', 'bookmarks', 'Presets'], ['inspector', 'search_insights', 'Inspector']] },
  registry: { title: 'Registry', items: [['codecs', 'memory', 'Codecs'], ['formats', 'folder_zip', 'Formats'], ['protocols', 'lan', 'Protocols'], ['bsf', 'swap_horiz', 'Bitstream filters'], ['devices', 'videocam', 'Devices'], ['matrix', 'grid_on', 'Capability matrix']] },
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
const CATALOG_KINDS = { codecs: 'codecs', formats: 'formats', protocols: 'protocols', bsf: 'bsfs', devices: 'devices' };
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
const commandPreview = (argv) => ['ffmpeg', ...(Array.isArray(argv) ? argv : [])].map(quotePreview).join(' ');
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
  return argv.slice(0, 512).map((arg) => bounded(arg, 4096));
}
const allFiles = () => [...Object.values(state.inputs), ...Object.values(state.outputs), ...state.converterFiles].filter(Boolean);
const runtimeArgs = (argv) => {
  const handles = new Map(allFiles().map((file) => [file.handle, file]));
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
const outputOptions = (slot) => {
  const selectedInput = state.inputs[slot];
  const definitions = {
    convert: { extension: state.form.container, label: state.form.container.toUpperCase() },
    trim: { extension: 'mp4', label: 'MP4 video' },
    filters: { extension: 'mp4', label: 'MP4 video' },
    'audio-normalize': { extension: state.form.loudnormCodec === 'aac' ? 'm4a' : state.form.loudnormCodec === 'libopus' ? 'opus' : state.form.loudnormCodec.startsWith('pcm_') ? 'wav' : state.form.loudnormCodec, label: 'Normalized audio' },
    'audio-extract': { extension: state.form.audioCodec === 'aac' ? 'm4a' : state.form.audioCodec === 'libopus' ? 'opus' : state.form.audioCodec.startsWith('pcm_') ? 'wav' : state.form.audioCodec === 'copy' ? (selectedInput?.name?.split('.').pop()?.toLowerCase() || 'mka') : state.form.audioCodec, label: 'Extracted audio' },
    gif: { extension: 'gif', label: 'GIF image' },
    thumbs: { extension: 'jpg', label: 'JPEG image' },
    streaming: { extension: 'm3u8', label: 'HLS playlist' },
    composer: { extension: 'mp4', label: 'Media output' }
  };
  const definition = definitions[slot] || { extension: 'mp4', label: 'Media output' };
  const source = slot.startsWith('audio-') ? state.inputs.audio : selectedInput;
  return {
    suggestedName: `${fileStem(source)}-${slot.replace(/^audio-/u, '')}.${definition.extension}`,
    filters: [{ name: definition.label, extensions: [definition.extension] }]
  };
};
const outputExtension = (file) => file?.name?.includes('.') ? file.name.split('.').pop().toLowerCase() : '';
const requireExtension = (file, extensions, label) => {
  if (!file) throw new Error(`Choose the ${label} destination first.`);
  const accepted = new Set(extensions.map((extension) => extension.toLowerCase()));
  if (!accepted.has(outputExtension(file))) throw new Error(`${label} must use ${[...accepted].map((extension) => `.${extension}`).join(' or ')}.`);
  return file;
};
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
const trimValues = () => ({
  input: state.inputs.trim?.handle,
  output: requireExtension(state.outputs.trim, ['mp4','mkv','mov','webm','m4v','ts'], 'trim output').handle,
  start: state.form.trimStart || undefined,
  end: state.form.trimEnd || undefined,
  duration: state.form.trimEnd ? undefined : state.form.trimDuration || undefined,
  mode: state.form.trimMode,
  videoCodec: state.form.trimMode === 'reencode' ? state.form.trimVideoCodec : undefined,
  audioCodec: state.form.trimMode === 'reencode' ? state.form.trimAudioCodec : undefined,
  crf: state.form.trimMode === 'reencode' ? state.form.trimCrf : undefined,
  preset: state.form.trimMode === 'reencode' ? state.form.trimPreset : undefined,
  avoidNegativeTs: state.form.avoidNegative ? 'make_zero' : 'disabled'
});
const filtergraphValues = () => {
  const videoGraph = state.filters.filter((node) => (node.kind || (['loudnorm', 'atempo'].includes(node.name) ? 'audio' : 'video')) === 'video')
    .map((node) => node.options ? `${node.name}=${node.options}` : node.name).join(',');
  const audioGraph = state.filters.filter((node) => (node.kind || (['loudnorm', 'atempo'].includes(node.name) ? 'audio' : 'video')) === 'audio')
    .map((node) => node.options ? `${node.name}=${node.options}` : node.name).join(',');
  return {
    input: state.inputs.filters?.handle,
    output: requireExtension(state.outputs.filters, ['mp4','mkv','mov'], 'filtergraph output').handle,
    videoGraph: videoGraph || undefined,
    audioGraph: audioGraph || undefined,
    videoCodec: videoGraph ? 'libx264' : 'copy',
    audioCodec: audioGraph ? 'aac' : 'copy',
    crf: videoGraph ? state.form.crf : undefined,
    preset: videoGraph ? state.form.preset : undefined
  };
};
const extractValues = () => ({
  input: state.inputs.audio?.handle,
  streams: [{ selector: state.form.audioStream, output: requireExtension(state.outputs['audio-extract'], [outputOptions('audio-extract').filters[0].extensions[0]], 'extracted audio output').handle, codec: state.form.audioCodec }]
});
const gifValues = () => ({ input: state.inputs.gif?.handle, output: requireExtension(state.outputs.gif, ['gif'], 'GIF output').handle, fps: state.form.gifFps, width: state.form.gifWidth, maxColors: state.form.gifColors });
const thumbnailValues = () => ({ input: state.inputs.thumbs?.handle, outputPattern: requireExtension(state.outputs.thumbs, ['jpg','jpeg'], 'thumbnail output').handle, start: state.form.thumbTime, mode: 'thumbnail', batchSize: 100, count: 1, quality: 2 });
const streamingValues = () => state.form.streamMode === 'hls'
  ? {
      input: state.inputs.streaming?.handle,
      output: requireExtension(state.outputs.streaming, ['m3u8'], 'HLS playlist').handle,
      hlsTime: state.form.hlsTime,
      listSize: state.form.hlsList,
      segmentFilename: state.outputs.streaming ? derivedOutput(state.outputs.streaming, '.segment-%05d.ts') : undefined,
      flags: ['independent_segments', 'temp_file'],
      videoCodec: 'libx264',
      audioCodec: 'aac'
    }
  : {
      input: state.inputs.streaming?.handle,
      target: state.form.streamTarget,
      format: state.form.streamMode === 'rtmp' ? 'flv' : 'mpegts',
      videoCodec: 'libx264',
      audioCodec: 'aac',
      realtime: true,
      lowLatency: true
    };
const workflowPreview = (kind, values) => {
  try { return commandPreview(previewArgs(build(kind, typeof values === 'function' ? values() : values))); }
  catch (error) { return bounded(error.message, 1000); }
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
    error: bounded(job.error || outputError || '', 1000)
  };
};

async function refreshJobs() {
  try {
    const result = await apiCall('jobs.list');
    state.jobs = (Array.isArray(result) ? result : result?.jobs || []).slice(0, 1000).map(normalizeJob); render();
  } catch (error) { state.runtime.error = error.message; render(); }
}

const jobRows = (selectable = false) => state.jobs.length ? state.jobs.map((job) => `<div class="list-item job-row" data-job-id="${esc(job.id)}">
  ${selectable ? `<input class="job-select" type="checkbox" data-job-id="${esc(job.id)}"${state.selectedJobs.has(job.id) ? ' checked' : ''}>` : ''}
  <span class="ms">${job.status === 'completed' ? 'check_circle' : job.status === 'failed' ? 'error' : 'movie'}</span>
  <span style="flex:1;min-width:0"><b>${esc(job.label)}</b><br><small class="mono">${esc(job.argv.length ? commandPreview(job.argv) : job.progressText || job.kind)}</small>${job.error ? `<br><small style="color:var(--danger)">${esc(job.error)}</small>` : ''}</span>
  <span class="tag${['completed', 'cancelled', 'failed'].includes(job.status) ? ' idle' : ''}">${esc(job.status.toUpperCase())}</span>
  <b class="mono" style="font-size:11px;color:var(--muted)">${esc(job.speed || (job.exitCode != null ? `exit ${job.exitCode}` : ''))}</b>
  <button class="job-focus" data-job-id="${esc(job.id)}" title="Open job log"><span class="ms">receipt_long</span></button>
  <div class="progress-track" style="grid-column:1/-1" role="progressbar"${job.progress === null ? ` aria-valuetext="${esc(job.progressText || job.status)}"` : ` aria-valuemin="0" aria-valuemax="100" aria-valuenow="${job.progress}"`}><span style="width:${job.progress === null ? 0 : job.progress}%"></span></div></div>`).join('') : '<div class="empty-state"><b>No jobs yet</b><br><small>Choose a real input and output, then queue an operation.</small></div>';

const field = (label, control) => `<label class="field"><span>${esc(label)}</span>${control}</label>`;
const input = (id, value, type = 'text', extra = '') => `<input id="${id}" type="${type}" value="${esc(value)}" ${extra}>`;
const select = (id, values, selected) => `<select id="${id}">${values.map((value) => `<option value="${esc(value)}"${String(value) === String(selected) ? ' selected' : ''}>${esc(value)}</option>`).join('')}</select>`;
const pageHead = (eyebrow, title, description, actions = '') => `<div class="page-head"><div><p class="eyebrow">${esc(eyebrow)}</p><h1>${esc(title)}</h1><p class="lede">${esc(description)}</p></div><div class="head-actions">${actions}</div></div>`;
const displayFile = (file, empty) => file ? esc(file.name) : `<span class="hint">${esc(empty)}</span>`;
const pickerCard = (slot, label, output = false) => `<div class="list-item"><span class="ms">${output ? 'output' : 'movie'}</span><span style="flex:1;min-width:0"><b>${esc(label)}</b><br><small class="mono">${displayFile(output ? state.outputs[slot] : state.inputs[slot], output ? 'Choose an output destination' : 'Choose an input file')}</small></span><button class="tonal ${output ? 'pick-output' : 'pick-input'}" data-slot="${slot}">${output ? 'Choose' : 'Browse'}</button></div>`;

const VIEWS = {
  overview: () => {
    const counts = state.runtimeCatalog.counts || {};
    const running = state.jobs.filter((job) => ['running', 'encoding'].includes(job.status)).length;
    const queued = state.jobs.filter((job) => job.status === 'queued').length;
    const cards = [
      ['Runtime', state.runtime.loading ? 'Loading' : state.runtime.available ? state.runtime.version || 'Ready' : 'Unavailable', state.runtime.error || 'Bundled FFmpeg status'],
      ['Codecs', counts.codecs ?? '—', counts.codecs == null ? 'Load from the bundled runtime' : 'Reported by this build'],
      ['Filters', counts.filters ?? '—', counts.filters == null ? 'Load from the bundled runtime' : 'Reported by this build'],
      ['Queue', `${running} + ${queued}`, 'running + queued']
    ];
    return `${pageHead('Media control plane', 'Overview', 'Live state from the bundled FFmpeg runtime and durable job queue.', '<button class="filled" data-go="convert">New job</button><button class="tonal" data-go="composer">Command composer</button>')}
      <div class="grid">${cards.map(([label, value, sub]) => `<div class="card span3"><small>${esc(label)}</small><div class="stat">${esc(value)}</div><small>${esc(sub)}</small></div>`).join('')}
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
      ${field('Out point (-to, overrides duration)', input('trim-end', state.form.trimEnd, 'text', 'placeholder="00:00:10.000"'))}
      ${field('Clip duration (-t, used when out point is blank)', input('trim-duration', state.form.trimDuration, 'text', 'placeholder="00:00:10.000"'))}
      ${field('Mode', select('trim-mode', ['copy','reencode'], state.form.trimMode))}
      <label class="check-row"><input id="trim-negative" type="checkbox"${state.form.avoidNegative ? ' checked' : ''}> Avoid negative timestamps</label>
    </div><fieldset${state.form.trimMode === 'copy' ? ' disabled' : ''} style="margin-top:14px"><legend>Re-encode settings</legend><div class="two-col">
      ${field('Video encoder',select('trim-video-codec',['libx264','libx265','libsvtav1','libvpx-vp9'],state.form.trimVideoCodec))}
      ${field('Audio encoder',select('trim-audio-codec',['aac','flac','libopus','pcm_s24le'],state.form.trimAudioCodec))}
      ${field('CRF',input('trim-crf',state.form.trimCrf,'number','min="0" max="63"'))}
      ${field('Preset',select('trim-preset',['ultrafast','veryfast','fast','medium','slow','slower','veryslow'],state.form.trimPreset))}
    </div></fieldset><p class="hint">Re-encode controls are unavailable in copy mode because stream copy does not consume them.</p></div><div class="card span5"><h2>Command preview</h2><pre class="cmd-pre">${esc(workflowPreview('trim',trimValues))}</pre></div></div>`,

  filters: () => `${pageHead('Filtergraph', 'Node graph', 'Build a real ordered filter chain, edit each node, and queue it.', '<button class="outlined" id="add-filter">Add node</button><button class="filled" id="queue-filtergraph">Apply & queue</button>')}
    <div class="grid"><div class="card span7"><div class="list">${pickerCard('filters','Input')}${pickerCard('filters','Output',true)}</div><div class="graph" style="margin-top:14px">${state.filters.length ? state.filters.map((node,index) => `<button class="node${index === state.selectedFilter ? ' sel' : ''}" data-filter-index="${index}"><b>${esc(node.name)}</b><br><small>${esc(node.options || 'No options')}</small></button>`).join('<span class="ms">east</span>') : '<div class="empty-state">No filters. Add one to begin.</div>'}</div></div>
    <div class="card span5"><h2>Selected node</h2>${state.filters[state.selectedFilter] ? `${field('Media stream',select('filter-kind',['video','audio'],state.filters[state.selectedFilter].kind || (['loudnorm','atempo'].includes(state.filters[state.selectedFilter].name) ? 'audio' : 'video')))}${field('Filter', select('filter-name',(state.filters[state.selectedFilter].kind || (['loudnorm','atempo'].includes(state.filters[state.selectedFilter].name) ? 'audio' : 'video')) === 'audio' ? ['loudnorm','atempo'] : ['scale','crop','fps','eq','curves','drawtext','unsharp'],state.filters[state.selectedFilter].name))}${field('Options', `<textarea id="filter-options" class="mono" rows="7">${esc(state.filters[state.selectedFilter].options)}</textarea>`)}<button class="tonal" id="update-filter">Update node</button><button class="outlined" id="remove-filter">Remove node</button>` : '<div class="empty-state">Select or add a node.</div>'}<p class="hint">Audio and video chains are compiled separately, then applied to the matching stream.</p></div></div>`,

  audio: () => `${pageHead('Audio', 'Extraction & loudness', 'Inspect real streams, normalize with measured loudness, or extract one selected stream.', '')}
    <div class="grid"><div class="card span6"><h2>Two-pass loudness</h2><div class="list">${pickerCard('audio','Input')}${pickerCard('audio-normalize','Normalized output',true)}</div>
      <div class="two-col" style="margin-top:14px">${field('Integrated loudness (LUFS)', input('audio-lufs',state.form.loudness,'number','min="-70" max="-5" step="0.1"'))}${field('Loudness range',input('audio-lra',state.form.lra,'number','min="1" max="50" step="0.1"'))}${field('True peak (dBTP)',input('audio-tp',state.form.truePeak,'number','min="-9" max="0" step="0.1"'))}${field('Normalized output codec',select('loudnorm-codec',['flac','aac','libopus','pcm_s24le'],state.form.loudnormCodec))}</div><button class="filled" id="queue-loudnorm">Queue measured two-pass normalization</button></div>
    <div class="card span6"><h2>Extract stream</h2><div class="list">${pickerCard('audio-extract','Extracted output',true)}</div>${field('Stream', select('audio-stream', state.audioStreams.length ? state.audioStreams.map((s) => s.id) : ['0:a:0'], state.form.audioStream))}${field('Output codec',select('audio-codec',['copy','flac','aac','libopus','pcm_s24le'],state.form.audioCodec))}<button class="filled" id="queue-extract">Queue extraction</button><p class="hint">Streams are populated from the selected file's real ffprobe result. Stream copy keeps the encoded bytes and does not apply filters.</p></div></div>`,

  gif: () => `${pageHead('Stills & loops', 'GIF & thumbnails', 'Queue a palette-based GIF or one timestamped still.', '')}<div class="grid">
    <div class="card span6"><h2>GIF export</h2><div class="list">${pickerCard('gif','Input')}${pickerCard('gif','Output',true)}</div><div class="two-col">${field('FPS',input('gif-fps',state.form.gifFps,'number','min="1" max="60"'))}${field('Width',input('gif-width',state.form.gifWidth,'number','min="16" max="8192"'))}${field('Palette colors',input('gif-colors',state.form.gifColors,'number','min="2" max="256"'))}</div><button class="filled" id="queue-gif">Queue GIF</button></div>
    <div class="card span6"><h2>Thumbnail</h2><div class="list">${pickerCard('thumbs','Input')}${pickerCard('thumbs','JPEG output',true)}</div>${field('Timestamp',input('thumb-time',state.form.thumbTime,'text','placeholder="00:00:10.000"'))}<button class="filled" id="queue-thumbs">Queue thumbnail</button><p class="hint">This flow writes one validated still. It does not pretend a single save destination is a sequence folder.</p></div></div>`,

  presets: () => `${pageHead('Reusable settings', 'Presets', 'Saved locally from real configured operations.', '<button class="filled" id="new-preset">Save current convert settings</button>')}<div class="card"><div class="list">${state.presets.length ? state.presets.map((preset,index) => `<div class="list-item"><span class="ms">bookmarks</span><span style="flex:1"><b>${esc(preset.name)}</b><br><small class="mono">${esc(JSON.stringify(preset.values).slice(0,300))}</small></span><button class="tonal preset-use" data-index="${index}">Use</button><button class="outlined preset-edit" data-index="${index}">Rename</button><button class="preset-delete" data-index="${index}" style="color:var(--danger)">Delete</button></div>`).join('') : '<div class="empty-state"><b>No presets saved</b><br><small>Configure Convert, then save a named preset.</small></div>'}</div></div>`,

  inspector: () => `${pageHead('ffprobe', 'Media inspector', 'Inspect a real file and export the exact bounded result.', '<button class="outlined" id="inspect-pick">Choose file</button><button class="filled" id="inspect-run">Inspect</button>')}<div class="grid"><div class="card span4"><h2>Source</h2>${state.inputs.inspector ? `<b>${esc(state.inputs.inspector.name)}</b>` : '<div class="empty-state">No file selected.</div>'}${state.probeError ? `<div class="notice" style="color:var(--danger)">${esc(state.probeError)}</div>` : ''}<div class="dialog-actions"><button class="tonal probe-export" data-format="json">JSON</button><button class="tonal probe-export" data-format="csv">CSV</button><button class="tonal probe-export" data-format="xml">XML</button></div></div>
    <div class="card span8"><h2>Probe result</h2><pre class="cmd-pre" id="probe-result">${state.probe ? esc(JSON.stringify(state.probe,null,2).slice(0,200000)) : 'Nothing inspected yet.'}</pre></div></div>`,

  hwaccel: () => {
    const methods = state.catalogs.hwaccels || [];
    return `${pageHead('Runtime inventory', 'Hardware acceleration', 'Only methods reported by this bundled FFmpeg build are shown.', '<button class="tonal" id="refresh-runtime">Refresh</button>')}<div class="card"><div class="list">${methods.length ? methods.slice(0,200).map((item) => `<div class="list-item"><span class="ms">developer_board</span><b>${esc(typeof item === 'string' ? item : item.name)}</b><small>${esc(typeof item === 'object' ? item.details || item.description || '' : '')}</small></div>`).join('') : `<div class="empty-state"><b>${state.runtime.loading ? 'Loading hardware inventory…' : 'No hardware method reported'}</b><br><small>${esc(state.runtime.error || 'This is not inferred from the computer name or graphics vendor.')}</small></div>`}</div></div>`;
  },

  streaming: () => `${pageHead('Live output', 'Streaming', 'Configure a real HLS playlist, RTMP URL, or SRT URL; nothing is preconnected.', '<button class="filled" id="queue-stream">Queue stream</button>')}<div class="grid"><div class="card span6"><div class="list">${pickerCard('streaming','Input')}${state.form.streamMode === 'hls' ? pickerCard('streaming','HLS playlist',true) : ''}</div>${field('Mode',select('stream-mode',['hls','rtmp','srt'],state.form.streamMode))}${state.form.streamMode === 'hls' ? '<p class="notice">Segments are written beside the selected playlist through the same trusted output handle.</p>' : field('Validated streaming URL',input('stream-target',state.form.streamTarget,'text','placeholder="rtmp://… or srt://… (credentials are not accepted)"'))}</div>
    <div class="card span6"><h2>HLS options</h2><div class="two-col">${field('Segment seconds',input('hls-time',state.form.hlsTime,'number','min="1" max="60"'))}${field('Playlist entries',input('hls-list',state.form.hlsList,'number','min="0" max="10000"'))}</div><div class="empty-state">No target is treated as live or connected until the queued FFmpeg process reports it.</div></div></div>`,

  jobs: () => {
    const selected = state.jobs.find((job) => job.id === state.selectedJobId) || state.jobs[0];
    const logs = selected?.logs || [];
    return `${pageHead('Durable queue', 'Jobs & logs', 'Live process state, progress facts, exit status, output validation, and bounded logs.', '<button class="outlined" id="refresh-jobs">Refresh</button><button class="outlined" id="clear-finished">Clear finished</button>')}<div class="card bulk-bar"><b>${state.selectedJobs.size} selected</b><button id="jobs-select-all">Select all</button><button id="jobs-select-none">Clear</button><button id="jobs-pause">Pause</button><button id="jobs-resume">Resume</button><button id="jobs-back">Move to back</button><button id="jobs-cancel" style="color:var(--danger)">Cancel</button></div>
      <div class="list">${jobRows(true)}</div><div class="card" style="margin-top:14px"><div class="section-head"><h2>${selected ? esc(selected.label) : 'Job log'}</h2><input id="log-search" placeholder="Filter log lines"></div>${selected?.error ? `<p class="notice" style="color:var(--danger)"><b>Failure:</b> ${esc(selected.error)}</p>` : ''}<div class="log-pane" id="log-pane">${logs.length ? logs.map((line) => `<div>${esc(line)}</div>`).join('') : '<div>No log lines available.</div>'}</div></div>`;
  },

  composer: () => `${pageHead('Structured argv', 'Command composer', 'One argument per line. The renderer never parses or executes a shell string.', '<button class="filled" id="queue-composer">Queue command</button>')}<div class="grid"><div class="card span5"><div class="list">${pickerCard('composer','Input')}${pickerCard('composer','Output',true)}</div><p class="hint">Blank lines are ignored. Executable names and shell operators are rejected by the builder.</p></div><div class="card span7">${field('Arguments',`<textarea id="composer-args" class="mono" rows="18">${esc(state.form.composerArgs)}</textarea>`)}<pre class="cmd-pre" id="composer-preview"></pre></div></div>`,

  converter: () => `${pageHead('Media conversion', 'File converter', 'Add a real batch, inspect actual media types, choose a supported target, and queue each file.', '<button class="outlined" id="converter-add">Add files</button><button class="filled" id="queue-converter">Queue supported files</button>')}<div class="grid"><div class="card span7"><div class="list">${state.converterFiles.length ? state.converterFiles.map((file,index) => `<div class="list-item"><span class="ms">draft</span><span style="flex:1"><b>${esc(file.name)}</b><br><small>${esc(file.details || file.kind || 'Type will be validated by the runtime')}</small></span><span class="tag${file.supported ? '' : ' idle'}">${file.supported ? 'READY' : 'UNSUPPORTED'}</span><button class="converter-remove" data-index="${index}">×</button></div>`).join('') : '<div class="empty-state"><b>No files added</b><br><small>The runtime performs bounded byte detection; extensions are not trusted.</small></div>'}</div></div><div class="card span5"><h2>Target</h2>${field('Output type',select('converter-target',['mp4','mkv','webm','mp3','flac','wav','png','jpg'],state.form.converterTarget))}<p class="notice">Media conversions may be lossy. Originals remain untouched and each queued result is validated by the runtime.</p></div></div>`,

  settings: () => `${pageHead('Application', 'Settings', 'Execution, appearance, and message voice preferences persist locally.', '')}<div class="grid"><div class="card span6"><h2>Appearance</h2><div class="seg"><button id="theme-dark" class="${state.theme === 'dark' ? 'active' : ''}">Dark</button><button id="theme-light" class="${state.theme === 'light' ? 'active' : ''}">Light</button></div><button class="tonal" id="logo-settings" style="margin-top:14px">Customize app logo</button></div>
    <div class="card span6"><h2>Execution</h2>${field('Parallel jobs',input('setting-parallel',state.settings.parallel,'number','min="1" max="8"'))}<label class="check-row"><input id="setting-hardware" type="checkbox"${state.settings.preferHardware ? ' checked' : ''}> Prefer hardware encoders reported by runtime</label><label class="check-row"><input id="setting-passlogs" type="checkbox"${state.settings.keepPassLogs ? ' checked' : ''}> Keep intermediate two-pass logs</label><label class="check-row"><input id="setting-notify" type="checkbox"${state.settings.notifyComplete ? ' checked' : ''}> Notify on job completion</label></div>
    <div class="card full"><h2>Funny levels</h2><p class="hint">English and Cantonese keep independent voice levels from 1 (fully serious) to 5 (maximum playfulness). New and reset profiles start at 5. Voice can change; file names, exit status, affected data, and recovery actions never do.</p><div class="two-col">
      <div><label class="field"><span>English — level <output id="setting-funny-en-output">${state.settings.englishFunny}</output></span><input id="setting-funny-en" type="range" min="1" max="5" step="1" value="${state.settings.englishFunny}" aria-describedby="setting-funny-en-preview"></label><p class="notice" id="setting-funny-en-preview">${esc(funnyPreview('english', state.settings.englishFunny))}</p></div>
      <div><label class="field"><span lang="zh-HK">廣東話 — 程度 <output id="setting-funny-yue-output">${state.settings.cantoneseFunny}</output></span><input id="setting-funny-yue" type="range" min="1" max="5" step="1" value="${state.settings.cantoneseFunny}" aria-describedby="setting-funny-yue-preview"></label><p class="notice" id="setting-funny-yue-preview" lang="zh-HK">${esc(funnyPreview('cantonese', state.settings.cantoneseFunny))}</p></div>
    </div><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="tonal" id="reset-funny-levels">Reset both to level 5</button><button class="filled" id="save-settings">Save settings</button></div></div></div>`
};

const catalogView = (view) => {
  const kind = CATALOG_KINDS[view], rows = state.catalogs[kind] || [], error = state.catalogErrors[kind], loading = state.catalogLoading[kind];
  const label = GROUPS.registry.items.find((item) => item[0] === view)?.[2] || view;
  return `${pageHead('Bundled runtime inventory', label, 'Entries come directly from the bundled FFmpeg executable.', '<input id="catalog-search" placeholder="Search this inventory"><button class="tonal" id="catalog-refresh">Refresh</button>')}<div id="catalog-results" class="registry-grid">${loading ? '<div class="empty-state">Loading runtime inventory…</div>' : error ? `<div class="empty-state"><b>Inventory unavailable</b><br><small>${esc(error)}</small></div>` : rows.length ? rows.slice(0,2000).map((entry,index) => { const item = typeof entry === 'string' ? { name: entry } : entry; return `<button class="registry-row" data-catalog-index="${index}"><b>${esc(item.name || item.id || item.key || '')}</b><span class="desc">${esc(item.description || item.details || item.flags || '')}</span><span class="tag">${esc(item.type || kind)}</span><span class="ms">tune</span></button>`; }).join('') : '<div class="empty-state"><b>No entries reported</b><br><small>The app does not substitute a fabricated registry.</small></div>'}</div><p class="hint">${rows.length} entries loaded. Search filters this bounded local view.</p>`;
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
  const version = state.runtime.loading ? 'Checking runtime…' : state.runtime.available ? `FFmpeg ${esc(state.runtime.version || 'ready')}` : 'FFmpeg unavailable';
  $('#subnav').innerHTML = `<p class="eyebrow">${esc(GROUPS[group].title)}</p><div style="display:grid;gap:3px">${GROUPS[group].items.map(([id,icon,label]) => `<button class="subnav-item${id === state.view ? ' active' : ''}" data-go="${id}"><span class="ms">${icon}</span><span>${esc(label)}</span></button>`).join('')}</div><div class="build-note"><b>${version}</b><br>${esc(state.runtime.error || 'Bundled runtime')}</div>`;
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
  const composer = $('#composer-preview'); if (composer) {
    try { composer.textContent = commandPreview(build('composer', composerValues())); }
    catch (error) { composer.textContent = error.message; }
  }
}

function composerValues() {
  const lines = state.form.composerArgs.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const options = [];
  const optionName = /^-{1,2}[A-Za-z0-9][A-Za-z0-9_.:+-]{0,127}$/u;
  for (let index = 0; index < lines.length; index += 1) {
    const name = lines[index];
    if (/^ffmpeg(?:\.exe)?$/iu.test(name) || /[|;&`]/u.test(name)) throw new Error('Composer accepts FFmpeg option rows, not a shell command.');
    if (!optionName.test(name)) throw new Error(`Expected a valid FFmpeg option name, received: ${name}`);
    const next = lines[index + 1];
    const nextIsOption = next && optionName.test(next) && !/^-\d+(?:\.\d+)?$/u.test(next);
    options.push({ name, value: next && !nextIsOption ? (index += 1, next) : true });
  }
  return { inputs: [{ source: state.inputs.composer?.handle }], outputs: [{ target: state.outputs.composer?.handle, options }] };
}

async function queueLoudnormAnalysis() {
  try {
    if (!state.runtime.available) throw new Error(state.runtime.error || 'The bundled FFmpeg runtime is unavailable.');
    const output = requireExtension(state.outputs['audio-normalize'], [outputOptions('audio-normalize').filters[0].extensions[0]], 'normalized audio output');
    const values = { input: state.inputs.audio?.handle, phase: 'analysis', stream: state.form.audioStream, integrated: state.form.loudness, lra: state.form.lra, truePeak: state.form.truePeak };
    const argv = build('loudnorm', values), label = `Analyze loudness · ${state.inputs.audio?.name || 'audio'}`;
    const result = await apiCall('jobs.enqueue', { label, args: runtimeArgs(argv) });
    const analysis = Array.isArray(result)
      ? result.filter((job) => job.label === label).sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0]
      : result && typeof result === 'object' ? result : null;
    if (!analysis?.id) throw new Error('The analysis job was queued without an identifier.');
    state.loudnormPending[analysis.id] = { input: state.inputs.audio, output, stream: state.form.audioStream, integrated: state.form.loudness, lra: state.form.lra, truePeak: state.form.truePeak, audioCodec: state.form.loudnormCodec };
    notify('Two-pass normalization started','Pass 1 is measuring the selected stream.'); state.view='jobs'; await refreshJobs();
  } catch (error) { notify('Could not queue loudness analysis',error.message,'error'); }
}

function loudnormMeasurements(logs) {
  const text = (logs || []).join('\n').slice(-200000), candidates = text.match(/\{[^{}]{1,8000}\}/gu) || [];
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(candidates[index]);
      const measurements = { inputI:Number(parsed.input_i), inputLra:Number(parsed.input_lra), inputTp:Number(parsed.input_tp), inputThresh:Number(parsed.input_thresh), targetOffset:Number(parsed.target_offset) };
      if (Object.values(measurements).every(Number.isFinite)) return measurements;
    } catch { }
  }
  throw new Error('Pass 1 completed without valid bounded loudnorm JSON measurements.');
}

async function completeLoudnorm(job) {
  const pending = state.loudnormPending[job.id]; if (!pending || job.status !== 'completed') return;
  try {
    const values = { input:pending.input.handle, output:pending.output?.handle, phase:'apply', stream:pending.stream, integrated:pending.integrated, lra:pending.lra, truePeak:pending.truePeak, measurements:loudnormMeasurements(job.logs), audioCodec:pending.audioCodec };
    const argv = build('loudnorm',values); await apiCall('jobs.enqueue',{label:`Normalize · ${pending.output?.name || 'audio'}`,args:runtimeArgs(argv)}); delete state.loudnormPending[job.id]; notify('Pass 2 queued','Measured loudness values were applied to the output job.'); await refreshJobs();
  } catch (error) { notify('Two-pass normalization stopped',error.message,'error'); }
}

function wireView() {
  $$('[data-go]').forEach((button) => button.onclick = () => go(button.dataset.go));
  $$('[data-group]').forEach((button) => button.onclick = () => go(GROUPS[button.dataset.group].items[0][0]));
  $$('#palette-open,#palette-open-2').forEach((button) => button.onclick = openPalette);
  $$('.pick-input').forEach((button) => button.onclick = async () => { const files = await pickFile(button.dataset.slot, { multiple: false, purpose: button.dataset.slot }); if (files.length && ['audio','inspector'].includes(button.dataset.slot)) inspectSelected(button.dataset.slot); });
  $$('.pick-output').forEach((button) => button.onclick = () => chooseOutput(button.dataset.slot, Object.assign({ purpose: button.dataset.slot }, outputOptions(button.dataset.slot))));
  [['convert-codec','codec'],['convert-container','container'],['convert-crf','crf',true],['convert-preset','preset'],['convert-tune','tune'],['convert-fps','fps'],['convert-width','width',true],['convert-height','height',true],['trim-start','trimStart'],['trim-end','trimEnd'],['trim-duration','trimDuration'],['trim-mode','trimMode'],['trim-video-codec','trimVideoCodec'],['trim-audio-codec','trimAudioCodec'],['trim-crf','trimCrf',true],['trim-preset','trimPreset'],['audio-lufs','loudness',true],['audio-lra','lra',true],['audio-tp','truePeak',true],['loudnorm-codec','loudnormCodec'],['audio-codec','audioCodec'],['audio-stream','audioStream'],['gif-fps','gifFps',true],['gif-width','gifWidth',true],['gif-colors','gifColors',true],['thumb-time','thumbTime'],['stream-target','streamTarget'],['hls-time','hlsTime',true],['hls-list','hlsList',true],['converter-target','converterTarget']].forEach(([id,key,numeric]) => updateForm(id,key,numeric));
  const streamMode = $('#stream-mode'); if (streamMode) streamMode.onchange = () => { state.form.streamMode = streamMode.value; saveUi(); render(); };
  const trimNegative = $('#trim-negative'); if (trimNegative) trimNegative.onchange = () => { state.form.avoidNegative = trimNegative.checked; saveUi(); };

  $('#queue-convert')?.addEventListener('click', () => enqueue('convert', convertValues, state.outputs.convert?.name || 'Convert'));
  $('#queue-trim')?.addEventListener('click', () => enqueue('trim', trimValues, state.outputs.trim?.name || 'Trim'));
  $('#queue-filtergraph')?.addEventListener('click', () => enqueue('filtergraph', filtergraphValues, state.outputs.filters?.name || 'Filtergraph'));
  $('#queue-loudnorm')?.addEventListener('click', queueLoudnormAnalysis);
  $('#queue-extract')?.addEventListener('click', () => enqueue('extract', extractValues, state.outputs['audio-extract']?.name || 'Extract audio'));
  $('#queue-gif')?.addEventListener('click', () => enqueue('gif', gifValues, state.outputs.gif?.name || 'GIF'));
  $('#queue-thumbs')?.addEventListener('click', () => enqueue('thumbnails', thumbnailValues, state.outputs.thumbs?.name || 'Thumbnail'));
  $('#queue-stream')?.addEventListener('click', () => enqueue(state.form.streamMode === 'hls' ? 'hls' : 'stream', streamingValues, `${state.form.streamMode.toUpperCase()} output`));

  $('#add-filter')?.addEventListener('click', () => { state.filters.push({ kind: 'video', name: 'scale', options: '1920:-2' }); state.selectedFilter = state.filters.length - 1; render(); });
  $$('[data-filter-index]').forEach((button) => button.onclick = () => { state.selectedFilter = Number(button.dataset.filterIndex); render(); });
  const filterKind = $('#filter-kind'); if (filterKind) filterKind.onchange = () => { const node = state.filters[state.selectedFilter]; if (!node) return; node.kind = filterKind.value; node.name = node.kind === 'audio' ? 'loudnorm' : 'scale'; node.options = node.kind === 'audio' ? 'I=-16:LRA=11:TP=-1.5' : '1920:-2'; render(); };
  $('#update-filter')?.addEventListener('click', () => { const node = state.filters[state.selectedFilter]; if (!node) return; node.kind = bounded($('#filter-kind').value, 20); node.name = bounded($('#filter-name').value, 80); node.options = bounded($('#filter-options').value, 2000); render(); });
  $('#remove-filter')?.addEventListener('click', () => { state.filters.splice(state.selectedFilter,1); state.selectedFilter = clamp(state.selectedFilter,0,Math.max(0,state.filters.length-1)); render(); });

  $('#save-convert-preset')?.addEventListener('click', savePreset); $('#new-preset')?.addEventListener('click', savePreset);
  $$('.preset-use').forEach((button) => button.onclick = () => { Object.assign(state.form,state.presets[Number(button.dataset.index)]?.values || {}); go('convert'); });
  $$('.preset-edit').forEach((button) => button.onclick = () => { const preset = state.presets[Number(button.dataset.index)]; if (!preset) return; const name = prompt('Preset name',preset.name); if (name?.trim()) { preset.name = bounded(name.trim(),100); render(); } });
  $$('.preset-delete').forEach((button) => button.onclick = () => openConfirm('Delete this preset?', 'This removes the selected local preset.', () => { state.presets.splice(Number(button.dataset.index),1); render(); }));

  $('#inspect-pick')?.addEventListener('click', async () => { const files = await pickFile('inspector',{multiple:false,purpose:'probe'}); if (files.length) inspectSelected('inspector'); });
  $('#inspect-run')?.addEventListener('click', () => inspectSelected('inspector')); $$('.probe-export').forEach((button) => button.onclick = () => exportProbe(button.dataset.format));
  $('#refresh-runtime')?.addEventListener('click', refreshRuntime); $('#refresh-jobs')?.addEventListener('click', refreshJobs);
  $('#catalog-refresh')?.addEventListener('click', () => loadCatalog(CATALOG_KINDS[state.view],true)); $('#catalog-search')?.addEventListener('input', filterCatalog);
  $('#matrix-search')?.addEventListener('input',(event)=>{$$('.matrix-entry').forEach((row)=>{row.hidden=!row.textContent.toLowerCase().includes(event.target.value.toLowerCase());});});
  $$('[data-catalog-index]').forEach((button) => button.onclick = () => openCatalogHelp(CATALOG_KINDS[state.view],Number(button.dataset.catalogIndex)));

  $$('.job-select').forEach((check) => check.onchange = () => { check.checked ? state.selectedJobs.add(check.dataset.jobId) : state.selectedJobs.delete(check.dataset.jobId); render(); });
  $$('.job-focus').forEach((button) => button.onclick = () => { state.selectedJobId = button.dataset.jobId; render(); });
  $('#jobs-select-all')?.addEventListener('click', () => { state.jobs.forEach((job) => state.selectedJobs.add(job.id)); render(); }); $('#jobs-select-none')?.addEventListener('click', () => { state.selectedJobs.clear(); render(); });
  $('#jobs-pause')?.addEventListener('click', () => runJobAction('pause')); $('#jobs-resume')?.addEventListener('click', () => runJobAction('resume'));
  $('#jobs-cancel')?.addEventListener('click', () => openConfirm('Cancel selected jobs?', 'Running processes will receive a graceful cancellation request.', () => runJobAction('cancel')));
  $('#jobs-back')?.addEventListener('click', moveSelectedToBack); $('#clear-finished')?.addEventListener('click', clearFinished); $('#log-search')?.addEventListener('input', filterLogs);

  const composer = $('#composer-args'); if (composer) { composer.oninput = () => { state.form.composerArgs = composer.value.slice(0,20000); saveUi(); updatePreviews(); }; updatePreviews(); }
  $('#queue-composer')?.addEventListener('click', () => enqueue('composer', composerValues, state.outputs.composer?.name || 'Composed command'));
  $('#converter-add')?.addEventListener('click', addConverterFiles); $('#queue-converter')?.addEventListener('click', queueConverterFiles);
  $$('.converter-remove').forEach((button) => button.onclick = () => { state.converterFiles.splice(Number(button.dataset.index),1); render(); });

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
  $('#save-settings')?.addEventListener('click', () => { state.settings.parallel = clamp($('#setting-parallel').value,1,8); state.settings.preferHardware = $('#setting-hardware').checked; state.settings.keepPassLogs = $('#setting-passlogs').checked; state.settings.notifyComplete = $('#setting-notify').checked; state.settings.englishFunny = normalizeFunnyLevel($('#setting-funny-en').value); state.settings.cantoneseFunny = normalizeFunnyLevel($('#setting-funny-yue').value); saveUi(); notify('Settings saved','Execution and message voice preferences are now active.'); render(); });
}

const go = (view) => { state.view = VIEWS[view] ? view : 'overview'; render(); };
function savePreset() {
  const name = prompt('Preset name', `Convert ${state.form.codec}`); if (!name?.trim()) return;
  const values = ['codec','container','crf','preset','tune','width','height','fps'].reduce((result,key) => { result[key] = state.form[key]; return result; },{});
  state.presets.push({ id: crypto.randomUUID?.() || String(Date.now()), name: bounded(name.trim(),100), values }); state.presets = state.presets.slice(-200); render();
}

async function inspectSelected(slot) {
  const file = state.inputs[slot]; if (!file) return notify('Choose a file','A real input is required before inspection.','error');
  state.probeError = '';
  try {
    const result = await apiCall('probe.inspect', file.handle); state.probe = result;
    const streams = Array.isArray(result?.streams) ? result.streams : [];
    state.audioStreams = streams.filter((stream) => stream.codec_type === 'audio').slice(0,128).map((stream,index) => ({ id: stream.specifier || `0:a:${index}`, codec: stream.codec_name || '' }));
  } catch (error) { state.probe = null; state.probeError = error.message; }
  render();
}
async function exportProbe(format) {
  if (!state.probe || !state.inputs.inspector) return notify('Nothing to export','Inspect a file first.','error');
  try {
    const destination = normalizeFiles(await apiCall('files.save',{suggestedName:`probe.${format}`,filters:[{name:format.toUpperCase(),extensions:[format]}]}))[0]; if (!destination) return;
    await apiCall('probe.export', { fileHandle: state.inputs.inspector.handle, destinationHandle: destination.handle, format }); notify('Export complete',`${format.toUpperCase()} probe data saved.`);
  }
  catch (error) { notify('Export failed',error.message,'error'); }
}
async function loadCatalog(kind, force = false) {
  if (!kind || (state.catalogLoading[kind] && !force)) return;
  state.catalogLoading[kind] = true; delete state.catalogErrors[kind]; render();
  try { const result = await apiCall('catalog.list', kind); state.catalogs[kind] = (Array.isArray(result) ? result : result?.entries || result?.items || []).slice(0,10000); }
  catch (error) { state.catalogErrors[kind] = error.message; state.catalogs[kind] = []; }
  state.catalogLoading[kind] = false; render();
}
function filterCatalog() {
  const query = bounded($('#catalog-search').value,500).toLowerCase(); $$('.registry-row','#catalog-results').forEach((row) => { row.hidden = !row.textContent.toLowerCase().includes(query); });
}
async function openCatalogHelp(kind,index) {
  const entry = state.catalogs[kind]?.[index], name = typeof entry === 'string' ? entry : entry?.name || entry?.id || entry?.key; if (!name) return;
  const helpKind = kind === 'codecs' ? ((entry?.flags || '').includes('E') ? 'encoder' : 'decoder') : kind === 'formats' ? ((entry?.flags || '').includes('E') ? 'muxer' : 'demuxer') : kind === 'protocols' ? 'protocol' : kind === 'bsfs' ? 'bsf' : null;
  if (!helpKind) return notify('Help unavailable',`This FFmpeg inventory does not expose component help for ${kind}.`);
  try {
    const result = await apiCall('catalog.help', helpKind, name);
    if (window.optionGuides?.openRuntimeHelp) return window.optionGuides.openRuntimeHelp({ kind:helpKind, name, help: result });
    if (window.optionGuides?.openCatalog) return window.optionGuides.openCatalog({ kind:helpKind, initialItem: name });
    notify(name,bounded(typeof result === 'string' ? result : JSON.stringify(result),500));
  } catch (error) { notify('Help unavailable',error.message,'error'); }
}
async function runJobAction(action) {
  const ids = Array.from(state.selectedJobs); if (!ids.length) return notify('No jobs selected','Select at least one job.','error');
  const results = await Promise.allSettled(ids.map((id) => apiCall(`jobs.${action}`,id))), failed = results.filter((result) => result.status === 'rejected').length;
  if (failed) notify(`${action} incomplete`,`${failed} of ${ids.length} requests failed.`,'error'); state.selectedJobs.clear(); await refreshJobs();
}
async function moveSelectedToBack() {
  const selected = new Set(state.selectedJobs); if (!selected.size) return notify('No jobs selected','Select at least one job.','error');
  const order = [...state.jobs.filter((job) => !selected.has(job.id)), ...state.jobs.filter((job) => selected.has(job.id))].map((job) => job.id);
  try { await apiCall('jobs.reorder',order); state.selectedJobs.clear(); await refreshJobs(); } catch (error) { notify('Reorder failed',error.message,'error'); }
}
async function clearFinished() {
  const ids = state.jobs.filter((job) => ['completed','failed','cancelled','interrupted'].includes(job.status)).map((job) => job.id);
  if (!ids.length) return notify('Nothing to clear','No finished jobs are present.');
  openConfirm('Clear finished jobs?',`${ids.length} finished job records will be removed.`,async () => { try { await apiCall('jobs.clear',ids); await refreshJobs(); } catch (error) { notify('Clear failed',error.message,'error'); } });
}
function filterLogs() {
  const selected = state.jobs.find((job) => job.id === state.selectedJobId) || state.jobs[0], query = $('#log-search').value.toLowerCase();
  $('#log-pane').replaceChildren(...(selected?.logs || []).filter((line) => line.toLowerCase().includes(query)).map((line) => { const div = document.createElement('div'); div.textContent = line; return div; }));
}
async function addConverterFiles() {
  const files = await pickFile(null,{multiple:true,purpose:'converter'});
  for (const file of files) {
    try { const probe = await apiCall('probe.inspect',file.handle); file.details = bounded(probe?.format?.format_long_name || probe?.format?.format_name || file.details || 'Media detected by runtime',300); file.supported = true; }
    catch (error) { file.details = bounded(error.message,300); file.supported = false; }
    state.converterFiles.push(file);
  }
  state.converterFiles = state.converterFiles.slice(0,500); render();
}
async function queueConverterFiles() {
  const files = state.converterFiles.filter((file) => file.supported); if (!files.length) return notify('No supported files','Add at least one media file that the runtime can inspect.','error');
  if (!state.runtime.available) return notify('Bundled runtime unavailable',state.runtime.error || 'The bundled FFmpeg runtime is unavailable.','error');
  const adapters = { mp4:'video/mp4-h264-aac',mkv:'video/mkv-copy',webm:'video/webm-vp9-opus',mp3:'audio/mp3',flac:'audio/flac',wav:'audio/wav-pcm-s24le',png:'image/png',jpg:'image/jpeg' };
  const adapter = adapters[state.form.converterTarget]; if (!adapter) return notify('Target unavailable',`No bundled adapter is available for ${state.form.converterTarget}.`,'error');
  let queued = 0;
  for (const file of files) {
    try {
      const stem = file.name.replace(/\.[^.]+$/u,'').slice(0,180) || 'output';
      const output = normalizeFiles(await apiCall('files.save',{suggestedName:`${stem}.${state.form.converterTarget}`,filters:[{name:state.form.converterTarget.toUpperCase(),extensions:[state.form.converterTarget]}]}))[0];
      if (!output) continue; state.outputs[`converter-${queued}`]=output;
      const argv = build('converter',{ input:file.handle, output:output.handle, adapter }); await apiCall('jobs.enqueue',{label:`${file.name} → ${state.form.converterTarget}`,args:runtimeArgs(argv)}); queued += 1;
    }
    catch (error) { notify(`Could not queue ${file.name}`,error.message,'error'); }
  }
  if (queued) { notify('Batch queued',`${queued} conversion jobs added.`); state.view='jobs'; await refreshJobs(); }
}
async function refreshRuntime() {
  state.runtime.loading = true; state.runtime.error = ''; render();
  try {
    const [status,catalog] = await Promise.all([apiCall('runtime.status'),apiCall('runtime.catalog')]);
    state.runtime = { available: status?.ready === true, loading: false, version: bounded(status?.version || status?.ffmpegVersion || '',100), error: bounded(status?.error || (!status?.ready ? 'Bundled FFmpeg or ffprobe is unavailable.' : ''),500) };
    state.runtimeCatalog = catalog && typeof catalog === 'object' ? catalog : {};
  } catch (error) { state.runtime = { available:false,loading:false,version:'',error:error.message }; }
  render();
}

function notify(title,body,type='info') {
  const item = { id: String(Date.now()) + Math.random().toString(16).slice(2), title:bounded(title,100), body:bounded(body,1000), type, at:new Date().toISOString() };
  state.notifications.unshift(item); state.notifications = state.notifications.slice(0,200); store.set('notifications',state.notifications);
  const toast = document.createElement('div'); toast.className = 'toast'; const heading = document.createElement('b'); heading.textContent = item.title; const copy = document.createElement('small'); copy.textContent = item.body; toast.append(heading,copy); $('#toast-zone').append(toast); setTimeout(() => toast.remove(), type === 'error' ? 12000 : 6000);
}
function openNotifications() {
  const list = $('#notification-list'), search = $('#notification-search');
  const draw = () => {
    const query = search.value.toLowerCase(); list.replaceChildren(); const items = state.notifications.filter((item) => `${item.title} ${item.body}`.toLowerCase().includes(query));
    if (!items.length) { const empty=document.createElement('p'); empty.className='hint'; empty.textContent='No matching notifications.'; list.append(empty); return; }
    items.forEach((item) => { const row=document.createElement('div'); row.className='list-item'; const text=document.createElement('span'); text.style.flex='1'; const title=document.createElement('b'); title.textContent=item.title; const body=document.createElement('small'); body.textContent=item.body; const at=document.createElement('small'); at.textContent=item.at; text.append(title,document.createElement('br'),body,document.createElement('br'),at); row.append(text); list.append(row); });
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
  if (Array.isArray(payload.jobs)) state.jobs=payload.jobs.slice(0,1000).map(normalizeJob);
  else if (payload.job && typeof payload.job === 'object') { const normalized=normalizeJob(payload.job,0), index=state.jobs.findIndex((job)=>job.id===normalized.id); if(index>=0)state.jobs[index]=normalized; else state.jobs.unshift(normalized); completeLoudnorm(normalized); }
  else if (payload.type === 'cleared' && Array.isArray(payload.ids)) { const cleared=new Set(payload.ids.map(String)); state.jobs=state.jobs.filter((job)=>!cleared.has(job.id)); state.selectedJobs=new Set([...state.selectedJobs].filter((id)=>!cleared.has(id))); if(cleared.has(state.selectedJobId))state.selectedJobId=''; }
  else return;
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
document.addEventListener('contextmenu',(event)=>{const tab=event.target.closest('.tab');if(!tab)return;event.preventDefault();const id=tab.dataset.tabId,item=state.tabs.find((entry)=>entry.id===id),menu=$('#ctx-menu');menu.replaceChildren();const header=document.createElement('header');header.textContent=item?.label||'Tab';menu.append(header);[['Pin or unpin',()=>{item.pinned=!item.pinned;render();}],['Duplicate',()=>{if(!state.tabs.some((entry)=>entry.id===`${id}-copy`))state.tabs.push({...item,id:`${id}-copy`,view:item.view||item.id,label:`${item.label} copy`,pinned:false});render();}],['Move to group',openTabManager],['Edit appearance',()=>openAppearance(item.label)],['Close',()=>{if(!item.pinned){state.tabs=state.tabs.filter((entry)=>entry!==item);render();}}]].forEach(([label,run])=>{const button=document.createElement('button');button.textContent=label;button.onclick=()=>{menu.hidden=true;run();};menu.append(button);});menu.hidden=false;menu.style.left=`${Math.min(event.clientX,innerWidth-250)}px`;menu.style.top=`${Math.min(event.clientY,innerHeight-220)}px`;});
document.addEventListener('click',(event)=>{if(!event.target.closest('#ctx-menu'))$('#ctx-menu').hidden=true;});
$$('.builder-button').forEach((button)=>button.onclick=(event)=>{event.preventDefault();openRegex();});
$('#appearance-apply').onclick=(event)=>{event.preventDefault();state.theme=$('#appearance-theme').value;state.settings.appearance={accent:$('#appearance-accent').value,font:$('#appearance-font').value,scale:Number($('#appearance-scale').value),weight:Number($('#appearance-weight').value),radius:Number($('#appearance-radius').value)};saveUi();$('#appearance-dialog').close();render();};
$('#appearance-reset').onclick=()=>{delete state.settings.appearance;saveUi();applyAppearance();$('#appearance-dialog').close();render();};
window.addEventListener('keydown',(event)=>{if(event.ctrlKey&&event.shiftKey&&event.key.toLowerCase()==='f'){event.preventDefault();openPalette();}});

async function initialize() {
  render(); await Promise.all([refreshRuntime(),refreshJobs()]);
  try { const unsubscribe=window.api?.jobs?.onEvent?.(filterJobEvent); if(typeof unsubscribe==='function')window.addEventListener('beforeunload',unsubscribe,{once:true}); }
  catch(error){notify('Live job updates unavailable',error.message,'error');}
}
window.state=state; window.save=saveUi; window.render=render; window.openRegex=openRegex; initialize();
