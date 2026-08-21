# Settings and preferences

The current renderer combines a frameless Material-style desktop shell with locally persisted presentation and workflow preferences.

## Behavior

The source includes dark and light themes, accent/font/scale/weight/radius appearance controls, app-logo presets and local image selection, a notification centre, command palette on `Ctrl+Shift+F`, regex builder, draggable dialogs, searchable select replacements, context-menu search, tab pinning/group labels/duplication/closing, and local presets.

Settings currently expose job parallelism, hardware preference, pass-log retention, and completion notifications. The renderer saves its UI state in local storage and reports unavailable runtime or bridge operations as visible errors.

## Configuration

Renderer state is stored under a versioned local-storage key. Appearance values are applied through CSS custom properties. The shipped window minimum is 960 by 640, with a default size of 1440 by 900. The application shell uses local CSS and does not load Google Fonts or a CDN.

## Failure modes

Corrupt local state falls back to shipped defaults. Clipboard, image decoding, runtime calls, catalog requests, and native dialogs can fail independently and should surface an error without inventing success. A persisted preference is not proof that every downstream FFmpeg option consumes it.

Some interface areas are partial: the appearance editor is not Word-depth, logo conversion does not yet expose the complete crop/fit/color pipeline, tab management does not yet implement the full four-search and docking contract, and the security-lock prototype does not provide vault-backed password/TOTP verification.

## Security considerations

Local storage is suitable for ordinary presentation preferences but not for secrets. The source contains a local hash-based lock prototype; it is not a security boundary and must not be presented as credential-vault protection. User-selected logo images must remain local and bounded before a release can claim full safe conversion.

## Verification state

The controls and persistence routes are present in source. No keyboard, screen-reader, narrow-width, high-scale, theme, or packaged interaction checks were run during this pass.

## Suggested articles

- [Privacy and security](privacy-security.md)
- [Feature status ledger](feature-ledger.md)
- [Jobs, queue, file registry, and commands](jobs-queue-commands.md)
