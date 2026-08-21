# Release and installer trust

The website exposes a direct installer download only after an immutable Windows release asset is verified. Until then it links to release history and describes the installer as pending.

Windows installers are unsigned by policy and may trigger an unknown-publisher warning. Release notes, checksums, exact commits, and downloadable assets are the public evidence source.

Static Open Graph metadata references the local `assets/social-preview.png` path. The Status page reports that asset as pending until its owning local module registers it; metadata is never injected at runtime.

## Suggested articles

- [Website and installed application boundary](website-boundary.md)
- [Accessibility and navigation](accessibility-and-navigation.md)
