(function materialFfmpegDocsModule(global) {
  'use strict';

  const MAX_QUERY_LENGTH = 512;
  const MAX_ARTICLE_BYTES = 512 * 1024;
  const DEFAULT_CATEGORY = 'all';

  const state = {
    articles: [],
    categories: [],
    selectedCategory: DEFAULT_CATEGORY,
    selectedArticle: null,
    query: '',
    regexEnabled: false,
    regexFlags: 'i',
    regexError: '',
    mount: null,
    coreApi: null,
    releases: null,
    regexController: null,
  };

  const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

  const escapeAttribute = (value) => escapeHtml(value).replaceAll('`', '&#96;');

  function safeLinkTarget(target) {
    const value = String(target || '').trim();
    if (/^(https:\/\/|mailto:|#|\.\.?\/)/i.test(value)) return value;
    return '#';
  }

  function resolveArticleTarget(target) {
    const cleanTarget = String(target || '').split('#')[0].replaceAll('\\', '/');
    if (!cleanTarget.toLowerCase().endsWith('.md')) return null;
    const basename = cleanTarget.split('/').pop();
    return state.articles.find((article) => article.path.replaceAll('\\', '/').endsWith(`/${basename}`)) || null;
  }

  function inlineMarkdown(text) {
    let value = escapeHtml(text);
    value = value.replace(/`([^`]+)`/g, '<code>$1</code>');
    value = value.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    value = value.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    value = value.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, target) => {
      const article = resolveArticleTarget(target);
      if (article) return `<a href="#docs-${escapeAttribute(article.id)}" data-docs-open="${escapeAttribute(article.id)}">${label}</a>`;
      const href = safeLinkTarget(target);
      const external = /^https:\/\//i.test(href);
      return `<a href="${escapeAttribute(href)}"${external ? ' target="_blank" rel="noreferrer"' : ''}>${label}</a>`;
    });
    return value;
  }

  function tableCells(line) {
    return String(line || '')
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((cell) => cell.trim());
  }

  function isTableDivider(line) {
    const cells = tableCells(line);
    return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
  }

  function renderMarkdown(source) {
    const lines = String(source || '').replace(/\r\n?/g, '\n').split('\n');
    const html = [];
    let paragraph = [];
    let listType = null;
    let inCode = false;
    let codeLanguage = '';
    let code = [];

    const flushParagraph = () => {
      if (!paragraph.length) return;
      html.push(`<p>${inlineMarkdown(paragraph.join(' '))}</p>`);
      paragraph = [];
    };
    const closeList = () => {
      if (!listType) return;
      html.push(`</${listType}>`);
      listType = null;
    };
    const flushCode = () => {
      html.push(`<pre tabindex="0" aria-label="Code example"><code${codeLanguage ? ` class="language-${escapeAttribute(codeLanguage)}"` : ''}>${escapeHtml(code.join('\n'))}</code></pre>`);
      code = [];
      codeLanguage = '';
    };

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex];
      const fence = line.match(/^```\s*([\w-]*)\s*$/);
      if (fence) {
        flushParagraph();
        closeList();
        if (inCode) flushCode();
        else codeLanguage = fence[1] || '';
        inCode = !inCode;
        continue;
      }
      if (inCode) {
        code.push(line);
        continue;
      }
      if (!line.trim()) {
        flushParagraph();
        closeList();
        continue;
      }
      if (line.includes('|') && isTableDivider(lines[lineIndex + 1] || '')) {
        flushParagraph();
        closeList();
        const headers = tableCells(line);
        const rows = [];
        lineIndex += 2;
        while (lineIndex < lines.length && lines[lineIndex].trim() && lines[lineIndex].includes('|')) {
          rows.push(tableCells(lines[lineIndex]));
          lineIndex += 1;
        }
        lineIndex -= 1;
        html.push(`<div class="docs-table-wrap" tabindex="0" role="region" aria-label="Scrollable documentation table"><table><thead><tr>${headers.map((cell) => `<th scope="col">${inlineMarkdown(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${headers.map((_header, index) => `<td>${inlineMarkdown(row[index] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
        continue;
      }
      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      if (heading) {
        flushParagraph();
        closeList();
        if (heading[1].length === 1) continue;
        const level = Math.min(6, heading[1].length + 2);
        html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
        continue;
      }
      const bullet = line.match(/^\s*[-*]\s+(.+)$/);
      const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
      if (bullet || ordered) {
        flushParagraph();
        const wanted = bullet ? 'ul' : 'ol';
        if (listType !== wanted) {
          closeList();
          listType = wanted;
          html.push(`<${listType}>`);
        }
        html.push(`<li>${inlineMarkdown((bullet || ordered)[1])}</li>`);
        continue;
      }
      const quote = line.match(/^>\s?(.*)$/);
      if (quote) {
        flushParagraph();
        closeList();
        html.push(`<blockquote>${inlineMarkdown(quote[1])}</blockquote>`);
        continue;
      }
      const rule = /^-{3,}$/.test(line.trim());
      if (rule) {
        flushParagraph();
        closeList();
        html.push('<hr>');
        continue;
      }
      paragraph.push(line.trim());
    }
    if (inCode) flushCode();
    flushParagraph();
    closeList();
    return html.join('\n');
  }

  async function loadJson(url) {
    const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) throw new Error(`Could not load ${url} (HTTP ${response.status}).`);
    return response.json();
  }

  async function loadArticle(entry) {
    try {
      const response = await fetch(entry.path, { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const contentLength = Number(response.headers.get('content-length') || 0);
      if (contentLength > MAX_ARTICLE_BYTES) throw new Error('Article exceeds the local size limit.');
      const body = await response.text();
      if (new Blob([body]).size > MAX_ARTICLE_BYTES) throw new Error('Article exceeds the local size limit.');
      return { ...entry, body, status: 'ready', error: '' };
    } catch (error) {
      return { ...entry, body: '', status: 'missing', error: error.message || 'Article could not be loaded.' };
    }
  }

  function resolveMount(coreApi) {
    if (coreApi && coreApi.mount instanceof HTMLElement) return coreApi.mount;
    if (coreApi && typeof coreApi.getMount === 'function') {
      const candidate = coreApi.getMount('documentation');
      if (candidate instanceof HTMLElement) return candidate;
    }
    return document.querySelector('[data-module-mount="docs"], [data-material-ffmpeg-docs], #docs-browser, #documentation');
  }

  function categoryLabel(category) {
    const found = state.categories.find((item) => item.id === category);
    return found ? found.label : category;
  }

  function buildMatcher() {
    const query = state.query.slice(0, MAX_QUERY_LENGTH);
    state.regexError = '';
    if (state.regexController) {
      return (value) => {
        const candidate = String(value || '');
        const chunkSize = 60 * 1024;
        const overlap = 1024;
        for (let offset = 0; offset < candidate.length || offset === 0; offset += chunkSize - overlap) {
          const result = state.regexController.matches(candidate.slice(offset, offset + chunkSize));
          if (!result.ok) {
            state.regexError = result.error || 'The search expression is invalid.';
            return false;
          }
          if (result.matched) return true;
          if (candidate.length <= chunkSize) break;
        }
        return false;
      };
    }
    if (!query) return () => true;
    if (!state.regexEnabled) {
      const normalized = query.toLocaleLowerCase();
      return (value) => String(value || '').toLocaleLowerCase().includes(normalized);
    }
    try {
      const allowedFlags = [...new Set(state.regexFlags.replace(/[^gimsuy]/g, '').split(''))].join('');
      if (/\\[1-9]/.test(query) || /\([^)]*[+*][^)]*\)[+*{]/.test(query) || /(\.\*|\.\+).*(\.\*|\.\+)/.test(query)) {
        throw new Error('This expression is rejected because it can require unsafe backtracking.');
      }
      const expression = new RegExp(query, allowedFlags.replace('g', ''));
      return (value) => {
        const candidate = String(value || '');
        const chunkSize = 60 * 1024;
        for (let offset = 0; offset < candidate.length || offset === 0; offset += chunkSize - 1024) {
          expression.lastIndex = 0;
          if (expression.test(candidate.slice(offset, offset + chunkSize))) return true;
          if (candidate.length <= chunkSize) break;
        }
        return false;
      };
    } catch (error) {
      state.regexError = error.message || 'Invalid regular expression.';
      return () => false;
    }
  }

  function filteredArticles() {
    const matcher = buildMatcher();
    return state.articles.filter((article) => {
      const categoryMatches = state.selectedCategory === DEFAULT_CATEGORY || article.category === state.selectedCategory;
      const haystack = `${article.title}\n${article.summary || ''}\n${article.body || ''}`;
      return categoryMatches && matcher(haystack);
    });
  }

  function notify(message, type = 'info') {
    if (state.coreApi && typeof state.coreApi.notify === 'function') {
      state.coreApi.notify({ title: 'Documentation', body: message, kind: type });
      return;
    }
    const live = state.mount && state.mount.querySelector('[data-docs-live]');
    if (live) live.textContent = message;
  }

  function renderReleaseSummary() {
    if (!state.releases || !Array.isArray(state.releases.releases) || !state.releases.releases.length) {
      return '<p class="docs-empty">No verified release has been recorded in the local release data yet.</p>';
    }
    return `<div class="docs-release-list">${state.releases.releases.map((release) => `
      <article class="docs-release-card">
        <h4>${escapeHtml(release.version || 'Unknown version')}</h4>
        <dl>
          <div><dt>Status</dt><dd>${escapeHtml(release.status || 'Unknown')}</dd></div>
          <div><dt>Commit</dt><dd><code>${escapeHtml(release.commit || 'Not recorded')}</code></dd></div>
          <div><dt>Published</dt><dd>${escapeHtml(release.publishedAt || 'Not recorded')}</dd></div>
        </dl>
        ${release.url ? `<a href="${escapeAttribute(safeLinkTarget(release.url))}" target="_blank" rel="noreferrer">Open release</a>` : ''}
      </article>`).join('')}</div>`;
  }

  function renderShell() {
    state.mount.innerHTML = `
      <section class="docs-browser" aria-labelledby="docs-browser-title">
        <header class="docs-browser__header">
          <div>
            <p class="docs-browser__eyebrow">PROJECT DOCUMENTATION</p>
            <h2 id="docs-browser-title">Documentation browser</h2>
            <p>Search the complete local article set, inspect verification boundaries, and export the exact Markdown.</p>
          </div>
          <div class="docs-browser__actions">
            <button type="button" data-docs-copy disabled>Copy article</button>
            <button type="button" data-docs-export disabled>Export Markdown</button>
          </div>
        </header>
        <div class="docs-search" role="search">
          <label for="docs-search-input">Search documentation</label>
          <div class="docs-search__row">
            <input id="docs-search-input" type="search" maxlength="${MAX_QUERY_LENGTH}" autocomplete="off" placeholder="Search titles and article text">
            <button type="button" class="docs-regex-toggle" aria-expanded="false" aria-controls="docs-regex-panel">Regex builder</button>
          </div>
          <div id="docs-regex-panel" class="docs-regex" hidden>
            <label><input type="checkbox" data-docs-regex-enabled> Use JavaScript regular expression</label>
            <label for="docs-regex-flags">Flags</label>
            <input id="docs-regex-flags" data-docs-regex-flags value="i" maxlength="6" inputmode="text" aria-describedby="docs-regex-help">
            <p id="docs-regex-help">Supported flags: g, i, m, s, u, y. Search stays local and is bounded to 512 characters.</p>
          </div>
          <p class="docs-search__status" data-docs-search-status aria-live="polite"></p>
        </div>
        <div class="docs-tabs" role="tablist" aria-label="Documentation categories" data-docs-categories></div>
        <div class="docs-browser__layout">
          <nav class="docs-article-list" aria-label="Articles" data-docs-list></nav>
          <article class="docs-article" tabindex="-1" data-docs-article>
            <div class="docs-empty-state">
              <h3>Select an article</h3>
              <p>The article list includes project records, application behavior, delivery details, security, accessibility, and site modules.</p>
            </div>
          </article>
        </div>
        <details class="docs-release-data">
          <summary>Release history data</summary>
          <div data-docs-releases>${renderReleaseSummary()}</div>
        </details>
        <p class="docs-sr-live" data-docs-live aria-live="polite"></p>
      </section>`;
  }

  function renderCategories() {
    const host = state.mount.querySelector('[data-docs-categories]');
    const categories = [{ id: DEFAULT_CATEGORY, label: 'All articles' }, ...state.categories];
    host.innerHTML = categories.map((category, index) => {
      const selected = category.id === state.selectedCategory;
      return `<button type="button" role="tab" id="docs-tab-${escapeAttribute(category.id)}" aria-selected="${selected}" tabindex="${selected ? '0' : '-1'}" data-category="${escapeAttribute(category.id)}">${escapeHtml(category.label)}${index ? '' : ` <span>(${state.articles.length})</span>`}</button>`;
    }).join('');
  }

  function renderList() {
    const articles = filteredArticles();
    const list = state.mount.querySelector('[data-docs-list]');
    const status = state.mount.querySelector('[data-docs-search-status]');
    status.textContent = state.regexError || `${articles.length} article${articles.length === 1 ? '' : 's'} shown.`;
    status.dataset.error = state.regexError ? 'true' : 'false';
    if (!articles.length) {
      list.innerHTML = `<div class="docs-empty-state"><h3>No matching articles</h3><p>${state.regexError ? 'Correct the regular expression to search again.' : 'Clear the search or choose another category.'}</p></div>`;
      return;
    }
    list.innerHTML = articles.map((article) => `
      <button type="button" class="docs-article-link" data-article-id="${escapeAttribute(article.id)}" aria-current="${article.id === state.selectedArticle ? 'page' : 'false'}">
        <span>${escapeHtml(article.title)}</span>
        <small>${escapeHtml(categoryLabel(article.category))}${article.status === 'missing' ? ' · unavailable' : ''}</small>
      </button>`).join('');
  }

  function renderArticle(focus = false) {
    const host = state.mount.querySelector('[data-docs-article]');
    const copy = state.mount.querySelector('[data-docs-copy]');
    const exportButton = state.mount.querySelector('[data-docs-export]');
    const article = state.articles.find((item) => item.id === state.selectedArticle);
    copy.disabled = !article || article.status !== 'ready';
    exportButton.disabled = !article || article.status !== 'ready';
    if (!article) {
      host.innerHTML = '<div class="docs-empty-state"><h3>Select an article</h3><p>Choose an article from the list to read its local Markdown content.</p></div>';
      return;
    }
    if (article.status !== 'ready') {
      host.innerHTML = `<div class="docs-empty-state docs-empty-state--error"><h3>${escapeHtml(article.title)} is unavailable</h3><p>${escapeHtml(article.error || 'The local article could not be loaded.')}</p><p>No substitute content has been shown.</p></div>`;
    } else {
      host.innerHTML = `
        <header class="docs-article__header">
          <p>${escapeHtml(categoryLabel(article.category))}</p>
          <h3>${escapeHtml(article.title)}</h3>
          <p>${escapeHtml(article.summary || '')}</p>
        </header>
        <div class="docs-markdown">${renderMarkdown(article.body)}</div>`;
    }
    if (focus) host.focus({ preventScroll: true });
  }

  function renderAll(focusArticle = false) {
    renderCategories();
    renderList();
    renderArticle(focusArticle);
  }

  async function copySelected() {
    const article = state.articles.find((item) => item.id === state.selectedArticle && item.status === 'ready');
    if (!article) return;
    try {
      await navigator.clipboard.writeText(article.body);
      notify(`Copied ${article.title}.`, 'success');
    } catch (_error) {
      const textarea = document.createElement('textarea');
      textarea.value = article.body;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.append(textarea);
      textarea.select();
      const copied = document.execCommand('copy');
      textarea.remove();
      notify(copied ? `Copied ${article.title}.` : 'Copy was not available in this browser.', copied ? 'success' : 'error');
    }
  }

  function exportSelected() {
    const article = state.articles.find((item) => item.id === state.selectedArticle && item.status === 'ready');
    if (!article) return;
    const blob = new Blob([article.body], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${article.id.replace(/[^a-z0-9-]+/gi, '-')}.md`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    notify(`Exported ${article.title} as Markdown.`, 'success');
  }

  function bindEvents() {
    state.mount.addEventListener('click', (event) => {
      const category = event.target.closest('[data-category]');
      if (category) {
        state.selectedCategory = category.dataset.category;
        renderAll();
        return;
      }
      const article = event.target.closest('[data-article-id]');
      if (article) {
        state.selectedArticle = article.dataset.articleId;
        renderAll(true);
        return;
      }
      const linkedArticle = event.target.closest('[data-docs-open]');
      if (linkedArticle) {
        event.preventDefault();
        state.selectedArticle = linkedArticle.dataset.docsOpen;
        const selected = state.articles.find((item) => item.id === state.selectedArticle);
        if (selected) state.selectedCategory = selected.category;
        renderAll(true);
        return;
      }
      if (event.target.closest('.docs-regex-toggle')) {
        const button = event.target.closest('.docs-regex-toggle');
        if (state.regexController) {
          state.regexController.toggle();
          button.setAttribute('aria-expanded', String(state.regexController.isOpen));
          return;
        }
        const panel = state.mount.querySelector('#docs-regex-panel');
        panel.hidden = !panel.hidden;
        button.setAttribute('aria-expanded', String(!panel.hidden));
        if (!panel.hidden) panel.querySelector('input').focus();
        return;
      }
      if (event.target.closest('[data-docs-copy]')) copySelected();
      if (event.target.closest('[data-docs-export]')) exportSelected();
    });

    state.mount.querySelector('#docs-search-input').addEventListener('input', (event) => {
      state.query = event.target.value.slice(0, MAX_QUERY_LENGTH);
      renderList();
    });
    state.mount.querySelector('#docs-search-input').addEventListener('material-ffmpeg-regex-change', () => {
      const controllerState = state.regexController?.getState();
      if (controllerState) {
        state.query = controllerState.mode === 'regex' ? controllerState.pattern : controllerState.query;
        state.regexEnabled = controllerState.mode === 'regex';
        state.regexFlags = controllerState.flags;
      }
      renderList();
    });
    state.mount.querySelector('[data-docs-regex-enabled]').addEventListener('change', (event) => {
      state.regexEnabled = event.target.checked;
      renderList();
    });
    state.mount.querySelector('[data-docs-regex-flags]').addEventListener('input', (event) => {
      state.regexFlags = event.target.value;
      renderList();
    });
    state.mount.querySelector('[data-docs-categories]').addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const tabs = [...event.currentTarget.querySelectorAll('[role="tab"]')];
      const current = tabs.indexOf(document.activeElement);
      let next = current;
      if (event.key === 'ArrowRight') next = (current + 1) % tabs.length;
      if (event.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      event.preventDefault();
      tabs[next].focus();
      tabs[next].click();
    });
  }

  function descriptor() {
    return {
      status: 'available',
      message: 'The complete local project article catalog is available with full-text and regular-expression search.',
      mount(host, api) {
        void init(Object.assign({}, api, { mount: host }));
      },
      commands: [
        {
          id: 'docs-open-browser',
          label: 'Open documentation browser',
          category: 'Documentation',
          keywords: 'articles project records help',
          run: () => global.MaterialFFmpegSite?.openTab('docs'),
        },
        {
          id: 'docs-search-articles',
          label: 'Search project documentation',
          category: 'Documentation',
          keywords: 'full text regex articles',
          run: () => {
            global.MaterialFFmpegSite?.openTab('docs', { focus: false });
            global.requestAnimationFrame(() => state.mount?.querySelector('#docs-search-input')?.focus());
          },
        },
        {
          id: 'docs-release-history',
          label: 'Open release history documentation',
          category: 'Documentation',
          keywords: 'versions installer release commit',
          run: () => {
            global.MaterialFFmpegSite?.openTab('docs', { focus: false });
            global.requestAnimationFrame(() => {
              state.selectedArticle = state.articles.find((item) => item.id === 'update-release')?.id || state.selectedArticle;
              renderAll(true);
            });
          },
        },
      ],
    };
  }

  function init(coreApi = {}) {
    state.coreApi = coreApi;
    state.mount = resolveMount(coreApi);
    if (!state.mount) return descriptor();
    return mountDocumentation(coreApi);
  }

  async function mountDocumentation(coreApi) {
    state.mount.innerHTML = '<div class="docs-loading" role="status">Loading local documentation…</div>';
    try {
      const manifestUrl = coreApi.manifestUrl || 'articles/index.json';
      const releaseUrl = coreApi.releaseDataUrl || 'release-data.json';
      const [manifest, releaseResult] = await Promise.all([
        loadJson(manifestUrl),
        loadJson(releaseUrl).catch((error) => ({ schemaVersion: 1, releases: [], error: error.message })),
      ]);
      if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.articles) || !Array.isArray(manifest.categories)) {
        throw new Error('The local documentation manifest is invalid or unsupported.');
      }
      state.categories = manifest.categories;
      state.releases = releaseResult;
      state.articles = await Promise.all(manifest.articles.map(loadArticle));
      state.selectedArticle = manifest.defaultArticle || state.articles.find((item) => item.status === 'ready')?.id || null;
      renderShell();
      const searchInput = state.mount.querySelector('#docs-search-input');
      if (global.MaterialFfmpegRegexBuilder && typeof global.MaterialFfmpegRegexBuilder.attach === 'function') {
        state.regexController = global.MaterialFfmpegRegexBuilder.attach(searchInput, {
          storageKey: 'material-ffmpeg-regex-docs-search',
          limits: { queryLength: MAX_QUERY_LENGTH, patternLength: MAX_QUERY_LENGTH, candidateLength: 64 * 1024 },
        });
        const fallbackTrigger = state.mount.querySelector('.docs-regex-toggle');
        if (fallbackTrigger) fallbackTrigger.hidden = true;
        if (state.regexController.launcher) state.regexController.launcher.hidden = false;
        state.mount.querySelector('#docs-regex-panel').hidden = true;
      }
      bindEvents();
      renderAll();
      if (typeof coreApi.bindRegexBuilder === 'function') {
        coreApi.bindRegexBuilder({
          input: state.mount.querySelector('#docs-search-input'),
          trigger: state.mount.querySelector('.docs-regex-toggle'),
          panel: state.mount.querySelector('#docs-regex-panel'),
          setPattern(pattern, flags = 'i', enabled = true) {
            setSearchPattern(pattern, flags, enabled);
          },
        });
      }
      state.mount.dispatchEvent(new CustomEvent('material-ffmpeg-docs-ready', {
        bubbles: true,
        detail: { articleCount: state.articles.length, missingCount: state.articles.filter((item) => item.status !== 'ready').length },
      }));
      return { ok: true, articleCount: state.articles.length };
    } catch (error) {
      state.mount.innerHTML = `<div class="docs-empty-state docs-empty-state--error" role="alert"><h2>Documentation is unavailable</h2><p>${escapeHtml(error.message || 'The local documentation could not be loaded.')}</p><p>No remote fallback was attempted.</p></div>`;
      return { ok: false, reason: error.message };
    }
  }

  function setSearchPattern(pattern, flags = 'i', enabled = true) {
    state.query = String(pattern || '').slice(0, MAX_QUERY_LENGTH);
    state.regexFlags = String(flags || '').slice(0, 6);
    state.regexEnabled = Boolean(enabled);
    if (!state.mount) return;
    if (state.regexController) {
      state.regexController.setState({
        mode: state.regexEnabled ? 'regex' : 'plain',
        query: state.regexEnabled ? '' : state.query,
        pattern: state.regexEnabled ? state.query : '',
        flags: state.regexFlags,
      });
      return;
    }
    const input = state.mount.querySelector('#docs-search-input');
    const flagInput = state.mount.querySelector('[data-docs-regex-flags]');
    const enabledInput = state.mount.querySelector('[data-docs-regex-enabled]');
    if (input) input.value = state.query;
    if (flagInput) flagInput.value = state.regexFlags;
    if (enabledInput) enabledInput.checked = state.regexEnabled;
    renderList();
  }

  global.MaterialFFmpegDocs = Object.freeze({ init, setSearchPattern, renderMarkdown, descriptor });
})(window);
