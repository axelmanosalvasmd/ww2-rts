# Issue batch verification, 2026-10-01

This batch continues the open gameplay, graphics and controls branches from master `41eefe8`, then adds individual soldier movement and fixes troop selection. Each implementation group worked in its own worktree. The combined source was checked in the browser and with the full simulation suite.

## Automated checks

The final combined `node test.js` run exited 0 after the last selection change. It passed simulation, command feedback, availability, room lifecycle and all model-family checks. The fog proof compared 4,489 paired turns and 1,899 command-only orders across all difficulty levels, with 26,707 hidden-unit and 183,030 hidden-mine perturbations. `node test-world.js` and syntax checks for all changed JavaScript modules also passed. Source review found no remaining actionable defects in the reviewed changes.

## Real GPU performance

The combined game ran on an Apple M3 Max through ANGLE Metal in the Codex in-app browser at a 1600 x 900 viewport. The Six Fronts Conquest match used Massive armies and six seats. The human recruited 60 units and ordered them into combat. The five opponents used Hard, Easy and three Normal seats.

| Setting | Mean fps | Lowest one-second fps | Mean frame ms | Max one-second frame ms | Max draws | Max triangles | Max particles |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| High | 57.59 | 44.9 | 17.50 | 22.3 | 1369 | 2144036 | 2034 |
| Low | 59.59 | 55.7 | 16.82 | 17.9 | 1330 | 1228869 | 908 |

Each row summarizes ten consecutive one-second HUD samples after warm-up. High rendered at 1600 x 900; Low rendered at 1200 x 675 in the same viewport. More than 500 soldier models were moving during most High samples. Low followed later in the battle after casualties, so the rows are not an identical-scene comparison. CPU balance simulations ran concurrently. These window averages are not per-frame percentiles. Initial shader compilation and reload stalls are excluded. Raw samples and counters are in [issue-batch-performance.json](issue-batch-performance.json).

## Browser checks

- Clicks and boxes on outer soldiers select their squad without a prior selection. Mixed types remain selectable across houses and props. Dedicated selection checks cover crouched and prone soldiers, trench offsets and garrison roof markers.
- Soldiers walk, crouch-walk and crawl with separate stride phases, turning and following. Moving fire uses the animated muzzle position. Each squad remains one controllable gameplay unit.
- A real right-drag displays formation slots and issues movement with facing. The seven-unit server check, including a tank, finished within snapshot rounding of the requested angle.
- The controls sheet opens on first match and with F1, closes with Escape or a click, and blocks map-edge scrolling while open. Its first-match preference persists.
- Cover preview is before Volume in the menu, toggles, and persists. Shields follow explored ground and share the new overlay colors.
- The lobby accepts separate host-selected AI levels. The editor opens and validates default and Kasserine Pass maps without the prior route-check error.
- The Panzer IV viewer keeps readable shaded paint with textures disabled. German aircraft show irregular splinter camouflage. Infantry, vehicles and aircraft meet their mesh budgets.
- Continuous terrain and water were checked on default, island, river and cliff maps, with High/Low graphics, golden light and weather. Edge-crater and cliff seams were checked numerically.
- The final combined browser session reported no console errors.

## Remaining limits

Cover previews approximate damaged-wall protection because the client receives damage stages rather than exact wall health. Effect sprites fade against ground but may intersect walls or units. Medics still use the engineer figure with a carbine despite being unarmed. Queued formation lines do not display facing, the AI does not issue facing orders, and the minimap has no facing drag. These limits are recorded in DESIGN.md.

The 18-match AI difficulty pilots establish sample outcomes, not Normal-versus-master parity in Classic. The separate larger three-faction comparisons are recorded in the behavior balance evidence and DESIGN.md.
