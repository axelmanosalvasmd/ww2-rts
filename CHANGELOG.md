# Changelog

What changed in the game, newest first. Player-facing changes lead each entry; balance numbers come from
AI-vs-AI runs (see DESIGN.md for the balance log). Add new entries under **Unreleased**.

## Unreleased

- A fourth faction: the UK, picked in the lobby like the others. Its own units: the Churchill VII (480 MP, max 1),
  a slow infantry tank with the thickest front on the map (takes 60% from the front, the Tiger 70%) and a modest
  75 mm gun, and Commandos (190 MP, 5 men), raiders with Stens and satchel charges who hide when they keep still,
  like the sniper. Its doctrine, the 25-pounder: an artillery barrage fires 15 shells instead of 10, same price.
  The AI fields Commandos and its Churchill the way it does Rangers and the Tiger.
- British models, as detailed as the others: infantry in battledress, pale '37 webbing and the Brodie helmet with
  the No.4 rifle, the Sten and a Bren gunner per section; Commandos in green berets with toggle ropes; the
  Churchill VII, the Cromwell (medium tank), the Daimler armoured car, the Universal Carrier (the UK's squad
  carrier), the Vickers MG, the 6-pounder, the 3-inch mortar and a Bofors with Royal Artillery marks; the RAF's
  Spitfire IX, Typhoon IB, Mosquito VI and Dakota in roundels and invasion stripes. British vehicles wear the Allied
  white star in a circle, a WD number and unit signs. The RAF roundel marks UK players in the HUD.
- Balance, 240 Conquest AI matches on the default map with all four factions rotating through the three spawns
  (each faction played 180): wins USA/GER/USSR/UK 66/63/50/61 (37/35/28/34%), 9.4 min median. The UK sits at its
  fair share; the USSR's low share was there before. `tools/ai-balance.mjs --factions 4` runs this.
- Left for later: the UK's light tank, tank destroyer, mobile flak, rocket launcher, howitzer, flamer, boats and
  medics still use the American models in British paint (the white star was the Allied mark, so they read right).
  UK voices are American until British lines are recorded. Gun pits and the Creeping Barrage order from the UK
  design are not built yet.

- New models for the new units, as detailed as the old ones. Tank destroyers: the M10 Wolverine (Sherman chassis, a
  sloped hull studded with armor bosses, the open five-sided turret with its counterweights and the long 3 inch
  gun), the StuG III Ausf. G (Panzer III running gear, the low casemate, the Saukopf mantlet, side skirts) and the
  SU-85 (the T-34 hull carried up into a casemate, the 85 mm in a ball mantlet). The StuG and SU-85 only turn their
  gun, a few degrees either way. Field howitzers: the M2A1, leFH 18 and M-30 on split trails with their own
  wheels, recoil cylinders and shields, raised for indirect fire, with crews and ready shells. The flamethrower
  squad: a flamer with the M2-2 tanks, the Flammenwerfer 41 or the box-shaped ROKS-2 and its rifle-looking gun,
  held at the hip with the hose to his back, and two riflemen.
- Their own map icons and unit badges too (the HUD cards, the war map and the badges over units): the tank destroyer
  is a low turretless casemate with a long gun, the howitzer a steeply raised barrel on a wheel and trail, the
  flamethrower a soldier with tanks on his back and fire at his hip, the bomber a twin-engine plane with a twin tail.
- The model viewer takes &view=N to show one view filling the window.
- Left for later: the sim does not turn a casemate hull toward its target, so a StuG or SU-85 shooting to the side
  fires past its own gun.

- Paratroopers drop a whole stick now: two rifle squads and an MG team land in a ring around the spot you pick,
  instead of one rifle squad. Same price (260 MP / 90 Munitions in Classic) and cooldown, so the call is worth its
  cost (350 MP of units; before it was 2.6x the price of the one squad it brought). It needs room for all three
  under the army limit and reserves it until they land or the plane is shot down. 120 AI matches on the default map:
  USA/GER/USSR 44/38/38 (was 41/41/38), 9.3 min either way; the AI rarely calls paratroopers (it needs 6+ units and
  a visible enemy-held point), so this barely measures the change. Left for later: AI use of paratroopers.
- Map rework, from research on RTS map design (Company of Heroes map rules, StarCraft map papers): eleven Conquest
  maps get cover along their open approaches and, where there is room, a home point per HQ.
  - Killing fields broken up: every long open stretch on the walk between HQs and points now has shell holes beside
    the route, and some bushes that block the sight line. The longest open run on Six Fronts fell from 49 to 10
    cells, Ardennes 52 to 9, King of the Hill 37 to 10, Island Towns 58 to 21. HQ doorsteps stay clear.
  - Home points on Default, River Towns, Ardennes Crossing, Twin Valleys, The Polder, No Man's Land, Crater Field and
    Crossroads Village: each HQ gets its own point a third of the way to the front, worth 1 MP/s and no VP. It is
    safely yours (the enemy walks twice as far), but a raid can take it or cut its supply line.
  - Every change is copied through the map's symmetry, so fair maps stay fair. 120 AI matches per map, old vs new:
    wins by spawn within noise everywhere (Default 39/40/41 -> 44/36/40), matches the same length or up to 11%
    shorter on the two-side maps. Details in DESIGN.md, Map design rules.
  - New tools: `node tools/mapstats.mjs` measures every map (rush distance, point safety, lanes, chokes, open
    stretches, dead space), and `node tools/mapwork.mjs <maps>` applies the rework.
  - Found and left: the mirrored two-side maps are fair for two teams but not as a 4-player free-for-all (on
    Ardennes one mirror pair of HQs won 100 of 120 FFA matches, before and after). Assault maps were left alone
    (their single-lane funnels are the set piece, and their balance was tuned with AI runs).
- Fixed: units walked over the corner of an HQ (and other buildings and houses) instead of around it. Routes hugged
  the wall 1 m off, so a squad's soldiers and a tank's hull cut across the model. Pathfinding now pays a little extra
  for ground right beside a wall and straightens routes only where a 4 m wide lane is clear, so units pass a
  building about 3 m out. One-cell alleys between houses still work.
- Fixed: units routed straight through the command bunker (Assault, Annihilation, Horde) and were shoved out by
  crowding. Routes now go around a standing bunker; an order aimed at the bunker still reaches it.
- Fixed: spawn placement measured walking distance through cliffs, so two spawns on either side of a cliff counted
  as neighbours. A step of more than one level now blocks that measure, like water and houses already did.

### 2026-10-03: Public lobby (`b2dc9ab`)

- A public match browser now opens at the site's main address, using the same gunmetal panels, khaki borders,
  brass accents and condensed type as the room UI. Pick a nickname, filter live rooms by mode or open seats,
  use Quick Play for Conquest, create a public or unlisted room, or enter a room code. No account is needed.
- Public rooms show their name, map, mode, occupied seats, human/AI counts and match status. Unlisted and old
  rooms stay out of the browser. Rooms without a connected human player disappear from it. Unlisted rooms are
  link-accessible, not password-protected. Old /#code links and alternate-seat links still work; games now use
  /play and room invite links point there. The room screen has a Browse matches link.
- Room creation has a configurable server-wide limit (MAX_ROOMS, default 32), with a retry message when full.
  This is an admission guard, not a measured safe number of simultaneous battles. New seat tokens and room codes
  from the public lobby use browser cryptographic randomness. Invalid room titles fall back safely.
- Listed rooms enforce the selected map's seat limit, including AI and spectators taking a seat. A late joiner
  can watch instead of adding an extra player that prevents the match from starting.
- Left for later: public deployment, abuse/rate limits, per-match compute budgets, editor isolation, accounts,
  moderation and atomic Quick Play seat reservations. A room can fill or start between browsing and joining;
  the existing game flow then offers a spectator seat. Gameplay balance is unchanged.

### Other unreleased changes

- Fixed: long floating labels shrank their letters to fit a fixed plate, so the "Locked" tag over a linked point was
  unreadable. A long label now gets a wider plate at the normal letter size, and the locked tag reads "Locked: take
  the linked point first".
- Medics matter now. They heal 2.5x faster (a man back every 4 s instead of every 10 s), keep healing at half rate
  while the squad is under fire (before they stopped for 5 s after every hit), and an idle medic walks on its own to
  the most hurt friendly squad within 30 m (below 90% strength, not retreating). The AI no longer pulls its medic
  back to the middle of the army every time it steps away to treat someone. Balance over 150 AI matches on the
  default map: USA/GER/USSR 40/30/30% (was 34/37/29%), 9.2 min (was 9.3); medics are the same for every faction,
  so the USA swing is most likely noise, worth a recheck.
- Rubble stops vehicles. Infantry still climb through it and use it as cover, but tanks and trucks can no longer
  drive over a ruined house. A house that falls also throws rubble into the street beside it (about a 1 in 3 chance
  per side), so shelling a town can choke its roads for armour and cut off the points behind them (supply lines
  already count any ground a vehicle cannot cross). Any squad that can dig clears rubble with **Fill in**, and a road
  gets its road back. The AI clears rubble off roads near points it holds. Tanks crushing a wall leave a crater, not
  rubble. No shipped map loses vehicle access to a point. Balance unchanged within noise: default map
  USA/GER/USSR 37/33/31% over 150 AI matches (was 33/37/30%), 9.6 min (was 9.3); Stalingrad Factory 42/33/25% over
  60 (was 37/40/23%).
- Left for later: rubble cannot be blown clear with explosives (only shovelled), and ordinary shelling never digs a
  road deep enough to cut it (only bomb holes make cliffs).
- Four new units for every faction:
  - **Tank Destroyer** (Motor Pool, 320 MP): M10 Wolverine / StuG III / SU-85. A long gun that out-ranges every
    tank but the Tiger and hits like an AT gun without setting up. Poor against infantry.
  - **Field Howitzer** (Motor Pool, 300 MP): M2A1 / leFH 18 / M-30. Heavy shells on anything your side spots, out to
    95 m, but it can't hit anything closer than 30 m and must set up. Barrage: 4 shells on a spot. Shells scatter
    more the further they fly: tight (3 m) close in, loose (8 m) at full range.
  - **Flamethrower Squad** (Barracks, 180 MP): short range, and cover doesn't protect against fire. Squads in houses
    and trenches take 1.5x damage.
  - **Bomber** (Airfield, 420 MP): B-25 / He 111 / Pe-2. Drops two sticks of four bombs a sortie.
  - The AI builds all four. Faction wins 32/37/32% over 60 AI matches.
- **Shell area** (Shift+B, or the new order button): mortars, howitzers, rocket trucks, destroyers and bombers can
  fire on any patch of ground, seen or not, not just at a unit or a building. Guns move into range and keep firing
  until given another order. A bomber drops every stick it carries on the spot, then flies home. Shift+click queues it.
- Map labels with long text widen their plate instead of squeezing the letters, and a locked point's tag is shorter
  ("Locked: take the linked point first").
- Left for later: the new units borrow models and icons (the tank destroyer looks like the medium tank, the
  howitzer like the AT gun, the flamer like an engineer), and the flame is drawn as a fat tracer. The bomber's stick
  lands where its target was when it dropped, so it misses moving units.

- The paper war map: zoom all the way out and the battlefield fades into a staff map on old paper lying on a
  wooden desk (inked roads, houses, woods, water, contours and a blue grid), with the map's name above it and a
  compass in the corner. Every unit you can see is its map symbol in its owner's color, sharp at any map size;
  capture points are lettered rings in the holder's color; strikes on the way are red hatched boxes; your units'
  routes and queued orders are grease-pencil arrows (blue move, red attack, dashed retreat), and selected units get
  a pencil ring. Ground you cannot see now has a sepia wash. The floating labels fade out while the map is up.
  Zoom back in for the 3D view.
- Men killed by a blast (grenade, mortar, shell, rocket, bomb) are thrown away from it, tumbling through the air,
  and lie where they land. The closer they were and the bigger the blast, the higher and farther they fly.
- Gore: a man torn by a blast throws out bloody scraps and a red mist, and leaves a blood stain on the ground. A
  new **Gore: On/Off** button in the menu turns it off (bodies are still thrown). Visual only, no gameplay change.
- Left for later: real dismemberment (loose limbs) needs the soldier model split by limb. A thrown body snaps flat
  as it lands instead of rolling to rest. Blood stains share the crater marks' pool, so a long fight recycles the
  oldest of either.
- Auto-retreat is on by default: every new ground unit runs for home below 35% strength unless you switch it off
  (Shift+X). Planes are unchanged. Before, it started off and you had to turn it on per unit. The AI already armed it
  in a fight, so AI behaviour is about the same; balance not re-measured.
- New map, **The Great Bridge** (Assault): hold or take a great stone bridge into a river town. At 5:00 the
  defenders' engineers start wiring it, at 7:00 it is blown with anyone still on it, and from then on the attack has
  to go round by a ford far to the north or a plank rail bridge far to the south. The town square can only be taken
  by the side holding the bridge's east end. Attackers win 4 of 20 AI 1v1 assaults.
- Maps can say more:
  - **Landmarks**: a house can be named a church (upper floors see 1.6x as far, 700 hp a cell) or a factory
    (1000 hp a cell, 0.2x incoming fire inside). Both have their own look. A bridge can be a stone bridge, which
    takes 12x the hits of a plank one: one bomb no longer drops it.
  - **Point kinds**: a radio post makes its side's off-map support recharge 1.5x as fast; a supply depot reinforces
    and repairs like home.
  - **Linked points**: a point can need another one; a side can only take it while holding that one. The point shows
    "Locked" and a dashed line to the point it needs on the minimap, and the AI leaves it alone until then.
  - **Scripted events (triggers)**: at a set time a map can put a message on everyone's screen and blow up every
    structure in a box (a bridge, a row of houses).
  - The editor's select tool sets a house's or bridge's type, and the point panel sets a point's kind and link.
    Triggers are written in the map file for now (no editor control).
- Fixed: saving a map in the editor dropped its naval, trench-facing and Assault clock settings and every spawn's
  "Assault only" flag. Three Islands, No Man's Land, the XL maps, Bastogne, Helm's Deep and Stalingrad Factory lost
  them when saved. The editor and server now keep every setting the map check knows.
- Left for later: cells that hold two things (a mine under a road, wire in woods). Mines are a terrain type today,
  so it means changing every mine check and how fog hides them.

- The AI fortifies the points it holds: mines, a trench arc or strongpoint, a belt of barbed wire across the
  approach, and tank traps once you have shown it armor. It keeps less manpower back to do it, and a squad holding a
  point from a house now steps out to build while the point is quiet, then goes back in. On the default map it digs
  about three times as much as before. Balance (90 AI matches): faction wins 30/37/23 -> 26/31/33, spawn wins
  34/37/19 -> 34/28/28, median length 9.3 -> 9.0 min.
- Left for later: a point held by a mortar, AT gun or flak never gets fortified (only the first unit there holds it),
  and the AI does not build MG nests, sandbags or a Field Hospital.

- Shell holes, rubble and burnt ground are blast marks instead of filled squares. A lone hit is strongest in the middle and leaves grass in the corners. A bombed block is one torn patch, with bites along the edge and craters that run together. A line of bombs is a ragged run: the banks wander and the bright rim is gone on dug ground, instead of a row of equal pale bowls. A wrecked house is broken wall stubs and spilled rubble, not a shorter box. Feet can sit a couple of metres off the visible lip, because the lip slides and the ground under a unit does not.
- Trenches are real cuts in the ground now: the terrain drops 0.9 m along every trench, with sloped walls and the
  channel running on between connected cells. Men in a trench stand on its floor instead of sinking through flat
  ground, and anyone walking across one dips into it. The timber revetments line the walls from floor to lip and
  MG nest sandbags sit on the lip. Visual only: cover and sight lines are unchanged.
- Trenches are a mechanic now, not just a bigger cover number:
  - **Settling in**: a squad that just jumped into a trench gets ordinary cover. After 8 s standing still it is dug
    in and takes 0.3x incoming fire (was a flat 0.35x).
  - **Facing**: a trench you dig faces away from the diggers (rings, arcs and strongpoints face outward). Fire from
    the front meets the full trench; fire along it or from behind gets only ordinary cover. Flanking a line pays, and
    a captured enemy trench faces the wrong way.
  - **Hidden**: a squad in a trench that is not firing is seen only within 18 m. Firing gives it away.
  - **Communication trenches**: infantry move 20% faster along trenches.
  - **Steady**: suppression wears off almost twice as fast in a trench.
  - **Caving in**: enough shelling turns a trench cell into a crater, and tanks crush trenches they drive over.
  - Balance (150 AI Conquest matches, default map): faction wins 50/47/53 -> 44/50/56; spawn wins 51/49/50 ->
    62/54/34, which may be noise (see DESIGN.md "Trench rules"); games slightly less close (runner-up VP 0.49 -> 0.44).
- New map **No Man's Land** (2v2): two trench systems facing each other across wire and a cratered middle, made to
  show off the trench rules. Its trenches face the enemy (new map option `trenchFacing`).
- Planes: Shift- or Ctrl-click a plane in the air panel to add it to the selection (or drop it), double-click to
  select all your planes. Before, a click always replaced the selection, so you could not send several at once.
- Left for later: the AI does not yet flank trench lines or shell them on purpose; the client does not draw which
  way a trench faces.

- Boats in every mode: on a naval map, Conquest, Assault and Annihilation now offer the Landing Craft, Gunboat and
  Destroyer in a new **Naval** group of the recruit bar (140, 220 and 700 MP). A bought boat launches on the water
  nearest your HQ (a destroyer on the nearest deep water). Classic still trains them at the Shipyard.
- The destroyer fires broadsides: all four gun mounts turn to the target and each fires a shell with its own muzzle
  flash. A salvo is now four shells of 22 (32 against vehicles) instead of two of 40 (60), about the same weight.

- Warships (Classic, naval maps), trained at the Shipyard:
  - **Gunboat** (PT Boat / S-Boot / Armored Boat, 170 MP + 40 Fuel): the fastest unit (10 m/s), a rapid autocannon
    against boats and the shore, and a **Torpedo** (Munitions, 40 s cooldown) that hits a boat or ship for 25 times
    a normal shell (300 damage) and is never wasted on anything ashore.
  - **Destroyer** (Fletcher / Zerstörer 1936 / Gnevny, 520 MP + 180 Fuel, max 2): true size, 110 m long, 2400 hp.
    It keeps to deep water (at least 20 m from any shore or surf), so it cannot run aground. Its guns reach 120 m,
    further than anything ashore, and arc onto whatever your side spots, so it needs eyes on the ground. Flak against
    planes. **Shore Bombardment** (40 Munitions): eight heavy shells on a spot.
  - A ship is hit and seen along its whole length, not just at its middle.
- Fix: a Shipyard can now go up on a beach. Before, it needed open water within 2 cells, and every beach on Three
  Islands has 6 cells of surf, so only cliff tops were allowed and most players found nowhere to build it.
- Left for later: a coastal battery to answer the destroyer, the AI using any boat, shells and blasts still treat a
  ship as its middle, and the destroyer's balance is untested beyond the unit tests.

- Naval warfare, first slice (Classic only, on maps marked naval). Engineers can build a **Shipyard** on the coast
  (150 MP, needs water or surf beside it). It trains the **Landing Craft** (LCVP / Sturmboot / Assault Boat, 120 MP + 15
  Fuel): a fast, thin-skinned boat with two light MGs that floats on water and surf only. It carries one squad like a
  halftrack: right-click it with infantry to board, Unload to land them. A squad lands only where dry ground or
  wadeable surf is within 5 m, and a squad in a boat sunk far from land drowns.
- New map **Three Islands** (1 km, up to 6 players): three home islands and a central islet, no bridges. Each coast
  has beaches with surf where boats can land and cliffs where they cannot. Generated by `tools/genmap-islands.mjs`.
- Maps can now be up to 1024 cells (2 km) on a side; the lobby preview crashed on maps over about 350 cells (fixed).
  Measured: a 1 km map with six Massive AI armies runs at 2.1 ms per tick (11 ms p95, of 50 ms); the browser holds
  about 450 MB of JS heap on it against 76 MB on King of the Hill, so 1 km is the practical ceiling for now.
- Left for later: the AI does not use boats yet (on Three Islands the AI defends its island and never attacks),
  warships, coastal guns, beach obstacles, supply across the sea, and a longer Sudden Death for 60-minute games.

- Conscripts take three quarters of a place in the army limit, so the USSR can field a third more squads than anyone else (32 instead of 24 in Classic). The army count in the HUD can show quarters, and a unit only goes into the queue if the whole unit fits.
- Smoke is no longer a cloak of invulnerability. It still blocks sight lines 15 m and longer, so it screens you from tanks and guns at range, but anything closer sees and shoots through it. Before, a unit in smoke could not be seen or hit beyond 6 m.
- Balance, 150 AI matches on the default map (seed 1000), before -> after both changes: faction wins USA/Germany/USSR 39/58/53 -> 46/46/58, median length 473 s -> 465 s, runner-up VP share 0.44 -> 0.44. The USSR edges up from 35% to 39%, inside the swing earlier runs showed.
- Fixed: dead or fogged units (yours and the enemy's) stayed on screen with their health bars and icons ("That target is not visible" when you attacked them) until a reload. The cause: a game server started before the snapshot deltas, serving the newer page, which only drops a unit the server names as gone. The page now treats a snapshot from such a server as the full list. Each snapshot also says which units your game should hold; if it ever disagrees, your game asks for a full resend and repairs itself within a fraction of a second, and the browser console shows "unit rows out of sync".

- Teammates now spawn on the same side of the map. Spawns are matched by walking distance over the terrain, so a river, cliff or sea between two spawns keeps them on different teams: on Pegasus Bridge, Ardennes, Seawall, Kasserine and Monte Cassino a 2v2 or 3v3 always splits one bank against the other. Before, spawns were dealt in map-file order with a random rotation, which could put teammates on opposite banks. Which side your team gets still changes each match, and a free-for-all spreads players evenly.
- Smoother play on slow connections: snapshots are compressed, and each one now carries only the units that changed (plus the ones that died or slipped into fog), with wrecks and resource nodes sent only when they change. Measured on Six Fronts with Endless armies over 300 s of AI play (360 units at the end): late-game snapshots went from 10.2 KB to 7.3 KB raw and about 2.7 KB on the wire (3.7 KB compressed before the deltas, 10.2 KB uncompressed before this change). Building and encoding snapshots for six players went from 11.4 ms to 6.6 ms per send.
- Spectators: the server builds one snapshot for all of them instead of one each, and replays only new terrain changes (1.0 ms and 23.6 KB down to 0.4 ms and 15.4 KB per broadcast, at 3000 changed cells). A spectator who joins late still gets the whole map and every unit.
- The client only touches health bar, suppression bar, cover shield and sniper camouflage materials when their look changes, instead of on every unit every snapshot.
- Left for later: the team fog pass (`teamFog`) still reruns on every vision pass; it is already shared per team and cached between passes.

- Smoother big battles: all soldiers that look the same are now drawn together in one go instead of one by one, so 30 infantry squads cost about 60 draw calls instead of about 250 (fewer still at a distance), and squads off screen are skipped. Health bars only show on units that are hurt, suppressed, selected or under the cursor. The terrain no longer casts shadows on itself, the weather stops re-applying the light once it has settled, digging and shelling re-place only the nearby trees and rebuild the trenches and minimap at most 4 times a second, and the cursor check under the mouse runs every fourth frame. Bar materials are now freed when a unit is removed. To check in the browser: soldiers posing and walking, the far-away models, sniper camouflage and the `?perf` draw-call count.
- Fallen soldiers stay the soldiers who fell. A dead man lies as if he fell rather than aiming from the dirt. He keeps his uniform, helmet and kit, stays where he dropped, then sinks and fades. Bodies are no longer brown capsules. Up to 200 stay on the field, in one draw per uniform.
- Left for later: a wiped gun crew's weapon still disappears with the squad. Vehicle wrecks are still the real hull, darkened.

- Computer opponents play as a commander for the match, instead of issuing every perfect order on the same look.
  Each look is one situation: wait, hold, or attack, and that plan stays until the objective falls, the push fails,
  a watched enemy hits something they hold, or the time they gave it runs out. Easy keeps a plan longer than Hard.
  A tank they saw and then lost still keeps their rifles off that ground, and the next rifle or machine-gun purchase
  becomes an anti-tank gun, until the sighting is a minute old, they look and the ground is empty, or the wait runs out.
  If they already have an anti-tank gun, that gun goes toward the tank and the rifles stay back. The rest of the army
  does not freeze: a point clear of that tank is still taken. A watched enemy on a
  point, depot, or base they hold pulls idle squads there and stops a second attack for that look. A unit they have
  only just spotted does not break the plan and is not struck yet. An announced enemy air strike is still answered
  at once. When squads die on a point, the next push asks for a bigger margin and prefers a different point. Taking
  a point spends some of that caution, so a lesson can fade. The memory lasts one match. It is not a language model,
  and it still sees only what a player in that seat would see. A large AI-versus-AI balance sample was not rerun.
- New **Formation** menu in the Orders panel: line, block, column and wedge (Shift+V cycles), Tighten and Spread (`[` and `]`) to re-form units where they stand, March together (the group moves at its slowest unit's pace) and Snap to trenches (infantry placed next to a trench step into it). Mortars, rockets and medics stand in the rear rank.
- A wider right-drag now fits more units side by side, so a long drag gives fewer ranks. A double right-click turns the selection to face a spot without moving.
- Control groups remember their formation: Ctrl+number saves it, recalling the group brings it back.
- Less clutter: fortifications moved into a **Build** menu and dig patterns into a **Trenches** menu. Their hotkeys still work with the menus closed.
- Left for later: queued legs do not keep the march-together pace, and a group's saved formation does not include its facing.

- Big battles run smoother on the server. Unit separation uses its own fine 4 m grid and filters before sorting, vision shares one nearby-enemy query per 16 m cell, mortars count a target's neighbours from one query, radius queries filter before sorting, and the server builds the snapshot cache once per send tick instead of twice. Bastogne Horde (3 AI, endless army, 6000 ticks, seeded) at 300 to 399 units: step p50/p95 7.7/21.5 ms to 6.4/13.1 ms, worst step 34.5 to 21.7 ms, snapshot p50 3.1 to 1.5 ms. Same final state hash before and after, so replays and AI results are unchanged. One side effect: orders an AI gives on a send tick reach human snapshots one send later (about 0.1 s).
- Checked and left alone: the path budget counts findPath calls (default 4096 per tick, so it never limits), not node expansions. It does not explain step spikes: the slowest steps in the run above had no path work, and the heaviest path tick (5042 expansions) took 9 ms.

- Spectator mode. In the lobby, "Watch as a spectator" gives up your seat; "Take a seat" sits you back down. A
  spectator sees the whole map with no fog, every army and every shot, and has no orders, resources, recruit bar or
  alerts (the banner under the scores says "Spectating"). Anyone who opens the invite while a match runs, or when all
  six seats are taken, now watches instead of waiting outside. Up to eight spectators per room.
  - AI-only matches: step back to watch, add AIs and start. With nobody seated, the first spectator hosts (start,
    pause, end, restart). A match still needs at least one seat.
  - A spectator who disconnects is simply gone (no pause, no seat kept). A spectator reconnecting keeps watching.
  - Left for later: picking whose side to watch from. The view sits on the first seat's side, so friend and foe
    markers follow that player.

- Unit balance: rocket trucks, armored cars and MG teams.
  - Rocket launcher: damage to vehicles 30 -> 12 per rocket. It still breaks infantry and garrisons, but no longer
    beats light vehicles. Range, reload and cost are unchanged, and there is no limit on how many you can field.
  - Armored car: damage to vehicles 6 -> 14, so the unit meant to hunt rocket trucks and other soft vehicles can
    kill them. It still loses badly to tanks and AT guns.
  - MG team: damage to infantry 2.4 -> 4 per hit.
  - Measured on open flat ground, 2000 MP of one unit against 2000 MP of another, both attack-moving (share of army
    left, first minus second): armored car vs rocket -22 -> +78, mobile flak vs rocket -72 -> -35, armored car vs
    light tank -87 -> -73, MG vs rifles -77 -> -66, MG vs Rangers -45 -> +24. Ten MG teams set up and waiting for
    15 rifle squads went from wiped out (rifles keep 64%) to nearly even (MGs keep 4%, rifles 16%).
  - 60 AI matches on Three Crossroads, before -> after: faction wins USA/Germany/USSR 24/19/17 -> 20/17/23, median
    length 439 s -> 444 s, runner-up VP share 0.42 -> 0.42. Too few matches to call the faction shift real.
  - Rocket launcher, second round: it is now area artillery. It no longer fires at units on its own; a salvo lands
    where you order a Rocket Barrage, on a unit you give it an attack order on, or by autocast on a crowd (3+ in one
    blast area) or a dug-in enemy. The barrage is ready every 20 s (was 45) and is free in Classic (was 25
    Munitions), so autocast starts on there too. Speed 5 -> 3.5: moving it is a commitment.
  - Infantry against vehicles: rifle squads' damage to vehicles 0.4 -> 1.5, conscripts' 0.3 -> 1.1. A rifle army now
    beats halftracks (-72 -> +59), armored cars (-23 -> +82) and mobile flak (-68 -> +55) at equal cost, and still
    loses to light tanks (-85 -> -44) and medium tanks (-82 -> -25). AT guns stay the answer to tanks.
  - Nine rocket trucks defending against an equal-cost army attack-moving into them: against rifle squads the trucks
    kept 63% and the rifles 0% (with the infantry change alone); as area artillery the trucks keep 12%, the rifles
    5%. Against conscripts 61%/0% -> 6%/6%. A mass of trucks is now an even trade with infantry, not a wipe, and
    still punishes a crowd or a garrison.
  - AI matches on Three Crossroads after the merge with #29, before -> after both rounds: 150 matches (seed 1000)
    faction wins 46/53/51 -> 57/52/41, median length 474 s -> 464 s, runner-up VP share 0.46 -> 0.45; 60 matches
    (seed 1) 15/24/21 -> 19/13/28. The two runs swing opposite ways, so no faction effect shows above noise.
  - Left for later: MG teams still lose to equal-cost conscripts in the open. A slower truck (5 -> 3) made no
    difference in a straight fight; the speed cut is for feel. Planes, off-map support, cover and houses were not
    part of these tests. The trucks are still drawn as trucks (a towed gun would need new models).

### 2026-10-01. Individual soldiers and troop selection (`c55fd0f`, `69575e3`, `c27bcef`)

- Soldiers now walk, crouch-walk, crawl and retreat with moving limbs and individual stride timing. Men follow and turn separately inside their squad, keep their boots on the ground, and stop stepping when they stop. Moving shooters aim at their target, with flashes attached to the animated weapon. Squads return to normal spacing when a trench disappears.
- Troop selection follows visible soldiers and health bars, including squads spread along trenches and inside houses. Box selection works across mixed troop types without selecting a squad first. Small boxes cover the full posed soldier and rooftop bar, including prone boots. Saved groups skip passengers and parked aircraft, then include them again after unloading or launching. Dead squads stay excluded.

### 2026-10-01. Behavior and formation facing (`5b8783c`)

- Units choose targets by weapon role and incoming fire, keep space between squads, settle plain moves into nearby cover, and turn vehicle armor toward anti-tank threats. Automatic cover moves respect Hold position and Hold fire. Crowded destinations keep available shelter instead of choosing closer open ground just for spacing.
- Right-drag a destination to arrange selected units and set their facing. Shift queues the facing, and Ctrl-drag or G then left-drag attack-moves. Infantry and guns face on arrival; vehicles turn their hulls. Halftrack boarding and other special right-click orders still work.
- Mortars and rockets count only visible squads when choosing a cluster to fire on. Hidden squads and halftrack passengers cannot influence that choice.
- Fixed sight rays ending exactly on cell borders and the map editor's route check when it has terrain without player state.
- Diagnostic matches found that target choice changes the share of hits taken on cover tiles. That measure differs from time spent in cover. Seeded comparisons and the independent cover-time measure are recorded in DESIGN.md. No faction costs, weapons or health were retuned.
- Paired balance runs completed 300 Conquest and 120 Classic games per build. USA/GER/USSR wins changed from 102/91/107 to 98/101/101 in Conquest, and 41/39/40 to 30/43/45 in Classic, with two final Classic draws. Conquest crowding fell from 44.5% to 11.7%; sampled infantry time in cover changed from 27.3% to 25.8%. These results include both behavior and AI changes. See the committed balance evidence for the full comparison.

### 2026-10-01. AI difficulty (`bbd170a`)

- Hosts can choose Easy, Normal or Hard for each AI seat before a match. Difficulty changes reaction time and tactics, with the same income and fog rules at every level. Squads fall back at their last model, wait for reinforcements at forward Classic production buildings, and recognize medium tanks and Tigers when buying AT guns.
- Hard keeps onward move orders when changing focus targets and stops chasing retreating squads. Supply reconnection stays immediate at every difficulty.
- AI pilots, 18 matches per comparison: Conquest Hard / Normal 14/4, Easy / Normal 2/16, Normal / master 9/9; Classic Hard / Normal 11/7, Easy / Normal 3/15, Normal / master 6/12. All 108 games ended without draws or timeouts. These small samples do not establish Normal-versus-master parity in Classic.

### 2026-10-01. Controls and cover overlays (`b6fa1df`, `4faefee`)

- Controls are in a `?` / `F1` sheet, with mouse instructions and current hotkeys. It appears on your first match in this browser and closes with your first click. Map-edge scrolling pauses while the sheet is open.
- Infantry preview cover around the cursor with green shields for heavy cover, yellow for light cover and red for open ground. Direction marks show protected sides, and a move briefly shows the destination's cover. The menu's Cover preview switch saves its setting. Marks stay inside explored ground, including after a rejoin.
- Ground rings, order lines, capture progress, strike zones, formation previews and fortification cells use thin, smooth lines that follow hills and craters. Queued orders use dashes and destinations use arrowheads. Unit cover shields share the preview colors.
- Cover marks refresh when vehicles or enemies move inside a terrain cell. Woods and wreck cover follow the current rules. Exact wall health remains unavailable to the client, so some marks behind damaged walls can overstate protection. Categories show the kind of protection rather than its exact strength.

### 2026-10-01. Grounded world and effects (`b5b7def`, `8a4a7d8`)

- The battlefield continues into natural land and water beyond the playable map. Removed the wooden table, desk props, cut earth border and tilt-shift blur. Ground colors and light are more muted, with an optional golden sun through `?mood=golden`. Server vision fog, weather and changing ground extend across the world edge.
- Fixed fog at the world edge and crater updates on previously flat edges. The combined build was checked in the map editor and on a real GPU in a Massive match. Measurements and limits are in `docs/issue-batch-verification.md`.
- Explosions throw dirt and debris, leave craters and cool from fire into smoke. Smoke screens, burning wrecks, grass, hedges, woods, houses and aircraft share lit effects that drift with the wind. Graphics Low reduces particles and crater count. Removed the unused support-plane effect pool and fixed one-sided collapse dust on Low. Sprites still can intersect walls and units; they fade against terrain only.

### 2026-10-01. Unit models (`2235ce3`, `4127dbd`, `8e47836`)

- Infantry have clearer faces and helmet straps, thicker webbing and bags, a rounder Soviet greatcoat roll, and three rifle stances. Prone riflemen support level weapons on their elbows, kneeling feeders lean toward the belt, and distant helmets keep their domed shape. The unused draft is folded into the live model. Each soldier uses one draw call, at most 884 near triangles and 145 far triangles.
- Shaded vehicle faces keep their paint and surface detail. Light tanks have clearer hull seams and rivets, Tiger wheels are separated, and the ZSU-37 has lower shields and a fuller breech. Vehicles remain within their triangle budgets and use two model draw calls.
- German planes have smaller splinter camouflage broken into uneven angular patches. All fighters and attackers stay within the 3,500 triangle limit, including props and blur discs.
- Left for later: medics still use the engineer figure, including its carbine, although they are unarmed in combat.

### Earlier unreleased changes

- Woods, mine clearing, halftracks, medics, the Field Hospital and supply lines.
  - Woods (new terrain): infantry in a wood get light cover (30% fewer hits, a wall gives 50%), sight reaches about
    three cells (6 m) into the trees and never through a wood, vehicles drive through at half speed and route around,
    and nothing can be dug or built there. Woods burn (a cell burns for 20 s, the fire runs through the trees) and
    heavy shelling clears them. Three Crossroads, Crossroads Village, River Towns and Ardennes Crossing now have woods
    on the flanks of each HQ's road to its nearest point (`node tools/woods.mjs <map>` stamps them). The map editor
    has a Woods brush.
  - Finding mines: a rifle, conscript or engineer squad that stands still for 2 s finds enemy mines within 6 m
    (Engineers find them on the move). Found mines show to the whole team, and the team's units route around them.
  - Clear mines (Shift+M, 5 MP per 4-cell piece, drawn as a line like sandbags): builder squads lift the mines their
    side knows about, working from a few metres back.
  - Halftrack (180 MP; Classic: Motor Pool, 140 MP + 20 Fuel): fast, light MG, thin armor. It carries one infantry
    squad: right-click your halftrack with infantry selected and the nearest squad climbs in; Unload (Shift+E, or the
    button) lets it out. A squad inside cannot be seen, shot or ordered. If the halftrack is destroyed the squad is
    thrown out with 30% losses. Infantry within 10 m of a halftrack that has stood still for 2 s reinforce there
    (same price as at the HQ, half the pace).
  - Medic team (120 MP; Classic: Barracks): two unarmed men. They heal the most hurt friendly squad within 10 m at
    2 hp per second, for free, but only a squad that has taken no damage for 5 s.
  - Field Hospital (100 MP, on the builder squads' orders panel, 12 s to put up, one per player): a tent. Your side's
    infantry within 12 m reinforce there like beside a halftrack. Shelling destroys it.
  - Supply lines (every mode but Horde): a point pays its manpower, victory points and Munitions only while a
    vehicle could drive to it from its owner's HQ (or a teammate's). Rivers without a bridge or ford, walls, tank
    traps and cliffs block the way, and so does the ground within 8 m of an enemy fighting unit, unless that enemy
    is within 16 m of the point (that is a fight for the point, not a cut road). A cut point shows "Cut off: no
    supply", a red cross on the minimap and an alert. Checked every 2 s.
  - Computer players buy one medic team once they have five infantry squads and keep it with the army, lift mines
    their side has found, and send free units to reopen a point of theirs that is cut off. They do not buy
    halftracks or build hospitals.
  - Balance, Conquest, AI against AI, 150 matches per map, everything on against woods and supply off (medics in
    both): Three Crossroads wins per spawn 37/44/19% (39/41/20%), length 465 s (475 s); River Towns 36/39/25%
    (36/40/24%), 519 s (503 s). No measurable change. Ardennes Crossing, 100 matches, four-way: 53/1/46/0%
    (53/0/47/0%): two of its four spawns never win, with or without the new rules.
  - Supply was never cut in those 550 AI matches: the computer does not block roads on purpose, and these maps have
    fords beside every bridge. So the rule is untested as a balance factor between people.
  - Bug fixed along the way: a grenade or satchel ordered at a spot with no way to it could crash the match after
    20 failed route searches.
  - Not checked in a browser (the browser tools could not reach the local server this session): the new models, the
    wood trees, the hospital tent, the Unload button and the cut-off marker are unseen. `node test.js` passes.
  - Left for later: the fog of war drawn on the client does not know woods hide things (the server does). The
    Command Card now has 16 cards for 15 letters, so the last one (the ground-attack plane) is click-only. A found
    mine stays known after the squad that found it leaves. The halftrack is drawn on wheels only.
- Houses now come in three types, set by how big the building is on the map: a wooden shed (10 cells or fewer) is weak
  cover and falls fast (55% incoming accuracy, 250 HP per cell), a brick house (11-23 cells) is what every house used
  to be (35%, 400 HP), and a stone building (24+ cells) is a fortress (25%, 650 HP). The tag on a garrisoned squad
  names the type.
  - A house protects less as it is shot up: the squad's own cell slides to 85% / 70% / 55% just before it collapses,
    so shelling a garrison hurts it before the house comes down.
  - Balance, 40 AI matches per map, old rules vs new: 2nd place's VP share fell from 58% to 53% (default), 56% to 51%
    (River Towns) and 76% to 68% (Stalingrad Factory); match length moved by 15 s at most. First-guess numbers.
  - Each type has its own model, so you can read a building before you send a squad in. Sheds are timber: plank
    walls on a low stone footing, tarred corner posts, a braced plank door and grey shingles (about half of the 3x3
    ones are barns). Houses are brick or limewashed render under clay tiles, with stone corners and lintels. Stone
    buildings are bare stone under slate, two storeys or more, with pale dressed lintels and a band between storeys.
    Ruins and rubble keep the material (splintered boards, broken brick, broken stone).
  - The church is now always a stone building, so maps with no block of 24 cells or more have no church. Fieldstone
    farmhouses are gone from the mid-size houses, since stone now means the strong type.
  - Left for later: the AI does not yet weigh a house's type or damage when it picks one to hold.

- Line infantry now marches as a battalion: a block of ranks instead of a handful of men. Rifle squads draw 15 men
  (3 ranks of 5), conscripts 21 (3 of 7), rangers 12 (2 of 6), engineers 6 (2 of 3). Looks only: health, damage and
  cost are unchanged, and the rear ranks fall as the squad loses health. Weapon crews and snipers stay as they were.
  - In a trench the block breaks ranks: the men line the trench cells nearest the squad (up to four to a cell)
    instead of standing sunk into the open ground beside it, and form up again when they leave. Squads sharing a
    trench take separate spots; only when a stretch is full (more than four men per cell) do the extra men double up.
  - Fixed: men a squad got back by reinforcing near its spawn were never drawn again.
  - Left for later: each man is his own mesh, so very large armies draw about 3x as much; instance them if it stutters.

- Sandbags, barbed wire, tank traps and minefields can be drawn out as one continuous line, like a trench line.
  - Their buttons and hotkeys now take two clicks: where the line starts and where it ends. A short line is one piece
    (as before); a long one is up to 12 pieces end to end. Every selected builder squad works on it, each piece is paid
    for when a squad starts it, Shift on the second click queues it, and other squads can be sent to help by
    right-clicking the ghost while pieces are left.
  - Piece lengths and prices are unchanged: sandbags 4 cells for 20 MP, wire 5 for 25, tank traps 4 for 40, mines 4
    for 40. The ghost shows each kind in its own colour (wire brass, sandbags tan, traps grey, mines red).
  - The plain Trench (T), the MG nest and the bridge keep their single placement.
  - Not checked in a browser. Computer players still place these one piece at a time.
- Entrenchment ghost: works stay on the ground until they are dug.
  - Bug fixed: the ghost only listed segments nobody had started. A segment vanished the moment a squad took it, so a
    pattern with as many squads as segments showed no ghost at all, and there was nothing to right-click for help.
    Segments a squad is walking to or digging now stay in the ghost, and their cells drop out one by one as they are dug.
  - A single fortification (trench, sandbags, wire, tank traps, MG nest, minefield, bridge) now shows the same ghost
    while its squad walks over and builds it. Allies see it, enemies do not.
  - Right-click to help still joins only a pattern that has segments left to hand out. A segment that already has a
    squad on it cannot take a second one.
- Flooding: a crater next to a river or ford fills with water.
  - It becomes a ford as deep as the crater was: everyone wades through it slowly, it gives no cover any more and
    nothing can be built on it. A flooded crater floods the crater next to it, one cell every half second, so water
    creeps down a line of shell holes. It never drains.
  - A crater on ground higher than the water stays dry. Craters that touch water on the map at the start of a match
    fill in the first second.
  - Left for later: trenches do not flood, a deep crater does not become impassable river, rain does not fill craters.
  - Not checked in a browser, and no AI balance run yet (shelling a riverbank now removes cover instead of making it).
- Wrecks: a destroyed vehicle no longer disappears. Its burnt-out hull stays where it stopped and is cover.
  - Infantry behind a wreck get the same cover as behind a live vehicle: full within about 2.5 m, fading to nothing
    at 4 m, from the front only. A squad standing on the wreck's cell is in cover as well.
  - A wreck blocks vehicles like tank traps do: tanks have to go around, so a knocked-out tank can plug a road or a
    one-cell gap. Infantry climb over it. It does not block sight.
  - A wreck can be blown apart: it has 300 hp against explosions (a bomb or a satchel charge in one, about four
    artillery or tank shells) and leaves a crater. Wire, sandbags and buildings cannot be put on it.
  - A vehicle that dies on a bridge or in a ford, or on a cell another vehicle stands on, leaves a hull that is only
    cover: it blocks nothing and cannot be destroyed, and goes when the 40-wreck limit clears it.
  - Every tank, half-track, rocket launcher and other ground vehicle leaves one. Planes, guns and infantry do not, and
    neither does a vehicle that went into the river with its bridge.
  - Up to 40 wrecks lie on the field. Past that the oldest is cleared away. Before, the hull was only drawn for 40
    seconds and never gave cover.
  - Everyone sees every wreck, also through fog and after reconnecting.
  - Not checked in a browser. Computer players do not look for wrecks to hide behind, and do not shoot wrecks out of
    their way (their tanks path around).
- Scarred ground: shelling sinks the ground, bomb holes are round, and squads can fill holes back in.
  - Artillery now sinks the ground around where its shells land, not just the one cell under each shell. A cell goes
    one level (2.5 m) down for every 600 terrain damage it takes, which is about three barrages on the same strip, and
    it becomes a crater when it sinks. Tank shells count a quarter (roughly 35 shots on one spot per level). Bombs are
    unchanged in speed: one level at once. Rockets, mortars, grenades and satchels do not sink ground.
  - The limits are the old ones: nothing goes below level -2, and a cell never ends up more than one level below the
    ground beside it, so a pounded field sinks as a bowl from the middle out, never as a shaft.
  - Bomb holes are round. A Bombing Run bomb digs a 4.2 m hole and a Dive Bomber a 3.2 m one, measured from where the
    bomb lands (not snapped to a 3x3 square), two levels deep in the inner half, with craters across the whole hole.
    Under a river the bed is only dug once.
  - New order, Fill in (Shift+L, 10 MP, a line like sandbags): builder squads turn craters, flooded craters and sunken
    ground back into open ground and raise it towards the height the map had, at most one level above the lowest
    ground beside it. A deep bowl takes several passes, deepest cells first. Fords drawn on the map cannot be filled.
  - Buildings can go on ground with one level of fall across the footprint. The builders level it to the highest
    cell. Before, any dip under a site blocked it, which shelling would now cause all the time.
  - Computer players fill holes too: flooded craters and sunken ground within reach of a point their side holds, and
    on a free supply node (so a shelled node can take a depot again). One job at a time, with 160 MP or more in hand,
    never with a visible enemy within 35 m, and only a squad within 60 m goes. Dry craters at the map's height are
    left alone because they are cover. Their artillery and tanks scar the ground like anyone's.
  - Not checked in a browser. No AI balance run.
  - Left for later: a hole two levels deep hides its bottom from a squad a few metres back, so a Fill in order there
    answers "not visible" until the squad stands at the rim.
  - Test fix: the lobby check "a new match without the old result" raced the lobby message and failed about half the
    runs. It now waits for it. `node test.js` passed 5 of 5 afterwards.
  - Found, not fixed: `node test.js` fails about one run in three on the lobby check "a new match without the old
    result" (once on "an explicit ground attack overrides the plane stance" with flooding switched off).
- The computer opponents no longer cheat. They plan only from what a player in their seat could know: the same
  snapshots a human receives (units seen right now, buildings and terrain remembered under fog, public announcements),
  with the same rounded numbers. Leaks closed: they knew which resource nodes already held an enemy depot (it steered
  their Engineers and how many they bought), they planned building sites, cover and trenches around enemy buildings
  they had never seen, they knew how long a newly spotted gun had been standing still (it triggered artillery), they
  counted planes for a few ticks after those planes landed, and they used exact health and positions where players see
  rounded ones. They look at the world on the same beat as player snapshots and keep a 60 second memory of sightings.
  The Horde's own seat plays by the same rules: it sees only what its units see, and its waves still march straight on
  the always-visible bunker. Their economy was already identical to a player's, and a test now replays an AI seat's
  orders as a human to prove it. Every order, including entrenching, mines and bridges, goes through the normal command
  checks, and a test fails if the AI changes anything else.
  Balance, same seeds before and after on the current game (default map, 3 players, 20 minute limit). Conquest, 60
  matches: wins USA/Germany/USSR 23/20/17 to 19/17/24, median length 9.27 to 9.15 minutes, all matches finished,
  runner-up VP over winner VP 0.573 to 0.533. Classic, 30 matches: wins 4/8/5 to 7/10/5, finished 17 to 22 (timeouts 13
  to 8), median length including timeouts 19.41 to 18.39 minutes. Left for later: two Engineers can pick the same
  building site in one turn (the second order is rejected normally), the shared auto-targeting of rocket salvos still
  counts hidden neighbours of a visible target, and a hidden mine on a road still shifts vehicle routes (the road is cut
  in the terrain flags), all for players and AI alike.
- Textured units (toward a realistic look instead of painted toys):
  - Soldiers, tanks, wheeled vehicles, guns and planes now show real surface detail: worn and chipped paint on armor,
    scratched gunmetal, rusty track links, rubber tires, wool uniforms, wood and canvas, plus a dust film and dried mud
    that build up toward the ground on hulls, wheels, tracks and boots. Faction paint, markings and owner colors keep
    their hue; the texture adds the wear, and paint is a little faded so nothing looks candy-colored.
  - Twelve seamless textures generated with gpt-image-2 (painted armor, cast armor, gunmetal, track steel, rubber,
    wood, canvas, wool, leather, aluminum, aircraft paint, mud; 512 px, about 1.1 MB in all) in
    `client/textures/models/`, packed into one texture array and mapped from three sides in each model's own space,
    so nothing swims when a turret turns or a squad lies down.
  - No extra draw calls or triangles: a tank is still 2 draws, a rifle squad 5, one faction's full lineup 57.
    Graphics Low turns the textures off (models look as before and cost nothing more), and so does the moment before
    they finish loading.
  - Fixed: the grime turned dark tracks, road wheels and tires into an orange-tan band at the lower hull (reported
    from the medium and light tank models). The dust film and mud clumps are now greyer, never much brighter than
    the part under them, sparser, and held at about a third on track steel, rubber and gunmetal; vehicles gather mud
    up to 0.75 m instead of 0.9 m and track links show less rust.
  - Soldier uniforms on the current models are more muted (olive drab, field grey, Soviet khaki) and helmets take
    less of the owner's color.
  - Model building: a part can say what it is made of (`part(..., mat)`, `merge()` items with `mat`, `tag()`; names in
    `MATS` in `client/models/geom.js`), see DESIGN.md. Toolkit wheels tag their tires as rubber and tracks their links
    as track steel. Model viewer: `&tex=0` shows a unit without textures; the header says whether they are on.
  - Measured in headless Chrome, which only has SwiftShader (software rendering, so texture filtering is far slower
    than on a real GPU): a dense 42-unit battle at 1280x720 keeps 205 draw calls and 200,906 triangles and takes
    about 2.9 s per frame with textures against 1.45 s without (2x; the first version was 2.6x before the shader
    skipped faint triplanar sides, reads the mud layer only where mud clumps can show and skips far-off pixels).
    Frame rate on real graphics cards is not measured yet.
  - Left for later: the model families still have to tag their parts (faces and the infantry base as plain, cast
    turrets, tracks built without `track()`, canvas, wood); until then those parts take the default (painted armor on
    vehicles, wool on soldiers). The airfield uses the near-flat aircraft paint. Graphics Low has no texture at all.
    Found: the room check "a new match without the old result" (a draw, then a restart) failed once in four
    `node test.js` runs and passed on the rerun; it does not touch the models and was left as is.
- New look for the whole interface. The paperwork style (manila cards, typewriter text, stencil numbers, map symbols)
  made the game read like a board game, so the HUD, lobby, menu, alerts, banners, tooltips, match report, end-of-match
  notice, map editor and the labels and badges over the battlefield now share one modern style: dark gunmetal panels
  with thin khaki edges, one condensed typeface (Barlow Semi Condensed) and brass only on manpower, victory points and
  the clock. Layout, hotkeys, element ids and what each panel shows are unchanged.
- Recruit cards, train and build cards and the selection list show a small picture of each unit, rendered from its
  real 3D model in your faction and color. They are made one per frame once the match is under way, so loading and the
  frame rate are not affected, and they follow the models as those improve. Until a picture is ready the slot shows
  the unit's silhouette.
- One set of flat silhouette icons replaces the NATO map symbols and the line icons: unit types, buildings, support
  calls, orders and the badge beside each unit's health bar on the battlefield (drawn there in the owner's color on a
  small dark plate). Costs are plain numbers; resources get a small icon (helmet, cartridge, jerrycan).
- The Victory or Defeat notice at the end of a match is a quiet panel that fades in, instead of a tilted rubber stamp.
- Recruit by letter and autocast take the new look. The Recruit tab, when on, reads in brass with a brass hairline
  and the Command Card's edge turns brass while the letters are live; each card's letter sits at the left end of its
  cost line, clear of the name and the portrait; a card bought by its letter shows the pressed look for a moment.
  An ability with autocast on gets the HUD's on state (brass hairline over a faint brass tint) and a small A, instead
  of a dashed pencil border.
- Stances, Take cover, mass entrenchment, Horde and the weather line take the new look. The stance switches (hold
  fire, hold position, auto-retreat) and Take cover, the six entrenchment patterns (line, zigzag, double, arc, ring,
  strongpoint), mines and the bridge get silhouettes from the same set; a stance that is on shows the HUD's on state
  and reads "On" or "Off" (it read "ON"). Horde's next-wave button, Horde's result line, the lobby's Weather
  picker and the weather line under the teams use the panels, hairlines and plain punctuation like the rest.
- The lobby shows the selected map's real battlefield behind the room form: the camera drifts slowly over it, dimmed so
  the form stays easy to read, and it changes with the Map select. It runs on a small low-resolution renderer of its
  own that is freed when the match starts, is skipped on Graphics Low, and on software rendering (or with reduced
  motion) shows a single still frame. Its world is built in steps in idle time; the biggest step, painting the ground,
  took about 0.7 to 1.1 s on the heavily loaded test machine, and a match on that map reuses the painted ground.
- The Command Card's group names (Infantry, Support weapons, Vehicles, Aircraft) lead with a small silhouette.
- Fixed: starting a match could send the start before the lobby message that clears the last match's result, because
  that message waits on reading the map list. The server now sends the lobby first. It made `node test.js` fail now
  and then on a busy machine ("a new match without the old result").
- Status lines and hints read as plain sentences ("0 pts, 0 held", "60 MP, 20s", "Right-click cancels") instead of
  pieces joined with middle dots.
- Checked in Conquest and Classic at 1920x1080 and 1366x768 (lobby, HQ view, selection with orders and recruit row,
  support calls, alerts, tooltip, menu, pause banner, end notice, match report, map editor): nothing overlaps, all 16
  Conquest portraits render, no console errors. The Impeccable detector (4.1.0) is clean on `client/`.
- Left for later: the portraits show today's simple models and will look better as the models do; a few text glyphs remain (veterancy stars in the selection list,
  the lobby's kick cross, the editor's check and warning marks, the star on double-VP point tags); `client/markers.js`
  still exports the old ink color, unused now; the menu button's tooltip can cover the first menu item while the
  cursor stays on the button.

- Weather: the host picks it in the lobby (Map default, Clear, Fog, Rain, Mud, Snow or Random), and it changes how
  the match plays for everyone. Ground fog cuts sight by 30%. Rain is the living ground's rain held on all match, on
  ground soaked from the start: sight -20%, vehicles off the roads -20% (more on low ground), fords slower, smoke
  thinner and fires put out. Mud is the living ground's soaked ground held all match: vehicles off the roads -20%
  (more on low ground), fords slower, driven ground churning to mud sooner, and infantry -10%. Snow cuts sight by 10%
  and slows infantry by 10% and vehicles by 15%. Roads are the map's roads and bridges. In Clear, Fog and Mud the
  living ground's showers still come and go; in Snow it never rains. Planes and recon flights fly above it. Map
  default follows the map: the Ardennes snows, and the misty river maps (Pegasus Bridge, The Polder, River Towns)
  start in ground fog that lifts at 4:00. Random can lift its fog or turn its rain to mud partway through. Any change
  is announced to everyone 10 seconds ahead in a quiet line under the score strip, which always says the weather and
  what it does, and also tells of a passing shower or wet ground (it replaces the separate rain line). The board shows
  it too: thicker haze and drifting fog banks, rain streaks on the wind with wet ground and puddle sheen (after a
  shower too), mud along the roads and village streets, and snow falling and lying on open ground, on Low graphics as
  well (with fewer drops). The AI waits for a bigger army before marching on a Classic base or an Assault bunker when
  it can see less. Balance, measured before the living ground was merged (Rain was then its own rule at sight -15%),
  AI vs AI on the default map:
  Conquest (40 matches each) 2nd place ends at 0.59 / 0.63 / 0.62 / 0.62 of the winner's VP in Clear / Fog / Rain /
  Snow, matches last 9.2 / 9.6 / 9.3 / 9.1 min, faction wins USA/GER/USSR 6/20/14, 14/15/11, 16/16/8, 15/13/12.
  Classic (20 each) lasts 19.2 to 20.0 min, 14 to 17 of 20 are decided before Sudden Death, faction wins 6/7/6,
  6/8/6, 6/9/4, 9/5/6 (2 draws in all). Found while measuring: asking for groups of 4 instead of 3 to attack a held
  point in poor weather made Conquest one-sided (2nd place 0.26 to 0.37 of the winner), so Conquest groups stay at 3.
  Mud, measured in review (same harness, 40 Conquest matches each): mud ends at 0.60 of the winner's VP, 9.0 min, faction
  wins 14/16/10, against Clear at 0.57, 9.0 min, 15/14/11. That Clear run also shows the 6/20/14 split above was
  sampling noise. Classic in mud (24 matches against 24 in Clear) runs about 2 minutes longer (19.9 against 17.7 min)
  and 7 of 24 reach Sudden Death against 2 of 24 (the same 7 of 24 with the AI's caution switched off, so the slower
  armies cause it, not the AI). The AI's Classic caution on its own (24 fog matches each way) adds about 1.6 min (19.6
  against 18.0) and one more match into Sudden Death (4 against 3).
  Found and fixed in review: the map editor lost the falling snow on winter maps; the lobby tooltip repeated the
  weather's name; Clear is now exactly the game before weather (the weather seed used to take one random number from
  every match, which changed seeded bench runs; checked with the bench's final-state hash on both modes); a
  made-up weather name in a map file or a bad setting falls back to the map default instead of freezing every unit.
  Merged with the living ground (roads, mud, showers and wind, d1b7150): both had rain and soft ground, so Rain now
  runs the living ground's rain all match and Mud its soaked ground, instead of their own rules (Mud was -30% off
  roads; a tank in a mud cell in Mud weather no longer pays twice), the showers follow the match weather, the sim's
  roads are the map's road and bridge cells (village streets only place the mud and puddles you see), the weather's
  sight goes through the same range function as the fog of war (#14), and the two lines under the scores became one.
  Clear is exactly the living-ground game: the seeded bench gives master's final-state hash. Balance after the
  merge (same harness, default map, 40 Conquest matches each): 2nd place ends at 0.47 / 0.47 / 0.53 / 0.55 of the
  winner's VP in Clear / Rain / Mud / Snow, matches last 8.7 / 8.8 / 9.2 / 9.0 min, faction wins USA/GER/USSR
  15/13/12, 9/17/14, 16/7/17, 14/16/10. Nothing is one-sided. Clear is noisy at this size (its two halves gave 0.30
  and 0.63; master's own Clear over 20 matches gave 0.57), and Germany's 7 of 40 in Mud is about two standard
  deviations under an even split, worth a second run.
  Left for later: the match-end test "a new match without the old result" fails on a busy machine: the server sends
  the lobby update after listing the map files, so it can arrive after the start message. It failed twice in a row at
  a load average near 75 after the merge and passed on the next run at 33; origin/master passed at 35 to 70.
- Fog of war now shows exactly what your team sees:
  - Before, the client drew its own vision circles, and they disagreed with the server on 6.4% of the map's cells
    (a quarter of all the cells either side called seen) over AI matches on five maps. 5.7% of the map was drawn
    clear while the team saw nothing there, 0.7% was seen but drawn fogged, and 29 of 477 enemy units the server
    showed stood on fogged ground (on Bocage, all of them).
  - The server now sends each player only its own team's seen cells: the whole mask at match start and on
    reconnect, then only the cells that changed, as short run-length strings. On a six-player Massive game (Six
    Fronts, Conquest) a snapshot grows from 1920 to 2022 bytes on average (+102, about 5%). Working out the masks
    raises the server's cost for one round of six snapshots from 0.77 to 3.75 ms on average (p95 2.8 to 10.7 ms).
  - The ground has three looks: seen (clear), explored (dimmed) and never seen (dark). A cell fades to its new look
    within a quarter second, and only the changed part of each texture row goes to the graphics card (about 1 KB a
    frame instead of the whole 90 KB texture). Trees, rocks and other props now darken in the fog like houses and
    walls already did, and water darkens under the same overlay.
  - Every unit a snapshot shows stands on clear ground: in a replay of 1334 snapshots, 0 of 21108 shown ground
    units stood on fog and the client's seen cells matched the server's every time, and in a live 2v1 match on
    Bocage 0 of 13588 shown ground units over 1465 snapshots stood on fog. A new server test checks each
    team's mask against a cell-by-cell vision check on the 300-unit Massive fixture, including after a hedge, smoke
    and raised ground appear in a standing unit's view.
  - Review fix: houses, walls, hedges and props in the fog now darken like the ground. On High graphics they faded
    toward a mid grey, so hedge rows and trees showed as pale shapes on dark ground. The fog mix ran after the colour
    conversion, which High does in a later pass, so it used a grey meant for Low. It now mixes toward the overlay's own
    colour before conversion, and both graphics levels match the ground.
  - Review checks: a live reconnect on Bocage kept every explored cell and the changed-cells stream stayed in step
    afterwards (0 of 15818 shown ground units outside the server's mask over 1274 snapshots). Replays of Classic
    (Default, Bocage) and Annihilation (Hill 112) had 0 mismatches between the client's seen cells and the server's
    mask, and every building footprint matched cell by cell (7340 building rows on Bocage alone). Client fog work on a
    six-player Massive game costs 0.16 ms per snapshot and 0.009 ms per frame on average, about 3 KB of texture upload
    a frame.
  - Merged with the realistic scenery: the new trees, bushes, hedgerow leaves, grass and wheat darken from the same
    server mask, with the same mix as the ground. Their own darkening rule (a multiply written against the old grey
    mix) no longer matched anything, so `client/foliage.js` now uses the shared fog shader as it is.
  - Merged with the living ground: rain now shortens sight by up to 20%, and the drawn fog follows it. The fog and the
    server's vision read one range function, and units standing still recompute their seen cells when a shower
    comes or goes. A new test pass checks that rain shrinks the mask and that it comes back when the rain stops.
  - Left for later: terrain changes (craters, trenches) still reach every client, even in the fog. Enemy planes
    still show over fog (by design), and a camouflaged sniper can stand unseen on clear ground. The fog edge can
    trail a moving unit by up to about half a second (five vision passes a second plus the fade). In Annihilation the
    ground under the always-visible enemy bunkers is clear, and in Horde the last few attackers shown through the fog
    get a clear cell under them the same way. The new test adds about 3 seconds to `node test.js`.
- Living ground: the board wears, burns and gets rained on, and nothing snaps at a tile edge any more.
  - Soft edges: a unit's speed is the average of the ground under its whole footprint, so a tank half on a road gets
    half the bonus. Cover behind a wall, house, hedge or vehicle is full within about 2 m and fades to nothing at
    3.8 m (it used to switch off at 2.2 m).
  - Wear from traffic: every vehicle that drives over open ground cuts it up a little (about 10 tank passes when dry,
    light vehicles count half). Churned ground slows vehicles by up to 30%, then turns into shallow mud, and mud that
    keeps getting driven on gets deeper. Roads do not wear from traffic.
  - Wear from shelling: explosions break up a road step by step (less speed bonus each time) until the cell is a
    crater. A crater that is hit again gets deeper.
  - Depth: every mud, ford and crater cell has its own depth. Mud runs from 70% vehicle speed (shallow) to 35% (deep),
    a ford from 75% to 35% for everyone, and a deeper crater is better cover (from about 40% protection to 70%;
    it was a flat 50%).
  - Shot-up cover: walls, sandbags and hedges show two stages of damage before they fall, and protect less as they go
    (down to half their protection when nearly gone).
  - Slope: going uphill slows a unit in proportion to how steep the next metre is, up to 20% for infantry and 45% for
    vehicles. Crossing a slope at an angle is faster than driving straight up it. Downhill costs nothing.
  - Wind: each match has a wind that slowly shifts. Smoke screens drift with it (up to 1.2 m/s), so a screen laid
    upwind covers an advance and one laid downwind blows away from it. Cloud shade, particle smoke and rain follow
    the same wind.
  - Dust: a vehicle moving over dry ground trails dust and is spotted from 30% further away. No dust in the wet or
    in mud.
  - Fire: heavy explosions (artillery, bombs, rockets, satchels) can set hedges, houses and dry grass alight. Fire
    spreads to neighbouring cells, much faster downwind. A hedge burns for 14 s and is gone, a house burns for 25 s
    and ends as rubble, grass burns for 5 s and does not burn twice. Infantry in a burning cell (or a burning house)
    lose 8 hp a second and get pinned; an idle squad steps out by itself. Burning hedges and houses throw up a smoke
    cloud that blocks sight. Units route around fire.
  - Rain: showers come and go (the first no sooner than 3 minutes in, 1.5 to 3 minutes long, 4 to 8 minutes apart).
    Rain cuts sight by 20%, thins smoke faster, puts fires out four times faster and stops them spreading. The ground
    soaks over 90 s and dries over 4 minutes: wet ground slows vehicles off the road by up to 20% (40% on ground
    below level 0), triples traffic wear, and slows fords by up to another 30%. Roads are unaffected, so they matter
    most in the wet. A line under the scores says when it is raining or the ground is wet.
  - Look: worn ground shows as mud creeping into the grass, broken roads as shelled earth, burnt ground as black
    earth, deep mud and fords darker than shallow ones. Fires use the existing flame, ember and smoke effects and
    leave a scorch mark; rain is thin streaks on the wind with a dimmer sun and heavier cloud shade (streaks are off
    on Graphics Low, like snow). All of it uses the existing painted textures and models; nothing was replaced.
  - Computer players get all of it through the game rules; their vehicles weigh wear, mud, roads and fire when they
    pick a route.
  - Balance: Conquest, 120 three-way AI matches per map, wins per spawn. Three Crossroads 42/33/25% (30/34/36% before,
    44/33/23% the round before that: within the noise of this script). Crossroads Village 51/49%. Hill 112 30/27/13/30%
    (27/27/15/32% before). River Towns 30/43/27% over 240 matches (43/29/28% before): the favoured spawn moved from
    the top one to the second one, most likely because its fords drew shallower depths. Spawns are shuffled per
    match, so no player is favoured, but the map is no fairer than it was.
  - In an average 9-minute AI match on Three Crossroads: about 65 of 360 road cells shelled into craters, 130 fires
    started, 170 cells burnt, 15 hedge cells lost, and only a handful of cells churned toward mud (standard armies
    have few vehicles; River Towns, with its bridge approaches, wore about 100 cells and made 5 new mud cells).
  - Smoke clouds now carry an id in snapshots, so a drifting cloud is the same cloud to the client.
  - Performance: a wear or scorch change repaints only the ground tiles around it. The 3D pieces, scenery, relief and
    water are rebuilt only when a cell's type, height or damage stage changes.
  - Left for later: no lobby switch for weather (the rules take `weather: false`, nothing in the lobby sets it).
    Fire does not spread through the painted crop fields any differently from grass. No rain sound. Wet ground is
    not drawn darker. Houses do not show damage stages. Depth is random per cell, which can favour a spawn on a
    symmetric map (see River Towns above).
- Terrain: roads, mud, buildable bridges and mines.
  - Roads: vehicles drive 35% faster on a road or a bridge and plan their routes along roads. Infantry are unaffected.
    A trench, wire or tank traps can be built across a road, which cuts it.
  - Mud: vehicles move at half speed in mud and route around it when dry ground is close. Infantry are unaffected.
  - Bridges can be built: Shift+K (or the Bridge button with a builder squad selected), click on a river and aim along
    the crossing. 80 MP, up to 5 river cells, built from the bank one cell every 3 s (engineers twice as fast). It is
    an ordinary bridge afterwards: vehicles cross it and explosives drop it.
  - Mines: Shift+J (or the Minefield button). 40 MP for 4 mines in a line. Only your team sees them. A mine goes off
    under the first enemy squad or vehicle that steps on it (45 damage to infantry, 220 to vehicles, 3 m blast) and
    leaves a crater. Your own side walks over them safely. Any explosion that damages terrain (artillery, bombs,
    grenades, satchels) clears the mines it reaches.
  - Maps: Three Crossroads, Crossroads Village, River Towns and Ardennes Crossing now have roads from each HQ to its
    nearest points and between neighbouring points; River Towns and Ardennes Crossing have mud at the ford approaches.
    The map editor has Road, Mud and Mine brushes. The other maps are unchanged.
  - Balance: Conquest, 120 three-way AI matches per map, wins per spawn. Three Crossroads 44/33/23% with roads
    (44/29/27% without, same script). River Towns 39/30/31% (43/28/29% without). No measurable change. The top spawn
    winning about 4 in 10 is there with and without roads.
  - Craters from shelling were already in the game (shells, bombs and rockets turn open ground into crater cover).
    There are no woods in any branch: the trees on the board are scenery only.
  - Computer players use both. The squad holding a captured point lays one minefield across the approach from the
    nearest enemy HQ, 2 m outside the point, before it entrenches, and lays it again when fewer than 2 of its mines
    are left. When a bridge
    that was on the map gets blown, the nearest free builder squad walks to the bank and puts it back (not while
    enemies are within 35 m of the gap). Both keep 150 MP in reserve.
  - Balance with the AI doing this: Three Crossroads 30/34/36% per spawn over 120 matches (44/33/23% before), River
    Towns 43/29/28% over 360 (39/30/31% before, 120 matches). Match length unchanged at about 9 minutes.
  - Bug fixed along the way: a squad ordered to bridge a river from further than 9 m away stood still instead of
    walking to the bank. It now walks to its own bank first.
  - Left for later: computer players only rebuild bridges the map started with, they never bridge a new crossing.
    Nothing detects mines short of shelling the ground. Shells do not crater roads or mud. Mines are drawn as a
    plain dark disc.
- Fixed entrenchment orders leaking unseen terrain or buildings: every segment needs sight when placed and when
  it starts. Refused orders preserve the digging, full queues create no abandoned plans, and follow-up orders wait
  for every squad's paid segment to finish. A single fortification (trench, wire, tank traps, nest) now also needs its
  cells in sight: before, a valid one could be ordered into fog while an invalid one answered "not visible", which told
  the player whether hidden ground was buildable.
- Fixed Take cover letting squads leave trenches, Hold fire being ignored by aircraft and anti-air weapons, and
  crowded units skipping required terrain corners. Full shelling queues now report a refusal, and Shift-queued
  grenades, satchels and barrages can wait for cooldowns and munitions in the browser as they do on the server.
- Fixed Horde starting as Conquest after a map edit removes defender spawns. Very large waves now buy at most
  32 reserve units per tick and store at most 240, keeping the normal wave budgets and unit weights. The remaining
  count is an upper estimate while purchases are unfinished; the final three only appear when all purchases finish.

- Merging unit control with autocast: a squad on Hold fire no longer throws grenades, suppresses or barrages on its
  own (smoke, the AP round and Ura! still go off, and a satchel still needs an attack order). The autocast flag moved
  to snapshot bit 16384, because bit 1024 now marks a squad on a mass entrenchment for everyone.
- Mass entrenchment, follow-up: help, ghost and queueing.
  - The plan stays on the ground: every segment still to be dug shows as faint squares (trench green, wire brass) for
    you and your allies, and shrinks as squads take segments. Enemies do not see it.
  - Send more squads to help: select builder squads and right-click the planned pattern. They join it and share the
    remaining segments. Allies can help on your pattern too; each player pays for the segments their own squads dig.
  - Shift-queue works for more orders. Hold Shift on the second click of a pattern to queue the entrenchment behind
    the squads' current orders (the ghost appears at once). Shift+click the Take cover button, and Shift on the click
    of a grenade, satchel charge or rocket barrage, queue those; shelling a house with Shift held now queues as well
    (it used to replace the orders). A queued ability is checked for cooldown and munitions when its turn comes.
  - Orders queued behind an entrenchment (a move, say) now wait until the pattern is finished. Before, a Shift-queued
    move took the squad off the pattern.
  - A pattern is dropped, ghost included, when it is finished or when nobody is working on it or queued to.
  - Retreat and Stop never queue: they always act at once and clear the queue, as before.
  - Not seen running: the ghost and the right-click to join are tested in the rules and the snapshot, but not looked at
    in a browser.

- New mode: Horde. You and your friends (up to five, AI teammates allowed) share one HQ and defend one command bunker
  against waves that keep growing. Nobody wins: the result is the wave the bunker fell on.
  - Pick Horde in the lobby. It plays on the 11 maps built for Assault (the others are greyed out). Everyone is on one
    team and starts at the same HQ behind one trench line; the horde comes from the attackers' spawns.
  - The first wave comes after 45 seconds. The next one comes 45 seconds after the last is dead, and the host can send
    it early with "Send next wave" at the top of the screen, which also shows the wave number and how many are left.
    When 3 or fewer are left they show through the fog.
  - Each wave is worth 25% more than the last (wave 1: 300 MP of units per defender) and brings new units: MGs and
    mortars from wave 3, armored cars, light tanks and AT guns from 5, medium tanks and rockets from 8, Tigers from
    12. From wave 6 the horde calls artillery and air strikes, from wave 10 it flies planes, so bring Flak. At most
    60 horde units per defender are on the map at once; the rest of a big wave walks on as you kill them.
  - The horde never retreats, never reinforces and ignores the points, which are yours to hold for manpower. You get
    the Assault defender's income (250 MP, +3.5/s) and the Kill Bounty for every horde unit.
  - The bunker has 3000 hp per defender and gets 10% back for every wave you clear.
  - The lobby shows the best run for the map, team size and army size you have picked, and the result says how far
    you got and whether it is a new record. Army size scales the horde too; Endless is not offered in Horde.
  - Balance (AI defenders, Standard army, 3 runs per map and team size, 68 runs over all 11 maps): runs end on waves
    8 to 15, median 12, after 22 to 36 minutes, about the same with 1, 3 or 5 defenders. Massive is harder (waves 4
    and 8 in two runs) and is not tuned. `node tools/horde.mjs <map> <defenders> <runs>` repeats the runs.
- Fixed: a group of units that reached the same waypoint at the same moment could push each other off it forever and
  stand still with their orders intact (seen with horde waves, which start in a clump; it could happen in any mode).
  A unit that makes no progress for a second now walks on to its next waypoint.
- Found and left for later: in Horde, AI teammates do not go out to hunt a mortar that shells the bunker from range,
  and horde vehicles with no way in (a closed ring of tank traps) wait outside until you kill them.

- Unit control, part 4: the computer uses it, and a rebalance.
  - Computer players dig in properly: the squad holding a captured point entrenches an arc of trench toward the
    nearest enemy HQ (a strongpoint with wire when it has 600 MP or more), instead of one short trench line. Soviet
    AIs dig too now (only rifle squads did before, and they field conscripts). A holding squad that is standing in the
    open walks into the trench or other cover.
  - Computer players switch auto-retreat on for their whole army, so a broken squad runs the moment it breaks instead
    of at the AI's next decision two seconds later.
  - The AI does not use Hold fire or Hold position: it has no ambush plan, and on its units they would only mean
    guns that do not shoot. Auto-cover, corner cover, hull turning and spread fire apply to it as to everyone.
  - Rebalance: Ranger Squad 185 -> 200 MP, Tiger 620 -> 560 MP (Classic Tiger price unchanged). Cover that infantry
    find by themselves helped the infantry-heavy USA and did nothing for Germany's Tiger: after parts 1 to 4 the
    factions stood at USA/GER/USSR 41/29/30% over 1400 three-way AI Conquest matches (700 on the default map, 700 on
    River Towns; 38/33/29% before any of this, 1000 matches). With the two prices changed: 36/35/29% over 1400 matches
    (default 38/34/27%, River Towns 34/35/31%).
  - Other modes after part 4, default map, measured before the two price changes: Classic 40/33/27% (90 matches,
    32/38/30% before, both inside the noise for 90); Annihilation 32/37/32% (60 matches), every match finished.
  - Server cost per tick in a three-AI Conquest match went from about 65 to 75 microseconds.
  - Not done: the planned pattern is not drawn after you order it; entrench orders cannot be shift-queued; the on-map
    preview of a pattern was not seen running (the test browser does not render frames in the background), only the
    buttons, hotkeys and orders were.

- Unit control, part 3: stances, auto-retreat, smarter vehicles and fire.
  - Three switches per unit in Orders, all off for new units, so nothing changes until you use them. A switch that is
    on is ringed in brass and tagged in the selection list; click or press the key again to turn it off.
    - Hold fire (Shift+F): the unit shoots only when you give it an attack order. A sniper stays hidden, an AT gun
      waits for the tank you pick.
    - Hold position (Shift+G): the unit never moves on its own, not even to cover.
    - Auto-retreat (Shift+X): the unit runs for home by itself when it falls below 35% strength (a squad of five down
      to its last two men), unless it is already at base. It reinforces there as usual.
    These are independent switches rather than one three-way stance, so a gun can hold fire and hold position at once.
    Enemies who see your unit do not see its switches.
  - Vehicles standing still turn their hull toward the gun that last shot at them (tank guns, AT guns: anything that
    hurts armor), or toward such a gun they are fighting, at about 70 degrees a second. Rifles and planes do not make
    them turn. A flanked tank no longer sits with its rear to the AT gun.
  - Spread fire: units choosing a target count what their own side already has aimed at it. A squad that is already
    getting more than it can survive in the next volley looks further away in proportion, so a big group moves on to
    the next enemy instead of emptying every gun into one dying squad. Attack orders are not affected.
  - Balance (Conquest, default map, 300 three-way AI matches): USA/GER/USSR 42/33/26% (39/33/28% before parts 1 to 3),
    average match 559 s (552 s). The AI does not use the switches yet.
  - Shift+R is deliberately left unbound (an existing rule: R with a modifier must not retreat by accident), so
    auto-retreat is on Shift+X.

- House corners are cover: a squad standing beside a house (or a Classic building), corner cells included, takes half
  the fire from any shooter on the house's side, within 60 degrees of the wall. It still sees and shoots past the
  corner, which a squad hidden behind the house cannot. Fire from the open side is not reduced. The selection list
  shows "By cover" for a squad at a corner. Squads looking for cover (on their own or on Take cover) now prefer a
  corner they can fire from over a spot fully behind the wall. Before this, a house only protected squads inside it.

- Unit control, part 2: mass entrenchment.
  - Six new orders next to the single fortifications, for every selected builder squad at once (rifles, conscripts,
    engineers): Trench line (Shift+T), Zigzag trench, Double line, Arc, Ring and Strongpoint. Click where it starts,
    then where it ends: a line runs between the two clicks; an arc, a ring and a strongpoint are centered on the first
    click and face or reach to the second. Green squares show every cell that will be dug before you commit, and the
    hint says how many segments it is and what it costs.
  - The squads share the work: each takes the nearest of the next segments, the middle of the pattern first, and goes
    on to the next one when it is done. A segment is four trench cells for 30 MP, as before, and is paid when a squad
    starts it. If you are short of manpower the squads dig what you can pay for and wait ("Waiting for MP to dig") for
    the rest. Cells that cannot be dug (already a trench, a road) are not charged.
  - The patterns: a zigzag puts more trench on the same frontage (no special rule against shells: a trench cell is a
    trench cell); a double line adds a second row 6 m behind, on your squads' side; an arc is a third of a circle bowed
    toward the second click; a ring has a 6 to 24 m radius; a strongpoint is an 8 m trench square with two runs of
    barbed wire on the side it faces (170 MP).
  - Any other order (move, attack, stop, retreat, a single fortification) takes a squad off the pattern for good; the
    others carry on.
  - Fixed along the way: a squad standing in cover blocked friends walking through it (part 1 stopped it being pushed
    out, which also made it a wall). Friends now walk past it.
  - Classic balance for part 1 (90 three-way AI matches, default map): USA/GER/USSR 37/38/26% (32/38/30% before).
  - Left for later: the planned pattern is only drawn while you place it, not afterwards, and an entrench order cannot
    be shift-queued. The computer does not use patterns yet (part 4).

- Unit control, part 1: cover.
  - Infantry look after themselves: a squad with no orders that gets shot at walks to the nearest better cover within
    10 m (a trench first, then a cover cell such as a wall, rubble, a hedge or a shell hole, then a spot behind
    something solid on the shooter's side) and stays there. Squads you gave an order keep following it. Crewed weapons
    (MG, AT gun, mortar, flak) never move on their own, so a gun line stays where you set it up.
  - New order: Take cover (Shift+C, or the button in Orders). Every selected infantry squad, crewed weapons included,
    drops what it is doing and runs to the best cover within 10 m, judged against the nearest enemy you can see. Each
    squad takes its own cell. Squads already in a trench or a house stay; "No cover within reach" if there is none.
  - Squads standing in cover are no longer shoved out of it by other units crowding past.
  - Computer players get the automatic part too (it is in the game rules, not the AI).
  - Balance: Conquest, default map, 300 three-way AI matches with rotated factions: USA/GER/USSR won 41/36/23% (39/33/28% before this change on the same script), average match 561 s (552 s). USSR lost about 5 points, at the edge of the noise for 300 matches; left alone until the rebalance in the last part. The Classic run is recorded with part 2.
- New army size in the lobby: Endless. Same unit limit as Massive (5x) but 20x income and starting MP instead of 6x,
  so losses are replaced almost at once and the battle never thins out. Not balance-tested with AI runs; the unit
  limit is unchanged, so server load should match Massive.
- The scenery looks like real places instead of toys, everything at real size (checked against a Company of Heroes 3
  style reference). Trees are real trees: broadleaf oaks about 12.5 m tall with 9 to 10 m crowns, spruces about 14 m,
  Lombardy poplars about 17 m, with bark trunks and limbs and crowns of photographed leaf clusters, each tree its own
  height, girth, heading and shade of green. Bushes and the bocage hedgerows are dense, ragged leaf masses instead of
  green balls, meadow grass grows in tufts across open ground, and about half the ploughed fields stand in ripe wheat.
  Rocks are weathered field stones, fences weathered post-and-rail.
- Houses: two in five farmhouses and every church are fieldstone, the rest limewashed render with stone quoins up the
  corners; flat Normandy clay-tile roofs replace the orange Spanish tiles; windows have depth (a shadowed reveal, a frame
  proud of the wall, a sill, sky in the glass, plank shutters); doors get stone jambs; chimneys get clay pots. Damage
  states and footprints are unchanged.
- The HQ is a real camp: a canvas wall tent with sagging roof, guy lines, an open door and a stovepipe, crates, a drum,
  jerricans and a field table with a map, a 15 m guyed flagpole, and a ring of real-size sandbags (about 0.8 m long, three
  courses) instead of the green box and oversized bags. The barracks, motor pool, depot, command bunker and Classic HQ
  show canvas, timber, concrete and corrugated-sheet grain.
- New textures, generated with gpt-image-2 and made seamless: leaf, spruce and grass sprites (one atlas), bark, plaster,
  roof tiles, canvas and burlap.
- Cost, measured with renderer.info in the same views (before, after): Three Crossroads HQ view 119 draw calls and 195k
  triangles, 128 and 245k; village 92 and 192k, 93 and 239k; zoomed out 154 and 202k, 158 and 273k. Bocage HQ view
  121 and 275k, 132 and 346k; zoomed out 190 and 280k, 194 and 367k. Graphics Low hides the grass, keeps half the
  trees and turns off tree and bush shadows (bocage HQ view 98 calls, 193k triangles). Frame rate could only be
  measured in headless Chrome on a software renderer (SwiftShader, 0.6 to 0.9 fps before and after on a heavily loaded
  machine), so the cost on real laptop graphics is not yet checked.
- Trees, bushes and hedgerow leaves darken under the fog of war as the ground does (before, trees ignored the fog and
  hedges turned grey).
- Left for later: real laptop fps with 250+ units; wind sway in the crowns; the haystack texture (burlap stands in for
  straw); a second broadleaf shape to break up repeats in big woods.

- Autocast, Warcraft 3 style: right-click an ability button to let the selected units of that type use it on their
  own. Rifles throw grenades at infantry in cover, trenches or houses within 18 m, MGs fire Suppressive Fire at squads
  advancing on them, AT guns load an AP round against vehicles, tanks pop smoke when badly hurt under anti-tank fire,
  rocket trucks and mortars barrage crowds or dug-in enemies, Rangers plant a satchel on a house or bunker they were
  told to attack once they are within 20 m of it (they stop to shoot at 26 m, so this is for close fights), and
  Conscripts shout Ura! when pinned on the move. Units only act on what their side can see, pay
  the same cooldowns and Munitions as a click, never override an ability you ordered, and never fire while retreating.
  It starts on where abilities are free and off in Classic, where they cost Munitions. A button with autocast on has a
  dashed brass border and a small A under its hotkey (clear of the Munitions cost in Classic), and the game remembers your choice per
  unit type for new units.
  Balance (300 paired AI-vs-AI Conquest matches, on vs off): 2nd place VP vs winner 0.57 both, lead changes 2.24 vs
  2.23, length 9.1 vs 9.0 min, about 98 vs 88 abilities used per match; faction wins 35/36/29% vs 39/31/30% (probably
  noise). The Tiger rear-armor test now turns autocast off so the AT gun's AP round does not skew it.
  Checked live: an MG fired Suppressive Fire by itself, a rifle squad threw a grenade by itself at enemy squads
  holding a capture point, and an MG turned off stayed off in the next match. Seen live in review: a rocket truck barraged
  by itself and a tank popped smoke at 90 hp, enemy units never show the flag, and the switch, its memory and the Classic
  default work at 1920x1080 and 1366x768. Not seen live: a rifle squad turned off holding its grenade, and the AP round,
  satchel and Ura!; all of those, plus Suppressive Fire, smoke, barrage (friends in the blast, units out of sight) and a
  walked-away squad, are now covered by tests.
- Recruit by letter: outside Classic, press Tab (or the key under Esc) and the Command Card header reads
  "Recruiting". Each card gets a letter (Q W E R T, A S D F G, Z X C V B in reading order), the letter buys that unit
  like a click, and Shift+letter buys five, or as many as your MP and army limit allow. Tab, Esc or a right-click ends
  it. While it is on, a letter that has a card buys, so WASD, Q/E, Stop (X), Retreat (R), Ability (F), Attack-move (G),
  Trench (T) and the Z C V support calls pause (the arrows still pan) and their badges hide; B has no card in Conquest
  and still aims smoke. In Classic, a selected HQ or production building shows the same letters on its train cards
  without any mode and Shift+letter queues five at that building; an HQ uses only Q and W, so A S D E still pan and
  rotate. Classic Tab explains this. Refusals show their reason as a click would ("Needs 220 MP", "Army at its limit
  (12/12)").
  - Fixed along the way: a Classic card on a selected building now greys out when that building's queue is full, even
    if another building still has room (the server refuses a full chosen building).
  - Left for later: with a laggy server, a Shift+letter right after a purchase can count MP the server already spent,
    and the extra buys come back refused with their reason.

- Edge scrolling works like Warcraft III. The band at the screen edge is wider (32 px at 1920x1080, 24 to 48 px by
  window size; it was 8 px), scrolling gets faster the closer you push to the edge, starts with a short ease-in and
  goes diagonal in corners, and the cursor turns into an arrow pointing the way. Pushing the mouse out of the window
  keeps scrolling until it comes back (before, leaving the window stopped it, so in a normal browser window edge
  scrolling barely worked). Switching windows or tabs, or opening the menu, stops it at once. It stays off while you
  box-select, rotate with the middle button or watch the opening glide, and pushing an edge ends Follow. Checked at
  1920x1080 at the default zoom: 66 m/s at an edge, 93 m/s in a corner, the same as the pan keys.
- Capture mouse: a new button next to Fullscreen keeps the cursor inside the game (the game draws its own cursor), so
  edge scrolling works in a window too. The menu setting chooses In fullscreen (the default), Always or Off, and Esc
  lets go. Selecting, box select, double-click, orders, the minimap, the recruit bar, the menu, the volume slider and
  strike aiming all work while it is on.
- Fixed: the first click or box drag of a match could select nothing. The opening camera glide swallowed the first
  mouse press to end itself; now a left press ends the glide and selects as well, and a right press still only ends
  it (so it cannot give an order). A Node test covers it. Left for later: the first key pressed during the glide is
  still swallowed.
- Not checked: Alt+click pings while the mouse is captured (the test browser cannot hold Alt during a click), and
  moving a captured mouse in fullscreen (headless Chrome answers each move there with a move back).

- Interface cleanup (checked with the Impeccable detector, now clean): alerts, connection banners and the match strip
  under the scores lose the colored stripe down their left side. An alert's kind now shows in its text color (light red
  for trouble, brass for a point won), a lost connection gets a red border all round, and being out of the match is a
  dark red band. The HQ sign leads with the owner's HQ map symbol instead of a color bar. The lobby loses its glowing
  backdrop and the paper cards their gradient sheen, and the Victory or Defeat stamp settles without bouncing.
- Model toolkit (no visible change yet):
  - New `client/models/geom.js` for building more detailed miniatures: rounded and chamfered boxes, lofted hulls,
    lathed shapes (barrels with muzzle brakes, US, German and Soviet helmets, wheels, radial engines, bombs,
    spinners), extruded outlines, spoked and disc wheels, road wheel sets, tank tracks with grousers and horns,
    bent tubes, mirroring, a vertex-colored merge, painted markings (US star, Balkenkreuz, roundel) and baked shading
    that darkens toward the ground. Every closed shape is checked in `node test.js` for outward faces, no gaps and
    the right volume.
  - Sizes to budget with: a full track with five road wheels, sprocket and idler is about 9,400 vertices, a wheel
    about 790, a radial engine about 2,100, a helmet a few hundred.
  - Model building: a part painted with the shared material now multiplies its paint color by the shape's own vertex
    colors when the shape has them, so wheels, tracks and markings keep their tire, link and insignia colors (paint
    them white to show the colors as built). Existing models have no vertex colors of their own and look the same.
- Model viewer (developer tool, no gameplay change):
  - `/client/viewer.html?type=medium&fac=0` builds one unit through the game's own model code (the same calls as
    `makeUnit` in main.js, faction looks and player colors included) and shows it under the game's warm sun and
    shadows from the front, left side, top, three-quarter front and back, plus the in-game camera (42° FOV, pitch
    0.95, distance 40) at true 1920x1080 scale. A header gives the unit name and its draw calls and triangles in the
    game view, shadow pass included; squads add a row with one soldier close up and the far soldier model's counts.
    Options: `&color=`, `&posture=0..3`, `&bg=`, `&aim=`, `&far=1`, `&grid=0`. `&all=1` lines up every type one
    faction can field, each labeled with its own draw calls and triangles (22 types, about 57 to 62 calls in all).
  - `tools/model-shots.sh <port> <outdir> [types] [facs]` screenshots the viewer with agent-browser into
    `<outdir>/<type>-<fac>.png`, and puts each next to `/tmp/ww2-models/refs/<type>-<fac>.png` when that reference
    exists. It starts no server.
  - Found: at the distance-40 zoom a plane flying at 20 m is about 15 m from the camera, so it draws about 2.6 times
    larger than ground units and overflows a 640 px wide view. Left as is.
- Miniatures (round 6):
  - Soldiers stand on small dark-green painted bases like tabletop miniatures (the base stays flat when they crouch,
    lie down or fall back), wear warmer faction uniforms (olive drab, field grey, khaki) and have a lighter crown on
    their helmets. The base is part of each soldier's single mesh, so draw calls do not grow.
  - Hills read more clearly from above: each height level makes the ground a little lighter and drier (about 10 to
    13% per level, up to three levels), and a thin light rim traces hill crests.
  - Left for later: the bases were not confirmed close up in a screenshot. The early combat test ("rifle took damage"
    within 5 s of an MG opening fire) failed once in two runs; it depends on random hits and was not changed here.
- Polish (round 5):
  - Your HQ is framed between the top panels and the recruit bar at match start, on H and after the opening glide,
    and fully zoomed out the whole board fits on screen, centered with a small table margin. HQ rings and sandbags no
    longer hang past the board edge, and enemy strike warnings are a red pencil outline with light hatching instead
    of a magenta smear.
  - Hills cast shadows on High graphics and have darker, softer shading at the foot of slopes and cliffs, so terraces
    read from above. The ground is warmer (khaki and ochre instead of olive green), grass and dirt blend with soft,
    noisy edges instead of square steps, and house walls are clean painted plaster without rust-colored blotches.
  - Support planes stay inside the camera view (recon and bomber flights no longer slide off the top of the screen),
    bombers visibly drop their bombs, the few birds fly low enough to be seen on High, and cloud shadows also cross
    the table.
  - Clearer text: a full order queue says "This unit already has 8 queued orders" (production keeps the training
    queue message), the second step of a fort dig says "click to place", cooldown numbers match between messages and
    buttons, the Assault scoreboard label stays on one line, the top panels are solid so map labels no longer show
    through, the map editor's Preview menu and tool hint are fixed, and the game has a tab icon.
  - Left for later: the dive bomber's bomb still lands before the plane reaches its target; hill tops are only a
    little lighter than the ground around them; the relief shadow's GPU cost was not measured on real laptops; and
    one match-end server test ("a new match without the old result") failed once in six runs while the machine was
    under heavy load, not yet explained.
- Fixed a flaky server test: the Massive snapshot-cache check sent Start before the map switch it had just asked
  for had finished loading, so on a busy machine Start was checked against the old map's seats and dropped. The test
  now waits for the lobby to show the new map. Left for later: the same can happen to a host who clicks Start within
  a moment of changing the map (messages from one player are not handled strictly in order while a map loads).
- Terrain relief, miniature structures and map moods (round 4):
  - Terrain reads as a sculpted painted model. Cliffs are warm stratified rock faces with a pale lip and a soil foot,
    1-level slopes are eased ramps painted with dry earth and a darker foot, height tints the ground (lower is greener
    and damper, higher is drier), roads sink slightly, and river and canal beds are carved below the water line with
    sloping banks. Cell centres keep their exact simulation heights, so units still stand on the visible ground. On
    the round 4 branch, terrain triangles on Hill 112 went from 17.6k to 37k, Kasserine Pass dropped from 64k to 29k
    and flat maps shrank 10x or more. The fog of war overlay follows craters and darkens the rock faces, a crater
    rebuild takes about 4 ms, and Graphics Low uses a simpler shader and a coarser mesh.
  - Map structures are miniature models. Houses have roof overhangs, ridge tiles, chimneys and inset windows and
    doors, and each map gets a church with a tower and some barns. Wrecked houses are broken walls on rubble, stone
    walls have capstones, hedgerows are bocage earth banks with shrubs, and bridges have railings and piers. Sandbags
    are rounded and stacked, tank traps are steel hedgehogs, wire is concertina on posts, trenches have revetments
    and duckboards, and MG nests are easy to read. The HQ, Barracks, Motor Pool, Supply Depot and Command Bunker each
    have their own shape. Map structures darken under fog of war, and footprints and cover are unchanged. On the round
    4 branch the default map's whole-map view went from 463 to 200 draw calls and from 47.3k to 105.1k triangles.
  - Each map has a mood. Most keep the warm afternoon. Pegasus Bridge and The Polder get a low dawn sun with mist over
    the river, Bocage and Monte Cassino are overcast with softer shadows, the Ardennes gets falling snow, and
    Kasserine Pass gets blowing dust. Faint cloud shadows drift across the board. The planning table now has a folded
    field map, a ruler, a pencil, an "HQ 1944" coffee mug, an open brass compass, map pins with paper flags, and a
    desk lamp casting a warm pool of light at one corner. On High, a few birds circle above the board. Graphics Low
    turns off the clouds, weather and birds. No gameplay changes.
  - Merged with rounds 1 to 3: the relief mesh replaces the round 3 smoothed height field. Units, scenery props, the
    camera, the minimap shading, the HQ and the water all read the same ground height. Props refresh after the relief
    reshapes a crater and still keep off every structure cell. The water surface takes the relief's height so it sits
    in the carved beds, and bridges keep their deck height. The fog overlay shares the relief's live geometry, so it
    follows craters too. Structures darken in the fog through the `setFogMap` hook in the round 1 surfaces module,
    which main.js calls once the fog texture exists. The round 3 one-draw unit models stay, and the five base
    buildings and the HQ sandbag ring now come from the round 4 models.
  - Integration fixes: with the relief ground, every match crashed at start because the atmosphere read the size of
    the old flat ground plane, and the board edge, table shadow and contact shadow disappeared. Both now read the
    relief mesh (its bounds, and height as the up axis), and the cut-earth board edge follows the relief height along
    all four sides, including where a cliff meets the edge.
  - Left for later:
    - The birds fly about 30 m above the board, so they only show when they pass under the view. Cloud shadows
      darken only the ground and table, not units, structures or trees. Snow maps have falling snow but no snow lying
      on the ground. The desk lamp's arm and shade are mostly off-screen, so players mainly see its shadow and pool.
    - Cloud shadows reuse the full ground mesh (about 12.8k triangles on the default map, more on big maps).
    - Triangle count about doubled with the new structures (about 212k on Monte Cassino XL at the whole-map view).
      Low drops duckboards, half the shrubs and small-part shadows but keeps the house detail. Instanced meshes have
      bounds that cover the whole map, so close-up views do not cull triangles (a village view still draws about 99k).
      The fog overlay draws the terrain a second time.
    - The base-building models use the shared unit material and do not darken in the fog the way terrain pieces do
      (the server already hides enemy units outside vision).
    - The church roof is the terracotta texture with a slate tint. Bridge railings are thin and hard to see from the
      default camera. Destruction of the new structures in a long live match was not watched end to end.
    - Cliffs are a heightfield with no overhangs, and painted contour lines still draw a thin dark line where a cliff
      meets the plateau.
    - Capture point, HQ and structure anchors only refresh when the world is rebuilt, so a crater under an existing
      flag base does not re-seat it.
    - Rendering was checked only with the headless browser's software renderer, so there are no real GPU timings.

- Rooms, controls, match endings and performance (round 3):
  - Keys and selection: Shift+Y, Shift+U, Shift+I and Shift+O now place sandbags, wire, tank traps and an MG nest (T
    still digs a trench), and the fort buttons show the Shift key. Shift+click adds or removes a squad. Double-click
    selects every squad of that type on screen, and Ctrl+double-click selects them on the whole map. Ctrl+A selects
    the army. The selection list groups squads by type with a count and total health. Period cycles idle squads, Comma
    cycles idle Engineers, and an Idle chip does the same. Control groups forget dead units, reset each match, add
    units with Shift+number, and center the camera on a double tap.
  - Camera and pings: the mouse wheel zooms toward the cursor, middle-drag rotates the view, and Shift+Space follows
    the selected unit. The menu has Edge scroll on/off and Pan speed. A match opens with a 2.5 s glide down to your
    HQ, which any key or click skips. Alt+click on the map or minimap pings your teammates with a chalk ring for 4 s
    and an alert line, and Space jumps to it (3 pings per 5 s). Picking the ground under the cursor is faster and
    exact on hills.
  - Rooms: if a player drops mid-match, the game waits up to 30 s for them (once per player per match), and the host
    can pause and resume. The host role passes to the next connected player. A refresh keeps your seat, camera,
    selection and groups, and &seat=2 gives a second player a seat on the same computer. The host can remove an
    offline player in the lobby or hand their army to an AI. An invite opened mid-match joins by itself when the match
    ends, and the reconnect banner counts down 1, 2, 4, then 8 s. The Large and Massive army labels now show the real
    numbers.
  - Command feedback: orders that cannot happen now say why. Recruit cards, support calls, forts, Classic builds and
    abilities grey out with a reason (Needs 120 MP, Cooldown 23 s, Army at its limit) and can still be clicked to show
    it. An order the server refuses plays an error sound and shows one plain sentence for 2 s, for example 'Not enough
    manpower'. A blocked or uneven footprint shows red and placement stays armed.
  - Order queue and rally: hold Shift while right-clicking (or on the minimap) to chain up to 8 orders. Moves,
    attack-moves, attacks, houses, trenches and Engineer builds run in turn and show as dashed pencil lines. A ninth
    order is refused with the error sound. Outside Classic, the Rally button or Shift+H sets a rally point that newly
    bought ground troops walk to. Minimap right-click now attacks, garrisons and assists like a click in the world.
  - Match endings: when a match is decided, the action slows to half speed, the camera glides to where it was won or
    lost, and a Victory, Defeat or Draw stamp says why. The battle stays on screen for 6 s with orders closed and the
    fog lifted. The lobby then shows a match report: a chart of the victory point race (or points held), a legend in
    words, and each player's kills, losses, builds, captures, manpower spent, support calls and planes downed.
  - Battlefield readability: contested points pulse red and brass, and only when your team can see both sides on the
    point. A captured point flips with a short flourish. Buildings smoke below two thirds health and burn below one
    third. A strip under the scores shows the time to victory at the current rate, the catch-up bonus, the last minute
    of an Assault and Sudden Death. Eliminated players see an 'out' banner, Assault and Annihilation totals no longer
    shrink as structures fall, and the Classic rules list the Airfield.
  - Unit rendering: big battles draw far fewer objects with the same look. Each soldier, hull, turret and building is
    one draw, soldiers beyond 110 m (80 m on Low) use a simple model, scenery is merged, and corpses share one pooled
    mesh (200 at most). Measured on the stream branch, draw calls in a Massive Classic 3v3 at 70 s fell 78 to 86% (885
    to about 150 in the own-army view). Suppressed squads crouch at 50 and go prone at 90, retreating squads lean
    forward, '?perf' shows an fps and draw-call box, and Low renders at 0.75 resolution.
  - Server performance: six-player Massive matches run smoother. On the stream branch, benchmark p95 tick time fell
    from 26.1 ms to 7.8 ms in Classic and from 8.2 ms to 3.4 ms in Conquest, with identical match results. A room that
    still falls behind sends updates every 3 or 4 ticks instead of 2, and units still glide smoothly. The pause and
    the end hold also use the shared snapshot cache.
  - Merged with rounds 1 and 2: the planes and the Airfield keep their round 2 models (client/aircraft.js) while
    soldiers, vehicles, guns and structures use the new one-draw models, and Classic buildings keep the round 1 wood
    and sandbag textures. Explosions and battle sounds still come from the round 1 effects layer, with the one Volume
    slider (M still mutes). The round 2 fog, command and start-race fixes and the round 3 server speedups both stay,
    with one copy of each guard, and all server tests now run on one in-process server.
  - Left for later:
    - Rejoining a running Classic match (reload) draws the Conquest command tent and crates at every HQ. The server
      sends 'start' before the async lobby() message, so classicMode() is false when buildHQ runs. This is the same in
      base c21777f and master. See /tmp/ww2-shots/stage-r3/rejoin-high.png.
    - After a reload mid-match, cratered ground near the HQ shows as gray-blue blocks instead of the dark scorch seen
      in live play. The cause is not traced; the start message's cell levels and the rebuild path are unchanged from
      the base. See /tmp/ww2-shots/stage-r3/low-home.png.
    - An unsaved default name (SoldierNN) is re-rolled on every load, so a reload renames your seat and HQ label
      mid-match. This predates round 3.
    - The 'queueFull' sentence reads 'The training queue is full' but now also covers a full order queue.
    - The client blocks arming a fort when MP is short; only a Shift-queued dig skips that check, even though queued
      digs are paid when they start.
    - Outside Classic, a rally message that carries building ids is ignored.
    - The lobby result header uses r.teams[me] rather than r.you.
    - The away flag in tickRooms and the online list in timedRoomTick still use !!p.ws, while pauseTick and holdEnding
      use connected(p).
    - On a resume, startGame may replay match_start or restart the ambience.
    - From the streams: blast-area scans and server timer drift under sustained overload (sim-server-perf); greyed
      Barracks-only units on the Classic HQ card (command-feedback); no static controls list in the menu yet
      (keys-and-selection); saveMap may drop assaultTime and the per-spawn assault flag (plan).
    - Fallen soldiers are plain dark bodies again (the pooled corpses, one draw for up to 200) instead of the round 1
      soldier copies in helmet and colors; a pooled body in soldier shape and colors would bring that look back.
    - House roofs are not merged into one draw, since a roof uses two materials (plaster gable and tiles) and
      mergeMeshes keeps one.

- Scenery, water and planes (round 2):
  - Map symbols now cover every aviation unit (fighter, ground-attack plane, mobile flak, flak emplacement, airfield)
    and all eight support calls, and an unknown unit type shows an empty frame with a "?" instead of a blank one.
  - Open ground is dressed with painted scenery props: round trees, poplar rows, pines on high ground, bushes along
    hedges, rocks, fences, haystacks and crates beside houses. They are purely visual, keep clear of spawns, points,
    paths and resource nodes, stay put when terrain changes, and Low graphics shows half of them.
  - Rivers, fords and bridges get a flowing water surface: blue-green, darker in deep water, pebbled at fords, with
    foam at the banks and around bridge spans. Fog of war still darkens it, it rebuilds when a bridge collapses, and
    Low graphics freezes the animation.
  - Planes are now per-faction painted miniatures (P-51, P-47, B-25; Bf 109, Ju 87, He 111; Yak-9, Il-2, Pe-2) with
    spinning propellers, a ground shadow, banking in turns, damage smoke, dark flak bursts and a spiral-down
    shoot-down that ends in a fireball, and the Classic airfield gets a runway, arched hangar, control tower and
    windsock.
  - The new planes use the round 1 explosions and recorded sounds: a crash plays the plane-crash sound and a fire
    loop, a strafing run plays one gun burst, and the tracers that flak and fighters fire at planes still come from
    the effects layer, so each plane, burst and tracer is drawn once.
  - Left for later: support bombers no longer show bombs falling from the plane (the bomb blasts still land on
    time), and `client/fx.js` still carries its own plane pool and falling-plane code, now unused.
- Simulation fixes (round 2):
  - Air support: a spent Fighter Cover ring now leaves the map instead of staying forever. Ground squads ignore an
    attack order on a plane, one cover can no longer shoot down two strikes on the same tick, blowing a bridge no
    longer kills planes flying over it, and a plane overhead no longer counts as cover. Parked planes no longer spot,
    houses no longer block spotting from the air, new planes appear at the Airfield that trained them, and
    paratroopers take a population slot and no longer drop for an eliminated army.
  - Fog of war: shoot-downs, flak shooters and HQ collapses only reach teams that can see them, terrain updates and
    the start of a match no longer reveal unseen building footprints, and a reconnect keeps remembered terrain.
  - Server: commands with a bad player slot, unit, support or fortification name, or someone else's building are
    rejected, a bad army value no longer gives NaN MP, Massive selections are no longer capped at 50 units, and
    reconnects and map loads during the start or end of a match are handled. The AI no longer crashes when it holds
    an allied point with no opponent left.
  - Speed: a Massive six-army Classic match steps in 3 ms on average instead of 21 ms. Idle squads look for targets on
    a 0.5 s timer, vision and terrain updates skip work they threw away, and AI players get no snapshots.
  - Balance is unchanged within noise: Conquest wins 34/36/30% by faction over 300 AI matches (was 41/29/31%), and
    Classic 47/47/44 wins over 160 matches.
  - Left for later: the Tiger limit of 1 does not grow with army size; the server tests strip `import` lines from server.js with a
    regex; AI anti-tank buying against medium tanks is untested; an idle squad now notices a new enemy up to 0.5 s
    later; and AI thinking spikes in big armies were not profiled.

- Polish (review fixes for the HUD, world and effects slices):
  - Point and resource node income tags and the HQ sign keep the same size on screen at every zoom, so they stay
    readable when zoomed out and no longer cover the fight when zoomed in. They fade out up close, and a point's tag
    hides while that point is being captured. The HQ sign shows the name as typed, not in capitals.
  - The HQ reinforce zone is a faint chalk tint inside its ring instead of a blue patch that looked like a pond.
    Big pencil rings no longer draw a second line a meter inside the first.
  - Range rings show only for a small selection (up to two units, or up to four of one type), so a big selection no
    longer covers the screen in dashes.
  - The edge of the board is deeper and lighter, so its soil layers show on both the sunny and the shaded side, and it
    meets the table with a soft shadow instead of a jagged black line.
  - Fallen soldiers stay as soldiers (helmet and colors) and sink into the ground, instead of turning into brown
    capsules. Classic buildings use the wood, sandbag and earth textures of the rest of the world. Resource nodes are
    marked with a brass pencil square.
  - Command Card: a locked card keeps its "Needs a Barracks" note readable (dark ink with a red dot), and the cost of
    a unit you can't afford is a solid red chip. Disabled support buttons are less faded, so their costs can be read
    at the start of a Classic match.
  - In Classic the "click where to build" hint sits above the Build panel instead of on top of it.
  - Lobby: section headings are in sentence case, your own name and the host mark no longer get cut off, muted text
    is darker, and the Add AI, Copy link, Join and Start buttons have tooltips. The support and veteran tags are
    easier to read.
  - Alerts sit a little higher above the minimap so they no longer touch its frame.
  - Fixed: every dig or shell that changed the terrain left the old buildings' and roofs' GPU buffers behind, and
    Play again kept the whole previous match on the GPU. Both are freed now. The fog of war now follows craters and
    trenches. The minimap no longer raycasts the terrain on every redraw (it was costly while an alert was showing).
    A machine gun shooting at a plane no longer shows flak bursts or plays the flak sound.
  - Left for later: warmer ground, smoother contour lines, a north arrow and scale bar on the
    minimap, Graphics Low cutting shadow draw calls, patching only the dug part of the terrain instead of rebuilding
    it, trimming the blur pass's unused GPU memory, unit names on recruit cards at 1366 and 1600 px wide, and a
    design decision on whether the lobby title and Start button may keep the stencil font.
- Audio (slice 5): recorded effects and voice lines, one volume control:
  - Recorded sound effects (ElevenLabs) for every weapon, shell, grenade, bomb and rocket, the support planes, flak,
    plane crashes, falling houses, smoke shells, digging and building, plus a quiet battlefield ambience and a short
    sound when the match starts. Each sound plays when its effect shows, gets quieter with distance from the camera
    and pans left or right with it. Moving tanks and vehicles swell a shared engine rumble.
  - Burning wrecks crackle while they burn. Artillery and mortar whistles end as the round lands. A machine gun or SMG
    burst plays once per burst, and a Tiger's gun sounds deeper. A hedge or fence being knocked down only crunches;
    a house falling is loud.
  - Each faction speaks its own language with recorded voice lines (Eleven v4): two voices per faction, the player's
    slot picks one, for move, attack, retreat, under fire and unit lost. They replace the browser's speech voice.
  - Alerts, recruiting, orders and button clicks each have a short sound.
  - One Volume slider in the in-game menu covers effects, voices and alerts and is remembered. M mutes and restores
    the last level. A player who had muted the old way starts muted.
  - Fixed: the old synthesized noise bursts are gone. Mute used to silence only the voices. Machine guns no longer
    pile up a new sound every few tenths of a second while firing.
  - Left for later: the Armored Car's cannon uses the tank gun sound. A hedge or fence falling still throws up the
    full dust cloud of a house (only the sound is lighter). The Fighter Cover circle is still the old flat ring. The
    automated browser checks confirm which sounds are played, not how they sound.
- Combat effects (slice 4): muzzle flashes, tracers, explosions, scorch, fire and smoke:
  - Every shot has a muzzle flash at the gun and a glowing tracer to the target, with the impact landing when the
    round arrives: dust and dirt for small arms, sparks off armor, a fireball and debris for shells and bombs.
    Explosions are sized by the weapon (grenade, mortar, tank gun, artillery, bomb) and leave scorch marks on the
    ground that fade after a while.
  - Destroyed vehicles burn and smoke, then smoulder. Smoke screens are thick drifting smoke, all smoke drifts with
    the same wind, and houses that fall down throw up a cloud of dust. Big blasts near the camera give a very small
    screen shake (off on Graphics Low and with reduced motion).
  - The support planes fly over and drop what they carry: recon, strafing, bombing, the dive bomber (one steep dive
    and one bomb) and the paratroop transport.
  - Air war: flak guns and Mobile Flak fire tracers up at planes, with black airbursts around them; when a flak gun
    opens up on a passing support plane, the bursts walk around that plane. Fighters fire from both wings in turn and
    the Ground-attack Plane fires rockets. A plane shot down rolls over and falls trailing fire and smoke, then
    blows up and burns where it lands; a support plane that is shot down cancels the bombs it hadn't dropped yet.
  - Fixed: a Flak Emplacement firing at ground units drew puffs in the sky instead of tracers to the target. A Fighter
    or Ground-attack Plane that was killed stayed frozen in the air as a wreck for 40 s. Shots no longer make and free
    GPU objects each time: all particles are one mesh and the planes come from a small pool.
  - Left for later: if every pooled plane is in use, a support plane shot down shows only an airburst. The Fighter
    Cover circle is still the old flat ring.
- World look (slice 3): painted ground, warm light, a planning table and map-symbol markers:
  - The ground is painted from real textures per cell (grass, dirt, mud, ploughed field, road, water, rubble,
    shelled earth, trench earth) with soft edges, and keeps the contour lines; shell holes and trenches are painted
    on. Houses, roofs, hedges, walls, sandbags, wire, tank traps, bridges and trench parapets get textured surfaces.
    When terrain changes in play or in the editor, only the patch around it is repainted.
  - A warm low sun over each player's opening view with a sky fill, crisp shadows that don't crawl when the camera
    moves, and haze that scales with zoom. The board sits on a dark wooden planning table with a cut-earth edge, so
    panning past the map edge no longer shows a grey void.
  - Graphics High / Low in the in-game menu. High blurs the far edge of the view; Low skips the blur and uses cheaper
    shadows and a smaller ground texture. If the frame rate stays low, the game switches to Low once and says so.
  - Player colors are now blue, red, chalk, orange, violet and cyan, so a 1v1 is blue against red.
  - Over each unit, its military map symbol filled in the owner's color (the same symbols as the HUD). Owner,
    selection, range and HQ rings are hand-drawn pencil strokes: selection is a chalk ring over a dark halo, weapon
    range is dashed chalk. Order lines are pencil strokes with arrowheads, in the same colors as before.
  - Capture points: a dashed chalk ring while neutral, a solid ring in the owner's color once taken, and capture
    progress as a shaded band. Flags are cloth in the owner's color. HQ names are in stencil type with a color bar.
  - Map symbols for the aviation types, which slice 1 left blank: Fighter and Ground-attack Plane (a plane seen from
    above, with bombs under the wings for the attacker), Mobile Flak (the air defense dome over an armor oval),
    Airfield and Flak Emplacement (the installation bar with the plane or the dome). They show on the Command Card
    and over the units.
  - Fixed: a dead unit's weapon range rings could stay on the ground. Order lines no longer make and free GPU
    objects every snapshot.
  - Left for later: the Fighter Cover circle is still the old flat blue ring, not a pencil stroke, and it is rebuilt
    every snapshot. The headless test browser drops to Graphics Low within seconds, so the integration screenshots
    don't show the far-edge blur.
- Alerts (slice 2): short lines above the minimap tell you when something needs you, each with a ping on the minimap
  and a sound hook (the sounds arrive with the audio slice):
  - Under attack: your units and buildings (planes too), an allied HQ or bunker, or a point of your side losing
    ground. At most once per 20 s per area, and not while the fight is on screen. Friendly fire and Sudden Death
    crumbling don't count.
  - Point captured, point lost, unit lost or building destroyed (losses close together share one line, so a plane
    shot down reads "Fighter lost").
  - Enemy Air Support incoming near your side: strafing, bombing, recon, dive bomber and paratroopers. Artillery and
    smoke barrages and fighter cover don't raise it.
  - Classic: a unit out of a building's queue, a building finished.
  - The newest line is bold; lines fade after about 6 s, four at most. Space jumps to the newest alert while one is
    showing (otherwise it centers the selection as before); clicking a line jumps there too.
  - Only what the server already sends you is used, so nothing under fog leaks.
- New HUD, "sand table" look (slice 1 of the look and feel work):
  - A dark olive strip holds the panels; the unit cards and the selection list are manila cards. Courier Prime for
    text, Stardos Stencil for the big numbers (MP, clock, VP).
  - Score and clock top center, with faction markings next to player names; resources, income, army size and the
    eight support calls (two rows of icon buttons with their hotkeys) top right; your planes and what each is doing
    listed under them (click one to select it); selection list and an icon grid of orders bottom left; the Command
    Card bottom center; menu, voices and fullscreen in a small bar top left.
  - Military map symbols (infantry box with an X, armor with an oval, and so on) on the Command Card, the selection
    list and the orders. Tooltips give the full unit name and its role; hotkeys show on the buttons.
  - Command Card groups: Infantry, Support weapons, Vehicles and Aircraft (Fighter and Ground-attack Plane).
  - The lobby is a manila order card and keeps its two columns (Players and Invite, Battle with the map preview, mode
    description and army size).
  - The always-on keybinding panel is gone; the hotkeys are on the buttons.
  - Fixed: the HUD rebuilt its buttons 10 times a second, which could eat clicks (orders, Command Card, air panel).
    At 1600x900 the orders panel covered the recruit bar. Classic's MP / Mun / Fuel readout wrapped to two lines.
    Engineers now get the fortification buttons too.
  - The aviation map symbols and keyboard shortcuts for every fortification came in later rounds (see above).
- Army size in the lobby (host picks): Standard (as before), Large (2.5x unit limit, 3x income) or Massive (5x unit
  limit, 6x income: MP, Munitions, Fuel and starting MP). The AI buys several units at a time in big games. With 6 AIs
  on Six Fronts, Massive peaked at about 240 units (Conquest) and 270 (Classic); the server stayed under 8 ms per tick
  on average (24 ms worst, budget 50). With 3.5x income Massive only reached 98 units: armies died as fast as they came.
- Aviation (all modes):
  - New air support: Dive Bomber (U, 180 MP / 70 Mun): one heavy bomb right on the spot. Paratroopers (P, 260 / 90):
    a rifle squad dropped where your side can see (counts toward pop). Fighter Cover (I, 120 / 40): for 60s the next
    enemy air strike over the area is shot down (never recon).
  - Flak gun (200 MP; Barracks in Classic): each support plane flying over it has a 35% chance per gun of being shot
    down (a bombing run drops only part of its stick, a recon flight ends early). It also shreds infantry, not tanks.
  - Planes you command: Fighter (P-51 / Bf 109 / Yak-9, 280 MP) and Ground-attack Plane (P-47 / Stuka / Il-2, 340).
    They fly sorties from an airbase behind your HQ (in Classic, an Airfield built by Engineers, O): right-click the
    ground to patrol, an enemy to attack, a friendly unit to escort; R sends them home. They circle the mission for 50s
    of fuel, then fly home and rearm in 30s. Your planes and their state are listed under the support buttons.
  - Anti-air hurts planes every second they're in range: flak guns, Mobile Flak (M16 / Wirbelwind / ZSU, Motor Pool),
    Flak Emplacements (Classic building, Y), enemy fighters, and a little from MG teams. Rifles and tanks can't touch
    planes. Planes in the air are seen from 60 m with no line of sight and see 40 m below them.
  - The AI buys flak when it sees planes, fighters to contest the sky and ground-attack planes for big armies; it calls
    fighter cover over announced enemy strikes, dive bombers on tanks and paratroopers onto enemy points.
- Kill bounty: finishing off an enemy unit or building pays 20% of its cost in MP (a tank 60, a rifle squad 20).
- Classic pop cap 24 (was 20): with the bounty the leader banked ~1100 MP at the cap.
- Balance (AI): Conquest 2nd place 63% of the winner's VP on Three Crossroads (90 matches), 57% on River Towns (60),
  lead changes up to 1.55-1.68. Classic decided before sudden death: 85% (default), 80% (River Towns), 60% (Six Fronts,
  still the long one). In 6 Conquest matches the AIs called 19 dive bombers and 9 fighter covers (8 intercepts), and
  lost 6 planes; in Classic 17 paratrooper drops, 21 intercepts, 17 planes down.
- Lobby redesign and fix:
  - Fixed: the long Annihilation entry in the Mode menu made the whole lobby card wider than the window, so every row
    ran off the right edge (and off a phone screen entirely). Nothing in the lobby can grow wider than the card now,
    and the lobby scrolls when it is taller than the window.
  - Two columns on wide screens (Players and Invite on the left, Battle on the right), one column on narrow ones.
  - Map preview: a picture of the chosen map (terrain shaded by height, capture points, spawns; in Assault, red spawns
    defend and blue attack) with its real name, size in metres, player count, hills, rivers, and the Assault clock.
  - Short mode names in the menu with a one-line description of the chosen mode underneath.
  - Map names read properly (Kasserine Pass, not kasserine-pass), and Start is a big gold button.
- Fixed the Flak Gun card and tooltip showing "undefined": they now explain that it shoots down enemy air support.
  Both the buy bar and Classic training cards use the unit name if a role description is missing.
- New mode, **Annihilation**: like Assault, but every player gets a Command Bunker with its trench and sandbag ring,
  and there's no clock. A side is out when its last bunker falls; the last side standing wins. Works with any teams,
  including free-for-all. Everyone starts with 300 MP and +4.5/s; points pay manpower only (no VP). Bunkers take 5%
  from support strikes, as in Assault, so they have to be taken on the ground. AI matches all finished: 1v1 on Three
  Crossroads and River Towns in 5 to 27 minutes, 3v3 on Kasserine Pass in about 29 minutes.
- Field fortifications: rifle squads, conscripts and engineers (twice as fast) can now build five things, each
  placed like a trench (click the spot, move the mouse to turn it, click again):
  - **Trench** (T, 30 MP): as before.
  - **Sandbags** (Y, 20 MP): a 4-cell low wall. Cover, and you can still walk over it.
  - **Barbed Wire** (U, 25 MP): 5 cells. Infantry wade through at 35% speed and path around it when they can.
    Tanks flatten it by driving over it, and any explosion clears it.
  - **Tank Traps** (I, 40 MP): 4 cells of steel hedgehogs. Vehicles can't cross them; infantry walk through and
    use them as cover. Explosives knock them down. Never built under a vehicle.
  - **MG Nest** (O, 60 MP): a trench pit behind a horseshoe of sandbags facing away from the builders.
  - Fortifications go on open ground, craters or rubble. The map editor has wire and tank-trap brushes too.
  - Left for later: the AI still only digs trenches.
- New XL map, Monte Cassino XL (135x165, 6 spawns): the monastery on the summit and three tiers, now with two ramps per
  cliff (flanks below, either side of the monastery above). AI 3v3 assault with a 23 min clock: attackers won 45% of
  40 (22% at 20 min, 60% at 25).
- Stalingrad Factory: in Conquest and Classic one player started inside the factory in the middle of the map. The
  factory spawn is now Assault-only (the defender still holds it there) and there's a fourth edge spawn, so other modes
  start everyone at the edges (N, E, S, W). 4-way Conquest wins by spawn: 4/8/6/6 of 24. The fix is in the map pack's
  generator, which is still waiting to be committed with the pack.
- Maps can mark a spawn Assault-only (`"assault": true`): other modes skip it, and the lobby counts seats per mode.
  The editor has an "Assault only" box for a selected spawn.
- Map editor: a Preview dropdown shows the map as each mode sets it up: Assault's added trenches, walls and bunkers and
  the points it leaves out, Classic's HQs and its MP (yellow) and Fuel (orange) nodes, which spawns each mode uses and
  who defends or attacks, for any number of players. Editing pauses while previewing.
- New XL assault map for 3v3, **Kasserine Pass** (160x200): a cliff-sided mountain wall across the whole map with a
  single winding pass through it, the only way from the attackers' valley to the defenders' (checked: plugging the
  pass cuts the two sides apart). Overwatch ledges beside each mouth of the pass, reached from that side's valley.
  Defenders hold a town and three bunkers in the north. AI 3v3 assault: attackers won 2 of 8 matches, both near the
  15:00 clock, with up to 9 units fighting in the pass at once. More attacker income didn't help (0 of 8): the clock
  is the limit. Left for later: a per-map Assault clock would let XL maps run longer.
- Three XL maps for up to 6 players (3v3 Assault: three defenders, three bunkers), about 1.5x the size of the originals:
  - Pegasus Bridge XL (140x150): a bigger town, two stone bridges, a ford on each flank and one in the middle.
  - Hill 112 XL (120x160): the terraced climb with three ramps up the escarpment instead of one.
  - Seawall XL (130x140): a longer beach and cliff with three ramps, trenches across the ramp tops.
  AI 3v3 assault, attacker wins over 40 matches: Pegasus Bridge XL 58%, Hill 112 XL 45%, Seawall XL 25% (the
  original Seawall is 25% too). They also work for 3v3 Conquest (all test matches finished, 12-16 min).
- A map can set its own assault clock (`assaultTime`): Pegasus Bridge XL 20 min, Hill 112 XL 16 min (attackers won
  10% at 15 min, 80% at 20). Generated by tools/genmap-xl.js.
- Found and left: the assault AI only defends points within 70 m of its HQ, so on big maps defenders must spawn near
  what they defend (Seawall XL's HQs sit behind the cliff for this; with them further back attackers won 19/20).
- Units are easier to tell apart:
  - Every unit has a class badge left of its health bar, a pictogram on a disc in its owner's color: rifle, star
    (Rangers), three heads (Conscripts), MG on a tripod, mortar tube, crosshair (sniper), hammer (Engineers), AT gun,
    armored car, and a tank with one, two or three pips for light, medium and heavy (Tiger). The cover shield moved
    to the right of the bar.
  - Soldiers have faces, and each class carries its own kit: rifles, SMGs, a sniper's long scoped rifle and ghillie
    cape, an engineer's pack and shovel, ammo boxes for MG and mortar crews.
- Fixed: faction models (helmet shapes, the Calliope / Panzerwerfer / Katyusha) were picked by player slot, not
  faction, so a German player in the first slot got American helmets and a Calliope.
- One link for good: the plain address (no #code) always opens the same room, so friends can bookmark it. The lobby has
  a Room box to join any other room by code, and New room for a private one.
- When a match ends, the room goes straight back to the lobby with the result on top: change map, mode, teams or AIs,
  and new friends can join, then Play again. (Before, the room stayed locked on the result until a rematch.)
- In-game menu (the ☰ button by the MP): the host can Restart the match (same settings) or End it (everyone back to the
  lobby); anyone can Leave, and an AI takes over their army so the match goes on. Each asks for a second click.
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
