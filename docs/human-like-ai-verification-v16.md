# V16 verification

This is prospective verification of the R6 gameplay corrections and the adopted public manual-response scorer. Historical V14 and V15 failures remain in their reports. The original timing, APM, opening, balance and performance limits stay unchanged. The behavior and balance campaigns are running against the unchanged read-only 1,635-file archive at runtime checkpoint `3bac0c0923bcfe622dac10a8b76783d090eaf249a4c54e3e9a89a305c9e51ae9`. Their final results remain open. A subsequent local-guard gameplay correction is under verification in the working tree. The original V16 archive stays unchanged and its running results must be reported against that earlier source.

The latest manual policy fixture passes 162 assertions. A native paid camera move exposes a squad at tick 15 using snapshot 14; displayed damage at 16 now uses that real visible baseline. The old unknown classification and corrected required classification retain identical native events and inputs. Never-visible and unchanged-health controls remain negative. The earlier 27 integrated isolation controls are tied to the original adapter checkpoint. V17 subsequently passes all 27 treatments on the corrected adapter before its separate traffic-privacy failure. Evidence is in `docs/evidence/human-like-ai-manual-response-v2/camera-baseline/`.

## Quiet performance failure, before the fresh-root copy change

All four original fixed rows completed once: 1,000 ticks each, with the original ten warmup ticks excluded and 990 latency samples. Root and archive sources matched before and after. The rows retain the whole AI phase, including observation and hands. Startup remains separately reported, with no new exclusion.

| Measure | Before | After | Allowed increase | Result |
| --- | ---: | ---: | ---: | --- |
| Exact AI p95 | 8.866 ms | 12.193 ms | 2 ms | Fail |
| Exact AI maximum | 48.659 ms | 47.052 ms | 4.8659 ms | Pass |
| Counted AI p95 | 9.751 ms | 11.590 ms | 2 ms | Pass |
| Counted AI maximum | 51.627 ms | 58.731 ms | 5.1627 ms | Fail |
| Counted sampled ticks above 40 ms | 2 | 4 | 0 | Fail |

Evidence: `docs/evidence/human-like-ai-v16-performance/`, including preregistration, all four raw rows, the completed protocol, root launch record and a byte-verified source archive. The performance gate remains open. This run predates the small fresh-root perception copy change and latest grader baseline capture correction. Those changes do not convert this result into a pass.

## Bounded copy reduction

The adopted 13-line helper skips redundant top-level descriptor checks only for an immediately constructed, unexposed screen-unit record. Nested copy validation and native whole-root fallback remain unchanged. Root's perception and privacy tests pass. Six seeded native comparisons preserve all inputs, commands and complete game/commander graphs, including aliases and cycles. Nine graph/accessor/Proxy controls preserve source traces and rejection behavior.

The fixed isolated micro saves 25.0% for the first screen copy and 14.3% for the screen-plus-memory pair. This local saving is too small to establish the full latency gate. The larger dual-copy proposal was rejected because it adds temporary allocations and complexity. Its intermediate failures and final controls remain recorded. Evidence: `docs/evidence/human-like-ai-v16-fresh-copy/`.

## Remaining gates

The first frozen 76-child `node test.js` run exited 1 after 288 seconds. A direct `plan()` Engineer fixture in `test-engine-ai-bridge-repair.js` omitted the empty `seen` and `node` maps that normal `think()` initializes. The newly attended Engineer economy branch reached that missing memory. Root added those two maps to the fixture only. Its forty native repair matches, sixty-second limit, negative controls and effect assertions remain unchanged. The failure and all 54 valid source checks are retained in `docs/evidence/human-like-ai-v16-full-failure/`. Every captured source and archive file remained unchanged during that run. The running behavior and balance archive is untouched.

The corrected native bridge test passes all forty repairs within the unchanged sixty-second limit, with a worst case of 52 seconds. Its original negative controls and repair effects pass. `root-native-fix-manifest.json` binds the corrected fixture and exact native output. Runtime source is unchanged.

The fresh V17 full run passed every AI child, including the 162 policy assertions and all 27 manual isolation treatments. It then exited 1 after 617 seconds in traffic privacy. The helper allowed one stale WebSocket frame, so one trajectory began at tick 10 and the other at 12 while later transforms matched. Root changed the wait to the current emitted snapshot beat. The focused native test passes exact tick/position/rotation equality, hidden terrain and hidden wreck controls, and actual live-truth/live-cover negative controls. No equality tolerance or assertion changed. Evidence: `docs/evidence/human-like-ai-v17-full-failure/`, with all 110 valid source checks, unchanged 1,649-file archive and exact failure output.

A fresh full regression run after the snapshot-wait correction, full 120-match behavior campaign, final-source 150-match balance campaign, final browser proof, independent review, documentation closure and PR delivery remain open. No numeric gate or checklist box is closed by the component results above.

## Subsequent idle-guard correction under verification

The native Conquest Easy seed 1 trace identifies an objective reservation suppressing MG3's response to an attended visible contact at tick 818. The first narrow correction preserves the native prefix and completes a real key at tick 838 and accepted attack-move at 852, with all original timing and input costs intact. Root's new guard fixture and causal-order tests pass. The unchanged tactical-reaction test then catches a neighboring regression: a stationary rifle guard moves before using its useful grenade. That failure is retained in `docs/evidence/human-like-ai-attended-guard/initial-proposal/`. A narrower correction must retain the existing grenade guard assertion and the actual MG response before acceptance. These episode results do not establish a campaign median or a full-suite pass.

The corrected guard retains a meaningful affordable ready or inspectable grenade before movement. Root independently compares all thirty submitted commands and twenty-six physical inputs through tick 890 with the initial guard replay, preserving MG key 838 and click 852. All five focused current-source tests pass, including the unchanged tactical grenade assertion. Correction evidence is in `docs/evidence/human-like-ai-attended-guard/corrected-ability-choice/`. Final population and full-suite gates remain open.

The working source also fixes repeated hesitation within one attended visit. Root's native hesitation, commitment, coherence and response tests pass; the original rates, full pause durations and motor parameters remain unchanged. These later gameplay changes do not mutate the V16 archive or turn its results into final-source evidence.

## Original population wiring

The independent direct Conquest reduction retains all sixty historical V16 matches and 180 seats while full mode packaging continues. Public manual screen medians are unidentified for Easy (121 answered, 127 censored), 2.7 seconds for Normal (202 answered, 137 censored), and 2.4 seconds for Hard (188 answered, 117 censored). Physical input APM is 27.333, 42.167 and 57.834 respectively; Hard fails the original 80 to 120 band. Opening limits, peak caps, one command per tick, quarter-second locality and Conquest opening variety pass. These results precede the current guard, hesitation and wound-response corrections. The reducer verifies every raw/gzip digest twice and all frozen source entries before and after. Its exact code, declaration and unchanged result are retained in `docs/evidence/human-like-ai-v16-conquest-direct/`. Off-screen acceptance remains unevaluable rather than inferred from answered-only medians.

The running V16 archive records genuine original `newEvents` but copies an empty unrelated array into cumulative `events`. Its reported zero original populations are incomplete instrumentation, not evidence that those matches had no stimuli. They remain unchanged. The prospective collector takes a detached copy of the private detector's actual cumulative history. Native damage frames retain populations 0/1/1/2/2 and score exactly two required unanswered events. Current root passes the full measurement-stream fixture and 36 native mode/difficulty/treatment comparisons with the later guard and hesitation fixes combined. Oracle bytes, scoring, creation clocks, inputs, resources and RNG remain unchanged. Evidence: `docs/evidence/human-like-ai-original-cumulative/`.

## Navigation work

Current source removes the redundant region scan only after connected coarse routes on internally maintained complete typed navigation views. Public stale-version and sparse-height controls retain the old rejection, and each catches an unrestricted bypass mutant. Root's route and terrain-delivery tests pass. Six native input/command/full-graph comparisons match on the recorded proposal source. The isolated cost is about 2.1 ms on captured cold graphs; final-source performance remains unverified.

Complete proposal, captured terrain, native equivalence, reconstructed connectivity enumeration and original cost trials are retained in `docs/evidence/human-like-ai-native-navigation/`.

## Prospective verifier throughput

The explicitly selected bounded hash helper matches all fifty current Conquest and forty-two historical Classic/World digests. The original nine-digest workload drops from 97.43 to 10.94 CPU seconds. Current root passes the full storage fixture, preserving three native matches, nine seats, complete graphs, reducers, exact gzip, merge, backpressure and failure cleanup. Default hashing remains original; only an explicit future verifier dependency selects the helper. The running V16 campaign and raw serialization remain unchanged. Evidence: `docs/evidence/human-like-ai-bounded-hash/`. This isolated speedup neither changes any acceptance limit nor guarantees a full-campaign ETA.

## Attended wound response

The current planner adds a narrowly qualified ordinary retreat for an unfinished infantry march after its attended heavy suppressed-hit cue, without guessing an unseen shooter. It preserves active combat, busy work, fortified holds, automatic protection and existing homeward movement. A native MP0 negative caught an unnecessary retreat while already at home; the final option explicitly excludes that actor. Current normal posture during visible recovery remains eligible within the original cue window, while zero suppression does not. Classic and World retain existing policies pending destination proof. Current combined source passes the new fixture, tactical reaction, attended danger and commitment. Recorded seed1 timing predates the latest hesitation and navigation changes and does not certify their campaign median. Full retained evidence: `docs/evidence/human-like-ai-unseen-hit/`.

## Later full-suite failure

The V18 full suite exits 1 after 207 seconds in crowded crossing, with all 1,848 source/archive files and 36 checks unchanged. Root retains the full failure in `docs/evidence/human-like-ai-v18-full-failure/`. Controlled late delivery of the right WebSocket move produces its exact tank row on both original and optimized navigation: right receipt tick810 follows the entire 800-step loop. An ordered application ping/pong barrier delivers both orders at tick10 before the same loop; all original assertions pass. The original full run lacks receipt timing, so its cause is not directly observed. Five fixture lines remove that demonstrated race, and root's complete nine-group acceptance module passes. No gameplay or timing limit changes. `docs/evidence/human-like-ai-crossing-delivery/` retains all controlled graph and receipt evidence. A fresh complete regression run remains required.

## Interim independent review and focused lab

Round 7 identifies two prospective measurement gaps: accepted useful damaging support and target abilities have no credited response endpoint, and a new contact can appear during an already physically started response to a nearby earlier contact. The review also identifies genuine unattended or late reactions and does not approve release. Its complete report is retained in `docs/evidence/human-like-ai-review-round7/`. Existing V16 results are unchanged. Any corrected predicates require public creation and native input proof, with the original timing bands and end censoring preserved.

Julio requested a focused AI lab to reproduce individual failures efficiently. Its short authored native scenes are diagnostic tools. They do not replace the original seeded acceptance populations, balance runs or performance gates.

The lab is now adopted as the primary development loop. Its real commander, delivered view, timed hands and native commands run incrementally in the CLI and browser. Root verifies deterministic traces, hidden and on-screen counterfactuals, physical starts and receipts, automatic retreat, edit reset and restricted static routes. The live browser advances sixty simulated seconds in 133 ms. A later fresh browser scene produces nineteen inputs and five native receipts after sixty seconds; an authored edit resets it to tick zero. Its transferred short recording mostly shows the advanced scene; the reset is separately verified by the actual browser result. Inspected screenshots, recording and native proof remain in `docs/evidence/human-like-ai-lab/`.

The lab reproduces three narrow gameplay defects. AP was restricted to the light tank type, despite native vehicle targeting. A queued stance could reselect squads already showing that same stance. Production could move the camera to an empty home before its first unaffordable receipt. Current root passes the permanent AP, stance and public-budget fixtures. Their evidence is in `docs/evidence/human-like-ai-ap-vehicles/`, `docs/evidence/human-like-ai-stale-stance/` and `docs/evidence/human-like-ai-production-attention/`. These corrections retain physical timing, skill parameters and resource costs.

Prospective screen-manual-v3 and public-danger-alert-v1 are adopted for later measurement, with original bands and historical results preserved. Root passes their native fixtures and an integrated real collector smoke. The alert smoke is eventless, so its median stays unknown. Declarations and full controls are retained beside their modules; no final population pass is claimed.

V16 balance completed naturally at 20:58:27 UTC. Root independently reduces all 150 original rows and verifies every recorded artifact hash. All matches ended, with four Classic draws and no timeouts. Conquest wins are 23/22/15, Classic wins 7/11/8, and Hard wins against old Easy/Normal/Hard are 15/20, 17/20 and 13/20. Germany's Classic decisive share is 42.3077%, exceeding the original 42% ceiling. The historical gate fails. The complete original reports, logs, checkpoints and supervision remain byte-verified in `docs/evidence/human-like-ai-v16-balance/`. Later fixes still require final-source balance proof.

The rapid lab sweep records 93 authored native episodes and twelve whole-trace observer-isolation comparisons. It identifies bare-ground cover refusals and a stationary rifle that notices a real tank hit but chooses no protection. The current correction passes a native weapon witness plus 90 neighboring public-scene controls. Hard selects in 0.40 seconds and accepts retreat in 0.50 seconds in that witness. Separate full paired traces retain the original contact, later missed damage and Easy's reaction-band failure. The lab enables short direct iteration; its numbers do not replace campaign medians. Source-bound traces and readouts are in `docs/evidence/human-like-ai-rapid-lab/` and `docs/evidence/human-like-ai-stationary-armor/`.

V19's full native suite exits 1 after 626.5 seconds at `test-ai-lab.js:15`. All 1,964 file hashes, source HEAD and 107 continuous checks remain unchanged. The lab assertion expects a refusal from the original bare-ground guard, while the reviewed cover correction now prevents that pointless attempt. The refusal-recording assertion remains required and needs a separate genuine rejected physical-input scene. `docs/evidence/human-like-ai-v19-full-failure/` preserves the complete failure and source evidence. No overall pass is claimed.
