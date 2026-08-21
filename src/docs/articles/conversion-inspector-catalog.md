# Conversion, inspector, and runtime catalogs

The inspector and catalog surfaces derive their data from the bundled FFprobe and FFmpeg executables rather than from hard-coded capability lists.

## Behavior

The renderer provides guided conversion, trimming, filtergraph, audio, GIF, thumbnail, HLS, command-composer, preset, and batch-converter surfaces. Typed builders produce argument arrays for trusted execution. The filtergraph surface keeps video and audio nodes in separate ordered chains, provides per-filter guided controls, and queues only node kinds, names, and option objects accepted by the builder allowlist. GIF output uses one in-memory palette-generation and palette-use graph; per-frame palette statistics also enable a new palette for each frame. Thumbnail output seeks to one selected timestamp and limits the job to one JPEG or PNG still rather than routing a single save destination through a sequence workflow. The batch converter currently maps verified media inputs to MP4, MKV, WebM, MP3, FLAC, WAV, PNG, and JPEG adapters.

The inspector opens a user-selected media file, requests structured FFprobe JSON, displays format and stream information, and can export that exact in-memory inspection snapshot through a user-selected destination. Export does not run a second probe whose result could differ from the data on screen. The renderer derives its audio-stream picker from inspected streams.

JSON export preserves the nested FFprobe object. CSV and XML use the same documented row-per-node representation: each record carries an RFC 6901 JSON Pointer path, a value type, and a scalar value where applicable. Container rows preserve objects and arrays, so the formats do not pretend nested media metadata is a simple one-row table. All three formats are UTF-8 and fail when serialized output would exceed 32 MiB. XML additionally fails with a visible explanation when a value contains a character XML 1.0 cannot represent; JSON or CSV remains available for that snapshot.

Runtime catalogs list codecs, formats, protocols, bitstream filters, devices, filters, and hardware accelerators. Component help supports encoders, decoders, filters, muxers, demuxers, protocols, and bitstream filters. The option-guides layer combines static, bounded guidance with runtime-derived help while keeping those sources distinguishable.

## Configuration

Codec, container, quality, dimensions, frame rate, filters, loudness, GIF, thumbnail, streaming, and adapter values are stored in renderer state. Filtergraph state is bounded to 64 nodes and normalized to the current video/audio filter catalog when it is loaded. Node order persists locally, and reordering operates within the selected stream chain. GIF controls cover start, duration, frame rate, width and aspect-preserving height, scaler, palette size, palette statistics, dither, bounded Bayer scale, and loop count. Thumbnail controls cover timestamp, JPEG or PNG, width and aspect-preserving height, scaler, and JPEG quality. The typed builders enforce the authoritative numeric, time, enum, and output-pattern bounds before enqueueing. Presets persist locally and are bounded to 200 records.

Catalog queries use fixed FFmpeg argument sets and a five-minute in-memory cache. Inventory output is bounded to 16 MiB and 30 seconds; help is bounded to 4 MiB and 20 seconds; version output is bounded to 256 KiB and 10 seconds. Component names accept a restricted token format.

## Failure modes

Builders reject unknown fields, unsupported enumerations, conflicting trim values, filter nodes combined with stream copy, malformed stream selectors, oversized collections, out-of-range filter options, disallowed sequence patterns, a non-GIF GIF destination, and a still destination whose extension does not match the selected JPEG or PNG format. The filtergraph builder does not accept raw graph text or a complex-graph override. Single-still mode always limits output to one frame and rejects a conflicting count. A valid argument vector can still fail for a particular media input or bundled-runtime capability.

Missing FFprobe, malformed JSON, oversized output, timeouts, unsupported catalog/help kinds, invalid names, empty runtime results, and expired file handles are reported rather than replaced with mock data. Probe exports fail if the destination handle is not an output handle, the format is unsupported, the bounded inspection snapshot is no longer available, serialization exceeds 32 MiB, or XML cannot faithfully represent a value.

## Security considerations

Conversion uses opaque handles and structured arrays rather than renderer paths or shell strings. The renderer cannot select an arbitrary executable.

Inputs and export destinations are opaque handles created by native dialogs. Filtergraph nodes compile into one `-vf` value and one `-af` value from fixed filter and option allowlists; user-entered shell commands, executable choices, file paths, and raw filtergraph separators are not accepted. The renderer cannot supply a destination path or arbitrary export payload: the trusted main process retains the bounded inspection snapshot, resolves the output handle, serializes the selected allowlisted format, and writes atomically. At most 64 inspection snapshots are retained in memory. Catalog commands are selected from fixed allowlists. Help names are bounded and validated before becoming an argument. Display code limits result counts and text lengths before inserting content.

## Verification state

Source wiring connects the visual-output cards and typed filtergraph lanes to native input and output selection, typed argument construction, opaque-handle conversion, and the durable job queue. Source inspection also confirms the snapshot-bound Inspector export route and its serialization bounds. This ultra-speed pass ran no tests, lint, type checks, static analysis, accessibility checks, captures, package execution, live GIF, thumbnail, or filtergraph job, media probe, catalog enumeration, help lookup, or export. The source routes are present; packaged, runtime, and visual behavior remain unverified.

## Suggested articles

- [Architecture and trusted runtime boundary](architecture-runtime.md)
- [Jobs, queue, file registry, and commands](jobs-queue-commands.md)
- [Privacy and security](privacy-security.md)


