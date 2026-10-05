# Stationary infantry after a watched armor hit

The proposed gameplay fallback resolves one source-backed missing response. It does not change reaction scoring, physical inputs, health thresholds, difficulty statistics or economy rules. It is a narrow Conquest action chosen from the existing public attended observation.

In the native medium-fire control, the opponent is released at tick 240. Actual projectile damage at 244 removes 35% of victim 8's health, leaving 65%. The medium is 14m away with range 38m. A destination beyond weapon range plus the existing 4m safety margin needs at least 28m of travel. The existing local destination search permits 24m, so it cannot supply an escaped destination on bare ground. Ordinary Hard retreat below 50% does not apply. With the cover-only source the commander notices the damage, pays deliberation, produces no intent and waits. Automatic retreat after a later shot does not answer this earlier required creation.

The fallback requires all of these current public facts: a recent attended screen-damage event for this squad with at least 25% visible health loss; current watched armed armor in weapon range, outside any minimum range, with actual public LOS; idle controllable ground infantry with no movement, queued work, ongoing engagement, attack, digging, building, grenade or area fire; no explicit protected hold, trench or garrison; no anti-armor counter role or already covered automatic retreat; no actually useful local grenade already available or being thrown; no safer watched ground destination in the existing 24m local search; an own Conquest home outside every visible or remembered enemy weapon envelope. It reuses the safety search's existing 4m margin. No extra health threshold is introduced.

Classic, World, at-home squads, moving or working crews, protected tactics and ordinary retreat behavior stay outside this fallback. The planner cannot inspect authoritative HP, enemy state, grading labels or future outcomes. The response uses the existing ordinary retreat order and pays its normal selection, delay and R-key motor work.

The final current-source patch applies to AI a903af250df0ea8d738a63ee75c43eb66b40c9b14e63333598ab0b76c68fc5b3, including the reviewed cover guard. Candidate AI is 84e5d86a69c1a3832c393e18346f4243e2c4697b1ad0a8a88eeb8c82130c7046. Only shared/ai.js and a new portable test are included. Runtime files were copied to /tmp and never edited in the worktree.

The portable fixture passes 90 neighboring public-observation controls across Easy, Normal and Hard, anchored in a real engine-created medium hit. Controls include light damage, infantry threat, current combat, protected hold/trench/garrison, movement, attacks, busy construction, queued orders, area fire, current grenade, automatic protection, home, current and remembered unsafe home, stale or wrong cue, missing or offscreen actor, Classic, World, anti-armor role and a genuinely escapable local destination. Forged grading labels do not affect the positive action.

A separate full-native paired replay uses the same current cover-only source against the combined candidate for every difficulty. Complete events, inputs, input starts and command prefixes before tick 244 match exactly. Full raw native and detached policy streams are retained. The combined first completed physical input and accepted retreat are Easy 275/279, Normal 256/259 and Hard 252/255. These correspond to 1.55/1.75s, 0.60/0.75s and 0.40/0.55s. Every selection and key motor duration is paid. Easy's first endpoint is above its original timing band in this episode. These are diagnostic numbers, not campaign acceptance.

The current portable fixture's native witness uses a separately scoped seeded real-engine driver. It selects the victim at 252 and accepts R at 254. Its full prefixes match its own control. The one-tick difference from the captured paired driver is retained rather than selecting a favorable result. Both show useful physical protection and unchanged source limits.

Remaining required failures persist in the full raw data. The original armor contact at tick1 remains unanswered. Hard's later damage to the other rifle at 316 remains censored. Easy's later event at 598 has only two ticks of follow-up and stays censored. No population is removed or relabeled to conceal those results.

An initial portable treasury setup used player.id instead of the engine's player.slot. That ran with 0 MP in both treatments. The fixture was corrected to use the array index and intended 20 MP, then passed again. Both development logs and the previous patch are retained. The separate complete paired replay always used explicit 20 MP and was unaffected.

Files: integration.patch is the final reviewable patch; adoption-manifest.json binds exact base/candidate/test/patch hashes; current-combined holds the candidate; current-control is the exact cover-only source; current-combined-portable-treasury-corrected.log contains portable PASS; combined-pair-results.json and combined-pair.log contain all paired endpoints; easy/normal/hard-cover-only.json and easy/normal/hard-combined.json retain full timelines. Original no-cover-fix evidence remains in runtime/native-positive.json and portable.log. The 93-episode matrix source and failures remain separately under /tmp/ai-lab-response-current.

Direct check:

```sh
nice -n 19 taskset -c 1 node /tmp/ai-lab-stationary-armor-fallback/current-combined/test-engine-ai-stationary-armor-hit.js
```
