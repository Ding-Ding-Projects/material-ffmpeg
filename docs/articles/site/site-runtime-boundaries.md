# Website runtime boundaries

## Behavior

The GitHub Pages site is a local-first documentation and interaction surface. It provides browser-local language, tone, emoji, School, vocabulary, attention, schedule, tabs, regex search, appearance, logo, notifications, history, exports, bulk actions, locks, authenticator, Support Tickets, converter, and Ollama-equivalent panels where their browser capabilities are available. Optional modules register with the shared shell; an absent module is rendered as unavailable rather than silently treated as loaded.

## Configuration

Visitor preferences and feature state use versioned `localStorage`, `sessionStorage`, or IndexedDB records owned by the site. Plain-text search is the default; each search field owns its anchored regex-builder state. Clearing site data resets the browser-local records and does not touch a desktop installation or user media.

## Failure modes

- The site never runs FFmpeg or FFprobe, opens an operating-system application-data folder, reads a credential vault, or controls desktop jobs.
- Native file conversion, PDF tooling, external-editor handoff, Home Assistant, privileged Ollama control, and browser-extension messaging stay visibly unavailable when no safe browser boundary exists.
- A missing optional script or article produces an explicit unavailable state; no placeholder success is claimed.
- Browser storage loss or corruption falls back to shipped defaults and states what was reset.

## Security and privacy

Assets, scripts, fonts, and feature state are local to the published site. There is no account, analytics service, CDN dependency, remote vocabulary upload, or hidden network call. Browser toy locks and authenticator records are convenience features, not operating-system security; their secrets are not included in ordinary exports. The site is not an embedded substitute for the installed Windows application.

## Verification

The source defines the browser equivalents and explicit native gaps. Built-site interaction, offline behavior, accessibility, and real capture evidence remain unrun for this article until an exact published commit is exercised through the approved headless route.

## Suggested articles

- [Website and installed application boundary](../core/website-boundary.md)
- [Browser-only boundaries](../features/browser-boundaries.md)
- [Local website preferences](../core/local-preferences.md)
- [Accessibility and navigation](../core/accessibility-and-navigation.md)
