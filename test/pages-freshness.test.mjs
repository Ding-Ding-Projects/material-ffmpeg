import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');

test('Pages deployment refuses a stale main commit', () => {
  assert.match(workflow, /- name: Ensure Pages source is still current main\s+id: freshness/);
  assert.match(workflow, /git fetch --no-tags --depth=1 origin main/);
  assert.match(workflow, /current_main="\$\(git rev-parse origin\/main\)"/);
  assert.match(workflow, /if \[\[ "\$current_main" == "\$GITHUB_SHA" \]\]; then/);
  assert.match(workflow, /echo "deploy=true" >> "\$GITHUB_OUTPUT"/);
  assert.match(workflow, /echo "deploy=false" >> "\$GITHUB_OUTPUT"/);
  const gatedSteps = workflow.match(/if: steps\.freshness\.outputs\.deploy == 'true'/g) || [];
  assert.equal(gatedSteps.length, 3, 'configure, upload, and deploy must all require a fresh main SHA');
});
