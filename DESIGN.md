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

## Tech
- Plain JS ES modules, no build step. Deps: `ws` (server), `three` (client).
- Server-authoritative: `shared/sim.js` runs at 20 Hz on the server and snapshots go out at 10 Hz.
  Clients send commands and smooth toward the latest snapshot.
- All command validation lives in `command()` in `shared/sim.js`.
- Map = grid of cells (2 m). `B` building, `H` hedgerow, `#` wall, `+` crater. LOS, pathing (A*), and cover all read the grid.
- Hosted on the owner's PC in Ecuador, reached by friends over Tailscale (`tailscale serve`).

## Roadmap
1. ~~Tracer bullet~~ 2. ~~Combat~~ 3. ~~LOS + fog~~ 4. ~~Points, VP, manpower, call-ins~~ (MVP)
5. In-game map editor (`?edit`, maps saved server-side, password on save)
6. Destructible terrain (flip cell flags, send changes in snapshots)
7. Elevation (height per cell, LOS samples heights, cliffs block pathing)
8. Faction flavor: GLTF models behind `makeUnit()`, one asymmetric unit per faction

Tuning knobs: `CFG` and `UNITS` at the top of `shared/sim.js`.
