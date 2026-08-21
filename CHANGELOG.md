# Changelog

## Unreleased

### Changed

- Restored the ZIP-supplied UI's complete contextual right-click routing and wired its existing menu actions to the trusted tab, registry, job, and appearance paths. The context-menu search now retains a usable text field, a compact regex button, bounded viewport placement, and reliable action hit testing.
- The desktop trim workflow now keeps its input and output behind opaque native-dialog handles, validates positive source ranges or durations, converts an absolute out point to an explicit clip duration, aligns the save filter with the chosen container, re-renders copy and re-encode controls when the mode changes, and reports a queued result only after the trusted queue returns a valid job identity.

### Verification

- Archive fidelity was verified across all 12 ZIP entries. Two focused Node regressions passed, the exact selector mutation turned red then green, and the freshly packaged Windows application was exercised on a hidden desktop: the menu search measured 172 px, the regex control 32 px, hit testing reached the Duplicate action, the duplicate tab appeared, and the menu dismissed.
- The ultra-speed delivery lane intentionally did not run tests, lint, type checks, reviews, audits, captures, installer execution, or runtime interaction for this source change.
