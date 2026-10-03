# RTS engine research

Research date: 2026-10-03. Scope: simulation, commands, navigation, collision, projectiles, rendering and maps for Three Crossroads. This is a research note, not an implementation specification.

The user agreed to seven directions: movement/collision, vehicle handling, projectile physics, impact timing, independent map layers, scenario authoring and large-map navigation. They subsequently agreed to additions 1-9 in [Ten additional game improvements](game-feel-research.md), then explicitly added [realistic physics and world destruction](physics-destruction-research.md). The [implementation spec](engine-game-feel-spec.md) now proposes rules, delivery order and acceptance checks; numeric tuning remains implementation work.

## What source is available

Public repositories expose useful engine implementations, but their relationship to the named commercial games varies.

| Reference | What was verified | Useful material |
| --- | --- | --- |
| [Warsmash][warsmash-readme] | Independent Java/LibGDX Warcraft III emulator that loads separately supplied game assets. | Fixed simulation steps, turn-dependent movement, pathfinding, collision and script bindings. |
| [OpenWCIII][openwciii] | Community Warsmash fork whose README describes incomplete parity. | Additional implementation work, with compatibility limits stated by its authors. |
| [HiveWE][hivewe-readme] | Warcraft III map editor. | Editable terrain and independent static/dynamic pathing data. |
| [TinkerWorX/warcraftIII][warcraft-reverse] | Partial reverse-engineered material and analysis utilities. | Recovered structures and binary-analysis context, not a verified complete runtime. |
| [OpenBW][openbw] | Open implementation used as a Brood War simulation backend. | Frame processing, unit behavior and scenario data. This is distinct from Warcraft III and StarCraft II. |
| [openage][openage-readme] | Independent implementation of the Genie engine family used by Age of Empires and Age of Empires II. Its current README says gameplay is largely non-functional. | Sector/portal navigation, shared flow fields, data-driven entities and simulation/render separation. |
| [CryBarEditor][crybar] and [AoM: Retold modding interfaces][aom-api] | Community scenario/asset tooling and publisher-supported scripting interfaces. | Scenario conditions/effects, terrain serialization and random-map obstruction constraints. These sources do not reveal the complete Age of Mythology runtime. |
| [Recoil/Spring][recoil-readme] | Open RTS engine used by [Beyond All Reason][bar]. | Predictive avoidance, movement-specific navigation, simulation/display separation, projectiles and terrain-update dependencies. |
| [Warzone 2100][warzone-readme] | Open 3D RTS whose original source was released and subsequently developed by the community. | Swept projectile collision, asynchronous path jobs, visibility contributions and timestamped display state. |
| [OpenRA][openra-readme] | Open RTS engine supporting early Westwood games. | Hierarchical route guidance and projectile blocking along traveled segments. |
| [0 A.D.][zero-ad-readme] | Open historical RTS under development. | Separate formation/unit motion updates, delayed attack damage and replay state-hash comparisons. |
| [Last Colony][last-colony] | Small JavaScript/Canvas tutorial RTS with WebSocket multiplayer source. | Simple command processing, independent drawing and simulation, and route/steering separation. |
| [VOIDSTRIKE][voidstrike] | Substantial browser RTS implementation with a larger TypeScript/React/Three.js stack. | Spatial avoidance, worker/display messages, instanced rendering and map serialization. Source inspection does not establish production reliability. |
| [SC_Js][sc-js] | JavaScript/Canvas recreation with removed game assets and explicitly experimental multiplayer. | Tick-scheduled commands and state-dependent collision priorities. Its all-pairs collision loop is a scaling limitation. |

The inspected projects do not establish a complete public Warcraft III, Age of Empires or Age of Mythology engine decompilation. That is a bounded research finding, not proof that no other project exists. Reimplementations, editors, exposed scripts and partial reverse engineering should retain those labels.

## Our current engine

The game already separates an authoritative 20 Hz server simulation from normally 10 Hz snapshots and an independent client render loop. `command()` validates orders. Navigation uses A*, movement-class masks, connected-region rejection, path smoothing and shorter World Conquest route legs. Nearby queries use a spatial grid, and overlap correction protects units occupying cover. See [simulation](../shared/sim.js), [spatial queries](../shared/grid.js) and [runtime notes](../DESIGN.md#runtime).

The client exponentially approaches the latest snapshot position and facing. It already has individual visual soldier motion, instanced soldier and corpse rendering, distance-dependent detail and frustum filtering. These are existing systems to extend. See [display smoothing](../client/main.js#L1636), [soldier rendering](../client/unit-models.js#L481) and [visual squad movement](../client/squad-motion.js).

There are specific remaining boundaries. Ordinary direct fire applies damage immediately; grenades and salvos already have delayed resolution. A terrain cell has one primary character, so placing a mine replaces the road type. Generic map triggers currently have a time condition and announcement/destruction actions, while the tutorial has its own richer progression. See [direct fire](../shared/sim.js#L2654), [cell mutation](../shared/sim.js#L1444), [generic triggers](../shared/sim.js#L3156) and [tutorial](../shared/tutorial.js).

## Proposed engine experiments

### 1. Traffic handling and formation travel

Recoil separates route waypoints, predictive local avoidance and collision correction. Its avoidance uses nearby motion and stable turn preferences. Warsmash makes turning and a propulsion window explicit movement rules. Warzone combines predictive steering with a separate collision stage. See [Recoil avoidance][recoil-avoidance], [Warsmash movement][warsmash-movement] and [Warzone steering][warzone-steering].

0 A.D. processes formation motion separately from individual unit motion. That is another useful boundary when a group's travel shape and each member's obstacle response need different rules. See [motion updates][zero-ad-motion].

For our game, experiment with state-aware yielding: moving allies make room, a firing or entrenched squad keeps its place, and vehicles use their own clearance and turning limits. Let long-distance groups compress through a crossing and recover their ordered formation afterward. Preserve the distinction between a squad's authoritative footprint and its rendered soldiers.

Verification scene: two columns meet on a bridge, infantry pass a stationary gun, and a mixed tank/infantry group turns through a village. Measure blocked time, arrival delay, overlap and server tick cost. Compare against current movement using identical commands. Turning, acceleration and collision strictness remain player-feel decisions.

### 2. Render motion and combat events on a shared timeline

Recoil computes display interpolation independently of simulation. Warzone retains previous object timestamps and renders projectiles between valid times. Last Colony illustrates a simpler independent drawing loop. See [Recoil display timing][recoil-display], [Warzone projectile display][warzone-display] and [Last Colony drawing][last-colony-draw].

Our current smoothing follows the newest position. An experiment could retain timestamped snapshot history and render on a short buffered timeline, coordinating unit movement, aim, shots and impacts. Keep selection feedback immediate. Any prediction should be bounded and discarded when visibility or authoritative state changes.

Verification: feed the same movement and combat sequence through steady, jittered and bursty snapshot arrivals. Compare speed consistency, correction distance, visible response delay and impact timing. Extra buffering can improve smoothness while adding display latency, so it requires comparison rather than automatic adoption.

### 3. Authoritative projectile flight and collision

Warzone tests the traveled projectile segment relative to moving targets and selects the earliest object or terrain collision. Recoil updates projectile velocity with gravity before advancing position. See [Warzone impact selection][warzone-projectiles] and [Recoil ballistic updates][recoil-projectiles].

OpenRA also checks projectile blockers between the previous and current position. 0 A.D. offers a different model: its attack code estimates flight time, launches a visual projectile and schedules damage through a timer. Improved shot/impact timing can therefore be tested without adopting continuous physical collision. See [OpenRA bullets][openra-bullets] and [0 A.D. attack scheduling][zero-ad-attacks].

A contained experiment would give one tank weapon an authoritative projectile with launch time, velocity, collision bounds and impact time. Sweep its traveled segment each simulation step so a fast shell cannot skip a thin target. Emit a shot identity and an impact identity for the client. Keep small-arms rules separate unless changing them is a deliberate decision.

Verification: fire across a ridge, past a moving vehicle and through a thin obstacle. Damage, destruction, sound and visual impact should agree on the impact event. Decide separately whether shells can hit intervening allies, miss moving targets or cause splash. Those are gameplay changes, not consequences that must follow from adding visible flight.

### 4. Independent terrain and object layers

HiveWE stores static and dynamic pathing arrays with independent walk/fly/build flags. Recoil reports changed blocking rectangles to navigation. openage invalidates cached integration fields when their cost data changes. See [HiveWE pathing][hivewe-pathing], [Recoil blocking changes][recoil-blocking] and [openage cache invalidation][openage-integrator].

Our map already distinguishes movement and sight flags. The useful extension is separating the ground surface from overlays and objects: a road can retain its identity while carrying a mine, wire, smoke or wreck. A change should update only the affected navigation, visibility, collision and rendering data, with the unit's clearance included.

Verification: place a concealed mine on a road, remove it, collapse a bridge and rebuild the crossing. Preserve road movement rules, remembered terrain and concealment. A hidden mine must not reveal itself by changing an unseen route or a client's map.

### 5. Shared long-distance routing for World Conquest

openage routes between sector portals, then builds local flow fields. Its integrator caches fields and evicts them when costs change. OpenRA uses a coarse graph to guide fine-grained A* around terrain and selected immovable obstacles. Recoil also maintains movement-specific navigation layers and bounded dirty-region work. See [openage pathfinder][openage-pathfinder], [field caching][openage-integrator], [OpenRA route hierarchy][openra-paths] and [Recoil path manager][recoil-paths].

Our World Conquest already plans shorter legs and rejects disconnected goals. If large group orders remain expensive, test a coarse shared route or field for units with compatible movement rules, then retain local avoidance and individual arrival slots. Cache identity must include movement class, destination and the terrain information available to that player. A global authoritative route cache could disclose unknown terrain if reused without that boundary.

Verification: repeated continent-scale orders, a blocked crossing and a crossing changed under fog. Measure path work, queue delay, tick time and actual arrival behavior. Add hierarchy or worker jobs only when this workload demonstrates a benefit.

### 6. Data-driven map scenarios

AoM: Retold exposes random-map APIs and installed scripting documentation. CryBarEditor serializes scenario triggers and converts condition/effect groups to XS scripts. Warsmash supplies an inspectable script/native boundary. These establish authoring patterns, not complete original-engine internals. See [AoM publisher notes][aom-api], [scenario conversion][crybar-triggers] and [Warsmash bindings][warsmash-scripts].

Extend our narrow map trigger format with named conditions and actions when a scenario needs them: area entered, Point captured, structure destroyed, spawn reinforcement group, change objective or end the mission. Keep editor preview, validation and server execution on the same definition. Define whether each trigger fires once, per player or per team.

Verification: a saved map round-trips through the editor, reconnecting players see the current objective, and simultaneous capture events cannot duplicate reinforcement groups. Keep generic map rules distinct from tutorial-specific presentation.

### 7. Rendering workload and entity identity

VOIDSTRIKE's renderer batches transforms into instance groups and tracks entity identities separately from instance indices. Its worker render messages are separate from network synchronization. See [unit renderer][void-renderer], [instance utilities][void-pools] and [worker][void-worker].

Our soldiers and corpses already use instancing and culling. Investigate remaining mesh categories and animation work before adding another renderer. Useful experiments include batching repeated props or overlays, reducing distant animation updates and preserving stable picking as instance groups change. Keep presentation-only motion out of authoritative collision.

Verification: capture CPU frame time, GPU time, draw calls and picking behavior for the same camera path and army. Compare visible animation quality and allocation churn. Repository feature claims are not performance measurements for our workload.

### 8. Reproducible engine diagnostics

OpenBW processes simulation frames and triggers explicitly; Last Colony and SC_Js schedule commands by ticks. These implementations show useful recording boundaries while using different networking assumptions. See [OpenBW frame processing][openbw-frames], [Last Colony commands][last-colony-commands] and [SC_Js command scheduling][sc-js-commands].

0 A.D. compares the simulation hash after a replay turn with the expected recorded hash and reports divergence. That provides a concrete way to check whether replay reproduces behavior. See [replay validation][zero-ad-replay].

Record a match's initial state, tick-stamped accepted commands, random state and content version. Our simulation uses both a seeded helper and ambient `Math.random()` in combat, so command recording alone does not establish repeatable replay. Decide between simulation replays and state/event playback according to the intended debugging or player-facing use.

Verification: repeat a command trace and compare authoritative hashes. Once worker path jobs exist, apply results through defined simulation ordering and reject results for superseded commands or terrain versions.

## Suggested first slice and unresolved choices

My recommendation is a movement experiment plus a render-timing comparison, followed by one physical projectile weapon and independent terrain overlays. Map triggers are a separate authoring slice. Hierarchical routing should follow measured large-map pressure.

The next decisions are which player-visible engine problem to target first, and how much turning/acceleration realism should affect command response. The seven directions are agreed; engine migration, exact gameplay rules and the other experiments remain undecided. No implementation specification, new glossary term or ADR has been adopted by this research.

## Evidence limits

Six research workers examined primary repositories and publisher documentation. Firecrawl was used for discovery and page extraction, then source files were inspected directly; relevant repositories were shallow-cloned into temporary research directories. Third-party games were not built, run or benchmarked. Code links are pinned to inspected commits. Source mechanisms support the proposed experiments; they do not establish original-game parity or predict our performance gains.

[warsmash-readme]: https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/README.md
[openwciii]: https://github.com/awest813/OpenWCIII/blob/d0352c75ca39aea9db34912a55b64011784af602/README.md
[hivewe-readme]: https://github.com/stijnherfst/HiveWE/blob/cbfd6b32d4dcaa5583c9f360d59617cb12531d10/README.md
[warcraft-reverse]: https://github.com/TinkerWorX/warcraftIII/blob/e94a800fb99dea45d1e63f3ae1ed9533fca3b15a/README.md
[openbw]: https://github.com/OpenBW/bwapi/blob/48124ba8ed1b4d52b3dfd52acbaf34afb9a37fe2/README.md
[openage-readme]: https://github.com/SFTtech/openage/blob/90cd2938557adc920f6f6f370382e329cbe96718/README.md
[crybar]: https://github.com/CryShana/CryBarEditor/blob/3f89992b6e24a87782bc66ca8851ff6b8e21ac01/README.md
[aom-api]: https://www.ageofempires.com/news/age-of-mythology-retold-update-18-7603/
[recoil-readme]: https://github.com/beyond-all-reason/RecoilEngine/tree/10baea878c02c4c18cca42545ae4321a4b959d9c
[bar]: https://github.com/beyond-all-reason/beyond-all-reason/blob/f92aaf2545ec1a677b1e1bb801e614af20b59685/README.md
[warzone-readme]: https://github.com/Warzone2100/warzone2100/blob/d919af02b4daf78adae03d75572f0d7b5a8bae39/README.md
[openra-readme]: https://github.com/OpenRA/OpenRA/blob/7d57605bca2cbe963068d42505e00072afe19868/README.md
[zero-ad-readme]: https://github.com/0ad/0ad/blob/61a3b9507d974084e6badb88a0826bd89a6d5b8b/README.txt
[last-colony]: https://github.com/adityaravishankar/last-colony/blob/0800823502bf3f0606c1f67dd8a5dbebac895e41/README.md
[voidstrike]: https://github.com/braedonsaunders/voidstrike/blob/4df0235116b78bf9232105486738e64b2e6905cb/README.md
[sc-js]: https://github.com/gloomyson/SC_Js/blob/4981ce27b29c4970390159b59d414a5e19326fbf/README.md
[recoil-avoidance]: https://github.com/beyond-all-reason/RecoilEngine/blob/10baea878c02c4c18cca42545ae4321a4b959d9c/rts/Sim/MoveTypes/GroundMoveType.cpp#L1843
[warsmash-movement]: https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/viewer5/handlers/w3x/simulation/behaviors/CBehaviorMove.java#L180
[warzone-steering]: https://github.com/Warzone2100/warzone2100/blob/d919af02b4daf78adae03d75572f0d7b5a8bae39/src/steering/collision_avoidance_behavior.cpp#L49
[recoil-display]: https://github.com/beyond-all-reason/RecoilEngine/blob/10baea878c02c4c18cca42545ae4321a4b959d9c/rts/Game/Game.cpp#L1279
[warzone-display]: https://github.com/Warzone2100/warzone2100/blob/d919af02b4daf78adae03d75572f0d7b5a8bae39/src/display3d.cpp#L1800
[last-colony-draw]: https://github.com/adityaravishankar/last-colony/blob/0800823502bf3f0606c1f67dd8a5dbebac895e41/js/game.js#L115
[warzone-projectiles]: https://github.com/Warzone2100/warzone2100/blob/d919af02b4daf78adae03d75572f0d7b5a8bae39/src/projectile.cpp#L919
[recoil-projectiles]: https://github.com/beyond-all-reason/RecoilEngine/blob/10baea878c02c4c18cca42545ae4321a4b959d9c/rts/Sim/Projectiles/Projectile.cpp#L149
[hivewe-pathing]: https://github.com/stijnherfst/HiveWE/blob/cbfd6b32d4dcaa5583c9f360d59617cb12531d10/src/base/pathing_map.ixx#L23
[recoil-blocking]: https://github.com/beyond-all-reason/RecoilEngine/blob/10baea878c02c4c18cca42545ae4321a4b959d9c/rts/Sim/Misc/GroundBlockingObjectMap.cpp#L37
[openage-integrator]: https://github.com/SFTtech/openage/blob/90cd2938557adc920f6f6f370382e329cbe96718/libopenage/pathfinding/integrator.cpp#L47
[openage-pathfinder]: https://github.com/SFTtech/openage/blob/90cd2938557adc920f6f6f370382e329cbe96718/libopenage/pathfinding/pathfinder.cpp#L91
[recoil-paths]: https://github.com/beyond-all-reason/RecoilEngine/blob/10baea878c02c4c18cca42545ae4321a4b959d9c/rts/Sim/Path/QTPFS/PathManager.cpp#L766
[crybar-triggers]: https://github.com/CryShana/CryBarEditor/blob/3f89992b6e24a87782bc66ca8851ff6b8e21ac01/CryBar/Scenario/ScenarioFile.XS.cs
[warsmash-scripts]: https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/parsers/jass/Jass2.java#L259
[void-renderer]: https://github.com/braedonsaunders/voidstrike/blob/4df0235116b78bf9232105486738e64b2e6905cb/src/rendering/UnitRenderer.ts#L1129
[void-pools]: https://github.com/braedonsaunders/voidstrike/blob/4df0235116b78bf9232105486738e64b2e6905cb/src/rendering/shared/InstancedMeshPool.ts
[void-worker]: https://github.com/braedonsaunders/voidstrike/blob/4df0235116b78bf9232105486738e64b2e6905cb/src/engine/workers/GameWorker.ts
[openbw-frames]: https://github.com/OpenBW/openbw/blob/4b046d5f65302b10cb0a745f0fecd37ec85b20a8/bwgame.h#L13191
[last-colony-commands]: https://github.com/adityaravishankar/last-colony/blob/0800823502bf3f0606c1f67dd8a5dbebac895e41/js/game.js#L260
[sc-js-commands]: https://github.com/gloomyson/SC_Js/blob/4981ce27b29c4970390159b59d414a5e19326fbf/GameRule/Game.js#L948
[openra-paths]: https://github.com/OpenRA/OpenRA/blob/7d57605bca2cbe963068d42505e00072afe19868/OpenRA.Mods.Common/Pathfinder/HierarchicalPathFinder.cs#L50
[openra-bullets]: https://github.com/OpenRA/OpenRA/blob/7d57605bca2cbe963068d42505e00072afe19868/OpenRA.Mods.Common/Projectiles/Bullet.cs#L247
[zero-ad-attacks]: https://github.com/0ad/0ad/blob/61a3b9507d974084e6badb88a0826bd89a6d5b8b/binaries/data/mods/public/simulation/components/Attack.js#L650
[zero-ad-motion]: https://github.com/0ad/0ad/blob/61a3b9507d974084e6badb88a0826bd89a6d5b8b/source/simulation2/components/CCmpUnitMotion_System.cpp#L145
[zero-ad-replay]: https://github.com/0ad/0ad/blob/61a3b9507d974084e6badb88a0826bd89a6d5b8b/source/simulation2/system/ReplayTurnManager.cpp#L63
