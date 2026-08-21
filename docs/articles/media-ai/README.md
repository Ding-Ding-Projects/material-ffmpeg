# Local converter and Ollama suite

The documentation site includes browser-local equivalents of the file converter and Ollama manager. They are real controls with explicit browser boundaries, not demonstrations with invented results.

## File converter

Files remain in the browser. The converter identifies supported inputs from bounded byte inspection instead of trusting the filename. It exposes a categorized adapter catalog and keeps unsupported formats visible with the exact unavailable adapter or browser limitation.

Only adapters implemented in the bundled worker can run. Every conversion preserves the source, builds the output in memory, validates the result, and starts a download only after the user chooses it. The queue stores resumable metadata locally but never persists file bytes or file paths. After a reload, the user must reselect the source bytes before a pending item can resume.

PDF inspection, splitting, merging, extraction, reordering, rotation, and metadata writing are shown but disabled. The site does not bundle a validated PDF engine, so pretending those operations work would risk corrupt output. The installed desktop application can provide stronger adapters through its packaged runtime.

## Ollama suite

The site can make user-initiated requests only to `http://127.0.0.1:11434` or `http://localhost:11434`. The browser may block these requests because of mixed-content, CORS, or Private Network Access policy. A failure is reported as a browser mediation boundary, not as proof that Ollama is stopped.

Runtime health, version, installed models, running models, pulls, generation, chat, copies, and deletes use documented local API routes. Destructive model deletion remains unavailable unless the hosting surface supplies its confirmation contract.

The model store does not scrape an online catalog. The user imports a bounded, versioned catalog snapshot containing pagination completeness, refresh time, source identity, and variant metadata. The site validates the entire file before replacing the last valid snapshot. When no snapshot exists, or it is stale, the store says so and never invents models or tags.

Hardware-fit labels are conservative evidence. They use user-entered current RAM, VRAM, free storage, architecture/backend status, and imported exact model metadata. Missing evidence produces **Unknown**. A label never promises that a model will run.

The cart schedules local pulls and contains no payment, price, checkout, account, or entitlement behavior. Streaming chat, capability-gated attachments, allowlisted harness previews, and local snapshot restore are provided where their verified inputs permit them.

## Privacy and recovery

No analytics or third-party assets are used. Catalog metadata, settings, queue metadata, chat history, and snapshots remain in browser storage. Media bytes, prompts in ordinary exports, Ollama response bodies, credentials, and private filesystem paths are not written to logs or public records.

Clear this site's storage to reset all browser-local state. This removes local metadata and history but does not delete models from Ollama or files from the computer.

## Verification status

Syntax and state-model checks can be run from source. Runtime and visual evidence must come from a built site and a real local Ollama service; until that evidence exists, the interface reports those states as unverified.

## Suggested articles

- [FFmpeg source reference](../../../design/source/README.md)
- [Project build instructions](../../../README.md)
- [Release history](https://github.com/Ding-Ding-Projects/material-ffmpeg/releases)
