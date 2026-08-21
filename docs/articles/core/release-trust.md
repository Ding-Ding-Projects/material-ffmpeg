# Release and installer trust

The website exposes a direct installer download only after an immutable Windows release asset is verified. Until then it links to release history and describes the installer as pending.

Windows installers are unsigned by policy and may trigger an unknown-publisher warning. Release notes, checksums, exact commits, and downloadable assets are the public evidence source.

Static Open Graph metadata references `assets/social-preview.png`, a real 1440×900 packaged-application capture. The versioned website asset is byte-identical to the root `social-preview.png` master with SHA-256 `8b2a7fda2dbfd15480ed3f8de0037c9f6ae229c83a7e4405e689dc8b300002a2`; metadata is present in source HTML and is never injected at runtime. Live anonymous availability remains unverified until the documentation commit's own Pages deployment succeeds and the exact public image URL returns 2xx. The separate GitHub repository social-preview setting still requires a manual upload because the supported CLI does not expose that setting.

## Suggested articles

- [Website and installed application boundary](website-boundary.md)
- [Accessibility and navigation](accessibility-and-navigation.md)
