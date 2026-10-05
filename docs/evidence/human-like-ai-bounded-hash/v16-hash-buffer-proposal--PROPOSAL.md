# Prospective verifier digest proposal

The live V16 campaign spends most verification CPU time serializing digest bytes. This proposal changes only the external verifier's digest helper for a future campaign. The running controller, source archive, protocol, measurement rules, score reducers, outputs and retained failures stay unchanged.

## Actual source and profile

Inspected controller: `/tmp/human-ai-final-v16-v4-preparation/run-campaign.mjs`. Frozen storage helper: `/tmp/human-ai-v16-full-source/tools/json-stream.mjs`. Runtime checkpoint: `3bac0c0923bcfe622dac10a8b76783d090eaf249a4c54e3e9a89a305c9e51ae9`.

The original helper already calls crypto.update on 64 KiB buffers. The expensive work is the recursive token generator and repeated TextEncoder.encodeInto calls for small tokens. It is not millions of tiny crypto calls.

A read-only profile of the already-verified Conquest Easy seed 1 match, 110,796,568 raw bytes, recomputed all original seat metrics and digests. Digest serialization used 97.430437 CPU seconds. Parsing used 2.287675 CPU seconds; all three summarizeSeat and manualResponseMetrics calls together used 0.302769 CPU seconds. Full assertion details are in `/tmp/v16-verifier-proposal/profile.json`.

The controller hashes every full seat log, then its included manual stream and private measurement stream again. Packaging later hashes timelines again. These checks remain in this proposal. Parallel verification would reduce serial elapsed time, but would retain this avoidable serialization cost and increase peak memory per worker.

## Proposed helper and narrow patch

`hash-bounded-native.mjs` exports createBoundedNativeHasher(originalHashJSON). It recognizes plain JSON data and computes conservative UTF8 size bounds before calling native JSON.stringify on subtrees no larger than 65,536 bytes. Larger containers are traversed in original property order. Larger strings are escaped in bounded pieces with surrogate pairs preserved. Output buffers are bounded to 65,536 bytes, with periodic event-loop yields. No whole large match is stringified.

Unsupported values use the complete original helper. This includes undefined/function/symbol values, sparse arrays, nonfinite numbers, getters, proxies, conversion hooks, custom prototypes, boxed values, cycles and raw-file sentinels. This preserves original conversion calls and errors. A fresh metadata cache belongs to each call, so later object mutations cannot reuse earlier sizes.

`run-campaign-digest-only.patch` imports the new sibling helper, constructs it with frozen storage.hashJSON and substitutes exactly the three digest calls inside receive. Every source, gzip, byte count, metric, population, censoring, descriptor and coverage assertion remains in place. No scheduling, process pool, scorer, serialization format or compression changes are proposed. The helper belongs to the prospective external verifier and needs its own preregistered fingerprint. It does not replace a file in the frozen runtime archive.

This smallest patch leaves tool.packageReport's internal original hashing unchanged. Accelerating those later package checks would require a separately reviewed verifier-owned hash injection with the original serialization, gzip and readback assertions preserved. An 8.9-fold digest improvement is not an 8.9-fold whole-campaign claim.

## Exact evidence

Five completed immutable Conquest matches were selected before validation: Easy seeds 1 and 20, Normal seeds 1 and 20, Hard seed 1. Raw sizes range from 103,218,330 to 141,399,002 bytes. Five complete match hashes and byte counts match original emitted raw-file manifests. All 45 seat-log, private-stream and manual-stream hashes match original completed verifier manifests. The original raw files and source files were rechecked unchanged.

On the first match, the same nine digest computations dropped from 97.430437 to 10.937359 CPU seconds, an 8.91-fold improvement. Five-case validation took 159.22 wall seconds and 109.03 user CPU seconds. Maximum RSS was 2,618,800 KiB while sequentially parsing five large matches, with earlier heaps retained by GC. This is not a quiet performance gate or game benchmark.

Eleven edge fixtures, three error fixtures and one raw-file fragment pass against original hashJSON. They cover undefined, sparse arrays, escapes, Unicode, numeric serialization, integer key order, aliases, custom toJSON behavior and unsupported-value fallback. The largest instrumented native encoding was 36,410 bytes. Full fixture source and logs are retained.

Current V16 World raw data was unavailable for this bounded review. The native-subtree output bound and large-string fixtures address the oversized-string risk, but this proposal does not claim validation against current World match objects. Before prospective adoption, validate the actual completed World and Classic corpus against the original manifests. No campaign or source behavior needs to change for that check.

The earlier token-buffer-only trial is retained as partial development evidence. It improved the first available case only modestly because recursive generator traversal remained. Its owned scratch process was stopped after the improved candidate was selected; native-controls.log is partial, not a complete PASS. No running campaign process was stopped.

## Reproduction

All controls ran read-only, pinned CPU 1 with nice 19. Original simulation workers and controller were untouched.

```sh
nice -n 19 taskset -c 1 node /tmp/v16-verifier-proposal/profile.mjs
nice -n 19 taskset -c 1 node /tmp/v16-hash-buffer-proposal/test-bounded-native.mjs
nice -n 19 taskset -c 1 node /tmp/v16-hash-buffer-proposal/bounded-native-controls.mjs
```

These are scratch evidence commands, not authorization to modify or rerun the current campaign. Evidence hashes and original paths are recorded in manifest.json. Existing raw files remain in the campaign archive; this proposal does not duplicate them.
