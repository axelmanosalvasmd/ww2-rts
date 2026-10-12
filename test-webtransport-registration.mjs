import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { check } from './test-check.js';
await check('WebTransport child-file selection runs real nested assertions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ww2-registration-'));
  const helper = pathToFileURL(join(import.meta.dirname, 'test-check.js')).href;
  try {
    writeFileSync(join(dir, 'child.mjs'), `import {check} from ${JSON.stringify(helper)}; await check('inner assertion',()=>{console.log('INNER_EXECUTED');});`);
    writeFileSync(join(dir, 'parent.mjs'), `import {runFiles} from ${JSON.stringify(helper)}; await runFiles(['child.mjs'],{cwd:${JSON.stringify(dir)}});`);
    // Selected file on a non-first shard with a filename filter. Child must not inherit either selection.
    writeFileSync(join(dir, 'child.mjs'), `import {check} from ${JSON.stringify(helper)}; await check('inner assertion',()=>{throw Error('INNER_EXECUTED');});`);
    const result = spawnSync(process.execPath, [join(dir, 'parent.mjs')], { encoding: 'utf8', env: { ...process.env, WW2_TEST_ONLY: 'child', WW2_TEST_SHARD: '1/4' } });
    assert.equal(result.status, 1, 'inner deliberate failure must reach parent');
    assert.match(result.stderr, /INNER_EXECUTED/);
    assert.match(result.stderr, /1 failed/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
