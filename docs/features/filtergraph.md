# Filtergraph builder

The desktop filtergraph builder creates ordered FFmpeg video and audio filter chains without accepting shell commands, executable paths, local file paths, or raw filtergraph text from the renderer.

## Behavior

The input and output controls open native dialogs through the trusted main-process boundary. The renderer receives opaque handles and never receives the selected absolute paths. Video and audio nodes appear in separate lanes. Moving a node earlier or later changes its position only within the matching stream chain.

The supported video filters are scale, crop, frame rate, picture adjustment, color-curve presets, text overlay, and sharpen/soften. The supported audio filters are loudness normalization and tempo. Each filter exposes typed fields, bounded numeric ranges, and enumerated choices. Updating a node validates the complete node before it replaces the saved value.

Queueing compiles the ordered video nodes into one `-vf` argument and the ordered audio nodes into one `-af` argument. A filtered stream is re-encoded, while an unfiltered stream uses stream copy. The resulting string array is converted to a trusted job specification whose input and output positions refer to the selected opaque handles.

## Configuration

The node list persists in local renderer storage and is limited to 64 entries. Previously stored scale, crop, frame-rate, loudness, and tempo strings are migrated only when they match the recognized legacy shape; other legacy text falls back to the selected filter's safe defaults.

## Failure modes

The builder rejects an empty or oversized node list, unknown object fields, unsupported stream kinds or filter names, missing option objects, out-of-range numbers, invalid frame rates, unsupported choices, and text containing filtergraph delimiters. The queue also reports missing or expired handles, unavailable bundled executables, unsupported media, encoder failures, and invalid or empty output rather than claiming success.

## Security considerations

Filter names and option keys come from fixed allowlists. Numeric and enumerated values are validated before string construction. Text overlays accept a deliberately restricted character set so a caption cannot inject another filter, stream label, or graph separator. FFmpeg is launched shell-free from its trusted bundled location by the main process.

## Verification state

The source implementation and documentation are present. This ultra-speed change did not run tests, lint, static analysis, accessibility checks, the packaged application, or capture workflows. The filtergraph interaction therefore remains unverified at runtime.
