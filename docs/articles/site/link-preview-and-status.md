# Link preview and status evidence

## Behavior

The published site includes static Open Graph and Twitter metadata for its title, description, canonical URL, and an absolute HTTPS preview-image URL. The Home and Status surfaces distinguish a published documentation site from pending installer, feature-module, and social-preview evidence. The status copy does not promote an installer until an immutable release asset has been verified.

## Configuration

Metadata is authored in `docs/index.html`; the referenced preview path is versioned site content rather than a runtime-generated image. The status module reports the local release-data record and registered module state. Repository social-preview configuration is a separate forge setting and is not inferred from the HTML tags.

## Failure modes

- A missing `assets/social-preview.png` or unavailable feature-assets module leaves the social-preview state pending; it does not become a green release claim.
- No direct installer button is advertised while the release manifest lacks a verified immutable asset.
- A static metadata URL can be syntactically present while the binary asset or repository setting remains unverified; those are separate evidence boundaries.

## Security and privacy

The metadata contains ordinary public product description only. It does not expose credentials, local paths, visitor records, personal vocabulary, or runtime data. Preview images must remain local project assets or verified public release assets; no third-party tracking image or generated substitute is implied.

## Verification

Source inspection confirms the metadata and pending-state wording. The exact social-preview image availability and the repository social-preview upload remain unrun: the `gh` CLI has no supported upload route for that repository setting. No built-site capture or release publication is claimed here.

## Suggested articles

- [Release and installer trust](../core/release-trust.md)
- [Website and installed application boundary](../core/website-boundary.md)
- [Feature verification ledger](../project/feature-ledger.md)
