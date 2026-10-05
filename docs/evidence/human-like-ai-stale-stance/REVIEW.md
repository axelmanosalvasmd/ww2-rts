# Hard native lab diagnosis and queued stance proposal

This is a scratch-only diagnosis against the current runtime. Root source was not changed. The actual lab uses default `think`, native `viewFor` delivery and real timed hands, followed by authoritative `sim.command`. Authored health stimuli are labeled injections, not claimed weapon hits. All runs are short scenes, not acceptance campaigns.

## Native cases

`occupied.mjs` defines three variants of the same four-rifle front, seed 42, Hard, 15 simulated seconds. The rifles have a real cooling grenade, hold fire, and a visible opposing MG. Cues hit actor 8 for 65 HP at tick 44, 70 or 160.

| Cue | Native first linked input | Native retreat | Explanation |
| --- | --- | --- | --- |
| 44 | 59, 0.75s | 61 | The current box approach cancels physically, but the initial first-order deadline remains in force. This is an opening case. |
| 70 | 81, 0.55s | 83 | The started stance key finishes at 72. New selection pays six full motor ticks over approximately 487 CSS pixels, with a sampled reaction tail reaching 81. |
| 160 | 191, 1.55s after an alert | 193 | The camera left for the first unaffordable production visit, requiring real return travel. It is an offscreen alert case rather than a screen-response latency. |

The tick-70 response was independently recorded with the actual `screen-manual-v3` capture and reducer. It is required and answered at 81/83. Capture audit reports zero future/stale descriptors, unrelated commands, missing operation proofs, invalid native receipts or below-floor responses. Root's motor coefficients, reaction law, opening deadline, caps and one-command gate were preserved.

I do not recommend compressing the motor based on these cases. The 0.55s result is a real tail and occupied-input case; the earlier opening example is constrained deliberately. Three scenes do not establish a distribution median or excuse any existing campaign gate.

The first unaffordable production trip is a separate actionable attention problem. `baseline_tools` owns its narrow Conquest shop-affordability proposal. I initially described the fallback incorrectly after reading only its final line. Current fallback already chooses `observe` when deferred; the actual waste is the first unvisited production concern. No fallback change is included here.

## Actual obsolete stance work

The paid stance at tick 72 enables auto-retreat for actors `[8,9,7,10]`. Emergency planning at 73 sees the delivered tick-72 view taken before that command and queues the same setting with a reordered actor list. From tick 74 onward the delivered screen states already show the requested flag on every actor. The second job still spends selections at 90, 94, 96 and 100 and finally loses the retreating actor from its selection.

The candidate drops only this unstarted obsolete stance job before its first physical gesture. It requires a newer delivered tick than enqueue, current screen membership, a fresh screen stamp, a live own actor, no inventory placeholder and an explicit matching boolean on every intended actor. It checks only `holdFire`, `holdPos` and `autoRetreat`. It never guesses from missing fields or stance bits, and it leaves pending target-cancellation gestures and all already-started jobs unchanged.

Native result: 18 to 14 physical inputs over the same 15-second trace, with four useful accepted commands in both. The damage response remains tick 81 and accepted retreat remains 83. The actual v3 required population remains two events and both remain answered, with identical timing and clean audits. This removes wasted work and lowers input activity; it is not an APM-band fix. No full-minute APM or campaign improvement is claimed.

Artifacts:

- `stance.patch`: hands-only runtime change plus proposed permanent focused test.
- `stance-v3-base.json` and `stance-v3-candidate.json`: full native reports, actual capture proofs and actual v3 results.
- `stance-summary.json`: compact comparison without dropping the original raw artifacts.
- `test-engine-ai-stale-stance.js`: true/false settings for all three modes, required and mixed settings, unknown fields, dead actors, inventory placeholders, stale screen reading and preservation of a started gesture.
- `hands-suite.log`: complete current focused hands suite passed against the scratch candidate.

The narrow skip does not alter how an existing mixed setting is toggled or how queued selections narrow after a miss. The negative controls preserve existing work and requested command modes. Separate stale-toggle parity changes are outside this patch.

Source hashes:

- Base hands: `69eb15070dbf3e3839f4a264bc24d5010033f6d745bc1cf53ba285fc362323d6`.
- Candidate hands: `8bd373c3afb8261bf8ca2a53f24512522b91f0ddc6568eaa61dbf7039684b9a3`.
- Patch: `7da25abc64218518056cb135c3baa0cc68078cf87389e37e138b762bc59fbf2f`.

Checks passed: the new focused controls, the actual baseline/candidate v3 capture and the complete current hands suite. The three scene diagnostic took 519ms; actual baseline/candidate v3 capture took 652ms; full hands proof took 765ms wall time. No campaign, full suite, source registration or commit was launched.
