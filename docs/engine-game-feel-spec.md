# Three Crossroads: engine, game feel, physics and world destruction

Spec date: 2026-10-03. Status: published as [issue #39](https://github.com/axelmanosalvasmd/ww2-rts/issues/39), labeled `ready-for-agent`. The user confirmed the multiplayer acceptance harness, browser proof and performance measurements as the testing boundary. This document is the implementation contract. Current implementation checks and measured limits are recorded separately in [the verification report](engine-game-feel-verification.md).

## Problem Statement

Three Crossroads already has terrain damage, fire, wreck cover, formation orders, combined-arms AI, positional sound and instanced rendering. Players should feel those systems working together more consistently. Crowded crossings should remain usable, heavy vehicles should move with weight, and a visible shell should cause damage when it actually arrives. Destruction should create believable breaches, rubble and changes to routes rather than an unrelated visual effect.

Players also need better control during a busy battle: change a waiting recruitment choice, recover an expired Alert and detach units into another control group. Enemy attacks and Horde Waves should create recognizable situations that reward preparation. The battlefield should sound different by location and Weather, and large distant armies should consume less animation work without affecting combat.

The user approved seven engine directions and nine additional gameplay/presentation directions, then explicitly added realistic physics and world destruction. The scope below includes all of them. Detailed technical rules in this spec are recommended defaults synthesized from the existing game and the research, rather than claims that the user separately selected each tuning value.

## Solution

Extend the existing authoritative simulation and client presentation in independently verifiable phases. Keep ordinary orders and the squad as the gameplay entity. Use bounded physical models where they affect combat or the world, and inexpensive client motion for small cosmetic fragments.

| Agreed direction | Result for players |
| --- | --- |
| Traffic and collision handling | Units anticipate congestion, yield consistently and clear narrow crossings without repeated shoving. |
| Vehicle handling | Heavy vehicles accelerate, brake, reverse and turn within readable limits. |
| Physical projectile flight | Shells cross space and meet terrain, structures or moving targets along their actual flight. |
| Damage at impact | Damage, suppression, destruction and hit feedback follow authoritative arrival. |
| Independent map layers | Roads and ground survive underneath mines, structures, wrecks and rubble until the ground itself is damaged. |
| Scenario authoring | Map authors combine conditions and effects for reinforcements, captures, objectives and destruction. |
| Hierarchical navigation | Long orders use coarse routes and bounded local searches that react to discovered obstacles and destruction. |
| Persistent combined-arms assaults | AI infantry and support weapons stage, advance and regroup as an operation. |
| Withdrawal from losing engagements | Visible reinforcements or losses can make an AI assault withdraw before its members are almost dead. |
| Recognizable Horde Waves | Infantry pressure, armored pushes and siege Waves have a broad warning and different preparation demands. |
| Editable production queues | Players cancel a specific waiting recruit with a clear, exact refund. |
| Retained Alert history | Players revisit important notices after they fade and jump to the recorded location. |
| Explicit control-group transfers | A deliberate transfer removes units from other groups while ordinary overlapping groups still work. |
| Living vehicle damage cues | Damaged vehicles show restrained persistent cues that clear with repair and change on destruction. |
| Environmental sound | Nearby rivers, woodland, wind and Weather change the atmosphere as the camera moves. |
| Earlier animation visibility checks | Detailed animation concentrates on visible units and resumes correctly when the camera returns. |
| Realistic physics | Movement, gravity, swept collision, contact response and material behavior use consistent world measurements. |
| World destruction | Local failure, structural support, directional rubble, material-aware craters and progressive fire affect the same world every client sees. |

## User Stories

1. As a player, I want a group to pass a narrow crossing without repeatedly pushing itself backward, so that a move order remains dependable.
2. As a player, I want opposing traffic to yield in a consistent order, so that a busy bridge clears eventually.
3. As a player, I want stopped units to make room only when appropriate, so that a traffic fix does not pull my defenders out of cover.
4. As a player, I want Stop, Retreat and a new order to take effect promptly, so that congestion does not take control away from me.
5. As a player, I want tanks to accelerate and brake visibly, so that their weight is apparent without making selection and orders sluggish.
6. As a player, I want heavy vehicles to turn or reverse within their movement rules, so that hull facing and rear armor matter consistently.
7. As a player, I want a vehicle to respect walls, slopes and wrecks while turning, so that its model does not imply an impossible route.
8. As a player, I want infantry to keep responsive movement, so that vehicle realism does not impose vehicle handling on squads.
9. As a player, I want shells to collide along their traveled path, so that they cannot pass through a thin wall between updates.
10. As a player, I want a moving target to be able to leave a shell's path, so that a round does not follow it after firing.
11. As a player, I want a round to strike an intervening obstacle or eligible enemy, so that the visible line of fire matters.
12. As a player, I want damage and hit feedback to happen at arrival, so that an enemy does not die before the shell reaches it.
13. As a player, I want a projectile already in flight to remain valid if its shooter dies, so that firing and impact are separate events.
14. As a player, I want an impact to resolve once, so that reconnecting or receiving repeated data cannot duplicate damage or rewards.
15. As a player, I want blast damage to retain its documented friendly-fire behavior, so that physical flight does not silently change team combat rules.
16. As a player, I want a mine on a road to preserve the road beneath it, so that clearing the mine restores the correct surface.
17. As a player, I want rubble and wreck cover to match their visible footprint, so that I can judge where infantry and vehicles can move.
18. As a player, I want destruction to update cover, sight and navigation together, so that a visible breach is a usable breach.
19. As a player, I want unseen mines and destruction to stay unknown, so that path previews and effects do not reveal private world state.
20. As a player, I want long-distance orders to reach the intended destination, so that local route legs do not discard the full order.
21. As a player, I want a long route to recover when a discovered bridge fails, so that my units replan rather than remain stuck.
22. As a player, I want an unreachable order to stop safely and explain the problem, so that units do not retry forever.
23. As a map author, I want to combine elapsed time, capture, unit-loss and area-entry conditions, so that I can make missions with meaningful events.
24. As a map author, I want to announce an objective and bring in a defined reinforcement group, so that the mission progresses without custom runtime code.
25. As a map author, I want to destroy a chosen structure or map section through the normal world system, so that authored destruction obeys ordinary combat rules.
26. As a map author, I want validation errors to identify an invalid condition or target, so that I can repair a scenario before hosting it.
27. As a map author, I want repeat conditions to have explicit limits and cooldowns, so that a mission cannot accidentally spawn endless reinforcements in one tick.
28. As a player, I want enemy infantry and support weapons to arrive as a coherent assault, so that the fight rewards countering their roles.
29. As a player, I want the AI to regroup after contact without waiting forever for one blocked gun, so that attacks remain active and believable.
30. As a player, I want visible reinforcements to change the enemy's assessment, so that reinforcing a position can break an assault.
31. As a player, I want enemies to withdraw to reachable known ground, so that they do not retreat through danger they supposedly cannot see.
32. As a player, I want AI behavior to use the same observed information as a human, so that hidden reinforcements cannot influence its decisions early.
33. As a Horde defender, I want a broad warning about the next Wave, so that I can choose a useful defense during the break.
34. As a Horde defender, I want infantry, armored and siege profiles to produce meaningfully different mixes, so that preparation is more than buying the same army each time.
35. As a Horde defender, I want profile variety within ordinary unlocks and budgets, so that a warning does not introduce an impossible early counter requirement.
36. As a Horde defender, I want a Wave to finish only after its fielded forces, Reserve and purchase budget are exhausted, so that distinct profiles retain the established progression rule.
37. As a player, I want every waiting recruit to have its own cancel control, so that I can remove the second of two identical jobs reliably.
38. As a player, I want the refund shown before cancellation, so that I know how much MP and Fuel I will recover.
39. As a player, I want cancellation to preserve the active recruit's progress and the remaining order, so that changing one choice does not reset production.
40. As a player, I want a stale cancellation to be harmless, so that a job starting or finishing at the same time cannot cancel a different recruit.
41. As a player, I want a bounded history of my side's Alerts, so that I can recover a missed Point loss, ally ping or production notice.
42. As a player, I want an old Alert to show its match time and recorded location, so that revisiting it does not imply fresh knowledge.
43. As a player, I want to open Alert history without hiding battle controls, so that I can consult it during combat.
44. As a player, I want an explicit move-to-group action, so that a detached AT Gun is no longer pulled back by its former group's next order.
45. As a player, I want ordinary group assignment and overlapping groups to keep working, so that transfers are a deliberate additional action.
46. As a player, I want group feedback to explain membership changes, so that I know which units I transferred.
47. As a player, I want a damaged surviving tank to look damaged, so that its condition is readable without selecting it.
48. As a player, I want damage smoke to clear with repair and hand over to wreck effects on death, so that the cue follows the real state.
49. As a player, I want nearby water, trees and Weather to change the ambience, so that different areas of the map feel distinct.
50. As a player, I want ambience to respect volume controls and combat cues, so that it does not bury an Alert or order acknowledgement.
51. As a player, I want distant armies to consume less detailed animation work, so that a large match remains responsive.
52. As a player, I want units to resume their current movement and pose when I return to them, so that saving animation work does not produce a catch-up lurch.
53. As a player, I want the same simulation on every graphics setting, so that presentation savings cannot change combat or visibility.
54. As a player, I want a shell hitting a building corner to create a local breach first, so that damage has a readable location.
55. As a player, I want unsupported adjoining sections to fail while supported sections remain, so that a collapse follows the structure.
56. As a player, I want bridge failure to follow deck and supports, so that damaging one section does not always erase the entire connected bridge.
57. As a player, I want collapse direction to influence rubble placement, so that the settled obstacle agrees with the falling structure.
58. As a player, I want soft ground, roads and hard surfaces to deform differently, so that bombardment leaves believable terrain.
59. As a player, I want fire to show progressive damage before a structure fails, so that I can judge whether a position is becoming unsafe.
60. As a player, I want bridge failure, fire and breached garrisons to apply their consequences only to affected occupants, so that partial destruction is fair.
61. As a player, I want settled rubble and damaged terrain to survive reconnecting, so that both clients continue fighting on the same map.
62. As a player, I want hidden damage to appear only when observed, so that remembered buildings do not update through fog.
63. As a player, I want the new controls and messages in the existing supported languages, so that the additions fit the current interface.
64. As a host, I want measurements from representative matches and bombardment, so that a completed phase has evidence of usable performance.

## Implementation Decisions

### Authority and compatibility

- Keep the existing fixed-step authoritative server, normal commands, spatial queries, squad entities and client rendering architecture. Do not replace the engine or adopt a physics library as part of this spec. The current server simulation is 20 Hz, with normally 10 Hz snapshots. Physical integration and collision use simulation time, not browser frame time.
- Gameplay movement, projectile contact, damage, terrain levels, structural support and settled obstruction belong to the server. Individual visual soldiers, small sparks, dust, fragments and pose blending remain presentation. A cosmetic fragment cannot independently damage a unit, obstruct a route or reveal terrain.
- A new ordered command overrides voluntary traffic adjustments immediately. Stop applies braking to vehicles rather than teleporting their velocity to zero. Retreat preserves existing protection and destination rules. Hold Position, garrisoning, construction and setup weapons retain their constraints; traffic logic cannot silently release them.
- Apply the new engine behavior across modes where the relevant entities exist. Production editing applies to Production Buildings in Classic and World Conquest; Wave profiles apply only to Horde; scenario progression applies only to authored scenarios. Preserve each mode's victory, population, resource and recovery rules, and existing naval movement classes.
- Every authoritative projectile, recruitment job, structural section and scenario execution has a stable match-scoped identity. State transitions and rewards resolve once. Recipient-filtered snapshots carry current durable state; transient events carry enough timing and identity for presentation to avoid replaying old impacts after reconnect.
- Filter new terrain, obstruction, projectile and collapse data using the same current-vision and remembered-world rules as their recipient's mode. Intentionally tighten existing local collapse/impact effects that currently travel through fog as public effects. Preserve genuinely public Air Support warnings, Weather announcements and explicitly public scenario messages. A hidden mine must not change a player's route preview or delivered navigation metadata before discovery.

### Layered world and terrain changes

- Separate the base surface and elevation from placed objects, structural sections, mines, settled rubble/wrecks and derived movement, cover and sight properties. Ground damage changes the surface; placing or removing an object changes its layer. A mine over a road leaves the road intact, while a crater caused by its explosion may damage it normally.
- Use a versioned map and scenario format, with validation and an explicit migration from current character-row maps. Existing maps remain loadable and retain their known surface/movement meaning. Where an old mine cell has already lost its former surface, use the documented legacy default ground rather than inventing a road. Saving the new format retains independent layers, section/support metadata, material and authored scenario data.
- Make terrain and object mutations one authoritative operation that updates derived cover, sight, movement masks, coarse connectivity and network dirty state. The client invalidates only affected terrain/render chunks. Keep private truth and each team's remembered state separate, including reconnect baselines and delta application.
- Infer conservative structural metadata for existing houses and bridges, and expose explicit sections, support anchors and material in the map editor. Validate unsupported starts, impossible support references and invalid footprints before hosting. Authored supported spans may survive beside a failed section; the migration must not create magically supported floating deck cells.

### Navigation, local traffic and vehicle motion

- Keep global routing separate from local steering and final nonpenetration correction. Build a coarse region/portal graph for each movement class, guide bounded fine searches with that graph, and retain a complete order goal across route legs. Cache by movement class and terrain/obstruction version, with recipient knowledge included wherever the result is player-visible or AI-observable.
- Use the spatial grid for predictive nearby traffic checks. Choose deterministic yield priority from order urgency, existing occupancy and a stable tie-break. Age blocked requests to avoid starvation. Use a bounded wait, local alternative and replan sequence instead of alternating left/right indefinitely. Do not make a new all-pairs unit pass.
- Permit overlapping squad presentation inside the existing authoritative squad footprint rules, but prevent vehicles and structures from interpenetrating. A unit making room may not leave protected cover for a clearly worse exposed location without an order. Track completion, interruption and unreachable outcomes separately so queued orders still begin at the right time.
- Give ground vehicles type-specific maximum speed, forward/reverse acceleration, braking and hull turn limits, with existing slope and Weather effects. Keep tracked turn-in-place and short reverse maneuvers where appropriate. Infantry keeps immediate directional response; crewed guns retain their existing setup requirements. Naval and air movement retain their distinct class rules rather than receiving ground-vehicle constraints automatically.
- Separate desired travel direction, hull orientation and weapon aim where a unit has a turret or independent mount. Preserve documented firing arcs and setup rules. Swept footprints prevent a vehicle cutting through a wall during a turn, and contact correction does not add speed or create an uncommanded damaging collision.
- Treat tuning values as named movement profiles selected and recorded during implementation. Existing top speeds are the initial comparison baseline. Accept profiles on response, stopping distance, turn clearance and successful travel, rather than prescribing unmeasured real-world tank specifications.

### Projectiles, timing and material response

- Create a server-owned flight record for each gameplay round or equivalent batched volley. It includes launch time, origin, position/velocity, weapon profile, owning side and consumed impact state. Direct gunfire uses a non-homing launch solution. Existing accuracy, moving-fire, cover and suppression effects become launch dispersion or eligible collision/damage modifiers, rather than immediate damage followed by a decorative tracer.
- Use swept collision over the traveled segment, including relative movement of eligible targets and sampled terrain/structural surfaces. High-speed small-arms rounds may resolve through an analytic sweep within a tick; slower shells and grenades integrate over successive ticks with gravity where appropriate. Rendering uses the same launch and arrival times. Batch equivalent infantry rounds without discarding intervening-obstacle or hit-location behavior.
- Give each contact a stable sequence identity. Resolve a terminal impact or expiry once; a qualifying ricochet is a nonterminal contact that consumes energy and continues the same flight without applying a terminal blast. Contact damage, local surface deformation and any resulting breach/support failure resolve at that contact, once. Terminal explosive blast damage and its resulting terrain/structural changes resolve separately once, only on terminal impact. Health loss contributes to veterancy and Kill Bounty once through existing accounting. A shooter dying does not remove its launched round, and an intended target disappearing does not redirect the round toward a replacement. Deduplicate suppressive near misses per flight/volley and affected target rather than applying them at every traveled segment.
- Preserve current direct-fire team safety as the default: allied unit bodies do not intercept ordinary direct rounds. Explosions and abilities retain their existing friendly-fire rules. Terrain and structures still block eligible rounds. This is a documented gameplay rule, not a claim of complete real-world ballistics.
- Give materials explicit hardness, contact normal and rebound/absorption behavior. The initial contact-response model may deflect a qualifying gun round at a shallow hard-surface contact with reduced energy and a bounded contact count. Explosive shells detonate according to their weapon profile rather than becoming bouncing bullets. Retain existing front/rear armor and AP ability meaning; a full thickness-based armor penetration and internal-component simulator is outside this spec.
- Use bounded mass-sensitive impulse for wrecks and collapsing sections, followed by damping/gravity and settling into static world state. Keep living-unit movement under orders; do not add general knockback, infantry crushing or ragdoll-based hit detection. Small cosmetic fragments can bounce against nearby known surfaces and terrain using the same material family.
- Reconcile display flight with authoritative impact after jitter, missed snapshots and late visibility. Do not apply health changes locally to hide latency, and do not keep a visual shell flying through a surface after the server has resolved its contact. Recipient filtering must not reveal a hidden shooter, target or unexplored portion of a trajectory.

### Structural destruction, rubble and fire

- Represent destructible houses, constructed buildings and bridge spans as a bounded graph of cell/section-sized elements with health, material, support connections and anchors. Direct damage breaches the affected section. Reevaluate support after a breach; every surviving section needs a valid structural path to a surviving anchor, so a disconnected cycle cannot support itself. A whole structure can still collapse when its remaining support is lost.
- Keep a constructed building's existing owner, total-health budget, construction progress, recruitment identity and defeat significance. Section damage debits that same total-health budget once, rather than duplicating entity and terrain damage. A local breach does not delete a surviving Production Building, cancel its queue, transfer ownership or satisfy a World Conquest claim lock. Total-health exhaustion or loss of all functional structural support destroys the entity through the existing destruction/endgame path. Engineer building repair remains free and progress-based, distinct from paid new construction and Bridge rebuilding. It restores damaged or failed sections inside a surviving building's existing footprint only when support and placement are valid; it cannot revive a destroyed entity for free. Re-test Construction Site cancellation, Classic Annihilation and World Conquest claims/recovery against this model.
- Use the impact direction, structure layout and bounded server impulse to choose collapse direction and final rubble footprint. Replicate that final footprint and structural state. Client fragments illustrate it without selecting new obstruction positions. Once settled, debris becomes normal static world data rather than a permanent rigid-body simulation.
- A breached garrison applies the existing eviction and damage rule to occupants of the failed section, once. A bridge occupant on failed deck receives the existing crossing-loss consequence; units on supported deck remain. Preserve existing fire damage and trench protection. Rubble placement respects occupied vehicle footprints instead of creating an overlapping obstacle beneath a live vehicle.
- Give soil, road, stone/concrete and structural materials different documented damage/deformation profiles. Crater depth respects the existing height, slope, flooding and movement rules. Layering permits a damaged road to retain a recognizable road surface until damage actually destroys it. Client craters must agree with authoritative elevation rather than only painting a darker circle.
- Preserve bridge rebuilding through the existing paid Bridge order, reach, construction-time and terrain/vision checks. New deck sections attach to surviving banks, anchors or supported sections; invalid floating rebuilds are rejected. Restored spans use the existing replacement bridge material policy rather than recovering the old stone strength for free. AI rebuilding uses remembered/discovered bridge locations and observed missing sections, with no privileged scan of private support state. Clearing rubble or a wreck removes the object layer and reveals its current underlying surface.
- Extend fire with readable burning/damaged/failed section states, driven by the existing fire lifetime, wind, wetness and structural damage. Fire weakens support through the same damage path as shelling. Repairs, extinguishing where already supported, failure and reconnect must not leave orphaned smoke or duplicate collapse events.
- Bound active moving sections and cosmetic fragments, and process large support/terrain updates incrementally without permitting units to traverse a section already marked failed. Overflow consolidates the same authoritative final collapse into static state; it never skips damage or produces a different route because one client has fewer particles.

### Structured scenarios and authoring

- Add validated, data-only conditions for elapsed match time, Point/Region ownership or capture, a referenced unit/group lost, surviving group count, entry into a defined area and prior objective/trigger completion. Conditions combine through explicit all/any groups. References identify authored entities or stable runtime groups, not arbitrary executable expressions or hidden client queries.
- Add actions for localized side/public announcements, objective activation/completion, bounded reinforcements at a valid authored entry location, normal orders for that group, and localized structural/terrain damage or destruction. Reinforcements have explicit side, roster, count and order; obey eligible unit classes, playable space and population/field limits. Deferred reinforcements remain in bounded scenario bookkeeping until they can enter or their documented expiry cancels them. Keep that bookkeeping separate from the Horde Reserve and Wave completion; a scenario must not add uncounted Horde enemies or cause a Wave to finish early. Scripted grants are authored mission effects, not a new player command for free units. Keep normal mode victory authoritative; completing a scenario objective cannot arbitrarily declare a winner in an ordinary mode.
- Each trigger declares match/player/team scope, recipient policy and once-only or bounded repeat behavior. A repeat has a positive cooldown and finite maximum execution count, with a declared rising-edge or while-true condition. Evaluate at simulation time in stable authored order. Assign an execution ID before applying its action list atomically; track deferred arrivals separately so reevaluation cannot enqueue the same group twice.
- Persist objective state, execution counts, cooldowns and deferred reinforcements in authoritative match state. Reconnect receives the permitted current objectives and world state, without re-executing old triggers or replaying expired announcements. Scenario queries do not become an information-disclosure channel for players or AI.
- Extend the existing map editor with condition/action selection, area/target picking, recipient and repeat settings, and validation feedback. Enforce finite limits on trigger count, action count and total per-tick work in the shared validator/runtime, with rejected cyclic objective dependencies and invalid entity references. Load/save round-trips the same contract. Migrate legacy time/say/blow triggers while preserving their declared public announcements. Do not require rewriting the separate tutorial before authored scenarios can use this engine.

### AI operations and Horde profiles

- Extend AI operations with persistent member identities, role assignments and staged states: assemble, advance, engage, regroup, withdraw and complete/abandon. Place support weapons in reachable known positions that can support infantry. Bound regroup time; a lost, retreating or blocked member is removed or reassigned instead of freezing the assault.
- Reevaluate known weapon matchups, available support, recent observed losses and reachable cover while engaged. Withdraw when the observed fight becomes untenable, then use a cooldown and distinct resume threshold to prevent charge/retreat oscillation. Keep existing reaction delays and difficulty differences. The AI submits normal validated commands from its filtered observation; it cannot query private enemies to justify a withdrawal.
- These operation controls apply to AI-owned forces. Player squad behavior keeps its existing Stance and manual order rules. If a seat or unit stops being AI-controlled, clear operation claims so subsequent player orders are not overwritten. Local World Conquest defenders retain their region-bound role rather than gaining a continent-wide assault planner.
- Define seeded Horde composition profiles using existing units, Wave unlocks, MP budgets, Reserve handling and field caps. Start with mixed/infantry pressure, armor and siege categories. A profile is eligible only when its defining units are unlocked and purchasable; fall back to a legal mixed profile when needed. Bound consecutive repeated profiles without giving defenders an exact roster preview.
- Announce the selected next profile during the existing break, with localized text and a broad threat cue. Preserve normal unit stats, bunker scaling, support/air unlocks and the rule that no next Wave starts while the current Wave retains forces or spendable purchase budget. Measure the profile's share of spending and actual deployed roles to ensure the warning describes the attack.

### Production, Alerts and control groups

- Give waiting Production Building jobs stable IDs, status and the exact charged MP/Fuel amounts. Expose individual waiting jobs in the Command Card with cancel controls and refund text. Recommended initial rule: a waiting job refunds 100% of its actual charge; the active job cannot be cancelled. Active-job cancellation and arbitrary queue reorder are outside this first contract.
- The head is active as soon as a free producer accepts it, including zero elapsed training and a head stalled on its exit. Subsequent jobs are waiting until promoted. Migrate snapshot decoding, AI own-queue observations, population/unit-limit accounting, paid recovery, production completion and Sudden Death cleanup together. Expose job identities/costs only to their permitted owner view. Refunds reverse the corresponding spent-MP accounting as well as returning MP/Fuel, so reports remain accurate.
- Validate ownership, match state, building and waiting status server-side. Resolve cancellation atomically with starting/completing a job. Duplicate or stale requests cannot refund twice, cancel a different identical job or cancel the now-active head. Preserve all remaining queue order and active progress, and release the cancelled job's population reservation using existing accounting.
- Retain the existing Construction Site cancellation policy. Production-building destruction follows its existing queue-loss/refund behavior; adding the new cancel command must not invent an additional refund path. Reconnect presents authoritative IDs and status rather than reconstructing job identity from unit names or row indices.
- Add a match-local Alert history of the most recent 100 delivered entries, with match time, original localized text, category and recorded location. Keep current transient notices and Space behavior. Provide a collapsible history, previous/next navigation and click-to-location. Reopening an Alert does not make sound again, query an enemy's current position or update remembered terrain. Preserve history across a connection interruption in the same tab, clear it on a new match, and deduplicate retained events.
- Add an explicit Move to control group action for the selected eligible own units, with a documented unassigned keyboard binding and visible destination feedback. It removes those unit IDs from every other group, then appends them to the destination without removing its existing members. Existing ordinary replace/add assignments continue to allow overlapping membership. Preserve double-recall camera behavior, saved formations and dead-unit cleanup.
- Add new player-facing text to the current English/Spanish language system. Match existing Command Card, controls and Alert styling; include accessible names, keyboard operation and layouts that fit supported small screens. Keep implementation details such as cache versions and physics budgets out of those controls.

### Vehicle cues, ambience and animation work

- Derive living-vehicle smoke and damage cues from currently delivered health/damage state, with hysteresis around cue thresholds to avoid flicker. Increase cues in restrained stages, fade them after repair, and transfer to existing wreck/fire effects on death. Never attach a fresh cue to an unseen enemy or replay an impact merely because the camera returned.
- Build environmental sound from currently known nearby terrain and public Weather: water, woodland, wind and rain. Use camera-relative spatial weighting, bounded active sources, gradual crossfades and the existing volume/mute controls. Add no music system. Ambience cannot expose an unexplored river, hidden fire or enemy activity through sound.
- Determine camera interest before expensive per-model pose and mesh updates, with a margin covering spread-out soldiers and screen-edge effects. Maintain cheap current transforms and essential visual state off-screen, then evaluate the current pose on return rather than replaying every missed animation frame. Selected/visible combat remains detailed. Simulation, visibility and command processing are never culled.
- Reuse existing instancing, graphics settings and effect caps. Correct visibility-dependent animation cost is included; a new adaptive system that prioritizes particle classes or lowers/restores cosmetic quality during load is not included because that research option was not selected.

### Delivery order and completion

| Phase | Deliverable | Dependency and completion evidence |
| --- | --- | --- |
| 1 | Queue cancellation, Alert history and group transfers; baseline benchmark fixtures | Independent controls can ship first. Show normal browser flows and authoritative queue/refund outcomes. Record before-change measurements for later phases. |
| 2 | Layered maps, materials, atomic world mutation and knowledge-safe replication | Load/save legacy and new maps, preserve a road under a mine, and verify hidden changes and reconnect on two clients. This supplies the common world contract. |
| 3 | Coarse navigation, traffic and vehicle profiles | Use phase 2 obstruction state. Prove complete long orders, crossing throughput, turn clearance and prompt interruption under destruction. |
| 4 | Physical flight, authoritative impacts and bounded material contact | Use the layered collision surfaces and moving footprints. Prove first-contact damage, moving-target misses and jitter-safe visual timing. |
| 5 | Local structural/support failure, persistent directional rubble, craters and progressive fire | Use phases 2 and 4. Record one shared destruction scene, reconnect and reroute through its resulting state. |
| 6 | Structured scenario runtime and editor authoring | Use layered map validation and normal damage/reinforcement contracts. Show a saved authored mission with combined conditions, bounded repeats and reconnect-safe objectives. |
| 7 | Persistent AI assaults/withdrawal and Horde profiles/warnings | Exercise the final movement/combat rules. Show observed-information fairness, useful role coordination and distinct equal-budget Waves. |
| 8 | Vehicle cues, location/Weather ambience and early animation gating; integrated scale validation | Cues and ambience use final filtered world state. Show repair/death/visibility transitions, off-screen reentry and representative full-match measurements. |

Each phase requires its acceptance checks, player-facing evidence where applicable, an updated design record and changelog, and the mandatory game regression suite. Independent presentation work may proceed earlier against settled interfaces. Do not call the overall spec complete when only the smaller control phase has shipped, or treat a flag hiding unfinished systems as acceptance.

## Testing Decisions

- **User-confirmed primary seam:** use real WebSocket clients joining the existing authoritative room server, sending normal commands and inspecting delivered start messages, snapshots, denials, Alerts and results. Existing World Conquest tests already stop the automatic loop, arrange fixtures and advance the server explicitly. Reuse that setup and clock control across relevant modes. Fixture placement is allowed; acceptance actions and observations must use public commands and recipient-filtered payloads.
- **Test behavior:** assert routes reached, obstacles respected, impact timing, resulting health/world state, correct refunds and information disclosure. Do not assert private helper calls, array layouts, exact A* paths or copied implementation formulas. Exact historic path hashes are not valid oracles where this spec intentionally changes routing.
- **Supporting browser seam:** use the normal app with real clients for control flows, flight/impact presentation, destruction, audio behavior and camera movement. Existing Node rendering adapters with mocked DOM/renderer remain useful regression checks, but they do not establish browser frame time, sound quality or visible correctness. Small client-level tests may cover a UI race that cannot be observed reliably through a server snapshot; do not create a separate framework for every module.

| Acceptance scene | Required observable outcome |
| --- | --- |
| Crowded crossing with two-way squads, tank and support gun | All reachable travel orders complete within the fixture's documented bound; congestion alone cannot be reported as unreachable. Only a genuinely disconnected known route permits an unreachable outcome. Traffic does not oscillate forever, violate footprints or abandon protected defenders. Stop/new order/Retreat interrupts voluntary yielding. |
| Tight tank turn, reverse and sloped stop | Hull, footprint and displayed motion agree; acceleration and braking are finite and profile-consistent; the tank cannot cut a wall or gain speed from collision correction. Infantry keeps responsive movement. |
| Long route, then discovered bridge failure | Full destination and queued order survive local legs; a legal alternative is taken, or a fair unreachable outcome is delivered. Changing an unseen mine or bridge cannot alter pre-discovery route feedback. |
| Gun round toward a moving target behind a thin obstacle | No pre-arrival damage; a swept first contact stops or deflects the round according to its profile; a target leaving the path is not chased; shooter death and duplicate delivery do not cancel or duplicate the impact. |
| Friendly direct-fire lane and nearby explosive impact | Ordinary direct rounds keep team safety, while explosions retain existing friendly-fire behavior. Death, suppression, veterancy and Kill Bounty resolve once at the authoritative event. |
| Mine on road, then removal and a separate damaging blast | Placement/removal preserves the base road; the blast changes surface/height only through normal material damage. Movement, cover, sight, editor save/load and client state agree. |
| House corner beside a road, independent supported section, bridge and soft/hard ground | A local breach precedes dependent collapse; supported sections remain and disconnected support cycles fail. Rubble direction/footprint is authoritative; bridge losses affect only failed deck occupants; equal blasts create different documented deformation in different materials. Paid rebuilding restores a supported crossing, while invalid floating sections are rejected. |
| Burning supported structure during rain, followed by reconnect | Fire progresses through damage states, Weather affects it through existing rules, support failure applies once, and the reconnected client receives the current settled world without old impact playback. |
| Same hidden world change observed by two teams at different times | The uninformed team receives no changed terrain, Ghost, obstacle, trajectory, cue or ambient sound before observation. The observing team sees current state; legitimate public warnings remain public. |
| Scenario with capture, loss, area entry, delayed reinforcement and destruction | Validated conditions execute normal effects with correct ownership and count. Once-only and bounded repeating conditions cannot duplicate on reconnect, host action or condition persistence. Invalid references are rejected before a match. |
| AI rifles and supporting MG/gun making first contact | Operation membership persists, support uses reachable useful ground, blocked members time out and the operation can regroup and continue. Losing known matchups causes a healthy withdrawal without oscillation or private-information dependence. |
| Matched-seed AI observation pair | Perturb only unseen enemy state and require the same observable AI decisions until discovery. Observe a reinforcement and require a bounded reaction according to difficulty, rather than an immediate private-state response. |
| Horde profiles across defender counts and unlock boundaries | Announced category agrees with delivered mix, every purchase is legal, budget/field/Reserve limits hold, and the next Wave waits for all current obligations to end. Equal-budget profiles create different counter needs. |
| Two identical waiting recruits behind an active head | Cancel the second by ID, preserve head progress and remaining order, refund exact original MP/Fuel once and release correct population. Reject rival/defeated/stale/now-active cancellation without changing another job. |
| Expired Alert and an AT Gun transferred between groups | Old Alert retains original time/location without new sound or knowledge; history is bounded and resets on a new match. A transferred gun leaves former groups, while ordinary overlapping assignments and recall still work. |
| Damaged/repaired/destroyed vehicle and camera movement through known terrain | Living cues follow health without threshold flicker; repair and death clear/replace them. Water/woodland/Weather ambience crossfades, respects mute and does not reveal hidden terrain or bury a critical Alert. |
| Large off-screen army and immediate camera return | Visible units show current transforms and pose on the first returned view; dead/hidden units do not reappear; off-screen animation cost falls measurably while gameplay and graphics-setting outcomes remain identical. |

- Capture inspected before/after screenshots for visible changes and recordings for multi-step controls, moving projectiles, vehicle handling and collapse. Record audio for sound changes alongside camera/Weather state. Use two clients for the shared destruction scene and reconnect. Label temporary staged fixtures; they are evidence of the exercised behavior, not an unstaged full match.
- Measure server tick p50/p95/p99, movement-command latency, navigation/AI/projectile/support-update cost, payload sizes/update gaps, active and settled debris, memory and client frame p50/p95/p99. Include hardware, browser/runtime, graphics settings, map, player count, army size, seed and fixture conditions. Add bounded browser frame instrumentation where the current one-second counters do not expose percentiles; do not infer GPU performance from mocked renderer tests.
- Compare quiet play, busy crossing, distant armies, sustained bombardment and a representative integrated match, including existing World Conquest Huge/Massive presets and Horde field limits. Accelerated-funds or manually stepped benchmarks are controlled fixtures; also check normal real-time ticking and compression-enabled networking. Target the existing 20 Hz simulation and existing runtime warning limits, including the 40 ms snapshot-tick budget. A new threshold or hardware support claim requires measured evidence.
- Run the mandatory `node test.js` before any implementation commit. Run relevant existing performance, client-adapter, lobby and World Conquest regressions when those surfaces change. Once checks pass, broaden only for an actual remaining concern. Record test results against the final implementation source in the verification report.
- For movement/combat/AI phases, run paired seeded comparison matches, record travel failures, operation completion/abandonment, losses, match length and faction outcomes, and review representative replays/recordings. For Horde, compare profile spending and defender outcomes at legal unlock transitions. Balance sample size and tuning numbers belong in the design record and changelog; a small successful scene is not proof of balanced gameplay.
- Paired fixtures control every random stream and the command schedule, including the current mixed seeded and global-random combat paths. A harness-local seeded override is existing prior art. State those controls in the evidence; do not claim deterministic replay from seeding only the map, and do not add a replay engine to satisfy this spec.

## Out of Scope

- An engine rewrite, wholesale port of another RTS, or a physics-library migration.
- New faction rosters, technology trees, naval unit families, campaign politics, diplomacy or changes to mode victory rules.
- Full per-soldier authoritative rigid bodies, ragdoll hit detection, internal vehicle components, a thickness-based armor simulator, general living-unit knockback or a new crushing-damage system.
- Unlimited fracture, permanently active rigid-body rubble, a voxel world rewrite or complete physical fluid simulation.
- Active recruitment cancellation, arbitrary queue reorder, production automation or a new construction refund policy.
- An arbitrary JavaScript scenario runtime, a full replacement World Editor, or campaign persistence. Structured conditions/effects and their editor controls are included.
- A new adaptive particle-priority/cosmetic-quality system, the unselected tenth addition. Existing graphics settings and effect limits remain available.
- Research alternatives that were not selected, including a new lost-contact investigation system, a new combat-music system or a new general snapshot-recovery protocol.
- A guaranteed frame rate, real-world vehicle specification, balance result or measured improvement before validation.
- Copying third-party game assets or treating an emulator, editor or partial reverse-engineering repository as the complete original commercial engine.

## Further Notes

- The accepted scope is recorded in the design roadmap. The source comparisons are in [RTS engine research](rts-engine-research.md), [nine approved game-feel additions and one researched option](game-feel-research.md), and [physics and world destruction](physics-destruction-research.md). Supporting audits describe current behavior and inspected source mechanisms; they are not implementation proof.
- Reference patterns include Recoil movement/contact/deformation, Warzone traveled-segment collision, 0 A.D. impact scheduling, HiveWE independent terrain/pathing, OpenRA hierarchical routes/operations/UI/ambience and Age of Mythology scenario tooling. Use those patterns to implement this game's own contracts. None requires replacing this engine or reproducing another game's exact unit behavior.
- Current-source baseline: direct ordinary fire applies immediate damage, while grenades/salvos already have delayed resolution; map cells have a single primary terrain character; connected bridge cells fail recursively; generic triggers support timed announcement/destruction; queue controls cannot cancel individual recruits; expired Alerts are discarded; detailed soldier animation precedes draw-time frustum checks. Existing features should be extended rather than recreated under new names.
- Recommended defaults chosen here are waiting-only cancellation with a full exact refund, 100 match-local Alert entries, responsive infantry with constrained ground vehicles, preserved team-fire rules, a bounded section/support model, observed-information AI and structured scenario actions. Numeric material, ricochet, movement, smoke, regroup and profile weights remain implementation tuning with documented fixtures and measurements.
- The user confirmed the testing boundary on 2026-10-03. No additional product interview is required to write this spec. Publishing it does not authorize a claim that any phase is built, tested, merged or deployed.
- During implementation, update the glossary for adopted new player terms, keep design decisions and balance measurements synchronized, and add a player-facing changelog entry for every slice. Keep the tracker issue and this document aligned when the implementation contract changes.
