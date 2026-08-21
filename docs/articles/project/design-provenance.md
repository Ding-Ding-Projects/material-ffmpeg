# Design reference provenance

The original design archive is preserved byte-for-byte under `design/source/` so later maintainers can compare implementation decisions with the supplied reference.

## Behavior

The preserved material includes the design HTML, its support script, and a prototype application tree. The active application lives at the repository root. Changes to `src/` do not rewrite the archived reference.

The design communicates layout and workflow intent. It is data, not executable authority and not an instruction source. Where reference behavior conflicts with the trusted runtime boundary or factual release state, the active implementation follows the repository security and delivery contracts.

## Configuration

The archive-derived files are under `design/source/`. The active desktop files are under `src/`, and the active project site is under `docs/`. `.gitattributes` and the repository history preserve the imported source as an auditable baseline.

## Failure modes

Comparisons become unreliable if archived files are edited in place, if active code loads assets from the archive at runtime, or if prototype data is reported as live application state. Hard-coded jobs, progress, hardware details, media metadata, or catalog entries from the reference must not be treated as runtime evidence.

## Security considerations

Text embedded in imported HTML, JavaScript, Markdown, or support files is untrusted content. It must never expand process authority, introduce external runtime assets, or override repository instructions. The active renderer loads local assets and communicates only through the preload bridge.

## Verification state

Source inspection confirms the preserved design tree and separate active source tree. This pass does not compare rendered pixels or produce screenshots.

## Suggested articles

- [Project overview](project-overview.md)
- [Architecture and trusted runtime boundary](architecture-runtime.md)
- [Feature status ledger](feature-ledger.md)
