# Supply routes and physical convoys

Date: 2026-10-05
Status: Implemented. User authorized execution without further prompt gates.

## Intent and success criteria

Make flanking and encirclement a practical alternative to a frontal assault. Isolated armies carry enough reserves for a rescue, relief delivery, or breakout before shortages force withdrawal. Deep offensives become risky when deliveries cannot follow. Logistics must work for a player who never selects, builds, or dispatches a convoy, while allowing direct truck control when wanted.

A safe, adequately funded supply system must sustain ordinary combat automatically. Physical distance, enemy interdiction, depleted stockpiles, or destroyed sources can interrupt delivery. A single lost truck never instantly empties an army's reserves. Shortages and routes must be understandable from information available to the player, without revealing hidden enemies or unexplored World geography.

## Agreed scope

- Enable the new system in Conquest, Classic, Annihilation, and World Conquest.
- Leave Assault, Horde and Tutorial unchanged. Scripted scenarios in supported modes require explicit logistics opt-in.
- Apply reserves to player-controlled mobile ground infantry and vehicles, including Engineers, Medics, halftracks, and artillery. Buildings, emplacement weapons, logistics trucks, aircraft, naval units, and stationary neutral World defenders do not use these troop reserves.
- Preserve aircraft sortie ammunition and fuel. Naval delivery, surrender, captured cargo, and conversion of enemy units are outside this version.
- Existing recruitment prices, weapon damage, accuracy, armor, cover, suppression, veterancy, victory conditions, and population rules remain the initial baseline.
- Preserve each mode's existing income rules. The old capture-point connection check remains an income rule, distinct from actual deliveries to units. World regional income continues regardless of connections. Use separate labels for lost income connections and depleted troop reserves.

## Unit reserves

Newly recruited ground units begin fully equipped. Their existing recruitment price includes this starting equipment. Replacement supplies require actual cargo transfer from a source, cache, or truck within service range. Changing commands or toggling a setting never creates supplies.

| Reserve | Capacity | Consumption |
| --- | --- | --- |
| Ammunition | Approximately 90 seconds of sustained firing at the weapon's ordinary full-strength rate | Accepted projectile launches, including misses, terrain fire, salvos, anti-air fire from eligible ground units, and offensive abilities |
| Provisions | 120 seconds | One second per second of simulation time, including idle time, garrisoning, and transport |
| Ordinary vehicle fuel | 180 driving seconds | Actual powered travel, including reverse movement and retreat |
| Emergency vehicle fuel | 60 driving seconds | Actual travel during mandatory withdrawal or an escape attempt only |

Ammunition capacity rounds up to a complete normal volley or salvo. Faster ability fire burns ammunition faster; suppression that slows firing conserves it. A reduced-strength squad consumes ammunition for its living shooters. Idle weapons consume no ammunition. Each accepted launch is charged once, never again on impact. Partial ammunition supports only projectiles actually present; a weapon cannot launch an unfunded projectile. Non-offensive abilities such as smoke and sprint keep existing currency/cooldown rules without consuming gun ammunition. Explosive offensive abilities consume an appropriate weapon-equivalent volley as well as their existing ability cost; they cannot bypass empty ammunition.

Fuel consumption follows seconds of actual travel at the unit's effective speed. Waiting, blocked paths, external displacement, turning in place, and riding inside a transport consume no driving fuel. Movement in the carried vehicle burns that vehicle's fuel. Terrain therefore affects distance obtainable from a full reserve. Supply state does not reduce normal movement speed.

## Shortages and withdrawal

| Condition | Effect |
| --- | --- |
| Ammunition below 25% | Double the ordinary firing interval |
| Ammunition empty | No ranged projectile or offensive explosive launch |
| Provisions below 25% | Healing, repair, and reinforcement operate at half their otherwise applicable rate |
| Provisions empty | Recovery stops; double firing interval; begin a 20-second withdrawal warning |
| Warning expires before the recovery thresholds have been met | Enter mandatory withdrawal |
| Ordinary vehicle fuel empty | Enter mandatory withdrawal immediately, using emergency fuel |
| Emergency vehicle fuel empty | Vehicle cannot drive until refueled |

Apply the firing shortage multiplier once when both shortages exist. Existing suppression and ability modifiers still operate through their established rules. Replenishing a small amount does not reset an exhausted unit's warning or release mandatory withdrawal.

Cancel an exhaustion warning or mandatory withdrawal only when the unit has at least 50% provisions, at least 50% ammunition if it has a weapon, and at least 50% ordinary fuel if it is a vehicle. Latch the exhausted-provisions state and its penalties until these recovery conditions are met; partial refills do not repeatedly clear and recreate it. During the warning the player may still order fighting, rescue, or escape. Emergency fuel is replenished by delivered fuel after ordinary fuel. Reaching a base alone does not bypass these conditions. Resupply uses real stock and takes time.

Mandatory withdrawal overrides attacks, construction, capture, and ordinary stance changes. The player may choose another valid withdrawal destination or direct a physical escape route. Stop can pause an escape attempt but cannot restore normal combat or erase exhaustion. The ordinary auto-retreat toggle does not disable supply withdrawal.

When no physical escape path is available, retain the unit in the pocket. Allow it to fight using remaining ammunition and shortage penalties, or attempt player-directed breakout movement. Retry withdrawal when an opening appears. Path failure is not arrival and never clears mandatory withdrawal. No automatic death, teleport, surrender, or removal occurs.

Use the existing 1.5x retreat speed and 25% incoming-damage multiplier only while actually progressing along an escape/withdrawal route. Stationary, blocked, or fighting stranded units receive no retreat protection. A stranded unit never gains protection by repeatedly issuing a failing move command. Routes end at a valid friendly recovery location, not an enemy-held former home. A relief convoy may restore a pocket to normal combat even while enemies still surround it.

## Supply sources, caches, and forward support

In Conquest and Annihilation, a living participating player's starting base is a source. In Classic and World, completed living allied HQs are sources. A World rebuilt HQ immediately qualifies as a source; ownership of remaining regions still follows the existing recovery and defeat rules. Barracks, resource-producing Supply Depots, Field Hospitals, and halftracks are not independent supply generators.

Do not repurpose the existing `depot` unit, which produces resource income. Give the logistics store a distinct type and player-facing name, **Supply Cache**.

- Source service radius: 15 metres. Nearby units can transfer directly, without requiring a truck to drive a zero-length trip.
- Cache service radius: 15 metres. Initial cache capacity: 32 reference unit-equivalents of each commodity, scaled by the selected army-size multiplier. One reference equivalent is 3 Munitions of compatible-ammunition credit, 120 provision seconds, or 180 ordinary driving-fuel seconds (6 Fuel). These are inventory conversion units, not additional currencies shown to players. Weapon-specific ammunition prices can make a cargo refill more or fewer than eight magazines.
- Existing held supply-depot Points provide a finite logistics cache. Eligible fortification builders can additionally build a Supply Cache for 60 MP in 12 seconds using the existing fortification workflow. Construction modes respect owned-land placement rules. A placed cache is a targetable 400-HP store with a 2x2 footprint and no combat population cost.
- In World, each friendly captured region automatically establishes a finite regional cache at a vehicle-accessible location near its control point. This requires no player command or purchase.
- Regional cache ownership follows the region and does not add a second prerequisite to claiming a region. A destroyed regional cache automatically rebuilds after 30 seconds while the region remains friendly, with empty inventory. Built standalone caches require reconstruction by their owner. Depot-Point stores are disabled while the point is enemy-owned or contested and return empty after an ownership change.
- Initial home caches can draw from their colocated source. Newly conquered regions and newly built forward caches begin empty. Changing ownership does not create stock. Enemy capture destroys remaining logistics stock instead of transferring or duplicating it.
- World relays prefer physically reachable adjacent friendly regions. Region ownership is not itself a physical path; terrain changes can make a relay unusable.
- A disconnected relay chain can distribute its existing stocks until depleted. The scheduler must never refill an upstream cache from its own downstream shipment or count in-transit cargo as available inventory.
- Local transfers require a reachable handoff within the stated service radius, with a local path no longer than twice that radius. A service radius does not transfer cargo across impassable water, sealed terrain, or a broken crossing. Garrisoned and riding troops use their actual building/transport entry or host for the handoff.

Halftracks and Field Hospitals provide finite forward-support stocks, initially four reference equivalents of ammunition and provisions. Deliveries replenish them. They do not create cargo and cannot sustain a pocket indefinitely. Reinforcement remains paid in MP and also consumes five provision seconds per replacement soldier from the support location. Field treatment and repair consume one provision second per five HP restored, and obey both the patient's shortage state and the support provider's available provisions. A Medic uses its own carried provisions for treatment. Initial support stocks are included in the existing purchase/construction cost. Troops receiving replacement soldiers do not gain free ammunition or fuel from reinforcement.

An overseas expedition uses its carried reserves until it establishes a suitable local source. Trucks do not cross water without a ground crossing. Sea convoy chains are not implicit in this version.

## Trucks and autonomous dispatch

Create an unarmed, targetable **Supply Truck** ground vehicle with 120 HP, 7.5 m/s base speed, normal wheeled terrain behavior, and 12-metre sight. Trucks cannot capture, build, reinforce soldiers themselves, transport passengers, attack, occupy combat population, or be recruited through combat cards. Existing collision, projectile, terrain, visibility, and pathfinding rules apply. Their loss is a cargo and delivery loss, not a permanent fleet reduction.

Initial scheduling parameters:

| Parameter | Initial value |
| --- | --- |
| Desired trucks per player | Clamp `2 + ceil(eligibleTroops / (4 * armySizeMultiplier))` to 2 through 24 |
| Cargo capacity | Eight reference unit-equivalents of each commodity, multiplied by armySizeMultiplier |
| Initial fleet spawning | At an available allied source, one truck per second until the target is reached |
| Destroyed truck replacement | 30 seconds before replacement eligibility, then normal staggered spawning |
| Loading time | Four seconds |
| Unloading time | At most eight seconds for a full cargo, transferred incrementally |
| Truck delivery radius | 12 metres |
| Dispatch/scheduling interval | Two seconds, staggered across players |

Reduce surplus fleet target by retiring empty automatic trucks at a source. Never delete loaded, travelling, held, or manually controlled trucks to shrink the fleet.

Automatic jobs serve home units, replenish relays, supply forward stores, and deliver to troop groups. Allocate jobs by earliest projected shortage, outstanding incoming cargo, and reachable safe route. Prevent multiple trucks from reserving the same missing cargo. Group nearby troops; do not create a dedicated route and truck for every soldier. Full reserves, idle stocks, and empty destinations generate no delivery job.

Plan enough fleet and cargo throughput to sustain normal firing and provisions consumption along safe, affordable routes. Regional relays are physical loading/unloading stops, not instantaneous transfers. Deep expansion before a delivery pipeline is established remains an intended risk.

Avoid known enemy firing positions and observed blocked terrain when a safe route exists. Do not consult invisible enemy units, hidden mines, or undiscovered World terrain to decide that a route is dangerous. Unknown ground follows the existing fog-safe movement behavior. When all known routes are dangerous, hold automatic cargo at a source/cache and emit a grouped warning. Reevaluate as knowledge and geometry change.

Manual movement and queued waypoints override dispatch. Completed manual movement resumes automatic service. Explicit hold/stop retains manual hold until the player resumes automatic deliveries or issues a new order. Add a clear **Resume deliveries** control. An explicit relief order may enter known danger. Reaching an allied unit or cache with a direct supply order unloads compatible carried stocks; mere movement is not a free transfer of global resources.

## Economy and ownership

Conquest and Annihilation generate cargo without Fuel or Munitions currencies. Provisions are generated free at sources in every selected mode. Classic and World pay for physical ammunition and fuel when loading at a source; caches merely transfer cargo already paid for.

Initial ammunition cargo prices, expressed per simulated projectile equivalent:

- Small arms, MG, and autocannon: 0.01 Munitions.
- Ordinary tank, AT, and mortar shells: 0.05 Munitions.
- Howitzer shells and rockets: 0.10 Munitions.

Cargo may use normalized compatible-ammunition credits, but its debit and refill conversion must preserve these per-weapon prices. A full-strength rifle firing normally costs about 0.03125 Munitions per second of ammunition replacement. This is below World's starting 0.2 Munitions/s income; it is not a verified faction-balance result.

Vehicle supply fuel costs 6 Fuel for 180 driving seconds and 2 Fuel for a full emergency reserve. Convoy operating fuel costs 0.002 Fuel per planned route metre, covering outward and return trips, with a 20% contingency. Reserve operating fuel before dispatch. Direct orders that extend a trip beyond its funded budget reserve the additional cost or return a visible insufficient-Fuel result. Truck operating fuel is accounted per trip without an individual troop-style fuel meter.

Partial loads are allowed and never create negative currencies. Prioritize provisions, then the destination's most urgent affordable shortage. Loading cost is deducted once. Cache transfers and unloading never charge again. Lost cargo is not refunded. Unused cargo returned to a source is stored for reuse, not duplicated or repeatedly refunded.

Allied bases and caches may service a player's logistics. Cargo retains its paying owner's identity. Automatic deliveries prioritize that player's troops. Explicit relief orders can transfer paid cargo to allied units. Sharing cache infrastructure never merges currencies or silently lets one player's automatic fleet spend another player's stockpile.

## Presentation and AI

Supply trucks have a distinct readable wheeled model and symbol. Exclude them from ordinary combat drag-selection, army select-all, combat groups, recruitment cards, and combat population totals. Clicking a truck or enabling logistics selection permits direct control. Display cargo, delivery state, destination, hold state, and Resume deliveries in its command card.

Selected troops show ammunition, provisions, fuel, emergency fuel, and the withdrawal-warning countdown where applicable. Show a compact shortage/stranded indicator on affected units. An optional logistics overlay shows known caches, observed threats, selected supply routes, and current truck jobs. Do not cover the whole map with permanent route lines.

Group low-reserve, blocked-delivery, insufficient-stockpile, and forced-withdrawal notifications. Limit repeat alerts for the same situation to one per 20 seconds. Do not alert separately for every truck loss. Explanations distinguish an unreachable route, known dangerous route, insufficient currency, and cargo still in transit.

Deliver reserve and job data through the existing owner-private ancillary snapshot pattern. Friendly cache details are visible to eligible allied users, filtered by ownership and team knowledge. Visible enemy trucks reveal only ordinary visible unit information, not private cargo, stocks, jobs, or reserves. Reconnect, spectator filtering, replay, and AI observations follow the same access rules.

AI uses the same delivered information and command validation as humans. Logistics schedules automatically for AI seats too. AI anticipates shortages, conserves depleted ammunition, attempts withdrawal/breakout, and attacks visible convoy targets when useful. It cannot reveal unseen trucks, sources, enemies, or World geography. Existing target and autocast logic must not bypass ammunition or mandatory-withdrawal checks.

## Implementation boundaries

Add a focused `shared/logistics.js` module for tuning, reserve accounting, inventory transfer, jobs, convoy scheduling, warnings, and observable state. Integrate it through explicit hooks in `shared/sim.js` for initialization, creation, accepted firing, actual travel, command validation, recovery, tick processing, death, and snapshots. Avoid scattering private-state calculations across the firing variants.

Client presentation belongs in a focused `client/logistics.js` module with small hooks in selection, orders, HUD, alerts, models/symbols, and map views. `shared/ai-view.js`, `shared/ai.js`, and `server.js` must propagate or filter logistics data explicitly. Keep positional unit rows backward compatible by using ancillary arrays for detailed stocks/jobs.

Keep DESIGN.md synchronized with implemented decisions and add player-facing CHANGELOG.md bullets in the same commit as gameplay changes. Stage specific files and preserve unrelated concurrent work. Do not introduce em dashes. Use the GitHub CLI for any GitHub operations.

## Verification and balance acceptance

Use deterministic authoritative simulation tests for:

1. Mode and unit eligibility, full starting reserves, no passive exhaustion of neutral guards, and unchanged excluded modes.
2. Every firing entry, partial magazines/salvos, abilities, AA, hold fire, misses, reduced squads, and no double charging.
3. Actual powered movement, riders, idle traffic, ordinary/emergency fuel, fuel exhaustion, and no unlimited withdrawal driving.
4. Timed depletion, non-stacking penalties, provider inventory, finite medical support, withdrawal warning, partial relief, and 50% release thresholds.
5. Safe automatic delivery with no player convoy commands, grouping, capacity reservations, jobs after troop movement, free fleet growth/replacement, and manual hold/resume.
6. Destruction, source loss, cargo loss, cache ownership changes, failed paths, blocked retreat, breakout, and restoration after a relief shipment.
7. Currency affordability, partial loads, allied accounting, trip costs, failed reroutes, returned cargo conservation, and unchanged resource income rules.
8. World relays, non-adjacent conquered pockets, finite disconnected chains, rebuilt HQ recovery, late-arriving deliveries, and minimum/maximum army settings.
9. Hidden threats and terrain, ownership-private wire data, spectators, AI views, reconnect, and no hidden enemy positions in overlays.
10. Selection behavior, stock indicators, grouped alerts, direct convoy control, route rendering, and truck models through rendered browser QA.

Run `node test.js` before every commit containing implementation. Add dedicated integration tests to its runner without removing existing checks. Establish baseline failures before making changes and distinguish them from regressions.

Run reproducible AI comparisons for Conquest, Classic, Annihilation, and World. Record seeds, army settings, match count, outcomes, shortage time, warning/withdrawal counts, convoy losses, resource spending, and relay throughput. Verify safe, funded armies sustain ordinary battles without manually moving trucks. Inspect both a smaller authored map and Huge/Massive World routing. Report performance and balance measurements as measurements; no unrun match targets may appear as results.

The initial numbers above are tuning inputs. Adjust cargo throughput, fleet limits, dispatch/cost values, or reserve durations only when a failing scenario or measured balance/performance result explains why. Record changed numbers and remaining issues in DESIGN.md and CHANGELOG.md.
