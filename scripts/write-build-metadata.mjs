import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const packageJson = JSON.parse(await readFile(resolve('package.json'), 'utf8'));
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const metadata = {
  schemaVersion: 1,
  product: packageJson.productName,
  version: packageJson.version,
  commit,
  generatedAt: new Date().toISOString(),
  ffmpegVersion: '9.0.1',
  signing: 'unsigned'
};
const output = resolve('resources/build-metadata.json');
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
console.log(`[metadata] Pinned package metadata to ${commit}.`);
