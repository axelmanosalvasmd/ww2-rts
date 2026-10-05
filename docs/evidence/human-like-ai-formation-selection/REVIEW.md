# Actual selection order in movement formations

Current hands SHA a8df9cdda67ec8b10d20606a116d3c089d15ff59af7d450a90e66e57c8c46fdb produces a demonstrated mismatch against the client dispatcher.

`client/selection.js` stores and restores the insertion order of the real selected IDs. `client/orders.js` builds its troop list from that actual Set order. `client/main.js` passes this list to shared formation. Shared formation retains input order when positions tie, including rank and trench-slot decisions. Hands instead constructs the list in the planned `job.units` order, even though its actual group recall restored a different order for the same ID set.

The bounded probe pays actual selections, two accepted movements, a binding and a later actual recall, and submits native commands through the real engine. A group bound as [1,3] restores [1,3], while a new planned order for [3,1] currently forms in [3,1] order. At equal delivered coordinates (122,120), this changes actor-to-destination assignment and, because the mixed troop slot widths differ, exact destination coordinates too. The same mismatch survives pruning a dead third member. A retained actual selection has the same tied-order mismatch without another recall. A surviving singleton, spatially separated troops and P1 partial selection controls already match.

The proposed one-line patch reads formation members in `hands.selected` order, with each current delivered unit or its corresponding queued stale snapshot. Existing dispatch checks already require the command member set to equal the actual selection. This changes neither membership nor the existing stale-click behavior. It changes no physical input, timing, RNG, grouping, information tier or public overlay.

All six native-vs-client probes match exactly after the patch. Every submitted probe command is accepted by the ordinary engine boundary. Current formation settings are already the client's initial line, spacing 1, trench snapping and march together. Hands emits no formation menu inputs, so no settings mismatch was demonstrated and no new group settings state is proposed.

Artifacts:

- `formation-selection-order.patch`: one-line source proposal against the captured current runtime.
- `before-proof.json` and `after-proof.json`: exact native and client commands, actual selected order and delivered units at issuing time.
- `probe.mjs`: repeatable source comparison, with optional HANDS_MODULE and REQUIRE_PARITY environment controls.
- `test-engine-ai-formation-selection.js`: ordinary relative-import regression candidate. It requires equality and therefore fails the original source and passes the proposed source.

Only small fixtures ran on CPU 1 at nice 19. No production edits or performance runs occurred.
