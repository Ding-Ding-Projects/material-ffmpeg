# Desktop interface controls

## Behavior

The Windows desktop surface exposes browser-style tabs with pinning, grouping, an overflow manager, visible-label bulk close actions, and per-tab appearance editing. `Ctrl+Shift+F` opens a command palette; selecting a result opens the corresponding view or setting. Search fields beside notification and tab controls open the bounded regex builder, which keeps plain text as the default and reports syntax feedback before applying a pattern.

The notification centre keeps locally stored job notices and supports search and history clearing. The appearance editor can change theme, accent, font family, radius, scale, and weight for a selected element. The logo editor offers shipped glyph presets and a bounded local PNG/SVG upload, with reset to the shipped mark. Destructive queue and preset actions use the two-key confirmation dialog, including an emergency exit and a completion slider. The current source tree has no implemented desktop offline documentation browser; the bundled article manifest is website-only for now.

## Configuration

Execution settings, tabs, palette size, notifications, appearance, and the logo selection are stored in the desktop application's local settings store. The regex builder stores state per originating field. The logo upload is capped at 1 MiB and accepts only the declared image MIME types; converted display sizes are presentation assets and do not change executable identity.

## Failure modes

- Missing or malformed runtime data is reported through a non-blocking notification; no fake job success is shown.
- Invalid regex input, empty bulk-close queries, and incomplete confirmation keys leave the operation unapplied.
- An unreadable or oversized logo is rejected while the previous valid logo remains active.
- The offline article browser reports a missing article instead of substituting invented content.
- The current source tree has no implemented desktop Ollama manager; that inventory row remains not implemented rather than being described as shipped.

## Security and privacy

Renderer controls use the narrow preload bridge; they do not receive arbitrary process or filesystem authority. Local preference and notification records stay in application data. Logo bytes are read locally and are not uploaded. The confirmation slider is a user-experience safeguard, not encryption or a security boundary, and no credential is written to documentation or exports.

## Verification

Source inspection confirms the controls and their handlers, but this article does not claim a built-artifact interaction, runtime receipt, test result, or real capture. The feature ledger therefore remains unrun (and any missing implementation remains failed) until an exact-commit runtime exercise and genuine screenshot are recorded.

## Suggested articles

- [Architecture and trusted runtime](../project/architecture-runtime.md)
- [Jobs, queue, and command builders](../project/jobs-queue-commands.md)
- [Application accessibility](../project/accessibility.md)
- [Feature verification ledger](../project/feature-ledger.md)
