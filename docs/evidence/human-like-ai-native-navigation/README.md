This package preserves the small region proposal evidence. The native terrain input is 1,489,807 bytes; the cost result is 33,573 bytes and contains both warmup sweeps and all 12 trials. The full CPU profile is excluded.

The proof originally ran from stdin. Its exact enumeration and eligibility were reconstructed into the retained proof script and rerun on CPU 1 at nice 19: 43,220 comparisons, 5,776 eligible connected legs, zero mismatches. No original standalone proof script existed before that reconstruction. This was a tiny geometry control, not a native benchmark.

Current-session reproduction paths are preserved verbatim in MANIFEST.json and the scripts. The isolated region probe module is byte-for-byte original sim.js followed only by `export { regionsFor };`. It imports the other unchanged modules from the original V16 frozen tree. The six native cases also require that frozen tree, the isolated candidate tree, their package dependencies, and the preserved test-engine-ai-human.js harness input. This is an evidence package, not a standalone engine runtime. Keep the original full source freeze alongside it; its original paths and source manifests identify the dependencies. Before relocating a reproduction, update only scratch paths to the preserved sources and input files, preserving file contents and documented hashes. Do not read a subsequently changed ROOT test as the six-case harness input.

Existing commands, to run only when separately authorized:

```sh
nice -n 19 taskset -c 1 node /tmp/v16-region-connectivity-proof.mjs
nice -n 19 taskset -c 1 node /tmp/v16-region-cost-probe.mjs
nice -n 19 taskset -c 1 node /tmp/v16-region-redundancy-native-equivalence.mjs
nice -n 19 taskset -c 1 node /tmp/v16-region-permanent-fixture-equivalence.mjs
```

The unrestricted mutant is reproducible by taking the isolated candidate sim.js and replacing the unique complete full-map guard condition with `if (false) {`, saved only as the scratch sim-global-region-bypass.js beside unchanged imported dependencies. Both stale-array and sparse-height controls reject it independently. The focused raw harness records all 12 routes, counters, terrain values and hole keys. Six native results compare exact inputs, commands and full enumerable game/commander graphs including aliases, cycles, bytes and function source. No performance acceptance result follows from these controls or from the isolated pass cost.
