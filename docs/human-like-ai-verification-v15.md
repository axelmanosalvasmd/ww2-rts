# Human commander V15 verification

V15 is a preserved failed acceptance checkpoint. Its 120 gameplay matches and browser capture are complete, but the full suite and performance checks failed. The working tree includes later camera and fog-loop corrections. Historical V15 results do not certify those changes. No acceptance band or original population was relaxed.

## Frozen source and full regression

The predeclared archive contains 763 files, 75,419,365 bytes, from HEAD `8a2343bf535170dfc14822c82ca15cfeedfb7bef`. The before-manifest SHA256 is `f2a118140ee11e43e7cec9d91ee0e8e69bab35a436abb4a6046f661f95e7519a`; its file-map digest is `e2c442455fce4b87ca304f88402213430a79753c47ad1ae507cc1502b1dd715d`. All source hashes, archive bytes and HEAD stayed unchanged throughout the full run.

`taskset -c 4 node test.js` ran from 14:51:15 to 14:54:30 UTC on 2026-10-04 and exited 1. The preserved log SHA256 is `7c08d99e29f59d741be1ff82cf62ae11156032d6cdbb3fb39d080dab1e5b6a11`. World, navigation, engine contracts, caller integration, hands, perception and the human commander fixtures passed before `test-engine-ai-response.js:215` failed. The fixture assumed a control group existed after its first movement, contrary to the reviewed second-use binding contract.

The corrected fixture now makes two accepted pair movements, observes the real paid binding, removes one member, changes the selection, then requires a paid recall and accepted survivor movement. It injects no group state. This preserves the original requirement and also compares the native pair membership and binding key.

That migration exposed a real camera error later in the same response suite: historical `eventOnScreen` metadata prevented a return after an uninterrupted held pan moved the victim off screen. Both routing guards now check current camera visibility. The creation descriptor and event clock remain immutable. Root's complete response suite passes: cue tick 78, held pan finishing 96, paid return 120, native retreat 137, or 139 after the separate expired-concern control. Ordinary diagonal travel remains pans 96/121, fresh planning 128 and command 136. These focused results require a fresh full-suite run.

Full failure artifacts are in [the full-run evidence](evidence/human-like-ai-v15-full/copy-manifest.json). The original failure, fixture migration, two single-guard negative variants and root's combined passing log are in [the camera evidence](evidence/human-like-ai-current-camera/copy-manifest.json).

## Gameplay measurements

The unchanged runtime checkpoint is `e2d17224047076252b115e6e66e8dc2504aa003b2fc66d9169e9d32ec27c38c1`. All original 20 Conquest and 10 Classic/World seeds ran at each difficulty, totaling 120 matches and 360 seats, each for 180 seconds. There were no early endings. Independent recomputation matches every recorded seat metric and pooled result; both detector policies, scoring methods and censored endpoints remain in the complete raw archive.

| Mode | Physical minute APM, Easy/Normal/Hard | First-order medians, Easy/Normal/Hard | Peak physical APM, Easy/Normal/Hard |
| --- | --- | --- | --- |
| Conquest | 27.333 / 40.5 / 55.167 | 6.1 / 4.575 / 3.05 s | 60 / 120 / 168 |
| Classic | 27 / 38.334 / 52.167 | 6.05 / 4.525 / 3.025 s | 60 / 120 / 192 |
| World Conquest | 31.333 / 39.833 / 52.5 | 6.15 / 4.625 / 3.025 s | 60 / 120 / 198 |

Average APM fails Hard in all modes and Normal in Classic/World. Every individual first-order delay passes its original band; peak caps, the causal floor, one command per tick and quarter-second cross-screen locality pass all nine groups. Every Conquest faction/difficulty opening group passes the original accepted purchase-family sequence gate over 20 seeds. Classic and World each have ten seeds per faction, so they do not establish that opening gate.

The original oracle actually started at tick 2, when actors were first delivered. All 360 `originalFromMatchStart` flags remain false. Required original reaction gates are therefore not evaluable. No seat is removed and no tick-zero event is inferred retrospectively. The observed required-screen first-input Kaplan-Meier medians are diagnostic only: Conquest 4.8/1.55/8.25 s, Classic unidentifiable/11.5/2.7 s, World unidentifiable/0.8/11.25 s. Unanswered events remain censored; these medians cannot replace the original acceptance population.

The complete raw gzip is 18,921,350 bytes, SHA256 `127c1a33209ee1ed40cca0cd026041ad74bccf9d5ec927ce96aa5ad32a03b830`. [The evidence manifest](evidence/human-like-ai-v15/copy-manifest.json) retains its protocol, every match identity, complete independent verification, all seat rows and the complete gate analysis. [The root summary](evidence/human-like-ai-v15/root-summary.json) is a convenience view of those retained values.

## Performance

The prospectively fixed four rows use the same six-seat, six-front, 1,000-tick workload. Startup cost is recorded separately. Each row retains all 990 original warm samples, with only the original ten startup ticks excluded. No measured row was repeated or removed.

| Check | Before | After | Result |
| --- | ---: | ---: | --- |
| Exact AI p95 | 9.501 ms | 10.876 ms | Pass |
| Exact AI maximum | 61.818 ms | 40.720 ms | Pass |
| Counts AI p95 | 9.142 ms | 11.749 ms | Fail, exceeds the 2 ms allowance |
| Counts AI maximum | 63.371 ms | 45.607 ms | Pass |
| Raw timed ticks over 40 ms | 4 | 5 | Fail |

Current startup AI cost is 0.464179 ms in the exact row and 1.567438 ms in the counts row. Legacy zero records an unexecuted human-start branch, not free legacy initialization. Full rows, raw checks, source manifests and logs remain in [the performance evidence](evidence/human-like-ai-v15-performance/copy-manifest.json).

The later fog-loop change preserves ascending cell order while avoiding division and remainder per cell. Comparisons match 554 cache cases, 261 captured source masks and ordered lists, and every enumerable game graph across 1,000 ticks, including all 303 inputs and 130 commands. Twelve retained paired isolated trials save about 0.029 ms per rebuild. Root's privacy, effect-visibility and terrain-delivery tests pass. This modest saving does not establish performance gate closure. [The retained comparison](evidence/human-like-ai-terrain-loop/copy-manifest.json) includes earlier failed harness attempts and all trials.

## CI and visible proof

CI gives the full suite a 55-minute step within a 60-minute job, preserves assertion exit codes through explicit Bash pipefail semantics, and retains logs, runtime versions and tracked-source before/after hashes. The original focused-child 180,000 ms limit and gameplay assertions stay intact. Default actionlint with installed ShellCheck passes. Local wrapper controls preserve a failing assertion and reject changed source. Remote CI for this candidate has not run.

The real Conquest spectator flow used three Normal AI seats through ordinary Join, Watch, Start and confirmed Restart. The 108 server/shared/client JavaScript hashes were unchanged. Native T3 preview captures the quiet opening followed by squad movements and capture progress. The later Linux fallback shows a contested point, smoke, fire and airborne activity with camera and pointer markers on the minimap. Root inspected the opening and battle contact sheets and full-size battle frames.

The preferred [opening film](evidence/human-like-ai-v15-browser/opening-35s.mp4), [battle film](evidence/human-like-ai-v15-browser/linux-battle-40s.mp4), [opening image](evidence/human-like-ai-v15-browser/opening-frame-6s.png) and [battle image](evidence/human-like-ai-v15-browser/linux-battle-frame-20s.png) are durable copies. The native host later explicitly became unavailable; that error is retained. The fallback software renderer was slow, so its wall-clock clip does not prove AI response time or performance. Captured application error listeners were empty; initial WebGL readback warnings and automation failures remain documented. Spectator readbacks expose no resource or command queues, so these pictures cannot establish exact money float.

This browser evidence predates the two later corrections. It supports the visible overlay and actual startup flow, but final-source browser and release gates remain open. [The browser record](evidence/human-like-ai-v15-browser/README.md) contains the complete provenance and limits. Final-source balance and independent review remain open.

## Historical balance completion

All 150 V15 matches finished without timeout. Conquest wins are USA 18, Germany 25, USSR 17 (30.0/41.7/28.3%); Classic wins are 7/10/9 with four draws (26.9/38.5/34.6% among decisive games). Both satisfy the original 25-42% faction range. New Hard wins 16/20 against old Easy, passing its 70% floor, 17/20 against old Normal and 10/20 against old Hard. The latter two comparisons have no declared win floor.

Conquest median duration is 636.65 seconds versus 596.175 before; Classic remains 1600 seconds. Root independently reduced all original rows and verified all 76 compact-bundle members byte for byte against the original artifacts. [The evidence](evidence/human-like-ai-v15-balance/root-copy-manifest.json) retains all after/before rows, runner logs, source hashes, protocol and exact source-difference qualifications. The original Conquest baseline has no runtime source fingerprint. Navigation and initial terrain delivery differ from the corrected Classic baseline; the audit does not independently establish their equivalence or attribute changes solely to AI. V15 gameplay balance passes, while its performance failure and later R6 qualification remain open.
