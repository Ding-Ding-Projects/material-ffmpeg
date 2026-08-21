# Handoff

## Delivery lane

- GitHub Pages home: commit `b110674b715e895a0aaf747c4556c749ed56ef12`.
- Runtime archive: FFmpeg 9.0.1 full Windows x64, pinned by URL and SHA-256 in `dependencies.json`.
- Toolchain: Node.js 22.18.0 Windows x64 and `7zip-bin` 5.2.0 are pinned through the manifest and package lock.
- Packaging: unsigned Squirrel.Windows with generated multi-resolution icon, bundled FFmpeg/FFprobe, upstream license/build information, and source-commit metadata.
- Trusted runtime paths: the internal diagnostic enumerates only packaged `process.resourcesPath/ffmpeg/{ffmpeg.exe,ffprobe.exe}` or development `<repositoryRoot>/resources/ffmpeg/{ffmpeg.exe,ffprobe.exe}`; there is no `bin` layer, `PATH` search, or caller-selected executable.
- Manual entry points: `download-dependencies.bat`, `build.bat`, and `build-installer.bat`.
- Automation: every push or manual dispatch builds, publishes a unique non-draft release, and deploys `docs/`.

## Verification boundary

Exact commit `5358582f13b6af418e58c1971747b270d308f34b` was packaged and exercised on a named off-screen desktop through `lowlevel-computer-use-cheap`. The packaged application resolved bundled FFmpeg and FFprobe 9.0.1, completed and independently validated one real H.264/AAC conversion, inspected real media through FFprobe, and loaded a 539-entry live codecs catalog. Three privacy-reviewed captures and their active receipt records are under `docs/captures/5358582/` and `docs/verification/`. The completed-conversion and Inspector captures are quarantined because their rendered pixels expose machine-local paths; path-redacted receipts preserve the verified interaction facts without publishing those images.

This pass intentionally ran no tests, lint, static analysis, accessibility checks, captures, live streaming, or installer execution. The GUI's Parallel jobs preference is wired through the trusted preload/main-process boundary to the live scheduler with the scheduler's real one-through-four bound, but that interaction remains unrun. Inspector JSON/CSV/XML export is bound to the exact retained inspection snapshot, uses only a trusted output handle, documents its nested JSON and row-per-node CSV/XML behavior, and enforces a 32 MiB serialization limit; those export interactions also remain unrun. The Streaming surface source-wires guided HLS playlist and segment options plus mode-matched RTMP/RTMPS and SRT targets, compatibility encoding controls, session-only URL handling, selected-handle HLS derivatives, and durable queue submission; none of those streaming paths was executed. The Trim source path validates opaque input/output handles, positive source ranges or durations, selected output extensions, returned queue identity, and the copy/re-encode mode transition; it remains unrun and is not presented as packaged-runtime proof. Filtergraph, audio extraction, two-pass loudness normalization, batch conversion, additional queue controls, other catalog kinds, and component help remain unrun rather than inferred working. The offline documentation and Ollama desktop bridges plus the broader universal feature contract remain incomplete.

The two-pass loudness GUI validates opaque input/output selections, stream and target bounds, retains only those selected handles through a narrow trusted IPC route for the registry's 24-hour maximum, records its pass-1 handoff in bounded versioned local state, reconciles that state against real queue outcomes, extracts all required finite measurements from bounded logs, prevents duplicate pass-2 jobs, and surfaces every non-recoverable handoff as an error. The code explicitly does not claim that an opaque file selection survives a full application restart. This source path remains unrun and is not presented as packaged-runtime proof.

The GIF and thumbnail source lane now connects native file selection to bounded persisted options, typed FFmpeg argument builders, opaque input/output handle conversion, queue submission, and the queue's nonempty-output validation. GIF generation includes bounded timing, scaling, palette statistics, dithering, Bayer scale, and looping; single-frame palette statistics request a fresh palette per frame. Thumbnail generation seeks to one timestamp and forces exactly one JPEG or PNG output with bounded scaling and format-appropriate quality. This is source-wiring evidence only: the ultra-speed lane ran no tests, lint, type checks, static analysis, accessibility checks, captures, package execution, installer execution, or live visual-output job.

The Command composer now has bounded global/input/output option scopes, guided output-format and native file selection, a bounded inline preview, and a dedicated trusted enqueue route that rebuilds the vector in the main process from live opaque handles before handing it to `JobManager`. Executable names, shell syntax, local or protocol paths, path-reading arguments, implicit file outputs, and runtime-managed arguments are rejected. This is source-wiring evidence only: the composer route remains unrun rather than inferred working.

## Latest release result

[GitHub Actions run `32460503357`](https://github.com/Ding-Ding-Projects/material-ffmpeg/actions/runs/32460503357) completed successfully at exact commit `5358582f13b6af418e58c1971747b270d308f34b`. It published [v0.1.22-r1](https://github.com/Ding-Ding-Projects/material-ffmpeg/releases/tag/v0.1.22-r1) as a non-draft, non-prerelease release and deployed Pages. The release has the setup executable, `RELEASES`, full `.nupkg`, and `SHA256SUMS.txt`, but its current asset inventory lacks the separately required dim-sum image.

## Expected release assets

- `material-ffmpeg-setup-<version>.exe`
- `RELEASES`
- `material-ffmpeg-<version>-full.nupkg`
- `SHA256SUMS.txt`

Use the exact-commit capture and interaction receipts as the current packaged GUI evidence. Preserve unrun and not-integrated rows in the feature ledger until they receive their own exact-commit interaction receipts. Repair the missing dim-sum release asset before treating the broader release contract as complete.
