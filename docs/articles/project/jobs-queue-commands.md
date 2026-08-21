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

`src/ui/command-builders.js` implements typed builders for conversion, trimming, filtergraphs, audio processing, GIF creation, thumbnails, HLS/RTMP/SRT streaming, low-level composition, and converter adapters. Builders validate supported keys, ranges, codecs, containers, stream selectors, time values, typed filter nodes, and file-handle objects before returning arguments. Filtergraphs accept ordered allowlisted node objects and compile video and audio chains separately; raw graph text is not part of the GUI contract. Streaming builders validate the HLS playlist and segment contract, bitrate and encoding bounds, selected transport mode, URL protocol/host/port, and forbidden credential-bearing URL fields before returning arguments.

The visual-output surface converts renderer-visible UUIDs into typed input/output handle entries only after the GIF or still builder accepts the selected values. GIF jobs use one selected `.gif` destination. Still jobs use a selected `.jpg`, `.jpeg`, or `.png` destination, seek to a bounded timestamp, and force a one-frame output. The queue resolves those handles to paths in the privileged process and independently requires each declared output to exist and contain bytes before marking the job complete.

The command composer separates global, input, and output option rows. A guided output-format selector owns `-f`; native file pickers own `-i` and the final output. The renderer limits each option field to 8,000 characters, the combined composer to 120 option rows, the final vector to 256 arguments, and the visible preview to 12,000 characters.

The visible command is a preview, not a shell command. Enqueueing uses a dedicated `composer:enqueue` IPC route rather than submitting the preview or a caller-provided executable. The main process rebuilds the vector from the structured specification, verifies that every UUID is a live file-registry handle of the expected input or output kind, converts those UUIDs to `JobManager` file-handle arguments, and then queues the job. Executable names, shell operators, local paths, protocol targets, response files, path-reading filters, process-control options, implicit file outputs, and path-bearing options such as `-i`, `-progress`, `-report`, filter scripts, segment paths, attachment paths, and pass-log paths are rejected.

The dedicated source route is present, but it was not launched or exercised during this ultra-speed pass. The source wiring does not prove that the exact bundled FFmpeg build accepts a particular composed argument vector.

## Suggested articles

- [Architecture and trusted runtime boundary](architecture-runtime.md)
- [Conversion, inspector, and catalogs](conversion-inspector-catalog.md)
- [Privacy and security](privacy-security.md)
