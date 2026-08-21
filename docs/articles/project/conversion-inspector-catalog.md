# Conversion, inspector, and runtime catalogs

The inspector and catalog surfaces derive their data from the bundled FFprobe and FFmpeg executables rather than from hard-coded capability lists.

## Behavior

The renderer provides guided conversion, trimming, filtergraph, audio, GIF, thumbnail, HLS, command-composer, preset, and batch-converter surfaces. Typed builders produce argument arrays for trusted execution. The batch converter currently maps verified media inputs to MP4, MKV, WebM, MP3, FLAC, WAV, PNG, and JPEG adapters.

The inspector opens a user-selected media file, requests structured FFprobe JSON, displays format and stream information, and can export the current probe result through a user-selected destination. The renderer derives its audio-stream picker from inspected streams.

Runtime catalogs list codecs, formats, protocols, bitstream filters, devices, filters, and hardware accelerators. Component help supports encoders, decoders, filters, muxers, demuxers, protocols, and bitstream filters. The option-guides layer combines static, bounded guidance with runtime-derived help while keeping those sources distinguishable.

## Configuration

Codec, container, quality, dimensions, frame rate, filters, loudness, GIF, thumbnail, streaming, and adapter values are stored in renderer state. Presets persist locally and are bounded to 200 records.

Catalog queries use fixed FFmpeg argument sets and a five-minute in-memory cache. Inventory output is bounded to 16 MiB and 30 seconds; help is bounded to 4 MiB and 20 seconds; version output is bounded to 256 KiB and 10 seconds. Component names accept a restricted token format.

## Failure modes

Builders reject unknown fields, unsupported enumerations, conflicting trim values, filters combined with stream copy, malformed stream selectors, oversized collections, and disallowed sequence patterns. A valid argument vector can still fail for a particular media input or bundled-runtime capability.

Missing FFprobe, malformed JSON, oversized output, timeouts, unsupported catalog/help kinds, invalid names, empty runtime results, and expired file handles are reported rather than replaced with mock data. Probe exports fail if the destination handle is not an output handle or the format is unsupported.

## Security considerations

Conversion uses opaque handles and structured arrays rather than renderer paths or shell strings. The renderer cannot select an arbitrary executable.

Inputs and export destinations are opaque handles created by native dialogs. Catalog commands are selected from fixed allowlists. Help names are bounded and validated before becoming an argument. Display code limits result counts and text lengths before inserting content.

## Verification state

Source inspection confirms the runtime-derived routes and their bounds. No actual media probe, catalog enumeration, help lookup, or export was run in this documentation-only pass.

## Suggested articles

- [Architecture and trusted runtime boundary](architecture-runtime.md)
- [Jobs, queue, file registry, and commands](jobs-queue-commands.md)
- [Privacy and security](privacy-security.md)
