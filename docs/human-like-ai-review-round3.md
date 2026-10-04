# Human-like AI commander: independent review, round 3 (interim, methodological)

Reviewer: Claude Opus 5.5, acting as review sub-agent. I did not build this code. This is a read-only interim review of
two measurement questions. It is **not release approval** and gives no release verdict. I changed no production file,
test or spec; this document is my only repository output. Scratch scripts and outputs are in `/tmp/review-r3/`.
Written 2026-10-04, 09:27 to 09:45 UTC.

## Verdicts

**Automatic contact handling proposal: defensible in principle, not acceptable as proposed. Do not authorize it as
production policy yet.** Excluding contacts that the engine already handles without input is a fair correction of what
the reaction gate measures. A person does not click a rifle squad that is already shooting the enemy in front of it,
and the literature reaction times behind the bands are times to answer a stimulus that needs an answer. The proposal is
also prospective, outcome-blind, versioned, applied equally to all levels, and leaves the endpoint and bands alone.
Those are the right safeguards, and nothing in it reads as intentional metric gaming. But in its current form it would
(1) change the AI's behavior through the same flag it reclassifies, (2) exempt contacts a player plainly must answer,
such as a tank rolling up to idle riflemen, and contacts behind off-screen smoke that never fire, and (3) quietly
narrow the set of actors whose orders count as an answer, which changes the endpoint. Details and the required proof
are below.

**Multi-event accounting (Version 3): the core idea is sound, but it has two fair boundary bugs, and it is now the main
driver of the reaction result.** One box-select and right-click answering two nearby contacts is human, and the old
metric could not credit it. The immutable links, descriptor checks, one-input APM accounting and actual actor/target
checks work as described. However, a secondary link pays no reaction time (0.2 s at every level in a fixture,
Easy included), and links have no age limit (a 150 s old event is accepted as answered). On the same 27 seat logs,
switching from the Version 2 scoring to Version 3 moves the pooled Normal median from 4.3 s to 0.7 s. A change that
large, made after V11 failed, must be handled as a written protocol amendment, with both versions reported.

## What I inspected

Hashes at 09:38 UTC (the tree was being edited during the review; ai-hands.js, the tool and the multievent test
changed at about 09:33, and I re-checked every finding against the later versions):

| File | SHA-256 (first 12) |
|---|---|
| `shared/ai-commander.js` | `aaa86b94f707` |
| `shared/ai-hands.js` | `e8b2f0178c3f` (snapshot `09b785388866` at 09:27; the later edit only adds a null guard at line 73) |
| `shared/ai-perception.js` | `b90ec6375681` |
| `shared/ai-view.js` | `9e1d14987d75` |
| `shared/ai-attention.js` | `fef9810644c1` |
| `shared/ai.js` | `228d0745b6be` |
| `shared/sim.js` | `81dd8c6d23cc` (same as the proposal's JSON) |
| `tools/ai-humanity.mjs` | `d1e36fec0274` (snapshot `d2bdd9dc780b`; the later edit adds policy and reason to the descriptor check) |
| `test-engine-ai-humanity-multievent.js` | `eb7c4cfdf2c7` |
| `/tmp/human-ai-auto-contact-proposal.md` | `7d3050c0568f` |
| `/tmp/human-ai-auto-contact.mjs` | `59833b85dfb6` |
| `/tmp/human-ai-auto-contact.json` | `7189bbd66be2` |

The proposal's JSON records perception `088a9e...` and ai-view `b06f6a...`, which are older than the current files. Its
line references (`ai-perception.js:164-170`) now point elsewhere; the contact branch is at `ai-perception.js:196-202`
and the engaged exemption at `:182-191`. I re-ran its nine cases on the current hashes and got identical outcomes.

Read in full: the current `ai-commander.js`, `ai-perception.js`, `ai-attention.js`, the working diff of
`ai-hands.js`, `ai-view.js` and `tools/ai-humanity.mjs`, the reaction code in the tool (`primaryReactionMetrics`,
`linkedCommandServes`, `reactionMetrics`, `kaplanMeier`), the multievent test, and the engine paths the proposal cites
(`sim.js` `canShoot`, `pickTarget`, `armorMul`, the fire loop at 4225-4240, smoke creation, team visibility).

What I ran (all lightweight, all output under `/tmp/review-r3/`):

- `node test-engine-ai-humanity-multievent.js`: passes.
- `/tmp/review-r3/ac.mjs`: a copy of the proposal's fixture with three added cases (tank target, off-screen smoke,
  on-screen smoke control). Output `ac.json`.
- `/tmp/review-r3/link-timing.mjs`: real hands and the real tool, 40 seeds per level, comparing a primary event with
  the same event as a secondary link. Output `link-timing.json`.
- `node tools/ai-humanity.mjs --seeds 1-3 --mode conquest --level all --seconds 180 --workers 3 --logs --out
  /tmp/review-r3/mini3.json` at 09:35 UTC, checkpoint `bf18ec64...` (hashes as in the table). This is a 9-seat-per-level
  spot check of the live tree, not gate evidence. Analysis scripts: `links.mjs`, `v2v3.mjs`, `late.mjs`.

I did not run the full suite, any campaign, the balance tool or the benchmark.

## Part 1: the automatic contact handling proposal

### What the proposal gets right

- The engine claims check out. `canShoot` requires range (to the hull point), team visibility and line of sight
  (`sim.js:2786-2790`); targeting runs on its own when the retarget timer expires (`sim.js:4226`); a ready rifle fires
  on the next step with no command (fixture: 5 flights at tick 5). Weapon reload and retarget are not in the delivered
  row, and identical delivered rows fire at tick 5, 15 or 36 depending on hidden timers. So the proposal is right to
  claim "automatic fire eligible", not "fires next tick", and right not to use ability `cd` as a reload proxy.
- Team visibility is shared (`sim.js:3295`, `:3343`), so an ally-spotted enemy that is delivered to the seat is also
  shootable by the seat's units. No gap there.
- The conservative choices are sound: hold-fire, area and salvo weapons, unfinished setup, retreat risk with rounded
  health, unknown or uneven ground, and any doubt about the corridor all keep the event required. An event stays
  required if any candidate actor lacks proof.
- Prospective version, no retrospective reclassification, every event and reason kept, endpoint and bands unchanged.

### P1. The flag drives behavior, so this is not a measurement-only change (high)

`responseRequired` is read in three decision paths:

- `ai-commander.js:146-150`: a screen event with `responseRequired === false` never triggers the emergency interrupt.
- `ai-attention.js:94-96`: such an event gets urgency 52 instead of 92 (contact) or 103 (damage).
- `ai.js:400-407`: a required screen contact creates a `defense` situation aimed at the contact's target.

If the new policy writes the same field in perception, the AI will deprioritize exactly the contacts that leave the
graded population. The behavior and the measurement change together, in the direction that helps the gate. That is a
circularity problem even when the intent is honest: the system under test would be defining both what it must answer
and what it is graded on.

Fix: put the new classification in a separate, measurement-only field (for example `responseClass` with policy
`screen-v2`), computed by a pure, hashed function, and leave the behavior flag on `screen-v1`. Prove it with a negative
control: for fixed seeds, the complete input timelines with the new field must be byte-identical to timelines without it.
If Julio later wants the AI to ignore auto-handled contacts as a gameplay choice, that is a separate behavior change
with its own full verification, balance and campaign.

### P2. "Positive effective damage" lets riflemen "handle" a tank (high)

The predicate accepts any target where `w.veh * w.accVeh > 0`. Rifles have `veh` 1.5 (conscripts 1.1, engineers 0.3,
halftracks 0.2, MGs 0.2), and `pickTarget` does pick a tank for them (`armorMul` never reaches zero, `sim.js:2882`).

Reproduction: `node /tmp/review-r3/ac.mjs`, case `tank-target`. A rifle squad 20 m from a 360-hp tank is classified
`automatic-fire-eligible`, and the engine fires 5 rifle rounds at the tank at tick 5. Under the proposal this contact
leaves the required population, and if P1 is not fixed it also drops to urgency 52. A player who sees a tank roll up to
idle riflemen must react (pull back, bring anti-tank). Automatic fire is not handling it.

This combines with an existing `screen-v1` ordering: `alreadyEngaged` is checked before `heavy-damage`
(`ai-perception.js:208-209`), so damage events on a unit that has a target are exempt until it crosses retreat risk.
Under both rules, riflemen could auto-engage a tank and lose up to 65% of their health without one required stimulus.

Fix: restrict the first policy to matchups where automatic fire is an adequate answer, decided by a fixed table, not by
a positive damage number. A defensible start: infantry small arms against infantry; anti-tank guns, tank destroyers and
tanks against vehicles. Keep every vehicle contact against small-arms-only actors required. Consider moving
`heavy-damage` ahead of `already-engaged` in the next policy version (not retroactively).

### P3. Off-screen smoke makes a blocked line look clear (medium-high)

Perception delivers only smoke whose centre is on screen (`ai-perception.js:315`). The predicate requires the corridor
cells to be on screen, but not every smoke that could cover them. Smoke radii are 5 to 9 m (`sim.js:87`, `:174`; the
barrage uses 7 m clouds along a 14 m wide strip, `:336`).

Reproduction: `ac.mjs`, case `offscreen-smoke`. With the camera at (40, 72), the whole corridor is on screen, but a
radius 9 smoke 6 m beside it has its centre off screen. The view delivers 0 smokes, the predicate returns
`automatic-fire-eligible`, and the rifle never fires in the 40-tick window (line of sight is blocked). The negative
control `onscreen-smoke` delivers the smoke and correctly returns `line-of-sight`.

Fix: require the corridor, expanded by the largest smoke radius (9 m, plus the barrage half-width if larger), to be on
screen; otherwise the event stays required. Also expand the corridor by the target's hull length for vehicle targets,
because `canShoot` aims at `hullPoint`, not the centre.

### P4. Shrinking `responseUnits` changes the endpoint (medium)

The proposal removes proven actors from the required actor list. But `responseUnits` is also the answer criterion: the
tool counts a first completed answer only when the input's intended actors intersect `responseUnits`
(`tools/ai-humanity.mjs` `primaryReactionMetrics`, `intendedResponse`), and the commander's `servesEvent` uses the same
list (`ai-commander.js:45-48`). If a contact stays required because an out-of-range MG lacks proof, an order to the
in-range rifle (for example a focus-fire attack) would no longer count as an answer. That is a stricter, different
endpoint, which the brief says must not change.

Fix: keep two fields. `responseUnits` stays the `screen-v1` candidate set and defines what counts as an answer.
A new `unprovenUnits` list decides required or exempt.

### P5. The population is computed by the AI, and humans cannot be scored on it yet (medium)

The required population comes from the AI's own perception. The tool's human-log path calls `summarizeSeat` without any
events (`tools/ai-humanity.mjs:640-645`), so a recorded human seat cannot be scored on `screen-v1` or a successor. The
claim "a person would not answer this contact" therefore rests on argument, not data. That is acceptable for an
interim policy if it is stated plainly, but the policy should be computable from data a human seat can also produce
(server-side snapshots), so Phase 6 can check it.

### Proof and negative controls required before freezing a `screen-v2`

1. **Decoupling proof (P1).** Fixed seeds, all three levels and modes: complete input timelines identical with and
   without the new field. A behavior coupling is a separate, declared gameplay change.
2. **Predicate fixtures.** Keep the nine existing cases and add: tank, armored car and halftrack targets against rifles
   (must stay required); off-screen smoke beside the corridor (required) with the on-screen control; two enemies in
   range where the contact enemy is not the one `pickTarget` prefers (report "handled other target"); suppressed actor
   (supp 50 and 90); target in cover, trench and garrison; actor that entered the screen this frame (setup unknown);
   target at the exact range edge with rounding; vehicle target whose hull point differs from its centre; camera moved
   on the event tick.
3. **Natural-match validation with ground truth (tool only).** On seeds disjoint from the gate seeds, record for every
   event the new policy exempts: did the actor acquire a target and fire within a prespecified window (for example
   3 s) with no input; was the target the contact enemy; did the actor lose 25% health or cross retreat risk within the
   window. Prespecify the acceptance rule before running, for example acquisition-and-fire in at least 95% of exempt
   events with a stated lower confidence bound, zero blocked-line cases, and zero outmatched cases.
4. **Side-by-side reporting.** In the fresh campaign, report `screen-v1` and `screen-v2` on the same events: counts and
   shares exempted per level and reason, both Kaplan-Meier curves and censoring counts. Decide in writing, before the
   run, which one gates release.
5. **Null-commander control.** Same seeds with a commander that issues no input after the opening. The `screen-v2`
   required population must stay non-trivial and its median must be unidentified. This shows the policy cannot be
   passed by doing nothing.
6. **Seed split.** Develop and freeze on calibration seeds; never on the gate seeds.
7. **Julio's sign-off** as a protocol amendment, because it changes what the gate measures even though the numbers do
   not change.

## Part 2: prospective multi-event accounting (Version 3)

### Checked and working

- Links are created at enqueue from delivered events with `event.tick <= tick` (`ai-commander.js:312-314`) and frozen
  in the queued job (`ai-hands.js` `frozenContext`, lines 58-68). The test mutates the caller's context after enqueue
  and the emitted rows keep the original descriptors.
- The tool matches every link to the recorded population by id and tick, compares the full descriptor including policy
  and reason, and requires creation before enqueue and motor start (`tools/ai-humanity.mjs` `reactionMetrics`). Links
  cannot manufacture a population (`unknownPopulationLinks`).
- One physical input with several links counts once for APM. `summarizeSeat` computes APM from the original
  `log.inputs`; only the reaction path sees duplicated rows. The test and my spot check agree.
- Actual commands are checked separately against eligible actors and target positions (`linkedCommandServes`), so an
  intended actor cannot certify an unrelated actual order.
- All required unanswered events stay in the survival estimate.
- The commander now marks an event answered only after an accepted command that serves it (`ai-commander.js:196-203`).

### M1. Secondary links pay no reaction time (high)

`reactionDelay` (`ai-hands.js:148-170`) samples a reaction only from the job's primary `context.event`. For other
linked events, the only constraint is `minimumResponseTick`, the event tick plus 4 ticks (`ai-hands.js:70-74`, `:742`,
`:766`).

Reproduction: `node /tmp/review-r3/link-timing.mjs`. The same required contact, created on the tick the plan runs,
40 seeds per level:

| Level | As primary event: first input median (range) | As secondary link only |
|---|---|---|
| Easy | 1.05 s (0.95-1.3) | 0.25 s (0.2-0.25) |
| Normal | 0.6 s (0.55-0.75) | 0.2 s (0.2-0.2) |
| Hard | 0.35 s (0.35-0.45) | 0.2 s (0.2-0.2) |

The tool accepts these links as valid and reports a 0.2 s Kaplan-Meier median at Easy. An Easy commander answering a
new contact in 0.2 s is a bot tell and is outside its own 0.9-1.4 s band.

In the 27-seat spot check this path was rare as a first answer: 1 (Easy), 2 (Normal) and 1 (Hard) required events were
first answered by a secondary link to an event created after the decision clock started (Hard example: 0.3 s via a
group recall, event created 2.8 s after the decision began). Overall, 144, 205 and 529 link rows pointed at such
events. Rare is not zero, and Hard has the most.

Fix (either is fair): link only events present when the cycle's decision started (`event.tick <= reactionStartTick`
or `decisionStartedTick`); or make `reactionDelay` treat the newest linked event as causal and sample a full reaction
from it. In the tool, validate `event.tick <= input.reactionStartTick` for non-primary links, or report those answers
in a separate "late link" bucket.

### M2. Links have no age limit (medium)

Attention ignores stimuli older than 240 ticks (`ai-attention.js:92`), but links accept any event still in the last 128
perception events, and the tool accepts any age. A synthetic row linking a 150 s old event is counted as answered at
150.3 s. In the spot check, 514, 642 and 674 link rows were older than 12 s, and 1, 1 and 2 required events were first
answered that way (34.75 s; 72.7 s; 16.3 and 73.45 s). Each converts a censored event into an observed answer, which
can make an otherwise unidentified median identifiable, and it marks the event answered in the AI's own state.

Fix: use the attention horizon (240 ticks) as the link horizon, and report later answers separately as late, not as
completed reactions.

### M3. Version 3 is now the main driver of the reaction result (high, interpretation)

Same 27 seat logs, scored three ways (`node /tmp/review-r3/v2v3.mjs /tmp/review-r3/mini3.json`):

| Level | Version 2 scoring (primary only) | Version 3 links | Version 3, links under 12 s and present at decision start |
|---|---|---|---|
| Easy | 3.25 s, 18 of 40 censored | 2.25 s, 9 censored | 2.55 s, 12 censored |
| Normal | 4.3 s, 23 of 51 censored | 0.7 s, 4 censored | 0.75 s, 12 censored |
| Hard | 0.9 s, 15 of 44 censored | 0.5 s, 5 censored | 0.65 s, 9 censored |

Bands: Easy 0.9-1.4, Normal 0.5-0.8, Hard 0.3-0.45 s. Three seeds per level; this is a spot check on a tree under
edit, not a gate. The restricted column is my approximation of the M1 and M2 fixes, applied to the logged links.

The scoring change alone moves Normal into its band. Most of the gain comes from links to events that were present at
decision time, which is the legitimate case. But two cautions follow:

- This change was designed after V11 failed, and it moves the result in the favorable direction. It is defensible on
  construct grounds, but it needs the same treatment as Part 1: a written amendment with the rationale, Julio's
  approval, both versions reported in the fresh campaign, and the gating version chosen before the run.
- Once few events are censored, the Kaplan-Meier median converges to the per-job reaction the hands sample from the
  skill table (`ai-hands.js:148-170` targets "the complete first-input interval" at the band). Round 1 (finding 8)
  already noted this. Passing the band is then largely by construction. The real evidence is the answered fraction,
  the share of answers that are secondary or late, and end-to-end delays from queueing and interrupts. Report those
  next to the median. Round 2's point stands: Hard's 0.3-0.45 s band is faster than published choice reaction times
  without pointer travel, so a Hard "pass" is not evidence of human-like speed.

### M4. Control groups are now bound for almost every moved unit (medium)

The diff sets `operation` for any movement of own ground units (`ai-commander.js:317-320`) and lowers the bind minimum
from 2 units to 1 (`ai-hands.js:500`; previously `context.operation = !!mem.mind?.assault` and `>= 2`). In the spot
check, group binds were 72, 85 and 104 across 9 seats in 180 s (Easy, Normal, Hard), against 10, 10 and 13 in round 2's
same-sized sample. 49, 55 and 60 bind a single unit. 37, 31 and 39 are never recalled before the number is rebound
or the match ends. At Easy, binds are 10% of all physical inputs.

This partly reverses round 1 finding 5 ("bind only when an operation forms an army"), and it adds counted inputs, a
third of them wasted. The brief warns against meeting the APM floor with group binds. I make no claim about intent,
but this needs a stated reason, or a revert to operation-only binding. Report physical APM with and without
never-recalled binds.

### M5. The answered-event fallback never fires (low)

`context?.responseEvents ?? [context.event]` (`ai-commander.js:200`) never falls back, because decision jobs always
carry an array. A primary event that is not among the links (a minimap cluster whose centre moved, or an event pushed
out of the 128-event window) is never marked answered. The practical effect looks small, since minimap events are
exploratory and old events no longer draw attention. Use the union of the primary event and the links.

### M6. Invalid links are dropped silently (low)

The tool counts and drops unknown, mismatched, mistimed and unrelated links. For AI-generated logs these indicate
instrumentation bugs, not human variation. For a gate run, require zero unknown, descriptor-mismatch and timing-invalid
links, and add a counter for primary events that were not linked.

### M7. The newest link delays the primary answer (low, note)

`minimumResponseTick` takes the maximum over all links, so a fresh secondary event pushes back the first input for an
older primary event. It is harmless for the floor, but it adds to primary latency. Record it so it is not mistaken for
slow deliberation.

## Remaining blockers (not a release verdict)

- Fix P1 to P4 and M1, M2 and M4, or record a reason for each, before freezing any new policy or measurement version.
- Written protocol amendment for `screen-v2` (if adopted) and for Version 3 scoring, approved by Julio, with the gating
  version chosen before the fresh campaign. Report the older versions alongside.
- Freeze the tree, record one checkpoint for all levels, and rerun the full `node test.js` after the last edit.
- The final 120-match humanity campaign; the 60/30 balance campaigns; new Hard against old Easy, Normal and Hard.
- Hard average physical APM: 62.3 in this spot check (V11: 60.3) against the 80-120 band, unmet.
- Performance: quiet p95 8.658 to 11.149 ms and ticks over 40 ms 3 to 5, as reported by the root, failing.
- The perception adapter mismatch reopened in the spec (Phase 1) and the research document (Phase 0) remain open.
- Julio's decisions on the Hard reaction band and the APM floors (round 2).
- Browser proof with the new film, reviewed separately.
