# Website and installed application boundary

This GitHub Pages surface is a documentation website. It does not run FFmpeg, inspect local media, control application jobs, or access the operating system.

The installed Windows application owns native file selection, FFmpeg and FFprobe execution, output validation, job progress, cancellation, and local application data. Website preferences are separate browser-local state.

## Failure modes

- If an optional documentation module is absent, the website shows an unavailable state instead of claiming its records loaded.
- If a verified immutable installer is unavailable, the Home page does not show a direct download.
- Clearing site storage resets website preferences only; it does not alter application data or media.

## Security and privacy

The website uses no analytics, remote fonts, CDN scripts, or account. Local file controls parse data in the browser and do not upload it.

## Suggested articles

- [Local website preferences](local-preferences.md)
- [Accessibility and navigation](accessibility-and-navigation.md)
- [Release trust](release-trust.md)
