#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const inventoryPath = path.join(root, 'docs', 'feature-inventory.json');
const argumentsList = process.argv.slice(2);
const valueAfter = (flag, fallback) => {
  const index = argumentsList.indexOf(flag);
  return index >= 0 && argumentsList[index + 1] ? argumentsList[index + 1] : fallback;
};
const evidenceDirectory = path.resolve(root, valueAfter('--evidence', 'artifacts/verification/receipts'));
const outputPath = valueAfter('--output', '');
const expectedCommit = valueAfter('--commit', execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim());
const statuses = new Set(['working', 'failed', 'unrun', 'not-applicable']);
const fields = ['id', 'surface', 'feature', 'implementation', 'docs', 'localized', 'persistence', 'evidence'];
const requiredIds = new Set([
  'app-overview','app-convert','app-trim','app-filtergraph','app-audio','app-gif-thumbnails','app-presets','app-inspector','app-registry','app-hardware','app-streaming','app-composer','app-file-converter','app-jobs','app-runtime-boundary','app-tabs','app-command-palette','app-regex-builder','app-notifications','app-appearance','app-logo','app-super-confirmation','app-settings','app-offline-docs','app-local-ollama',
  'site-language-modes','site-funny-levels','site-emoji-toggle','site-personal-vocabulary','site-school-mode','site-narrator','site-scheduled-settings','site-dim-sum','site-tabs','site-tab-searches','site-regex-builders','site-command-palette','site-notifications','site-status-hub','site-material-design','site-appearance','site-logo','site-file-converter','site-ollama','site-toy-locks','site-support-tickets','site-authenticator','site-local-history','site-changelog','site-super-confirmation','site-external-editor','site-exports','site-bulk-actions','site-offline-docs','site-accessibility','site-mobile','site-overlays','site-menu-search','site-guided-forms','site-browser-download-dialogs','site-installer-download','site-local-privacy',
  'site-docs-browser-index','site-doc-readme','site-doc-agents','site-doc-handoff','site-doc-roadmap','site-doc-license','site-doc-third-party','site-doc-verification',
  'site-adhd-focus','site-adhd-low-stimulation','site-adhd-time-awareness','site-adhd-one-thing','site-adhd-momentum','site-adhd-integrations','site-open-graph-tags','site-open-graph-image','repository-social-preview-upload'
]);

const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
if (inventory.schemaVersion !== 1 || !Array.isArray(inventory.rows)) throw new Error('Unsupported feature inventory.');
const seen = new Set();
for (const row of inventory.rows) {
  for (const field of fields) if (typeof row[field] !== 'string' || !row[field].trim()) throw new Error(`Inventory row ${row.id || '<unknown>'} has no ${field}.`);
  if (seen.has(row.id)) throw new Error(`Duplicate feature inventory id: ${row.id}`);
  seen.add(row.id);
}
for (const id of requiredIds) if (!seen.has(id)) throw new Error(`Missing canonical feature inventory id: ${id}`);
if (seen.size !== inventory.rows.length) throw new Error('Feature inventory ids are not unique.');

function receiptFor(row) {
  if (row.evidence.startsWith('external-unverified:')) {
    return { status: 'unrun', note: row.evidence.slice('external-unverified:'.length).replaceAll('-', ' ') };
  }
  const receiptPath = path.join(evidenceDirectory, `${row.id}.json`);
  if (!fs.existsSync(receiptPath)) {
    const declaredPaths = [...row.implementation.split(';'), row.docs]
      .map((entry) => entry.split('#', 1)[0])
      .filter((entry) => /^(?:src|docs|resources)\//.test(entry) || /^(?:README|AGENTS|HANDOFF|ROADMAP|THIRD_PARTY_NOTICES|LICENSE|social-preview\.png)/.test(entry));
    const missing = declaredPaths.filter((entry) => !fs.existsSync(path.join(root, entry)));
    if (missing.length) return { status: 'failed', note: `Declared implementation or documentation is missing: ${missing.join(', ')}` };
    return { status: 'unrun', note: 'Declared files exist, but no exact-commit runtime evidence receipt exists.' };
  }
  try {
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    if (receipt.schemaVersion !== 1 || receipt.featureId !== row.id) throw new Error('identity mismatch');
    if (!statuses.has(receipt.status)) throw new Error('unknown status');
    if (receipt.commit !== expectedCommit) throw new Error(`receipt commit ${receipt.commit || '<missing>'} does not match ${expectedCommit}`);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(receipt.observedAt)) throw new Error('invalid UTC timestamp');
    if (typeof receipt.command !== 'string' || !receipt.command.trim()) throw new Error('missing command');
    if (!Array.isArray(receipt.evidence) || !receipt.evidence.length || receipt.evidence.some((item) => typeof item !== 'string' || !item.trim())) throw new Error('missing evidence list');
    if (receipt.status === 'working' && receipt.evidence.some((item) => /(?:mock|design|planned|pending)/i.test(item))) throw new Error('working receipt contains non-runtime evidence');
    return { status: receipt.status, note: receipt.note || '', receipt: path.relative(root, receiptPath).replaceAll('\\', '/'), evidence: receipt.evidence };
  } catch (error) {
    return { status: 'failed', note: `Invalid evidence receipt: ${error.message}` };
  }
}

const rows = inventory.rows.map((row) => ({ ...row, verdict: receiptFor(row) }));
const counts = Object.fromEntries([...statuses].map((status) => [status, rows.filter((row) => row.verdict.status === status).length]));
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  commit: expectedCommit,
  evidenceDirectory: path.relative(root, evidenceDirectory).replaceAll('\\', '/'),
  counts,
  complete: counts.failed === 0 && counts.unrun === 0 && counts['not-applicable'] === 0,
  externalLimitations: [{ featureId: 'repository-social-preview-upload', state: 'externally-unverified', reason: 'The gh CLI has no supported route for uploading a repository social preview.' }],
  rows
};
const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (outputPath) {
  const resolved = path.resolve(root, outputPath);
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error('Report output must stay inside the repository.');
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, serialized, 'utf8');
}
process.stdout.write(serialized);
process.exitCode = report.complete ? 0 : 2;
