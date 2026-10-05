# Performance wrapper correction

Only `test-performance.mjs` changed. Its SHA256 is `4ec5847cf75abc2ef51f40ebe11ac5e0b01e34ff035c590cc8a48e3e9bb02c63`.

The original full R9 run naturally exited 1 when the wrapper killed `test-corpse-performance.mjs` after its 60000 ms wall-clock limit. The original wrapper and corpse fixture came from commit 725755b; that wrapper used 60000 ms, not 30000 ms. The retained full-run verification records 684 unchanged source files, 100 valid during-run checks and an unchanged archive/HEAD. The log proves the preceding printed checks passed; it does not independently certify every unprinted registration.

The unchanged native corpse fixture passed alone on CPU 4 at nice 19 in 20.62 seconds, with 15.02 seconds user CPU, 0.90 seconds system CPU and 1172700 KiB peak RSS. It contains geometry, draw-budget, pool-capacity, visibility, lifecycle and resource assertions. It has no elapsed-time assertion or server loop. No exact failure-time CPU/memory attribution is claimed.

The correction shares the caller's existing 240000 ms performance-block budget. Each native subprocess can use at most 180000 ms or the remaining block budget, whichever is smaller. The wrapper fails before launching another process if that total budget has expired. Native child failures still propagate through execFileSync. The four child files, test.js and CI workflow remain byte-identical to the failed frozen R9 source. Every existing standard registered child retains 180000 ms, the performance caller retains 240000 ms, and CI retains its 60-minute job limit.

The corrected complete wrapper passed naturally on CPU 4 at nice 19 in 19.95 seconds (16.05 seconds user CPU, 2.33 seconds system CPU, 1174368 KiB peak RSS). It printed the original ground, corpse, client and path successes. Corpse metrics exactly match both other unchanged native runs. Syntax and scoped diff checks passed. No AI timing bands, benchmark criteria, native performance assertions, runtime source, CI configuration or test.js changed. A new full node test.js run remains the root agent's required gate.

An additional controlled-load diagnostic had already started before the root asked to skip that experiment. Its owned load generator was stopped after about 43 seconds. The unchanged native corpse process finished successfully in 57.40 seconds. The diagnostic controller exited 13 because its top-level await waited for the already-delivered load exit event. Those raw files are retained as a partially interrupted diagnostic, not as proof of the planned 75-second load or of the original failure's cause.

Native verification command: `taskset -c 4 nice -n 19 /usr/bin/time -v node test-performance.mjs`. No outer timeout or retry was used.
