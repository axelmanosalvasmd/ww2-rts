# Human-like AI commander: independent review, round 6

Reviewer: Claude Opus 5.5, review sub-agent. I did not build this code. I changed no repository file, staged nothing,
committed nothing, signalled no process and sent no external message. Scratch work is in `/tmp/review-r6/`.
Written 2026-10-04, about 15:35 to 16:20 UTC.

This is **not** a passing verdict and not release approval.

## 1. Verdicts

**Behavior verdict: improved substantially, not yet acceptable.** Most R5 objections are fixed in source and the V15
logs confirm it with broad numbers, not only fixtures: empty squad clicks fell from about 9% to 0.5 to 1.1%, automatic
binds are now mostly recalled at Normal and Hard, and combat-only input gaps of 8 s or more fell to 7 at Normal and 0 at
Hard. Two R5 objections are **unchanged in code** (R5-4 armor pullback, R5-6 watched suppressed heavy hits), and fresh
V15 cases show them. One new P2 tell exists: a repeated right-click loop on a squad already at its destination (R6-6).

**Release-evidence verdict: FAIL.** No source has a passing `node test.js`. The root source is ahead of every acceptance
artifact (campaign, balance, performance, films). On V15, the original reaction gate fails in all six completed groups
under all four scorings, Hard APM fails in both completed modes, Classic Normal APM fails, and the performance gate
fails. Balance and World are incomplete. No remote CI run exists.

**Main new finding.** In 8 replayed Hard Conquest matches, the frozen scorer leaves 71 of 136 required events
unanswered. About half of those (35) had a command to the required squad within 12 s that the frozen linker does not
credit. About a quarter (18) were protected holds or infeasible windows. Only about 7 look like genuine missed responses
under fire. Answered-only latencies sit near the authored bands (Hard median 0.55 s against 0.3 to 0.45 s). So the
reaction failure is now mostly about **coverage of the credited endpoint**, not timing, and fixing behavior alone will
not make the gate pass. That needs Julio's decision on a prospective endpoint change, plus the residual behavior fixes.

## 2. Sources, hashes and what I ran

Worktree `/home/judiazm/.t3/worktrees/ww2-rts/ai-human-commander`, branch `ai/human-commander`, HEAD `8a2343b` plus
uncommitted work. I hashed every claimed file myself:

| File | Root SHA-256 | V15 archive | V14 archive |
|---|---|---|---|
| `shared/ai.js` | `1e601a848c53...` | same | `792320343740...` |
| `shared/ai-hands.js` | `69eb15070dbf...` | same | `b54305294279...` |
| `shared/ai-perception.js` | `75b5f4877b5c...` | same | `377d885e40aa...` |
| `shared/ai-priority.js` | `6b5d5a8a2296...` | same | `3184d73c5fd6...` |
| `shared/ai-attention.js` | `2b1f22635d43...` | same | `a9913856d01b...` |
| `shared/ai-commander.js` | `27ea7d5b6a05...` | `48a3f5014aa5...` | `82f2cc5d9e01...` |
| `shared/sim.js` | `5bedd607250c...` | `20d8f1d1e9f1...` | `20d8f1d1e9f1...` |
| `tools/ai-humanity.mjs` | `d2a641c6f982...` | same | `8326d7c0aa0f...` |

`diff -rq` of root against `/tmp/human-ai-v15-full-source` shows only `shared/ai-commander.js`, `shared/sim.js`,
`test-engine-ai-response.js`, `CHANGELOG.md` and `DESIGN.md` differ (plus untracked tool directories that are not source).
The commander diff is exactly the two `onScreen` guards at `ai-commander.js:336` and `:346`. The sim diff is the nested
fog loop at `sim.js:3391-3399`. This matches root's description.

Read: the spec first, AGENTS.md, CONTEXT.md, rounds 4 and 5 in full (`docs/human-like-ai-review.md` does not exist),
`/tmp/r5-camera-current-visibility/REVIEW.md`, root's `/tmp/ai-v14-tactical-diagnostic.md`, the V14 to root diffs of
`ai.js`, `ai-hands.js`, `ai-perception.js`, current `ai-commander.js`, `ai-priority.js`, `ai-attention.js` in full,
the scorer (`tools/ai-humanity.mjs:160-395`), V15 campaign compact reports and raw match files, the V15 performance
protocol, balance supervision and checkpoint, the V15 full-suite log and verification, the film README, contact sheets
and frame 20 s, the CI diff and the test.js diff.

Ran (all on CPU 4 at nice 19, disclosed; none is a benchmark or acceptance run):

- `scan.py`, `loops.py` and inline Python over the 90 completed V15 raw match files (read only).
- `replay.mjs`: a read-only replay that imports the frozen V15 archive and reproduces one campaign match, snapshotting
  authoritative state of each required actor at +0, +0.5, +1, +3, +6 and +12 s. Conquest Hard seeds 1 to 8 and Normal
  seeds 1 to 4, about 11 s each. Hard seed 3's command logs for all three seats are **identical** to the campaign logs
  (49/45/49 commands), so the replay is faithful.
- `perevent.mjs`: calls the frozen V15 `measurementScoringViews` and applies the explicit-link rules per event. It
  reproduces the official Hard total exactly (65 of 136 answered) and Normal within one event (30 against 29).
- Focused root tests, all exit 0: `test-engine-ai-response.js` (1.07 s), `test-engine-ai-group-reuse.js`,
  `test-engine-ai-pointer-tracking.js`, `test-engine-ai-causal-orders.js`. `git status --short` hash identical before
  and after.

## 3. R5 objections, rechecked

| R5 | Status | Narrow or broad | Evidence |
|---|---|---|---|
| R5-1 storage crash | **Fixed** | Broad | V15 wrote all 60 Conquest and 30 Classic raw files plus compact and gzip archives; World 26/30 in progress. |
| R5-2 stale pointer on moving squads | **Fixed** | Broad | Tracking at `ai-hands.js:619-679`, `:740-748`, `:773-786`. V15 empty select-clicks: Conquest Easy 12/1125 (1.1%), Normal 13/1592 (0.8%), Hard 10/2137 (0.5%); V14 was about 9% at every level. Skill order restored. Lag is authored (`hands.skill.key[0]`), as DESIGN says. |
| R5-3 partial selection cancels | **Fixed for the subset** | Narrow by design | `selectionContinues` (`ai-hands.js:689-711`) keeps the intended subset; wrong neighbours and named actors still cancel. The missed squad gets no retry; acceptable. |
| R5-4 narrow armor pullback | **Open, code unchanged** | n/a | `ai.js:766-782` still needs `u.path.length`, a watched drop of 25% between two plans, and `ARMOR` (`ai-mind.js:97`). See R6-4. |
| R5-5 one committed squad blocks a batch | **Fixed** | Broad | Per-row filter `ai-commander.js:139-153`; danger rows submitted separately `ai.js:1015-1018`. |
| R5-6 watched damage or cover responses | **Open, code unchanged** | n/a | No new response path in `ai.js`. See R6-5. |
| R5-7 per-ID empty fights | **Fixed** | Broad | Area keyed `ai-attention.js:61-71`, `:165-189`; facts use health bands. V15 combat-only gaps of 8 s or more: Conquest Easy 52 (max 16.1 s), Normal 7 (max 9.9 s), Hard 0; Classic 16/1/0. |
| R5-8 unused binds | **Fixed** | Broad | `acceptedOperation` `ai-hands.js:152-166`. V15 binds/recalls: Conquest Easy 24/8, Normal 40/26, Hard 23/25; Classic 4/1, 8/0, 8/2. Easy still leaves two thirds unused; minor. |
| R5-9 stale-frame duplicates | **Mostly fixed** | Narrow | `pendingAccepted` `ai-commander.js:131-138` clears at the next newer frame. Non-purchase repeats within 0.25 s: Conquest 1/6/5, Classic 0/1/0. Five of the six Normal cases are the R6-6 loop, which this guard cannot stop. |
| R5-10 cue/ack predicate mismatch | **Fixed** | Broad | One predicate `commandServesObservedEvent` (`ai-priority.js:9-56`) for priority, context and acknowledgement (`ai-commander.js:155-164`, `:276-281`). Contact cue uses `armedContactActor` (`ai-perception.js:414`); planner idle defense uses it (`ai.js:726`). |
| R5-11 startup console error | **Fixed in V15 flows** | Broad | Native Start/Restart and Linux fallback reported zero errors. Films predate root (R6-12). |
| R5-12 diagonal pans | **Open** | n/a | Still one axis per hold (`ai-hands.js:528-537`); the client combines W/S with A/D (`client/camera.js:268-269`). See R6-8. |
| R5-13 inspection order | **Fixed** | Narrow | `ai-priority.js:83-88` ranks pending reads by observed relevance. |
| R5-14 capture fixture | **Fixed** | Narrow | `test.js` capture seeded (seed 10), original 180 s bound kept; 40-seed `test-engine-ai-decision-capture.js` asserts the same bound. It exercises `decisionOnly`, not the hands. |
| R5-15 bridge fixture | **Fixed** | Narrow | `test.js:7388-7406` seeded (seed 23), original 60 s bound and assertions kept; `test-engine-ai-bridge-repair.js` covers 40 seeds. I did not rerun these. |

The new camera guard (root, not in V15) addresses a real V15 case I found independently: Hard seed 6 slot 1, MG 6 takes
a 25% hit at tick 3380 while attention switches to it, but a camera pan from the previous concern completes at 3387 and
moves the camera to (120.5, 65.5). The MG drops from 57% to 29% and auto-retreats with no input. The guard's design is
sound: creation descriptors stay immutable, the held pan is paid in full, and the return is a paid gesture. Its effect on
populations is unmeasured until the next campaign.

## 4. Remaining bot tells and blockers

Classes: **missed useful work**, **visible tell**, **protected hold** (correct inaction), **calibration gap** (authored
number without human data), **evidence**.

### P1

**R6-1. No full suite has passed on any source.** *(evidence)* `/tmp/human-ai-v15-full-test.log` ends at
`test-engine-ai-response.js` (exit 1). Because `test.js` runs child files in order and stops on the first failure,
every file registered after it never ran on V15. Root has only focused passes (mine and root's). The migrated response
fixture adds assertions and removes none; the binding contract change (second accepted operation) is a declared
behavior change, so the migration is legitimate. Rerun the full suite on the final frozen source.

**R6-2. Root is ahead of every acceptance artifact.** *(evidence)* Campaign, balance, performance and both films use
commander `48a3f50`. Root `27ea7d5` changes how screen-damage responses route after a pan, which can change inputs,
populations and outcomes. The fog loop is unbenchmarked. None of the V15 numbers below can be called current. Freeze,
then rerun all of them.

**R6-3. The reaction gate fails, and about half of its censoring is an endpoint construct gap.** *(gate, calibration
gap, needs Julio's decision)*

V15 original-oracle KM medians for required screen events:

| Group | Required | Primary-only | Explicit-linked | Band |
|---|---|---|---|---|
| Conquest Easy | 335 | unidentified (200 censored) | unidentified (172) | 0.9 to 1.4 s |
| Conquest Normal | 395 | unidentified (214) | 2.1 s | 0.5 to 0.8 s |
| Conquest Hard | 374 | unidentified (237) | unidentified (194) | 0.3 to 0.45 s |
| Classic Easy | 64 | unidentified | unidentified | 0.9 to 1.4 s |
| Classic Normal | 74 | unidentified | unidentified | 0.5 to 0.8 s |
| Classic Hard | 94 | unidentified | 2.4 s | 0.3 to 0.45 s |

The `screen-observed-v1` comparison fails too (Conquest Hard explicit 8.25 s). Answered-only per-seat medians: Easy
1.325 s, Normal 0.775 s, Hard 0.55 s (Conquest); timing of the answers is near the bands, with Hard about 0.1 s slow.

My per-event classification of the 71 officially unanswered Hard events (8 seeds, heuristics in
`/tmp/review-r6/classify2.py`, thresholds mine):

| Class | Count | Meaning |
|---|---|---|
| Required squad commanded within 12 s, not credited | 35 | Retreats after a contact (8), moves (5), attack-moves, abilities, garrisons. `linkedCommandServes` credits a retreat only for the damaged unit or from within 24 m, and moves only to within 24 m (`ai-humanity.mjs:240-258`). Some are plausible answers, some are unrelated plans; not separable without judgment. |
| Auto-retreat or death within 1 s | 8 | Infeasible window; protected. |
| Garrison hold or engaged on its own, no harm | 10 | Protected hold (R4 A1/A2 pattern). |
| Idle, no harm, no command | 11 | Contact passed; low value, unclassified. |
| Under fire, no response | 7 | Candidate missed work (R6-4, R6-5); at least one had a neighbour grenade. |

Effect: even a perfect fix of the last row leaves most censoring in place, so medians stay unidentified or slow. Do not
retro-credit, rescore V15, or redefine the population after seeing these results. If Julio wants an endpoint that
credits any command by a required squad that serves the event's situation (R4 section 5 audit), it must be
preregistered, apply identically to recorded human seats, and run on a fresh campaign. Until then the gate stays failed.

### P2

**R6-4. Soft units keep fighting visible armor (R5-4 unchanged).** *(missed useful work, visible tell)*
- Source: `dangerDestination` (`ai.js:766-782`) returns nothing unless the unit is moving (`!u.path.length` at `:767`),
  had a watched 25% drop between two plans at most 80 ticks apart (`:750-763`), and the threat is in
  `ARMOR = tank, medium, tiger, churchill` (`ai-mind.js:97`). Tank destroyers (12 infantry damage) and rocket trucks
  (25) are excluded. `hurt` at Normal triggers only below 35% (`ai.js:647`).
- V15 example, Normal seed 1 slot 2, rifle 8: from tick 3338 it fires at a tank 23.2 m away (tank range 35). The squad
  falls to 40% while the camera is on an alert. At 3417 the camera arrives at (120.1, 40.9) with the tank on screen.
  The seat attends this damage stimulus from 3473 to 3514 and makes **zero inputs**; the next input is a minimap jump at
  3526. The rifle reaches 10% and auto-retreats. It was stationary, so the pullback could not fire. One selection and
  one retreat key fit easily in a 2 s Normal visit.
- Root's diagnostic correctly found four seed-1 cases infeasible or unproven. That is a sample result, not proof that the
  class is empty.
- Fix: on an attended plan, check soft units that are inside a visible armor unit's range and in the hurt band or under
  its fire, moving or not; include anti-infantry armored vehicles. Keep the garrison, anti-tank, healthy, off-screen,
  remembered-only and safe-destination negatives. Report how often it fires.

**R6-5. Watched suppressed heavy hits still get no local response (R5-6 unchanged).** *(missed useful work)*
- V15 Hard seed 2 slot 1, rifle 5: at tick 1838 a conscript is 2.6 m away on screen; rifle 5 is idle, takes 33% and
  48 suppression within 1 s, and gets no order for 12 s. A neighbour's grenade at 1907 may have been the answer, so this
  one is ambiguous.
- V15 Hard seed 7 slot 1, rifle 17: pinned (95) at 55% near an off-screen tank; the camera leaves within 0.5 s; one
  input in 12 s; auto-retreat at 3 s covers it (protected outcome, but leaving a pinned squad is a visible tell).
- Hard seed 6 MG 6 (section 3) was a routing defect the root guard should fix.
- Fix as in R5-6: one ordinary cover or short pullback for a watched suppressed squad after a heavy hit, without
  lowering retreat thresholds or adding toggles. Then measure the "under fire, no response" class again.

**R6-6. New: repeated right-clicks on a squad already at its destination.** *(visible tell, wasted input)*
- V15 Conquest Normal seed 12, slot 2, squad 16: ten accepted `move [16]` commands at ticks 2281, 2301, 2305, 2310,
  2339, 2343, 2347, 2351, 2356 and 2381, all to within 0.25 m of (119.6, 63.2). Each is a paid right-click 4 to 5 ticks
  apart; pointer travel between clicks is 0.2 to 2 px. A spectator sees a burst of identical click markers.
- Mechanism: the planner wants (119, 61). The formation snap sends the squad to (119.7, 63.3), 2.4 m away. The arrival
  guard (`ai-commander.js:144`) requires both the stored actual destination and the unit to be within 2 m of the
  planned point, so it never matches. Commitment does not apply because the squad is at its old destination
  (`:148`). Duplicate memory (`:131-138`) expires at the next delivered frame. The planner proposes the same move each
  plan.
- Prevalence: one 10-command chain, plus four 3 to 5 command chains (Conquest Easy seed 20, Classic Normal seed 10,
  Classic Hard seed 10) in 90 matches. Rare, but it is exactly the spec's banned "order given again and again".
- Fix: compare against the accepted actual destination with a tolerance at least the formation snap distance, or treat
  a planned target as reached while the squad stays within that tolerance of its last accepted destination for the same
  planned point.

**R6-7. Hard and Classic Normal APM fail; the gap is mostly a calibration gap.** *(calibration gap, some missed work)*
- V15 physical APM medians (60 s windows): Conquest 27.3 / 40.5 / 55.2, Classic 27 / 38.3 / 52.2. Bands 20 to 35,
  40 to 70, 80 to 120. Conquest Normal passes by 0.5 with p10 35.6; Classic Normal and both Hard groups fail.
- Missed work exists (R6-4, R6-5, floating MP: Hard mean 136 Conquest, 91 Classic) but is far smaller than 25 inputs per
  minute. About 10 Hard inputs per minute are already camera moves with no following action (section 6).
- Do not close the gap with binds, inspections, camera moves or repeats. Julio's recorded play is the only valid basis
  for revising the band, as R4 said.

**R6-8. Performance fails.** *(evidence)* `/tmp/human-ai-final-performance-protocol-v15.json`: exact arm passes
(p95 9.501 to 10.876 ms; max 61.818 to 40.720). Counts arm fails: p95 9.142 to 11.749 ms against an 11.142 ms limit,
ticks over 40 ms 4 to 5. One trial per arm, no resample, which is correct. The fog-loop saving (0.029 ms per rebuild)
cannot close a 0.6 ms gap. Remeasure on the final source with the same protocol.

### P3

- **R6-9. L-shaped camera pans (R5-12 open).** V15 consecutive orthogonal pan pairs: Easy 135, Normal 194, Hard 477
  (about 8 per Hard seat in 3 minutes, about 2.7 extra paid holds per minute). The client allows one diagonal hold.
  Sub-human rather than a cheat; visible as a right-angle camera path.
- **R6-10. Classic opening is one script.** Purchase-only sequences over 10 seeds per faction: Normal and Hard have two
  distinct sequences with 70 to 80% `engineer, rifle, rifle`. Not the gated 20-seed population, and Engineer-first is
  normal human play, but the uniformity is visible.
- **R6-11. Short duplicate attacks.** Four Hard attack re-clicks within 0.25 s (for example Hard seed 17 slot 0
  `attack [2]` at 2052 and 2056). Within 2 s, Classic Hard has 26 same-target repeats. Minor; people do re-click.
- **R6-12. Films predate root and the battle clip is low-FPS.** The README is honest: scene and overlay proof only, no
  timing claims. Frame 20 s shows camera footprints and markers clearly. A final-source native clip is still needed.
- **R6-13. Original oracle coverage starts at tick 2.** All 360 seats report `originalFromMatchStart: false`
  (baseline tick 2). Practical effect is likely nil because no enemy is visible in the first two ticks, but it is not
  proven. Keep any tick-0 correction prospective and out of the running campaign, and keep the failed attempts.
- **R6-14. Empty glances.** About half of all camera moves are followed directly by another camera move (Hard 1896 of
  3500, of which 918 are pan legs). Plausible checking, but it is input count, not useful work.
- **R6-15. No remote CI.** The workflow change is sound: explicit `shell: bash` gives `-eo pipefail`, source hashes are
  checked before and after, logs are uploaded, assertions and 180 s child limits are unchanged. Whether 55 minutes is
  enough on a hosted runner is unknown until it runs.

## 5. Gates on V15 (not root-current)

| Gate | V15 result |
|---|---|
| `node test.js` | **Fail** (V15 at response test); root not run |
| Reaction, required screen events | **Fail** in all six completed groups (R6-3) |
| Off-screen alert first action | Pass: Conquest 4.1 / 2.15 / 1.15 s, Classic 4.225 / 2.075 / 1.175 s |
| Average physical APM | Easy pass both modes; Conquest Normal 40.5 marginal pass; Classic Normal 38.3 fail; Hard fail both |
| Peak 10 s APM | Pass; maxima equal the enforced caps (60, 120) at Easy and Normal, Hard max 192 |
| First order | Pass all groups (Conquest ranges 4.05 to 7.95, 3.05 to 5.95, 2.2 to 4.0 s) |
| One command per tick, 0.25 s cross-screen floor | Pass, zero violations |
| Opening variety, 20 seeds per faction | Conquest purchase-only sequences pass all nine groups (3 to 11 distinct, max 20 to 45%) |
| World | 26 of 30 complete, not reviewed |
| Balance | Classic 14 of 30 (Germany 5, USA 4, USSR 4, draw 1); C60 and old-commander duels not started |
| Performance | **Fail** (R6-8) |
| Browser | Clean console; films predate root |
| Spec items still unchecked | Bounded rationality and human slips (R6-6 is relevant to the first) |

## 6. Measurement, source and creation integrity

- Runtime strips `responseRequired`, `responseReason`, `responsePolicy` and `responseUnits` before saving events
  (`ai-perception.js:253`); the only other reference builds the tool-only label (`:215`). No `shared/` or `server.js`
  file imports `tools/`. No `Math.random` in `shared/ai*.js`.
- The scorer audit reports zero unknown, mismatched or invalid mappings in all six groups. `originalEventsWithoutRuntimeAlias`
  is 154 / 241 / 281 in Conquest; those stay censored with no retro-credit, which is correct.
- The new response fixture asserts the creation descriptor is unchanged after the camera return.
- Bands, populations, horizons and child-test limits are unchanged. I found no eased number or removed assertion.
- The campaign runner recomputes every seat summary from the raw log and checks both policies keep equal required
  counts; that is good practice.

## 7. Fix order

1. R6-6 arrival tolerance; R6-4 and R6-5 local responses, with positive and negative fixtures and prevalence counts.
2. Freeze. Full `node test.js` on the frozen tree.
3. Fresh 120-match campaign with both policies and both scorings, then balance C60, Classic 30 and duels, the
   performance protocol, and a native film, all on that one source.
4. Ask Julio, before the campaign, whether a preregistered secondary endpoint for R6-3 should be reported. Keep the
   original gate as the gate unless he decides otherwise in writing, and record his own matches for APM and reaction
   calibration.
5. Another independent review round.

## 8. Paths

- This review: `/tmp/human-ai-review-round6.md`
- Scripts: `/tmp/review-r6/{scan.py,loops.py,replay.mjs,perevent.mjs,classify.py,classify2.py}`
- Replays: `/tmp/review-r6/replay-conquest-{hard-1..8,normal-1..4}.json`; per-event join `/tmp/review-r6/perevent.json`
- Focused test logs: `/tmp/review-r6/test-engine-ai-{response,group-reuse,pointer-tracking,causal-orders}.js.log`
