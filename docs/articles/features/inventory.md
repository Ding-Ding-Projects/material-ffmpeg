# Website feature inventory

This hand-written inventory names the interactive website contracts. Implementation and documentation are tracked separately from later built-site interaction and real capture evidence. A row marked pending is not considered verified.

| Feature | Browser implementation | Documentation | Persistence | Interaction proof | Capture evidence |
|---|---|---|---|---|---|
| Language: English, Cantonese, bilingual | Shared core preferences and feature copy adapter | Accessibility and responsive behavior | Versioned site preferences | Pending | Pending |
| Independent tone levels | Shared core preference controls | Accessibility and responsive behavior | Versioned site preferences | Pending | Pending |
| Dialog emoji preference | Shared core preference control | Accessibility and responsive behavior | Versioned site preferences | Pending | Pending |
| School mode browser equivalent | Shared core preference boundary | Browser-only boundaries | Versioned site preferences | Pending | Pending |
| Local personal-vocabulary upload | Shared core bounded upload | Browser-only boundaries | Validated browser cache | Pending | Pending |
| Narration and voice controls | Shared core browser speech surface | Accessibility and responsive behavior | Versioned site preferences | Pending | Pending |
| Five focus and attention modes | Feature workspace settings and state | Focus and attention modes | Versioned feature state | Pending | Pending |
| Scheduled settings | Feature schedule editor | Notifications, schedules, and history | Versioned feature state | Pending | Pending |
| Notifications and center | Feature toasts and notification list | Notifications, schedules, and history | Versioned feature state | Pending | Pending |
| Dim-sum startup draw | Feature startup draw with honest offline-photo boundary | Browser-only boundaries | One draw per page load | Pending | Pending |
| Anchored regex builders | Shared core plus feature search adapters | Exports and bulk actions | Per-field feature state | Pending | Pending |
| Appearance and every-element editor | Feature context menu and editor | Appearance and app logo | Versioned feature state | Pending | Pending |
| Continuous color picker and translator | Feature appearance editor | Appearance and app logo | Versioned feature state | Pending | Pending |
| App-logo customization | Feature local logo editor | Appearance and app logo | Bounded browser image cache | Pending | Pending |
| Tabs, groups, pinning, docking, four searches | Shared core navigation | Accessibility and responsive behavior | Versioned site preferences | Pending | Pending |
| Command palette | Shared core command registry | Accessibility and responsive behavior | Versioned site preferences | Pending | Pending |
| Two-key destructive confirmation | Feature confirmation component | Exports and bulk actions | Ephemeral action state | Pending | Pending |
| Local history and append-only restore | Feature history manager | Notifications, schedules, and history | Versioned feature state | Pending | Pending |
| Changelog with dates and commit links | Feature changelog surface | Notifications, schedules, and history | Filter state only | Pending | Pending |
| Structured exports | Feature export registry | Exports and bulk actions | None after download | Pending | Pending |
| Bulk actions | Feature lists and previews | Exports and bulk actions | Versioned feature state | Pending | Pending |
| Toy locks on rendered elements | Feature security component | Local locks, authenticator, and Support Tickets | Versioned local lock records | Pending | Pending |
| TOTP authenticator | Feature security component | Local locks, authenticator, and Support Tickets | Browser-local secret records | Pending | Pending |
| Support Tickets | Feature security component | Local locks, authenticator, and Support Tickets | Versioned local tickets | Pending | Pending |
| Download start/progress/complete surfaces | Feature download simulator | Download handoff surfaces | Ephemeral simulated queue | Pending | Pending |
| Draggable/resizable panels | Feature floating panels | Accessibility and responsive behavior | Versioned panel geometry | Pending | Pending |
| Context-menu shortcut display | Feature context menu | Accessibility and responsive behavior | None | Pending | Pending |
| Collapsible filters/statistics | Feature list controls | Exports and bulk actions | Versioned feature state | Pending | Pending |
| Local file converter | Media module | Browser-only boundaries | Module-specific local state | Pending | Pending |
| Local Ollama manager | Media/AI module | Browser-only boundaries | Module-specific local state | Pending | Pending |

No row may be marked verified from source presence alone. Interaction proof must exercise the built website, and capture evidence must be a real capture of that built commit.
