# Verification evidence

This directory defines the release-grade evidence contract. It contains no simulated proof.

`../feature-inventory.json` is hand-written and fail-closed. The report generator marks a row `unrun` until a valid receipt for the exact commit exists. A declared file, interaction, or image name does not prove that it worked.

`verdict-ledger.json` defines the four verdicts. Run `npm run report:features -- --commit <exact-commit>` to print the current working, failed, unrun, and not-applicable rows. Missing declared files produce `failed`; present declarations without real evidence remain `unrun`.

Real UI captures must come from the packaged application or deployed Pages response on a named off-screen desktop through `lowlevel-computer-use-cheap`. The capture verifier rejects missing or invalid PNGs, mismatched commits, visible-desktop routes, browser plugins, mocks, DOM injection, design files, and unreviewed images.

The capture plan expands `docs/generated-article-index.json` and requires one deployed-page capture receipt for every indexed root project document and generated feature article. A missing article index fails closed instead of silently shrinking coverage.

The repository social-preview upload remains externally unverified because the `gh` CLI exposes no supported upload route for that setting. Committing `social-preview.png` is necessary but cannot prove the setting was changed.

## Exact packaged GUI evidence at `5358582`

Three captures from the packaged application at commit `5358582f13b6af418e58c1971747b270d308f34b` are promoted under `docs/captures/5358582/`. Their active records extend `capture-manifest.json`; public, path-redacted receipt summaries live under `receipts/5358582/`.

The corresponding private run receipts remain outside the repository so machine-local paths and the task profile are not published. Receipt validation binds the promoted bytes to the exact raw capture hashes, the packaged executable SHA-256 `95d1b2349891d01e17fa1bcc5e9b24bf7a87f9f8c6aa915b8bc6ab838df7052a`, and the unchanged source commit. The executable was unsigned and contained bundled FFmpeg and FFprobe 9.0.1.

The interaction receipt records a completed real H.264/AAC conversion, independently inspected output, a real FFprobe inspection, and a live 539-entry codec catalog. The completed-conversion and Inspector raw images are quarantined because their pixels exposed machine-local paths; the public inventory records both capture gaps explicitly. It does not claim interaction coverage for the other source-wired workflows. No tests or lint commands were run for this evidence-only update.

Independent publication evidence comes from [GitHub Actions run 32460503357](https://github.com/Ding-Ding-Projects/material-ffmpeg/actions/runs/32460503357), which completed successfully at the same exact commit. It published [v0.1.22-r1](https://github.com/Ding-Ding-Projects/material-ffmpeg/releases/tag/v0.1.22-r1) as a non-draft, non-prerelease release with four downloadable Squirrel.Windows assets. The release asset inventory does not contain the separately required dim-sum image, so this evidence does not mark the complete release contract satisfied.
