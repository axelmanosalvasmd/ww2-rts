# Three Crossroads: design decisions

WW2 tactics RTS in the browser for three friends. Decided 2026-09-30.

## Game
- Tactics skirmish, no base building. PvP: 1v1 or 3-player FFA, joined by room link (`/#code`). The host can add AI opponents.
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

## Command & readability (slice after destruction)
- Minimap (bottom-right), rotated with the camera: terrain, fog, points, HQs, units, strike warnings, camera view.
  Left-click/drag looks, right-click moves the selection (Ctrl = attack-move).
- Attack-move: G then click, or Ctrl+right-click. Units halt to fight what's in range, then carry on.
- F fires one ability: the first ready type in rifle > MG > AT > tank > rocket order; others are click-only in the bar.
- Garrison: right-click a house with rifles/MGs. One squad per house cell (edge cells, so they can shoot out).
  Inside: 35% incoming accuracy, +25% vision, blasts halved. House wrecked -> thrown out with 30% damage.
- Tanks shell a house on right-click (fire-at), and every tank round damages the structure it lands on.
- Directional cover: a house, wall, rubble, hedge or vehicle within ~2 m on the shooter's side = 50% cover from that shooter.
- Veterancy: damage dealt of 1/2.5/5x the unit's cost = 1-3 stars (+10% accuracy, -8% damage, -15% suppression each).
- Rocket launcher (250 MP; T34 Calliope / Panzerwerfer / Katyusha): 8-rocket salvo up to 70 m on anything its side can
  see, no line of sight needed, +50% vs garrisons, 20s reload. F = Rocket Barrage on any clicked spot.
- Bombing run (250 MP, N): 6 heavy bombs in a line, 7 m blasts, big craters, 400 structure damage per bomb.
- Balance: garrisons alone dropped 2nd place to 55%; with rockets it's back to 63% (default) / 61% (River Towns).

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
8. Faction flavor: GLTF models behind `makeUnit()`, one asymmetric unit per faction

Tuning knobs: `CFG` and `UNITS` at the top of `shared/sim.js`.
