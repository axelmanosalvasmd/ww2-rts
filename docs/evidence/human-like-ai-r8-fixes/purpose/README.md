# R8-4 native diagnosis and candidate

Source: immutable V21 archive `/tmp/human-ai-v21-final-full-source`. All edits and executions occur in `/tmp/human-ai-r8-purpose`, CPU3, nice19. No ROOT or archive writes. `final-source-hashes.json` pins all four runtime files, unchanged grading sources and the patch. `protocol.json` declares the scene classes before the final native controls.

## Confirmed defects

The old runtime predicate acknowledges accepted damaging support if a watched hostile is within24m of the click and focus. It does not check the strike footprint, visible friendly hazard, whether strafe effectively answers armor, or whether a hostile threatens the current local actor. It similarly acknowledges suppress/AP without known selected-HUD cooldown/setup, usable target class or weapon effectiveness. These are behavior bookkeeping defects: answeredEvents stops ordinary attention/relevance for that original event.

`native-purpose.json` records20 scene rows using native purchases and actual perceive-generated contact/damage descriptors. Valid dive, infantry strafe, selected-HUD MG suppress and AT AP remain true. Dive misses by10m, artillery side misses by8m, strafe against native armor, AP against infantry and MG against armor are accepted native commands but become false-purpose decisions. Native commands accept suppress even when an abstract public scene says it has no useful setup/ready/target opportunity. Readiness, moving/setup, retreat, hold-fire and selected-HUD negatives are explicitly public-scene controls, not claimed authoritative failure receipts. An offcamera hostile cannot justify a strike. Private measurement-field perturbation does not affect the candidate predicate.

Friendly fire is real. The fixture buys an own rifle at the native dive endpoint. The ordinary support command accepts. With weapons held and automatic abilities disabled, native blast decreases friendly HP100 to32.8. Sim blast applies damage to both teams; dive radius5 and bombing40m stick plus shell blast are inspected directly. The candidate human planner guards dive and bombing against actual current delivered-camera friendly positions. It does not inspect hidden allies. The helper also protects runtime purpose ACK for artillery and strafe. The candidate preserves the current24m ability relevance bound and existing costs, limits, unit definitions, strike damage and event creation.

## Physical and planner controls

`physical-support.json` contains3 full runCommander plus real hands scenes. The planner is deliberately injected to isolate the decision contract, as the permanent response test already does. A genuine delivered40% own-damage episode precedes a real support hotkey/click and ordinary sim.command receipt. The useful accepted dive remains answered. An accepted dive whose actual endpoint misses the watched hostile changes baseline answered=true to candidate=false, and acquires no false response link. The refused dive stays unanswered in both versions. Valid and refused scenes retain identical actual issuing input and native receipt. The actual accepted miss retains the same command/receipt. No dummy input or retrospective event link is introduced.

`planner-support.json` contains7 actual production-plan scenes. All three human difficulties propose a dive against an actual watched purchased tank in the safe scene. A current visible own rifle inside the blast/stick hazard suppresses dive/bombing proposals. Safe scenes retain the entire identical plan. The legacy decision-only plan is byte-identical in the friendly scene. This proposes intentional human safety across all authored difficulties; no source instruction declares friendly bombing to be intended Easy/Normal slippage. ROOT must choose that policy when adopting.

## Review distinctions and scope limits

R7 F1a grader-side v3 footprint/readiness checks are present and unchanged. R7 F1b and R8-4 runtime support/AP/MG looseness are real. R8's concern about absent dive/bombing friendly guards is confirmed as actual native friendly damage.

Current commander credit is already accepted-command-only. It checks the fixed enqueued descriptors against the actual command after ordinary submit returns undefined. There is no queued/future command credit defect in that path. The retained refused physical negative proves that existing protection. The review's claim that every runtime-v3 mismatch necessarily causes end-censoring is too broad: some mismatches do not occur in a natural useful plan, and other independent later responses remain possible. This bounded fixture proves one false ACK, not a campaign effect or numeric gate closure.

This patch addresses the named damaging-support and suppress/AP paths, plus dive/bombing planning safety. It does not claim complete equality with tools' v3 predicate. Existing stance, generic smoke, aimed barrage, movement/attack and other branch purpose definitions remain separate gameplay questions. No runtime import references tools, grading policies, responseRequired, responseUnits or private populations.

## Reproduction

The scratch directory includes copied archive shared/client runtime and package.json, with dependency symlink to the same V21 archive. It additionally has original priority/AI/commander copies under `*-before.js`; only their priority import path changes so each physical baseline uses the actual original predicate. Production candidate imports remain untouched.

```
taskset -c 3 nice -n 19 node /tmp/human-ai-r8-purpose/native-purpose.mjs /tmp/human-ai-r8-purpose/native-purpose.json
taskset -c 3 nice -n 19 node /tmp/human-ai-r8-purpose/physical-support.mjs /tmp/human-ai-r8-purpose/physical-support.json
taskset -c 3 nice -n 19 node /tmp/human-ai-r8-purpose/planner-support.mjs /tmp/human-ai-r8-purpose/planner-support.json
```

All three final logs PASS:20 purpose rows,3 physical scenes,7 planner scenes. No matches, full suites or grader rescoring were run. Proposed source hunks: `/tmp/human-ai-r8-purpose.patch`, only shared/ai-priority.js and shared/ai.js.
