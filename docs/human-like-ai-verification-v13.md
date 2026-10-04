# Human commander: selected HUD verification slice

`node test.js` exited 0 on 2026-10-04, 10:21:10-10:46:41 UTC. All 601 tracked and untracked nonignored
file hashes matched before and after. Manifest digest: `a739feb823297fd2452d5586a31a21b3eace527f1a438efee81137b3967289a1`.
The retained full log is `/tmp/human-ai-v13-full-test.log`, 14,127 bytes, SHA-256
`36ab524d2e25934baa4e47f76e163daef03cec8899f241c1b772162c3bfa4c6c`. Independent manifests are `/tmp/ai-v13-full-before.json` and
`/tmp/ai-v13-full-after.json`; the summary is `/tmp/human-ai-v13-full-verification.json`.

The tested source includes the merge of master `a3564a6`, with natural terrain and tank wheel/track changes.
Only the changelog needed conflict resolution. All 47 registered subprocesses ran, including every
`test-engine-ai*.js`, World observation, spectator privacy, selected HUD, physical inspection, canonical effect
visibility, immutable response links, workload and terrain delivery. The complete suite also ran rendering,
engineering, server and performance checks. No existing test was skipped.

The fog proof retained 4,489 paired turns and 1,885 decision-only orders: 230 purchases, 544 moves, 206 abilities,
174 digs, 83 garrisons, 96 entrenchments, 63 retreats, 40 support calls, 25 cover orders, 263 attack-moves,
68 attacks, 36 builds, 56 assists and one fire-at order. Perturbations covered 30,213 hidden units,
9,566 visible units, 7,353 subprecision positions, 2,205 secret depots and 237,654 hidden mines, plus
420 dropped-visible controls. The unchanged decision-only capture deadline passed at 49 seconds.

The actual-input Normal match finished with seat 0 winning at 616 seconds. The first point was captured at
19 seconds, all points at 79 seconds, with 96 recruits and 72 deaths. Its assertions verify physical selection,
ordinary command submission, opening delay, causal floor and rolling input caps. The 43,499 microseconds per tick
printed by this long assertion-heavy match is retained, rather than treated as the separate release benchmark.

The selected-HUD tests verify singleton exact text and rounded cooldowns, grouped aggregate text, stale memory,
unknown unselected readiness, and private detector/projection storage. Physical inspection tests exercise the
actual commander and planner: paid selection and HUD reading precede a useful ability; wrong selections and
cooling actors do not fabricate readiness or event acknowledgements. Existing assertion changes are limited to
intentionally estimated world-bar HP, new selected-HUD contracts and the preexisting Engineer reservation probe's
actual post-command planning beat. These retain positive controls and ordinary rejection checks.

## Provisional measurements

The immutable 15-match diagnostic source checkpoint is
`80f5b59d0b2fcfadd8b55e21be76b0903dca4473857fe7eb967ee189644d0e45`.
Source archive SHA-256 is `25329e4827aa637f6c5bbc69792ace0aa84c41f58562aada2382d864c514e57d`;
full raw gzip SHA-256 is `c244ba3a8ae382844329a9d252d0cb4485d43d6d90db52a27706e24159db1f61`.
The report and complete logs remain under `/tmp/human-ai-selected-hud-v13/`. Every compact metric was recomputed
from the unchanged raw log, and decompressed bytes match the original report exactly.

| Measure | Easy | Normal | Hard |
| --- | ---: | ---: | ---: |
| Median physical APM | 26.333 | 40.333 | 63.333 |
| Required screen first-action Kaplan-Meier median, explicit links | 3.1 s | 1.9 s | 1.5 s |
| Same-log primary-only median | unidentified | 4.75 s | 2.05 s |
| Required answered / censored / total | 56 / 26 / 82 | 83 / 31 / 114 | 59 / 27 / 86 |
| Ten-second peak APM | 60 | 120 | 168 |

All reaction medians and Hard average activity miss the original authored bands. Both scores retain every
censored stimulus. This 15-match run does not meet the required 120-match campaign size. Earliest causal action,
opening intervals, physical burst caps, one command per tick and spatial floors pass the diagnostic.
Actual physical inspections total 341, with 332 correct selections and nine misses. Accepted abilities total
233, including ordinary failed cooldown attempts retained in the source logs.

Conquest 60 is provisionally balanced: USA 19, Germany 24, USSR 17 wins, or 31.667/40/28.333 percent.
All 60 ended by victory points, with no draws or timeouts. Median length is 638.575 seconds, versus
596.175 before, an increase of 42.4 seconds or 7.112 percent. Classic and old-commander duels are still running.
Any subsequent behavioral change requires fresh final balance results.

The predeclared four-row release benchmark remains failed. Exact baseline/current AI p95 is
9.220/10.968 ms and maximum 70.635/63.070 ms, within the phase limit. The separately instrumented count rows
have p95 9.016/12.799 ms, outside the limit. Full ticks above 40 ms increase from two to nine, while
AI phases above 40 ms remain two. All rows and source hashes are retained in
`/tmp/human-ai-final-performance-protocol-selected-hud-v13.json`. The later HUD sweep started after the
benchmark completed and did not overlap it. Separate concurrent profiling is diagnostic only.

A subsequent current-source probe confirms an unselected health-event leak: the same world-bar estimate
can yield different damage-event existence, amounts, heavy thresholds and retreat-risk crossings. Exact
suppression also escapes the visible category boundary. `/tmp/human-ai-subprecision-events/proof.json` retains
three health counterfactuals and the production attention difference. Phase 1 and the perception gate remain open.

Release gates remain open. Next work verifies useful inspection priority, corrects damage-event precision,
remaining performance costs, the final campaign, readable film and independent review. No numeric gate,
required-event population or economic rule has been changed to make these measurements pass.
