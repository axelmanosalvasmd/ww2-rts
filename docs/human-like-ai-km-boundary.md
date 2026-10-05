# Prospective exact-half median correction

Adopted on 2026-10-04 as `km-exact-half-v1`, under Julio's authorization to correct the scorer prospectively while keeping the original timing limits.

The ordinary-play lab exposed a numerical error: after exactly half the responses had arrived, floating-point survival was 0.5000000000000001. The old reducer reported the Easy first-input median as 4.15 seconds instead of 1.65 seconds. Its accepted-command median was 1.85 seconds, although every native command followed its input.

Both screen and public-alert reducers now use an exact rational check when the floating result lies near one half. They retain the original floating curves. The exact prefix is cached and extended only when needed. The helper's bytes are included in each worker's source checkpoint.

The change preserves event eligibility, response policy, observations, censoring, curve values, physical inputs, native commands and every timing band. Historical reports and completed campaigns remain unchanged. New campaigns declare the helper version and source hash before running.

Root's `node test-ai-km-boundary.mjs` passes 110 controls: exact and neighboring half crossings, tied completions and censors, permutations, cached prefix extension, actual native input and command ordering, retained curves and helper source binding. The unchanged humanity and multi-event tests also pass. The compact fixture contains 27 native endpoint rows and hashes for all 36 original episodes. Original proof, baseline reducers and candidate sources are retained in `docs/evidence/human-like-ai-km-boundary/`; Root independently verifies all 19 archive members.

The correction establishes numerical accuracy. The new population campaign still has to meet the original acceptance bands.
