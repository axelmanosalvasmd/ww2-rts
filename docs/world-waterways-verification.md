# Variable river networks: generator v3 verification

## Behavior

- Seeded 1-3 main rivers, each with two bridges and two permanent fords.
- Seeded 0-3 tributaries, using shallow ford terrain along their length.
- Terrain-cost channel routing, connected outlets, and wider downstream main channels.
- Main rivers currently drain north to south. All water uses the existing flat level-zero plane;
  this is game-oriented valley carving, not a hydraulic or erosion simulation.
- Lake, roads, settlements, and territory generation preserve the network.
- Complete paths and crossing diagnostics are authoritative-only. Live clients discover terrain normally.

No server deployment, commit or push was performed for this change.

## Reproduce

```sh
node test-world-waterways.js
node test-world-generation.js
node test-world-multiple-rivers.js
node test-world-conquest.js
node tools/test-world-waterway-seeds.mjs 80
node test.js
```

`test-world-multiple-rivers.js` uses real WebSocket move orders. Both the rifle squad and tank must be
observed on a permanent ford in every main river, remain out of impassable water, and reach their final
destination. It covers two-river seed 1 and three-river seed 2. The existing default river test remains.

The shared bridge-destroyed reachability helper requires a three-cell-wide clear route and legal height
steps to every regional objective. It is a conservative raster check, not a replacement for squad or army
throughput testing. Controlled movement scenarios do not establish multiplayer balance.

## Results

- Focused waterways, generation, conquest secrecy, and two-/three-river movement tests: PASS.
- 80 seeded worlds, with both sizes, 1-6 seats and mixed teams: PASS. Each map was generated twice and
  compared exactly. Every objective retained correct membership. Every channel centerline survived
  roads/settlements. Every objective remained tank-clearance reachable with bridges treated as water.
- The sweep exercised every combination of 1-3 main rivers and 0-3 tributaries.
- Review-driven test hardening: exact two-ford/two-bridge counts, distinct crossing locations, their
  physical width in the raster, and completed bank-to-bank ford traversals are now asserted. Traversal
  checks require a declared ford belonging to that specific river, not merely a nearby shallow cell. The final
  waterways and one-/two-/three-river movement tests passed again after those test-only changes.
  Production code remained unchanged during the full regression run.
- Full `node test.js` regression: PASS, exit 0. This includes 4,489 paired AI fog-proof turns,
  simulation and room lifecycle checks, model tests, public-lobby checks, and performance regressions.
  The later test-only strengthening described above also passed its focused reruns.
- Final pre-commit `node test.js` rerun: PASS, exit 0, on the complete staged implementation.
  `node test-world.js` also passed, as did the movement fixture under Node 24.
  Pre-commit regression log: `/tmp/ww2-pr-final-tests.log`.

Production source hashes for this run:

- `shared/world-landforms.js`: `ecb6916db6785484f8bb813f7745c8c48ccea370f084fea290ff736edc968e34`
- `shared/world-conquest.js`: `1c251e6d340586d7fb367d4f47938d5898f5239824dac46f054880a3d897aeef`

Local execution evidence:

- `/tmp/ww2-waterways-seeds.log`
- `/tmp/ww2-waterways-regression.log`
- `/tmp/ww2-waterways-source.sha256`

## Actual generated previews

```sh
node tools/preview-world-generation.mjs 0 huge /tmp/rivers-open
node tools/preview-world-generation.mjs 7 huge /tmp/rivers-tributaries
node tools/preview-world-generation.mjs 1 huge /tmp/rivers-two
node tools/preview-world-generation.mjs 2 huge /tmp/rivers-three
```

Seed 0 has one main river and no tributaries. Seed 7 has one main river and three tributaries. Seed 1 has
two main rivers and two tributaries. Seed 2 has three main rivers and one tributary.

The comparison image `/tmp/world-river-networks.png` is rendered from these real PPM exports. It is a
diagnostic terrain overview, not an in-game screenshot. No new browser FPS or controlled grown-army
performance claim is made. Previous Massive stress-budget and headless-capture limitations are not
resolved by this hydrology change.

## Regression caught during implementation

Jittered tributary junctions exposed a crossing-approach bug: painting the road pad could overwrite an
existing shallow stream with dry road. The continuity test failed, the painter was corrected to preserve
ford cells, and the focused checks and final-raster seed sweep passed afterward.
