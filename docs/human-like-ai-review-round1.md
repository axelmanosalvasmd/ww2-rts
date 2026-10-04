# Human-like AI commander: independent review, round 1

Reviewer: Claude Opus 5.5, acting as review sub-agent. I did not build this code. I changed no production file; this document
is my only output. Written 2026-10-04, around 06:30 UTC.

## Verdict

Not ready to call human yet. The input layer now reads like a person: one camera, minimap jumps, one command per tick, no
cross-map pairs, a first order after about 5 s at Normal and about 44 physical APM. A spectator watching the inputs one at a
time would accept the pacing.

The decisions behind those inputs do not yet read like one coherent mind. In current-source runs the same squad is sent one
way and then back again (once within 0.95 s), a grenade or barrage is re-clicked on the same spot twelve times in 30 s,
control groups are bound and almost never used, and the on-screen reaction number that is reported as "5.3 s, exceeds the
brief" does not measure on-screen reaction at all. Findings 1 to 4 below should be fixed before round 2. None needs a
rewrite: each has a narrow fix in the commander, the hands or the metric.

To the question "does it feel like a real person with coherent tactics": the hands feel like a person. The tactics feel
like a person who forgets, a few seconds later, what they just told each squad to do. That indecision is the most visible
bot tell left.

## What I reviewed and ran

Source read in full at 06:13 to 06:30 UTC: `shared/ai-hands.js`, `ai-commander.js`, `ai-attention.js`, `ai-perception.js`,
`ai-persona.js`, `ai-rng.js`, `ai-mind.js`, `alert-events.js`, the human-mode parts of `shared/ai.js` and `ai-view.js`, and the
`server.js`, `client/main.js`, `client/fairness.js` diffs. Three files changed while I reviewed (see "Changed during this
review"). Line numbers below are as of 06:30 UTC.

Historical inputs: `/tmp/human-ai-review-timelines.json` (3 seeds, Normal, Conquest, 180 s, generated at 06:14) and the V4
failure traces `/tmp/human-ai-loss7-v4-spatial.json`, `loss17-v4-assault.json`, `loss18-v4-spatial.json` (Hard against the
old Easy commander, 06:07 to 06:10).

Fresh runs on the current source, written only to `/tmp/review-r1/`:

```
node tools/ai-humanity.mjs --seeds 1-3 --mode conquest --level easy|normal|hard --seconds 180 --workers 3 --logs --out /tmp/review-r1/current-<level>.json
```

These ran at about 06:23 UTC, after the root's listed fixes and after the Hands agent's pointer projection landed (hands
06:19, commander 06:20). `shared/ai.js` changed again at 06:29, after these runs. My analysis scripts are
`/tmp/review-r1/tl.js` (per-seat input timeline), `stats.js` (look-only camera jumps, group use, repeats, redirects) and
`snap.js` (V4 snapshot summary).

Tests run at 06:27 on the current source, all passing: `test-engine-ai-hands.js`, `test-engine-ai-human.js` (21 s),
`test-engine-ai-perception.js`, `test-engine-ai-commitment.js`, `test-engine-ai-overlay.js`, `test-human-input.js`. I did not
run `node test.js`, the balance campaign or the benchmark.

Current-source summary (medians over 9 seats per level, 3 seeds):

| Measure | Easy | Normal | Hard | Brief target (Easy / Normal / Hard) |
|---|---|---|---|---|
| Physical APM, 60 s windows | 24.3 | 43.7 | 63.0 | 20-35 / 40-70 / 80-120 |
| Peak physical APM, 10 s | 60 | 90 | 120 | 60 / 120 / 200 or less |
| First order (s) | 6.8 | 5.05 | 3.25 | 4-8 / 3-6 / 2-4 |
| First buy (s) | 13.6 | 9.8 | 6.75 | not in table |
| "On-screen" reaction, tool definition (s) | 5.8 | 4.45 | 2.85 | 0.9-1.4 / 0.5-0.8 / 0.3-0.45 |
| Off-screen alert reaction (s) | 3.78 | 2.7 | 1.63 | 3-6 / 1.5-3 / 0.8-1.6 |
| Camera jumps per minute | 6.3 | 9.3 | 16.3 | not in table |
| Max commands per tick | 1 | 1 | 1 | 1 |
| Cross-map pairs within 1 s | 0 | 0 | 0 | 0 |

Three seeds per level is a spot check, not the 20-seed gate.

### Visual evidence and its limits

The recording (`mcp-e5a71...mp4`, 50.9 s, 1920x1080) shows the Controls sheet over the play area for the entire clip, not
only until late. I extracted frames every 5 s and minimap crops every 2 s (`/tmp/review-r1/frames/sheet.jpg`,
`mmsheet.png`, `mm2040.png`). Only the top score bar and the minimap with the overlay are readable. I could not judge
in-world unit movement, click markers or the ghost cursor from it.

On the minimap the three dashed AI camera outlines are visible and move between bases and points. They look larger than
the solid outline of the spectator's own view. The recording was made before the footprint sign fix (below), so those
outlines are drawn with the old, flipped formula and should not be used to judge camera size. The screenshot shows a
spectator view of the AI 1 HQ with a squad by the flag; nothing in it is a tell. Round 2 needs a clip with the play area
visible.

## Findings, most severe first

Status labels: **current** means reproduced on the current source or confirmed in current code; **historical** means seen
only in older traces.

### 1. Squads are sent one way and then back (current, high)

Reproduction: `node /tmp/review-r1/tl.js /tmp/review-r1/current-hard.json 1 2 114 165`.

- Hard, seed 2, slot 2: at 116.95 s a box-selected pair gets `move` to (87,80); at 117.90 s the same selection gets
  `amove` to (85,120), 40 m the other way, under the same alert concern.
- The same seat, unit 9: (81,121) at 140.4 s, (81,81) at 149.3 s, (81,121) at 154.4 s, (81,81) at 163.8 s. Four
  reversals between two points 40 m apart in 23 s, each from a different concern (production, idle, fight, fight).
- Normal, seed 1, slot 2: four units attack-moved to (83,87) at 140.3 s, then moved 47 m away to (97,41) at 148 to 150 s.
- Historical Normal, seed 3, slot 0: (80,79), then (32,110) 5 s later, then (80,80) 11 s after that.

The brief lists "units turning back and forth" as a behaviour a person would read as a bug.

Causes in the source:

- `plan()` never reads `opts.concern` (no reference anywhere in `shared/ai.js`). Every attention cycle re-plans every
  on-screen unit from scratch, and the commander only filters the output by concern kind
  (`ai-commander.js:118-128`). Whichever concern brings the camera near a squad can re-task it.
- Inside one cycle, plan can emit two movement orders for the same unit (assault staging plus point assignment). The
  hands keep both because their dedupe key includes the command type (`ai-hands.js:194`). In the old commander the later
  order silently replaced the earlier one in the same tick. With hands, both become visible clicks.
- Point choice uses noise re-rolled every 6/10/16 s (`ai-persona.js:41-43`), and `load` and wave sizes see only on-screen
  troops as available (`ai.js:324`), so the answer changes with where the camera happens to be.

Minimal fair fix: in the commander, keep at most one movement intent per unit per cycle (the highest rank), and keep a
per-unit "last order" record (tick, target, concern). Drop a new `move`/`amove` that sends a unit more than about 20 m from
its last target within a commitment window, unless it is a retreat, a base or danger alert, or the unit has arrived or gone
idle. Make the window a skill parameter and label it provisional like the other timings.

### 2. The same aimed ability is clicked again and again (current, high)

Reproduction: `/tmp/review-r1/current-normal.json`, seed 2, slot 0, unit 16. Twelve accepted `ability` commands to the same
spot (75.7, 77.9) between 113.15 s and 143.40 s, every 1.5 to 5 s, across fight, alert and idle concerns. The unit's
source location stays at x = 58.46 the whole time, so the throw never happens. Each command resets the pending throw
(`sim.js:2603-2618` sets `u.nade` and accepts it while the cooldown is zero).

`mem.failedInputs` only records rejected commands (`ai-commander.js:75`). An accepted order that has no effect is retried
forever. A person might click twice; twelve identical clicks in 30 s is a bot tell, and it also wastes APM budget that
should go to the fight.

Minimal fair fix: treat a repeat of the same aimed ability (same unit, target within a few metres) issued twice without
the unit's cooldown starting as failed, and back off for the same 15 s the commander already uses for rejected inputs.

### 3. The on-screen reaction metric does not measure on-screen reaction (current, high, metric definition)

The known "on-screen event to first physical input, Normal median 5.3 s" (4.45 s on the current source) cannot be compared
with the 0.5-0.8 s target, because the samples are mostly something else:

- In the historical timelines, 62 of the 77 "on-screen" samples are `minimap-contact` fight concerns, and their first
  answering input is a camera move (29 `camera-minimap`, 29 `camera-pan`). If the camera has to move, the event was not on
  screen in any useful sense.
- `eventOnScreen` for a fight is true if any one enemy dot in a 40 m grid bin is on screen at the moment attention picks it
  (`ai-attention.js:55`), not at the event tick.
- The event clock starts at the first minimap sighting of any dot that is now in the bin (`ai-attention.js:47`, `54`), even
  if that enemy was first seen far away and harmless. The clock also restarts when a dot flickers out of the minimap and
  back.
- An own unit taking fire on screen produces no event at all: `deriveAlertEvents` drops attack alerts that are on screen
  (`alert-events.js:33`), which is right for the client's presentation but leaves the AI and the metric without the most
  basic on-screen stimulus.
- The research note defines this measure as "event to first answering command" (`docs/research/human-like-rts-ai.md:49`);
  the tool reports first physical input including camera moves; the hands apply the table's range as a per-job pause
  (`ai-hands.js:485`). These are three different quantities with one name.

Minimal fair fix: emit an AI-side event, with `onScreen` stamped at the event tick, when an enemy first enters the screen
tier and when an own on-screen unit loses health (keep the client's suppression in `client/alerts.js` presentation only).
Measure from that tick to the first non-camera input answering it, and report unanswered events as censored, as the
research note already asks (`human-like-rts-ai.md:75`). Do this before tuning anything against the 5.3 s number.

### 4. A new emergency cannot interrupt queued work (current, medium-high)

The commander does nothing while the hands are busy (`ai-commander.js:83`). A cycle can queue up to three intents
(`ai-commander.js:136`), each of which costs a reaction pause, selection, keys and a click, about 1 to 2.5 s each at
Normal. A base alert that arrives just after a cycle is queued waits for all of it. The emergency override in
`chooseConcern` (`ai-attention.js:118`) only runs once the hands are idle. This is part of why on-screen reaction is slow
and is the "flank answered late" slip happening every time rather than sometimes.

Minimal fair fix: when a danger alert or an emergency-level concern appears, drop queued jobs that have not started (keep
the active one) and let attention choose again.

### 5. Control groups are bound and almost never used (current, medium)

- Historical Normal: seed 1 slots 0 and 1 bound 3 and 5 groups and recalled none. V4 loss7 bound 9 groups and recalled
  none in 556 s.
- Current runs: Hard seed 1 slot 0 bound 6 and recalled 0; Normal seed 2 slots 0 to 2 bound 2 to 3 each and recalled 0.
- Groups are numbered `groups.size + 1`, never pruned, never reused (`ai-hands.js:322-323`), so a seat runs out after 9
  bindings. Loss7 and loss17 used up all 9 by 342 s and 477 s; units bought later can only be ordered on screen.
- `groupFor` needs an exact id match (`ai-hands.js:83-86`). One dead member, or plan splitting the army differently, and
  the group never matches again.

To a viewer this looks like a player who presses Ctrl+number on every box selection out of habit and never presses the
number. It also inflates physical APM with inputs that do nothing.

Minimal fair fix: prune dead members on recall, recall when the group contains the wanted units (a person recalls the group
and lets the dead ones drop out), overwrite the least recently used number instead of stopping at 9, and bind only when an
operation forms an army, not on every multi-unit selection.

### 6. Timing distributions are uniform and the reaction pause is paid before every job (current, medium)

Every reaction, key and deliberation delay is `between(rng, lo, hi)`, a flat range with hard edges
(`ai-hands.js:9-11`, `485`; `ai-commander.js:96-97`). Inter-input gaps on the current source show the edges: at Easy there
is one gap between 1.0 and 1.2 s against 19 to 33 per 0.1 s bin from 1.5 to 1.9 s; Normal has a dip at 0.6 to 0.8 s and a
bump at 1.0 to 1.3 s. A histogram of the input log shows a machine.

The full reaction pause is also charged at the start of every job, including the second and third order of the same visit
(`ai-hands.js:485`). The project's own research note says the opposite: "Repeated inputs inside a practiced sequence should
not each repay the entire deliberation delay" (`human-like-rts-ai.md:11`).

Minimal fair fix: draw from a right-skewed distribution (lognormal or ex-Gaussian) whose median is the provisional table
value, with the 0.2 s floor kept. Charge the full reaction only for the first input answering a new event or concern; use a
shorter between-actions gap for later jobs in the same visit. The values stay provisional until local recordings exist.

### 7. Enemy strength estimates are re-rolled every cycle (current, medium)

`estimateSightings` draws fresh noise for every sighting on every cycle (`ai-persona.js:30-37`, called from
`ai-commander.js:110`). With Normal's plus or minus 22%, the same remembered enemy group can look strong enough to withdraw
from in one cycle and weak enough to advance on in the next. That feeds the dithering in finding 1. DESIGN.md says "Option
noise persists during commitment"; that is true for point bias but not for these estimates.

Minimal fair fix: store one error per sighting id and keep it until that enemy is seen on screen again.

### 8. Difficulty is not yet skill-only, and two table rows are not implemented (current, medium)

- Hard averages 63 physical APM against an 80-120 target. The cap only enforces the upper bound (`ai-hands.js:79`); nothing
  makes Hard use its budget.
- "Concerns it can juggle" (1-2 / 2-3 / 3-4) is not implemented as juggling. Every level attends exactly one concern.
  `tune.capacity` only changes the idle urgency cap (`ai-attention.js:83`), and `state.concerns` is used only for its first
  element (`ai-attention.js:115-117`).
- `AI_LEVELS` still carries binary policy switches that change behaviour by script rather than by skill
  (`ai.js:223` onward): Easy has `adaptive: false` and `firstAssault: 150`; only Hard has `focus` and `guard`. One of them
  changes information use: `L.memory` is true only at Hard, and it decides whether remembered sightings feed counters
  and point threat (`ai.js:314-315`, and the `foes` check around line 757). Easy and Normal therefore ignore what their
  own screen memory holds when choosing counters in Conquest. The brief says difficulty changes speed, attention and
  judgement, "never information". Either express memory use as a decay rate for every level, or document these switches
  as judgement in DESIGN.md and say why.
- The skill table's median ranges are used as hard bounds of a uniform component (`ai-hands.js:9-11`). That satisfies
  "median in range" for the component by construction and says nothing about end-to-end behaviour. DESIGN.md and the
  research note are honest that these are authored defaults; keep that wording, and do not report component values as
  measured human values.

### 9. Money floats for long stretches at every level (current, medium-low)

Current runs, seconds spent at 200 MP or more in the first 180 s: Easy 53 to 133, Normal 44 to 81, Hard 28 to 83. Seats
field 6 to 8 units against a population cap of 12, so this is not the cap. The plan buys at most one unit per production
visit (`ai.js:425`) and sometimes saves for its `want` unit. Only 1 or 2 purchases happen in the first 45 s, so the opening
measure ("first five purchases") mostly measures moves. The brief wants it to "sometimes" float money; holding two rifles'
worth for a minute in most matches reads more as a weak bot than as a busy person. I have not proven a bug here. Check
whether saving for an unaffordable `want` is the main cause before changing anything.

### 10. Enemy minimap dots carry stable unit ids (current, low, latent information cheat)

`perceive` builds every minimap dot with the unit's real id (`ai-perception.js:77`). A person cannot tell which red dot is
which once a unit leaves the screen. `enqueueOne` lets an `attack` on a remembered enemy go through the minimap by
matching that id (`ai-hands.js`, the `attack` branch of `enqueueOne`), which would aim at the current position of that
exact unit. The contact clocks in attention are also keyed by these ids. In the 9 current matches plus the 3 historical
matches, 0 of 41 attack commands went through the minimap, so this did not occur, but it is reachable by construction.

Minimal fair fix: give enemy dots per-snapshot anonymous ids in the AI view, and resolve a minimap attack only by the
clicked position, as the client does.

### 11. Alert jumps reach older alerts for one click (current, low)

Attention considers alerts up to 240 ticks (12 s) old (`ai-attention.js:28`) and jumps to whichever ranks highest with a
single click at a fixed UI spot (`ai-hands.js:302`). In the client an alert line shows for about 6 s, Space goes to the
newest one, and older ones need Alert history (Alt+H) plus a click (`client/alerts.js:4-5`, `client/keys.js:20-23`).
Minimal fair fix: one-input jumps only to the newest visible alert; older ones cost the history inputs.

### 12. Unit clicks never miss and use the queue-time position (current, low)

Selection clicks on units carry no endpoint noise (`unitTarget: true` at `ai-hands.js:320`) and aim at the unit's position
when the job was queued. At fire time the selection is set by id from units that are on screen
(`ai-hands.js:510-512`), not by hit-testing where the click landed. A unit that walked 5 m during the reaction pause is
still selected by a click on empty ground. Minimal fair fix: hit-test the clicked pixel against current screen positions
at fire time, so a click on a moving unit can miss.

### 13. Many camera jumps are followed by another jump with no action (current, low)

Roughly 40 to 50% of camera moves are followed by another camera move with no input in between (current Normal: 9 to 24
per seat in 180 s). People glance around, so some of this is fine. Part of it comes from fights being keyed by 40 m grid
bins (`ai-attention.js:50`): one fight on a bin edge becomes two concerns, and the recency penalty lasts only 45 ticks
(`ai-attention.js:113`), so the camera flicks between neighbours, as in the historical seed 1 slot 0 at 33 to 39 s.
Minimal fair fix: cluster contacts by distance instead of grid cells, and give a just-visited fight a longer recency
penalty.

## Historical issues checked against current code

I did not count these as current findings.

- Proposed-operation false acknowledgement: deferred assaults now store `proposedOrder` and acknowledge only on an accepted
  send (`ai-mind.js:277-279`, `ai-commander.js:68-74`).
- Formation batching: deferred assault orders are batched per role and clicked as one anchor (`ai-mind.js:283-301`).
- Idle urgency that never aged: urgency now counts from the later of "still since" and the last visit
  (`ai-attention.js:84`).
- Permanent guards on zero-VP points: holding now requires `p.vp > 0` in human mode (`ai.js`, the `holding` check).
- Lone base guard: base advances need at least two ready friends nearby (`baseReady` in `ai.js`;
  `test-engine-ai-commitment.js` passes).
- Pre-flight bad assault: a deferred assault that is untenable on its first look is rejected and the point marked failed
  (`ai-mind.js:240-249`).
- Empty-cycle delay: `noWorkUntil` after a cycle with no queued work (`ai-commander.js:143`).
- In V4 loss7, Hard held "push point 2" from 210 s to 550 s while losing points 0, 1 and 4, with 5 to 9 of its 9 to 11
  units counted idle in most snapshots. The 100 s assault lifetime, the pre-flight rejection and the idle-aging fix all
  bear on this, but I did not re-run Hard against the old Easy, so whether it still happens is unverified. Hard against
  old Easy remains open, as stated.

## Changed during this review

- `cameraFootprint` had a sign error that drew the near and far edges swapped; it was fixed at about 06:19
  (`ai-perception.js:54`). I checked the new formula against `onScreen` by brute force: the footprint is 159.9 m wide and
  matches the on-screen region on flat ground. The tool's 160 m "one screen" constant already matched the corrected
  formula, so cross-map numbers are unaffected. The overlay in the recording predates the fix.
- The commander now passes `plan()` an allow-listed options object instead of spreading all `opts`
  (`ai-commander.js:117`). I found nothing in `plan()` that read a leaked field, so this is a safety improvement, not a
  fixed leak.
- The Hands agent finished the pixel-space pointer: Fitts travel in CSS pixels, noisy endpoints projected back to ground,
  and a pointer path for the overlay. At 06:15 the file briefly called undefined `scatter` and `pointerDuration`; that was
  an in-progress edit and is resolved. Ctrl+right-click legality was still being changed; I did not review it.

## Things that work and should be kept

- Camera locality holds: orders go to on-screen units, an exact recalled group, or a minimap click, and the hands throw if
  a command fires without a physical selection (`ai-hands.js`, `advanceHands`).
- Zero cross-map pairs within 1 s and never more than one command per tick, across the 12 matches with tool metrics (3 historical, 9 current).
- Off-screen alert reaction lands inside the table at every level on the current source.
- No `Math.random` in `shared/ai*.js`, `human-input.js`, `alert-events.js` or `formation.js`; one seeded stream per seat.
- Spectator diagnostics go only to watchers, and the human recorder is opt-in on both sides and never relayed
  (`server.js` diff; `test-engine-ai-overlay.js` passes).
- DESIGN.md and the research note label every timing number as an authored, provisional default. Keep that.

## Minimal fair fixes, in order

1. One movement intent per unit per cycle, plus a per-unit commitment window for re-targeting (finding 1).
2. Back off repeated accepted aimed abilities that never fire (finding 2).
3. Redefine the on-screen reaction event and measure to the first non-camera answering input, with censoring (finding 3).
4. Let emergencies drop queued, unstarted jobs (finding 4).
5. Prune and reuse control groups, recall by containment, bind only for operations (finding 5).
6. Skewed timing distributions; full reaction only for the first answer in a visit (finding 6).
7. Persistent estimate error per sighting (finding 7).
8. Either make Hard reach its APM band and implement concern juggling, or strike those table rows with a reason; turn
   `L.memory` into a per-level decay or document it as judgement (finding 8).

Findings 9 to 13 can wait for round 2 unless they turn out to be cheap.

For round 2, please provide a recording with the play area visible, the same three seeds re-run after the fixes, and one
longer Hard match (at least 8 minutes) so the group and stale-plan behaviour can be checked over a full game.
