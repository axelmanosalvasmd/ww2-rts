A useful garrison order can stall when its named idle squad is on screen but the nearby house is outside the camera. The original Conquest Hard seed 10, slot 0, tick 606 scene has rifle 2 at (83.2,125.8), HP 70, an owned point, free hands, and a planner-selected house at (87,121), 6.12 m away. The planner repeats this garrison at 614, 622, 630, 638, and 646 while the queue stays empty. Hands correctly refuses an off-screen garrison; the commander previously had no paid framing path for it.

The source patch adds two lines in ai-commander.js. Garrison uses the existing placement-camera search and paid pan route, with onScreen for the house click rather than a ground-placement ray. After framing, the proposal must pass the current view.sees check before it can enter the hands queue. Existing selection, input timing, actor eligibility, command dispatch, prices, and other placement handling remain intact.

Artifacts:

- /tmp/human-garrison-framing.patch
- /tmp/human-garrison-framing-test.patch
- /tmp/human-garrison-framing-native-proof.json
- /tmp/human-garrison-framing-manifest.json

Both patches pass git apply --check against root ai.js 038bba2d8b69ee158f6cf6014a3ba6a245441d16c27b2376715027dbee3e82ed and commander 145ebe7f589fd6daf09db41865d237d4f5fe69c3b0cbb6ff1a2f839e21ff1527. Candidate commander SHA256 214cfdf199c02afbba40a2958a8df05a95c3588f4bd0d1cc08c5bcbe6dc9ae01. No repository source was edited.

The permanent portable fixture is test-engine-ai-garrison-framing.js. Each fixture scopes LCG 23 over native creation, commander inputs, dispatch, movement, and entry, restoring Math.random in finally. It uses normal imports, actual delivered views, and native command once per dispatched input. It prints one PASS line.

The positive starts with the real retained actor and camera geometry, with a one-cell authored house. Paid pan completes at tick 8, physical selection of rifle 2 at tick 50, and native rightclick at tick 55. The selection is exactly [2], the final house is both on screen and team-visible, and the native unit physically enters house cell 4843. The test checks the pan's full recorded motor duration, input order, actual selection, native acceptance, and final entry. No minimap garrison or group bind is added.

Four negative fixtures preserve the boundaries: an actor remembered at the old location but now elsewhere, a house corner behind native LOS, a hedge instead of a house, and an actor that dies after the paid camera input. None accepts a garrison. Two additional controls prove that already-framed garrison needs no extra camera input and that native ground building still pays actual selection/key/placement and 60 MP, then advances its depot construction. Complete input and command timelines for those two controls are identical to the unchanged baseline in /tmp/human-garrison-framing-baseline-existing.json and /tmp/human-garrison-framing-candidate-existing.json.

The unchanged baseline fails the new positive's paid camera requirement, retained in /tmp/human-garrison-framing-baseline.log. Candidate seven-fixture PASS is /tmp/human-garrison-framing-final.log.

First failures remain available. /tmp/human-garrison-framing-first-native.log contains the two-cell-deep house setup: its far corner was genuinely not team-visible, so the new visibility guard correctly refused it. That setup is retained as the unseen-house negative, while the positive uses a single authored house cell. /tmp/human-garrison-framing-ground-first.log records an off-camera resource node: the recently adopted local-engineer rule correctly excludes that work before requesting a build. The ground preservation control therefore uses a framed node and proves native construction unchanged; no visibility restriction was relaxed.

The retained three original V15 matches were inspected without another match or campaign. Their original terrain arrays were not stored in the detailed trace, so /tmp/human-v15-followup-garrison-geometry.json qualifies the original house geometry against authored public terrain. The new native fixture establishes actual geometry, sight, paid movement, command acceptance, and entry without that reconstruction limit. This correction has no claimed APM benefit and does not explain the Hard cohort median by itself. The earlier casts:1 proof remains unchanged.

Suggested changelog: Idle squads now frame a nearby house before entering it, and check that the house is currently visible.

Suggested design note: A garrison click uses the existing paid camera route when the chosen house is outside the viewport. Replanning after that input uses current team sight and actual physical selection; an off-screen house never receives a minimap garrison order.

Root owns adoption, registration, documentation, and frozen validation. CPU1 is free. No repository edits, staging, or commits were performed.
