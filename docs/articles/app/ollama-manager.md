# Local Ollama suite manager

The desktop surface is a local control plane for an Ollama installation. It does not call the network or spawn processes from the renderer. `src/ui/ollama-manager.js` receives a narrow privileged adapter with `health`, `listModels`, `catalogPage`, `pull`, and `chatStream` methods; all other behavior is state management and validation.

## Behavior and configuration

The manager reports `unknown`, `checking`, `running`, `unhealthy`, and `unavailable` runtime states. Installed models and an exhaustive paginated catalog are kept separately, with page count, revision, refresh time, and a completeness flag. Catalog search is plain text by default; callers can enable regex with a field-local `{ pattern, flags }` pair. Each search surface should place its regex-builder affordance adjacent to that field and keep its query state independent.

Model rows can be filtered by family, capability, and installed state and sorted by name or reported size. Hardware fit is conservative: `Runs well`, `Runs with limits`, `Unlikely`, or `Unknown` with the evidence and assumptions shown. Missing size or memory never becomes a guessed success.

Inputs are bounded (`maxModels` defaults to 2,000 and is clamped to 10,000; `maxPages` defaults to 100 and is clamped to 1,000; prompts default to 32 KiB and are clamped to 128 KiB). Pull requests longer than the model bound are rejected. Pulls form a bounded-concurrency queue with progress, cancellation through `AbortSignal`, retryable failures, and bounded retained history (500 entries by default, at most 2,000). Chat accepts a model, prompt, system prompt, validated parameters, and only attachment metadata whose kind is present in the selected model's verified capabilities; attachment bytes never enter renderer state. Streamed responses are capped at 256 KiB by default (1 MiB maximum), with cancellation and redacted JSON export. Regex searches reset `lastIndex` before each match, so global/sticky flags remain deterministic.

Harness profiles are explicitly registered rather than arbitrary shell text. Duplicate IDs and shell metacharacters in executable or arguments are rejected. Registration records an executable, string arguments, working directory, and environment-key names only, with bounded retained history. Preflight returns a reviewable preview and blockers (including an `Unlikely` fit); snapshot and restore hooks are exposed for the privileged host to implement rollback.

## Failure, security, and privacy

The renderer never receives unrestricted process spawning, shell commands, credentials, response bodies, or direct `fetch` authority. The injected adapter is the only route to Ollama. Unknown, stopped, unhealthy, offline, malformed, oversized, or incomplete responses remain visible as failure states. No payment, purchase, account, cloud entitlement, sample model, or fake success state exists. Chat export excludes attachment payload bytes and records only names and kinds.

## Verification boundary

This article documents the adapter contract and state transitions. Runtime health, Ollama API compatibility, exhaustive catalog completeness, packaged-artifact wiring, and actual harness rollback require built-artifact verification through the host application's privileged bridge; source presence alone is not proof.

## Suggested articles

- [Architecture and runtime boundary](../project/architecture-runtime.md)
- [Conversion inspector catalog](../project/conversion-inspector-catalog.md)
- [Privacy and security](../project/privacy-security.md)
