# Appearance and app logo

## Behavior

The website provides persisted light and dark themes, density, font family, font scale, weight, motion, accent color, and per-element appearance overrides. An element's context menu exposes **Edit appearance…**. The editor includes typography controls, continuous color selection, numeric color fields, contrast information, and reset actions.

The color translator reports equivalent values in HEX/HEX8, RGB/RGBA, HSL/HSLA, HSV/HSB, HWB, CIELAB/LCH, OKLab/OKLCH, and CMYK. Browser conversion is deterministic, but conversions into print-oriented or perceptual spaces are approximations because this static site has no calibrated color-management service.

The local logo editor includes shipped project marks plus a local image picker, fit/fill/contain, focal point, and background controls. Files are checked by byte signature, size, type, and decoded pixel bounds before preview. The source and derived preview remain in browser storage and are never uploaded. A failed conversion keeps the previous valid selection active.

## Configuration

Appearance changes apply immediately and are stored under the site's versioned local state. Each setting explains its current value and whether it came from a stored preference or the shipped default. Named presets can be exported and imported.

## Failure modes

- An unsupported, malformed, animated, oversized, or excessive-pixel image is rejected without partial application.
- A font that is not installed falls back to the documented system stack while preserving the requested value.
- A color outside the target gamut is reported before the translated value is clipped.
- Clearing site data removes custom logo bytes and appearance preferences.

## Security and privacy

Image decoding and conversion happen locally. The website does not transmit the file, its name, its path, or its derived pixels. Changing the displayed mark does not change package identity, installer identity, update feeds, or repository metadata.

## Verification

The feature inventory tracks theme, density, font controls, continuous color input, translator output, per-element reset, preset import/export, logo presets, local upload bounds, fit/focal/background controls, and failed-conversion rollback.

## Suggested articles

- [Focus and attention modes](focus-and-attention.md)
- [Exports and bulk actions](exports-and-bulk-actions.md)
- [Accessibility and responsive behavior](accessibility-and-responsive-layout.md)
