# Changelog

What changed in the game, newest first. Player-facing changes lead each entry; balance numbers come from
AI-vs-AI runs (see DESIGN.md for the balance log). Add new entries under **Unreleased**.

## Unreleased

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
