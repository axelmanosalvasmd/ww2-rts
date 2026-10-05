# R9 full-suite failure and wrapper correction

The literal R9 `node test.js` run naturally exited 1. The final performance wrapper killed `test-corpse-performance.mjs` at its 60000 ms subprocess timeout. Its original log and final verification are retained without alteration in `r9-original-full-failure.tar.gz`. The original verification records 684 unchanged source files, 100 valid during-run checks, unchanged runtime/archive/HEAD and the actual failed exit. Printed preceding successes do not stand in for a full-suite pass.

Only `test-performance.mjs` changed afterward. It now shares the caller's existing 240000 ms block budget and caps each of its four native subprocesses at the smaller of 180000 ms or the remaining budget. Every native test body, assertion, standard child deadline, test.js caller deadline and CI job limit remains unchanged. The unchanged corpse fixture passed alone in 20.62 seconds; the corrected complete four-module wrapper passed in 19.95 seconds on CPU 4 at nice 19. The original failure-time scheduling cause remains unproven. This is a test orchestration correction, not a performance target change or an AI acceptance waiver.

The wrapper proof archive retains exact native logs, timing output, byte comparisons against the failed frozen source, identical corpse geometry results, the minimal patch and a qualified partially interrupted diagnostic. See `wrapper-review.md` for that diagnostic's native success and controller exit 13. It is not used to certify the original failure's cause.

The newly authorized R10 full suite runs separately and must finish naturally before a full-suite pass or commit is claimed. Remaining numerical balance, reaction and performance targets belong to the user-authorized follow-up work; these artifacts neither change nor certify them.

`original-source-bindings.json` maps every original R9 artifact to its original path, byte length and SHA256. `manifest.json` and `SHA256SUMS` bind this evidence directory. No media or gameplay source is included.
