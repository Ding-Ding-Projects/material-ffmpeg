#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const valueAfter = (flag, fallback = '') => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const commit = valueAfter('--commit');
const evidenceRoot = path.resolve(root, valueAfter('--evidence', 'artifacts/verification/captures'));
if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('--commit must be the exact 40-character candidate commit.');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'verification', 'capture-manifest.json'), 'utf8'));
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
const pngSignature = Buffer.from([137,80,78,71,13,10,26,10]);
const failures = [];
const verified = [];
for (const state of allStates) {
  const imagePath = path.join(evidenceRoot, `${state.id}.png`);
  const metadataPath = path.join(evidenceRoot, `${state.id}.json`);
  try {
    const image = fs.readFileSync(imagePath);
    if (image.length < 33 || !image.subarray(0, 8).equals(pngSignature)) throw new Error('not a decodable PNG signature');
    const width = image.readUInt32BE(16);
    const height = image.readUInt32BE(20);
    if (width !== state.viewport[0] || height !== state.viewport[1]) throw new Error(`PNG is ${width}x${height}; expected ${state.viewport.join('x')}`);
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    if (metadata.schemaVersion !== 1 || metadata.stateId !== state.id) throw new Error('metadata identity mismatch');
    if (metadata.commit !== commit) throw new Error('metadata commit mismatch');
    if (metadata.route !== manifest.allowedRoute) throw new Error(`route must be ${manifest.allowedRoute}`);
    if (manifest.forbiddenRoutes.includes(metadata.route) || metadata.visibleDesktopTouched !== false) throw new Error('visible or forbidden capture route');
    if (metadata.target !== state.target || typeof metadata.desktop !== 'string' || !metadata.desktop.startsWith('material-ffmpeg-')) throw new Error('target or named-desktop evidence missing');
    if (!Array.isArray(metadata.observedText) || state.requiredText.some((text) => !metadata.observedText.some((actual) => String(actual).includes(text)))) throw new Error('required visible text was not independently recorded');
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(metadata.capturedAt)) throw new Error('invalid capture timestamp');
    const digest = crypto.createHash('sha256').update(image).digest('hex');
    if (metadata.imageSha256 !== digest) throw new Error('PNG digest does not match metadata');
    if (!metadata.visualReview || metadata.visualReview.result !== 'accepted' ||
      typeof metadata.visualReview.notes !== 'string' || !metadata.visualReview.notes.trim() ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(metadata.visualReview.reviewedAt)) {
      throw new Error('real PNG was not opened and visually accepted with factual notes');
    }
    if (state.target === 'deployed-pages' && (!metadata.sourceUrl || !/^https:\/\//.test(metadata.sourceUrl))) throw new Error('deployed capture has no absolute HTTPS source URL');
    verified.push({ id: state.id, image: path.relative(root, imagePath).replaceAll('\\', '/'), width, height });
  } catch (error) {
    failures.push({ id: state.id, error: error.message });
  }
}
process.stdout.write(`${JSON.stringify({ commit, verified, failures }, null, 2)}\n`);
if (failures.length) process.exitCode = 2;
