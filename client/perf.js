// Performance numbers. window.__perf always holds fps and frame time over the last second, the last frame's draw
// calls and triangles (renderer.info.render), how many units, effect particles and corpses there are, and how many
// snapshots arrive per second and their average size. '?perf' in the URL also shows them in a small box.
// renderScale() sets the render resolution for the graphics level.
import { gfx } from './gfx.js';

const stat = { fps: 0, ms: 0, cpu: 0, calls: 0, tris: 0, units: 0, fx: 0, corpses: 0, snaps: 0, bytes: 0, kbs: 0, scale: 1, gfx: gfx.level };
window.__perf = stat;

let box = null;
if (new URLSearchParams(location.search).has('perf')) {
  box = document.createElement('div');
  box.id = 'perf';
  box.style.cssText = 'position:fixed;left:10px;top:58px;z-index:40;pointer-events:none;padding:6px 10px;white-space:pre;'
    + 'font:13px/1.4 var(--type, sans-serif);color:#efe9d8;background:rgba(26,25,19,0.84);border:1px solid rgba(239,233,216,0.28)';
  document.body.append(box);
}

let frames = 0, busy = 0, snaps = 0, bytes = 0, since = performance.now();
const k = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n));

export const perf = {
  // one call per snapshot that arrives, with its size
  net(n) { snaps++; bytes += n; },
  // once per frame, right after renderer.render(); start is the frame's performance.now() at its beginning
  frame(renderer, start, counts) {
    const now = performance.now(), r = renderer.info.render;
    frames++; busy += now - start;
    stat.calls = r.calls; stat.tris = r.triangles;
    Object.assign(stat, counts);
    const span = now - since;
    if (span < 1000) return;
    stat.fps = Math.round(frames * 10000 / span) / 10;
    stat.ms = Math.round(span / frames * 10) / 10;
    stat.cpu = Math.round(busy / frames * 10) / 10;
    stat.snaps = Math.round(snaps * 10000 / span) / 10;
    stat.bytes = snaps ? Math.round(bytes / snaps) : 0;
    stat.kbs = Math.round(bytes / span * 10) / 10;
    frames = busy = snaps = bytes = 0; since = now;
    if (box) box.textContent = `${stat.fps} fps   ${stat.ms} ms/frame (js ${stat.cpu})\n`
      + `${stat.calls} draw calls   ${k(stat.tris)} triangles\n`
      + `${stat.units} units   ${k(stat.fx)} fx   ${stat.corpses} corpses\n`
      + `${stat.snaps} snapshots/s   ${(stat.bytes / 1000).toFixed(1)} kB each\n`
      + `render scale ${stat.scale}   graphics ${stat.gfx}`;
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
