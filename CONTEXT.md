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

**Kill Bounty**:
The MP paid to whoever finishes off an enemy unit or building: a share of what it cost.
_Avoid_: reward, loot

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

**Fuel**:
Classic's third currency. It pays for vehicles (light tank, rocket truck, Tiger), which then cost less MP. It only exists in Classic.
_Avoid_: gas, oil

**Camouflage**:
A sniper that hasn't moved or fired for a few seconds can only be seen up close (or from a recon flight). Firing gives it away for a moment.
_Avoid_: stealth, invisibility

**Point**:
A capture location on the map. In Classic it earns Munitions rather than VP.
_Avoid_: flag, objective

## Air

**Sortie**:
One trip of a commanded plane: out to its mission, circling it while fuel lasts, home to rearm.
_Avoid_: flight (for this), run

**Airfield**:
The Classic building that trains planes and is their base. Elsewhere planes use an off-map airbase behind the HQ.

**Air Support**:
An off-map strike or drop you call on a spot, announced to everyone before it arrives: recon flight, strafing run, bombing run, dive bomber, paratroopers, fighter cover (artillery and smoke barrages are support too, but not aircraft). Paid in MP, or Munitions in Classic.
_Avoid_: call-in, airstrike (for the whole family)

**Fighter Cover**:
Air Support that intercepts the next enemy air strike over an area for a while. It never stops recon.

**Paratroopers**:
Air Support that drops a rifle squad anywhere your side can see. It counts toward the pop cap.

**Flak**:
Anti-aircraft fire, from a flak gun or a Classic flak emplacement. Each flak in range gives a chance to shoot down a passing support plane, which cancels whatever it hasn't delivered yet.
_Avoid_: AA (in player-facing text)

**Shoot-down**:
A plane destroyed by Flak or Fighter Cover before it finishes its run.

## Interface

**Command Card**:
The panel at the bottom center of the screen that lists what you can make. Outside Classic it holds every unit you can buy; in Classic it shows what the selected building trains or what the selected Engineers can build.
_Avoid_: buy bar, build menu, production panel

**Alert**:
A short notice to one side that something needs its attention: it is under attack, it captured or lost a Point, it lost a unit, enemy Air Support is coming, or (in Classic) a unit or building is ready. Unlike an Air Support announcement, which everyone sees on the map, an Alert goes only to the side it concerns.
_Avoid_: notification, toast, event

