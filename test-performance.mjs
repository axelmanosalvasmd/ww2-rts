// Run each browser adapter in its own process so its globals cannot leak into another test.
import { execFileSync } from 'node:child_process';

for (const file of ['test-ground-performance.mjs', 'test-corpse-performance.mjs', 'test-client-performance.mjs', 'test-path-performance.mjs']) {
  execFileSync(process.execPath, [file], { cwd: import.meta.dirname, stdio: 'inherit', timeout: 60000 });
}
console.log('all performance regression checks passed');
