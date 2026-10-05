// Run each browser adapter in its own process so its globals cannot leak into another test.
import { execFileSync } from 'node:child_process';

// Share the caller's four-minute budget, with the standard three-minute child limit.
const deadline = performance.now() + 240000;
for (const file of ['test-ground-performance.mjs', 'test-corpse-performance.mjs', 'test-client-performance.mjs', 'test-path-performance.mjs']) {
  const remaining = Math.floor(deadline - performance.now());
  if (remaining <= 0) throw new Error('Performance regression checks exhausted their four-minute budget');
  execFileSync(process.execPath, [file], { cwd: import.meta.dirname, stdio: 'inherit', timeout: Math.min(180000, remaining) });
}
console.log('all performance regression checks passed');
