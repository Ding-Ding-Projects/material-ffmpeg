#!/usr/bin/env node
/* Validate the product-owned Material Symbols inventory against supplied local font metadata. */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const inventoryPath = path.resolve(process.cwd(), 'src/assets/icon-ligatures.json');
const metadataPath = process.argv[2] ? path.resolve(process.cwd(), process.argv[2]) : '';

const fail = (message) => {
  console.error(`icon ligature validation failed: ${message}`);
  process.exitCode = 1;
};

if (!fs.existsSync(inventoryPath)) {
  fail(`inventory not found: ${path.relative(process.cwd(), inventoryPath)}`);
  process.exit();
}

let inventory;
try {
  inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
} catch (error) {
  fail(`inventory is not valid JSON (${error.message})`);
  process.exit();
}

if (inventory?.schemaVersion !== 1) fail('inventory schemaVersion must be 1');
if (!Array.isArray(inventory?.names) || inventory.names.length === 0) fail('inventory names must be a non-empty array');

const namePattern = /^[a-z][a-z0-9_]*$/u;
const names = inventory.names;
const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
if (duplicates.length) fail(`duplicate names: ${[...new Set(duplicates)].join(', ')}`);
for (const name of names) if (typeof name !== 'string' || !namePattern.test(name)) fail(`invalid ligature name: ${JSON.stringify(name)}`);

const inventoryNameSet = new Set(names);
for (const use of [...(inventory.uses || []), ...(inventory.dynamicUses || [])]) {
  for (const name of use.names || [use.fallback, ...(use.knownValues || [])]) {
    if (name && !inventoryNameSet.has(name)) fail(`usage references name absent from inventory: ${name}`);
  }
}

if (!metadataPath) {
  fail('supply official local font metadata as the first argument (for example: node scripts/validate-icon-ligatures.mjs path/to/metadata.json)');
  process.exit();
}
if (!fs.existsSync(metadataPath)) {
  fail(`font metadata not found: ${path.relative(process.cwd(), metadataPath)}`);
  process.exit();
}

let metadata;
let metadataText;
try {
  metadataText = fs.readFileSync(metadataPath, 'utf8');
  metadata = JSON.parse(metadataText);
} catch (error) {
  metadata = null;
}

const extractNames = (value) => {
  if (Array.isArray(value)) return value.filter((entry) => typeof entry === 'string');
  if (!value || typeof value !== 'object') return [];
  const result = [];
  for (const key of ['names', 'ligatures', 'icons', 'iconNames', 'glyphs']) {
    if (Array.isArray(value[key])) result.push(...extractNames(value[key]));
  }
  return result;
};
const metadataNames = new Set(extractNames(metadata));
if (!metadataNames.size && typeof metadataText === 'string') {
  for (const line of metadataText.split(/\r?\n/u)) {
    const name = line.trim().split(/\s+/u)[0];
    if (name && namePattern.test(name)) metadataNames.add(name);
  }
}
if (metadataNames.size === 0) {
  fail('font metadata must be JSON exposing names, ligatures, icons, iconNames, or glyphs, or a codepoint list with one ligature name per line');
  process.exit();
}

const unsupported = names.filter((name) => !metadataNames.has(name));
if (unsupported.length) fail(`unsupported names in the supplied font metadata: ${unsupported.join(', ')}`);

if (!process.exitCode) {
  console.log(`icon ligatures verified: ${names.length} names present in ${path.relative(process.cwd(), metadataPath)}`);
}
