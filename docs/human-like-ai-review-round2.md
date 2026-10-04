# Human-like AI commander: independent review, round 2

Reviewer: Claude Opus 5.5, acting as review sub-agent. I did not build this code. I changed no production file, test or
spec; this document is my only output in the repository. Scratch scripts and frame extracts are in `/tmp/review-r2/`.
Written 2026-10-04, 07:10 to 07:30 UTC.

## Verdicts

**Release readiness: NOT READY.** The evidence covers 3 seeds per level against the 120-match gate, several table gates
are unmet, the balance and head-to-head campaigns are unfinished, and the full test run started before the code it
should certify (see "Provenance limits"). Nothing below should be read as approval to ship.

**Gameplay verdict, separate from readiness: much closer, still not "a real player" at Hard.** The round 1 fixes worked
where I could check them. Grenades are no longer re-clicked, groups are recalled more often than they are bound, minimap
dots are anonymous, Space only reaches the newest alert, and Normal's on-screen first input (0.75 s median) sits inside
its band. In the opening film the three starting squads leave the HQ one after another, about 1 to 2 s apart, which
reads as a person.

What an attentive opponent would still notice, in order of how visible it is:

1. Hard still marches the same squads back and forth between two points (12 A-to-B-to-A reversals in 9 Hard seats).
2. Every plane the commander buys stays parked forever, and its camera keeps jumping to the map corner to look at it.
3. It visits its base again and again and does not buy, while holding 200+ MP for long stretches.
4. It sends two squads to the same spot with two separate selections and two separate clicks.

At Normal a casual player would mostly accept it. At Hard, a player who watches the minimap or the replay will see
dithering and stranded planes, which read as a machine.

## What I reviewed

Source read in full on the current tree: `shared/ai-commander.js`, `ai-attention.js`, `ai-hands.js`, `ai-perception.js`,
`ai-persona.js`, the human-mode parts of `shared/ai.js` (`plan()` lines 236-620), and `client/ai-overlay.js`. I also read
`client/main.js:536-552`, `client/hud.js:563-582`, `client/selection.js:8` and the aircraft code in `shared/sim.js`.

Evidence analysed: `/tmp/human-ai-review-v8-{easy,normal,hard,hard-long}.json`, `-analysis.json`, `-summary.json`, both
films, both contact sheets, the screenshot, and `/tmp/human-final-proof/timeline.json`. My scripts:
`/tmp/review-r2/stats.js` (reversals, repeats, gaps, groups), `concern.js` (does the command serve its concern),
`orphans.js` (wasted selections, split orders), `tl.js` (per-seat timeline). I ran no simulation, test suite or campaign.

### Provenance limits

- **Three different `shared/ai-perception.js` versions.** The Easy and Normal runs record checkpoint `287acf...`
  (perception SHA-256 `8c5ce4...`, 07:02:52). The Hard and long Hard runs record `c0d1f2...` (perception `546a62...`,
  07:04:11). The current file is `51e61a...`, modified at 07:07:24, after every v8 run. All other 30 hashed files match
  the current tree. I found no archived copy of either older perception file, so I cannot verify the claim that they
  differ only by a comment and the road/trench cut. That cut changes `onScreen()`, so it can change what is on screen
  and therefore decisions. No evidence file was produced by the current perception code.
- **Easy/Normal and Hard are not comparable at the source level.** They ran on different perception versions.
- **The full `node test.js` run does not cover the v8 code.** Process 881528 started at 07:00:00 and statically imports
  `shared/ai.js`, so it loaded `ai-hands.js` from before its 07:01:34 edit and the pre-07:07 perception. At 07:16 its log
  had reached the fog proofs and had not finished.
- **Films.** The likely film server (PID 887286) started at 07:03:29, between the two perception checkpoints, so I cannot
  tell which perception version it ran. A second server from 06:26 runs older code.
- **Verified:** the long Hard seed 1 input logs for all three seats are identical to the short Hard seed 1 logs over the
  first 180 s (117, 148 and 145 inputs, byte-identical). That supports determinism for that seed only.

## Status of round 1 findings

| # | Round 1 finding | Status in v8 | Evidence |
|---|---|---|---|
| 1 | Squads sent one way and back | **Partly fixed; still present at Hard** | Finding A below |
| 2 | Same aimed ability re-clicked | **Fixed in these logs** | 0 same-spot repeats within 30 s in 100 aimed abilities across all runs |
| 3 | Wrong reaction metric | **Definition fixed; population not evaluable** | Section "Measurement" below |
| 4 | Emergencies wait behind queued work | **Fixed, but over-triggers** | Finding D |
| 5 | Groups bound, never used | **Fixed** | Sets/recalls: Easy 10/11, Normal 10/13, Hard 13/32, long Hard 38/60 |
| 6 | Uniform delays, full reaction every job | **Fixed, small residue** | `skewedDelay` (`ai-hands.js:118-127`); truncation noted in Finding K |
| 7 | Estimates rerolled | **Fixed** | `estimateSightings` keeps one error per sighting until reacquired (`ai-persona.js:30-45`) |
| 8 | Difficulty not skill-only; Hard low APM | **Capabilities fixed; APM unmet** | `ai.js:262-264` gives every level memory, adaptive and guard; APM in Finding E |
| 9 | Money floats | **Still present, cause unproven** | Finding E and L |
| 10 | Enemy minimap ids | **Fixed** | Enemy dots carry no id (`ai-perception.js:94`); only the click dispatcher resolves (`ai-commander.js:61-64`) |
| 11 | Old alerts reached by one key | **Fixed** | `newestAlert` uses a 6 s window (`ai-hands.js:327-331`) |
| 12 | Unit clicks never miss | **Fixed** | Fire-time pixel hit test (`ai-hands.js:217-223`, `644-655`) |
| 13 | Camera flicks with no action | **Improved** | Camera followed by camera: 32% (short runs) and 23% (long) against 40-50% in round 1; residue in Finding B |

## Remaining bot tells, most severe first

### A. Hard still turns squads back and forth (high)

Reproduce: `node /tmp/review-r2/stats.js /tmp/human-ai-review-v8-{easy,normal,hard}.json` and
`node /tmp/review-r2/tl.js /tmp/human-ai-review-v8-hard-long.json 1 0 360 400`.

A-to-B-to-A reversals (B more than 25 m from A, return within 30 s): Easy 1, Normal 3, **Hard 12** in 9 seats each over
180 s, and 6 in the long Hard match. Example, long Hard seed 1 slot 0, group of units 15 and 35:

- 366.35 s `move` to (73.6, 89.8), concern screen-damage
- 371.15 s `amove` to (80.9, 121.0), screen-damage
- 387.15 s `amove` to (81.0, 80.8), alert
- 393.90 s `amove` to (81.0, 121.0), screen-contact

Four orders in 27.5 s between points 1 and 0, 40 m apart. Other cases: Hard seed 2 slot 0 unit 3 at 80.2, 84.2 and 88.3 s;
Normal seed 2 slot 1 units 6 and 17 at 132.3, 135.3 and 149.9 s.

Causes in the source:

- The commitment window is shortest at Hard: 240/180/120 ticks (`ai-commander.js:181`). The 387 to 393.9 s pair is
  6.75 s apart, just past Hard's 6 s.
- Any `screen-damage` concern bypasses commitment (`ai-commander.js:177`). With this game's large screen, damage events
  arrive constantly during fights, so the bypass applies to most fight cycles, including orders to units that are not
  the damaged unit.
- The rule compares only the unit's distance to its last target, not whether the new target is a place the unit was
  just sent away from.

Minimal fair fix: do not make Hard's window shorter than Normal's (better judgement should mean less dithering, not
more). Block a new movement order that returns a unit to within about 15 m of a target it left in the last 30 s, unless
it is a retreat or a base alert. Apply the danger bypass only to the damaged unit and units within a short radius of it.

### B. Parked aircraft can never be ordered, and the camera loops to the map corner (high, new bug)

Reproduce: `node /tmp/review-r2/tl.js /tmp/human-ai-review-v8-hard-long.json 1 0 255 265`, and search the long
Hard log for commands containing unit 42 or 66.

- Long Hard seed 1, slot 0 bought an attacker at 198.8 s. The idle concern `idle:42` appears from 228.8 s. Unit 42
  received **zero commands in the remaining 281 s**. Slot 2 bought an attacker at 331.8 s; unit 66 received zero commands
  in 148 s. Two of two purchased planes were stranded. (Unit 42 is very likely the attacker from the timing; the log
  does not map purchases to ids.)
- Slot 0 spent 12 minimap clicks on the map edge for `idle:42`, all at x = 159.0, including two triples within 1.5 s:
  259.20, 260.05, 260.80 s and 382.30, 383.05, 383.80 s, with no other input between them.

Causes:

- The hands drop own units carrying snapshot flag 512, "plane at base" (`ai-hands.js:157-160`; flag defined at
  `sim.js:4576`, documented at `sim.js:4727`). A parked plane can therefore never be selected by click, box or group.
  The client selects a parked plane through the top-right air panel button (`client/hud.js:563-575`). The hands have no
  equivalent input.
- The parked plane sits off-map past the HQ (`sim.js:1369-1375`, `CFG.air.offmap` = 40). For spawn (139, 115) that is
  about (173, 135). The camera clamps to x = 159, so the commander's "camera more than 12 m from target" test
  (`ai-commander.js:137`) is always true and every reselection of the concern costs another minimap click.
- The parked plane counts as an unnoticed idle unit (`ai-attention.js:136`), so its urgency keeps growing.

The round 1 response "avoid another aircraft until the first known plane has a mission" does not help, because the first
plane never gets one. Every attacker or fighter purchase is wasted MP and repeated wasted attention.

Minimal fair fix: add an air-panel selection input (UI click at the panel position, then right-click a destination),
which is exactly what a player does. Do not raise an idle camera concern for flag-512 planes; treat them as a production
panel task. Treat a camera target as reached once it is on screen or the camera is clamped at the map edge.

### C. Orders attributed to a concern often do not serve it (medium-high)

Reproduce: `node /tmp/review-r2/concern.js /tmp/human-ai-review-v8-{easy,normal,hard,hard-long}.json`.

- Expansion visits: of `move`/`amove` commands issued under `point:i`, the share sent more than 20 m from point i is
  12/15 Easy, 11/15 Normal, 22/27 Hard and 15/17 long Hard. Example, Hard seed 2 slot 0, 82.40 s: concern `point:4`,
  point 4 is at (41, 23), the camera is at that seat's base (25, 119), and the order is an attack-move to point 0 at
  (81, 81).
- Idle visits: the idle unit itself is in a command in only 14/45 Easy, 8/34 Normal, 10/41 Hard and 8/64 long Hard idle
  visits. Other on-screen units get orders instead (for example long Hard 172.70 s, concern `idle:2`, an ability for
  unit 15; 179.35 s, `idle:34`, a dig for unit 33).
- Production visits: 31/54 Easy, 49/71 Normal and 73/100 Hard commands under `production` are moves, not purchases.

Causes: for expansion the camera goes to the free squad nearest the point (`cameraTarget`, `ai-commander.js:18-26`),
not to the point. `plan()` uses the concern only to centre its 48 m focus for combat and support (`ai.js:326-327`) and
otherwise plans for whatever is near the camera. The commander filters intents only by command type per concern kind
(`ai-commander.js:169-171`).

Why it matters: the attention model looks human in the log, but the decisions behind it are not tied to what the seat
went to look at. A player who reads the overlay label sees "point" while the squad walks to a different point. It also
inflates idle revisits, since the idle unit often stays idle.

Minimal fair fix: for expansion, pass the point index into the point choice (a strong bias toward point i for this
visit) or relabel the visit by what plan actually did. For idle visits, keep only intents that include the idle unit,
or units within a small radius of it, plus economy at the base. Add the alignment numbers above to `tools/ai-humanity.mjs`.

### D. The emergency interrupt fires constantly and treats known enemies as new (medium)

- Emergency-kind events per seat-minute: Easy 15.9, Normal 23.6, Hard 28.0, long Hard 37.0. Each one clears the queue
  and cuts the active job after its current input (`ai-commander.js:74-90`).
- 27%, 33%, 35% and 38% of `screen-contact` events are the same enemy re-entering the screen within 10 s. Example: Hard
  seed 1 slot 0, enemy 4 creates `screen:270:1` and again `screen:300:2` 1.5 s later.
- Cause: "new contact" compares only with the previous frame's screen set (`ai-perception.js:98-99`, `125`), so a camera
  move or a unit stepping over the screen edge creates a fresh stimulus.
- Effect: 15-19% of selections are never followed by an order before the next selection or camera move (Easy 37/192,
  Normal 48/283, Hard 62/418, long 97/543). It also inflates the unanswered stimulus count discussed below.

Minimal fair fix: emit `screen-contact` only for an enemy not seen on screen in roughly the last 10 s (screen memory
already exists in `state.screenMemory`). Interrupt the queue only when the new event outranks the concern being worked.

### E. Hard has work it does not do; its APM gap is a throughput limit (medium; gate unmet)

Hard's physical-input APM median is 49.3 over 60 s windows (long Hard 70.4) against the 80-120 floor. This is not a lack
of work. In the same logs:

- 54-70% of on-screen stimuli are never answered (Hard 293/741 answered; long Hard 400/864).
- MP floats: mean banked MP is Easy 240, Normal 174, Hard 153, long Hard 184. Long Hard slot 0 held 200+ MP for 199 of
  480 s while making 35 production visits and 5 purchases; slot 2 held 200+ for 228 s. No purchase was rejected for
  slot 0, so the plan chose not to spend; saving for an unaffordable `want` is the likely cause but I did not prove it.
- Idle episodes last a median of 6-7 s at Hard.
- Actions per attention cycle have a median of 2 at every level. Thompson et al. 2013 (Supporting Information, Figures
  S2, S3) report a mean of 5.27 actions per perception-action cycle and 18.4 cycles per minute across 3,360 StarCraft II
  players.

Structural limits in the code: at most 3 intents per cycle, 2 at Easy (`ai-commander.js:200`); the commander waits until
the hands are idle (`ai-commander.js:119`); every cycle picks a new concern, usually with a camera move; empty cycles add
`noWorkUntil` (`ai-commander.js:207`); one purchase per plan call (`ai.js:428`).

Fair fixes that raise useful input rather than filler:

1. Let a visit continue: when the queue drains and the same concern still has on-screen work, plan again on the same
   screen without a new concern choice or camera move. Scale the per-visit intent cap with skill.
2. On production visits with banked MP and free population, buy more than one unit, as a person queues two at once.
3. Fix B (stranded planes) and C (idle visits that do not fix the idle unit), which waste attention now.
4. Fix D, so started work is not thrown away by repeat contacts.

Do not meet the floor with group binds, extra camera jumps or repeated clicks.

### F. Hard reacts more slowly on screen than Normal (medium)

Pooled completed on-screen first non-camera input: Easy 1.50 s, Normal 0.75 s, **Hard 1.05 s**, long Hard 0.60 s. Skill
order is inverted between Normal and Hard. The stage medians show where: event to queue is 0.35 / 0.20 / 0.40 / 0.20 s,
queue to motor start 0.05 s, first motor 0.50 / 0.35 / 0.30 / 0.25 s.

The emergency deliberation is a fixed 4 or 6 ticks regardless of level (`ai-commander.js:89`), and an emergency during
an active, non-reacting job waits for that job's current input (`ai-commander.js:81`, `ai-hands.js:84-90`). Hard has
more jobs in flight, so it waits more often. I did not isolate this fully. The same seed gives 1.05 s over 180 s and
0.60 s over 480 s, so the median also depends on match phase; 3 seeds cannot settle it.

Minimal fair fix: scale emergency deliberation with skill, and let a higher-ranked emergency cancel an active job between
inputs rather than after the whole current gesture. Report per-seat medians with intervals, not one pooled number.

### G. The AI's detailed screen is larger than a player's default view (medium, fidelity)

`HUMAN_CAMERA.distance` is 85 (`ai-perception.js:6`), taken from the pre-match literal in `client/main.js:1248`. At match
start the client sets `cam.dist = 60` and turns the camera to face the map centre (`client/main.js:546-549`). The ground
footprint scales with distance, so the AI's full-detail area is about (85/60)^2, roughly 2 times, the area of a fresh
player view: about 160 m across the far edge and 87 m deep on a 160 m map, against about 113 m by 61 m. A player can zoom
out with the wheel up to the whole-map fit (`client/camera.js:207`), so 85 is reachable for a human and this is not an
impossible advantage. It is still not "the default client view at default zoom" that the brief specifies, and it
increases screen detail, screen-contact counts and on-screen order range. In the films the dashed AI camera outlines are
much larger than the spectator's view outline, which is consistent with this.

Minimal fair fix: use 60, the actual match-start zoom, or record in DESIGN.md that the AI plays zoomed out at 85 and why.
Either choice must be made before the campaigns, because it changes every perception number.

### H. Same destination, separate selections (low-medium)

Consecutive movement orders of the same type to targets within 8 m, for different units, within 2 s: Easy 3, Normal 5,
**Hard 25**, long Hard 30. Example, Hard seed 2 slot 0: 86.25 s select unit 16, `amove` to (84.9, 81.1); 87.00 s select
unit 2, `amove` to (80.9, 81.1). A player box-selects both and clicks once. Cause: plan emits these as separate intents
(the assault and point loops push per-unit rows), and the hands merge orders only inside one command
(`ai-hands.js:301-317`). Fix: merge intents of the same type with targets within about 10 m before enqueueing.

### I. The opening starts at almost the same moment every match (low-medium)

First order across 9 seats: Easy 6.25 to 6.7 s, Normal 4.35 to 5.0 s, Hard 2.9 to 3.2 s. All are inside the table's
ranges, but each level uses a sliver of its range. The opening gate is `between(lo, hi - motorRoom)`
(`ai-hands.js:39-40`), which is 4.0-4.6 s Easy, 3.0-3.6 s Normal and 2.0-2.2 s Hard. Over several matches a player would
see the enemy start at the same instant. Fix: sample over the whole range and let the motor time push the click later.

### J. Easy's burst limit is a visible wall (low)

Peak physical APM over 10 s is exactly 60 in all 9 Easy seats, the cap from `affordableInput` (`ai-hands.js:93-97`).
Normal's maximum is exactly 120, its cap. A histogram of 10 s windows shows a hard ceiling. Fix: a soft limit, for
example slowing inputs as the window fills, or a per-match sampled ceiling below the cap.

### K. Delay distributions have no right tail (low)

`skewedDelay` rejects samples above the authored range's upper end (`ai-hands.js:118-127`), so a reaction component never
exceeds 1.4 / 0.8 / 0.45 s, and Easy keys always take 0.15-0.25 s. The table gives median ranges, not bounds. Human
response times have long right tails. Fix: an ex-Gaussian or untruncated lognormal whose median is in the range, keeping
the 0.2 s floor.

### L. Money floats at every level (low-medium, cause unproven)

See the numbers in E. Holding two rifles' worth of MP for most of a match reads as a weak bot rather than a busy person.
Instrument the production visit: log the chosen `buy`, its price and the reason nothing was submitted, then decide.

## Measurement problems that block the reaction gates

- **The population median is undefined.** On-screen stimuli are answered at 30% (Easy), 34% (Normal), 40% (Hard) and 46%
  (long Hard). With more than half the events right-censored, a Kaplan-Meier median is not reached. The reported medians
  are conditional on answering. The research note says this too, and the tool definition says unanswered counts are not
  an error rate. That is true, but then the gate needs a rule, chosen before looking at results, for which stimuli
  require a response. Without it the on-screen gate cannot be evaluated over the population.
- **Finding D inflates the stimulus population** with repeat contacts, which lowers the answer fraction mechanically.
- **Off-screen alerts rarely get a command.** First action medians are inside the bands (tool-reported 4.06 / 1.98 / 1.10 s),
  but only 1 of 46 Easy, 4 of 49 Normal and a handful of Hard off-screen alerts reach an attempted command. Most alert
  responses are a camera jump followed by work on something else.

## The original lower bounds: scientific assessment

This section is my interpretation. It does not change the acceptance gates. Under the brief, a revision belongs in
Phase 0, with primary sources, before the campaigns, and it needs Julio's decision. The gates below remain **unmet**.

**Hard on-screen reaction, 0.3-0.45 s to the first non-camera input.** This conflicts with the brief's own physical model.

- Woods et al. 2015 (in the research note): mean visual simple reaction 213-231 ms with no pointer travel; mean
  two-button choice reaction 472-550 ms.
- Thompson et al. 2013, Supporting Information Figure S1 (I opened the article): mean first-action latency after a new
  point of view is **719.94 ms (SD 217.3)** across all 3,360 players in seven leagues, professionals included.
- In the v8 logs 71% of Hard first answering inputs are unit clicks that need pointer travel (184 `select-click` and 24
  `select-box` of 293), on top of a choice.

A median of 0.3-0.45 s for a choice plus an aimed click is faster than the published choice means without any pointer
movement, and well below the nearest RTS measure. With the 0.2 s floor and a full Fitts movement it is not reachable
except by pre-aimed keys. Two honest options for Julio, both prospective: (a) keep the numbers but measure to response
onset (the start of the first motor gesture), or (b) revise the Hard band using Thompson's latency data and record it as
a Phase 0 research revision. Normal's 0.5-0.8 s and Easy's 0.9-1.4 s are not contradicted by these sources. Do not
choose between them by looking at which one the bot passes.

**APM floors, Normal 40-70 and Hard 80-120.** These have no primary support for this game and none against it. Thompson
reports a mean of **117.05 APM (SD 51.95)** for StarCraft II players, a game with workers, buildings and armies far
larger than this game's 12-unit population cap (`sim.js:40`). The research note found no primary Company of Heroes
dataset. Lower workload per minute in a 12-unit tactics game is plausible, but plausibility does not license a lower
number. Because Hard visibly leaves work undone (Finding E), the current shortfall is a throughput limit in the
commander, not evidence that the floor is wrong. Fix throughput first. If useful work is exhausted and the floor is still
missed, use the spec's strike-through rule with a reason, Julio's sign-off and local recordings (Phase 6), not the bot's
output.

**First order after match start.** All levels are inside their ranges; Finding I is about variety, not the bound.

## Visual evidence and its limits

- Opening film (28 s, 1280x720): the play area is visible; the Controls sheet is closed. A scoreboard panel covers the top
  centre in every frame. The spectator camera stays on AI 1's HQ. From 5 to 12 s the three starting squads leave one at a
  time, roughly 1 to 2 s apart, on different routes (`/tmp/review-r2/open_zoom.jpg`). I saw no tell in that window.
- Minimap overlay (`/tmp/review-r2/mm_open10.png`, `mm_open_sheet.png`): three dashed AI camera outlines move separately
  between bases and points. They are much larger than the spectator's solid outline (see G). The ghost cursor and click
  rings are drawn on the minimap only (`client/ai-overlay.js:42-70`), so neither film can show in-world click markers.
- Fight film (36 s): the first 22 s are a high, wide view where units are a few pixels tall. From 22 s the view is closer,
  but the fight sits at the right edge under the Alert history panel and the minimap (`/tmp/review-r2/fight_close.jpg`).
  I could see explosions, smoke and a squad on a point, but I could not judge micro, focus fire or order timing from it.
  For the next round, a clip centred on a fight with the panels collapsed would let a reviewer judge the tactics by eye.
- Browser timeline: first world clicks at ticks 83, 87 and 89 (4.15 to 4.45 s), consistent with the Normal opening.

## Successes I checked myself

- One command per tick at most and zero cross-map pairs within 1 s, in all 30 seat runs (tool summary).
- No same-spot aimed ability repeats (my count over 100 aimed abilities).
- Group recalls outnumber group binds at every level; long Hard 60 recalls to 38 binds.
- Enemy dots are anonymous; minimap attacks resolve only by clicked position at dispatch.
- Space jumps only to an alert under 6 s old; older ones fall back to a minimap click.
- Selection clicks are hit-tested at fire time against current positions.
- Every level gets the same memory, adaptive and guard capabilities in human mode (`ai.js:262-264`).
- Fight concerns use persistent distance clusters (`ai-attention.js:19-48`), and camera-to-camera sequences dropped.
- Combat stimulus orders mostly involve nearby units: only 3-11% come from units more than 48 m from the stimulus.
- The long Hard run's first 180 s are identical to the short run for all three seats.

## Minimal fair fixes, in order

1. Parked planes: add the air-panel selection input, stop raising camera concerns for them, and accept a clamped camera
   as arrived (B).
2. Hard dithering: no shorter commitment at Hard, block returns to a just-left target, narrow the danger bypass (A).
3. Tie visits to their concern: point bias for expansion, idle-unit intents for idle visits, alignment metrics (C).
4. Repeat contacts: 10 s screen memory for `screen-contact`, interrupt only on higher rank (D).
5. Throughput: continue a visit while on-screen work remains, buy more than one unit when MP floats (E, L).
6. Skill-scaled emergency deliberation and earlier cancellation of lower-ranked jobs (F).
7. Decide the camera distance, 60 or a documented 85, before the campaigns (G).
8. Merge same-destination intents; spread the opening over its range; soften the burst wall; add right tails (H to K).
9. Before the next campaign: freeze perception, hands and tool, record one checkpoint for all levels, restart the full
   test suite after the last edit, and fix the "needs a response" rule for stimuli in writing.

Release still requires the full 120-match humanity campaign, the 60/30 balance campaigns, new Hard against old Easy,
Normal and Hard, the benchmark, a passing full test run on the frozen tree, and Julio's decision on the Hard reaction
band and APM floors.
