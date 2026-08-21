# Privacy and security

material-ffmpeg is designed for local media processing with a narrow renderer-to-runtime boundary. Privacy and security claims remain tied to concrete implementation and execution evidence.

## Behavior

Media selection, probing, command generation, conversion, job state, and ordinary settings are local. The desktop renderer uses native file dialogs through the main process and does not receive absolute paths. The project site ships local HTML and CSS without analytics, remote fonts, or CDN scripts.

## Configuration

Electron is configured with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, and `webSecurity: true`. Window creation and navigation are denied outside the local packaged page. Runtime output, queue history, labels, arguments, inventory names, and UI text are bounded.

## Failure modes

Privacy can be compromised if future code logs selected paths, media metadata, tokens, or imported private vocabulary.

Several broader contracts are not complete: narrator and voice selection, universal language/funny-level settings, local vocabulary upload, complete every-element appearance editing and locks, built-in authenticator, local Git history, scheduled external settings, automatic updates, and the full universal converter/Ollama suites.

## Security considerations

Do not store passwords or TOTP secrets in local storage, logs, exports, or Git. The current lock prototype is not vault-backed and must remain described as incomplete. Do not enable arbitrary process execution, shell command strings, external navigation, or machine-installed-runtime fallback. FFmpeg parses untrusted media and should be updated through a pinned, reviewed dependency change.

## Verification state

The security configuration is confirmed by source inspection. No penetration review or hostile-input execution was performed in this pass.

## Suggested articles

- [Architecture and trusted runtime boundary](architecture-runtime.md)
- [Accessibility](accessibility.md)
- [Settings and preferences](settings-preferences.md)
- [Feature status ledger](feature-ledger.md)

