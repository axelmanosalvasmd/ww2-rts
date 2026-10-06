# Human-like AI commander: brief and checklist

Started 2026-10-04 for a GPT-6.1 Sol goal thread. Tick a box only after you have verified it, and write the evidence
next to it (command and output, number, `file:line`, screenshot path). If an item turns out to be wrong for this game,
do not silently skip it: strike it through and write why.

Julio initially moved the numerical targets to [issue #48](https://github.com/axelmanosalvasmd/ww2-rts/issues/48)
on 2026-10-05. His later request to finish both PR #49 and issue #48 restores those targets as required gates.
The original limits, complete populations and failed historical evidence remain unchanged. Core correctness,
fairness, the full test suite, independent review, inspected proof and a verified merge also remain required.

## Why

Julio's complaint, translated from Spanish: the enemy AI runs a script. It reads the game and never has to think the
way a person does before deciding, so it is always ahead. At the start of a match he is still working out what to do
("they sent out one tank, then two tanks, then a squad: what should I do?"), while the AI already has everything it
needs and has moved it exactly where it should go, at once. He wants the enemy to decide like a human brain that has to
press keys and click: look somewhere, select, right-click, one thing after another. The bar: after playing against the
new AI he should think "wow, this feels like a real player, not a machine that always has the advantage".

Being human is the goal, not being weak. A human-like Hard AI should still be a good player. It wins by better
decisions, not by seeing everything at once and acting everywhere in the same instant.

## What already existed before implementation (do not rebuild it)

The following source and schedule descriptions refer to the preimplementation audit at `fc60be9`. Current player-seat
commanders advance every tick from the latest delivered observation; their hands and attention schedule the work.

- Fog-fair information (`shared/ai-view.js`, DESIGN.md "AI information and commands (2026-10-01)"). An AI seat sees
  only what a human in that seat receives and acts only through `command()`. `think(g, slot, opts)` builds or takes a
  view and calls `plan()`, which has no reference to the authoritative game. Keep this boundary and every proof of it.
- One commander per seat with private memory (`shared/ai-mind.js`, DESIGN.md "AI decisions (2026-10-02)"): a `notice`
  delay before acting on a new contact, a `hands` cap on march orders per look, a `casts` cap on abilities, a `commit`
  time on a chosen objective, and learning from its own losses.
- Difficulty table `AI_LEVELS` in `shared/ai.js` (around line 219). The look period `every` is 120 / 40 / 20 ticks
  (Easy / Normal / Hard) at 20 Hz, scheduled in `server.js` (around line 610) and in `tools/ai-balance.mjs`.
- Human client references for what a person can do and see: `client/main.js` `formation()` and `client/orders.js`
  (what one right-click sends), `shared/formation.js`, `client/keys.js` (control groups, hotkeys),
  `client/camera.js` (view size, pan speed), `client/map-view.js` (minimap), `client/alerts.js` (alerts built only from
  what the server sends; Space jumps to the newest).

## Original complaint and preimplementation hypotheses

The audit below verifies and qualifies these original hypotheses. They are not claims about the current implementation.

Verify each item against the code, add any you find, and record `file:line` for each in the audit (Phase 0).

1. A look issues all its orders in the same tick: purchases, the support call, abilities, 4 to 8 march orders,
   retreats, stances and Engineer jobs, anywhere on the map. A person does one action at a time, a few hundred
   milliseconds apart, with the camera in one place.
2. The first look acts at once. There is no moment of reading the map at the start, and no pause after a handover.
3. It perceives every visible unit everywhere at once, with exact type and health. A person sees that detail only on
   screen. Elsewhere the minimap shows dots, and alerts say that something happened somewhere.
4. Orders go to exact computed spots (the best cover cell, a point's exact centre, a separate spot per unit) instead of
   the scatter of a mouse click and the formation one right-click produces.
5. Micro runs in every fight at once (hurt-squad retreats, grenades, Hard's focus fire), and production never slips
   while it fights.
6. Money is spent the look it becomes affordable.
7. Every match plays the same script: the same build order and the same first moves for the same situation.
8. It never forgets a unit, never leaves a squad idle unnoticed, never misjudges a fight and never hesitates.

## The model to build: perceive, attend, decide, act

A person playing an RTS works in perception-action cycles: they look at one part of the battlefield, take a few
actions there, then move their view somewhere else (Thompson, Blair, Chen and Henrey, "Video game telemetry as a
critical tool in the study of complex skill learning", PLOS ONE 2013, measured this in StarCraft 2). Build the AI as the
same loop, with human limits at each stage.

### Phase 0: audit, research, baseline

- [x] Audit: list every superhuman behaviour (the eight above and any others) with `file:line` in
      `docs/human-like-ai-audit.md`.
      Evidence: audited preimplementation revision `fc60be9`; the audit records all eight claims, qualifications,
      selection costs, own-unit detail, aircraft/support bypasses and caller differences with exact source lines.
- [x] Research: write `docs/research/human-like-rts-ai.md` from primary sources you open yourself (papers, official
      pages), with links. Cover at least: perception-action cycles and first-action latency in RTS play (Thompson et
      al. 2013), the camera interface, action delay and APM limits used for AlphaStar (Vinyals et al., Nature 2019),
      human reaction times for simple and choice tasks, Fitts' law for pointer time and error, and what is known about
      APM in slower tactics RTS games like Company of Heroes. Use the findings to confirm or revise every number in the
      difficulty table below, and cite the source next to each number you keep.
      Evidence: `docs/research/human-like-rts-ai.md:43` records an explicit retain decision and adjacent primary
      anchor for every original difficulty value and documented motor coefficient. The opened Thompson supplement,
      AlphaStar paper, simple/choice studies and Fitts/MacKenzie papers support mechanisms and task scales, not
      empirical confirmation of this game's ranges. Original numeric gates remain unchanged. Matching local human
      and Company of Heroes calibration is a documented evidence gap, not a claimed published measurement.
- [x] Baseline on current master behaviour with the tool from Phase 5 (or a first version of it): commands per tick,
      APM, time to the first order, reaction times, cross-map orders within one second, opening variety. Save the JSON
      next to the "after" numbers so the PR shows both.
      Evidence: `docs/ai-humanity-before.json`, 120 matches (20 Conquest and 10 Classic/World seeds per difficulty),
      180 seconds each; `tools/legacy-ai/provenance.json` freezes master `5293ddb` with import-path-only changes.
      Conquest command APM medians 10.667/25.667/36.667 and maximum commands per tick 8/7/6. Physical input and causal
      reaction metrics are explicitly unknown for the old commander. Full baseline definitions and timing caveats
      remain in the JSON.

### Phase 1: perceive

- [x] Perception tiers that match what the human client shows. Check the client code and write down exactly what
      each tier exposes:
  - Screen: inside the seat's virtual camera (the area the default client view covers at default zoom on a
    1920x1080 window; derive it from `client/camera.js`). Full detail, as the client shows it on screen.
  - Minimap: everything the team can see, but only what the minimap draws (position and side, plus anything else it
    really draws). No health, no exact type unless the minimap shows it.
  - Memory: details seen on screen earlier, fading with time.
  - Alerts: the same alert events a person gets. Prefer moving the alert logic from `client/alerts.js` into `shared/`
    so the client and the AI derive alerts the same way from the same snapshots.
  Evidence: `shared/ai-perception.js:6`, `:84`, `:131` and `:153`; DESIGN.md's human commander section records the
  1920x1080 camera, anonymous minimap dots, 60-second memory and shared snapshot alerts. `node test-engine-ai-perception.js`
  passes. Actual Three.js projection checks cover 660,336 samples, including current master's natural hills,
  with zero falsely detailed markers. The camera uses the actual 60 m starting distance and seat-facing yaw.
  Verified in the unchanged V13 full suite: `test-engine-ai-effect-visibility.js` reproduces the shot/flight
  mismatch and passes the read-only exact-key canonical mask correction, stale-key fallback, poisoned-history
  and live-cache immutability controls. `test-engine-ai-selected-hud.js` verifies actual selected-type HUD,
  grouped text and coarse world health. See `docs/human-like-ai-verification-v13.md`.
  Corrected after `/tmp/human-ai-subprecision-events/proof.json`: runtime damage now follows the observed
  estimate or actual singleton HUD. `node test-engine-ai-observed-events.js`, `node test-engine-ai-selected-hud.js`
  and `node test-engine-ai-perception.js` pass current production counterfactuals, visible category controls,
  group privacy, selected health, actual Three projection and detached private detector history.
- [x] Every decision that needs detail (type, health, suppression, whether an ability is ready) uses only the screen
      tier, memory of it, or the actual selected-type HUD available to the human. Unselected readiness stays unknown.
      Evidence: `shared/ai-perception.js:129-170` removes the delivered snapshot before planning. Enemy minimap dots
      have no IDs, health or exact types. `node test-engine-ai-human.js` passes action-level off-camera invariance.
      Current `test-engine-ai-observed-events.js` fixes the one-HP, raw heavy-hit and risk-crossing leaks while
      preserving actual bar color and posture. `test-engine-ai-measurement-streams.js` proves private oracle
      data cannot change nonempty native inputs, commands or runtime events at any difficulty. Original
      raw populations remain separate and censored; equal estimates are not claimed to be identical pixels.
- [x] Proofs in the style of the existing fog-fair tests: perturbing an off-camera enemy's health or type does not
      change the AI's next actions; the same perturbation on camera can (negative control).
      Evidence: `node test-engine-ai-human.js` reports "Default commander action-level camera detail invariance and
      on-camera negative control passed." `node test-engine-ai-perception.js` verifies detached tiers and memory.

### Phase 2: attend

- [x] One virtual camera per seat with a position. Moving it costs time: panning at the client's pan speed, jumping
      by minimap click, by alert (Space) or by double-tapping a control group, each with human latency.
      Evidence: `shared/ai-hands.js:35`, `:381` and `:516`; `node test-engine-ai-hands.js` passes real-key camera
      gestures, historical cardinal 66 m/s pans, current-alert Space, minimap noise and two-key group jumps.
      Round 8 adds real concurrent diagonal keys with independently paid press/release times. Root passes
      `node test-engine-ai-diagonal-pan.js` and the unchanged hands, response and public-alert controls.
      Native client parity and retained earlier traces are in `docs/evidence/human-like-ai-r8-fixes/pan/`.
- [x] An attention scheduler over concerns (each fight, base and production, expansion, scouting, idle units,
      support ready). It looks at one concern at a time, stays for a while, and pays a cost to switch. Alerts and
      minimap changes raise urgency. Under load it slips like a person: during a big fight, production and expansion
      wait.
      Evidence: `node test-engine-ai-perception.js` passes persistent bounded working sets, stronger emergency
      retention, combat/production revisits, contact debounce and visibly busy Engineer exclusions. Only one
      concern has attention; waiting concerns retain ages. The full-campaign workload measurements remain open.
- [x] Orders go only to units on screen, to a recalled control group, or through a minimap right-click (coarse). An
      order to a unit far from the camera without one of those is impossible by construction, and a test proves it.
      Evidence: `node test-engine-ai-human.js` and `node test-engine-ai-hands.js` pass dispatch-time locality,
      actual-selection and minimap/group positive controls, including units that move away before a queued input.

### Phase 3: decide

- [x] `plan()` stays view-only. Decisions for a concern are made while it has attention, from what the tiers allow.
      Evidence: `node test-engine-ai-human.js` passes action-level off-camera invariance and its on-camera negative
      control. `node test-engine-ai-commitment.js` passes actual idle-unit, expansion destination and production
      batch inputs. `plan(observation, slot, opts, mem, send)` receives no authoritative game reference.
      Current `test-engine-ai-selected-hud.js` traverses actual planner memory and confirms raw detector and
      projection graphs are unreachable. `test-engine-ai-observed-events.js` verifies the corrected precision
      boundary. `test-engine-ai-priority.js` and `test-engine-ai-tactical-reaction.js` prove diagnostic population
      permutations cannot choose an actor, alter contact defense or create a danger pullback.
- [x] Deliberation takes time, more for harder choices and lower skill. The opening is a real opening: the AI looks
      at its base and the map for a few seconds, then gives its first orders one group at a time.
      Evidence: `node test-engine-ai-human.js` reports first commands at 4.5/3.4/2.75 seconds, with timed physical
      selections. `node test-engine-ai-hands.js` checks complete opening sequences and total reaction budgets.
- [x] Bounded rationality: score the options and choose with seeded noise (for example softmax) whose temperature
      depends on difficulty, so Easy makes plausible mistakes. Never choose what a person would read as a bug: a lone
      unit walking into the enemy base, units turning back and forth, an order given and cancelled again and again.
      Round 6's accepted-formation repeated-click defect is corrected with actual destination receipts. One exact
      archived Normal seed12 replay changes its ten cited clicks to one, with identical input history through that
      first move. Changed points, actor order/membership, queue/facing, genuine movement away, refusals, partial
      selection and current danger/base responses remain eligible. All three R6 gameplay fixes pass together on
      current root; `docs/evidence/human-like-ai-r6-fixes/root-consolidated/r6-root-consolidated-result.json` retains
      source hashes and seven passing native checks. Final campaign and independent review remain open.
      A later real idle-objective-guard omission is corrected while preserving the existing useful stationary
      grenade assertion. Five focused native controls pass. Repeated hesitation now samples once per attended
      visit and keeps its full pause; native hesitation, commitment, coherence and response checks pass.
      `docs/evidence/human-like-ai-attended-guard/` retains the initial regression and narrow correction.
      Final-source population and independent-review gates still remain open.
      The lab also reproduces an ordinary rifle's weak automatic fire preventing retreat after a native tank
      hit. The correction distinguishes that automatic target from a paid attack or useful counterfire.
      Root's new native fixture and all 90 prior stationary controls pass. Three captured level pairs retain
      pre-hit equality and every later response and censor; the portable driver supplies six native pairs.
      `docs/evidence/human-like-ai-automatic-armor/` independently verifies all 35 payload files against their
      original bytes, including both timing sets. These episodes are diagnostic, not population acceptance.
      Current-source component verification: `shared/ai-persona.js:59` uses seeded option temperatures 28/14/5
      with skill-dependent commitment. Root runs the complete persona, coherence and hesitation modules after
      the R9 changes; all three exit zero with relevant source byte-identical before/after. The independent
      GPT-6-Sol round 9 review finds no new demonstrated core decision defect and verifies prior formation,
      guard and paid-input corrections. Native logs, exact source bindings and its qualified verdict are in
      `docs/evidence/human-like-ai-review-round9-codex/`. Population calibration remains deferred to #48.
- [x] A persona per match from the seeded RNG (for example aggressive, defensive, armour-first, infantry mass,
      support-heavy), with build-order families and variations. It keeps its persona but adapts to what it sees.
      Evidence: `node test-engine-ai-persona.js` passes persona persistence through new visits, loss and score
      changes, and legal faction purchase fallback. The new candidate's full opening-variety campaign remains open.
- [x] Estimates instead of exact numbers: enemy strength comes from what was seen, with uncertainty, so the AI can be
      surprised and can misjudge a fight.
      Evidence: `node test-engine-ai-persona.js` verifies stable error through repeated inspection and brief camera
      excursions, a fresh estimate after genuine contact reacquisition, stale remembered health and actual default
      commander input invariance under off-camera health changes. Camera return supplies a positive control.
- [x] Commitment and hesitation: it sticks to a plan, sometimes pauses at the edge of a fight before committing, and
      pulls back as a group when the fight turns.
      Evidence: `node test-engine-ai-coherence.js` and `node test-engine-ai-commitment.js` pass unfinished 12-second
      commitment, a 30-second arrived A-B-A guard, local base emergency override, delayed formation acknowledgement
      and refused-operation negative controls. Risky advance hesitation is seeded; accepted repairs retain crews.
- [x] Human slips, with frequency set by difficulty and seeded: an idle unit off screen goes unnoticed for a while,
      MP piles up while it is busy fighting, a flank is answered late.
      Evidence: the current default commander passes a fixed native 40-second scene at all three levels, a quiet
      control and an exact full seeded replay. A rear MG remains idle and unwatched for six seconds. MP rises
      from 44.9875 to 104.9708 during ordinary projectile combat, with 101 visible on the actual HUD. The native
      flank hit at tick 162 receives a fully paid camera response after 4.60/2.75/1.05 seconds. Conditional seeded
      optional-attention probabilities remain 0.5/0.3/0.15; these are authored rates, not measured population error.
      Root independently reruns the pristine portable fixture against actual Root modules: exit zero in 4.403 seconds,
      all 450 runtime/tool/client files unchanged. `docs/evidence/human-like-ai-r8-human-slips/` preserves all 92
      original members, the separate Root replay and source maps. Campaign timing and APM gates remain open.
- [x] Mood: more careful after a heavy loss, greedier when ahead, within limits.
      Evidence: `node test-engine-ai-persona.js` observes real roster losses in attended planner visits, caution
      bounded at 0.3, a 0.1 reduction when leading by more than 50 VP, and expiry/equal-score controls. Persona remains
      unchanged; the mood affects the human decision margin, with no information or resource change.

### Phase 4: act (the hands)

- [x] An input executor (for example `shared/ai-hands.js`) between decisions and `command()`. Every decision becomes a
      sequence of human inputs: camera move, select (box drag, click, group recall), order (right-click, attack-move,
      ability key plus click), buy click, building placement. Each input takes time from a motor model (reaction,
      Fitts' law for pointer travel, keystroke time). Inputs are released on the tick their time comes, through the
      existing `submit` / `command()` path.
      Evidence: `shared/ai-commander.js:87`, `shared/ai-hands.js:381`, `:478` and `:585`;
      `node test-engine-ai-hands.js` passes opening, physical input sequences, targeting and motor timing checks.
- [x] At most one command per seat per tick, and each command carries what one human input produces: one formation
      move for the whole selection, built with the same formation code the client uses (move the client's
      `formation()` into `shared/` if needed so both use one function).
      Evidence: `shared/formation.js` supplies both callers. `node test-engine-ai-hands.js` verifies formation
      geometry, intervening-unit box selection and one-command-per-tick. Final campaign verification remains open.
- [x] Click precision: target points scatter around the intended spot following Fitts' law (more error for long,
      fast moves and small targets; minimap clicks are coarse), and snap where the client snaps (clicking a unit or a
      building).
      Evidence: `shared/ai-hands.js:478-510` uses CSS-pixel distance/width, endpoint noise and inverse projection.
      `node test-engine-ai-hands.js` passes missed selection, unit snapping and coarse minimap controls. The research
      note distinguishes the supported speed/accuracy relation from authored coefficients and endpoint noise.
- [x] Control groups: the AI sets and recalls groups like a player, with human group sizes and mixes.
      Evidence: `shared/ai-hands.js:141`; `node test-engine-ai-group-reuse.js` passes actual accepted first/second/third
      movements: no first-use key, a separate paid binding after the second accepted movement, then real recall.
      History retains at most 32 exact 2-8-troop sets for 60 seconds. Refusals, changed sets, dead members, actual
      partial selections, aircraft, structures and singleton jobs are checked. `node test-engine-ai-hands.js` and
      `node test-engine-ai-pointer-tracking.js` pass the migrated binding contract while preserving timing,
      locality, actual selection, nine-key reuse, dead pruning and two-tap camera centering. Root logs:
      `/tmp/r5-group-root-adoption.log`, `/tmp/r5-group-hands-root-adoption.log`,
      `/tmp/r5-pointer-group-root-adoption.log`; historical hands SHA256 `f3f2d4a0a86e3cb6ce7980eaab6dadeb69d8f21430600c11e6500638729f0b80`.
- [x] An APM budget per difficulty that counts the same inputs a person makes (camera moves and selections count),
      with short bursts allowed in fights.
      Evidence: `HUMAN_SKILLS` in `shared/ai-hands.js:8` and `node test-engine-ai-hands.js`: every physical input
      counts against rolling minute and tick-sliding ten-second caps, including camera moves and selections.
      This verifies the caps; the average-throughput gate below remains open.
- [x] Stale inputs: when the world changes before an input fires (unit dead, target gone), the hand behaves like a
      person (a wasted click is fine; `command()` already rejects invalid orders).
      Evidence: `node test-engine-ai-hands.js` passes stale unit/group/target cases, actual pixel selection and
      current alert resolution. `node test-engine-ai-coherence.js` passes accepted-but-ineffective ability backoff.
- [x] Handover: an AI taking over a human seat first looks for at least 1.5 s and builds its own groups.
      Evidence: `shared/ai-hands.js:43`; `node test-engine-ai-human.js` and `node test-engine-ai-hands.js` verify
      the pause from the actual handover tick, with a fresh selection/group state.
- [x] The Horde wave director stays scripted (a Wave is not a player). Decide whether the Horde seat's support calls
      and co-op AI teammates go through the hands, and write the boundary down in DESIGN.md.
      Evidence: DESIGN.md's human commander section states that enemy Wave support, stances, abilities and bounded
      movement remain scripted; co-op teammates use hands. `node test-engine-horde-queue.js` passes lifecycle,
      supersession, ownership, observe and direct-command contracts in the focused verification log.
- [x] Server integration: the hands run every tick (cheap), decisions run when attention arrives at a concern (or on
      the look schedule, if you keep one). Update `server.js`, `tools/ai-balance.mjs`, `tools/bench*.mjs` and any other
      caller.
      Evidence: `node test-engine-ai-callers.js` executes the Horde, fairness and balance loops with current and
      legacy schedules, preserving odd-tick alerts, bounded delivery history and once-only hit/loss counters.
      The frozen 1,000-tick benchmark records 6,000 current hand advances versus 149 legacy looks. Server and every
      gameplay tool were inspected for the same every-tick/delivery-beat boundary; performance remains open.
- [x] Determinism: all randomness comes from a seeded RNG per seat (match seed plus slot). No `Math.random` in
      `shared/ai*.js` or the hands. Same seed, same input log.
      Evidence: `rg -n 'Math.random' shared/ai*.js` returns no matches. `node test-engine-ai-human.js` forbids
      Math.random while thinking and compares complete same-seed timelines, with a different-seed negative control.

### Difficulty as skill, not cheats

Original authored acceptance targets. Phase 0 research records each value's provenance and retain decision.
The sources support mechanisms, not empirical confirmation of these difficulty bands. Every original gate remains unchanged.

| Measure | Easy | Normal | Hard |
|---|---|---|---|
| Reaction to an on-screen event (median) | 0.9 to 1.4 s | 0.5 to 0.8 s | 0.3 to 0.45 s |
| Off-screen event to first action, with an alert (median) | 3 to 6 s | 1.5 to 3 s | 0.8 to 1.6 s |
| Average APM over 60 s windows | 20 to 35 | 40 to 70 | 80 to 120 |
| Peak APM over 10 s windows | 60 or less | 120 or less | 200 or less |
| First order after match start | 4 to 8 s | 3 to 6 s | 2 to 4 s |
| Decision noise | high | medium | low |
| Concerns it can juggle | 1 to 2 | 2 to 3 | 3 to 4 |

Floors at every level: no reaction under 0.2 s, no two orders to places more than one screen apart within 0.25 s, never
more than one command per tick. Difficulty changes skill (speed, attention, judgement), never information or economy.

### Phase 5: make it visible

- [x] An input log per AI seat: every input with tick, kind, camera position, number of units selected, target, the
      event it answers and its latency, and the concern it served. Off by default, on in tools and tests. It holds
      nothing the seat could not know.
      Evidence: `shared/ai-hands.js:58` and `tools/ai-humanity.mjs`; `node test-engine-ai-human.js` inspects emitted
      physical inputs. Reaction metadata separates event, decision, queue, motor and command clocks.
- [x] `tools/ai-humanity.mjs`: runs seeded AI matches (and can read recorded human logs) and prints every measure in
      the table above plus commands per tick, camera jumps per minute, dwell time per cycle, actions per cycle, time to
      first buy, floating MP, unnoticed idle time, opening variety across seeds and cross-map orders within one
      second. It writes a JSON report under `docs/`.
      Evidence: V14 collector `8326d7c0` supports independent measurement streams; `node test-engine-ai-humanity.js`, `node test-human-input.js` and
      the native recorder-to-public-CLI fixture pass. `/tmp/human-ai-phase5-phase6-verification/README.md`
      maps every metric to its field and observation limits. The 120-match baseline is saved under docs.
      Human stimulus populations, attention, resources and semantic camera jumps remain explicitly unknown;
      command APM is not physical input APM. The original V14 serialization attempt failed after 60 Conquest simulations.
      Authorized storage-only streaming recovery completed all 120 original matches and 360 seats at frozen checkpoint
      `7c87de19`. Every full raw frame and both policy/scoring comparisons are retained in
      `docs/human-like-ai-verification-v14.md`. This is historical failed acceptance evidence, not proof of the later R5
      corrections. The corrected public writer passes `test-ai-humanity-storage.js`, including nine real seats, complete
      raw graphs, native reducers, package/merge, backpressure and failure cleanup. Acceptance gates remain open.
- [x] A spectator and developer overlay: each AI seat's virtual camera rectangle and a ghost cursor that travels
      between clicks, with click markers like the human move marker. Off for players. Check the spectator rules
      (DESIGN.md, `test-engine-spectators.js`) so the overlay reveals nothing a spectator could not already see.
      Evidence: `client/ai-overlay.js`, `shared/human-input.js`; `node test-engine-ai-overlay.js` passes player,
      spectator and World team-fog privacy over WebSocket. Screenshots and recordings are listed in
      `docs/human-like-ai-browser-final.md`; UI-only pointer travel is hidden instead of exposing private purchases.

### Phase 6: calibrate from real people

- [x] An opt-in, local human input recorder (server flag or environment variable) that logs the same measures for
      human seats from the commands they send. If it needs a camera beat from the client, keep that opt-in, local and
      never sent to other seats.
      Evidence: `node test-human-input.js` and `node test-engine-ai-overlay.js` pass dual opt-in, bounded local
      files/queues, 10 Hz camera beats, denied neighboring cases and no telemetry relay to other seats.
- [x] `tools/ai-humanity.mjs` can fit the hands' timing distributions from those logs. Commit the literature defaults
      now, and document in DESIGN.md the one command Julio runs after playing a few matches to calibrate to how he and
      his friends actually play.
      Evidence: actual recorder, `--fit` CLI and hands consumer pass the synthetic contract fixture in
      `/tmp/human-ai-phase5-phase6-verification/verification.json`. Five measured key gaps yield
      `[0.14, 0.46]` seconds, applied as `[0.14, 0.4]` after the documented safety clamp. Unobserved reaction,
      pointer and error distributions retain authored defaults. DESIGN.md gives
      `node tools/ai-humanity.mjs --fit logs/human-input --out docs/local-ai-calibration.json`.
      This verifies fitting support, not real-person calibration; local human recordings remain future work.

## Verification gates (all required for PR #49 and issue #48)

- [ ] `node test.js` passes, plus every `test-engine-ai*.js`, `test-world-observation.js` and any test that calls
      `think()`. List what you ran with the results. If an existing test encodes superhuman timing (for example it
      expects orders on the first look), change it to the human contract and say so in the PR. Never weaken an
      assertion only to make it pass. Keep a way to test the decision layer without the hands.
      Evidence: V13 full suite exited 0 on 2026-10-04, 10:21:10-10:46:41 UTC. All 601 source/document hashes
      matched before and after, including master `a3564a6`. `docs/human-like-ai-verification-v13.md` lists the
      checks, exact log hash and assertion migrations. The current V14 run exited 1 at `test.js:7391`:
      the bridge repair fixture still had no vehicle crossing after 60 seconds. All 611 file hashes matched
      during the run. `/tmp/human-ai-v14-full-verification.json` records log SHA256
      `1e9e06e4892fd6c12c792f465c1fd177fcb4f214f907d8e0cd64c25d94eb68e3`.
      Preserve the repair requirement, correct the failure, then rerun the full suite.
      V15 exited 1 at the response fixture with all 763 file hashes unchanged. The fixture now establishes real
      second-use binding and keeps the paid survivor recall assertion. That exposed current-camera routing after
      a held pan; the correction passes the complete response module with original clocks and added native guards.
      `docs/human-like-ai-verification-v15.md` retains failure and correction evidence. Fresh full verification remains open.
      The later commitment fixture also assumed a crowded noisy box would select both support teams. Its initial
      scene now separates the actual MG pair, keeping every assertion, seed, camera, 300-tick bound and 30-tick
      refusal observation. Root passes the complete module with accepted line tick 65 and refused pair tick 91;
      the native scene proof remains in `docs/evidence/human-like-ai-r6-fixes/commitment-fixture`.
      V16 then failed an incomplete direct-planner Engineer fixture; normal `think()` initializes the missing
      `seen`/`node` maps. The corrected fixture retains all forty native repairs and the original sixty-second
      limit, with a worst case of 52 seconds. V17 passes every AI child, including 162 manual-policy assertions
      and all 27 integrated isolation treatments, then fails a stale WebSocket frame in traffic privacy.
      The corrected wait preserves exact trajectory equality and passes hidden terrain/wreck controls plus
      actual live-truth/live-cover negatives. Both full failures and all clean source checks remain in
      `docs/evidence/human-like-ai-v16-full-failure/` and `docs/evidence/human-like-ai-v17-full-failure/`.
      A fresh full exit 0 remains required.
      V19 exits 1 at the lab's expected native-refusal assertion after the cover correction removes bare-ground
      refusals. All 1,964 source hashes and 107 continuous checks remain unchanged. The recording assertion
      remains required; its scene will be corrected to a genuine rejected paid input. Full failure evidence is
      retained in `docs/evidence/human-like-ai-v19-full-failure/`.
      The lab now uses a watched wall to reproduce a genuine `noCover` refusal after full selection and motor
      timing. Its privacy control requires an accepted trench-cover operation before inspecting the remote
      enemy, and caller-edit isolation follows actual simulated movement. Root's adopted `node test-ai-lab.js`
      exits 0 in 2.8377 seconds. Thirteen payload files are independently byte-verified in
      `docs/evidence/human-like-ai-lab-fixture/`. A fresh full-suite exit 0 remains required.
      V21 passes all ninety-two registered children, then fails the spectator lobby assertion at `test.js:5818`.
      All 2,039 source entries match across 291 continuous checks. Full failure proof is retained in
      `docs/evidence/human-like-ai-v21-full-failure/`. The lobby now waits for a new matching delivery,
      preserving all eleven original scenarios, which pass on Root. Cover and contact fixtures retain their
      original behavioral assertions while verifying actual paid operations and genuine idle contact.
      A fresh full-suite exit zero on the corrected source remains required.
      The first integrated round 8 run exits one at inspection:110, with all 681 locked files identical across
      nineteen checks. Its separate remaining-child continuation passes 59/61. Public HUD-read relevance is now
      separated from strict useful-command acknowledgement, and Root passes all five complete affected modules.
      The formation fixture preserves its original assertion and chooses an actor with the actual pair receipt,
      proving paid singleton selection at 396 and acceptance at 400. Root's full fixture passes in 3.076 seconds.
      Original failures and source-bound corrections remain in `docs/evidence/human-like-ai-r8-full-failure/`
      and `docs/evidence/human-like-ai-r8-fixes/inspection/` and `accepted-destinations/`.
      The corrected Root full run exits zero naturally on 2026-10-05, 01:43:59-02:12:23 UTC (1,704.183 seconds).
      All 99 registered children, original native limits and full assertions pass. All 681 held files match across
      113 valid checks. The complete log SHA256 is `ed166828b5133257272c384007c30fb65b183e7ac56fdee46479b7219c8b5fbb`.
      `docs/evidence/human-like-ai-r8-full-pass/` retains the protocol, actual exit and registration; Root independently
      matches all 142 archived originals against their physical bytes. This verifies the recorded source, with
      subsequent runtime changes requiring renewed full verification. The next slice adds same-squad risk
      escalation, ready-AP wakeup and three permanent lab fixtures. Its fresh 102-child full pass remains required.
      That candidate's R9 full run fails in the nested corpse adapter timeout; its minimal wrapper correction and
      native four-module pass are retained in `docs/evidence/human-like-ai-r9-full-wrapper/`. The next R10 full
      run exits one naturally at 03:54:10 UTC on 2026-10-05, in the unchanged World teams child's 180-second limit.
      All 684 runtime files match across ten valid checks; an actual 162.498-second observation gap is retained.
      Root independently compares all 23 archived originals in `docs/evidence/human-like-ai-r10-full-failure/`.
      Random World seeds and missing phase measurements prevent attributing the timeout to a specific cause.
      The later session restriction independently produces localhost `EPERM` and blocks the required reproduction.
      No final 102-child full pass is claimed and no gameplay assertion or child deadline is waived.
- [x] The fog-fair proofs pass, plus the new perception-tier proofs.
      Evidence: the unchanged V14 full-run source passed 4,489 paired fog turns, including 30,213 hidden-unit,
      9,566 visible-unit, 7,353 sub-precision, 2,205 secret-depot and 237,654 hidden-mine perturbations.
      The registered camera/minimap, canonical effects, selected-HUD, observed-event, measurement-stream and
      off-camera private-memory tests also passed before the later bridge assertion failed. The damage and
      suppression precision correction passes its positive and negative controls. These component results
      do not certify the separate full-suite or numeric campaign gates.
- [x] New tests: one command per tick per seat; nothing before the opening look ends; the reaction floor; APM caps;
      camera locality (no order to an off-screen unit without a group recall or minimap order); seeded determinism;
      the handover pause.
      Evidence: the unchanged 611-file V14 run passes `test-engine-ai-hands.js`, `test-engine-ai-human.js` and
      `test-engine-ai-perception.js`: opening, dispatch locality, real selection, one-command-per-tick, rolling
      caps, 0.2-second causal floor, seeded timelines and takeover pause. Its 120-second human fixtures report
      first commands 4.5/3.4/2.75 s. Average APM and population reaction medians remain open campaign gates.
- [ ] `tools/ai-humanity.mjs` numbers fall inside the table for each difficulty over at least 20 seeds per difficulty
      on Conquest and 10 each on Classic and World Conquest. The numbers go into DESIGN.md.
      Required by Julio's later request to complete both PR #49 and
      [#48](https://github.com/axelmanosalvasmd/ww2-rts/issues/48). Original timing limits, complete populations,
      missed responses and all failed historical evidence remain unchanged. No numerical pass is claimed.
      Historical V14 evidence: all eight identifiable original required-screen medians fail; World Easy is not evaluable.
      Physical APM fails five groups and first-order bounds fail five groups. Peak caps pass all nine groups.
      `docs/human-like-ai-verification-v14.md` retains all required/censored endpoints and unchanged authored bands.
      V15 retains all 120 matches and 360 seats: APM fails five mode/level groups; first-order, peak, reaction floor,
      one-command and quarter-second locality checks pass. Original reaction gates are not evaluable because all
      360 original baselines are tick 2. Full populations and raw data remain in
      `docs/human-like-ai-verification-v15.md`. The collector-only initial-scene correction passes 36 native isolation
      comparisons on current root in 71.11 seconds, preserving first actor delivery at tick 2 and every input,
      resource receipt, complete game graph and RNG value. Historical coverage is unchanged.
      Julio then authorized correcting the reaction scorer prospectively while retaining the original timing limits.
      The adopted rule is documented in `docs/human-like-ai-manual-response-v2.md`. Native fixtures pass 162
      assertions after correcting the latest public screen baseline following a real paid camera move. Earlier
      27 source-bound controls preserve complete native graphs, inputs, commands, RNG and original metrics on
      their recorded adapter checkpoint; the frozen full suite will recheck the corrected adapter. Root also verifies the adopted fixture and
      unchanged humanity/multievent/stream tests. `docs/evidence/human-like-ai-manual-response-v2/` retains
      original proposals and exact proof. Existing scores and all original limits remain preserved;
      numerical acceptance still requires the next full frozen campaign.
      The subsequent R7 correction is adopted prospectively as `screen-manual-v3`: useful support and direct
      target abilities need real accepted receipts and public purpose; a later contact covered by an already
      started physical attack input can be monitoring without a zero-time answer. Root's permanent native
      fixture exits 0. `docs/human-like-ai-manual-response-v3.md` and
      `docs/evidence/human-like-ai-manual-response-v3/` retain the declaration, controls and source hashes.
      V2 and historical scores remain unchanged. No final-source population pass is claimed.
      The prospective off-screen `public-danger-alert-v1` fixture verifies actual paid Space, minimap and pan
      arrivals at the original public danger location, including retarget, partial and cancellation controls.
      Root also runs the real collector with both new policies; its eventless alert population remains unknown.
      `docs/ai-public-alert-response-v1.md` and `docs/evidence/human-like-ai-public-alert/` retain source-bound proof.
      No population timing pass is claimed, and all original timing bands remain unchanged.
      The running V16 collector also drops genuine original creations from its cumulative array. Its zero original
      populations remain incomplete instrumentation evidence. The prospective one-line correction passes the
      complete stream fixture and 36 current native isolation comparisons, retaining original oracle/scoring bytes,
      timing limits and historical results. `docs/evidence/human-like-ai-original-cumulative/` records the defect and proof.
      The lab's exact-half numerical correction is adopted prospectively as `km-exact-half-v1`.
      Root's portable fixture passes 110 controls and the unchanged humanity and multi-event tests.
      All curves and original rows remain unchanged; the retained Easy diagnostic first-input median
      is 4.15 seconds historically and 1.65 seconds prospectively. Root independently verifies 19 archive
      members in `docs/evidence/human-like-ai-km-boundary/`. The rule and unchanged limits are declared in
      `docs/human-like-ai-km-boundary.md`; a fresh population pass remains required.
      The completed archival V21 Conquest sixty-match sample fails: screen-manual-v3 medians are
      3.50/1.65/1.15 seconds and physical APM medians 26.834/42.167/59.667. All 180 seats, required events
      and censors remain recorded. Peak caps, first-order bands, floor and locality pass. Public-alert-v1
      numeric medians fit their bands but unsupported causal inputs leave coverage unknown.
      DESIGN.md records the exact counts and unchanged limits; the round 8 source still needs acceptance.
- [ ] Opening variety: over 20 seeds per faction, at least 3 distinct openings and none in more than half the
      matches.
      Required for PR #49 and [#48](https://github.com/axelmanosalvasmd/ww2-rts/issues/48),
      retaining the original twenty-seed requirement and separate auxiliary opening population.
      Historical evidence only: the earlier Conquest campaign, 20 seeds per difficulty, checkpoint `223d17f`: USA 7/4/5/4,
      Germany 9/3/5/3, USSR 9/5/3/3 across infantry, anti-tank, mortar and machine-gun first accepted purchases.
      Each has four meaningful families and maximum 45%; pointer jitter and route coordinates are excluded.
      Completed historical V14 accepted-purchase sequences over 20 Conquest seeds per faction/difficulty fail seven
      of nine groups. Normal USSR passes (six sequences, maximum 30%); Hard Germany passes (five, maximum 35%).
      `docs/human-like-ai-verification-v14.md` records every sequence count. First-family concentration is diagnostic,
      not another gate. Classic and World have only ten seeds per faction; later R5 source needs fresh acceptance proof.
      Historical V15 Conquest passes all nine faction/difficulty groups: 5-12 accepted-family sequences, maximum
      concentration 20-45%, with every original seed retained. Later camera and runtime corrections still need
      final-source verification. `docs/evidence/human-like-ai-v15/root-summary.json` retains exact per-group counts.
- [ ] Balance with `tools/ai-balance.mjs`, same seeds before and after (Conquest 60, Classic 30, as in DESIGN.md):
      each faction wins 25 to 42%, matches still finish, and any change in median length is explained. Head to head
      against the old commander (kept reachable only for this measurement, for example a frozen copy under `tools/`):
      new Hard beats old Easy at least 70% of the time; report new Hard against old Normal and old Hard. Tune the AI,
      not unit stats.
      Required for PR #49 and
      [#48](https://github.com/axelmanosalvasmd/ww2-rts/issues/48). All seeds, faction limits and head-to-head
      requirements remain unchanged. The failed faction shares below are retained, not accepted.
      Historical V15 finishes all 150 matches without timeout. Conquest faction shares are 30.0/41.7/28.3%,
      Classic decisive shares 26.9/38.5/34.6%; new Hard wins 16/20, 17/20 and 10/20 against old Easy/Normal/Hard.
      Root independently reduces all rows and verifies every compact-bundle member against its source.
      `docs/evidence/human-like-ai-v15-balance/root-copy-manifest.json` retains baseline/source limitations.
      These precede current R6 fixes, whose final-source balance gate remains open.
      Historical V16 now finishes all 150 original rows naturally, with four Classic draws and zero timeouts.
      Conquest wins are 23/22/15. Classic decisive shares are 26.92/42.31/30.77%, so Germany fails the exact
      42% ceiling. Hard beats old Easy/Normal/Hard 15/20, 17/20 and 13/20. Root's independent full-row reduction
      and byte-verified artifacts remain in `docs/evidence/human-like-ai-v16-balance/`. Current-source balance stays open.
      Historical V21 completes all 150 original rows, four draws and no timeout. Conquest 25/22/13 fails USSR's
      25% floor; Classic 11/8/7 over 26 decisive results fails USA's exact 42% ceiling. Hard beats old
      Easy/Normal/Hard 15/20, 16/20 and 14/20. Root verifies all original rows, seeds, durations, logs and 59
      physical archive members in `docs/evidence/human-like-ai-v21-balance/`. Current-source balance remains open.
- [ ] Performance: `tools/bench-engine.mjs` AI phase p95 and maximum no worse than master by more than 10% or 2 ms,
      whichever is larger, and no new ticks over the 40 ms budget.
      Required for PR #49 and
      [#48](https://github.com/axelmanosalvasmd/ww2-rts/issues/48). Original limits and every failed fixed row remain.
      V15 fails: exact p95 9.501/10.876 ms passes, counts p95 9.142/11.749 ms exceeds the 2 ms allowance,
      and raw timed ticks above 40 ms rise from four to five. All four fixed rows remain in
      `docs/human-like-ai-verification-v15.md`; the later equivalent fog-loop change is not a passing benchmark.
      V16's four quiet fixed rows also fail: exact p95 is 8.866/12.193 ms, counted maximum is
      51.627/58.731 ms and counted ticks above 40 ms rise from two to four. All rows and byte-verified
      source remain in `docs/evidence/human-like-ai-v16-performance/`. The subsequent small copy
      reduction is supported by native equivalence and an isolated micro, not a full performance pass.
      The exact sparse-effect fog correction preserves every native digest over 1,000 current-source ticks,
      including human snapshots and canonical fog. Root passes 25 history, privacy and World controls plus
      the unchanged effect-visibility, selected-HUD and perception tests. AI-phase fog line-of-sight calls
      fall from 2,566,003 to 19,569; diagnostic p95 is 8.707251/6.482153 ms. Root independently verifies all
      168 payload files and their manifest in `docs/evidence/human-like-ai-point-fog/`. This is a material implementation
      change supporting a fresh quiet benchmark, not a performance gate pass.
      The fixed quiet V21 exact AI p95 also fails at 10.746/15.880 ms against the original two-millisecond
      allowance. Its counted rows pass; all four rows remain recorded. Slower ownership prototypes were
      rejected. No unchanged favorable rerun substitutes for the failed exact measurement.
      The fixed quiet round 8 rows pass their latency comparisons: exact p95 8.961/10.409 ms and maximum
      40.759/38.962 ms; counted p95 8.676/10.531 ms and maximum 45.486/40.846 ms. Counted timed ticks above
      40 ms increase from two to four, so overall performance still fails. Root independently byte-verifies
      all 78 payload originals in `docs/evidence/human-like-ai-r8-performance/`, including the initial preflight
      refusal and actual pause/resume journal. The later inspection fix still requires its own final-source gate.
      The fresh fixed R9 four-row benchmark also fails overall: exact p95 8.789/9.925 ms and maximum
      48.911/46.647 ms pass; counted p95 9.279/10.933 ms passes, while counted maximum 44.992/50.765 ms
      exceeds its 49.4912 ms limit by 1.2738 ms. Counted timed ticks over 40 ms fall from three to one.
      Root independently byte-verifies all 248 physical originals in `docs/evidence/human-like-ai-r9-performance/`.
      Source, quiet-workload and resume checks pass. Individual slow-tick samples were not recorded, so no
      allocation or scheduling cause is attributed to this maximum.
- [x] Browser check: start the server, play or spectate a real match against Normal AIs, with the overlay on. Save
      screenshots or a short recording for the PR and check the console for errors. Confirm by eye: at the start the
      AI looks first, then moves groups one after another; its camera goes to fights; orders appear one at a time; it
      sometimes floats money or reacts late.
      Root inspects the actual R9 sandbox screenshots and two native recording frames in
      `/tmp/human-ai-pr-lab-proof/`: six simulated seconds show five physical inputs and two native orders;
      sixty seconds show nineteen inputs and five orders. Actual console/errors are empty and source stays unchanged.
      This verifies the authored 2D diagnostic flow, not real-time 3D gameplay. The historical Normal-AI overlay
      combat recording in `docs/evidence/human-like-ai-browser-current/` predates the latest AI refinements.
      That earlier R9 3D attempt has only seven captured frames and fails its final screenshot; it is not accepted.
      Root subsequently inspects current-source ordinary Three Crossroads Conquest screenshots with three Normal
      AI seats: actual red/blue infantry combat, an explosion, native spectator follow and camera outlines on the
      minimap. Both inspected screenshots are attached to
      [PR #49](https://github.com/axelmanosalvasmd/ww2-rts/pull/49#issuecomment-5988293784).
      A separate ordinary browser capture on the same commander, attention and hands hashes retrieves the
      unwiped errors and console arrays; both are empty. Exact CLI replies, source hashes and failed later capture
      qualifications are byte-verified in `docs/evidence/human-like-ai-r9-current-browser/`.
      Opening selection and sequential orders have the attached native sandbox UI recording and paid input
      traces; `test-engine-ai-human-slips.js` verifies unnoticed idle troops, about 60 MP accumulating during combat
      and paid flank responses after 4.60/2.75/1.05 seconds. These are authored native cases, not population rates.
      Sparse spectator footage does not establish exact input cadence or private resource totals. The close
      capture's video does not finalize, and its bounded shorter correction times out at the first snapshot;
      neither is presented as a playable recording. Current inspected screenshots and the sandbox recording
      supply the PR proof; numerical calibration stays in #48. All new media stays outside the checkout.
- [ ] Independent review: give a reviewer that did not build it (another model through T3 `delegate_task` if
      available, otherwise a fresh Codex session) the input timelines and the recordings, and ask it to list every
      "bot tell". Fix what is fair to fix, review once more, and record both verdicts in the PR.
      Round 6 by Claude Opus 5.5 confirms substantial behavioral improvement but retains a failing verdict,
      including a formation-snap repeated-move loop and narrower-than-needed local responses. Its complete report
      is preserved in `docs/evidence/human-like-ai-review-round6/human-ai-review-round6.md`. Its population classifications
      are diagnostic; original baseline-2 gates remain not evaluable, V13's historical full pass remains valid,
      and World completed after the review's snapshot. Final-source review and remaining corrections are open.
      Julio subsequently requested Codex agents only. GPT-6-Sol round 9 reads the original brief, prior findings
      and responses, current runtime and native input evidence. It finds no new demonstrated core gameplay,
      fairness or physical-command defect, while retaining the full-suite and current-source browser proof limits.
      Root verifies its exact source hashes and byte-identical report in
      `docs/evidence/human-like-ai-review-round9-codex/`. Earlier failed verdicts and this conditional verdict still
      need publication in the PR, so this box remains open. The interrupted Claude round 9 attempt supplies no verdict.
- [ ] Docs: a new DESIGN.md section for the human-like commander (model, numbers, balance, what is left for later),
      the new terms in the CONTEXT.md glossary in its existing format, and CHANGELOG.md "Unreleased" bullets in the
      same commits as the changes. No em dashes in anything you write.

## Delivery

- [ ] Commit in working slices on this branch, each with its CHANGELOG bullet. Stage specific files, and check
      `git status` for changes that are not yours (other sessions may share this repo).
- [x] `git fetch origin`; if master moved, merge it in, resolve conflicts and rerun the tests.
      Evidence: Root fetches on 2026-10-05 at 04:50:51 UTC; `origin/master` remains
      `a3564a6a7bcd733900953b57854ba2d5bd885147`, already an ancestor of this branch. No new base merge is needed.
      Master will be checked again before the pinned merge.
- [x] Open a PR to `master` with the before/after metrics, overlay screenshots and balance tables, and link it to the
      thread.
      Evidence: ready [PR #49](https://github.com/axelmanosalvasmd/ww2-rts/pull/49) targets `master`, records the
      original maximum nine commands per seat/tick versus the enforced maximum one, source-qualified historical
      balance and timing numbers, and #48. `gh --attach` uploads inspected screenshots and the sandbox recording.
      T3 `link_pull_request` succeeds with `alreadyLinked: false`; the subsequent proof comment adds current combat.
- [ ] Merge it with the repo's flow once every gate above passes: `gh pr merge <n> --squash --match-head-commit
      <full 40-character sha>`, run from outside the checkout and without `--delete-branch`. There are no review bots.
- [ ] ~~Final report to Julio in Spanish~~: what changed for a player, the key numbers, and what is left for later.
      Language superseded by Julio's later instruction, "Work in english. Everything in english." The final report
      will use English; its substantive requirements remain open until delivery.

## Out of scope

Unit stats and economy numbers (tune the AI, not the game), new modes, models and art, UI work beyond the developer
overlay, and putting a language model in the game loop.
