# Browser-only boundaries

## What works locally on the website

The static website can persist visitor preferences, tabs, groups, appearance, local image previews, notification history, schedules, focus modes, toy locks, authenticator entries, local tickets, and redacted history in browser storage. It can generate structured text exports, run bounded in-browser search and regex matching, and demonstrate interaction flows.

## What the website does not claim

The static website does not execute FFmpeg or FFprobe, inspect local media without a user-selected file, install or update the desktop application, read an operating-system credential vault, open an application-data directory, start an external editor, publish to a source forge, control Ollama, call Home Assistant, receive browser-extension messages, create a real archive or installer, or provide a security boundary.

Controls for those capabilities remain visible when useful, but are disabled with the missing installed boundary and the next supported route stated. There are no fake success states, mock API responses, hidden network calls, or inferred capabilities.

## Storage and reset

Visitor-owned state uses versioned browser storage. Clearing site data resets all local preferences, locks, authenticator entries, custom logo bytes, notifications, tickets, and history. The website never claims that this is equivalent to the desktop application's operating-system credential storage or local application-data repository.

## Network and third parties

The interactive feature layer loads no CDN code, remote font, analytics library, or third-party asset. The release and source links are ordinary visitor-initiated navigation. A feature that needs a privileged network boundary stays unavailable on the static site.

## Verification

The hand-written inventory records each implemented browser equivalent, its persistence key, documentation, interaction evidence, and capture evidence. A negative regression check must fail when a required registration, article, control, persistence path, or evidence record is removed.

## Suggested articles

- [Local locks, authenticator, and Support Tickets](locks-authenticator-support.md)
- [Download handoff surfaces](download-handoff.md)
- [Accessibility and responsive behavior](accessibility-and-responsive-layout.md)
