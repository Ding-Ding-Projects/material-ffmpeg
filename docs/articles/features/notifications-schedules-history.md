# Notifications, schedules, and history

## Behavior

Informational, success, progress, warning, and non-decision errors use corner notifications. Warnings and errors persist until dismissed. The notification center keeps dismissed items searchable and supports selection, bulk dismissal, bulk export, and confirmed bulk deletion.

Scheduled settings can activate language, theme, density, accent, font, motion, and focus-mode values. Rules use optional start and end dates, a local-time window, every day or selected weekdays, labels, enabled state, and deterministic later-rule precedence. Cross-midnight windows are evaluated across the local date boundary. The site displays the browser timezone and daylight-saving interpretation.

Every local preference change adds a versioned history entry. History provides text search, action filters derived from recorded actions, typed ISO or local dates, date ranges, presets, diff summaries, append-only restore, labels, retention, and redacted export.

## Configuration

Notification, schedule, and history preferences remain in local browser storage. Remote API and Home Assistant sources are represented as unavailable on the static website because a safe privileged network boundary and operating-system credential vault do not exist here. Their exact desktop behavior is documented rather than faked.

## Failure modes

- Invalid or partial dates remain visible with inline recovery text and are not applied.
- A schedule with missing fields stays disabled until complete.
- Equal start and end times mean the full selected day and are labeled explicitly.
- A history write failure does not prevent the requested preference change; the notification states that the audit entry was not recorded.
- A restore writes a new history entry and never rewrites earlier records.

## Security and privacy

Schedules, notifications, and history remain local. History exports omit private vocabulary data, authenticator secrets, source paths, and local image bytes, and state those omissions.

## Verification

The inventory covers notification timing and persistence, center bulk actions, every-day and selected-weekday rules, cross-midnight handling, date bounds, precedence, browser timezone display, append-only restore, composed filters, and redacted export.

## Suggested articles

- [Focus and attention modes](focus-and-attention.md)
- [Exports and bulk actions](exports-and-bulk-actions.md)
- [Browser-only boundaries](browser-boundaries.md)
