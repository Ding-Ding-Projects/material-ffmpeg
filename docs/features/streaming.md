# Streaming workflows

## Behavior

The desktop Streaming surface prepares three bounded FFmpeg workflows:

- HLS writes a selected `.m3u8` playlist plus derived MPEG-TS or fragmented-MP4 files beside it.
- RTMP accepts `rtmp://` or `rtmps://` application endpoints and uses FLV transport.
- SRT accepts `srt://` targets with an explicit port and uses MPEG-TS transport.

All modes expose guided video bitrate, audio bitrate, resolution, frame-rate, and keyframe-interval controls. HLS additionally exposes segment duration, playlist length, playlist type, and segment container. RTMP and SRT expose native-pace input and low-latency choices. Queue submission uses the same durable job manager and bounded log surface as the other media workflows.

## Configuration

HLS requires an input selected through the native open dialog and a `.m3u8` destination selected through the native save dialog. Segment and initialization names are derived from that opaque output handle; the renderer does not receive or construct an absolute filesystem path.

RTMP and SRT require a URL matching the selected mode. RTMP accepts one application path component and rejects an additional stream-key component. SRT requires a host and port. Both reject embedded username/password credentials, URL fragments, and query fields named `passphrase`, `password`, `token`, or `key`. Target URLs are session-only and are not restored from local preferences.

The current guided compatibility profile uses H.264 video, AAC audio, and FFmpeg's `veryfast` preset. Bitrates, dimensions, frame rate, keyframe interval, HLS playlist type, and HLS segment type are validated by the typed argument builders before a job enters the queue.

## Failure modes

Choosing Queue stream can fail before process creation when the bundled runtime is unavailable, no input is selected, the HLS destination is absent or has the wrong extension, a numeric value is outside its bound, a bitrate is malformed, or a URL violates the selected transport contract. These failures appear as non-blocking error notifications.

A successfully queued RTMP or SRT job is not proof of a connection. Server reachability, authentication, protocol negotiation, and acceptance are known only after FFmpeg reports them through the job status and bounded logs. HLS success likewise requires FFmpeg to finish and the queue to validate the selected playlist output.

## Security considerations

The renderer submits a structured argument array, never a shell command or executable path. The main process resolves only opaque native-dialog file handles and launches the bundled FFmpeg executable with shell execution disabled. Local HLS paths cannot be supplied as renderer strings.

The application has no credential-vault integration for streaming targets. Do not enter stream keys, passphrases, credentials, or secret URL parameters. Authenticated streaming destinations that require those values are intentionally unsupported by this surface.

## Verification

This source lane did not run tests, lint, type checks, accessibility checks, UI captures, live HLS output, or live network streaming. The controls, typed builders, handle translation, and queue call are source-wired; packaged and runtime behavior remains unverified until exercised separately against the exact integrated commit.
