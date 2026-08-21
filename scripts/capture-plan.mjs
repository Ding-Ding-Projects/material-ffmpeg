#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'verification', 'capture-manifest.json'), 'utf8'));
const args = process.argv.slice(2);
const valueAfter = (flag, fallback = '') => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const commit = valueAfter('--commit');
const appExecutable = valueAfter('--app');
const siteUrl = valueAfter('--site', 'https://ding-ding-projects.github.io/material-ffmpeg/');
const output = valueAfter('--output');
if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('--commit must be the exact 40-character candidate commit.');
if (!output) throw new Error('--output is required; the plan is evidence data, not an implicit action.');
const desktop = `material-ffmpeg-${commit.slice(0, 12)}`;
const articleIndexPath = path.join(root, manifest.generatedArticleCoverage.index);
if (!fs.existsSync(articleIndexPath)) throw new Error(`Generated article index is missing: ${manifest.generatedArticleCoverage.index}`);
const articleIndex = JSON.parse(fs.readFileSync(articleIndexPath, 'utf8'));
if (!Array.isArray(articleIndex.articles) || !articleIndex.articles.length) throw new Error('Generated article index has no articles.');
const articleStates = articleIndex.articles.map((article) => {
  const id = article[manifest.generatedArticleCoverage.idField];
  const route = article[manifest.generatedArticleCoverage.routeField];
  const title = article[manifest.generatedArticleCoverage.titleField];
  if (!/^[a-z0-9-]{3,100}$/.test(id) || typeof route !== 'string' || !route.startsWith('/') || typeof title !== 'string' || !title.trim()) throw new Error('Generated article index contains an invalid id, route, or title.');
  return { id: `site-article-${id}`, target: 'deployed-pages', view: route, viewport: [390, 844], requiredText: [title] };
});
const allStates = [...manifest.states, ...articleStates];
if (new Set(allStates.map((state) => state.id)).size !== allStates.length) throw new Error('Capture state ids are not unique after article expansion.');
const states = allStates.map((state, index) => ({
  ...state,
  commit,
  route: manifest.allowedRoute,
  desktop,
  output: `artifacts/verification/captures/${state.id}.png`,
  metadata: `artifacts/verification/captures/${state.id}.json`,
  sequence: state.target === 'packaged-app' ? [
    { tool: 'create_headless_desktop', args: { name: desktop } },
    { tool: 'launch_on_headless_desktop', args: { name: desktop, executable: appExecutable || '<required-packaged-executable>', arguments: [`--remote-debugging-port=${9400 + index}`, `--user-data-dir=<task-profile-${state.id}>`] } },
    { tool: 'list_headless_windows', args: { name: desktop }, rule: 'Resolve the current HWND dynamically; never retain a prior handle.' },
    { tool: 'drive_packaged_electron', rule: 'Use the exact isolated CDP target launched on this named headless desktop. Never inject a mock bridge or alter application state outside real controls.' },
    { tool: 'capture_packaged_electron', rule: 'Use Page.captureScreenshot on the exact isolated target, then inspect the PNG. Do not use visible UI.' }
  ] : [
    { tool: 'create_headless_desktop', args: { name: desktop } },
    { tool: 'launch_on_headless_desktop', args: { name: desktop, executable: '<installed-edge>', arguments: ['--guest','--disable-sync','--disable-extensions','--disable-component-extensions-with-background-pages','--no-first-run','--no-default-browser-check',`--remote-debugging-port=${9700 + index}`,`--user-data-dir=<task-profile-${state.id}>`,`--app=${siteUrl}`] } },
    { tool: 'verify_isolated_cdp_target', rule: 'The entire /json/list array must contain exactly one page whose normalized URL equals the expected site URL.' },
    { tool: 'drive_deployed_page', rule: 'Use real controls and synchronous bounded CDP evaluation without awaitPromise.' },
    { tool: 'capture_deployed_page', rule: 'Capture the real deployed page at the requested viewport and inspect the PNG.' }
  ]
}));
const plan = {
  schemaVersion: 1,
  commit,
  generatedAt: new Date().toISOString(),
  route: manifest.allowedRoute,
  forbiddenRoutes: manifest.forbiddenRoutes,
  beforeAnyCapture: ['Confirm the exact packaged executable or deployed URL.', 'Create a fresh task-only profile.', 'Resolve window and target identities dynamically.', 'Keep the visible desktop, cursor, keyboard focus, and foreground application untouched.'],
  afterAllCaptures: ['Close the exact application and browser process trees.', 'Close the named headless desktop.', 'Delete only the task profiles created by this plan.', 'Run scripts/capture-verify.mjs against the exact commit.'],
  states
};
const resolved = path.resolve(root, output);
if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error('Plan output must stay inside the repository.');
fs.mkdirSync(path.dirname(resolved), { recursive: true });
fs.writeFileSync(resolved, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
process.stdout.write(`${resolved}\n`);
