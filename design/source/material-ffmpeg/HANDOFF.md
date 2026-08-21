# HANDOFF — material-ffmpeg (Electron app)

The UI is complete and self-running with mock data. A wiring agent's ONLY job is connecting real ffmpeg/ffprobe output to the existing surfaces. Do not redesign; the DC file `../FFmpeg Media Console.dc.html` is the visual source of truth ("what it looks like").

## Run / package
- `npm install && npm start` (Electron ≥33). `npm run dist` → Squirrel.Windows, **unsigned by permanent policy** (forceCodeSigning=false must stay).
- Requires `ffmpeg`/`ffprobe` on PATH for real execution; every screen renders without them.

## IPC contract (already implemented in main.js / preload.js)
- `window.api.window.{minimize,maximize,close}` — frameless titlebar controls (wired).
- `window.api.openFile()` → native file picker path (wired to Convert › Change input).
- `window.api.runFfmpeg({bin, args, jobId})` → spawns, resolves `{code}`.
- `window.api.onLog(cb)` → streamed stderr/stdout lines `{jobId, line}` (already appended to the Jobs log pane).

## Wiring TODOs (in priority order)
1. **Registries** — replace the representative rows in `renderer.js` `REGISTRY` with real parses of `ffmpeg -codecs / -formats / -protocols / -bsfs / -devices / -filters` (run once at startup via `runFfmpeg`, cache in localStorage).
2. **Jobs** — replace the `JOBS` mock array with a real queue: build args from `liveCommand()`, call `runFfmpeg`, parse `frame=/fps=/speed=` lines into the progress bars.
3. **ffprobe inspector** — `ffprobe -v quiet -print_format json -show_format -show_streams <file>` → populate `VIEWS.inspector`.
4. **Option guides** — `option-guides.js` `DOCS` holds ~30 curated entries. Long-tail options: generate entries from `ffmpeg -h encoder=<name>` output (same shape: kind/body/values/min/max).
5. **Converter** — byte-detection is illustrative; implement magic-number sniffing in main process (read first 16 bytes).

## Feature map (all working in-UI today)
- Views: overview, convert (full libx264), trim, filtergraph, audio/loudnorm, gif, presets, inspector, 6 registries, hwaccel/NVENC, streaming/HLS, jobs (+bulk select/pause/cancel), composer, file converter, settings.
- Universal: Ctrl+Shift+F palette · regex builder (tokens, recipes, flags, explanation; draggable, close only via buttons) · option guides (ⓘ on every config; enum listbox w/ search+regex, number stepper+slider, rich bool cards, array builder w/ bulk actions; live command preview; draggable) · right-click menus with search on tabs/jobs/registry (+Edit appearance, toy Lock, support ticket) · functional toy locks (unlock via two-key gate) · two-key+slider super confirmation · per-element appearance editor · app-logo customization · notification centre · personal vocabulary upload (validated schema v1 ≤64 KB, persisted, applied to nav labels) · theme dark/light · state persisted in localStorage (`mffmpeg.*`).
- **No Ollama** — intentionally excluded by owner instruction.

## Invariants
- Never enable code signing. Never remove a universal feature to "simplify". Vocabulary JSON stays local; never bundle real user vocabulary into committed code.
