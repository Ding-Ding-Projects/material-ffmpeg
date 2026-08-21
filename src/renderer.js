/* material-ffmpeg renderer — vanilla, no bundler. Mirrors the design source of truth. */
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const store = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem('mffmpeg.' + k)) ?? d; } catch { return d; } },
  set: (k, v) => localStorage.setItem('mffmpeg.' + k, JSON.stringify(v)),
};

const state = Object.assign({
  view: 'overview', theme: 'dark', logo: 'M',
  crf: 20, crfMax: 28, lookahead: 40, tune: 'film', x264Preset: 'medium', fpsIdx: 3,
  fontColor: '#f2e9d8', textAlpha: 0.9, lufsI: -16, lra: 11, tp: -1.5,
  gifFps: 15, gifColors: 128, nvencCq: 23, nvencPreset: 'p5', hlsTime: 6, hlsList: 6,
  selNode: 'drawtext', bools: {}, vocab: null,
}, store.get('state', {}));
const save = () => store.set('state', state);

/* ---------- data ---------- */
const GROUPS = {
  overview: { title: 'Home', items: [['overview', 'dashboard', 'Overview'], ['jobs', 'receipt_long', 'Jobs & logs'], ['settings', 'settings', 'Settings']] },
  media: { title: 'Media', items: [['convert', 'sync_alt', 'Convert'], ['trim', 'content_cut', 'Trim & clip'], ['filters', 'account_tree', 'Filtergraph'], ['audio', 'graphic_eq', 'Audio'], ['gif', 'gif_box', 'GIF & thumbs'], ['presets', 'bookmarks', 'Presets'], ['inspector', 'search_insights', 'Inspector']] },
  registry: { title: 'Registry', items: [['codecs', 'memory', 'Codecs', '718'], ['formats', 'folder_zip', 'Formats', '402'], ['protocols', 'lan', 'Protocols', '58'], ['bsf', 'swap_horiz', 'Bitstream filters', '44'], ['devices', 'videocam', 'Devices', '12'], ['matrix', 'grid_on', 'Capability matrix']] },
  system: { title: 'System', items: [['hwaccel', 'developer_board', 'Hardware accel'], ['streaming', 'podcasts', 'Streaming'], ['composer', 'terminal', 'Composer'], ['converter', 'published_with_changes', 'File converter']] },
};
const RAIL = [['overview', 'dashboard', 'Home'], ['media', 'movie', 'Media'], ['registry', 'database', 'Registry'], ['system', 'developer_board', 'System']];
const viewGroup = (v) => Object.keys(GROUPS).find((g) => GROUPS[g].items.some((i) => i[0] === v)) || 'overview';

const X264_PRESETS = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow', 'placebo'];
const FPS_LIST = ['23.976 (24000/1001)', '24/1', '25/1', '29.97 (30000/1001)', '30/1', '50/1', '59.94 (60000/1001)', '60/1'];
const X264_BOOLS = [
  ['mbtree', 'Use macroblock tree ratecontrol.', true], ['psy', 'Use psychovisual optimizations.', true],
  ['mixed-refs', 'One reference per partition, not per macroblock', true], ['8x8dct', 'High profile 8x8 transform.', true],
  ['fast-pskip', 'Early skip detection on P-frames', true], ['weightb', 'Weighted prediction for B-frames.', true],
  ['intra-refresh', 'Periodic Intra Refresh instead of IDR frames.', false], ['bluray-compat', 'Bluray compatibility workarounds.', false],
  ['aud', 'Use access unit delimiters.', false], ['ssim', 'Calculate and print SSIM stats.', false],
  ['fastfirstpass', 'Use fast settings when encoding first pass', true], ['forced-idr', 'Force keyframes as IDR frames.', false],
];
const JOBS = [
  ['sync_alt', 'interview_final.mp4', 'libx264 crf 20 · scale 1920:-2 · loudnorm', 'ENCODING', '87.4 fps · 3.6×', 62, 'pause'],
  ['podcasts', 'hls ladder — ep04/', '3 renditions · hls_time 6 · fmp4', 'ENCODING', '1.2× realtime', 31, 'pause'],
  ['graphic_eq', 'podcast_ep12.flac', 'loudnorm I=-16 TP=-1.5 · two-pass', 'DONE', '41.8×', 100, 'folder_open'],
  ['gif_box', 'teaser_loop.gif', 'palettegen/paletteuse · fps 15 · 128 colors', 'QUEUED', 'waiting', 0, 'play_arrow'],
];
const REGISTRY = {
  codecs: ['Codecs — 718 of 718', 'Every codec compiled into this build, from libavcodec/allcodecs.c.', 'Search 718 codecs', ['All', 'Video', 'Audio', 'Subtitle', 'Encoders', 'Decoders', 'Hardware'], [
    ['libx264', 'H.264 / AVC via x264 — the reference software encoder', 'VIDEO·ENCODER'], ['h264_nvenc', 'NVIDIA NVENC H.264 hardware encoder', 'VIDEO·HW'],
    ['libx265', 'H.265 / HEVC via x265', 'VIDEO·ENCODER'], ['libsvtav1', 'AV1 via SVT-AV1', 'VIDEO·ENCODER'],
    ['libvpx-vp9', 'VP9 via libvpx', 'VIDEO·ENCODER'], ['prores_ks', 'Apple ProRes encoder (Kostya)', 'VIDEO·ENCODER'],
    ['aac', 'Native AAC-LC encoder/decoder', 'AUDIO·BOTH'], ['libopus', 'Opus via libopus', 'AUDIO·ENCODER'],
    ['flac', 'FLAC lossless', 'AUDIO·BOTH'], ['pcm_s24le', 'PCM signed 24-bit little-endian', 'AUDIO·BOTH'],
    ['ass', 'ASS / SSA subtitles', 'SUBTITLE·BOTH'], ['mjpeg', 'Motion JPEG', 'VIDEO·BOTH']]],
  formats: ['Formats — 402 muxers/demuxers', 'Container formats from libavformat; each muxer exposes its private AVOption set.', 'Search 402 formats', ['All', 'Muxers', 'Demuxers', 'Streaming', 'Image'], [
    ['mp4 / mov', 'ISO Base Media — faststart, fragmentation, edit lists', 'MUX·DEMUX'], ['matroska', 'MKV — attachments, chapters, any codec', 'MUX·DEMUX'],
    ['mpegts', 'MPEG transport stream — broadcast & HLS segments', 'MUX·DEMUX'], ['hls', 'Apple HTTP Live Streaming muxer', 'MUX'],
    ['dash', 'MPEG-DASH segmenter', 'MUX'], ['webm', 'WebM (VP8/VP9/AV1 + Opus/Vorbis)', 'MUX·DEMUX'],
    ['flv', 'Flash Video — RTMP payload', 'MUX·DEMUX'], ['wav', 'RIFF WAVE audio', 'MUX·DEMUX'],
    ['image2', 'Image sequence (%04d patterns)', 'MUX·DEMUX'], ['gif', 'Animated GIF muxer', 'MUX']]],
  protocols: ['Protocols — 58 of 58', 'I/O protocols from libavformat: every URL scheme ffmpeg can read or write.', 'Search 58 protocols', ['All', 'Input', 'Output', 'Network', 'Crypto'], [
    ['file', 'Local file access', 'IN·OUT'], ['pipe', 'stdin/stdout piping', 'IN·OUT'],
    ['http / https', 'HTTP with cookies, headers, reconnect options', 'IN·OUT'], ['rtmp', 'Real-Time Messaging Protocol', 'IN·OUT'],
    ['srt', 'Secure Reliable Transport — latency, passphrase', 'IN·OUT'], ['rtsp', 'RTSP with TCP/UDP transport selection', 'IN·OUT'],
    ['udp', 'Raw UDP with buffer/ttl options', 'IN·OUT'], ['tcp', 'Raw TCP', 'IN·OUT'],
    ['crypto', 'AES-encrypted stream reading', 'IN'], ['concat', 'Virtual concatenation of inputs', 'IN']]],
  bsf: ['Bitstream filters — 44 of 44', 'Packet-level transforms from libavcodec — no re-encode required.', 'Search 44 bitstream filters', ['All', 'H.264/5', 'Metadata', 'Repair'], [
    ['h264_mp4toannexb', 'Convert AVCC to Annex B start codes (for mpegts)', 'H264'], ['hevc_mp4toannexb', 'Same conversion for HEVC', 'HEVC'],
    ['extract_extradata', 'Pull parameter sets from packets', 'META'], ['av1_metadata', 'Edit AV1 sequence header fields', 'AV1·META'],
    ['h264_metadata', 'Edit SPS fields: SAR, level, colors', 'H264·META'], ['setts', 'Rewrite packet timestamps with expressions', 'META'],
    ['noise', 'Corrupt packets deliberately (testing)', 'REPAIR'], ['filter_units', 'Drop/pass NAL unit types', 'H264·HEVC']]],
  devices: ['Devices — 12 of 12', 'Capture and playback devices from libavdevice, as detected on this machine.', 'Search 12 devices', ['All', 'Video in', 'Audio in', 'Output'], [
    ['dshow', 'DirectShow — Logitech BRIO, Elgato HD60 X detected', 'VIDEO·AUDIO'], ['gdigrab', 'Windows GDI screen capture', 'VIDEO'],
    ['ddagrab', 'Desktop Duplication API capture (D3D11)', 'VIDEO·HW'], ['wasapi', 'Windows audio session capture', 'AUDIO'],
    ['lavfi', 'Libavfilter virtual input device', 'VIRTUAL'], ['sdl2', 'SDL2 output window', 'OUTPUT']]],
  matrix: ['Capability matrix', 'Which encoder works in which container, with hardware pathways.', 'Search matrix', ['All', 'mp4', 'mkv', 'webm', 'mpegts'], [
    ['libx264 → mp4', 'Universal playback; faststart recommended', 'OK'], ['libx265 → mp4', 'hvc1 tag needed for Apple', 'OK·TAG'],
    ['libsvtav1 → mp4', 'AV1 in ISOBMFF — modern players only', 'OK'], ['libvpx-vp9 → webm', 'The canonical WebM pairing', 'OK'],
    ['prores_ks → mov', 'Edit-friendly intermediate', 'OK'], ['h264_nvenc → mpegts', 'Broadcast/HLS segments, Annex B', 'OK·BSF'],
    ['libopus → mp4', 'Supported since 2016 spec update', 'CAUTION'], ['flac → mp4', 'Experimental flag required', 'EXPERIMENTAL']]],
};
const NOTIFS = store.get('notifs', [
  ['Job finished — podcast_ep12.flac', 'loudnorm two-pass completed at 41.8× realtime.', 'today 14:22'],
  ['NVENC session limit reached', '3rd parallel encode fell back to libx264.', 'today 13:05'],
  ['Preset saved — YouTube 4K master', 'Available in Presets and the command palette.', 'yesterday 19:44'],
]);

const liveCommand = () => `ffmpeg -hwaccel cuda -i interview_cam_A.mov -vf "scale=1920:-2:flags=bicubic,drawtext=text='EP 04 — ROUGH CUT':fontcolor=${state.fontColor}@${state.textAlpha}:x=(w-text_w)/2:y=h-line_h-24" -c:v libx264 -preset ${state.x264Preset} -tune ${state.tune} -crf ${state.crf} -rc-lookahead ${state.lookahead} -af loudnorm=I=${state.lufsI}:LRA=${state.lra}:TP=${state.tp} -c:a aac -b:a 256k -movflags +faststart interview_final.mp4`;

/* ---------- shared partials ---------- */
const slider = (id, label, val, min, max, step, unit = '') => `
  <div><div class="slider-head"><span>${esc(label)}</span><b>${esc(val)}${unit}</b></div>
  <input type="range" id="${id}" min="${min}" max="${max}" step="${step || 1}" value="${val}"></div>`;
const field = (label, inner) => `<label class="field">${esc(label)}${inner}</label>`;
const sel = (opts, selIdx = 0) => `<select>${opts.map((o, i) => `<option${i === selIdx ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
const searchLine = (ph) => `<div class="search-line"><input placeholder="${esc(ph)}"><button class="builder-button" data-builder="x">.*</button></div>`;
const jobRows = (bulk) => JOBS.map(([icon, name, cmd, st, meta, pct, act]) => `
  <div class="list-item" style="display:block">
    <div style="display:flex;gap:10px;align-items:center">
      ${bulk ? `<input type="checkbox" class="job-sel" data-name="${esc(name)}"${(state.jobSel || {})[name] ? ' checked' : ''} title="Select for bulk actions">` : ''}
      ${(state.locks || {})[name] ? '<span class="ms" title="Locked (toy lock) — right-click to unlock" style="font-size:16px;color:var(--danger)">lock</span>' : ''}
      <span class="ms">${icon}</span>
      <span style="flex:1;min-width:0"><b style="font-size:13px">${esc(name)}</b><br><small class="mono">${esc(cmd)}</small></span>
      <span class="tag${st === 'ENCODING' ? '' : ' idle'}">${st}</span>
      <b class="mono" style="font-size:12px;color:var(--muted)">${esc(meta)}</b>
      <button title="${act}" style="background:var(--surface3);width:34px;height:34px;border-radius:50%"><span class="ms" style="font-size:17px">${act}</span></button>
    </div>
    <div class="progress-track"><span style="width:${pct}%"></span></div>
  </div>`).join('');

/* ---------- views ---------- */
const VIEWS = {
  overview: () => `
    <div class="page-head"><div><p class="eyebrow">Media control plane</p><h1>Overview</h1><p class="lede" style="margin:0">Every codec, filter, muxer, protocol, and device in this build is inspectable and configurable here — no terminal required.</p></div>
    <div class="head-actions"><button class="filled" data-go="convert"><span class="ms" style="font-size:18px">add</span>New job</button><button class="tonal" data-go="composer">Command composer</button></div></div>
    <div class="grid">
      ${[['Codecs in build', '718', '451 encoders · 267 hw paths'], ['Filters', '458', 'libavfilter · 214 video · 176 audio'], ['Muxers / demuxers', '402', '58 protocols · 44 bitstream filters'], ['Queue', '2 + 2', 'encoding + waiting · 3.6× avg speed']].map(([l, v, s]) => `
        <div class="card span3"><div style="display:flex;justify-content:space-between;align-items:center"><span style="color:var(--muted);font-size:12px;font-weight:500">${l}</span><button data-appearance="${l}" title="Edit appearance" style="color:var(--muted)"><span class="ms" style="font-size:15px">palette</span></button></div><div class="stat">${v}</div><small style="color:var(--muted)">${s}</small></div>`).join('')}
      <div class="card span8"><div style="display:flex;justify-content:space-between;margin-bottom:14px"><h2 style="margin:0">Active queue</h2><button class="tonal" style="padding:6px 14px;font-size:12.5px" data-go="jobs">All jobs</button></div><div class="list">${jobRows()}</div></div>
      <div class="span4" style="display:grid;gap:14px;align-content:start">
        <div class="card"><h3>Quick actions</h3><div class="list">
          ${[['sync_alt', 'Convert a file', 'convert'], ['content_cut', 'Trim without re-encode', 'trim'], ['graphic_eq', 'Normalize loudness', 'audio'], ['search_insights', 'Inspect media (ffprobe)', 'inspector']].map(([i, l, v]) => `<button class="list-item" data-go="${v}" style="width:100%;text-align:left;font-size:13px"><span class="ms">${i}</span>${l}</button>`).join('')}
        </div></div>
        <div class="card"><h3>Personal vocabulary</h3><p class="hint" style="margin-bottom:10px">Load a local vocabulary JSON to rename surfaces in your own words. Stays private and on this machine.</p>
        <label class="upload-slot"><span class="ms" style="font-size:18px">upload_file</span>Upload vocabulary JSON<input type="file" class="vocab-upload" accept="application/json" hidden></label></div>
      </div>
    </div>`,

  convert: () => `
    <div class="page-head"><div><p class="eyebrow">Transcode</p><h1>Convert — libx264</h1><p class="lede" style="margin:0">Every encoder option from libavcodec/libx264.c as a typed control.</p></div>
    <div class="head-actions"><button class="outlined">Save as preset</button><button class="filled" data-go="jobs"><span class="ms" style="font-size:18px">play_arrow</span>Queue job</button></div></div>
    <div class="grid">
      <div class="span7" style="display:grid;gap:14px;align-content:start">
        <div class="card"><h2>Rate control</h2><p class="hint">CRF is constant-quality; QP is constant-quantizer. Setting a bitrate switches x264 to ABR/VBV.</p>
          <div style="display:grid;gap:16px">
            ${slider('crf', 'crf — Select the quality for constant quality mode', state.crf, 0, 51)}
            <div class="slider-scale"><span>0 lossless</span><span>18 visually lossless</span><span>23 default</span><span>51 worst</span></div>
            <div class="two-col">${slider('crfMax', 'crf_max — VBV quality floor', state.crfMax, 0, 51)}${slider('lookahead', 'rc-lookahead — frames', state.lookahead, 0, 250)}</div>
          </div></div>
        <div class="card"><h2>Preset · tune · profile</h2><p class="hint">preset — “Set the encoding preset (cf. x264 --fullhelp)”.</p>
          <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:16px">${X264_PRESETS.map((p) => `<button class="chip-btn${p === state.x264Preset ? ' active' : ''}" data-x264preset="${p}">${p}</button>`).join('')}</div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
            ${field('tune — content hint', `<select id="tune">${['none', 'film', 'animation', 'grain', 'stillimage', 'fastdecode', 'zerolatency', 'psnr', 'ssim'].map((t) => `<option${t === state.tune ? ' selected' : ''}>${t}</option>`).join('')}</select>`)}
            ${field('profile — restriction set', sel(['auto', 'baseline', 'main', 'high', 'high10', 'high444'], 3))}
            ${field('level — Annex A level', sel(['auto', '3.1', '4.0', '4.1', '5.1', '6.2'], 3))}
          </div></div>
        <div class="card"><h2>Analysis &amp; psychovisual</h2><p class="hint">Toggles map 1:1 to AVOption booleans; hover any control for the source description.</p>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 18px">
            ${X264_BOOLS.map(([n, d, def]) => `<label class="check-row" title="${esc(d)}"><input type="checkbox" data-bool="${n}"${(state.bools[n] ?? def) ? ' checked' : ''}><span style="flex:1;min-width:0"><b>${n}</b><br><small>${esc(d)}</small></span></label>`).join('')}
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px">
            ${field('aq-mode — AQ method', sel(['none', 'variance — complexity mask', 'autovariance', 'autovariance-biased — dark scenes'], 1))}
            ${field('motion-est — estimation method', sel(['dia', 'hex', 'umh', 'esa', 'tesa'], 1))}
            ${field('b-pyramid — B refs', sel(['none', 'strict — Blu-ray', 'normal — non-strict'], 2))}
            ${field('weightp — weighted P', sel(['none', 'simple', 'smart'], 2))}
            ${field('coder — entropy coder', sel(['default', 'cavlc / vlc', 'cabac / ac'], 2))}
            ${field('nal-hrd — HRD signaling', sel(['none', 'vbr', 'cbr — requires vbv-bufsize'], 0))}
          </div></div>
      </div>
      <div class="span5" style="display:grid;gap:14px;align-content:start">
        <div class="card"><h2>Input → output</h2>
          <div class="list" style="margin:12px 0">
            <div class="list-item"><span class="ms">movie</span><span style="flex:1;min-width:0"><b style="font-size:13px">interview_cam_A.mov</b><br><small class="mono">ProRes 422 HQ · 3840×2160 · 23.976 · 12:41 · 42.1 GB</small></span><button id="pick-input" class="tonal" style="padding:5px 12px;font-size:11.5px">Change</button></div>
            <div class="list-item"><span class="ms">output</span><span style="flex:1"><b style="font-size:13px">interview_final.mp4</b><br><small class="mono">H.264 High · mp4 · faststart</small></span></div>
          </div>
          <h3>scale — output size</h3>
          <div class="two-col">
            ${field('w × h (−1/−2 keep aspect)', '<div style="display:flex;gap:6px"><input value="1920" class="mono"><input value="-2" class="mono"></div>')}
            <div class="field"><span>fps — rational stepper</span><div style="display:flex;gap:4px;align-items:center"><button id="fps-down" class="builder-button" style="min-width:34px;height:38px">−</button><b class="mono" style="flex:1;text-align:center;font-size:13px" id="fps-val">${FPS_LIST[state.fpsIdx]}</b><button id="fps-up" class="builder-button" style="min-width:34px;height:38px">+</button></div></div>
            ${field('flags — scaler algorithm', sel(['fast_bilinear', 'bilinear', 'bicubic', 'lanczos', 'spline', 'neighbor'], 2))}
            ${field('force_original_aspect_ratio', sel(['disable', 'decrease', 'increase'], 0))}
          </div></div>
        <div class="card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><h2 style="margin:0">Live command</h2><button class="tonal" style="padding:6px 14px;font-size:12px" id="copy-command-2">Copy</button></div>
        <pre class="cmd-pre" id="cmd-pre">${esc(liveCommand())}</pre></div>
      </div>
    </div>`,

  trim: () => `
    <p class="eyebrow">Cut without re-encoding</p><h1>Trim &amp; clip</h1><p class="lede">-ss / -to with stream copy, or frame-accurate re-encode. Drag the handles or type exact timecodes.</p>
    <div class="view-search"><input placeholder="Search chapters & markers" style="background:var(--surface2);border:1px solid var(--line);border-radius:20px;color:var(--text);padding:10px 16px;width:280px"><button class="builder-button" data-builder="x">.*</button></div>
    <div class="card">
      <div style="height:180px;border-radius:12px;background:repeating-linear-gradient(90deg,var(--surface2) 0 46px,var(--surface3) 46px 48px);position:relative;overflow:hidden">
        <div style="position:absolute;inset:0;display:grid;place-items:center;color:var(--muted);font-family:var(--mono);font-size:12px">video preview — interview_cam_A.mov</div>
        <div style="position:absolute;top:0;bottom:0;left:18%;right:34%;background:color-mix(in oklab,var(--accent) 14%,transparent);border-left:3px solid var(--accent);border-right:3px solid var(--accent)"></div>
      </div>
      <div style="display:flex;gap:14px;align-items:end;margin-top:16px;flex-wrap:wrap">
        ${field('In point (-ss)', '<input value="00:02:17.083" class="mono" style="width:150px">')}
        ${field('Out point (-to)', '<input value="00:08:22.541" class="mono" style="width:150px">')}
        <div class="field"><span>Mode</span><div class="seg"><button class="active">Stream copy (-c copy)</button><button>Frame-accurate re-encode</button></div></div>
        <label class="check-row" style="background:transparent"><input type="checkbox" checked> -avoid_negative_ts make_zero</label>
        <span style="flex:1"></span><button class="filled">Queue trim</button>
      </div>
      <p class="mono" style="margin:14px 0 0;font-size:11.5px;color:var(--muted)">ffmpeg -ss 00:02:17.083 -to 00:08:22.541 -i interview_cam_A.mov -c copy -avoid_negative_ts make_zero clip_01.mov</p>
    </div>`,

  filters: () => `
    <div class="page-head"><div><p class="eyebrow">Filtergraph</p><h1>Node graph</h1><p class="lede" style="margin:0">All 458 filters are droppable nodes. Select a node to edit its full AVOption set.</p></div>
    <div class="head-actions">${searchLine('Search 458 filters')}<button class="filled">Apply graph</button></div></div>
    <div style="display:grid;grid-template-columns:1fr 380px;gap:14px">
      <div class="card graph">
        <div style="display:flex;gap:26px;align-items:center;flex-wrap:wrap">
          ${[['[0:v] in', '3840×2160 · yuv422p10le'], ['scale', '1920:-2 bicubic'], ['eq', 'contrast 1.04 · sat 1.1'], ['drawtext', 'EP 04 — ROUGH CUT'], ['[out]', 'yuv420p → libx264']].map(([n, s], i) => `
            <button class="node${n === state.selNode ? ' sel' : ''}" data-node="${esc(n)}"><b style="${n === state.selNode ? 'color:var(--accent)' : ''}">${esc(n)}</b><br><small>${esc(s)}</small></button>${i < 4 ? '<span class="ms" style="color:var(--accent);font-size:22px">east</span>' : ''}`).join('')}
        </div>
        <div style="position:absolute;left:20px;bottom:16px;right:20px;display:flex;gap:6px;flex-wrap:wrap;align-items:center">
          <small style="color:var(--muted);font-weight:600">Drop a filter:</small>
          ${['scale', 'crop', 'eq', 'curves', 'hue', 'unsharp', 'drawtext', 'overlay', 'fps', 'loudnorm', 'atempo', 'deband'].map((f) => `<span class="tag mono" style="cursor:grab">${f}</span>`).join('')}
        </div>
      </div>
      <div style="display:grid;gap:14px;align-content:start">
        <div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><h2 class="mono" style="margin:0">drawtext</h2><span class="tag">VIDEO · libfreetype</span></div>
          <p class="hint" style="margin-top:6px">Draw text on top of video using libfreetype. Every option below is a live AVOption.</p>
          <div style="display:grid;gap:12px">
            ${field('text — set text', '<input value="EP 04 — ROUGH CUT">')}
            <div class="two-col">${field('font — Font name', sel(['Sans', 'Roboto', 'Mono']))}${field('fontsize — expr ok', '<input value="h/18" class="mono">')}</div>
            <div><p class="field" style="margin:0 0 6px">fontcolor — foreground color (any RGBA)</p>
              <div style="display:flex;gap:6px;align-items:center">
                <input type="color" id="fontcolor" value="${state.fontColor}" style="width:44px;height:36px;border:1px solid var(--line);border-radius:10px;background:var(--surface2);padding:3px">
                <b class="mono" style="font-size:12px;flex:1" id="fontcolor-val">${state.fontColor}@${state.textAlpha}</b>
                ${['#f2e9d8', '#ffffff', '#ffc953', '#82d5cc', '#101010'].map((h) => `<button data-swatch="${h}" style="width:24px;height:24px;border-radius:50%;border:2px solid var(--line);background:${h}"></button>`).join('')}
              </div>
              ${slider('textAlpha', 'alpha — apply alpha while rendering', state.textAlpha, 0, 1, 0.05)}
            </div>
            <div class="two-col">${field('x — position expr', '<input value="(w-text_w)/2" class="mono">')}${field('y — position expr', '<input value="h-line_h-24" class="mono">')}</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <label class="check-row"><input type="checkbox" checked> box</label>
              <label class="check-row"><input type="checkbox"> fix_bounds</label>
              <label class="check-row"><input type="checkbox" checked> text_shaping</label>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
              ${field('borderw', '<input type="number" value="2">')}${field('shadowx', '<input type="number" value="1">')}${field('shadowy', '<input type="number" value="1">')}
            </div>
          </div></div>
        <div class="card"><h2 class="mono">curves — master</h2><p class="hint">Drag points to shape the tone curve; exported as x/y anchor pairs.</p>
          <svg viewBox="0 0 300 160" style="width:100%;border-radius:12px;background:var(--surface2)">
            <line x1="0" y1="160" x2="300" y2="0" stroke="var(--line)" stroke-dasharray="4 4"/>
            <polyline points="0,160 75,118 150,72 225,30 300,0" fill="none" stroke="var(--accent)" stroke-width="2.5"/>
            <circle cx="75" cy="118" r="6" fill="var(--accent)"/><circle cx="150" cy="72" r="6" fill="var(--accent)"/><circle cx="225" cy="30" r="6" fill="var(--accent)"/>
          </svg>
          <p class="mono" style="margin:8px 0 0;font-size:11px;color:var(--muted)">curves=master='0/0 0.25/0.26 0.5/0.55 0.75/0.81 1/1'</p></div>
      </div>
    </div>`,

  audio: () => `
    <p class="eyebrow">Audio</p><h1>Extraction &amp; loudness</h1><p class="lede">EBU R128 two-pass normalization via loudnorm, plus stream extraction to any audio codec.</p>
    <div class="view-search"><input placeholder="Search 176 audio filters" style="background:var(--surface2);border:1px solid var(--line);border-radius:20px;color:var(--text);padding:10px 16px;width:280px"><button class="builder-button" data-builder="x">.*</button></div>
    <div class="grid">
      <div class="card span6"><div style="display:flex;justify-content:space-between;align-items:center"><h2 class="mono" style="margin:0">loudnorm</h2><span class="tag">AUDIO · EBU R128</span></div>
        <div style="display:grid;gap:14px;margin-top:16px">
          ${slider('lufsI', 'I — integrated loudness target', state.lufsI, -70, -5, 1, ' LUFS')}
          <div class="slider-scale"><span>-70</span><span>-24 EBU</span><span>-16 podcast</span><span>-14 streaming</span><span>-5</span></div>
          ${slider('lra', 'LRA — loudness range target', state.lra, 1, 50, 1, ' LU')}
          ${slider('tp', 'TP — maximum true peak', state.tp, -9, 0, 0.1, ' dBTP')}
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <label class="check-row"><input type="checkbox" checked> linear — normalize linearly if possible</label>
            <label class="check-row"><input type="checkbox"> dual_mono</label>
          </div>
          <div class="notice"><b style="font-size:12.5px">Pass 1 measured values</b> <small style="color:var(--muted)">— auto-filled into measured_*</small>
            <div class="mono" style="display:flex;gap:14px;margin-top:8px;font-size:12px"><span>I <b style="color:var(--accent)">-19.2</b></span><span>LRA <b style="color:var(--accent)">11.4</b></span><span>TP <b style="color:var(--accent)">-0.3</b></span><span>thresh <b style="color:var(--accent)">-29.5</b></span></div></div>
          <button class="filled" style="justify-self:start">Run two-pass normalize</button>
        </div></div>
      <div class="span6" style="display:grid;gap:14px;align-content:start">
        <div class="card"><h2>Extract streams</h2><div class="list">
          ${[['0:1', 'Boom mic', 'pcm_s24le · 48 kHz · stereo', true], ['0:2', 'Lav pair', 'pcm_s24le · 48 kHz · stereo', true], ['0:3', 'Room tone', 'pcm_s24le · 48 kHz · mono', false]].map(([id, n, m, on]) => `
          <label class="list-item"><input type="checkbox"${on ? ' checked' : ''}><span style="flex:1"><b class="mono" style="font-size:13px">${id}</b> <b style="font-size:13px">${n}</b><br><small class="mono">${m}</small></span>
          <select style="background:var(--surface3);border:1px solid var(--line);border-radius:9px;color:var(--text);padding:7px 9px;font-size:12px"><option>copy</option><option>flac</option><option selected>aac 256k</option><option>libopus 128k</option><option>pcm_s24le</option></select></label>`).join('')}
        </div></div>
        <div class="card"><h2 class="mono">Channel EQ — superequalizer</h2>
          <div style="display:flex;gap:8px;align-items:end;height:110px;padding-top:6px">
            ${[['31', 38], ['62', 52], ['125', 66], ['250', 58], ['500', 47], ['1k', 55], ['2k', 70], ['4k', 62], ['8k', 44], ['16k', 30]].map(([f, h]) => `<div style="flex:1;display:grid;gap:5px;text-align:center;height:100%;align-content:end"><div style="height:${h}px;background:var(--accent);opacity:.85;border-radius:4px"></div><small class="mono" style="font-size:9.5px;color:var(--muted)">${f}</small></div>`).join('')}
          </div></div>
      </div>
    </div>`,

  gif: () => `
    <p class="eyebrow">Stills &amp; loops</p><h1>GIF &amp; thumbnails</h1><p class="lede">Two-pass palettegen → paletteuse for dither-correct GIFs; thumbnail grid export via the select filter.</p>
    <div class="view-search"><input placeholder="Search palette & dither options" style="background:var(--surface2);border:1px solid var(--line);border-radius:20px;color:var(--text);padding:10px 16px;width:280px"><button class="builder-button" data-builder="x">.*</button></div>
    <div class="grid">
      <div class="card span6"><h2>GIF export</h2><div style="display:grid;gap:14px">
        ${slider('gifFps', 'fps', state.gifFps, 5, 30)}
        ${slider('gifColors', 'palettegen max_colors', state.gifColors, 4, 256)}
        ${field('paletteuse dither', sel(['none', 'sierra2_4a', 'bayer:bayer_scale=2', 'floyd_steinberg', 'heckbert'], 1))}
        ${field('palettegen stats_mode', sel(['full — whole clip', 'diff — moving areas only', 'single — per frame'], 0))}
        <button class="filled" style="justify-self:start">Render GIF</button></div></div>
      <div class="card span6"><h2>Thumbnail grid</h2>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px">
          ${['00:00', '01:00', '02:00', '03:00', '04:00', '05:00', '06:00', '07:00'].map((t) => `<div style="aspect-ratio:16/9;border-radius:8px;background:repeating-linear-gradient(135deg,var(--surface2) 0 8px,var(--surface3) 8px 16px);display:grid;place-items:end start;padding:5px"><small class="mono" style="font-size:9.5px;color:var(--accent);background:var(--titlebg);border-radius:5px;padding:1px 5px">${t}</small></div>`).join('')}
        </div>
        <div style="display:flex;gap:12px;margin-top:14px;align-items:end">
          ${field('Interval', sel(['Every I-frame', 'Every 60 s', 'thumbnail filter (best of 100)'], 1))}
          <button class="tonal">Export PNGs</button>
        </div></div>
    </div>`,

  presets: () => `
    <div class="page-head"><div><p class="eyebrow">Reusable recipes</p><h1>Presets</h1></div><div class="head-actions">${searchLine('Search presets')}</div></div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px">
      ${[['smart_display', 'WEB', 'YouTube 4K master', 'libx264 slow · crf 18 · aac 256k · faststart', '-c:v libx264 -preset slow -crf 18 -c:a aac -b:a 256k -movflags +faststart'],
        ['podcasts', 'AUDIO', 'Podcast loudness', 'loudnorm two-pass to -16 LUFS · mp3 V0', '-af loudnorm=I=-16:TP=-1.5:LRA=11 -c:a libmp3lame -q:a 0'],
        ['phone_iphone', 'SOCIAL', 'Vertical 9:16 clip', 'crop + scale 1080×1920 · libx264 fast', '-vf crop=ih*9/16:ih,scale=1080:1920 -c:v libx264 -crf 21'],
        ['movie_edit', 'EDIT', 'ProRes proxy', 'prores_ks profile 0 · 960w · pcm audio', '-c:v prores_ks -profile:v 0 -vf scale=960:-2 -c:a pcm_s16le'],
        ['podcasts', 'LIVE', 'HLS event ladder', '3 renditions · hls_time 6 · independent segments', '-f hls -hls_time 6 -hls_flags independent_segments'],
        ['gif_box', 'LOOP', 'Dither-perfect GIF', 'palettegen/paletteuse · sierra2_4a · fps 15', '-vf fps=15,scale=480:-1,split[a][b];[a]palettegen[p];[b][p]paletteuse']]
        .map(([i, tg, n, d, c]) => `<div class="card"><div style="display:flex;justify-content:space-between;align-items:start"><span class="ms" style="font-size:22px;color:var(--accent)">${i}</span><span class="tag">${tg}</span></div>
        <h3 style="margin:10px 0 4px">${n}</h3><p class="hint" style="margin-bottom:10px;font-size:12px">${d}</p>
        <p class="mono" style="margin:0 0 12px;font-size:10.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c)}</p>
        <div style="display:flex;gap:6px"><button class="tonal" style="padding:7px 14px;font-size:12px">Use</button><button class="outlined" style="padding:7px 14px;font-size:12px">Edit</button><button class="danger-open" style="color:var(--danger);font-size:12px;padding:7px 10px">Delete</button></div></div>`).join('')}
    </div>`,

  inspector: () => `
    <p class="eyebrow">ffprobe</p><h1>Media inspector</h1><p class="lede">Full container, stream, and frame-level metadata for any file. Export as JSON / CSV / XML.</p>
    <div class="view-search"><input placeholder="Search stream & format fields" style="background:var(--surface2);border:1px solid var(--line);border-radius:20px;color:var(--text);padding:10px 16px;width:280px"><button class="builder-button" data-builder="x">.*</button></div>
    <div class="grid">
      <div class="card span6"><h2 class="mono">interview_cam_A.mov</h2><div class="list">
        ${[['movie', '0:0', 'prores (HQ)', 'VIDEO', '3840×2160 · yuv422p10le · 23.976 fps · 471 Mb/s · bt709'], ['graphic_eq', '0:1', 'pcm_s24le', 'AUDIO', '48000 Hz · stereo · 2304 kb/s · boom mic'], ['graphic_eq', '0:2', 'pcm_s24le', 'AUDIO', '48000 Hz · stereo · 2304 kb/s · lav pair'], ['schedule', '0:3', 'timecode', 'DATA', 'tmcd · start 01:00:00:00']].map(([i, id, c, t, m]) => `
        <div class="list-item" style="display:block"><div style="display:flex;gap:10px;align-items:center"><span class="ms">${i}</span><b class="mono" style="font-size:12.5px">${id}</b><b style="font-size:13px">${c}</b><span style="flex:1"></span><span class="tag">${t}</span></div><small class="mono" style="display:block;margin-top:5px">${m}</small></div>`).join('')}
      </div></div>
      <div class="card span6"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><h2 style="margin:0">Container</h2><div style="display:flex;gap:6px"><button class="tonal" style="padding:6px 13px;font-size:12px">JSON</button><button class="outlined" style="padding:6px 13px;font-size:12px">CSV</button><button class="outlined" style="padding:6px 13px;font-size:12px">XML</button></div></div>
        <div style="display:grid;gap:2px;font-size:12.5px">
          ${[['format_name', 'mov,mp4,m4a,3gp,3g2,mj2'], ['duration', '12:41.208 (761.208 s)'], ['size', '42.13 GB'], ['bit_rate', '474 583 kb/s'], ['nb_streams', '4'], ['major_brand', 'qt'], ['encoder', 'Blackmagic Design'], ['creation_time', '2026-08-19T14:02:11Z']].map(([k, v]) => `<div style="display:flex;justify-content:space-between;gap:14px;padding:7px 10px;border-radius:8px"><span class="mono" style="color:var(--muted);font-size:12px">${k}</span><b class="mono" style="font-size:12px">${v}</b></div>`).join('')}
        </div></div>
    </div>`,

  hwaccel: () => `
    <p class="eyebrow">Hardware acceleration</p><h1>h264_nvenc</h1><p class="lede">Detected: NVIDIA RTX 4080 (nvenc, nvdec, cuda) · Intel UHD 770 (qsv) · Software fallback always available.</p>
    <div class="view-search"><input placeholder="Search NVENC/QSV options" style="background:var(--surface2);border:1px solid var(--line);border-radius:20px;color:var(--text);padding:10px 16px;width:280px"><button class="builder-button" data-builder="x">.*</button></div>
    <div class="grid">
      <div class="card span6"><h2>Encoder preset &amp; tuning</h2>
        <p class="field" style="margin:0 0 6px">preset — p1 (fastest) → p7 (slowest, best quality)</p>
        <div style="display:flex;gap:4px;margin-bottom:16px">${['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'].map((p) => `<button class="chip-btn mono${p === state.nvencPreset ? ' active' : ''}" data-nvencpreset="${p}" style="flex:1;text-align:center">${p}</button>`).join('')}</div>
        <div class="two-col">${field('tune', sel(['hq — high quality', 'll — low latency', 'ull — ultra low latency', 'lossless'], 0))}${field('rc — rate control', sel(['constqp', 'vbr', 'cbr'], 1))}</div>
        <div style="margin-top:14px">${slider('nvencCq', 'cq — constant quality (VBR)', state.nvencCq, 0, 51)}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
          <label class="check-row"><input type="checkbox" checked> spatial-aq</label><label class="check-row"><input type="checkbox" checked> temporal-aq</label>
          <label class="check-row"><input type="checkbox"> weighted_pred</label><label class="check-row"><input type="checkbox" checked> b_ref_mode middle</label>
        </div></div>
      <div class="span6" style="display:grid;gap:14px;align-content:start">
        <div class="card"><h2>Device inventory</h2><div class="list">
          ${[['developer_board', 'NVIDIA GeForce RTX 4080', 'nvenc · nvdec · cuda filters · driver 581.20', 'ACTIVE', ''], ['memory', 'Intel UHD Graphics 770', 'qsv available · vaapi n/a on Windows', 'READY', ' idle'], ['computer', 'Software (x86-64 AVX-512)', 'libx264 · libx265 · libsvtav1 — always available', 'FALLBACK', ' idle']].map(([i, n, m, s2, cls]) => `
          <div class="list-item"><span class="ms">${i}</span><span style="flex:1"><b style="font-size:13px">${n}</b><br><small>${m}</small></span><span class="tag${cls}">${s2}</span></div>`).join('')}
        </div></div>
        <div class="card"><h2>NVENC session load</h2>
          ${[['Encoder utilization', 64], ['Decoder utilization', 22], ['VRAM 6.2 / 16 GB', 39]].map(([l, p]) => `<div style="margin-bottom:9px"><div style="display:flex;justify-content:space-between;font-size:12px;color:var(--muted)"><span>${l}</span><b class="mono" style="color:var(--accent)">${p}%</b></div><div class="progress-track" style="margin-top:5px"><span style="width:${p}%"></span></div></div>`).join('')}
        </div></div>
    </div>`,

  streaming: () => `
    <p class="eyebrow">Live output</p><h1>Streaming — HLS muxer</h1><p class="lede">Push to RTMP/SRT or write an HLS ladder. Every muxer AVOption is a typed control.</p>
    <div class="view-search"><input placeholder="Search muxer & protocol options" style="background:var(--surface2);border:1px solid var(--line);border-radius:20px;color:var(--text);padding:10px 16px;width:280px"><button class="builder-button" data-builder="x">.*</button></div>
    <div class="grid">
      <div class="card span6"><h2 class="mono">hls options</h2><div style="display:grid;gap:14px">
        ${slider('hlsTime', 'hls_time — target segment length', state.hlsTime, 1, 20, 1, ' s')}
        ${slider('hlsList', 'hls_list_size — playlist entries (0 = all)', state.hlsList, 0, 30)}
        ${field('hls_segment_type', sel(['mpegts', 'fmp4'], 0))}
        <div><p class="field" style="margin:0 0 6px">hls_flags — bit flags</p><div style="display:flex;gap:8px;flex-wrap:wrap">
          <label class="check-row"><input type="checkbox" checked> delete_segments</label><label class="check-row"><input type="checkbox" checked> independent_segments</label>
          <label class="check-row"><input type="checkbox"> append_list</label><label class="check-row"><input type="checkbox"> temp_file</label>
          <label class="check-row"><input type="checkbox" checked> program_date_time</label></div></div>
        ${field('master_pl_name', '<input value="master.m3u8" class="mono">')}
      </div></div>
      <div class="span6" style="display:grid;gap:14px;align-content:start">
        <div class="card"><h2>Publish targets</h2><div class="list">
          <div class="list-item"><span class="ms">podcasts</span><span style="flex:1"><b style="font-size:13px">rtmp://live.example.tv/app/key</b><br><small>flv muxer · 6 Mb/s · connected 00:41:12</small></span><span class="tag" style="animation:pulse 2s infinite">LIVE</span></div>
          <div class="list-item"><span class="ms" style="color:var(--muted)">satellite_alt</span><span style="flex:1"><b style="font-size:13px">srt://ingest.example.tv:9000</b><br><small>latency=120ms · passphrase set · standby</small></span><span class="tag idle">IDLE</span></div>
        </div></div>
        <div class="card"><h2>Ladder renditions</h2><div class="list">
          ${[['1920×1080', 'libx264 high · 60 fps capable', '6.0 Mb/s'], ['1280×720', 'libx264 main', '3.2 Mb/s'], ['854×480', 'libx264 main', '1.4 Mb/s'], ['audio', 'aac-lc stereo', '128 kb/s']].map(([r, m, b]) => `<div class="list-item" style="font-size:12.5px"><b class="mono" style="width:70px">${r}</b><span style="color:var(--muted);flex:1">${m}</span><b class="mono" style="color:var(--accent)">${b}</b></div>`).join('')}
        </div></div>
    </div>`,

  jobs: () => `
    <div class="page-head"><div><p class="eyebrow">Queue</p><h1>Jobs &amp; logs</h1></div>
    <div class="head-actions">${searchLine('Search log lines')}<button class="outlined danger-open" style="color:var(--danger)">Clear queue…</button></div></div>
    <div class="card" style="display:flex;gap:8px;align-items:center;margin-bottom:12px;padding:10px 14px">
      <b class="mono" style="font-size:12.5px;color:var(--accent)" id="job-sel-count">0 selected</b>
      <button class="outlined" style="padding:5px 12px;font-size:11.5px" id="jobs-select-all">Select all</button>
      <button class="outlined" style="padding:5px 12px;font-size:11.5px" id="jobs-clear-sel">Clear</button>
      <button class="tonal" style="padding:5px 12px;font-size:11.5px" id="jobs-bulk-pause">Pause selected</button>
      <button class="tonal" style="padding:5px 12px;font-size:11.5px" id="jobs-bulk-back">Move to back</button>
      <button class="danger-open" style="color:var(--danger);padding:5px 12px;font-size:11.5px;font-weight:600">Cancel selected…</button>
      <small style="color:var(--muted);margin-left:auto">Bulk actions apply to checked jobs</small>
    </div>
    <div class="list" style="margin-bottom:16px">${jobRows(true)}</div>
    <div class="log-pane" id="log-pane">
      ${['[libx264 @ 0x5f2c] using cpu capabilities: MMX2 SSE2Fast SSSE3 SSE4.2 AVX FMA3 BMI2 AVX2 AVX512',
        '[libx264 @ 0x5f2c] profile High, level 4.1, 4:2:0, 8-bit',
        'frame= 5288 fps= 87 q=22.0 size= 412416KiB time=00:03:40.54 bitrate=15324.1kbits/s speed=3.62x',
        "[hls @ 0x71aa] Opening 'ep04/seg_1080_00042.ts' for writing",
        '[loudnorm @ 0x82b1] input_i: -19.21 | input_tp: -0.31 | input_lra: 11.40 | input_thresh: -29.53',
        '[Parsed_loudnorm_0] normalization_type: dynamic → linear (target gain 3.2 dB)',
        'frame= 6120 fps= 88 q=21.0 size= 486912KiB time=00:04:15.29 bitrate=15621.7kbits/s speed=3.64x',
        '[mp4 @ 0x60d1] moov atom will be written at start (faststart second pass)'].map((l) => `<div>${esc(l)}</div>`).join('')}
    </div>`,

  composer: () => `
    <p class="eyebrow">Full CLI surface</p><h1>Command composer</h1><p class="lede">Every fftools flag — global, per-input, per-output — is a structured row with its own typed editor. The long tail is always reachable.</p>
    <div style="display:grid;grid-template-columns:280px 1fr;gap:14px">
      <div class="card" style="align-self:start;padding:16px">
        <div class="search-line" style="margin-bottom:10px"><input placeholder="Search all flags" style="width:100%;border-radius:16px;padding:9px 13px;font-size:12.5px"><button class="builder-button" data-builder="x" style="height:38px;min-width:38px">.*</button></div>
        <div style="display:grid;gap:2px">
          ${[['Global', 74], ['Per-input', 41], ['Video', 96], ['Audio', 52], ['Subtitle', 18], ['Muxer private', 380], ['Advanced', 210]].map(([l, c], i) => `<button class="subnav-item${i === 2 ? ' active' : ''}" style="border-radius:11px">${l}<small>${c}</small></button>`).join('')}
        </div></div>
      <div style="display:grid;gap:14px;align-content:start">
        <div class="card"><h2>Active flags</h2><div class="list">
          ${[['-hwaccel', 'Use HW-accelerated decoding — enum of detected methods', 'cuda', 'GLOBAL'], ['-ss', 'Seek input to position — timecode scrubber', '00:00:00.000', 'INPUT 0'], ['-c:v', 'Video encoder — full codec registry picker', 'libx264', 'OUTPUT'], ['-crf', 'Constant quality 0–51 — slider', String(state.crf), 'OUTPUT'], ['-vf', 'Filtergraph — opens node editor', 'scale=1920:-2,drawtext=…', 'OUTPUT'], ['-c:a', 'Audio encoder', 'aac', 'OUTPUT'], ['-b:a', 'Audio bitrate — stepper', '256k', 'OUTPUT'], ['-movflags', 'mp4 muxer bit flags — checkbox set', '+faststart', 'OUTPUT']].map(([f, d, v, sc]) => `
          <div class="list-item"><b class="mono" style="font-size:12.5px;color:var(--accent);width:130px">${f}</b><span style="flex:1;font-size:12px;color:var(--muted)">${d}</span><b class="mono" style="font-size:12px">${esc(v)}</b><span class="tag idle">${sc}</span><button style="color:var(--muted)"><span class="ms" style="font-size:16px">edit</span></button></div>`).join('')}
          <button class="upload-slot">+ Add flag from catalog</button>
        </div></div>
        <div class="card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><h2 style="margin:0">Composed command</h2><div style="display:flex;gap:6px"><button class="tonal" style="padding:6px 14px;font-size:12px" id="copy-command-2">Copy</button><button class="filled" style="padding:6px 14px;font-size:12px">Queue</button></div></div>
        <pre class="cmd-pre">${esc(liveCommand())}</pre></div>
      </div>
    </div>`,

  converter: () => `
    <p class="eyebrow">Universal feature</p><h1>File converter</h1><p class="lede">Byte-based type detection (magic numbers, not extensions), a bounded adapter registry, guided target choice, batches, and honest loss disclosure.</p>
    <div class="view-search"><input placeholder="Search adapter registry" style="background:var(--surface2);border:1px solid var(--line);border-radius:20px;color:var(--text);padding:10px 16px;width:280px"><button class="builder-button" data-builder="x">.*</button></div>
    <div class="grid">
      <div class="card span6">
        <label class="upload-slot" style="padding:26px"><span class="ms" style="font-size:20px">upload_file</span>Drop files or click to add a batch<input type="file" hidden multiple></label>
        <div class="list" style="margin-top:12px">
          <div class="list-item"><span class="ms">movie</span><span style="flex:1"><b style="font-size:13px">board_meeting.webm</b><br><small class="mono">detected by bytes: EBML → Matroska/WebM · VP9 + Opus</small></span><span class="tag">SUPPORTED</span></div>
          <div class="list-item"><span class="ms">graphic_eq</span><span style="flex:1"><b style="font-size:13px">voicemail.amr</b><br><small class="mono">detected by bytes: #!AMR → AMR-NB mono 8 kHz</small></span><span class="tag">SUPPORTED</span></div>
          <div class="list-item"><span class="ms" style="color:var(--muted)">draft</span><span style="flex:1"><b style="font-size:13px">notes.docx</b><br><small class="mono">detected by bytes: PK zip + word/ — not a media type</small></span><span class="tag idle" style="color:var(--danger)">UNSUPPORTED</span></div>
        </div>
        <div class="notice" style="margin-top:12px">notes.docx is skipped with an honest explanation instead of producing corrupt output.</div>
      </div>
      <div class="span6" style="display:grid;gap:14px;align-content:start">
        <div class="card"><h2>Guided target choice</h2><p class="hint">Each target shows its loss disclosure before you commit.</p>
          <div class="list">
            <label class="list-item" style="background:var(--tonal)"><input type="checkbox" checked><span style="flex:1"><b style="font-size:13px;color:var(--accent)">mp4 · H.264 + AAC</b><br><small>Lossy re-encode — generation loss. Universal playback.</small></span></label>
            <label class="list-item"><input type="checkbox"><span style="flex:1"><b style="font-size:13px">mkv · stream copy</b><br><small>Lossless — container rewrite only. Requires compatible codecs.</small></span></label>
            <label class="list-item"><input type="checkbox"><span style="flex:1"><b style="font-size:13px">flac · audio only</b><br><small>Lossless audio; video streams dropped — disclosed, not silent.</small></span></label>
          </div>
          <div style="display:flex;gap:8px;margin-top:14px"><button class="filled">Convert batch (2 files)</button><button class="outlined">Preview commands</button></div></div>
        <div class="card"><h2>Isolation &amp; limits</h2><div style="display:grid;gap:10px;font-size:12.5px">
          <label class="check-row" style="background:transparent"><input type="checkbox" checked> Bounded resources per conversion (2 threads · 2 GB)</label>
          <label class="check-row" style="background:transparent"><input type="checkbox" checked> Validate output before replacing anything</label>
          <label class="check-row" style="background:transparent"><input type="checkbox" checked> Keep originals untouched</label>
        </div></div>
      </div>
    </div>`,

  settings: () => `
    <p class="eyebrow">Application</p><h1>Settings</h1><p class="lede">All settings persist locally and are searchable from the command palette.</p>
    <div class="view-search"><input placeholder="Search settings" style="background:var(--surface2);border:1px solid var(--line);border-radius:20px;color:var(--text);padding:10px 16px;width:280px"><button class="builder-button" data-builder="x">.*</button></div>
    <div class="grid">
      <div class="card span6"><h2>Appearance</h2><div style="display:grid;gap:12px">
        <div class="field"><span>Theme</span><div class="seg"><button id="set-dark" class="${state.theme === 'dark' ? 'active' : ''}">Dark</button><button id="set-light" class="${state.theme === 'light' ? 'active' : ''}">Light</button></div></div>
        ${field('Density', sel(['Compact', 'Comfortable', 'Large'], 1))}
        <button class="tonal" id="logo-open-2" style="justify-self:start">Customize app logo…</button>
        <button class="outlined appearance-open" style="justify-self:start">Per-element appearance editor…</button>
      </div></div>
      <div class="span6" style="display:grid;gap:14px;align-content:start">
        <div class="card"><h2>Personal vocabulary</h2>
          <p class="hint" style="margin-bottom:10px">${state.vocab ? Object.keys(state.vocab.entries || {}).length + ' entries loaded (schema v' + state.vocab.schemaVersion + '). Private and local.' : 'No vocabulary loaded. Upload a local JSON (schema v1, ≤64 KB) to rename UI terms privately on this machine.'}</p>
          <label class="upload-slot"><span class="ms" style="font-size:18px">upload_file</span>Upload vocabulary JSON<input type="file" class="vocab-upload" accept="application/json" hidden></label></div>
        <div class="card"><h2>Security — password &amp; TOTP</h2>
          <p class="hint">Locking requires a saved password. Stored locally as a salted SHA-256 hash.</p>
          <div style="display:grid;gap:12px">
            <label class="field">Password<div style="display:flex;gap:6px"><input id="sec-set-pw" type="password" placeholder="Set a password" style="flex:1"><button type="button" class="tonal" id="sec-save" style="padding:0 16px">Save</button></div></label>
            <label class="check-row" style="background:transparent"><input type="checkbox" id="sec-totp"> Require TOTP as second factor (secret: <code class="mono" style="color:var(--accent)">JBSW Y3DP EHPK 3PXP</code>)</label>
            <button class="filled" id="sec-lock" style="justify-self:start"><span class="ms" style="font-size:17px">lock</span>Lock app now</button>
          </div></div>
        <div class="card"><h2>Locked elements (toy locks)</h2>
          <div id="locks-list" style="display:grid;gap:6px">${Object.keys(state.locks || {}).length ? Object.keys(state.locks).map((l) => `<div class="list-item"><span class="ms" style="color:var(--danger);font-size:16px">lock</span><b style="flex:1;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(l)}</b><button class="tonal lock-unlock" data-l="${esc(l)}" style="padding:5px 12px;font-size:11.5px">Unlock…</button></div>`).join('') : '<p class="hint">Nothing locked. Right-click any element → “Lock element”.</p>'}</div></div>
        <div class="card"><h2>Universal feature inventory</h2><p class="hint" style="font-size:12px">Fail-closed per-surface delivery: every row is asserted against the built output.</p>
          <div style="display:grid;gap:5px;font-size:12.5px">
            ${[['Command palette (Ctrl+Shift+F)','global'],['Regex builder + advanced tokens','every search'],['Personal vocabulary upload','Overview · Settings'],['App-logo customization','titlebar'],['Universal file converter','System › File converter'],['Two-key super confirmation','destructive actions'],['Per-element appearance editor','right-click · Settings'],['Toy locks (functional)','right-click any element'],['Notification centre','titlebar'],['Right-click menus with search','tabs · jobs · registry'],['Bulk job actions','Jobs & logs'],['Option guides with live preview','every config ⓘ']].map(([n,w]) => `<div style="display:flex;gap:10px;align-items:center;padding:7px 10px;border-radius:9px;background:var(--surface2)"><span style="width:8px;height:8px;border-radius:50%;background:var(--accent);flex:none"></span><span style="flex:1">${n}</span><small class="mono" style="color:var(--muted);font-size:10.5px">${w}</small></div>`).join('')}
          </div></div>
        <div class="card"><h2>Execution</h2><div style="display:grid;gap:10px;font-size:12.5px">
          <label class="check-row" style="background:transparent"><input type="checkbox" checked> Run up to 2 jobs in parallel</label>
          <label class="check-row" style="background:transparent"><input type="checkbox" checked> Prefer hardware encoders when detected</label>
          <label class="check-row" style="background:transparent"><input type="checkbox"> Keep intermediate two-pass logs</label>
          <label class="check-row" style="background:transparent"><input type="checkbox" checked> Notify on job completion</label>
        </div></div>
      </div>
    </div>`,
};
const registryView = (id) => {
  const [title, sub, ph, filters, rows] = REGISTRY[id];
  return `
    <div class="page-head"><div><p class="eyebrow">Registry · full build inventory</p><h1>${title}</h1><p class="lede" style="margin:0">${sub}</p></div>
    <div class="head-actions">${searchLine(ph)}</div></div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">${filters.map((f, i) => `<button class="chip-btn${i === 0 ? ' active' : ''}">${f}</button>`).join('')}</div>
    <div style="display:grid;gap:7px">${rows.map(([n, d, tags]) => `<button class="registry-row"><b>${esc(n)}</b><span class="desc">${esc(d)}</span>${tags.split('·').map((t) => `<span class="tag">${t}</span>`).join('')}<span class="ms" style="font-size:17px;color:var(--muted)">tune</span></button>`).join('')}</div>
    <p style="margin:14px 0 0;color:var(--muted);font-size:12px">Showing ${rows.length} — every entry opens its own generated option editor.</p>`;
};
Object.keys(REGISTRY).forEach((k) => { VIEWS[k] = () => registryView(k); });

/* ---------- render ---------- */
function render() {
  const g = viewGroup(state.view);
  $('#rail').innerHTML = RAIL.map(([id, icon, label]) => `<button class="rail-item${id === g ? ' active' : ''}" data-group="${id}"><span class="ms">${icon}</span><b>${label}</b></button>`).join('') +
    `<div class="rail-spacer"></div><button class="rail-item" id="palette-open" aria-keyshortcuts="Control+Shift+F"><span class="ms">keyboard_command_key</span><b>Commands</b></button>`;
  $('#subnav').innerHTML = `<p class="eyebrow">${GROUPS[g].title}</p><div style="display:grid;gap:3px">` +
    GROUPS[g].items.map(([id, icon, label, count]) => `<button class="subnav-item${id === state.view ? ' active' : ''}" data-go="${id}"><span class="ms">${icon}</span><span style="flex:1">${label}</span>${count ? `<small>${count}</small>` : ''}</button>`).join('') +
    `</div><div class="build-note"><b style="color:var(--text)">Build</b><br>ffmpeg 8.0 · GPL v3<br>libx264 · libx265 · nvenc</div>`;
  const TABS = [['overview', 'dashboard', 'Overview'], ['convert', 'sync_alt', 'Convert — libx264'], ['filters', 'account_tree', 'Filtergraph'], ['jobs', 'receipt_long', 'Jobs & logs']];
  $('#tabs').innerHTML = TABS.map(([id, icon, label]) => `<button class="tab${id === state.view ? ' active' : ''}" data-go="${id}" role="tab"><span class="ms">${icon}</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${label}</span></button>`).join('') +
    `<button title="Open a tab" style="height:36px;width:36px;color:var(--muted);font-size:19px">+</button>
     <button id="tab-list" title="Tabs, groups, and safe closing" style="height:36px;width:36px;color:var(--muted)"><span class="ms" style="font-size:19px">menu</span></button>
     <div class="palette-hint" id="palette-open-2"><span class="ms" style="font-size:16px">search</span>Search everything <b>Ctrl+Shift+F</b></div>`;
  $('#content').innerHTML = (VIEWS[state.view] || VIEWS.overview)();
  $('#live-command').textContent = liveCommand();
  document.body.classList.toggle('light', state.theme === 'light');
  $('#logo-open').textContent = state.logo;
  save();
  wireContent();
}

/* ---------- wiring ---------- */
const go = (v) => { state.view = v; render(); };
function wireContent() {
  $$('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
  $$('[data-group]').forEach((b) => b.addEventListener('click', () => go(GROUPS[b.dataset.group].items[0][0])));
  $$('#palette-open,#palette-open-2').forEach((b) => b.addEventListener('click', openPalette));
  const bindSlider = (id, key, num = true) => { const el = $('#' + id); if (el) el.addEventListener('input', () => { state[key] = num ? Number(el.value) : el.value; el.closest('div').querySelector('.slider-head b').textContent = el.value + (id === 'lufsI' ? ' LUFS' : id === 'lra' ? ' LU' : id === 'tp' ? ' dBTP' : id === 'hlsTime' ? ' s' : ''); $('#live-command').textContent = liveCommand(); const pre = $('#cmd-pre'); if (pre) pre.textContent = liveCommand(); save(); }); };
  ['crf', 'crfMax', 'lookahead', 'textAlpha', 'lufsI', 'lra', 'tp', 'gifFps', 'gifColors', 'nvencCq', 'hlsTime', 'hlsList'].forEach((k) => bindSlider(k, k));
  $$('[data-x264preset]').forEach((b) => b.addEventListener('click', () => { state.x264Preset = b.dataset.x264preset; render(); }));
  $$('[data-nvencpreset]').forEach((b) => b.addEventListener('click', () => { state.nvencPreset = b.dataset.nvencpreset; render(); }));
  $$('[data-bool]').forEach((c) => c.addEventListener('change', () => { state.bools[c.dataset.bool] = c.checked; save(); }));
  $$('[data-node]').forEach((b) => b.addEventListener('click', () => { state.selNode = b.dataset.node; render(); }));
  $$('[data-swatch]').forEach((b) => b.addEventListener('click', () => { state.fontColor = b.dataset.swatch; render(); }));
  const fc = $('#fontcolor'); if (fc) fc.addEventListener('input', () => { state.fontColor = fc.value; $('#fontcolor-val').textContent = fc.value + '@' + state.textAlpha; $('#live-command').textContent = liveCommand(); save(); });
  const tuneEl = $('#tune'); if (tuneEl) tuneEl.addEventListener('change', () => { state.tune = tuneEl.value; $('#live-command').textContent = liveCommand(); save(); });
  const fu = $('#fps-up'), fd = $('#fps-down');
  if (fu) fu.addEventListener('click', () => { state.fpsIdx = Math.min(7, state.fpsIdx + 1); render(); });
  if (fd) fd.addEventListener('click', () => { state.fpsIdx = Math.max(0, state.fpsIdx - 1); render(); });
  const sd = $('#set-dark'), sl = $('#set-light');
  if (sd) sd.addEventListener('click', () => { state.theme = 'dark'; render(); });
  if (sl) sl.addEventListener('click', () => { state.theme = 'light'; render(); });
  $$('.danger-open').forEach((b) => b.addEventListener('click', openConfirm));
  $$('[data-appearance],.appearance-open').forEach((b) => b.addEventListener('click', () => { $('#appearance-target').textContent = 'Target: ' + (b.dataset.appearance || 'selected element'); $('#appearance-dialog').showModal(); }));
  $$('.builder-button').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); openRegex(); }));
  const lo2 = $('#logo-open-2'); if (lo2) lo2.addEventListener('click', openLogo);
  $$('.vocab-upload').forEach((inp) => inp.addEventListener('change', async () => {
    const f = inp.files[0]; if (!f) return;
    if (f.size > 65536) return toast('Vocabulary rejected', 'File exceeds the 64 KB bound.');
    try { const j = JSON.parse(await f.text()); if (j.schemaVersion !== 1 || typeof j.entries !== 'object') throw new Error('schema'); state.vocab = j; save(); toast('Vocabulary loaded', Object.keys(j.entries).length + ' entries — private and local.'); render(); }
    catch { toast('Vocabulary rejected', 'Not a valid schema v1 vocabulary JSON.'); }
  }));
  const pick = $('#pick-input'); if (pick && window.api) pick.addEventListener('click', async () => { const p = await window.api.openFile(); if (p) toast('Input selected', p); });
  state.jobSel = state.jobSel || {};
  const selCount = () => { const el = $('#job-sel-count'); if (el) el.textContent = Object.values(state.jobSel).filter(Boolean).length + ' selected'; };
  $$('.job-sel').forEach((c) => c.addEventListener('change', () => { state.jobSel[c.dataset.name] = c.checked; save(); selCount(); }));
  selCount();
  const jsa = $('#jobs-select-all'); if (jsa) jsa.addEventListener('click', () => { JOBS.forEach(([, n]) => state.jobSel[n] = true); save(); render(); });
  const jcs = $('#jobs-clear-sel'); if (jcs) jcs.addEventListener('click', () => { state.jobSel = {}; save(); render(); });
  const jbp = $('#jobs-bulk-pause'); if (jbp) jbp.addEventListener('click', () => { state.jobSel = {}; save(); render(); toast('Paused', 'Selected jobs paused.'); });
  const jbb = $('#jobs-bulk-back'); if (jbb) jbb.addEventListener('click', () => { state.jobSel = {}; save(); render(); toast('Reordered', 'Selected jobs moved to back of queue.'); });
  const ss = $('#sec-save'); if (ss) ss.addEventListener('click', () => { const pw = $('#sec-set-pw').value.trim(); if (!pw) return; window.secSave(pw, $('#sec-totp').checked).then(() => toast('Password saved', 'Stored locally as a salted hash.')); });
  const sl = $('#sec-lock'); if (sl) sl.addEventListener('click', () => { window.secLock ? window.secLock() : toast('Set a password first', 'Locking requires a saved password.'); });
  $$('.lock-unlock').forEach((b) => b.addEventListener('click', () => openConfirm('Unlock “' + b.dataset.l + '”?', 'Unlocking restores all interactions on this element.', () => { delete state.locks[b.dataset.l]; save(); render(); })));
  $$('#copy-command,#copy-command-2').forEach((b) => b.addEventListener('click', () => { navigator.clipboard.writeText(liveCommand()); toast('Copied', 'Command copied to clipboard.'); }));
}

/* ---------- dialogs ---------- */
function openPalette() {
  const items = [];
  Object.entries(GROUPS).forEach(([, g]) => g.items.forEach(([id, , label, count]) => items.push([`Go to ${label}`, `View · ${g.title}${count ? ' — ' + count + ' entries' : ''}`, () => go(id)])));
  items.push(['Toggle theme', 'Setting · flips instantly', () => { state.theme = state.theme === 'dark' ? 'light' : 'dark'; render(); }]);
  items.push(['Customize app logo', 'Setting · presentation only', openLogo]);
  items.push(['Clear job queue…', 'Action · two-key safety gate', openConfirm]);
  const list = $('#command-list'), search = $('#command-search');
  const draw = (q = '') => {
    let test = (t) => t.toLowerCase().includes(q.toLowerCase());
    if (q.startsWith('/') && q.length > 1) { try { const re = new RegExp(q.slice(1), 'i'); test = (t) => re.test(t); } catch { } }
    list.innerHTML = items.filter(([l, s]) => test(l + ' ' + s)).map(([l, s], i) => `<button class="command" data-i="${i}" value="default"><span><b style="font-size:13px">${esc(l)}</b><br><small>${esc(s)}</small></span><kbd>↵</kbd></button>`).join('');
    $$('.command', list).forEach((b) => b.addEventListener('click', () => { $('#command-dialog').close(); items.filter(([l, s]) => test(l + ' ' + s))[+b.dataset.i][2](); }));
  };
  search.value = ''; draw(); search.oninput = () => draw(search.value);
  $('#command-dialog').showModal(); search.focus();
}
const REGEX_TOKENS = [['\\d', 'any digit 0-9'], ['\\w', 'word character'], ['\\s', 'whitespace'], ['[a-z]', 'character range'], ['[^]', 'negated set'], ['^', 'start anchor'], ['$', 'end anchor'], ['+', 'one or more'], ['*', 'zero or more'], ['?', 'optional'], ['{2,4}', 'count range'], ['|', 'alternation'], ['()', 'capture group'], ['(?:)', 'non-capture group'], ['\\b', 'word boundary'], ['.', 'any character'], ['\\.', 'literal dot']];
const REGEX_RECIPES = [['Hardware encoders', '(nvenc|qsv|amf|videotoolbox)$'], ['10-bit codecs', '(10le|10be|p010)'], ['Timecodes', '^\\d{2}:\\d{2}:\\d{2}[.:]\\d+$'], ['Log errors only', '\\[(error|fatal)\\]'], ['Segment files', 'seg_\\d+_\\d+\\.(ts|m4s)$']];
const REGEX_FLAGS = [['i', 'case-insensitive'], ['g', 'global — all matches'], ['m', 'multiline anchors'], ['u', 'unicode']];
function explainRegex(pat) {
  try { new RegExp(pat); } catch (e) { return 'Invalid pattern — ' + e.message; }
  const parts = [];
  if (pat.startsWith('^')) parts.push('anchored to start');
  if (pat.endsWith('$')) parts.push('anchored to end');
  if (/\|/.test(pat)) parts.push('matches any of the alternatives');
  if (/\(\?:/.test(pat)) parts.push('groups without capturing'); else if (/\(/.test(pat)) parts.push('captures a group');
  if (/\\d/.test(pat)) parts.push('expects digits');
  if (/[+*]|\{\d/.test(pat)) parts.push('repeats a token');
  return parts.length ? parts.join('; ') + '.' : 'literal text match.';
}
function openRegex() {
  const d = $('#regex-dialog'), p = $('#regex-pattern'), f = $('#regex-flags'), s2 = $('#regex-sample'), out = $('#regex-preview'), ex = $('#regex-explain');
  const update = () => { ex.textContent = explainRegex(p.value); try { const re = new RegExp(p.value, f.value.replace('g', '')); const m = s2.value.split(/\s+/).filter((w) => re.test(w)); out.textContent = m.length ? 'matches: ' + m.join(', ') : 'no matches in sample'; } catch (e) { out.textContent = 'invalid pattern: ' + e.message; } };
  $('#regex-tokens').innerHTML = REGEX_TOKENS.map(([t, desc], i) => `<button type="button" class="tok-btn" title="${desc}" data-i="${i}">${esc(t)}</button>`).join('');
  $$('#regex-tokens .tok-btn').forEach((b) => (b.onclick = () => { p.value += REGEX_TOKENS[+b.dataset.i][0]; update(); }));
  $('#regex-recipes').innerHTML = REGEX_RECIPES.map(([l, pat], i) => `<button type="button" class="tag" title="${esc(pat)}" data-i="${i}" style="cursor:pointer;border:0;font-size:11.5px;padding:5px 12px">${l}</button>`).join('');
  $$('#regex-recipes .tag').forEach((b) => (b.onclick = () => { p.value = REGEX_RECIPES[+b.dataset.i][1]; update(); }));
  const drawFlags = () => { $('#regex-flag-btns').innerHTML = REGEX_FLAGS.map(([fl, desc]) => `<button type="button" class="flag-btn${f.value.includes(fl) ? ' active' : ''}" title="${desc}" data-f="${fl}">${fl}</button>`).join(''); $$('#regex-flag-btns .flag-btn').forEach((b) => (b.onclick = () => { const fl = b.dataset.f; f.value = f.value.includes(fl) ? f.value.replace(fl, '') : f.value + fl; drawFlags(); update(); })); };
  drawFlags(); [p, s2].forEach((el) => (el.oninput = update)); update(); d.showModal();
}
/* ---------- context menus ---------- */
function showCtx(e, title, sub, items) {
  e.preventDefault(); e.stopPropagation();
  state.locks = state.locks || {};
  if (state.locks[title]) {
    items = [['lock_open', 'Unlock element… (safety gate)', false, () => openConfirm('Unlock “' + title + '”?', 'This element was locked as a toy lock. Unlocking restores all interactions.', () => { delete state.locks[title]; save(); render(); })]];
  } else {
    items = items.concat([
      ['palette', 'Edit appearance', false, () => { $('#appearance-target').textContent = 'Target: ' + title; $('#appearance-dialog').showModal(); }],
      ['lock', 'Lock element (toy lock)', false, () => { state.locks[title] = true; save(); render(); toast('Locked', title + ' is now a toy lock — right-click to unlock.'); }],
      ['support_agent', 'File a support ticket', false, () => toast('Support ticket', 'Ticket drafted for “' + title + '” — see notification centre.')],
    ]);
  }
  const m = $('#ctx-menu');
  m.innerHTML = `<header><b>${esc(title)}</b><br><small>${esc(sub)}</small></header>` +
    items.map(([icon, label, danger], i) => `<button data-i="${i}" class="${danger ? 'danger' : ''}"><span class="ms">${icon}</span>${esc(label)}</button>`).join('');
  m.hidden = false;
  m.style.left = Math.min(e.clientX, innerWidth - 250) + 'px';
  m.style.top = Math.min(e.clientY, innerHeight - 60 - items.length * 38) + 'px';
  $$('button', m).forEach((b) => (b.onclick = () => { m.hidden = true; const fn = items[+b.dataset.i][3]; if (fn) fn(); }));
}
document.addEventListener('click', () => { $('#ctx-menu').hidden = true; });
document.addEventListener('contextmenu', (e) => {
  const tab = e.target.closest('.tab');
  if (tab) return showCtx(e, tab.textContent.trim(), 'Workspace tab', [
    ['keep', 'Pin tab'], ['tab_duplicate', 'Duplicate tab'], ['folder', 'Move to group…', false, openTabManager],
    ['close', 'Close tab', true], ['clear_all', 'Close others…', true, openTabManager]]);
  const row = e.target.closest('.registry-row');
  if (row) return showCtx(e, row.querySelector('b').textContent, 'Registry entry', [
    ['tune', 'Open option editor'], ['content_copy', 'Copy name', false, () => navigator.clipboard.writeText(row.querySelector('b').textContent)],
    ['bookmarks', 'Use in new preset', false, () => go('presets')], ['description', 'Show source AVOption table']]);
  const job = e.target.closest('.list-item');
  if (job && (state.view === 'jobs' || state.view === 'overview') && job.querySelector('.progress-track')) {
    return showCtx(e, job.querySelector('b').textContent, 'Job', [
      ['pause', 'Pause job'], ['low_priority', 'Move to back of queue'],
      ['terminal', 'Copy full command', false, () => navigator.clipboard.writeText(liveCommand())],
      ['receipt_long', 'Open log', false, () => go('jobs')], ['cancel', 'Cancel job…', true, openConfirm]]);
  }
  // generic fallback: every element gets appearance editor + toy lock
  const host = e.target.closest('button,label,h1,h2,h3,pre,input,select,.card,.list-item') || e.target;
  const label = ((host.innerText || host.value || host.tagName || 'Element').trim().split('\n')[0] || 'Element').slice(0, 42) || 'Element';
  showCtx(e, label, 'Any element — appearance & locks', []);
});
function openConfirm(title, copy, onGo) {
  const d = $('#confirm-dialog'); const keys = { a: false, l: false };
  $('#confirm-title').textContent = title || 'Clear the job queue?';
  $('#confirm-copy').textContent = copy || 'This cancels running jobs and removes queued jobs. Press both keys, then move the slider to the end to authorize.';
  const sliderEl = $('#confirm-slider'), goBtn = $('#confirm-go'), prog = $('#confirm-progress');
  sliderEl.value = 0; prog.style.width = '0'; sliderEl.disabled = true; goBtn.disabled = true;
  $$('.key-row button', d).forEach((b) => { b.classList.remove('ready'); b.onclick = () => { keys[b.dataset.key] = true; b.classList.add('ready'); if (keys.a && keys.l) sliderEl.disabled = false; }; });
  sliderEl.oninput = () => { prog.style.width = sliderEl.value + '%'; goBtn.disabled = sliderEl.value < 100; };
  goBtn.onclick = () => { d.close(); if (onGo) onGo(); else { state.jobSel = {}; save(); render(); toast('Queue cleared', 'All jobs cancelled and removed.'); } };
  d.showModal();
}
function openLogo() {
  const wrap = $('#logo-presets');
  wrap.innerHTML = ['M', 'F', '▶', '◆', '8'].map((g) => `<button type="button" data-glyph="${g}" style="width:46px;height:46px;border-radius:14px;border:2px solid ${g === state.logo ? 'var(--accent)' : 'var(--line)'};background:${g === state.logo ? 'var(--accent)' : 'var(--surface2)'};color:${g === state.logo ? 'var(--on-accent)' : 'var(--text)'};font-weight:800;font-size:17px">${g}</button>`).join('');
  $$('[data-glyph]', wrap).forEach((b) => b.addEventListener('click', () => { state.logo = b.dataset.glyph; render(); openLogo(); }));
  $('#logo-reset').onclick = (e) => { e.preventDefault(); state.logo = 'M'; render(); openLogo(); };
  $('#logo-dialog').showModal();
}
function openNotifications() {
  $('#notification-list').innerHTML = NOTIFS.map(([t, b, when]) => `<div class="list-item" style="display:block;border-left:3px solid var(--accent)"><b style="font-size:13px">${esc(t)}</b><br><small>${esc(b)}</small><br><small class="mono" style="font-size:10.5px">${esc(when)}</small></div>`).join('') || '<p class="hint">No notifications.</p>';
  $('#notification-dialog').showModal();
}
function openTabManager() {
  $('#tab-manager-list').innerHTML = [['Overview', 'pinned · Home', 'Unpin'], ['Convert — libx264', 'Media · modified', 'Pin'], ['Filtergraph', 'Media', 'Pin'], ['Jobs & logs', 'Home', 'Pin']].map(([l, s, p]) => `
    <div class="list-item"><span style="flex:1;min-width:0"><b style="font-size:13px">${l}</b><br><small>${s}</small></span>
    <select style="background:var(--surface3);border:1px solid var(--line);border-radius:9px;color:var(--text);padding:8px"><option>Home</option><option>Encoding</option><option>No group</option></select>
    <button class="tonal" style="padding:8px 12px;font-size:12px">${p}</button><button style="color:var(--danger);padding:6px">×</button></div>`).join('');
  $('#tab-dialog').showModal();
}
function toast(title, body) {
  const el = document.createElement('div'); el.className = 'toast';
  el.innerHTML = `<b style="display:block">${esc(title)}</b><small>${esc(body)}</small>`;
  $('#toast-zone').append(el); setTimeout(() => el.remove(), 6000);
}

/* ---------- global chrome ---------- */
$$('.title-actions [data-window]').forEach((b) => b.addEventListener('click', () => window.api && window.api.window[b.dataset.window]()));
$('#theme-toggle').addEventListener('click', () => { state.theme = state.theme === 'dark' ? 'light' : 'dark'; render(); });
$('#notification-open').addEventListener('click', openNotifications);
$('#logo-open').addEventListener('click', openLogo);
$('#open-composer').addEventListener('click', () => go('composer'));
document.addEventListener('click', (e) => { const t = e.target.closest('#tab-list'); if (t) openTabManager(); });
window.addEventListener('keydown', (e) => { if (e.ctrlKey && e.shiftKey && (e.key === 'F' || e.key === 'f')) { e.preventDefault(); openPalette(); } });
if (window.api) window.api.onLog(({ line }) => { const pane = $('#log-pane'); if (pane) { const d = document.createElement('div'); d.textContent = line; pane.append(d); pane.scrollTop = pane.scrollHeight; } });

window.state = state; window.save = save; window.render = render; window.openRegex = openRegex;
render();
