# Terrain workshop

Run `node tools/serve-movement-lab.mjs --port 3047`, then open <http://127.0.0.1:3047/tools/terrain-workshop.html>. The server listens only on loopback. The movement lab also links to the workshop.

The workshop builds native faction vehicle models on the game's `createRelief` ground mesh and painted ground textures. Each step places the root at `relief.hAt`, runs `animate`, then runs `vehicleTerrainPose` on `vehicleBody`, matching the game's presentation pipeline. Native model textures finish loading before the browser reports readiness.

Choose a mountain climb and descent, a cross slope, a rounded hill, a narrow crest, a trench crossing or flat ground. The generated scene uses the full 512 by 512 World Conquest map with seed 20261003 and crosses an ordinary hillside near cell 122,40. It uses the game's World Conquest terrain quality setting. Run and pause playback, take one frame, or scrub distance to inspect a particular position. Side, oblique and front views follow the vehicle. Turn terrain alignment off to compare the level hull at the ground height under its center.

The original mountain and cross-slope heights and camera views remain unchanged for geometry comparisons. The rounded hill exercises slopes in both axes. The ramp-beside-cliff scene keeps a vertical two-level wall beside an ordinary ramp; its scripted path can cross that wall even though game navigation would block it. The generated scene uses unmodified game generation and map heights. All paths are scripted presentation checks. They do not simulate navigation, gravity, orders, combat or server movement. Use the movement lab for simulation behavior.

The inspection panel reports center ground height, visual pitch and roll, chassis lift and the smallest probe gap. A negative gap means a displayed probe is below the ground. Nine probes show the front, middle and rear of the native track or tire footprint. The support solver also checks terrain vertices and footprint boundaries, so a narrow ridge cannot slip between those probes. The browser API reports each probe and its ground height, plus world forward and up vectors.

For browser automation, wait for `window.__terrainWorkshopReady === true`, then use:

```js
const workshop = window.__terrainWorkshop;
workshop.reset({ scenario: 'ramp', type: 'medium', faction: 0, aligned: true, view: 'side' });
workshop.seek(13);
workshop.advance(0.5);
const telemetry = workshop.state();
```

`reset` accepts `scenario`, `type`, `faction` (0 through 3), `aligned` (also accepted as `alignment`) and `view`. It resets elapsed time and pauses playback. `seek` accepts distance in metres, pauses playback and immediately applies the current ground pose. `advance` accepts 0 through 120 seconds and divides the interval into steps of at most 1/60 second. `state` includes distance, elapsed time, height, pitch and roll in radians, chassis lift, minimum and maximum contact gap, all nine contacts, texture status and world direction vectors. When inspecting an older client without the native footprint cache, support telemetry falls back to independently measured lower-hull vertices and reports `contactAvailable: false` and its fallback source.

The fixtures module can also be imported in Node. The loopback server serves only named lab files, shared JavaScript, client JavaScript and image assets, and the installed Three.js build. Its existing `--root` option selects the shared simulation source for movement comparisons. Workshop client modules and assets come from the checkout containing the server.
