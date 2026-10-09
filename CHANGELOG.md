# Changelog

What changed in the game, newest first. Player-facing changes lead each entry; balance numbers come from
AI-vs-AI runs (see DESIGN.md for the balance log). Add new entries under **Unreleased**.

## Unreleased

- Performance work beyond issue #58, with the game itself unchanged (the 6-AI Massive Classic and Conquest benchmarks
  end in exactly the same state as before):
  - Loading is lighter for friends joining over Tailscale. The server now gzips scripts and other text (three.js goes
    from 1,458 KB to 288 KB; the game's 9.5 MB of scripts come to about 4.7 MB) and answers a reload of an unchanged
    file with a 304 instead of sending it again (an ETag from the file's size and time). Images and sounds are unchanged.
  - Big battles draw with less work per frame. Each squad's men now stand in one group that three.js skips entirely
    once they are drawn instanced (they were hidden only by a camera layer, so every pass still walked them). In a
    scene of 200 rifle squads and 60 tanks each pass (the camera, the shadows and, on High, the ambient occlusion
    normals) walks 2,061 objects instead of 11,261. The ambient occlusion pass's own walk over the scene now skips
    hidden branches and allocates nothing per object: 4.1 ms to 0.6 ms a frame there (headless, machine under load).
  - Shadows are drawn at most once a frame and at most every 25 ms: about 30 times a second at 60 fps instead of 60 on
    Low and 120 on High, where the ambient occlusion pass's second render of the scene drew them again for nothing.
    Below 40 fps, and in the operative's eye-level view, they are still drawn every frame.
  - The first explosion, corpse or selection ring of a match no longer compiles its shader on the frame it appears:
    after the match's first snapshot the game compiles every shader in the scene in the background and uploads the
    loaded textures. All 43 ground unit types share about six materials, so the units on the field cover those still to come
    (building one of each type to warm them up would cost about 8.6 s per faction).
  - Joining before the ground textures arrive no longer freezes the game when they do: the textured ground comes in
    tile by tile within the frame budget. A full repaint takes 290 to 615 ms of script on the default, Kasserine Pass,
    Six Fronts and Three Islands maps. The paint at match start is still done at once, while the match loads.
  - Route regions are recomputed far less often. A player's remembered-terrain path view moves its region versions for
    any remembered change (wear, cover, a crater's material), and each move redid a whole-map flood fill.
    `regionsFor` now first checks whether any cell's blocking or height changed. Over 4,000 ticks of the 6-AI Massive
    Conquest benchmark the fills fell from 1,922 to 305, from 1.37 s to 0.23 s.
  - Crowd separation and the off-map strikes moved out of `step()` into their own functions (`separateCrowds`,
    `stepStrikes`), which V8 optimizes on their own; separation alone was about 10% of step time. With the region
    change above, 8,000 ticks of the 6-AI Massive Conquest benchmark spent 5.0% less main-thread CPU (164.2 and 164.5 s
    against 172.8 and 173.2 s; two copies of each version stepped side by side in one process, and the copies agreed
    within 0.3%). How much of that each change gives was not measured: that run was stopped when the machine ran low
    on memory.
  - `applySnapshot` builds the view `productionAccess` needs once a snapshot instead of once per unit. Handling only
    the unit rows that changed was measured and left out: a player holds about 37 rows in that battle and 57% of them
    change every snapshot.
  - Tests: the ground check that pinned the old full repaint on texture arrival now checks the queued one. Two checks
    that read code structure follow the moves: the separation check splices its reference in place of the
    `separateCrowds` call (and now says so when its markers are gone), and the crew-served gun check skips the crew
    group when it looks for the gun's mesh. New checks:
    scripts are gzipped and revalidate with a 304 (test-public-lobby.js), the shadow map is drawn every other frame at
    60 fps (test-client-performance.mjs), and three.js skips the drawn men's own meshes (test.js, unit models).
  - Not verified in a browser: the wmux browser panel drew no frames this session, so the shader warm-up, the shadow
    cadence and the hidden crews were checked only headlessly. Found and left for later: `step()` never stays
    optimized, since V8 throws its optimized code away dozens of times a match ("wrong map": units gain properties as
    they play); giving units every property at spawn is the fix. Ambient occlusion at half resolution was not tried
    (it needs a visual check). Crowd separation's search radius is not its cost: its queries return 1.6 units each.

- Classic balance re-measured over 60 free-for-alls with the 40-minute limit: USA 37%, Germany 35%, USSR 28% of
  decisive matches (three draws), all inside 25-42%. The earlier 30-match reading of USA 43% was noise.

- World Conquest snapshots cost less than half as much (no game change): deciding which burning cells and smoke
  clouds a player sees now asks only the units that could reach each spot, not every unit on the map. Burning cells
  were 94% of that visibility work on the huge map. Four simulated minutes of a three-player World match spent 29.9 s
  building snapshots before and 12.6 s after (the whole simulation 41.0 s and 22.8 s). Output checked identical against the full check in 144 snapshots (1,716 burning
  cells, 93 smokes). The bucketed unit lookup that terrain updates already used is now shared (`eyesFor` in sim.js).
- Eleven more room-test files connect through in-memory sockets (`memoryConnect`, which now also supports
  `pause()`/`resume()` for the delayed-receiver check), so they no longer depend on network timing. The public lobby,
  compressed-snapshot and backpressure checks keep real WebSockets on purpose.
- The fire check places an observer next to the burnt cell before asserting the client is told about it. It failed
  once on CI when the original squad had died or wandered off during the fire.

- Training is easy to see. A selected Classic or World Conquest building shows its queue as five slots: the unit in
  training fills its slot in brass, with "Training Rifle squad, 6 s left" above; waiting units follow (click one to
  cancel it for a refund) and free places stay empty. Before, it was one line of text and a list of cancel buttons.
  A building that is training also shows its progress in the bar over it on the map, and a building's line in the
  selection list turns brass with its progress underlined. `test-engine-controls.js` now checks the new queue
  sentences translate instead of the old cancel button's.
- UI scale: a slider in the menu (75% to 150%) makes the panels, buttons and text bigger or smaller. It applies when
  you let go of the slider and is remembered by the browser. Left for later: the lobby and the Controls sheet keep
  their size.
  Found, not looked into: `test-world-conquest.js` "engineers can raise a forward HQ on conquered land" fails about
  one run in four on master as it was (4dffcce), so it is flaky.
- Howitzers, bombers and other explosives no longer flatten an HQ or other base building in seconds. An explosion
  hit every map cell of a building it reached at full strength (a 3x3 HQ has nine), and any heavy shell could set a
  building alight, after which the fire burned it down on its own about half the time. Now an explosion hits a
  building once, for at most its listed demolition value (150 for a howitzer shell, 250 for a bomb), and base
  buildings, walls and gates don't burn (houses, hedges and fields still do). One attacker against an undefended
  full-health HQ, before / after: a howitzer at 80 m 54-78 s / 5-6 min; a bomber 13 s (its first stick) / one full
  sortie leaves 30-40% of the HQ; a rocket truck at 60 m 23-44 s / 84-104 s; a mortar at 50 m 2.5-3 min / 8.5-9 min.
  Command bunkers (Assault, Annihilation) were never affected, and nothing changed against troops: a howitzer still
  wipes a rifle squad standing in the open 60 m away in about 1-2 minutes. New check `Explosives vs base buildings` in
  `test.js`. Left for later: the rocket truck is now the quickest way to knock an HQ down.
- Fixed: a tank (or tank destroyer, or any direct-fire gun) told to fire at a house cell with more of the same house
  in front of it drove up beside the house and sat there for good, never firing. It needed a clear line to that exact
  cell, which its own walls always block. About a third of all house cells on the maps (3,553 of 10,970) are walled in
  on four sides, and the AI orders its tanks at whichever cell an enemy squad is garrisoned in, so AI tanks parked
  this way too. Now the gun fires when the first wall in the way belongs to the same house or building: the shell
  hits that wall, and once it breaks the next one goes deeper. Area fire also aims halfway up the target (1.2 m on a
  house) instead of at its foot, so shells no longer burst on the rubble of the wall in front. A medium tank 20 m from
  a 3x3 house block, firing at its middle cell: 0 shots in 90 s before, the cell down in 5 shots after. Attacking
  an enemy HQ you can see was never affected. `Tank shells` in `test.js` now also checks the middle of a house block.
- Operative shots hit the soldiers you see. A squad in the open is now its drawn men, each a 0.45 m body on the
  formation slot the client draws (slots moved to `shared/squad-men.js`, shared by client and server, with a lag
  of speed/9 for marching men). Before, a squad was one 1.2 m cylinder at its centre, so the end men of a rifle
  block could not be hit and shots into empty ground inside it could. The man you hit is the one who falls; the
  last man of the block steps up into his place. Damage numbers are unchanged. Squads in a trench or a house
  still use the old single body (the client seats trench men itself). The operative is now drawn on his own
  position instead of the front-left slot of a rifle block, 1.9 m off his hitbox.
- Operatives can lead a squad: F picks the commander's nearest infantry squad within 8 m, which attack-moves to
  4 m behind the operative as he goes. F again, or any order from the commander, lets it go. While it has two or
  more men, a dead operative comes back after the usual 8 s as one of its men (the squad loses a man, no MP)
  instead of walking up from the HQ. The HUD shows the squad and its men.
- Merged onto master: the operative's snapshot flag moved from bit 65536 (now the open-gate flag) to
  `OPERATIVE_FLAG` 131072; the branch's own fixture fixes gave way to master's `clearFixtureUnits` ones.
- Left for later: the man a squad gives up for the operative drops as a corpse on the client; the per-man body
  ignores kneeling and prone poses (a pinned squad is as tall as a standing one).

- WIP branch publication: FPS simulation, multiplayer, native-browser death/respawn/reconnect and public HTTPS/WSS acceptance checks pass. The full `node test.js` gate is not passing: AI full-match story and seeded capture assertions remain unresolved. Published as a user-authorized WIP exception, not a release or approval to merge.

- Added an isolated commander plus first-person infantry MVP. Teammates attach to a human commander's army without taking an army seat. Desktop WASD, native mouse aim, hold-click rifle fire, crosshair, HP, hit/damage feedback and a ground-level rifle view use the same terrain and authoritative battle as the RTS.
- Operatives have one soldier's 20 HP and 4.5 m/s movement. Their rifle deals 6 infantry damage, reaches 36 m and fires at most once every 0.65 s. Death waits 8 s and spends 10 commander MP to replace the soldier, or waits for sufficient MP. The first soldier is free.
- Server input validation rejects stale/replayed/non-finite/out-of-bounds input; movement obeys infantry terrain and cliffs, and shots use server-side aim rays, visibility and obstruction checks. Operatives cannot issue army commands and commanders cannot redirect their controlled soldier. Disconnect stops input without pausing the army; refresh restores the companion identity. No spectator fog lift is used.
- Added lobby role choice, commander selection, dedicated teammate FPS links, a separate in-match FPS tab button and desktop-only instructions. RTS controls, normal spectators and existing unit type indices remain intact. World Conquest is intentionally unsupported for companions in this MVP.
- Fixed the start/snapshot race: clients receive battlefield initialization before simulation snapshots. Fixed focused FPS buttons swallowing WASD after mouse capture, short input disappearing on slow rendering, and own-model visibility being restored by network snapshots.
- Added simulation, socket, desktop input, real-browser and public HTTPS/WSS acceptance scripts. Isolated demo launcher uses a separate loopback port and temporary Cloudflare HTTPS tunnel. This is a preview, not permanent production hosting.
- Browser acceptance now uses a connected enemy commander instead of a disconnected disabled AI, preserves absent-player authority checks, targets the exact native input window, waits for actual movement and verifies refresh keeps the respawned soldier. Combat regression fixtures use existing producer/terrain cleanup helpers rather than relaxing production rules.

- Drills (no game change): small authored scenes for AI behaviour questions, played on the server's AI schedule.
  `drills/drill.js` places a drill's units on a small map, runs its timed script and returns its measure;
  `node tools/drill.mjs drills/<name>.js --seeds 200` runs one across seeds. The first drill, `drills/flank-answer.js`,
  hits two squads with the camera on the fight or elsewhere: 100 seeds per level take about 13 s and give answer
  medians of 0.85 / 0.55 / 0.25 s on screen and 3.5 / 1.65 / 1.0 s off screen (Easy / Normal / Hard), every hit
  answered. The commander test now uses it instead of its own hand-built scene (121 lines down to 68).
  `playMatch` gains `setup` and `beforeStep` hooks.

- Enemy commanders now play like a person at a keyboard (issue #48). Each AI seat has its own camera and only plans
  against enemies it has looked at, notices damage on screen after a reaction time and off screen after an alert,
  and gives orders through timed clicks and keys, at most one command per tick, under per-difficulty input caps.
  Difficulty changes speed and attention only. The targets were revised (DESIGN.md, "Human-like commander"): Hard
  may peak at 300 APM instead of 200, and strength is judged against the old Hard AI, since the old "Hard beats old
  Easy 14 of 20" target was out of reach for the old Hard AI too (it wins 36 of 60). Measured: every timing band met;
  Normal beats Easy 41-18 and Hard beats Normal 36-24 over 60 duels; new Hard beats the old Easy AI 34-26, the old
  Hard AI 36-24. Conquest balance over 60 matches: USA 28%, Germany 33%, USSR 38%. AI cost per tick falls by half
  (95th percentile 0.71 ms against 1.30 ms). The Horde wave director keeps the scripted planner. Replaces PRs #49 and
  #50 with a smaller design: `shared/ai-human.js` plus one test file.
- `tools/ai-balance.mjs`: an `old:` seat plays the scripted planner, and Classic free-for-alls get 40 minutes (both the
  old and the new AI ran past 20). Classic balance, 30 matches: USA 43%, Germany 29%, USSR 29% (old AI on the same
  seeds: 33 / 43 / 23%). `tools/ai-human-report.mjs` measures the commander's timing.

- Room checks in `test.js` no longer use the network or wall-clock sleeps (no game change). Their clients connect
  through in-memory sockets (`memoryConnect` in `test-socket.js`) that deliver each message at once in both
  directions, and the harness serves map files from already-resolved promises, so a reply is there as soon as the
  server's handler finishes. This removes the lobby-read races seen when tests run side by side (a check read the
  lobby before the reply arrived). Two full suites run at the same time pass.

- AI tools now play the AI that players face (no game change). The server's per-tick AI schedule moved into
  `shared/ai-schedule.js` (`aiTick`), and `playMatch` runs a seeded headless match on it. The server, the balance,
  bench and Horde tools, the skirmish scenario tool, the map editor's spawn fairness worker and the full-match test
  all use it. Before, each kept its own copy: the balance tools observed every seat every 2 ticks (about 1.5 times
  the per-tick cost, and different AI sighting memory than the server), the bench, Horde and skirmish tools thought
  without a delivered view, and the Horde tool never ran the Horde seat's own AI. `tools/ai-balance.mjs` now plays
  12 Conquest matches in 43 s instead of 147 s on 6 workers, and the balance tools default to all cores but one.
  `tools/horde.mjs` runs are seeded (run r uses seed r). Balance numbers measured before this change came from the
  old tool schedule; re-measure before comparing.

- The test suite runs in about 2 minutes instead of about 15 (no game change). Its 270 inline blocks are now named
  checks (`test-check.js`): run one with `WW2_TEST_ONLY=<name>`, and a failure no longer stops the run, the summary
  lists every failure. `node test.js` splits itself across processes and runs child files in parallel, then runs
  the performance budgets alone. The AI fog proof, 8 of the 15 minutes, now plays one seed and compares every sixth
  AI turn by default (375 paired turns); `WW2_TEST_SLOW=1` restores the full two-seed proof of every turn,
  which CI runs nightly. CI runs three shards and a performance job in parallel.
- Fixed three timing races in room tests that showed up when tests run side by side: a sent order could reach the
  server after the clock was stepped (eight harnesses now use `sendsReadBy` from `test-socket.js`), and two harnesses
  accepted a snapshot up to two ticks old, so a later read could sample a different tick. The room lifecycle check now waits for
  the lobby reply it asserts on.

- World Conquest: Engineers can now build extra HQs (200 MP) on land you own. Damaged squads retreat to the nearest HQ instead of marching home, and each HQ trains Engineers.
- World Conquest: local defenders are no longer just two rifle squads everywhere. Rural regions add an MG, cities hold rifles, an MG, an AT gun and a mortar, industrial works field an AT gun and an armored car, and mines keep an MG and a mortar. About 3.5 guards per region instead of 2, so watch server tick on Massive.
- World Conquest: regions have real place names (Falkburg, Dornburg Works, Brayford Mines) instead of "City 12" or "Province 3".
- HQ tiers and the Armory (Conquest, Assault, Annihilation, Horde and Classic). Every commander starts at Platoon HQ with the Barracks infantry: rifles, conscripts, flamers, MGs, medics and snipers. Select your HQ to upgrade it: Company HQ (250 MP, 60 s) unlocks the Motor Pool, Shipyard and Armory, light vehicles, light tanks, AT guns, mortars and flak; Battalion HQ (400 MP, 90 s) unlocks medium and heavy tanks, tank destroyers, rockets, howitzers, the Airfield and planes, Rangers, Commandos and the destroyer. The tier stays yours if the HQ falls, and research pauses until you have a finished HQ again. The new Armory (150 MP, 30 s, needs Company HQ) researches Infantry Weapons, Vehicle Guns and Vehicle Armor, three levels each (100/175/250 MP, 30/45/60 s): +10% damage or 10% less damage taken per level, for units already in the field too. Level 2 needs Company HQ, level 3 Battalion HQ. Classic also charges Munitions. Horde defenders start at Company HQ. Cards above your tier say which HQ they need. The AI upgrades from 2:00 and 6:30 and researches with spare MP. AI 1v1 Conquest (default map, 8 matches): 6/2 and about 6.5 minutes a match, Company HQ around 3:30 to 4:00; matches end before Battalion HQ. Hill 112 Assault: Battalion HQ at 9 to 10 minutes, defender 4/4. Found and left for later: AI Conquest matches end around 6 to 8 minutes, so Battalion HQ (planned for 8 minutes) rarely matters against the AI; human playtests should decide whether to cheapen it.
- Selecting one of your finished production buildings in Conquest, Assault, Annihilation or Horde now opens its recruit group right away, with the card letters live (HQ and Barracks open Infantry, Motor Pool Vehicles, Airfield Aircraft, Shipyard Naval). Deselecting it closes recruit mode again. Classic and World already did this.
- Fixed long black streaks and dark bands across the battlefield on Graphics High (most visible on El Alamein). The new ambient occlusion pass drew see-through things (capture point rings, labels, fog, the haze past the map edge) as solid walls and shaded the ground behind them. It now skips sprites and see-through materials, like it already skipped points and lines.
- Four new maps after real battles (`tools/genmap-history.mjs`), each opening with a line that sets the scene. Prokhorovka (Conquest, 120x90): open steppe for tanks around Hill 252.2, with an anti-tank ditch crossed only at three causeways, a railway embankment, ravines to flank through and tree belts as the only cover. Hurtgen Forest (Conquest, 110x100): dense woods cut by firebreaks, dragon's teeth, and the Kall gorge down the middle, crossed only by the trail bridge and two fords (the ford points sit in the water, so nobody owns them). El Alamein (Assault, 140x100): two belts of minefields and wire with gaps that don't line up, a coast road through a wire gate, then Miteirya Ridge. Seelow Heights (Assault, 110x120): a muddy floodplain and canal, then an escarpment you can climb only at the three roads, with Seelow on top behind three trench lines. Both Conquest maps are point-symmetric. AI 1v1 over 30 matches: Prokhorovka 16/14, Hurtgen Forest 17/13. Assault attacker wins over 21 AI matches: Seelow Heights 1/21, El Alamein 0/21 (with a 40-minute clock only 2/21, so the clock stays at 30 minutes). Found and left for later: today's AI rarely wins as attacker on any assault map (Hill 112 4/14, The Great Bridge 2/14, Seawall 1/14 over 14 matches each, well below the numbers in DESIGN.md), so the assault AI needs a look before the new assault maps can be tuned further.
- Grass is no longer one even yellow-olive with a repeating pattern: meadows now shift between lusher green hollows and drier yellow rises 10 to 50 m across. Dirt, roads and mud keep their color; Graphics Low skips it.
- Art pass. Units stand out from the ground: tanks, guns, planes and soldiers get a faint sky rim along their edges, so an olive tank no longer melts into the grass. On Graphics High the battlefield gets ambient occlusion: soft shade under trees, hulls, walls, sandbags and buildings, so they sit in the ground instead of floating (turn it off with `?ao=0`; Low skips it). Shelled ground is churned brown earth instead of near-black blobs, and shelled hills no longer show flat tan stepped patches. Not measured: the frame cost of the occlusion. Left for later: flying wall debris as flat black slabs, stepped shadow edges, the even grass color, pale dead soldiers (see DESIGN.md, Art pass).
- Fixed Horde tanks jamming for minutes at the gates on Stalingrad Factory and Bastogne. Waves now walk on 16 m inside the map along their route (Stalingrad's gates sat in a 6 m strip on the map edge), a vehicle boxed in by friends for 3 seconds ghosts through them (before, only a traffic wait did, not friends physically in the way), and a tank walled in a narrow street that can neither turn nor back up slides up to 1.5 m sideways to where it can turn. Late armor Horde waves, vehicles making no progress toward the bunker after a minute without fighting: Stalingrad Factory 91% to 1%, Bastogne 24% to 1%, Hill 112 66% to 0%. Ghosting now covers allied units as well as your own (teammates share one HQ spawn in Horde); enemies still always collide. Tried and dropped as no help: holding units at a full gate, stopping only the vehicle that drives into another, and shorter back-up moves.
- Units no longer spawn on top of each other and lock up. Every new unit (Horde waves at their gates, reinforcements at a plain spawn) now steps out to its own spot with room to turn, and passes through friends for its first 4 seconds. Friendly vehicles that jam each other for 3 seconds also ghost through for 2 seconds, so a crowded gate or street clears instead of freezing. Enemies still collide. In late armor Horde waves, the share of units still stuck at their gate after 20 s fell from 51% to 0% on Hill 112, 86% to 44% on Stalingrad Factory and 50% to 36% on Bastogne. Left for later: on Bastogne and Stalingrad some tanks near the map edge turn on the spot with nothing blocking them, a separate steering bug.
- Fixed trenches and MG nests dug during a match showing only as a flat dirt strip, with no cut, walls or sandbags. The server dropped the change for any player who had a unit on the move at that moment (the movement code read the terrain first and used up the update), so the client never learned the cell became a trench. Reconnecting showed them. Older than the ping fix below.
- Fixed pings climbing to 10 s and beyond late in big fights. The server tick grew with the battle (3 ms at 66 units to 70 ms at 268 in a 2v2 Annihilation), and once it overran, snapshots piled up 3 MB deep per socket with pongs stuck behind them. Now a player whose connection is 256 KB behind skips snapshots and gets one fresh snapshot when it catches up, so a slow server or connection costs smoothness, not a minute of lag.
- The server does about 44% less work in large battles (CPU 119 s to 67 s over a 6000-tick Massive 2v2 Annihilation with the same result): remembered terrain no longer rechecks every pending crater for every player each tick, team sight checks no longer copy the whole unit list per cell, and vehicle traffic skips a sort it never needed. Path searches and crowd separation are the next biggest costs, left for later.

### 2026-10-09: Classic Munitions trickle and a fair El Alamein (`0f27ee2`)

- El Alamein is fair in Conquest and Classic. It was drawn for Assault, so in the other modes the east side's home
  points paid 5 VP and the west's none: in AI 2v2 Conquest the east won 60 of 60. The two Miteirya Ridge points and
  the station now pay no VP, like home points on other maps; Kidney Ridge in the middle pays 3; Tel el Eisa (now 1.5
  VP) has a west twin at the north gap of the first minefield (1.5 VP, 2 MP), so both sides earn the same VP and MP
  from home. AI 2v2 with supply on, same seeds: Conquest west 36 / east 24 over 60 (median match 12.5 min, was 9);
  Classic east 13 / west 12 with 10 draws over 35 (stopped at 35: Classic matches run up to 40 minutes and memory
  allowed two at once). Assault scores no VP, but its AI prefers higher-VP points and the north gap is a new
  attacker-side point: AI 1v1 attacker wins 15/20 before, 12/20 after on the same seeds, within noise.
  `tools/ai-balance.mjs` takes `--teams 0,0,1,1` for team matches and `--logistics` to play with supply on, as the
  lobby does. Found and left for later: El Alamein attackers now win 15 of 20 on the old map, where DESIGN.md had 0
  to 2 of 21, so the AI attacker has grown much stronger and the Assault maps need re-measuring.
- Fixed: in Classic, a side holding no point worth victory points earned no Munitions at all, and since refilling
  ammunition costs Munitions its units could not rearm. Found on El Alamein 2v2 (2026-10-09): the west side started
  next to a single 0-vp point, so in an all-AI match it sat at 0 Munitions for 8 minutes while its army's ammunition
  fell to 67%, against 2,500 Munitions for the east. Classic HQs now trickle 0.5 Munitions/s (like the 0.5/s Fuel
  trickle); in the same match the west keeps 6 to 64 Munitions and its ammunition at 99%. A full rifle reload costs
  about 0.6 Munitions, so the trickle rearms a whole army but buys only one smoke call a minute. Not measured over 60
  Classic matches: the trickle is the same for every player. `Fuel (Classic)` in `test.js` now also checks the
  Munitions trickle; `test-territory-supply.mjs` "refills cost Munitions" was rewritten to measure against it.
  Also found: with other sessions loading the machine, `test-world-acceptance.js` and `test-world-multiple-rivers.js`
  hit the suite's 180 s limit (127 s and 90 s alone) and `test-world-conquest.js` failed "engineers can raise a
  forward HQ on conquered land" once; all pass alone.

### 2026-10-08: World Conquest scenery (`be8dbf8`)

- World Conquest regions now look different from each other. Each region has a biome (farmland, pine, marsh,
  highland, orchard or steppe) with its own ground tint and scenery: hedgerows with gates in farmland, pine woods,
  marsh mud, orchard rows, reeds, dry steppe grass, rocky highlands. Cities have a church on a paved square and a
  town around it, industrial regions a brick works with a chimney and warehouses, resource regions a mine head
  (new landmark: 800 hp, 0.25x damage, garrison vision 1.5) under a steel headframe with spoil tips beside it.
  Farm hamlets fill the countryside. A seed keeps its rivers, roads, regions, homes and names. Biomes and landmark
  names reach a player only with the discovered cell.
- Battle scars last: known craters keep a crater mark on the ground in World Conquest, shelled ground shows as churned
  earth from the first hit (before it sinks), and a destroyed vehicle leaves a scorch mark under its hulk.
- Tests: new `test-world-scenery.js` (scenery leaves the geography alone, landmarks sit in their kind of region,
  biomes and landmarks arrive only with discovered cells); `test.js` gains a shelling-marks check and a scorch
  assertion in the wreck check. `generateWorldMap` takes `scenery: false` for the bare map.
  `test-ground-performance.mjs`: the pinned pixel hashes of the three fixtures with a burnt cell were regenerated,
  since burnt ground is now charred darker (the others are unchanged). `test-world-river.js`: its tank now starts
  east of the rifle, since its old spot on seed 4111514762 is inside one of the new houses.
- Fixed before release: a World map's spoil tips (rubble from the start) counted as battle damage, so supply through
  a resource region was a step weaker than it should be and engineers could "fill in" the heaps.

### 2026-10-08: World Conquest railways, transport and saves (`0ff7cc4`)

- World Conquest polish: railways, transport, saved games and a reachable win.
  - Victory: a side wins by owning 60% of all regions (`WORLD_TUNING.winShare`) or by being the last nation with
    land. A match with only one team still needs every region. The score bar counts toward the goal, and the
    epilogue says which way the match was won.
  - Railways: the generator lays stations in every home, city and industrial region and joins them with track on
    flat ground that crosses rivers only on bridges (`shared/world-rails.js`; a seed's terrain and regions are
    unchanged). Send by rail (Shift+N) puts up to 8 ground units within 30 m of one of your stations on a train to
    your station nearest the click. Every region on the way must be yours and its bridges standing; a train whose
    line is cut (land lost, bridge blown) lets everyone off where it stands. One train per station every 20 s.
    Nothing can be built on the track or in a station yard. Explored track and stations are drawn and shown on the
    minimap. Home stations stand 32 to 46 m out and track avoids the ground around each HQ, so every home keeps the
    same room to build (the World acceptance check caught rails taking 20 to 40 of 81 barracks spots near some HQs).
    The AI sends units by train for trips over 250 m.
  - Transport: new Troop Truck at the Motor Pool (110 MP, Classic 80 MP + 15 Fuel), unarmed, carries three
    squads. Tanks carry riders on the deck (light, medium and tank destroyer 2, Tiger and Churchill 3), drawn
    kneeling on the hull; riders take blast damage and jump down suppressed (60) as soon as the tank or a rider is
    hit. Mount up (Shift+Q) spreads the selected squads over the selected carriers; Unload empties every seat.
    `carries` is now a seat count; the halftrack's forward reinforcement moved to its own `reinforces` flag.
    The World AI buys a truck per six squads (at most three) and loads squads that have far to go.
    Measured over 2 all-AI Huge matches of 25 minutes (`tools/world-pacing.mjs`): first capture at 5.4 min, T2 at
    5.5 min, T3 at 14 min, about 6 of 64 regions per side at minute 20, no match finished; the AI rode tanks (up to
    6 squads at once) but took no train and bought no truck yet. Left for later: tune AI rail and truck use.
  - Road march: in World Conquest a unit that has not fought for 10 s moves 1.5 times as fast on its own side's land.
  - HQ tiers now apply in World Conquest too. World paratroopers need a finished Airfield within 300 m of the drop.
  - Saved games: the host can save from the match menu, and World Conquest saves itself every 2 game minutes (3
    autosaves and 10 manual saves kept per room, under `saves/`). The room's lobby lists its saves; loading one puts
    every seat back (AIs with their memory, humans by token or the next free player) and opens paused.
  - Tests rewritten for the new rules: `test-world-teams.js` now expects the last nation with land to win (it
    pinned "no winner while unclaimed land remains"); halftrack checks in `test.js` and `test-audit-combat.mjs` read
    `cargo` as a list. Test runs keep their autosaves in the temp folder (`test-check.js` sets `SAVES_DIR`).
  - Tests: `test-world-rules.mjs`, `test-transport.mjs` and `test-saves.mjs` (one check per behavior above).
    `tools/world-pacing.mjs` reports match length, tiers, land and transport use over seeded all-AI World matches.

### 2026-10-08: AI forward HQs, Horde late waves, sandbox, dig bar, bridge crossings, World discovery (`2ce5843`)

- Finished work left uncommitted on master by an earlier session (its Horde, sandbox, dig-bar and bridge-crossing
  changes were named as left out of the supply truck entry below). The stale changelog and DESIGN.md edits that
  came with it (older wording of already committed entries) were dropped. Files that had been saved with Windows
  line endings were put back to the repository's plain line endings.
- The AI now pushes the way players do: once its army stands 70 m or more from every HQ it owns, a builder squad puts
  up a forward HQ 20 m behind the army (never with an enemy in sight within 30 m, at most 3 HQs). Hurt squads then
  retreat to it and refill there instead of walking home. An Assault defender doesn't do it (its home is the front).
  AI 1v1 Assault, attacker wins over 20 matches before and after (same seeds): Hill 112 5 to 10, El Alamein 0 to 2,
  Seelow Heights 1 to 4. Conquest is unchanged: 12/20 and about 7 min a match.
- Measured whether retreat is too strong (taking 25% damage while retreating, 1.5x speed, auto-retreat at 35%
  strength). It isn't, for the AI at least: with 50% damage while retreating, or auto-retreat off, Conquest losses go
  up from 4.7 to 6.7 or 7.7 units a match, but winners and match length barely move (Hill 112 attacker wins 5, 8 and
  5 of 20). Left as is.
- Late Horde Waves get better instead of only longer. More units join the Horde: medics (Wave 4), halftracks (6),
  Rangers (9), snipers and howitzers (10), Commandos (11) and the Churchill (14). From Wave 12 the mix leans more and
  more on dear units, and from Wave 10 every Horde unit walks on with a veterancy star, one more every 4 Waves (3
  stars from Wave 18). Not measured yet: Horde survival runs need redoing before the balance log's Wave numbers
  hold again.
- Sandbox matches for testing. The host ticks Sandbox in the lobby; in the match a Sandbox bar lets anyone pick
  any unit (the Kaiju included) and a side, press Spawn, then click the map once per unit (right-click stops).
  Enemies go to the Horde in Horde (they attack-move on the bunker and count as a Wave on the map) and to the first
  player on another team otherwise. Horde records do not count in a sandbox match. Found and left for later: the
  Spanish translation shows the Spawn button as "Punto de inicio" (spawn point); it needs its own entry in
  client/es.js.
- Digging and building are easier to spot. A gold work bar under the health bar fills as a squad digs its trench (or
  other field work) and as a construction site goes up. Diggers throw up clods of earth and builders raise a little
  dust, and the dig and build sounds play about twice as often, louder and from further away (110 m, was 70 m).
- Fixed selected infantry and support teams piling up at bridges and fords instead of marching across. Squads now
  keep their forward steps through friendly crowds going the same way, pass nearby waypoints when the way on is
  clear, and refresh stalled routes within the search budget. Waiting movement orders keep their original
  destination. New check: `test-bridge-groups.mjs` (18 rifles, support guns, MGs, mortars and medics over 2, 4 and
  6 m decks).
- Fixed World Conquest refusing building placement inside controlled territory. The preview now recognizes
  discovered irregular region borders (and so does the server's region lookup) and still requires the whole building
  to fit on visible ground your team owns.
- Reduced pauses while exploring World Conquest. Ground updates now process changed cells and their neighbors, and
  scenery preparation runs in small steps across frames instead of rebuilding the continent in one frame. In a
  browser fixture, ground processing for 160 newly revealed cells fell from about 60 ms (Huge) and 230 ms (Massive)
  to about 3 ms, and a 163 ms scenery rebuild became 3 ms slices. Left for later: terrain geometry updates still
  take about 13 to 23 ms. `tools/profile-world-discovery.mjs` measures it; `test-world-discovery.js` checks it.

### 2026-10-08: Fortress buildings (`9a35da4`)

- The AI now fortifies. After the first 2.5 minutes each of its HQs (forward HQs too, so its front line gets them) goes up in steps toward the nearest enemy: a Scout Tower, a Pillbox once it has Company HQ, then a concrete wall 24 m out across that side with a gate in the middle, then two flank walls angled back. The back stays open so it never seals itself in. It keeps MP back from buying units for the next step, one job at a time, and repairs damaged pieces with the rest of its base. In a 12-minute World Conquest AI match the AI's planning time per tick moved from 0.80 to 0.93 ms. Balance with fortifications in: Conquest wins USA/Germany/USSR 35/35/30% over 60 AI matches (was 28/33/38%), median 565 s (was 621 s); Classic 37/30/33% over 30 matches, median 1,557 s (was 43/29/29%, 1,509 s).
- World Conquest: fortifications change hands. Take a region and every Pillbox, Scout Tower, wall and gate still standing in it becomes yours, as damaged as it is. The 40% of defended regions farthest from any home now start fortified: a Pillbox facing the nearest home, and in the farthest 15% also a Scout Tower and a concrete wall either side of the Pillbox (25 of 62 regions on a 2-player Huge map). Local defenders now see out of their pillboxes and towers.
- New: Concrete Walls and Gates (Company HQ, Defenses tab; Engineers only in Classic and World Conquest, builder squads elsewhere). Draw a wall like a sandbag line (120 MP per 4-cell piece, 30 MP a cell, 6 s a cell): each finished cell is a 400 hp concrete block that stops infantry and vehicles and blocks sight, so the crew works from 6 m back. Explosives breach it a block at a time and leave rubble you can climb through. A Gate (150 MP, three cells, click to place) stands open for your side and your allies and shuts while an enemy is within 16 m (it never shuts on someone standing in it).
- New building: the Scout Tower (120 MP, 25 s, no tier needed, Defenses tab). A timber lookout on one cell that sees 60 m over walls and houses once it is finished (12 m while it goes up). Unarmed and only 300 hp: when it is destroyed it keels over and crashes down in a cloud of dust. Good for spotting targets for Gun Pits and artillery.
- The MG Nest is now the Gun Pit (same 60 MP trench pit behind a horseshoe of sandbags, Defenses tab). An MG, AT gun, mortar, flak gun or howitzer standing in the pit reaches 25% farther (an MG 45 m instead of 36), so pair it with something that can see that far. Fixed: a gun in a nest could not shoot out over its own front sandbags, so the old MG Nest's MG hit nothing in front of it; shots now clear sandbags right beside the shooter.
- New building: the Pillbox (200 MP, 35 s, Company HQ). A small concrete blockhouse with an MG crew inside that opens fire once it is finished, its slit facing away from your home. Rifles barely scratch it (a rifle squad does about 8 damage in 20 s against 1500 hp from the front, about 15 from behind), so bring satchels, AT guns, tanks or artillery, or go round the back. Built by Engineers in Classic and World Conquest, by builder squads elsewhere; it sits in the Build menu's Defenses tab.
- The Build menu is split into tabs (Base, Defenses, Field works, Engineering), so builders no longer get one long grid of about 18 buttons. The menu opens on the last tab you used. Hotkeys are unchanged. First step of the fortress buildings plan (docs/superpowers/plans/2026-10-08-fortress-buildings.md).

### 2026-10-07: Big battle performance (`d13086b`, `65e98c5`)

- Big battles run lighter on both ends, with the game itself unchanged (the 6-AI Massive benchmark ends in exactly the same state). Client: soldiers no longer take part in the scene's own matrix pass, which updated some 40 objects per squad every frame whether on screen or not. Each frame now updates only the soldiers of on-screen squads, and squads off screen keep their men hidden. The per-frame matrix work for 200 squads fell from 6.4 ms to 2.6 ms. Server: about 13% less CPU over a 6000-tick six-AI Massive battle (193 s to 169 s), and the saving grows as a battle goes on. Craters a team hasn't seen yet are checked only against that team's units within sight range, instead of every unit of the team on every vision pass. Queries that only want vehicles (squads steering around traffic, vehicles shoving, cover next to hulls) now skip the infantry. Left for later: crowd separation still searches a radius sized for the largest unit on the map around every unit, every tick. Shrinking it changes which units get pushed, so it needs its own balance check.
- Big battles stutter much less when new infantry appears, and joining or watching a big match in progress no longer freezes the screen for up to a minute. Every player's soldiers used to be built from scratch in that player's color, although the color only tints a small arm band on the distant model. Now all players share each soldier's shapes and only the band is recolored. Building the soldiers of 6 players went from 21.7 s to 4.3 s of CPU, and joining a 6-AI Massive Annihilation at minute 18 went from 59 s to 4 s before the match was playable. The same battle's memory fell from about 2.5 GB to 1.3 GB, and the frame rate on the low setting rose from 30 to 45 fps to about 57 fps (rough comparison, not the same moment of the battle). Found and left for later: every frame, three.js still updates about 19,800 scene objects, 54 per squad, mostly hidden per-soldier meshes kept for picking, corpses and effects. The server tick in that battle ran 85 to 210 ms against its 40 ms budget, so snapshots came only 1 to 4 times a second.

### 2026-10-07: Audit fixes and digging animation (`5e5dffd`)

- Fixed server crashes caused by Supply orders aimed at unfinished or newly completed caches, and by malformed movement orders. Unfinished caches now refuse deliveries safely; completed caches can accept them immediately.
- Supplied troops can reinforce and repair at forward production buildings using their carried provisions when no nearby supply store is available.
- Convoys keep their limit of three route searches per tick when looking for new jobs and retain increasing retry delays for blocked routes.
- Supplies explicitly delivered to an ally's cache can now be used by that ally's troops. Automatic convoy stock keeps its original owner.
- Construction refuses footprints occupied by ground troops, so buildings cannot trap their builders. Cancelling a site also removes its physical sections, preventing ghost rubble later.
- Manual grenades and other aimed abilities replace prior construction, digging and boarding orders correctly. Troops cannot board carriers through water, walls or cliffs, while landing craft still accept troops from a reachable bank.
- Anti-aircraft guns spend ammunition when firing at off-map support aircraft and cannot intercept with empty magazines. Aircraft keep queued sorties until rearming finishes.
- Fill in keeps the original terrain height through live changes and World reconnects. Active objectives reappear after reconnect, and opening scripted announcements display once.
- World AI remembers bridges discovered later in the match and can repair them. Enemy troops can blockade supply in the source region itself. Losing every player's final region at once ends the match in a draw.
- A Horde map still loading in the lobby cannot change the mode or map of a match that has started, or overwrite a newer mode selection.
- Squads visibly dig and build with spades. Distant shovels stay within the existing 150-triangle limit (maximum 149, down from 169).
- Fixed an intermittent CI failure in the engine acceptance checks. The test client sent an order, waited a fixed
  8 ms and then stepped the server 800 ticks; on a slow runner the second side's order arrived after the clock ran,
  so its AT gun stayed parked on the tank's destination and the tank stopped 7 m short. Each test send now waits
  until the server has read the message. No game change.

### 2026-10-06: Destroy your own units, roomier bases, tanks no longer stuck at spawn (`257d357`)

- Select your own units or buildings and press Delete to destroy them. No refund, and the enemy earns no kill bounty.
- Fortified bases (Horde, Assault defenders, Annihilation) are laid out like a compound with roads: HQ in the middle,
  the bunker forward at the gate, flak on the four corners, the Barracks beside the HQ, trenches further out (15 cells
  instead of 11). Every map still gets all four flak emplacements (before, 3 map and mode pairs got fewer).
- Tanks made in a crowded base no longer get stuck at spawn. A new tank used to appear inside its building and on the
  same spot as the tanks before it, so it found no route out: in a Horde base 6 new tanks moved 0 m in 30 s, now all
  six drive out. Vehicles now step out where the hull fits, fanned out around the door; a hull wedged against a wall
  backs out to open ground first and may move as long as it does not dig in deeper.
- The Kaiju no longer stalls against the Horde bunker: its route through the old base ran straight through it.
- New buildings placed by the AI keep a 4 m lane to the buildings around them, so they never seal a road.
- Found, not fixed: two tanks can still deadlock on open ground when one yields to the other but its own sidestep is
  blocked, so neither moves.

- The full test suite passes again after merging skirmish production bases. Fixed the AI ignoring an enemy air strike
  on squads busy building: a squad sent to rebuild a base no longer gets bombed without fighter cover. Test setups
  that wipe the map or count units now allow for the starting HQ and Barracks. The AI-match check now asks for at
  least half the points within 3 minutes instead of all of them: with bases, AIs hold 6 of 7 at 3 minutes in seeded
  runs and take all 7 at about 7.5 minutes, since part of the opening goes to tech.

- Fixed the Engineers' Build card in Classic and World Conquest showing only an empty "Build" tab after a Conquest
  (or other recruit-bar) match in the same page. The recruit bar's tab layout stayed on and hid every building card.

- Integrated skirmish production bases (`232f3a9`) with the newer engine and recruit tabs. Preserved paid Classic queue identities/refunds, section-based building repairs, observed-terrain navigation, vehicle motion fields and shared Horde facility rallies. Updated the isolated Hot Gates vehicle fixture to supply its production prerequisite, and made combat-fixture cleanup remove layered terrain and structural collision data for starting bases. Focused skirmish, production-refund, Horde queue, AI privacy and Hot Gates navigation checks pass; merged core tests still stop at the previously documented fighter-cover assertion.
- Conquest, Assault, Annihilation and Horde now start with a finished HQ and Barracks. Recruit instantly from surviving finished facilities, and build Motor Pools, Airfields and coastal Shipyards during the match to unlock their units. Unit prices remain MP-only with no training queues.
- Rifle and Conscript squads construct, assist and repair production buildings. Destroyed buildings leave rebuildable rubble. Rebuilding an HQ costs 200 MP/40s; the other buildings retain Classic's construction prices and times. HQ loss disables its reinforcement zone until rebuilt.
- Horde defenders share facilities and prerequisites while keeping individual MP and unit ownership. Existing bunker objectives and wave spawning are unchanged.
- The build menu, recruit lock reasons, selected-facility spawning, shared facility selection/rallies and construction cancellation work with the new bases. AI builds technology and repairs/rebuilds its facilities.
- Fixed builders reviving zero-HP buildings before destruction cleanup. Added simulation, client and AI regression coverage. No combat or income rebalance; competitive pacing remains a human-playtest follow-up.
- Known verification gap: the latest core regression run fails the existing AI fighter-cover assertion (an announced enemy air strike should trigger fighter cover). The full suite is not green; this implementation is committed at the user's request pending regression follow-up.

### 2026-10-06: Territory supply (`c2dc946`)

- Supply now flows through connected friendly territory instead of a fleet of trucks (docs/territory-supply.md).
  Units refill where they stand: at full rate near an HQ (or a held depot in Conquest, any held point in
  Annihilation), weakening along the line to 25%. In World Conquest supply runs through owned regions that border
  each other; elsewhere it follows ground vehicles can cross. Enemy-held ground, armed enemies standing on the line
  (within 8 m) and broken bridges or rubble cut it; craters weaken it until squads fill them in. A unit out of supply
  keeps refilling for 10 s, then lives on its reserves, which the existing shortage and withdrawal rules govern. Trucks
  now serve only units and caches beyond supply, at most 4 per player, and World Conquest's region caches are gone.
  Refills are paid as before (Munitions and Fuel in Classic and World Conquest). The logistics overlay tints owned
  World regions by supply strength and rings cut-off units on the minimap; unit cards show the line's strength or the
  grace countdown; new alerts say when units are cut off and when a line is restored (English and Spanish).
  Measured in seeded 2-player, 2-AI World Conquest matches of 2.5 minutes (CPU time): 15.4 and 13.6 s against 23.2
  and 24.9 s with trucks, and 11.8 and 10.0 s with logistics off. Logistics' extra cost fell by about 70%, from 11 to
  15 s to about 3.6 s. Not reached: the target of under 10% of server CPU (it is about 25%; most of what remains is
  the few remaining trucks and per-unit store checks). Found, not fixed: outside World Conquest, cut-off units are
  usually in enemy contact or beyond vehicle ground, so trucks rarely reach them.

### 2026-10-06: Supply truck jams and re-planning (`9ae160f`)

- Supply trucks no longer jam at their own HQ and use less server time. Trucks coming home stopped behind the trucks
  parked around the HQ and stayed "not arrived" for seconds on end (162 of 219 stuck samples were stuck over 5 s, nine
  in ten within 20 m of their HQ), re-planning their whole trip every 2 s. Now:
  - a truck stuck within loading reach of its HQ (15 m) counts as arrived there;
  - a truck stuck elsewhere on a trip that still holds plans only a detour back onto its route about 30 m ahead;
  - hops of 16 m or less across open ground (most trips around a base) skip the route search, which cost 6 to 16 ms
    however short;
  - the way home, which only prices a trip's fuel, is planned once per trip end instead of on every recheck;
  - a recipient on the move is re-targeted once it leaves unloading reach (12 m), not every 4 m.
  Measured in a seeded 2-player, 2-AI World Conquest match of 2.5 minutes (CPU time, so other programs do not skew
  it): 27.9 s on master against 20.6 s, with the same 65 truck trips and troops as well supplied; on a second world
  24.6 s against 22.8 s, within noise there. Long stuck samples fell from 162 to 1.
  Found, not fixed: logistics still roughly double the server's CPU (8.5 to 10.7 s for the same matches without
  trucks). Most of what remains is planning trips: re-plans when a route turns dangerous or blocked (30 to 50 ms each)
  and new trips. Planning trips one leg at a time was tried and cost twice as much, since every leg pays the same
  fixed cost (danger map, threat scan, fuel pricing).

### 2026-10-06: Supply trucks on master and their World Conquest lag fixes (`625c4eb`, `5ce4243`, `8599d66`, `45eb104`)

- Supply trucks are now on master: the physical supply slice (`165b0fe`, see its entry below) merged with skirmish
  bases. Any match with an HQ now supplies from it (bases put an HQ on the old home position, where trucks used to
  load, and without this they never delivered), and the hold check waits a second because trucks now brake before
  they stand.
- Fixed allied supply trucks appearing at your HQ instead of their own. New trucks took the first friendly HQ in the
  list, which was always the first ally's.
- Fixed supply trucks lagging World Conquest, which with the merge alone ran at p95 up to 145 ms with one 77 s stall
  in a 2-player, 2-AI probe. Now: p95 22 to 45 ms and at most 114 ms over 4 minutes, against 20 to 32 ms and 144 ms
  on master without trucks. Causes and fixes:
  - A truck that found no route retried a whole-world search every 2 s, from two places. A failed route to the same
    place now waits 2, 4, 8, 16, then 32 s.
  - Every 2 s all trucks were assigned and rechecked in the same tick, each planning its trip there and back (about
    4 ms, up to 50), so up to 40 route plans landed in one tick. Trucks are now queued, at most 3 dispatches per
    tick; an unfinished pass carries over.
  - Trucks re-planned trips that still worked; they now keep a route whose every leg is still clear and safe.
  - A safe route near seen enemies built a new danger map, and with it a whole-world route graph, for every truck;
    now one danger map per side, updated cell by cell.
  - The remembered-ground view rebuilt its seen units, wrecks, fires and mines (a pass over every remembered cell)
    on every call, several per unit per tick. It now keeps them per player per tick and tracks mines cell by cell.
  - Remembered cells were compared through JSON strings, route graphs rebuilt for look-only changes, and a building
    going up (repairing its sections every tick) counted as a terrain change, redoing the whole map's fog and
    memory. Hit points, wear and scorch are now look-only.
  The speedups come from another session's finished work; its Horde, sandbox, dig-bar and bridge-crossing changes
  are not part of this.
  Left for later: one long trip is still planned whole in one tick (up to about 50 ms).

### 2026-10-06: World Conquest AI observation lag fix (`40c23fd`)

- Reduced World Conquest lag from AI players. Every AI rebuilt its full view, copying its whole terrain memory, on
  every snapshot beat (every 2 to 4 ticks), though a Normal AI thinks only every 40 ticks. Now only AIs that think
  before the next beat observe, still from the beat the players were last sent. In a 2-player, 2-AI World Conquest
  probe the AI share of a server tick fell from p95 13 to 44 ms to 4 to 6 ms.

### 2026-10-06: Tank abilities and Annihilation lag fix (`6ec1a2b`, `3d22e08`)

- Fixed multi-second ping for everyone (host included) in Annihilation and other non-World matches as a match went
  on. The server tick (budget 50 ms) climbed to 47 ms median by minute 6 with only 80 units, so snapshots queued up.
  Cause: the remembered-terrain path view was rebuilt from scratch on every call, and unit traffic and route checks
  call it per unit several times a tick. It is now built once per tick (or when terrain or vision
  changes). Headless 4-AI Annihilation on the default map, with the in-progress logistics and movement work loaded:
  step 50 to 83 ms per tick at minute 5, now 12 to 22 ms.

- Only the Light Tank and the Armored Car lay smoke now. The heavier tanks get their own abilities instead:
  - Medium Tank, HE Shell: fires a high-explosive round at a spot up to 38 m away (blast 5 m, kills about two men of
    a squad and pins the rest, cracks cover). 40 s cooldown. Autocast aims it at infantry in cover, trenches or houses.
  - Tiger, 88 mm AP Round: the next shot always hits and does double damage to a vehicle. 40 s cooldown.
  - Churchill, Petard: the AVRE's demolition charge, fired at a spot up to 20 m away. Wrecks houses, trenches and
    the squads in them (about three men of a squad). 45 s cooldown.
  The shells fly flat from the turret instead of being lobbed like a grenade. The AI now loads AP rounds against any
  vehicle, not only Light Tanks.

### 2026-10-06: Horde Kaiju boss (`cedf7ba`)

- Horde has a boss. Every tenth Wave a Kaiju walks on with the rest: a 17 m atomic lizard with glowing back
  plates. It walks, swings its tail and turns its head toward what it is about to burn. "THE KAIJU HAS SURFACED"
  rings out when it arrives, it always shows through the fog, and a big red health bar across the top of the screen
  tracks it until it dies. Its breath is a beam 34 m long that hits every enemy and every cell in its line once, sets
  the ground on fire and caves in trenches. It tramples trenches and sandbags, takes double damage from behind like a
  tank, and has 6000 hp per defender. Killing it pays the usual 20% bounty (300 MP). Wave 20 brings two, Wave 30
  three. Nobody can buy one. The commit also fixes ordinary shells ignoring its health per defender and breath samples
  damaging the same terrain cell repeatedly. Balance survival runs need refreshing after these corrections.
  Left for later: a Kaiju can't cross tank traps or
  rubble (it waits like any vehicle with no route); the Great Ape and the Seraph.
  With several Kaiju, the health bar currently tracks survivors, so its percentage can rise when one dies.
  Keeping the original wave health total on that bar remains for later.
- Found, not fixed: Horde runs on Kasserine Pass stall. A single Conscript gets stuck short of the bunker
  (around 161,189 and 163,155), so the Wave never ends. It happens with the Kaiju switched off too (Waves 7, 9 and
  11 cut off at 90 minutes, where the balance log had 13/15/14 with none cut off), so it comes from somewhere else.

### 2026-10-05: Right-side unit-loss notices (`fb51574`)

- Unit losses now appear as larger red notices on the right above the minimap for 12 seconds, with the unit name and a
  shortcut to look at the loss location. Routine tips stay above the minimap and cannot hide these notices.
  Space prioritizes a visible loss; nearby losses still combine, and at most two notices show at once.
  Projectile acceptance checks also wait for compressed commands to arrive before advancing the simulation,
  preventing intermittent validation failures on busy machines.
  The full-match AI smoke test uses a fixed seed while retaining its capture, combat and victory checks.

### 2026-10-05: Physical supply routes and unit reserves (`165b0fe`)

- Armies now depend on physical supply trucks in Conquest, Classic, Annihilation and World Conquest. Deliveries run automatically, with optional direct orders, hold/resume controls and a logistics overlay.
- Units carry about 90 seconds of ammunition and 120 seconds of provisions. Vehicles burn a 180-second fuel reserve while driving and keep 60 seconds for escape. Reserves below 25% reduce firing or recovery; exhausted provisions trigger a 20-second withdrawal warning. Recovery requires 50% of every applicable reserve, and encircled troops remain stranded until they can escape or receive relief.
- Build forward Supply Caches for 60 MP in 12 seconds. Captured World regions gain empty relays, rebuilt HQs restore supply, allied relief keeps separate paid stocks, and lost trucks receive free replacements after 30 seconds. Classic and World cargo spends existing Munitions and Fuel without changing income rules.
- Truck cargo and troop stocks remain private. Supply controls support English and Spanish. Fixed interrupted deliveries after source loss, cargo preservation through queued orders, and handoffs across impassable water. Naval supply remains for a later slice; aircraft retain their sortie rules. Found for later: very large World victory snapshots can still cause pauses.

### 2026-10-05: Windows naval source fingerprints (`d8bda15`)

- Fixed naval asset checks rejecting unchanged model sources on Windows because of line endings. Export and
  validation now use the same source fingerprints on Windows and Unix; real source edits still invalidate models.

### 2026-10-05: Detailed rock cliffs, Thermopylae fixes and recruit tabs (`063c1dc`)

- Recruit panel (Conquest, Assault, Annihilation, Horde): unit cards now show each unit's flat silhouette symbol
  instead of a small 3D render, so the types are easy to tell apart. The groups (Infantry, Support weapons,
  Vehicles, Aircraft, Naval) are now a row of tabs: click one to show only its units, click it again to close it.
  Keyboard recruiting works as before (a letter opens a group, a second buys) and opens the same tab.
  Classic building cards also use the symbols; the selection list keeps its 3D portraits.

- Rebuilt cliff walls with detailed rock models on every map except the huge generated ones. Faces are now stacked, fractured limestone slabs
  that step back as they rise, with occasional full-height buttresses, grassy ledges, boulders on the crest and
  scree at the foot. Diagonal cliff runs no longer show a cell-by-cell staircase: notches fill with rock piles
  and convex teeth are wrapped in rock columns. Rocks are visual only and never bury mountain-road cells.
  Cost: Hot Gates terrain goes from about 63k to 250k triangles on High (116k on Low), and a crater rebuild
  takes about 30 ms longer there. Found and left for later: the cliff crest still steps on 45 degree runs when
  seen from far away, because the plateau outline itself is unchanged.

- Integrated the Thermopylae fixes with the updated vehicle and terrain systems. Moved 20 rubble cells off the
  mountain road and onto the cliff shoulders so vehicles have room to pass. Ground picking and visible contact
  now follow the reshaped cliff triangles, while neighbouring plateau centres keep their original heights.
  Mixed tank and Churchill traffic can still jam during overtaking on the narrow road; that remains for a later fix.
  Fixed Windows file paths in the movement and localization regression runners so their checks run on Windows too.
  Cliff-adjacent terrain centres stay at their simulation height even beside shell scars. Camera and map checks
  now follow the ragged cliff backing and track decorative rock costs separately from the ground-mesh budget.

- Reworked the Thermopylae cliff visuals again: softened the square stair-step corners, removed the repeating
  wall panels and pale stripes, and added broad weathered rock faces, larger outcrops and scattered fallen stones.
  The revised cliffs use fewer triangles than the first version and keep the same vehicle movement rules.
  Terrain checks found two existing folded ground triangles on Hot Gates. One remains for a later ground-mesh fix.

- Fixed vehicles getting stranded on Thermopylae (The Hot Gates) in Horde: arriving units stay on ground connected
  to their gate, including the narrow mountain road, and crowds cannot shove vehicles onto rubble or tank traps.
  Cliff walls now have ragged rims, fractured stone faces and rocks at their feet, with softer stone shading.
  Fixed cliff faces disappearing when viewed from some directions. Convoys are checked through both mountain-road
  corners in both directions. Existing matches need a restart to replace units already stranded on cliff tops.

### 2026-10-04: Tank wheel and track animation (`5c0fb8e`)

- Tank road wheels, idlers, sprockets, return rollers and visible track belts now move with actual vehicle travel,
  reverse when backing up and move at different speeds on each side while steering. They stop with the tank
  and follow the hull on hills. Covers native light, medium, heavy and tank destroyer models for all four factions,
  plus tracked mobile flak and Calliope variants. Spare wheels stay fixed; wheeled and halftrack models are outside
  this change. The terrain workshop now offers forward, reverse, stopped and close side inspection.

### 2026-10-04: Natural terrain slopes (`7d67670`)

- Hills blend adjoining ramps instead of flattening into a shelf at each height level. Removed repeated dark
  contour and elevation bands from ordinary slopes, while keeping real cliff walls and their rock detail.
  Fixed cliff faces disappearing from their lower side when the next cell was higher.
  Grounding and game picking use the same relief surface, including narrow crests and cliff faces.
  Minimap viewport corners keep their projection when the camera looks beyond the map. Cell heights,
  movement and tank alignment keep their existing rules. Added rounded-hill, ramp-beside-cliff and full
  generated-map workshop scenes.
  Broad authored plateaus remain, and this does not change terrain balance or navigation.
  Existing crater-rim edge displacement can still differ from contact sampling and remains for later.

### 2026-10-04: Vehicle slopes and terrain workshop (`479b1f6`)

- Tanks and other ground vehicles pitch uphill and downhill and lean across slopes instead of staying almost
  level. Their native track or tire footprint supports the hull on ramps, crests and trench crossings, while
  turrets keep turning and selection rings stay level. Fixed the order of terrain tilt and suspension motion,
  and tracks cutting through narrow ridges between support points.
- Added a 3D terrain workshop with the game's vehicle models and terrain mesh, five repeatable scenes,
  frame stepping, distance scrubbing, faction and vehicle choices, and a level-hull comparison.
  The fixtures exercise presentation; use the movement lab to test navigation and orders.

### 2026-10-04: Movement recovery and disruption lab (`6a74b65`)

- Vehicles brake before their final waypoint instead of overshooting and turning a full circle to return.
  Their first movement step now respects each vehicle's forward and reverse acceleration.
- Fixed tanks getting stuck beside walls or repeating short forward and reverse moves to make turning room.
  Clicks too close to a wall resolve to an open position with room for the hull. Short reverse orders survive
  rerouting, and opposing heavy vehicles keep enough separation to clear their lane.
- Fixed infantry and tanks stopping at a cliff corner instead of following the nearby ramp. Route smoothing
  and vehicle collision now check every crossed height cell.
- Added a repeatable movement lab with 24 scenarios for all nine ground vehicle types, rifle squads and
  support guns. It supports live Stop, Retreat, replacement orders and tank traps, plus seeded command-line
  runs and comparison against another simulation revision. The 1,056-case heading matrix passes locally.

### 2026-10-03: World snapshot checks (`8dce8f7`)

- Added a delayed-receiver World regression that keeps the original 700-tick construction deadline and all
  gameplay assertions. It uses the delivered-snapshot wait from the model integration change.

### 2026-10-03: Final engine checks (`5346990`)

- Fixed authored reinforcement entries on mined ground using the underlying surface and object, so a mine marker
  cannot hide a vehicle-blocking obstacle during match admission.
- AI assaults count Tank Destroyers as an answer to observed armor. Healthy supported attacks keep fighting a
  countered tank, while overwhelming reinforcements still trigger withdrawal after the usual observation delay.
- Updated the glossary for waiting recruits, Alert history, control-group transfers, Wave profiles and authored
  structures and scenarios.
- Fixed the World scouting test setup to preserve live building footprints and update terrain layers together.
  The reproduced seed and two independent seeds pass the original long-order, queue, Stop and Retreat checks.
- Rechecked the combined engine and new models with the full suite, saved multiplayer mission, muted Linux
  browser captures and an eight-match AI pilot. Controlled World fixtures still exceeded the 40 ms tick target
  at their maximum: 42.745 ms on Huge and 51.474 ms on Massive. Native GPU performance and broader faction
  balance remain unverified.

### 2026-10-03: Textured Blender infantry and engine integration (`855be86`)

- Replaced near infantry bodies with a textured mesh fitted and weighted in Blender. Faces, cloth folds,
  boots and equipment now retain their surface detail through aiming, running, crouching and prone poses.
  All factions share the base cut, with different colors, helmets, weapons and specialist equipment.
  Distant figures remain simplified. Closed grips replace the generated reference's open hands.
- Fixed rifle squads getting stuck behind their own HQ when another infantry squad occupied a passing
  route's exit. Infantry now uses the same soft separation for route checks as for nearby traffic.
- Made World Conquest acceptance checks wait for delivered snapshots and use exact positions for wall
  collision checks, avoiding false failures caused by socket delays and rounded network coordinates.
- Fixed the model viewer drawing its first measurement before shadow textures existed, which caused
  a startup WebGL error. Added a neutral floor-color option and retained the infantry reference,
  reduced source, editable Blender rig and rebuild command in the repository.

### 2026-10-03: Rebuilt geometry and materials (`c60f4ce`)

- Rebuilt tank castings, wheels and tracks, infantry faces and weapons, aircraft fuselages and canopies, and base
  buildings with smoother shapes and more mechanical detail. Ships now have curved hulls, cambered decks, open
  bridges, torpedo tubes and shaped gunhouses, with Blender finishing for panel edges and normals.
- Painted metal, bare metal, rubber, cloth, timber, asphalt and concrete now respond differently to light.
  Fine fabric grain replaces coarse mottling, ship hulls avoid land mud, and a filtered sky reflection improves
  metal on High graphics. Low keeps material response while omitting texture detail and reflections.
- Fixed the model viewer sometimes reporting textures off while texture loading was still in progress.
- Known issue left for separate work: World Conquest can receive an early snapshot before the client world is
  ready. The same startup error was reproduced on unchanged master; it is unrelated to these visual changes.

### 2026-10-03: Model detail, lighting and movement (`fce8526`)

- Vehicles settle as they accelerate and turn, boats gently ride the water, and soldiers ease between stride
  frames and crouching or crawling movement. Selection markers stay level and muzzle effects follow the models.
- Shaded units and buildings stay readable under brighter sky and ground fill. Clouds have softer edges, and
  river mist and fog banks use the weather color, gentle wisps, and a fade near the camera.
- Naval craft now have shaped hulls, detailed bridges, deck fittings and working gun mounts. Landing craft
  have ribbed ramps, benches and an open passenger well. Both landing-craft muzzle flashes match their barrels.
  Movement and combat rules are unchanged.
- Infantry uniforms and equipment, tank fittings, wheel hubs, aircraft canopies and weapons, and base buildings
  have clearer detail. Refined painted metal and subtler cast-armor and gunmetal grain keep the faction
  colors easier to distinguish.
- Added the three project-scoped Blender integrations for Codex and Claude Code, reusable modeling instructions,
  model export and review tools, and generated multi-view art references.

### 2026-10-03: Engine and game feel (`7e3dc83`)

- Units anticipate traffic, yield through crowded crossings and keep their destination while rerouting around new
  obstacles. Ground vehicles accelerate, brake, reverse and turn within their own limits; their visible chassis follows
  slopes. Large-map routes use remembered terrain and hull clearance.
- Bullets, shells, grenades and rockets travel through the world. Damage and suppression arrive at contact, moving
  targets can leave the lane, and thin obstacles intercept a shot. Shallow hits on hard materials can ricochet once.
- Roads, objects and mines have independent layers and materials. Clearing a mine or wreck preserves the surface
  beneath it, including road damage. Hidden mines and destruction stay hidden from human, AI and spectator recipients.
- Buildings and bridges fail by local sections and anchored support. A breach preserves a surviving building's owner
  and queue. Falling sections and wrecks use gravity, mass, contacts and damping, then become persistent obstacles.
  Active debris is capped at 96 bodies, 8 contacts each and 2.5 seconds before settling. Fire wears sections before collapse.
- Large idle Horde groups receive orders four at a time every 100 ms, clearing a 238-unit staged launch in at most
  6 seconds at normal 10 Hz delivery, or 12 seconds at adaptive 5 Hz delivery. In the baseline and rebased Wave 10 Massive bridge
  fixture, maximum tick time changed from 728.910 to 32.601 ms, while p95 increased from 5.558 to 27.244 ms.
  The earlier integrated engine reached 1,047.132 ms before staggering. Direct player orders remain immediate.
- Enemy AI keeps combined-arms assaults together, regroups after contact and can withdraw from a losing fight.
  Horde Waves announce their mixed, infantry, armor or siege category before arriving; defining purchases target
  65%, 50% and 45% of the normal Wave budget respectively. This changes fights; faction balance still needs broader playtesting.
- Cancel an individual waiting recruit with its exact MP/Fuel refund shown in the command card. The active recruit
  keeps its progress. Battle Alert history retains the latest 100 notices and jumps back to their locations.
  Alt+number transfers selected units out of their previous control groups.
- Surviving vehicles show damage smoke that fades after repair. Nearby water, woodland and weather contribute to
  ambience. Off-screen units skip detailed animation and restore their current pose on camera return.
- The map editor supports separate surface/object/mine materials, structural sections and authored scenario
  conditions, reinforcements, objectives and announcements in English and Spanish. Invalid starts keep the prior room
  state; public map previews conceal mines and future scenario source, while authenticated editing preserves them.
- Added the source-backed implementation spec, research, multiplayer acceptance scenes and performance reports.
  Generated a transparent rubble atlas through the configured Codex image proxy. Effect prioritization remains outside this change.
- Large World fixtures still exceeded the 40 ms tick budget at their maximum: 47.787 ms on Huge and 124.532 ms on
  Massive. Native GPU performance and broader faction balance remain unverified.
- CI allows 30 minutes for the expanded regression suite, including the full AI fog proof and World tests.

### 2026-10-03: Strategic geography (source commit `b351ea1`)

- World Conquest seeds now choose 1-3 main rivers and 0-3 small tributaries. Streams are fordable along their length, join larger rivers, and widen the main channel downstream. Each main river has its own bridges and permanent fords; road approaches preserve shallow streams instead of paving them over.

- World Conquest now generates broad hills, cliff-forming ridges with saddles, a winding river and lake,
  fast destructible bridges and slower permanent fords. Roads follow terrain-cost routes with alternatives;
  forests and towns form coherent patches instead of evenly scattered cells.
- Territories now grow around terrain rather than staying square. Construction, regional production locks,
  AI and map borders use actual membership. Only explored portions of territory borders reach clients.
- New generator checks cover deterministic Huge/Massive maps and tank-width routes to every objective after
  all bridges are destroyed. The river movement regression now discovers actual generated fords rather than
  assuming the old fixed street grid.
- Current generator uses one river/lake/ridge family with seeded variation. Multiple landscape families,
  travel-time-based economic spawn balancing and full-match human pacing remain follow-up work. Massive
  six-seat grown-army stress exceeded the 50 ms tick budget on the current host; see
  `docs/strategic-world-generator-verification.md` for measured results and limits.

### Earlier unreleased changes

- Fixed: clicking Fill in froze the game. Its placement preview read the map's original terrain, which the
  browser's copy of the map did not have, so it threw an error every frame and stopped the game loop. The preview now
  has the map as drawn and matches the server.
- The game can be played in Spanish. A language picker (English / Español) sits at the top of the room screen and
  the match browser; the choice is saved per browser and a Spanish browser starts in Spanish. Everything written on
  screen is translated: lobby, mode and map descriptions, HUD, tooltips, alerts, the F1 controls sheet, the stats
  overlay, the match report, the tutorial (Sgt. Hollis), the map editor and floating world labels. Model names
  (M4 Sherman, Panzer IV) stay as they are. Unit voices and sound stay English.
- Left for later: the map editor's file-validation errors from the server (only seen when saving a broken map) are
  still English. A text the dictionary misses shows in English; `/play?i18n=log` lists them in `window.i18nMisses`.

- Annihilation, Assault and Horde bases now start with four Flak Emplacements inside their trench line, so a base
  can defend itself against planes and air strikes (each one has a 45% chance to shoot down a strike passing within
  55 m, so four together stop about 9 strikes in 10).
- Flak Emplacements can be built outside Classic. Select Rifles or Conscripts, open Build, pick Flak Emplacement and
  click where it goes: 100 MP, 20 s with one squad, faster with more. Assault still ends when the bunker falls; the
  flak does not have to be destroyed, and the "structures left" count only counts bunkers.
- A new alert when your base is under attack. Anything of yours hit within 40 m of your spawn, or your own HQ or
  bunker, raises "Our base is under attack!" in a filled red line that pulses and stays 10 s, with the attack sound.
  Like the other alerts it waits if you are already looking at the fight.
- Fixed: construction outside Classic could crash on a missing mode (now guarded). Not tuned in AI matches yet: AIs
  do not build flak themselves.

### 2026-10-03: World Conquest (`b82c9c6`)

- Added World Conquest: scout a generated continent of 64 or 128 regions, destroy local defenses, claim land
  with infantry, and build your own military in conquered territory. Each player starts with one home region
  and the normal small construction force. Huge spans 1,024 by 1,024 metres; Massive spans 2,048 by 1,024 metres.
  Teams share land and its benefits; victory requires the whole map.
- World Conquest keeps unexplored terrain and enemy homes hidden, including after reconnecting. It uses
  last-region defeat instead of HQ loss or Classic's Sudden Death. Match-length and large-army balance still
  need multiplayer playtesting.
- Hidden capture contests now stay remembered until scouted again. AI troops approach remembered enemy
  production buildings that block claiming and attack them after rediscovery.
- Long World Conquest moves plan in shorter steps while preserving the destination, queued orders and retreat.
  Region capture and remembered route data reuse nearby work to keep large armies responsive.
- Fixed infantry and tanks stopping at a river bank instead of finding a ford. With six players and 64 mobile
  units each, local server ticks measured 27.32 ms p95 on Huge and 31.37 ms on Massive. Other desktop work was
  running; these bounded samples do not establish full-match pacing or browser frame rates.
- Kept the lobby and battlefield language module available while integrating Spanish support. Browser entry
  modules now have a served-dependency check.
- Preserved Engineer construction in World Conquest while integrating buildable flak in other modes. New
  World Conquest text currently falls back to English in the Spanish interface. Translation remains for later.
- World acceptance checks now run before the long AI proofs. The relocated-retreat fixture starts outside the
  home arrival radius so it can observe an active retreat before arrival.
- Fixed the tutorial progression fixture losing its house defenders when the next step began. Simulated combat
  now removes those defenders and clears pending artillery before crossing. The check runs first with route,
  bridge and capture diagnostics. Tutorial gameplay is unchanged.

### 2026-10-03: Defeated players spectate (`14cbe41`)

- Fixed defeated teams continuing to recruit and fight in Annihilation. Losing the team's last bunker now stops
  its human and AI players, removes their remaining units and stops their manpower income. Defeated players
  spectate with their team's vision; recruitment and order controls disappear, including in Classic.

### 2026-10-03: Performance regressions (`028ac23`)

- Explosions keep their ragged crater and rubble outlines, but painting reuses nearby scar data and spreads live
  updates across frames. Newer updates replace pending work with the latest ground, so repainting cannot put old
  damage back. The editor still paints immediately.
- Nearby fallen soldiers keep their detailed poses and kit. Distant bodies use simpler models, bodies outside the
  camera stay out of draw batches, and expired bodies release their buffers. Large groups of deaths are packed once
  per frame rather than once per death.
- The wide paper map avoids rendering the battlefield when its desk fully covers the view. Its symbols redraw at
  30 Hz while the camera is still, with immediate camera and terrain updates, and its overlay caps pixel ratio at 1.5.
  Toggling gore no longer rebuilds unrelated terrain, scenery, shadows or model materials.
- Large movement orders reuse vehicle and bunker costs within each route search, while refreshing them for the
  next search. Routes, wall clearance, mines and gameplay rules are unchanged.
- Added regression checks for painting, graphics notifications, corpse lifetimes and movement routes, plus CI for
  the game and world tests. Local WebGL checks compare queued ground painting and paper-map rendering against full
  rendering, and check near and far corpse detail.
- Left for later: initial ground painting and texture readiness still paint synchronously. Match FPS and GPU timing
  need a separate live sample; this work did not alter or profile the running hosted match.

### Other recent unreleased changes

- A tutorial. The Tutorial button on the start page opens a private room and starts it at once (it is also a mode
  in the room's Mode list, so friends can play it co-op). Sergeant Hollis walks you from a glider landing to a
  bridge on a small map of its own, one goal at a time, with the goal always shown under the top bar: move to a
  hedgerow, clear orchard sentries from cover, take the crossroads, recruit an AT gun (Tab W E), kill the tank that
  comes down the road, grenade a farm trench (F), send a squad home to refill (R), shell the stone house with
  artillery (C) and take the bridgehead, which wins. The enemy is a side nobody plays: its units stay where the
  script puts them and fight what comes. Steps that need money top your manpower up.
- Found while testing: a map's first-snapshot alerts are dropped by the client on purpose, so the tutorial holds
  each step's lines until 2 s into the match.
- Annihilation, merging #36 with the per-player rule: a player is out the moment their bunker falls (their army
  goes to a teammate), now settled at the start of the tick, so their infantry can no longer finish a capture on that
  tick. Out players earn nothing and do not count on points (from #36). When the match is decided the losing army is
  only marked out and stays on the field for the end reveal, rather than being deleted as #36 did.
- Recruiting by letter now works like StarCraft's build menus. Press Tab, then a letter for the group (Q Infantry,
  W Support weapons, E Vehicles, R Aircraft, T Naval), then a letter for the unit: Tab Q Q buys a Rifle Squad. The
  group stays open so you can keep buying; Esc steps back to the groups, then closes. Before, all the cards were
  lettered in one long row, so later units sat on awkward keys.
- Smoother zoomed-out map in big fights: the paper war map no longer repaints itself on every shell crater, only
  at most every 3 seconds while it is up.
- Annihilation: a player whose bunker is destroyed is now out of the match, even while a teammate still has one.
  They can no longer call in units or give orders, and their army passes to the nearest teammate. Before, they could
  keep spawning units until their whole team lost.
- Annihilation: howitzers do a tenth of their old damage to bunkers. Ten shells used to take half a bunker
  (1500 of 3000), now they take 150, so one gun needs about 40 minutes alone. Left unanswered, a battery of them
  still grinds a bunker down. Not yet balance-tested in AI matches.
- A lag recorder for diagnosing multiplayer lag. Hosting with start.cmd now records, every 5 seconds, the server's
  real tick rate and timing plus each player's ping, connection backlog, frame rate and update gaps to
  `logs/diag-<room>.jsonl`. After a laggy match, `node tools/diag.mjs` reads the newest recording and says whether
  the lag came from the server, one player's connection, the host's connection (everyone at once) or a player's
  browser. Players need to reload the page once so their browser starts sending its numbers.
- A stats overlay for checking how the game runs. Open it from the menu (Stats overlay) and tick the numbers you want:
  frame rate, frame time, worst frame, script time, draw calls, triangles, render scale, memory; ping, jitter, loss,
  updates per second, the longest gap between updates, update size, download rate and the server's tick time; units,
  effect particles and bodies. Quick picks set Basic (FPS, ping, loss), Performance, Network or Everything. You also
  choose where it sits (top left, center or right), a list or one line, the size, the background, and whether bad
  numbers turn amber and red. F2 shows or hides it, and the choice is saved per browser. It replaces the old `?perf`
  box; `?perf` now shows every number in the overlay for that visit.
- Loss counts pings the server has not answered within 3 seconds over the last minute. The connection is TCP, so
  nothing is really dropped; a lost ping means the connection stalled.
- Fixed: on a Windows host the game ran at 80% speed. The 50 ms tick timer really fired every ~62 ms (Windows
  timers step in ~15.6 ms), so the server stepped 16 times a second instead of 20 and sent 8 snapshots a second
  instead of 10, which made unit movement look laggy. The server now runs the ticks the clock says are due.
- A fourth faction: the UK, picked in the lobby like the others. Its own units: the Churchill VII (480 MP, max 1),
  a slow infantry tank with the thickest front on the map (takes 60% from the front, the Tiger 70%) and a modest
  75 mm gun, and Commandos (190 MP, 5 men), raiders with Stens and satchel charges who hide when they keep still,
  like the sniper. Its doctrine, the 25-pounder: an artillery barrage fires 15 shells instead of 10, same price.
  The AI fields Commandos and its Churchill the way it does Rangers and the Tiger.
- British models, as detailed as the others: infantry in battledress, pale '37 webbing and the Brodie helmet with
  the No.4 rifle, the Sten and a Bren gunner per section; Commandos in green berets with toggle ropes; the
  Churchill VII, the Cromwell (medium tank), the Daimler armoured car, the Universal Carrier (the UK's squad
  carrier), the Vickers MG, the 6-pounder, the 3-inch mortar and a Bofors with Royal Artillery marks; the RAF's
  Spitfire IX, Typhoon IB, Mosquito VI and Dakota in roundels and invasion stripes. British vehicles wear the Allied
  white star in a circle, a WD number and unit signs. The RAF roundel marks UK players in the HUD.
- Balance, 240 Conquest AI matches on the default map with all four factions rotating through the three spawns
  (each faction played 180): wins USA/GER/USSR/UK 66/63/50/61 (37/35/28/34%), 9.4 min median. The UK sits at its
  fair share; the USSR's low share was there before. `tools/ai-balance.mjs --factions 4` runs this.
- Left for later: the UK's light tank, tank destroyer, mobile flak, rocket launcher, howitzer, flamer, boats and
  medics still use the American models in British paint (the white star was the Allied mark, so they read right).
  UK voices are American until British lines are recorded. Gun pits and the Creeping Barrage order from the UK
  design are not built yet.

- New models for the new units, as detailed as the old ones. Tank destroyers: the M10 Wolverine (Sherman chassis, a
  sloped hull studded with armor bosses, the open five-sided turret with its counterweights and the long 3 inch
  gun), the StuG III Ausf. G (Panzer III running gear, the low casemate, the Saukopf mantlet, side skirts) and the
  SU-85 (the T-34 hull carried up into a casemate, the 85 mm in a ball mantlet). The StuG and SU-85 only turn their
  gun, a few degrees either way. Field howitzers: the M2A1, leFH 18 and M-30 on split trails with their own
  wheels, recoil cylinders and shields, raised for indirect fire, with crews and ready shells. The flamethrower
  squad: a flamer with the M2-2 tanks, the Flammenwerfer 41 or the box-shaped ROKS-2 and its rifle-looking gun,
  held at the hip with the hose to his back, and two riflemen.
- Their own map icons and unit badges too (the HUD cards, the war map and the badges over units): the tank destroyer
  is a low turretless casemate with a long gun, the howitzer a steeply raised barrel on a wheel and trail, the
  flamethrower a soldier with tanks on his back and fire at his hip, the bomber a twin-engine plane with a twin tail.
- The model viewer takes &view=N to show one view filling the window.
- Left for later: the sim does not turn a casemate hull toward its target, so a StuG or SU-85 shooting to the side
  fires past its own gun.

- Paratroopers drop a whole stick now: two rifle squads and an MG team land in a ring around the spot you pick,
  instead of one rifle squad. Same price (260 MP / 90 Munitions in Classic) and cooldown, so the call is worth its
  cost (350 MP of units; before it was 2.6x the price of the one squad it brought). It needs room for all three
  under the army limit and reserves it until they land or the plane is shot down. 120 AI matches on the default map:
  USA/GER/USSR 44/38/38 (was 41/41/38), 9.3 min either way; the AI rarely calls paratroopers (it needs 6+ units and
  a visible enemy-held point), so this barely measures the change. Left for later: AI use of paratroopers.
- Map rework, from research on RTS map design (Company of Heroes map rules, StarCraft map papers): eleven Conquest
  maps get cover along their open approaches and, where there is room, a home point per HQ.
  - Killing fields broken up: every long open stretch on the walk between HQs and points now has shell holes beside
    the route, and some bushes that block the sight line. The longest open run on Six Fronts fell from 49 to 10
    cells, Ardennes 52 to 9, King of the Hill 37 to 10, Island Towns 58 to 21. HQ doorsteps stay clear.
  - Home points on Default, River Towns, Ardennes Crossing, Twin Valleys, The Polder, No Man's Land, Crater Field and
    Crossroads Village: each HQ gets its own point a third of the way to the front, worth 1 MP/s and no VP. It is
    safely yours (the enemy walks twice as far), but a raid can take it or cut its supply line.
  - Every change is copied through the map's symmetry, so fair maps stay fair. 120 AI matches per map, old vs new:
    wins by spawn within noise everywhere (Default 39/40/41 -> 44/36/40), matches the same length or up to 11%
    shorter on the two-side maps. Details in DESIGN.md, Map design rules.
  - New tools: `node tools/mapstats.mjs` measures every map (rush distance, point safety, lanes, chokes, open
    stretches, dead space), and `node tools/mapwork.mjs <maps>` applies the rework.
  - Found and left: the mirrored two-side maps are fair for two teams but not as a 4-player free-for-all (on
    Ardennes one mirror pair of HQs won 100 of 120 FFA matches, before and after). Assault maps were left alone
    (their single-lane funnels are the set piece, and their balance was tuned with AI runs).
- Fixed: units walked over the corner of an HQ (and other buildings and houses) instead of around it. Routes hugged
  the wall 1 m off, so a squad's soldiers and a tank's hull cut across the model. Pathfinding now pays a little extra
  for ground right beside a wall and straightens routes only where a 4 m wide lane is clear, so units pass a
  building about 3 m out. One-cell alleys between houses still work.
- Fixed: units routed straight through the command bunker (Assault, Annihilation, Horde) and were shoved out by
  crowding. Routes now go around a standing bunker; an order aimed at the bunker still reaches it.
- Fixed: spawn placement measured walking distance through cliffs, so two spawns on either side of a cliff counted
  as neighbours. A step of more than one level now blocks that measure, like water and houses already did.

### 2026-10-03: Public lobby (`b2dc9ab`)

- A public match browser now opens at the site's main address, using the same gunmetal panels, khaki borders,
  brass accents and condensed type as the room UI. Pick a nickname, filter live rooms by mode or open seats,
  use Quick Play for Conquest, create a public or unlisted room, or enter a room code. No account is needed.
- Public rooms show their name, map, mode, occupied seats, human/AI counts and match status. Unlisted and old
  rooms stay out of the browser. Rooms without a connected human player disappear from it. Unlisted rooms are
  link-accessible, not password-protected. Old /#code links and alternate-seat links still work; games now use
  /play and room invite links point there. The room screen has a Browse matches link.
- Room creation has a configurable server-wide limit (MAX_ROOMS, default 32), with a retry message when full.
  This is an admission guard, not a measured safe number of simultaneous battles. New seat tokens and room codes
  from the public lobby use browser cryptographic randomness. Invalid room titles fall back safely.
- Listed rooms enforce the selected map's seat limit, including AI and spectators taking a seat. A late joiner
  can watch instead of adding an extra player that prevents the match from starting.
- Left for later: public deployment, abuse/rate limits, per-match compute budgets, editor isolation, accounts,
  moderation and atomic Quick Play seat reservations. A room can fill or start between browsing and joining;
  the existing game flow then offers a spectator seat. Gameplay balance is unchanged.

### Other unreleased changes

- Fixed: long floating labels shrank their letters to fit a fixed plate, so the "Locked" tag over a linked point was
  unreadable. A long label now gets a wider plate at the normal letter size, and the locked tag reads "Locked: take
  the linked point first".
- Medics matter now. They heal 2.5x faster (a man back every 4 s instead of every 10 s), keep healing at half rate
  while the squad is under fire (before they stopped for 5 s after every hit), and an idle medic walks on its own to
  the most hurt friendly squad within 30 m (below 90% strength, not retreating). The AI no longer pulls its medic
  back to the middle of the army every time it steps away to treat someone. Balance over 150 AI matches on the
  default map: USA/GER/USSR 40/30/30% (was 34/37/29%), 9.2 min (was 9.3); medics are the same for every faction,
  so the USA swing is most likely noise, worth a recheck.
- Rubble stops vehicles. Infantry still climb through it and use it as cover, but tanks and trucks can no longer
  drive over a ruined house. A house that falls also throws rubble into the street beside it (about a 1 in 3 chance
  per side), so shelling a town can choke its roads for armour and cut off the points behind them (supply lines
  already count any ground a vehicle cannot cross). Any squad that can dig clears rubble with **Fill in**, and a road
  gets its road back. The AI clears rubble off roads near points it holds. Tanks crushing a wall leave a crater, not
  rubble. No shipped map loses vehicle access to a point. Balance unchanged within noise: default map
  USA/GER/USSR 37/33/31% over 150 AI matches (was 33/37/30%), 9.6 min (was 9.3); Stalingrad Factory 42/33/25% over
  60 (was 37/40/23%).
- Left for later: rubble cannot be blown clear with explosives (only shovelled), and ordinary shelling never digs a
  road deep enough to cut it (only bomb holes make cliffs).
- Four new units for every faction:
  - **Tank Destroyer** (Motor Pool, 320 MP): M10 Wolverine / StuG III / SU-85. A long gun that out-ranges every
    tank but the Tiger and hits like an AT gun without setting up. Poor against infantry.
  - **Field Howitzer** (Motor Pool, 300 MP): M2A1 / leFH 18 / M-30. Heavy shells on anything your side spots, out to
    95 m, but it can't hit anything closer than 30 m and must set up. Barrage: 4 shells on a spot. Shells scatter
    more the further they fly: tight (3 m) close in, loose (8 m) at full range.
  - **Flamethrower Squad** (Barracks, 180 MP): short range, and cover doesn't protect against fire. Squads in houses
    and trenches take 1.5x damage.
  - **Bomber** (Airfield, 420 MP): B-25 / He 111 / Pe-2. Drops two sticks of four bombs a sortie.
  - The AI builds all four. Faction wins 32/37/32% over 60 AI matches.
- **Shell area** (Shift+B, or the new order button): mortars, howitzers, rocket trucks, destroyers and bombers can
  fire on any patch of ground, seen or not, not just at a unit or a building. Guns move into range and keep firing
  until given another order. A bomber drops every stick it carries on the spot, then flies home. Shift+click queues it.
- Map labels with long text widen their plate instead of squeezing the letters, and a locked point's tag is shorter
  ("Locked: take the linked point first").
- Left for later: the new units borrow models and icons (the tank destroyer looks like the medium tank, the
  howitzer like the AT gun, the flamer like an engineer), and the flame is drawn as a fat tracer. The bomber's stick
  lands where its target was when it dropped, so it misses moving units.

- The paper war map: zoom all the way out and the battlefield fades into a staff map on old paper lying on a
  wooden desk (inked roads, houses, woods, water, contours and a blue grid), with the map's name above it and a
  compass in the corner. Every unit you can see is its map symbol in its owner's color, sharp at any map size;
  capture points are lettered rings in the holder's color; strikes on the way are red hatched boxes; your units'
  routes and queued orders are grease-pencil arrows (blue move, red attack, dashed retreat), and selected units get
  a pencil ring. Ground you cannot see now has a sepia wash. The floating labels fade out while the map is up.
  Zoom back in for the 3D view.
- Men killed by a blast (grenade, mortar, shell, rocket, bomb) are thrown away from it, tumbling through the air,
  and lie where they land. The closer they were and the bigger the blast, the higher and farther they fly.
- Gore: a man torn by a blast throws out bloody scraps and a red mist, and leaves a blood stain on the ground. A
  new **Gore: On/Off** button in the menu turns it off (bodies are still thrown). Visual only, no gameplay change.
- Left for later: real dismemberment (loose limbs) needs the soldier model split by limb. A thrown body snaps flat
  as it lands instead of rolling to rest. Blood stains share the crater marks' pool, so a long fight recycles the
  oldest of either.
- Auto-retreat is on by default: every new ground unit runs for home below 35% strength unless you switch it off
  (Shift+X). Planes are unchanged. Before, it started off and you had to turn it on per unit. The AI already armed it
  in a fight, so AI behaviour is about the same; balance not re-measured.
- New map, **The Great Bridge** (Assault): hold or take a great stone bridge into a river town. At 5:00 the
  defenders' engineers start wiring it, at 7:00 it is blown with anyone still on it, and from then on the attack has
  to go round by a ford far to the north or a plank rail bridge far to the south. The town square can only be taken
  by the side holding the bridge's east end. Attackers win 4 of 20 AI 1v1 assaults.
- Maps can say more:
  - **Landmarks**: a house can be named a church (upper floors see 1.6x as far, 700 hp a cell) or a factory
    (1000 hp a cell, 0.2x incoming fire inside). Both have their own look. A bridge can be a stone bridge, which
    takes 12x the hits of a plank one: one bomb no longer drops it.
  - **Point kinds**: a radio post makes its side's off-map support recharge 1.5x as fast; a supply depot reinforces
    and repairs like home.
  - **Linked points**: a point can need another one; a side can only take it while holding that one. The point shows
    "Locked" and a dashed line to the point it needs on the minimap, and the AI leaves it alone until then.
  - **Scripted events (triggers)**: at a set time a map can put a message on everyone's screen and blow up every
    structure in a box (a bridge, a row of houses).
  - The editor's select tool sets a house's or bridge's type, and the point panel sets a point's kind and link.
    Triggers are written in the map file for now (no editor control).
- Fixed: saving a map in the editor dropped its naval, trench-facing and Assault clock settings and every spawn's
  "Assault only" flag. Three Islands, No Man's Land, the XL maps, Bastogne, Helm's Deep and Stalingrad Factory lost
  them when saved. The editor and server now keep every setting the map check knows.
- Left for later: cells that hold two things (a mine under a road, wire in woods). Mines are a terrain type today,
  so it means changing every mine check and how fog hides them.

- The AI fortifies the points it holds: mines, a trench arc or strongpoint, a belt of barbed wire across the
  approach, and tank traps once you have shown it armor. It keeps less manpower back to do it, and a squad holding a
  point from a house now steps out to build while the point is quiet, then goes back in. On the default map it digs
  about three times as much as before. Balance (90 AI matches): faction wins 30/37/23 -> 26/31/33, spawn wins
  34/37/19 -> 34/28/28, median length 9.3 -> 9.0 min.
- Left for later: a point held by a mortar, AT gun or flak never gets fortified (only the first unit there holds it),
  and the AI does not build MG nests, sandbags or a Field Hospital.

- Shell holes, rubble and burnt ground are blast marks instead of filled squares. A lone hit is strongest in the middle and leaves grass in the corners. A bombed block is one torn patch, with bites along the edge and craters that run together. A line of bombs is a ragged run: the banks wander and the bright rim is gone on dug ground, instead of a row of equal pale bowls. A wrecked house is broken wall stubs and spilled rubble, not a shorter box. Feet can sit a couple of metres off the visible lip, because the lip slides and the ground under a unit does not.
- Trenches are real cuts in the ground now: the terrain drops 0.9 m along every trench, with sloped walls and the
  channel running on between connected cells. Men in a trench stand on its floor instead of sinking through flat
  ground, and anyone walking across one dips into it. The timber revetments line the walls from floor to lip and
  MG nest sandbags sit on the lip. Visual only: cover and sight lines are unchanged.
- Trenches are a mechanic now, not just a bigger cover number:
  - **Settling in**: a squad that just jumped into a trench gets ordinary cover. After 8 s standing still it is dug
    in and takes 0.3x incoming fire (was a flat 0.35x).
  - **Facing**: a trench you dig faces away from the diggers (rings, arcs and strongpoints face outward). Fire from
    the front meets the full trench; fire along it or from behind gets only ordinary cover. Flanking a line pays, and
    a captured enemy trench faces the wrong way.
  - **Hidden**: a squad in a trench that is not firing is seen only within 18 m. Firing gives it away.
  - **Communication trenches**: infantry move 20% faster along trenches.
  - **Steady**: suppression wears off almost twice as fast in a trench.
  - **Caving in**: enough shelling turns a trench cell into a crater, and tanks crush trenches they drive over.
  - Balance (150 AI Conquest matches, default map): faction wins 50/47/53 -> 44/50/56; spawn wins 51/49/50 ->
    62/54/34, which may be noise (see DESIGN.md "Trench rules"); games slightly less close (runner-up VP 0.49 -> 0.44).
- New map **No Man's Land** (2v2): two trench systems facing each other across wire and a cratered middle, made to
  show off the trench rules. Its trenches face the enemy (new map option `trenchFacing`).
- Planes: Shift- or Ctrl-click a plane in the air panel to add it to the selection (or drop it), double-click to
  select all your planes. Before, a click always replaced the selection, so you could not send several at once.
- Left for later: the AI does not yet flank trench lines or shell them on purpose; the client does not draw which
  way a trench faces.

- Boats in every mode: on a naval map, Conquest, Assault and Annihilation now offer the Landing Craft, Gunboat and
  Destroyer in a new **Naval** group of the recruit bar (140, 220 and 700 MP). A bought boat launches on the water
  nearest your HQ (a destroyer on the nearest deep water). Classic still trains them at the Shipyard.
- The destroyer fires broadsides: all four gun mounts turn to the target and each fires a shell with its own muzzle
  flash. A salvo is now four shells of 22 (32 against vehicles) instead of two of 40 (60), about the same weight.

- Warships (Classic, naval maps), trained at the Shipyard:
  - **Gunboat** (PT Boat / S-Boot / Armored Boat, 170 MP + 40 Fuel): the fastest unit (10 m/s), a rapid autocannon
    against boats and the shore, and a **Torpedo** (Munitions, 40 s cooldown) that hits a boat or ship for 25 times
    a normal shell (300 damage) and is never wasted on anything ashore.
  - **Destroyer** (Fletcher / Zerstörer 1936 / Gnevny, 520 MP + 180 Fuel, max 2): true size, 110 m long, 2400 hp.
    It keeps to deep water (at least 20 m from any shore or surf), so it cannot run aground. Its guns reach 120 m,
    further than anything ashore, and arc onto whatever your side spots, so it needs eyes on the ground. Flak against
    planes. **Shore Bombardment** (40 Munitions): eight heavy shells on a spot.
  - A ship is hit and seen along its whole length, not just at its middle.
- Fix: a Shipyard can now go up on a beach. Before, it needed open water within 2 cells, and every beach on Three
  Islands has 6 cells of surf, so only cliff tops were allowed and most players found nowhere to build it.
- Left for later: a coastal battery to answer the destroyer, the AI using any boat, shells and blasts still treat a
  ship as its middle, and the destroyer's balance is untested beyond the unit tests.

- Naval warfare, first slice (Classic only, on maps marked naval). Engineers can build a **Shipyard** on the coast
  (150 MP, needs water or surf beside it). It trains the **Landing Craft** (LCVP / Sturmboot / Assault Boat, 120 MP + 15
  Fuel): a fast, thin-skinned boat with two light MGs that floats on water and surf only. It carries one squad like a
  halftrack: right-click it with infantry to board, Unload to land them. A squad lands only where dry ground or
  wadeable surf is within 5 m, and a squad in a boat sunk far from land drowns.
- New map **Three Islands** (1 km, up to 6 players): three home islands and a central islet, no bridges. Each coast
  has beaches with surf where boats can land and cliffs where they cannot. Generated by `tools/genmap-islands.mjs`.
- Maps can now be up to 1024 cells (2 km) on a side; the lobby preview crashed on maps over about 350 cells (fixed).
  Measured: a 1 km map with six Massive AI armies runs at 2.1 ms per tick (11 ms p95, of 50 ms); the browser holds
  about 450 MB of JS heap on it against 76 MB on King of the Hill, so 1 km is the practical ceiling for now.
- Left for later: the AI does not use boats yet (on Three Islands the AI defends its island and never attacks),
  warships, coastal guns, beach obstacles, supply across the sea, and a longer Sudden Death for 60-minute games.

- Conscripts take three quarters of a place in the army limit, so the USSR can field a third more squads than anyone else (32 instead of 24 in Classic). The army count in the HUD can show quarters, and a unit only goes into the queue if the whole unit fits.
- Smoke is no longer a cloak of invulnerability. It still blocks sight lines 15 m and longer, so it screens you from tanks and guns at range, but anything closer sees and shoots through it. Before, a unit in smoke could not be seen or hit beyond 6 m.
- Balance, 150 AI matches on the default map (seed 1000), before -> after both changes: faction wins USA/Germany/USSR 39/58/53 -> 46/46/58, median length 473 s -> 465 s, runner-up VP share 0.44 -> 0.44. The USSR edges up from 35% to 39%, inside the swing earlier runs showed.
- Fixed: dead or fogged units (yours and the enemy's) stayed on screen with their health bars and icons ("That target is not visible" when you attacked them) until a reload. The cause: a game server started before the snapshot deltas, serving the newer page, which only drops a unit the server names as gone. The page now treats a snapshot from such a server as the full list. Each snapshot also says which units your game should hold; if it ever disagrees, your game asks for a full resend and repairs itself within a fraction of a second, and the browser console shows "unit rows out of sync".

- Teammates now spawn on the same side of the map. Spawns are matched by walking distance over the terrain, so a river, cliff or sea between two spawns keeps them on different teams: on Pegasus Bridge, Ardennes, Seawall, Kasserine and Monte Cassino a 2v2 or 3v3 always splits one bank against the other. Before, spawns were dealt in map-file order with a random rotation, which could put teammates on opposite banks. Which side your team gets still changes each match, and a free-for-all spreads players evenly.
- Smoother play on slow connections: snapshots are compressed, and each one now carries only the units that changed (plus the ones that died or slipped into fog), with wrecks and resource nodes sent only when they change. Measured on Six Fronts with Endless armies over 300 s of AI play (360 units at the end): late-game snapshots went from 10.2 KB to 7.3 KB raw and about 2.7 KB on the wire (3.7 KB compressed before the deltas, 10.2 KB uncompressed before this change). Building and encoding snapshots for six players went from 11.4 ms to 6.6 ms per send.
- Spectators: the server builds one snapshot for all of them instead of one each, and replays only new terrain changes (1.0 ms and 23.6 KB down to 0.4 ms and 15.4 KB per broadcast, at 3000 changed cells). A spectator who joins late still gets the whole map and every unit.
- The client only touches health bar, suppression bar, cover shield and sniper camouflage materials when their look changes, instead of on every unit every snapshot.
- Left for later: the team fog pass (`teamFog`) still reruns on every vision pass; it is already shared per team and cached between passes.

- Smoother big battles: all soldiers that look the same are now drawn together in one go instead of one by one, so 30 infantry squads cost about 60 draw calls instead of about 250 (fewer still at a distance), and squads off screen are skipped. Health bars only show on units that are hurt, suppressed, selected or under the cursor. The terrain no longer casts shadows on itself, the weather stops re-applying the light once it has settled, digging and shelling re-place only the nearby trees and rebuild the trenches and minimap at most 4 times a second, and the cursor check under the mouse runs every fourth frame. Bar materials are now freed when a unit is removed. To check in the browser: soldiers posing and walking, the far-away models, sniper camouflage and the `?perf` draw-call count.
- Fallen soldiers stay the soldiers who fell. A dead man lies as if he fell rather than aiming from the dirt. He keeps his uniform, helmet and kit, stays where he dropped, then sinks and fades. Bodies are no longer brown capsules. Up to 200 stay on the field, in one draw per uniform.
- Left for later: a wiped gun crew's weapon still disappears with the squad. Vehicle wrecks are still the real hull, darkened.

- Computer opponents play as a commander for the match, instead of issuing every perfect order on the same look.
  Each look is one situation: wait, hold, or attack, and that plan stays until the objective falls, the push fails,
  a watched enemy hits something they hold, or the time they gave it runs out. Easy keeps a plan longer than Hard.
  A tank they saw and then lost still keeps their rifles off that ground, and the next rifle or machine-gun purchase
  becomes an anti-tank gun, until the sighting is a minute old, they look and the ground is empty, or the wait runs out.
  If they already have an anti-tank gun, that gun goes toward the tank and the rifles stay back. The rest of the army
  does not freeze: a point clear of that tank is still taken. A watched enemy on a
  point, depot, or base they hold pulls idle squads there and stops a second attack for that look. A unit they have
  only just spotted does not break the plan and is not struck yet. An announced enemy air strike is still answered
  at once. When squads die on a point, the next push asks for a bigger margin and prefers a different point. Taking
  a point spends some of that caution, so a lesson can fade. The memory lasts one match. It is not a language model,
  and it still sees only what a player in that seat would see. A large AI-versus-AI balance sample was not rerun.
- New **Formation** menu in the Orders panel: line, block, column and wedge (Shift+V cycles), Tighten and Spread (`[` and `]`) to re-form units where they stand, March together (the group moves at its slowest unit's pace) and Snap to trenches (infantry placed next to a trench step into it). Mortars, rockets and medics stand in the rear rank.
- A wider right-drag now fits more units side by side, so a long drag gives fewer ranks. A double right-click turns the selection to face a spot without moving.
- Control groups remember their formation: Ctrl+number saves it, recalling the group brings it back.
- Less clutter: fortifications moved into a **Build** menu and dig patterns into a **Trenches** menu. Their hotkeys still work with the menus closed.
- Left for later: queued legs do not keep the march-together pace, and a group's saved formation does not include its facing.

- Big battles run smoother on the server. Unit separation uses its own fine 4 m grid and filters before sorting, vision shares one nearby-enemy query per 16 m cell, mortars count a target's neighbours from one query, radius queries filter before sorting, and the server builds the snapshot cache once per send tick instead of twice. Bastogne Horde (3 AI, endless army, 6000 ticks, seeded) at 300 to 399 units: step p50/p95 7.7/21.5 ms to 6.4/13.1 ms, worst step 34.5 to 21.7 ms, snapshot p50 3.1 to 1.5 ms. Same final state hash before and after, so replays and AI results are unchanged. One side effect: orders an AI gives on a send tick reach human snapshots one send later (about 0.1 s).
- Checked and left alone: the path budget counts findPath calls (default 4096 per tick, so it never limits), not node expansions. It does not explain step spikes: the slowest steps in the run above had no path work, and the heaviest path tick (5042 expansions) took 9 ms.

- Spectator mode. In the lobby, "Watch as a spectator" gives up your seat; "Take a seat" sits you back down. A
  spectator sees the whole map with no fog, every army and every shot, and has no orders, resources, recruit bar or
  alerts (the banner under the scores says "Spectating"). Anyone who opens the invite while a match runs, or when all
  six seats are taken, now watches instead of waiting outside. Up to eight spectators per room.
  - AI-only matches: step back to watch, add AIs and start. With nobody seated, the first spectator hosts (start,
    pause, end, restart). A match still needs at least one seat.
  - A spectator who disconnects is simply gone (no pause, no seat kept). A spectator reconnecting keeps watching.
  - Left for later: picking whose side to watch from. The view sits on the first seat's side, so friend and foe
    markers follow that player.

- Unit balance: rocket trucks, armored cars and MG teams.
  - Rocket launcher: damage to vehicles 30 -> 12 per rocket. It still breaks infantry and garrisons, but no longer
    beats light vehicles. Range, reload and cost are unchanged, and there is no limit on how many you can field.
  - Armored car: damage to vehicles 6 -> 14, so the unit meant to hunt rocket trucks and other soft vehicles can
    kill them. It still loses badly to tanks and AT guns.
  - MG team: damage to infantry 2.4 -> 4 per hit.
  - Measured on open flat ground, 2000 MP of one unit against 2000 MP of another, both attack-moving (share of army
    left, first minus second): armored car vs rocket -22 -> +78, mobile flak vs rocket -72 -> -35, armored car vs
    light tank -87 -> -73, MG vs rifles -77 -> -66, MG vs Rangers -45 -> +24. Ten MG teams set up and waiting for
    15 rifle squads went from wiped out (rifles keep 64%) to nearly even (MGs keep 4%, rifles 16%).
  - 60 AI matches on Three Crossroads, before -> after: faction wins USA/Germany/USSR 24/19/17 -> 20/17/23, median
    length 439 s -> 444 s, runner-up VP share 0.42 -> 0.42. Too few matches to call the faction shift real.
  - Rocket launcher, second round: it is now area artillery. It no longer fires at units on its own; a salvo lands
    where you order a Rocket Barrage, on a unit you give it an attack order on, or by autocast on a crowd (3+ in one
    blast area) or a dug-in enemy. The barrage is ready every 20 s (was 45) and is free in Classic (was 25
    Munitions), so autocast starts on there too. Speed 5 -> 3.5: moving it is a commitment.
  - Infantry against vehicles: rifle squads' damage to vehicles 0.4 -> 1.5, conscripts' 0.3 -> 1.1. A rifle army now
    beats halftracks (-72 -> +59), armored cars (-23 -> +82) and mobile flak (-68 -> +55) at equal cost, and still
    loses to light tanks (-85 -> -44) and medium tanks (-82 -> -25). AT guns stay the answer to tanks.
  - Nine rocket trucks defending against an equal-cost army attack-moving into them: against rifle squads the trucks
    kept 63% and the rifles 0% (with the infantry change alone); as area artillery the trucks keep 12%, the rifles
    5%. Against conscripts 61%/0% -> 6%/6%. A mass of trucks is now an even trade with infantry, not a wipe, and
    still punishes a crowd or a garrison.
  - AI matches on Three Crossroads after the merge with #29, before -> after both rounds: 150 matches (seed 1000)
    faction wins 46/53/51 -> 57/52/41, median length 474 s -> 464 s, runner-up VP share 0.46 -> 0.45; 60 matches
    (seed 1) 15/24/21 -> 19/13/28. The two runs swing opposite ways, so no faction effect shows above noise.
  - Left for later: MG teams still lose to equal-cost conscripts in the open. A slower truck (5 -> 3) made no
    difference in a straight fight; the speed cut is for feel. Planes, off-map support, cover and houses were not
    part of these tests. The trucks are still drawn as trucks (a towed gun would need new models).

### 2026-10-01. Individual soldiers and troop selection (`c55fd0f`, `69575e3`, `c27bcef`)

- Soldiers now walk, crouch-walk, crawl and retreat with moving limbs and individual stride timing. Men follow and turn separately inside their squad, keep their boots on the ground, and stop stepping when they stop. Moving shooters aim at their target, with flashes attached to the animated weapon. Squads return to normal spacing when a trench disappears.
- Troop selection follows visible soldiers and health bars, including squads spread along trenches and inside houses. Box selection works across mixed troop types without selecting a squad first. Small boxes cover the full posed soldier and rooftop bar, including prone boots. Saved groups skip passengers and parked aircraft, then include them again after unloading or launching. Dead squads stay excluded.

### 2026-10-01. Behavior and formation facing (`5b8783c`)

- Units choose targets by weapon role and incoming fire, keep space between squads, settle plain moves into nearby cover, and turn vehicle armor toward anti-tank threats. Automatic cover moves respect Hold position and Hold fire. Crowded destinations keep available shelter instead of choosing closer open ground just for spacing.
- Right-drag a destination to arrange selected units and set their facing. Shift queues the facing, and Ctrl-drag or G then left-drag attack-moves. Infantry and guns face on arrival; vehicles turn their hulls. Halftrack boarding and other special right-click orders still work.
- Mortars and rockets count only visible squads when choosing a cluster to fire on. Hidden squads and halftrack passengers cannot influence that choice.
- Fixed sight rays ending exactly on cell borders and the map editor's route check when it has terrain without player state.
- Diagnostic matches found that target choice changes the share of hits taken on cover tiles. That measure differs from time spent in cover. Seeded comparisons and the independent cover-time measure are recorded in DESIGN.md. No faction costs, weapons or health were retuned.
- Paired balance runs completed 300 Conquest and 120 Classic games per build. USA/GER/USSR wins changed from 102/91/107 to 98/101/101 in Conquest, and 41/39/40 to 30/43/45 in Classic, with two final Classic draws. Conquest crowding fell from 44.5% to 11.7%; sampled infantry time in cover changed from 27.3% to 25.8%. These results include both behavior and AI changes. See the committed balance evidence for the full comparison.

### 2026-10-01. AI difficulty (`bbd170a`)

- Hosts can choose Easy, Normal or Hard for each AI seat before a match. Difficulty changes reaction time and tactics, with the same income and fog rules at every level. Squads fall back at their last model, wait for reinforcements at forward Classic production buildings, and recognize medium tanks and Tigers when buying AT guns.
- Hard keeps onward move orders when changing focus targets and stops chasing retreating squads. Supply reconnection stays immediate at every difficulty.
- AI pilots, 18 matches per comparison: Conquest Hard / Normal 14/4, Easy / Normal 2/16, Normal / master 9/9; Classic Hard / Normal 11/7, Easy / Normal 3/15, Normal / master 6/12. All 108 games ended without draws or timeouts. These small samples do not establish Normal-versus-master parity in Classic.

### 2026-10-01. Controls and cover overlays (`b6fa1df`, `4faefee`)

- Controls are in a `?` / `F1` sheet, with mouse instructions and current hotkeys. It appears on your first match in this browser and closes with your first click. Map-edge scrolling pauses while the sheet is open.
- Infantry preview cover around the cursor with green shields for heavy cover, yellow for light cover and red for open ground. Direction marks show protected sides, and a move briefly shows the destination's cover. The menu's Cover preview switch saves its setting. Marks stay inside explored ground, including after a rejoin.
- Ground rings, order lines, capture progress, strike zones, formation previews and fortification cells use thin, smooth lines that follow hills and craters. Queued orders use dashes and destinations use arrowheads. Unit cover shields share the preview colors.
- Cover marks refresh when vehicles or enemies move inside a terrain cell. Woods and wreck cover follow the current rules. Exact wall health remains unavailable to the client, so some marks behind damaged walls can overstate protection. Categories show the kind of protection rather than its exact strength.

### 2026-10-01. Grounded world and effects (`b5b7def`, `8a4a7d8`)

- The battlefield continues into natural land and water beyond the playable map. Removed the wooden table, desk props, cut earth border and tilt-shift blur. Ground colors and light are more muted, with an optional golden sun through `?mood=golden`. Server vision fog, weather and changing ground extend across the world edge.
- Fixed fog at the world edge and crater updates on previously flat edges. The combined build was checked in the map editor and on a real GPU in a Massive match. Measurements and limits are in `docs/issue-batch-verification.md`.
- Explosions throw dirt and debris, leave craters and cool from fire into smoke. Smoke screens, burning wrecks, grass, hedges, woods, houses and aircraft share lit effects that drift with the wind. Graphics Low reduces particles and crater count. Removed the unused support-plane effect pool and fixed one-sided collapse dust on Low. Sprites still can intersect walls and units; they fade against terrain only.

### 2026-10-01. Unit models (`2235ce3`, `4127dbd`, `8e47836`)

- Infantry have clearer faces and helmet straps, thicker webbing and bags, a rounder Soviet greatcoat roll, and three rifle stances. Prone riflemen support level weapons on their elbows, kneeling feeders lean toward the belt, and distant helmets keep their domed shape. The unused draft is folded into the live model. Each soldier uses one draw call, at most 884 near triangles and 145 far triangles.
- Shaded vehicle faces keep their paint and surface detail. Light tanks have clearer hull seams and rivets, Tiger wheels are separated, and the ZSU-37 has lower shields and a fuller breech. Vehicles remain within their triangle budgets and use two model draw calls.
- German planes have smaller splinter camouflage broken into uneven angular patches. All fighters and attackers stay within the 3,500 triangle limit, including props and blur discs.
- Left for later: medics still use the engineer figure, including its carbine, although they are unarmed in combat.

### Earlier unreleased changes

- Woods, mine clearing, halftracks, medics, the Field Hospital and supply lines.
  - Woods (new terrain): infantry in a wood get light cover (30% fewer hits, a wall gives 50%), sight reaches about
    three cells (6 m) into the trees and never through a wood, vehicles drive through at half speed and route around,
    and nothing can be dug or built there. Woods burn (a cell burns for 20 s, the fire runs through the trees) and
    heavy shelling clears them. Three Crossroads, Crossroads Village, River Towns and Ardennes Crossing now have woods
    on the flanks of each HQ's road to its nearest point (`node tools/woods.mjs <map>` stamps them). The map editor
    has a Woods brush.
  - Finding mines: a rifle, conscript or engineer squad that stands still for 2 s finds enemy mines within 6 m
    (Engineers find them on the move). Found mines show to the whole team, and the team's units route around them.
  - Clear mines (Shift+M, 5 MP per 4-cell piece, drawn as a line like sandbags): builder squads lift the mines their
    side knows about, working from a few metres back.
  - Halftrack (180 MP; Classic: Motor Pool, 140 MP + 20 Fuel): fast, light MG, thin armor. It carries one infantry
    squad: right-click your halftrack with infantry selected and the nearest squad climbs in; Unload (Shift+E, or the
    button) lets it out. A squad inside cannot be seen, shot or ordered. If the halftrack is destroyed the squad is
    thrown out with 30% losses. Infantry within 10 m of a halftrack that has stood still for 2 s reinforce there
    (same price as at the HQ, half the pace).
  - Medic team (120 MP; Classic: Barracks): two unarmed men. They heal the most hurt friendly squad within 10 m at
    2 hp per second, for free, but only a squad that has taken no damage for 5 s.
  - Field Hospital (100 MP, on the builder squads' orders panel, 12 s to put up, one per player): a tent. Your side's
    infantry within 12 m reinforce there like beside a halftrack. Shelling destroys it.
  - Supply lines (every mode but Horde): a point pays its manpower, victory points and Munitions only while a
    vehicle could drive to it from its owner's HQ (or a teammate's). Rivers without a bridge or ford, walls, tank
    traps and cliffs block the way, and so does the ground within 8 m of an enemy fighting unit, unless that enemy
    is within 16 m of the point (that is a fight for the point, not a cut road). A cut point shows "Cut off: no
    supply", a red cross on the minimap and an alert. Checked every 2 s.
  - Computer players buy one medic team once they have five infantry squads and keep it with the army, lift mines
    their side has found, and send free units to reopen a point of theirs that is cut off. They do not buy
    halftracks or build hospitals.
  - Balance, Conquest, AI against AI, 150 matches per map, everything on against woods and supply off (medics in
    both): Three Crossroads wins per spawn 37/44/19% (39/41/20%), length 465 s (475 s); River Towns 36/39/25%
    (36/40/24%), 519 s (503 s). No measurable change. Ardennes Crossing, 100 matches, four-way: 53/1/46/0%
    (53/0/47/0%): two of its four spawns never win, with or without the new rules.
  - Supply was never cut in those 550 AI matches: the computer does not block roads on purpose, and these maps have
    fords beside every bridge. So the rule is untested as a balance factor between people.
  - Bug fixed along the way: a grenade or satchel ordered at a spot with no way to it could crash the match after
    20 failed route searches.
  - Not checked in a browser (the browser tools could not reach the local server this session): the new models, the
    wood trees, the hospital tent, the Unload button and the cut-off marker are unseen. `node test.js` passes.
  - Left for later: the fog of war drawn on the client does not know woods hide things (the server does). The
    Command Card now has 16 cards for 15 letters, so the last one (the ground-attack plane) is click-only. A found
    mine stays known after the squad that found it leaves. The halftrack is drawn on wheels only.
- Houses now come in three types, set by how big the building is on the map: a wooden shed (10 cells or fewer) is weak
  cover and falls fast (55% incoming accuracy, 250 HP per cell), a brick house (11-23 cells) is what every house used
  to be (35%, 400 HP), and a stone building (24+ cells) is a fortress (25%, 650 HP). The tag on a garrisoned squad
  names the type.
  - A house protects less as it is shot up: the squad's own cell slides to 85% / 70% / 55% just before it collapses,
    so shelling a garrison hurts it before the house comes down.
  - Balance, 40 AI matches per map, old rules vs new: 2nd place's VP share fell from 58% to 53% (default), 56% to 51%
    (River Towns) and 76% to 68% (Stalingrad Factory); match length moved by 15 s at most. First-guess numbers.
  - Each type has its own model, so you can read a building before you send a squad in. Sheds are timber: plank
    walls on a low stone footing, tarred corner posts, a braced plank door and grey shingles (about half of the 3x3
    ones are barns). Houses are brick or limewashed render under clay tiles, with stone corners and lintels. Stone
    buildings are bare stone under slate, two storeys or more, with pale dressed lintels and a band between storeys.
    Ruins and rubble keep the material (splintered boards, broken brick, broken stone).
  - The church is now always a stone building, so maps with no block of 24 cells or more have no church. Fieldstone
    farmhouses are gone from the mid-size houses, since stone now means the strong type.
  - Left for later: the AI does not yet weigh a house's type or damage when it picks one to hold.

- Line infantry now marches as a battalion: a block of ranks instead of a handful of men. Rifle squads draw 15 men
  (3 ranks of 5), conscripts 21 (3 of 7), rangers 12 (2 of 6), engineers 6 (2 of 3). Looks only: health, damage and
  cost are unchanged, and the rear ranks fall as the squad loses health. Weapon crews and snipers stay as they were.
  - In a trench the block breaks ranks: the men line the trench cells nearest the squad (up to four to a cell)
    instead of standing sunk into the open ground beside it, and form up again when they leave. Squads sharing a
    trench take separate spots; only when a stretch is full (more than four men per cell) do the extra men double up.
  - Fixed: men a squad got back by reinforcing near its spawn were never drawn again.
  - Left for later: each man is his own mesh, so very large armies draw about 3x as much; instance them if it stutters.

- Sandbags, barbed wire, tank traps and minefields can be drawn out as one continuous line, like a trench line.
  - Their buttons and hotkeys now take two clicks: where the line starts and where it ends. A short line is one piece
    (as before); a long one is up to 12 pieces end to end. Every selected builder squad works on it, each piece is paid
    for when a squad starts it, Shift on the second click queues it, and other squads can be sent to help by
    right-clicking the ghost while pieces are left.
  - Piece lengths and prices are unchanged: sandbags 4 cells for 20 MP, wire 5 for 25, tank traps 4 for 40, mines 4
    for 40. The ghost shows each kind in its own colour (wire brass, sandbags tan, traps grey, mines red).
  - The plain Trench (T), the MG nest and the bridge keep their single placement.
  - Not checked in a browser. Computer players still place these one piece at a time.
- Entrenchment ghost: works stay on the ground until they are dug.
  - Bug fixed: the ghost only listed segments nobody had started. A segment vanished the moment a squad took it, so a
    pattern with as many squads as segments showed no ghost at all, and there was nothing to right-click for help.
    Segments a squad is walking to or digging now stay in the ghost, and their cells drop out one by one as they are dug.
  - A single fortification (trench, sandbags, wire, tank traps, MG nest, minefield, bridge) now shows the same ghost
    while its squad walks over and builds it. Allies see it, enemies do not.
  - Right-click to help still joins only a pattern that has segments left to hand out. A segment that already has a
    squad on it cannot take a second one.
- Flooding: a crater next to a river or ford fills with water.
  - It becomes a ford as deep as the crater was: everyone wades through it slowly, it gives no cover any more and
    nothing can be built on it. A flooded crater floods the crater next to it, one cell every half second, so water
    creeps down a line of shell holes. It never drains.
  - A crater on ground higher than the water stays dry. Craters that touch water on the map at the start of a match
    fill in the first second.
  - Left for later: trenches do not flood, a deep crater does not become impassable river, rain does not fill craters.
  - Not checked in a browser, and no AI balance run yet (shelling a riverbank now removes cover instead of making it).
- Wrecks: a destroyed vehicle no longer disappears. Its burnt-out hull stays where it stopped and is cover.
  - Infantry behind a wreck get the same cover as behind a live vehicle: full within about 2.5 m, fading to nothing
    at 4 m, from the front only. A squad standing on the wreck's cell is in cover as well.
  - A wreck blocks vehicles like tank traps do: tanks have to go around, so a knocked-out tank can plug a road or a
    one-cell gap. Infantry climb over it. It does not block sight.
  - A wreck can be blown apart: it has 300 hp against explosions (a bomb or a satchel charge in one, about four
    artillery or tank shells) and leaves a crater. Wire, sandbags and buildings cannot be put on it.
  - A vehicle that dies on a bridge or in a ford, or on a cell another vehicle stands on, leaves a hull that is only
    cover: it blocks nothing and cannot be destroyed, and goes when the 40-wreck limit clears it.
  - Every tank, half-track, rocket launcher and other ground vehicle leaves one. Planes, guns and infantry do not, and
    neither does a vehicle that went into the river with its bridge.
  - Up to 40 wrecks lie on the field. Past that the oldest is cleared away. Before, the hull was only drawn for 40
    seconds and never gave cover.
  - Everyone sees every wreck, also through fog and after reconnecting.
  - Not checked in a browser. Computer players do not look for wrecks to hide behind, and do not shoot wrecks out of
    their way (their tanks path around).
- Scarred ground: shelling sinks the ground, bomb holes are round, and squads can fill holes back in.
  - Artillery now sinks the ground around where its shells land, not just the one cell under each shell. A cell goes
    one level (2.5 m) down for every 600 terrain damage it takes, which is about three barrages on the same strip, and
    it becomes a crater when it sinks. Tank shells count a quarter (roughly 35 shots on one spot per level). Bombs are
    unchanged in speed: one level at once. Rockets, mortars, grenades and satchels do not sink ground.
  - The limits are the old ones: nothing goes below level -2, and a cell never ends up more than one level below the
    ground beside it, so a pounded field sinks as a bowl from the middle out, never as a shaft.
  - Bomb holes are round. A Bombing Run bomb digs a 4.2 m hole and a Dive Bomber a 3.2 m one, measured from where the
    bomb lands (not snapped to a 3x3 square), two levels deep in the inner half, with craters across the whole hole.
    Under a river the bed is only dug once.
  - New order, Fill in (Shift+L, 10 MP, a line like sandbags): builder squads turn craters, flooded craters and sunken
    ground back into open ground and raise it towards the height the map had, at most one level above the lowest
    ground beside it. A deep bowl takes several passes, deepest cells first. Fords drawn on the map cannot be filled.
  - Buildings can go on ground with one level of fall across the footprint. The builders level it to the highest
    cell. Before, any dip under a site blocked it, which shelling would now cause all the time.
  - Computer players fill holes too: flooded craters and sunken ground within reach of a point their side holds, and
    on a free supply node (so a shelled node can take a depot again). One job at a time, with 160 MP or more in hand,
    never with a visible enemy within 35 m, and only a squad within 60 m goes. Dry craters at the map's height are
    left alone because they are cover. Their artillery and tanks scar the ground like anyone's.
  - Not checked in a browser. No AI balance run.
  - Left for later: a hole two levels deep hides its bottom from a squad a few metres back, so a Fill in order there
    answers "not visible" until the squad stands at the rim.
  - Test fix: the lobby check "a new match without the old result" raced the lobby message and failed about half the
    runs. It now waits for it. `node test.js` passed 5 of 5 afterwards.
  - Found, not fixed: `node test.js` fails about one run in three on the lobby check "a new match without the old
    result" (once on "an explicit ground attack overrides the plane stance" with flooding switched off).
- The computer opponents no longer cheat. They plan only from what a player in their seat could know: the same
  snapshots a human receives (units seen right now, buildings and terrain remembered under fog, public announcements),
  with the same rounded numbers. Leaks closed: they knew which resource nodes already held an enemy depot (it steered
  their Engineers and how many they bought), they planned building sites, cover and trenches around enemy buildings
  they had never seen, they knew how long a newly spotted gun had been standing still (it triggered artillery), they
  counted planes for a few ticks after those planes landed, and they used exact health and positions where players see
  rounded ones. They look at the world on the same beat as player snapshots and keep a 60 second memory of sightings.
  The Horde's own seat plays by the same rules: it sees only what its units see, and its waves still march straight on
  the always-visible bunker. Their economy was already identical to a player's, and a test now replays an AI seat's
  orders as a human to prove it. Every order, including entrenching, mines and bridges, goes through the normal command
  checks, and a test fails if the AI changes anything else.
  Balance, same seeds before and after on the current game (default map, 3 players, 20 minute limit). Conquest, 60
  matches: wins USA/Germany/USSR 23/20/17 to 19/17/24, median length 9.27 to 9.15 minutes, all matches finished,
  runner-up VP over winner VP 0.573 to 0.533. Classic, 30 matches: wins 4/8/5 to 7/10/5, finished 17 to 22 (timeouts 13
  to 8), median length including timeouts 19.41 to 18.39 minutes. Left for later: two Engineers can pick the same
  building site in one turn (the second order is rejected normally), the shared auto-targeting of rocket salvos still
  counts hidden neighbours of a visible target, and a hidden mine on a road still shifts vehicle routes (the road is cut
  in the terrain flags), all for players and AI alike.
- Textured units (toward a realistic look instead of painted toys):
  - Soldiers, tanks, wheeled vehicles, guns and planes now show real surface detail: worn and chipped paint on armor,
    scratched gunmetal, rusty track links, rubber tires, wool uniforms, wood and canvas, plus a dust film and dried mud
    that build up toward the ground on hulls, wheels, tracks and boots. Faction paint, markings and owner colors keep
    their hue; the texture adds the wear, and paint is a little faded so nothing looks candy-colored.
  - Twelve seamless textures generated with gpt-image-2 (painted armor, cast armor, gunmetal, track steel, rubber,
    wood, canvas, wool, leather, aluminum, aircraft paint, mud; 512 px, about 1.1 MB in all) in
    `client/textures/models/`, packed into one texture array and mapped from three sides in each model's own space,
    so nothing swims when a turret turns or a squad lies down.
  - No extra draw calls or triangles: a tank is still 2 draws, a rifle squad 5, one faction's full lineup 57.
    Graphics Low turns the textures off (models look as before and cost nothing more), and so does the moment before
    they finish loading.
  - Fixed: the grime turned dark tracks, road wheels and tires into an orange-tan band at the lower hull (reported
    from the medium and light tank models). The dust film and mud clumps are now greyer, never much brighter than
    the part under them, sparser, and held at about a third on track steel, rubber and gunmetal; vehicles gather mud
    up to 0.75 m instead of 0.9 m and track links show less rust.
  - Soldier uniforms on the current models are more muted (olive drab, field grey, Soviet khaki) and helmets take
    less of the owner's color.
  - Model building: a part can say what it is made of (`part(..., mat)`, `merge()` items with `mat`, `tag()`; names in
    `MATS` in `client/models/geom.js`), see DESIGN.md. Toolkit wheels tag their tires as rubber and tracks their links
    as track steel. Model viewer: `&tex=0` shows a unit without textures; the header says whether they are on.
  - Measured in headless Chrome, which only has SwiftShader (software rendering, so texture filtering is far slower
    than on a real GPU): a dense 42-unit battle at 1280x720 keeps 205 draw calls and 200,906 triangles and takes
    about 2.9 s per frame with textures against 1.45 s without (2x; the first version was 2.6x before the shader
    skipped faint triplanar sides, reads the mud layer only where mud clumps can show and skips far-off pixels).
    Frame rate on real graphics cards is not measured yet.
  - Left for later: the model families still have to tag their parts (faces and the infantry base as plain, cast
    turrets, tracks built without `track()`, canvas, wood); until then those parts take the default (painted armor on
    vehicles, wool on soldiers). The airfield uses the near-flat aircraft paint. Graphics Low has no texture at all.
    Found: the room check "a new match without the old result" (a draw, then a restart) failed once in four
    `node test.js` runs and passed on the rerun; it does not touch the models and was left as is.
- New look for the whole interface. The paperwork style (manila cards, typewriter text, stencil numbers, map symbols)
  made the game read like a board game, so the HUD, lobby, menu, alerts, banners, tooltips, match report, end-of-match
  notice, map editor and the labels and badges over the battlefield now share one modern style: dark gunmetal panels
  with thin khaki edges, one condensed typeface (Barlow Semi Condensed) and brass only on manpower, victory points and
  the clock. Layout, hotkeys, element ids and what each panel shows are unchanged.
- Recruit cards, train and build cards and the selection list show a small picture of each unit, rendered from its
  real 3D model in your faction and color. They are made one per frame once the match is under way, so loading and the
  frame rate are not affected, and they follow the models as those improve. Until a picture is ready the slot shows
  the unit's silhouette.
- One set of flat silhouette icons replaces the NATO map symbols and the line icons: unit types, buildings, support
  calls, orders and the badge beside each unit's health bar on the battlefield (drawn there in the owner's color on a
  small dark plate). Costs are plain numbers; resources get a small icon (helmet, cartridge, jerrycan).
- The Victory or Defeat notice at the end of a match is a quiet panel that fades in, instead of a tilted rubber stamp.
- Recruit by letter and autocast take the new look. The Recruit tab, when on, reads in brass with a brass hairline
  and the Command Card's edge turns brass while the letters are live; each card's letter sits at the left end of its
  cost line, clear of the name and the portrait; a card bought by its letter shows the pressed look for a moment.
  An ability with autocast on gets the HUD's on state (brass hairline over a faint brass tint) and a small A, instead
  of a dashed pencil border.
- Stances, Take cover, mass entrenchment, Horde and the weather line take the new look. The stance switches (hold
  fire, hold position, auto-retreat) and Take cover, the six entrenchment patterns (line, zigzag, double, arc, ring,
  strongpoint), mines and the bridge get silhouettes from the same set; a stance that is on shows the HUD's on state
  and reads "On" or "Off" (it read "ON"). Horde's next-wave button, Horde's result line, the lobby's Weather
  picker and the weather line under the teams use the panels, hairlines and plain punctuation like the rest.
- The lobby shows the selected map's real battlefield behind the room form: the camera drifts slowly over it, dimmed so
  the form stays easy to read, and it changes with the Map select. It runs on a small low-resolution renderer of its
  own that is freed when the match starts, is skipped on Graphics Low, and on software rendering (or with reduced
  motion) shows a single still frame. Its world is built in steps in idle time; the biggest step, painting the ground,
  took about 0.7 to 1.1 s on the heavily loaded test machine, and a match on that map reuses the painted ground.
- The Command Card's group names (Infantry, Support weapons, Vehicles, Aircraft) lead with a small silhouette.
- Fixed: starting a match could send the start before the lobby message that clears the last match's result, because
  that message waits on reading the map list. The server now sends the lobby first. It made `node test.js` fail now
  and then on a busy machine ("a new match without the old result").
- Status lines and hints read as plain sentences ("0 pts, 0 held", "60 MP, 20s", "Right-click cancels") instead of
  pieces joined with middle dots.
- Checked in Conquest and Classic at 1920x1080 and 1366x768 (lobby, HQ view, selection with orders and recruit row,
  support calls, alerts, tooltip, menu, pause banner, end notice, match report, map editor): nothing overlaps, all 16
  Conquest portraits render, no console errors. The Impeccable detector (4.1.0) is clean on `client/`.
- Left for later: the portraits show today's simple models and will look better as the models do; a few text glyphs remain (veterancy stars in the selection list,
  the lobby's kick cross, the editor's check and warning marks, the star on double-VP point tags); `client/markers.js`
  still exports the old ink color, unused now; the menu button's tooltip can cover the first menu item while the
  cursor stays on the button.

- Weather: the host picks it in the lobby (Map default, Clear, Fog, Rain, Mud, Snow or Random), and it changes how
  the match plays for everyone. Ground fog cuts sight by 30%. Rain is the living ground's rain held on all match, on
  ground soaked from the start: sight -20%, vehicles off the roads -20% (more on low ground), fords slower, smoke
  thinner and fires put out. Mud is the living ground's soaked ground held all match: vehicles off the roads -20%
  (more on low ground), fords slower, driven ground churning to mud sooner, and infantry -10%. Snow cuts sight by 10%
  and slows infantry by 10% and vehicles by 15%. Roads are the map's roads and bridges. In Clear, Fog and Mud the
  living ground's showers still come and go; in Snow it never rains. Planes and recon flights fly above it. Map
  default follows the map: the Ardennes snows, and the misty river maps (Pegasus Bridge, The Polder, River Towns)
  start in ground fog that lifts at 4:00. Random can lift its fog or turn its rain to mud partway through. Any change
  is announced to everyone 10 seconds ahead in a quiet line under the score strip, which always says the weather and
  what it does, and also tells of a passing shower or wet ground (it replaces the separate rain line). The board shows
  it too: thicker haze and drifting fog banks, rain streaks on the wind with wet ground and puddle sheen (after a
  shower too), mud along the roads and village streets, and snow falling and lying on open ground, on Low graphics as
  well (with fewer drops). The AI waits for a bigger army before marching on a Classic base or an Assault bunker when
  it can see less. Balance, measured before the living ground was merged (Rain was then its own rule at sight -15%),
  AI vs AI on the default map:
  Conquest (40 matches each) 2nd place ends at 0.59 / 0.63 / 0.62 / 0.62 of the winner's VP in Clear / Fog / Rain /
  Snow, matches last 9.2 / 9.6 / 9.3 / 9.1 min, faction wins USA/GER/USSR 6/20/14, 14/15/11, 16/16/8, 15/13/12.
  Classic (20 each) lasts 19.2 to 20.0 min, 14 to 17 of 20 are decided before Sudden Death, faction wins 6/7/6,
  6/8/6, 6/9/4, 9/5/6 (2 draws in all). Found while measuring: asking for groups of 4 instead of 3 to attack a held
  point in poor weather made Conquest one-sided (2nd place 0.26 to 0.37 of the winner), so Conquest groups stay at 3.
  Mud, measured in review (same harness, 40 Conquest matches each): mud ends at 0.60 of the winner's VP, 9.0 min, faction
  wins 14/16/10, against Clear at 0.57, 9.0 min, 15/14/11. That Clear run also shows the 6/20/14 split above was
  sampling noise. Classic in mud (24 matches against 24 in Clear) runs about 2 minutes longer (19.9 against 17.7 min)
  and 7 of 24 reach Sudden Death against 2 of 24 (the same 7 of 24 with the AI's caution switched off, so the slower
  armies cause it, not the AI). The AI's Classic caution on its own (24 fog matches each way) adds about 1.6 min (19.6
  against 18.0) and one more match into Sudden Death (4 against 3).
  Found and fixed in review: the map editor lost the falling snow on winter maps; the lobby tooltip repeated the
  weather's name; Clear is now exactly the game before weather (the weather seed used to take one random number from
  every match, which changed seeded bench runs; checked with the bench's final-state hash on both modes); a
  made-up weather name in a map file or a bad setting falls back to the map default instead of freezing every unit.
  Merged with the living ground (roads, mud, showers and wind, d1b7150): both had rain and soft ground, so Rain now
  runs the living ground's rain all match and Mud its soaked ground, instead of their own rules (Mud was -30% off
  roads; a tank in a mud cell in Mud weather no longer pays twice), the showers follow the match weather, the sim's
  roads are the map's road and bridge cells (village streets only place the mud and puddles you see), the weather's
  sight goes through the same range function as the fog of war (#14), and the two lines under the scores became one.
  Clear is exactly the living-ground game: the seeded bench gives master's final-state hash. Balance after the
  merge (same harness, default map, 40 Conquest matches each): 2nd place ends at 0.47 / 0.47 / 0.53 / 0.55 of the
  winner's VP in Clear / Rain / Mud / Snow, matches last 8.7 / 8.8 / 9.2 / 9.0 min, faction wins USA/GER/USSR
  15/13/12, 9/17/14, 16/7/17, 14/16/10. Nothing is one-sided. Clear is noisy at this size (its two halves gave 0.30
  and 0.63; master's own Clear over 20 matches gave 0.57), and Germany's 7 of 40 in Mud is about two standard
  deviations under an even split, worth a second run.
  Left for later: the match-end test "a new match without the old result" fails on a busy machine: the server sends
  the lobby update after listing the map files, so it can arrive after the start message. It failed twice in a row at
  a load average near 75 after the merge and passed on the next run at 33; origin/master passed at 35 to 70.
- Fog of war now shows exactly what your team sees:
  - Before, the client drew its own vision circles, and they disagreed with the server on 6.4% of the map's cells
    (a quarter of all the cells either side called seen) over AI matches on five maps. 5.7% of the map was drawn
    clear while the team saw nothing there, 0.7% was seen but drawn fogged, and 29 of 477 enemy units the server
    showed stood on fogged ground (on Bocage, all of them).
  - The server now sends each player only its own team's seen cells: the whole mask at match start and on
    reconnect, then only the cells that changed, as short run-length strings. On a six-player Massive game (Six
    Fronts, Conquest) a snapshot grows from 1920 to 2022 bytes on average (+102, about 5%). Working out the masks
    raises the server's cost for one round of six snapshots from 0.77 to 3.75 ms on average (p95 2.8 to 10.7 ms).
  - The ground has three looks: seen (clear), explored (dimmed) and never seen (dark). A cell fades to its new look
    within a quarter second, and only the changed part of each texture row goes to the graphics card (about 1 KB a
    frame instead of the whole 90 KB texture). Trees, rocks and other props now darken in the fog like houses and
    walls already did, and water darkens under the same overlay.
  - Every unit a snapshot shows stands on clear ground: in a replay of 1334 snapshots, 0 of 21108 shown ground
    units stood on fog and the client's seen cells matched the server's every time, and in a live 2v1 match on
    Bocage 0 of 13588 shown ground units over 1465 snapshots stood on fog. A new server test checks each
    team's mask against a cell-by-cell vision check on the 300-unit Massive fixture, including after a hedge, smoke
    and raised ground appear in a standing unit's view.
  - Review fix: houses, walls, hedges and props in the fog now darken like the ground. On High graphics they faded
    toward a mid grey, so hedge rows and trees showed as pale shapes on dark ground. The fog mix ran after the colour
    conversion, which High does in a later pass, so it used a grey meant for Low. It now mixes toward the overlay's own
    colour before conversion, and both graphics levels match the ground.
  - Review checks: a live reconnect on Bocage kept every explored cell and the changed-cells stream stayed in step
    afterwards (0 of 15818 shown ground units outside the server's mask over 1274 snapshots). Replays of Classic
    (Default, Bocage) and Annihilation (Hill 112) had 0 mismatches between the client's seen cells and the server's
    mask, and every building footprint matched cell by cell (7340 building rows on Bocage alone). Client fog work on a
    six-player Massive game costs 0.16 ms per snapshot and 0.009 ms per frame on average, about 3 KB of texture upload
    a frame.
  - Merged with the realistic scenery: the new trees, bushes, hedgerow leaves, grass and wheat darken from the same
    server mask, with the same mix as the ground. Their own darkening rule (a multiply written against the old grey
    mix) no longer matched anything, so `client/foliage.js` now uses the shared fog shader as it is.
  - Merged with the living ground: rain now shortens sight by up to 20%, and the drawn fog follows it. The fog and the
    server's vision read one range function, and units standing still recompute their seen cells when a shower
    comes or goes. A new test pass checks that rain shrinks the mask and that it comes back when the rain stops.
  - Left for later: terrain changes (craters, trenches) still reach every client, even in the fog. Enemy planes
    still show over fog (by design), and a camouflaged sniper can stand unseen on clear ground. The fog edge can
    trail a moving unit by up to about half a second (five vision passes a second plus the fade). In Annihilation the
    ground under the always-visible enemy bunkers is clear, and in Horde the last few attackers shown through the fog
    get a clear cell under them the same way. The new test adds about 3 seconds to `node test.js`.
- Living ground: the board wears, burns and gets rained on, and nothing snaps at a tile edge any more.
  - Soft edges: a unit's speed is the average of the ground under its whole footprint, so a tank half on a road gets
    half the bonus. Cover behind a wall, house, hedge or vehicle is full within about 2 m and fades to nothing at
    3.8 m (it used to switch off at 2.2 m).
  - Wear from traffic: every vehicle that drives over open ground cuts it up a little (about 10 tank passes when dry,
    light vehicles count half). Churned ground slows vehicles by up to 30%, then turns into shallow mud, and mud that
    keeps getting driven on gets deeper. Roads do not wear from traffic.
  - Wear from shelling: explosions break up a road step by step (less speed bonus each time) until the cell is a
    crater. A crater that is hit again gets deeper.
  - Depth: every mud, ford and crater cell has its own depth. Mud runs from 70% vehicle speed (shallow) to 35% (deep),
    a ford from 75% to 35% for everyone, and a deeper crater is better cover (from about 40% protection to 70%;
    it was a flat 50%).
  - Shot-up cover: walls, sandbags and hedges show two stages of damage before they fall, and protect less as they go
    (down to half their protection when nearly gone).
  - Slope: going uphill slows a unit in proportion to how steep the next metre is, up to 20% for infantry and 45% for
    vehicles. Crossing a slope at an angle is faster than driving straight up it. Downhill costs nothing.
  - Wind: each match has a wind that slowly shifts. Smoke screens drift with it (up to 1.2 m/s), so a screen laid
    upwind covers an advance and one laid downwind blows away from it. Cloud shade, particle smoke and rain follow
    the same wind.
  - Dust: a vehicle moving over dry ground trails dust and is spotted from 30% further away. No dust in the wet or
    in mud.
  - Fire: heavy explosions (artillery, bombs, rockets, satchels) can set hedges, houses and dry grass alight. Fire
    spreads to neighbouring cells, much faster downwind. A hedge burns for 14 s and is gone, a house burns for 25 s
    and ends as rubble, grass burns for 5 s and does not burn twice. Infantry in a burning cell (or a burning house)
    lose 8 hp a second and get pinned; an idle squad steps out by itself. Burning hedges and houses throw up a smoke
    cloud that blocks sight. Units route around fire.
  - Rain: showers come and go (the first no sooner than 3 minutes in, 1.5 to 3 minutes long, 4 to 8 minutes apart).
    Rain cuts sight by 20%, thins smoke faster, puts fires out four times faster and stops them spreading. The ground
    soaks over 90 s and dries over 4 minutes: wet ground slows vehicles off the road by up to 20% (40% on ground
    below level 0), triples traffic wear, and slows fords by up to another 30%. Roads are unaffected, so they matter
    most in the wet. A line under the scores says when it is raining or the ground is wet.
  - Look: worn ground shows as mud creeping into the grass, broken roads as shelled earth, burnt ground as black
    earth, deep mud and fords darker than shallow ones. Fires use the existing flame, ember and smoke effects and
    leave a scorch mark; rain is thin streaks on the wind with a dimmer sun and heavier cloud shade (streaks are off
    on Graphics Low, like snow). All of it uses the existing painted textures and models; nothing was replaced.
  - Computer players get all of it through the game rules; their vehicles weigh wear, mud, roads and fire when they
    pick a route.
  - Balance: Conquest, 120 three-way AI matches per map, wins per spawn. Three Crossroads 42/33/25% (30/34/36% before,
    44/33/23% the round before that: within the noise of this script). Crossroads Village 51/49%. Hill 112 30/27/13/30%
    (27/27/15/32% before). River Towns 30/43/27% over 240 matches (43/29/28% before): the favoured spawn moved from
    the top one to the second one, most likely because its fords drew shallower depths. Spawns are shuffled per
    match, so no player is favoured, but the map is no fairer than it was.
  - In an average 9-minute AI match on Three Crossroads: about 65 of 360 road cells shelled into craters, 130 fires
    started, 170 cells burnt, 15 hedge cells lost, and only a handful of cells churned toward mud (standard armies
    have few vehicles; River Towns, with its bridge approaches, wore about 100 cells and made 5 new mud cells).
  - Smoke clouds now carry an id in snapshots, so a drifting cloud is the same cloud to the client.
  - Performance: a wear or scorch change repaints only the ground tiles around it. The 3D pieces, scenery, relief and
    water are rebuilt only when a cell's type, height or damage stage changes.
  - Left for later: no lobby switch for weather (the rules take `weather: false`, nothing in the lobby sets it).
    Fire does not spread through the painted crop fields any differently from grass. No rain sound. Wet ground is
    not drawn darker. Houses do not show damage stages. Depth is random per cell, which can favour a spawn on a
    symmetric map (see River Towns above).
- Terrain: roads, mud, buildable bridges and mines.
  - Roads: vehicles drive 35% faster on a road or a bridge and plan their routes along roads. Infantry are unaffected.
    A trench, wire or tank traps can be built across a road, which cuts it.
  - Mud: vehicles move at half speed in mud and route around it when dry ground is close. Infantry are unaffected.
  - Bridges can be built: Shift+K (or the Bridge button with a builder squad selected), click on a river and aim along
    the crossing. 80 MP, up to 5 river cells, built from the bank one cell every 3 s (engineers twice as fast). It is
    an ordinary bridge afterwards: vehicles cross it and explosives drop it.
  - Mines: Shift+J (or the Minefield button). 40 MP for 4 mines in a line. Only your team sees them. A mine goes off
    under the first enemy squad or vehicle that steps on it (45 damage to infantry, 220 to vehicles, 3 m blast) and
    leaves a crater. Your own side walks over them safely. Any explosion that damages terrain (artillery, bombs,
    grenades, satchels) clears the mines it reaches.
  - Maps: Three Crossroads, Crossroads Village, River Towns and Ardennes Crossing now have roads from each HQ to its
    nearest points and between neighbouring points; River Towns and Ardennes Crossing have mud at the ford approaches.
    The map editor has Road, Mud and Mine brushes. The other maps are unchanged.
  - Balance: Conquest, 120 three-way AI matches per map, wins per spawn. Three Crossroads 44/33/23% with roads
    (44/29/27% without, same script). River Towns 39/30/31% (43/28/29% without). No measurable change. The top spawn
    winning about 4 in 10 is there with and without roads.
  - Craters from shelling were already in the game (shells, bombs and rockets turn open ground into crater cover).
    There are no woods in any branch: the trees on the board are scenery only.
  - Computer players use both. The squad holding a captured point lays one minefield across the approach from the
    nearest enemy HQ, 2 m outside the point, before it entrenches, and lays it again when fewer than 2 of its mines
    are left. When a bridge
    that was on the map gets blown, the nearest free builder squad walks to the bank and puts it back (not while
    enemies are within 35 m of the gap). Both keep 150 MP in reserve.
  - Balance with the AI doing this: Three Crossroads 30/34/36% per spawn over 120 matches (44/33/23% before), River
    Towns 43/29/28% over 360 (39/30/31% before, 120 matches). Match length unchanged at about 9 minutes.
  - Bug fixed along the way: a squad ordered to bridge a river from further than 9 m away stood still instead of
    walking to the bank. It now walks to its own bank first.
  - Left for later: computer players only rebuild bridges the map started with, they never bridge a new crossing.
    Nothing detects mines short of shelling the ground. Shells do not crater roads or mud. Mines are drawn as a
    plain dark disc.
- Fixed entrenchment orders leaking unseen terrain or buildings: every segment needs sight when placed and when
  it starts. Refused orders preserve the digging, full queues create no abandoned plans, and follow-up orders wait
  for every squad's paid segment to finish. A single fortification (trench, wire, tank traps, nest) now also needs its
  cells in sight: before, a valid one could be ordered into fog while an invalid one answered "not visible", which told
  the player whether hidden ground was buildable.
- Fixed Take cover letting squads leave trenches, Hold fire being ignored by aircraft and anti-air weapons, and
  crowded units skipping required terrain corners. Full shelling queues now report a refusal, and Shift-queued
  grenades, satchels and barrages can wait for cooldowns and munitions in the browser as they do on the server.
- Fixed Horde starting as Conquest after a map edit removes defender spawns. Very large waves now buy at most
  32 reserve units per tick and store at most 240, keeping the normal wave budgets and unit weights. The remaining
  count is an upper estimate while purchases are unfinished; the final three only appear when all purchases finish.

- Merging unit control with autocast: a squad on Hold fire no longer throws grenades, suppresses or barrages on its
  own (smoke, the AP round and Ura! still go off, and a satchel still needs an attack order). The autocast flag moved
  to snapshot bit 16384, because bit 1024 now marks a squad on a mass entrenchment for everyone.
- Mass entrenchment, follow-up: help, ghost and queueing.
  - The plan stays on the ground: every segment still to be dug shows as faint squares (trench green, wire brass) for
    you and your allies, and shrinks as squads take segments. Enemies do not see it.
  - Send more squads to help: select builder squads and right-click the planned pattern. They join it and share the
    remaining segments. Allies can help on your pattern too; each player pays for the segments their own squads dig.
  - Shift-queue works for more orders. Hold Shift on the second click of a pattern to queue the entrenchment behind
    the squads' current orders (the ghost appears at once). Shift+click the Take cover button, and Shift on the click
    of a grenade, satchel charge or rocket barrage, queue those; shelling a house with Shift held now queues as well
    (it used to replace the orders). A queued ability is checked for cooldown and munitions when its turn comes.
  - Orders queued behind an entrenchment (a move, say) now wait until the pattern is finished. Before, a Shift-queued
    move took the squad off the pattern.
  - A pattern is dropped, ghost included, when it is finished or when nobody is working on it or queued to.
  - Retreat and Stop never queue: they always act at once and clear the queue, as before.
  - Not seen running: the ghost and the right-click to join are tested in the rules and the snapshot, but not looked at
    in a browser.

- New mode: Horde. You and your friends (up to five, AI teammates allowed) share one HQ and defend one command bunker
  against waves that keep growing. Nobody wins: the result is the wave the bunker fell on.
  - Pick Horde in the lobby. It plays on the 11 maps built for Assault (the others are greyed out). Everyone is on one
    team and starts at the same HQ behind one trench line; the horde comes from the attackers' spawns.
  - The first wave comes after 45 seconds. The next one comes 45 seconds after the last is dead, and the host can send
    it early with "Send next wave" at the top of the screen, which also shows the wave number and how many are left.
    When 3 or fewer are left they show through the fog.
  - Each wave is worth 25% more than the last (wave 1: 300 MP of units per defender) and brings new units: MGs and
    mortars from wave 3, armored cars, light tanks and AT guns from 5, medium tanks and rockets from 8, Tigers from
    12. From wave 6 the horde calls artillery and air strikes, from wave 10 it flies planes, so bring Flak. At most
    60 horde units per defender are on the map at once; the rest of a big wave walks on as you kill them.
  - The horde never retreats, never reinforces and ignores the points, which are yours to hold for manpower. You get
    the Assault defender's income (250 MP, +3.5/s) and the Kill Bounty for every horde unit.
  - The bunker has 3000 hp per defender and gets 10% back for every wave you clear.
  - The lobby shows the best run for the map, team size and army size you have picked, and the result says how far
    you got and whether it is a new record. Army size scales the horde too; Endless is not offered in Horde.
  - Balance (AI defenders, Standard army, 3 runs per map and team size, 68 runs over all 11 maps): runs end on waves
    8 to 15, median 12, after 22 to 36 minutes, about the same with 1, 3 or 5 defenders. Massive is harder (waves 4
    and 8 in two runs) and is not tuned. `node tools/horde.mjs <map> <defenders> <runs>` repeats the runs.
- Fixed: a group of units that reached the same waypoint at the same moment could push each other off it forever and
  stand still with their orders intact (seen with horde waves, which start in a clump; it could happen in any mode).
  A unit that makes no progress for a second now walks on to its next waypoint.
- Found and left for later: in Horde, AI teammates do not go out to hunt a mortar that shells the bunker from range,
  and horde vehicles with no way in (a closed ring of tank traps) wait outside until you kill them.

- Unit control, part 4: the computer uses it, and a rebalance.
  - Computer players dig in properly: the squad holding a captured point entrenches an arc of trench toward the
    nearest enemy HQ (a strongpoint with wire when it has 600 MP or more), instead of one short trench line. Soviet
    AIs dig too now (only rifle squads did before, and they field conscripts). A holding squad that is standing in the
    open walks into the trench or other cover.
  - Computer players switch auto-retreat on for their whole army, so a broken squad runs the moment it breaks instead
    of at the AI's next decision two seconds later.
  - The AI does not use Hold fire or Hold position: it has no ambush plan, and on its units they would only mean
    guns that do not shoot. Auto-cover, corner cover, hull turning and spread fire apply to it as to everyone.
  - Rebalance: Ranger Squad 185 -> 200 MP, Tiger 620 -> 560 MP (Classic Tiger price unchanged). Cover that infantry
    find by themselves helped the infantry-heavy USA and did nothing for Germany's Tiger: after parts 1 to 4 the
    factions stood at USA/GER/USSR 41/29/30% over 1400 three-way AI Conquest matches (700 on the default map, 700 on
    River Towns; 38/33/29% before any of this, 1000 matches). With the two prices changed: 36/35/29% over 1400 matches
    (default 38/34/27%, River Towns 34/35/31%).
  - Other modes after part 4, default map, measured before the two price changes: Classic 40/33/27% (90 matches,
    32/38/30% before, both inside the noise for 90); Annihilation 32/37/32% (60 matches), every match finished.
  - Server cost per tick in a three-AI Conquest match went from about 65 to 75 microseconds.
  - Not done: the planned pattern is not drawn after you order it; entrench orders cannot be shift-queued; the on-map
    preview of a pattern was not seen running (the test browser does not render frames in the background), only the
    buttons, hotkeys and orders were.

- Unit control, part 3: stances, auto-retreat, smarter vehicles and fire.
  - Three switches per unit in Orders, all off for new units, so nothing changes until you use them. A switch that is
    on is ringed in brass and tagged in the selection list; click or press the key again to turn it off.
    - Hold fire (Shift+F): the unit shoots only when you give it an attack order. A sniper stays hidden, an AT gun
      waits for the tank you pick.
    - Hold position (Shift+G): the unit never moves on its own, not even to cover.
    - Auto-retreat (Shift+X): the unit runs for home by itself when it falls below 35% strength (a squad of five down
      to its last two men), unless it is already at base. It reinforces there as usual.
    These are independent switches rather than one three-way stance, so a gun can hold fire and hold position at once.
    Enemies who see your unit do not see its switches.
  - Vehicles standing still turn their hull toward the gun that last shot at them (tank guns, AT guns: anything that
    hurts armor), or toward such a gun they are fighting, at about 70 degrees a second. Rifles and planes do not make
    them turn. A flanked tank no longer sits with its rear to the AT gun.
  - Spread fire: units choosing a target count what their own side already has aimed at it. A squad that is already
    getting more than it can survive in the next volley looks further away in proportion, so a big group moves on to
    the next enemy instead of emptying every gun into one dying squad. Attack orders are not affected.
  - Balance (Conquest, default map, 300 three-way AI matches): USA/GER/USSR 42/33/26% (39/33/28% before parts 1 to 3),
    average match 559 s (552 s). The AI does not use the switches yet.
  - Shift+R is deliberately left unbound (an existing rule: R with a modifier must not retreat by accident), so
    auto-retreat is on Shift+X.

- House corners are cover: a squad standing beside a house (or a Classic building), corner cells included, takes half
  the fire from any shooter on the house's side, within 60 degrees of the wall. It still sees and shoots past the
  corner, which a squad hidden behind the house cannot. Fire from the open side is not reduced. The selection list
  shows "By cover" for a squad at a corner. Squads looking for cover (on their own or on Take cover) now prefer a
  corner they can fire from over a spot fully behind the wall. Before this, a house only protected squads inside it.

- Unit control, part 2: mass entrenchment.
  - Six new orders next to the single fortifications, for every selected builder squad at once (rifles, conscripts,
    engineers): Trench line (Shift+T), Zigzag trench, Double line, Arc, Ring and Strongpoint. Click where it starts,
    then where it ends: a line runs between the two clicks; an arc, a ring and a strongpoint are centered on the first
    click and face or reach to the second. Green squares show every cell that will be dug before you commit, and the
    hint says how many segments it is and what it costs.
  - The squads share the work: each takes the nearest of the next segments, the middle of the pattern first, and goes
    on to the next one when it is done. A segment is four trench cells for 30 MP, as before, and is paid when a squad
    starts it. If you are short of manpower the squads dig what you can pay for and wait ("Waiting for MP to dig") for
    the rest. Cells that cannot be dug (already a trench, a road) are not charged.
  - The patterns: a zigzag puts more trench on the same frontage (no special rule against shells: a trench cell is a
    trench cell); a double line adds a second row 6 m behind, on your squads' side; an arc is a third of a circle bowed
    toward the second click; a ring has a 6 to 24 m radius; a strongpoint is an 8 m trench square with two runs of
    barbed wire on the side it faces (170 MP).
  - Any other order (move, attack, stop, retreat, a single fortification) takes a squad off the pattern for good; the
    others carry on.
  - Fixed along the way: a squad standing in cover blocked friends walking through it (part 1 stopped it being pushed
    out, which also made it a wall). Friends now walk past it.
  - Classic balance for part 1 (90 three-way AI matches, default map): USA/GER/USSR 37/38/26% (32/38/30% before).
  - Left for later: the planned pattern is only drawn while you place it, not afterwards, and an entrench order cannot
    be shift-queued. The computer does not use patterns yet (part 4).

- Unit control, part 1: cover.
  - Infantry look after themselves: a squad with no orders that gets shot at walks to the nearest better cover within
    10 m (a trench first, then a cover cell such as a wall, rubble, a hedge or a shell hole, then a spot behind
    something solid on the shooter's side) and stays there. Squads you gave an order keep following it. Crewed weapons
    (MG, AT gun, mortar, flak) never move on their own, so a gun line stays where you set it up.
  - New order: Take cover (Shift+C, or the button in Orders). Every selected infantry squad, crewed weapons included,
    drops what it is doing and runs to the best cover within 10 m, judged against the nearest enemy you can see. Each
    squad takes its own cell. Squads already in a trench or a house stay; "No cover within reach" if there is none.
  - Squads standing in cover are no longer shoved out of it by other units crowding past.
  - Computer players get the automatic part too (it is in the game rules, not the AI).
  - Balance: Conquest, default map, 300 three-way AI matches with rotated factions: USA/GER/USSR won 41/36/23% (39/33/28% before this change on the same script), average match 561 s (552 s). USSR lost about 5 points, at the edge of the noise for 300 matches; left alone until the rebalance in the last part. The Classic run is recorded with part 2.
- New army size in the lobby: Endless. Same unit limit as Massive (5x) but 20x income and starting MP instead of 6x,
  so losses are replaced almost at once and the battle never thins out. Not balance-tested with AI runs; the unit
  limit is unchanged, so server load should match Massive.
- The scenery looks like real places instead of toys, everything at real size (checked against a Company of Heroes 3
  style reference). Trees are real trees: broadleaf oaks about 12.5 m tall with 9 to 10 m crowns, spruces about 14 m,
  Lombardy poplars about 17 m, with bark trunks and limbs and crowns of photographed leaf clusters, each tree its own
  height, girth, heading and shade of green. Bushes and the bocage hedgerows are dense, ragged leaf masses instead of
  green balls, meadow grass grows in tufts across open ground, and about half the ploughed fields stand in ripe wheat.
  Rocks are weathered field stones, fences weathered post-and-rail.
- Houses: two in five farmhouses and every church are fieldstone, the rest limewashed render with stone quoins up the
  corners; flat Normandy clay-tile roofs replace the orange Spanish tiles; windows have depth (a shadowed reveal, a frame
  proud of the wall, a sill, sky in the glass, plank shutters); doors get stone jambs; chimneys get clay pots. Damage
  states and footprints are unchanged.
- The HQ is a real camp: a canvas wall tent with sagging roof, guy lines, an open door and a stovepipe, crates, a drum,
  jerricans and a field table with a map, a 15 m guyed flagpole, and a ring of real-size sandbags (about 0.8 m long, three
  courses) instead of the green box and oversized bags. The barracks, motor pool, depot, command bunker and Classic HQ
  show canvas, timber, concrete and corrugated-sheet grain.
- New textures, generated with gpt-image-2 and made seamless: leaf, spruce and grass sprites (one atlas), bark, plaster,
  roof tiles, canvas and burlap.
- Cost, measured with renderer.info in the same views (before, after): Three Crossroads HQ view 119 draw calls and 195k
  triangles, 128 and 245k; village 92 and 192k, 93 and 239k; zoomed out 154 and 202k, 158 and 273k. Bocage HQ view
  121 and 275k, 132 and 346k; zoomed out 190 and 280k, 194 and 367k. Graphics Low hides the grass, keeps half the
  trees and turns off tree and bush shadows (bocage HQ view 98 calls, 193k triangles). Frame rate could only be
  measured in headless Chrome on a software renderer (SwiftShader, 0.6 to 0.9 fps before and after on a heavily loaded
  machine), so the cost on real laptop graphics is not yet checked.
- Trees, bushes and hedgerow leaves darken under the fog of war as the ground does (before, trees ignored the fog and
  hedges turned grey).
- Left for later: real laptop fps with 250+ units; wind sway in the crowns; the haystack texture (burlap stands in for
  straw); a second broadleaf shape to break up repeats in big woods.

- Autocast, Warcraft 3 style: right-click an ability button to let the selected units of that type use it on their
  own. Rifles throw grenades at infantry in cover, trenches or houses within 18 m, MGs fire Suppressive Fire at squads
  advancing on them, AT guns load an AP round against vehicles, tanks pop smoke when badly hurt under anti-tank fire,
  rocket trucks and mortars barrage crowds or dug-in enemies, Rangers plant a satchel on a house or bunker they were
  told to attack once they are within 20 m of it (they stop to shoot at 26 m, so this is for close fights), and
  Conscripts shout Ura! when pinned on the move. Units only act on what their side can see, pay
  the same cooldowns and Munitions as a click, never override an ability you ordered, and never fire while retreating.
  It starts on where abilities are free and off in Classic, where they cost Munitions. A button with autocast on has a
  dashed brass border and a small A under its hotkey (clear of the Munitions cost in Classic), and the game remembers your choice per
  unit type for new units.
  Balance (300 paired AI-vs-AI Conquest matches, on vs off): 2nd place VP vs winner 0.57 both, lead changes 2.24 vs
  2.23, length 9.1 vs 9.0 min, about 98 vs 88 abilities used per match; faction wins 35/36/29% vs 39/31/30% (probably
  noise). The Tiger rear-armor test now turns autocast off so the AT gun's AP round does not skew it.
  Checked live: an MG fired Suppressive Fire by itself, a rifle squad threw a grenade by itself at enemy squads
  holding a capture point, and an MG turned off stayed off in the next match. Seen live in review: a rocket truck barraged
  by itself and a tank popped smoke at 90 hp, enemy units never show the flag, and the switch, its memory and the Classic
  default work at 1920x1080 and 1366x768. Not seen live: a rifle squad turned off holding its grenade, and the AP round,
  satchel and Ura!; all of those, plus Suppressive Fire, smoke, barrage (friends in the blast, units out of sight) and a
  walked-away squad, are now covered by tests.
- Recruit by letter: outside Classic, press Tab (or the key under Esc) and the Command Card header reads
  "Recruiting". Each card gets a letter (Q W E R T, A S D F G, Z X C V B in reading order), the letter buys that unit
  like a click, and Shift+letter buys five, or as many as your MP and army limit allow. Tab, Esc or a right-click ends
  it. While it is on, a letter that has a card buys, so WASD, Q/E, Stop (X), Retreat (R), Ability (F), Attack-move (G),
  Trench (T) and the Z C V support calls pause (the arrows still pan) and their badges hide; B has no card in Conquest
  and still aims smoke. In Classic, a selected HQ or production building shows the same letters on its train cards
  without any mode and Shift+letter queues five at that building; an HQ uses only Q and W, so A S D E still pan and
  rotate. Classic Tab explains this. Refusals show their reason as a click would ("Needs 220 MP", "Army at its limit
  (12/12)").
  - Fixed along the way: a Classic card on a selected building now greys out when that building's queue is full, even
    if another building still has room (the server refuses a full chosen building).
  - Left for later: with a laggy server, a Shift+letter right after a purchase can count MP the server already spent,
    and the extra buys come back refused with their reason.

- Edge scrolling works like Warcraft III. The band at the screen edge is wider (32 px at 1920x1080, 24 to 48 px by
  window size; it was 8 px), scrolling gets faster the closer you push to the edge, starts with a short ease-in and
  goes diagonal in corners, and the cursor turns into an arrow pointing the way. Pushing the mouse out of the window
  keeps scrolling until it comes back (before, leaving the window stopped it, so in a normal browser window edge
  scrolling barely worked). Switching windows or tabs, or opening the menu, stops it at once. It stays off while you
  box-select, rotate with the middle button or watch the opening glide, and pushing an edge ends Follow. Checked at
  1920x1080 at the default zoom: 66 m/s at an edge, 93 m/s in a corner, the same as the pan keys.
- Capture mouse: a new button next to Fullscreen keeps the cursor inside the game (the game draws its own cursor), so
  edge scrolling works in a window too. The menu setting chooses In fullscreen (the default), Always or Off, and Esc
  lets go. Selecting, box select, double-click, orders, the minimap, the recruit bar, the menu, the volume slider and
  strike aiming all work while it is on.
- Fixed: the first click or box drag of a match could select nothing. The opening camera glide swallowed the first
  mouse press to end itself; now a left press ends the glide and selects as well, and a right press still only ends
  it (so it cannot give an order). A Node test covers it. Left for later: the first key pressed during the glide is
  still swallowed.
- Not checked: Alt+click pings while the mouse is captured (the test browser cannot hold Alt during a click), and
  moving a captured mouse in fullscreen (headless Chrome answers each move there with a move back).

- Interface cleanup (checked with the Impeccable detector, now clean): alerts, connection banners and the match strip
  under the scores lose the colored stripe down their left side. An alert's kind now shows in its text color (light red
  for trouble, brass for a point won), a lost connection gets a red border all round, and being out of the match is a
  dark red band. The HQ sign leads with the owner's HQ map symbol instead of a color bar. The lobby loses its glowing
  backdrop and the paper cards their gradient sheen, and the Victory or Defeat stamp settles without bouncing.
- Model toolkit (no visible change yet):
  - New `client/models/geom.js` for building more detailed miniatures: rounded and chamfered boxes, lofted hulls,
    lathed shapes (barrels with muzzle brakes, US, German and Soviet helmets, wheels, radial engines, bombs,
    spinners), extruded outlines, spoked and disc wheels, road wheel sets, tank tracks with grousers and horns,
    bent tubes, mirroring, a vertex-colored merge, painted markings (US star, Balkenkreuz, roundel) and baked shading
    that darkens toward the ground. Every closed shape is checked in `node test.js` for outward faces, no gaps and
    the right volume.
  - Sizes to budget with: a full track with five road wheels, sprocket and idler is about 9,400 vertices, a wheel
    about 790, a radial engine about 2,100, a helmet a few hundred.
  - Model building: a part painted with the shared material now multiplies its paint color by the shape's own vertex
    colors when the shape has them, so wheels, tracks and markings keep their tire, link and insignia colors (paint
    them white to show the colors as built). Existing models have no vertex colors of their own and look the same.
- Model viewer (developer tool, no gameplay change):
  - `/client/viewer.html?type=medium&fac=0` builds one unit through the game's own model code (the same calls as
    `makeUnit` in main.js, faction looks and player colors included) and shows it under the game's warm sun and
    shadows from the front, left side, top, three-quarter front and back, plus the in-game camera (42° FOV, pitch
    0.95, distance 40) at true 1920x1080 scale. A header gives the unit name and its draw calls and triangles in the
    game view, shadow pass included; squads add a row with one soldier close up and the far soldier model's counts.
    Options: `&color=`, `&posture=0..3`, `&bg=`, `&aim=`, `&far=1`, `&grid=0`. `&all=1` lines up every type one
    faction can field, each labeled with its own draw calls and triangles (22 types, about 57 to 62 calls in all).
  - `tools/model-shots.sh <port> <outdir> [types] [facs]` screenshots the viewer with agent-browser into
    `<outdir>/<type>-<fac>.png`, and puts each next to `/tmp/ww2-models/refs/<type>-<fac>.png` when that reference
    exists. It starts no server.
  - Found: at the distance-40 zoom a plane flying at 20 m is about 15 m from the camera, so it draws about 2.6 times
    larger than ground units and overflows a 640 px wide view. Left as is.
- Miniatures (round 6):
  - Soldiers stand on small dark-green painted bases like tabletop miniatures (the base stays flat when they crouch,
    lie down or fall back), wear warmer faction uniforms (olive drab, field grey, khaki) and have a lighter crown on
    their helmets. The base is part of each soldier's single mesh, so draw calls do not grow.
  - Hills read more clearly from above: each height level makes the ground a little lighter and drier (about 10 to
    13% per level, up to three levels), and a thin light rim traces hill crests.
  - Left for later: the bases were not confirmed close up in a screenshot. The early combat test ("rifle took damage"
    within 5 s of an MG opening fire) failed once in two runs; it depends on random hits and was not changed here.
- Polish (round 5):
  - Your HQ is framed between the top panels and the recruit bar at match start, on H and after the opening glide,
    and fully zoomed out the whole board fits on screen, centered with a small table margin. HQ rings and sandbags no
    longer hang past the board edge, and enemy strike warnings are a red pencil outline with light hatching instead
    of a magenta smear.
  - Hills cast shadows on High graphics and have darker, softer shading at the foot of slopes and cliffs, so terraces
    read from above. The ground is warmer (khaki and ochre instead of olive green), grass and dirt blend with soft,
    noisy edges instead of square steps, and house walls are clean painted plaster without rust-colored blotches.
  - Support planes stay inside the camera view (recon and bomber flights no longer slide off the top of the screen),
    bombers visibly drop their bombs, the few birds fly low enough to be seen on High, and cloud shadows also cross
    the table.
  - Clearer text: a full order queue says "This unit already has 8 queued orders" (production keeps the training
    queue message), the second step of a fort dig says "click to place", cooldown numbers match between messages and
    buttons, the Assault scoreboard label stays on one line, the top panels are solid so map labels no longer show
    through, the map editor's Preview menu and tool hint are fixed, and the game has a tab icon.
  - Left for later: the dive bomber's bomb still lands before the plane reaches its target; hill tops are only a
    little lighter than the ground around them; the relief shadow's GPU cost was not measured on real laptops; and
    one match-end server test ("a new match without the old result") failed once in six runs while the machine was
    under heavy load, not yet explained.
- Fixed a flaky server test: the Massive snapshot-cache check sent Start before the map switch it had just asked
  for had finished loading, so on a busy machine Start was checked against the old map's seats and dropped. The test
  now waits for the lobby to show the new map. Left for later: the same can happen to a host who clicks Start within
  a moment of changing the map (messages from one player are not handled strictly in order while a map loads).
- Terrain relief, miniature structures and map moods (round 4):
  - Terrain reads as a sculpted painted model. Cliffs are warm stratified rock faces with a pale lip and a soil foot,
    1-level slopes are eased ramps painted with dry earth and a darker foot, height tints the ground (lower is greener
    and damper, higher is drier), roads sink slightly, and river and canal beds are carved below the water line with
    sloping banks. Cell centres keep their exact simulation heights, so units still stand on the visible ground. On
    the round 4 branch, terrain triangles on Hill 112 went from 17.6k to 37k, Kasserine Pass dropped from 64k to 29k
    and flat maps shrank 10x or more. The fog of war overlay follows craters and darkens the rock faces, a crater
    rebuild takes about 4 ms, and Graphics Low uses a simpler shader and a coarser mesh.
  - Map structures are miniature models. Houses have roof overhangs, ridge tiles, chimneys and inset windows and
    doors, and each map gets a church with a tower and some barns. Wrecked houses are broken walls on rubble, stone
    walls have capstones, hedgerows are bocage earth banks with shrubs, and bridges have railings and piers. Sandbags
    are rounded and stacked, tank traps are steel hedgehogs, wire is concertina on posts, trenches have revetments
    and duckboards, and MG nests are easy to read. The HQ, Barracks, Motor Pool, Supply Depot and Command Bunker each
    have their own shape. Map structures darken under fog of war, and footprints and cover are unchanged. On the round
    4 branch the default map's whole-map view went from 463 to 200 draw calls and from 47.3k to 105.1k triangles.
  - Each map has a mood. Most keep the warm afternoon. Pegasus Bridge and The Polder get a low dawn sun with mist over
    the river, Bocage and Monte Cassino are overcast with softer shadows, the Ardennes gets falling snow, and
    Kasserine Pass gets blowing dust. Faint cloud shadows drift across the board. The planning table now has a folded
    field map, a ruler, a pencil, an "HQ 1944" coffee mug, an open brass compass, map pins with paper flags, and a
    desk lamp casting a warm pool of light at one corner. On High, a few birds circle above the board. Graphics Low
    turns off the clouds, weather and birds. No gameplay changes.
  - Merged with rounds 1 to 3: the relief mesh replaces the round 3 smoothed height field. Units, scenery props, the
    camera, the minimap shading, the HQ and the water all read the same ground height. Props refresh after the relief
    reshapes a crater and still keep off every structure cell. The water surface takes the relief's height so it sits
    in the carved beds, and bridges keep their deck height. The fog overlay shares the relief's live geometry, so it
    follows craters too. Structures darken in the fog through the `setFogMap` hook in the round 1 surfaces module,
    which main.js calls once the fog texture exists. The round 3 one-draw unit models stay, and the five base
    buildings and the HQ sandbag ring now come from the round 4 models.
  - Integration fixes: with the relief ground, every match crashed at start because the atmosphere read the size of
    the old flat ground plane, and the board edge, table shadow and contact shadow disappeared. Both now read the
    relief mesh (its bounds, and height as the up axis), and the cut-earth board edge follows the relief height along
    all four sides, including where a cliff meets the edge.
  - Left for later:
    - The birds fly about 30 m above the board, so they only show when they pass under the view. Cloud shadows
      darken only the ground and table, not units, structures or trees. Snow maps have falling snow but no snow lying
      on the ground. The desk lamp's arm and shade are mostly off-screen, so players mainly see its shadow and pool.
    - Cloud shadows reuse the full ground mesh (about 12.8k triangles on the default map, more on big maps).
    - Triangle count about doubled with the new structures (about 212k on Monte Cassino XL at the whole-map view).
      Low drops duckboards, half the shrubs and small-part shadows but keeps the house detail. Instanced meshes have
      bounds that cover the whole map, so close-up views do not cull triangles (a village view still draws about 99k).
      The fog overlay draws the terrain a second time.
    - The base-building models use the shared unit material and do not darken in the fog the way terrain pieces do
      (the server already hides enemy units outside vision).
    - The church roof is the terracotta texture with a slate tint. Bridge railings are thin and hard to see from the
      default camera. Destruction of the new structures in a long live match was not watched end to end.
    - Cliffs are a heightfield with no overhangs, and painted contour lines still draw a thin dark line where a cliff
      meets the plateau.
    - Capture point, HQ and structure anchors only refresh when the world is rebuilt, so a crater under an existing
      flag base does not re-seat it.
    - Rendering was checked only with the headless browser's software renderer, so there are no real GPU timings.

- Rooms, controls, match endings and performance (round 3):
  - Keys and selection: Shift+Y, Shift+U, Shift+I and Shift+O now place sandbags, wire, tank traps and an MG nest (T
    still digs a trench), and the fort buttons show the Shift key. Shift+click adds or removes a squad. Double-click
    selects every squad of that type on screen, and Ctrl+double-click selects them on the whole map. Ctrl+A selects
    the army. The selection list groups squads by type with a count and total health. Period cycles idle squads, Comma
    cycles idle Engineers, and an Idle chip does the same. Control groups forget dead units, reset each match, add
    units with Shift+number, and center the camera on a double tap.
  - Camera and pings: the mouse wheel zooms toward the cursor, middle-drag rotates the view, and Shift+Space follows
    the selected unit. The menu has Edge scroll on/off and Pan speed. A match opens with a 2.5 s glide down to your
    HQ, which any key or click skips. Alt+click on the map or minimap pings your teammates with a chalk ring for 4 s
    and an alert line, and Space jumps to it (3 pings per 5 s). Picking the ground under the cursor is faster and
    exact on hills.
  - Rooms: if a player drops mid-match, the game waits up to 30 s for them (once per player per match), and the host
    can pause and resume. The host role passes to the next connected player. A refresh keeps your seat, camera,
    selection and groups, and &seat=2 gives a second player a seat on the same computer. The host can remove an
    offline player in the lobby or hand their army to an AI. An invite opened mid-match joins by itself when the match
    ends, and the reconnect banner counts down 1, 2, 4, then 8 s. The Large and Massive army labels now show the real
    numbers.
  - Command feedback: orders that cannot happen now say why. Recruit cards, support calls, forts, Classic builds and
    abilities grey out with a reason (Needs 120 MP, Cooldown 23 s, Army at its limit) and can still be clicked to show
    it. An order the server refuses plays an error sound and shows one plain sentence for 2 s, for example 'Not enough
    manpower'. A blocked or uneven footprint shows red and placement stays armed.
  - Order queue and rally: hold Shift while right-clicking (or on the minimap) to chain up to 8 orders. Moves,
    attack-moves, attacks, houses, trenches and Engineer builds run in turn and show as dashed pencil lines. A ninth
    order is refused with the error sound. Outside Classic, the Rally button or Shift+H sets a rally point that newly
    bought ground troops walk to. Minimap right-click now attacks, garrisons and assists like a click in the world.
  - Match endings: when a match is decided, the action slows to half speed, the camera glides to where it was won or
    lost, and a Victory, Defeat or Draw stamp says why. The battle stays on screen for 6 s with orders closed and the
    fog lifted. The lobby then shows a match report: a chart of the victory point race (or points held), a legend in
    words, and each player's kills, losses, builds, captures, manpower spent, support calls and planes downed.
  - Battlefield readability: contested points pulse red and brass, and only when your team can see both sides on the
    point. A captured point flips with a short flourish. Buildings smoke below two thirds health and burn below one
    third. A strip under the scores shows the time to victory at the current rate, the catch-up bonus, the last minute
    of an Assault and Sudden Death. Eliminated players see an 'out' banner, Assault and Annihilation totals no longer
    shrink as structures fall, and the Classic rules list the Airfield.
  - Unit rendering: big battles draw far fewer objects with the same look. Each soldier, hull, turret and building is
    one draw, soldiers beyond 110 m (80 m on Low) use a simple model, scenery is merged, and corpses share one pooled
    mesh (200 at most). Measured on the stream branch, draw calls in a Massive Classic 3v3 at 70 s fell 78 to 86% (885
    to about 150 in the own-army view). Suppressed squads crouch at 50 and go prone at 90, retreating squads lean
    forward, '?perf' shows an fps and draw-call box, and Low renders at 0.75 resolution.
  - Server performance: six-player Massive matches run smoother. On the stream branch, benchmark p95 tick time fell
    from 26.1 ms to 7.8 ms in Classic and from 8.2 ms to 3.4 ms in Conquest, with identical match results. A room that
    still falls behind sends updates every 3 or 4 ticks instead of 2, and units still glide smoothly. The pause and
    the end hold also use the shared snapshot cache.
  - Merged with rounds 1 and 2: the planes and the Airfield keep their round 2 models (client/aircraft.js) while
    soldiers, vehicles, guns and structures use the new one-draw models, and Classic buildings keep the round 1 wood
    and sandbag textures. Explosions and battle sounds still come from the round 1 effects layer, with the one Volume
    slider (M still mutes). The round 2 fog, command and start-race fixes and the round 3 server speedups both stay,
    with one copy of each guard, and all server tests now run on one in-process server.
  - Left for later:
    - Rejoining a running Classic match (reload) draws the Conquest command tent and crates at every HQ. The server
      sends 'start' before the async lobby() message, so classicMode() is false when buildHQ runs. This is the same in
      base c21777f and master. See /tmp/ww2-shots/stage-r3/rejoin-high.png.
    - After a reload mid-match, cratered ground near the HQ shows as gray-blue blocks instead of the dark scorch seen
      in live play. The cause is not traced; the start message's cell levels and the rebuild path are unchanged from
      the base. See /tmp/ww2-shots/stage-r3/low-home.png.
    - An unsaved default name (SoldierNN) is re-rolled on every load, so a reload renames your seat and HQ label
      mid-match. This predates round 3.
    - The 'queueFull' sentence reads 'The training queue is full' but now also covers a full order queue.
    - The client blocks arming a fort when MP is short; only a Shift-queued dig skips that check, even though queued
      digs are paid when they start.
    - Outside Classic, a rally message that carries building ids is ignored.
    - The lobby result header uses r.teams[me] rather than r.you.
    - The away flag in tickRooms and the online list in timedRoomTick still use !!p.ws, while pauseTick and holdEnding
      use connected(p).
    - On a resume, startGame may replay match_start or restart the ambience.
    - From the streams: blast-area scans and server timer drift under sustained overload (sim-server-perf); greyed
      Barracks-only units on the Classic HQ card (command-feedback); no static controls list in the menu yet
      (keys-and-selection); saveMap may drop assaultTime and the per-spawn assault flag (plan).
    - Fallen soldiers are plain dark bodies again (the pooled corpses, one draw for up to 200) instead of the round 1
      soldier copies in helmet and colors; a pooled body in soldier shape and colors would bring that look back.
    - House roofs are not merged into one draw, since a roof uses two materials (plaster gable and tiles) and
      mergeMeshes keeps one.

- Scenery, water and planes (round 2):
  - Map symbols now cover every aviation unit (fighter, ground-attack plane, mobile flak, flak emplacement, airfield)
    and all eight support calls, and an unknown unit type shows an empty frame with a "?" instead of a blank one.
  - Open ground is dressed with painted scenery props: round trees, poplar rows, pines on high ground, bushes along
    hedges, rocks, fences, haystacks and crates beside houses. They are purely visual, keep clear of spawns, points,
    paths and resource nodes, stay put when terrain changes, and Low graphics shows half of them.
  - Rivers, fords and bridges get a flowing water surface: blue-green, darker in deep water, pebbled at fords, with
    foam at the banks and around bridge spans. Fog of war still darkens it, it rebuilds when a bridge collapses, and
    Low graphics freezes the animation.
  - Planes are now per-faction painted miniatures (P-51, P-47, B-25; Bf 109, Ju 87, He 111; Yak-9, Il-2, Pe-2) with
    spinning propellers, a ground shadow, banking in turns, damage smoke, dark flak bursts and a spiral-down
    shoot-down that ends in a fireball, and the Classic airfield gets a runway, arched hangar, control tower and
    windsock.
  - The new planes use the round 1 explosions and recorded sounds: a crash plays the plane-crash sound and a fire
    loop, a strafing run plays one gun burst, and the tracers that flak and fighters fire at planes still come from
    the effects layer, so each plane, burst and tracer is drawn once.
  - Left for later: support bombers no longer show bombs falling from the plane (the bomb blasts still land on
    time), and `client/fx.js` still carries its own plane pool and falling-plane code, now unused.
- Simulation fixes (round 2):
  - Air support: a spent Fighter Cover ring now leaves the map instead of staying forever. Ground squads ignore an
    attack order on a plane, one cover can no longer shoot down two strikes on the same tick, blowing a bridge no
    longer kills planes flying over it, and a plane overhead no longer counts as cover. Parked planes no longer spot,
    houses no longer block spotting from the air, new planes appear at the Airfield that trained them, and
    paratroopers take a population slot and no longer drop for an eliminated army.
  - Fog of war: shoot-downs, flak shooters and HQ collapses only reach teams that can see them, terrain updates and
    the start of a match no longer reveal unseen building footprints, and a reconnect keeps remembered terrain.
  - Server: commands with a bad player slot, unit, support or fortification name, or someone else's building are
    rejected, a bad army value no longer gives NaN MP, Massive selections are no longer capped at 50 units, and
    reconnects and map loads during the start or end of a match are handled. The AI no longer crashes when it holds
    an allied point with no opponent left.
  - Speed: a Massive six-army Classic match steps in 3 ms on average instead of 21 ms. Idle squads look for targets on
    a 0.5 s timer, vision and terrain updates skip work they threw away, and AI players get no snapshots.
  - Balance is unchanged within noise: Conquest wins 34/36/30% by faction over 300 AI matches (was 41/29/31%), and
    Classic 47/47/44 wins over 160 matches.
  - Left for later: the Tiger limit of 1 does not grow with army size; the server tests strip `import` lines from server.js with a
    regex; AI anti-tank buying against medium tanks is untested; an idle squad now notices a new enemy up to 0.5 s
    later; and AI thinking spikes in big armies were not profiled.

- Polish (review fixes for the HUD, world and effects slices):
  - Point and resource node income tags and the HQ sign keep the same size on screen at every zoom, so they stay
    readable when zoomed out and no longer cover the fight when zoomed in. They fade out up close, and a point's tag
    hides while that point is being captured. The HQ sign shows the name as typed, not in capitals.
  - The HQ reinforce zone is a faint chalk tint inside its ring instead of a blue patch that looked like a pond.
    Big pencil rings no longer draw a second line a meter inside the first.
  - Range rings show only for a small selection (up to two units, or up to four of one type), so a big selection no
    longer covers the screen in dashes.
  - The edge of the board is deeper and lighter, so its soil layers show on both the sunny and the shaded side, and it
    meets the table with a soft shadow instead of a jagged black line.
  - Fallen soldiers stay as soldiers (helmet and colors) and sink into the ground, instead of turning into brown
    capsules. Classic buildings use the wood, sandbag and earth textures of the rest of the world. Resource nodes are
    marked with a brass pencil square.
  - Command Card: a locked card keeps its "Needs a Barracks" note readable (dark ink with a red dot), and the cost of
    a unit you can't afford is a solid red chip. Disabled support buttons are less faded, so their costs can be read
    at the start of a Classic match.
  - In Classic the "click where to build" hint sits above the Build panel instead of on top of it.
  - Lobby: section headings are in sentence case, your own name and the host mark no longer get cut off, muted text
    is darker, and the Add AI, Copy link, Join and Start buttons have tooltips. The support and veteran tags are
    easier to read.
  - Alerts sit a little higher above the minimap so they no longer touch its frame.
  - Fixed: every dig or shell that changed the terrain left the old buildings' and roofs' GPU buffers behind, and
    Play again kept the whole previous match on the GPU. Both are freed now. The fog of war now follows craters and
    trenches. The minimap no longer raycasts the terrain on every redraw (it was costly while an alert was showing).
    A machine gun shooting at a plane no longer shows flak bursts or plays the flak sound.
  - Left for later: warmer ground, smoother contour lines, a north arrow and scale bar on the
    minimap, Graphics Low cutting shadow draw calls, patching only the dug part of the terrain instead of rebuilding
    it, trimming the blur pass's unused GPU memory, unit names on recruit cards at 1366 and 1600 px wide, and a
    design decision on whether the lobby title and Start button may keep the stencil font.
- Audio (slice 5): recorded effects and voice lines, one volume control:
  - Recorded sound effects (ElevenLabs) for every weapon, shell, grenade, bomb and rocket, the support planes, flak,
    plane crashes, falling houses, smoke shells, digging and building, plus a quiet battlefield ambience and a short
    sound when the match starts. Each sound plays when its effect shows, gets quieter with distance from the camera
    and pans left or right with it. Moving tanks and vehicles swell a shared engine rumble.
  - Burning wrecks crackle while they burn. Artillery and mortar whistles end as the round lands. A machine gun or SMG
    burst plays once per burst, and a Tiger's gun sounds deeper. A hedge or fence being knocked down only crunches;
    a house falling is loud.
  - Each faction speaks its own language with recorded voice lines (Eleven v4): two voices per faction, the player's
    slot picks one, for move, attack, retreat, under fire and unit lost. They replace the browser's speech voice.
  - Alerts, recruiting, orders and button clicks each have a short sound.
  - One Volume slider in the in-game menu covers effects, voices and alerts and is remembered. M mutes and restores
    the last level. A player who had muted the old way starts muted.
  - Fixed: the old synthesized noise bursts are gone. Mute used to silence only the voices. Machine guns no longer
    pile up a new sound every few tenths of a second while firing.
  - Left for later: the Armored Car's cannon uses the tank gun sound. A hedge or fence falling still throws up the
    full dust cloud of a house (only the sound is lighter). The Fighter Cover circle is still the old flat ring. The
    automated browser checks confirm which sounds are played, not how they sound.
- Combat effects (slice 4): muzzle flashes, tracers, explosions, scorch, fire and smoke:
  - Every shot has a muzzle flash at the gun and a glowing tracer to the target, with the impact landing when the
    round arrives: dust and dirt for small arms, sparks off armor, a fireball and debris for shells and bombs.
    Explosions are sized by the weapon (grenade, mortar, tank gun, artillery, bomb) and leave scorch marks on the
    ground that fade after a while.
  - Destroyed vehicles burn and smoke, then smoulder. Smoke screens are thick drifting smoke, all smoke drifts with
    the same wind, and houses that fall down throw up a cloud of dust. Big blasts near the camera give a very small
    screen shake (off on Graphics Low and with reduced motion).
  - The support planes fly over and drop what they carry: recon, strafing, bombing, the dive bomber (one steep dive
    and one bomb) and the paratroop transport.
  - Air war: flak guns and Mobile Flak fire tracers up at planes, with black airbursts around them; when a flak gun
    opens up on a passing support plane, the bursts walk around that plane. Fighters fire from both wings in turn and
    the Ground-attack Plane fires rockets. A plane shot down rolls over and falls trailing fire and smoke, then
    blows up and burns where it lands; a support plane that is shot down cancels the bombs it hadn't dropped yet.
  - Fixed: a Flak Emplacement firing at ground units drew puffs in the sky instead of tracers to the target. A Fighter
    or Ground-attack Plane that was killed stayed frozen in the air as a wreck for 40 s. Shots no longer make and free
    GPU objects each time: all particles are one mesh and the planes come from a small pool.
  - Left for later: if every pooled plane is in use, a support plane shot down shows only an airburst. The Fighter
    Cover circle is still the old flat ring.
- World look (slice 3): painted ground, warm light, a planning table and map-symbol markers:
  - The ground is painted from real textures per cell (grass, dirt, mud, ploughed field, road, water, rubble,
    shelled earth, trench earth) with soft edges, and keeps the contour lines; shell holes and trenches are painted
    on. Houses, roofs, hedges, walls, sandbags, wire, tank traps, bridges and trench parapets get textured surfaces.
    When terrain changes in play or in the editor, only the patch around it is repainted.
  - A warm low sun over each player's opening view with a sky fill, crisp shadows that don't crawl when the camera
    moves, and haze that scales with zoom. The board sits on a dark wooden planning table with a cut-earth edge, so
    panning past the map edge no longer shows a grey void.
  - Graphics High / Low in the in-game menu. High blurs the far edge of the view; Low skips the blur and uses cheaper
    shadows and a smaller ground texture. If the frame rate stays low, the game switches to Low once and says so.
  - Player colors are now blue, red, chalk, orange, violet and cyan, so a 1v1 is blue against red.
  - Over each unit, its military map symbol filled in the owner's color (the same symbols as the HUD). Owner,
    selection, range and HQ rings are hand-drawn pencil strokes: selection is a chalk ring over a dark halo, weapon
    range is dashed chalk. Order lines are pencil strokes with arrowheads, in the same colors as before.
  - Capture points: a dashed chalk ring while neutral, a solid ring in the owner's color once taken, and capture
    progress as a shaded band. Flags are cloth in the owner's color. HQ names are in stencil type with a color bar.
  - Map symbols for the aviation types, which slice 1 left blank: Fighter and Ground-attack Plane (a plane seen from
    above, with bombs under the wings for the attacker), Mobile Flak (the air defense dome over an armor oval),
    Airfield and Flak Emplacement (the installation bar with the plane or the dome). They show on the Command Card
    and over the units.
  - Fixed: a dead unit's weapon range rings could stay on the ground. Order lines no longer make and free GPU
    objects every snapshot.
  - Left for later: the Fighter Cover circle is still the old flat blue ring, not a pencil stroke, and it is rebuilt
    every snapshot. The headless test browser drops to Graphics Low within seconds, so the integration screenshots
    don't show the far-edge blur.
- Alerts (slice 2): short lines above the minimap tell you when something needs you, each with a ping on the minimap
  and a sound hook (the sounds arrive with the audio slice):
  - Under attack: your units and buildings (planes too), an allied HQ or bunker, or a point of your side losing
    ground. At most once per 20 s per area, and not while the fight is on screen. Friendly fire and Sudden Death
    crumbling don't count.
  - Point captured, point lost, unit lost or building destroyed (losses close together share one line, so a plane
    shot down reads "Fighter lost").
  - Enemy Air Support incoming near your side: strafing, bombing, recon, dive bomber and paratroopers. Artillery and
    smoke barrages and fighter cover don't raise it.
  - Classic: a unit out of a building's queue, a building finished.
  - The newest line is bold; lines fade after about 6 s, four at most. Space jumps to the newest alert while one is
    showing (otherwise it centers the selection as before); clicking a line jumps there too.
  - Only what the server already sends you is used, so nothing under fog leaks.
- New HUD, "sand table" look (slice 1 of the look and feel work):
  - A dark olive strip holds the panels; the unit cards and the selection list are manila cards. Courier Prime for
    text, Stardos Stencil for the big numbers (MP, clock, VP).
  - Score and clock top center, with faction markings next to player names; resources, income, army size and the
    eight support calls (two rows of icon buttons with their hotkeys) top right; your planes and what each is doing
    listed under them (click one to select it); selection list and an icon grid of orders bottom left; the Command
    Card bottom center; menu, voices and fullscreen in a small bar top left.
  - Military map symbols (infantry box with an X, armor with an oval, and so on) on the Command Card, the selection
    list and the orders. Tooltips give the full unit name and its role; hotkeys show on the buttons.
  - Command Card groups: Infantry, Support weapons, Vehicles and Aircraft (Fighter and Ground-attack Plane).
  - The lobby is a manila order card and keeps its two columns (Players and Invite, Battle with the map preview, mode
    description and army size).
  - The always-on keybinding panel is gone; the hotkeys are on the buttons.
  - Fixed: the HUD rebuilt its buttons 10 times a second, which could eat clicks (orders, Command Card, air panel).
    At 1600x900 the orders panel covered the recruit bar. Classic's MP / Mun / Fuel readout wrapped to two lines.
    Engineers now get the fortification buttons too.
  - The aviation map symbols and keyboard shortcuts for every fortification came in later rounds (see above).
- Army size in the lobby (host picks): Standard (as before), Large (2.5x unit limit, 3x income) or Massive (5x unit
  limit, 6x income: MP, Munitions, Fuel and starting MP). The AI buys several units at a time in big games. With 6 AIs
  on Six Fronts, Massive peaked at about 240 units (Conquest) and 270 (Classic); the server stayed under 8 ms per tick
  on average (24 ms worst, budget 50). With 3.5x income Massive only reached 98 units: armies died as fast as they came.
- Aviation (all modes):
  - New air support: Dive Bomber (U, 180 MP / 70 Mun): one heavy bomb right on the spot. Paratroopers (P, 260 / 90):
    a rifle squad dropped where your side can see (counts toward pop). Fighter Cover (I, 120 / 40): for 60s the next
    enemy air strike over the area is shot down (never recon).
  - Flak gun (200 MP; Barracks in Classic): each support plane flying over it has a 35% chance per gun of being shot
    down (a bombing run drops only part of its stick, a recon flight ends early). It also shreds infantry, not tanks.
  - Planes you command: Fighter (P-51 / Bf 109 / Yak-9, 280 MP) and Ground-attack Plane (P-47 / Stuka / Il-2, 340).
    They fly sorties from an airbase behind your HQ (in Classic, an Airfield built by Engineers, O): right-click the
    ground to patrol, an enemy to attack, a friendly unit to escort; R sends them home. They circle the mission for 50s
    of fuel, then fly home and rearm in 30s. Your planes and their state are listed under the support buttons.
  - Anti-air hurts planes every second they're in range: flak guns, Mobile Flak (M16 / Wirbelwind / ZSU, Motor Pool),
    Flak Emplacements (Classic building, Y), enemy fighters, and a little from MG teams. Rifles and tanks can't touch
    planes. Planes in the air are seen from 60 m with no line of sight and see 40 m below them.
  - The AI buys flak when it sees planes, fighters to contest the sky and ground-attack planes for big armies; it calls
    fighter cover over announced enemy strikes, dive bombers on tanks and paratroopers onto enemy points.
- Kill bounty: finishing off an enemy unit or building pays 20% of its cost in MP (a tank 60, a rifle squad 20).
- Classic pop cap 24 (was 20): with the bounty the leader banked ~1100 MP at the cap.
- Balance (AI): Conquest 2nd place 63% of the winner's VP on Three Crossroads (90 matches), 57% on River Towns (60),
  lead changes up to 1.55-1.68. Classic decided before sudden death: 85% (default), 80% (River Towns), 60% (Six Fronts,
  still the long one). In 6 Conquest matches the AIs called 19 dive bombers and 9 fighter covers (8 intercepts), and
  lost 6 planes; in Classic 17 paratrooper drops, 21 intercepts, 17 planes down.
- Lobby redesign and fix:
  - Fixed: the long Annihilation entry in the Mode menu made the whole lobby card wider than the window, so every row
    ran off the right edge (and off a phone screen entirely). Nothing in the lobby can grow wider than the card now,
    and the lobby scrolls when it is taller than the window.
  - Two columns on wide screens (Players and Invite on the left, Battle on the right), one column on narrow ones.
  - Map preview: a picture of the chosen map (terrain shaded by height, capture points, spawns; in Assault, red spawns
    defend and blue attack) with its real name, size in metres, player count, hills, rivers, and the Assault clock.
  - Short mode names in the menu with a one-line description of the chosen mode underneath.
  - Map names read properly (Kasserine Pass, not kasserine-pass), and Start is a big gold button.
- Fixed the Flak Gun card and tooltip showing "undefined": they now explain that it shoots down enemy air support.
  Both the buy bar and Classic training cards use the unit name if a role description is missing.
- New mode, **Annihilation**: like Assault, but every player gets a Command Bunker with its trench and sandbag ring,
  and there's no clock. A side is out when its last bunker falls; the last side standing wins. Works with any teams,
  including free-for-all. Everyone starts with 300 MP and +4.5/s; points pay manpower only (no VP). Bunkers take 5%
  from support strikes, as in Assault, so they have to be taken on the ground. AI matches all finished: 1v1 on Three
  Crossroads and River Towns in 5 to 27 minutes, 3v3 on Kasserine Pass in about 29 minutes.
- Field fortifications: rifle squads, conscripts and engineers (twice as fast) can now build five things, each
  placed like a trench (click the spot, move the mouse to turn it, click again):
  - **Trench** (T, 30 MP): as before.
  - **Sandbags** (Y, 20 MP): a 4-cell low wall. Cover, and you can still walk over it.
  - **Barbed Wire** (U, 25 MP): 5 cells. Infantry wade through at 35% speed and path around it when they can.
    Tanks flatten it by driving over it, and any explosion clears it.
  - **Tank Traps** (I, 40 MP): 4 cells of steel hedgehogs. Vehicles can't cross them; infantry walk through and
    use them as cover. Explosives knock them down. Never built under a vehicle.
  - **MG Nest** (O, 60 MP): a trench pit behind a horseshoe of sandbags facing away from the builders.
  - Fortifications go on open ground, craters or rubble. The map editor has wire and tank-trap brushes too.
  - Left for later: the AI still only digs trenches.
- New XL map, Monte Cassino XL (135x165, 6 spawns): the monastery on the summit and three tiers, now with two ramps per
  cliff (flanks below, either side of the monastery above). AI 3v3 assault with a 23 min clock: attackers won 45% of
  40 (22% at 20 min, 60% at 25).
- Stalingrad Factory: in Conquest and Classic one player started inside the factory in the middle of the map. The
  factory spawn is now Assault-only (the defender still holds it there) and there's a fourth edge spawn, so other modes
  start everyone at the edges (N, E, S, W). 4-way Conquest wins by spawn: 4/8/6/6 of 24. The fix is in the map pack's
  generator, which is still waiting to be committed with the pack.
- Maps can mark a spawn Assault-only (`"assault": true`): other modes skip it, and the lobby counts seats per mode.
  The editor has an "Assault only" box for a selected spawn.
- Map editor: a Preview dropdown shows the map as each mode sets it up: Assault's added trenches, walls and bunkers and
  the points it leaves out, Classic's HQs and its MP (yellow) and Fuel (orange) nodes, which spawns each mode uses and
  who defends or attacks, for any number of players. Editing pauses while previewing.
- New XL assault map for 3v3, **Kasserine Pass** (160x200): a cliff-sided mountain wall across the whole map with a
  single winding pass through it, the only way from the attackers' valley to the defenders' (checked: plugging the
  pass cuts the two sides apart). Overwatch ledges beside each mouth of the pass, reached from that side's valley.
  Defenders hold a town and three bunkers in the north. AI 3v3 assault: attackers won 2 of 8 matches, both near the
  15:00 clock, with up to 9 units fighting in the pass at once. More attacker income didn't help (0 of 8): the clock
  is the limit. Left for later: a per-map Assault clock would let XL maps run longer.
- Three XL maps for up to 6 players (3v3 Assault: three defenders, three bunkers), about 1.5x the size of the originals:
  - Pegasus Bridge XL (140x150): a bigger town, two stone bridges, a ford on each flank and one in the middle.
  - Hill 112 XL (120x160): the terraced climb with three ramps up the escarpment instead of one.
  - Seawall XL (130x140): a longer beach and cliff with three ramps, trenches across the ramp tops.
  AI 3v3 assault, attacker wins over 40 matches: Pegasus Bridge XL 58%, Hill 112 XL 45%, Seawall XL 25% (the
  original Seawall is 25% too). They also work for 3v3 Conquest (all test matches finished, 12-16 min).
- A map can set its own assault clock (`assaultTime`): Pegasus Bridge XL 20 min, Hill 112 XL 16 min (attackers won
  10% at 15 min, 80% at 20). Generated by tools/genmap-xl.js.
- Found and left: the assault AI only defends points within 70 m of its HQ, so on big maps defenders must spawn near
  what they defend (Seawall XL's HQs sit behind the cliff for this; with them further back attackers won 19/20).
- Units are easier to tell apart:
  - Every unit has a class badge left of its health bar, a pictogram on a disc in its owner's color: rifle, star
    (Rangers), three heads (Conscripts), MG on a tripod, mortar tube, crosshair (sniper), hammer (Engineers), AT gun,
    armored car, and a tank with one, two or three pips for light, medium and heavy (Tiger). The cover shield moved
    to the right of the bar.
  - Soldiers have faces, and each class carries its own kit: rifles, SMGs, a sniper's long scoped rifle and ghillie
    cape, an engineer's pack and shovel, ammo boxes for MG and mortar crews.
- Fixed: faction models (helmet shapes, the Calliope / Panzerwerfer / Katyusha) were picked by player slot, not
  faction, so a German player in the first slot got American helmets and a Calliope.
- One link for good: the plain address (no #code) always opens the same room, so friends can bookmark it. The lobby has
  a Room box to join any other room by code, and New room for a private one.
- When a match ends, the room goes straight back to the lobby with the result on top: change map, mode, teams or AIs,
  and new friends can join, then Play again. (Before, the room stayed locked on the result until a rematch.)
- In-game menu (the ☰ button by the MP): the host can Restart the match (same settings) or End it (everyone back to the
  lobby); anyone can Leave, and an AI takes over their army so the match goes on. Each asks for a second click.
- Tailnet members can also join by IP: http://<host's Tailscale IP>:3000 (start.cmd prints it). The server listens on
  all interfaces; a Windows Firewall rule, "ww2-rts game (Tailscale only)", lets in only Tailscale addresses
  (100.64.0.0/10), so the home network and the internet stay blocked. The rule has to be added once as admin.
- start.cmd tries Tailscale Funnel first (a public link: friends can join without Tailscale) and falls back to the
  tailnet-only link. Funnel stays off until the tailnet admin allows it; the link is the same either way.
- Conquest catch-up is stronger: trailing players get up to +6 MP/s (was 4), 1 per 60 VP behind (was 80). The new units
  had made games one-sided (2nd place finished with 54% of the winner's VP); now 66% on Three Crossroads and 63% on
  River Towns, more lead changes (1.58), 9.6 min games, faction wins 33/31/26 (90 AI matches). Tried and dropped: keeping
  mortars and armored cars out of the first 4 minutes (49%, worse).
- Classic Fuel nodes now sit halfway between neighbouring enemy HQs instead of by the villages (on several maps a
  village Fuel node was 15-17 m from one player's HQ and 65+ m from the others). Each spot is picked so both sides walk
  about as far to it; a 1v1 gets one on each flank. Audited every map as a 1v1 and full lobby: everyone gets an HQ and
  2 MP nodes 21-34 m from home, every map has Fuel, nothing is unreachable. Still uneven where terrain forces detours:
  Monte Cassino 1v1 (115 vs 164 m walk), Island Towns 6p (34-77 m). Classic balance after: 80% of games decided before
  sudden death, median 15.8 / 16.6 / 21.4 min (90 AI matches).
- Fixed a flaky test: the bunker-falls check fired a real random barrage at a 1 hp bunker, and sometimes every shell
  missed.
- Four new units in every mode:
  - Mortar team (Barracks in Classic): lobs shells at anything your side can see, out-ranges MGs; Mortar Barrage ability.
  - Sniper (Barracks): one shot, one kill at long range. Hides when it keeps still and stops firing (only seen up close
    or by a recon flight); firing gives it away. Your own shows a HIDDEN tag.
  - Armored car (Motor Pool): the fastest unit. Scouts, raids, hunts snipers and mortars; weak against tanks.
  - Medium tank (Motor Pool): Sherman, Panzer IV or T-34, between the light tank and the Tiger.
- Classic: Fuel, a third currency for vehicles. Depots on the contested nodes by the villages now pay Fuel (orange
  marker, "+1.5 Fuel/s") instead of MP, and the HQ trickles a little. Vehicles cost less MP plus Fuel (light tank
  200 MP + 60 Fuel). Home depots pay more MP (2.5/s) and the HQ trickle went up to 3/s. HQ, Barracks and Motor Pool have
  25% less health.
- The AI uses the new units and buys infantry when it can't make what it wants (it used to save forever).
- Balance: Conquest games got more one-sided (2nd place 54% of the winner's VP, was 62%) but factions are the most even
  yet; Classic decides 74% of games before sudden death, median 16-23 min. Details in DESIGN.md.
- Assault: the Command Bunker now takes only 5% damage from off-map support (artillery, bombing runs, strafing).
  It has to be taken on the ground: satchels, rockets, tanks and infantry. The AI attacker no longer calls its
  strikes on the bunker; it uses them on the defenders instead. AI 1v1 assault, attacker wins out of 20 after the
  change: Three Crossroads 15, River Towns 12, Pegasus Bridge 7, Seawall 7, Stalingrad Factory 7, Bocage 4,
  Hill 112 3, Monte Cassino 1. Bocage and Monte Cassino were 11/20 before, so they now favour the defender
  strongly.
- Assault no longer shows capture points that only pay VP (Assault has no VP): the center of Three Crossroads and
  River Towns is gone in Assault. Every remaining point is labelled with the manpower it pays, not "2x VP".
  Balance is unchanged by this (AI 1v1 assault, attacker wins with/without the change: Three Crossroads 16/20 vs
  16/20, River Towns 15/20 vs 13/20). Found and left for later: that's well above the 50% / 61% logged when Assault
  shipped, so something since then has shifted Assault toward the attacker.
- Classic economy: depots on the contested nodes by the villages pay 2.5 MP/s, the safe home nodes 1.5. Each node shows
  what it pays. Fielded units cost upkeep (0.08% of their price per second: a rifle 0.08 MP/s, a tank 0.24), shown next
  to your income. The AI walks further for a richer node.
- Fixed (Classic): capture points still said "+1.5 MP/s" from Conquest, but in Classic they pay Munitions. They now
  show "+1.5 Mun/s" (center "+3 Mun/s"). Depots pay MP, points pay Munitions.
- Balance (30 AI matches per map): 28/30 and 29/30 decided before sudden death, median 17.2 and 16.7 min. Upkeep at
  this rate doesn't stop the leader banking MP at the pop cap (doubling it only made games longer, 20.2 min): that needs
  something to spend on.
- Classic now works like a classic RTS: the bottom panel shows only what your selection can do. Select a building to
  see the units it trains (cost and training time) and its queue; select Engineers to see the buildings they can put up
  (and what each still needs). Nothing selected, nothing shown. Soldiers keep their abilities in the lower-left bar.
  H jumps home and selects your HQ. Conquest and Assault keep the always-on unit bar.
- Classic mode is complete (the rest of the planned slices):
  - Engineers also build a Barracks (K, 150 MP: MGs, Rangers, Conscripts) and a Motor Pool (L, 200 MP, needs a
    Barracks: AT guns, tanks, rockets, Tiger). The placement preview snaps to the grid, green or red.
  - Units take time to train (rifle 15s, tank 35s...) in a queue of up to 5 per building, and step out at their building.
    Click a building to see its queue and train from it; right-click sets its rally point. The buy bar is greyed until
    you own the right building.
  - Cancel an unfinished building for 75% back. Right-click your own site or damaged building with Engineers to help
    build or repair it.
  - Retreat goes to your nearest Barracks, Motor Pool or HQ, and units reinforce near any of them (or an ally's).
  - Enemy buildings are hidden by the fog until you see them, then stay on your map as faded ghosts where you saw them.
  - Sudden death at 25:00: no more building or training, and every HQ, Barracks and Motor Pool loses 1% of its health
    per second. Last base standing wins.
  - In team games an eliminated player's army goes to their teammate.
  - Unit abilities cost Munitions in Classic (grenade 15, satchel 30...), on top of their cooldowns.
  - Pop cap is 20 in Classic.
  - Buildings are timber: guns hit them fully and rifles chip at them. Before, rifles and MGs did almost nothing to a
    building and AI armies shot at bases for 20 minutes.
  - The AI builds the full base, repairs, saves up for buildings, and adapts: it counters tanks and infantry it has seen,
    defends against early rushes, attacks when its army outweighs what it has seen, raids unguarded depots and flies
    recon when it hasn't found your base. It beats the old scripted AI 68% of the time.
  - Balance (3-player FFA, 90 AI matches): every match ended by destroying bases, 90% before sudden death, median
    16.5-19.6 min. Faction wins 32/33/25 (USSR slightly weak).
- Selected units now show their weapon range as a ring (rocket launchers also show their minimum range), the route
  they're walking, and what they're locked onto: a red line and ring to an attack target, markers for a grenade spot,
  a trench being dug, a building site or a house they're entering. Only your own units' orders are sent.
- Routes and targets are drawn as flat bands on the ground (the first version used 1px lines that were hard to see),
  and a unit shooting at something it picked itself now shows a red band and ring to that target too, not just
  targets you ordered. Needs a server restart: the routes come from the server.
- Added this changelog and AGENTS.md (the rule to keep it up to date).
- Twelve new maps (generated by `tools/genmap-pack.js`):
  - Assault: **Pegasus Bridge** (a town across a river, one bridge you can blow up and a far ford),
    **Bocage** (fields boxed in by hedgerows), **Seawall** (a beach below a cliff with two ramps),
    **Monte Cassino** (a monastery on three cliff tiers, the climb zigzags ramp to ramp) and
    **Stalingrad Factory** (a walled factory in a ruined city, attacked from three sides).
  - Conquest, mirrored for two sides: **Twin Valleys** (a cliff ridge crossed by two passes), **Ardennes Crossing**
    (a winding river, three bridges, two fords, a point on each crossing), **Crossroads Village** (a small quick 1v1),
    **The Polder** (sunken fields, dykes you can't see over, canals) and **Crater Field** (Verdun: trench lines and a
    shelled no man's land).
  - Up to six players: **King of the Hill** (a big central hill worth triple VP) and **Island Towns** (islands joined
    by long bridges and fords).
  - Every map passes a new test: valid, and every spawn can walk to every point and every other spawn.
  - AI checks: every conquest map finishes with all points taken in under 3.5 minutes. Assault 1v1, attacker wins:
    Pegasus Bridge 7/20, Bocage 11/20, Seawall 4/20, Monte Cassino 11/20, Stalingrad Factory 7/20.
  - Assault capture points sit on the defenders' side or in the middle, so the attackers have to take ground to earn
    more than their base income. The first version put most points next to the attackers (on Pegasus Bridge, 4 MP/s
    of free income for the attacker against 1.5 for the defender), and attackers won about 35/40 there and on
    Seawall. Moving them swung every assault map hard toward the defender (Monte Cassino 1/20), so each map got one
    or two contested points back.
  - Seawall was rebuilt with the cliff closer to the defenders' town. The AI defender only holds ground within 70 m
    of its base: with the cliff far away the attackers took both ramp tops in the first minute and won 20/20.
- Bombs and artillery now dig the ground. Each blast lowers the ground one level (a real dip that changes
  sight lines and gives low ground): a bomb digs a 3x3 patch, an artillery shell a single cell. Repeated hits on
  the same spot deepen the middle into a bowl, but a cell never ends up more than one level below its
  neighbours, so units can always climb out.
- New map, Hill 112, built for Assault: the defenders hold a plateau and the attackers start at the foot of the
  hill and have to climb. Cliffs on the upper flanks funnel the climb through a central ramp, with narrow paths at
  both edges. Shelled slopes, a hamlet on the middle terrace, and farms and orchards lower down give cover on the way up.
  AI 1v1 assault: defenders win 23 of 30.
- Maps can now pin the defenders to chosen spawns in Assault (`defend` in the map file). The editor keeps it on save.
- Units show a shield next to their health bar when they're in cover: green for cover, faded green for cover
  on one side ("by cover"), blue for a trench. No shield when garrisoned (the panel already says so).
- Fixed: clicking or box-selecting units on high ground missed them. Selection projected every unit at ground
  level 0, so on a level-4 plateau the click spot was about 90 px below the soldiers (the pick radius is 32 px).
  It was barely noticeable on the older maps' low hills.
- New mode, Classic (first slice): build a base. The host picks it in the lobby. Each player starts with an HQ,
  an Engineer squad, a rifle squad and 200 MP. Select Engineers and press J (or the Supply Depot button), then click a
  glowing resource node: the depot costs 60 MP, goes up in about 20s, and adds 1.5 MP/s to your 2 MP/s trickle.
  Holding points earns Munitions, which pay for off-map support in this mode. Destroy every enemy HQ to win.
  Barracks, Motor Pool, build times, Sudden Death and the rest come in later slices (see DESIGN.md).
- Classic balance: 90 AI matches over the three maps all ended by Annihilation, median 12-15 min, faction wins 30/32/28.
- Fixed (Classic AI): every AI aimed its artillery and bombs at the same player's HQ (the first one created), so that
  player always died first. Found while measuring Classic.

## 2026-09-30

### Assault mode (7fb1b23)
- New mode: attack and defend a base. The host picks Conquest or Assault and which team defends.
- Each defender gets a Command Bunker (3000 hp, MG slit) behind a trench and sandbag line. Direct fire does 25%;
  explosives do their full demolition damage.
- Attackers win by destroying every bunker; defenders win when the 15:00 clock runs out.
- Works 1v1 and with teams (3v3 on Six Fronts gives three bunkers).
- Balance: attackers win 50% (default map) and 61% (River Towns) over 90 AI matches each.
- Fixed: the free bunker counted as a 3-star veteran. Fixed a flaky high-ground test.

### Teams, up to 6 players, Six Fronts map (f0f021b)
- Up to 6 players: 1v1, FFA, 2v2v2, 3v3. The host sets teams; each player picks a faction.
- Teammates share vision, can't shoot each other, hold each other's points and win on combined VP.
- New 150x150 map for 6 players: Six Fronts.
- Built by a parallel session; part of it landed in the faction commit below.

### Faction flavor (ba20177)
- Unique units: USA Ranger Squad (satchel charges), German Tiger (heavy tank, thick front armor, max 1),
  Soviet Conscripts (cheap, Ura! sprint).
- Faction looks drawn in code: helmets, tanks and rocket carriers differ per faction.
- Units answer orders in English, German or Russian (mute with M).
- Balance: faction wins 37/33/30% over 300 AI matches (USSR won 74% before tuning).

### Control groups on Ctrl (d6a7970)
- Ctrl+1-9 sets a group. Fullscreen button claims the number keys from the browser; Shift+1-9 still works.

### Command & readability (3557373)
- Minimap (rotates with the camera), attack-move (G or Ctrl+right-click), F fires one ability by priority.
- Garrison houses; tanks shell houses on right-click; every tank round damages structures.
- Cover behind houses, walls, rubble, hedges and vehicles. Veterancy stars.
- Rocket launcher (Calliope / Panzerwerfer / Katyusha) to break garrisons. Bombing run support.

### Rivers, bridges, destruction (8054969)
- Rivers, fords and bridges; houses collapse to rubble, bridges drop into the river, shells crater the ground,
  tanks crush hedges and walls. New map: River Towns.

### Friend-ready hosting (908fa39)
- start.cmd hosts over Tailscale; the invite link always uses the Tailscale address.
- Ping on the scoreboard; a disconnected player's clock pauses. Ground can dip below level (depressions).

### Elevation and editor tools (622c5c2)
- Hills block sight, high ground aims and sees better, cliffs block movement.
- Map editor: select, move and delete whole structures; raise and lower ground.

### Map editor (8841758)
- In-game editor at /?edit: paint terrain, place spawns and points, save with a password, fairness test.
- The host picks the map in the lobby.

### Directional aiming (0d98796)
- Supports and trench digging: click the center, move the mouse to rotate, click to launch.

### Trenches and smoke barrage (ed58db6)
- Trenches (heavy cover), rifle squads dig them, smoke barrage support.

### HQ bases and off-map support (dc57b9c)
- Visible HQs; recon flight, artillery barrage and strafing run, announced to everyone before they land.

### Retreat, abilities, economy (ce53a70)
- Retreat and reinforce, one ability per unit, flat income with catch-up, center point worth 2x VP.
- Fixed a map bias: the top spawn won 22 of 30 AI matches; spawns are now shuffled.

### AI opponents (6ddb136)
- Add AI players from the lobby. Victory target raised to 1200 VP (matches were ending in 3.5 minutes).

### MVP (a4c2de3)
- Server-authoritative WW2 tactics RTS in the browser: 1v1 and 3-way FFA, rifle / MG / AT gun / tank,
  cover, suppression, line of sight, fog of war, capture points.
