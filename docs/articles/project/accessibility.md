# Accessibility

The desktop shell and project site include accessibility-oriented structure, but a source declaration is not interaction proof.

## Behavior

The source includes semantic dialogs and labels, roles on runtime catalog results, focusable buttons, explicit empty and error states, keyboard-accessible core controls, an emergency-exit action in destructive confirmation, reduced-motion CSS hooks, responsive layouts, and the `Ctrl+Shift+F` command-palette shortcut.

## Configuration

The desktop window has a minimum size of 960 by 640. Dialog widths are bounded against the viewport, long lists scroll internally, and renderer styles define focus and responsive behavior. The project site uses a viewport declaration and responsive CSS maintained under `docs/`.

## Failure modes

Accessibility can regress through clipped controls, missing focus restoration, insufficient contrast, inaccessible custom dropdowns, pointer-only dragging, or dialogs that cannot be operated at narrow widths. Custom select and context-menu replacements require real keyboard and screen-reader exercise. Source markup alone cannot prove assistive-technology behavior.

## Security considerations

Accessibility copy must not disclose absolute local paths, credentials, or private data. Errors should remain factual and should not be hidden behind animation, color, or icon-only states.

## Verification state

Relevant markup and styling hooks are present in source. This pass runs no keyboard-only, screen-reader, contrast, high-scale, narrow-width, touch, or screenshot checks.

## Suggested articles

- [Privacy and security](privacy-security.md)
- [Settings and preferences](settings-preferences.md)
- [Feature status ledger](feature-ledger.md)
