# Skirmish Production Bases Implementation Plan

**Goal:** In Conquest, Assault, Annihilation and Horde, start with HQ + Barracks and build destructible, repairable production buildings during matches. Purchases remain instant and MP-only. Horde defenders share buildings, not wallets or unit ownership.

**Architecture:** Reuse Classic footprints, placement, construction crews, damage and rubble. Keep isConstructionMode exclusively for Classic/World economics and queues. Add separate skirmish-base and production-access helpers usable by sim, AI and client. Preserve tutorial, Classic, World and existing bunker victory rules.

**Tech Stack:** JavaScript ES modules, authoritative Node simulation, Three.js client.

## 1. Simulation start and ownership
- Add tests in test-skirmish-bases.js for every mode's completed HQ/Barracks starts, single shared Horde base and no enemy-wave base.
- Add isSkirmishBaseMode(g), productionAccess(g,b,slot), productionBuildings(g,slot,type) in shared/sim.js.
- Place starting bases with existing footprints, away from bunker structures and capture points. HQ rebuilding has an explicit MP cost and build duration, never free construction.

## 2. Instant production and construction
- Test missing/dead/unfinished/foreign producer rejection without payment, valid producer selection, unit ownership and spawn at producer, faction/population limits and shared Horde prerequisites.
- Extend field construction to Barracks/Motor Pool/Airfield/Shipyard and HQ reconstruction in these four modes only; keep tutorial flak-only.
- Reuse construction and repair, reject dead targets. Reuse training spawn geometry without queues; keep player and building rally behavior.
- HQ remains the reinforcement anchor. Its destruction disables HQ reinforcement until rebuilt. Existing bunker objectives stay unchanged.

## 3. Client
- Update client/availability.js, client/hud.js and client/main.js to expose construction and producer requirements without showing Classic fuel/queues.
- Keep global instant recruit cards, show locked reasons, allow selection of shared Horde producers, spawn/rally correctly and suppress duplicate decorative HQ tents.
- Add client availability tests and run browser smoke check.

## 4. AI
- Add skirmish building upkeep using visible friendly buildings only, reserve money for tech, retain working builders, repair/rebuild and unlock vehicles/air/naval production.
- Filter purchases by completed producers, share Horde prerequisites and avoid duplicate shared sites.
- Add focused AI tests and deterministic simulation smoke runs across modes.

## 5. Verification and documentation
- Register focused tests in test.js. Update legacy fixtures only when their setup assumed unrestricted purchases; preserve assertions.
- Run node test-skirmish-bases.js and node test.js, inspect git diff and browser/server console.
- Update DESIGN.md and CHANGELOG.md with player rules, actual validation and any unresolved limits.

## Risks / boundaries
- Extra footprints change pathfinding near spawn; do not overlap bunkers or place units inside footprints.
- Horde building owner can differ from buyer; keep costs and resulting unit ownership on buyer.
- Building repair must not turn dead buildings back on before cleanup.
- Buildings add strategic spending but no arbitrary income or combat rebalance without evidence.
