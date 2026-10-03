import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import * as THREE from 'three';

// Browser modules use root-relative shared imports. Exercise the same modules in this isolated Node process.
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('/shared/')) return nextResolve(new URL(`.${specifier}`, import.meta.url).href, context);
  return nextResolve(specifier, context);
} });

let now = 0;
globalThis.performance = { now: () => now };
globalThis.window = {};
globalThis.location = { search: '' };
globalThis.devicePixelRatio = 3;
globalThis.innerWidth = 1920;
globalThis.innerHeight = 1080;
const saved = new Map();
globalThis.localStorage = { getItem: k => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, v) };
globalThis.Path2D = class {};

const canvases = [], buttons = [];
const menu = { insertBefore(button) { buttons.push(button); } };
globalThis.document = {
  getElementById(id) { return id === 'menu' ? menu : null; },
  createElement(tag) {
    if (tag !== 'canvas') return {};
    const canvas = { width: 0, height: 0, style: {}, clears: 0, fills: 0, removed: false,
      remove() { this.removed = true; } };
    const ctx = new Proxy({
      clearRect() { canvas.clears++; }, fillRect() { canvas.fills++; },
      createRadialGradient() { return { addColorStop() {} }; },
    }, { get(target, key) { return target[key] ?? (() => {}); } });
    canvas.getContext = () => ctx;
    canvases.push(canvas);
    return canvas;
  },
};

const { gfx } = await import('./client/gfx.js');
const { createMapView } = await import('./client/map-view.js');
const { setupLight, renderFrame } = await import('./client/light.js');
const { perf } = await import('./client/perf.js');
const { CELL } = await import('./shared/sim.js');

let qualityChanges = 0, goreChanges = 0;
const offQuality = gfx.onChange(() => qualityChanges++), offGore = gfx.onGoreChange(() => goreChanges++);
gfx.setGore(false); gfx.setGore(false);
assert.equal(goreChanges, 1, 'a repeated gore setting must not invalidate subscribers');
assert.equal(qualityChanges, 0, 'gore must not rebuild quality-dependent terrain or materials');
assert.equal(saved.get('ww2-gore'), 'off');
gfx.set('low'); gfx.set('low');
assert.equal(qualityChanges, 1);
assert.equal(goreChanges, 1);
gfx.set('high');
offQuality(); offGore(); gfx.setGore(true);
assert.equal(qualityChanges, 2, 'quality listeners can unsubscribe');
assert.equal(goreChanges, 1, 'gore listeners can unsubscribe');

const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 1, 2200);
const w = 32, h = 24, MW = w * CELL, MH = h * CELL;
camera.position.set(MW / 2, 250, MH / 2);
camera.lookAt(MW / 2, 0, MH / 2); camera.updateMatrixWorld();
const geometry = new THREE.PlaneGeometry(MW, MH); geometry.rotateX(-Math.PI / 2); geometry.translate(MW / 2, 0, MH / 2);
const units = new Map([[1, { id: 1, type: 'rifle', owner: 0, x: MW / 2, z: MH / 2 }]]);
const map = createMapView({ grid: Array.from({ length: h }, () => Array(w).fill('.')), w, h, geometry,
  hAt: () => 0, fog: { texture: new THREE.Texture() }, units, colorOf: () => '#123456', title: 'Test map',
  camera, view: { after() {} }, state: () => ({ me: 0, selected: new Set([1]) }) });
const [paper, desk, overlay] = canvases;
map.frame(1 / 60, 0);
assert.equal(map.renderObject, null);
assert.equal(overlay.width, 0);
map.frame(1 / 60, 1);
assert.equal(map.renderObject, null, 'a partially faded desk must still render the battlefield');
assert.ok(map.fade > 0 && map.fade < 1);
assert.equal(overlay.width, 2880, 'overlay pixel ratio is capped at 1.5 on a 3x display');
assert.equal(overlay.height, 1620);
for (let i = 0; i < 120; i++) map.frame(1 / 60, 1);
assert.equal(map.fade, 1, 'the fade must reach an exact opaque state');
assert.equal(map.renderObject, map.object);
assert.equal(map.object.children.length, 3, 'the map-only render keeps desk, relief paper and fog wash');
assert.equal(map.object.children[2].material.uniforms.k.value, 0.55, 'the map keeps its live fog wash');
const clears = overlay.clears, fills = paper.fills;
for (let i = 0; i < 120; i++) { units.get(1).x += 0.1; map.frame(1 / 60, 1); }
assert.equal(overlay.clears - clears, 60, 'moving symbols redraw at 30 Hz on a steady 60 Hz view');
assert.equal(paper.fills, fills, 'symbols must not repaint paper terrain');
const beforeMove = overlay.clears;
camera.position.x += 1; map.frame(1 / 120, 1);
assert.equal(overlay.clears, beforeMove + 1, 'camera input redraws without waiting for the symbol cadence');
const beforeResize = overlay.clears;
globalThis.innerWidth = 1600; map.frame(0, 1);
assert.equal(overlay.clears, beforeResize + 1);
assert.equal(overlay.width, 2400);
const beforeRefresh = overlay.clears;
map.refresh(); map.frame(0, 1);
assert.ok(paper.fills > fills, 'terrain changes repaint on the next visible frame');
assert.equal(overlay.clears, beforeRefresh + 1);
map.setGeometry(geometry.clone()); map.frame(0, 1);
assert.equal(overlay.clears, beforeRefresh + 2, 'new relief geometry redraws immediately');

const scene = new THREE.Scene(); scene.add(map.object);
const battlefield = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()); scene.add(battlefield);
const rendered = [];
const renderer = { shadowMap: {}, info: { autoReset: true, render: { calls: 0, triangles: 0 },
  reset() { this.render.calls = this.render.triangles = 0; } },
  render(root) { rendered.push(root); root.traverse(node => { if (node.isMesh) { this.info.render.calls++; this.info.render.triangles += 2; } }); } };
// This renderer measures scene routing without a GPU. Supply the GPU-created resource at its boundary.
const environment = new THREE.Texture();
const { sun } = setupLight(renderer, scene, camera, () => environment);
assert.equal(scene.environment, environment, 'High attaches the reflection environment');
gfx.set('low');
assert.equal(scene.environment, null, 'Low avoids reflection sampling');
gfx.set('high');
assert.equal(scene.environment, environment, 'High restores the same environment after a quality change');
const goreButton = buttons.find(b => b.id === 'goreBtn');
let shadowResizes = 0;
const setShadowSize = sun.shadow.mapSize.set.bind(sun.shadow.mapSize);
sun.shadow.mapSize.set = (...args) => { shadowResizes++; return setShadowSize(...args); };
goreButton.onclick();
assert.equal(goreButton.textContent, 'Gore: Off');
assert.equal(shadowResizes, 0, 'gore UI refresh must not reapply shadow quality');
const ground = map.object.children[1];
let updates = 0; const stopPerf = perf.onUpdate(() => updates++);
for (let i = 0; i < 90; i++) {
  const start = now; now += 1000 / 60;
  map.frame(1 / 60, 1); renderFrame({ dist: 400 }, ground, map.renderObject);
  perf.frame(renderer, start, { units: units.size, fx: 5, corpses: 2 });
}
assert.equal(rendered.at(-1), map.object, 'opaque map rendering excludes the battlefield');
assert.equal(renderer.info.render.calls, 3);
assert.equal(window.__perf.calls, 3, 'map render counts stay current');
assert.ok(window.__perf.fps >= 59 && updates > 0, 'the performance overlay keeps rolling while the map is opaque');
assert.equal(window.__perf.fx, 5);

camera.aspect = 10; camera.updateProjectionMatrix(); map.frame(0, 1);
assert.equal(map.renderObject, null, 'an uncovered desk edge restores the full scene');
renderFrame({ dist: 400 }, ground, map.renderObject);
assert.equal(rendered.at(-1), scene);
camera.aspect = 16 / 9; camera.updateProjectionMatrix(); map.frame(0, 1);
assert.equal(map.renderObject, map.object);
camera.far = 100; camera.updateProjectionMatrix(); map.frame(0, 1);
assert.equal(map.renderObject, null, 'a desk clipped by the far plane cannot hide the battlefield');
camera.far = 2200; camera.updateProjectionMatrix();
camera.lookAt(MW / 2, 500, MH / 2); map.frame(0, 1);
assert.equal(map.renderObject, null, 'a camera pointing above the desk restores the full scene');
camera.lookAt(MW / 2, 0, MH / 2); map.frame(0, 1);
assert.equal(map.renderObject, map.object);
map.frame(1 / 60, 0.85);
assert.equal(map.renderObject, null, 'zooming back in restores the battlefield on the first fade frame');
for (let i = 0; i < 120; i++) map.frame(1 / 60, 0);
assert.equal(map.fade, 0);
assert.equal(map.object.visible, false);
assert.equal(overlay.width, 0);
const hiddenPaints = paper.fills;
map.refresh(); map.frame(1 / 60, 0);
assert.equal(paper.fills, hiddenPaints, 'hidden terrain changes wait until the map returns');
map.frame(1 / 60, 1);
assert.ok(overlay.width > 0, 'returning to the map restores its overlay');
assert.ok(paper.fills > hiddenPaints);
map.dispose(); stopPerf();
assert.equal(overlay.removed, true);
assert.ok(desk.fills > 0);
console.log('client performance checks passed: gore invalidation, map fade, bounded pixels, redraw cadence and render routing');
