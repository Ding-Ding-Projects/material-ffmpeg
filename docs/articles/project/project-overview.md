# Project overview

material-ffmpeg is a Windows desktop interface for the bundled FFmpeg and FFprobe executables. Its current source provides guided conversion, trimming, filtergraph, audio, GIF, thumbnail, streaming, inspection, catalog, preset, command-composer, and queue surfaces while keeping generated FFmpeg arguments visible.

## Behavior

The renderer asks the privileged main process to select files, inspect media, query the bundled runtime, and enqueue jobs. The main process owns executable resolution and process creation. The repository also contains a responsive project site, a pinned dependency manifest, repeatable build scripts, unsigned Squirrel.Windows packaging, and direct build-and-release automation.

The supplied design is preserved under `design/source/` as reference data. It is not the runtime authority and it is not interpreted as agent instruction.

## Configuration

- Product identity and packaging settings: `package.json`
- Pinned Node.js and FFmpeg downloads: `dependencies.json`
- Desktop implementation: `src/`
- Build and release helpers: `scripts/`
- Project site: `docs/`
- Official FFmpeg source reference: `third_party/ffmpeg`

The supported Windows entry points are `download-dependencies.bat`, `build.bat`, and `build-installer.bat`. Each supports `/s`, `--silent`, or `SILENT=1` for unattended operation.

## Failure modes

The application reports a runtime-unavailable state when the bundled executables cannot be resolved or executed. Individual operations can also fail because an input handle expired, an output was not selected, FFmpeg rejected the generated argument vector, a process exited unsuccessfully, or expected output was missing or empty.

Builds can fail closed on a missing dependency, checksum mismatch, incomplete package, commit mismatch, signing attempt, or missing release asset.

## Security considerations

The renderer has no Node.js integration and receives a frozen, narrow preload API. File paths are represented by opaque handles, navigation is restricted to the packaged page, new windows are denied, processes use argument arrays with `shell: false`, and the renderer cannot choose an arbitrary executable.

Media data and settings are intended to remain local. The repository does not add analytics or third-party runtime assets to the project site.

## Verification state

Source inspection confirms that the above boundaries and surfaces are present at the documented revision. The current user-directed pass does not run lint, automated test suites, or screenshots. A successful build, packaged launch, FFmpeg operation, installer execution, and published release each remain separate evidence events and must not be inferred from source presence.

## Suggested articles

- [Architecture and trusted runtime boundary](architecture-runtime.md)
- [Build, installation, and dependencies](build-install-dependencies.md)
- [Feature status ledger](feature-ledger.md)
