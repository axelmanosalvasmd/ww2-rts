# Physics and world destruction: current state and extensions

This audit records the current implementation before detailed physics and destruction mechanics are fixed. The game already has persistent destruction with gameplay effects. Craters and damaged roads alter the shared terrain grid, terrain relief follows crater heights, fires spread and can destroy structures, bridges fail across a connected span, houses leave rubble, and vehicle wrecks can block movement and shelter infantry. The proposals below extend those systems without assuming new thresholds or a physics-engine replacement.

## What already exists

- **Cratered and lowered ground:** `shared/sim.js:3051-3068, 1500-1510` accumulates road wear, turns open ground into crater cells, and lowers cells under blasts. Bombs can deepen the inner half. The slope rule constrains the resulting terrain, and nearby crater cells can flood into fords (`shared/sim.js:3119-3129`). The client rebuilds visible relief around changed cells (`client/relief.js:528-549`) and paints persistent shell and rubble scars (`client/ground.js:146-152, 560-570`). This is persistent gameplay terrain, not only a decal.
- **Structure and bridge damage:** `shared/sim.js:3050-3074` applies blast damage to terrain cells; houses and structures track cell hit points. A bridge cell's destruction propagates through the connected span, and units standing on a bridge cell that becomes impassable are killed (`shared/sim.js:3175-3195`). A destroyed house can spill rubble into adjacent open or road cells, evicting and damaging garrisons. Visual house ruins and rubble are assembled from static chunks (`client/structures.js:547-578, 591-620`). Stone bridges already have a larger shared durability value (`shared/sim.js:112`; `DESIGN.md:1768-1774`).
- **Fire and wreckage:** Fires ignite flammable cells, spread with wind and rain, damage infantry and houses, and leave burnt ground, bare ground, or rubble when exhausted (`shared/sim.js:3076-3117`). Burning is visualized with flames and smoke (`client/fx.js:799-825, 846-886`). Destroyed vehicles leave wreck records, and suitable open cells become `Q`, a movement obstacle and infantry cover (`shared/sim.js:3661-3670`; directional wreck cover is in `shared/sim.js:1287-1313`).
- **Cosmetic physics:** Explosion soil, masonry, wood, and metal particles use gravity and ground bounce (`client/fx.js:48-51, 82-89, 322-328`). The effect particles do not alter the simulation grid. A corpse that dies beside a recent blast can receive a visual impulse, tumble, and land on sampled ground (`client/fx.js:546-559`; `client/unit-models.js:713-738`). Corpses later sink and fade as a rendering and performance policy (`client/unit-models.js:520-525, 740-743`).
- **Design intent already recorded:** The design document describes house collapse, garrison eviction, cratered bombing, shell damage, wreck cover, rubble, and combat debris (`DESIGN.md:350-382, 793-794`). These are established behaviors, not gaps.

## Extensions to consider

These are candidate directions for discussion. None selects a numerical threshold or implies an implementation commitment.

### 1. Let structural failure follow damage location and support

**Current boundary:** Houses have per-cell hit points, but their visible ruin is rebuilt from the remaining standing cells and deterministic chunks (`shared/sim.js:3051-3074`; `client/structures.js:547-578`). A bridge currently drops as one connected span when a cell fails (`shared/sim.js:3178-3182`). There is no visible intermediate sag or support-dependent failure sequence.

**Player-visible behavior:** A wall or house corner hit repeatedly could crack, shed masonry, and partially fall before neighboring sections collapse. A bridge could lose a damaged deck segment or support section first, with the rest failing only when its supporting connection is gone. This would make damage location and structural layout readable.

**Authority:** Any change to passability, cover, garrison safety, bridge crossing, or damage must be server-authoritative in `shared/sim.js`, with the resulting terrain state sent to clients. Cracks, sag, falling chunks, and dust can remain cosmetic in `client/structures.js` and `client/fx.js` if they do not affect movement or sight.

**Verification scene:** Damage one edge cell of a multi-cell stone house and one middle cell of a multi-cell bridge in separate matches. Check the order of visible failures, whether units can cross or remain garrisoned consistently with the authoritative grid, and whether all clients render the same final terrain state.

### 2. Make destroyed-building debris placement respond to the collapse

**Current boundary:** A house collapse can probabilistically mark adjacent open or road cells as rubble, with a guard against placing it under a vehicle (`shared/sim.js:3184-3189`). The client scatters static rubble pieces deterministically around each rubble cell (`client/structures.js:591-620`). Debris particles bounce, but are transient effects (`client/fx.js:82-86`).

**Player-visible behavior:** A collapse could direct most debris toward the open side or street, leave less rubble against a neighboring structure, and visibly settle large slabs where they land. If rubble placement changes, its gameplay meaning should remain legible: blocked cells and cover should match the visible pile.

**Authority:** The destination cells and their movement/cover consequences belong in `shared/sim.js`. Directional dust and falling chunks can be client effects. A purely visual slab must not imply a blocked cell if the server still allows passage.

**Verification scene:** Destroy a house bordering a street on one side and another building on the opposite side. Compare the rubble footprint and infantry/vehicle routes against the cell state returned by the server.

### 3. Give terrain deformation more local shape while preserving movement rules

**Current boundary:** Simulation terrain is cell-based. Blasts lower affected cells by discrete levels and constrain adjacent slopes (`shared/sim.js:119-120, 1470-1475, 1500-1510`). The relief mesh smooths cell heights and adds visible crater lips; long bombing scars receive additional visual shaping, while movement uses the unshifted simulation height (`client/relief.js:170-174, 219-235`).

**Player-visible behavior:** Different impacts could leave more distinct bowl and rim shapes, with softer soil producing broader disturbance and harder or rocky ground producing tighter, shallower damage. Surface deformation should remain aligned with the grid's movement and flooding consequences, so units do not appear to float over or fall through the terrain.

**Authority:** If material type changes crater depth, movement, water flow, or cover, encode those consequences in shared simulation state. Higher-resolution bowl and rim shape can be visual only as long as it stays within the authoritative height envelope used for pathing and collision.

**Verification scene:** Fire the same weapon into adjacent open ground, a road, and a wet low area. Compare the terrain state, route choice, and rendered relief, including after a reconnect or terrain update.

### 4. Carry impact interactions beyond cosmetic bouncing debris

**Current boundary:** Debris particles have gravity and a ground bounce (`client/fx.js:48-51, 82-89`), and corpses can be thrown by nearby blasts for a short visual animation (`client/unit-models.js:713-738`). These effects do not collide with other units or structures and do not change damage or terrain.

**Player-visible behavior:** A limited set of large, identifiable fragments could strike a roof, wall, or ground surface and produce a secondary dust or chip effect. The visual should show a plausible landing or deflection based on the surface. If fragments are ever meant to injure units or obstruct paths, that must be a separate gameplay design decision with clear rules.

**Authority:** Surface contacts and secondary visuals may be client-side. Any unit damage, structure damage, persistent debris, or collision obstacle must be resolved by `shared/sim.js` and replicated. Keep the existing corpse impulse cosmetic unless gameplay consequences are deliberately specified.

**Verification scene:** Trigger a masonry collapse beside a wall and open ground, then confirm fragments visibly meet the surface without passing through it or changing server-side health, movement, or terrain unexpectedly.

### 5. Make burning structures fail through visible stages

**Current boundary:** Fire spreads over time and burns houses down into rubble; other burning vegetation is removed or marked burnt after its timer (`shared/sim.js:3076-3117`). House visuals expose damage stages, but the final ruin is the main structural transition (`client/structures.js:835-842, 547-578`). Fire animation and smoke are driven by the visible fire snapshot (`client/fx.js:799-825`).

**Player-visible behavior:** A burning building could lose roof sections or a floor before final collapse, with fire and smoke emerging from the damaged area. Players would be able to read that a structure is close to failure without needing damage numbers. A damaged wall or partial roof could remain as cover only if the simulation represents it consistently.

**Authority:** Burn duration, health loss, occupancy eviction, final rubble, and any intermediate cover or passability changes must be authoritative in `shared/sim.js`. Flames, embers, roof fragments, and smoke can be client effects keyed to authoritative damage stages.

**Verification scene:** Ignite a garrisoned house, observe it through each damage stage, and confirm the occupants, protection, and final rubble transition match the state observed by another client.

## Shared guardrail

Keep a clear distinction between rendered motion and world state. `shared/sim.js` already owns the consequential terrain and obstruction rules; `client/fx.js`, `client/structures.js`, `client/relief.js`, and `client/unit-models.js` render much of their physical appearance. New visuals can look richer without changing gameplay. If a visible crack, slab, depression, or wreck is meant to affect play, the corresponding state must be represented and replicated by the simulation.
