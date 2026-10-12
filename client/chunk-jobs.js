// Versioned rebuilds of a map mesh drawn in chunks (client/relief.js, client/water.js). The logical terrain changes at
// once; the drawn chunks that read it are marked, rebuilt a few per frame and swapped in.
//
// - mark(i) coalesces: a chunk marked twice before its rebuild is built once, from the state at build time.
// - A chunk marked again after its rebuild drops that result, so an old build never replaces a newer state.
// - A rebuilt chunk is published together with its rebuilt neighbours, and waits while a neighbour still has to be
//   built: both sides of a shared edge change in the same frame, so no crack opens. Built neighbours that wait are
//   held as one group, and the group is published whole once its oldest build has waited maxWaitMs, so a stream of
//   changes nearby cannot hold it back for ever. The wait counts from a chunk's first build since it was last shown,
//   not from its mark, so time spent queued behind other chunks does not use it up.
// - run(budgetMs) builds until the budget is spent, at least one chunk (one chunk can take longer than the budget).
// - cancel() drops every queued and built result; nothing is published after it (a new match, a disposed mesh).
//
// cols x rows chunks, numbered row by row. build(i) returns a result for chunk i, publish(i, result) shows it,
// discard(result) frees one that will not be shown. now() is the clock (performance.now by default).
export function createChunkJobs({ cols, rows, build, publish, discard = () => {}, now = () => performance.now(), maxWaitMs = 400 }) {
  const version = new Uint32Array(cols * rows), dirty = new Set(), staged = new Map(), since = new Map();
  let cancelled = false;
  const stats = { built: 0, published: 0, ms: 0, waiting: 0 };

  function mark(i) {
    if (cancelled) return;
    version[i]++;
    const old = staged.get(i);
    if (old) { staged.delete(i); discard(old.result); }
    dirty.add(i);
  }
  // every chunk in the inclusive chunk box, clamped to the map
  function markBox(cx0, cy0, cx1, cy1) {
    for (let cy = Math.max(0, cy0); cy <= Math.min(rows - 1, cy1); cy++)
      for (let cx = Math.max(0, cx0); cx <= Math.min(cols - 1, cx1); cx++) mark(cy * cols + cx);
  }
  function buildNext() {
    const i = dirty.values().next().value;
    dirty.delete(i);
    staged.set(i, { result: build(i), version: version[i] });
    if (!since.has(i)) since.set(i, now());
    stats.built++;
  }
  // built chunks that must wait: each group of touching built chunks waits while one of them borders a chunk still to
  // build, until the group's oldest build has waited maxWaitMs
  function held(t) {
    const out = new Set(), seen = new Set();
    for (const first of staged.keys()) {
      if (seen.has(first)) continue;
      const group = [first];
      seen.add(first);
      for (let g = 0; g < group.length; g++) touches(group[g], k => { if (staged.has(k) && !seen.has(k)) { seen.add(k); group.push(k); } return false; });
      if (!group.some(i => touches(i, k => dirty.has(k))) || group.some(i => t - since.get(i) >= maxWaitMs)) continue;
      for (const i of group) out.add(i);
    }
    return out;
  }
  function touches(i, test) {
    const cx = i % cols, cy = (i - cx) / cols;
    for (let y = Math.max(0, cy - 1); y <= Math.min(rows - 1, cy + 1); y++)
      for (let x = Math.max(0, cx - 1); x <= Math.min(cols - 1, cx + 1); x++) if ((x !== cx || y !== cy) && test(y * cols + x)) return true;
    return false;
  }
  function publishReady(all) {
    if (!staged.size) return 0;
    const wait = all ? null : held(now());
    let count = 0;
    for (const [i, job] of [...staged]) {
      if (wait?.has(i)) continue;
      staged.delete(i); since.delete(i);
      if (job.version !== version[i]) { discard(job.result); continue; } // marked since: a newer build follows
      publish(i, job.result); stats.published++; count++;
    }
    return count;
  }

  return {
    mark, markBox, stats,
    // builds for about budgetMs (at least one chunk), then publishes what is ready; returns the chunks published
    run(budgetMs) {
      if (cancelled) return 0;
      const start = now();
      while (dirty.size) { buildNext(); if (now() - start >= budgetMs) break; }
      const count = publishReady(false);
      stats.ms = now() - start; stats.waiting = dirty.size + staged.size;
      return count;
    },
    // builds and publishes everything queued (startup, settings changes, callers without frames)
    flush() {
      if (cancelled) return 0;
      while (dirty.size) buildNext();
      const count = publishReady(true);
      stats.waiting = 0;
      return count;
    },
    cancel() {
      cancelled = true;
      dirty.clear(); since.clear();
      for (const job of staged.values()) discard(job.result);
      staged.clear(); stats.waiting = 0;
    },
    // chunk i still shows an older state than the logical one
    pending: i => dirty.has(i) || staged.has(i),
    get waiting() { return dirty.size + staged.size; },
  };
}
