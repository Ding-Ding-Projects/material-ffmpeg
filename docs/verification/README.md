# Verification evidence

This directory defines the release-grade evidence contract. It contains no simulated proof.

`../feature-inventory.json` is hand-written and fail-closed. The report generator marks a row `unrun` until a valid receipt for the exact commit exists. A declared file, interaction, or image name does not prove that it worked.

`verdict-ledger.json` defines the four verdicts. Run `npm run report:features -- --commit <exact-commit>` to print the current working, failed, unrun, and not-applicable rows. Missing declared files produce `failed`; present declarations without real evidence remain `unrun`.

Real UI captures must come from the packaged application or deployed Pages response on a named off-screen desktop through `lowlevel-computer-use-cheap`. The capture verifier rejects missing or invalid PNGs, mismatched commits, visible-desktop routes, browser plugins, mocks, DOM injection, design files, and unreviewed images.

The capture plan expands `docs/generated-article-index.json` and requires one deployed-page capture receipt for every indexed root project document and generated feature article. A missing article index fails closed instead of silently shrinking coverage.

The repository social-preview upload remains externally unverified because the `gh` CLI exposes no supported upload route for that setting. Committing `social-preview.png` is necessary but cannot prove the setting was changed.
