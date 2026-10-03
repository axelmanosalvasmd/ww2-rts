// Reads a lag recording (logs/diag-<room>.jsonl, written by server/diag.js with WW2_DIAG=1) and says where the lag
// comes from: the server, the network to one player, everyone's link at once (the host's side), or a browser.
// Usage: node tools/diag.mjs [logs/diag-XXXX.jsonl]   (no file: the newest recording)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export function summarize(lines) {
  const pct = (xs, q) => { const v = xs.filter(Number.isFinite).sort((a, b) => a - b); return v.length ? v[Math.min(v.length - 1, Math.floor(v.length * q))] : null; };
  const col = (rows, f) => rows.map(f).filter(Number.isFinite);
  const server = {
    tpsMin: pct(col(lines, l => l.tps), 0), tpsP50: pct(col(lines, l => l.tps), 0.5), lateMax: pct(col(lines, l => l.lateMax), 1),
    loopMax: pct(col(lines, l => l.loopMax), 1), tickP95: pct(col(lines, l => l.tickP95), 1), snapEvery: pct(col(lines, l => l.snapEvery), 1),
  };
  const verdicts = [];
  if (server.tpsP50 < 19 || server.tickP95 > 40 || server.snapEvery > 2 || server.loopMax > 100)
    verdicts.push(`SERVER: behind (ticks/s p50 ${server.tpsP50}, slowest tick ${server.tickP95} ms, event loop stall ${server.loopMax} ms, snapshots every ${server.snapEvery} ticks)`);
  const humans = new Map();
  for (const l of lines) for (const p of l.players) if (!p.ai && p.on) {
    const h = humans.get(p.slot) ?? { name: p.name, rows: [] };
    h.rows.push({ ...p.client, rtt: p.rtt, buf: p.bufMax, quiet: p.quiet ?? Infinity }); humans.set(p.slot, h);
  }
  const players = [...humans.entries()].map(([slot, { name, rows }]) => {
    const s = { slot, name, samples: rows.length };
    for (const k of ['fps', 'worst', 'cpu', 'snaps', 'gap', 'kbs', 'rtt', 'jitter', 'loss', 'buf', 'quiet']) s[k] = { p50: pct(col(rows, r => r[k]), 0.5), p95: pct(col(rows, r => r[k]), 0.95) };
    const who = `${name} (slot ${slot})`;
    // pings come every 2 s: none for 6 s means the link stalled (or the page predates the recorder: reload it)
    const silent = rows.filter(r => !(r.quiet <= 6000)).length;
    if (silent) verdicts.push(`${who}: NETWORK, no pings for 6 s+ in ${silent} of ${rows.length} windows (a stalled link, or a page not reloaded since the update)`);
    if (s.buf.p95 > 32768) verdicts.push(`${who}: NETWORK, upload to them can't keep up (send queue p95 ${Math.round(s.buf.p95 / 1024)} KB): they fall seconds behind`);
    if (s.gap.p95 > 300 || s.loss.p95 > 0 || s.jitter.p95 > 40) verdicts.push(`${who}: NETWORK stalls (longest update gap p95 ${s.gap.p95} ms, jitter p95 ${s.jitter.p95} ms, ping loss p95 ${s.loss.p95}%, ping p50 ${s.rtt.p50} ms)`);
    if (s.fps.p50 !== null && (s.fps.p50 < 40 || s.worst.p95 > 100))
      verdicts.push(`${who}: BROWSER (fps p50 ${s.fps.p50}, worst frame p95 ${s.worst.p95} ms, script ${s.cpu.p50} ms/frame: ${s.cpu.p50 > 10 ? 'JavaScript-bound, one core' : 'mostly rendering or the GPU'})`);
    return s;
  });
  // the same 5 s window stalling for two or more players points at the host's side (upload, Tailscale, the server)
  const shared = lines.filter(l => l.players.filter(p => p.on && p.client?.gap > 300).length >= 2).length;
  if (shared) verdicts.push(`SHARED: ${shared} of ${lines.length} windows had 2+ players stalling at once: look at the host (upload, Tailscale relay, server)`);
  if (!verdicts.length) verdicts.push('nothing over the thresholds: no lag recorded');
  return { minutes: Math.round(lines.length * 5 / 6) / 10, server, players, verdicts };
}

if (process.argv[1]?.endsWith('diag.mjs')) {
  let file = process.argv[2];
  if (!file) {
    const dir = join(import.meta.dirname, '..', 'logs');
    file = readdirSync(dir).filter(f => f.startsWith('diag-')).map(f => join(dir, f)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
    if (!file) throw new Error('no recordings in logs/: host with WW2_DIAG=1 (start.cmd does)');
  }
  const r = summarize(readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l)));
  console.log(`${file}: ${r.minutes} min recorded`);
  console.log('server', JSON.stringify(r.server));
  for (const p of r.players) console.log(`${p.name} (slot ${p.slot}):`, Object.entries(p).filter(([, v]) => v?.p50 !== undefined).map(([k, v]) => `${k} ${v.p50}/${v.p95}`).join(', '));
  console.log('\nVerdict:\n' + r.verdicts.map(v => '- ' + v).join('\n'));
}
