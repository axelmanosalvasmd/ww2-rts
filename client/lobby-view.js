// The lobby's backdrop: the selected map's real battlefield (painted ground, relief, houses, hedgerows, trees and
// water, built by the same modules as a match) seen from above while the camera drifts slowly across it. It sits
// behind the room form, dimmed, on a small renderer of its own at a low resolution, so it stays soft and cheap.
//
// main.js calls show(name, map) when the lobby shows a map (again for every lobby message: the same map is a no-op)
// and hide() when a match starts, which stops it and frees its renderer. Nothing runs on Graphics Low. The world goes
// up in steps, each in the browser's idle time, so the form keeps answering; the biggest step is painting the ground
// canvas, which a match on that map then reuses instead of painting again. On a machine that only has a software
// renderer (SwiftShader), or when the player asks for reduced motion, it draws a single frame and stops.
import * as THREE from 'three';
import { CELL } from '/shared/sim.js';
import { gfx } from './gfx.js';
import { createGround } from './ground.js';
import { createRelief } from './relief.js';
import { buildStructures } from './structures.js';
import { createProps } from './props.js';
import { createWater } from './water.js';
import { setFogMap } from './surfaces.js';

const SCALE = 0.5;        // render resolution against the screen: soft, and a quarter of the pixels
const PERIOD = [140, 95]; // seconds for one sweep across the map, east-west and north-south (never in step)
const REACH = 0.14;       // how far from the center the view drifts, as a share of the map size (the frame stays on the map)
const FPS = 30;           // the drift is slow; half the frames are plenty

export function createLobbyView(host) {
  let gl = null, built = null, shown = null, frame = 0, last = 0, start = 0, pending = 0, builds = 0;

  function context() {
    if (gl) return gl;
    const canvas = document.createElement('canvas');
    canvas.className = 'lobby-view'; canvas.setAttribute('aria-hidden', 'true');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(SCALE); renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.NeutralToneMapping;
    const info = renderer.getContext().getExtension('WEBGL_debug_renderer_info');
    const name = String(renderer.getContext().getParameter(info ? info.UNMASKED_RENDERER_WEBGL : 0x1F01) || '');
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(40, 16 / 9, 1, 900);
    // the battlefield's daylight (client/light.js): sky and earth bounce and a warm low sun, without shadows
    const sun = new THREE.DirectionalLight(0xffd6a8, 3.0);
    scene.add(new THREE.HemisphereLight(0xc9d6e4, 0x5a4a32, 0.9), sun, sun.target);
    host.prepend(canvas);
    const calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    gl = { canvas, renderer, scene, camera, sun, still: calm || /swiftshader|llvmpipe|software/i.test(name) };
    return gl;
  }

  function size() {
    const w = innerWidth, h = innerHeight;
    gl.renderer.setSize(w, h, false); gl.camera.aspect = w / h; gl.camera.updateProjectionMatrix();
  }

  // Built in steps with a pause between them, so the form keeps answering while the world goes up. `still` turns false
  // when a newer show() or a hide() takes over, and the half-built world is dropped.
  const idle = (fn, wait) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: wait }) : setTimeout(fn, 0));
  const pause = () => new Promise((r) => idle(r, 400));
  async function build(map, current) {
    const s = context(), grid = map.rows.map((r) => [...r]), world = new THREE.Group(), times = [];
    let t = performance.now();
    const step = async () => { times.push(Math.round(performance.now() - t)); await pause(); t = performance.now(); if (!current()) throw new Error('replaced'); };
    setFogMap(null); // no fog of war over the houses in the lobby (a match sets its own)
    const ground = createGround(map, s.renderer);
    ground.paint(grid);
    ground.tex.needsUpdate = true; // the ground canvas is shared with matches: upload it whole here
    const out = { world, ground, relief: null, water: null, props: null, W: map.w * CELL, H: map.h * CELL };
    built = out; // drop() can clean up whatever is made so far
    await step();
    out.relief = createRelief(map, grid, { texture: ground.tex, isRoad: ground.isRoad, gfx, low: true });
    out.hAt = (x, z) => out.relief.hAt(x, z);
    world.add(out.relief.mesh);
    await step();
    const pieces = new THREE.Group(); world.add(pieces);
    buildStructures(pieces, grid, map.rows, out.hAt, undefined, map.buildings);
    await step();
    out.water = createWater(grid, map, out.hAt); if (out.water) world.add(out.water.mesh);
    await step();
    out.props = createProps({ map, grid, hAt: out.hAt, parent: world });
    await step();
    s.scene.add(world);
    const { W, H } = out;
    s.scene.fog = new THREE.Fog(0x1a1d1f, Math.max(W, H) * 0.3, Math.max(W, H) * 0.9); // the far side fades into the dark
    s.sun.position.set(W * 0.5 - 70, 110, H * 0.5 - 50); s.sun.target.position.set(W * 0.5, 0, H * 0.5);
    s.canvas.dataset.buildMs = times.join(' '); // per step, for checks from devtools
    out.ready = true;
  }

  function drop() {
    if (!built) return;
    gl?.scene.remove(built.world);
    built.props?.dispose(); built.water?.dispose(); built.relief?.dispose();
    built.ground.tex.needsUpdate = true; // the next match uploads the shared ground canvas whole
    built = null;
  }

  // the camera: high over the map, looking down at about 50 degrees, its aim gliding along a slow figure that never
  // repeats in step; it never turns or changes height
  function place(t) {
    const { W, H, hAt } = built, c = gl.camera;
    const x = W / 2 + Math.sin((t / PERIOD[0]) * Math.PI * 2) * W * REACH, z = H / 2 + Math.sin((t / PERIOD[1]) * Math.PI * 2 + 1.3) * H * REACH;
    const y = hAt(x, z), dist = Math.max(W, H) * 0.36;
    c.position.set(x - dist * 0.25, y + dist * 0.77, z + dist * 0.59);
    c.lookAt(x, y, z);
  }

  function loop(now) {
    frame = requestAnimationFrame(loop);
    if (now - last < 1000 / FPS - 2) return;
    last = now;
    built.water?.tick(now);
    place((now - start) / 1000);
    gl.renderer.render(gl.scene, gl.camera);
    if (!gl.canvas.classList.contains('on')) gl.canvas.classList.add('on');
  }

  addEventListener('resize', () => { if (gl && built?.ready) { size(); if (gl.still) api.redraw(); } });

  function stop() { cancelAnimationFrame(frame); frame = 0; clearTimeout(pending); pending = 0; }

  const api = {
    // still mode: draw one frame where the drift would be 20 s in
    redraw() {
      if (!gl || !built?.ready) return;
      place(20); gl.renderer.render(gl.scene, gl.camera); gl.canvas.classList.add('on');
    },
    show(name, map) {
      if (gfx.low || !map?.rows) { this.hide(); return; }
      if (shown === name && (built || pending)) return;
      stop(); drop(); shown = name;
      // build after the form has painted, so the lobby shows at once
      const ticket = ++builds, current = () => ticket === builds;
      pending = setTimeout(() => idle(async () => {
        pending = 0;
        if (!current()) return; // hidden or another map while waiting
        try { await build(map, current); } catch { if (current()) this.hide(); return; }
        size(); start = performance.now() - 20000; // start mid-drift
        // a still: one frame now, and again as the leaf and wall textures arrive
        if (gl.still) { for (const ms of [0, 1500, 4000, 9000]) setTimeout(() => this.redraw(), ms); return; }
        frame = requestAnimationFrame(loop);
      }, 1000), 250);
    },
    hide() {
      builds++; stop(); drop(); shown = null;
      if (gl) { gl.renderer.dispose(); gl.renderer.forceContextLoss(); gl.canvas.remove(); gl = null; }
    },
  };
  return api;
}
