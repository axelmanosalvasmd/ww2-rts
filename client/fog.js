// Fog of war, drawn from the server's mask of the cells my team sees (shared/sim.js fogFor): the whole mask when a
// match starts or I reconnect, then only the cells that flipped. Each cell looks one of three ways: seen now (clear),
// explored (dimmed) or never seen (dark), and fades to a new look within a quarter second. The ground overlay, the
// structures and props (surfaces.js setFogMap) and the minimap all read this one state. Only the changed stretch of
// each texture row goes to the GPU.
import * as THREE from 'three';
import { unpackRuns, UNITS, CELL } from '../shared/sim.js';

const CLEAR = 0, DIM = 120, DARK = 185; // overlay alpha for seen, explored and never seen
const SPEED = DARK / 0.25; // alpha per second: any change of look finishes within a quarter second
const SHADE = 10; // the overlay's colour (near black); surfaces.js mixes toward the same shade
let versions = 0; // the minimap repaints when this moves; it never repeats across matches

// w, h: the map in cells. key: the start message's fog ({ v: seen, e: explored }). off: no fog at all (map editor).
export function createFog(w, h, key, off = false) {
  const n = w * h, data = new Uint8Array(n * 4);
  const seen = new Uint8Array(n), explored = new Uint8Array(n), lit = new Uint8Array(n), litList = [];
  const want = new Uint8Array(n), alpha = new Float32Array(n), busy = new Uint8Array(n), active = [];
  const rowMin = new Int32Array(h).fill(w), rowMax = new Int32Array(h).fill(-1);
  // without a mask (an older server) nothing is hidden on the ground
  let lifted = off || !key, uploaded = false;
  if (key) {
    unpackRuns(key.v, (start, count) => seen.fill(1, start, start + count));
    unpackRuns(key.e, (start, count) => explored.fill(1, start, start + count));
  }
  const look = c => (lifted || seen[c] || lit[c] ? CLEAR : explored[c] ? DIM : DARK);
  // texture row 0 is the far (z = max) edge, like the ground overlay's plane
  for (let c = 0; c < n; c++) {
    const i = ((h - 1 - Math.floor(c / w)) * w + c % w) * 4;
    data[i] = data[i + 1] = data[i + 2] = SHADE;
    data[i + 3] = alpha[c] = want[c] = look(c);
  }
  const texture = new THREE.DataTexture(data, w, h);
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  // the first upload sends the whole texture; row ranges only after it
  texture.onUpdate = () => { uploaded = true; };
  const state = { texture, w, h, version: ++versions, seen, explored };
  const touch = c => {
    const t = look(c);
    if (t === want[c]) return;
    want[c] = t; state.version = ++versions;
    if (!busy[c]) { busy[c] = 1; active.push(c); }
  };
  // a snapshot: the cells that flipped since the last one, and the ground under every unit it shows. That ground
  // counts as seen until the next snapshot: the mask follows the server's vision pass (five a second), so a unit can
  // step onto a cell before the mask catches up.
  state.snapshot = (s) => {
    if (typeof s.fog === 'string') unpackRuns(s.fog, (start, count) => {
      for (let c = start; c < start + count; c++) { seen[c] ^= 1; explored[c] |= seen[c]; touch(c); }
    });
    const old = litList.splice(0);
    for (const c of old) lit[c] = 0;
    for (const [, type, , x, z] of s.units) {
      const def = UNITS[type];
      if (!def || def.air) continue;
      // a building's whole footprint (its position is the footprint's centre), one cell for anything else
      const size = def.building ? def.size : 1, x0 = size > 1 ? Math.round(x / CELL - size / 2) : Math.floor(x / CELL);
      const y0 = size > 1 ? Math.round(z / CELL - size / 2) : Math.floor(z / CELL);
      for (let y = Math.max(0, y0); y < Math.min(h, y0 + size); y++) for (let cx = Math.max(0, x0); cx < Math.min(w, x0 + size); cx++) {
        const c = y * w + cx;
        if (!lit[c]) { lit[c] = 1; litList.push(c); }
      }
    }
    for (const c of old) touch(c);
    for (const c of litList) touch(c);
  };
  // every frame: lift (the match is decided) clears the whole map; cells still changing fade one step
  state.frame = (dt, lift = false) => {
    if (!off && key && lift !== lifted) { lifted = lift; for (let c = 0; c < n; c++) touch(c); }
    if (!active.length) return;
    const stepBy = SPEED * dt;
    for (let i = active.length - 1; i >= 0; i--) {
      const c = active[i], t = want[c], a = alpha[c], next = a < t ? Math.min(t, a + stepBy) : Math.max(t, a - stepBy);
      alpha[c] = next;
      const y = h - 1 - Math.floor(c / w), x = c % w, at = (y * w + x) * 4 + 3, v = Math.round(next);
      if (data[at] !== v) { data[at] = v; if (x < rowMin[y]) rowMin[y] = x; if (x > rowMax[y]) rowMax[y] = x; }
      if (next === t) { busy[c] = 0; active[i] = active[active.length - 1]; active.pop(); }
    }
    let dirty = false;
    for (let y = 0; y < h; y++) {
      if (rowMax[y] < 0) continue;
      if (uploaded) texture.addUpdateRange((y * w + rowMin[y]) * 4, (rowMax[y] - rowMin[y] + 1) * 4);
      rowMin[y] = w; rowMax[y] = -1; dirty = true;
    }
    if (!dirty) return;
    // ranges piling up while nothing draws the texture: send it whole instead
    if (texture.updateRanges.length > 2 * h) texture.clearUpdateRanges();
    texture.needsUpdate = true;
  };
  // 'seen', 'explored' or 'dark' at a world position (debugging and checks)
  state.at = (x, z) => {
    const cx = Math.floor(x / CELL), cy = Math.floor(z / CELL);
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) return null;
    const t = want[cy * w + cx];
    return t === CLEAR ? 'seen' : t === DIM ? 'explored' : 'dark';
  };
  // the minimap's fog (an ImageData of w x h, rows in map order), from each cell's look
  state.minimap = (img) => {
    const d = img.data;
    for (let c = 0; c < n; c++) { d[c * 4] = d[c * 4 + 1] = d[c * 4 + 2] = SHADE; d[c * 4 + 3] = want[c] === CLEAR ? 0 : want[c] === DIM ? 110 : 175; }
  };
  state.dispose = () => texture.dispose();
  return state;
}
