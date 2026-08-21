# Handoff

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

The prior speed handoff explicitly recorded no lint, tests, accessibility checks, screenshots, package build, or installer execution. This repair performed source inspection and directly invoked the previously packaged flat-layout FFmpeg and FFprobe binaries, both of which reported version 9.0.1. It did not build a new package, interact with the packaged application, or take a screenshot. The release candidate, packaged runtime interaction, and public assets require independent verification at the final integrated commit.

## Suggested articles

- [Roadmap](roadmap.md)
- [Feature status ledger](feature-ledger.md)
- [Updates and releases](update-release.md)
