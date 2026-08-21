# Conversion, inspector, and runtime catalogs

The inspector and catalog surfaces derive their data from the bundled FFprobe and FFmpeg executables rather than from hard-coded capability lists.

## Behavior

The renderer provides guided conversion, trimming, filtergraph, audio, GIF, thumbnail, HLS, command-composer, preset, and batch-converter surfaces. Typed builders produce argument arrays for trusted execution. The filtergraph surface keeps video and audio nodes in separate ordered chains, provides per-filter guided controls, and queues only node kinds, names, and option objects accepted by the builder allowlist. The audio extraction surface inspects the selected input, requires one detected audio stream, offers Matroska stream copy or bounded M4A/AAC, MP3, Ogg Opus, FLAC, and WAV/24-bit PCM formats, and selects its output through the native save dialog. Re-encoding formats expose only fixed bitrate choices where the encoder uses them, fixed source/44.1/48/96/192 kHz sample-rate choices, and source/mono/stereo channel choices. GIF output uses one in-memory palette-generation and palette-use graph; per-frame palette statistics also enable a new palette for each frame. Thumbnail output seeks to one selected timestamp and limits the job to one JPEG or PNG still rather than routing a single save destination through a sequence workflow. The batch converter currently maps verified media inputs to MP4, MKV, WebM, MP3, FLAC, WAV, PNG, and JPEG adapters.

The inspector opens a user-selected media file, requests structured FFprobe JSON, displays format and stream information, and can export that exact in-memory inspection snapshot through a user-selected destination. Export does not run a second probe whose result could differ from the data on screen. The renderer derives its audio-stream picker from inspected streams.

JSON export preserves the nested FFprobe object. CSV and XML use the same documented row-per-node representation: each record carries an RFC 6901 JSON Pointer path, a value type, and a scalar value where applicable. Container rows preserve objects and arrays, so the formats do not pretend nested media metadata is a simple one-row table. All three formats are UTF-8 and fail when serialized output would exceed 32 MiB. XML additionally fails with a visible explanation when a value contains a character XML 1.0 cannot represent; JSON or CSV remains available for that snapshot.

Runtime catalogs list codecs, encoders, decoders, formats, filters, protocols, bitstream filters, devices, hardware accelerators, pixel formats, sample formats, and channel layouts. Each declared kind has a local bounded search surface. Component help supports encoders, decoders, filters, muxers, demuxers, protocols, and bitstream filters; entries whose FFmpeg inventory has no component-help route say so instead of opening an empty panel. The option-guides layer combines static, bounded guidance with runtime-derived help while keeping those sources distinguishable.

## Configuration

Codec, container, quality, dimensions, frame rate, filters, loudness, audio extraction format, bounded audio options, GIF, thumbnail, streaming, and adapter values are stored in renderer state. Filtergraph state is bounded to 64 nodes and normalized to the current video/audio filter catalog when it is loaded. Node order persists locally, and reordering operates within the selected stream chain. Changing the extraction format clears a previously selected destination when its extension no longer matches, so a stale path is never silently reused. GIF controls cover start, duration, frame rate, width and aspect-preserving height, scaler, palette size, palette statistics, dither, bounded Bayer scale, and loop count. Thumbnail controls cover timestamp, JPEG or PNG, width and aspect-preserving height, scaler, and JPEG quality. The typed builders enforce the authoritative numeric, time, enum, and output-pattern bounds before enqueueing. Presets persist locally and are bounded to 200 records.

Catalog queries use fixed FFmpeg argument sets and a five-minute in-memory cache. The desktop request returns at most 500 entries per inventory, while the reusable help panel requests at most 250. Runtime help returned to the renderer is limited to 64 KiB. Process collection remains bounded to 16 MiB and 30 seconds for inventory, 4 MiB and 20 seconds for help, and 256 KiB and 10 seconds for version output. Catalog kinds, component names, limits, and refresh options are validated at the trusted boundary.

## Failure modes

Builders reject unknown fields, unsupported enumerations, conflicting trim values, filter nodes combined with stream copy, malformed stream selectors, oversized collections, out-of-range filter options, disallowed sequence patterns, a non-GIF GIF destination, and a still destination whose extension does not match the selected JPEG or PNG format. The filtergraph builder does not accept raw graph text or a complex-graph override. Single-still mode always limits output to one frame and rejects a conflicting count. Audio extraction additionally stops before queue submission when inspection is still running, FFprobe reports an error, no audio stream exists, the selected stream is stale, a bounded option is invalid, the output was cancelled, or the output extension does not match the selected format. A valid argument vector can still fail for a particular media input or bundled-runtime capability.

Missing FFprobe, malformed JSON, oversized output, timeouts, unsupported catalog/help kinds, invalid names, empty runtime results, and expired file handles are reported rather than replaced with mock data. Probe exports fail if the destination handle is not an output handle, the format is unsupported, the bounded inspection snapshot is no longer available, serialization exceeds 32 MiB, or XML cannot faithfully represent a value.

## Security considerations

Conversion uses opaque handles and structured arrays rather than renderer paths or shell strings. The renderer cannot select an arbitrary executable.

Inputs, extraction outputs, and export destinations are opaque handles created by native dialogs. Filtergraph nodes compile into one `-vf` value and one `-af` value from fixed filter and option allowlists; user-entered shell commands, executable choices, file paths, and raw filtergraph separators are not accepted. The audio controls map fixed format and option choices to the existing typed extraction builder; the renderer never receives or assembles an absolute path or shell command. The renderer cannot supply a destination path or arbitrary export payload: the trusted main process retains the bounded inspection snapshot, resolves the output handle, serializes the selected allowlisted format, and writes atomically. At most 64 inspection snapshots are retained in memory. Catalog commands are selected from fixed allowlists. Help names are bounded and validated before becoming an argument. Display code limits result counts and text lengths before inserting content.

## Verification state

At source commit `5358582f13b6af418e58c1971747b270d308f34b`, the packaged application used native file dialogs to select a real H.264/AAC input and output, displayed its structured FFmpeg argument preview, completed the job through the trusted runtime queue, and validated a 1,470,093-byte output. Independent FFprobe inspection found H.264 at 1920×1080, AAC at 48 kHz mono, and a 3.000-second duration.

The packaged inspector rendered structured metadata for a separate real H.264 320×180 and AAC 48 kHz input. The codecs view loaded 539 live entries from the bundled FFmpeg 9.0.1 runtime. The expanded bounded catalog routes, local search, component help, JSON/CSV/XML export, non-codec catalog kinds, the typed filtergraph workflow, and the other workflow builders were not interacted with in this implementation pass and remain unrun rather than inferred working. The snapshot-bound exporters described above are source-wired but have not been exercised in a packaged application.

The GIF and thumbnail visual-output route is now source-wired through native selection, typed argument construction, opaque-handle conversion, and the durable queue. This ultra-speed change ran no tests, lint, type checks, static analysis, accessibility checks, captures, package execution, or live GIF/thumbnail/filtergraph job, so the existing conversion evidence does not verify those workflows.

The later audio-extraction wiring was completed under the same ultra-speed boundary with no test, lint, type, accessibility, review, capture, packaged interaction, or actual extraction, so that workflow remains runtime-unverified.

![Convert workflow with real input and output selected and structured command preview](../../captures/5358582/convert-ready.png)

![Live codecs catalog showing entries returned by the bundled FFmpeg runtime](../../captures/5358582/codecs.png)

The completed-conversion and Inspector interactions are retained in a path-redacted receipt. Their raw captures are quarantined rather than published because the rendered interface exposed machine-local paths. Public replacement captures remain a documented gap.

## Suggested articles

- [Architecture and trusted runtime boundary](architecture-runtime.md)
- [Jobs, queue, file registry, and commands](jobs-queue-commands.md)
- [Privacy and security](privacy-security.md)
