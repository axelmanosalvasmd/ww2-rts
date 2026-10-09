# Territory supply

Built 2026-10-06 (`shared/sim.js` "territory supply", `territoryService` in `shared/supply-convoys.js`). Replaces most
supply trucks with supply that flows through connected friendly territory. Trucks stay only for
units and caches beyond that territory. Goal: keep supply lines worth cutting and defending, at a fraction of the
CPU (today the truck system roughly doubles the server's CPU in World Conquest).

## Where supply comes from

- **Sources:** completed HQs, held depot points in Conquest, and every held capture point in Annihilation. A point
  supplies only while it is not cut off from its HQ (as Conquest depots work today), and distance is measured from
  the nearest source, so taking points extends a team's supply forward.
- **Forward Supply Caches:** a cache refills units within 15 m from its own finite stock, even when cut off. Trucks
  stock caches (see "Forward trucks").

## How supply spreads

- **World Conquest:** over the region graph. Two regions connect when they share a border. Adjacency is computed
  once at game start from the region map. Supply spreads from each source region through regions the team owns that
  are not blocked.
- **Conquest, Classic, Annihilation:** over ground, with the flood the point cut check already does: from each HQ
  across ground a vehicle could cross, closed within enemy zone of control. To count damaged ground as extra
  distance, the flood steps through cells with costs (1 per cell, 5 per damaged cell) using a bucket queue, which
  stays a single cheap pass.
- Recomputed once a second per team (a capture takes effect within that second).
- A unit standing in enemy zone of control is cut off. One inside a house or beside a wall, where the flood cannot
  go, takes the best open cell within 3 cells (6 m).

## What blocks it

- **Ownership:** an enemy-owned or neutral region breaks the chain.
- **Zone of control:** armed enemy ground units close ground within 8 m of them, except within 16 m of a point the
  team holds (the cut check's existing numbers). In World Conquest a region is blocked while armed enemy ground
  units are in it and none of the team's are.
- **Chokepoints:** a destroyed bridge or a mined road cell is no longer crossable, so it cuts the link it carried.

## Damaged ground weakens it

Fighting wrecks the ground supply runs over: shelled roads break into craters, open ground sinks, houses fall to
rubble. That ground weakens supply without cutting it, and squads repair it with the existing **Fill in** order
(10 MP), which fills craters, flooded craters and sunken ground and clears rubble.

- Damaged ground is any cell a squad could fill in (the game's `fillable` cells) that vehicles can still cross:
  craters, flooded craters, sunken ground. Rubble blocks vehicles, so rubble across a line cuts it until cleared.
- **World Conquest:** each damaged cell in a region adds 0.05 to the region's distance, so 20 craters weigh as much
  as one more region on the line.
- **Other modes:** each damaged cell the supply crosses counts as 10 m of extra distance (5 more cells).
- Damage only lengthens the line, so it lowers the refill rate through the distance table below and never cuts on
  its own. Filling the cells in restores the rate at the next recompute.
- Artillery and bombing runs on a supply line therefore matter, and engineers or squads filling craters behind the
  front matter too.

## Distance weakens supply

Refill runs at full rate near a source and weakens along the line:

| Distance from the nearest source | Refill rate |
|---|---|
| World: the source region or one region away | 100% |
| World: each region beyond that | 15% less, down to 25% |
| Other modes: within 150 m of travel | 100% |
| Other modes: beyond 150 m | falls evenly to 25% at 600 m |

A long, thin front is weaker than a compact one, so pushing deep without taking the ground between costs something.

## Refill

- At 100%, a unit's empty reserves fill in 40 s: about 90 s of ammunition, 120 s of provisions, 180 s of fuel plus
  60 s emergency fuel.
- Refills are free in every mode (2026-10-09; Classic and World Conquest used to charge Munitions and Fuel).
- Healing, repair and reinforcement keep using provisions as today.

## Being cut off

- **Grace:** a unit must be out of supply for 10 s before refill stops, so a scout running past doesn't flicker the
  line. Reconnecting restores refill at once.
- **Out of supply:** no refill, and reserves drain as they do now. The existing shortage penalties, warnings and forced
  withdrawal apply unchanged. With full reserves a cut-off force fights on for 1.5 to 3 minutes, which leaves time to
  reopen the line.

## Forward trucks (the hybrid part)

- Trucks deliver only to units that are out of supply, and to caches outside supplied territory.
- World Conquest's automatic region caches are gone: the region graph carries that supply.
- Outside World Conquest a cut-off unit is usually in enemy contact or beyond ground vehicles can cross, where a
  truck cannot go either, so it lives on its reserves until the line reopens. In World Conquest trucks reach units
  pushing into neutral or enemy regions.
- At most 4 trucks per player (today up to 24). A truck spawns only when such a job exists, and retires at its HQ
  when idle.
- Routing and danger avoidance stay as they were. Fuel funding prices the way home by its straight line (searching
  it was the larger part of what the remaining trucks cost); the 20% contingency covers detours.

## What players see

- The supply overlay tints territory: supplied, weakened (below 100%) and cut off.
- Unit cards show "Out of supply" with the grace countdown, then the reserves already shown.
- Grouped alerts reuse the existing system: "3 units cut off from supply", "Supply line restored".
- Each team sees only its own supply state. Enemy supply stays private, like reserves and cargo today.

## AI

- The AI view gets each own unit's supply rate and cut state, and each own region's supply state.
- It already withdraws on forced shortage. Later: value capturing or holding chokepoint regions.

## CPU target

- The supply spread is a breadth-first search over a few hundred regions (World) or the existing flood (other
  modes), once a second per team.
- Target: logistics under 10% of server CPU in the seeded 2-player, 2-AI World Conquest match (CPU time, against
  the same match with logistics off).
- Measured (2.5 minutes, two worlds): 15.4 and 13.6 s with territory supply, against 23.2 and 24.9 s with trucks and
  11.8 and 10.0 s with logistics off. The extra cost of logistics fell from 11 to 15 s to about 3.6 s (about 70% less),
  but that is still about 25% of server CPU, above the target. The network costs about 0.1 s and refills about 0.1 s;
  most of the rest is the two or three remaining trucks and the per-unit store checks.

## Tests

- Supply spreads through owned connected regions; capturing a linking region cuts everything beyond it.
- Zone of control cuts a corridor; a held point within 16 m keeps it open.
- A destroyed bridge cuts a link and rebuilding it restores the link.
- Refill rate by distance follows the table.
- Craters on a line lower the refill rate without cutting it; filling them in restores it.
- In Annihilation a held, connected capture point supplies nearby units at full rate; once cut off it stops.
- Grace: no change before 10 s cut off, refill stops after, and resumes at once on reconnection.
- Refills cost nothing in any mode.
- A cache refills nearby units from its stock while cut off.
- Trucks spawn only for out-of-supply jobs, at most 4 per player.
- Privacy: snapshots never carry enemy supply state.

## Decided

- Annihilation: held capture points are supply sources while connected to an HQ.
- Interdiction: strikes weaken supply through the ground they damage, and filling it in repairs the line (see
  "Damaged ground weakens it"). No separate timed penalty.
