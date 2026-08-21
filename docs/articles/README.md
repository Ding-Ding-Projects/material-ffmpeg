# Documentation article source

This directory is the source of the documentation browser published with the project site. `index.json` is the hand-written catalog; every listed Markdown file is loaded locally by `docs/assets/docs-browser.js` and rendered without a CDN, analytics, or an external fallback.

Each feature article records behavior, configuration, failure modes, security considerations, verification state, and suggested related articles. Missing files remain visible as unavailable entries rather than being replaced by invented content.

The browser uses plain-text search by default and exposes an adjacent JavaScript regular-expression builder. Search queries and article content stay in the browser. The selected article can be copied or exported as UTF-8 Markdown.

## Suggested articles

- [Project overview](project/project-overview.md)
- [Feature verification ledger](project/feature-ledger.md)
- [Privacy and security](project/privacy-security.md)
