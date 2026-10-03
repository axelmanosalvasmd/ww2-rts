# Strategic World Generator v2: verification

Historical verification of generator v2, before the v3 river-network extension. This records actual
execution rather than a rendered design concept. See `world-waterways-verification.md` for v3 results.

## Implemented

- Broad seeded hills, cliff-forming ridge spine, broad saddles.
- Winding river, contiguous lake, two destructible bridges and two durable fords.
- Terrain-cost roads with proximity backbone, local loops, crossing approaches and tank-clear verges.
- Clustered woodland and settlement blocks, protected objective/construction clearings.
- Irregular terrain-weighted territories with authoritative cell membership.
- Explored membership runs for AI, minimap, paper map and battlefield borders. Full seed and membership raster stay private.
- Existing Huge/Massive sizes, region counts, costs and victory rules retained.

## Commands exercised

- `node test-world-generation.js`: PASS. Two presets, five deterministic seeds each; reproducibility, substantial relief, lake/bridges, irregular membership and three-cell-wide connectivity to every objective with all bridges treated as water.
- `node test-world-territories.js`: PASS. Explored-run filtering, irregular membership and perimeter edges without internal horizontal seams.
- `node test-world-conquest.js`: PASS. Real WebSocket setup, discovery, territory runs, destruction/claim, paid construction, recruitment and recovery.
- `node test-world-teams.js`: PASS, including 300 AI ticks.
- `node test-world-observation.js`: PASS. Hidden contests remain remembered and AI pursues remembered blockers.
- `node test-world-acceptance.js`: PASS. Capture, production locks, income/capacity, retreat, reconnect, deadline rules, hidden-state perturbations, seeded connectivity and usable homes.
- `node test-world-movement.js`: PASS. Long movement, hidden terrain, collision, continued arrival and stop.
- `node test-world-river.js`: PASS. Real socket rifle/tank orders use a generated ford and reach the opposite bank without traversing water.

The old river test assumed a straight river with fords at `y % 64 == 32`. It now locates an actual generated ford, verifies impassable water is never traversed, and observes both real units arrive. The old rectangular test fixture path remains supported.

Full `node test.js`: PASS, exit 0. It completed 4,489 paired AI fog-proof turns and all simulation,
command feedback, availability, model, destruction-paint, Spanish, public-lobby and performance regressions.
Log: `/tmp/ww2-generator-regression-final.log`. The final outward-home selection adjustment was additionally
verified by rerunning `test-world-generation.js` and `test-world-acceptance.js`, both passing.

Independent `node test-public-lobby.js` and `node test-performance.mjs`: PASS. The latter includes eight
focused pathfinding scenarios and client/ground/corpse regression checks.

Headless browser navigation reached the generated game's ground mesh, but screenshot capture timed out,
including a retry bypassing web-font readiness. Visual verification and live browser FPS remain incomplete.
The attached diagnostic image is generated from real terrain data, not an in-game screenshot. Temporary
preview servers were stopped; no public service was restarted or deployed.

## Generation sweep

An additional 80-map sweep covered alternating Huge/Massive, 1-6 players, dispersed deterministic seeds, successful generation and objective membership. No exceptions or overlapping objective memberships were observed. Early implementation generation times under concurrent load: median 641 ms, p95 986 ms, max 1,264 ms. This sweep predates the final diagonal-road polish and is not a final release benchmark. The final deterministic regression covers the current source.

## Stress measurement

Command:

```sh
node tools/bench-world-conquest.mjs --mobile=64 --ticks=80 --pacing-ticks=600 --out=/tmp/world-generator-bench.json
```

Current host: Linux x64, Node v22.22.3, AMD EPYC-Rome, four logical CPUs, approximately 8 GB RAM. Regression/browser work was running concurrently. This is not an isolated same-seed comparison against the old generator.

- Huge, 576 total units: tick p95 47.34 ms, maximum 94.18 ms.
- Massive, 768 total units: tick p95 88.32 ms, maximum 168.96 ms.
- Huge generation, three samples: median 528 ms, maximum 781 ms.

Massive exceeds the intended 50 ms tick interval in this bounded sample. Do not claim sustained 20 Hz, low-latency large-army commands, browser FPS, or completed-match pacing from these measurements. Historical M3 Max measurements used the old generator on different hardware and are not comparable.

## Reproduce actual terrain previews

```sh
node tools/preview-world-generation.mjs 20261003 huge /tmp/world-new
node tools/preview-world-generation.mjs 42 massive /tmp/world-massive-new
```

Outputs are PPM terrain images and JSON from the exact generator used by the game. PPM can be converted with Pillow or ImageMagick. These diagnostic overviews reveal the full map and are not player screenshots or evidence of rendering FPS.

## Remaining scope and risks

- One river/lake/ridge landscape family with seeded variation, not three independent landscape families.
- Stratified objective placement remains, although membership boundaries are irregular.
- Home filtering guarantees nearby neutral expansion in tested worlds and comparable construction room, not a full travel-time/resource/guard fairness optimizer.
- The generator routes around obstacles and relocates shoreline sites; a general topology-repair/retry/template system is not implemented.
- Natural-match economic balance, bottleneck throughput under very large armies, and full-match human pacing need playtesting.
- Runtime generation is synchronous. Larger sweeps and pathological-seed validation remain worthwhile before public rollout.
