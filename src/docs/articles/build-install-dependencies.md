# Build, installation, and dependencies

The repository uses pinned, unattended Windows scripts and a direct GitHub Actions build-and-release workflow.

## Behavior

`download-dependencies.bat` restores pinned Node.js, exact npm packages, and the checksum-verified FFmpeg runtime. `build.bat` packages a runnable unpacked application and verifies its executable, `app.asar`, bundled FFmpeg/FFprobe, build metadata, commit identity, and executable hash. `build-installer.bat` creates unsigned Squirrel.Windows artifacts and invokes the release collector.

The local scripts use the same dependency preparation and packaging commands that automation calls. A release-specific article describes the direct workflow and current update boundary.

## Configuration

- Node.js: 22.18.0 Windows x64
- FFmpeg: 9.0.1 full Windows x64 archive with pinned SHA-256
- Electron: 33.4.11
- electron-builder and Squirrel target: 26.15.3
- Signing: disabled in package configuration and workflow environment
- Release checks: build, package collection, asset identity, nonzero assets, and download URLs

The build paths intentionally do not add lint or test suites to automation.

## Failure modes

Dependency download, checksum, extraction, npm restore, icon generation, metadata generation, package creation, bundled-runtime presence, commit identity, unsigned-state validation, release creation, asset readback, or Pages deployment can fail independently. A workflow failure means no successful release should be claimed. Pages depends on the build-and-release job, so a packaging failure prevents that workflow's site deployment.

## Security considerations

The scripts pin versions and hashes, suppress signing discovery, and never request signing credentials. Releases are unsigned and can trigger Windows warnings. Workflow credentials are supplied only through GitHub's token environment chain and are not committed. Build evidence uploads are bounded to declared artifact paths.

## Verification state

The scripts and workflow are present in source. This documentation pass does not run a package build or inspect a new release. Each workflow run and release must be judged by its own terminal status and published assets.

## Suggested articles

- [License and third-party software](licensing-notices.md)
- [Updates and releases](update-release.md)
- [Handoff](handoff.md)
- [Feature status ledger](feature-ledger.md)


