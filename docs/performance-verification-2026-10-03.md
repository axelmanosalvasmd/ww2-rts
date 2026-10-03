# Performance regression verification, 2026-10-03

Reviewed the eight-hour window ending 2026-10-03 01:56 UTC, including PRs #33 and #34, then traced older rendering
changes when the recent code pointed to them. The reviewed base was `66a3734240d98d32d4c5ecd471bd7a1bbbc63336`.
Fetching before integration confirmed that it remained the latest `master`. The source checkout was safely
fast-forwarded from `e5544ad`; the running hosted match was not changed.

The largest measured regression came from the ragged scar raster introduced in `b7b665d` and expanded in `163a080`,
before the eight-hour window. It performed neighborhood and noise calculations per texture pixel during snapshot
handling. Detailed corpse rendering came from PR #30. The paper map and gore invalidation came from `79147e3`, and
wall clearance costs came from `0363ef2`. Commit records do not identify which model produced those changes.

## Terrain raster

Apple M3 Max, Node 24.20.0. Five fresh processes per revision/mode, identical current default map, 80 by 80 cells,
24 pixels per cell. Canvas paths are no-ops and textures stay on the flat fallback. These are JavaScript
measurements; browser drawing, texture upload and mipmap cost are excluded.

| Default-map case | Original | Fixed synchronous | Fixed queued handler | Queued total work |
| --- | ---: | ---: | ---: | ---: |
| Initial paint | 886.37 ms | 259.67 ms | 259.42 ms | 259.42 ms |
| Single-cell crater | 77.55 ms | 26.32 ms | 3.87 ms | 27.11 ms |
| 9 by 9 crater | 307.43 ms | 82.39 ms | 1.55 ms | 83.79 ms |

The queued 9 by 9 case used 18 frames. The median of each run's slowest paint frame was 9.32 ms, excluding GPU work.
The 6 ms raster budget is soft because one tile cannot be interrupted. Six original raster hashes remain identical;
coalesced incremental painting matches a fresh full paint. Cancellation, same-size reuse, stale owners, texture
readiness and copied GPU rectangles are checked through the ground interface.

## Bodies and paper map

At 200 rifle bodies, close detail remains 161,824 triangles in four batches; distance detail uses 29,000 triangles
in four batches, 82.1% fewer. The mixed-uniform fixture allocates 57,344 instance bytes for close bodies, compared
with 716,800 before. Expiry releases all corpse geometry and instance pools. Off-screen bodies remain logical and
age without entering draw batches. The tests also check growth, transforms, fade, sinking and death batching.

At a 1920 by 1080 CSS viewport and DPR 3, the paper overlay falls from 18,662,400 to 4,665,600 pixels, 75% fewer.
A steady view redraws symbols 30 times per second; camera, resize and terrain changes redraw immediately. The
battlefield is omitted only when the fully opaque desk covers the clipped viewport. Gore changes do not notify
quality-dependent subscribers.

## Movement orders

The portable Six Fronts benchmark compares the same map, units and commands across revisions. Three interleaved
runs per mode, 32 packets per run, four warmup packets excluded: 84 warm samples per revision per mode.

| 60-unit command fixture | Original mean / p95 | Fixed mean / p95 |
| --- | ---: | ---: |
| No bunkers | 18.96 / 23.19 ms | 17.72 / 21.68 ms |
| Six live bunkers | 54.93 / 60.32 ms | 32.80 / 35.34 ms |

All 192 paired packets retained identical route hashes and search counters. Costs refresh on every search. Tests
cover mines, walls, roads, mud, weather, wear, water, elevation and bunker insertion, movement, death and removal.
The earlier simulation audit did not reproduce a consistent severe server tick regression.

## Native WebGL check

A background local fixture used actual Three.js and WebGL, with no game connection. Queued texture updates and full
painting produced identical GPU pixels (maximum channel difference 0); all 12 queued frames copied once. Full-scene
and paper-only rendering also produced identical pixels (difference 0), using four versus three draw calls in the
small fixture. The corpse fixture submitted 808 close versus 145 distant triangles. All WebGL error checks were 0.
This verifies upload and render semantics, not match FPS or GPU timing.

## Reproduce

```sh
npm ci --ignore-scripts --no-audit --no-fund
node test.js
node test-world.js
node tools/bench-ground.mjs --map maps/default.json
node tools/bench-ground.mjs --map maps/default.json --deferred
node tools/bench-ground.mjs --root /path/to/original --map maps/default.json
node tools/bench-move.mjs
node tools/bench-move.mjs --bunkers
node tools/bench-move.mjs --root /path/to/original --bunkers
python3 -m http.server 3845 --bind 127.0.0.1
```

Open `http://127.0.0.1:3845/tools/test-render-browser.html` for the native WebGL fixture. Benchmarks report timings;
regression tests use behavior, pixels, geometry and route assertions rather than timing thresholds. CI runs the
full game and world checks on Node 24. Initial/texture-ready painting remains synchronous, and queued painting
makes more total mipmap generations than one synchronous update. Real match FPS, GPU timing and the user's exact
network-versus-render symptom remain unmeasured while the user plays.
