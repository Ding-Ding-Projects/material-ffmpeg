# Focus and attention modes

## Behavior

The website offers five independent, locally persisted attention supports:

1. **Low stimulation** reduces nonessential motion, color intensity, and notification frequency without hiding factual status.
2. **Time awareness** shows the current time and timestamps for state changes, scheduled rules, notifications, and history entries.
3. **One thing** keeps one selected task visible across reloads and collapses unrelated panels until the user deliberately expands them.
4. **Momentum** keeps a lightweight progress streak and offers a bounded snooze instead of silently dismissing an unfinished task.
5. **Focus styling** lets the user select a visible target and apply high-contrast outline, spacing, and emphasis without changing its action.

The modes can be combined. Reduced-motion preferences from the operating environment always take priority over animated presentation.

## Configuration

Each mode has its own switch in the settings panel and is indexed by the command palette. One Thing stores only the selected local label and completion state. Momentum stores its snooze-until timestamp and completed-step count. Focus Styling stores a stable element identifier and visual values.

## Failure modes

- A removed focus target is reported as unavailable and the stored choice is retained for possible restoration.
- An expired Momentum snooze returns the task to the active state; it never marks the task complete.
- Invalid or stale timestamps are discarded and replaced by an explicit local state message.
- Low Stimulation never suppresses errors, warnings, or the factual text of a notification.

## Security and privacy

The modes use browser-local state only. No task title, timestamp, focus target, or streak is transmitted.

## Verification

The inventory covers independent persistence, combination behavior, reduced-motion precedence, timestamp accuracy, One Thing reload behavior, Momentum snooze expiry, and focus-target recovery.

## Suggested articles

- [Notifications, schedules, and history](notifications-schedules-history.md)
- [Appearance and app logo](appearance-and-logo.md)
- [Accessibility and responsive behavior](accessibility-and-responsive-layout.md)
