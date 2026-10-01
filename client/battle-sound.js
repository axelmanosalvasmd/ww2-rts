// Battle sounds: turns the server's shot events and what units are doing into calls on client/audio.js.
// main.js calls battleShots() once per snapshot, battleFrame() once per frame and battleGone() when a unit leaves.
import { UNITS, CELL } from '/shared/sim.js';
import { audio } from './audio.js';

// direct fire by the shooter's unit type
const FIRE = {
  rifle: 'rifle', conscript: 'rifle', engineer: 'rifle', ranger: 'smg', armoredcar: 'smg',
  mg: 'mg', bunker: 'mg', sniper: 'sniper', at: 'atgun', tank: 'tankgun', medium: 'tankgun', tiger: 'tankgun',
};
const SMALL = new Set(['rifle', 'smg', 'mg', 'sniper']);
const HEAVY = new Set(['atgun', 'tankgun']);
const isVeh = (type) => UNITS[type] && !UNITS[type].infantry && !UNITS[type].structure;

const t = () => performance.now() / 1000;
const lastFire = new Map(), whistled = new Set(), foley = new Map(), seen = new Map();

// mapW: the map width in cells, to tell what a 'collapse' knocked down
export function battleShots(s, units, mapW) {
  // the sim reports every wrecked map cell as a collapse; hedges, wire and trees (they become open ground '.') only crunch
  const open = new Set();
  if (mapW) for (const [cell, ch] of s.cells ?? []) if (ch === '.') open.add(cell);
  for (const sh of s.shots) {
    const from = units.get(sh.f), at = { x: sh.x, z: sh.z };
    switch (sh.k) {
      case 'throw': case 'hurt': break;
      case 'boom': audio.play('blast_small', at); break; // grenades and satchels
      case 'shell': audio.play('blast_large', at); break;
      case 'rocket': audio.play('blast_small', at, { gain: 0.8 }); break;
      case 'bomb': audio.play('bomb', at); break;
      case 'collapse': {
        const light = open.has(Math.floor(sh.z / CELL) * mapW + Math.floor(sh.x / CELL));
        audio.play('collapse', at, light ? { gain: 0.3, rate: 1.3 } : {});
        break;
      }
      case 'smokeshells': for (let i = 0; i < 3; i++) audio.play('smoke', { x: sh.x + (Math.random() - 0.5) * 12, z: sh.z + (Math.random() - 0.5) * 12 }, { delay: i * 0.25 }); break;
      case 'strafe': audio.play('plane_flyby', at); audio.play('strafe', at, { delay: 1.3 }); break; // guns open up as it passes (plane() in main.js)
      case 'recon': audio.play('plane_flyby', at, { gain: 0.8 }); break;
      case 'bombing': audio.play('bomber', at); break;
      // aviation (merged after this module was written): dive bombers and transports fly over, flak bursts, AA guns chatter;
      // a downed plane's crash is played by downed() in main.js and parachutes make no sound
      case 'dive': case 'para': audio.play('plane_flyby', at); break;
      case 'flak': audio.play('flak', at); break;
      case 'aa': if (from) audio.play('mg', from, { gain: 0.8 }); break;
      case 'chutes': case 'shotdown': case 'planedown': break;
      case 'salvo': {
        const pos = from ?? at, mortar = from ? from.type === 'mortar' : sh.n === 1;
        if (!mortar) { audio.play('rockets', pos); break; }
        audio.play('mortar', pos);
        // the round's whistle ends as it lands
        audio.play('whistle', at, { gain: 0.7, offset: Math.max(0, audio.length('whistle') - UNITS.mortar.w.flight) });
        break;
      }
      default: gunfire(sh, from, units.get(sh.t), at);
    }
  }
  // artillery: a whistle as the first shells of a barrage come in
  for (const [kind, x, z, , left] of s.strikes ?? []) {
    const key = `${kind}:${x}:${z}`;
    if (kind === 'artillery' && left > 0 && left < 1.4 && !whistled.has(key)) {
      whistled.add(key);
      audio.play('whistle', { x, z }, { offset: Math.max(0, audio.length('whistle') - left) });
    }
  }
  if (whistled.size > 20) whistled.clear();
}

function gunfire(sh, from, to, at) {
  const name = FIRE[sh.k] ?? (isVeh(sh.k) ? 'tankgun' : 'rifle'), pos = from ?? at, now = t();
  // an MG fires every 0.3 s: one burst sample covers several shots
  if (name === 'mg' || name === 'smg') {
    if (now - (lastFire.get(sh.f) ?? -9) < (name === 'mg' ? 1.25 : 0.7)) return;
    lastFire.set(sh.f, now);
  }
  if (name === 'rifle') {
    // a squad's volley: one to three shots, a little apart
    const n = Math.max(1, Math.min(3, from?.alive ?? 1));
    for (let i = 0; i < n; i++) audio.play('rifle', pos, { delay: i * (0.07 + Math.random() * 0.12), gain: i ? 0.8 : 1 });
  } else audio.play(name, pos, { rate: sh.k === 'tiger' ? 0.85 : 1 });
  if (HEAVY.has(name) && sh.hit) audio.play('blast_small', at, { gain: 0.6, delay: 0.08 });
  else if (SMALL.has(name) && to && isVeh(to.type) && Math.random() < 0.35) audio.play('ricochet', at, { delay: 0.05 });
  if (lastFire.size > 400) lastFire.clear();
}

// a unit removed from the scene: wrecks burn for a while
export function battleGone(v) {
  if (!v.killed) return;
  if (isVeh(v.type)) {
    const at = { x: v.x, z: v.z };
    audio.play('vehicle_destroyed', at);
    audio.play('fire_loop', at, { delay: 0.8, dur: 14 });
  } else if (UNITS[v.type]?.structure && !UNITS[v.type].building) audio.play('collapse', { x: v.x, z: v.z }); // buildings collapse in the sim already
}

// once per frame: the listener follows the camera; a few times a second, engines, digging and building
let tick = 0;
export function battleFrame(cam, units, me) {
  audio.listener(cam.x, cam.z, cam.dist, cam.yaw);
  const now = t();
  if (now - tick < 0.2) return;
  tick = now;
  const engines = [];
  for (const v of units.values()) {
    const prev = seen.get(v.id), moving = prev && Math.hypot(v.x - prev.x, v.z - prev.z) > 0.25;
    seen.set(v.id, { x: v.x, z: v.z });
    if (isVeh(v.type) && moving) engines.push(v);
    const work = v.flags & 16 ? 'dig' : v.flags & 128 ? 'build' : null;
    if (work && !moving && now > (foley.get(v.id) ?? 0)) {
      foley.set(v.id, now + 2.5 + Math.random() * 1.5);
      audio.play(work, v, { gain: v.owner === me ? 1 : 0.7 });
    }
  }
  audio.bed('tank_engine', engines);
  if (seen.size > units.size + 50) for (const id of seen.keys()) if (!units.has(id)) { seen.delete(id); foley.delete(id); }
}
