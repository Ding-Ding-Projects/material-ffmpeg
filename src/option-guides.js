/* option-guides.js — guided option docs, draggable dialogs, ctx-menu search. Loads after renderer.js. */
'use strict';
(() => {
  const $g = (s, r = document) => r.querySelector(s);
  const escg = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const num = (o) => ({ kind: 'num', ...o }), en = (o) => ({ kind: 'enum', ...o }), bo = (o) => ({ kind: 'bool', ...o }), arr = (o) => ({ kind: 'array', ...o });

  const RUNTIME_LIMITS = Object.freeze({ results: 250, name: 256, description: 2000, help: 65536, error: 400, timeoutMs: 15000, cacheMs: 300000 });
  const runtimeCache = new Map();
  const runtimeRequestEpoch = new Map();
  const boundedText = (value, max) => String(value == null ? '' : value).replace(/\u0000/g, '').slice(0, max);
  const runtimeErrorText = (error) => boundedText(error && error.message ? error.message : error || 'Unknown runtime error.', RUNTIME_LIMITS.error);
  const validCatalogToken = (value, label) => {
    const token = boundedText(value, 64).trim();
    if (!/^[a-z0-9][a-z0-9:_-]{0,63}$/i.test(token)) throw new Error(`${label} contains unsupported characters.`);
    return token;
  };
  const runtimeRequestError = (code, message) => Object.assign(new Error(message), { code });
  const runtimeResultStatus = (error) => error && error.code === 'RUNTIME_REQUEST_CANCELLED' ? 'cancelled' : error && error.code === 'RUNTIME_REQUEST_TIMEOUT' ? 'timeout' : 'error';
  const withRuntimeTimeout = (key, operation) => new Promise((resolve, reject) => {
    const epoch = (runtimeRequestEpoch.get(key) || 0) + 1;
    runtimeRequestEpoch.set(key, epoch);
    const timer = setTimeout(() => reject(runtimeRequestError('RUNTIME_REQUEST_TIMEOUT', 'The bundled FFmpeg request timed out.')), RUNTIME_LIMITS.timeoutMs);
    Promise.resolve().then(operation).then((value) => {
      clearTimeout(timer);
      if (runtimeRequestEpoch.get(key) !== epoch) reject(runtimeRequestError('RUNTIME_REQUEST_CANCELLED', 'The bundled FFmpeg request was replaced by a newer request.'));
      else { runtimeRequestEpoch.delete(key); resolve(value); }
    }, (error) => { clearTimeout(timer); if (runtimeRequestEpoch.get(key) === epoch) runtimeRequestEpoch.delete(key); reject(error); });
  });
  const readRuntimeCache = (key) => {
    const cached = runtimeCache.get(key);
    if (!cached || Date.now() - cached.at >= RUNTIME_LIMITS.cacheMs) { runtimeCache.delete(key); return null; }
    return cached.value;
  };
  const writeRuntimeCache = (key, value) => {
    runtimeCache.delete(key);
    runtimeCache.set(key, { at: Date.now(), value });
    while (runtimeCache.size > 256) runtimeCache.delete(runtimeCache.keys().next().value);
    return value;
  };
  const cancelRuntimeRequests = () => { runtimeRequestEpoch.clear(); };
  const runtimeCatalogApi = () => {
    const catalog = window.api && window.api.catalog;
    return catalog && typeof catalog.list === 'function' && typeof catalog.help === 'function' ? catalog : null;
  };
  const normalizeRuntimeItem = (item, index) => {
    if (typeof item === 'string' || typeof item === 'number') {
      const name = boundedText(item, RUNTIME_LIMITS.name).trim();
      return name ? { id: name, name, description: '', index } : null;
    }
    if (Array.isArray(item)) {
      const name = boundedText(item[0], RUNTIME_LIMITS.name).trim();
      return name ? { id: name, name, description: boundedText(item.slice(1).filter(Boolean).join(' '), RUNTIME_LIMITS.description), index } : null;
    }
    if (!item || typeof item !== 'object') return null;
    const name = boundedText(item.name ?? item.label ?? item.id ?? item.key ?? item.value, RUNTIME_LIMITS.name).trim();
    if (!name) return null;
    const description = boundedText(item.description ?? item.summary ?? item.longName ?? item.details ?? item.detail ?? item.type ?? '', RUNTIME_LIMITS.description).trim();
    const flags = boundedText(item.flags ?? '', 32).trim();
    const type = boundedText(item.mediaType ?? item.type ?? '', 64).trim();
    return {
      id: boundedText(item.id ?? item.key ?? name, RUNTIME_LIMITS.name) || name,
      name,
      description,
      flags,
      type,
      canEncode: item.canEncode === true,
      canDecode: item.canDecode === true,
      muxing: item.muxing === true,
      demuxing: item.demuxing === true,
      input: item.input === true,
      output: item.output === true,
      index
    };
  };
  const catalogArrayFrom = (payload) => {
    if (Array.isArray(payload)) return payload;
    if (typeof payload === 'string') return payload.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!payload || typeof payload !== 'object') return [];
    for (const key of ['items', 'entries', 'results', 'data', 'catalog']) if (Array.isArray(payload[key])) return payload[key];
    return [];
  };
  const normalizeCatalogPayload = (payload, limit) => {
    if (payload && typeof payload === 'object' && payload.ok === false) throw new Error(payload.error || payload.message || 'The bundled FFmpeg catalog request failed.');
    const source = catalogArrayFrom(payload);
    const items = [];
    const seen = new Set();
    for (let index = 0; index < source.length && items.length < limit; index += 1) {
      const normalized = normalizeRuntimeItem(source[index], index);
      if (!normalized) continue;
      const key = `${normalized.name}\u0000${normalized.description}`;
      if (seen.has(key)) continue;
      seen.add(key); items.push(normalized);
    }
    return { items, total: Number.isFinite(payload && payload.total) ? Math.max(items.length, payload.total) : source.length, truncated: source.length > items.length || !!(payload && payload.truncated) };
  };
  const normalizeHelpPayload = (payload) => {
    if (payload && typeof payload === 'object' && payload.ok === false) throw new Error(payload.error || payload.message || 'The bundled FFmpeg help request failed.');
    const source = payload && typeof payload === 'object' ? (payload.text ?? payload.help ?? payload.output ?? payload.data ?? '') : payload;
    const original = String(source == null ? '' : source).replace(/\u0000/g, '');
    return { text: original.slice(0, RUNTIME_LIMITS.help), truncated: original.length > RUNTIME_LIMITS.help || !!(payload && payload.truncated) };
  };
  const runtimeCatalog = {
    async list(kind, options = {}) {
      let safeKind;
      try { safeKind = validCatalogToken(kind, 'Catalog kind'); } catch (error) { return { status: 'error', kind: '', items: [], error: runtimeErrorText(error) }; }
      const requested = Number(options.limit);
      const limit = Number.isFinite(requested) ? Math.max(1, Math.min(RUNTIME_LIMITS.results, Math.floor(requested))) : RUNTIME_LIMITS.results;
      const api = runtimeCatalogApi();
      if (!api) return { status: 'unavailable', kind: safeKind, items: [], error: 'The bundled FFmpeg catalog bridge is unavailable.' };
      const cacheKey = `list:${safeKind}:${limit}`;
      const cached = options.refresh ? null : readRuntimeCache(cacheKey);
      if (cached) return cached;
      try {
        const normalized = normalizeCatalogPayload(await withRuntimeTimeout(cacheKey, () => api.list(safeKind, { limit, refresh: options.refresh === true })), limit);
        const result = { status: normalized.items.length ? 'ready' : 'empty', kind: safeKind, ...normalized };
        return writeRuntimeCache(cacheKey, result);
      } catch (error) {
        return { status: runtimeResultStatus(error), kind: safeKind, items: [], error: runtimeErrorText(error) };
      }
    },
    async help(kind, name, options = {}) {
      let safeKind; let safeName;
      try { safeKind = validCatalogToken(kind, 'Help kind'); safeName = boundedText(name, RUNTIME_LIMITS.name).trim(); if (!/^[a-z0-9_.+-]{1,128}$/i.test(safeName)) throw new Error('Help name contains unsupported characters.'); } catch (error) { return { status: 'error', kind: '', name: '', text: '', error: runtimeErrorText(error) }; }
      const api = runtimeCatalogApi();
      if (!api) return { status: 'unavailable', kind: safeKind, name: safeName, text: '', error: 'The bundled FFmpeg help bridge is unavailable.' };
      const cacheKey = `help:${safeKind}:${safeName}`;
      const cached = options.refresh ? null : readRuntimeCache(cacheKey);
      if (cached) return cached;
      try {
        const normalized = normalizeHelpPayload(await withRuntimeTimeout(cacheKey, () => api.help(safeKind, safeName, { maxChars: RUNTIME_LIMITS.help, refresh: options.refresh === true })));
        const result = { status: normalized.text.trim() ? 'ready' : 'empty', kind: safeKind, name: safeName, ...normalized };
        return writeRuntimeCache(cacheKey, result);
      } catch (error) {
        return { status: runtimeResultStatus(error), kind: safeKind, name: safeName, text: '', error: runtimeErrorText(error) };
      }
    },
    clearCache() { runtimeCache.clear(); cancelRuntimeRequests(); },
    cancelPending() { cancelRuntimeRequests(); }
  };

  const DOCS = {
    crf: num({ name: 'crf', flag: '-crf', body: 'Select the quality for constant quality mode. Rate factor 0–51: each +6 roughly halves bitrate. 18 is often called visually lossless for 8-bit H.264; 23 is the encoder default.', note: 'Mutually exclusive with -b:v two-pass targeting. VBV (-maxrate/-bufsize) can cap it for streaming.', min: 0, max: 51, step: 1, def: 23, stateKey: 'crf', preview: (v) => `-c:v libx264 -crf ${v}` }),
    crfMax: num({ name: 'crf_max', flag: '-crf_max', body: 'In CRF mode, prevents VBV from lowering quality beyond this point — a worst-quality floor during demanding scenes.', min: 0, max: 51, step: 1, def: 28, stateKey: 'crfMax', preview: (v) => `-crf_max ${v}` }),
    lookahead: num({ name: 'rc-lookahead', flag: '-rc-lookahead', body: 'Number of frames to look ahead for frametype and ratecontrol. Larger values improve quality at a cost of memory and latency. Typical: 40–60 VOD, 10–20 low latency.', min: 0, max: 250, step: 1, def: 40, stateKey: 'lookahead', preview: (v) => `-rc-lookahead ${v}` }),
    preset: en({ name: 'preset', flag: '-preset', stateKey: 'x264Preset', body: 'Set the encoding preset (cf. x264 --fullhelp). A bundle of ~20 analysis settings; slower presets never hurt quality — they only cost CPU.', values: [['ultrafast', 'no CABAC, no B-frames — capture/proxy only'], ['superfast', 'very fast, weak compression'], ['veryfast', 'popular for live streaming'], ['faster', 'step up in refs and ME'], ['fast', 'good live/VOD balance'], ['medium', 'the default reference point'], ['slow', '≈5-10% bitrate savings vs medium'], ['slower', 'b-adapt 2, more refs'], ['veryslow', 'best practical compression'], ['placebo', 'exhaustive; not worth it']], preview: (v) => `-preset ${v}` }),
    tune: en({ name: 'tune', flag: '-tune', stateKey: 'tune', body: 'Tune the encoding params for a class of content. Applied on top of the preset.', values: [['none', 'no content-specific tuning'], ['film', 'live action — grain retention'], ['animation', 'flat cel content'], ['grain', 'heavy film grain'], ['stillimage', 'slideshow-like content'], ['fastdecode', 'weak decoders'], ['zerolatency', 'no frame delay'], ['psnr', 'metric benchmarking'], ['ssim', 'metric benchmarking']], preview: (v) => `-tune ${v}` }),
    profile: en({ name: 'profile', flag: '-profile:v', body: 'Set profile restrictions (Annex A). Limits features so constrained decoders are guaranteed playback.', values: [['auto', 'from options'], ['baseline', 'no CABAC/B-frames — legacy'], ['main', 'CABAC + B, 8-bit 4:2:0'], ['high', '8x8 transform — web default'], ['high10', '10-bit'], ['high422', '4:2:2 pro capture'], ['high444', '4:4:4 + lossless']], preview: (v) => `-profile:v ${v}` }),
    level: en({ name: 'level', flag: '-level', body: 'Specify level (Annex A). Caps decoder requirements; pick the lowest your resolution/fps fits.', values: [['auto', 'derived'], ['3.1', '720p30'], ['4.0', '1080p30'], ['4.1', '1080p30 HB — Blu-ray safe'], ['5.1', '4K30'], ['6.2', '8K120']], preview: (v) => `-level ${v}` }),
    aqmode: en({ name: 'aq-mode', flag: '-aq-mode', body: 'AQ method — redistributes bits so flat and dark areas keep detail.', values: [['none', 'uniform quantization'], ['variance', 'Variance AQ (complexity mask) — default'], ['autovariance', 'auto-variance'], ['autovariance-biased', 'bias to dark scenes']], preview: (v) => `-aq-mode ${v}` }),
    motionest: en({ name: 'motion-est', flag: '-motion-est', body: 'Motion estimation method — wider searches, better matches, more CPU.', values: [['dia', 'diamond — smallest'], ['hex', 'hexagon — default'], ['umh', 'uneven multi-hex'], ['esa', 'exhaustive'], ['tesa', 'transformed exhaustive']], preview: (v) => `-motion-est ${v}` }),
    bpyramid: en({ name: 'b-pyramid', flag: '-b-pyramid', body: 'Keep some B-frames as references.', values: [['none', 'never references'], ['strict', 'Blu-ray hierarchical'], ['normal', 'non-strict — best compression']], preview: (v) => `-b-pyramid ${v}` }),
    weightp: en({ name: 'weightp', flag: '-weightp', body: 'Weighted P-frame prediction analysis — helps fades dramatically.', values: [['none', 'disabled'], ['simple', 'weighted refs'], ['smart', 'refs + duplicates — default']], preview: (v) => `-weightp ${v}` }),
    coder: en({ name: 'coder', flag: '-coder', body: 'Entropy coder. CABAC ≈10-15% better than CAVLC; unavailable in baseline.', values: [['default', 'follow profile'], ['cavlc', 'context-adaptive VLC'], ['cabac', 'binary arithmetic']], preview: (v) => `-coder ${v}` }),
    nalhrd: en({ name: 'nal-hrd', flag: '-nal-hrd', body: 'Signal HRD information (requires vbv-bufsize). Broadcast/HLS validators may require CBR.', values: [['none', 'no signaling'], ['vbr', 'VBR timing'], ['cbr', 'CBR — needs -maxrate = -b:v + -bufsize']], preview: (v) => `-nal-hrd ${v}` }),
    scaleflags: en({ name: 'scale flags', flag: 'scale=…:flags=', body: 'libswscale algorithm. Lanczos is sharper for downscales; neighbor keeps pixel art crisp.', values: [['fast_bilinear', 'fastest, softest'], ['bilinear', 'fast, soft'], ['bicubic', 'default'], ['lanczos', 'sharp downscales'], ['spline', 'ringing-free'], ['neighbor', 'pixel art']], preview: (v) => `scale=1920:-2:flags=${v}` }),
    foar: en({ name: 'force_original_aspect_ratio', flag: 'scale=…:foar=', body: 'Fit inside w×h keeping aspect instead of stretching.', values: [['disable', 'exact w×h (may distort)'], ['decrease', 'shrink to fit'], ['increase', 'grow to cover']], preview: (v) => `scale=1920:1080:force_original_aspect_ratio=${v}` }),
    alpha: num({ name: 'alpha', flag: 'drawtext=alpha=', body: 'Apply alpha while rendering; expressions allowed (fade: if(lt(t,1),t,1)).', min: 0, max: 1, step: 0.05, def: 1, stateKey: 'textAlpha', preview: (v) => `drawtext=…:alpha=${v}` }),
    lufsI: num({ name: 'I (integrated loudness)', flag: 'loudnorm=I=', body: 'Integrated loudness target in LUFS (EBU R128). -24 broadcast, -16 podcast, -14 streaming.', min: -70, max: -5, step: 1, def: -24, unit: ' LUFS', stateKey: 'lufsI', preview: (v) => `loudnorm=I=${v}` }),
    lra: num({ name: 'LRA', flag: 'loudnorm=LRA=', body: 'Loudness range target in LU; lower compresses dynamics more.', min: 1, max: 50, step: 1, def: 7, unit: ' LU', stateKey: 'lra', preview: (v) => `loudnorm=…:LRA=${v}` }),
    tp: num({ name: 'TP (true peak)', flag: 'loudnorm=TP=', body: 'Max true peak in dBTP; -1 to -2 leaves lossy-encode headroom.', min: -9, max: 0, step: 0.1, def: -2, unit: ' dBTP', stateKey: 'tp', preview: (v) => `loudnorm=…:TP=${v}` }),
    giffps: num({ name: 'fps', flag: 'fps=', body: 'GIF frame rate. Rates dividing 100 (10/20/25/50) reproduce most accurately in GIF centisecond delays.', min: 5, max: 30, step: 1, def: 15, stateKey: 'gifFps', preview: (v) => `fps=${v}` }),
    gifcolors: num({ name: 'max_colors', flag: 'palettegen=max_colors=', body: 'Palette size 4–256; fewer colors = smaller files, more banding.', min: 4, max: 256, step: 1, def: 256, stateKey: 'gifColors', preview: (v) => `palettegen=max_colors=${v}` }),
    gifdither: en({ name: 'dither', flag: 'paletteuse=dither=', body: 'Dithering when mapping onto the palette. Error diffusion looks best on gradients; bayer compresses better.', values: [['none', 'posterized, smallest'], ['sierra2_4a', 'default error diffusion'], ['bayer:bayer_scale=2', 'stable ordered pattern'], ['floyd_steinberg', 'classic diffusion'], ['heckbert', 'simple, fast']], preview: (v) => `paletteuse=dither=${v}` }),
    statsmode: en({ name: 'stats_mode', flag: 'palettegen=stats_mode=', body: 'Which pixels palettegen studies.', values: [['full', 'whole clip'], ['diff', 'moving areas only'], ['single', 'per frame (paletteuse new=1)']], preview: (v) => `palettegen=stats_mode=${v}` }),
    nvencpreset: en({ name: 'preset (NVENC)', flag: '-preset', stateKey: 'nvencPreset', body: 'p1 fastest → p7 best quality; p5–p7 enable internal two-pass.', values: [['p1', 'fastest'], ['p2', 'faster'], ['p3', 'fast'], ['p4', 'medium (default)'], ['p5', 'slow'], ['p6', 'slower'], ['p7', 'best hardware quality']], preview: (v) => `-c:v h264_nvenc -preset ${v}` }),
    nvenctune: en({ name: 'tune (NVENC)', flag: '-tune', body: 'NVENC tuning target.', values: [['hq', 'high quality VOD'], ['ll', 'low latency'], ['ull', 'ultra low latency'], ['lossless', 'lossless mode']], preview: (v) => `-tune ${v}` }),
    nvencrc: en({ name: 'rc', flag: '-rc', body: 'Rate control override.', values: [['constqp', 'fixed QP'], ['vbr', 'variable — use with -cq'], ['cbr', 'constant — live']], preview: (v) => `-rc ${v}` }),
    cq: num({ name: 'cq', flag: '-cq', body: 'Constant quality for VBR (0–51, 0=auto). NVENC analogue of CRF; 19–26 practical.', min: 0, max: 51, step: 1, def: 0, stateKey: 'nvencCq', preview: (v) => `-rc vbr -cq ${v}` }),
    hlstime: num({ name: 'hls_time', flag: '-hls_time', body: 'Target segment length (s). Segments split on keyframes — set -g to fps×hls_time.', min: 1, max: 20, step: 1, def: 2, unit: ' s', stateKey: 'hlsTime', preview: (v) => `-hls_time ${v} -g ${v * 24}` }),
    hlslist: num({ name: 'hls_list_size', flag: '-hls_list_size', body: 'Playlist entries; 0 keeps all (VOD), small window + delete_segments = live.', min: 0, max: 30, step: 1, def: 5, stateKey: 'hlsList', preview: (v) => `-hls_list_size ${v}` }),
    segtype: en({ name: 'hls_segment_type', flag: '-hls_segment_type', body: 'Segment container.', values: [['mpegts', 'universal compatibility'], ['fmp4', 'needed for HEVC/AV1; shares files with DASH']], preview: (v) => `-hls_segment_type ${v}` }),
    hlsflags: arr({ name: 'hls_flags', flag: '-hls_flags', body: "Bit flags combined with '+'. Array option — build the set; controls adapt to flag type.", noun: 'muxer flags', arrKey: 'hlsFlagsArr', choices: ['delete_segments', 'independent_segments', 'append_list', 'temp_file', 'program_date_time', 'omit_endlist', 'split_by_time', 'discont_start'], preview: (a) => a.length ? `-hls_flags +${a.join('+')}` : '(no flags set)' }),
    x264params: arr({ name: 'x264-params', flag: '-x264-params', body: 'Override x264 config with :-separated key=value list — the escape hatch to every internal knob. Free-form key=value items.', noun: 'key=value pairs', text: true, arrKey: 'x264ParamsArr', placeholder: 'e.g. keyint=48', preview: (a) => a.length ? `-x264-params ${a.join(':')}` : '(none)' }),
  };
  const HELP_TARGETS = {
    crf: ['encoder', 'libx264'], crfMax: ['encoder', 'libx264'], lookahead: ['encoder', 'libx264'], preset: ['encoder', 'libx264'], tune: ['encoder', 'libx264'], profile: ['encoder', 'libx264'], level: ['encoder', 'libx264'], aqmode: ['encoder', 'libx264'], motionest: ['encoder', 'libx264'], bpyramid: ['encoder', 'libx264'], weightp: ['encoder', 'libx264'], coder: ['encoder', 'libx264'], nalhrd: ['encoder', 'libx264'], x264params: ['encoder', 'libx264'],
    scaleflags: ['filter', 'scale'], foar: ['filter', 'scale'], alpha: ['filter', 'drawtext'], lufsI: ['filter', 'loudnorm'], lra: ['filter', 'loudnorm'], tp: ['filter', 'loudnorm'], giffps: ['filter', 'fps'], gifcolors: ['filter', 'palettegen'], statsmode: ['filter', 'palettegen'], gifdither: ['filter', 'paletteuse'],
    nvencpreset: ['encoder', 'h264_nvenc'], nvenctune: ['encoder', 'h264_nvenc'], nvencrc: ['encoder', 'h264_nvenc'], cq: ['encoder', 'h264_nvenc'],
    hlstime: ['muxer', 'hls'], hlslist: ['muxer', 'hls'], segtype: ['muxer', 'hls'], hlsflags: ['muxer', 'hls']
  };
  Object.entries(HELP_TARGETS).forEach(([id, target]) => { if (DOCS[id]) DOCS[id].runtimeHelp = { kind: target[0], name: target[1] }; });
  window.OPTION_DOCS = DOCS;

  const st = window.state || {};
  st.hlsFlagsArr = st.hlsFlagsArr || ['delete_segments', 'independent_segments', 'program_date_time'];
  st.x264ParamsArr = st.x264ParamsArr || ['keyint=48', 'min-keyint=48', 'scenecut=0'];

  const makeNode = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = boundedText(text, RUNTIME_LIMITS.help);
    return node;
  };
  const renderDocRuntimeHelp = (host, entry, state) => {
    if (!host || !entry.runtimeHelp) return;
    host.replaceChildren();
    const heading = makeNode('p', 'field', `Bundled FFmpeg help · ${entry.runtimeHelp.kind}:${entry.runtimeHelp.name}`);
    heading.style.margin = '0 0 6px'; host.append(heading);
    if (state.status === 'loading') {
      const loading = makeNode('div', 'notice', 'Loading help from the bundled FFmpeg build…');
      loading.setAttribute('role', 'status'); host.append(loading); return;
    }
    if (state.status === 'ready') {
      const pre = makeNode('pre', 'cmd-pre', state.text);
      pre.style.fontSize = '11px'; pre.style.maxHeight = '260px'; pre.style.overflow = 'auto'; pre.style.whiteSpace = 'pre-wrap';
      host.append(pre);
      if (state.truncated) host.append(makeNode('small', '', `Help output was limited to ${RUNTIME_LIMITS.help.toLocaleString()} characters.`));
    } else if (state.status === 'empty') {
      const empty = makeNode('div', 'notice', 'The bundled FFmpeg build returned no help text for this entry.');
      empty.setAttribute('role', 'status'); host.append(empty);
    } else if (['error', 'unavailable', 'timeout', 'cancelled'].includes(state.status)) {
      const error = makeNode('div', 'notice', state.error || 'Bundled FFmpeg help is unavailable.');
      error.setAttribute('role', 'alert'); host.append(error);
    } else {
      host.append(makeNode('small', '', 'Static guidance does not prove availability. Read the bundled build help for the authoritative installed options.'));
    }
    const button = makeNode('button', 'doc-runtime-load outlined', state.status === 'ready' ? 'Refresh bundled help' : 'Read bundled help');
    button.type = 'button'; button.style.marginTop = '8px'; button.style.padding = '7px 12px'; host.append(button);
  };

  let panel = null;
  let catalogPanel = null;
  const closeCatalogPanel = () => { runtimeCatalog.cancelPending(); if (catalogPanel) { catalogPanel.remove(); catalogPanel = null; } };
  window.openDoc = function openDoc(id) {
    const e = DOCS[id]; if (!e) return;
    closeCatalogPanel();
    if (panel) panel.remove();
    const cur = e.stateKey != null ? st[e.stateKey] : undefined;
    let sel = e.kind === 'enum' ? (cur ?? e.values[0][0]) : null;
    let val = e.kind === 'num' ? (typeof cur === 'number' ? cur : e.def) : 0;
    let boolV = e.kind === 'bool' ? (cur ?? true) : true;
    let items = e.kind === 'array' ? [...(st[e.arrKey] || [])] : [];
    let selSet = new Set();
    let runtimeHelpState = { status: 'idle', text: '', error: '', truncated: false };
    panel = document.createElement('div');
    const ownPanel = panel;
    let runtimeRequest = 0;
    panel.style.cssText = 'position:fixed;left:460px;top:70px;z-index:70;width:min(500px,calc(100vw - 40px))';
    const previewVal = () => e.kind === 'enum' ? sel : e.kind === 'num' ? val : e.kind === 'array' ? items : boolV;
    const draw = () => {
      const q = ($g('.doc-search', panel) || {}).value || '';
      panel.innerHTML = `<div style="background:var(--surface);border:1px solid var(--accent);border-radius:18px;box-shadow:0 24px 80px #000c;display:flex;flex-direction:column;max-height:calc(100vh - 80px)">
        <div class="doc-drag" style="cursor:move;padding:14px 18px 12px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;gap:12px">
          <div><p class="eyebrow" style="margin:0 0 3px">Option guide · anchored — drag to move</p>
          <div style="display:flex;gap:8px;align-items:center"><h2 class="mono" style="margin:0;font-size:18px">${escg(e.name)}</h2><span class="tag">${e.kind.toUpperCase()}</span><span class="tag idle mono">${escg(e.flag)}</span></div></div>
          <button class="doc-close icon-button">×</button></div>
        <div style="padding:16px 18px;overflow:auto;display:grid;gap:14px">
          <p style="margin:0;font-size:13px;line-height:1.6">${escg(e.body)}</p>
          <div class="notice">Reference guidance only. The bundled FFmpeg build is authoritative for installed availability and accepted options.</div>
          ${e.note ? `<div class="notice">${escg(e.note)}</div>` : ''}
          ${e.kind === 'enum' ? `<div><p class="field" style="margin:0 0 6px">Guided reference values — pick one</p>
            <div style="display:flex;gap:5px;margin-bottom:8px"><input class="doc-search" placeholder="Search values" value="${escg(q)}" style="width:100%;background:var(--surface2);border:1px solid var(--line);border-radius:11px;color:var(--text);padding:9px 12px"><button class="builder-button doc-rx">.*</button></div>
            <div role="listbox" style="display:grid;gap:4px;max-height:220px;overflow:auto">${e.values.filter(([v, d]) => !q || (v + ' ' + d).toLowerCase().includes(q.toLowerCase())).map(([v, d]) => `<button class="doc-val" data-v="${escg(v)}" style="border:1px solid ${v === sel ? 'var(--accent)' : 'var(--line)'};background:${v === sel ? 'var(--tonal)' : 'var(--surface2)'};text-align:left;display:flex;gap:10px;align-items:center;padding:9px 12px;border-radius:11px;color:var(--text)"><span style="width:14px;height:14px;border-radius:50%;border:2px solid ${v === sel ? 'var(--accent)' : 'var(--line)'};background:${v === sel ? 'var(--accent)' : 'transparent'};flex:none"></span><span><b class="mono" style="font-size:12.5px">${escg(v)}</b><br><small style="color:var(--muted);font-size:11px">${escg(d)}</small></span></button>`).join('')}</div></div>` : ''}
          ${e.kind === 'num' ? `<div><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"><span class="field">Value</span><span style="display:flex;gap:6px;align-items:center"><button class="doc-dn builder-button" style="min-width:28px;height:28px">−</button><b class="mono" style="color:var(--accent);font-size:15px;min-width:52px;text-align:center">${val}${e.unit || ''}</b><button class="doc-up builder-button" style="min-width:28px;height:28px">+</button></span></div>
            <input class="doc-range" type="range" min="${e.min}" max="${e.max}" step="${e.step}" value="${val}"><div class="slider-scale"><span>min ${e.min}</span><span>default ${e.def}</span><span>max ${e.max}</span></div></div>` : ''}
          ${e.kind === 'bool' ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <button class="doc-on" style="border:2px solid ${boolV ? 'var(--accent)' : 'var(--line)'};background:${boolV ? 'var(--tonal)' : 'var(--surface2)'};border-radius:13px;padding:12px;text-align:left;color:var(--text)"><b style="font-size:13px">Enabled</b><br><small style="color:var(--muted);font-size:11px">${escg(e.yes || 'Force on')}</small></button>
            <button class="doc-off" style="border:2px solid ${!boolV ? 'var(--accent)' : 'var(--line)'};background:${!boolV ? 'var(--tonal)' : 'var(--surface2)'};border-radius:13px;padding:12px;text-align:left;color:var(--text)"><b style="font-size:13px">Disabled</b><br><small style="color:var(--muted);font-size:11px">${escg(e.no || 'Force off')}</small></button></div>` : ''}
          ${e.kind === 'array' ? `<div><p class="field" style="margin:0 0 6px">Array builder — ${escg(e.noun)}</p>
            ${e.text ? `<div style="display:flex;gap:5px;margin-bottom:8px"><input class="doc-new mono" placeholder="${escg(e.placeholder || 'value')}" style="width:100%;background:var(--surface2);border:1px solid var(--line);border-radius:11px;color:var(--text);padding:9px 12px"><button class="doc-add tonal" style="padding:0 16px">Add</button></div>`
              : `<div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px">${(e.choices || []).filter((c) => !items.includes(c)).map((c) => `<button class="doc-choice mono" data-v="${escg(c)}" style="border:1px dashed var(--line);background:transparent;color:var(--accent);border-radius:99px;padding:4px 11px;font-size:11.5px;font-weight:600">+ ${escg(c)}</button>`).join('')}</div>`}
            <div style="display:flex;gap:5px;margin-bottom:8px"><input class="doc-search" placeholder="Search items" value="${escg(q)}" style="width:100%;background:var(--surface2);border:1px solid var(--line);border-radius:11px;color:var(--text);padding:9px 12px"><button class="builder-button doc-rx">.*</button></div>
            <div role="listbox" style="display:grid;gap:4px;max-height:180px;overflow:auto;margin-bottom:8px">${items.filter((v) => !q || v.toLowerCase().includes(q.toLowerCase())).map((v) => `<div style="display:flex;gap:10px;align-items:center;padding:8px 12px;border-radius:10px;background:var(--surface2)"><input type="checkbox" class="doc-sel" data-v="${escg(v)}"${selSet.has(v) ? ' checked' : ''}><b class="mono" style="flex:1;font-size:12.5px">${escg(v)}</b><button class="doc-del" data-v="${escg(v)}" style="color:var(--danger);padding:2px 6px;font-size:15px">×</button></div>`).join('')}</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap"><button class="doc-selall outlined" style="padding:5px 12px;font-size:11.5px">Select all</button><button class="doc-selnone outlined" style="padding:5px 12px;font-size:11.5px">Clear selection</button><button class="doc-rmsel" style="color:var(--danger);padding:5px 12px;font-size:11.5px;font-weight:600">Remove selected</button></div></div>` : ''}
          ${e.runtimeHelp ? '<div class="doc-runtime-help"></div>' : ''}
          <div><p class="field" style="margin:0 0 6px">Live preview — command fragment</p><pre class="cmd-pre" style="font-size:11.5px">${escg(e.preview(previewVal()))}</pre></div>
        </div>
        <div style="display:flex;justify-content:space-between;gap:8px;padding:12px 18px;border-top:1px solid var(--line)">
          <small style="color:var(--muted);align-self:center">Closes only via Cancel, Apply, or ×</small>
          <div style="display:flex;gap:8px"><button class="doc-cancel tonal" style="padding:9px 16px">Cancel</button><button class="doc-apply filled" style="padding:9px 16px">Apply to command</button></div></div></div>`;
      const runtimeHost = $g('.doc-runtime-help', panel);
      renderDocRuntimeHelp(runtimeHost, e, runtimeHelpState);
      const runtimeLoad = $g('.doc-runtime-load', panel);
      if (runtimeLoad) runtimeLoad.onclick = async () => {
        if (runtimeHelpState.status === 'loading') return;
        const refresh = runtimeHelpState.status === 'ready' || runtimeHelpState.status === 'empty' || runtimeHelpState.status === 'error';
        const request = ++runtimeRequest;
        runtimeHelpState = { status: 'loading', text: '', error: '', truncated: false }; draw();
        const result = await runtimeCatalog.help(e.runtimeHelp.kind, e.runtimeHelp.name, { refresh });
        if (panel !== ownPanel || request !== runtimeRequest) return;
        runtimeHelpState = result; draw();
      };
      // wire
      const close = () => { runtimeRequest += 1; runtimeCatalog.cancelPending(); if (panel === ownPanel) { panel.remove(); panel = null; } };
      $g('.doc-close', panel).onclick = close; $g('.doc-cancel', panel).onclick = close;
      $g('.doc-apply', panel).onclick = () => {
        if (e.stateKey != null) st[e.stateKey] = e.kind === 'enum' ? sel : e.kind === 'num' ? val : boolV;
        if (e.arrKey) st[e.arrKey] = items;
        if (window.save) window.save(); if (window.render) window.render(); close();
      };
      panel.querySelectorAll('.doc-val').forEach((b) => (b.onclick = () => { sel = b.dataset.v; draw(); }));
      const r = $g('.doc-range', panel); if (r) r.oninput = () => { val = Number(r.value); draw(); };
      const up = $g('.doc-up', panel); if (up) up.onclick = () => { val = Math.min(e.max, +(val + e.step).toFixed(3)); draw(); };
      const dn = $g('.doc-dn', panel); if (dn) dn.onclick = () => { val = Math.max(e.min, +(val - e.step).toFixed(3)); draw(); };
      const on = $g('.doc-on', panel); if (on) on.onclick = () => { boolV = true; draw(); };
      const off = $g('.doc-off', panel); if (off) off.onclick = () => { boolV = false; draw(); };
      const srch = $g('.doc-search', panel); if (srch) srch.oninput = () => draw();
      const rx = $g('.doc-rx', panel); if (rx) rx.onclick = () => window.openRegex && window.openRegex();
      const add = $g('.doc-add', panel); if (add) add.onclick = () => { const v = $g('.doc-new', panel).value.trim(); if (v && !items.includes(v)) { items.push(v); draw(); } };
      panel.querySelectorAll('.doc-choice').forEach((b) => (b.onclick = () => { items.push(b.dataset.v); draw(); }));
      panel.querySelectorAll('.doc-del').forEach((b) => (b.onclick = () => { items = items.filter((x) => x !== b.dataset.v); selSet.delete(b.dataset.v); draw(); }));
      panel.querySelectorAll('.doc-sel').forEach((c) => (c.onchange = () => { c.checked ? selSet.add(c.dataset.v) : selSet.delete(c.dataset.v); }));
      const sa = $g('.doc-selall', panel); if (sa) sa.onclick = () => { selSet = new Set(items); draw(); };
      const sn = $g('.doc-selnone', panel); if (sn) sn.onclick = () => { selSet = new Set(); draw(); };
      const rs = $g('.doc-rmsel', panel); if (rs) rs.onclick = () => { items = items.filter((v) => !selSet.has(v)); selSet = new Set(); draw(); };
      // drag
      const head = $g('.doc-drag', panel);
      head.onmousedown = (ev) => {
        if (ev.target.closest('button')) return;
        const sx = ev.clientX - panel.offsetLeft, sy = ev.clientY - panel.offsetTop;
        const mm = (m) => { panel.style.left = Math.max(8, m.clientX - sx) + 'px'; panel.style.top = Math.max(8, m.clientY - sy) + 'px'; };
        const mu = () => { removeEventListener('mousemove', mm); removeEventListener('mouseup', mu); };
        addEventListener('mousemove', mm); addEventListener('mouseup', mu);
      };
    };
    draw();
    document.body.append(panel);
  };

  // Runtime-derived catalogs remain separate from the static guide above. The bridge output is
  // bounded and rendered with textContent so a tool name or help line can never become markup.
  const catalogKindForHelp = (kind) => ({ encoder: 'encoders', decoder: 'decoders', filter: 'filters', muxer: 'formats', demuxer: 'formats', protocol: 'protocols', bsf: 'bsfs' }[kind] || null);
  const helpKindForCatalogItem = (kind, item, configuredKind) => {
    if (configuredKind) return configuredKind;
    if (kind === 'encoders') return 'encoder';
    if (kind === 'decoders') return 'decoder';
    if (kind === 'filters') return 'filter';
    if (kind === 'protocols') return 'protocol';
    if (kind === 'bsfs') return 'bsf';
    if (kind === 'codecs') return item.canEncode || String(item.flags || '').includes('E') ? 'encoder' : item.canDecode || String(item.flags || '').includes('D') ? 'decoder' : null;
    if (kind === 'formats' || kind === 'devices') return item.muxing || String(item.flags || '').includes('E') ? 'muxer' : item.demuxing || String(item.flags || '').includes('D') ? 'demuxer' : null;
    return null;
  };

  function openRuntimeCatalog(options = {}) {
    const config = typeof options === 'string' ? { kind: options } : (options || {});
    let kind;
    try { kind = validCatalogToken(config.kind || 'filters', 'Catalog kind'); } catch (error) {
      return runtimeCatalog.list(config.kind || '', { limit: 1 });
    }
    if (panel) { panel.remove(); panel = null; }
    closeCatalogPanel();
    let listState = { status: 'loading', items: [], total: 0, truncated: false };
    let helpState = { status: 'idle', text: '', error: '', truncated: false };
    let selected = null;
    let query = boundedText(config.query || '', 256);
    let listRequest = 0;
    let helpRequest = 0;
    let initialSelectionPending = Boolean(config.initialItem);

    catalogPanel = document.createElement('div');
    const ownPanel = catalogPanel;
    ownPanel.className = 'option-catalog-panel';
    ownPanel.setAttribute('role', 'dialog');
    ownPanel.setAttribute('aria-modal', 'false');
    ownPanel.setAttribute('aria-label', 'Bundled FFmpeg catalog');
    ownPanel.style.cssText = 'position:fixed;left:clamp(16px,28vw,420px);top:56px;z-index:75;width:min(700px,calc(100vw - 32px));max-height:calc(100vh - 72px);background:var(--surface);border:1px solid var(--accent);border-radius:18px;box-shadow:0 24px 80px #000c;display:flex;flex-direction:column;overflow:hidden';

    const head = makeNode('div', 'doc-drag');
    head.style.cssText = 'cursor:move;padding:14px 18px 12px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;gap:12px;align-items:center';
    const headCopy = makeNode('div');
    const eyebrow = makeNode('p', 'eyebrow', 'Bundled FFmpeg runtime catalog'); eyebrow.style.margin = '0 0 3px';
    const title = makeNode('h2', 'mono', boundedText(config.title || `${kind} catalog`, 120)); title.style.cssText = 'margin:0;font-size:18px';
    const kindTag = makeNode('span', 'tag idle mono', kind); kindTag.style.marginLeft = '8px'; title.append(kindTag);
    headCopy.append(eyebrow, title);
    const closeButton = makeNode('button', 'icon-button', '×'); closeButton.type = 'button'; closeButton.title = 'Close runtime catalog';
    head.append(headCopy, closeButton);

    const controls = makeNode('div'); controls.style.cssText = 'padding:12px 18px;border-bottom:1px solid var(--line);display:flex;gap:6px;align-items:center';
    const search = makeNode('input', 'runtime-catalog-search'); search.type = 'search'; search.placeholder = 'Search runtime entries'; search.value = query;
    search.style.cssText = 'flex:1;min-width:0;background:var(--surface2);border:1px solid var(--line);border-radius:11px;color:var(--text);padding:9px 12px';
    const regex = makeNode('button', 'builder-button', '.*'); regex.type = 'button'; regex.title = 'Open regex builder';
    const refresh = makeNode('button', 'outlined', 'Refresh'); refresh.type = 'button'; refresh.style.padding = '8px 12px';
    controls.append(search, regex, refresh);

    const body = makeNode('div'); body.style.cssText = 'padding:14px 18px 18px;overflow:auto;display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px';
    const listColumn = makeNode('section');
    const listSummary = makeNode('p', 'field', 'Runtime entries'); listSummary.style.margin = '0 0 8px';
    const listHost = makeNode('div', 'runtime-catalog-list'); listHost.style.cssText = 'display:grid;gap:4px;max-height:430px;overflow:auto';
    listHost.setAttribute('role', 'listbox'); listHost.setAttribute('aria-live', 'polite');
    listColumn.append(listSummary, listHost);
    const detailColumn = makeNode('section');
    const detailSummary = makeNode('p', 'field', 'Bundled help'); detailSummary.style.margin = '0 0 8px';
    const detailHost = makeNode('div', 'runtime-catalog-detail'); detailHost.style.cssText = 'display:grid;gap:8px;min-width:0';
    detailHost.setAttribute('aria-live', 'polite');
    detailColumn.append(detailSummary, detailHost); body.append(listColumn, detailColumn);
    ownPanel.append(head, controls, body); document.body.append(ownPanel);

    const isCurrent = () => catalogPanel === ownPanel;
    const close = () => {
      listRequest += 1; helpRequest += 1;
      if (isCurrent()) closeCatalogPanel();
    };
    const renderDetail = () => {
      detailHost.replaceChildren();
      if (!selected) {
        detailHost.append(makeNode('div', 'notice', 'Select a runtime entry to request its bundled FFmpeg help.'));
        return;
      }
      const selectedName = makeNode('h3', 'mono', selected.name); selectedName.style.cssText = 'margin:0;font-size:15px'; detailHost.append(selectedName);
      if (selected.description) { const description = makeNode('p', '', selected.description); description.style.cssText = 'margin:0;color:var(--muted);font-size:12px;line-height:1.5'; detailHost.append(description); }
      if (helpState.status === 'loading') {
        const loading = makeNode('div', 'notice', 'Loading bundled FFmpeg help…'); loading.setAttribute('role', 'status'); detailHost.append(loading);
      } else if (helpState.status === 'ready') {
        const pre = makeNode('pre', 'cmd-pre', helpState.text); pre.style.cssText = 'font-size:11px;max-height:330px;overflow:auto;white-space:pre-wrap'; detailHost.append(pre);
        if (helpState.truncated) detailHost.append(makeNode('small', '', `Help output was limited to ${RUNTIME_LIMITS.help.toLocaleString()} characters.`));
      } else if (helpState.status === 'empty') {
        detailHost.append(makeNode('div', 'notice', 'The bundled FFmpeg build returned no help text for this entry.'));
      } else if (['error', 'unavailable', 'timeout', 'cancelled'].includes(helpState.status)) {
        const failure = makeNode('div', 'notice', helpState.error || 'Bundled FFmpeg help is unavailable.'); failure.setAttribute('role', 'alert'); detailHost.append(failure);
      }
      const actions = makeNode('div'); actions.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
      const retry = makeNode('button', 'outlined', helpState.status === 'ready' ? 'Refresh help' : 'Retry help'); retry.type = 'button'; retry.style.padding = '7px 12px';
      retry.onclick = () => loadHelp(selected, true);
      actions.append(retry);
      if (typeof config.onSelect === 'function' || config.emitSelection !== false) {
        const use = makeNode('button', 'filled', boundedText(config.useLabel || 'Use selected entry', 80)); use.type = 'button'; use.style.padding = '7px 12px';
        use.onclick = async () => {
          use.disabled = true;
          try {
            const detail = { kind, item: { ...selected }, help: helpState.status === 'ready' ? helpState.text : '' };
            if (typeof config.onSelect === 'function') await config.onSelect(detail);
            if (config.emitSelection !== false) window.dispatchEvent(new CustomEvent('option-guide:catalog-select', { detail }));
            if (config.closeOnSelect !== false) close(); else use.disabled = false;
          } catch (error) {
            helpState = { status: 'error', text: '', error: runtimeErrorText(error), truncated: false }; renderDetail();
          }
        };
        actions.append(use);
      }
      detailHost.append(actions);
    };
    const loadHelp = async (item, forceRefresh = false) => {
      selected = item; helpState = { status: 'loading', text: '', error: '', truncated: false }; renderList(); renderDetail();
      const helpKind = helpKindForCatalogItem(kind, item, config.helpKind);
      if (!helpKind) {
        helpState = { status: 'unavailable', text: '', error: `This ${kind} entry does not expose component help in the bundled FFmpeg interface.`, truncated: false };
        renderDetail(); return;
      }
      const request = ++helpRequest;
      const result = await runtimeCatalog.help(helpKind, item.name, { refresh: forceRefresh });
      if (!isCurrent() || request !== helpRequest || selected !== item) return;
      helpState = result; renderDetail();
    };
    const renderList = () => {
      listHost.replaceChildren();
      if (listState.status === 'loading') {
        const loading = makeNode('div', 'notice', 'Loading entries from the bundled FFmpeg build…'); loading.setAttribute('role', 'status'); listHost.append(loading); return;
      }
      if (['error', 'unavailable', 'timeout', 'cancelled'].includes(listState.status)) {
        const failure = makeNode('div', 'notice', listState.error || 'The bundled FFmpeg catalog is unavailable.'); failure.setAttribute('role', 'alert'); listHost.append(failure); return;
      }
      const needle = query.trim().toLocaleLowerCase();
      const visible = listState.items.filter((item) => !needle || `${item.name} ${item.description}`.toLocaleLowerCase().includes(needle));
      if (!visible.length) {
        listHost.append(makeNode('div', 'notice', listState.status === 'empty' ? 'The bundled FFmpeg build returned no entries for this catalog.' : 'No runtime entries match this search.'));
      } else {
        visible.forEach((item) => {
          const button = makeNode('button', 'runtime-catalog-item'); button.type = 'button'; button.setAttribute('role', 'option'); button.setAttribute('aria-selected', selected === item ? 'true' : 'false');
          button.style.cssText = `border:1px solid ${selected === item ? 'var(--accent)' : 'var(--line)'};background:${selected === item ? 'var(--tonal)' : 'var(--surface2)'};text-align:left;padding:9px 11px;border-radius:10px;color:var(--text);min-width:0`;
          const name = makeNode('b', 'mono', item.name); name.style.cssText = 'display:block;font-size:12.5px;overflow-wrap:anywhere'; button.append(name);
          if (item.description) { const description = makeNode('small', '', item.description); description.style.cssText = 'display:block;color:var(--muted);font-size:11px;line-height:1.35;margin-top:2px;overflow-wrap:anywhere'; button.append(description); }
          button.onclick = () => loadHelp(item); listHost.append(button);
        });
      }
      const count = makeNode('small', '', `${visible.length} shown · ${listState.items.length} loaded${listState.total > listState.items.length ? ` · ${listState.total} reported` : ''}`); count.style.color = 'var(--muted)'; listHost.append(count);
      if (listState.truncated) listHost.append(makeNode('small', '', `Results were limited to ${RUNTIME_LIMITS.results} entries.`));
    };
    const loadList = async (forceRefresh = false) => {
      selected = null; helpState = { status: 'idle', text: '', error: '', truncated: false }; listState = { status: 'loading', items: [], total: 0, truncated: false }; renderList(); renderDetail();
      const request = ++listRequest;
      const result = await runtimeCatalog.list(kind, { limit: RUNTIME_LIMITS.results, refresh: forceRefresh });
      if (!isCurrent() || request !== listRequest) return;
      listState = result; renderList(); renderDetail();
      if (initialSelectionPending && (result.status === 'ready' || result.status === 'empty')) {
        initialSelectionPending = false;
        const targetName = boundedText(config.initialItem, RUNTIME_LIMITS.name).toLocaleLowerCase();
        const initial = result.items.find((item) => item.name.toLocaleLowerCase() === targetName);
        if (initial) {
          if (config.initialHelp !== undefined) {
            selected = initial;
            const normalized = normalizeHelpPayload(config.initialHelp);
            helpState = { status: normalized.text.trim() ? 'ready' : 'empty', kind: config.helpKind || '', name: initial.name, ...normalized };
            renderList(); renderDetail();
          } else loadHelp(initial);
        } else if (config.initialHelp !== undefined) {
          const normalized = normalizeHelpPayload(config.initialHelp);
          selected = { id: targetName, name: boundedText(config.initialItem, RUNTIME_LIMITS.name), description: '', flags: '', type: '', index: -1 };
          helpState = { status: normalized.text.trim() ? 'ready' : 'empty', kind: config.helpKind || '', name: selected.name, ...normalized };
          renderList(); renderDetail();
        }
      }
    };

    closeButton.onclick = close;
    search.oninput = () => { query = boundedText(search.value, 256); if (search.value !== query) search.value = query; renderList(); };
    regex.onclick = () => window.openRegex && window.openRegex();
    refresh.onclick = () => loadList(true);
    ownPanel.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.preventDefault(); close(); } });
    head.onmousedown = (event) => {
      if (event.target.closest('button')) return;
      const startX = event.clientX - ownPanel.offsetLeft; const startY = event.clientY - ownPanel.offsetTop;
      const move = (next) => { ownPanel.style.left = Math.max(8, Math.min(innerWidth - ownPanel.offsetWidth - 8, next.clientX - startX)) + 'px'; ownPanel.style.top = Math.max(8, Math.min(innerHeight - 80, next.clientY - startY)) + 'px'; };
      const stop = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', stop); };
      addEventListener('mousemove', move); addEventListener('mouseup', stop);
    };
    renderList(); renderDetail(); loadList(); setTimeout(() => { if (isCurrent()) search.focus(); }, 0);
    return ownPanel;
  }

  function openRuntimeHelp(options = {}) {
    const config = options && typeof options === 'object' ? options : {};
    let helpKind; let name;
    try {
      helpKind = validCatalogToken(config.kind, 'Help kind');
      name = boundedText(config.name, RUNTIME_LIMITS.name).trim();
      if (!/^[a-z0-9_.+-]{1,128}$/i.test(name)) throw new Error('Help name contains unsupported characters.');
    } catch (error) {
      return runtimeCatalog.help(config.kind || '', config.name || '');
    }
    const catalogKind = catalogKindForHelp(helpKind);
    if (!catalogKind) return runtimeCatalog.help(helpKind, name, { refresh: true });
    return openRuntimeCatalog({
      kind: catalogKind,
      helpKind,
      initialItem: name,
      initialHelp: config.help,
      title: `${helpKind}:${name}`,
      emitSelection: false,
      closeOnSelect: false
    });
  }

  window.openOptionCatalog = openRuntimeCatalog;
  window.optionGuides = Object.freeze({
    docs: DOCS,
    limits: RUNTIME_LIMITS,
    list: (kind, options) => runtimeCatalog.list(kind, options),
    help: (kind, name, options) => runtimeCatalog.help(kind, name, options),
    openCatalog: openRuntimeCatalog,
    openRuntimeHelp,
    close: () => { if (panel) { panel.remove(); panel = null; } closeCatalogPanel(); },
    clearCache: () => runtimeCatalog.clearCache()
  });

  // ---- inject ⓘ buttons next to known controls after every render ----
  const LABEL_MAP = [['crf —', 'crf'], ['crf_max', 'crfMax'], ['rc-lookahead', 'lookahead'], ['tune — content', 'tune'], ['profile —', 'profile'], ['level —', 'level'], ['aq-mode', 'aqmode'], ['motion-est', 'motionest'], ['b-pyramid', 'bpyramid'], ['weightp', 'weightp'], ['coder', 'coder'], ['nal-hrd', 'nalhrd'], ['flags — scaler', 'scaleflags'], ['force_original', 'foar'], ['alpha —', 'alpha'], ['I — integrated', 'lufsI'], ['LRA —', 'lra'], ['TP —', 'tp'], ['fps', 'giffps'], ['palettegen max_colors', 'gifcolors'], ['paletteuse dither', 'gifdither'], ['palettegen stats_mode', 'statsmode'], ['rc — rate', 'nvencrc'], ['cq —', 'cq'], ['hls_time', 'hlstime'], ['hls_list_size', 'hlslist'], ['hls_segment_type', 'segtype']];
  function injectInfo(root) {
    root.querySelectorAll('.slider-head > span:first-child, .field > span:first-child, label.field').forEach((el) => {
      if (el.querySelector('.doc-info') || el.closest('#ctx-menu')) return;
      const txt = (el.childNodes[0] && el.childNodes[0].textContent || '').trim();
      const hit = LABEL_MAP.find(([p]) => txt.startsWith(p));
      if (!hit) return;
      const b = document.createElement('button');
      b.className = 'doc-info'; b.title = 'Open option guide';
      b.style.cssText = 'border:0;background:transparent;color:var(--accent);cursor:pointer;padding:0 4px;vertical-align:middle';
      b.innerHTML = '<span class="ms" style="font-size:15px">info</span>';
      b.onclick = (ev) => { ev.preventDefault(); ev.stopPropagation(); window.openDoc(hit[1]); };
      el.appendChild(b);
    });
  }
  const content = $g('#content');
  if (content) { new MutationObserver(() => injectInfo(content)).observe(content, { childList: true }); injectInfo(content); }

  // ---- ctx-menu search bar ----
  const ctx = $g('#ctx-menu');
  if (ctx) new MutationObserver(() => {
    if (ctx.hidden || $g('.ctx-search', ctx)) return;
    const wrap = document.createElement('div');
    wrap.style.cssText = 'padding:2px 4px 6px';
    wrap.style.display = 'flex'; wrap.style.gap = '4px';
    wrap.innerHTML = '<input class="ctx-search" placeholder="Search actions" style="flex:1;min-width:0;background:var(--surface2);border:1px solid var(--line);border-radius:9px;color:var(--text);padding:7px 10px;font-size:12px;box-sizing:border-box"><button class="ctx-rx" title="Regex builder" style="border:0;min-width:32px;background:var(--surface3);border-radius:8px;color:var(--accent);font-weight:800;cursor:pointer;font-family:var(--mono);font-size:11px">.*</button>';
    const header = ctx.querySelector('header');
    if (header) header.after(wrap); else ctx.prepend(wrap);
    const inp = $g('.ctx-search', ctx);
    inp.onclick = (e) => e.stopPropagation();
    const rxb = $g('.ctx-rx', ctx); if (rxb) rxb.onclick = (e) => { e.stopPropagation(); ctx.hidden = true; window.openRegex && window.openRegex(); };
    inp.oninput = null;
    inp.oninput = () => { const q = inp.value.toLowerCase(); ctx.querySelectorAll('button[data-context-action]').forEach((b) => { b.style.display = b.textContent.toLowerCase().includes(q) ? '' : 'none'; }); };
    requestAnimationFrame(() => ctx.dispatchEvent(new CustomEvent('archive-context-menu-opened')));
  }).observe(ctx, { childList: true, attributes: true, attributeFilter: ['hidden'] });

  // ---- draggable dialogs (regex builder and friends) ----
  document.addEventListener('mousedown', (ev) => {
    const head = ev.target.closest('.dialog-head');
    if (!head || ev.target.closest('button')) return;
    const dlg = head.closest('dialog'); if (!dlg || !dlg.open) return;
    head.style.cursor = 'move';
    const r = dlg.getBoundingClientRect();
    dlg.style.position = 'fixed'; dlg.style.margin = '0';
    dlg.style.left = r.left + 'px'; dlg.style.top = r.top + 'px';
    const sx = ev.clientX - r.left, sy = ev.clientY - r.top;
    const mm = (m) => { dlg.style.left = Math.max(8, m.clientX - sx) + 'px'; dlg.style.top = Math.max(8, m.clientY - sy) + 'px'; };
    const mu = () => { removeEventListener('mousemove', mm); removeEventListener('mouseup', mu); };
    addEventListener('mousemove', mm); addEventListener('mouseup', mu);
  });

  // ---- every <select> becomes a dropdown listbox with search + regex ----
  let ddPop = null;
  const closeDd = () => { if (ddPop) { ddPop.remove(); ddPop = null; } };
  document.addEventListener('mousedown', (e) => {
    const sel = e.target.closest('select');
    if (!sel) { if (ddPop && !e.target.closest('.dd-pop')) closeDd(); return; }
    e.preventDefault();
    closeDd();
    const r = sel.getBoundingClientRect();
    ddPop = document.createElement('div');
    ddPop.className = 'dd-pop';
    ddPop.style.cssText = 'position:fixed;z-index:80;left:' + Math.min(r.left, innerWidth - 300) + 'px;top:' + (r.bottom + 4) + 'px;width:' + Math.max(r.width, 280) + 'px;background:var(--surface);border:1px solid var(--accent);border-radius:14px;box-shadow:0 14px 44px #000b;padding:8px;display:grid;gap:6px';
    const opts = [...sel.options].map((o) => o.text);
    const draw = (q = '') => {
      ddPop.innerHTML = '<div style="display:flex;gap:4px"><input class="dd-q" placeholder="Search values" value="' + escg(q) + '" style="flex:1;min-width:0;background:var(--surface2);border:1px solid var(--line);border-radius:9px;color:var(--text);padding:8px 10px;font-size:12.5px"><button class="dd-rx" style="border:0;min-width:34px;background:var(--surface3);border-radius:8px;color:var(--accent);font-weight:800;cursor:pointer;font-family:var(--mono);font-size:11px">.*</button></div>' +
        '<div style="display:grid;gap:3px;max-height:240px;overflow:auto">' + opts.filter((t) => !q || t.toLowerCase().includes(q.toLowerCase())).map((t) => {
          const cur = sel.options[sel.selectedIndex] && sel.options[sel.selectedIndex].text === t;
          return '<button class="dd-opt" data-t="' + escg(t) + '" style="border:0;background:' + (cur ? 'var(--tonal)' : 'transparent') + ';text-align:left;display:flex;gap:9px;align-items:center;padding:8px 10px;border-radius:9px;cursor:pointer;color:var(--text)"><span class="ms" style="font-size:15px;color:' + (cur ? 'var(--accent)' : 'transparent') + '">check</span><b class="mono" style="font-size:12.5px">' + escg(t) + '</b></button>';
        }).join('') + '</div>';
      const q2 = ddPop.querySelector('.dd-q');
      q2.oninput = () => { const v = q2.value; draw(v); ddPop.querySelector('.dd-q').focus(); const inp = ddPop.querySelector('.dd-q'); inp.setSelectionRange(v.length, v.length); };
      ddPop.querySelector('.dd-rx').onclick = () => { closeDd(); window.openRegex && window.openRegex(); };
      ddPop.querySelectorAll('.dd-opt').forEach((b) => (b.onclick = () => {
        const i = [...sel.options].findIndex((o) => o.text === b.dataset.t);
        if (i >= 0) { sel.selectedIndex = i; sel.dispatchEvent(new Event('change', { bubbles: true })); }
        closeDd();
      }));
    };
    draw();
    document.body.append(ddPop);
    setTimeout(() => { const q = ddPop && ddPop.querySelector('.dd-q'); if (q) q.focus(); }, 0);
  }, true);

  // ---- security gate: password or password + TOTP ----
  const SEC_KEY = 'mffmpeg.sec';
  const sha = async (t) => { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('mffmpeg:' + t)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join(''); };
  const getSec = () => { try { return JSON.parse(localStorage.getItem(SEC_KEY)); } catch { return null; } };
  window.secSave = async (pw, totp) => { localStorage.setItem(SEC_KEY, JSON.stringify({ hash: await sha(pw), totp: !!totp })); };
  window.secLock = () => showGate();
  function showGate() {
    const sec = getSec(); if (!sec) return;
    if ($g('#sec-gate')) return;
    const o = document.createElement('div');
    o.id = 'sec-gate';
    o.style.cssText = 'position:fixed;inset:0;z-index:99;background:var(--bg);display:grid;place-items:center';
    o.innerHTML = '<div style="width:min(400px,calc(100vw - 40px));background:var(--surface);border:1px solid var(--line);border-radius:22px;padding:30px;box-shadow:0 24px 80px #000c;text-align:center">' +
      '<div style="width:52px;height:52px;margin:0 auto 14px;display:grid;place-items:center;border-radius:16px;background:var(--accent);color:var(--on-accent);font-weight:800;font-size:24px">M</div>' +
      '<h2 style="margin:0 0 4px;font-size:20px">material-ffmpeg is locked</h2>' +
      '<p style="margin:0 0 18px;color:var(--muted);font-size:12.5px">' + (sec.totp ? 'Enter your password and the current 6-digit code.' : 'Enter your password to continue.') + '</p>' +
      '<div style="display:grid;gap:10px;text-align:left">' +
      '<label class="field">Password<input id="sec-pw" type="password"></label>' +
      (sec.totp ? '<label class="field">TOTP code<input id="sec-code" maxlength="6" placeholder="6 digits" class="mono" style="letter-spacing:6px;text-align:center;font-size:16px"></label>' : '') +
      '<div id="sec-err" style="display:none;padding:9px 12px;border-radius:10px;background:#422323;color:var(--danger);font-size:12px"></div>' +
      '<button id="sec-go" class="filled" style="justify-content:center;font-size:14px;padding:12px">Unlock</button></div></div>';
    document.body.append(o);
    $g('#sec-go', o).onclick = async () => {
      const pw = $g('#sec-pw', o).value;
      const err = $g('#sec-err', o);
      if (await sha(pw) !== sec.hash) { err.textContent = 'Wrong password.'; err.style.display = 'block'; return; }
      if (sec.totp && !/^\d{6}$/.test(($g('#sec-code', o) || {}).value || '')) { err.textContent = 'TOTP code must be 6 digits.'; err.style.display = 'block'; return; }
      o.remove();
    };
  }
  if (getSec()) showGate();
})();
