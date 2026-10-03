// Lag recorder, on with WW2_DIAG=1 (start.cmd sets it). Every 5 s each playing room appends one JSON line to
// logs/diag-<room>.jsonl: the server's real tick rate and how late ticks ran, the event loop delay, and per player
// the round trip, how long since their last ping arrived, the bytes still queued on their socket and the numbers their browser sends with each ping
// (client/perf.js diag()). `node tools/diag.mjs logs/diag-XXXX.jsonl` reads it back.
import { appendFile, mkdir } from 'node:fs/promises';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { join } from 'node:path';

export const CLIENT_KEYS = ['fps', 'worst', 'cpu', 'snaps', 'gap', 'kbs', 'ping', 'jitter', 'loss', 'mem', 'units', 'fx'];
export const EVERY = 5000;

// the browser's numbers as sent in a ping: kept only as finite, clamped numbers (it is untrusted input)
export function cleanClient(d) {
  if (!Array.isArray(d)) return null;
  return Object.fromEntries(CLIENT_KEYS.map((k, i) => [k, Number.isFinite(d[i]) ? Math.min(1e6, Math.max(0, d[i])) : null]));
}

export function createDiag({ dir, now = Date.now }) {
  const loop = monitorEventLoopDelay({ resolution: 10 }); loop.enable();
  let late = 0, ready = null;
  const write = (room, line) => (ready ??= mkdir(dir, { recursive: true }))
    .then(() => appendFile(join(dir, `diag-${room.code}.jsonl`), JSON.stringify(line) + '\n')).catch(() => {});
  return {
    // how late (ms) the server ran a tick against its schedule
    lateBy(ms) { late = Math.max(late, ms); },
    // once per tick per playing room; writes a line every EVERY ms. stats() is the tick meter's (called only then).
    // ponytail: lateMax and the loop delay are process-wide and reset by whichever room writes first; per room if many rooms run
    tick(room, stats) {
      for (const p of room.players) if (p.ws) p.diagBuf = Math.max(p.diagBuf ?? 0, p.ws.bufferedAmount); // the most bytes waiting to go
      const t = now(), d = room.diag ??= { since: t, tick: room.game.tick };
      if (t - d.since < EVERY) return;
      if (t - d.since > EVERY * 1.5) { room.diag = null; return; } // the room was paused: start a fresh window
      const g = room.game, st = stats(), secs = (t - d.since) / 1000;
      write(room, { t: new Date(t).toISOString(), tick: g.tick, tps: Math.round((g.tick - d.tick) / secs * 10) / 10, lateMax: Math.round(late),
        loopP99: Math.round(loop.percentile(99) / 1e5) / 10, loopMax: Math.round(loop.max / 1e5) / 10,
        tickP50: Math.round(st.tick.p50 * 10) / 10, tickP95: Math.round(st.tick.p95 * 10) / 10, snapEvery: room.snapEvery, units: g.units.size,
        players: room.players.map((p, i) => p.ai ? { slot: i, ai: true } : { slot: i, name: p.name, on: p.ws?.readyState === 1, rtt: p.rtt ?? null, quiet: p.diagAt ? t - p.diagAt : null, bufMax: p.diagBuf ?? 0, client: p.diagClient ?? null }) });
      room.players.forEach(p => { p.diagBuf = 0; });
      room.diag = { since: t, tick: g.tick }; late = 0; loop.reset();
    },
  };
}
