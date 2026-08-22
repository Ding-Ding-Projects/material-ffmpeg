# Trim and clip

The desktop trim workflow selects one input and one output with native dialogs, keeps their absolute paths inside the trusted main process, and gives the renderer only opaque UUID handles and bounded base names.

## Behavior

Choose a start time and either an absolute source out point or a positive duration. When an out point is used, the command builder validates that it is later than the start and converts the difference to a positive `-t` duration. This avoids relying on mixed input-seek and output-`-to` timestamp semantics. Copy mode uses `-c copy`; re-encode mode exposes bounded video codec, audio codec, CRF, and preset choices.

The output-container picker and save-dialog filter use the same selected extension. Queue submission proceeds only when the renderer still holds exactly one valid input handle and one valid output handle. A successful notification requires the trusted queue to return a UUID job identifier with a queued or running state.

## Configuration

Times accept seconds or `HH:MM:SS[.fraction]`. The start defaults to zero and the duration defaults to ten seconds. Supported output choices are MP4, Matroska, MOV, WebM, M4V, and MPEG-TS. Container and codec compatibility remains subject to the bundled FFmpeg build; an incompatible combination fails as a normal job with FFmpeg diagnostics.

## Failure modes

The trim is not queued when the runtime is unavailable, a native selection was cancelled or expired, a handle has the wrong kind, the output extension no longer matches the selected container, the duration is zero, the out point is not later than the start, a builder value is unsupported, or the queue refuses the specification. A queued job can later fail when FFmpeg rejects the media or selected codecs, or when the expected output is missing or empty.

## Security considerations

The renderer never receives an absolute selected path and cannot choose an executable, construct a shell command, or spawn a process. The trusted process resolves the typed input/output handles, compiles a bounded argument array, runs only the bundled FFmpeg executable with `shell: false`, and validates declared outputs after completion.

## Verification state

This implementation was completed in the ultra-speed lane without tests, lint, type checks, reviews, audits, captures, installer execution, or runtime interaction. Source presence is not evidence that a packaged trim operation completed successfully.
