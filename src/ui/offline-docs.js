'use strict';

/**
 * Packaged local documentation browser.
 *
 * The renderer owns no filesystem or network authority. The caller injects the
 * packaged API contract: `getManifest()`, `readArticle(id)`, `copyText(text)`,
 * and `exportArticle({ id, title, markdown })`. Every method resolves to
 * `{ ok: true, value }` or `{ ok: false, error }` (export may return
 * `{ ok: true, cancelled: true }`).
 */
const MAX_QUERY = 240;
const MAX_ARTICLES = 500;
const MAX_ARTICLE_BYTES = 512 * 1024;
const MAX_INDEX_BYTES = 4 * 1024 * 1024;

const text = (value) => String(value ?? '');
const clampText = (value, max) => text(value).slice(0, max);
const escapeHtml = (value) => text(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));

function markdownToHtml(markdown, { linkMap = {} } = {}) {
  const source = clampText(markdown, MAX_ARTICLE_BYTES);
  const lines = source.split(/\r?\n/);
  const output = [];
  let inCode = false;
  let code = [];
  let listOpen = false;
  const inline = (value) => escapeHtml(value)
    .replace(/\[([^\]]+)\]\(([^\s)]+)\)/g, (_, label, href) => {
      const target = linkMap[href] || linkMap[href.replace(/^\.\//, '')];
      if (target) return `<a href="#" data-doc-link="${escapeHtml(target)}">${label}</a>`;
      if (/^https:\/\//u.test(href)) return `<a href="${href}" rel="noreferrer">${label}</a>`;
      return `<span title="Unavailable offline link: ${escapeHtml(href)}">${label}</span>`;
    })
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  const closeList = () => { if (listOpen) { output.push('</ul>'); listOpen = false; } };
  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      if (inCode) { output.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`); code = []; }
      inCode = !inCode;
      continue;
    }
    if (inCode) { code.push(line); continue; }
    if (!line.trim()) { closeList(); continue; }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) { closeList(); output.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`); continue; }
    const item = line.match(/^\s*[-*]\s+(.+)$/);
    if (item) { if (!listOpen) { output.push('<ul>'); listOpen = true; } output.push(`<li>${inline(item[1])}</li>`); continue; }
    closeList();
    output.push(`<p>${inline(line)}</p>`);
  }
  if (inCode) output.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
  closeList();
  return output.join('');
}

function normalizeManifest(raw) {
  const rows = Array.isArray(raw) ? raw : raw?.articles;
  if (!Array.isArray(rows)) return { articles: [], limits: {}, linkMap: {} };
  const limits = raw && !Array.isArray(raw) && raw.limits && typeof raw.limits === 'object' ? raw.limits : {};
  const linkMap = raw && !Array.isArray(raw) && raw.linkMap && typeof raw.linkMap === 'object' ? raw.linkMap : {};
  const articles = rows.slice(0, Math.min(MAX_ARTICLES, Number(limits.maxArticles) || MAX_ARTICLES)).map((article, index) => ({
    id: clampText(article?.id ?? `article-${index + 1}`, 120),
    title: clampText(article?.title ?? article?.id ?? `Article ${index + 1}`, 240),
    summary: clampText(article?.summary ?? '', 360), bodyText: ''
  })).filter((article) => article.id && article.title);
  return { articles, limits, linkMap };
}

function createRegexBuilder({ onChange, initialPattern = '', initialFlags = '' } = {}) {
  const root = document.createElement('div');
  root.className = 'offline-docs-regex-builder';
  root.innerHTML = `<div role="dialog" aria-label="Regex builder" hidden>
    <label>Pattern <input data-pattern maxlength="240" type="text"></label>
    <label>Flags <input data-flags maxlength="8" type="text" value=""></label>
    <small data-feedback>Plain text search is active.</small>
    <div><button type="button" data-apply>Apply pattern</button><button type="button" data-close>Close</button></div>
  </div>`;
  const panel = root.firstElementChild;
  const pattern = panel.querySelector('[data-pattern]');
  const flags = panel.querySelector('[data-flags]');
  const feedback = panel.querySelector('[data-feedback]');
  pattern.value = clampText(initialPattern, MAX_QUERY);
  flags.value = clampText(initialFlags, 8);
  const report = () => {
    try {
      // Compile before applying, so malformed expressions never filter silently.
      // `u` is always included for deterministic Unicode matching.
      new RegExp(pattern.value, `${flags.value.replace(/[^dgimsuvy]/g, '')}`);
      feedback.textContent = pattern.value ? 'Pattern is valid.' : 'Plain text search is active.';
      return true;
    } catch (error) { feedback.textContent = `Invalid pattern: ${clampText(error.message, 160)}`; return false; }
  };
  panel.querySelector('[data-apply]').addEventListener('click', () => { if (report()) { onChange?.(clampText(pattern.value, MAX_QUERY), clampText(flags.value, 8)); panel.hidden = true; } });
  panel.querySelector('[data-close]').addEventListener('click', () => { panel.hidden = true; });
  return { root, open() { panel.hidden = false; pattern.focus(); report(); }, close() { panel.hidden = true; } };
}

export function mountOfflineDocsBrowser(container, api = {}) {
  if (!(container instanceof Element)) throw new TypeError('A container element is required');
  if (typeof api.getManifest !== 'function' || typeof api.readArticle !== 'function' || typeof api.copyText !== 'function' || typeof api.exportArticle !== 'function') {
    container.textContent = 'Offline documentation is unavailable: the local article API is not connected.';
    return { destroy() {} };
  }
  const state = { manifest: [], limits: {}, linkMap: {}, filtered: [], query: '', pattern: '', flags: '', regexMode: false, selected: 0, article: null, loading: false, error: '' };
  const root = document.createElement('section');
  root.className = 'offline-docs-browser';
  root.setAttribute('aria-label', 'Offline documentation');
  root.innerHTML = `<div class="offline-docs-toolbar"><label>Search documentation <input data-search type="search" maxlength="240" autocomplete="off"><button type="button" data-regex aria-haspopup="dialog" aria-expanded="false">Regex builder</button></label><button type="button" data-copy disabled>Copy article</button><button type="button" data-export disabled>Export Markdown</button></div><div class="offline-docs-layout"><nav aria-label="Documentation articles"><p data-status role="status"></p><ul data-list tabindex="0"></ul></nav><article data-article tabindex="-1"><p>Select an article to read it offline.</p></article></div>`;
  container.replaceChildren(root);
  const search = root.querySelector('[data-search]');
  const list = root.querySelector('[data-list]');
  const article = root.querySelector('[data-article]');
  const status = root.querySelector('[data-status]');
  const copy = root.querySelector('[data-copy]');
  const exportButton = root.querySelector('[data-export]');
  const regex = createRegexBuilder({ onChange(pattern, flags) { state.pattern = pattern; state.flags = flags; state.regexMode = Boolean(pattern); applyFilter(); render(); } });
  root.querySelector('[data-regex]').insertAdjacentElement('afterend', regex.root);

  const predicate = (record) => {
    const haystack = `${record.title}\n${record.summary}\n${record.bodyText || ''}`;
    if (!state.regexMode || !state.pattern) return haystack.toLocaleLowerCase().includes(state.query.toLocaleLowerCase());
    try { return new RegExp(state.pattern, state.flags).test(haystack); } catch { return false; }
  };
  function applyFilter() { state.filtered = state.manifest.filter(predicate); state.selected = Math.min(state.selected, Math.max(0, state.filtered.length - 1)); }
  function render() {
    const regexButton = root.querySelector('[data-regex]');
    regexButton.setAttribute('aria-expanded', String(!regex.root.firstElementChild.hidden));
    list.replaceChildren(...state.filtered.map((record, index) => { const item = document.createElement('li'); const button = document.createElement('button'); button.type = 'button'; button.dataset.index = String(index); button.textContent = record.title; button.setAttribute('aria-current', state.article?.id === record.id ? 'page' : 'false'); button.className = index === state.selected ? 'is-selected' : ''; button.addEventListener('click', () => openArticle(record)); item.append(button); return item; }));
    status.textContent = state.error || `${state.filtered.length} article${state.filtered.length === 1 ? '' : 's'} available offline.`;
    copy.disabled = !state.article; exportButton.disabled = !state.article;
    if (state.article) { article.innerHTML = `<h1>${escapeHtml(state.article.title)}</h1>${markdownToHtml(state.article.markdown, { linkMap: state.linkMap })}`; }
  }
  async function openArticle(record) {
    state.loading = true; state.error = ''; render();
    try { const response = await api.readArticle(record.id); if (!response?.ok) throw new Error(response?.error || 'Article content is missing.'); const raw = response.value; const markdown = typeof raw === 'string' ? raw : raw?.markdown; if (typeof markdown !== 'string') throw new Error('Article content is missing.'); state.article = { id: record.id, title: record.title, markdown: clampText(markdown, MAX_ARTICLE_BYTES) }; }
    catch (error) { state.article = null; state.error = `Article unavailable offline: ${clampText(error.message, 180)}`; }
    finally { state.loading = false; render(); article.focus(); }
  }
  search.addEventListener('input', () => { state.query = clampText(search.value, MAX_QUERY); state.regexMode = false; state.pattern = ''; applyFilter(); render(); });
  root.querySelector('[data-regex]').addEventListener('click', () => regex.open());
  article.addEventListener('click', (event) => { const link = event.target.closest('[data-doc-link]'); if (!link) return; event.preventDefault(); const target = state.manifest.find((record) => record.id === link.dataset.docLink); if (target) openArticle(target); else status.textContent = 'That documentation link is unavailable in this package.'; });
  list.addEventListener('keydown', (event) => { if (!state.filtered.length) return; if (event.key === 'ArrowDown') { event.preventDefault(); state.selected = Math.min(state.selected + 1, state.filtered.length - 1); render(); } else if (event.key === 'ArrowUp') { event.preventDefault(); state.selected = Math.max(state.selected - 1, 0); render(); } else if (event.key === 'Enter') { event.preventDefault(); openArticle(state.filtered[state.selected]); } });
  copy.addEventListener('click', async () => { if (!state.article) return; const response = await api.copyText(state.article.markdown); status.textContent = response?.ok ? 'Article copied to the clipboard.' : `Copy unavailable: ${clampText(response?.error || 'the local clipboard bridge is unavailable', 180)}`; });
  exportButton.addEventListener('click', async () => { if (!state.article) return; const response = await api.exportArticle(state.article); status.textContent = response?.ok ? (response.cancelled ? 'Export cancelled.' : 'Article export requested.') : `Export unavailable: ${clampText(response?.error || 'the local export bridge is unavailable', 180)}`; });
  (async () => {
    try {
      const response = await api.getManifest();
      if (!response?.ok) throw new Error(response?.error || 'No bundled manifest is available.');
      const normalized = normalizeManifest(response.value);
      state.manifest = normalized.articles; state.limits = normalized.limits; state.linkMap = Object.fromEntries(Object.entries(normalized.linkMap).slice(0, MAX_ARTICLES).map(([key, value]) => [clampText(key, 240), clampText(value, 120)]));
      let indexedBytes = 0;
      for (const record of state.manifest) {
        if (indexedBytes >= MAX_INDEX_BYTES) break;
        const articleResponse = await api.readArticle(record.id);
        if (!articleResponse?.ok) continue;
        const raw = articleResponse.value; const markdown = typeof raw === 'string' ? raw : raw?.markdown;
        if (typeof markdown !== 'string') continue;
        const bounded = clampText(markdown, MAX_ARTICLE_BYTES); const bytes = typeof TextEncoder === 'function' ? new TextEncoder().encode(bounded).byteLength : bounded.length;
        if (indexedBytes + bytes > MAX_INDEX_BYTES) continue;
        record.bodyText = bounded; indexedBytes += bytes;
      }
      applyFilter(); render(); if (state.manifest[0]) await openArticle(state.manifest[0]); else { state.error = 'No bundled documentation articles are available.'; render(); }
    } catch (error) { state.error = `Offline documentation manifest unavailable: ${clampText(error.message, 180)}`; render(); }
  })();
  return { destroy() { root.remove(); } };
}

export { markdownToHtml, normalizeManifest, createRegexBuilder };
