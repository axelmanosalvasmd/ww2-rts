# Realistic physics and world destruction

The user explicitly added these two goals on 2026-10-03, alongside the previously agreed engine and game-feel directions. The goals are agreed. The [implementation spec](engine-game-feel-spec.md) now proposes bounded physical and structural rules; material values and other numeric tuning remain implementation work. The candidates below retain their original research status.

## Existing foundation

World destruction already affects play. [Terrain damage](../shared/sim.js#L3051) lowers shelled ground, damages roads and caves trenches in. [Structural destruction](../shared/sim.js#L3175) drops connected bridge spans, turns houses into rubble and hurts evicted garrisons. Fires spread, and [vehicle wrecks](../shared/sim.js#L3661) can obstruct vehicles and shelter infantry.

The client already gives [debris gravity and ground bounce](../client/fx.js#L322) and [blast-thrown bodies](../client/unit-models.js#L713) visual motion. Those effects are cosmetic. The [current-state audit](research/physics-destruction-current.md) records the distinction between persistent world state and its presentation.

## Physics realism

Extend the agreed vehicle and projectile work with consistent acceleration, braking, slope response, gravity, swept collision and material response. A projectile should meet the visible surface; a heavy vehicle should have readable momentum; a fragment should land or deflect instead of passing through a wall.

Ricochet, penetration, blast impulse and support-dependent collapse are candidate mechanics within this goal. Their rules need to distinguish weapon type, impact angle and material, and must agree with damage and terrain changes. The existing ricochet sound and armor sparks do not establish a physical deflection simulation.

Useful inspected reference mechanisms:

- [Recoil projectile bounce][bounce] checks traveled ground/water segments, uses the contact normal, adjusts velocity through slip/rebound parameters and limits bounce count. This supports contact-response design; it does not supply a verified armor-penetration model.
- [Recoil feature damage][feature-damage] scales applied impulse by mass, replaces destroyed features with wreckage, and carries position/velocity into the replacement.
- [Recoil feature motion][feature-motion] applies drag and gravity, updates spatial position and prevents sinking below sampled ground. Its source delegates more advanced water physics rather than implementing them there.

Gameplay consequences belong to the authoritative simulation. Small dust, sparks and transient fragments can use bounded client motion. If a large fragment damages a unit or becomes a persistent obstacle, its impact and final state must be replicated.

## World destruction

Extend the current grid and damage stages with more localized, material-aware failure:

- A damaged wall or roof section sheds pieces and breaches locally; unsupported adjoining sections can fail afterward.
- Bridge damage follows deck/support structure instead of every failed cell automatically dropping the entire connected span.
- Collapse direction influences persistent rubble placement, with the visible pile matching movement, cover and sight rules.
- Soil, roads and harder ground deform differently under the same blast, with crater depth and shape consistent with movement and flooding.
- Burning buildings show progressive structural failure before their final rubble state.

These are proposed ways to satisfy the agreed goal. A specific support model, fracture representation or penetration formula has not been chosen.

[Recoil terrain deformation][deformation] shapes explosion damage using a crater profile and terrain hardness, while protecting selected occupied footprints. Its [changed-area update][dependencies] informs terrain, features, sight and navigation. This is a useful dependency model: visible destruction, authoritative obstruction and route/visibility updates must agree.

## First verification scene

Shell one corner of a building beside a road, destroy a bridge section and fire into soft ground. Show the impacts, falling pieces and final state on two clients, then reconnect one client. Confirm that units use the same breach, rubble and crossing rules, hidden destruction stays hidden, and terrain/visibility updates remain consistent.

Record server tick cost, client frame tails and active fragment counts during a quiet scene and sustained bombardment. Put static settled rubble into the existing world representation and bound the number of actively simulated fragments. Performance limits and gameplay thresholds need measured values before implementation decisions are finalized.

[bounce]: https://github.com/beyond-all-reason/RecoilEngine/blob/10baea878c02c4c18cca42545ae4321a4b959d9c/rts/Sim/Projectiles/WeaponProjectiles/WeaponProjectile.cpp#L349
[feature-damage]: https://github.com/beyond-all-reason/RecoilEngine/blob/10baea878c02c4c18cca42545ae4321a4b959d9c/rts/Sim/Features/Feature.cpp#L392
[feature-motion]: https://github.com/beyond-all-reason/RecoilEngine/blob/10baea878c02c4c18cca42545ae4321a4b959d9c/rts/Sim/Features/Feature.cpp#L552
[deformation]: https://github.com/beyond-all-reason/RecoilEngine/blob/10baea878c02c4c18cca42545ae4321a4b959d9c/rts/Map/BasicMapDamage.cpp#L88
[dependencies]: https://github.com/beyond-all-reason/RecoilEngine/blob/10baea878c02c4c18cca42545ae4321a4b959d9c/rts/Map/BasicMapDamage.cpp#L228
