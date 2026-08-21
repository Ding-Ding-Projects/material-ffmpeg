# Roadmap

The active milestone is the first fully wired, packaged Windows release of material-ffmpeg.

## Behavior

Completed source milestones include preservation of the supplied design, the pinned official FFmpeg source reference, a checksum-pinned Windows runtime download, one-click build entry points, unsigned Squirrel.Windows packaging configuration, the responsive project site, trusted process wiring, job management, and renderer controls that call the preload API.

The FFmpeg GUI milestone reached exact-commit packaged interaction and publication at `5358582f13b6af418e58c1971747b270d308f34b`. The packaged application completed a real conversion, inspection, and live codecs query, and [GitHub Actions run 32460503357](https://github.com/Ding-Ding-Projects/material-ffmpeg/actions/runs/32460503357) published [v0.1.22-r1](https://github.com/Ding-Ding-Projects/material-ffmpeg/releases/tag/v0.1.22-r1).

The remaining milestone is fail-closed: complete the universal desktop surfaces and their exact interaction evidence, then repair the release asset inventory so it includes the separately required dim-sum image.

## Configuration

The authoritative checklist remains `ROADMAP.md`. Delivery scope is Windows x64. The first release line is `0.1.x`; automation derives a unique patch build from the workflow run number and attempt.

## Failure modes

The milestone is not complete if a feature is present only as markup, a queue operation has not reached the bundled executable, an output has not been independently observed, or a published asset is missing or empty. A successful Pages deployment does not prove the desktop package, and a successful package build does not prove UI interaction.

## Security considerations

Roadmap work must preserve the trusted process boundary, file-handle indirection, checksum-pinned dependency acquisition, and permanent no-signing policy. Broadening the preload API or accepting arbitrary executable paths is outside the intended architecture.

## Verification state

Source-wired and packaged/runtime-verified states are tracked separately in the feature ledger. The exact-commit GUI evidence includes three privacy-reviewed packaged-application captures plus path-redacted interaction receipts for the completed-conversion and Inspector states. Public replacement captures for those two states remain open because their raw images exposed machine-local paths. This documentation update does not run lint, tests, static analysis, accessibility checks, or installer execution. The release asset list remains incomplete because no dim-sum image is attached.

## Suggested articles

- [Feature status ledger](feature-ledger.md)
- [Architecture and trusted runtime boundary](architecture-runtime.md)
- [Handoff](handoff.md)
