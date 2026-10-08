import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// Run against a local game server. TEST_BASE_URL and PLAYWRIGHT_MODULE can select other local setups.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
  await page.goto(base + '/client/index.html');
  console.log(await page.evaluate(async () => {
    const { candidates, candidateBatches, createProps } = await import('/client/props.js');
    const THREE = await import('three');
    const { createRelief } = await import('/client/relief.js');
    const { createGround } = await import('/client/ground.js');
    const { gfx } = await import('/client/gfx.js');
    gfx.set('high');
    const qualityMap = { w: 64, h: 64, rows: Array(64).fill('.'.repeat(64)) };
    const grass = candidates(qualityMap).filter(c => c.kind === 'grass').slice(0, 300);
    const changing = createProps({ map: qualityMap, grid: qualityMap.rows, hAt: () => 0, parent: new THREE.Group(), prepared: grass, deferRefresh: true });
    const interrupted = changing.refreshBatches(); interrupted.next();
    gfx.set('low');
    while (!interrupted.next().done) {}
    if (changing.group.children.some(mesh => mesh.count > 0)) throw new Error('A stale discovery batch restored grass after a graphics downgrade');
    changing.dispose(); gfx.set('high');
    const results = [];
    for (const [w, explored] of [[512, false], [1024, false], [1024, true]]) {
      const h = 512, map = { w, h, rows: Array(h).fill('.'.repeat(w)), world: {}, discovered: new Uint8Array(w * h) };
      for (let y = 20; y < 60; y++) for (let x = 20; x < 60; x++) map.discovered[y * w + x] = 1;
      if (explored) for (let y = 0; y < h; y++) for (let x = 0; x < w * 0.75; x++) map.discovered[y * w + x] = 1;
      const grid = map.rows.map(row => [...row]), parent = new THREE.Group();
      let heightReads = 0;
      const hAt = () => { heightReads++; return 0; };
      const start = performance.now(), list = candidates(map), candidateMs = performance.now() - start;
      const work = candidateBatches(map); let batch, slices = 0, maxSliceMs = 0;
      do {
        const begin = performance.now();
        do { batch = work.next(); } while (!batch.done && performance.now() - begin < 3);
        maxSliceMs = Math.max(maxSliceMs, performance.now() - begin); slices++;
        if (!batch.done) await new Promise(resolve => requestAnimationFrame(resolve));
      } while (!batch.done);
      if (JSON.stringify(list) !== JSON.stringify(batch.value)) throw new Error('Scenery placements changed');
      const buildStart = performance.now(), props = createProps({ map, grid, hAt, parent, prepared: batch.value, deferRefresh: true });
      const buildMs = performance.now() - buildStart;
      if (props.group.children.some(mesh => mesh.count !== 0)) throw new Error('Deferred scenery must not draw unplaced instances');
      const placement = props.refreshBatches(); let placed, placementSlices = 0, maxPlacementMs = 0;
      do {
        const begin = performance.now();
        do { placed = placement.next(); } while (!placed.done && performance.now() - begin < 3);
        maxPlacementMs = Math.max(maxPlacementMs, performance.now() - begin); placementSlices++;
        if (!placed.done) await new Promise(resolve => requestAnimationFrame(resolve));
      } while (!placed.done);
      const unchangedNodesStart = performance.now();
      const previousReads = heightReads;
      for (let tick = 0; tick < 10; tick++) props.setNodes([]);
      const unchangedNodesMs = performance.now() - unchangedNodesStart;
      if (heightReads !== previousReads) throw new Error('Unchanged resource nodes repositioned scenery');
      const catchupStart = performance.now(); props.refresh([40, 120, 120, 128]);
      const catchupMs = performance.now() - catchupStart;
      if (!explored) {
        const reference = createProps({ map, grid, hAt: () => 0, parent, prepared: candidates(map) });
        for (let i = 0; i < props.group.children.length; i++) {
          const actual = props.group.children[i], wanted = reference.group.children[i];
          if (actual.count !== wanted.count || actual.instanceMatrix.array.some((v, k) => v !== wanted.instanceMatrix.array[k])) throw new Error('Deferred placements differ from synchronous scenery');
        }
        reference.dispose();
      }
      const renderer = new THREE.WebGLRenderer(); renderer.setSize(64, 64);
      const scene = new THREE.Scene(); scene.add(parent); scene.add(new THREE.AmbientLight(0xffffff, 2));
      const camera = new THREE.PerspectiveCamera(50, 1, 1, 4000); camera.position.set(80, 100, 80); camera.lookAt(80, 0, 80);
      renderer.render(scene, camera);
      if (renderer.getContext().getError() !== 0) throw new Error('Scenery instance buffers produced a WebGL error');
      renderer.dispose();
      props.dispose();
      map.heights = Array(h).fill('0'.repeat(w));
      const relief = createRelief(map, grid, { low: true });
      const cells = [];
      for (let y = 60; y < 64; y++) for (let x = 20; x < 60; x++) {
        map.heights[y] = map.heights[y].slice(0, x) + '1' + map.heights[y].slice(x + 1);
        cells.push([y * w + x, '.', 1]);
      }
      relief.update(cells);
      const ground = createGround(map, null, { frames: { request: callback => requestAnimationFrame(callback), cancel: id => cancelAnimationFrame(id) } });
      await ground.loading; ground.paint(grid, new Uint8Array(w * h));
      const paintStart = performance.now(); ground.paint(grid, new Uint8Array(w * h), undefined, undefined, cells);
      const groundCheckMs = performance.now() - paintStart;
      results.push({ w, explored: explored ? '75%' : '1600 cells', candidates: list.length, candidateMs, buildMs, slices, maxSliceMs,
        placementSlices, maxPlacementMs, unchangedNodesMs, catchupMs, reliefMs: relief.stats.updateMs, groundCheckMs });
      relief.dispose(); ground.dispose();
    }
    return results;
  }));
  await page.route('**/tools/test-render-browser.html', route => route.fulfill({ contentType: 'text/html',
    body: readFileSync(new URL('./test-render-browser.html', import.meta.url), 'utf8').replace('/node_modules/three/build/three.module.js', '/vendor/three.module.js') }));
  await page.goto(base + '/tools/test-render-browser.html');
  await page.waitForFunction(() => window.__renderCheck !== undefined);
  const rendered = await page.evaluate(() => window.__renderCheck);
  console.log(rendered); assert.equal(rendered.passed, true);
} finally { await browser.close(); }
