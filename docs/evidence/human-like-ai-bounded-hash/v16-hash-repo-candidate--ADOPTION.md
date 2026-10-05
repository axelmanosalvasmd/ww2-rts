# Prospective hash helper adoption candidate

This scratch patch adds a bounded digest helper, an explicit packaging dependency injection and storage assertions. It does not change the live V16 controller, archive, protocol, rules, reports or timeline files. Root review and a new prospective source/protocol declaration are required before future use.

## Files and contract

The integration patch contains only `tools/hash-json-native.mjs`, `tools/ai-humanity.mjs` and additions to `test-ai-humanity-storage.js`. Original storage assertions remain intact.

The new helper exports `createBoundedNativeHasher(originalHashJSON, {chunkBytes=65536}={})`. Callers supply the original fallback. Unsupported values preserve the original serialization and observable conversion effects. Plain JSON data uses conservative UTF8 bounds and native serialization of at most 65,536-byte subtrees. Larger strings and containers are split. Per-call size caches are discarded after each digest. No serialization format, measurement rule or compressed bytes change.

The packaging API becomes `packageReport(input, output, archive, {hashJSON: verifierHasher}={})`. Its default uses the original imported hashJSON. The CLI and all callers that omit the fourth argument retain the original digest path. The staging, gzip level, source bytes, parse/readback, publication and cleanup logic are unchanged. An invalid helper rejects before staging. An injected digest failure preserves both previous published outputs.

This module is an explicitly selected verifier dependency. Its file hash must be included in the future common archive manifest and verifier preregistration. The frozen gameplay source checkpoint does not import it. The new collector signature changes the collector hash prospectively; existing V16 files and historical source checkpoints stay untouched.

## All digest callsites

| Location | Hashed value | Proposed use |
| --- | --- | --- |
| External verifier receive | Each complete seat log | Explicit bounded helper |
| External verifier receive | Each private perception stream | Explicit bounded helper |
| External verifier receive | Each public manual-response stream | Explicit bounded helper |
| packageReport | Complete logs array per match | Explicit helper only when fourth argument supplied |
| packageReport | Each complete seat log | Same explicit helper |
| packageReport | Each private perception stream | Same explicit helper |
| CLI package and existing callers | Same packaging values | Original default unchanged |
| Native writeJSON, raw-fragment output, gzip, byte/file checks | Original raw serialization and file hashing | Unchanged |

`future-verifier.patch` demonstrates the external runner changes: three receive digest calls and explicit injection into mode and final package calls. It does not alter source validation, original reducers, deep equality, populations, censored accounting, seed coverage, worker scheduling, gzip/readback or any gate. It is a scratch diff, not an active runner edit.

## Validation

The full existing storage test passes on the scratch source. Its three real 20-second matches retain all nine seats, full native Worker graph equality, original reducers, complete physical inputs/commands/events/private callback frames, exact gzip, merge, backpressure, failure preservation and cleanup. This is a focused storage smoke, not a replacement campaign.

Added tests compare observable traces for keyed/stateful toJSON conversion, accessor mutations, toJSON accessors, proxies and throwing accessors. They verify prototype hooks preserve invocation order, aliases retain bytes, mutations between hashes invalidate size caches, cycles/BigInt/undefined preserve errors, and raw fragments keep the original path. Instrumented native encodes remain within 65,536 bytes. Packaging injection yields the exact old compact report and gzip bytes, and reaches every packaging digest callsite.

Historical V15 Classic and World seed 1 objects at Easy, Normal and Hard pass 42 whole-match and stream digest comparisons. Each digest matches the original manifest and the original helper; original raw/gzip/manifest/source files are rechecked unchanged. These six objects are historical V15 data, not current V16 World proof, and no historical scores are changed. Source script, exact paths and digests are in historical-controls.json.

The earlier five current V16 Conquest controls remain at `/tmp/v16-hash-buffer-proposal/bounded-native-controls.json`, with 50 exact whole-match and stream comparisons. The original read-only profile and bounded helper proposal remain unchanged. The candidate helper is an exact copy of the validated helper. First-match nine-digest CPU time was 97.430437 seconds for the original helper and 10.937359 seconds for the candidate. This is a digest cost comparison, not an overall campaign or performance-gate claim.

## Reproduction

```sh
nice -n 19 taskset -c 1 node /tmp/v16-hash-repo-candidate/test-ai-humanity-storage.js
nice -n 19 taskset -c 1 node /tmp/v16-hash-repo-candidate/historical-controls.mjs
```

Both completed successfully. All changes and proof outputs are under `/tmp`. No prospective campaign is launched by these commands. Before a new campaign, preregister the exact helper, collector and external verifier file hashes, preserve all original assertions and full raw retention, and retain current V16 results independently.
