// Named checks for the suite. A failed check is reported and the run goes on; the process exits 1 at the end.
//   WW2_TEST_ONLY=text   run only checks whose name contains text (case-insensitive)
//   WW2_TEST_SHARD=i/n   run checks i, i+n, i+2n... (1-based), so n processes split one file
//   WW2_TEST_SLOW=1      also run checks marked slow (full-length proofs)
//   WW2_TEST_TIMES=1     print each check's duration
//   WW2_TEST_SHARDS=n    how many processes `node test.js` splits into (default: a third of the cores, 1 to 4)
//   WW2_TEST_JOBS=n      child files each process runs at once
import { dirname } from 'node:path';
const only = process.env.WW2_TEST_ONLY?.toLowerCase();
const [shard, shards] = (process.env.WW2_TEST_SHARD ?? '1/1').split('/').map(Number);
const slowToo = process.env.WW2_TEST_SLOW === '1', times = process.env.WW2_TEST_TIMES === '1';
const results = { passed: 0, failed: [], skipped: 0 };
let index = 0, reported = false;

// Is this check part of this process's run? Shards count every named check, selected or not, so they stay stable.
export function selected(name, { slow = false } = {}) {
  const mine = index++ % shards === shard - 1;
  return mine && (!only || name.toLowerCase().includes(only)) && (!slow || slowToo);
}

export async function check(name, fn, options = {}) {
  if (!selected(name, options)) { results.skipped++; return; }
  const start = performance.now();
  try {
    await fn();
    results.passed++;
    if (times) console.log(`ok ${((performance.now() - start) / 1000).toFixed(2)}s ${name}`);
  } catch (error) {
    results.failed.push({ name, error });
    console.error(`FAIL ${name}\n${error?.stack ?? error}`);
  }
}

export function report(label = 'checks') {
  if (reported) return results;
  reported = true;
  const { passed, failed, skipped } = results;
  console.log(`${label}: ${passed} passed, ${failed.length} failed, ${skipped} skipped`);
  for (const { name, error } of failed) console.error(`  FAIL ${name}: ${String(error?.message ?? error).split('\n')[0]}`);
  if (failed.length) process.exitCode = 1;
  return results;
}
if ((await import('node:worker_threads')).isMainThread) process.on('exit', () => report());

// Splits `node <file>` into shard processes when it was started without WW2_TEST_SHARD. Returns null when the
// file should run its checks itself, otherwise the exit code once every shard and the `after` files have run.
// Files in `after` (performance budgets) run alone once the shards are done.
export async function runShards(file, after = []) {
  const { availableParallelism } = await import('node:os');
  const cores = availableParallelism(), n = Number(process.env.WW2_TEST_SHARDS) || Math.max(1, Math.min(4, Math.floor(cores / 3)));
  if (process.env.WW2_TEST_SHARD || n === 1) return null;
  const { spawn } = await import('node:child_process');
  const jobs = process.env.WW2_TEST_JOBS || String(Math.max(1, Math.min(2, Math.floor((cores - n) / n))));
  const start = performance.now();
  const codes = await Promise.all(Array.from({ length: n }, (_, i) => new Promise(resolve => {
    const child = spawn(process.execPath, [file], { env: { ...process.env, WW2_TEST_SHARD: `${i + 1}/${n}`, WW2_TEST_JOBS: jobs }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', d => { output += d; }); child.stderr.on('data', d => { output += d; });
    child.on('close', code => { console.log(`--- shard ${i + 1}/${n} (${((performance.now() - start) / 1000).toFixed(0)} s)\n${output.trimEnd()}`); resolve(code); });
  })));
  reported = true; // the shards printed their own summaries
  await runFiles(after, { cwd: dirname(file), timeoutMs: 240000 });
  const failed = codes.filter(code => code !== 0).length + results.failed.length;
  console.log(`all shards: ${failed ? `${failed} failing shard(s) or file(s)` : 'passed'} in ${((performance.now() - start) / 1000).toFixed(0)} s`);
  return failed ? 1 : 0;
}

// Child test files, each in its own process, at most WW2_TEST_JOBS at a time (default: cores - 1, up to 4).
// The pool runs in a worker thread: the checks in the main thread are synchronous and would otherwise hold back
// starting the next file. A passing file prints one line; a failing or timed-out file prints its whole output.
export async function runFiles(files, { cwd = process.cwd(), timeoutMs = Number(process.env.WW2_TEST_CHILD_TIMEOUT_MS) || 180000 } = {}) {
  const { Worker } = await import('node:worker_threads');
  const { availableParallelism } = await import('node:os');
  const jobs = Number(process.env.WW2_TEST_JOBS) || Math.max(1, Math.min(4, availableParallelism() - 1));
  const queue = files.filter(file => selected(file) || (results.skipped++, false));
  if (!queue.length) return;
  const worker = new Worker(new URL(import.meta.url), { workerData: { pool: { files: queue, cwd, timeoutMs, jobs } } });
  const done = [];
  worker.on('message', row => done.push(row));
  await new Promise((resolve, reject) => { worker.on('error', reject); worker.on('exit', resolve); });
  for (const { file, ok, seconds, message, output } of done) {
    if (ok) { results.passed++; console.log(`ok ${seconds}s ${file}`); }
    else { results.failed.push({ name: file, error: new Error(message) }); console.error(`FAIL ${file} (${seconds}s): ${message}\n${output}`); }
  }
}

const { isMainThread, workerData, parentPort } = await import('node:worker_threads');
if (!isMainThread && workerData?.pool) {
  const { spawn } = await import('node:child_process');
  const { files, cwd, timeoutMs, jobs } = workerData.pool, queue = [...files];
  const one = file => new Promise(resolve => {
    const start = performance.now(), child = spawn(process.execPath, [file], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', timedOut = false;
    child.stdout.on('data', d => { output += d; }); child.stderr.on('data', d => { output += d; });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.on('close', code => {
      clearTimeout(timer);
      const ok = code === 0 && !timedOut, seconds = ((performance.now() - start) / 1000).toFixed(1);
      parentPort.postMessage({ file, ok, seconds, message: timedOut ? `timed out after ${timeoutMs / 1000} s` : `exited with code ${code}`, output: ok ? '' : output });
      resolve();
    });
  });
  await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, async () => { while (queue.length) await one(queue.shift()); }));
}
