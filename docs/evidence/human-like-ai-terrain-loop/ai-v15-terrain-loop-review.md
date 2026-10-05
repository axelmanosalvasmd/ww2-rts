# V15 terrain-loop scratch candidate

The nested row/column scan preserves the tested fog behavior and reduces isolated terrain-build time. Its absolute saving is modest, so this review does not recommend it as a demonstrated solution to the remaining performance gate. No production files, documentation, staging or commits were changed. No acceptance benchmark ran.

The reviewable patch is `/tmp/ai-v15-terrain-loop.patch`. It changes only fogTerrain's second scan, keeping ascending cell order while calculating the block-row offset once per row. All terrain-cache allocation, keys, version handling, stamp reuse, reads and writes remain in place. It introduces no visibility sharing or retained knowledge.

Original sim SHA-256: `20d8f1d1e9f14f8a2178cbc8b30e1732ac5afc367632400081ca393048aaac51`.
Candidate sim SHA-256 before test instrumentation: `5bedd607250c8171ed053e6200a643ce7f57a55c2549e0b515d80fcdffac832b`.

## Isolated cost

The frozen V15 baseline captured 42 actual cache builds at ticks 322, 422, 430, 542, 762 and 982. Tick 494 was included in the capture predicate but did not rebuild terrain. Both implementations produced equal complete results on every captured build.

The micro ran on CPU10 at nice 19 with two untimed paired warmups, followed by twelve fixed alternating before/after pairs. Input cloning happened outside the timer, and every trial is retained, including a slower candidate trial of 10.596 ms.

| Scope | Before median | After median | Difference |
| --- | ---: | ---: | ---: |
| All 42 builds | 6.842 ms | 5.644 ms | 1.198 ms, about 17.5% |
| Arithmetic average saving per build | | | About 0.029 ms |

At comparable steady-state cost, six rebuilt seat caches would save roughly 0.17 ms. That extrapolation is not a whole-frame measurement and does not establish closure of the 0.607 ms counts-p95 shortfall. The earlier profiler's multi-millisecond fogTerrain residence includes instrumentation and cannot substitute for this absolute cost measurement. No favorable trials were selected or discarded.

## Correctness evidence

`/tmp/test-v15-terrain-loop.mjs` accepts before root, after root, captured-fixture file and output path as optional arguments. It passed 554 cache cases and all 261 previously captured fogSource inputs after rebuilding each terrain cache with the respective implementation.

The controls cover dimensions including zero, one-cell and nonmultiples of eight; null/undefined/negative heights; sight and elevation edits; same-key stale cache behavior; repeated version changes; malformed or edited prior derivative arrays; original stamp aliases; generation isolation; and instrumented array access order. Captured-source comparison checks exact masks, ordered stationary cell lists and complete returned objects.

A separate sequence verifies actual visible-to-hidden-to-visible transitions for smoke, high ground and sight blockers, then moving sources and null height. It compares full fog state and private cache histories, and asserts that both current-canonical and stale-private view delivery leave the authoritative game unchanged.

The following existing frozen tests passed against both implementations:

- `test-engine-ai-privacy.js`: hidden mine information, observed terrain and effect privacy.
- `test-engine-ai-effect-visibility.js`: canonical effects, poisoned cache history, private refresh and World isolation.
- `test-ai-terrain-delivery.js`: 40 complete view/game/memory equivalence cases.

## Frozen workload equivalence

The original seeded six-fronts 1000-tick workload ran with identical semantic instrumentation on both scratch copies. Canonical encoding matched the complete enumerable game graph at every tick, including Map/Set order, array holes, object references and typed-array backing-buffer aliases. All 303 native input values and all 130 native command values also match.

- Full game sequence SHA-256: `1e9b6362c3c8090d3c67365711cb0fc48016157ef75e6b5ad18d1ae76f01f826`
- Native input sequence SHA-256: `d1c1aa7ed12f5774969e264100e99f5f64aa22e6de832d9498078a6490e63455`
- Native command sequence SHA-256: `d7dd3b1cf570ae32d59c6329e586ad34047d1f10a5147bc48e680bda9fd189d7`

Both also match the original V15 exact report's final state, all three sampled payloads, snapshot-byte distribution, fixture, unit counts, event counts, current/peak state counts and path statistics. The canonical full-game sequence does not include private commander WeakMap memory. Private fog/memory equivalence is covered by the focused sequence and existing terrain-delivery controls, not claimed for every private field throughout the 1000-tick workload.

The semantic workload's timings include hashing and capture overhead and are not performance evidence.

## Retained failed attempts

The first semantic harness hashed raw V8 serialization bytes. Full-game and native-input byte hashes differed while commands, final state and sampled payloads matched. A minimal control confirmed that equal arrays can serialize differently when their internal integer/double representation differs. The canonical reruns then matched every per-tick graph and every native input value. Initial reports and the initial harness remain retained; their byte hashes are not treated as value-equivalence evidence.

The initial smoke/hill fixture incremented an undefined terrainVersion to NaN. Its hill visibility assertion failed in both implementations because that malformed version did not invalidate the retained source as intended. The fixture now initializes the version to zero before deliberate terrain edits. Initial source, failure and debug logs remain retained. The corrected sequence passes both exact comparison and the positive visibility controls.

## Artifacts

- Tiny patch: `/tmp/ai-v15-terrain-loop.patch`
- Source manifests and command record: `/tmp/ai-v15-terrain-loop-protocol.json`
- Portable cache/capture test: `/tmp/test-v15-terrain-loop.mjs`
- Cache/capture result: `/tmp/ai-v15-terrain-loop-controls.json`
- Actual captured terrain builds: `/tmp/ai-v15-terrain-loop-before-terrain.bin`
- All twelve paired micro trials: `/tmp/ai-v15-terrain-loop-micro.json`
- Full-game/native-input equality: `/tmp/ai-v15-terrain-loop-equivalence.json`
- Canonical workload reports: `/tmp/ai-v15-terrain-loop-{before,after}-canonical.json`
- Initial V8 reports: `/tmp/ai-v15-terrain-loop-{before,after}.json`
- Fog sequence: `/tmp/ai-v15-terrain-loop-fog-sequence.json`
- Existing test logs: `/tmp/ai-v15-terrain-loop-{before-,}{privacy,effects,delivery}.log`

The original acceptance failure remains unchanged. Root can review the small patch as an isolated engine improvement, but the evidence does not justify presenting it as the performance fix or launching an acceptance resample without further authorization.
