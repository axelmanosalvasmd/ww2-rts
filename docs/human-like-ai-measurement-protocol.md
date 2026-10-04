# Human-like AI measurement protocol: prospective Version 3 amendment

Recorded before the next runtime campaign on 2026-10-04. This amendment uses explicit links to measure one physical response to several already perceived stimuli. Version 3 is the prospective explicit-link scoring method for the next campaign. The same new logs must also report historical primary-only scoring. Neither method is selected after observing which passes.

The original brief authorizes the tools, research and corrections recorded here. The round 3 review is evidence to address, including its request for a written amendment. This document records that amendment within the existing scope. It does not adopt the proposed automatic-contact policy or certify release. `screen-v1`, its creation-time eligibility, and all original numeric bounds remain unchanged.

## Why one input may answer several events

A player can select a local squad and issue one relevant attack that answers two nearby contacts. A local artillery order can also answer several contacts inside the same response area. A single primary label arbitrarily credits one stimulus and suppresses the others even when the accepted command addresses each. This is a limitation of the label, not evidence that the other stimuli were ignored.

Explicit links correct that limitation only when the decision already knew each event and deliberately addressed it. Links cannot create or reclassify stimuli, manufacture missing eligibility, match a later arrival, or infer causality from whichever future command happened to be nearby. The primary label remains in the raw input record and in the comparison score.

## Creation population and immutable links

Perception records every delivered event at creation. Screen contacts and damage carry the existing `screen-v1` boolean, reason and eligible own-unit IDs. Alerts and minimap events keep their separate populations; they have no prospective required-screen eligibility. Minimap contacts remain exploratory and cannot enter either reaction gate.

Each decision job copies full descriptors from already delivered `view.events` that independently satisfy `servesEvent`. Its `responseEvents` array and nested descriptors are detached and frozen at enqueue. Every physical row gets a separate copy. A later caller mutation cannot change queued creation metadata or earlier log rows.

The collector requires an independently recorded creation event with the same `id` and `tick`, then matches `kind`, `source`, `onScreen`, `x`, `z`, `unitId`, `targetId`, `responseRequired`, `responsePolicy`, `responseReason` and `responseUnits`. Optional identity fields must agree when absent as well as when present. Missing population or eligibility remains unmeasured, rather than being reconstructed from outcomes.

Creation must precede both the job enqueue and motor start. The timestamps must be nonnegative integer ticks with `event.tick <= queuedTick <= inputStartedTick <= input.tick`. An explicit link must also satisfy `queuedTick - event.tick <= 240`, or 12 seconds at 20 ticks per second. The 240-tick boundary is inclusive. A 241-tick-old plan is rejected into `staleLinks`; its event stays unanswered and censored. A plan queued within the horizon can complete later after motor travel, queueing or an input cap wait. Age is tested at enqueue, not completion.

An instrumented row's link array is authoritative, including an empty array. Primary-only historical rows retain their existing semantics. In mixed logs, rows without an array retain that historical path. Duplicate links and repeated responses never create multiple first answers for one event.

## Completed response and actual command endpoints

The reaction endpoint remains the first completed physical input. On-screen stimuli require a non-camera input. An off-screen delivered alert may count a legitimate camera gesture as the first action. Command attempts and accepted commands are separate endpoints, so a refused command cannot be presented as an accepted answer.

For a required first action, intended `responseActorIds` must intersect the creation event's unchanged `responseUnits`. Support with no unit actors needs an explicit intended response target within 24 metres. A relevant selection attempt may miss; that still counts as a human attempt. Whether the actual selected IDs intersect the eligible IDs is reported separately.

An attempted or accepted command must match a submitted command at the same tick and independently qualify through its actual actors and geometry. Intended metadata alone cannot certify an unrelated command. Actual attack or pointed ability targets must be within 24 metres of the stimulus. Movement requires an eligible actual actor within 48 metres and an actual destination within 24 metres. Support uses its actual target within 24 metres. Direct own-unit retreat, stance, cover, stop or unpointed ability uses the event unit or an eligible local actor as defined in `linkedCommandServes`. Economy and fortification commands do not answer combat stimuli. These are declared locality proxies, not a claim that every accepted command was strategically useful.

Each linked event is independently validated and independently deduplicated. One local command can therefore answer two eligible events while a third event with an unrelated actor or wrong target remains unanswered. Links rejected for descriptor, timing, actor or geometry errors remain visible in audit counters. They never remove creation events from the denominator.

## Equal timing for primary and secondary stimuli

Hands samples the same authored reaction distribution whether the causal stimulus is the primary label or a secondary link. If a newly linked screen event or alert arrived after the choice clock started, its creation time becomes the response clock. The newest relevant link determines the sampled complete first-input budget. An older link does not restart a newer choice clock. Each fresh linked event is tracked even inside a visit whose earlier reaction was already paid.

Elapsed looking and deliberation, followed by the full motor duration, consume that budget. Hands adds any remaining wait; it never compresses physical travel to reach a deadline. Camera preparation cannot mark a screen reaction as paid. Repeated inputs answering the same event use the existing practiced pause after its first response, rather than sampling a new choice reaction for every key.

Every causal response also keeps the universal four-tick, 0.2-second floor, including the newest link. That floor is an additional lower bound, not a replacement for Easy or Normal reaction distributions. The authored distributions are not measured human recordings. A numerical pass would establish compliance with these declared bounds, not prove human speed or validate the scientific interpretation of Hard's interval.

## Population, censoring and dual reporting

All creation stimuli remain in the all-event tables. Every required `screen-v1` stimulus remains in its survival population, including unanswered and rejected links. Recording-end censoring records remaining follow-up time. A Kaplan-Meier median that cannot be identified is null and cannot pass. Conditional medians over answered events are shown separately and cannot replace the population result.

For newly instrumented logs, `reactionScoringComparison` records `primaryOnly` and `explicitLinked` per seat and in the pooled summary. Both use the exact same input timeline, command records, creation population, recording duration and completed endpoints. Primary-only uses the unchanged historical `input.event` reducer. Explicit-linked validates the declared links and enqueue horizon. Reports retain counts, answered fractions, censoring, survival curves and conditional medians alongside both scores. Queue, start and completion clocks remain available in full raw logs for independent timing analysis.

APM uses the original physical timeline. A box selection, key or click counts once even if it answers several stimuli. Reaction-only expansion of linked rows never increases APM, command counts or the number of actual physical inputs. Command APM stays separate from physical input APM. Raw logs are unchanged, and gzip packaging preserves their exact report bytes and source hashes.

## Original bounds and required-screen policy

| Measure | Easy | Normal | Hard |
| --- | --- | --- | --- |
| On-screen completed response median | 0.9 to 1.4 s | 0.5 to 0.8 s | 0.3 to 0.45 s |
| Off-screen alert to first completed action median | 3 to 6 s | 1.5 to 3 s | 0.8 to 1.6 s |
| Physical APM over full 60-second windows | 20 to 35 | 40 to 70 | 80 to 120 |
| Peak physical APM over 10-second windows | at most 60 | at most 120 | at most 200 |
| First order after start | 4 to 8 s | 3 to 6 s | 2 to 4 s |

The unchanged `screen-v1` contact population requires a novel hostile screen contact with an idle, controllable own ground combat unit within 45 metres. Damage eligibility uses the existing creation-time heavy-hit and retreat-risk rules, including 25% maximum health, health below 35%, the last live model, or suppression at least 90 with health below 60%. Existing source-proven retreat and already-engaged exemptions retain their original order and reasons. No new automatic-acquisition exemption, matchup predicate, actor-list narrowing or `screen-v2` policy is adopted here. The original one-command-per-tick, opening, locality and reaction-floor controls remain in force.

## Response to round 3

| Finding | Current response and evidence |
| --- | --- |
| M1: secondary links pay only the universal floor | `reactionDelay` treats fresh linked screen events and alerts as causal, samples the complete reaction budget from the newest stimulus, and tracks each link in a paid visit. `test-engine-ai-hands.js` compares primary, secondary-only and older-primary physical timelines across 40 seeds, each difficulty and both screen and alert sources. It also checks repeated visits, older-link controls, intact motor duration and camera preparation. |
| M2: arbitrarily old events can become answered | Commander filtering and collector validation use the same inclusive 240-tick enqueue horizon. `test-engine-ai-humanity-multievent.js` covers 240 and 241 ticks, rejects a 150-second-old enqueue, and accepts a timely plan whose actual input and attack complete at 150 seconds. Every rejected event stays censored. |
| M3: scoring change drives the result | This written amendment chooses explicit-link scoring before the next runtime campaign and requires both scores on the same new logs. The fixture has two identical stimuli: primary-only reports one observed and one censored; explicit links report two observed. Both have the same population and unchanged raw log. All 45 archived V10 primary-only seat metrics and complete pooled summaries remain exactly equal to the previous collector. Earlier provisional reports remain archived under their original definitions. |
| M5: an empty link array suppresses the answered-state primary fallback | Accepted-command bookkeeping uses the union of `responseEvents` and the primary event, then independently applies `servesEvent` to the accepted actual command. This corrects commander state. It does not inject an absent primary into explicit-link measurement; primary-only scoring remains separately visible. |

The three focused controls passed on the source snapshot below: `node test-engine-ai-hands.js`, `node test-engine-ai-humanity.js` and `node test-engine-ai-humanity-multievent.js`. This is focused proof of the amendment, not a fresh full-suite result or acceptance campaign. Round 3's control-group usefulness concern and other gameplay, performance, perception, balance and browser blockers remain separate work. No result from the next campaign exists at the time of writing.

## Source snapshot and next diagnostic

This snapshot records inspected source, not the final campaign freeze. The final archive must capture all runtime dependencies, including `client/keys.js`, before the first module import. Every worker must report the same checkpoint. If source changes before freeze, the campaign archive records the new bytes; this document's snapshot remains the review response evidence.

| File | SHA-256 |
| --- | --- |
| `tools/ai-humanity.mjs` | `4dff661f2fd4cf5de5a133089e1458412d52da529c11eb55e848939ecb05edda` |
| `shared/ai-commander.js` | `2b61352aadcd2f181b8683cc1f202b259ef2a6fde1b8fb4e77271e2e2a39318f` |
| `shared/ai-hands.js` | `e8ca564c24005e3b6be77e7a0e4165a346d9c9574a0fb6a99ebf115bb688c928` |
| `shared/ai-perception.js` | `b90ec63756812a27c5daf15a5b1700239031896064375d89e846c1753379d2a9` |
| `test-engine-ai-hands.js` | `9b7388e5a8f2fa317a42a8df4e0e4c793613bae55d0c7621860a426fd6b68e5e` |
| `test-engine-ai-humanity.js` | `5a3cc752690616638b54f8d855f938597471de915ad40a15bd4ae218e6871363` |
| `test-engine-ai-humanity-multievent.js` | `11b1c9c7908c469732aa90f6b44861ab439db0b65583a9a6669f58811fbe74eb` |

The prepared short diagnostic uses the same Conquest seeds 1 through 5 at each difficulty, 180 seconds, two workers, full raw logs and a 113-metre screen proxy. It is 15 matches and 45 seats, not the final 120-match acceptance campaign. It will run only after the root announces a source freeze. The archive procedure verifies source hashes before copying, after copying and against archive bytes, then makes the source tree read-only. Full and compact reports, exact gzip round-trip, timeline digests, both scorings, required censored populations, link audits, all seat rates, group use, actual commands and camera counts are preserved for review.

```sh
node /tmp/FROZEN_SOURCE/tools/ai-humanity.mjs --mode conquest --level all --seeds 5 --seconds 180 --workers 2 --logs --screen-span 113 --out /tmp/EVIDENCE/report.json
node /tmp/FROZEN_SOURCE/tools/ai-humanity.mjs --package /tmp/EVIDENCE/report.json --archive /tmp/EVIDENCE/full-report.json.gz --out /tmp/EVIDENCE/compact-report.json
```
