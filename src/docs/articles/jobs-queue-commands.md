# Jobs, queue, file registry, and commands

The file registry and job manager connect user-selected files to bounded FFmpeg jobs without exposing absolute paths to the renderer.

## Behavior

Native open/save dialogs register selected paths as random UUID handles. The renderer receives only the handle, kind, and base name. Command compilation resolves input and output handles in the main process.

The queue accepts validated job specifications, runs up to the configured concurrency, parses FFmpeg progress, retains bounded logs, supports pause, resume, cancellation, queued-item reordering, and clearing finished records, and emits live events to the renderer. Queue state is written atomically to `runtime/jobs.json` under the application data directory. Jobs left active by a prior session become `interrupted` on reload.

Completed file-producing jobs are considered successful only when every expected output exists, is a file, and has nonzero size.

## Configuration

Runtime concurrency defaults to two and is clamped to one through four by `JobManager`. The Settings control applies that value through a trusted IPC method, and the scheduler immediately re-evaluates queued work without interrupting jobs already in progress. The queue retains at most 1,000 jobs, 500 terminal history records, 500 log lines per job, and 4,000 characters per log line. Cancellation first writes `q` to FFmpeg and uses a bounded forced termination fallback.

## Failure modes

A handle expires when the application process restarts because the registry is intentionally in memory. Invalid or wrong-kind handles are rejected. Queue state that is oversized, malformed, or from an unsupported schema is quarantined. Pause/resume can fail when the process is no longer active or the Windows process-state helper fails. A zero-byte or missing output converts an otherwise zero FFmpeg exit into a failed job.

## Security considerations

Only native-dialog-selected absolute paths enter the registry. Persisted job data contains compiled arguments and output paths, so the queue file must remain within private application data. Process execution is hidden, shell-free, bounded, and tied to the trusted FFmpeg executable.

## Verification state

The implementation and bounds are present in source. No live queue, restart recovery, pause/resume, cancellation, or output-validation operation was executed during this documentation pass.

## Command construction

`src/ui/command-builders.js` implements typed builders for conversion, trimming, filtergraphs, audio processing, GIF creation, thumbnails, HLS streaming, low-level composition, and converter adapters. Builders validate supported keys, ranges, codecs, containers, stream selectors, time values, filter text, and file-handle objects before returning arguments.

The visible command is a preview, not a shell command. File paths remain opaque handles until the trusted process compiles them. The command composer blocks process-control and path-bearing options such as `-i`, `-progress`, `-y`, report paths, filter scripts, and pass-log paths.

Source inspection confirms the builders call the queue bridge. It does not prove the exact bundled FFmpeg build accepts every generated argument vector.

## Suggested articles

- [Architecture and trusted runtime boundary](architecture-runtime.md)
- [Conversion, inspector, and catalogs](conversion-inspector-catalog.md)
- [Privacy and security](privacy-security.md)


