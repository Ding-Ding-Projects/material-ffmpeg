# Roadmap

The active milestone is the first fully wired, packaged Windows release of material-ffmpeg.

## Behavior

Completed source milestones include preservation of the supplied design, the pinned official FFmpeg source reference, a checksum-pinned Windows runtime download, one-click build entry points, unsigned Squirrel.Windows packaging configuration, the responsive project site, trusted process wiring, job management, and renderer controls that call the preload API.

The remaining release milestone is evidence-driven: integrate every implementation lane, build the exact commit, exercise the real packaged application with the bundled runtime, publish one direct build-and-release result, and update the site with the verified release and captures.

## Configuration

The authoritative checklist remains `ROADMAP.md`. Delivery scope is Windows x64. The first release line is `0.1.x`; automation derives a unique patch build from the workflow run number and attempt.

## Failure modes

The milestone is not complete if a feature is present only as markup, a queue operation has not reached the bundled executable, an output has not been independently observed, or a published asset is missing or empty. A successful Pages deployment does not prove the desktop package, and a successful package build does not prove UI interaction.

## Security considerations

Roadmap work must preserve the trusted process boundary, file-handle indirection, checksum-pinned dependency acquisition, and permanent no-signing policy. Broadening the preload API or accepting arbitrary executable paths is outside the intended architecture.

## Verification state

Source-wired and packaged/runtime-verified states are tracked separately in the feature ledger. This documentation update does not run lint, tests, or screenshots.

## Suggested articles

- [Feature status ledger](feature-ledger.md)
- [Architecture and trusted runtime boundary](architecture-runtime.md)
- [Handoff](handoff.md)
