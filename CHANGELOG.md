# Changelog

What changed in the game, newest first. Player-facing changes lead each entry; balance numbers come from
AI-vs-AI runs (see DESIGN.md for the balance log). Add new entries under **Unreleased**.

## Unreleased

- Tailnet members can also join by IP: http://<host's Tailscale IP>:3000 (start.cmd prints it). The server listens on
  all interfaces; a Windows Firewall rule, "ww2-rts game (Tailscale only)", lets in only Tailscale addresses
  (100.64.0.0/10), so the home network and the internet stay blocked. The rule has to be added once as admin.
- start.cmd tries Tailscale Funnel first (a public link: friends can join without Tailscale) and falls back to the
  tailnet-only link. Funnel stays off until the tailnet admin allows it; the link is the same either way.
- Conquest catch-up is stronger: trailing players get up to +6 MP/s (was 4), 1 per 60 VP behind (was 80). The new units
  had made games one-sided (2nd place finished with 54% of the winner's VP); now 66% on Three Crossroads and 63% on
  River Towns, more lead changes (1.58), 9.6 min games, faction wins 33/31/26 (90 AI matches). Tried and dropped: keeping
  mortars and armored cars out of the first 4 minutes (49%, worse).
- Classic Fuel nodes now sit halfway between neighbouring enemy HQs instead of by the villages (on several maps a
  village Fuel node was 15-17 m from one player's HQ and 65+ m from the others). Each spot is picked so both sides walk
  about as far to it; a 1v1 gets one on each flank. Audited every map as a 1v1 and full lobby: everyone gets an HQ and
  2 MP nodes 21-34 m from home, every map has Fuel, nothing is unreachable. Still uneven where terrain forces detours:
  Monte Cassino 1v1 (115 vs 164 m walk), Island Towns 6p (34-77 m). Classic balance after: 80% of games decided before
  sudden death, median 15.8 / 16.6 / 21.4 min (90 AI matches).
- Fixed a flaky test: the bunker-falls check fired a real random barrage at a 1 hp bunker, and sometimes every shell
  missed.
- Four new units in every mode:
  - Mortar team (Barracks in Classic): lobs shells at anything your side can see, out-ranges MGs; Mortar Barrage ability.
  - Sniper (Barracks): one shot, one kill at long range. Hides when it keeps still and stops firing (only seen up close
    or by a recon flight); firing gives it away. Your own shows a HIDDEN tag.
  - Armored car (Motor Pool): the fastest unit. Scouts, raids, hunts snipers and mortars; weak against tanks.
  - Medium tank (Motor Pool): Sherman, Panzer IV or T-34, between the light tank and the Tiger.
- Classic: Fuel, a third currency for vehicles. Depots on the contested nodes by the villages now pay Fuel (orange
  marker, "+1.5 Fuel/s") instead of MP, and the HQ trickles a little. Vehicles cost less MP plus Fuel (light tank
  200 MP + 60 Fuel). Home depots pay more MP (2.5/s) and the HQ trickle went up to 3/s. HQ, Barracks and Motor Pool have
  25% less health.
- The AI uses the new units and buys infantry when it can't make what it wants (it used to save forever).
- Balance: Conquest games got more one-sided (2nd place 54% of the winner's VP, was 62%) but factions are the most even
  yet; Classic decides 74% of games before sudden death, median 16-23 min. Details in DESIGN.md.
- Assault: the Command Bunker now takes only 5% damage from off-map support (artillery, bombing runs, strafing).
  It has to be taken on the ground: satchels, rockets, tanks and infantry. The AI attacker no longer calls its
  strikes on the bunker; it uses them on the defenders instead. AI 1v1 assault, attacker wins out of 20 after the
  change: Three Crossroads 15, River Towns 12, Pegasus Bridge 7, Seawall 7, Stalingrad Factory 7, Bocage 4,
  Hill 112 3, Monte Cassino 1. Bocage and Monte Cassino were 11/20 before, so they now favour the defender
  strongly.
- Assault no longer shows capture points that only pay VP (Assault has no VP): the center of Three Crossroads and
  River Towns is gone in Assault. Every remaining point is labelled with the manpower it pays, not "2x VP".
  Balance is unchanged by this (AI 1v1 assault, attacker wins with/without the change: Three Crossroads 16/20 vs
  16/20, River Towns 15/20 vs 13/20). Found and left for later: that's well above the 50% / 61% logged when Assault
  shipped, so something since then has shifted Assault toward the attacker.
- Classic economy: depots on the contested nodes by the villages pay 2.5 MP/s, the safe home nodes 1.5. Each node shows
  what it pays. Fielded units cost upkeep (0.08% of their price per second: a rifle 0.08 MP/s, a tank 0.24), shown next
  to your income. The AI walks further for a richer node.
- Fixed (Classic): capture points still said "+1.5 MP/s" from Conquest, but in Classic they pay Munitions. They now
  show "+1.5 Mun/s" (center "+3 Mun/s"). Depots pay MP, points pay Munitions.
- Balance (30 AI matches per map): 28/30 and 29/30 decided before sudden death, median 17.2 and 16.7 min. Upkeep at
  this rate doesn't stop the leader banking MP at the pop cap (doubling it only made games longer, 20.2 min): that needs
  something to spend on.
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
- Twelve new maps (generated by `tools/genmap-pack.js`):
  - Assault: **Pegasus Bridge** (a town across a river, one bridge you can blow up and a far ford),
    **Bocage** (fields boxed in by hedgerows), **Seawall** (a beach below a cliff with two ramps),
    **Monte Cassino** (a monastery on three cliff tiers, the climb zigzags ramp to ramp) and
    **Stalingrad Factory** (a walled factory in a ruined city, attacked from three sides).
  - Conquest, mirrored for two sides: **Twin Valleys** (a cliff ridge crossed by two passes), **Ardennes Crossing**
    (a winding river, three bridges, two fords, a point on each crossing), **Crossroads Village** (a small quick 1v1),
    **The Polder** (sunken fields, dykes you can't see over, canals) and **Crater Field** (Verdun: trench lines and a
    shelled no man's land).
  - Up to six players: **King of the Hill** (a big central hill worth triple VP) and **Island Towns** (islands joined
    by long bridges and fords).
  - Every map passes a new test: valid, and every spawn can walk to every point and every other spawn.
  - AI checks: every conquest map finishes with all points taken in under 3.5 minutes. Assault 1v1, attacker wins:
    Pegasus Bridge 7/20, Bocage 11/20, Seawall 4/20, Monte Cassino 11/20, Stalingrad Factory 7/20.
  - Assault capture points sit on the defenders' side or in the middle, so the attackers have to take ground to earn
    more than their base income. The first version put most points next to the attackers (on Pegasus Bridge, 4 MP/s
    of free income for the attacker against 1.5 for the defender), and attackers won about 35/40 there and on
    Seawall. Moving them swung every assault map hard toward the defender (Monte Cassino 1/20), so each map got one
    or two contested points back.
  - Seawall was rebuilt with the cliff closer to the defenders' town. The AI defender only holds ground within 70 m
    of its base: with the cliff far away the attackers took both ramp tops in the first minute and won 20/20.
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
