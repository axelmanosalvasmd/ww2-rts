# World Conquest verification

The final full local regression run was stopped at the user's request. GitHub CI runs `node test.js` and
`node test-world.js` on its runner. Focused acceptance, observation, movement and river checks were run locally;
the fixed-seed river check failed with bank recovery disabled and passed with it restored.

The shipped presets use 64-cell regions with two metres per cell. Huge contains 64 regions on a
1,024 by 1,024 metre map. Massive contains 128 regions on a 2,048 by 1,024 metre map. Generation validates
ground connectivity between every capture centre before the match starts.

The main `node test.js` command runs the following real WebSocket suites, each with a fresh authoritative
server. Fixtures position combatants and advance simulation time; player actions and assertions use the
same commands and filtered messages as the browser.

- `test-world-conquest.js`: hidden homes and regions, destruction before infantry claiming, hostile guards
  remaining hostile, paid construction and recruitment, queue ownership, paid HQ and Engineer recovery.
- `test-world-teams.js`: shared discovery, remembered regions, spectator fog, exact Massive dimensions,
  HQ survival, last-region defeat, all-region victory and lobby AI scouting.
- `test-world-acceptance.js`: contested capture, production-locked recapture, construction territory denial,
  income and population-cap loss, existing excess troops preserved, team home relocation and retreat,
  reconnect terrain memory, hidden remote terrain changes and crossing Classic's deadline. Three seeds per
  preset cover two and six seats, independently checking infantry/vehicle connectivity and usable homes.
- `test-world-observation.js`: unseen regional contests, progress and claimants remain remembered while
  genuine ownership loss is delivered; AI approaches remembered blocking production and attacks on rediscovery.
- `test-world-movement.js`: long orders retain their clicked destination, undiscovered terrain cannot change
  delivered plans, ordinary collision rules and route completion, queued moves, stop and long retreat.
- `test-world-river.js`: Rifle Squads and Light Tanks scout a generated ford and complete their original
  cross-river destinations, including recovery after stopping against a newly discovered bank.

The public-lobby suite requests the browser entry modules and their local dependencies through HTTP.
`node test-world.js` separately checks water geometry and shared fog uniforms. Browser checks cover actual
module initialization, rendered fog, the camera and whole-world paper map; renderer tests alone cannot prove
those behaviors.

The grown-army stress method, measurements, hardware and limits are recorded in
[the performance report](world-conquest-performance.md). It uses six real socket seats and paid production
commands, with artificial resources and accelerated training to prepare 64 mobile units per seat. That roster
is a stress fixture. Normal matches still start with one HQ, one Engineer Squad and one Rifle Squad per player.

The 45 to 60 minute Huge match target and faction balance need natural-start multiplayer playtesting.
Prepared AI expansion demonstrates fighting, claiming and recruitment, without establishing naturally
earned late armies or a completed match. Remote networks, many concurrent rooms and long-session memory
growth also require separate measurements.
