# World Conquest verification

Passed locally: `node test.js`, `node test-world.js`, both standalone World Conquest WebSocket suites,
syntax checks for changed JavaScript files, and `git diff --check`.

The shipped presets use 64-cell regions with two metres per cell. Huge contains 64 regions on a
1,024 by 1,024 metre map. Massive contains 128 regions on a 2,048 by 1,024 metre map. Generation validates
ground connectivity between every capture centre before the match starts.

`test-world-conquest.js` uses two real WebSocket clients to check hidden spawns and regions, destruction
before claiming, infantry occupation, hostile guards remaining hostile, paid construction and training,
queue ownership, and paid HQ and Engineer recovery. Fixtures place combatants near the objective to avoid
waiting for a cross-continent march. Actions and assertions use the same protocol as the browser.

`test-world-teams.js` uses real teammates, a rival, a spectator and a lobby AI. It checks shared discovery,
remembered regions, spectator fog, exact Massive dimensions, HQ survival rules, last-region elimination,
total-conquest victory and AI scouting. The main `node test.js` suite invokes both files.

Local in-app browser checks on 2026-10-03 loaded both enlarged presets and exercised the camera from the
battlefield to the whole-world paper map. Both reported no console warnings or errors. After initial loading,
the stats overlay showed 59.9 FPS in Huge at the home base and 55.9 FPS in Massive at the whole-world view.
These are individual observations with the starting forces, not sustained late-game benchmarks.

The 45 to 60 minute match target, balance between factions and sustained performance with large armies still
need multiplayer playtesting. The automated AI check demonstrates scouting; it does not complete an AI match.

The full specification has broader acceptance coverage than these initial tests. Dedicated checks for contested
recapture, income and capacity loss, relocation after losing a home, multi-seed starting fairness and reconnects
after remote terrain changes remain. Those checks and representative large-army performance runs remain
merge gates for the full specification.
