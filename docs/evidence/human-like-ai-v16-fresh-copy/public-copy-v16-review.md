# V16 public-copy candidates

Recommend the small fresh-root helper if root adopts a copy optimization. It saves 25.0% of the first screen-unit clone in the bounded native-root micro, and 14.3% of the complete screen-plus-memory copy pair. This is a local saving, not evidence that the original V16 performance failure passes. The larger dual-copy candidate saves 24.7% of the copy pair but adds more code and temporary allocations, so it is the second choice.

The current source already shares frozen delivered terrain versions. `perceiveScene` inherits `chars`, `flags`, `height`, `mapChars` and `mapHeight` from `viewFor` and never sends them through `detachedCopy`. The 300 captured native copy roots confirm that the actual repeated copy payloads are small unit, player, event and detector graphs. Terrain caching cannot remove a copy that does not occur.

The fresh-root helper applies only to `u`, the new ordinary object produced immediately by `{ ...delivered, ...observed fields }`. Spread has already read top-level accessors and created data properties. The helper skips redundant top-level descriptors while continuing to use the unchanged `copyData` for every nested graph. A per-copy map and whole-root native fallback retain aliases, cycles, prototype conversion, sparse properties, accessors and Proxy trap semantics. Public `detachedCopy`, retained memory, and all other callers continue using the old checked path.

The dual-copy helper allocates independent screen and memory graphs in one validated traversal. Its first version failed the nested Proxy followed by Date negative: fallback retried `detachedCopy`, which repeated source traps. The corrected helper falls directly back to `structuredClone` on the original root. The failed trial and correction are retained. Although the corrected candidate passes the controls, it introduces temporary two-item arrays and one extra top-level spread object. Its effect on GC tails remains uncertain.

## Bounded diagnostic evidence

All micros ran on CPU1 at nice 19. No new acceptance benchmark ran and no original rows changed. Every measured trial was retained.

| Micro | Payloads and fixed work | Baseline median | Candidate median | Saving |
| --- | --- | ---: | ---: | ---: |
| First screen clone, fresh-root helper | 75 captured fresh unit roots, 100 sweeps; 2 warmup pairs, 12 alternating measured pairs | 18.808 ms | 14.108 ms | 25.0% |
| Screen and memory pair, fresh-root helper | Same 75 roots, 40 sweeps; 3 warmup triples, 12 alternating measured triples | 15.065 ms | 12.913 ms | 14.3% |
| Screen and memory pair, dual-copy helper | Same triple comparison | 15.065 ms | 11.344 ms | 24.7% |

The earlier 85-root dual micro included 10 already remembered unit roots. It was not the selected direct fresh-unit comparison and remains saved in `/tmp/public-copy-pair-micro.json`: 19.838 to 15.913 ms, 19.8% saving. The later 75-root comparison uses `hpBasis && !screenSeen` from the previously captured native payloads. These are small isolated clone benchmarks, not latency percentiles or a resampled acceptance population.

Both candidates pass the existing camera-perception and privacy suites. Both also pass nine graph and source-trace controls covering cycles, shared references, sparse arrays, own `__proto__`, null prototypes, native types and buffer aliases, accessors, ordinary Proxy descriptor traps, Proxy plus native fallback rejection, functions and symbols. Existing perception checks also verify mutation isolation between delivery, screen, retained memory and recalled detail.

Each candidate matches the frozen baseline in six native integration cases: Easy, Normal and Hard at seed 183; Normal at seeds 907 and 908; and Hard handoff at seed 911. Exact input logs, command logs, and the full enumerable authoritative game plus commander-memory graph match, including aliases, cycles and function source text. These checks retain the original game, input, command, cadence and RNG paths. The final dual candidate was rerun after its fallback correction.

The source manifest verifies all 206 frozen files in each scratch runtime. Only `shared/ai-perception.js` differs. The fresh-root diagnostic module adds one helper export for the micro; the proposed production patch excludes that export. No repository files or commits were changed.

## Artifacts

Recommended patch: `/tmp/ai-v16-fresh-root.patch`.
Alternative patch: `/tmp/public-copy-pair-v16.patch`.

Fresh-root micro: `/tmp/ai-v16-fresh-root-micro.json`.
Paired comparison with all trials: `/tmp/public-copy-options-micro.json`.
Native equality reports: `/tmp/public-copy-root-native-equivalence.json`, `/tmp/public-copy-pair-native-equivalence.json`.
Existing suites: `/tmp/public-copy-root-controls.log`, `/tmp/public-copy-pair-controls-final.log`.
Source-trace controls: `/tmp/public-copy-root-proxy-controls.json`, `/tmp/public-copy-pair-proxy-controls.json`.
Source and patch hashes: `/tmp/public-copy-v16-source-manifests.json`.

Preserved failures: `/tmp/public-copy-pair-proxy-controls.initial-failure.log`, `/tmp/public-copy-pair-controls.initial-harness-failure.log`. The latter records a harness-only import failure resolving `three` from a data URL, corrected by executing the unchanged tests from their scratch filesystem path. Frozen read-only permissions also initially prevented scratch writes; preparation now changes only scratch permissions before patching. The preparation scripts retain those fixes.
