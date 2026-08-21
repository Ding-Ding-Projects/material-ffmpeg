# Feature status ledger

This ledger describes the installed desktop application and distinguishes source-wired behavior from packaged and interaction-verified behavior. “Source-wired” means the active code contains a route from a user control through the preload API to the trusted runtime where applicable. It does not mean the behavior has been executed successfully. The static website keeps its separate hand-written inventory in [Website feature inventory](../features/inventory.md).

## Exact candidate evidence

The current interaction evidence belongs to source commit `5358582f13b6af418e58c1971747b270d308f34b`. A feature is marked **Working** only when the packaged application was exercised successfully at that exact commit. **Unrun** means the feature is source-wired and packaged but was not exercised in this evidence pass. **Not integrated** means the required desktop bridge or user-facing surface is not connected in the packaged application. This ledger does not assert a release verdict.

### Working: packaged and interacted

| Feature | Status | Exact evidence |
| --- | --- | --- |
| Packaged application launch | Working | The packaged executable launched on the isolated headless desktop at the exact source commit. |
| Bundled runtime detection | Working | The packaged application resolved bundled FFmpeg 9.0.1 and FFprobe 9.0.1. |
| Local icon rendering | Working | The packaged renderer displayed the bundled local icon font without literal ligature text. |
| Convert | Working | A real conversion used native file dialogs, opaque file handles, structured arguments, the trusted runtime boundary, and bundled FFmpeg. |
| Queue completion, logs, and output validation | Working | The job completed with progress and logs; the result was validated as a non-empty H.264/AAC output. |
| Inspector | Working | FFprobe inspected a real H.264 320x180 video with AAC 48 kHz mono audio and rendered the returned metadata. |
| Codecs catalog | Working | The live bundled-runtime codecs catalog loaded 539 entries. |

### Source-wired and packaged, but unrun

| Feature | Status | Evidence boundary |
| --- | --- | --- |
| Trim | Unrun | Packaged route exists; no exact-commit interaction receipt was produced. |
| Filtergraph | Unrun | Packaged route exists; no exact-commit interaction receipt was produced. |
| Audio extraction | Unrun | Packaged route exists; no exact-commit interaction receipt was produced. |
| Two-pass loudness normalization | Unrun | Packaged route exists; no exact-commit interaction receipt was produced. |
| GIF creation | Unrun | Packaged route exists; no exact-commit interaction receipt was produced. |
| Thumbnail generation | Unrun | Packaged route exists; no exact-commit interaction receipt was produced. |
| HLS output | Unrun | Packaged route exists; no exact-commit interaction receipt was produced. |
| RTMP and SRT transport | Unrun | Packaged route exists; no exact-commit interaction receipt was produced. |
| Command composer | Unrun | Packaged route exists; no exact-commit interaction receipt was produced. |
| Batch converter | Unrun | Packaged route exists; no exact-commit interaction receipt was produced. |
| Queue pause, resume, cancel, reorder, and clear | Unrun | Packaged route exists; no exact-commit interaction receipt was produced. |
| Runtime catalog kinds other than codecs | Unrun | Only the codecs catalog was interacted with in this pass. |
| Component help | Unrun | Packaged route exists; no exact-commit interaction receipt was produced. |
| JSON, CSV, and XML export | Unrun | Packaged route exists; no exact-commit interaction receipt was produced. |

### Not integrated

| Feature | Status | Evidence boundary |
| --- | --- | --- |
| Desktop offline documentation browser | Not integrated | Article and service foundations do not yet have complete main, preload, and renderer bridges. |
| Desktop Ollama suite manager | Not integrated | Service and user-interface foundations do not yet have complete main, preload, and renderer bridges. |
| Universal feature contract | Not integrated | The complete cross-surface contract remains incomplete and unproven. |

## Broader source inventory

| Feature | Source state | Packaged/runtime state | Notes |
| --- | --- | --- | --- |
| Runtime status and version | Source-wired | Working at `5358582` | Bundled FFmpeg 9.0.1 and FFprobe 9.0.1 were detected in the packaged application. |
| Native input/output selection | Source-wired | Working at `5358582` | Native file dialogs participated in the real Convert interaction; the renderer received opaque handles, not paths. |
| Convert | Source-wired | Working at `5358582` | A real H.264/AAC output completed through structured arguments and bundled FFmpeg. |
| Trim | Source-wired | Unrun | Copy and re-encode modes use typed builders. |
| Filtergraph | Source-wired | Unrun | Video, audio, or complex graph validation is present. |
| Audio processing | Source-wired | Unrun | Includes audio extraction and two-pass loudness normalization controls. |
| GIF creation | Source-wired | Unrun | Palette/fps/dither controls are present. |
| Thumbnails | Source-wired | Unrun | Builder and destination flow are present. |
| HLS, RTMP, and SRT streaming | Source-wired | Unrun | Guided encoding controls, HLS selected-handle derivatives, mode-matched URLs, session-only target handling, and queue submission are present. |
| RTMP and SRT transport | Source-wired | Unrun | Transport builders are packaged; no exact-commit interaction receipt was produced. |
| Command composer | Source-wired | Unrun | Dangerous/path-bearing options are blocked. |
| Batch converter | Source-wired | Unrun | Eight media adapters are currently mapped. |
| Inspector and probe export | Source-wired | Inspector working; snapshot exports unrun | Real H.264 320x180 and AAC input was inspected. JSON preserves the bounded snapshot; CSV and XML use the documented row-per-node schema through a trusted output handle. None of the three exports were interacted with. |
| Runtime catalogs and help | Source-wired | Codecs working; other kinds and help unrun | The live codecs catalog returned 539 entries. |
| Durable job queue | Source-wired | Completion/logs working; controls unrun | Persistence, progress, logs, pause/resume/cancel/reorder/clear are implemented. |
| Output validation | Source-wired | Working at `5358582` | The completed conversion produced and validated a non-empty H.264/AAC output. |
| Presets | Source-wired | Unrun | Local creation/edit/delete and bounded persistence. |
| Themes and basic appearance | Source-wired, partial contract | Not integrated | Basic controls exist; Word-depth editing does not. |
| Tabs and groups | Source-wired, partial contract | Not integrated | Basic pin/group/duplicate/close exists; full docking and four-search contract does not. |
| Regex builder | Source-wired, partial contract | Not integrated | Local pattern feedback exists; not every search surface has proven complete integration. |
| Command palette | Source-wired, partial contract | Not integrated | `Ctrl+Shift+F` and destination commands exist; full rich-control inventory is incomplete. |
| Notification centre | Source-wired, partial contract | Not integrated | Local history exists; complete bulk/history behavior is incomplete. |
| App logo customization | Source-wired, partial contract | Not integrated | Presets/upload shell exist; complete bounded conversion/editor proof is absent. |
| Destructive confirmation | Source-wired, partial contract | Not integrated | Two checkboxes and a slider are present; complete accessibility/animation evidence is absent. |
| Personal vocabulary upload | Not implemented | Not integrated | No complete validated local JSON contract is wired. |
| English/Cantonese/bilingual modes and funny levels | Not implemented | Not integrated | Required persisted language surfaces are absent. |
| Narrator and voice pickers | Not implemented | Not integrated | No complete TTS queue and voice-selection surface. |
| School mode | Not implemented | Not integrated | No shared live cross-application record or unlock flow. |
| Scheduled/API/Home Assistant settings | Not implemented | Not integrated | No validated scheduled-source engine. |
| Automatic updates | Not implemented | Not integrated | Squirrel metadata exists; app-side update lifecycle does not. |
| Local Git-backed history | Not implemented | Not integrated | Local storage persistence is not append-only Git history. |
| Vault-backed toy locks and authenticator | Not implemented | Not integrated | The local hash prototype is not the required credential-vault/TOTP system. |
| Support Tickets recovery surface | Not implemented | Not integrated | No complete local fictional support workflow. |
| Universal multi-category file converter | Partial media subset only | Not integrated | Media adapters exist; documents, archives, structured data, code/text, binary encodings, PDF tools, and resumable unlimited queue are absent. |
| Local Ollama suite manager | Foundation only | Not integrated | Service and user-interface foundations lack complete main, preload, and renderer bridges. |
| In-app offline documentation browser | Foundation only | Not integrated | Article and service foundations lack complete main, preload, and renderer bridges. |
| Browser-extension download dialogs | Not implemented | Not integrated | No extension handoff or start/progress/completion windows. |

## Configuration

Source-wired rows are implemented primarily in `src/renderer.js`, `src/ui/command-builders.js`, `src/preload.js`, and `src/runtime/`. Build and release rows are configured in `package.json`, `dependencies.json`, `scripts/`, and `.github/workflows/release.yml`.

## Failure modes

The primary reporting failure is confusing a visible control, source method, successful build, or deployed site with working end-to-end behavior. Every row must retain its evidence boundary. A partial implementation must remain partial even if its happy-path UI resembles the complete contract.

## Security considerations

Incomplete security-related surfaces must not claim protection. In particular, the local-storage lock prototype is not a credential vault, and the absence of arbitrary shell access does not prove FFmpeg input safety. Never add private data to this public ledger.

## Verification state

The working rows above were exercised in the packaged application at exact source commit `5358582f13b6af418e58c1971747b270d308f34b`. The user explicitly disabled lint and test suites for this pass, so both remain unrun. Every other packaged feature remains **Unrun** unless an exact-commit interaction receipt is added, and incomplete desktop bridges remain **Not integrated**. This ledger does not claim release publication or release-asset verification.

## Suggested articles

- [Project overview](project-overview.md)
- [Handoff](handoff.md)
- [Privacy and security](privacy-security.md)
- [Build, installation, and dependencies](build-install-dependencies.md)
