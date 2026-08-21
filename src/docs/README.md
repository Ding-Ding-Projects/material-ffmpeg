# Packaged offline documentation bundle

This directory is the desktop application's read-only documentation payload. It is bundled under `src/` so packaged builds can open the same factual project, runtime, delivery, privacy, security, and accessibility articles without a network connection.

## Contract

The privileged boundary validates `manifest.json` and article paths, enforces the recorded size limits, and exposes only four narrow injected operations: `getManifest()`, `readArticle(id)`, `copyText(text)`, and `exportArticle({ id, title, markdown })`. The renderer never receives a general file reader or process launcher.

Links beginning with `doc:` and the relative source paths listed in `linkMap` resolve inside the browser. Unknown or malformed links remain text and report an honest unavailable state.

## Source and updates

The article copies were derived from `docs/articles/project/*.md` and their public metadata in `docs/articles/index.json`. The manifest records the source path, byte count, and SHA-256 of every bundled copy so an integration lane can reject drift rather than silently omit a document.

No network, remote font, CDN, analytics, private vocabulary payload, user file, credential, or media content belongs in this bundle.


