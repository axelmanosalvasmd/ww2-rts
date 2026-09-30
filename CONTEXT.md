# Three Crossroads

WW2 tactics RTS in the browser for a few friends. This file is the glossary; design decisions live in DESIGN.md.

## Modes

**Conquest**:
A VP race: holding points earns VP, and the first side to the goal wins.

**Assault**:
Attackers must destroy every defender's Command Bunker before the clock runs out.

**Classic**:
A mode where players build a base: they gather resources, put up buildings and produce units from them. It is won by Annihilation, and Sudden Death guarantees that it ends.
_Avoid_: base-building mode, RTS mode

**Annihilation**:
A player is eliminated when they have no Production Buildings left, where a Construction Site of one still counts. A team is out when all its players are, and the last team standing wins.

**Sudden Death**:
Classic's endgame once the clock runs out. Production and construction stop and Production Buildings decay, so Annihilation always arrives.
_Avoid_: overtime, time decision

## Economy

**Manpower (MP)**:
The main currency. It buys units.

**Resource Node**:
A map location in Classic where a Supply Depot can be built. Only one depot fits on each node.
_Avoid_: mine, deposit, field

**Supply Depot**:
A building on a Resource Node that produces MP for as long as it stands.
_Avoid_: extractor, refinery

**Production Building**:
A Classic building that produces units: HQ, Barracks or Motor Pool. Annihilation counts only these.

**HQ**:
Each player's home: the spawn and reinforce zone. In Classic it is also a Production Building (Engineers, rifle squads) that every player starts with.
_Avoid_: base, spawn (when you mean the building)

**Barracks**:
A Production Building for MG teams and faction infantry.

**Motor Pool**:
A Production Building for vehicles and guns. It requires a Barracks.
_Avoid_: factory, garage

**Construction Site**:
A building that has been placed and paid for but isn't finished. Engineers build it up, it can be attacked, and cancelling it refunds part of the cost.
_Avoid_: blueprint, foundation

**Ghost**:
The last-seen image of an enemy building under fog. It updates only when the building is back in vision.
_Avoid_: memory, snapshot

**Engineer**:
A Classic-only infantry squad that builds (and later repairs) buildings.
_Avoid_: worker, pioneer, peasant

**Munitions**:
Classic's second currency, earned only by holding points. It pays for off-map support and unit abilities, and only exists in Classic.
_Avoid_: ammo, command points

**Point**:
A capture location on the map. In Classic it earns Munitions rather than VP.
_Avoid_: flag, objective
