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

- [ ] Audit: list every superhuman behaviour (the eight above and any others) with `file:line` in
      `docs/human-like-ai-audit.md`.
- [ ] Research: write `docs/research/human-like-rts-ai.md` from primary sources you open yourself (papers, official
      pages), with links. Cover at least: perception-action cycles and first-action latency in RTS play (Thompson et
      al. 2013), the camera interface, action delay and APM limits used for AlphaStar (Vinyals et al., Nature 2019),
      human reaction times for simple and choice tasks, Fitts' law for pointer time and error, and what is known about
      APM in slower tactics RTS games like Company of Heroes. Use the findings to confirm or revise every number in the
      difficulty table below, and cite the source next to each number you keep.
- [ ] Baseline on current master behaviour with the tool from Phase 5 (or a first version of it): commands per tick,
      APM, time to the first order, reaction times, cross-map orders within one second, opening variety. Save the JSON
      next to the "after" numbers so the PR shows both.

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
- [ ] Every decision that needs detail (type, health, suppression, whether an ability is ready) uses only the screen
      tier or memory of it.
- [ ] Proofs in the style of the existing fog-fair tests: perturbing an off-camera enemy's health or type does not
      change the AI's next actions; the same perturbation on camera can (negative control).

### Phase 2: attend

- [ ] One virtual camera per seat with a position. Moving it costs time: panning at the client's pan speed, jumping
      by minimap click, by alert (Space) or by double-tapping a control group, each with human latency.
- [ ] An attention scheduler over concerns (each fight, base and production, expansion, scouting, idle units,
      support ready). It looks at one concern at a time, stays for a while, and pays a cost to switch. Alerts and
      minimap changes raise urgency. Under load it slips like a person: during a big fight, production and expansion
      wait.
- [ ] Orders go only to units on screen, to a recalled control group, or through a minimap right-click (coarse). An
      order to a unit far from the camera without one of those is impossible by construction, and a test proves it.

### Phase 3: decide

- [ ] `plan()` stays view-only. Decisions for a concern are made while it has attention, from what the tiers allow.
- [ ] Deliberation takes time, more for harder choices and lower skill. The opening is a real opening: the AI looks
      at its base and the map for a few seconds, then gives its first orders one group at a time.
- [ ] Bounded rationality: score the options and choose with seeded noise (for example softmax) whose temperature
      depends on difficulty, so Easy makes plausible mistakes. Never choose what a person would read as a bug: a lone
      unit walking into the enemy base, units turning back and forth, an order given and cancelled again and again.
- [ ] A persona per match from the seeded RNG (for example aggressive, defensive, armour-first, infantry mass,
      support-heavy), with build-order families and variations. It keeps its persona but adapts to what it sees.
- [ ] Estimates instead of exact numbers: enemy strength comes from what was seen, with uncertainty, so the AI can be
      surprised and can misjudge a fight.
- [ ] Commitment and hesitation: it sticks to a plan, sometimes pauses at the edge of a fight before committing, and
      pulls back as a group when the fight turns.
- [ ] Human slips, with frequency set by difficulty and seeded: an idle unit off screen goes unnoticed for a while,
      MP piles up while it is busy fighting, a flank is answered late.
- [ ] Mood: more careful after a heavy loss, greedier when ahead, within limits.

### Phase 4: act (the hands)

- [ ] An input executor (for example `shared/ai-hands.js`) between decisions and `command()`. Every decision becomes a
      sequence of human inputs: camera move, select (box drag, click, group recall), order (right-click, attack-move,
      ability key plus click), buy click, building placement. Each input takes time from a motor model (reaction,
      Fitts' law for pointer travel, keystroke time). Inputs are released on the tick their time comes, through the
      existing `submit` / `command()` path.
- [ ] At most one command per seat per tick, and each command carries what one human input produces: one formation
      move for the whole selection, built with the same formation code the client uses (move the client's
      `formation()` into `shared/` if needed so both use one function).
- [ ] Click precision: target points scatter around the intended spot following Fitts' law (more error for long,
      fast moves and small targets; minimap clicks are coarse), and snap where the client snaps (clicking a unit or a
      building).
- [ ] Control groups: the AI sets and recalls groups like a player, with human group sizes and mixes.
- [ ] An APM budget per difficulty that counts the same inputs a person makes (camera moves and selections count),
      with short bursts allowed in fights.
- [ ] Stale inputs: when the world changes before an input fires (unit dead, target gone), the hand behaves like a
      person (a wasted click is fine; `command()` already rejects invalid orders).
- [ ] Handover: an AI taking over a human seat first looks for at least 1.5 s and builds its own groups.
- [ ] The Horde wave director stays scripted (a Wave is not a player). Decide whether the Horde seat's support calls
      and co-op AI teammates go through the hands, and write the boundary down in DESIGN.md.
- [ ] Server integration: the hands run every tick (cheap), decisions run when attention arrives at a concern (or on
      the look schedule, if you keep one). Update `server.js`, `tools/ai-balance.mjs`, `tools/bench*.mjs` and any other
      caller.
- [ ] Determinism: all randomness comes from a seeded RNG per seat (match seed plus slot). No `Math.random` in
      `shared/ai*.js` or the hands. Same seed, same input log.

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

- [ ] An input log per AI seat: every input with tick, kind, camera position, number of units selected, target, the
      event it answers and its latency, and the concern it served. Off by default, on in tools and tests. It holds
      nothing the seat could not know.
- [ ] `tools/ai-humanity.mjs`: runs seeded AI matches (and can read recorded human logs) and prints every measure in
      the table above plus commands per tick, camera jumps per minute, dwell time per cycle, actions per cycle, time to
      first buy, floating MP, unnoticed idle time, opening variety across seeds and cross-map orders within one
      second. It writes a JSON report under `docs/`.
- [ ] A spectator and developer overlay: each AI seat's virtual camera rectangle and a ghost cursor that travels
      between clicks, with click markers like the human move marker. Off for players. Check the spectator rules
      (DESIGN.md, `test-engine-spectators.js`) so the overlay reveals nothing a spectator could not already see.

### Phase 6: calibrate from real people

- [ ] An opt-in, local human input recorder (server flag or environment variable) that logs the same measures for
      human seats from the commands they send. If it needs a camera beat from the client, keep that opt-in, local and
      never sent to other seats.
- [ ] `tools/ai-humanity.mjs` can fit the hands' timing distributions from those logs. Commit the literature defaults
      now, and document in DESIGN.md the one command Julio runs after playing a few matches to calibrate to how he and
      his friends actually play.

## Verification gates (all must pass)

- [ ] `node test.js` passes, plus every `test-engine-ai*.js`, `test-world-observation.js` and any test that calls
      `think()`. List what you ran with the results. If an existing test encodes superhuman timing (for example it
      expects orders on the first look), change it to the human contract and say so in the PR. Never weaken an
      assertion only to make it pass. Keep a way to test the decision layer without the hands.
- [ ] The fog-fair proofs pass, plus the new perception-tier proofs.
- [ ] New tests: one command per tick per seat; nothing before the opening look ends; the reaction floor; APM caps;
      camera locality (no order to an off-screen unit without a group recall or minimap order); seeded determinism;
      the handover pause.
- [ ] `tools/ai-humanity.mjs` numbers fall inside the table for each difficulty over at least 20 seeds per difficulty
      on Conquest and 10 each on Classic and World Conquest. The numbers go into DESIGN.md.
- [ ] Opening variety: over 20 seeds per faction, at least 3 distinct openings and none in more than half the
      matches.
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
- [ ] Final report to Julio in Spanish: what changed for a player, the key numbers, and what is left for later.

## Out of scope

Unit stats and economy numbers (tune the AI, not the game), new modes, models and art, UI work beyond the developer
overlay, and putting a language model in the game loop.
