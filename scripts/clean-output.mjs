import { rm } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

const root = resolve('.');
const target = resolve(root, 'dist', 'squirrel-windows');
const relation = relative(root, target);
if (relation.startsWith('..') || relation === '') throw new Error(`Refusing to clean unexpected output path: ${target}`);
await rm(target, { recursive: true, force: true });
console.log(`[package] Cleared generated output: ${target}`);
