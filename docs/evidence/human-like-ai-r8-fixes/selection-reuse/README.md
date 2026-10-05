# Current R8 physical selection inefficiency

Scope: one authored native laboratory scene and two selection controls. CPU3 nice19. Current ROOT files unchanged. Exact original source hashes, candidate hands and patch hashes: final-hashes.json. No match, scorer change, response-population change, timing retune, input filler, pan change or median gate claim.

## Actual source cause

The executor reuses selection only when it already exactly matches every intended actor. For a two-actor order with one actor already physically selected, actionsFor creates a new exact selectionBox and redraws both. The client and executor already support a real Shift-click to add the single missing actor. Preserving the existing actual subset and paying that one click gets the same complete selection. No intended actor must be dropped and no squad's movement or commitment changes.

The narrow candidate changes only the on-camera unit-selection branch after actual group recall/panel handling. It uses Shift-click only when the persistent selection is nonempty, every selected ID belongs to the intended command, and exactly one actor is missing. All actors must still pass the preexisting onScreen test. Otherwise the original box/click route remains. Existing reaction sampling, motor timing, hit-testing/noise, target mode, issuing locality, actor subsets, caps and group behavior are unchanged.

## Native laboratory proof

Actual purchases create three owned rifles. Prior selection is acquired through queueInspection and real input completion, not manually seeded. A fresh selected-HUD baseline is delivered before the authored local injury. Two camera-local rifles then have actual native health30% and receive genuine perceived70% damage episodes. This is a controlled damaged scene, not a new damage-mechanism proof or calibration sample. Production plan proposes a real two-squad retreat. The hands receive its original event descriptors and physically select/issue it via ordinary sim.command. Both intended rifles actually enter native retreat, and the third actor does not. The complete prior input timeline and final native command match between versions.

One desired actor selected: baseline select-box first input0.50s, accepted group retreat0.60s. Candidate select-add-click with Shift first input0.40s, accepted same group retreat0.50s. Existing0.2s event floor still holds. The full sampled reaction deadlines and motor durations are preserved. This saves0.10s here through useful selection reuse, not a cheaper timing constant.

Unrelated actor selected: full before/after timeline identical, first0.70s and accepted0.80s. It still boxes the two intended actors, because adding them to an unrelated persistent selection would be incorrect.

Both desired actors selected: prior actual group command establishes the physical selection through an identical box from an unrelated actor. Full before/after timeline identical, first and accepted0.40s. It requires no new selection input.

Each run advances fewer than60simseconds, with a fixed seed27/Hard and no seed search. native.json retains every causal input, native receipt and measured endpoint. It changes no historical/native campaign score or censor. No campaign scoring was invoked.

## Limits and retained diagnosis

The provided Hard seed1 summary has two box responses. At1550 selected actor6 differs from intended4/5. At2188 selected13 differs from intended19/20. Neither is this reusable-subset case, so this patch is not claimed to explain those exact natural endpoints or close the1.15s median. The latter also includes a companion already automatically engaged, but deciding to drop an intended formation member would require a separate gameplay review. This candidate keeps all actors.

Initial fixture runs missed the selected actor's injury event because the real click changed its health basis from world-bar to selected-HUD before a fresh HUD baseline. Those logs are retained. Delivery of the genuine new HUD baseline fixes the test setup; no perception source changes are proposed. The first exact-selection setup also naturally benefitted from the new Shift path before the injury, so that diagnostic is retained. Establishing its pair selection from an unrelated third actor provides an unchanged-history negative control.

hands_executor confirmed no overlap with its early-pan-release patch. Proposed source-only hunk: /tmp/human-ai-r8-selection.patch. Review before adoption. Native reproduction:

```
taskset -c 3 nice -n 19 node /tmp/human-ai-r8-selection-lab/native.mjs /tmp/human-ai-r8-selection-lab/native.json
```
