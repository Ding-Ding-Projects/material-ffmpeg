# Jobs, queue, file registry, and commands

The file registry and job manager connect user-selected files to bounded FFmpeg jobs without exposing absolute paths to the renderer.

## Behavior

Native open/save dialogs register selected paths as random UUID handles. The renderer receives only the handle, kind, and base name. Command compilation resolves input and output handles in the main process.

The queue accepts validated job specifications, runs up to the configured concurrency, parses FFmpeg progress, retains bounded logs, supports pause, resume, cancellation, queued-item reordering, and clearing finished records, and emits live events to the renderer. Queue state is written atomically to `runtime/jobs.json` under the application data directory. Jobs left active by a prior session become `interrupted` on reload.

Completed file-producing jobs are considered successful only when every expected output exists, is a file, and has nonzero size.

The two-pass loudness workflow validates the selected input/output handle kinds, output extension, audio stream, codec, and target ranges before it queues analysis. A dedicated trusted IPC operation retains only those two already-selected handles for the registry's existing 24-hour maximum so a long analysis can reach pass 2 without exposing either path. Pass 1 writes bounded `loudnorm` JSON into the ordinary job log. Pass 2 is queued only after the analysis job reports `completed` with exit code zero and the renderer extracts all five required finite measurements inside the command builder's accepted ranges. Its deterministic pass-2 label prevents a recovered completion event from creating a duplicate output job.

## Configuration

Runtime concurrency defaults to two and is clamped to one through four by `JobManager`. The Settings control applies that value through a trusted IPC method, and the scheduler immediately re-evaluates queued work without interrupting jobs already in progress. The queue retains at most 1,000 jobs, 500 terminal history records, 500 log lines per job, and 4,000 characters per log line. Cancellation first writes `q` to FFmpeg and uses a bounded forced termination fallback.

## Failure modes

A handle expires when the application process restarts because the registry is intentionally in memory. Invalid or wrong-kind handles are rejected. The loudness coordinator keeps a bounded, versioned local record of analysis job ids and opaque selections so a renderer reload can reconcile against the durable queue; it never stores an absolute media path. A full application restart invalidates those opaque selections, so the coordinator cancels a stale active analysis when possible and never starts its pass 2. That condition, or a pass 1 that is failed, cancelled, interrupted, cleared, missing, malformed, or lacks valid measurements, removes the pending handoff and shows an error that asks the user to reselect the files. Queue state that is oversized, malformed, or from an unsupported schema is quarantined. Pause/resume can fail when the process is no longer active or the Windows process-state helper fails. A zero-byte or missing output converts an otherwise zero FFmpeg exit into a failed job.

## Security considerations

Only native-dialog-selected absolute paths enter the registry. Persisted job data contains compiled arguments and output paths, so the queue file must remain within private application data. Process execution is hidden, shell-free, bounded, and tied to the trusted FFmpeg executable.

## Verification state

The implementation and bounds are present in source. No live loudness pass, queue, restart recovery, pause/resume, cancellation, or output-validation operation was executed during this documentation pass.

## Command construction

`src/ui/command-builders.js` implements typed builders for conversion, trimming, filtergraphs, audio processing, GIF creation, thumbnails, HLS/RTMP/SRT streaming, low-level composition, and converter adapters. Streaming builders validate the HLS playlist and segment contract, bitrate and encoding bounds, selected transport mode, URL protocol/host/port, and forbidden credential-bearing URL fields before returning arguments.

The visual-output surface converts renderer-visible UUIDs into typed input/output handle entries only after the GIF or still builder accepts the selected values. GIF jobs use one selected `.gif` destination. Still jobs use a selected `.jpg`, `.jpeg`, or `.png` destination, seek to a bounded timestamp, and force a one-frame output. The queue resolves those handles to paths in the privileged process and independently requires each declared output to exist and contain bytes before marking the job complete.

The visible command is a preview, not a shell command. File paths remain opaque handles until the trusted process compiles them. The command composer blocks process-control and path-bearing options such as `-i`, `-progress`, `-y`, report paths, filter scripts, and pass-log paths.

Source inspection confirms the builders call the queue bridge. It does not prove the exact bundled FFmpeg build accepts every generated argument vector.

## Suggested articles

- [Architecture and trusted runtime boundary](architecture-runtime.md)
- [Conversion, inspector, and catalogs](conversion-inspector-catalog.md)
- [Privacy and security](privacy-security.md)
