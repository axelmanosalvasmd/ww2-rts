// Performance and network numbers. window.__perf always holds them: fps, frame time, the worst frame and the js time
// per frame over the last second, the last frame's draw calls and triangles (renderer.info.render), how many units,
// effect particles and corpses there are, the js heap where the browser reports it, how many snapshots arrive per
// second with their size and the longest gap between two, the ping, jitter and loss of the latency pings, and the
// server's tick time. The stats overlay (client/stats.js) shows the ones the player picks; onUpdate() hears each
// one-second roll. renderScale() sets the render resolution for the graphics level.
import { gfx } from './gfx.js';

const stat = { fps: 0, ms: 0, worst: 0, cpu: 0, calls: 0, tris: 0, units: 0, fx: 0, corpses: 0, mem: null, snaps: 0, bytes: 0, kbs: 0, gap: 0,
  ping: null, jitter: null, loss: null, srvTick: null, srvEvery: null, scale: 1, gfx: gfx.level };
window.__perf = stat;

let frames = 0, busy = 0, worst = 0, lastStart = 0, snaps = 0, bytes = 0, gap = 0, lastSnap = 0, since = performance.now();
const subs = new Set();

// Latency pings: a ping with no pong within LOST_AFTER counts as lost. Loss and jitter cover the last PINGS answered
// or lost pings (a minute at one every two seconds). The socket is TCP, so a lost ping means a stall, not a dropped packet.
const LOST_AFTER = 3000, PINGS = 30;
const out = new Map(), done = [], rtts = [];
const settle = (lost) => { done.push(lost); if (done.length > PINGS) done.shift(); };
function rollPings(now) {
  for (const [c, at] of out) if (now - at > LOST_AFTER) { out.delete(c); settle(true); }
  stat.loss = done.length ? Math.round(done.filter(Boolean).length / done.length * 1000) / 10 : null;
  let d = 0;
  for (let i = 1; i < rtts.length; i++) d += Math.abs(rtts[i] - rtts[i - 1]);
  stat.jitter = rtts.length > 1 ? Math.round(d / (rtts.length - 1)) : null;
}

export const perf = {
  // one call per snapshot that arrives, with its size
  net(n) {
    const now = performance.now();
    if (lastSnap) gap = Math.max(gap, now - lastSnap);
    lastSnap = now; snaps++; bytes += n;
  },
  // a latency ping went out stamped c (its performance.now())
  pinged(c) { out.set(c, c); },
  // the server's pong: returns the round trip in ms, or null for a pong this page did not send
  pong(m) {
    if (!Number.isFinite(m.c)) return null;
    const rtt = Math.round(performance.now() - m.c);
    if (out.delete(m.c)) settle(false);
    rtts.push(rtt); if (rtts.length > PINGS) rtts.shift();
    stat.ping = rtt;
    if (Array.isArray(m.srv)) [stat.srvTick, stat.srvEvery] = m.srv;
    return rtt;
  },
  // fn(stat) after each one-second roll; returns an unsubscribe function
  onUpdate(fn) { subs.add(fn); return () => subs.delete(fn); },
  // once per frame, right after renderer.render(); start is the frame's performance.now() at its beginning
  frame(renderer, start, counts) {
    const now = performance.now(), r = renderer.info.render;
    frames++; busy += now - start;
    if (lastStart) worst = Math.max(worst, start - lastStart); // start to start: the whole frame, waits included
    lastStart = start;
    stat.calls = r.calls; stat.tris = r.triangles;
    Object.assign(stat, counts);
    const span = now - since;
    if (span < 1000) return;
    stat.fps = Math.round(frames * 10000 / span) / 10;
    stat.ms = Math.round(span / frames * 10) / 10;
    stat.worst = Math.round(worst * 10) / 10;
    stat.cpu = Math.round(busy / frames * 10) / 10;
    stat.snaps = Math.round(snaps * 10000 / span) / 10;
    stat.bytes = snaps ? Math.round(bytes / snaps) : 0;
    stat.kbs = Math.round(bytes / span * 10) / 10;
    // a snapshot still missing counts too, so a stall shows while it lasts
    stat.gap = Math.round(lastSnap ? Math.max(gap, now - lastSnap) : 0);
    stat.mem = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null; // Chrome and Edge only
    rollPings(now);
    frames = busy = snaps = bytes = gap = worst = 0; since = now;
    subs.forEach((fn) => fn(stat));
  },
};

// Pixel ratio per graphics level: Low renders at 0.75 of the screen's pixels (at most 1), higher levels at the
// screen's own ratio up to 1.5. Applied now and whenever the level changes.
export function renderScale(renderer) {
  const apply = () => {
    stat.scale = Math.round((gfx.low ? Math.min(1, 0.75 * devicePixelRatio) : Math.min(devicePixelRatio, 1.5)) * 100) / 100;
    stat.gfx = gfx.level;
    renderer.setPixelRatio(stat.scale);
  };
  apply();
  gfx.onChange(apply);
}
