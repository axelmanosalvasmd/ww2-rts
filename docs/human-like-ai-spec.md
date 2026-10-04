# Human-like AI commander: brief and checklist

Started 2026-10-04 for a GPT-6.1 Sol goal thread. Tick a box only after you have verified it, and write the evidence
next to it (command and output, number, `file:line`, screenshot path). If an item turns out to be wrong for this game,
do not silently skip it: strike it through and write why.

## Why

Julio's complaint, translated from Spanish: the enemy AI runs a script. It reads the game and never has to think the
way a person does before deciding, so it is always ahead. At the start of a match he is still working out what to do
("they sent out one tank, then two tanks, then a squad: what should I do?"), while the AI already has everything it
needs and has moved it exactly where it should go, at once. He wants the enemy to decide like a human brain that has to
press keys and click: look somewhere, select, right-click, one thing after another. The bar: after playing against the
new AI he should think "wow, this feels like a real player, not a machine that always has the advantage".

Being human is the goal, not being weak. A human-like Hard AI should still be a good player. It wins by better
decisions, not by seeing everything at once and acting everywhere in the same instant.

## What already exists (do not rebuild it)

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

## What still makes it superhuman

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

- [ ] Perception tiers that match what the human client shows. Check the client code and write down exactly what
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
  Reopened by `/tmp/human-ai-subprecision-events/proof.json`: identical unselected world-bar estimates can
  produce different raw damage events and urgency. Runtime events and suppression must use visible estimates.
- [ ] Every decision that needs detail (type, health, suppression, whether an ability is ready) uses only the screen
      tier or memory of it.
      Evidence: `shared/ai-perception.js:129-170` removes the delivered snapshot before planning. Enemy minimap dots
      have no IDs, health or exact types. `node test-engine-ai-human.js` passes action-level off-camera invariance.
      The unchanged V13 full suite verifies physical inspection and the selected-HUD boundary. Still open:
      `/tmp/human-ai-subprecision-events/proof.json` confirms that equal world-bar estimates can expose a
      one-HP loss, cross a raw heavy-damage threshold or create a raw risk-crossing event. Numeric suppression
      also needs the rendered category boundary. Correction and permanent invariance controls remain open.
- [x] Proofs in the style of the existing fog-fair tests: perturbing an off-camera enemy's health or type does not
      change the AI's next actions; the same perturbation on camera can (negative control).
      Evidence: `node test-engine-ai-human.js` reports "Default commander action-level camera detail invariance and
      on-camera negative control passed." `node test-engine-ai-perception.js` verifies detached tiers and memory.

### Phase 2: attend

- [x] One virtual camera per seat with a position. Moving it costs time: panning at the client's pan speed, jumping
      by minimap click, by alert (Space) or by double-tapping a control group, each with human latency.
      Evidence: `shared/ai-hands.js:35`, `:381` and `:516`; `node test-engine-ai-hands.js` passes real-key camera
      gestures, dominant-axis 66 m/s pans, current-alert Space, minimap noise and two-key group jumps.
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

- [ ] `plan()` stays view-only. Decisions for a concern are made while it has attention, from what the tiers allow.
      Evidence: `node test-engine-ai-human.js` passes action-level off-camera invariance and its on-camera negative
      control. `node test-engine-ai-commitment.js` passes actual idle-unit, expansion destination and production
      batch inputs. `plan(observation, slot, opts, mem, send)` receives no authoritative game reference.
      V13 verifies private detector and projection WeakMaps. `test-engine-ai-selected-hud.js` traverses actual
      planner memory and confirms those raw graphs are unreachable. Keep this box open while the damage-event
      and suppression precision leak described in Phase 1 is corrected.
- [x] Deliberation takes time, more for harder choices and lower skill. The opening is a real opening: the AI looks
      at its base and the map for a few seconds, then gives its first orders one group at a time.
      Evidence: `node test-engine-ai-human.js` reports first commands at 4.5/3.4/2.65 seconds, with timed physical
      selections. `node test-engine-ai-hands.js` checks complete opening sequences and total reaction budgets.
- [ ] Bounded rationality: score the options and choose with seeded noise (for example softmax) whose temperature
      depends on difficulty, so Easy makes plausible mistakes. Never choose what a person would read as a bug: a lone
      unit walking into the enemy base, units turning back and forth, an order given and cancelled again and again.
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
- [ ] Human slips, with frequency set by difficulty and seeded: an idle unit off screen goes unnoticed for a while,
      MP piles up while it is busy fighting, a flank is answered late.
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
      Evidence: `shared/ai-hands.js:427-430`; `node test-engine-ai-hands.js` verifies 2-8-unit operation bindings,
      exact living-member recall, dead-member pruning, nine-key reuse and two-tap camera centering.
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

Starting values. Phase 0 research must confirm or revise each one, with a source.

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
- [ ] `tools/ai-humanity.mjs`: runs seeded AI matches (and can read recorded human logs) and prints every measure in
      the table above plus commands per tick, camera jumps per minute, dwell time per cycle, actions per cycle, time to
      first buy, floating MP, unnoticed idle time, opening variety across seeds and cross-map orders within one
      second. It writes a JSON report under `docs/`.
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
- [ ] `tools/ai-humanity.mjs` can fit the hands' timing distributions from those logs. Commit the literature defaults
      now, and document in DESIGN.md the one command Julio runs after playing a few matches to calibrate to how he and
      his friends actually play.

## Verification gates (all must pass)

- [x] `node test.js` passes, plus every `test-engine-ai*.js`, `test-world-observation.js` and any test that calls
      `think()`. List what you ran with the results. If an existing test encodes superhuman timing (for example it
      expects orders on the first look), change it to the human contract and say so in the PR. Never weaken an
      assertion only to make it pass. Keep a way to test the decision layer without the hands.
      Evidence: V13 full suite exited 0 on 2026-10-04, 10:21:10-10:46:41 UTC. All 601 source/document hashes
      matched before and after, including master `a3564a6`. `docs/human-like-ai-verification-v13.md` lists the
      checks, exact log hash and assertion migrations. Subsequent gameplay changes require a fresh full run.
- [ ] The fog-fair proofs pass, plus the new perception-tier proofs.
      Evidence: unchanged V13 full suite, 4,489 paired fog turns and the actual camera/minimap, canonical
      effects, selected-HUD and off-camera private-memory proofs. The separate unselected damage-event
      precision investigation remains open under Phase 1.
- [x] New tests: one command per tick per seat; nothing before the opening look ends; the reaction floor; APM caps;
      camera locality (no order to an off-screen unit without a group recall or minimap order); seeded determinism;
      the handover pause.
      Evidence: the unchanged V11 full suite runs `test-engine-ai-hands.js`, `test-engine-ai-human.js` and
      `test-engine-ai-perception.js`. Opening, dispatch locality, real selection, one-command-per-tick, rolling
      input caps, 0.2-second causal floor, complete seeded timelines and takeover pause all pass. Average APM and
      population reaction medians remain separate, open campaign gates.
- [ ] `tools/ai-humanity.mjs` numbers fall inside the table for each difficulty over at least 20 seeds per difficulty
      on Conquest and 10 each on Classic and World Conquest. The numbers go into DESIGN.md.
- [ ] Opening variety: over 20 seeds per faction, at least 3 distinct openings and none in more than half the
      matches.
      Evidence: the Conquest humanity campaign, 20 seeds per difficulty, checkpoint `223d17f`: USA 7/4/5/4,
      Germany 9/3/5/3, USSR 9/5/3/3 across infantry, anti-tank, mortar and machine-gun first accepted purchases.
      Each has four meaningful families and maximum 45%; pointer jitter and route coordinates are excluded.
- [ ] Balance with `tools/ai-balance.mjs`, same seeds before and after (Conquest 60, Classic 30, as in DESIGN.md):
      each faction wins 25 to 42%, matches still finish, and any change in median length is explained. Head to head
      against the old commander (kept reachable only for this measurement, for example a frozen copy under `tools/`):
      new Hard beats old Easy at least 70% of the time; report new Hard against old Normal and old Hard. Tune the AI,
      not unit stats.
- [ ] Performance: `tools/bench-engine.mjs` AI phase p95 and maximum no worse than master by more than 10% or 2 ms,
      whichever is larger, and no new ticks over the 40 ms budget.
- [ ] Browser check: start the server, play or spectate a real match against Normal AIs, with the overlay on. Save
      screenshots or a short recording for the PR and check the console for errors. Confirm by eye: at the start the
      AI looks first, then moves groups one after another; its camera goes to fights; orders appear one at a time; it
      sometimes floats money or reacts late.
- [ ] Independent review: give a reviewer that did not build it (another model through T3 `delegate_task` if
      available, otherwise a fresh Codex session) the input timelines and the recordings, and ask it to list every
      "bot tell". Fix what is fair to fix, review once more, and record both verdicts in the PR.
- [ ] Docs: a new DESIGN.md section for the human-like commander (model, numbers, balance, what is left for later),
      the new terms in the CONTEXT.md glossary in its existing format, and CHANGELOG.md "Unreleased" bullets in the
      same commits as the changes. No em dashes in anything you write.

## Delivery

- [ ] Commit in working slices on this branch, each with its CHANGELOG bullet. Stage specific files, and check
      `git status` for changes that are not yours (other sessions may share this repo).
- [ ] `git fetch origin`; if master moved, merge it in, resolve conflicts and rerun the tests.
- [ ] Open a PR to `master` with the before/after metrics, overlay screenshots and balance tables, and link it to the
      thread.
- [ ] Merge it with the repo's flow once every gate above passes: `gh pr merge <n> --squash --match-head-commit
      <full 40-character sha>`, run from outside the checkout and without `--delete-branch`. There are no review bots.
- [ ] ~~Final report to Julio in Spanish~~: what changed for a player, the key numbers, and what is left for later.
      Language superseded by Julio's later instruction, "Work in english. Everything in english." The final report
      will use English; its substantive requirements remain open until delivery.

## Out of scope

Unit stats and economy numbers (tune the AI, not the game), new modes, models and art, UI work beyond the developer
overlay, and putting a language model in the game loop.
