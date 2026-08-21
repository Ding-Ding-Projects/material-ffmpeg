# Handoff

## Delivery lane

- GitHub Pages home: commit `b110674b715e895a0aaf747c4556c749ed56ef12`.
- Runtime archive: FFmpeg 9.0.1 full Windows x64, pinned by URL and SHA-256 in `dependencies.json`.
- Toolchain: Node.js 22.18.0 Windows x64 and `7zip-bin` 5.2.0 are pinned through the manifest and package lock.
- Packaging: unsigned Squirrel.Windows with generated multi-resolution icon, bundled FFmpeg/FFprobe, upstream license/build information, and source-commit metadata.
- Manual entry points: `download-dependencies.bat`, `build.bat`, and `build-installer.bat`.
- Automation: every push or manual dispatch builds, publishes a unique non-draft release, and deploys `docs/`.

## Verification boundary

This speed pass intentionally did not run tests, lint, reviews, accessibility checks, screenshots, a package build, or installer execution. The scripts and workflow contain file, version, checksum, package-content, commit, and unsigned-state assertions; those assertions become evidence only when the corresponding build completes successfully.

## Latest release attempt

GitHub Actions run `32456646436` (commit `b4a69531e66549b8fff7d0a2b7249611deb157e7`, 2026-08-21) built and collected the unsigned release assets, then failed in `Write measured release notes` with `Error formatting a string: Format specifier was invalid.` The release-publication, release-verification, and Pages jobs were skipped, so no release or published installer was produced by this run.

## Expected release assets

- `material-ffmpeg-setup-<version>.exe`
- `RELEASES`
- `material-ffmpeg-<version>-full.nupkg`
- `SHA256SUMS.txt`

Integrate the trusted runtime and renderer wiring before selecting the release candidate. Build against that exact commit and use the terminal workflow evidence as the release verdict.
