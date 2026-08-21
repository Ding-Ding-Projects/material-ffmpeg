# Accessibility and responsive behavior

## Behavior

The feature workspace uses semantic tabs and panels, visible focus, keyboard activation, touch-sized controls, screen-reader names and states, text equivalents for progress and countdowns, reduced-motion handling, contrast-aware appearance controls, and responsive layouts from 320 pixels upward.

The tab strip docks left by default and can move to right, top, or bottom. Vertical strips use Up and Down arrow navigation; horizontal strips use Left and Right. At narrow widths, labels collapse to accessible icon buttons and the strip becomes horizontally scrollable. Labels are never rotated.

Overlays paint an opaque surface, remain inside the viewport, and scroll internally. Floating panels are draggable and resizable at larger widths, with keyboard move/resize controls and a reset action. On narrow screens they become bounded full-width panels instead of leaving unreachable resize handles.

## Configuration

Language supports English, playful Hong Kong-style Cantonese, and bilingual presentation. Independent English and Cantonese tone sliders style non-factual surrounding copy while status, dates, versions, commands, and safety facts remain exact. A dialog-emoji preference changes decoration without changing control labels or accessible names.

## Failure modes

- If a selected font is unavailable, the fallback is stated and the selection is retained.
- If a panel's saved position no longer fits the viewport, it is clamped into view and the prior value remains available through reset history.
- If speech synthesis or a selected voice is unavailable, the narrator remains off and the surface reports the exact limitation.
- A missing keyboard shortcut is never displayed in a context menu.

## Verification

The inventory covers keyboard-only use, semantic roles, focus return, 320-pixel reflow, portrait and landscape layouts, 100–200% display scales, bilingual labels, reduced motion, touch targets, overlay bounds, and panel recovery.

## Suggested articles

- [Appearance and app logo](appearance-and-logo.md)
- [Focus and attention modes](focus-and-attention.md)
- [Browser-only boundaries](browser-boundaries.md)
