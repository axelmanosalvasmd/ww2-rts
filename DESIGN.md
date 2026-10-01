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
- Each spawn is a visible HQ: tinted reinforce zone, sandbags, tent, tall flag, name label. H jumps home.
- Spawns are shuffled each match: a 3-way map is never perfectly fair on a square grid.
- Up to 6 players, 2-6 spawns per map, maps up to 256x256. Spawns are listed in order around the map; teammates
  get neighbouring spawns and fewer players spread out (spawnSlots). The host sets teams, each player picks a faction.
  Teams share vision, can't target each other, hold each other's points, and win on combined VP; the goal scales
  with average team size (3v3 plays to 3600) so team games last about as long as a 1v1.
- Factions are cosmetic (USA / Germany / USSR by slot). Same roster and stats for everyone:
  rifle squad, MG team, AT gun, light tank, plus (2026-09-30) mortar team, sniper, armored car, medium tank.
  Squads are one sim entity with N models.
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
- Garrison: right-click a house with rifles/MGs. One squad per house cell (edge cells, so they can shoot out).
  Inside: 35% incoming accuracy, +25% vision, blasts halved. House wrecked -> thrown out with 30% damage.
- Tanks shell a house on right-click (fire-at), and every tank round damages the structure it lands on.
- Directional cover: a house, wall, rubble, hedge or vehicle within ~2 m on the shooter's side = 50% cover from that shooter.
- Veterancy: damage dealt of 1/2.5/5x the unit's cost = 1-3 stars (+10% accuracy, -8% damage, -15% suppression each).
- Rocket launcher (250 MP; T34 Calliope / Panzerwerfer / Katyusha): 8-rocket salvo up to 70 m on anything its side can
  see, no line of sight needed, +50% vs garrisons, 20s reload. F = Rocket Barrage on any clicked spot.
- Bombing run (250 MP, N): 6 heavy bombs in a line, 7 m blasts, big craters, 400 structure damage per bomb. Each bomb
  lowers a 3x3 patch one level, each artillery shell one cell (never more than one below a neighbour, so no
  inescapable pits).
- Balance: garrisons alone dropped 2nd place to 55%; with rockets it's back to 63% (default) / 61% (River Towns).

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

## Aviation (2026-10-01, all modes)
- Off-map air support adds Dive Bomber, Paratroopers and Fighter Cover (point supports, one click). Support planes
  (recon, strafe, bombing, dive, paratroopers) can be shot down on arrival: fighter cover always (and is used up; never
  recon), each flak in range rolls its chance (flak gun / mobile flak 35%, emplacement 45%).
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

## Weather (lobby setting, 2026-10-01, all modes)
- One state at a time, the same for every side. Clear: no effect. Ground fog: sight -30%. Rain: sight -15%, vehicles
  -20% off roads. Mud: infantry -10%, vehicles -30% off roads. Snow: sight -10%, infantry -10%, vehicles -15%.
  Planes, recon flights and the units' own stats are untouched: `shared/weather.js` gives the sim two multipliers,
  `sightMul` (vision, for ground units and buildings) and `speedMul` (movement), read in one place each in sim.js.
- Roads: the sim had no road layer, so `roadMask` follows the ground painter (client/ground.js): open ground next to a
  house is a village street unless it lies by water, and bridges are roads. A crater ends the road there. The client
  paints mud along the same streets.
- Lobby: the host picks Map default / Clear / Fog / Rain / Mud / Snow / Random (`room.weather`, message `weather`).
  Map default reads a `weather` field in the map file, else the map's mood: snowy maps (Ardennes) snow, misty river
  dawns (Pegasus, Polder, River Towns) start in ground fog that lifts at 4:00, every other map is clear. A host's pick
  holds all match. Random is seeded per match: any state, and half the time fog lifts at 3:30 to 4:30 or rain turns
  to mud at 5:00 to 7:00. At most one change per match, announced to everyone 10 seconds before in every snapshot
  (`weather: [now, next, seconds]`).
- Screen: one line under the score strip in plain words ("Rain: sight -15%, vehicles -20% off roads"), brass while
  it is about to change. `client/atmosphere.js` eases the haze, fog color, sun and shadows over a few seconds, and
  adds fog banks, rain streaks, falling snow, wet ground with puddle sheen, mud along the streets and snow cover
  (one ground layer shader). Rain and snow stay on Graphics Low with a third of the drops. The light mood is fixed
  per match: snow brings the winter light, rain and mud an overcast sky, fog and clear keep the map's mood.
- AI: `aiCaution` (1 in clear weather, 1.2 in mud and snow, 1.3 in rain, 1.43 in fog) raises the army margin and
  size it wants before marching on a Classic base or an Assault bunker (6 units in clear weather, 9 in fog), since it
  has seen less of the enemy and its tanks arrive late. Conquest point attacks keep groups of 3: scaling those to 4 made Conquest one-sided (2nd place VP
  0.26 of the winner's and 6.3 min matches with Clear stats; 0.34 to 0.37 and 7 min in fog, rain and snow).
- Balance (default map, 3 AIs, factions USA/GER/USSR by slot, spawns shuffled; leader changes checked every 10 s):
  | Weather | Conquest (40 each): 2nd place VP vs winner, leader changes, length, faction wins | Classic (20 each): length, decided before Sudden Death, winner's HQ health left, faction wins |
  |---|---|---|
  | Clear | 0.59, 1.88, 9.2 min, 6/20/14 | 19.7 min, 17/20, 88%, 6/7/6 and 1 draw |
  | Fog | 0.63, 1.93, 9.6 min, 14/15/11 | 19.9 min, 14/20, 76%, 6/8/6 |
  | Rain | 0.62, 2.05, 9.3 min, 16/16/8 | 20.0 min, 16/20, 85%, 6/9/4 and 1 draw |
  | Snow | 0.62, 1.80, 9.1 min, 15/13/12 | 19.2 min, 15/20, 76%, 9/5/6 |
  No weather comes out one-sided: closeness and length stay within the noise of Clear. The faction splits swing by
  about 3 wins either way at 40 matches; Clear (the unchanged game) has the widest one, in line with the older
  150-match Germany lead (45/63/42). Mud was not measured.

## Look and feel (decided 2026-10-01)
Art direction: **sand table**. The battlefield reads as a painted terrain model on a commander's planning table; the HUD
is the paperwork around it. Concepts in `docs/concepts/`: `e-mix-acetate.jpg` is the target, `a-sand-table.jpg` the world
mood, `c-clean-modern.jpg` the restraint (slim panels, small screen coverage), `before-conquest.jpg` where we started.
The concept images show richer models than ours; the models stay procedural, so the look comes from paint, light and
the HUD.
- Screens: designed at 1920x1080, must fit 1366x768 without overlap. No phone layout. 60 fps target on laptop graphics.
- Graphics setting (menu): High / Low, saved per browser. Low drops the edge blur, uses cheaper shadows and fewer
  particles. Defaults to High; switches itself to Low with a one-line notice if the game runs under 45 fps for 5 s.
- World:
  - Ground painted from tileable textures (grass, dirt, mud, road, field) generated with gpt-image-2 and blended per
    cell; contour lines stay. Craters and scorch marks are painted into the ground.
  - Warm low sun, soft shadows, slightly saturated "painted miniature" colors, a light haze.
  - A slight blur only along the far (top) edge of the screen, subtle enough that units there stay readable. Off on Low.
  - Beyond the map edge: a dark wooden planning table with the terrain board's cut earth edge showing (no grey void).
  - Unit markers: the class badge over each unit becomes the same military map symbol the HUD uses, drawn in the
    owner's color. Health bar, cover shield and veterancy stay.
  - Order lines and range rings drawn like grease pencil on the table (slightly rough strokes, arrowheads on routes).
    Colors keep their meaning: blue move, orange attack-move, white retreat, red attack, yellow dig/build.
- Player colors (grease pencil, they read on grass, the dark strip and manila): blue `#3b73d6`, red `#cc3a2e`, chalk
  `#ece6d6`, orange `#e2832b`, violet `#9b5cd4`, cyan `#35b6c0`. A 1v1 is blue against red. Gold and green are gone:
  gold clashed with the brass accent and manila, green vanished on grass.
- HUD (panel style "E"): a dark translucent olive-charcoal strip (`#22251b` at ~85%) holds everything; only the Command
  Card's unit cards and the selected-unit list are manila cards (`#d8c69a`) with dark brown ink (`#2b2418`). Light text
  on the strip `#e6dcc0`, brass `#d2a849` for big numbers, grease-pencil red `#b8322a` for danger.
- Type: Courier Prime (typewriter) for all HUD text, Stardos Stencil only for big numbers (MP, VP, clock, HQ labels).
  No all-caps labels, nothing under 13 px. IBM Plex Mono is gone.
- Unit icons everywhere: period military map symbols (infantry box with an X, armor box with an oval, artillery box
  with a dot, and so on), one symbol per unit type, full name and role in a tooltip. Faction markings next to player
  names in the score panel: US star, German cross, Soviet star.
- Layout: score and clock top center; MP / Munitions / Fuel, income and pop top right with the support calls as an icon
  row under them; bottom left the selection list and its orders (icon grid with hotkeys); bottom center the Command
  Card (always-visible recruit row outside Classic, grouped Infantry / Support weapons / Vehicles; train and build in
  Classic); bottom right the minimap. Nothing overlaps at 1366x768. The always-on keybinding panel is parked
  (issue #2); hotkeys show on buttons.
- Lobby: same style, the room form as a manila order card. The map editor only takes the new fonts and colors.
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
- As built, round 2 (props): `client/props.js` (`createProps({ map, grid, hAt, parent })`) places painted scenery
  from integer hash seeds, so every browser and late joiner sees the same trees, poplar rows, pines, bushes, rocks,
  fences, haystacks and crates. One InstancedMesh per kind, kept clear of spawns, points, the paths between points and
  resource nodes (`setNodes`); `refresh()` after terrain changes, and Graphics Low shows half of them.
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
- Fort keys are a Shift layer: T trench, Shift+Y sandbags, Shift+U wire, Shift+I traps, Shift+O nest. Plain Y/U/I/O
  keep the Classic build and support actions. `client/keys.js` is the single binding table and test.js rejects
  duplicate chords.
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
- Adaptive snapshot interval: rooms start at every 2 ticks (10 Hz) and stretch to 3, then 4, when the snapshot-tick p95
  over 50 samples exceeds 40 ms. They recover one step after 10 s under 24 ms. The client smooths units over the
  measured gap (60 to 400 ms).
- Snapshot cache: `snapshotCache(g)` is built once per send and passed as the fifth argument to `snapshotFor`. Without
  it, `snapshotFor` reads live state. Owner orders and the mode row with Assault total and Annihilation bunkers are
  cached. Rally, contested and the fog lift stay per player.
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
  5 triangles per cell, at most 150k). A Graphics change swaps the define, recompiles through the program cache key
  and rebuilds the geometry. Structures on Low drop duckboards, half the shrubs and small-part shadows. The atmosphere
  on Low turns off cloud shade, blowing dust and birds, and keeps the table props, the lamp pool, fewer mist sheets
  and fog banks, and the match weather's rain or snow with a third of the drops.
- Structures: `client/structures.js` rebuilds the map pieces (houses, church, barns, bocage banks, capped walls,
  sandbags, trenches, rubble, wire, tank traps, bridges) from the grid as one InstancedMesh per kind, seated on `hAt`.
  It never changes gameplay cells. The five base buildings are one merged, vertex-colored model per type and team
  (`buildingModel`). Map pieces darken in the fog through `fogShader` and `setFogMap(tex, MW, MH)` in
  `client/surfaces.js`. It imports `/shared/sim.js` by absolute path, so it is browser only.
- Atmosphere: `client/atmosphere.js` picks a mood from the map name (warm, dawn with river mist, overcast, snow, dust)
  and the match weather (see Weather; the name rules live in `shared/weather.js` so Map default agrees), drifts cloud shadows over the board and table, sets out the planning-table props and the desk lamp, and flies a few
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

## Tech
- Plain JS ES modules, no build step. Deps: `ws` (server), `three` (client).
- Server-authoritative: `shared/sim.js` runs at 20 Hz on the server and snapshots go out at 10 Hz (every 3 or 4
  ticks while a room falls behind, see round 3 above).
  Clients send commands and smooth toward the latest snapshot.
- All command validation lives in `command()` in `shared/sim.js`.
- Map = grid of cells (2 m). `B` building, `H` hedgerow, `#` wall, `+` crater. LOS, pathing (A*), and cover all read the grid.
- Hosted on the owner's PC in Ecuador, reached by friends over Tailscale (`tailscale serve`).

## Roadmap
1. ~~Tracer bullet~~ 2. ~~Combat~~ 3. ~~LOS + fog~~ 4. ~~Points, VP, manpower, call-ins~~ (MVP)
5. ~~In-game map editor~~ (`/?edit`): paint terrain, place spawns and points, per-point VP/MP, save with the `.edit-password`,
   fairness test (90 AI matches in a worker, per-spawn win rate). The host picks the map in the lobby.
   Select / move tool grabs a whole structure (drag to move, Delete removes) and drags spawns and points; Raise/Lower brushes.
6. ~~Destructible terrain, rivers, bridges~~: W river (impassable, see across), F ford (half speed), = bridge, R rubble.
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
   - USA Ranger Squad (185): 6 elite men with bazookas; Satchel Charge demolishes a house, wall or bridge.
   - Germany Tiger (620, max 1): 900 hp, big gun, front armor takes 70%.
   - USSR Conscripts (80): 7 cheap men; Ura! = 6s sprint that ignores suppression.
   300 AI matches per map, wins by faction USA/GER/USSR: 37/33/30% (default), 36/35/30% (River Towns).
   Before tuning: USSR won 74% (conscripts at 60 MP were too efficient) and the German AI stalled saving for the Tiger.

Tuning knobs: `CFG` and `UNITS` at the top of `shared/sim.js`.

## Field fortifications
- `FORTS` in sim.js: trench (T, 30), sandbags (#, 20), barbed wire (X, 25), tank traps (Y, 40), MG nest (6 cells, 60).
  Built by rifle squads, conscripts and engineers (`CFG.fortBuilders`); one cell per `digTime` (3 s, engineers 1.5 s).
- New terrain flags: WIRE (infantry speed x `wireSpeed` 0.35, +4 path cost so squads route around; tanks crush it;
  40 hp) and VBLOCK (vehicles' paths treat it as a wall; infantry pass and get cover; 250 hp). findPath picks the
  blocking mask from the moving unit's type.
- Only open ground, craters and rubble take a fortification, so nobody builds on bridges, fords or in houses.
