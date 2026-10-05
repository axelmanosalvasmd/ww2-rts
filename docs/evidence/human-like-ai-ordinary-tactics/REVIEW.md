# Ordinary tactic diagnosis on bc677

No material tactic stall was reproduced. Keep the gameplay source unchanged from this diagnosis.

The four authored scenes ran at Easy, Normal, and Hard with seeds 1, 2, and 3: 36 episodes. Assault, infantry support, and a protected hold ran for 30 seconds; the occupied two-front production scene ran for 60 seconds. Every episode reached its original deadline. Ordinary native firing stayed enabled. No damage or alert was injected. The two-front scene received legal native attack-move orders before tick 0, separately recorded as authored setup and excluded from AI inputs.

The actual native screen-manual-v3 and public-danger-alert-v1 adapters recorded the public scenes, motor starts, inputs, and real command receipts. Capture-on versus capture-off comparisons preserved the complete native timeline, command results, authoritative end state, and sampled public/authoritative frames for the four Hard seed 1 cases. All imported gameplay source is retained under source. Root gameplay hashes matched before and after both stages.

## Diagnostic response results

These authored episodes are not an acceptance population. Their opening responses include the ordinary initial planning delay. All original timing and APM limits remain unchanged.

| Level | Episodes | Screen required / answered / censored | Screen first-input KM median | Alert required / answered / censored | Alert paid-camera KM median |
| --- | ---: | ---: | ---: | ---: | ---: |
| Easy | 12 | 12 / 12 / 0 | 4.15 s | 4 / 4 / 0 | 4.2 s |
| Normal | 12 | 9 / 9 / 0 | 3.1 s | 5 / 5 / 0 | 2.1 s |
| Hard | 12 | 6 / 6 / 0 | 2.55 s | 9 / 9 / 0 | 1.2 s |

Every required row and every eventless scene remains in the raw files. No unknown creation occurred. Manual eventless episode counts are Easy 6, Normal 7, Hard 9; alert eventless counts are 8, 9, and 6. Manual scenes without required events retain the detector's original not-evaluable result, rather than being marked as successful response measurements. No recording-end censor arose in this set; the adapters and stored rows retain the original censor behavior.

The table uses the unchanged source Kaplan-Meier reducer. Its Easy first-input median crosses the unrounded floating survival boundary at 4.15 seconds, although the displayed curve rounds to 0.5 at 1.65 seconds. The accepted-command median is 1.85 seconds. Per-event accepted ticks all occur at or after their first physical response. This sparse-sample rounding effect is retained, with complete curves and rows, rather than corrected in this gameplay diagnosis.

## Gameplay evidence

All nine assault scenes issued real attack-moves, fired, damaged opponents, and preserved the four original squads. The neutral point was not captured within these 30-second contested fights. These scenes demonstrate actual assaults and subsequent combat responses, not an objective-win guarantee.

The support scenes used actual infantry targets, paid selections, HUD ability inspection, real support commands, and ordinary retreats. Support was not forced when the planner preferred another action. Hard seed 1 issued artillery at tick 98 and an MG ability at tick 146. Easy seed 3 had one ability refused because its squad had begun retreating; it still answered the actual damage episode with a native retreat and retained its squad.

All nine two-front scenes bought reinforcements, captured the forward objective, retained the rear objective, and preserved all six original actors. Hard seed 1 responded to both native off-screen attack alerts, used a para call and three buys, then performed real local fortification work. Both objectives remained owned and uncontested at tick 1200.

All nine protected-hold scenes kept the MG at (77,81), at its original 75 HP, while the opponent took native damage. The native detector classified these scenes as monitoring with no required manual response. No advance, retreat, or cover order displaced the guard.

Ten cover commands were refused across the three Hard two-front cases. Hard seed 1 includes wire construction accepted for actor 20 at tick 1084, followed by a cover command refused at 1088; actor 15 repeats this at 1114 and 1118. The public moving flags were visible by ticks 1086 and 1116. These are occasional wasted keys, not a destructive loop: no cover command was accepted, no original actor was lost, builder movement and digging continued, and both objectives stayed owned. The native no-cover path skips the squad before clearing its orders when no better spot exists at its current cover rank. The refusal cache also prevents immediate repetition of the identical failed proposal. This evidence does not justify reopening gameplay for a mandatory fix.

## Reproduction and artifacts

Run one exact source-qualified episode:

```bash
taskset -c 1 nice -n 19 node /tmp/ai-ordinary-tactics-bc677/probe.mjs --case twofront --level hard --seed 1
```

The other scene names are assault, support, and safehold. The runner imports its retained gameplay snapshot and checks the expected current Root gameplay hashes. It intentionally refuses a different source qualification. The shared Kaplan-Meier helper is imported from Root solely for diagnostic reduction; its qualification is recorded separately.

The 36 scene-level JSON files contain full native inputs, actual command receipts, public frames, native response streams, and separately labeled authoritative proof frames. Authoritative frames never enter the planner or response classifier. summary-first.json and summary-all.json retain command summaries; diagnostic-timing.json retains complete diagnostic curves; raw-manifest.json binds every raw episode by SHA-256. source-hashes.json and source-hashes-after-first.json/source-hashes-after-all.json retain the before/after runtime qualifications.

No Root source, archive, protocol, campaign, scorer, or acceptance rule was edited. CPU 1 work has finished.
