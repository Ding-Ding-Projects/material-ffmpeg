# Updates and releases

Every push and manual dispatch runs the direct `Build, release, and deploy Pages` workflow.

## Behavior

The Windows job restores dependencies, assigns a unique `0.1.<run>` version, builds unsigned Squirrel.Windows artifacts, validates and collects release files, records the repository line count, writes measured release notes, publishes one non-draft release, and reads its identity and assets back. A dependent Ubuntu job deploys `docs/` to GitHub Pages.

## Configuration

The workflow is in `.github/workflows/release.yml` and runs on `push` and `workflow_dispatch`. Release credentials use the `RELEASE_TOKEN`, `ORG_TOKEN`, then `GITHUB_TOKEN` environment chain. Release assets must be nonempty and expose download URLs. Automation intentionally runs no lint, tests, type checking, static analysis, accessibility checks, or screenshots.

## Failure modes

Package creation, collection, release creation, release readback, or Pages deployment can fail independently. A queued or failed workflow is not release proof. Automatic update behavior is not yet implemented in the desktop runtime: Squirrel `RELEASES` metadata exists, but startup/background checks, download state, a ready banner, and restart-to-install are absent.

## Security considerations

Signing discovery is disabled and no certificate is requested. Releases are unsigned and may trigger Windows warnings. Workflow tokens remain in the GitHub environment and must never appear in files or logs.

## Verification state

The direct build-and-release workflow is present in source. No new workflow or release was dispatched by this documentation pass. Each run must be judged from its terminal state and published assets.

## Suggested articles

- [Build, installation, and dependencies](build-install-dependencies.md)
- [Handoff](handoff.md)
- [Feature status ledger](feature-ledger.md)
