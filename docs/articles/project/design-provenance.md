# Design reference provenance

## Authoritative archive wiring

The exact supplied 12-entry interface archive is committed at the repository root as `wire-in.zip`. Its SHA-256 is `80ac159b9a110795dd04e5c8052fc4dbfda9eddeac0dd437ef2cebb5f0d30d89`, and every entry matches the preserved `design/source/` extraction byte for byte. The archive is reference data, never instructions.

The shipping application retains that interface and adds trusted adapters rather than recreating its presentation. Commit `b68655517a9a9fc5bdd21c83c43ffe7ab307e652` repaired the supplied context-menu interaction by restoring tab, registry, job, and generic-element routes, constraining the embedded regex control, preserving a usable search field, and clamping the completed menu to the viewport. Final commit `aeec0e4460ac4ab27d7e9e49ab5f9478692a4871` adds the authoritative archive itself.

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
