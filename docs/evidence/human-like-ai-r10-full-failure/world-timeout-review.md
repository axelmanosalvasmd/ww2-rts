# R10 World teams timeout review

The cause remains unresolved. R10 naturally exited 1 because `test.js:58` terminated `test-world-teams.js` at its unchanged 180000 ms subprocess limit. The child's last output is the server startup line. No native assertion failure or child completion was printed. No rerun, localhost experiment, source edit, timeout change or permissions workaround was performed for this review.

## Actual source and harness comparison

R9 and R10 contain the same 684 locked files except `test-performance.mjs`: its old 60000 ms per-process wrapper was changed to share the existing 240000 ms total budget with a 180000 ms per-process cap. That wrapper executes only at the end of test.js and was never reached in R10. The World teams child cannot import or execute it. Node executable/dependency bindings, test.js registration, command, CPU affinity, source-check policy and 180000 ms child timeout are identical between R9 and R10.

`test-world-teams.js` is byte-identical in R8 inspection-fixed, R9 and R10, SHA256 `7238f4706b7397c7be3ef1130cd4e15b9b30a705b39e6fefbf857043e093d245`. The unchanged server hash is `16004b2b7f3cd427d3fb61750a6a2788f9fe0e7bd8a22c92b4cd01d486677e57`.

The passing R8 inspection-fixed log records **53992 ms** and the passing R9 log records **49601 ms** for the AI fixture. Those times start at test-world-teams.js:110, after the Massive team/discovery/defeat/victory scene, the second World match startup and its initial ticks. They measure the final 300 AI ticks, not the complete child runtime. A different earlier R8-new log records 56642 ms; it is not the 53992 ms reference.

Between R8 inspection-fixed and R9, the runtime changed only shared/ai-attention.js (public AP readiness) and shared/ai-commander.js (equal-rank damage escalation); registrations and a few related tests also changed. R9 passed World teams with those runtime changes. Neither runtime module changed between R9 and R10. This removes a newly introduced R10 AI/source delta as an explanation but does not prove the absence of an intermittent runtime or terrain-dependent problem.

## What the retained failure cannot tell us

The fixture starts a 1024x512 Massive match and later a default Huge match. Both use real WebSocket clients. At server.js:281 each World start supplies `randomBytes(4).readUInt32LE()` to generateWorldMap. The fixture neither fixes nor records these seeds. Therefore identical source is not an identical terrain, pathfinding or AI scene. This is a concrete input difference the harness permits, not evidence that a particular seed caused this timeout.

There is no phase log between module startup and the final success at line119. The failure cannot distinguish Massive generation, team/discovery work, second match generation, or the 300-tick AI loop. `tick(n)` runs server.tickRooms synchronously before yielding; the fixture's 15000 ms message polling limit does not bound that synchronous work. The success is printed before final cleanup, so this is not an observed success followed solely by cleanup hanging. No child CPU/memory measurements or terrain seed were retained in this run. Host load cannot responsibly be named as the cause.

Final R10 verification records unchanged HEAD/runtime/archive, 684 unchanged source files and ten valid source checks. The actual check timestamps contain one **162.498-second gap**, despite the requested 15-second polling interval. This shows a monitoring observation gap and is worth retaining; it does not distinguish CPU scheduling, a paused host/process, filesystem delay or another cause. The valid endpoint checks must not be described as uninterrupted 15-second observations.

The current managed sandbox's localhost EPERM and restricted network/Git metadata are independent current execution blockers. R10 itself printed successful server startup, so its recorded failure should not be relabeled as a bind-permission failure. No less restricted agent was asked to bypass those restrictions.

## Conclusion

Do not weaken a gameplay assertion or widen this child timeout from these artifacts. A full-suite pass remains unproved. A later authorized execution should capture its actual World seeds and phase/CPU measurements before attributing the failure or choosing a corrective change. The present review leaves all source, tests and limits intact.

## Inspected artifact bindings

- `human-ai-r10-final-full-test.log`: `782d7848e0f6615459c2fa3d5e43dbef320d65154c71a2933c40a2a4c3dade8c`
- `human-ai-r10-final-full-verification.json`: `6c709423f923d5ec30c68aa2b7e854db20af44425875e772857910975eb4dab7`
- `human-ai-r10-final-full-checks.jsonl`: `a1c9df0642991d77a7c80d44fa27871380f50700858e58679afae6a0b49c4449`
- `human-ai-r10-final-full-before.json`: `f8a5b4961d430b661522425a46e72d2a7c86c02824e1559dbf68f613c28be640`
- `human-ai-r10-final-full-predeclared.json`: `bfcf2fa5c276b427121826bebe8b591b97fcc7131be6cebba7de34b3ea2b462f`
- `human-ai-r9-final-full-test.log`: `a6051ed7543094a5dfd57641a2bf441529694a1669a56579dc0f2ed3f1bfa594`
- `human-ai-r9-final-full-before.json`: `f2bdd74195cb4599e09e7bb258c7a53b60e84bc6a642644c474eeaa3a030355e`
- `human-ai-r9-final-full-predeclared.json`: `09b95bf139f1802f3f6bf873872639113b243040723a0f229b7b1abeec4b38fd`
- `human-ai-r8-inspection-fixed-full-test.log`: `ed166828b5133257272c384007c30fb65b183e7ac56fdee46479b7219c8b5fbb`
- `human-ai-r8-inspection-fixed-full-before.json`: `19587ef601dc68fff1c3ca836edc55a71d6f892c285816954a6ac73ec0fe2826`
