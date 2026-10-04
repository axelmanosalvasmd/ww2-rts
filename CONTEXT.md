# Three Crossroads

WW2 tactics RTS in the browser for a few friends. This file is the glossary; design decisions live in DESIGN.md.

## Modes

**World Conquest**:
A match on a generated continent. Teams scout unknown ground, destroy regional defenses, claim land with
infantry, and build their own forces. The last team region lost causes defeat; owning every region wins.

**Region**:
A bounded area in World Conquest with a military base, infantry capture point, ownership and economic bonuses.
Regions are separate from the capture Points used by other modes. Teammates share regional ownership.

**Home Region**:
The one region contributed by each player at the start of World Conquest. Losing it does not eliminate the
player while the team still has land.

**Conquest**:
A VP race: holding points earns VP, and the first side to the goal wins.

**Assault**:
Attackers must destroy every defender's Command Bunker before the clock runs out.

**Classic**:
A mode where players build a base: they gather resources, put up buildings and produce units from them. It is won by Annihilation, and Sudden Death guarantees that it ends.
_Avoid_: base-building mode, RTS mode

**Annihilation**:
A player is eliminated when they have no Production Buildings left, where a Construction Site of one still counts. A team is out when all its players are, and the last team standing wins.

**Horde**:
A co-op mode: every player shares one HQ and defends one Command Bunker against Waves. Nobody wins; the result is the Wave the bunker fell on. Also the name of the enemy side, an extra AI player no human sits in.
_Avoid_: survival, tower defense, zombies

**Wave**:
One numbered attack of the Horde. It is dead when no horde ground unit is left on the map or in its Reserve, and only then does the break before the next one start.
_Avoid_: round, level

**Reserve**:
The part of a Wave that has not entered the map yet. It walks on at the attacker spawns as units die and room opens up.
_Avoid_: queue, backlog

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
A map location in Classic or World Conquest where a Supply Depot can be built. Only one depot fits on each node.
_Avoid_: mine, deposit, field

**Supply Depot**:
A building on a Resource Node that produces MP for as long as it stands.
_Avoid_: extractor, refinery

**Production Building**:
A building that trains units in Classic or World Conquest: HQ, Barracks, Motor Pool or Airfield.

**HQ**:
Each player's home: the spawn and reinforce zone. In Classic and World Conquest it is also a Production Building (Engineers, rifle squads) that every player starts with.
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
An infantry squad in Classic and World Conquest that builds (and later repairs) buildings.
_Avoid_: worker, pioneer, peasant

**Munitions**:
A currency in Classic and World Conquest. Points or owned regions earn it; it pays for off-map support and unit abilities.
_Avoid_: ammo, command points

**Fuel**:
A currency in Classic and World Conquest. It pays for vehicles (light tank, rocket truck, Tiger), which then cost less MP.
_Avoid_: gas, oil

**Camouflage**:
A sniper that hasn't moved or fired for a few seconds can only be seen up close (or from a recon flight). Firing gives it away for a moment.
_Avoid_: stealth, invisibility

**Point**:
A capture location on the map. In Classic it earns Munitions rather than VP.
_Avoid_: flag, objective

## Orders

**Take Cover**:
The order that sends the selected infantry to the best cover within reach. Idle infantry under fire do the same on their own; crewed weapons only on the order.
_Avoid_: hide, duck

**Stance**:
One of three per-unit switches the player sets: Hold Fire (shoot only on an attack order), Hold Position (never move unordered) and Auto-retreat (run for home when broken). All off by default.
_Avoid_: mode, behaviour

**Mass Entrenchment**:
One order that sets every selected builder squad digging a shared pattern (trench line, zigzag, double line, arc, ring, strongpoint). Each squad pays for a segment as it starts it.
_Avoid_: mass dig, auto-trench

**Segment**:
One fortification of a pattern: four trench cells, or five of barbed wire.

## Air

**Sortie**:
One trip of a commanded plane: out to its mission, circling it while fuel lasts, home to rearm.
_Avoid_: flight (for this), run

**Airfield**:
The building in Classic and World Conquest that trains planes and is their base. Elsewhere planes use an off-map airbase behind the HQ.

**Air Support**:
An off-map strike or drop you call on a spot, announced to everyone before it arrives: recon flight, strafing run, bombing run, dive bomber, paratroopers, fighter cover (artillery and smoke barrages are support too, but not aircraft). Paid in MP, or Munitions in Classic and World Conquest.
_Avoid_: call-in, airstrike (for the whole family)

**Fighter Cover**:
Air Support that intercepts the next enemy air strike over an area for a while. It never stops recon.

**Paratroopers**:
Air Support that drops a rifle squad anywhere your side can see. It counts toward the pop cap.

**Flak**:
Anti-aircraft fire, from a flak gun or a flak emplacement in Classic or World Conquest. Each flak in range gives a chance to shoot down a passing support plane, which cancels whatever it hasn't delivered yet.
_Avoid_: AA (in player-facing text)

**Shoot-down**:
A plane destroyed by Flak or Fighter Cover before it finishes its run.

## Battlefield

**Weather**:
The match's conditions (Clear, Ground fog, Rain, Mud or Snow). It shortens sight on the ground and slows movement for every side alike; planes are not affected. The host picks it in the lobby, and it changes at most once in a match, announced to everyone a few seconds before.
_Avoid_: climate, season, conditions (in player-facing text)

**Shower**:
A spell of rain that comes and goes during a match in Clear, Ground fog and Mud weather. It shortens sight and soaks the ground, which slows vehicles off the roads until it dries. Rain weather is rain all match; Snow has no showers.

## Interface

**Command Card**:
The panel at the bottom center of the screen that lists what you can make. Outside Classic and World Conquest it holds every unit you can buy; in those modes it shows what the selected building trains or what the selected Engineers can build.
_Avoid_: buy bar, build menu, production panel

**Autocast**:
A per-unit switch, set by right-clicking an ability button, that lets the unit use its ability by itself when it judges the moment worth it. It starts on where abilities are free and off in Classic and World Conquest, where they cost Munitions.
_Avoid_: auto-ability, auto mode

**Alert**:
A short notice to one side that something needs its attention: it is under attack, it captured or lost a Point, it lost a unit, enemy Air Support is coming, or (in Classic or World Conquest) a unit or building is ready. Unlike an Air Support announcement, which everyone sees on the map, an Alert goes only to the side it concerns.
_Avoid_: notification, toast, event


## AI

**Seat Commander**:
The AI playing one normal player seat. It perceives the same fog-fair information, attends one concern with one virtual camera, and acts through timed human inputs. A Horde Wave director is separate.

**Concern**:
One task competing for the commander's attention: a fight, production, expansion, scouting, idle troops or support. Only one is attended at a time.

**Screen Memory**:
Details the commander saw inside its camera earlier. Confidence fades and the memory expires, so old health or readiness cannot become current off-screen knowledge.

**Hands**:
The input executor that selects troops, recalls groups, moves the camera, presses keys and clicks before sending ordinary game commands.

**Physical Input APM**:
Inputs per minute, including selection and camera gestures. Command APM counts game commands separately; one input can affect a whole formation.

**Persona**:
A seeded match preference for an aggressive, defensive, armor, infantry or support opening. It changes choices and can adapt to observed threats.
