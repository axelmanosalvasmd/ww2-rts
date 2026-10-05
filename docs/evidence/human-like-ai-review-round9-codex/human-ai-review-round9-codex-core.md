# Human commander, Codex core review, round 9

Review-only checkpoint on 2026-10-05. I read `docs/human-like-ai-spec.md` first, then `AGENTS.md`, `CONTEXT.md`, earlier review findings, the current runtime and the native evidence for the recent fixes. I made no repository edit, commit, external call, campaign or benchmark. This is a source and evidence review, not a release approval.

## Verdict

I found **no new demonstrated core gameplay, information-fairness or physical-command defect** in the reviewed source. The earlier round 8 visible tells have source corrections and bounded native controls. The risk escalation and AP readiness changes are similarly supported by authored native episodes and neighboring negative controls. These controls establish their stated behavior, not population rates or all-mode outcomes.

**Core merge status remains pending.** The current 102-child `node test.js` run did not pass: its `test-world-teams.js` child reached the existing 180-second subprocess limit and the full suite exited 1. The cause of that timeout was not established by this review. A natural full-suite exit 0 on the final source, final CI and review remain necessary. The prior 99-child pass belongs to the earlier runtime. The original reaction, APM, opening, balance and performance numerical targets are assigned to [issue 48](https://github.com/axelmanosalvasmd/ww2-rts/issues/48) by the user's current scope. Their known misses are not core merge blockers; none is claimed to pass.

## Source binding

HEAD at review: `bbff3fae04e67a2647523d8625a8bbe9f36434bf`. Current SHA-256:

| File | SHA-256 |
| --- | --- |
| `shared/ai-commander.js` | `03a8b1aa9dedd607f2614f981b69e8a0dcda4d3e5ffa620f942785bb5f4e0225` |
| `shared/ai-attention.js` | `6f26746572a5071d95bb1590c85ae9fb44e09d7256407542ae0876fff6313090` |
| `shared/ai-hands.js` | `d209f6861bf1d4165012372d21398c46985d51e357b79009c5b7e4b8dffbdaa9` |
| `shared/ai.js` | `685c178754646223ba57cbf6b0d795b0676b0a5cba84f51bfdfcae0cd71bc005` |
| `shared/ai-priority.js` | `8bf45be46b77ac78436356190de8b2b2e26005e65879cf61b0a87f840484dc60` |
| `shared/ai-perception.js` | `50e611a932728940c5047a61bf4fd7554c696f93880d7907a952d8b39fdcf3fd` |
| `tools/ai-manual-response-policy-v3.mjs` | `c45e589d661b4980a79181ca987b503054ebb3e7e554f1bc272dd3eab50a6928` |

The listed commander, attention and hands hashes match the frozen R10 source supplied for this review. The worktree has existing uncommitted game and test changes; I left them untouched.

## Remaining tells and dispositions

| Behavior or evidence | Current location and support | Disposition |
| --- | --- | --- |
| Hard's useful physical throughput and screen reaction still miss historical numerical targets; some contacts go unanswered. | `shared/ai-hands.js:9-11` has the unchanged authored skill bands; `shared/ai-attention.js:309-448` schedules one concern. `docs/human-like-ai-spec.md` records the completed V21 Conquest 60-match sample: screen-manual-v3 medians 3.50/1.65/1.15 seconds and physical APM 26.834/42.167/59.667. These are historical source-bound measurements, not a current-source population. | Deferred numerical gate in issue 48. A newly demonstrated unfair or broken command would still be a core defect. |
| Opening variety, faction balance and counted-tick performance have historical numerical misses. | `docs/human-like-ai-spec.md`, Phase 5, retains the V21 populations and round 8 performance rows. Current `shared/ai-attention.js:431-448` and `shared/ai.js` do not prove that a final-source population meets those bands. | Deferred numerical gates in issue 48. No current pass claimed. |
| A second hurt actor can be served after the first actor's paid visit. | `shared/ai.js:824-938` ties attended danger to the named actor or damage event; `shared/ai-commander.js:479-514` queues bounded work through one camera and real hands. Earlier R8-7 gave no failing second-actor episode. | Intentional sequential camera behavior. Population timing belongs in issue 48; no core defect shown. |
| Conquest's stationary-armor and unseen-hit home-retreat fallbacks do not run in Classic or World. | `shared/ai.js:871-875,895-902`; `DESIGN.md:2202,2228` records the reason: those modes retreat toward production buildings and need separate public destination safety proof. | Documented safety boundary, not a regression finding. A concrete unsafe or missing response in those modes would justify a separate focused fix. |
| Quiet guards previously caused repeated empty camera trips. | `shared/ai-attention.js:191-242` records the watched empty visit and reopens on public changes; `shared/ai-commander.js:517-524` applies it only after an empty plan. The native quiet guard, flank, construction, grenade, ordinary idle and Engineer controls in `docs/evidence/human-like-ai-r8-fixes/guard/README.md` support the correction. | Prior visible tell corrected. The remaining occasional inspection is human-like and has a bounded 30-second retry. |
| Diagonal pans previously drew right-angle paths. | `shared/ai-hands.js:545-559,833-839` prepares and holds both actual direction keys; `docs/evidence/human-like-ai-r8-fixes/pan/README.md` records client-frame parity and interruption/APM controls. | Prior visible tell corrected. |
| A fortification could be followed by a stale `cover` refusal. | `shared/ai-commander.js:154-162` blocks that actor's pending cover until the next delivered frame; `shared/ai.js:1037` is the planner source. The round 8 fortification controls exercise accepted and refused native operations. | Prior command defect corrected. |
| Support and selected abilities could acknowledge a contact they did not usefully address. | `shared/ai-priority.js:9-26,56-129` now checks the public footprint, friend hazard, effective target class and selected-HUD readiness for the named branches; `shared/ai.js:652-655` guards human dive/bombing planning. `docs/evidence/human-like-ai-r8-fixes/purpose/README.md` includes actual accepted misses, refused commands and friendly dive damage. | Prior supported defect corrected for the specified branches. Other purpose branches have no demonstrated natural failure in this review, so I do not turn their looser predicates into a new blocker. |
| A newly watched risk crossing could wait behind an older escape approach. | `shared/ai-commander.js:21-30,260-283` permits narrow equal-rank interruption. `docs/evidence/human-like-ai-r9-risk-escalation/README.md` records Normal risk at tick 168 and accepted native retreat at 179, with six rather than ten inputs and the same three native commands. `/tmp/ai-equal-risk-independent-held/REVIEW.md` records a started G key that completes before cancellation and retreat. | Prior core defect corrected for the authored case, with started physical input preserved. No population latency claim. |
| Selected HUD showed AP ready while an empty combat area stayed deferred. | `shared/ai-attention.js:72-81,120-159` now uses the planner's actual watched vehicle class to notice the opportunity; `shared/ai.js:952-953` checks the same class. `docs/evidence/human-like-ai-r9-ap-readiness/README.md` records HUD readiness at 102, accepted AP at 120 versus 149 before, and real target HP 180 versus 240 at tick 136. Cooling, infantry, tank, offscreen and unknown-readiness controls are bounded as declared. | Prior core omission corrected in the native case. No response-median or all-target guarantee. |
| Human slips have authored native proof, but live 3D proof of the latest source remains limited. | `test-engine-ai-human-slips.js` and `docs/evidence/human-like-ai-r8-human-slips/README.md` show a six-second unnoticed idle MG, MP accumulation during combat and paid flank response at 4.60/2.75/1.05 seconds. `/tmp/human-ai-pr-lab-proof/README.md` reports a current-source 2D lab clip with 60 simulated seconds, 19 physical inputs, five native orders and no console errors. The older normal 3D clip predates the latest runtime; the latest R9 3D attempt did not yield a usable final clip. | Component behavior verified; keep the browser evidence qualification explicit in the PR. If the project requires a latest-source real-time 3D recording for the browser gate, that proof is still pending. |

The current purpose function is not identical to the v3 measurement policy for every possible command, notably generic smoke, aimed grenade/barrage, stance and movement (`shared/ai-priority.js:91-127` versus `tools/ai-manual-response-policy-v3.mjs:195-262`). That is a possible future diagnostic, already acknowledged in the round 8 purpose evidence. I found no native episode in the provided material where one of those remaining differences creates an actual false acknowledgement on this source. It is therefore not a supported new core blocker.

## Verification limit

I inspected source and archived native controls and checked hashes. I did not run a new fixture because the focused modules and their exact source bindings already cover the recent changes, while the full-suite failure is being investigated separately. I did not accept a historical pass as final-source CI or convert a numerical miss into a gameplay defect.
