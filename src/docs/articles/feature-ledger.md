# Feature status ledger

This ledger describes the installed desktop application and distinguishes source-wired behavior from packaged and interaction-verified behavior. “Source-wired” means the active code contains a route from a user control through the preload API to the trusted runtime where applicable. It does not mean the behavior has been executed successfully. The static website keeps its separate hand-written inventory in [Website feature inventory](../features/inventory.md).

## Behavior and current status

| Feature | Source state | Packaged/runtime state | Notes |
| --- | --- | --- | --- |
| Runtime status and version | Source-wired | Not verified in this pass | Reads bundled `ffmpeg -version` with bounds. |
| Native input/output selection | Source-wired | Not verified in this pass | Renderer receives opaque handles, not paths. |
| Convert | Source-wired | Not verified in this pass | Guided H.264/H.265/AV1/VP9/copy controls and queue action. |
| Trim | Source-wired | Not verified in this pass | Copy and re-encode modes use typed builders. |
| Filtergraph | Source-wired | Not verified in this pass | Video, audio, or complex graph validation is present. |
| Audio processing | Source-wired | Not verified in this pass | Includes loudness and audio workflow controls. |
| GIF creation | Source-wired | Not verified in this pass | Palette/fps/dither controls are present. |
| Thumbnails | Source-wired | Not verified in this pass | Builder and destination flow are present. |
| HLS, RTMP, and SRT streaming | Source-wired | Not verified in this pass | Guided encoding controls, HLS selected-handle derivatives, mode-matched URLs, session-only target handling, and queue submission are present. |
| Command composer | Source-wired | Not verified in this pass | Dangerous/path-bearing options are blocked. |
| Batch converter | Source-wired | Not verified in this pass | Eight media adapters are currently mapped. |
| Inspector and probe export | Source-wired | Not verified in this pass | Retains the bounded FFprobe JSON snapshot and exports JSON or documented row-per-node CSV/XML through a native save destination. |
| Runtime catalogs and help | Source-wired | Not verified in this pass | Data is queried from the bundled build. |
| Durable job queue | Source-wired | Not verified in this pass | Persistence, progress, logs, pause/resume/cancel/reorder/clear are implemented. |
| Output validation | Source-wired | Not verified in this pass | Missing or empty expected output fails a job. |
| Presets | Source-wired | Not verified in this pass | Local creation/edit/delete and bounded persistence. |
| Themes and basic appearance | Source-wired, partial contract | Not verified in this pass | Basic controls exist; Word-depth editing does not. |
| Tabs and groups | Source-wired, partial contract | Not verified in this pass | Basic pin/group/duplicate/close exists; full docking and four-search contract does not. |
| Regex builder | Source-wired, partial contract | Not verified in this pass | Local pattern feedback exists; not every search surface has proven complete integration. |
| Command palette | Source-wired, partial contract | Not verified in this pass | `Ctrl+Shift+F` and destination commands exist; full rich-control inventory is incomplete. |
| Notification centre | Source-wired, partial contract | Not verified in this pass | Local history exists; complete bulk/history behavior is incomplete. |
| App logo customization | Source-wired, partial contract | Not verified in this pass | Presets/upload shell exist; complete bounded conversion/editor proof is absent. |
| Destructive confirmation | Source-wired, partial contract | Not verified in this pass | Two checkboxes and a slider are present; complete accessibility/animation evidence is absent. |
| Personal vocabulary upload | Not implemented | Not verified | No complete validated local JSON contract is wired. |
| English/Cantonese/bilingual modes and funny levels | Not implemented | Not verified | Required persisted language surfaces are absent. |
| Narrator and voice pickers | Not implemented | Not verified | No complete TTS queue and voice-selection surface. |
| School mode | Not implemented | Not verified | No shared live cross-application record or unlock flow. |
| Scheduled/API/Home Assistant settings | Not implemented | Not verified | No validated scheduled-source engine. |
| Automatic updates | Not implemented | Not verified | Squirrel metadata exists; app-side update lifecycle does not. |
| Local Git-backed history | Not implemented | Not verified | Local storage persistence is not append-only Git history. |
| Vault-backed toy locks and authenticator | Not implemented | Not verified | The local hash prototype is not the required credential-vault/TOTP system. |
| Support Tickets recovery surface | Not implemented | Not verified | No complete local fictional support workflow. |
| Universal multi-category file converter | Partial media subset only | Not verified | Media adapters exist; documents, archives, structured data, code/text, binary encodings, PDF tools, and resumable unlimited queue are absent. |
| Local Ollama suite manager | Not implemented | Not verified | No Ollama API, catalog, pull, chat, or harness surface. |
| In-app offline documentation browser | Not implemented | Not verified | Articles exist for the site; no bundled desktop browser is wired. |
| Browser-extension download dialogs | Not implemented | Not verified | No extension handoff or start/progress/completion windows. |

## Configuration

Source-wired rows are implemented primarily in `src/renderer.js`, `src/ui/command-builders.js`, `src/preload.js`, and `src/runtime/`. Build and release rows are configured in `package.json`, `dependencies.json`, `scripts/`, and `.github/workflows/release.yml`.

## Failure modes

The primary reporting failure is confusing a visible control, source method, successful build, or deployed site with working end-to-end behavior. Every row must retain its evidence boundary. A partial implementation must remain partial even if its happy-path UI resembles the complete contract.

## Security considerations

Incomplete security-related surfaces must not claim protection. In particular, the local-storage lock prototype is not a credential vault, and the absence of arbitrary shell access does not prove FFmpeg input safety. Never add private data to this public ledger.

## Verification state

This ledger was produced from source inspection at the current documentation base. The user explicitly disabled lint and test suites for this pass, and no screenshots were taken. Packaged/runtime states remain unverified until the exact candidate is built and exercised through the approved headless route.

## Suggested articles

- [Project overview](project-overview.md)
- [Handoff](handoff.md)
- [Privacy and security](privacy-security.md)
- [Build, installation, and dependencies](build-install-dependencies.md)


