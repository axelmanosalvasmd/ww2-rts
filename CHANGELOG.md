# Changelog

What changed in the game, newest first. Player-facing changes lead each entry; balance numbers come from
AI-vs-AI runs (see DESIGN.md for the balance log). Add new entries under **Unreleased**.

## Unreleased

- Classic now works like a classic RTS: the bottom panel shows only what your selection can do. Select a building to
  see the units it trains (cost and training time) and its queue; select Engineers to see the buildings they can put up
  (and what each still needs). Nothing selected, nothing shown. Soldiers keep their abilities in the lower-left bar.
  H jumps home and selects your HQ. Conquest and Assault keep the always-on unit bar.
- Classic mode is complete (the rest of the planned slices):
  - Engineers also build a Barracks (K, 150 MP: MGs, Rangers, Conscripts) and a Motor Pool (L, 200 MP, needs a
    Barracks: AT guns, tanks, rockets, Tiger). The placement preview snaps to the grid, green or red.
  - Units take time to train (rifle 15s, tank 35s...) in a queue of up to 5 per building, and step out at their building.
    Click a building to see its queue and train from it; right-click sets its rally point. The buy bar is greyed until
    you own the right building.
  - Cancel an unfinished building for 75% back. Right-click your own site or damaged building with Engineers to help
    build or repair it.
  - Retreat goes to your nearest Barracks, Motor Pool or HQ, and units reinforce near any of them (or an ally's).
  - Enemy buildings are hidden by the fog until you see them, then stay on your map as faded ghosts where you saw them.
  - Sudden death at 25:00: no more building or training, and every HQ, Barracks and Motor Pool loses 1% of its health
    per second. Last base standing wins.
  - In team games an eliminated player's army goes to their teammate.
  - Unit abilities cost Munitions in Classic (grenade 15, satchel 30...), on top of their cooldowns.
  - Pop cap is 20 in Classic.
  - Buildings are timber: guns hit them fully and rifles chip at them. Before, rifles and MGs did almost nothing to a
    building and AI armies shot at bases for 20 minutes.
  - The AI builds the full base, repairs, saves up for buildings, and adapts: it counters tanks and infantry it has seen,
    defends against early rushes, attacks when its army outweighs what it has seen, raids unguarded depots and flies
    recon when it hasn't found your base. It beats the old scripted AI 68% of the time.
  - Balance (3-player FFA, 90 AI matches): every match ended by destroying bases, 90% before sudden death, median
    16.5-19.6 min. Faction wins 32/33/25 (USSR slightly weak).
- Selected units now show their weapon range as a ring (rocket launchers also show their minimum range), the route
  they're walking, and what they're locked onto: a red line and ring to an attack target, markers for a grenade spot,
  a trench being dug, a building site or a house they're entering. Only your own units' orders are sent.
- Routes and targets are drawn as flat bands on the ground (the first version used 1px lines that were hard to see),
  and a unit shooting at something it picked itself now shows a red band and ring to that target too, not just
  targets you ordered. Needs a server restart: the routes come from the server.
- Added this changelog and AGENTS.md (the rule to keep it up to date).
- Bombs and artillery now dig the ground. Each blast lowers the ground one level (a real dip that changes
  sight lines and gives low ground): a bomb digs a 3x3 patch, an artillery shell a single cell. Repeated hits on
  the same spot deepen the middle into a bowl, but a cell never ends up more than one level below its
  neighbours, so units can always climb out.
- New map, Hill 112, built for Assault: the defenders hold a plateau and the attackers start at the foot of the
  hill and have to climb. Cliffs on the upper flanks funnel the climb through a central ramp, with narrow paths at
  both edges. Shelled slopes, a hamlet on the middle terrace, and farms and orchards lower down give cover on the way up.
  AI 1v1 assault: defenders win 23 of 30.
- Maps can now pin the defenders to chosen spawns in Assault (`defend` in the map file). The editor keeps it on save.
- Units show a shield next to their health bar when they're in cover: green for cover, faded green for cover
  on one side ("by cover"), blue for a trench. No shield when garrisoned (the panel already says so).
- Fixed: clicking or box-selecting units on high ground missed them. Selection projected every unit at ground
  level 0, so on a level-4 plateau the click spot was about 90 px below the soldiers (the pick radius is 32 px).
  It was barely noticeable on the older maps' low hills.
- New mode, Classic (first slice): build a base. The host picks it in the lobby. Each player starts with an HQ,
  an Engineer squad, a rifle squad and 200 MP. Select Engineers and press J (or the Supply Depot button), then click a
  glowing resource node: the depot costs 60 MP, goes up in about 20s, and adds 1.5 MP/s to your 2 MP/s trickle.
  Holding points earns Munitions, which pay for off-map support in this mode. Destroy every enemy HQ to win.
  Barracks, Motor Pool, build times, Sudden Death and the rest come in later slices (see DESIGN.md).
- Classic balance: 90 AI matches over the three maps all ended by Annihilation, median 12-15 min, faction wins 30/32/28.
- Fixed (Classic AI): every AI aimed its artillery and bombs at the same player's HQ (the first one created), so that
  player always died first. Found while measuring Classic.

## 2026-09-30

### Assault mode (7fb1b23)
- New mode: attack and defend a base. The host picks Conquest or Assault and which team defends.
- Each defender gets a Command Bunker (3000 hp, MG slit) behind a trench and sandbag line. Direct fire does 25%;
  explosives do their full demolition damage.
- Attackers win by destroying every bunker; defenders win when the 15:00 clock runs out.
- Works 1v1 and with teams (3v3 on Six Fronts gives three bunkers).
- Balance: attackers win 50% (default map) and 61% (River Towns) over 90 AI matches each.
- Fixed: the free bunker counted as a 3-star veteran. Fixed a flaky high-ground test.

### Teams, up to 6 players, Six Fronts map (f0f021b)
- Up to 6 players: 1v1, FFA, 2v2v2, 3v3. The host sets teams; each player picks a faction.
- Teammates share vision, can't shoot each other, hold each other's points and win on combined VP.
- New 150x150 map for 6 players: Six Fronts.
- Built by a parallel session; part of it landed in the faction commit below.

### Faction flavor (ba20177)
- Unique units: USA Ranger Squad (satchel charges), German Tiger (heavy tank, thick front armor, max 1),
  Soviet Conscripts (cheap, Ura! sprint).
- Faction looks drawn in code: helmets, tanks and rocket carriers differ per faction.
- Units answer orders in English, German or Russian (mute with M).
- Balance: faction wins 37/33/30% over 300 AI matches (USSR won 74% before tuning).

### Control groups on Ctrl (d6a7970)
- Ctrl+1-9 sets a group. Fullscreen button claims the number keys from the browser; Shift+1-9 still works.

### Command & readability (3557373)
- Minimap (rotates with the camera), attack-move (G or Ctrl+right-click), F fires one ability by priority.
- Garrison houses; tanks shell houses on right-click; every tank round damages structures.
- Cover behind houses, walls, rubble, hedges and vehicles. Veterancy stars.
- Rocket launcher (Calliope / Panzerwerfer / Katyusha) to break garrisons. Bombing run support.

### Rivers, bridges, destruction (8054969)
- Rivers, fords and bridges; houses collapse to rubble, bridges drop into the river, shells crater the ground,
  tanks crush hedges and walls. New map: River Towns.

### Friend-ready hosting (908fa39)
- start.cmd hosts over Tailscale; the invite link always uses the Tailscale address.
- Ping on the scoreboard; a disconnected player's clock pauses. Ground can dip below level (depressions).

### Elevation and editor tools (622c5c2)
- Hills block sight, high ground aims and sees better, cliffs block movement.
- Map editor: select, move and delete whole structures; raise and lower ground.

### Map editor (8841758)
- In-game editor at /?edit: paint terrain, place spawns and points, save with a password, fairness test.
- The host picks the map in the lobby.

### Directional aiming (0d98796)
- Supports and trench digging: click the center, move the mouse to rotate, click to launch.

### Trenches and smoke barrage (ed58db6)
- Trenches (heavy cover), rifle squads dig them, smoke barrage support.

### HQ bases and off-map support (dc57b9c)
- Visible HQs; recon flight, artillery barrage and strafing run, announced to everyone before they land.

### Retreat, abilities, economy (ce53a70)
- Retreat and reinforce, one ability per unit, flat income with catch-up, center point worth 2x VP.
- Fixed a map bias: the top spawn won 22 of 30 AI matches; spawns are now shuffled.

### AI opponents (6ddb136)
- Add AI players from the lobby. Victory target raised to 1200 VP (matches were ending in 3.5 minutes).

### MVP (a4c2de3)
- Server-authoritative WW2 tactics RTS in the browser: 1v1 and 3-way FFA, rifle / MG / AT gun / tank,
  cover, suppression, line of sight, fog of war, capture points.
