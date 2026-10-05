# Prospective manual-response measurement, version 2, integrated candidate

Status: reviewable candidate, not adopted and not campaign evidence. Julio authorized a prospective scorer correction while keeping the original timing limits. This proposal changes measurement only. It changes no controller behavior, motor timing, resource rules, APM budget or historical result.

The proposed policy is `screen-manual-v2`, with stream schema `ww2-public-manual-response-v2`. Root must approve and freeze this rule source, capture adapter and tests before a new campaign. No new campaign has run. V15's original scores remain failed or not evaluable exactly as recorded.

## What the new measurement asks

The gate asks how long a player takes to complete a physical response when a newly observed situation needs new manual action. A squad already performing a legal useful automatic response, or correctly holding an unthreatened fortified position, does not need another click simply because a contact row was created. An already-started protective key for an earlier cue can cover a later cue. These are creation-time exclusions with explicit evidence. They are not human response samples at zero seconds.

The detector retains every actual public screen-contact and screen-damage creation descriptor. Each gets `required`, `monitoring` or `unknown`, its reason, every initial candidate actor, every actor still needing action and each covered actor's proof. One covered actor cannot exempt an event while another eligible actor still needs action.

The unchanged `screen-v1` oracle and provenance remain separate diagnostics. Its complete raw creation population, same-frame mappings, unknown raw events, original and observed scoring, and both primary-only and explicit-linked scores remain in the report. This new policy does not overwrite those streams or reinterpret V15. Private oracle facts never reach perception, planning, hands, input logs or the server.

## Public creation facts

The grader records a detached masked scene at creation. It accepts current camera-visible actors, public unit types and positions, own orders and stances, selected HUD values, rendered health and suppression bands, public terrain, visible smoke, objectives and possible own retreat homes. It does not accept exact unselected HP, hidden cooldowns, remembered off-camera enemies, incoming private projectile solutions, planner concerns, bot difficulty or a random draw.

The scene carries actual recording and observation clocks. Event observationTick must match the scene and event creationTick must match the recording clock. A missing or contradictory proof stays unknown. The stream listener starts at match tick 0, while public setup 0 and first actor delivery 2 remain unchanged. Listener coverage is distinct from the frozen raw oracle's tick 0 baseline.

World health bars have a 5% rendered step. The proof records a conservative interval around that displayed value. A single selected-type HUD supplies the displayed integer HP and its ceiling interval. A positive exemption requires the whole interval to establish safety or the automatic threshold. A threshold-straddling bar is not proof. Pinned suppression is the actual public 90% tag.

Line-of-sight proof uses only the delivered public map and smoke. Unknown World cells cannot establish clear fire. The engine's public weapon table supplies ranges, minimum ranges, setup requirements, moving-fire capability and area-order rules. Salvos retain their actual arc rule. No future damage result is used to decide whether a hold was correct.

## Candidate actors and creation exemptions

Contact candidates retain the existing 45m neighborhood and idle controllable ground-combat requirement. Damage candidates use a displayed 25% loss since the preceding public observation, or a crossing of the existing retreat-risk conditions: below 35% health, the last model, or pinned 90% suppression below 60% health. Buildings, aircraft and carried actors remain ineligible. Aircraft and carried damage rows are retained with the explicit outside-ground-damage-policy reason. Missing preceding public damage data is unknown.

Apply these exemptions per candidate actor, in this order:

1. Already retreating: the fresh public retreat flag proves protection is underway.
2. Automatic retreat provable: automatic retreat is enabled, the unit is mobile and not the scripted owner, its entire public health interval is below the unchanged 35% trigger, and all possible known homes are farther than the unchanged 15m radius. Classic includes every own production identity conservatively, even an unfinished one. An uncertain nearest home in World remains required.
3. Paid protection in flight: an actual issuing retreat key began before this creation, its exact actual selected actor and earlier damage cause are recorded, and the earlier public cause independently required protection. It must be a physical key start, not selection, queue admission or an AI job label. The motor is still active when the event is created. The detached start receipt must have been observed at its actual start tick, must bind that actual job and keyboard chord, and must establish its active interval. A native creation registry must contain the complete earlier cause descriptor. The grader recomputes that earlier public demand rather than trusting a supplied required label. A missing registry, forged earlier cause, completed key or unrelated actual selection cannot exempt the later event. All known retreat homes must avoid the ranges of currently visible armed enemies. A newly threatened home prevents the exemption. The later event gets no reaction credit from this earlier motor action.
4. Automatic useful combat: the whole public health interval is outside the fixed retreat-risk region, the visible weapon can legally fire at a visible hostile, its movement/setup/hold-fire/area-order conditions permit firing, and the weapon is useful against that target class. A newly visible contact inside a legally ready firing line can be acquired automatically without a positive targetId yet. Salvo minimum range still applies.
5. Fortified monitoring hold, contacts only: the actor is already in a garrison or trench, is provably outside retreat risk, no visible hostile can legally threaten it, and no nearby public objective is contested. An idle squad in the open, Hold Position alone, or a garrison under legal fire does not qualify.

Small-arms chip damage is not a useful armor response. For a vehicle target, useful combat requires vehicle damage greater than infantry damage in the public weapon table. An infantry actor inside the legal range of a visible anti-infantry vehicle, with an ineffective weapon against it, remains required even while firing elsewhere. This is a type-based role check, not a whitelist of the tank names seen in R6. Pinned low-health holds always remain required unless actual retreat protection is independently proven.

The fortified-contact rule acknowledges an existing defensive position. It does not classify an idle contact as harmless because the enemy happened to pass, or because the squad survived later. Death within one second, disappearance from camera, later auto-retreat, or eventual automatic firing cannot retrospectively change creation eligibility. Such later transitions may be reported as competing resolutions in a separate diagnostic. They do not supply a human latency, remove a required event or make the gate pass. The candidate deliberately retains end censoring for every unanswered event that required action at creation.

## Causal physical endpoints

Retain the original endpoint: the first completed causal non-camera physical input. Also report the first actual accepted command separately. A deliberate selection attempt may miss and still count as an attempted first action; actual selection alignment is separate. Accepted commands require their actual actors, public click-time geometry and authoritative acceptance. Intended metadata alone cannot pass that endpoint.

An operation must declare complete immutable already-delivered event descriptors at enqueue, its real command recipe, the enqueue public scene, its motor start and receipts bound to the actual native job and action identity. Each receipt contains the immutable native input descriptor and command recipe. Both endpoints require safe integer native enqueue/start/completion clocks, exact enqueue equality and the same operation. Input indexes alone cannot establish attribution. A command-only row, another job's selection, reused receipt index, changed descriptor or motor start before enqueue is rejected. Links cannot be inferred from the nearest later command. Every link must precede enqueue and motor start and be no more than 240ticks old at enqueue. A timely queued response completed after a cap wait stays eligible. A later-arriving event cannot be attached retrospectively.

Public UI intent and input semantics establish operation attribution. AI concerns, random draws and planner grading labels cannot establish eligibility. Human logs lacking public creation state or explicit operation attribution remain unknown; command-only rows cannot impersonate physical reactions. This candidate does not claim that Julio's present recorder supplies those missing fields. His existing logs retain their measured command/key timings and unknown reaction fields.

Completion below the unchanged 0.2 s floor receives no manual credit. Automatic actions and in-flight protection never create a fast-response sample. Each physical input remains one native row and one APM input even when it serves multiple events.

## Accepted command purpose

The new independent predicate is narrower than any-command-to-a-squad. Its initial supported command set is:

| Command | Public purpose required |
|---|---|
| Retreat | Actual affected actor and damage demand, or a visible legal local threat related to the contact. The obsolete 24m retreat-origin restriction is removed. |
| Move/attack-move withdrawal | Actual affected actor, visible threatening enemy, at least 2.5m greater separation from a related threat, no closer approach to the other current threats, and no entry into a newly threatening visible weapon range. The 2.5m size comes from the engine's attack-move arrival tolerance, not a timing fit. |
| Attack/attack-move defense | Actual affected actor, visible hostile, useful weapon match, legal range, and geometry serving the delivered contact or threatening actor. A casual move toward armor is not a useful response. |
| Take Cover/garrison | Actual affected actor under a legal threat and a known public nearby cover/building option. Acceptance additionally needs the first next delivered public receipt showing the same actor's defensive path or actual improved cover/garrison, before another command to that actor. The receipt is bound to its canonical public frame index and exact observation/recording clocks. A delayed cover scene or a path installed by an intervening command is rejected. Receipt acceptance alone is insufficient. The recorded response time remains the physical issuing input's completion, not arrival time. |
| Neighbor grenade/satchel | Actual helper, fresh selected-HUD readiness, legal ability range, blast overlap with a visible hostile threatening the affected actor, and no visible friend inside the blast. A helper need not be one of the original required actors. |
| Smoke support | Actual accepted support, on the affected actor within its protective footprint and the existing 24m event neighborhood, addressing damage or a visible legal threat. A smoke center 25m away, unrelated target or unproductive support cannot qualify. |

Other commands, including buys, building work, generic stop/stance toggles and unsupported ability forms, receive no new credit. Wider support/defense forms need separately reviewed public footprint predicates. They must not be silently admitted as any actor action.

The prototype's smoke test is deliberately conservative: the center must lie inside the public 7m cloud radius of the actor, in addition to the 24m neighborhood. It does not infer eventual random cloud locations or damage outcomes. The public support command's effect and purpose are sufficient; the later support arrival is not a motor endpoint.

## Stream and reducer contract

`log.manualMeasurements` contains:

```text
schema, policy, startedTick, operationLinksRecorded
creations: creation, decision, reason, creationUnits, manualUnits,
           coverage, publicProof, publicBaseline, inFlightProof
operations: id, queuedTick, inputStartedTick, command,
            events(full descriptors declared at enqueue), publicScene
physicalStarts: id, operationId, registeredAtTick, queuedTick, startedTick,
                lastActiveTick, completedTick, kind, input, fire,
                intendedIds, actualSelectedIds, command, events
inputReceipts: inputIndex, operationId, startReceiptId, tick,
               recipe, nativeDescriptor
receipts: commandIndex, inputIndex, operationId, startReceiptId, tick,
          publicScene, publicAfter, publicAfterFrameId
publicFrames: id, tick, scene
```

Native `log.events`, `log.inputs` and `log.commands` are unaltered. All grading proofs and receipt annotations live in the separate tool-only stream. The reducer recomputes creation eligibility from the public proofs and rejects inconsistent derived decisions. A native creation omitted from the stream is retained as unknown. Historical logs without this stream keep their original reducers and results.

`createManualResponsePolicy({CELL, CFG, UNITS, SUPPORT, COVER, los, bindings})` constructs the detached grader after the worker source checkpoint. `manualResponseMetrics(log, seconds, publicGameRules)` produces the proposed score. Importing the candidate collector does not import the simulation before its source checkpoint. The rule helper and the actual client binding table are included in prospective checkpoint hashes. The in-flight key must match that binding and have a current active-at-creation motor receipt; its prior cause is independently reclassified from public evidence.

Outputs include total creation, required, monitoring and unknown counts; reasons and per-actor exclusions; every creation row; first-completed-action and accepted-command KM distributions; answered/end-censored counts; immutable-link/timing/actor audits; and the unchanged native physical-input count. Missing coverage, physical recording or operation instrumentation, a zero required population, or an unidentified KM median cannot be marked pass.

Numeric limits are unchanged: Easy 0.9 to 1.4 s, Normal 0.5 to 0.8 s, Hard 0.3 to 0.45 s. Off-screen alerts, APM, opening delays, locality, peak caps and all original gate reducers remain unchanged. A fresh full population run is required before claiming anything about pass rates.

## Evidence and limits

`native-counterexamples.json` retains four exact R6 identities and their native inputs/commands. It is historical diagnosis only, not a V15 rescore. Hard 1 slot 2 garrison contacts at 870 and 1018 illustrate automatic firing and a stationary defensive hold. Hard 1 slot 2 contact 1794 illustrates a real selected squad retreat rejected by the old spatial predicate. Hard 3 slot 0 damage 1820 illustrates a retreat key already physically underway: motor start 1818, completion 1821, responding to earlier damage 1806. It must not be called an automatic retreat or a 0.05 s response to 1820.

The native fixtures prove actual engine automatic acquisition/fire, actual automatic retreat, actual garrison holding, a paid hands retreat, a real neighboring grenade, and a real Take Cover path. Their adjacent negatives cover Hold Fire, blocked/unknown terrain, unset crew, armor danger, pinned damage, unknown/near/disabled auto-retreat, queued-only protection, wrong actual selection, unrelated commands, tiny moves, wrong targets, missing public receipts, future/stale links, altered descriptors, human command-only logs, incomplete event retention and unidentified KM.

Three real hands levels each compare disabled grading, public grading and mutated detached proof. Every control has native physical inputs and accepted/refused commands. Complete game values and graph aliases, all native inputs/receipts and the next Math.random value must match. The tests persist only small proof metadata/native timelines by explicit evidence opt-in.

The integrated candidate adds an actual opt-in public capture adapter. Run `node tools/ai-humanity.mjs --manual-policy screen-manual-v2 --mode conquest --level hard --seeds 1 --seconds 15 --workers 1 --out FILE`. The option retains full logs automatically. It is rejected with the legacy controller. Original metrics stay in their current fields. Additional per-seat `metrics.manualResponsePolicy` and pooled `summary[mode/level].manualResponsePolicy` carry the new score. This command is a collector smoke, not campaign acceptance.

The adapter uses the existing explicit native commander memory option. That memory contains only the native controller's own fields. Separate grader WeakMaps bind actual queued job/action identities to detached operation and motor receipts. A separate public perception state records masked creation facts from the same actual delivery, camera and selection. No callback proof, manual unit list or original oracle flag is placed in controller memory, command contexts or native input rows. The adapter declares qualifying already-perceived event links at the actual enqueue clock from public command purpose. It never scans future commands to infer links. Missing prospective enqueue/start capture fails closed.

The native motor/reaction scheduler is unchanged. Every linked stimulus uses the same completed physical input timestamp. The grader inserts no wait, rewrites no native reaction timestamp, shortens no pointer duration and generates no extra physical input. A recorded completion under0.2s is rejected for that particular stimulus. All original and observed primary-only/explicit-linked scoring remains beside the new score, including original failures and censored events.

All nine mode/level cases compare three treatments for15s each: disabled, enabled and maliciously mutated detached public proof. The integrated controls preserve complete native game values and cyclic/typed-array graph aliases, all physical inputs, command acceptance/refusal/resource receipts, the next Math.random value and every original seat metric. A natural native hands fixture establishes first-action and accepted-command attribution without injected runtime grading fields. The fixture's complete operation and start receipts are captured by the adapter itself.

Existing human logs cannot retroactively supply absent creation or operation proofs. Their command/key timings remain measurable; corrected manual reaction remains unknown. No campaign should use invented fields. The reviewed original proposal is retained separately under /tmp/human-ai-manual-response-v2. This integrated candidate is not adopted, and no new gate campaign has run. Approval, a source freeze and prospective preregistration remain required before launch.
