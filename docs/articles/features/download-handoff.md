# Download handoff surfaces

## Behavior

The website demonstrates the three independent surfaces expected from an installed browser-extension handoff:

1. **Start download** names the proposed file, source, destination label, and action that begins the transfer.
2. **Downloading** shows filename, source, destination label, bytes, rate, estimated time, pause, resume, cancel, errors, and progress.
3. **Download complete** reports the final outcome and remains visible until dismissed.

On this static website the flow is an explicitly labeled local simulation. It uses generated sample bytes and timers only after the visitor starts it. It does not intercept browser downloads, receive an extension message, read a destination path, or claim that a real file transfer occurred.

## Configuration

The simulated queue can be paused, resumed, or cancelled. Re-entry is blocked while the transfer is active. Low-stimulation mode reduces progress animation while preserving numeric progress and state.

## Failure modes

- Cancelling leaves the simulated queue in a cancelled state and never reports completion.
- Closing the page ends the simulation; it is not resumable as a real download.
- A browser that suspends background timers may report a discontinuous rate when the page returns.

## Security and privacy

No source URL is fetched, no destination path is accessed, and no extension API is invoked. The surface exists to document and exercise the interaction design, not to stand in for installed-extension evidence.

## Verification

The site inventory records the three distinct surfaces and their controls. Release verification still requires the real built extension-to-application path and real capture evidence.

## Suggested articles

- [Browser-only boundaries](browser-boundaries.md)
- [Accessibility and responsive behavior](accessibility-and-responsive-layout.md)
- [Notifications, schedules, and history](notifications-schedules-history.md)
