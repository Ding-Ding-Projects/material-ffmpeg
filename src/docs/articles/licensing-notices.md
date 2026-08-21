# License and third-party software

material-ffmpeg source is distributed under the MIT License. Bundled FFmpeg and the JavaScript build toolchain remain separate third-party works under their own licenses.

## Behavior

The application package includes `ffmpeg.exe` and `ffprobe.exe` from the pinned FFmpeg 9.0.1 Windows x64 full build. Packaging is configured to carry upstream license and build-information evidence beside those executables. The official FFmpeg source reference is pinned under `third_party/ffmpeg`.

## Configuration

- Application license: `LICENSE`
- Third-party summary: `THIRD_PARTY_NOTICES.md`
- Runtime identity and checksum: `dependencies.json`
- Exact JavaScript packages and integrity: `package-lock.json`
- Runtime packaging destination: `resources/ffmpeg/`

The selected full FFmpeg build is documented as GPLv3. Electron, electron-builder, electron-builder-squirrel-windows, 7zip-bin, and their transitive packages retain their individual terms.

## Failure modes

Packaging must stop if the runtime archive checksum does not match, required license/build-information files are absent, or the expected runtime executables cannot be found. The application MIT license must never be presented as relicensing FFmpeg.

## Security considerations

Dependency identity is pinned and downloaded from declared upstream locations. Generated archives, executables, dependency directories, and caches are excluded from Git. Code signing is intentionally disabled; release copy must state that Windows can show an unknown-publisher or SmartScreen warning.

## Verification state

The license texts, manifest, lockfile, and packaging assertions are present in source. Their inclusion in a particular installer is verified only by inspecting the artifacts produced from that commit. No installer was built during this documentation pass.

## Suggested articles

- [Build, installation, and dependencies](build-install-dependencies.md)
- [Privacy and security](privacy-security.md)
- [Design reference provenance](design-provenance.md)


