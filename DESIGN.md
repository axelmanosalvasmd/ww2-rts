# Three Crossroads: design decisions

WW2 tactics RTS in the browser for three friends. Decided 2026-09-30.

## Game
- Tactics skirmish, no base building outside Classic mode. PvP: 1v1 or 3-player FFA, joined by room link (`/#code`). The host can add AI opponents.
- Win: first to 1200 VP. The center gives 2 VP/s and no manpower; villages give 1 VP/s + 1.5 MP/s.
- Economy is mostly flat (4 MP/s base). Trailing players get up to +6 MP/s catch-up (1 per 60 VP behind the leader;
  was +4 per 80 until the new units made games one-sided).
- Retreat (R): sprint home at 1.5x speed, take 25% damage, don't fire. Near spawn, squads refill a soldier every 2s for half its cost; tanks repair for MP.
- One ability per unit (F): rifle grenade (thrown at a clicked spot, friendly fire, ignores cover), MG suppressive fire, AT gun AP round, tank smoke (blocks LOS).
- Off-map support for manpower, announced to everyone before it lands: recon flight (60 MP, reveals 40 m for 15s),
  artillery barrage (150 MP, 10 shells, 5s warning), strafing run (200 MP, plane flies out from your HQ along the line),
  smoke barrage (50 MP, 5 clouds over 12 m for 20s).
- Trenches (`T` cells): heavy cover (35% incoming accuracy/suppression vs 50% for normal cover), half blast damage.
  Pre-dug at the center and in front of each village. Rifle squads dig more (T, 30 MP): a 4-cell line across their approach,
  one cell per 3s. Terrain changes go out in snapshots; (re)joining clients get the full change log.
- Directional aiming for every targeted ability except the grenade: click the center, move the mouse to rotate, click to launch.
  Each is a rectangle along the chosen line: strafe 36x8 (the plane flies that way), artillery 24x10 (creeping barrage),
  smoke wall 36x14, recon corridor 80x30, trench line 4 cells. Without a direction the server falls back to 'out from your HQ'.
- Each spawn is a visible HQ: tinted reinforce zone, a ring of real-size sandbags, a canvas wall tent with guy lines,
  crates and a field table, a guyed flagpole with the team flag, name label. H jumps home.
- Spawns are shuffled each match: a 3-way map is never perfectly fair on a square grid.
- Up to 6 players, 2-6 spawns per map, maps up to 256x256. Spawn order in the map file does not matter: spawnSlots
  tries every layout and keeps the one with teammates closest together and enemies furthest apart, measured as
  walking distance over the terrain (spawnDistances: water, cliffs and houses block, a ford cell costs 6), so a team
  shares a river bank. Fewer players spread out, and a free-for-all spreads evenly (closest enemies as far apart as
  possible). Each match picks at random among layouts within 3% of the best, so which side a team gets changes.
  The host sets teams, each player picks a faction.
  Teams share vision, can't target each other, hold each other's points, and win on combined VP; the goal scales
  with average team size (3v3 plays to 3600) so team games last about as long as a 1v1.
- Factions are cosmetic (USA / Germany / USSR by slot). Same roster and stats for everyone:
  rifle squad, MG team, AT gun, light tank, plus (2026-09-30) mortar team, sniper, armored car, medium tank.
  Squads are one sim entity with N models.
- Four factions (2026-10-02: the UK joined; new players still cycle USA / Germany / USSR, the UK is picked in the
  lobby). The shared roster is the same for all; each faction adds its own units (USA Rangers, Germany the Tiger,
  USSR Conscripts, UK Commandos and the Churchill) and the UK a doctrine (DOCTRINE in shared/sim.js: its artillery
  barrage fires 1.5x the shells). The UK design aims at slow, methodical play behind the best artillery: the
  Churchill is tougher at the front than the Tiger (0.6 vs 0.7 front damage, 1050 vs 900 hp) but slower (3.2) with
  a weaker gun (70 vs 110 against vehicles). Planned, not built: gun pits (infantry-built sandbag emplacements that
  give a gun inside extra range), the Crocodile, and a Creeping Barrage commander order. Other factions' ideas
  (Japan: ambush, tunnels, Banzai) are parked.
- Balance with four factions: `node tools/ai-balance.mjs --matches 240 --factions 4` rotates the four through the
  three spawns (each sits out one match in four). 2026-10-02, 240 Conquest matches, default map: USA/GER/USSR/UK
  66/63/50/61 wins of 180 each (37/35/28/34%), median 565 s, runner-up VP 0.64 of the winner. Run on a working tree
  that also held other sessions' uncommitted paratrooper and pathfinding changes.
- Combat: cover cells halve incoming accuracy and suppression. The suppression meter slows and then pins infantry.
  Tanks take double damage from the rear. Grid line of sight. Fog of war is enforced by the server.

### Balance log (30-40 AI-vs-AI matches each)
| Version | 2nd place VP vs winner | Lead changes / match | Length |
|---|---|---|---|
| MVP (VP 500) | 10% | 0.0 | 6.8 min |
| + retreat, abilities, flat economy, unequal points | 43% | 0.6 | 9.2 min |
| + catch-up max 4 per 80 VP behind, spawn shuffle, AI group attacks | 63% | 1.2 | 9.7 min |
| + off-map support (AI calls ~8 per match) | 65% | 1.25 | 9.9 min |
| same, re-measured over 150 matches (the 40-match runs above are noisy, about ±0.1) | 63% | 0.97 | 9.5 min |
| + trenches, digging, smoke barrage (150 matches) | 61% | 0.95 | 9.3 min |
| + directional supports (150 matches) | 60% | 0.89 | 9.3 min |
| + elevation, overwatch hills (150 matches; per-spawn wins 37/34/29%) | 62% | 1.05 | 9.5 min |
| + weather: Clear / Fog / Rain / Snow (40 each; faction wins and Classic in Weather below) | 59 / 63 / 62 / 62% | 1.88 / 1.93 / 2.05 / 1.80 (checked every 10 s) | 9.2 / 9.6 / 9.3 / 9.1 min |

## AI information and commands (2026-10-01)

The rule: an AI seat knows only what a human in that seat could know, has the economy and limits of a human, and acts
only through `command()`.

- `shared/ai-view.js` is the AI's only window onto the game. `viewFor(g, slot, memory)` runs the same `snapshotFor()`
  a human receives and decodes its rows into plain objects. It copies units, public objectives, announcements and the
  seat's own economy; other seats expose only public start data (spawns, teams, factions) and scores. Coordinates,
  health, suppression, support countdowns, resources and cooldowns carry their wire values. Stances (hold fire, hold
  position, auto-retreat), autocast and "digging a mass entrenchment" come from the unit flag bits; the stances and
  autocast are the owner's only, so an enemy's are always off in a view.
- `think(g, slot, opts)` keeps its signature. It builds or accepts a view, then calls `plan(view, ...)`, which has no
  reference to the authoritative game. Orders go through `opts.submit` (default `command(g, slot, cmd)`). Engineer
  node assignments and the squad sent to rebuild a bridge live in private per-seat memory, not on the units.
- The server refreshes each AI observation on the human snapshot beat (every 2 to 4 ticks). A turn between beats uses
  the previous view. A seat handed over from a human waits for the next beat and keeps the terrain it had discovered.
- `seenBy(g, slot, id)` in `sim.js` is the one visibility predicate (reveal, allied, visible, and a plane counts only
  while airborne). `snapshotFor()` and the AI both use it.
- Terrain starts from an immutable copy of the public map (`g.initialTerrain`, taken before Classic buildings or
  Assault fortifications) and applies only the changes the seat's `terrainFor()` delivers. Cover, trench and house
  searches, building-site searches and the blown-bridge check run on that remembered terrain, so hidden placement,
  cancellation and destruction cannot move a plan. `terrainFor()` already withholds enemy mines, so the view's `mines`
  (the cells remembered as `N`) are the seat's own side's, which is what the AI counts before laying more.
- A resource node counts as taken only when an allied depot, or a visible or remembered enemy depot (Ghost), stands
  within 8 m. A Barracks next to a node does not claim it. Unknown nodes stay candidates, and `command()` rejects a
  wrong guess with the normal visibility mask.
- Sightings expire after 60 seconds in every mode. The lone-gun artillery fallback needs more than 3 seconds of
  stillness the AI observed itself (0.1 m tolerance, reset when sight is lost).
- Entrenchment, cover, stances: the AI sends `entrench`, `cover`, `stance` and `dig` (mines, bridge) through `submit`
  like a player, and `command()` applies the same sight rules (every segment must be in the team's sight). Where it
  entrenches is decided from remembered terrain (`trenchesNear`) and the squad's own cover value; whether it is already
  entrenching comes from its own flag bits.
- Weather is public: every snapshot carries the match weather (and the ten second warning of a change), so the view
  carries it too. `aiCaution(view)` and the view's own sight (`view.sees`, which `teamSees` scales by the weather) give
  the same answers as the game's for every weather kind. A weather change planned beyond the warning is hidden from
  everyone, and the match proof perturbs it.
- Horde. The horde is a scripted wave director plus one more seat. The sim itself spawns each wave and sends every
  unit at the shared bunker, a public structure that is always visible, so nothing in that needs hidden information.
  The horde seat's own `think()` (its off-map support, planes and abilities) is not exempt: it plans through the same
  view as every other seat, so it knows only what its units see, and the server gives it an observation like an AI
  defender's. The wave budget, the support allowance per wave and the free reinforcements are difficulty rules that
  do not depend on where the defenders are, so they stay as they are. Co-op AI defenders use the same view too.
- Proofs in `test.js`: seeded commands for equal snapshots stay equal while hidden armies, secret depots on every
  unseen node, hidden footprints, enemy economies, and the private state of enemies the seat can see (stationary
  timers, paths, health and position below the wire precision, stances) and enemy mines laid around the seat's units and
  points (on open ground, mud and road) are perturbed, across Conquest (also on a
  house-free map, where squads entrench), Classic, Assault and Horde matches, including the horde seat itself. A
  perturbation is kept for a turn only if the human snapshot stays identical. Negative controls show that perturbing
  something the seat sees does change its orders. State is hashed around every submit to catch writes outside
  `command()`, and an AI seat's orders are replayed as a human to show equal income, costs, cooldowns and limits.
  Fixtures cover entrenching beside hidden trench cover, mines (own side counted, enemy mines unknown), auto-retreat,
  and a blown bridge. These tests were run against the old `ai.js` logic (master's, adapted only to take
  `opts.submit` and `opts.memory`): the stillness, landed plane, wire precision, secret depot, footprint, entrenchment,
  delivery beat and match perturbation proofs all fail there. The bridge proof passes on both, as it checks that the
  port keeps behaviour, and the economy replay passes on both because there never was an AI-only economy. The mine
  proof passes on the old logic as well: master's AI already counted only its own side's mines, so it guards that rule.
- Integration: `ai.js` functions changed are `memoryOf`, `think`, `houseNear`, `trenchesNear`, `spotNear`,
  `buildEconomy`, `minesNear` and `rebuildBridge`. New: `observe`, `plan`, and the view adapters `knownBuildings` and
  `inCover`. The closures `trains`, `affords`, `pointOf`, `can`, `call` and `send` now read the view or use `submit`.
  Difficulty branches should plan on this view, act through `submit`, and pass the same proof tests.
- Reproducible runs use `tools/ai-balance.mjs` (default map, 3 players, standard armies, shuffled spawns, factions by
  slot, seeds 1 to N, 20 minute limit; medians include matches stopped at the limit). Same seeds before and after, no
  economy or unit tuning, both on the merged code with unit control, roads, mud, mines and bridges (master at
  d1b7150 as "before"):

| Mode (matches) | Wins USA/GER/USSR | Wins by spawn 0/1/2 | Finished | Median length |
|---|---|---|---|---|
| Conquest (60) before | 23/20/17 | 22/22/16 | 60 | 9.27 min |
| Conquest (60) after | 19/17/24 | 28/17/15 | 60 | 9.15 min |
| Classic (30) before | 4/8/5 | 12/2/3 | 17 | 19.41 min |
| Classic (30) after | 7/10/5 | 12/3/7 | 22 | 18.39 min |

  Conquest runner-up VP over winner VP: mean 0.573 before, 0.533 after (median 0.605, 0.561). Classic median length
  among finished matches: 18.01 minutes before, 15.91 after. Before the merge (master at 4f01489, the AI without
  stances, mines or bridges) the same check gave Conquest 30/14/16 to 26/13/21 with 8.45 to 9.59 minutes, and Classic
  8/8/4 to 8/9/6 with 20 to 23 finished.
- Left for later: a mine laid on a road cell turns it into `N` (no flags), which cuts the road in the authoritative
  terrain, so a vehicle's route shifts around a hidden mine for any player, human or AI. The AI plans no paths and reads
  no road flags, so it gains nothing, but keeping the ROAD flag under a mine would close the side channel for everyone.
  Two Engineers can propose the same building site in one turn before the next terrain snapshot (the
  second command is rejected normally). Shared automatic salvo targeting scores hidden neighbours of a visible target,
  for human and AI armies alike. A mine painted in the editor belongs to nobody and is not counted. The uncommitted
  difficulty branch has not been merged or edited.

## AI decisions (2026-10-02)

A seat AI is one commander with a private match memory (`shared/ai-mind.js`), not a list of reflexes that all fire
every look. The horde wave is unchanged: it still attack-moves the bunker and still arms every squad.

- A new enemy is noted the look it appears and acted on only after `notice` seconds (Easy 2.5, Normal 1.25, Hard 0.5).
  Strikes, grenades, satchels, barrages and Hard's focus retarget wait that long. An announced enemy air strike is
  still answered at once, because the siren is public. One support call per look.
- March orders are capped per look (`hands`: 4, 6, 8). Reopening a cut point is not capped. One enemy-held point is
  attacked per look. The point it picks keeps a small pull for `commit` seconds (16, 10, 6) unless that push is failing.
- Auto-retreat is no longer switched on for every squad at the first look. Squads are armed when they are sent into
  a fight, or once an enemy they have watched is within 40 m. Hurt squads still get an explicit retreat order.
- Learning uses only own losses and sightings. A squad that disappears within 28 m of a remembered enemy type adds
  one point of respect for that type (cap 6). Respect for tanks, mediums or Tigers makes the next rifle or MG buy an
  AT gun (until two are fielded) even after the armor leaves vision. Two infantry losses pull a machine gun.
  A squad lost within 20 m of a point adds a failure there (cap 4). Each failure adds 40 m to that point's score and
  0.45 to the force margin the next attack needs, counting at most three. Capturing a point removes one failure and
  one point of every respect, so the commander can change its mind. The memory is wiped with the match.
- Each look names one situation, stored on the seat's private operation: `wait`, `defense`, or `push`. Purchases,
  the one support call, and marches follow it. Support aims at that fight, or at an announced enemy air strike.
  A contact younger than `notice` does not cancel the operation and is not struck. Easy's `commit` is longer than Hard's.
- Wait: armor still in the 60 second sightings, and worth more than the anti-tank guns and tanks the seat can send.
  No rifle attack-move onto that ground. The next rifle or machine-gun buy is an anti-tank gun until two are fielded.
  An anti-tank gun already fielded is ordered toward the armor. The wait is that ground, not the whole army: another
  point more than 28 m from the threat can still be taken, and the decision names that action `take-other` (or
  `prepare` when every objective is the threat, `hold` on defense, `take` on a push). The same threat is not waited
  out forever: when `commit` ends, the sighting expires, or a later look sees that ground empty, a push onto it is
  allowed again. Rifles still do not walk onto armor that is remembered. An infantry crowd the seat cannot match
  waits for a machine gun.
- Defense: a watched enemy on a held point, a depot, or the base. Idle combat units are ordered toward it, and no
  second enemy objective is opened in that look. The horde wave director does not use these situations.

## Assault mode (attack & defend)
- Host picks Conquest (VP race) or Assault in the lobby, and which team defends; every other team attacks as one.
- Each defender gets a Command Bunker (3000 hp, MG slit, always visible) between their HQ and a generated line of
  trenches and sandbag walls facing the map center. Direct fire does 25% to it; explosives use their demolition value
  (bomb 400, satchel 600, rocket 120, shell 90), so every destruction tool is a way in.
- Off-map support does 5% of its demolition value to the bunker (`CFG.assault.supportMul`): a bombing run used to be
  the main way to kill it. The AI attacker stops aiming strikes at it. Attacker wins /20 after: Three Crossroads 15,
  River Towns 12, Pegasus 7, Seawall 7, Stalingrad 7, Bocage 4 (was 11), Hill 112 3, Monte Cassino 1 (was 11).
- Attackers win when every bunker is down; defenders win when the 15:00 clock runs out. No VP; points give manpower.
- Attackers start with 320 MP and +5/s, defenders 250 and +3.5/s. 90 AI 1v1 assaults per map, attacker wins:
  50% (default), 61% (River Towns). 3v3 on Six Fronts runs (3 bunkers).
- A map can reserve spawns for the defenders with `"defend": [spawn numbers]`; attackers get the rest. Without it,
  spawns are shuffled as usual.
- Map pack (`tools/genmap-pack.js`): 5 assault maps with `defend`, 5 point-symmetric 2-side conquest maps (drawn with
  a mirroring canvas, so every cell has its twin through the center) and 2 six-player rotational maps.
  Cliffs are 2+ level steps; ramps are single-level cells cut through them. Hedges block sight, not movement.
  Crossroads Village 1v1 by spawn: 15/9 over 24 (mirrored, so likely noise).
- Assault map balance is mostly about where the points are, not how much they pay. With points next to the attackers'
  spawn they won ~35/40 (Pegasus, Seawall); raising the defender's income changed nothing, while moving the points to
  the defender's side swung it to 1-4/20. Rule used: the defender's points and the key terrain (cliff tops, ramp tops)
  inside the AI defender's 70 m home range; a few contested points in the middle; small ones near the attackers.
  AI 1v1 assault, attacker wins (20 each): Pegasus 7, Bocage 11, Seawall 4, Monte Cassino 11, Stalingrad 7.
  Seawall: cliff at row 56 (ramp tops outside the defender's range) 20/20, at row 30 1-2/20, at row 42 4/20 (kept).
- Hill 112 (80x110, `tools/genmap.js`): defenders on a level-4 plateau, attackers at level 0. On the upper slope
  the flanks are a 2-level cliff, so the climb funnels through a central ramp or narrow paths at the map edges.
  The AI defender only holds points within 70 m of home, which here is just the summit, so the summit's MP
  decides the balance: AI 1v1 assault, attacker wins 13/20 at summit mp 1, 14/20 at 1.25, 7/30 at 1.5 (kept:
  the hill should favour the defender). Small samples; the swing between 1.25 and 1.5 is large.
- XL maps (tools/genmap-xl.js, 6 spawns, 3 defend): Pegasus Bridge XL, Hill 112 XL, Seawall XL. A map can carry
  `assaultTime` (seconds) because crossing takes longer: 20 min / 16 min / default 15. AI 3v3 attacker wins over 40:
  58% / 45% / 25%. Assault results swing a lot at 20 matches (2/20 and 7/12 for the same map), so measure with 40+.
  Monte Cassino XL: 23 min, 45%.
- Assault-only spawns (`"assault": true` on a spawn): for maps whose defenders start inside a fortress in the middle
  (Stalingrad Factory). Other modes skip them, so nobody starts surrounded; the lobby seats players per mode.
- The map editor previews each mode by running createGame for it and drawing the result (cells, bunkers, nodes, which
  spawns are used), so the preview can't drift from what the game really builds.
- Bug found while testing: veterancy thresholds are multiples of unit cost, so the free bunker counted as a 3-star
  veteran. Free units never rank up now.

## Annihilation mode
- Every player gets Assault's fortified bunker (`fortify()` in sim.js, shared with Assault). No clock, no VP: a team is
  out when its last bunker falls, last team with one wins. 300 MP start, +4.5/s base, points pay MP only.
- The AI treats it like an attacker in Assault: it captures points and goes for the nearest enemy bunker once it has
  6+ units. AI runs, time to finish: 1v1 Three Crossroads 4:47-26:43 (8 games), River Towns 5:41-23:45 (4),
  Kasserine Pass 3v3 28:40 and 29:54. None stalled out to the 40 minute cap.

## Horde mode (decided and built 2026-10-01)
Co-op: 1-5 players (humans or AI teammates) defend against Waves from the Horde, an extra AI player that
`createGame` adds after the last name (so no room seat maps to it; the server thinks for it). There is no winning:
the result is the Wave the bunker fell on. Terms are in CONTEXT.md, knobs in `CFG.horde`.
- Defend: one shared Command Bunker. Every player spawns, reinforces and retreats at the same HQ (the middle one of
  the map's `defend` spawns), and `fortify()` runs once there (the first player owns the bunker). The bunker has
  3000 hp per defender, done as damage divided by the number of defenders so its bar stays 0-100%. The run ends when
  it falls.
- Maps: only maps with `defend` spawns (11 of 22); the lobby greys out the rest, and picking Horde on another map
  switches to the first horde map. The Horde enters at every other spawn, one unit per spawn twice a second.
  Start and Restart recheck the freshly loaded map. Losing defender spawns refuses Start in the lobby or preserves
  the existing game on Restart.
- Waves: the 45 s break starts only when the Wave is dead (no horde ground unit on the map or in the Reserve). The
  host can send the next Wave early (`{t:'nextwave'}`, host only, handled by the server). With 3 or fewer left they
  are revealed through the fog until they die.
- Escalation: a Wave is an MP budget, 300 x 1.25^(wave - 1) x defenders x the army size's income factor, spent at
  random by weight on the normal roster at normal prices (`hordeWave`). No stat buffs. Unlocks: rifles and
  conscripts from 1, MG and mortar at 3, armored car, light tank and AT gun at 5, medium tank and rockets at 8, Tiger
  at 12 (the Horde ignores factions and the Tiger's limit of one). Never snipers.
- Big Waves: the Horde fields at most 60 units per defender (240 in all); the rest waits in the Reserve and enters as
  units die. Buy at most 32 reserve units per tick and buffer at most 240; keep the remaining MP budget as a number.
  Purchases keep the normal affordability and random weights. Budgets above `Number.MAX_SAFE_INTEGER` are capped
  so each purchase still reduces the budget. HUD: "Wave 16, 41 left". While purchases remain, the count includes an
  upper estimate from the cheapest unlocked unit; it becomes exact when purchasing ends. The final-three reveal and
  the break wait until the remaining budget is spent or cannot buy any unit.
- Horde support: from Wave 6 it gets 150 MP of off-map support per Wave past 5, per defender, spent by the existing
  AI (no paratroopers); what it doesn't spend is lost. From Wave 10 it gets planes (1, +1 every 3 Waves, x half the
  defenders rounded up, at most 8; every third a fighter), so players need Flak. Planes don't count toward "Wave
  dead" and are removed when it is cleared.
- Horde brain: `think()` with a horde branch. Every unit attack-moves on the bunker from spawn. No shopping, no
  retreat (auto-retreat is ignored for it), no reinforcing, no capturing points, no Kill Bounty, no income. It keeps
  abilities, smoke, mortars and support.
- Player economy: the Assault defender's (250 MP, +3.5/s) plus the Kill Bounty and MP from held points.
- Bunker repair: +10% max hp per cleared Wave. No paid repair.
- Army size: scales the players as usual and the Wave budget by the same income factor. Endless is refused.
- AI teammates: allowed, use the defender AI (they stay within 70 m of the HQ), and count as defenders for the
  budget and the record.
- Records: best Wave per map, team size and army size in `horde-records.json` beside server.js (not in git), with
  names, kills and time; a tie on the Wave goes to the longer run. The lobby shows the record for the current
  settings, the result line shows Wave, kills and time.
- Balance (AI defenders only, `node tools/horde.mjs <map> <defenders> <runs>`, Standard, 3 runs each, the Wave the
  run ended on): Hill 112 solo 11/9/11, three 12/12/11, five 14/14/9; Seawall 11/11/13 and 12/12/12; Pegasus
  13/14/11 and 13/11/15; Monte Cassino 13/12/12 and 12/14/11; Bocage 11/10/8 and 13/11/11; Stalingrad 13/11/11 and
  13/14/13; Kasserine 13/15/14 and 14/15/14; the four XL maps 8-14. Runs last 22-36 minutes. So the budget x
  defenders rule holds from 1 to 5 defenders, and runs end by themselves: a 12-unit army can't stop Wave 12+
  (4400 MP per defender). Humans should get further than the AI. Massive (2 runs, three defenders): Waves 4 and 8,
  308 units at the peak, worst server tick 16 ms. Massive is harder than Standard and is not tuned.
- Bug found while testing, in the shared movement code: units that reach one waypoint together pushed each other off
  it for good, because the "stuck" check measured movement before units are pushed apart and so never fired. Horde
  units spawn in a clump with the same route, so whole groups froze near their spawn (Monte Cassino with three
  defenders: 4 of 6 runs never ended). A unit with no real progress for a second now skips a waypoint it can walk
  past, and after three seconds counts standing next to it as reaching it.
- Known, left for later: AI teammates don't leave home to hunt a mortar or rocket truck shelling the bunker from
  range. A horde unit with no route to the bunker (vehicles behind a closed ring of tank traps) waits where it is
  until the players kill it. No regression test reproduces the waypoint jam in isolation; `tools/horde.mjs` reports
  runs cut off at 90 minutes (none in the 68 runs above).
- Deferred: difficulty levels, a hand-built horde map, paid repair, a Horde that takes points.

## Command & readability (slice after destruction)
- Recruitment cards and tooltips share role descriptions, including Flak's role against enemy air support.
  A unit without role copy shows its name in both the buy bar and Classic training cards.
- Minimap (bottom-right), rotated with the camera: terrain, fog, points, HQs, units, strike warnings, camera view.
  Left-click/drag looks, right-click moves the selection (Ctrl = attack-move).
- Attack-move: G then click, or Ctrl+right-click. Units halt to fight what's in range, then carry on.
- Selected units show their weapon range (a ring; rocket launchers also show their minimum range), their route, and
  what they're set on: a line and marker to the locked target, grenade spot, trench, site or house. Colors: blue move,
  orange attack-move, white retreat, red attack, yellow dig/build. The server sends these plans for your own units
  only, so nothing leaks through the fog.
- F fires one ability: the first ready type in rifle > MG > AT > tank > rocket order; others are click-only in the bar.
  Right-clicking an ability button turns autocast on or off (see Autocast below).
- Garrison: right-click a house with rifles/MGs. One squad per house cell (edge cells, so they can shoot out).
  Inside: +25% vision, blasts halved. House wrecked -> thrown out with 30% damage.
- House types (2026-10-01), set by the size of the block on the map, worked out once at match start (`CFG.houses`):
  wooden shed (10 cells or fewer, 250 HP per cell, 55% incoming accuracy), brick house (11-23 cells, 400 HP, 35%, the
  old numbers), stone building (24+ cells, 650 HP, 25%). Protection wears down with the squad's own cell: it slides to
  85% / 70% / 55% as that cell nears collapse, so shelling pays off before the house falls and the defender has to
  choose when to leave. All types burn down in the same time. The HUD tag names the type.
  The look follows the type (client/structures.js asks the same `houseKinds`): timber sheds and barns, brick or
  rendered houses under clay tiles, bare stone under slate. Stone on screen always means the strong type, which is
  why the church is only ever placed on a stone block. Brick is a texture drawn in code (client/surfaces.js).
  40 AI matches each, old rules vs new: default 15/8/17 -> 20/10/10 slot wins, 2nd place 58% -> 53%; River Towns
  12/10/18 -> 8/15/17, 56% -> 51%; Stalingrad Factory 0/27/13 -> 3/21/16, 76% -> 68%. Match length within 15 s.
  Too few matches to call the slot shifts real; the numbers are a first guess.
- Tanks shell a house on right-click (fire-at), and every tank round damages the structure it lands on.
- Directional cover: a house, wall, rubble, hedge or vehicle within ~2 m on the shooter's side = 50% cover from that shooter.
- Veterancy: damage dealt of 1/2.5/5x the unit's cost = 1-3 stars (+10% accuracy, -8% damage, -15% suppression each).
- Rocket launcher (250 MP; T34 Calliope / Panzerwerfer / Katyusha): 8-rocket salvo up to 70 m on anything its side can
  see, no line of sight needed, +50% vs garrisons, 20s reload. F = Rocket Barrage on any clicked spot.
- Bombing run (250 MP, N): 6 heavy bombs in a line, 7 m blasts, big craters, 400 structure damage per bomb. Each bomb
  lowers a 3x3 patch one level, each artillery shell one cell (never more than one below a neighbour, so no
  inescapable pits).
- Balance: garrisons alone dropped 2nd place to 55%; with rockets it's back to 63% (default) / 61% (River Towns).

## Autocast (2026-10-01, all modes)
- Warcraft 3 style: each unit with an ability has an autocast switch (`u.auto`), set with `{t:'autocast', ids, on}`.
  The server accepts it for your own units that have an ability and ignores the rest of the list.
- Default: on where the ability is free (Conquest, Assault, Annihilation), off in Classic, where abilities cost
  Munitions, so a squad never spends the stockpile without being told to. The AI never turns it on in Classic.
- The server checks every 0.5 s (10 ticks), staggered by unit id. A unit with autocast on, its cooldown ready, no
  ability order in flight and not retreating looks for a reason, using only what its side can see:
  - Grenade: the nearest enemy infantry in cover, in a trench or in a house within 18 m (never from inside a house).
  - Suppressive fire: the MG is set up (not moving) and an enemy squad in range and sight is advancing towards it.
  - AP round: the AT gun is shooting at a vehicle.
  - Tank smoke: the tank is below half health and took an anti-tank hit in the last 3 s.
  - Rocket or mortar barrage: a spot with 3+ visible enemies in one blast area, or anyone dug in (house, trench,
    bunker); the most crowded or dug-in spot wins.
  - Satchel: the house or bunker the Ranger squad was ordered to attack, once within 20 m. An attack order stops the
    squad at its weapon range (26 m), so this fires in close fights, not when Rangers are sent at a house from afar.
    Open question: raise the reach to 26 m so a Ranger sent at a house or bunker always runs in and plants it
    (it would also send Rangers into a bunker's machine gun for little damage), then re-run the balance check.
  - Ura!: the squad is pinned (suppression 50+) while moving.
  Aimed abilities (grenade, barrage, satchel) skip spots where the blast would also hit a friendly unit.
- It goes through the same ability command as a player's click, so cooldowns, Munitions and the usual checks apply.
  An autocast grenade or barrage in range goes off without stopping the unit's current orders; a satchel charge walks
  up first and the squad stays where it planted it. A player's own ability order is never replaced while it is in flight.
- The flag reaches the owner only (snapshot flag 16384, stripped for everyone else). The HUD marks an ability button
  whose selected units all have autocast on with a dashed brass border and a small A, and the tooltip says
  "Right-click: autocast on/off". Right-clicking toggles it for the selected units of that type: on unless all are on.
- The client remembers each player's last choice per unit type, separately for Classic and the free modes (local
  storage), and applies it to new units of that type as they arrive.
- Balance (300 paired AI-vs-AI Conquest matches, default map, 3 AIs, autocast on vs forced off): 2nd place VP vs winner
  0.57 both, lead changes 2.24 vs 2.23, length 9.1 vs 9.0 min (median 9.1 vs 9.2), about 98 vs 88 ability uses per match,
  25.2 vs 25.3 units killed. Faction wins USA/GER/USSR 35/36/29% vs 39/31/30%: Germany up and USA down about 4 points,
  roughly 1.5 to 2 standard deviations, so probably noise. Classic is unchanged because autocast starts off there.

## Classic mode (decided and built 2026-09-30, all 5 slices)
Base building as a third lobby mode next to Conquest and Assault. Terms are defined in CONTEXT.md.
- Win: Annihilation. A player with no Production Buildings (HQ, Barracks, Motor Pool; a Construction Site of one counts)
  is eliminated, and the last team standing wins. No VP.
- Sudden Death at 25:00: production and construction stop, and Production Buildings lose ~1% max hp/s (depots exempt).
  Repair is slower than decay. Last building standing wins; if the last ones fall in the same tick, it's a draw.
- Economy, three currencies, one source each: home depots pay MP (2.5/s each, plus an HQ trickle of 3/s), the contested
  depots by the villages pay Fuel (1.5/s, plus an HQ trickle of 0.5/s), points pay Munitions. Fuel buys vehicles, which
  cost less MP in Classic: armored car 160 MP + 25 Fuel, light tank 200 + 60, rocket truck 170 + 50, medium tank
  260 + 90, Tiger 420 + 150. Upkeep: each fielded unit costs 0.08% of its price per second off the MP income (min 0.5/s).
  History: contested depots paid 2.5 MP/s before Fuel. Upkeep alone (even doubled) didn't stop the leader banking MP at
  the pop cap; Fuel and the new units did (winners end with ~450 MP instead of 1500-2500). Depots only go on Resource Nodes (one each).
  No catch-up. Start: HQ, 1 Engineer, 1 rifle squad, 200 MP. Pop cap 20 in Classic (buildings excluded, queued units
  count): at 12 the leader sat at the cap banking thousands of MP and games stalled.
- Resource Nodes: generated per match: 2 home MP nodes per spawn (~12 cells out, toward the flanks) and Fuel nodes
  halfway between neighbouring enemy HQs (each player pairs with its 2 nearest enemies; a 1v1 gets one per flank), at
  the nearby spot both sides walk about equally far to. Village-side Fuel nodes were unfair: some sat 15-17 m from one
  HQ. (Hand-placed nodes in the map file wait for the editor Node tool.)
- Munitions: a second currency, Classic only, earned from held points at 1.5 x the point's vp (center 3/s, village 1.5/s),
  full rate for every teammate. It pays for off-map support and unit abilities (abilities keep their cooldowns).
- Buildings: HQ (3000 hp; Engineers, rifles; unique, can't be rebuilt), Supply Depot (60 MP, 600 hp), Barracks
  (150 MP, 1500 hp; MG, mortar, sniper, faction infantry), Motor Pool (200 MP, 1900 hp; AT gun, armored car, light and
  medium tank, rocket truck, Tiger; needs a Barracks). Hp went down 25% with the new units: armies hold fewer tanks
  (the base killers), and at the old hp only 53% of games were decided before Sudden Death.
  One tier; no upgrades or research. Barracks and Motor Pool can't cover a resource node.
- Buildings are timber, not bunker concrete: guns with 20+ anti-tank damage hit them fully, small arms do 25% of their
  anti-infantry damage. With the bunker rule (25% of anti-tank damage) a rifle hit did 0.1 and armies shot at bases forever.
- Training times: Engineer 12s, rifle 15, conscript 12, MG 18, mortar 20, sniper 20, Ranger 20, AT 22, armored car 25,
  rocket 30, tank 35, medium tank 40, Tiger 50.
- Buildings are stamped grid cells (3x3, depot 2x2): they block movement and sight, give cover and wreck to rubble.
  Hp lives on the building. Placement: any clear flat cells your side can see.
  Enemy buildings show as last-seen Ghosts under fog.
- Construction: placing a building pays the full cost and stamps a Construction Site at 25% hp. Adjacent Engineers build it
  (more Engineers build faster with diminishing returns, ~1.7x for 2, ~2.2x for 3). Cancelling refunds 75%, a destroyed
  site refunds nothing. Build times with 1 Engineer: depot 20s, Barracks 30s, Motor Pool 45s. Engineers repair for free,
  slowly (0.5% max hp/s per Engineer, capped at 0.6% in Sudden Death so decay still wins). Right-click your own site or
  damaged building with Engineers to help or repair.
- Engineers: a 3-man armed squad (~60 MP), a weak rifle squad. Only the HQ trains them.
- Production takes time, with a queue of up to 5 per building. Units appear at their building and walk to its rally point.
  Retreat goes to the nearest own Production Building. Reinforce and repair work near any own or allied
  Production Building; you can't produce from an ally's.
- Elimination in teams: the eliminated player's units pass to the nearest surviving teammate (or are removed), and their
  depots are destroyed. They keep spectating with team vision. No resource transfers.
- UI: Engineers selected means the build bar (J depot, K Barracks, L Motor Pool) with a grid-snapped green/red footprint;
  Shift-click keeps placing, Esc cancels. No global buy bar in Classic (the user found the always-on unit list confusing):
  the bottom panel is the selection's command card, a building's units and queue or the Engineers' buildings. H selects
  the HQ. Click a building to select it: its queue, what it trains, Cancel for a
  site; right-click sets its rally point. Building footprints aren't painted on the ground, because terrain changes reach
  every client and would show enemy bases through the fog (the data still reaches the client: fine among friends).
- AI build order: 2 depots, Barracks, Motor Pool, then the remaining nodes; Engineers help unfinished sites and repair
  anything under 70%; it saves MP for its next building unless its army is nearly gone, and only buys what its buildings
  train. It knows enemy buildings only through its team's Ghosts; with none known it marches on the enemy spawns.
- Adaptive AI (fog-fair: it remembers what its team saw in the last 60s): 1 counters (tanks seen = AT guns and the Motor
  Pool first; 6+ infantry seen = more MGs), 2 rush defense (enemies at its buildings before 4:00 = whole army home, stop
  saving, artillery on them), 3 attack a base only with an army worth 1.1x what that team showed in the last 30s,
  4 raid a known depot nobody was seen guarding for 30s with 2 squads, 5 recon flight over the likeliest spawn while no
  enemy base is known. `think(g, slot, { adaptive: false })` plays the scripted AI, `rules: [..]` a subset.
- Adaptive vs scripted, 1v1, rule by rule (20 matches each, adaptive wins): counters 12, rush defense 14, raids 10,
  attack timing 7 at first (1.3x over a 60s memory that still counted enemies since killed: it never attacked) then 11
  at 1.1x over 30s, scouting 5 at first (a lone squad walked to the enemy spawn and died) then 14 as recon-only.
  All five: 26/40 (default), 28/40 (River Towns). Rules 1+2+5 alone only 18/40 and 21/40: they work together.
- Balance target (AI vs AI): 70%+ of matches end by Annihilation before Sudden Death, median length 12-18 min, fair spawns.
- Slice 1 as built: lobby option; HQ (4000 hp) stamped on the spawn; generated nodes (9 on the 3-spawn maps, 12 on
  Six Fronts); Engineers build depots (J, click a node); supports cost Munitions (recon 25, smoke 20, artillery 60,
  strafe 80, bombing 100); Annihilation. Everything is still bought at the HQ with no build time. The AI keeps 1-2
  Engineers building on the nearest free node and marches on the nearest enemy HQ once its army is 6+.
  Buildings stay always visible until Ghosts (slice 3).
- Slice 1 balance (3-player FFA, 30 AI matches per map): Annihilation 30/30 on every map, median 13.7 min (default),
  14.6 (River Towns), 12.0 (Six Fronts). Faction wins USA/GER/USSR 30/32/28 of 90. HQ at 2000 hp ended games in ~7 min
  (HQs die mostly to bombing and artillery), so it went to 4000.
- Bug found while testing: the AI aimed its support at the first enemy building in creation order, which is always
  slot 0's HQ, so both AIs ganged up on slot 0 (slot 2 won 11/12 with equal factions). It now aims at the enemy
  building nearest its own HQ; wins by slot went to 4/4/4.
- Ability costs (Munitions, Classic only, on top of cooldowns): grenade 15, satchel 30, rocket barrage 25, AP round 15,
  suppressive fire 10, tank smoke 10, Ura! 10. Aimed ones are paid when thrown.
- Balance with production (slices 2+3, scripted AI, 30 per map): Annihilation 90/90, 77 before Sudden Death, median 16.1
  (default), 17.6 (River Towns), 23.8 (Six Fronts). Before the timber rule and pop cap 20 only 6/60 ended in 30 minutes.
- Balance, full MVP (all slices, adaptive AIs, 3-player FFA, 30 per map): Annihilation 90/90, 81 before Sudden Death
  (target 70%+), median 16.5 min (default), 17.4 (River Towns), 19.6 (Six Fronts, a bit over the 18 target on the biggest
  map). Faction wins USA/GER/USSR 32/33/25: USSR slightly weak (Conscripts now need a Barracks).
- Slices: 1 tracer · 2 production · 3 Sudden Death, elimination, Ghosts, ally support · 4 abilities cost Munitions
  · 5 adaptive AI: all built. Deferred: editor Node tool, hand-made Classic maps, AI difficulty levels (the lever would be
  aiAttackRatio plus a reaction delay).

## New units (2026-09-30, all modes)
- Mortar team (180 MP): one arcing shell every 8s at up to 50 m (min 12) on anything its side can see, no line of sight
  needed (the rocket truck's salvo with one shell). Mortar Barrage: 4 shells on a spot (Classic: 15 Munitions).
- Sniper (160 MP): shooter + spotter, 55 m, one shot kills one soldier (25 damage) every 5s, must stand still. Camouflage:
  after 3s still and 4s without firing it is only seen within 12 m (or by a recon flight). The server decides, so it is
  fog-fair; the owner sees a HIDDEN tag.
- Armored car (220 MP): fastest unit (9 m/s), 170 hp, light gun + MG that fire on the move, weak vs tanks. No transport.
- Medium tank (380 MP): 600 hp, 80 anti-tank damage, the mainline tank between the light tank and the Tiger.
- Balance pass (2026-10-01), after a player won by massing rocket trucks: rocket damage to vehicles 30 -> 12, armored
  car damage to vehicles 6 -> 14, MG damage to infantry 2.4 -> 4. Equal-cost duels on open ground showed the truck
  beat every light vehicle and the armored car could not hurt it (2.4 damage a second against 160 hp); now the car
  beats the truck (+78) and still loses to tanks (-73). No cap on trucks (decided). Reload, suppression and infantry
  damage of the rocket made no measurable difference to a mass of trucks, so they stay. 60 AI matches: faction wins
  24/19/17 -> 20/17/23, length and closeness unchanged. Open: halftracks and mobile flak beat basic infantry at equal
  cost; MG teams still lose to conscripts in the open.
- Second round (same day): the rocket launcher is area artillery (`w.area`): no automatic fire at units, only the
  barrage (clicked spot, or autocast on 3+ in a blast area or a dug-in enemy) or an explicit attack order. Barrage
  cooldown 45 -> 20 s and free in Classic (`ab.mun: 0`, so autocast defaults on there), speed 5 -> 3.5. Rifles do 1.5
  to vehicles (was 0.4), conscripts 1.1 (was 0.3): infantry beats light vehicles at equal cost and still loses to
  tanks. Nine trucks against equal-cost rifles went from 63%/0% army left to 12%/5%. AI faction wins moved within
  noise (150 matches 46/53/51 -> 57/52/41, 60 matches 15/24/21 -> 19/13/28, opposite swings).
- Looks per faction: Sherman / Panzer IV / T-34, M8 Greyhound / Sd.Kfz. 222 / BA-64.
- AI: a mortar against dug-in MGs and AT guns (or once its army is 6+), a sniper against 6+ infantry seen, an armored car
  once the army is 7+ (it leads depot raids), medium tanks when affordable. It falls back to infantry when it can't make
  what it wants (before, it saved for an unaffordable unit forever).
- Fix: catch-up raised to +6 MP/s, 1 per 60 VP behind: closeness 0.66 (default) / 0.63 (River Towns), lead changes
  1.58, 9.6 min, factions 33/31/26. Locking mortar and armored car for 4 minutes made it worse (0.49).
- Conquest balance (150 AI matches, default map): 2nd place VP / winner 0.62 -> 0.54, lead changes 1.57 -> 1.17, length
  9.5 -> 8.5 min, faction wins 45/63/42 -> 44/59/47. Taking out either the mortar or the armored car alone puts closeness
  back at 0.63 but USSR wins collapse (9 of 60). Weaker versions of both (mortar every 8s for 24, armored car 170 hp)
  didn't change closeness (0.53) and gave the most even factions so far (30/29/31 of 90). Kept the weaker versions.
  Open question: the side that's ahead gets the mortar and armored car first, so games are more one-sided.
- Classic balance with Fuel and the new units (30 per map): 74% decided before Sudden Death (23/25/19 of 30), median 15.9
  (default), 18.1 (River Towns), 23.2 min (Six Fronts, long), faction wins 24/33/31 with 2 draws.

### Second unit wave (2026-10-02, all modes)
- Tank destroyer (320 MP, Motor Pool; Classic 220 MP + 80 Fuel): M10 / StuG III / SU-85. 380 hp, 46 m gun doing 120 to
  vehicles (0.8 hit), 12 to infantry (0.35), fires on the move at half accuracy, AP Round, no smoke. Picks vehicles
  first like the AT gun (`roleMul` x3). Fills the gap between the towed AT gun (slow, sets up) and tanks.
- Field howitzer (300 MP, Motor Pool, Classic 30 s): M2A1 / leFH 18 / M-30, four crew. Mortar rules scaled up: one
  shell every 12 s at 30-95 m, 4 s setup, blast 4.5, 35/40 damage, garrisons x1.5. Howitzer Barrage: 4 shells
  (Classic 25 Munitions). Counts as a crew for snipers.
  Scatter grows with range (`w.spreadFar`, decided 2026-10-02): shells land within 3 m of the aim at 30 m and within
  8 m at 95 m, as real howitzers were not that accurate. Against a squad standing in the open, a shell does about
  27 on average close in, 16 at 62 m and 7 at 95 m (it lands within blast reach 100% / 67% / 32% of the time). This
  keeps massed howitzers at long range from deleting whatever their spotters see; to hit hard they must come closer.
- Area fire (decided 2026-10-02): the `fireat` order takes any ground cell for salvo weapons (mortar, howitzer,
  rocket truck, destroyer, bomber), seen or not; direct-fire guns still need a structure. A gun walks into range and
  keeps shelling until another order (`fireAt` never clears on open ground, so a Shift-queued order behind it waits
  forever: give a new order instead). A bomber gets an `area` mission: it circles the spot at 10 m and drops each
  stick there, then flies home when out of bombs. Client: Shift+B or the Shell area button, shown when a salvo unit
  is selected. Blind fire is allowed on purpose: shelling a suspected position is what artillery does.
- Flamethrower squad (180 MP, Barracks): three men, 14 m, 9 damage a shot to infantry. `w.flame`: cover, walls,
  trenches and houses give no protection from it, and a garrison or a trench takes x1.5. Pins hard (30 a shot).
- Bomber (420 MP, Airfield; Classic 300 MP + 100 Fuel): B-25 / He 111 / Pe-2. 420 hp, speed 12, two sticks a sortie,
  each a 4-bomb salvo (blast 5, 45/80 damage, terrain 250) on its attack target or a crowd it finds.
- AI: tank destroyer for every other anti-tank buy once it has an AT gun, flamers against garrisons (after the
  rocket truck), a howitzer once its army is 8+, a bomber once it has an attacker and 9+ units. Horde unlocks
  flamers at wave 6 and tank destroyers at wave 8.
- Each has its own model (M10 / StuG III / SU-85, M2A1 / leFH 18 / M-30, a flamethrower man with his tanks and two
  riflemen; the bombers already had theirs). The StuG and the SU-85 are casemates: only the gun turns, 12 degrees
  either way of the hull, and the sim does not swing the hull to face the target. Each has its own map icon and unit badge too: a low
  casemate with a long gun, a steeply raised barrel on a wheel and trail, a soldier with tanks on his back and a
  flame at his hip, a twin-engine plane with a twin tail. The flame is drawn as a fat slow tracer.
- 60 AI matches (Conquest, default map): faction wins 19/22/19 (32/37/32%). 6 AI matches per mode: all four units
  get fielded and fire; the bomber scored no kills in that small sample (its stick lands where the target was).

## Aviation (2026-10-01, all modes)
- Off-map air support adds Dive Bomber, Paratroopers and Fighter Cover (point supports, one click). Support planes
  (recon, strafe, bombing, dive, paratroopers) can be shot down on arrival: fighter cover always (and is used up; never
  recon), each flak in range rolls its chance (flak gun / mobile flak 35%, emplacement 45%).
- Paratroopers (2026-10-02): a stick of two rifle squads and an MG team (`SUPPORT.para.units`), landing 6 m apart
  around the spot. The call needs army room for the whole stick (`dropPop`) and reserves it while the plane flies.
  One rifle squad for 260 MP was 2.6x its own price, so nobody called it.
- Commandable planes fly sorties (not hovering units): base -> out -> on station (50s fuel, or ammo for the
  ground-attack plane) -> home -> rearm 30s. One altitude, no collisions, no terrain. Base = the nearest own Airfield
  in Classic, else an off-map airbase 40 m out past the HQ. No air cap (the user asked for strong counters instead):
  anti-air is continuous damage per second (flak 25, mobile flak 25, emplacement 40, fighter 30, MG 5) and planes count
  toward pop. Ground weapons can't target planes; blasts and strafing runs don't reach them.
- Visibility: an airborne plane is visible to anyone within 60 m with no line of sight; planes see 40 m below; planes at
  base are invisible and untouchable.
- Kill bounty (all modes): 20% of the dead unit's cost to the enemy who landed the last hit. It nudges games toward
  the winner of fights (Conquest closeness 0.66 -> 0.63, River Towns 0.63 -> 0.57) but adds lead changes.
- Classic pop cap 24: the bounty made leaders bank MP at 20.

## Army size (lobby setting)
- Standard / Large / Massive: unit limit x1 / x2.5 / x5 and every income x1 / x3 / x6 (`CFG.armies`). Income has to grow
  more than the limit, or armies never fill it (Massive at 3.5x income: 98 units with 6 AIs; at 6x: ~240 Conquest,
  ~270 Classic). The server cost stays well inside the 50 ms tick budget at that size (avg under 8 ms, worst 24 ms).
  Browser cost at 250+ units hasn't been measured on the friends' PCs.
- Endless: Massive's unit limit (x5) with income x20, for players who want the cap full all match. Money stops being a
  constraint, so it is a sandbox setting, not a balanced one (no AI runs behind it).

## Weather (lobby setting, 2026-10-01, all modes)
- One state at a time, the same for every side. Clear: no effect. Ground fog: sight -30%. Snow: sight -10%,
  infantry -10%, vehicles -15%. Planes, recon flights and the units' own stats are untouched: `shared/weather.js`
  gives the sim two multipliers, `sightMul` (vision, for ground units and buildings, through `visionOf` and so
  `visionRange`, which the fog masks share) and `weatherSpeed` (movement: infantry and vehicles as a whole), read in
  one place each in sim.js.
- Rain is the living ground's rain (`weather()` in sim.js, `CFG.weather`) held on all match, on ground soaked from the
  start: sight -20%, vehicles -20% off roads (-40% on ground below level 0), fords up to 30% slower, three times the
  traffic wear, smoke thinning faster and fires going out. Its numbers in `WEATHER.rain` only describe it to players and
  the AI (`rains: true` keeps them out of the two multipliers); test.js keeps them equal to `CFG.weather`. When Random's
  rain turns to mud the rain stops at once and the ground stays soaked.
- Mud is the living ground's soaked ground held all match (`wx.wet` at 1): vehicles -20% off roads (-40% below level
  0), fords slower, three times the traffic wear (so driven ground turns to mud cells sooner), no dust. Infantry -10%
  is Mud's own, since the living ground never slows infantry for wet ground. On the map's mud cells (`M`) Mud adds
  nothing the soaked ground has not: the ground is slowed once (test.js checks it). Showers still come in Mud and cut
  sight while they last, but cannot soak it further.
- Showers (the living ground's, 1.5 to 3 minutes, 4 to 8 apart, the first after 3 minutes) still come and go in Clear,
  Fog and Mud, so Clear is the living-ground game as it was: a seeded bench run (`tools/bench.mjs`, 9000 ticks, both
  scenarios) gives the same final-state hash as master. Snow never rains.
- Roads: the sim's roads are its ROAD cells (`D` roads and `=` bridges, from the living-ground terrain). The wet ground
  of Rain and Mud leaves them alone; snow slows vehicles everywhere. `roadMask` only places the look: mud and puddles
  gather along the roads, bridges and the village streets `client/ground.js` paints (open ground next to a house,
  unless it lies by water).
- Lobby: the host picks Map default / Clear / Fog / Rain / Mud / Snow / Random (`room.weather`, message `weather`).
  Map default reads a `weather` field in the map file, else the map's mood: snowy maps (Ardennes) snow, misty river
  dawns (Pegasus, Polder, River Towns) start in ground fog that lifts at 4:00, every other map is clear. A host's pick
  holds all match. Random is seeded per match: any state, and half the time fog lifts at 3:30 to 4:30 or rain turns
  to mud at 5:00 to 7:00. At most one change per match, announced to everyone 10 seconds before in every snapshot
  (`weather: [now, next, seconds]`).
- Screen: one line under the score strip in plain words ("Rain: sight -20%, vehicles -20% off roads"), brass while
  it is about to change. In Clear, Fog and Mud it also tells of a passing shower or of wet ground, in the living
  ground's own words (that line used to be a separate panel). `client/atmosphere.js` eases the haze, fog color, sun
  and shadows over a few seconds, and adds fog banks, rain streaks, falling snow, wet ground with puddle sheen, mud
  along the streets and snow cover (one ground layer shader). A shower moves the look toward rain's as hard as it
  rains and wets the ground as much as the server says (`setRain(rain, wet)` from `snapshot.wx`). Rain, snow and dust
  fall on the server's wind, each fall keeping the slant it started with. Rain and snow stay on Graphics Low with a
  third of the drops. The light mood is fixed per match: snow brings the winter light, rain and mud an overcast sky,
  fog and clear keep the map's mood.
- AI: `aiCaution` (1 in clear weather, 1.12 in mud, 1.2 in snow, 1.4 in rain, 1.43 in fog) raises the army margin and
  size it wants before marching on a Classic base or an Assault bunker (6 units in clear weather, 9 in fog), since it
  has seen less of the enemy and its tanks arrive late. Conquest point attacks keep groups of 3: scaling those to 4 made Conquest one-sided (2nd place VP
  0.26 of the winner's and 6.3 min matches with Clear stats; 0.34 to 0.37 and 7 min in fog, rain and snow).
- Balance, measured before the living ground was merged (Rain was then its own rule at sight -15%, village streets
  counted as roads, and there were no showers) (default map, 3 AIs, factions USA/GER/USSR by slot, spawns shuffled;
  leader changes checked every 10 s):
  | Weather | Conquest (40 each): 2nd place VP vs winner, leader changes, length, faction wins | Classic (20 each): length, decided before Sudden Death, winner's HQ health left, faction wins |
  |---|---|---|
  | Clear | 0.59, 1.88, 9.2 min, 6/20/14 | 19.7 min, 17/20, 88%, 6/7/6 and 1 draw |
  | Fog | 0.63, 1.93, 9.6 min, 14/15/11 | 19.9 min, 14/20, 76%, 6/8/6 |
  | Rain | 0.62, 2.05, 9.3 min, 16/16/8 | 20.0 min, 16/20, 85%, 6/9/4 and 1 draw |
  | Snow | 0.62, 1.80, 9.1 min, 15/13/12 | 19.2 min, 15/20, 76%, 9/5/6 |
  No weather comes out one-sided: closeness and length stay within the noise of Clear. A faction's win count at 40
  matches spreads about 3 either way by chance alone; a second Clear run (review) gave 15/14/11 where the first gave 6/20/14.
- Mud (review, same harness, 40 Conquest matches): 2nd place VP 0.60 of the winner, 1.60 leader changes, 9.0 min, faction
  wins 14/16/10; the Clear run beside it gave 0.57, 1.75, 9.0 min, 15/14/11. Classic, 24 matches each: Mud 19.9 min with
  7 reaching Sudden Death (the run was cut at 26 min), Clear 17.7 min with 2. Slower armies make Classic last longer;
  the AI's caution is not the cause: Mud with it off gave 18.7 min and the same 7 of 24. Fog with the caution on or off,
  24 matches each: 19.6 against 18.0 min, 4 against 3 reaching Sudden Death, so the caution costs a little time and no
  balance. If Mud Classic should end sooner, speed up the AI's attack or shorten Mud, not the caution.
- Balance after merging the living ground (same harness, default map, its roads now real, 40 Conquest matches each):
  | Weather | 2nd place VP vs winner | leader changes | length | faction wins USA/GER/USSR |
  |---|---|---|---|---|
  | Clear | 0.47 | 1.38 | 8.7 min | 15/13/12 |
  | Rain | 0.47 | 1.65 | 8.8 min | 9/17/14 |
  | Mud | 0.53 | 1.77 | 9.2 min | 16/7/17 |
  | Snow | 0.55 | 1.43 | 9.0 min | 14/16/10 |
  Clear's two halves gave 0.30 and 0.63 (master's own Clear, 20 matches: 0.57, 9.3 min), so 0.1 either way is noise
  here. Germany's 7 of 40 in Mud is about two standard deviations under an even split; run it again before tuning.
  Classic was not re-measured after the merge.
- Clear is the game as it was before weather: only Random draws a random number (the seed), so a seeded bench run
  gives the same final-state hash with and without this change in Clear weather. (Checked before the living ground
  was merged; the merge keeps every Clear, Fog and Mud shower roll where the living ground put it.)

## Infantry model refinement (2026-10-01)

- Adopted the useful draft face relief, chin and eye shading, shaped hands, folded pilotka, and stride/brace/standing
  rifle variants. Wider webbing, belt buckles, larger pouches and bags, helmet chin straps, and a six-sided greatcoat
  roll distinguish faction kit. Eight torso columns pay for this detail within the 900-triangle near budget.
- Dedicated prone morphs remain the pose source. Aiming bodies lie at an angle to their weapons with the fore-hand
  closer to the receiver and elbows near the ground. Crew feeders lean toward the belt when kneeling; prone legs
  extend behind the hips with slight splay. Suppression thresholds and game rules are unchanged.
- Far figures use an extra head ring and helmet crown ring. Owner tint stays on the upper left arm and is subdued
  so a white owner color does not resemble bare sleeves. Maximums across all infantry kits and factions: 884 near,
  145 far triangles, one mesh and draw per soldier. Medic teams retain their two engineer-based figures and poses.
  Dedicated medic kit is left for later: the existing alias still shows a carbine on an unarmed medic.
- Checked reference sheets and viewer standing, prone crew, and far conscript views, including the game-distance
  cell. Shared shadow-side lighting is handled separately; infantry still use the existing soldier material.

## Look and feel (decided 2026-10-01)
Art direction: a grounded military RTS. The sand-table framing was dropped on 2026-10-01 at the user's request.
The world target is `docs/concepts/f-grounded.jpg`: natural muted ground, present shadows and land continuing beyond
the playable map. The HUD target remains `docs/concepts/g-hud-gunmetal.jpg`, and models stay procedural.
Richer procedural models are built with the toolkit in `client/models/geom.js` (rounded and chamfered boxes,
lofted hulls, lathed barrels and helmets, wheels, tracks, tubes, painted markings, baked vertex shading). Each model
still merges into one vertex-colored mesh on the shared paint material, so detail costs vertices, not draw calls.
- Model textures (`client/model-textures.js`): units are textured so they read as weathered real equipment, not
  painted toys. Twelve seamless layers generated with gpt-image-2 (`client/textures/models/`, 512 px: painted armor,
  cast armor, gunmetal, track steel, rubber, wood, canvas, wool, leather, aluminum, aircraft paint, mud) sit in one
  texture array. The shared materials (PAINT, VEHICLE_PAINT, the plane body and blades) sample each fragment's layer with triplanar
  mapping in the model's own space (after the posture morphs, so nothing swims on a turning turret or a prone
  soldier). The texture's light and dark scale the vertex color, so faction paint, markings and the owner color keep
  their hue; paint is faded a little and mottled with broad blotches, and some layers (track steel, wood, leather)
  bring part of their own color. Grime is baked per vertex at merge time by height: a dust film everywhere and dried
  mud clumps on lower hulls, wheels, tracks and boots (none on planes). No extra draw calls; on Low, and until the
  textures load, the shader compiles without any of it. Tuning per layer (texels per metre, strength, hue, fade, and
  film: how much grime it holds) is in `LAYERS` at the top of the module. Grime is greyed and never much brighter than
  the part under it, so dark tracks, tires and gunmetal stay dark instead of turning into an orange band.
- Vehicle shade (2026-10-01): Neutral tone mapping subtracts most neutral light at low brightness and leaves the
  blue sky tint on dark grey paint. Vehicle meshes use their own shared Lambert material with a textured-albedo
  bounce fill, strongest away from the sun. The world light and soldier/gun materials stay as before. The fill adds
  no draws or texture samples. German and Soviet light-tank paints are warm grey and olive; the Sd.Kfz. 222's dark
  paint shades are warm grey. Stuart sponsons add a lower rivet row, T-70 sides have weld seams, Tiger wheels have
  wider rubber rims and distinct inner/outer depth, and ZSU shields sit below the barrel with a visible breech,
  recoil rail and case tray. Counts (hull + turret): Stuart 2,976/3,000, Panzer II 2,974/3,000, T-70 2,818/3,000,
  Tiger 4,907/5,000, ZSU-37 2,954/3,000. All armor models remain two draws; tests check budgets, normals and muzzle
  points. Panzer IV before/after viewer captures on the Apple M3 Max confirm readable rear plates at 3,908 tris.
- Tagging what a part is made of: `part(geo, paint, sx, sy, sz, x, y, z, mat)` in `client/unit-models.js`,
  `{ geo, color, matrix, mat }` items in `geom.merge()`, or `tag(geo, mat)`. `mat` is a name from `MATS` in
  `client/models/geom.js` or `'plain'` (no texture: faces, glass, the soldier's base). A shape's own tags win over the
  item's `mat`, so a wheel keeps its rubber tire (`wheel()` and `track()` tag their tires and links). Untagged parts
  take the model's default from `LOOKS` (painted armor on vehicles and guns, wool on soldiers, aircraft paint on
  planes); near-black colorless paint becomes gunmetal. A mesh drawn with PAINT without going through `mergeParts`
  gets the default material and no grime: put its geometry in `part(geo, 0xffffff)` and bake it instead.
- German splinter paint on the Ju 87, He 111 and Ju 52 uses weighted, jittered Voronoi cells with an oblong raked
  layout. The varied seeds make angular patches uneven in size; the shader scale is 0.7 on the Stuka and He 111, and
  0.8 on the corrugated Ju 52. The aircraft check counts every propeller blade and blur disc against the 3,500
  triangle fighter and attacker budgets: Ju 87 3,494, P-47 3,409.

The HUD's paperwork style (manila cards, typewriter text, stencil numbers, grease-pencil map symbols) was dropped on
2026-10-01 because it read as a board game. The HUD is now a modern PC military RTS interface: gunmetal panels, one
condensed sans, unit portraits and silhouette icons. Target: `docs/concepts/g-hud-gunmetal.jpg` (its coin icons by the
costs were left out). Reference games for density and restraint: Company of Heroes 3, Men of War II, Steel Division 2.
Rules from the user: it must not look like a mobile game, so no chunky rounded buttons or pills, glossy bevels,
gradients or inner glows, outlined or shadowed text and icons, cartoon or saturated colors, ornate or rarity-colored
card frames, coin or gem currency icons, red notification dots, oversized tap-sized targets, bouncy or pop-in motion
or big celebratory banners. Corners 0 to 2 px, 1 px hairlines, 13 to 15 px body text, real hover and keyboard focus.
- Screens: designed at 1920x1080, must fit 1366x768 without overlap. No phone layout. 60 fps target on laptop graphics.
- Graphics setting (menu): High / Low, saved per browser. Low uses cheaper shadows and fewer
  particles. Defaults to High; switches itself to Low with a one-line notice if the game runs under 45 fps for 5 s.
- World:
  - Ground painted from tileable textures (grass, dirt, mud, road, field) generated with gpt-image-2 and blended per
    cell; contour lines stay. Craters and scorch marks are painted into the ground.
  - Natural muted colors, warm afternoon sun, sky fill, soft shadows and distance haze. No tilt-shift blur.
  - Beyond the map edge: continuous ground and water. The apron follows relief, cliffs and craters at the boundary;
    its first 14 m ease to 20% darker and 25% greyer ground to mark the playable area without a hard line.
  - Unit markers: the badge left of each unit's health bar is the unit's silhouette from the HUD's icon set, drawn
    in the owner's color on a small gunmetal plate edged in that color. Health bar, cover shield and veterancy stay.
  - Order lines and range rings drawn with slightly rough strokes on the ground (slightly rough strokes, arrowheads on routes).
    Colors keep their meaning: blue move, orange attack-move, white retreat, red attack, yellow dig/build.
- Player colors (they carry meaning, so the HUD redesign kept them; they read on grass and on the gunmetal panels):
  blue `#3b73d6`, red `#cc3a2e`, chalk `#ece6d6`, orange `#e2832b`, violet `#9b5cd4`, cyan `#35b6c0`. A 1v1 is blue
  against red. Gold and green are gone: gold clashed with the brass accent, green vanished on grass.
- HUD panels (2026-10-01, replacing panel style "E"): translucent gunmetal `rgba(25, 28, 30, 0.86)` with a 1 px warm
  khaki hairline `rgba(176, 164, 122, 0.46)` and 2 px corners, no shadows, glows or blur. The top panels (scores,
  resources, buttons) are near solid (0.96) so world labels never read through. Cards, buttons and list cells sit a
  step lighter (`#24282b`) with a fainter hairline; hover lifts the cell (`#2e3337`) and lights its hairline brass,
  keyboard focus is a 1 px brass outline. The minimap sits in a plain frame (a 4 px gunmetal band and a hairline).
- Palette (restrained: neutrals plus one accent): text `#e2dfd3`, secondary text `#a6a292` (warm, tinted toward the
  khaki lines), brass `#d6b25e` only on the numbers that matter (manpower, victory points, the clock) and the lobby's
  Start button, olive `#a9b37b` for income and cover, signal red `#c8483b` (text `#ee8a7b`) for danger. Costs are plain
  numbers with a dim "MP"; resources are plain numbers with a small silhouette icon (helmet, cartridge, jerrycan).
- Type: Barlow Semi Condensed (Google Fonts, 400 to 700) for every word and number, tabular figures on. A straight-
  sided, DIN-like grotesk in the family of road-sign and equipment lettering, which suits the subject; of the five
  condensed faces tried (Sofia Sans Semi Condensed, Barlow Semi Condensed, Mona Sans, Archivo, Fira Sans Condensed)
  its numerals read clearest at 13 to 14 px and its width fits fourteen recruit cards at 1920. Weights: 500 body, 600
  names and numbers. Sentence case, no all-caps labels, nothing under 13 px. Courier Prime and Stardos Stencil are gone.
- Icons (`client/symbols.js`): one set of flat, filled silhouettes in a 100 box, single color, for unit types (side
  view facing right on a common baseline, planes from above), buildings, support calls, orders and the few UI glyphs.
  The HUD draws them in the text color; world badges draw them in the owner's color. They replace the NATO map
  symbols and the line icons. Full name and role stay in each tooltip. Faction markings next to player names in the
  score panel: US star, German cross, Soviet star.
- Portraits (`client/portraits.js`): recruit cards, train and build cards and the selection list show a small render
  of each unit's real 3D model, made from the same builders the battlefield uses (main.js hands them in), once per type
  and look (faction and player color), so they follow the models as those improve. A small renderer of its own
  starts 1.2 s after the match starts and renders one portrait per frame; colors are pulled 20% toward grey so the
  renders sit quietly on the panels. Until a portrait is ready its slot shows the silhouette icon.
- Layout: score and clock top center; MP / Munitions / Fuel, income and pop top right with the support calls as an icon
  row under them; bottom left the selection list and its orders (icon grid with hotkeys); bottom center the Command
  Card (always-visible recruit row outside Classic, grouped Infantry / Support weapons / Vehicles; train and build in
  Classic); bottom right the minimap. Nothing overlaps at 1366x768. The always-on keybinding panel is parked
  (issue #2); hotkeys show on buttons.
- On states share one look: a brass hairline over a faint brass tint (Capture mouse pressed, the Recruit tab on, an
  ability with autocast on, which also shows a small A). While recruit letters are live the Command Card's hairline
  turns brass; each card's letter sits at the left end of its cost line, clear of the name and the portrait. The
  Command Card's group names lead with a small silhouette (rifleman, MG team, tank, fighter).
- Lobby backdrop (`client/lobby-view.js`): behind the form, the selected map's real battlefield (the match's ground,
  relief, houses, water and trees) seen from above at about 50 degrees, the camera gliding slowly over the middle of
  the map on two unsynchronized sweeps (140 s and 95 s) without turning or changing height. It renders at half
  resolution on its own small renderer, shows at half strength over the dark ground, follows the Map select, and is
  freed when a match starts. It is built in steps in idle time; Graphics Low skips it; software rendering
  (SwiftShader) and reduced motion get one still frame.
- Lobby: the room form on one gunmetal panel in the HUD's style; Start is the one brass button. The match report,
  tooltips, banners, alerts and the end-of-match notice (a quiet panel, no stamp) share the panel and type. The map
  editor takes the same panel, type and colors.
- Alerts (see CONTEXT.md): under attack (units, a point, the HQ or a bunker; once per 20 s per area), point captured /
  lost, unit lost, enemy Air Support incoming, unit ready and building finished (Classic). One line each in a short list
  above the minimap (newest on top, gone after ~6 s), a minimap ping and a short sound. Space jumps to the newest alert
  while one is showing, otherwise it focuses the selection as before. No kill feed, no damage numbers.
- Combat effects: muzzle flashes, glowing tracers, particle explosions with dust and debris, lasting scorch marks, fire
  on wrecks, better smoke. A very small screen shake on big nearby blasts, off on Low.
- Audio (ElevenLabs, generated 2026-10-01; raw takes and manifests in `~/.local/share/ww2-rts/audio-raw/2026-10-01/`):
  35 sound effects (`eleven_text_to_sound_v2`, four takes each, best take picked by onset, clipping and loudness) and
  voice lines in Eleven v4 for each faction in its own language, two voices per faction, 12 lines each (move, attack,
  retreat, under fire, unit lost), two takes per line, directed with v4 audio tags. They replace the browser's speech
  synthesis. One volume control covers effects, voices and alerts (mute used to silence only the voices). No music.
- Slices, each its own commit with its changelog entry: 1 HUD (layout, panels, colors, type, symbols, and the bugs
  below), 2 alerts, 3 world (ground, light, table edge, graphics setting), 4 combat effects, 5 audio.
- Bugs found while looking (fixed in slice 1): at 1600x900 the orders panel covers the recruit bar; Classic's
  "MP · Mun · Fuel" readout wraps to two lines; the lobby form spills past its card; the orders panel's HTML is rebuilt
  on every snapshot (10 Hz), which can eat clicks; mute only silences the voices.
- As built, slice 1 (HUD): `client/hud.js` draws every panel; main.js hands it state and actions once (`createHud`).
  The support calls are two rows of four (aviation added Dive Bomber, Paratroopers and Fighter Cover), with the plane
  list (`#airPanel`) under them. The Command Card has a fourth group, Aircraft. The lobby kept the two-column layout
  from the aviation work (map preview, army size), restyled as the manila card. Hotkeys: only T digs by key, since
  Y, U, I and O went to the air calls and air buildings; the other forts are on the orders panel.
- As built, slice 2 (alerts): `client/alerts.js` and `client/alerts.css`, worked out client-side from two snapshots in
  a row. "Enemy Air Support incoming" covers the aviation calls too (dive bomber, paratroopers) but not fighter cover;
  your planes count as units for "under attack" and "lost".
- As built, slice 3 (world): `client/light.js` (sun, sky fill, haze, the table and board edge, the far-edge blur and
  the Graphics High / Low button), `client/ground.js` (the painted ground canvas, repainted in tiles when cells
  change), `client/surfaces.js` (textured structure materials) and `client/markers.js` (rings, badges, order lines,
  capture points, tags). Player colors are blue, red, chalk, orange, violet and cyan. The aviation types got map
  symbols in `client/symbols.js` (plane, dome over armor, installation bar), since the 3D badges now use the same
  symbols as the HUD and the old pictograms for flak and planes went away.
- As built, slice 4 (effects): `client/fx.js` (`createEffects`) reads each snapshot's shots, strikes and smokes and
  draws everything from one instanced billboard mesh, one scorch decal mesh and a pool of plane models. main.js only
  calls `effects.snapshot`, `effects.update`, `effects.wreck` and `effects.downPlane`. The aviation effects that lived
  in main.js (support planes, flak puffs, planes falling) moved into fx.js: flak and fighters firing at planes draw
  tracers into the sky (`aa`), a flak gun firing at a passing support plane makes airbursts around that plane,
  `shotdown` and `planedown` send the plane into a burning fall. Flak firing at ground units is ordinary direct fire.
  The paratroop canopies (`chutes`) stay in main.js. Particle and decal counts drop on Graphics Low.
- As built, slice 5 (audio): `client/audio.js` loads `client/audio/index.json` and the mp3s under `client/audio/sfx`
  and `client/audio/voice/{us,de,ru}`, mixes them on sfx, voice and ui buses under one volume (`ww2-volume`, M
  toggles mute), and places each sound by distance and pan from the camera. `client/fx.js` owns every effect sound
  and plays it when the effect shows (whistles timed to the landing, one sound per MG or SMG burst, fire loops on
  wrecks). `client/battle-sound.js` only moves the listener with the camera, drives the tank engine bed from moving
  vehicles and plays dig and build foley. The Volume slider sits in the in-game menu and replaces the old mute
  button. `tools/build-audio.mjs` rebuilds the mp3s and index from the raw takes (needs ffmpeg).
- As built, round 2 (props): `client/props.js` (`createProps({ map, grid, hAt, parent })`) places scenery
  from integer hash seeds, so every browser and late joiner sees the same trees, poplar rows, pines, bushes, meadow
  grass, standing wheat (about half the ploughed fields from `fieldCells` in `client/ground.js`), rocks, fences,
  haystacks and crates. One InstancedMesh per kind (trees two: bark and leaves), kept clear of spawns, points, the paths
  between points and resource nodes (`setNodes`); `refresh()` after terrain changes. Graphics Low shows half of them,
  keeps crop fields whole, drops the grass and turns off tree and bush shadows.
- Realistic scenery (October 2026): everything at real size, as in the Company of Heroes 3 reference
  (`/tmp/ww2-hud/world-target.png` at the time). `client/foliage.js` builds broadleaf trees about 12.5 m tall with
  9 to 10 m crowns, spruces about 14 m, Lombardy poplars about 17 m, bushes about 1.5 m, hedgerow stretches, grass
  tufts and wheat. Trunks and limbs are tapered bark tubes; crowns are clumps of alpha-tested leaf cards cut from one
  atlas (`client/textures/foliage.webp`, generated with gpt-image-2), each card lit with its crown's normal so a crown
  shades as one mass. The alpha is raised with the mip level so distant crowns stay full, and fog of war darkens
  foliage instead of greying it. Per instance: heading, height, girth and shade of green. Houses: two in five
  farmhouses and every church are fieldstone, the rest limewashed render with stone quoins on outside corners; flat
  clay-tile roofs; windows with a shadowed reveal, a frame proud of the wall, sky in the glass and plank shutters;
  stone door jambs; clay chimney pots. Base buildings keep one merged mesh and one material: each part carries a
  surface id in `uv.x` that picks canvas, timber or concrete grain from one packed detail texture
  (`client/textures/detail.jpg`), and corrugated sheet gets ridges that fade out before they could shimmer. Mobile-game
  tells are out: no saturated greens, no fat trunks or puffy round crowns, no oversized props.
- As built, round 2 (water): `client/water.js` (`createWater(grid, map)`) is one see-through mesh over river, ford and
  bridge cells, painted from a mask texture (shoreline, depth guess, fords, bridges) with a per-vertex flow
  direction. It draws first in the see-through pass and writes no depth, so fog of war, smoke and effects draw over
  it. `changed(cells)` rebuilds it after a bridge or bank change, `tick(now)` animates it, Graphics Low freezes it.
- As built, round 2 (aviation visuals): `client/aircraft.js` (`createAviation`) builds each faction's fighter,
  ground-attack plane and bomber as one merged vertex-colored mesh plus propellers, and draws plane units (bank,
  shadow, damage smoke), the Classic airfield, support planes crossing the map, flak bursts and shoot-downs. main.js
  sends it the air shots (`strafe`, `recon`, `bombing`, `dive`, `para`, `shotdown`, `planedown`, `flak` at a support
  plane, `aa`) and keeps those shots and the support planes' strike warnings out of `effects.snapshot`, so `client/fx.js`
  draws only the ground war plus the anti-air tracers (`effects.aaFire`). Paratroop canopies stay in main.js. Crashes
  and strafing hits use `effects.explode`, and every air sound plays through `client/audio.js`.

## Rooms, controls and match flow (round 3, 2026-10-01)
- Pause: the host can pause and resume at any time. A human who drops mid-match auto-pauses the game for up to 30 s,
  at most once per player per match (reset in startMatch). While paused, sim, AI and commands are off, and a filtered
  snapshot plus the pause message go out about once a second.
- Host and seats: the host is the first connected human, falling back to the first human. A lobby disconnect frees the
  seat after 10 s, and offline humans lose their seats when a match returns to the lobby. Tokens are per room plus an
  optional seat suffix, and a start with a matching matchId is a resume.
- Spectators (2026-10-01): `room.spectators`, up to 8, beside the seats. A hello with `spectate: true`, a full room or a
  running match makes you one; `spectate` and `sit` switch in the lobby. They get seat 0's start and snapshots through a
  projection (`watchGame` in server.js: reveal on, every unit visible, no fog mask, a terrain memory of their own), so
  the real seat 0 keeps its own fog and memory. Every command from a spectator is dropped except the host's lobby and
  match controls; the host is the first connected human seat, else the first connected spectator (all-AI rooms). A
  spectator's disconnect frees them at once and never pauses.
- Fort keys are a Shift layer: T trench, Shift+Y sandbags, Shift+U wire, Shift+I traps, Shift+O nest. Plain Y/U/I/O
  keep the Classic build and support actions. `client/keys.js` is the single binding table and test.js rejects
  duplicate chords.
- Recruit by letter (2026-10-01): outside Classic, Tab or Backquote toggles recruit mode. The Command Card cards take
  Q W E R T / A S D F G / Z X C V B in reading order, a letter buys exactly like a click (same availability check and
  refusal reason), and Shift+letter buys five or as many as MP, Fuel, the army limit and the type limit allow
  (`buyCount` in `client/availability.js`). The server still gets one 'buy' per unit. The mode lasts until Tab,
  Backquote, Esc or a right-click, and a new match starts with it off. A letter that has a card buys, so while the mode
  is on WASD, Q/E, the orders on those keys (X stop, R retreat, F ability, G attack-move, T trench) and the support calls
  on Z C V B are suspended, and their badges hide so the screen never shows one letter doing two things. The arrows still
  pan, Ctrl+A, N/U/P/I and the Shift fort keys still work. A letter with no card under it keeps its usual action,
  camera keys included (Conquest has 14 cards for 15 letters, so B still aims smoke). In Classic, a selected production
  building's train cards answer to the same letters without a mode ('building' context, Shift buys five up to that
  building's queue room): an HQ takes Q and W, so A S D E still pan and rotate. Classic Tab only explains this.
  Keys.js contexts are ranked (targeting 2, recruit and building 1, the rest 0): the highest rank wins, and test.js
  allows a repeated chord only across different ranks. Tab is preventDefaulted only in a match with the menu closed, so
  it still moves focus in the lobby and menus. The client's queue check follows the building a card belongs to (`from`),
  as the server does.
- Team pings: Alt+click sends `{t:'ping', x, z}`. The server accepts 3 per 5 s per player, only inside the map, and
  relays only to humans on the sender's team. No unit ids travel with it. The ring lasts 4 s.
- Order queue: up to 8 waiting orders per unit, and a full queue is refused with 'queueFull'. A queued dig is paid when
  it starts. Any non-queued order, stop or retreat clears the queue. 'orders' and 'rally' go only to their owner.
- Rally outside Classic is one personal point per player set with `{t:'rally', x, z}` on a passable cell. It applies to
  ground units bought with 'buy', and Classic keeps per-building rallies.
- Epilogue: `finish(g, winner, reason, at)` is the only way a winner is set. It sets `g.reveal` (fog lifted for all) and
  `endAt`. The server holds 120 ticks (6 s), stepping every other tick (half speed) with orders refused and AIs idle,
  then returns to the lobby with the result and story.
- Contested points are flagged per receiver: 1 only when the on-point units that player can see belong to two or more
  teams, so the flag never reveals a hidden enemy.
- Damage ladder: finished structures smoke at 0.66 hp or below and burn at 0.33 or below. Posture: crouch at
  suppression 50, prone at 90 (crouch at most in a trench), and lean when retreating. LOD: simple soldier model beyond
  110 m (80 m on Low) with 4 m hysteresis. Corpses are capped at 200 and live 25 s.
- Draw budget (2026-10-01): soldiers are drawn instanced, one InstancedMesh per baked figure (type, faction, color,
  kit, near or far) with posture weights per man (`drawSoldiers` in `client/unit-models.js`); each man keeps his own
  hidden mesh for posing, selection and corpses, and squads off screen are skipped. Health bars show only on hurt,
  suppressed, selected or hovered units. The relief casts no shadow (it still receives them). Dug or bombed cells
  re-place only nearby scenery props, and the 3D terrain pieces and minimap terrain are redone at most 4 times a second.
- Adaptive snapshot interval: rooms start at every 2 ticks (10 Hz) and stretch to 3, then 4, when the snapshot-tick p95
  over 50 samples exceeds 40 ms. They recover one step after 10 s under 24 ms. The client smooths units over the
  measured gap (60 to 400 ms).
- Snapshot cache: `snapshotCache(g)` is built once per send and passed as the fifth argument to `snapshotFor`. Without
  it, `snapshotFor` reads live state. Owner orders and the mode row with Assault total and Annihilation bunkers are
  cached. Rally, contested and the fog lift stay per player.
- Snapshot deltas (server.js `trimmed`): the WebSocket compresses messages over 1 KB (permessage-deflate). Each client
  gets only the unit rows that changed since its last snapshot plus `gone` (ids that died or went under fog), from
  `unitDelta(sent, rows)`; wrecks and resource nodes go only when their room-level version moves. A start or reconnect
  resets the seat's record, so its next snapshot is whole. Spectators share one stream: one build and one string per
  broadcast, one terrain memory on the game (`g.watchPending`, fed by `logCell`), and a joining spectator makes the
  next broadcast whole. The client (and the test harness) rebuild full lists before anything reads them.
  `terrainFor` skips its pending replay until a cell changes, a mine is found or a vision pass runs.
- Delta self-check: players saw dead or fogged units (bars and icons, "target not visible") until a reload. The cause
  was a server process started before the deltas serving the newer client from disk: it sent every row and no gone
  list, and the client only drops what gone names. The client now clears its rows for a snapshot without `held`
  (an older server's full list). Each snapshot carries `held`, the count and xor of the ids the client should hold.
  On a mismatch the client warns in the console ("unit rows out of sync") and sends `resync` (at most once a second);
  the server marks that seat (or the spectator stream) full, and the next snapshot has `all`, which makes the client
  replace its rows.
- As merged with rounds 1 and 2: snapshot terrain is each player's own memory (`terrainFor`, from the round 2 fog
  fixes), outside the cache, so the `cells` argument of `snapshotFor` is unused and a second build in the same tick
  gets only what the first one left. `command()` has one guard for bad slots, units, support, forts and foreign
  buildings, and it returns the round 3 reason strings. Cover checks use the spatial grid (`shared/grid.js`), so code
  that moves a unit directly calls `updateGrid`. The server keeps the round 2 start guard (`room.starting`) and builds
  snapshots only for sockets that are open (`readyState` 1).
- As merged on the client: `client/unit-models.js` builds soldiers, vehicles, guns and structures, and
  `client/aircraft.js` keeps the planes and the Airfield. Structure parts take the round 1 wood and sandbag textures
  through `setSurfaces(surface)` from main.js and fall back to plain colors in Node tests. House roofs stay separate
  meshes because `mergeMeshes` keeps one material and a roof has two. `client/fx.js` still owns every effect sound and
  `client/battle-sound.js` exports only `battleFrame`, so there is still one Volume slider and no mute button.

## Edge scrolling and Capture mouse (2026-10-01)
- Edge scrolling follows Warcraft III. The band is 3% of the window's shorter side, kept between 24 and 48 CSS px
  (32 px at 1920x1080). Speed grows with depth, from 30% at the inner side of the band to 100% at the very edge, eases
  in over 0.15 s (smoothstep) and adds up in corners, like holding two pan keys. It uses the keyboard pan speed, so
  zoom and the Pan speed setting apply. Over a HUD panel only the outer quarter of the band (at least 6 px) scrolls,
  so buttons near the edge stay usable.
- A cursor that leaves the window keeps scrolling toward the side it left by until it comes back. Blur, a hidden tab,
  the menu, the lobby or the replaced-seat screen stop it at once. The document `mouseleave` no longer affects it.
- No edge scroll during the opening glide, a box drag, with the left or middle button held (middle drag rotates), or
  for a follow that started while the cursor was already in the band (until the cursor leaves the band). A new edge
  push ends a follow, as the pan keys do.
- The cursor in the band is a block arrow toward the scroll direction (8 directions), set through `html[data-edge]`.
- Capture mouse is pointer lock with a cursor the game draws. The menu setting is In fullscreen (default), Always or
  Off, and a one-click toggle sits beside the Fullscreen button. Esc lets go, and the mouse stays free until the
  player clicks the toggle, enters fullscreen or starts a new match. Leaving play (lobby, match end) releases it.
- While captured, `client/pointer.js` stops each real mouse event at the window (its listeners are registered before
  main.js's) and fires a copy at the element under the drawn cursor, so main.js, the HUD, the minimap and the menu read
  clientX/clientY as usual. It sets `.vhover` for hover styles, makes its own click and double-click (same spot within
  6 px, and within 500 ms or the browser's own click count) and drags range sliders. Motion is movementX/Y times a
  ratio measured while the mouse is free, since browsers report it in different units.
- camera.js owns all camera motion. pointer.js only reports where the cursor is (`x`, `y`, `out`, `overView`,
  `active`, `buttons`) and draws the arrow camera.js picks each frame.
- First-press fix: main.js used to swallow the first mousedown of the opening glide (capture phase, then
  preventDefault and stopPropagation), so the first click or box drag of a match selected nothing. `rig.introPress`
  now lets a left press end the glide and go on to select. Only a right press is held back, so it cannot give an
  order. The keyboard handler still swallows the first key during the glide (left for later).

## Relief, structures and atmosphere (round 4, 2026-10-01)
- Relief module: `client/relief.js` (`createRelief(map, grid, { texture, isRoad, gfx, low, onGeometry, material })`)
  builds the board surface from the sim's cell levels and returns `{ mesh, geometry, hAt, update(cells), stats,
  dispose }`. The geometry is in world space (y up, x and z from 0 to the map size) with a fixed bounding box, and its
  UVs match the ground canvas and the fog texture (`v = 1 - z / MH`). `hAt(x, z)` is the one ground height for units,
  props, water, the camera, the minimap and picking (the mesh raycasts by marching against `hAt`). `update(cells)`
  rebuilds only the cells around a change (about 4 ms per crater) and calls `onGeometry` when the geometry is
  replaced, so the fog overlay shares it. Each cell is split into up to 4 x 4 quads (`S = 4`); flat cells merge into
  row runs of up to 32 cells. It imports `../shared/sim.js` by relative path, so test.js runs it in Node.
- Cliff and slope rules: cell centres keep their exact sim height (`level x CFG.levelHeight`). A step of two or more
  levels between connected cells is a cliff: the sides get separate vertices and a vertical rock strip between them,
  painted as warm strata with a pale lip and a soil foot. A one-level step is an eased ramp (smoothstep) between the two
  cell centres, steepest at the boundary, painted with dry earth on the steep part. Cliffs are a heightfield, so there are no overhangs. Roads
  sink 0.1 m with a shallow centre fan, and building cells are never sunk. Water cells are carved below the frozen
  water line of their body (`client/water-levels.js`): fords 0.15 m so they stay wadeable, channels 0.42 m at the
  bank row and 0.38 m deeper per row inward, with sloping banks. Bridge cells keep their deck height.
- Low path: the relief material compiles with `RELIEF_LOW`, which drops the noise patches, strata detail, cracks and
  paint bump in the shader. The geometry skips the extra centre vertices that High adds to sloped cells (a budget of
  5 triangles per cell, at most 150k, or one per cell on maps bigger than 256x256: Three Islands has 248k on 262k cells). A Graphics change swaps the define, recompiles through the program cache key
  and rebuilds the geometry. Structures on Low drop duckboards, half the shrubs and small-part shadows. The atmosphere
  on Low turns off cloud shade, blowing dust and birds, and keeps the table props, the lamp pool, fewer mist sheets
  and fog banks, and the match weather's rain or snow with a third of the drops.
- Structures: `client/structures.js` rebuilds the map pieces (houses, church, barns, bocage banks, capped walls,
  sandbags, trenches, rubble, wire, tank traps, bridges) from the grid as one InstancedMesh per kind, seated on `hAt`.
  A hedgerow stretch is a shaded lumpy core inside leaf cards that run along the hedge, so neighbours close into one
  wall. It never changes gameplay cells. The five base buildings are one merged model per type and team
  (`buildingModel`), textured through the detail map above. `hqCamp(f, tent)` builds the HQ's tent, crates, table and
  flagpole as three merged meshes (canvas, timber, poles and rope); main.js adds the flag. Map pieces, props and
  foliage darken in the fog through `fogShader` and `setFogMap(tex, MW, MH)` in `client/surfaces.js`, which samples
  the `client/fog.js` texture (see Fog of war below). It imports `/shared/sim.js` by absolute path, so it is browser
  only.
- Atmosphere: `client/atmosphere.js` picks a mood from the map name (warm, dawn with river mist, overcast, snow, dust)
  and the match weather (see Weather; the name rules live in `shared/weather.js` so Map default agrees), drifts cloud
  shadows over the board and table on the server's wind, sets out the planning-table props and the desk lamp, and flies a few
  birds on High. Everything over the board is transparent, writes no depth and draws before the fog overlay, so unseen
  ground darkens it too.
- As merged with rounds 1 to 3: main.js keeps `relief` and `hAt` delegates to it. The round 3 smoothed height field
  (`buildField`, `terrainGeometry`) and its house, roof and parapet builder are gone; `applyCells` now paints the
  ground, calls `relief.update(cells)`, rebuilds the structures, refreshes the props and updates the water.
  `createWater(grid, map, hAt)` takes the relief height. `client/ground.js` returns `isRoad` for the relief's road
  sink. `client/unit-models.js` keeps the round 3 one-draw units and Node tests keep its box buildings; main.js
  injects `buildingModel` through `setBuildings`, and the command bunker keeps no `v.body` because it is never built.
  The HQ uses `sandbagRing` from structures.js. `client/light.js` and `client/atmosphere.js` read the relief's bounding
  box when the ground has no plane parameters, and the board edge samples `mesh.userData.edge` (`hAt` and the quad
  step) along the four sides so the cut-earth skirt follows cliffs at the edge.

## Fog of war (2026-10-01)
- The server decides what each team sees, cell by cell, and the client only draws it. The old client drew its own
  vision circles and disagreed with the server on 6.4% of the map's cells (a quarter of the cells either side called
  seen), with 29 of 477 shown enemies standing on fogged ground.
- `teamFog(g, team)` in `shared/sim.js` applies updateVision's rule at every cell centre: within 6 m, a building's or
  an airborne plane's whole vision circle, a live recon corridor, otherwise the high-ground and garrison range with
  line of sight. The range comes from `visionRange`, the same function updateVision uses (high ground, garrison and,
  since the living-ground terrain, rain), so the two can't drift apart. The cells under the enemy ground units the
  team sees count too (a building's whole footprint), so nothing a snapshot shows stands on fogged ground; that also
  covers a dusty target seen from farther away, and the Horde stragglers revealed through the fog. It runs once per
  vision pass (`g.visionTick`, every 4 ticks), the first time a snapshot asks. Units standing still keep their cells
  until sight changes in their box (terrain edits, smoke) or their range changes (rain). Enemy planes are still shown
  over fog (they are seen up to `CFG.air.seeRange` away).
- Wire: `fogFor(g, slot, full)`. The start message carries `{ v, e }` (seen now and ever seen); each snapshot's `fog`
  is the cells that flipped since that player's last fog, or nothing when the view did not change. Both use
  `packRuns`: alternating run lengths as base-32 varints in URL-safe base64 digits. Teammates on the same base share
  one packing. A six-player Massive snapshot went from 1920 to 2022 bytes on average.
- Client: `client/fog.js` keeps seen, explored and the target look per cell: clear (seen, or under a unit the snapshot
  shows), dimmed (explored) or dark (never seen). Cells fade to a new look within 0.25 s, and only the changed span of
  each texture row is uploaded (`addUpdateRange`, after the first full upload). The ground overlay, structures, props
  and the minimap read it, and so does the realistic scenery's foliage (bark, leaves, grass, wheat), through the same
  `fogShader`; water darkens under the overlay. The match-end lift clears it.
- Fog on 3D pieces (`fogShader` in `client/surfaces.js`) mixes toward the overlay's own colour (10 / 255) right after
  `opaque_fragment`, in the shader's linear space. High draws into a linear render target and tone maps and converts
  in `client/light.js`'s last pass, Low converts in the material, so a constant placed after `colorspace_fragment`
  (the first version used 0.22) matches the ground on Low only and turns pieces pale on High.
- Not hidden yet: terrain changes in fog still reach every client, as noted under Classic.

## Tech
### Public lobby (first slice)
- `/` is a lightweight HTML/CSS/JS match directory, without Three.js or a game WebSocket. It reuses the room UI's
  gunmetal, khaki hairlines, brass, two-pixel corners and Barlow Semi Condensed typography. No new UI framework.
- `/play` serves the existing game. Legacy `/#code` links redirect there with the hash and alternate seat intact.
  `/?edit` remains the editor. `/play` without a code retains the legacy main room. New invite links use `/play#code`.
- `GET /api/rooms` is a no-store, explicit-field projection of in-memory rooms. Only explicitly listed rooms with
  a connected human player appear. It includes no seat tokens, player names, private state or unlisted codes.
  Connected spectators alone do not keep a room listed. Full and in-progress rooms stay visible but cannot be
  joined from the directory. Players can filter by mode or open seats; the list refreshes every five seconds while
  the page is visible. Failed refreshes clear stale join actions and show an offline state.
- The first WebSocket hello creates a room as before. Its optional `listing: { public, title }` sets visibility
  and a sanitized, 48-character title only on creation. Later joiners cannot change either. Legacy creation is
  unlisted. Metadata travels from the create form to the game through query parameters, never in shared invite links.
  Nicknames persist locally where storage is available and also travel in that initial URL.
- Quick Play refreshes the directory, picks an open Conquest room with the most connected humans, or creates a
  public Conquest room on the default map. This is discovery, not an atomic matchmaker: seats are not reserved.
  All existing host settings remain available inside a room. Unlisted does not mean authenticated or secret.
  Listed rooms enforce the selected map's seat limit for new players, taking a seat and adding AI. Late joiners
  become spectators if the room filled before they connected. Unlisted rooms keep the old lobby seating behavior.
- `MAX_ROOMS` defaults to 32 (bounded 1-256) across all rooms, including unlisted ones. A new room beyond that cap
  receives `{t:'full', reason:'capacity'}` and retries normally. Existing rooms remain reachable. Existing cleanup
  removes rooms after 60 seconds with no connected clients. This is not a compute-capacity guarantee.
- Tests: `node test-public-lobby.js` exercises the real HTTP/WebSocket server and is included by `node test.js`.
  `tools/test-public-lobby-browser.mjs` adds optional Playwright checks with separate player contexts, legacy links,
  unlisted creation, desktop/mobile screenshots, filters and network failure. Install Playwright outside this repo
  if desired and set `PLAYWRIGHT_MODULE` to its index.mjs; `CHROMIUM_PATH` overrides `/snap/bin/chromium`.
- Not a hardened internet launch yet: connection/command rate limits, per-IP room budgets, compute admission,
  editor isolation, moderation, deployment and persistent accounts are separate work. No gameplay balance changes.

### Runtime
- Plain JS ES modules, no build step. Deps: `ws` (server), `three` (client).
- Server-authoritative: `shared/sim.js` runs at 20 Hz on the server and snapshots go out at 10 Hz (every 3 or 4
  ticks while a room falls behind, see round 3 above).
  Clients send commands and smooth toward the latest snapshot.
- All command validation lives in `command()` in `shared/sim.js`.
- Map = grid of cells (2 m). `B` building, `H` hedgerow, `#` wall, `+` crater. LOS, pathing (A*), and cover all read the grid.
- Wall clearance: a cell touching a wall (a cell that blocks both MOVE and SIGHT: houses, building footprints) costs
  `CFG.wallHug` (0.5) extra to step on, and string-pulling checks three rays 2 m apart (other uses keep 0.9 m). Units
  pass buildings about 3 m out instead of 1 m, so models no longer cut across an HQ's corner. A penalty, not a block,
  so one-cell alleys stay open. 0.3 already clears a Classic HQ (0.1 does not), 0.5 leaves margin; 0.8 and up moved hill-112's
  Fuel node into a backyard (its placement compares walk lengths).
- The command bunker is a unit with no cells (a sight-blocking footprint would blind its MG slit). `findPath` adds
  30 to cells within its radius + 1 m and `wallHug` to the ring 2 m beyond, and string-pulling will not pass within
  radius + 1.5 m of it unless an end of the segment is already there. A cost, not a block, so a move or attack aimed
  at the bunker still gets a route.
- Hosted on the owner's PC in Ecuador, reached by friends over Tailscale (`tailscale serve`).

## Roadmap
1. ~~Tracer bullet~~ 2. ~~Combat~~ 3. ~~LOS + fog~~ 4. ~~Points, VP, manpower, call-ins~~ (MVP)
5. ~~In-game map editor~~ (`/?edit`): paint terrain, place spawns and points, per-point VP/MP, save with the `.edit-password`,
   fairness test (90 AI matches in a worker, per-spawn win rate). The host picks the map in the lobby.
   Select / move tool grabs a whole structure (drag to move, Delete removes) and drags spawns and points; Raise/Lower brushes.
6. ~~Destructible terrain, rivers, bridges~~: W river (impassable, see across), F ford (half speed), = bridge, R rubble
   (infantry only).
   Artillery/grenades damage structure cells (house -> rubble, wall -> crater, hedge -> gone); a wrecked bridge cell drops the
   whole span into the river, taking anyone on it. Shells crater open ground. Tanks crush hedges and walls. One barrage aimed
   along a bridge drops it ~91% of the time. Map "River Towns": three rivers between the sectors, a bridge through each
   village (point on the bridge) and a ford upstream; rasterized by distance so every river is equally wide (300 AI matches:
   34/37/30% per spawn). Default map's top spawn is mildly favored (39/28/32% over 300), spawns are shuffled per match.
7. ~~Elevation~~: height level 0-4 per cell (2.5 m each). Hills block sight (the line between eyes is sampled against the ground),
   +10% vision per level, up to +45% accuracy shooting downhill (down to -30% uphill), 1-level steps are slopes, bigger are cliffs.
   Default map: one identical overwatch hill per player between HQ and center.
   Depressions down to -2 (stored as a/b): gullies hide troops; a 2-level drop is a cliff.
8. ~~Faction flavor~~ (procedural models, no asset files): per-faction helmets, tanks (Stuart / Panzer II / T-70) and rocket
   carriers (Calliope on a Sherman / Panzerwerfer half-track / Katyusha truck). Units answer orders in their language via
   the browser's speech synthesis (mute: M). One unique unit each:
   - USA Ranger Squad (200, was 185 until the unit control rebalance): 6 elite men with bazookas; Satchel Charge demolishes a house, wall or bridge.
   - Germany Tiger (560, was 620 until the unit control rebalance; max 1): 900 hp, big gun, front armor takes 70%.
   - USSR Conscripts (80): 7 cheap men; Ura! = 6s sprint that ignores suppression.
   300 AI matches per map, wins by faction USA/GER/USSR: 37/33/30% (default), 36/35/30% (River Towns).
   Before tuning: USSR won 74% (conscripts at 60 MP were too efficient) and the German AI stalled saving for the Tiger.

Tuning knobs: `CFG` and `UNITS` at the top of `shared/sim.js`.

## Naval warfare (decided 2026-10-01, slice 1 built)
Goal: a big-map mode where players slowly take resource nodes, fortify their coast, then cross the sea to invade.
- Decided with the user: games last 60 minutes at most; both FFA and teams; ships at true size on bigger maps (a
  110 m destroyer is fine at 1 km); it builds on Classic (nodes, Engineers, buildings) and stays opt-in per map
  (`naval: true`), because rivers are chokepoints by design and boats would undo River Towns' balance.
- Core risk: the defender always wins a landing. What has to hold: the coast is too long to fortify everywhere
  (fog over the sea, limited builders), the attacker gets tools only an invasion needs (naval gunfire, smoke, paratroopers),
  the defender counters with coastal guns and mobile reserves. Kept small: no fleets, submarines or carriers.
- Map size spike (`tools/bench.mjs --map`, six Massive AI, 6000 ticks, Classic): tick p50/p95 1.8/6.6 ms on King
  of the Hill, 1.9/7.2 at 256 cells, 2.2/10.2 at 384, 2.1/11.1 at 512 (1 km). The per-seat snapshot is what grows.
  Browser JS heap 76 MB (King of the Hill) vs about 450 MB at 512 cells, so 2 km (about 1.7 GB) is out without client
  work. The size cap went from 256 to 1024 cells; 1 km is the working size.
- Slice 1 as built: terrain flag `LAND` on every char except `W` and `F`; `blockOf(def)` gives a boat `LAND` where
  a vehicle has `MOVE | VBLOCK`, so A*, regions (`navalRegionVersion`), string-pull and `nearestFree(g, x, z, block)`
  work unchanged. `F` doubles as surf off a beach: boats float in it, infantry wade it. The Landing Craft (`lcvp`)
  reuses the halftrack's cargo (`carries`) but gives no forward reinforcement. Unload asks for ground within
  `CFG.shoreReach` (5 m) and answers `shore` otherwise; a squad thrown from a sunk boat further out drowns. The
  Shipyard (`coast: true`) needs open water within two cells of its footprint and a naval map (`coast` reason);
  it counts as a Production Building, so boats retreat to it and it keeps its owner alive. Boats ride the client's
  water line (`relief.waterAt`). Three Islands: 512 cells, islands about 350 m across, straits about 185 m, beaches
  with 6 cells of surf on three sectors of each coast and two-level cliffs between.
- Slice 2 (warships): `SHOAL` marks water within `CFG.shoal` (10) cells of any non-`W` cell, once per match
  (`markShoals`, kept through `setCell`); a `deep` unit is blocked by `LAND | SHOAL`, so the same path code keeps a
  destroyer 20 m offshore. Ships have `hull` (half length): `hullPoint` / `reachDist` measure range and sight to the
  nearest point of the hull's centre line, and target and sight searches reach `HULL_MAX` further on naval maps only.
  Blasts and separation still use the middle. The destroyer's gun is a salvo weapon (spotting is enough, like the
  mortar) with 120 m range, 25 m minimum, and its ability is the barrage (Shore Bombardment). The gunboat's Torpedo
  is the AP round with `mult: 25` and `naval: true` (only fired at boats and ships). The Shipyard's coast test now
  takes surf too (beaches have 6 cells of it).
- Boats in every mode (2026-10-01): the naval units dropped `classic: true`. `command('buy')` refuses a `naval` unit
  unless `g.naval`; `spawnUnit` launches it with `nearestFree(..., blockOf(def))`, so a bought destroyer appears on the
  deep water nearest the HQ. The recruit bar gets a fifth group, Naval, shown only on naval maps.
- Destroyer broadside: `rockets: 4` (one per mount) at 22 / 32 damage, `every: 0.1`. The client model has four mounts
  (`v.mounts`, the first is also `v.turret`) that all follow the aim; fx.js fires shell i from mount i, with a muzzle
  flash per mount and one broadside per 1.2 s for an eight-shell Shore Bombardment.
- Next slices: AI that defends coasts and later invades, a coastal battery, beach obstacles and bunkers, supply across the sea (forward depot or a captured port), Sudden Death moved
  for 60-minute games, a larger pop cap, and the zoomed-out symbol view for big maps.

## Field fortifications
- `FORTS` in sim.js: trench (T, 30), sandbags (#, 20), barbed wire (X, 25), tank traps (Y, 40), MG nest (6 cells, 60).
  Built by rifle squads, conscripts and engineers (`CFG.fortBuilders`); one cell per `digTime` (3 s, engineers 1.5 s).
- New terrain flags: WIRE (infantry speed x `wireSpeed` 0.35, +4 path cost so squads route around; tanks crush it;
  40 hp) and VBLOCK (vehicles' paths treat it as a wall; infantry pass and get cover; 250 hp). findPath picks the
  blocking mask from the moving unit's type.
- Only open ground, craters and rubble take a fortification, so nobody builds on bridges, fords or in houses.

### Trench rules (2026-10-01)
Trenches were a flat 0.35x on incoming fire from every side, for anyone, forever. They now have five rules
(`CFG.trench`), so where and how you dig matters and attackers have answers:
- Settling in: incoming accuracy and suppression go from 0.5 (cover level, just jumped in) to 0.3 after 8 s standing
  still (`u.still`). Hit them before they settle.
- Facing: a dug trench cell remembers its front (`g.trenchFront`, radians). Lines and zigzags face away from the
  diggers; arcs, rings and strongpoints face out from their center; a single dig faces fortCells' forward. Fire from
  within about 72 degrees of the front (cos > 0.3) meets the full trench, anything else (enfilade, the rear) gets
  plain cover (0.5). Map-drawn trenches protect all round unless the map sets `trenchFacing: true`, which faces each
  away from its nearest spawn. Squads seeking cover (`coverRank`) know a flanked trench is only cover.
- Concealment: a squad in a trench that has not fired for 4 s is seen only within 18 m (and with line of sight).
  Planes and recon still see it. Firing gives it away.
- Moving: infantry move at 1.2x along trench cells (communication trenches).
- Rallying: suppression drains at 14/s in a trench instead of 8/s.
- Caving in: shell damage on a trench cell adds up in `g.wear` and at 400 the cell becomes a crater (cover). Tanks
  crush trench cells they drive over (`CFG.crush.T`).
- Balance, 150 Conquest AI matches on the default map (seeds 1-60 and 1000-1089), before and after: faction wins
  USA/GER/USSR 50/47/53 -> 44/50/56; spawn wins 51/49/50 -> 62/54/34; runner-up VP over winner 0.49 -> 0.44; median
  length about the same (7.9 -> 7.7 min). Turning one rule off at a time (90 matches each) moved spawn 2 between 22
  and 29 wins, so no single rule causes the spawn shift and it may be noise; turning facing off changed almost nothing,
  since the AI mostly fights head on. Worth re-measuring with more matches.
- New map **No Man's Land** (`tools/genmap-trenches.mjs`, 2v2, mirrored, `trenchFacing`) shows them off: reserve and
  zigzag front lines joined by communication trenches, staggered wire, a cratered middle with an abandoned trench by
  the center point.

### AI fortification (2026-10-02)
- The squad holding a point fortifies toward the closest enemy HQ, in order: mines at radius + 2 m, an arc of trench
  (strongpoint at 600 MP), a 14 m line of barbed wire at radius + 5 m, and once the enemy has shown armor
  (`mem.armor`) a 16 m line of tank traps at radius + 10 m. Each step keeps `FORT_RESERVE` (60 MP) back for units;
  it was 150, which left the AI almost never able to afford any of it.
- Before, a holder with a house nearby garrisoned and never dug, and from inside it could not see the ground to build
  on (wire was refused as `notVisible`). Now a builder squad on a quiet point (no enemy in sight within 40 m) does the
  work still owed first, stepping out of the house for it, and takes the house once it is done or the enemy shows up.
  Only the first unit at a point holds it, so a point held by a mortar or AT gun is still not fortified.
- Measured, 8 matches each (peak new cells per match), HEAD -> now: default map trench 1.3 -> 3.8, mines 2 -> 4.4,
  wire 0 -> 1, traps 0 -> 0 (the AI rarely gets that far there); No Man's Land trench 8.6 -> 10, mines 10.4 -> 11.9, wire
  0 -> 1.5, traps 0 -> 3.3.
- Balance, 90 Conquest AI matches on the default map (seeds 1000-1089), HEAD -> now: faction wins 30/37/23 ->
  26/31/33, spawn wins 34/37/19 -> 34/28/28, runner-up VP over winner 0.62 -> 0.58, median 9.3 -> 9.0 min.

## Roads, mud, bridges and mines (2026-10-01)
- Three terrain cells: `D` road (flag ROAD), `M` mud (flag MUD), `N` mine (no flags). `=` bridge also carries ROAD.
  The flags array is 16 bits now (MUD is 256).
- Vehicles only: speed x `CFG.roadSpeed` (1.35) on ROAD, mud between 0.7 and 0.35 by depth (see Living ground below).
  In `findPath` a vehicle's step costs 1 / the cell's speed, so the cost is the travel time. On a map with roads
  (`g.roads`) the A* estimate is scaled by 1 / 1.35 to stay admissible; maps without roads pay nothing. String-pulling
  does not cross mud and does not skip past the next road cell, so a vehicle stays on the road it chose.
- Infantry ignore both. One rule per terrain kept the HUD free of new tooltips; revisit if roads feel dull on foot.
- Roads and mud are buildable ground: a fortification replaces the cell, and it wrecks to open ground, not back to road.
- Bridge and Minefield are two more `FORTS`, so the dig command, queueing, previews and the Orders buttons came free.
  `on: 'W'` makes the bridge take river cells instead of open ground, `reach: 9` lets the squad work from the bank
  (the usual 3 m would send it into the river), `along` aims it the way the squad walks instead of across.
- Mines: `g.mines` maps the cell to the slot that laid it. `terrainFor` withholds an `N` cell from anyone not allied
  with that slot, so enemy clients never receive it; when it goes off the cell becomes `+` and everyone sees that.
  A mine painted in the editor has no owner and goes off under anyone. `terrainHp.N` is 1, so every blast with a
  terrain value clears mines. The mine's own blast has no terrain value, so mines do not set each other off.
- Known gap: the fire-at-structure order answers "blocked" for an empty cell and accepts a hidden mine cell, so a
  player could probe for mines one cell at a time. Not worth a fix until someone does it.
- `tools/roads.mjs` stamps roads and ford mud onto finished maps (spawn to nearest point, point to nearest point, ties
  within 10% all count so symmetric maps stay symmetric). It is separate from the generators: run it again after genmap.
- A bridge builder walks to `digGoal`: a point on the line from the span's middle to the squad, 2 m inside reach. Asking
  the pathfinder for the middle of the river picked either bank, and the far one is unreachable. Ceiling: on a river
  wider than the reach the nearest land to that point can be out of reach and the squad waits; build from closer.
- AI (`shared/ai.js`): the point holder lays one minefield at point radius + 2 m toward the nearest enemy HQ before it
  entrenches, again when fewer than 2 of its mines remain within radius + 10 m. Laid from inside the point, so the
  squad still counts as holding it (further out, it walked off the point and the AI never sent it back).
  `rebuildBridge` notes the map's bridge cells on the first look and sends the nearest free builder to a cell that has
  become river, one job per look, never with a visible enemy within 35 m. It does not bridge new crossings: knowing
  where a new bridge pays would need a path query per look, and no map needs one yet.
- Balance (120 three-way AI matches per map, wins per spawn, with / without roads, AI not using them): Three Crossroads
  44/33/23 vs 44/29/27, River Towns 39/30/31 vs 43/28/29. With the AI laying mines and rebuilding bridges: Three
  Crossroads 30/34/36 (120), River Towns 43/29/28 (360).

## Living ground (2026-10-01): less board, more ground
The owner's brief: the game felt like a board game because tiles have fixed effects that switch at their edges. Keep
the sand-table look, move the rules away from the board a little.
- One number per cell, `g.wear` (0-1), read according to the cell's type: churn on open ground, depth for mud, fords
  and craters, damage on a road. `groundMul(g, c, veh)` turns it into a speed; `speedMul` averages it over five points
  of the unit's footprint (centre and four at 0.6 x radius), skipping water and walls. That average is the whole
  "soft edges" rule for movement.
- Traffic: `CFG.traffic` (0.05) wear per metre a tank drives, half for vehicles that do not crush, half again in mud,
  x (1 + 3 x wetness). Open ground at wear 1 becomes `M` with wear 0, so the speed is continuous across the change
  (0.7 either side). First tried 0.02: a standard 9-minute AI match then churned under 10 cells, invisible.
- Shelling: `damageCells` adds hit / 200 to a road's wear (crater at 1) and hit / 500 to a crater's.
- Starting depth comes from `cellNoise(c)`, a hash of the cell index: mud and fords 0.2-0.8, craters 0.3-0.6. Cheap
  and stable, but it is not symmetric, so it can favour a spawn (River Towns moved from 43/29/28 to 30/43/27).
  If that matters, mirror the hash through the map's symmetry or let map files carry depths.
- Flooding: `flood(g)` runs twice a second. A `+` cell with a `W` or `F` 4-neighbour that is not lower than it
  becomes `F` and keeps its wear as the ford's depth. `g.soak` holds the cells to look at (every cell `setCell` or
  `dent` changed, and its neighbours), so a quiet map costs nothing. Chosen over a real fluid sim (water volume per
  cell): on a 2 m grid it would look the same and cost synced state and tuning. The client needed no change: a new
  `F` cell joins its neighbour's body in `water-levels.js` and takes its water line. Balance not rerun.
- Scarring: `damageCells` takes a `scar` share (artillery 1, tank shells `CFG.scar.tank` 0.25, everything else 0) and
  adds hit x scar / `CFG.scar.hit` (600) to `g.scar[c]` on open ground and craters. At 1 the cell is dented and
  cratered. A cell the slope rule holds back stays at 1 and goes down once its neighbours have, which is what makes a
  bowl. Kept apart from `g.wear` so cover and depth do not change. The floor stays `minLevel` -2: going deeper needs
  the map format (heights are `0-4ab`) and the relief checked first.
- Round holes: `digAt(g, at, r)` dents every cell whose centre is within r metres of the blast, then the inner half
  again, and craters open ground in it. River cells are not dented twice: a bridge needs every cell of its span seen,
  and a squad on the bank cannot see a bed two levels down (the AI stopped rebuilding bombed bridges).
- Fill in: a `FORTS` entry with `fill: true`, so the button, the line drawing and the dig jobs come for free.
  `fillable` picks the cells, `fillCell` raises one to min(original height, lowest neighbour + 1). `g.chars0` and
  `g.height0` keep the map as drawn. Buildings: `canStamp` allows one level of fall and `placeBuilding` raises the
  footprint to its top. That can leave a two-level step beside a building; it is a cliff edge like any other.
- Wrecks: `g.wrecks` (id, type, owner, x, z, rot), filled in the death loop, capped at `CFG.wrecks` 40. `coverBehind`
  treats them like live vehicles. On open ground, a crater, a road or mud the cell also becomes `Q` (VBLOCK | COVER,
  300 hp, wrecks into `+`), so pathing, cover and `damageCells` need nothing new; `setCell` drops the hull when its
  `Q` cell changes. One cell, although a tank is wider: enough to plug a road, and no footprint code. Not on a bridge
  (the span logic owns `=` cells) or a ford, where the hull is cover only. Sent whole in every snapshot
  (40 short rows at most); the client keeps one darkened model per id in `hulks`.
- Rubble (2026-10-02): `R` is VBLOCK | COVER, so a ruined block is no longer a tank shortcut. When a house cell
  (`B`) is wrecked, `wreckCell` throws rubble onto each 4-neighbour that is open ground, road, crater or mud with
  chance `CFG.rubbleSpill` (0.35), never under a vehicle. That is what chokes streets: house rubble alone stayed
  inside the footprint, which was already blocked. Supply lines needed nothing new (they flood over cells without
  MOVE | VBLOCK), so a street choked with rubble cuts the points behind it. `fillable` takes `R`; `fillCell` gives a
  cell that was `D` on the map its road back, anything else becomes open ground. `spoiled` adds rubble on a map road,
  so the AI clears its own streets near points it holds. Tanks crushing a wall now leave `+`, not `R`, or they would
  stand on a cell that blocks them. Hand-drawn rubble on the shipped maps cuts no point off from any spawn (checked
  by flood fill).
- AI filling: `fillHoles` in `shared/ai.js` sits beside `rebuildBridge` and works the same way (one job per look,
  walk up when the cell is not visible). `spoiled(g, c)` in the sim says what counts: flooded or below the map's
  height, and a shovel would change it now. That last part is what stops it paying for the same cell for ever: the
  lowest cell of any hole can always rise, so every job makes progress.
- Cover: `coverQ` scales a cover cell's protection (hp share for walls and hedges, depth for craters);
  `coverBehind` returns 0-1 by distance to the first solid cell toward the shooter (full to 2.2 m, zero at 3.8 m)
  times that cell's `coverQ`. `behindCover` (cover seeking, cover rank) is `coverBehind > 0.4`.
- Slope: `heightAt` interpolates the cell levels; the grade of the next metre along the path scales speed by
  `CFG.slope` ([0.2 infantry, 0.45 vehicles]). Levels stay whole numbers: only the movement reads them smoothly.
- Clients learn a cell's state as a 4th element in the terrain log entry: wear in quarters (bits 0-1), burnt (bit 2),
  damage stage (bits 3-4). `touch` logs a cell only when that byte changes, so wear costs four messages per cell
  over its life. `startState(ch, c)` is exported so the client can draw map cells nobody has mentioned yet.
- Wind, weather and fire roll their own dice (`g.seed`, `rng`), so they do not shift the combat rolls that some
  tests script through Math.random. The seed is a plain number so a game can still be cloned.
- Wind: `g.wind` { a, v } random-walks. `weather()` moves every smoke cloud by v x `CFG.windSpeed`. Smoke clouds
  got ids because the client keyed them by position and would have re-burst a drifting cloud every snapshot.
- Rain: `g.wx` { rain, wet, raining, next }. rain ramps over 20 s, wet follows over `soak` / `dryOut`. Effects are
  listed in the changelog; all of them read `g.wx` where they apply, there is no weather system beyond that.
  `createGame(..., { weather: false })` gives a game without it.
- Fire: `g.fires` maps cell -> seconds left; `burn()` runs twice a second. Spread chance per second per neighbour:
  hedge 0.25, house 0.03, grass 0.022, x max(0.1, 1 + 1.5 x wind along the step) x (1 - rain). Grass is tuned to
  under one new cell per burning cell in still air, so a grass fire dies out unless the wind carries it; hedgerows
  burn end to end. Only blasts with a terrain value of 60+ can ignite (hedge 0.3, house 0.15, grass 0.03 per cell).
- Dust: `u.dust` is the tick a vehicle last moved on dry ground; `updateVision` multiplies the viewer's range by
  `CFG.dustSeen` (1.3) for such a target. Unit flag 32768 tells the client to draw the trail.
- Client: `client/wind.js` holds the wind for fx.js and atmosphere.js (it was a constant in both). ground.js maps the
  state byte onto the existing material blend (mud share for wear, shelled earth for burnt and for broken road).
  structures.js lowers a damaged stone wall and drops its capstones, removes sandbag courses, and thins a hedge.
  fx.js draws fires with the existing flame, ember and wreck smoke particles and leaves the existing scorch decal.
  atmosphere.js adds rain as a third kind of weather points (the snow system with a streak fragment) and dims the sun.
- Balance and wear numbers: see the changelog entry.

## Unit control and unit AI (decided 2026-10-01, four slices)
Decisions from the planning interview:
- Cover: both automatic (idle infantry under fire) and a Take Cover order. Hold Position (slice 3) means hold: no
  auto-cover and no chasing.
- Mass entrenchment: every selected digger works one shared pattern (line, zigzag, double line, arc, ring,
  strongpoint with wire). Short of MP or diggers: dig what can be paid for, middle outward; the rest as MP comes in.
- Stances (free fire, hold fire, hold position), auto-retreat when broken (a toggle, on by default for ground units), vehicles turn
  their front to the threat, groups spread their fire. New units behave as before until the player changes them.
- Computer players use all of it. Order of work: cover, trenches, extras, AI and rebalance.

Slice 1, cover (`seekCover`, `coverRank` in sim.js):
- Spots are ranked 0 trench, 1 cover cell, 2 behind something solid on the threat's side (`behindCover`), 3 open. A
  squad only moves to a strictly better rank within `CFG.coverSeek` (10 m), scoring distance + 4 m per rank, and only
  if the walk is under 15 m (so not to cover across a river). A cell another squad stands on, or claimed in the last
  5 s (`g.coverClaims`), is skipped, so a platoon spreads along a wall instead of piling onto one cell.
- Automatic: infantry without `setup` weapons, idle (no path, order, target order, dig, build), shot at by direct fire
  in the last 2 s (`u.hitAt`, `u.hitFrom`, set in `fire` whether it hit or not), one look every `CFG.coverRetry` (2 s).
  Blasts do not trigger it: cover does not help against them and there is no direction to hide from.
- Crewed weapons are left out of the automatic part on purpose: moving costs them their setup time and their field of
  fire, which is the thing players set by hand. The Take Cover order still moves them.
  An accepted Take Cover order clears active and waiting orders even when the squad already has the best cover.
- Separation no longer pushes a squad in a cover cell onto a cell without cover (`shovedFromCover`). Found while
  testing: a squad walking past shoved the one already behind the wall out into the open.
- Classic, 90 three-way AI matches, default map: 37/38/26% (32/38/30% before). Same direction as Conquest, inside the noise.
- Balance: Conquest, default map, 300 three-way AI matches with rotated factions: USA/GER/USSR won 41/36/23% (39/33/28% before this change on the same script), average match 561 s (552 s). USSR lost about 5 points, at the edge of the noise for 300 matches; left alone until the rebalance in the last part. The Classic run is recorded with part 2.

Slice 2, mass entrenchment (`entrenchPlan`, `takeDigJob`, the `entrench` command):
- A pattern is a list of ordinary fortification segments (`FORTS.trench`, plus `FORTS.wire` for the strongpoint), so
  digging, pricing per cell and what ground takes a trench are the existing rules. `entrenchPlan` is pure geometry and
  is shared with the client, which draws the cells it would dig.
- The order creates one project `{ jobs, crew }` that every digger points at (`u.entrench`). An idle digger takes the
  nearest job among the first `crew` jobs (the list is sorted middle outward), pays `segmentCost` and digs. No
  manpower: it waits and looks again every tick. Nothing is paid up front and nothing is refunded.
- The first slice had no registry of projects; the follow-up below adds one. A replacement order clears
  `u.entrench` only for squads whose replacement is accepted.
- Rejected: queueing the segments as each squad's waiting orders. A queued dig that cannot be paid is dropped, and the
  queue holds 8, so "the rest as MP comes in" could not work.
- Separation and cover, second try: a squad holding cover is not pushed off it, and a friend with a path is not pushed
  back by it either (it walks through). With only the first half, a digger walking along a finished trench stopped
  dead behind the squad standing in it.
- The zigzag has no rule of its own. Blast damage in a trench is `trenchBlastMul` whatever the shape; its only gain
  is more trench cells per metre of front (6 segments on 40 m against 5).

House corners (asked for during slice 2):
- `behindCover` used to sample the line to the shooter at 1.2 and 2.2 m. For a house that never fired while the squad
  could be shot at all: a house cell on that line also blocks the line of sight. So houses gave cover only from inside.
- Now a house or building cell (`WALLS`: B, K) in any of the 8 cells around the squad counts when it lies within 60
  degrees of the shooter (cosine above 0.5). Same multiplier as other directional cover (`coverMul` 0.5), no new number.
- `spotNear` adds 3 m to a rank 2 spot that cannot see the threat, so corners win over blind spots behind the wall.

Slice 3, stances and the rest (`STANCES`, `retreatUnit`, `claim`/`retarget`, the hull-turn block in `step`):
- Three independent booleans on the unit (`holdFire`, `holdPos`, `autoRetreat`) set by the `stance` command, instead
  of one enum: the interview's "hold fire" and "hold position" are both wanted at once on an ambush gun. Sent as flag
  bits 2048/4096/8192, masked for everyone but the owner.
- Hold position blocks automatic cover shifts, idle spacing, move-end settling and vehicle pull-back. It does not stop an explicit order, Take Cover included.
- Auto-retreat threshold `CFG.autoRetreat` 0.35 is the number the AI already used for pulling squads back.
- Hull turn: `CFG.behavior.hullTurn` 1.5 rad/s, only while not moving. A shooter counts when its `w.veh` is 20 or more (the
  same line that separates guns from small arms against buildings) and it is not a plane.
- Spread fire: `g.claims` is rebuilt every tick from current targets (team and target -> expected volley damage) and
  kept current as units switch. `pickTarget` multiplies a target's score by max(1, others' claims / target hp). Below
  one volley's worth of overkill nothing changes, so small fights pick targets exactly as before. Salvo weapons
  (rockets, mortar) keep their own clustering rule.
- Balance after slices 1 to 3, Conquest 300 matches: 42/33/26% (39/33/28% before).

Slice 4, the AI and the rebalance (`shared/ai.js`):
- The point holder orders `entrench` (arc toward the nearest enemy HQ; strongpoint at 600 MP or more) where it used to
  order one `dig`. Any `fortBuilders` squad may be the holder, so conscripts dig. A holder outside cover orders `cover`.
- `autoRetreat` is switched on for every AI ground unit each decision. The AI's own retreat rule stays for the case
  auto-retreat does not cover (pinned and under 60%).
- Hold fire and hold position are left unused by the AI on purpose (decided against the interview's "everything"):
  without an ambush plan they only stop guns shooting. Revisit if the AI ever gets one.
- Balance log, Conquest three-way AI matches, USA/GER/USSR, same script throughout (factions rotated over spawns):
  - before the four slices: default 39/33/28% (300), River Towns 37/34/29% (700)
  - River Towns by slice (400 each): cover 40/31/28, entrench and corners 42/31/27, stances and fire 43/29/28,
    AI 44/26/29 (700). A steady drift to the USA, about 2 points a slice; no single change stands out.
  - default after slice 4: 38/32/30 (700). Pooled over both maps: 41/29/30 (1400).
  - tried alone, 800 matches each: Ranger 185 -> 200: 40/31/29. Tiger 620 -> 560: 40/31/28. Both together, 1400
    matches: 36/35/29 (default 38/34/27, River Towns 34/35/31). Kept both.
  - One 400-match run moves a faction by 2 to 3 points on its own; smaller runs cannot tell these variants apart.

Mass entrenchment follow-up (asked for after slice 4): joining, ghost, queueing.
- Projects now live in `g.projects` (id -> `{ id, owner, jobs, crew, active }`). This replaces slice 2's "no registry":
  a ghost and a join order both need to name a project. Paid digs name their project; `active` is recounted each tick
  so cancellations and dead diggers cannot hold it open. A sweep once a second drops finished or abandoned projects
  once their paid work ends, and recounts `crew`.
- The `entrench` command takes `join: id` instead of a pattern. Own and allied projects only; the digger's owner pays.
- Queueing an entrenchment creates the project at once and queues a join for each squad, so the squads share one
  project (queueing the pattern itself per squad would make one project each, digging and paying for the same cells).
  At least one squad must have queue room before creating the project; refused patterns allocate nothing.
- Fortification placement checks sight on every planned cell before inspecting its terrain. Deferred segments
  repeat the sight check when claimed; a segment that lost sight is dropped without payment or a terrain check.
- `planOf` reports a digger as busy (kind 7) while its project has pending or active segments, so waiting orders start after the
  pattern, not between two segments. A squad waiting for manpower therefore holds its queue too.
- Queued commands no longer clear `u.entrench` (they did, which made a Shift-queued move cancel the digging).
- Snapshot `works`: [project id, 1 for wire, x, z, dir] per remaining segment, unrounded so the client computes the
  same cells with `placementCheck`. Sent to the owner's whole team.
- Retreat is deliberately not queueable: an existing test requires Retreat and Stop to clear the queue even with
  Shift held.
- Shelling reports `queueFull` when no selected unit can enqueue it. The browser defers cooldown and munitions
  checks for queued grenade, satchel and barrage targets; ordinary target clicks and instant abilities check at once.
- Hold fire applies to aircraft guns, anti-air damage and Flak interception. A plane's explicit attack permits
  firing only at that target. Jam recovery skips a waypoint only with a walkable route to the following waypoint.

## Woods, mines, halftracks, medics and supply lines (2026-10-01)
- Woods are a terrain char `O` with a new flag `WOOD` (plus `COVER`). `clear()` counts wood cells along a sight line
  and stops at `CFG.wood.sight` (3); the start and end cells are not counted, so a squad at the edge sees out and is
  seen. Cover is `CFG.wood.cover` (0.6) of normal cover. Vehicles: `groundMul` gives `CFG.wood.speed` (0.5), and the
  route cost and string-pull treat woods like mud. Fire and blasts turn a wood cell into open ground.
  `tools/woods.mjs` stamps woods relative to each spawn's road, so a symmetric map stays close to symmetric.
- Mines: `g.mineSeen` (cell -> team bits) holds what builder squads found (`sweepMines`, twice a second, only while
  mines exist). `mineKnown(g, cell, team)` is the one test: `terrainFor` shows a known mine, `findPath` adds 30 to a
  known enemy mine cell and never cuts its corner, and Clear mines (`FORTS.demine`) only takes cells the ordering
  team knows, so an order on a hidden mine answers "blocked" like empty ground and gives nothing away.
- Riding: `u.board` (walking to a carrier), `u.riding` (in it), `c.cargo`. A rider is skipped by the unit loop,
  targeting (`canShoot`), blasts, strafing, fire, separation, capture and enemy vision, and `mine()` in `command`
  refuses it orders. Its owner and allies get `RIDING_FLAG` (the client hides it); only the owner gets `CARGO_FLAG`.
- Forward aid is one hook in the reinforce pass (`atAid`): a Field Hospital cell (`A`, `g.aid` cell -> owner) or a
  halted halftrack. Infantry only, `CFG.aid.slow` (2) times slower than the HQ, same price.
- Medics heal hp, not men: a squad is a pool of hp, so "treat the wounded but do not replace the dead" would heal at
  most one man's worth. Decided: free and slow (2 hp/s on one squad), and only out of the fight (5 s without damage).
  Revised 2026-10-02 (medics barely mattered: one man per 10 s, off in every fight, and only for a squad that happened
  to stand within 10 m): 5 hp/s (a man every 4 s), half that on a squad hit in the last 5 s, and an idle medic (no
  path, order, house or carrier) paths to the most hurt squad below 90% within `CFG.aid.seek` (30 m). Retreating
  squads are skipped, so a medic does not chase one home. The AI keeps its medic within 0.8 x seek of its army's
  middle (it was 8 m, which pulled the medic back off every patient).
- Supply (`supplyLines`, every 40 ticks): per team, a flood fill from its HQs over cells a vehicle can cross. A held
  point is supplied when the flood reaches any cell inside its capture radius. Enemy units close the ground within
  `zoc` 8 m, except within `free` 16 m of a point the team holds: without that exemption, any enemy walking up to a
  point would switch its income off, which is what capturing is for. `opts.supply === false` turns it off (no lobby
  switch). Horde is left out: a wave would cut every point and the mode's balance was measured without it.
  Known fog leak, accepted: "cut off" tells the owner that an enemy stands somewhere on the road.
- Open question: a cut point pays nothing at all. Half pay may be kinder if people find it too swingy.

## Combat effects, realistic (2026-10-01)
The art direction moved from the sand table to a realistic modern PC RTS (Company of Heroes 3, Men of War II, Gates of
Hell), and nothing may look like a mobile game: no cartoon starbursts, no saturated stylized fire, no glow halos, no big
screen shake. `client/fx.js` keeps its API and its one-draw-call design; what it draws changed.
- Textures: one atlas, `client/textures/fx-atlas.webp` (2048 px, 8 x 8 cells of 256 px), built by
  `tools/build-fx-atlas.mjs` from nine gpt-image-2 pictures with alpha (raw in `~/.local/share/ww2-rts/fx-raw/2026-10-01/`):
  billowing smoke, thin wisps, a 16-frame flame, a 15-frame fireball that cools into smoke (the sheet's first frame,
  a starburst, is dropped), dirt plumes, dust kicks, debris (soil, brick, stone, concrete, wood, scorched metal) and
  side-view muzzle flashes, plus a drawn glow, tracer, spark and ember. Smoke, dust, dirt and debris cells store a
  surface normal and a detail value instead of color, so the game lights them; the generator's red fringe around fire
  is cut out. `client/textures/fx-crater.webp` is a shell crater seen from above, multiplied into the ground (2x, so
  the rim can brighten and the burnt center darkens).
- Light: lit particles read the scene's sun and hemisphere light (light.js and atmosphere.js keep owning them) at the
  same Lambert scale as the world: a soft terminator, sky from above, ground bounce from below, darker low down, and a
  bright rim on thin edges when the sun is behind the smoke. Glowing sprites shine where the picture is hot and are lit
  like smoke where it has cooled.
- Soft edges: every sprite fades out over half its size (a fifth for sprites standing on the ground) above the terrain
  height under it, refreshed as it drifts. No depth texture is needed, so light.js's render path is untouched. Sprites
  can still cut into units and walls, as before.
- Sorting: one draw call, back to front each frame with a 4-pass radix sort of 16-bit depth and 12-bit index keys (no
  allocation). Glowing sprites sort 1.5 m nearer so flames show through the foot of their own smoke.
- Explosion sizes (about the blast radius in m): grenade 2, satchel 3.2, mortar bomb 2.6, rocket 3, 37 mm 1.5, 57 mm
  2.4, 75 mm 2.6, Panzer IV gun 3, 88 mm 3.4, barrage shell 4.2, bomb 6, vehicle death 3.2 (x1.15 medium, x1.3 Tiger),
  plane crash 3.6. Each has a brief flash, 1 to 3 fireballs, a dirt plume and clods that fall and bounce, a ring of dust,
  smoke held back 0.1 to 0.4 s that rises and drifts for 5 to 13 s, and a crater; from 4 up a column keeps rising for
  2 to 3 s. Mortar and rocket impacts (both `rocket` shots) are told apart by the salvo they belong to. Strafing hits
  are spurts of dirt, not explosions.
- Guns: a side-view flash along the barrel. MGs show a tracer every round, rifles and SMGs a faint one on about half
  their shots, snipers on 60%. Tank and AT guns blow a ring of dust off the ground and leave gun smoke; bazookas have a
  back-blast. A shell that hits a vehicle bursts on its near face, not inside the hull.
- Impacts: dust kicks on the ground, brick and stone chips with pale dust on walls, sparks on armor.
- Fire: wrecks burn with looping flipbook flames for 20 s (structures 8 s), then smolder; the smoke is black while the
  fuel burns and browner as it smolders, and leans downwind. The spreading fire (`snapshot.fires`, which main.js now
  passes with the cell type): grass in low flames, hedges in a wall of flame with dark smoke, houses in tall flames at
  windows and roof. A fire that goes out leaves a burn mark (darkening only); a house leaves rubble. The smoke cloud the
  server lights over a burning hedge or house draws as grey-black rising smoke, a smoke shell's cloud as white smoke that
  hangs and rolls; both block sight the same.
- Air: aircraft.js no longer has its own puff pool. Flak bursts (a flash and black puffs that hang), damage smoke, flame
  puffs, strafing hits and crash fires go through `effects.air`, so they are lit and sorted with everything else.
- Wind: everything drifts on `client/wind.js`, the server's wind.
- Budget: 4096 particles on High, 1600 on Low. Low emits about half, makes smoke and dust 15% smaller (screens keep
  their size so they still hide what they should), keeps 24 craters instead of 64 and skips flipbook frame blending.

- Integration: current halftrack MG, traversing flak muzzle and mortar tube positions are preserved. aircraft.js owns all support-plane models, crashes and bomb releases. Removed the obsolete support-plane pool from fx.js, retaining artillery warning whistles and the unit-fall API.
- Low collapse dust uses five puffs distributed over a full circle, preserving the outward burst with fewer particles.
- Burning woods retain their new terrain behavior and draw rising flames with dark smoke, rather than falling back to low grass fire.
- Local browser QA: staged grenade, bomb, collapse, flak, damage smoke, crash fire and screen smoke rendered on High (156 particles) and Low (69), with finite instance buffers and no browser errors. Actual aircraft shoot-downs reached a burning ground crash on both settings. Saturation stops at 4096/1600 particles and reset clears both live and rendered counts. Combined hardware frame times remain an integration check.

## World edge and light (2026-10-01)

`client/apron.js` continues the map's tinted ground tiles beyond every edge. Boundary columns at half-metre spacing
retain cliff heights and follow later crater deformation, including edges that started flat. Fields fade to grass,
rivers retain low beds and `client/water.js` continues water 900 m beyond wet boundary cells and corners. The apron
reaches 1250 m; the camera far plane is 2200 m. The playable map, pathfinding and scenery bounds stay unchanged.

The map and apron fog overlays sit flush with terrain using a depth offset. `client/surfaces.js` shares the live
server vision texture with the apron: boundary vision carries 6 m outward and eases to the never-seen alpha (185/255)
by 32 m. This uses the current fog system rather than the old branch's shader-color replacement. The editor hides
both overlays. Cloud shade, rain-wet ground, mud and lying snow continue over the apron so weather does not stop at
the map boundary. Rain showers, wind, weather transitions and server sight effects retain their current behavior.

`client/moods.js` holds sun, sky fill, haze, exposure, shadows and weather modifiers. `setMood()` applies the light.
The default afternoon has sun intensity 3.5, sky fill 0.74 and exposure 0.9 with ACES filmic tone mapping. The URL
`?mood=golden` selects a low golden sun. Snow selects winter light; rain and mud select overcast light; other weather
uses the map mood. The wooden table, cut earth border, desk props, lamp pool, saturation boost and far-edge blur are
removed. Balance values did not change.

Validation: `node test.js` and `node test-world.js` passed. Browser checks covered default ground, island sea with
server fog on High and Low, River Towns with every weather type, Twin Valleys cliffs and golden light. All 1804
cliff boundary vertices matched the terrain height exactly. A crater on a previously flat edge moved nine boundary
vertices with a maximum seam error below 0.000001 m. Combined-scene GPU measurements are recorded in `docs/issue-batch-verification.md`.

## Ground overlays and cover preview (2026-10-01)
- `client/overlay.js` draws ribbon geometry with a shared terrain-height texture. Its shader keeps line width above
  a screen pixel minimum, softens the edges and cuts dashes. Relief changes refresh the height texture. Rings,
  routes, capture points, strike zones and fortification cells share it. Formation drag previews use the same Batch
  shader and retain their existing slot layout and facing rules. Order lines and cell previews reuse buffers.
- With infantry selected, `client/cover-preview.js` marks explored cells within 6.5 m of the cursor (5.2 m on Low).
  Green shields mean heavy cover, yellow light cover and red open ground. A small yellow direction cue points toward
  solid cover or a vehicle hull. Move orders flash the destination for 1.6 s. The menu switch persists in `ww2-cover`.
- The cover preview mirrors cell flags, garrison entry cells and `coverBehind > 0.4`. Woods retain light cover,
  wreck cells count as solid, and visible wreck hulls count like vehicles. The server's explored cells prevent marks
  on unscouted ground and preserve them through rejoining. Terrain changes and nearby hull changes invalidate marks.
- Preview shields use `Builder` and `makeOverlay`, with four fixed regions for cursor/flash and ground/model marks.
  Ground marks depth test, while marks inside houses, walls, woods and wrecks remain visible through their models.
  Unit shields match the same green/yellow colors. Ghost cells preserve each current fortification kind's color.
- Protection categories remain approximate: house types, terrain damage, woods and crater depth affect actual strength.
  The client knows wall damage stages rather than health, leaving an uncertain part of stage 1 at the 2.9 m boundary.
  No cover values or gameplay rules changed. Tests compare the preview with the simulation and check fog/rejoin,
  destination flashes, disabled state and valid overlay buffers. Exact position hashes refresh distance and bearing
  changes within a terrain cell.

## Unit behavior reconciliation (2026-10-01, sources f4693aa, 826d32c, 6ab05ad)

- `react` is the single incoming-fire response. Crewed weapons stay put. A squad chooses strictly better cover within 4 m when it can answer, or 10 m when it cannot. Idle squads keep 3 m spacing. A hurt vehicle that cannot answer can reverse 10 m, except while holding a capture point.
- `spotNear` serves plain move settling, incoming-fire shifts, idle spacing and Take Cover. It reserves allied units' distant path ends as well as occupied positions, ignores unseen enemy positions, and keeps a squad inside a capture circle it starts in. Take Cover can fall back to one squad per cell when 3 m spacing has no available cover.
- Crowded move destinations first search for equal or better shelter within 6 m. A covered click stays covered if no equally sheltered free spot exists. An open click may use open ground when no covered spot is available. Facing formations keep their explicit layout.
- Planning uses graded terrain cover and permanent wrecks, excluding live vehicles. Actual shot protection still includes vehicles. This preserves woods, house types, medics, halftracks, mines, supply lines and match weather from current master. Riders do not reserve ground spots, and an automatic response cannot interrupt boarding.
- Target scores combine weapon role, expected damage, incoming-fire threat (2.5x), current-target hysteresis (30% improvement required), and the existing team volley claims. All automatic changes maintain claims. Salvo cluster scores count only visible, dismounted squads, so hidden nearby enemies cannot change target selection. Hold fire also blocks a rally walker's automatic return fire.
- A stopped vehicle faces a visible target that threatens armor, then recent anti-tank fire, then its visible target. Only non-air weapons with vehicle damage at least 20 mark its threat. Threat memory lasts 5 s, longer than an AT gun's reload. Short backward combat moves reverse at half speed.
- A waiting order interrupts an automatic cover, spacing or pull-back move. A new recruit's rally walk finishes first.
- `clear` and the fog ray walker stop advancing an axis once it reaches the destination cell. This fixes exact-border endpoints without ignoring walls along the segment. Regression checks include mixed-sign diagonals and a blocker beyond the endpoint.
- The editor's terrain-only `findPath` call has no players. Optional player access leaves mine avoidance active in matches and makes editor route validation work.

## Formation facing (2026-10-01, source 24b038c)

Right-click at a destination, drag toward the desired facing, and release. A plain click sends its move on release. Ctrl-drag and G then left-drag attack-move; Shift queues a leg with its own facing. Other right-click actions, including boarding a halftrack, dispatch immediately. Escape, lost focus and a cancelled gesture clear the preview.

`shared/formation.js` is shared by preview and simulation. Slots have at least 3 m between infantry and 5 m between vehicles; a longer drag widens a rank up to three times its natural width. More than ten units form ranks. The server validates and wraps an optional finite `face` angle into (-PI, PI]. Each queued leg stores its own angle. Infantry and guns face on arrival; a hull turns at the behavior turn speed. Combat aiming takes priority, followed by remembered anti-tank fire, then the ordered facing. Accepted replacement orders and Retreat clear it. Preview geometry follows terrain height and reuses one buffer. A live two-human-seat server check on port 3811 sent a PI/2 facing to seven units, including a tank: all seven reported rotation 1.6 (0.029 rad from the requested angle, within snapshot rounding), with no refused orders.

Remaining limits: queued plan lines do not draw facing, AI orders do not set facing, and the minimap has no facing drag. An automatic cover shift still cancels the formation facing.

## Formation menu (2026-10-01)

The Orders panel keeps its everyday buttons in one grid and moves the rest into submenus that open a second grid under it: **Formation** for every selection, **Build** (the fortifications) and **Trenches** (the dig patterns) for builder squads. A menu stays open until its button is clicked again; the hotkeys work with it closed. A builder squad's panel shows two menu buttons instead of every fortification and dig pattern.

Formation settings live on the client and shape the slots it sends (the server keeps distinct per-unit spots as sent):
- Shapes (Shift+V cycles): line (ranks of up to ten), block (square), column (two files), wedge (ranks of 1, 2, 3...). Plain clicks use the shape too, facing the way the group travels, and still settle into cover on arrival.
- A right-drag sets facing and width. A line or block takes as many side by side as the drag has room for, so a wider drag means fewer ranks; a single rank still stops at three times its natural width. Column and wedge ignore the width.
- Ranks are filled by whoever already stands furthest forward, each rank keeping left to right order. Mortars, rockets and medics (minimum range or no weapon) take the rear ranks.
- Tighten and Spread (`[` and `]`) scale every gap from 1x to 2.5x and re-form the selection around its center, facing its last ordered facing, or up the screen.
- March together (on by default) sends `together: true`: the server caps every unit of the order at the slowest one's speed (`u.pace`) until it arrives, attacks or retreats. Queued legs replay one unit at a time and do not keep the pace.
- Snap to trenches (on by default): an infantry slot within 3 m of a trench cell no other slot took moves onto it.
- A double right-click (two releases within 350 ms, 16 px) turns the selection in place toward the spot.
- Ctrl+number saves the formation settings with the group; recalling the group restores them. Facing is not saved.

## Behavior balance investigation (2026-10-01)

`tools/balance.mjs` uses deterministic per-match random streams, the server's two-tick AI observation beat, and a single worker for diagnostic runs. The seeds for `--seed 1` start at 100003, matching the source benchmark. Tile-cover hit percentage counts only COVER or TRENCH under infantry that were hit. It is not a complete protection rate: directional shelter and vehicle shielding count in the separate graded-shelter measure. Neither percentage measures time spent exposed. The runner also samples every living, dismounted, ungarrisoned infantry squad every 5 s, moving or stopped, to report approximate unit time on cover or trench tiles separately from hit location.

A two-match runtime pilot took 91 s with one worker on the busy host. It is too small to establish balance. The isolated diagnostic matrix changes capture-circle restrictions, cover spacing, live-vehicle planning, and the target score's cover penalty one at a time against the reconciled branch and current master. The full paired 300 Conquest and 120 Classic samples requested in issue #17 are recorded below; no faction costs, weapons or health were retuned from a small sample.

Diagnostic Conquest results: default map, standard army, three adaptive AI seats, seeds 100003 through 100014, one worker. These frozen diagnostic builds precede the final visible-neighbor salvo fix. Each variant changes one suspect from the reconciled feature build. Runtime varied with other work on the host and is not a speed comparison.

| Build (12 matches each) | Hits on cover tiles | Hits with graded shelter | Crowded idle squads | Rear vehicle hits | Closeness | USA/GER/USSR wins | Runtime |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Master 41eefe8 | 49.2% | 51% | 41.1% | 15.2% | 0.53 | 5/2/5 | 489 s |
| Reconciled feature | 33.8% | 35.8% | 10.8% | 14.4% | 0.52 | 7/2/3 | 151 s |
| No capture-circle constraint | 34.7% | 36.2% | 13.7% | 10.9% | 0.50 | 5/5/2 | 77 s |
| One squad per cell, no 3 m gap | 36.4% | 38.7% | 42.2% | 16.2% | 0.38 | 4/3/5 | 76 s |
| Live vehicles count for planning | 34.7% | 37% | 11.6% | 13.2% | 0.54 | 7/2/3 | 115 s |
| No cover penalty in target score | 41% | 42.7% | 13.4% | 11.8% | 0.41 | 4/1/7 | 133 s |
| Keep shelter when spacing | 33% | 35% | 10.4% | 12% | 0.42 | 4/2/6 | 192 s |

The target-score cover penalty accounts for the largest observed shift in hit location: removing it raises cover-tile hit share from 33.8% to 41.0%. The three original suspects each change it by at most 2.6 percentage points here. Removing spacing also restores crowding, from 10.8% to 42.2%, so it is not a useful fix. The shelter-preserving fallback fixes a specific move-destination bug, but its aggregate hit share remains 33.0%. These small samples do not establish causality for all of the remaining difference, faction balance, or overall protection. Keep the target-role rules and spacing, and use independent occupancy samples to interpret the hit metric.

Final reviewed code, including the visible-neighbor salvo fix, versus master: six Conquest matches each, seeds 100003 through 100008, same map/army/AI settings. The cover-time estimate counts five-second samples of dismounted, ungarrisoned infantry, including moving squads.

| Build | Unit time on cover tiles | Hits on cover tiles | Crowded idle squads | Rear vehicle hits | Closeness | USA/GER/USSR wins | Runtime |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Master 41eefe8 | 25.4% (8941 samples) | 45.4% | 42.1% | 16.0% | 0.42 | 3/0/3 | 74 s |
| Final reviewed feature | 25.0% (8859 samples) | 32.2% | 11.5% | 13.0% | 0.43 | 3/1/2 | 56 s |

Occupancy is closely matched in this small pair while hit location shifts substantially. That is consistent with enemies preferring exposed infantry. It does not establish equal damage taken or settle faction balance; the larger paired Conquest and Classic comparison is recorded below. No defense orders were removed to change these numbers.

### Full paired comparison

Completed the issue #17 gate: 300 Conquest and 120 Classic matches per build on Three Crossroads, three adaptive AI seats, standard starting armies, shuffled spawns. Both builds use seeds 100003 through 100302 for Conquest and 100003 through 100122 for Classic. Each batch used two workers, with at most four workers across concurrent batches. Master is `41eefe8`; the final frozen build combines the reconciled unit behavior, formation simulation and integrated AI planner. The final sim SHA-256 is `d7013427a04ee4189d9f4a4b73226870ee575bbe716be736c2f52ad0045bb61e`; AI SHA-256 is `1614db36fd3086d579fcbeb3d46694e66a9719151734dc0a279f03f84760e16f`. All ten shared/map/package digests still matched the integration source when the completed results were checked.

| Measure | Master Conquest | Integrated Conquest | Master Classic | Integrated Classic |
| --- | --- | --- | --- | --- |
| Matches | 300 | 300 | 120 | 120 |
| Draws | 0 | 0 | 0 | 2 |
| USA/GER/USSR wins | 102/91/107 | 98/101/101 | 41/39/40 | 30/43/45 |
| Mean / median length (min) | 8.23 / 7.72 | 8.45 / 8.46 | 20.80 / 20.01 | 21.40 / 20.91 |
| 2nd-place VP / winner | 0.46 | 0.5 | n/a | n/a |
| Lead changes / match | 0.86 | 1.01 | n/a | n/a |
| Decided before Sudden Death | n/a | n/a | 76/120 (63.3%) | 74/120 (61.7%) |
| Sampled infantry time on cover tiles | 27.3% | 25.8% | 32.3% | 32.1% |
| Infantry occupancy samples | 458095 | 464877 | 744051 | 762203 |
| Infantry hits on cover tiles | 46.5% | 35.6% | 35.6% | 31.7% |
| Infantry hits with graded shelter | 48.2% | 37.7% | 41.1% | 37.4% |
| Crowded idle squads | 44.5% | 11.7% | 47.9% | 35.3% |
| Rear / front vehicle hits | 19.3% / 51.4% | 13.7% / 67% | 8.2% / 74.9% | 4.2% / 89.1% |
| AT shots on vehicles | 15.8% | 16.5% | 3.7% | 4.1% |
| MG shots on infantry | 91.3% | 90% | 45.2% | 54.9% |
| Kills / match | 10.9 | 11.8 | 72.3 | 70.4 |
| Measured wall runtime, 2 workers | 504 s | 637 s | 1476 s | 897 s |

All 840 matches ended normally: 838 had winners and two integrated Classic matches ended in Sudden Death draws at 26.67 min (seeds 100037 and 100115). Neither mode hit its runner cap (40 min Conquest, 60 min Classic). Runtime measures include concurrent host work and do not establish a performance difference. Faction wins in Conquest are 34.0/30.3/35.7% on master and 32.7/33.7/33.7% in the integrated build. Classic wins are 34.2/32.5/33.3% versus 25.0/35.8/37.5%. These samples measure the combined behavior and AI changes; they do not isolate either change's causal effect or establish exact faction equality.

The cover occupancy estimate and the hit-location shares answer different questions. The Conquest cover-time estimate falls 1.5 percentage points while hits on cover tiles fall 10.9 points. The diagnostic target-score variant shows that target choice can move hit share substantially. The final comparison does not directly measure damage saved by cover, so the lower hit share alone does not show weaker cover protection. No defense orders, unit prices, health or weapon stats were removed or tuned to obtain these measurements.


## AI difficulty (2026-10-01, issue 27)

The lobby host chooses Easy, Normal or Hard independently for each AI seat. New seats,
human handovers and the Horde itself default to Normal. The server accepts only a valid
level on an AI seat while the room is in the lobby; humans and guests cannot change it.

All levels have the same resources, recruitment costs and delivered fog observations.
Planning receives only the detached view and acts through the seat-bound command handle.
Sightings come from the delivered view, including when the planner is given an older view
between snapshots. Hidden armies, private timers, terrain, mines, economy and enemy
queues cannot enter difficulty decisions.

- Easy decides every 6 seconds, disables Classic adaptive rules, keeps 250 manpower
  (40 munitions in Classic) before support, waits 45 seconds between calls, leaves
  enemy-held points alone for 150 seconds and needs ten units before attacking a base.
- Normal decides every 2 seconds and keeps the existing three-unit attack groups and
  six-unit base attacks. It retains Classic adaptation, weather caution, medics, mine
  work, supply reconnection and the Horde rules.
- Hard decides every second and remembers delivered sightings for 60 seconds. It buys
  counters from remembered armor and recent aircraft, attacks held points in pairs
  with at least 1.2 times the observed value, falls back below half health and defends
  held points. Barrage clusters use visible enemies and avoid nearby friendly ground
  units. Focus fire uses only visible targets and line of sight on remembered terrain.
- Every level recognizes light and medium tanks and Tigers, withdraws multi-model
  squads at their last model, waits for reinforcement at completed allied production
  buildings in Classic, and refuses held-point attacks below two-thirds of the defenders'
  observed value. A hurt squad waiting at base stays there when manpower runs out.

`tools/ai-balance.mjs` retains its three-faction default and accepts two difficulty seats,
`--rotate` and an alternate AI module for same-simulation comparisons. Duels swap seats
every other match and cycle all nine faction pairs, using seed 1 and the default map.
The server's two-tick observation delivery and each difficulty's decision interval are
reproduced. Balance results are recorded below.

Review regressions cover a second focus order preserving an already queued attack-move,
cancelling a visible target that starts retreating, and immediate reconnection of an
allied cut point during Easy's opening grace period. The integrated behavior change also
fixes the grid-ray endpoint case for exact terrain-cell corners.


Balance pilots on the reviewed source, seed 1, 18 matches per row:

| Mode | Seats | Wins | Draws | Timeouts |
| --- | --- | --- | --- | --- |
| Conquest | Hard / Normal | 14 / 4 | 0 | 0 |
| Conquest | Easy / Normal | 2 / 16 | 0 | 0 |
| Conquest | Normal / current master | 9 / 9 | 0 | 0 |
| Classic | Hard / Normal | 11 / 7 | 0 | 0 |
| Classic | Easy / Normal | 3 / 15 | 0 | 0 |
| Classic | Normal / current master | 6 / 12 | 0 | 0 |

These small pilots do not reproduce the older 60-match Conquest or 40-match Classic
samples. Per-match seeds, outcomes and simulation lengths are saved in
`docs/ai-difficulty-balance.json`. The current-master comparison uses the AI from
`41eefe8`. Both controllers used the same `41eefe8` simulation, map and observation delivery.

## Individual infantry movement (2026-10-01)

- Each squad remains one server unit. Its rendered men follow the authoritative center in world space, with different stride phases, response times and turning rates. A small separation pass keeps shoulders apart during corners. Visual offsets stay within the formation's footprint and a 0.65 m allowance.
- Leg IK builds eight marching frames and four frames each for moving aim, crouch walking and prone crawling. Their weights follow each man's actual travel, with a planted foot during walking. Idle returns to the existing standing, kneeling or prone pose. The first three posture morphs retain their original indices.
- Moving fire blends toward an aiming gait over 0.3 s. Weapon tips use the same morph weights and pose transform as the geometry, so muzzle flashes stay attached while aiming, carrying or changing posture. Retreat still carries the weapon.
- Hidden, newly visible and transported squads reset their visual followers. Trench seating stays fixed, and leaving a destroyed trench restores the home slots. Men sample local ground height outside trenches. Health still controls which men are visible and where each corpse is placed. A corpse is that man in a slack fallen pose, uniform, helmet and kit included, not the combat prone he aims from. Corpses are instanced up to 200 across the match, and each one sinks while it fades.
- Near and far figures retain one draw per soldier. Gait weights, pose values and muzzle vectors are reused per man. Across all factions and kits, 180 cached near/far geometries add 36.47 MiB of baked morph attributes, with an estimated 48.63 MiB of extra GPU morph textures. A standalone 100-squad (1,500-men) animation benchmark measured 4.57 ms median and 53.67 ms p95 wall time over 300 frames during concurrent test runs. The combined Massive-match GPU measurements are recorded in `docs/issue-batch-verification.md`.
- The model viewer's `motion=1` mode walks, stops and turns a squad. `posture=1` and `posture=2` check low movement, and the lower row shows an individual soldier.

### Troop selection (2026-10-01)

Click and box selection use projected bounds of each visible model mesh, squad centers and health bars. Posture bounds blend with the rendered morph weights, and near-plane intersections are clipped before projection. Selection and owner rings never count as troop geometry. Garrisoned squads use their roof bars. A box selects a squad when it overlaps any displayed mesh bounds, with 6 px of click forgiveness around those bounds; houses and scenery never block troop selection. Troops take priority over production buildings on a click. Double-click uses the same visible targets and excludes dead squads, passengers and parked aircraft. Release distance also detects a box drag when a mousemove event was missed. Saved groups retain living passenger and parked-aircraft IDs but skip them during recall until they become selectable again. This changes input targeting only, with no balance changes.

Full raw results and source manifests: [behavior balance evidence](docs/behavior-balance-2026-10-01.md). Combined browser checks and GPU measurements: [verification](docs/issue-batch-verification.md).

## Conscript population and smoke (2026-10-01)

- Units can take a fraction of the army limit: `UNITS[type].pop` (default 1), read through `popUse`. Conscripts are 0.75. `popOf`, paratrooper reservations, the buy check (`pop + popUse(unit) > popCap`), the client's `availability`/`buyCount` and the HUD all weigh units the same way.
- Smoke blocks a sight line only when the line is at least `CFG.smokeSight` (15 m) long. `los` and the fog's `fogLos` share the rule, so the drawn fog matches what units can see and shoot. Cloud sizes and durations are unchanged.
- Why: a unit inside smoke was hidden beyond the 6 m close-sight rule and could not be targeted at all, so tank smoke and smoke barrages made units close to invulnerable. Conscripts were meant as human waves but were held to the same squad count as everyone else.
- 150 AI matches, default map, seed 1000, before -> after: USA/Germany/USSR 39/58/53 -> 46/46/58, median 473 s -> 465 s.

## Map data: landmarks, point kinds and links, triggers (2026-10-02)
- `buildings: [{ x, y, kind }]`: an entry on any cell of a house names its type from `CFG.houses` (church: 700 hp,
  0.25x, garrison vision 1.6; factory: 1000 hp, 0.2x, vision 1.4; or a size type by name). `min: Infinity` keeps
  the landmarks out of the size rule. `kind: 'stone bridge'` on a bridge cell makes its whole span take
  `CFG.stoneBridge` (12) times the hits, so one bomb or satchel no longer drops it. The client draws churches with the
  church look, factories as multi-storey blocks and stone bridges with a stone deck. The house type now rides in unit
  flag bits 20-22 (it was 16-17, which only fit four types).
- Point `kind`: `radio` (the holding side's support cooldowns run `CFG.radioCd` 1.5x as fast) or `depot` (reinforce
  and repair within `CFG.reinforceRadius`, like home). A point that is cut off from its HQ does neither. Chosen
  because both work through code the AI and client already read: cooldowns and reinforcement need no new AI logic.
  A radio post that reveals ground was dropped: it would mean a new source in the fog masks.
- Point `needs: <index>`: a side takes the point only while it holds the needed one (both sides, so put it on the
  path from the side it should slow down). The snapshot's point row has a 6th value, 1 when your side is locked out;
  the client shows "Locked" and a dashed minimap line, and the AI skips locked points when picking targets. Loops are
  refused by `validateMap`.
- `triggers: [{ at, say?, blow? }]`: at `at` seconds, `say` goes to every player as a 15 s alert line and `blow`
  wrecks every structure in the box `[x0, y0, x1, y1]` (a bridge drops whole with anyone on it). Time is the only
  condition so far; "point taken" or "area entered" can follow when a scenario needs one. No editor control yet.
- The editor and the server keep every field `validateMap` checks (they dropped naval, trenchFacing, assaultTime and
  spawn `assault` flags before).
- Not done: cells holding two things (a mine under a road). Mines are the `N` terrain type, so a layer means touching
  every mine check, the fog rule that hides them and the client's road drawing.
- The Great Bridge (120x100, `tools/genmap-bridge.mjs`): Assault, attackers west, defenders in a river town east. A
  stone bridge on the main road is blown at 7:00 (warnings at 5:00 and 6:40); the ways round are a ford to the north
  and a plank rail bridge to the south. The town square (depot) needs the bridge's east end. With the defender spawns
  on the map's east edge (x 113) the AI defender never reached the bridge (it holds points within 70 m of home) and
  attackers won 3/4 (2v2); spawns moved into the town (x 102). 20 AI 1v1 assaults: attackers win 4/20 (Seawall, kept,
  is 4/20). The AI attacker uses the ford and once rebuilt a plank bridge where the great one fell.

## Map design rules (2026-10-02)

Researched from Company of Heroes 2/3 map threads and patch notes (coh2.org map overhaul, Angoville, map size
discussion), StarCraft map-making guides, CS level design, and three papers that measure maps on a grid: Togelius
et al. 2010 (StarCraft map space), Liapis et al. 2013 (map sketches, tile safety) and Uriarte & Ontañón (PSMAGE).
The rules we measure, with the numbers we use:

- Fairness by walking distance, not by eye. `tools/mapstats.mjs` walks 8 ways like the pathfinder (houses, water and
  cliff steps block, a ford costs 3x). A 4-way walk overstated diagonal routes by about 40% and made Default and
  River Towns look unfair when they split the points evenly.
- Point safety (Liapis): s = (enemy walk - own walk) / (enemy walk + own walk), against the nearest enemy. Over 0.35
  (the enemy walks 2x further) is a home point, under 0.1 for every side is contested. CoH gives each side its own
  resource about a third of the way to the front (safety about 2) and fights over the middle.
- Killing fields: on the shortest route between enemy HQs, no stretch over about 12 cells (24 m) without cover within
  2 cells. An HQ's own 8-cell doorstep stays clear (CoH removed hard cover near bases).
- Lanes: 2-3 separate routes at most 1.35x the shortest. Chokes under 6 cells are a funnel a few guns can hold.
- Dead space: walkable ground more than a quarter of the rush walk from every point and HQ is ground nobody visits.
- Sight lines through a point are broken by bushes or hedges, so one MG cannot see every approach.

`tools/mapwork.mjs` applies two of them to finished maps, through each map's own symmetry (point mirror or rotation
about the HQs' center, found by checking which transforms send HQs to HQs and most features onto themselves):

- Cover: every bare stretch of 12 cells on a walk from an HQ to each point and enemy HQ, and between neighbouring
  points, gets a pair of shell holes on both sides of the route (every third a pair of bushes). Shell holes only on
  flat ground away from water (a hole on a slope or bank tears the ground mesh: the relief test caught it on The
  Polder).
- Home points: on Conquest maps without defenders, with 2-4 HQs and room under the 9-point cap, each HQ gets a point
  worth no VP and 1 MP/s, about a third of the walk to the nearest enemy, with safety over 0.35, in the corridor
  toward the front (own walk + enemy walk at most 1.2x the rush walk), 6+ cells from the map edge, a little off the
  main route. Supply lines can still cut it, so it is a raid target. The AI takes it early (its point score counts
  distance and MP).
- Applied to Default, River Towns, Ardennes Crossing, Twin Valleys, The Polder, No Man's Land, Crater Field,
  Crossroads Village (home points and cover), King of the Hill, Six Fronts, Island Towns (cover only: 7 points and 6
  HQs leave no room). Bare stretches: Six Fronts 49 -> 10 cells, Ardennes 52 -> 9, King of the Hill 37 -> 10, Island
  Towns 58 -> 21 (its long bridges stay bare). Dead space on Default 44% -> 29%.
- Not applied to Assault maps: their balance was tuned with AI runs, and their funnels (Hot Gates, Monte Cassino's
  zigzag) are the set piece. By the rules they break (one lane, chokes of 5), they would need a second route.
- Balance (120 AI free-for-all Conquest matches per map, old maps vs new, wins by spawn and median length): Default
  39/40/41 -> 44/36/40, 9.3 -> 9.3 min, runner-up VP 0.61 -> 0.64 of the winner's (closer games); Ardennes 46/13/57/4
  -> 43/15/54/8, 9.3 -> 8.8 min; Twin Valleys 32/21/21/46 -> 36/22/22/40, 10.1 -> 10.0; The Polder 34/26/30/30 ->
  26/27/41/26, 11.6 -> 10.8; No Man's Land 32/24/41/23 -> 29/27/39/25, 11.0 -> 10.3; Crater Field 32/23/36/29 ->
  37/26/26/31, 9.8 -> 10.0; Crossroads Village (2 players) 51/69 -> 55/65, 8.2 -> 7.2; River Towns 48/34/38 ->
  45/40/35, 9.5 -> 9.5; King of the Hill 17/22/15/13/30/23 -> 14/19/10/24/28/25, 10.1 -> 10.4; Six Fronts
  12/17/26/22/22/21 -> 24/15/28/18/16/19, 11.4 -> 11.8. Spawn spreads stay within noise; the home points bring the
  first fights forward, so 2-side maps run up to 11% shorter. Faction wins by seat are noisy at 120 matches, so River
  Towns' GER 57 of 120 after (44 before) needs a recheck before reading anything into it. Island Towns (new) and the
  River Towns recheck were not run: the batch was stopped when the machine ran low on memory.
- Found: the 2-side mirrored maps (Ardennes, Twin Valleys, Polder, No Man's Land, Crater Field) are fair for two
  teams, not as a 4-player free-for-all: on Ardennes the two HQs of one mirror pair won 100 of 120 FFA AI matches
  before and after the rework. Research agrees a map built for one format compromises the other. Left as is.
- Found: `spawnDistances` (shared/sim.js) says cliffs block but only checks houses and water, so seating on cliff
  maps can misjudge who is near whom. Left for the pathfinding work.
