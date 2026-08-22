import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('..', import.meta.url);
const readSource = (relativePath) => readFile(new URL(relativePath, root), 'utf8');

test('archive tab context menu owns its command click before outside dismissal', async () => {
  const source = await readSource('src/renderer.js');
  const contextMenu = source.slice(source.indexOf('let tabContextMenuActions = []'));
  assert.match(contextMenu, /function openArchiveContextMenu\(event, title, actions\)/);
  assert.match(contextMenu, /event\.stopPropagation\(\);/);
  assert.match(contextMenu, /button\.dataset\.contextAction = String\(index\);/);
  assert.match(contextMenu, /\$\('#ctx-menu'\)\.addEventListener\('click', \(event\) => \{/);
  assert.match(contextMenu, /const action = tabContextMenuActions\[Number\(button\.dataset\.contextAction\)\];/);
  assert.match(contextMenu, /action\?\.run\(\);/);
  assert.match(contextMenu, /document\.addEventListener\('pointerdown', \(event\) => \{/);
  assert.match(contextMenu, /const registryRow = event\.target\.closest\('\.registry-row'\);/);
  assert.match(contextMenu, /const jobRow = event\.target\.closest\('\.job-row'\);/);
  assert.match(contextMenu, /archive-context-menu-opened/);
});

test('archive search controls can shrink beside their regex builder', async () => {
  const css = await readSource('src/styles.css');
  assert.match(css, /\.search-line\{[^}]*min-width:0/);
  assert.match(css, /\.search-line input\{[^}]*min-width:0[^}]*flex:1 1 auto/);
  assert.match(css, /\.view-search\{[^}]*min-width:0[^}]*flex-wrap:wrap/);
  assert.match(css, /\.view-search input\{[^}]*min-width:0[^}]*max-width:100%[^}]*flex:1 1 230px/);
  assert.match(css, /\.page-head\{[^}]*min-width:0[^}]*flex-wrap:wrap/);
  assert.match(css, /\.head-actions\{[^}]*min-width:0[^}]*max-width:100%[^}]*flex-wrap:wrap/);
  assert.match(css, /\.ctx-menu \.ctx-rx\{width:32px;min-width:32px;[^}]*flex:0 0 32px/);
});
