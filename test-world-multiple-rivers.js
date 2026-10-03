// Real socket movement through two-river and three-river worlds.
import { execFileSync } from 'node:child_process';
for (const seed of [1, 2])
  execFileSync(process.execPath, ['test-world-river.js'], {
    cwd: import.meta.dirname,
    env: { ...process.env, WORLD_RIVER_SEED: String(seed) },
    stdio: 'inherit',
    timeout: 180000,
  });
