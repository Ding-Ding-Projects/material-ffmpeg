# Conversion, inspector, and runtime catalogs

The inspector and catalog surfaces derive their data from the bundled FFprobe and FFmpeg executables rather than from hard-coded capability lists.

## Behavior

The renderer provides guided conversion, trimming, filtergraph, audio, GIF, thumbnail, HLS, command-composer, preset, and batch-converter surfaces. Typed builders produce argument arrays for trusted execution. GIF output uses one in-memory palette-generation and palette-use graph; per-frame palette statistics also enable a new palette for each frame. Thumbnail output seeks to one selected timestamp and limits the job to one JPEG or PNG still rather than routing a single save destination through a sequence workflow. The batch converter currently maps verified media inputs to MP4, MKV, WebM, MP3, FLAC, WAV, PNG, and JPEG adapters.

The inspector opens a user-selected media file, requests structured FFprobe JSON, displays format and stream information, and can export that exact in-memory inspection snapshot through a user-selected destination. Export does not run a second probe whose result could differ from the data on screen. The renderer derives its audio-stream picker from inspected streams.

JSON export preserves the nested FFprobe object. CSV and XML use the same documented row-per-node representation: each record carries an RFC 6901 JSON Pointer path, a value type, and a scalar value where applicable. Container rows preserve objects and arrays, so the formats do not pretend nested media metadata is a simple one-row table. All three formats are UTF-8 and fail when serialized output would exceed 32 MiB. XML additionally fails with a visible explanation when a value contains a character XML 1.0 cannot represent; JSON or CSV remains available for that snapshot.

Runtime catalogs list codecs, formats, protocols, bitstream filters, devices, filters, and hardware accelerators. Component help supports encoders, decoders, filters, muxers, demuxers, protocols, and bitstream filters. The option-guides layer combines static, bounded guidance with runtime-derived help while keeping those sources distinguishable.

## Configuration

Codec, container, quality, dimensions, frame rate, filters, loudness, GIF, thumbnail, streaming, and adapter values are stored in renderer state. GIF controls cover start, duration, frame rate, width and aspect-preserving height, scaler, palette size, palette statistics, dither, bounded Bayer scale, and loop count. Thumbnail controls cover timestamp, JPEG or PNG, width and aspect-preserving height, scaler, and JPEG quality. The typed builders enforce the authoritative numeric, time, enum, and output-pattern bounds before enqueueing. Presets persist locally and are bounded to 200 records.

Catalog queries use fixed FFmpeg argument sets and a five-minute in-memory cache. Inventory output is bounded to 16 MiB and 30 seconds; help is bounded to 4 MiB and 20 seconds; version output is bounded to 256 KiB and 10 seconds. Component names accept a restricted token format.

## Failure modes

Builders reject unknown fields, unsupported enumerations, conflicting trim values, filters combined with stream copy, malformed stream selectors, oversized collections, disallowed sequence patterns, a non-GIF GIF destination, and a still destination whose extension does not match the selected JPEG or PNG format. Single-still mode always limits output to one frame and rejects a conflicting count. A valid argument vector can still fail for a particular media input or bundled-runtime capability.

Missing FFprobe, malformed JSON, oversized output, timeouts, unsupported catalog/help kinds, invalid names, empty runtime results, and expired file handles are reported rather than replaced with mock data. Probe exports fail if the destination handle is not an output handle, the format is unsupported, the bounded inspection snapshot is no longer available, serialization exceeds 32 MiB, or XML cannot faithfully represent a value.

## Security considerations

Conversion uses opaque handles and structured arrays rather than renderer paths or shell strings. The renderer cannot select an arbitrary executable.

Inputs and export destinations are opaque handles created by native dialogs. The renderer cannot supply a destination path or arbitrary export payload: the trusted main process retains the bounded inspection snapshot, resolves the output handle, serializes the selected allowlisted format, and writes atomically. At most 64 inspection snapshots are retained in memory. Catalog commands are selected from fixed allowlists. Help names are bounded and validated before becoming an argument. Display code limits result counts and text lengths before inserting content.

## Verification state

At source commit `5358582f13b6af418e58c1971747b270d308f34b`, the packaged application used native file dialogs to select a real H.264/AAC input and output, displayed its structured FFmpeg argument preview, completed the job through the trusted runtime queue, and validated a 1,470,093-byte output. Independent FFprobe inspection found H.264 at 1920×1080, AAC at 48 kHz mono, and a 3.000-second duration.

The packaged inspector rendered structured metadata for a separate real H.264 320×180 and AAC 48 kHz input. The codecs view loaded 539 live entries from the bundled FFmpeg 9.0.1 runtime. Component help, JSON/CSV/XML export, non-codec catalog kinds, and the other workflow builders were not interacted with in this run and remain unrun rather than inferred working. The snapshot-bound exporters described above are source-wired but have not been exercised in a packaged application.

The GIF and thumbnail visual-output route is now source-wired through native selection, typed argument construction, opaque-handle conversion, and the durable queue. This ultra-speed change ran no tests, lint, type checks, static analysis, accessibility checks, captures, package execution, or live GIF/thumbnail job, so the existing conversion evidence does not verify either visual-output workflow.

![Convert workflow with real input and output selected and structured command preview](../../captures/5358582/convert-ready.png)

![Live codecs catalog showing entries returned by the bundled FFmpeg runtime](../../captures/5358582/codecs.png)

The completed-conversion and Inspector interactions are retained in a path-redacted receipt. Their raw captures are quarantined rather than published because the rendered interface exposed machine-local paths. Public replacement captures remain a documented gap.

## Suggested articles

- [Architecture and trusted runtime boundary](architecture-runtime.md)
- [Jobs, queue, file registry, and commands](jobs-queue-commands.md)
- [Privacy and security](privacy-security.md)
