# Handoff

## Archive UI and current publication

The authoritative archive is `wire-in.zip`, SHA-256 `80ac159b9a110795dd04e5c8052fc4dbfda9eddeac0dd437ef2cebb5f0d30d89`. It has 12 entries and matches `design/source/` byte for byte. Do not replace it with a visually similar implementation; preserve its interface and make changes through trusted wiring.

The focused context-menu repair is packaged-runtime verified. Its search field measured 172 px beside a 32 px regex control; direct hit testing reached Duplicate, the duplicate tab appeared, and the menu dismissed. Verified baseline release [v0.1.502-r1](https://github.com/Ding-Ding-Projects/material-ffmpeg/releases/tag/v0.1.502-r1) targets commit `aeec0e4460ac4ab27d7e9e49ab5f9478692a4871`. Workflow run [32511984489](https://github.com/Ding-Ding-Projects/material-ffmpeg/actions/runs/32511984489) verified that release baseline and its earlier Pages deployment; the current documentation change requires its own later successful Pages deployment before it is live.

This article explains what a subsequent maintainer should verify before treating the current desktop application as released and operational.

## Behavior

The repository joins three implementation areas: the renderer and guided workflows, the trusted runtime and durable queue, and the dependency/build/release path. The Pages home was published before the complete application candidate was assembled. The source now includes runtime and renderer wiring, but evidence must follow the exact integrated commit that is built and released.

## Configuration

Important handoff records are:

- `HANDOFF.md` for the repository-level delivery boundary.
- `ROADMAP.md` for the current milestone.
- `dependencies.json` and `package-lock.json` for exact dependency identity.
- `resources/build-metadata.json` in a built package for the source commit.
- `.github/workflows/release.yml` for direct build, release, and Pages deployment.

Expected release assets are a setup executable, `RELEASES`, a full `.nupkg`, and `SHA256SUMS.txt`.

The internal trusted-runtime diagnostic records the exact flat executable layout: packaged builds resolve `process.resourcesPath/ffmpeg/ffmpeg.exe` and `process.resourcesPath/ffmpeg/ffprobe.exe`; development builds resolve `<repositoryRoot>/resources/ffmpeg/ffmpeg.exe` and `<repositoryRoot>/resources/ffmpeg/ffprobe.exe`. It has no `bin` fallback, no `PATH` search, and no caller-selected executable input. `src/runtime/safe-process.js` consumes this resolver and returns only bounded, path-free status metadata across the renderer boundary.

## Failure modes

A handoff is incomplete when it names a source commit that differs from the package metadata, reports a build without the corresponding artifacts, treats a workflow still running as successful, or describes a feature as working only because its controls exist. A release that lacks bundled FFmpeg/FFprobe, upstream license information, source metadata, or unsigned-state evidence is also incomplete.

## Security considerations

Never place credentials, tokens, selected local paths, media contents, or private user data in a handoff. Do not work around the unsigned packaging policy, and do not substitute a machine-installed FFmpeg for packaged-runtime proof.

## Verification state

At exact commit `5358582f13b6af418e58c1971747b270d308f34b`, the packaged application resolved bundled FFmpeg and FFprobe 9.0.1, completed and independently validated one real H.264/AAC conversion, inspected real media through FFprobe, and loaded 539 live codec entries. Three privacy-reviewed exact-byte captures were promoted with validated receipts. The completed-conversion and Inspector interactions remain verified through a path-redacted receipt, while their raw images are quarantined because the rendered interface exposed machine-local paths. [GitHub Actions run 32460503357](https://github.com/Ding-Ding-Projects/material-ffmpeg/actions/runs/32460503357) completed successfully and published [v0.1.22-r1](https://github.com/Ding-Ding-Projects/material-ffmpeg/releases/tag/v0.1.22-r1) for the same commit.

No tests, lint, static analysis, accessibility checks, or installer execution ran in this pass. The release asset list also lacks the separately required dim-sum image. Every workflow and universal feature without an exact interaction receipt remains unrun or not integrated in the feature ledger.

The GIF and thumbnail lane now has source wiring for native input/output selection, bounded persisted controls, typed FFmpeg argument construction, opaque-handle conversion, queue submission, and nonempty-output validation. The GIF and thumbnail interactions were not launched or captured, and no test, lint, type-check, static-analysis, accessibility, package-execution, or installer-execution verdict exists for that lane.

## Suggested articles

- [Roadmap](roadmap.md)
- [Feature status ledger](feature-ledger.md)
- [Updates and releases](update-release.md)
