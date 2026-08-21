# material-ffmpeg

Local Material 3 Electron control plane for FFmpeg. Frameless shell, left rail + section sidebar, browser-style workspace tabs, and a typed editor for every codec/filter/muxer/protocol option — no bare textboxes, no terminal required.

Design source of truth: `design/source/FFmpeg Media Console.dc.html` (the design component this app is ported from).

## Run

```
npm install
npm start
```

Requires `ffmpeg`/`ffprobe` on PATH for real job execution (the UI runs fully without them).

## Package (Squirrel.Windows, unsigned by policy)

```
npm run dist
```

## Structure

- `src/main.js` — frameless BrowserWindow, window-control IPC, ffmpeg spawn bridge with streamed log lines
- `src/preload.js` — contextBridge API (`window.api`)
- `src/index.html` — shell + all dialogs (palette, regex builder, two-key confirmation, appearance, logo, notifications, tab manager)
- `src/renderer.js` — views, state (persisted to localStorage), live command building
- `src/styles.css` — Material 3 tokens, dark + light

## Universal features

Command palette (Ctrl+Shift+F) · regex builder beside every search · personal-vocabulary JSON upload (validated: schema v1, ≤64 KB, private/local) · app-logo customization (presentation only) · two-key + slider super confirmation · per-element appearance editor · notification centre · tab manager with safe close preview. Ollama is intentionally excluded per owner instruction.
