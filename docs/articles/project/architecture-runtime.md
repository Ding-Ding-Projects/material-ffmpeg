# Architecture and trusted runtime boundary

material-ffmpeg separates the unprivileged renderer from file-system access and process creation.

## Behavior

`src/main.js` creates a frameless, sandboxed BrowserWindow with context isolation, Node.js integration disabled, web security enabled, external windows denied, and navigation restricted to the packaged `index.html`. It resolves the packaged FFmpeg executables, creates the file registry, runtime service, and job manager, and registers a narrow IPC surface.

`src/preload.js` exposes frozen groups for window controls, runtime status/catalogs, native file selection, probing/export, and queue operations. `src/runtime/trusted-executable-locations.js` keeps the executable search bounded to two fixed roots: packaged builds use `process.resourcesPath/ffmpeg/ffmpeg.exe` and `process.resourcesPath/ffmpeg/ffprobe.exe`; development builds use `<repositoryRoot>/resources/ffmpeg/ffmpeg.exe` and `<repositoryRoot>/resources/ffmpeg/ffprobe.exe`. It never searches `PATH` or accepts a caller-selected executable. `src/runtime/safe-process.js` is the consuming boundary for those trusted paths, compiles validated job arguments, and launches processes without a shell. `src/runtime/runtime-service.js` handles version, inventory, help, inspection, and probe export requests.

## Configuration

The bundled runtime is expected at the flat `ffmpeg` directory beneath the packaged resources directory. In development, the same flat layout is materialized under the repository's `resources/ffmpeg` directory. There is no `bin` search layer. The job manager persists queue state below Electron's stable user-data directory. Catalog list results are cached for five minutes and bounded by request-specific byte and time limits.

## Failure modes

The runtime reports unavailable when either fixed-location executable is missing or is not a regular file. The internal location diagnostic returns bounded machine-safe status metadata with stable reason identifiers; it does not return absolute paths to the renderer. IPC rejects calls from a sender other than the main application frame. Invalid inventory kinds, help names, file handles, argument objects, output types, timeouts, or oversized process output fail with explicit errors. Runtime calls do not fall back to `PATH` or arbitrary machine-installed executables.

## Security considerations

Opaque file handles prevent renderer-supplied paths. IPC verifies the sender and main frame. Executable identity is fixed by the main process, arguments are arrays, shell execution is disabled, and process output is bounded. Navigation and new-window denial reduce the chance that untrusted web content can reach the preload API.

This boundary limits authority; it does not make arbitrary media files safe. FFmpeg still parses untrusted inputs, so the bundled version and its upstream security updates remain important.

## Verification state

The fixed-root diagnostic is integrated into `src/runtime/safe-process.js` and confirmed by source inspection. Direct invocation of the previously packaged flat-layout FFmpeg and FFprobe binaries reported version 9.0.1. A new package build, packaged application interaction, screenshot, and hostile-input review were not performed in this repair.

## Suggested articles

- [Jobs, queue, file registry, and commands](jobs-queue-commands.md)
- [Conversion, inspector, and catalogs](conversion-inspector-catalog.md)
- [Privacy and security](privacy-security.md)
