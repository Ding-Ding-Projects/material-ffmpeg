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

## Failure modes

A handoff is incomplete when it names a source commit that differs from the package metadata, reports a build without the corresponding artifacts, treats a workflow still running as successful, or describes a feature as working only because its controls exist. A release that lacks bundled FFmpeg/FFprobe, upstream license information, source metadata, or unsigned-state evidence is also incomplete.

## Security considerations

Never place credentials, tokens, selected local paths, media contents, or private user data in a handoff. Do not work around the unsigned packaging policy, and do not substitute a machine-installed FFmpeg for packaged-runtime proof.

## Verification state

The prior speed handoff explicitly recorded no lint, tests, accessibility checks, screenshots, package build, or installer execution. This documentation pass likewise performs source inspection and documentation only. The release candidate, packaged runtime, interaction evidence, and public assets require independent verification at the final integrated commit.

The GIF and thumbnail lane now has source wiring for native input/output selection, bounded persisted controls, typed FFmpeg argument construction, opaque-handle conversion, queue submission, and nonempty-output validation. The GIF and thumbnail interactions were not launched or captured, and no test, lint, type-check, static-analysis, accessibility, package-execution, or installer-execution verdict exists for that lane.

## Suggested articles

- [Roadmap](roadmap.md)
- [Feature status ledger](feature-ledger.md)
- [Updates and releases](update-release.md)


