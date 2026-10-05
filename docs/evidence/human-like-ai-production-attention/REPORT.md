# Hard authored-scene throughput

Four authored scenes ran for 60 simulation seconds each on Hard seed 42. This is direct lab evidence, not a campaign or an APM acceptance score. Recorded source: ai 76f02609, commander 19112a1e, hands 69eb1507, sim 7bc57ac1, attention 2b1f2263. Root's later AP targeting adoption is outside these recorded timings.

| Scene | Initial MP | Inputs | Camera inputs | Accepted buys | Other accepted commands | Refusals | Empty no-work retry seconds |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Idle squads and objectives | 900 | 82 | 17 | 4 | 18 | 0 | 16.5 |
| Two combat fronts | 900 | 77 | 12 | 5 | 16 | 5 | 19.6 |
| Two fronts and late hurt | 900 | 71 | 14 | 5 | 15 | 3 | 19.6 |
| Low-budget objective guard | 20 | 46 | 14 | 1 | 6 | 4 | 30.6 |

The 900 MP cases pay for recruitment while also moving groups, using a useful ability, deploying the purchased aircraft and fortifying objectives. First purchases are at ticks 110 or 209. There are no purchase refusals in these scenes. They do not support changing costs, purchase quotas, physical caps or economy thresholds.

Empty retries are real hands-empty, queue-empty frames with the existing noWorkUntil delay. They are not all missed useful work. Several squads are already holding owned objectives, digging or fighting. Hard's dwell remains about 45 ticks and empty retries retain the existing eight-tick delay. A shorter universal dwell could produce extra camera movements without more work, so this candidate leaves it unchanged.

A separate concrete waste is repeated cover attempts on bare ground: the two-front case refuses at ticks 652, 794, 891, 925 and 978 with noCover. The objective-holder branch in ai.js requests cover when the squad is outside cover without first establishing nearby available cover. This is reported, not included in the proposed attention patch.

## Narrow camera defect and candidate

The initial production visit has no previous failed-purchase receipt, so productionDeferred cannot yet recognize an unaffordable shop. In the low-budget scene, the commander travels from the front to its empty home at ticks 119 and 138, then records an unaffordable rifle at tick 142 with only 55 MP. The public rifle costs 100 MP. There is no home squad to inspect or deploy. This trip also takes the camera off the guard's next hurt cue.

The candidate adds a public Conquest-shop check. If no faction-legal troop can be bought with delivered MP and fuel, and no own minimap squad is within the existing reinforcement radius of home, production attention waits. The same guard uses current public prices and existing legality flags, and adds no numeric economy threshold. Production becomes available as income makes a troop affordable. Home deployment remains available independently. Classic and World are unchanged, and the existing observe fallback remains intact.

The occupied late-hit witness retains an explicit authored 65 HP hit at tick 160. Baseline home pans complete at 111 and 130, making the hurt an offscreen alert. It accepts the real retreat at tick 193. The candidate keeps the camera on the guard, records a screen-damage creation at 160, completes the first linked physical input at 167 and accepts retreat at 169. Total physical inputs fall from 15 to 12, cameras from four to zero, with four accepted useful commands in each trace. The candidate pays the existing full gesture and causal floor. These single-episode timings are not a reaction-population acceptance result.

The 60-second 20 MP case falls from 46 to 43 inputs and 14 to 10 cameras, with seven accepted useful commands in each. Its first genuinely affordable buy improves from tick 419 to 370. In the three other authored scenes, accepted purchase families and ticks stay identical; camera and fortification ordering may change later when resources fall below every troop price. All before and candidate timelines remain present.

## Portable verification

`test-engine-ai-production-attention.js` is ready for repository adoption after root review. It makes a temporary control copy with only the reviewed affordability guard disabled. The real lab engine reproduces the unaffordable-home symptom followed by late hurt. Rich recruitment and an actual home-squad deployment compare complete native input and receipt traces exactly. Real Classic and World delivered-view controls compare attention state and random consumption. Existing skills, full command motor durations and causal input floors are retained.

The portable fixture passes on the recorded candidate source. Root can run it on its current source after applying the narrow attention patch. It does not use a fixed benchmark timing or require the historical lab timings to remain literal constants.

The diagnostic capture adds detached planning and resource copies to frames only. Four complete original-runner versus instrumented-runner controls pass for in-memory events, input starts, inputs, commands, responses and final authored state. The first isolation assertion compared in-memory undefined fields with parsed JSON and failed at that serialization boundary. Its log is retained. The corrected control compares full in-memory graphs directly, then separately verifies stored JSON bytes. No behavior mismatch was found.

## Files and direct commands

`integration.patch` contains only shared/ai-attention.js and the new portable test. `source-manifest.json` binds the recorded shared and client source. Raw native rows are in each scene JSON and each control JSON. `summary.json`, `candidate-summary.json`, `controls-summary.json`, `portable-test.log` and `isolation.log` contain the results. This folder holds all changes; no production files, policies, caps or scoring rules were edited.

```sh
nice -n 19 taskset -c 1 node /tmp/ai-lab-hard-throughput/candidate/test-engine-ai-production-attention.js
node tools/ai-lab.mjs --scenario contact-threat --level hard --seed 42 --seconds 60 --scene /tmp/ai-lab-hard-throughput/scenes/two-front-budget.json --out /tmp/ai-lab-two-front
```

The CLI command intentionally runs the currently selected source. Historical recorded source is available under source; candidate source is under candidate. These scenes are bounded diagnostics and do not replace original campaign populations or gates.
