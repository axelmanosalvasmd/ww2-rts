import * as THREE from 'three';
import { UNITS } from '/shared/sim.js';
import { gfx } from './gfx.js';

const now = () => performance.now() / 1000;
const FLIP_TIME = 0.6, BANNER_TIME = 4, MAX_PLUMES = 12;
const ROOF = { hq: 3.6, barracks: 4.7, motorpool: 3.7, bunker: 3.1, depot: 2.5, airfield: 3.7, flakpos: 1.6 };

export function createObjectives(hooks) {
  const pointState = [], damage = new Map(), active = [], projected = new THREE.Vector3();
  let banner = null, bannerUntil = 0;

  function init() {
    if (!document.querySelector('link[data-objectives]')) {
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/client/objectives.css';
      css.dataset.objectives = ''; document.head.append(css);
    }
    banner = document.createElement('div'); banner.id = 'objective-banner'; banner.hidden = true;
    banner.setAttribute('role', 'status'); document.getElementById('hud').append(banner);
  }

  function reset() {
    pointState.length = 0; damage.clear(); active.length = 0; bannerUntil = 0;
    if (banner) banner.hidden = true;
  }

  function collapse(sh) {
    if (now() < bannerUntil) return;
    let text = sh.name ? `The ${sh.name} has collapsed` : '';
    if (!text) {
      let building = sh.t != null ? hooks.units.get(sh.t) : null;
      if (!UNITS[building?.type]?.building) building = null;
      if (!building) {
        let distance = 4;
        for (const v of hooks.units.values()) if (UNITS[v.type]?.building) {
          const d = Math.hypot((v.tx ?? v.x) - sh.x, (v.tz ?? v.z) - sh.z);
          if (d <= distance) { building = v; distance = d; }
        }
      }
      if (building) {
        const who = building.owner === hooks.me() ? 'Your' : hooks.friend(building.owner) ? 'The allied' : 'The enemy';
        text = `${who} ${UNITS[building.type].name} has collapsed`;
      }
    }
    if (!text) return;
    banner.textContent = text; banner.hidden = false; bannerUntil = now() + BANNER_TIME;
    placeBanner();
  }

  function placeBanner() {
    if (!banner || banner.hidden) return;
    const r = document.getElementById('top')?.getBoundingClientRect();
    banner.style.top = `${Math.max(12, (r?.bottom ?? 100) + 6)}px`;
  }

  // Read only the received units, never ghosts. Lost vision stops the emitter on the next snapshot.
  function snapshot(s) {
    const time = now(), points = hooks.points();
    for (let i = 0; i < (s.points ?? []).length; i++) {
      const [owner, capper, progress, contested = 0] = s.points[i], old = pointState[i];
      pointState[i] = { owner, flipped: old && old.owner !== owner ? time : old?.flipped ?? -Infinity };
      points[i]?.set(owner >= 0 ? hooks.colorOf(owner) : null, capper >= 0 ? hooks.colorOf(capper) : null, progress, contested);
    }
    const keep = new Set();
    for (const [id, type, , x, z, , , hp, , , , , , , built = 1] of s.units ?? []) {
      const def = UNITS[type], fraction = hp / ((def?.models ?? 1) * def?.hpPer);
      if (!def?.structure || built < 1 || hp <= 0 || fraction > 0.66) continue;
      keep.add(id);
      const entry = damage.get(id) ?? { smoke: 0, fire: 0, low: 0, count: 0 };
      Object.assign(entry, { id, type, x, z, radius: Math.max(1.5, def.radius ?? def.size ?? 2), burning: fraction <= 0.33 }); damage.set(id, entry);
    }
    for (const id of damage.keys()) if (!keep.has(id)) damage.delete(id);
    // Rank received buildings once per snapshot. The frame loop visits only nearby, onscreen sources.
    active.length = 0;
    const camera = hooks.camera, limit = Math.min(260, Math.max(130, (hooks.cam?.dist ?? 85) * 3));
    if (camera) camera.updateMatrixWorld();
    for (const e of damage.values()) {
      if (camera) {
        const dx = e.x - camera.position.x, dz = e.z - camera.position.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > limit * limit) continue;
        projected.set(e.x, hooks.hAt(e.x, e.z) + (ROOF[e.type] ?? 3) + 3, e.z).project(camera);
        if (projected.z < -1 || projected.z > 1 || Math.abs(projected.x) > 1.25 || Math.abs(projected.y) > 1.3) continue;
        e.distance = d2;
      }
      active.push(e);
    }
    if (camera) active.sort((a, b) => a.distance - b.distance);
    active.length = Math.min(MAX_PLUMES, active.length);
    for (const sh of s.shots ?? []) if (sh.k === 'collapse') collapse(sh);
  }

  function frame(dt = 1 / 60) {
    const time = now(), points = hooks.points();
    for (let i = 0; i < pointState.length; i++) {
      const age = time - pointState[i].flipped;
      points[i]?.frame(time, age >= 0 && age < FLIP_TIME ? Math.max(0.001, age / FLIP_TIME) : 0);
    }
    for (const e of active) {
      const roof = hooks.hAt(e.x, e.z) + (ROOF[e.type] ?? 3);
      if (gfx.low) {
        // One source alternates smoke and fire below 33%, so Low still shows both stages.
        e.low -= dt;
        if (e.low <= 0) {
          e.low = 0.18;
          const flame = e.burning && e.count++ % 3 !== 0;
          hooks.effects.plume(flame ? 'fire' : e.burning ? 'dark' : 'smoke', e.x, roof + (e.burning && !flame ? 1 : 0), e.z, e.radius);
        }
      } else {
        e.smoke -= dt; e.fire -= dt;
        if (e.smoke <= 0) { e.smoke = 0.28; hooks.effects.plume(e.burning ? 'dark' : 'smoke', e.x, roof + (e.burning ? 1 : 0), e.z, e.radius); }
        if (e.burning && e.fire <= 0) { e.fire = 0.16; hooks.effects.plume('fire', e.x, roof, e.z, e.radius); }
      }
    }
    if (banner && !banner.hidden) { if (time >= bannerUntil) banner.hidden = true; else placeBanner(); }
  }

  return { init, reset, snapshot, frame, collapse,
    get points() { return pointState; },
    get emitters() { return active.map(e => ({ id: e.id, burning: e.burning, sources: gfx.low || !e.burning ? 1 : 2 })); },
  };
}
