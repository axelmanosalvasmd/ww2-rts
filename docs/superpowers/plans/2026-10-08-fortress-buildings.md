# Fortress buildings implementation plan

**Goal:** Engineers build Concrete Walls, Gun Pits, Pillboxes and Scout Towers that are fun to hold and fun to
break. The AI builds and attacks them. The Build menu gets less cluttered, not more.

**Main mode:** World Conquest. Everything also works in Classic, Conquest and Assault.

**Decisions so far (user, 2026-10-08):**
- Fortifications persist. In World Conquest that means for the whole match, damage included.
- Concrete pieces are Engineers only.
- The AI builds them, not only attacks them, and walls off its ground.
- Captured fortifications switch to the captor. Gates let allies through. Tier split as in the table below.

## Design

### Why it is fun

1. Every piece fights back or changes the fight on its own, so building one feels like an investment.
2. Pieces break in stages, using the sections and collapse system in `shared/structures.js`. A wall gets a hole,
   a tower falls over, a garrison bails out.
3. Every piece has a clear answer. Small arms barely scratch concrete; satchels, AT rounds, flamethrowers and
   artillery do the work (the Command Bunker's demolition rule).

### The four pieces

| Piece | Who | Role | How it breaks |
|---|---|---|---|
| Concrete Wall | Engineers | Drawn as a line like sandbags. Stops vehicles and infantry, blocks sight. A Gate piece lets your team and allies through | Each segment is a section. A breach opens a gap that becomes a path; rubble left behind is cover |
| Gun Pit | All builders | Sandbag emplacement. The weapon team inside (MG, AT gun, mortar) gets extra range and heavy cover. Replaces the MG Nest | Sandbags wear down in stages, the bonus drops, then the crew is exposed |
| Pillbox | Engineers | Concrete, MG slit, crew built in (fires on its own once finished). Strong front, weak rear | Cracks section by section under explosives |
| Scout Tower | Engineers | Big sight radius, holds one sniper or spotter team | Tall and narrow: lose the base section and the whole tower topples |

Starting numbers (to tune with `tools/ai-balance.mjs`):

| Piece | Cost | Build time | HP | Tier |
|---|---|---|---|---|
| Concrete Wall | 30 MP per segment | 6 s per segment | 400 per segment | T2 |
| Gate | 50 MP | 10 s | 400 | T2 |
| Gun Pit | 60 MP (MG Nest's price) | 8 s | 200 | T1 |
| Pillbox | 200 MP | 35 s | 1500 | T2 |
| Scout Tower | 120 MP | 25 s | 300 | T1 |

Reuse, not new systems:
- Garrison, eviction damage and flamethrower bonus against garrisons: the existing house garrison code.
- Demolition against concrete: the Command Bunker's direct-fire multiplier and explosive demolition values.
- Line drawing, crew scaling, repair and rubble: the existing fort and building paths.
- Collapse: `supportedSections` in `shared/structures.js`.

### Persistence and region capture (World Conquest)

World Conquest is one long match, so persistence is the default: nothing heals on its own and Engineers repair.
The open rule is what happens when a region changes hands.

Decided: when a team captures a region, every fortification standing inside it switches to the captor, as
damaged as it is. Any enemy garrison is evicted. You fight your way into the enemy's fortress, and then you own
what is left of it. Fortifications do not block a capture (only Production Buildings and the regional base do), so
the capture rule stays as it is.

Regional defenders (the `worldbase` guard) start with a few pieces around their base: a wall stretch, a gun pit
and a pillbox scaled by distance from the nearest home. That gives attackers something to crack from minute one.

### Build menu

Today it is one flat grid of about 18 buttons (`client/hud.js`, `menuHTML('build')`). After:

```
Build ▸  [Base]  [Defenses]  [Field works]  [Engineering]

Base:         HQ  Barracks  Motor Pool  Airfield  Shipyard  Armory  Supply Cache
Defenses:     Pillbox  Gun Pit  Scout Tower  Concrete Wall  Gate  Flak
Field works:  Trench  Sandbags  Wire  Tank Traps  Minefield
Engineering:  Bridge  Field Hospital
```

- Two-step hotkeys: Build key, tab key, piece key. The menu remembers the last tab.
- Fill in and Clear mines leave the menu. Right-click a crater or rubble with builders to fill it, right-click a
  known minefield to clear it.
- MG Nest leaves the menu (the Gun Pit replaces it).
- Locked pieces (tier, Engineers only) are hidden, not greyed out. The tab tooltip says what unlocks more.
- A tab with nothing in it for the selection is hidden.

### AI

- Attacking: treat pillboxes and gun pits as threats to flank or blast. Send AT, flamers, satchels or artillery,
  not rifle squads head on. Treat a wall as an obstacle to breach when the path around it is long.
- Building: after a region is captured, if it borders enemy or guard land, an Engineer puts a Gun Pit and Scout
  Tower near the capture point, then a Pillbox when it can afford one, facing the nearest threat.
- Walling off: the AI rings its bases and frontier capture points with Concrete Wall, with a Gate on each side that
  faces its own or allied land (so its army can get out and reinforce). It walls the most threatened region first
  and keeps repairing breaches. Guard rails: never seal a production building's exit, always keep a gate path
  (checked with the navigation grid after placing), and keep an MP reserve so walls never starve unit production.
- AI plans from its own remembered view (`ai-view.js`), like the existing site searches.

## Slices

Each slice is playable, tested, and gets a CHANGELOG bullet and DESIGN.md update.

1. **Build menu tabs.** Tabs, two-step hotkeys, right-click fill and clear mines, hidden locked entries. No new
   pieces yet. Check for hotkey conflicts in `client/keys.js`.
2. **Pillbox end to end (done).** Sim definition, model, garrison, front/rear armor, demolition, staged cracking,
   eviction, repair. AI attacks it properly. Test: a squad inside survives rifle fire, dies to a satchel from the
   rear.
3. **Gun Pit (done).** Replaces the MG Nest (existing nests keep working). Range and cover bonus for the occupant,
   staged sandbag wear.
4. **Scout Tower (done).** Sight radius, garrison, toppling collapse with a falling section.
5. **Concrete Wall and Gate (done).** Line drawing, vehicle and sight blocking, breach becomes a path, rubble cover. Gate
   passes own team and allies. Pathing check: a wall must not trap starting units or seal a base.
6. **World Conquest rules (done).** Capture switches ownership and evicts garrisons. Guard regions start fortified.
7. **AI builds (done).** Placement rules above, budget reserve, per-region caps.
8. **Balance pass (done).** Conquest 60 matches 35/35/30%, Classic 30 matches 37/30/33%, recorded in DESIGN.md.

## As built (2026-10-08)

- Build menu: tabs only sort buttons; fort hotkeys stayed direct, so the two-step hotkeys were dropped. Fill in and
  Clear mines live in the Engineering tab instead of becoming right-click actions. Locked pieces show greyed out with
  the tier they need.
- Pillbox: built-in MG crew instead of a garrison (garrisons belong to map house cells; a mid-match building cannot
  become one without a new client channel).
- Gun Pit: kept the FORTS key `nest`, so old hotkeys and the AI's nests carry over. Found and fixed a projectile bug:
  shots from a nest hit its own front sandbags.
- Wall and Gate: FORTS kinds whose finished cells become one-cell buildings, so drawing, previews, crews and
  pay-per-segment reuse the entrenchment system. Gates open and shut by enemy proximity instead of per-team pathing.
- World Conquest: fortified share is by rank of distance from homes (40% / 15%), since absolute distances swing with
  map size and player count.
- AI: fortification reserves MP from unit buying, otherwise Classic's tight economy never leaves spare MP.
- Tests: test-fortress.js (pillbox, gun pit, tower, wall and gate, World Conquest rules, AI fortifying).
- Balance: no tuning needed. World Conquest has no win-rate harness (`ai-balance.mjs` runs Conquest and Classic), so it was checked with a 12-minute AI match instead.
