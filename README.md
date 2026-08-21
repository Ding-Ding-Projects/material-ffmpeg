# material-ffmpeg

material-ffmpeg is a local Windows desktop interface for FFmpeg. It turns conversion, trimming, filtering, audio, GIF, thumbnail, streaming, inspection, and batch workflows into guided controls while keeping the exact FFmpeg command visible.

- [Project site](https://ding-ding-projects.github.io/material-ffmpeg/)
- [Releases](https://github.com/Ding-Ding-Projects/material-ffmpeg/releases)
- [Source](https://github.com/Ding-Ding-Projects/material-ffmpeg)

The supplied design is preserved under `design/source/`. Official FFmpeg source is pinned under `third_party/ffmpeg`; installed builds use a separately downloaded, checksum-verified FFmpeg 9.0.1 runtime.

## Build on Windows

```bat
download-dependencies.bat /s
build.bat /s
build-installer.bat /s
```

The scripts accept `/s`, `--silent`, or `SILENT=1`. They obtain the pinned Node.js toolchain, restore the exact npm lockfile, verify the FFmpeg archive SHA-256, generate the application icon, and build through the same unsigned Squirrel.Windows path used by automation.

`build.bat` produces a runnable unpacked application and optionally launches it. `build-installer.bat` produces and validates the setup executable, `RELEASES`, full `.nupkg`, bundled FFmpeg/FFprobe, upstream license evidence, source commit metadata, and SHA-256 values.

> **Unsigned software:** code signing is intentionally disabled. Windows may display an unknown-publisher or SmartScreen warning.

## Runtime and privacy

Media processing runs locally. The renderer cannot select an arbitrary executable or spawn a shell; the privileged process owns trusted FFmpeg resolution, job lifecycle, and bounded output delivery.

The runtime is pinned in `dependencies.json`. Generated dependencies, bundled binaries, caches, and build output are not committed.

## Release automation

Every push and manual dispatch builds one uniquely tagged, non-draft release and deploys `docs/` to GitHub Pages. The workflow builds and packages only; it intentionally runs no tests, lint, type checking, static analysis, accessibility checks, or screenshots.

The committed line counter is reproducible with `npm run count:lines`.

## Licensing

The application source is MIT licensed. FFmpeg is a separate GPLv3 project distributed under its own terms. See `THIRD_PARTY_NOTICES.md` and the upstream license/build-information files packaged beside the runtime.

<details>
<summary>Repository layout</summary>

- `src/` — application and trusted runtime boundary
- `resources/` — icon source and generated runtime destination
- `scripts/` — dependency, build, package, verification, and line-count tooling
- `docs/` — responsive GitHub Pages site
- `design/source/` — supplied design archive contents
- `third_party/ffmpeg` — pinned official source reference

</details>
