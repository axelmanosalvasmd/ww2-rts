# Current-source sparse fog evidence

This bundle contains the exact three-source patch, clean integration files, portable 25-check test, current-source native equality proof, every timing row, count-only diagnostics, original regression logs and source bindings. ROOT adopted these three source files separately; this bundle did not edit ROOT.

The fixed current-source diagnostic is 8.707251 ms baseline versus 6.482153 ms candidate p95, a 2.225098 ms saving. The measured interval includes snapshotCache, observe and think. Hashing is outside it. It is not an acceptance benchmark. Native digests include all human snapshots and canonical fog. Count-only copies confirm AI-phase fogLos calls fall from 2566003 to 19569.

The clean directory excludes aiScratchRng. Reproduction source trees include that identical scratch-only RNG reader in baseline and candidate. The count source trees additionally contain counters; their timings are not used. There are no node_modules, credentials or symlinks in this archive.

From the extracted bundle directory:

```sh
node sources/candidate/test-engine-ai-point-fog.js
node scripts/ai-v19-fog-demand-human-proof.mjs "$PWD/sources/baseline"
node scripts/ai-v19-fog-demand-human-proof.mjs "$PWD/sources/candidate"
node scripts/ai-v19-structural-combined-timing.mjs "$PWD/sources/baseline"
node scripts/ai-v19-structural-combined-timing.mjs "$PWD/sources/candidate"
node scripts/ai-v19-point-fog-count.mjs "$PWD/sources/count-baseline"
node scripts/ai-v19-point-fog-count.mjs "$PWD/sources/count-candidate"
```

The native script writes proof JSON to stdout. The timing/count scripts write raw diagnostic rows or counters to stderr and proof JSON to stdout. Existing evidence is retained rather than replaced by reproductions. File sizes and SHA256 hashes are in byte-manifest.json; the archive hash is provided alongside the archive.

Earlier 84e5 AI-source trials are historical and cannot support current-source performance claims. They remain separately archived at /tmp/ai-v19-point-fog-historical-84e5.tar.gz. The file index in historical/ identifies those originals. The initial current-source controls had two fixture setup errors: null weather data and an incorrectly chosen negative cell. The final durable test corrects both without weakening the visibility assertions.
