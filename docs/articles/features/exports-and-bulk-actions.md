# Exports and bulk actions

## Behavior

Local records can be selected with pointer, range, and keyboard controls. Select-all states whether it applies to the visible page or every current match. Inverse selection is available. Before a bulk mutation, the site reports selected, eligible, skipped, and affected counts and provides a reviewable preview.

The export registry offers each format only when it can preserve the complete selected shape. Structured records support JSON, JSONL/NDJSON, YAML, TOML, XML, Markdown, HTML, CSV, TSV, SQL, TypeScript/JavaScript, Python, Go, Rust, JSON Schema, and Protobuf representations where faithful. Every export states UTF-8 encoding, line-ending behavior, schema version, and any omitted private fields before download.

ZIP, 7z, PDF, media, spreadsheet, and other binary conversion formats require a bundled converter in the installed application. The static website does not pretend to create those formats. It exposes them as unavailable with the missing browser capability named.

## Configuration

Search and filters compose with selection. Plain text is the default; each search has its own adjacent regex builder with raw pattern, guided literals/classes/anchors/groups/alternation/quantifiers, flags, sample text, syntax feedback, live matches, and capture groups.

## Failure modes

- Empty queries and invalid patterns cannot trigger bulk close or mutation.
- A format that would drop a field is disabled or requires an explicit pre-export omission review.
- Failed items remain selected and are reported separately from successful items.
- A cancelled operation reports completed, skipped, cancelled, and failed records independently.

## Security and privacy

Evaluation and export happen locally with bounded pattern and sample sizes. Secrets, credentials, private vocabulary values, local image bytes, and internal browser paths are excluded from ordinary export.

## Verification

The inventory covers selection scope, inverse selection, preview counts, partial results, cancellation, text and regex matching, supported structured formats, omission disclosure, and unavailable binary formats.

## Suggested articles

- [Notifications, schedules, and history](notifications-schedules-history.md)
- [Local locks, authenticator, and Support Tickets](locks-authenticator-support.md)
- [Browser-only boundaries](browser-boundaries.md)
