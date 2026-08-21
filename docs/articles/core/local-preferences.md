# Local website preferences

Language, funny levels, emoji decoration, appearance, tab layout, attention-support modes, notifications, and a validated personal-vocabulary cache persist in this browser's local storage.

The five independent attention-support modes—Focus, Low stimulation, Time awareness, One thing at a time, and Momentum—are presentation aids only. They are off by default and are not medical tools, diagnoses, or treatment. Focused mode temporarily pauses them while preserving the choices for later restoration.

The personal-vocabulary upload accepts a bounded version-1 JSON object with string replacements. Invalid, oversized, unsafe, or unsupported data is rejected without partially applying it. Clearing the control removes the cache and restores shipped wording.

## Failure modes

Unavailable or corrupt stored data falls back to compiled defaults. The website never treats a missing preference as application state.

## Suggested articles

- [Website and installed application boundary](website-boundary.md)
- [Accessibility and navigation](accessibility-and-navigation.md)
