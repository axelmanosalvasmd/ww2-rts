# Three Crossroads: design decisions

WW2 tactics RTS in the browser for three friends. Decided 2026-09-30.

## Game
- Tactics skirmish, no base building outside Classic mode. PvP: 1v1 or 3-player FFA, joined by room link (`/#code`). The host can add AI opponents.
- Win: first to 1200 VP. The center gives 2 VP/s and no manpower; villages give 1 VP/s + 1.5 MP/s.
- Economy is mostly flat (4 MP/s base). Trailing players get up to +4 MP/s catch-up (1 per 80 VP behind the leader).
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
  rifle squad, MG team, AT gun, light tank. Squads are one sim entity with N models.
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

## Assault mode (attack & defend)
- Host picks Conquest (VP race) or Assault in the lobby, and which team defends; every other team attacks as one.
- Each defender gets a Command Bunker (3000 hp, MG slit, always visible) between their HQ and a generated line of
  trenches and sandbag walls facing the map center. Direct fire does 25% to it; explosives use their demolition value
  (bomb 400, satchel 600, rocket 120, shell 90), so every destruction tool is a way in.
- Attackers win when every bunker is down; defenders win when the 15:00 clock runs out. No VP; points give manpower.
- Attackers start with 320 MP and +5/s, defenders 250 and +3.5/s. 90 AI 1v1 assaults per map, attacker wins:
  50% (default), 61% (River Towns). 3v3 on Six Fronts runs (3 bunkers).
- A map can reserve spawns for the defenders with `"defend": [spawn numbers]`; attackers get the rest. Without it,
  spawns are shuffled as usual.
- Map pack (`tools/genmap-pack.js`): 5 assault maps with `defend`, 5 point-symmetric 2-side conquest maps (drawn with
  a mirroring canvas, so every cell has its twin through the center) and 2 six-player rotational maps.
  Cliffs are 2+ level steps; ramps are single-level cells cut through them. Hedges block sight, not movement.
  AI 1v1 assault, attacker wins: Bocage 6/10, Monte Cassino 7/10, Stalingrad 4/10, Pegasus ~35/40, Seawall ~35/40
  (runs swing 7-10/10 between identical configs). Defender income didn't move Pegasus/Seawall: bombs do most of the
  bunker damage. Crossroads Village 1v1 by spawn: 15/9 over 24 (mirrored, so likely noise).
- Hill 112 (80x110, `tools/genmap.js`): defenders on a level-4 plateau, attackers at level 0. On the upper slope
  the flanks are a 2-level cliff, so the climb funnels through a central ramp or narrow paths at the map edges.
  The AI defender only holds points within 70 m of home, which here is just the summit, so the summit's MP
  decides the balance: AI 1v1 assault, attacker wins 13/20 at summit mp 1, 14/20 at 1.25, 7/30 at 1.5 (kept:
  the hill should favour the defender). Small samples; the swing between 1.25 and 1.5 is large.
- Bug found while testing: veterancy thresholds are multiples of unit cost, so the free bunker counted as a 3-star
  veteran. Free units never rank up now.

## Command & readability (slice after destruction)
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
- Economy: MP comes from an HQ trickle of 2/s plus the node rate of each Supply Depot: 1.5/s on home nodes, 2.5/s on
  the contested ones by the villages (so they're worth fighting for). Upkeep: each fielded unit costs 0.08% of its price
  per second off the income (min 0.5/s). Doubling upkeep only lengthened games (20.2 min median) without curbing the
  leader's MP banking at the pop cap, so it stays gentle; banking needs something to spend on. Depots only go on Resource Nodes (one each).
  No catch-up. Start: HQ, 1 Engineer, 1 rifle squad, 200 MP. Pop cap 20 in Classic (buildings excluded, queued units
  count): at 12 the leader sat at the cap banking thousands of MP and games stalled.
- Resource Nodes: generated per match: 2 home nodes per spawn (~12 cells out, toward the flanks) and 1 beside each point
  with mp > 0. None at the center. (Hand-placed nodes in the map file wait for the editor Node tool.)
- Munitions: a second currency, Classic only, earned from held points at 1.5 x the point's vp (center 3/s, village 1.5/s),
  full rate for every teammate. It pays for off-map support and unit abilities (abilities keep their cooldowns).
- Buildings: HQ (4000 hp; Engineers, rifles; unique, can't be rebuilt), Supply Depot (60 MP, 600 hp), Barracks
  (150 MP, 2000 hp; MG, faction infantry), Motor Pool (200 MP, 2500 hp; tanks, AT, rockets, Tiger; needs a Barracks).
  One tier; no upgrades or research. Barracks and Motor Pool can't cover a resource node.
- Buildings are timber, not bunker concrete: guns with 20+ anti-tank damage hit them fully, small arms do 25% of their
  anti-infantry damage. With the bunker rule (25% of anti-tank damage) a rifle hit did 0.1 and armies shot at bases forever.
- Training times: Engineer 12s, rifle 15, conscript 12, MG 18, Ranger 20, AT 22, rocket 30, tank 35, Tiger 50.
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

## Tech
- Plain JS ES modules, no build step. Deps: `ws` (server), `three` (client).
- Server-authoritative: `shared/sim.js` runs at 20 Hz on the server and snapshots go out at 10 Hz.
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
