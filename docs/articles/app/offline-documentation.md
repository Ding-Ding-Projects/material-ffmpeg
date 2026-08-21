# Offline documentation browser

The packaged desktop application can expose a documentation browser without granting the renderer filesystem or network authority. The browser receives four injected functions from the trusted preload boundary. Each resolves to `{ ok: true, value }` or `{ ok: false, error }` (export may return `{ ok: true, cancelled: true }`):

```js
{
  async getManifest() {
    return { ok: true, value: { articles: [{ id: 'convert', title: 'Convert media', summary: 'Guided conversion' }] } };
  },
  async readArticle(id) {
    return { ok: true, value: { id, title: 'Convert media', markdown: '# Convert media\n\nChoose an input and output.' } };
  },
  async copyText(markdown) {
    return { ok: true, value: undefined };
  },
  async exportArticle(article) {
    return { ok: true, value: article.id };
  }
}
```

`getManifest` is bounded to 500 article records. Each record needs a stable `id` and visible `title`; `summary` is optional. `readArticle(id)` returns a Markdown string or an object with a `markdown` string. The UI truncates article content at 512 KiB and never reads a path, executes a command, or makes a request itself. Missing or malformed records stay visible as an honest unavailable state. Clipboard and export authority remain in the injected bridge; the renderer never calls browser clipboard or download APIs directly.

The search field is plain-text-first and bounded to 240 characters. The browser sequentially indexes article bodies through the injected bridge up to a bounded aggregate byte budget, so full text is searchable without reading files directly. Its adjacent **Regex builder** opens an anchored popover where users can enter a pattern and flags; patterns are compiled before being applied and invalid expressions remain a clear error rather than silently matching nothing. Article navigation works with mouse, <kbd>ArrowUp</kbd>/<kbd>ArrowDown</kbd>, and <kbd>Enter</kbd>. Internal Markdown links resolve through the manifest `linkMap` and open another bundled article; unknown local links stay non-operative with an honest unavailable tooltip. The selected article can be copied or exported through the trusted injected bridge (never a browser download). Both actions are disabled until a real article has loaded.

The article content is rendered locally with a small Markdown subset (headings, paragraphs, lists, emphasis, code, and HTTPS links). HTML is escaped before rendering, and the browser has no CDN, remote font, analytics, or network fallback. If the manifest or an article cannot be loaded from the injected packaged source, the browser says so and remains usable rather than showing a spinner forever.
