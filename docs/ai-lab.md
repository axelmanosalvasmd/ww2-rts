# AI sandbox

Use the sandbox to reproduce a commander problem in seconds. It runs the real simulation, normal delivered views, default commander, timed hands and authoritative command validation. It does not run a direct planner shortcut or score an acceptance population.

Start the separate static server:

```sh
node tools/ai-lab.mjs --serve
```

Open `http://127.0.0.1:3048/tools/ai-lab.html`. Choose a scene, difficulty and seed. Advance one tick or 1, 10 or 60 simulated seconds immediately, or run at normal playback speed. Pause and scrub the recorded ticks to compare camera attention, public events, motor starts/completions and accepted or refused commands.

Choose `armor-pressure` with seed 1 and advance 30 simulated seconds to inspect ordinary rifles under real tank fire. Their weapons and grenade cooldowns use native defaults. The tank starts firing after 12 seconds through an authored opponent stance command; the first real projectile hit arrives at tick 244. Selection and retreat use the ordinary paid input path. This is a direct diagnostic scene, not a reaction acceptance score.

Edit units, positions, health, cooldowns, postures, resources and the initial camera. Add or remove units. Full scene JSON also supports objective points, 96 terrain rows and scheduled stimuli. Applying any edit creates a fresh case at tick 0 and clears its old trace. Export the trace before changing a case when you want to retain it.

The author debug toggle shows the current authoritative world, clearly labeled. Ordinary drawing and state panels use actual perceived screen units, anonymous enemy minimap dots and selected HUD information. The editor's raw graph never reaches the planner. Turn on author debug and click the map to place the selected authored unit.

Scheduled `hit` changes authored health and emits a hurt cue through normal delivered snapshots. `hurt-cue` emits only a cue. These are labeled author injections, not simulated gunfire. Target IDs are shown in the author unit selector. `weapon-release` issues an ordinary stance command to enable firing. It changes no health or cooldown and emits no hurt cue; subsequent damage comes from actual weapon simulation. The unseen-fire preset uses actual opposing MG fire instead. All opponents in these small scenes are passive commanders; their automatic engine combat remains real.

Save scene JSON from the editor to repeat a custom case in the CLI:

```sh
node tools/ai-lab.mjs --list
node tools/ai-lab.mjs --scenario armor-pressure --level hard --seed 1 --seconds 30 --out /tmp/ai-armor-pressure
node tools/ai-lab.mjs --scenario guard --level hard --seed 42 --seconds 20 --out /tmp/ai-case
node tools/ai-lab.mjs --scene /tmp/scene.json --scenario guard --level normal --seed 42 --seconds 20 --out /tmp/ai-custom
```

CLI runs accept 1 through 60 simulated seconds. Interactive sessions accept up to 600 simulated seconds, 48 units and 32 scheduled author cues. Reports preserve native inputs and command receipts. They include linked event-to-input timings for debugging, with no population labels or pass/fail reaction score.

`report.html` is a standalone replay, while the live sandbox is the scene editor and iteration loop. `report.json` includes source hashes for the six primary engine/commander modules. Reload the browser after changing source code; restart a long-lived Node caller to reload its imported modules.

Use `--root DIRECTORY` to run a different checkout. Static serving exposes only the lab browser files, that checkout's shared JavaScript and its `client/keys.js` keyboard definitions. It defaults to loopback; `--host IP --port NUMBER` can expose this developer tool to a chosen interface. It adds no game-server route.

The browser-neutral runner exports `createAIcase({sim, ai, perception, hands, view}, options, authoredScene)`. Its returned case provides `advance(ticks)`, `record()`, `tick` and a separately named `authorView()` for debug tools. `advance` accepts 1 through 1200 ticks at a time and returns a detached report. It scopes seeded engine randomness to each synchronous create/advance operation and restores the caller's random function afterward.

Verify the lab:

```sh
node test-ai-lab.js
```
