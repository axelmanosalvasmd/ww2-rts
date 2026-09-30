# Three Crossroads: design decisions

WW2 tactics RTS in the browser for three friends. Decided 2026-09-30.

## Game
- Tactics skirmish, no base building. PvP: 1v1 or 3-player FFA, joined by room link (`/#code`).
- Win: first to 1200 VP (was 500; AI-vs-AI matches ended in ~3.5 min, now 7-9 min). Each held capture point gives +1 VP/s and +2 MP/s (plus a base of 1 MP/s).
- Manpower buys reinforcements that spawn at your map edge. Pop cap is 12 units.
- Factions are cosmetic (USA / Germany / USSR by slot). Same roster and stats for everyone:
  rifle squad, MG team, AT gun, light tank. Squads are one sim entity with N models.
- Combat: cover cells halve incoming accuracy and suppression. The suppression meter slows and then pins infantry.
  Tanks take double damage from the rear. Grid line of sight. Fog of war is enforced by the server.

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
