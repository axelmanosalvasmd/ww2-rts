# R8-5 accepted fortification and stale cover

The V21 native reproduction confirms a gameplay bug. A default Hard rifle on an owned objective accepts entrench at tick 64. Tick 65 still uses delivered snapshot 64, taken before that acceptance. The exact accepted-command guard stops a repeated entrench but does not mirror the pending work in the new plan. The same plan queues cover at 65. Snapshot 66 reports real digging and entrenching, but that cover is already queued. Its full paid key completes at 80, is accepted, and clears both dig and entrench in the authoritative engine. This is more than one plausible refused stale input.

The two-line prospective commander change stores the actual accepted command type and extends pendingAccepted only for cover on an actor with accepted dig/entrench not yet followed by a newer delivered snapshot. It uses the commander's own receipt, not queried authoritative work. The existing snapshot expiry removes the guard once delivery is newer than the receipt. Other actors and emergency retreat/move/ability remain eligible. No AI cover predicate needs a change because it already respects delivered dig/entrench and locally mirrors successfully queued work.

The baseline has one trench terrain cell through tick 400. The candidate preserves the project and has five cells at 400. Complete commands and physical inputs through accepted entrench64 match. An idle useful-cover scene remains byte-deep identical. All three ordinary armor-pressure native scenes remain byte-deep identical, including paid accepted retreat. The original cover-opportunity test passes unchanged, retaining bare noCover refusals in its historical control, legal trench/wall use and hidden-terrain controls.

The reviewer-cited historical two-front receipts are preserved at their original paths: /tmp/ai-ordinary-tactics-bc677/twofront-hard-1.json has wire accepted1084, cover refused1088 for20 and wire1114, cover refused1118 for15. Those noCover failures do not by themselves prove cancellation. The new native V21 case proves the neighboring accepted-cover cancellation. Initial wire-specific probe attempts did not reproduce wire acceptance and remain in their original logs and timelines. They are not selected as proof of that symptom.

Source is the immutable V21 archive /tmp/human-ai-v21-final-full-source. Base AI c99be94a933f5c122d8ba7f32750f1a4bff66bf2875c8f3ec8e86322eb3d7e43, base commander19112a1e4c94da72d62564d940497d38cf7e93e3086c9bde3db9c29d088703df, candidate commander35e0690b6fd210e3e9b55103c917be2d91edea5269f3d62c91cf9641a5602734. integration.patch contains only the disjoint commander hunk and new portable native fixture. Native proof retains full reports and per-tick public/work/terrain-count states. No original score, bands, unit stats, seeds or refusal recording was changed. No ROOT source was edited.

The first fixture's assertions passed before cleanup failed because the copied frozen shared directory was readonly. The neighboring cover-opportunity run had the same scratch permission problem. Both failed logs are retained. Correcting scratch copy permissions made both entire processes exit0. No gameplay fixture or assertion was changed for that correction.

```sh
nice -n 19 taskset -c 5 node /tmp/ai-r8-cover-fort/candidate/test-engine-ai-fortification-cover.js
nice -n 19 taskset -c 5 node /tmp/ai-r8-cover-fort/candidate/test-engine-ai-cover-opportunity.js
```
