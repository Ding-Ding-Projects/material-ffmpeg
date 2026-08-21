# Changelog

## Unreleased

### Changed

- The desktop trim workflow now keeps its input and output behind opaque native-dialog handles, validates positive source ranges or durations, converts an absolute out point to an explicit clip duration, aligns the save filter with the chosen container, re-renders copy and re-encode controls when the mode changes, and reports a queued result only after the trusted queue returns a valid job identity.

### Verification

- The ultra-speed delivery lane intentionally did not run tests, lint, type checks, reviews, audits, captures, installer execution, or runtime interaction for this source change.
