# Human-like AI verification: archived V14

The completed V14 campaign is **failed acceptance evidence**, not current release proof. All 120 matches and 360 seats completed on the frozen runtime checkpoint below. Required-screen reactions fail wherever the median is identifiable; World Easy is not evaluable. Workload, first-order, opening-variety, performance and full-suite failures remain failures. Later R5 corrections require fresh verification on their own source.

## Scope and immutable evidence

Conquest ran seeds 1-20 at each difficulty; Classic and World ran seeds 1-10. Every match ran exactly 180 simulated seconds, with three faction seats, standard starting armies, the default map and Huge World configuration where applicable. Two workers inherited CPU 6 affinity. This is a humanity measurement sample, not the full-match faction-balance or old-commander duel gate.

Runtime checkpoint: `7c87de19ed1196044efbabad0d63bb8774d52acdd35e7695efac053a1f7c74a9`. The [complete source manifest](evidence/human-like-ai-v14/source-archive.json) records 43 archived files, including executable oracle and provenance. The [source archive](evidence/human-like-ai-v14/source.tar.gz) has SHA-256 `a4e605b3f924f7ac22ede29d394d0b206b17df60a671eb83a5b997120d1b09c9`. The runtime fingerprint records collector `8326d7c0aa0f2b25f8e1307bcda857ac563a5c7c7c91e435c32542489341e951`; it is historical source, even though the collector's output labels it “current.”

The [full raw gzip](evidence/human-like-ai-v14/final120-full.json.gz) preserves every timeline and private measurement frame. It contains 16,845 private frames, 42,574 native inputs, 19,748 native events and 12,560 native commands. Its 16,775,131 compressed bytes have SHA-256 `f73890986df3502ac1e2b69e18a71ee22a7c563715abc746331437f026ab30e5`. The 429,134,109 decompressed bytes have SHA-256 `714cb8bbabc54607e9c4d95cd13848e09b8a7a6677154d6374d86f22f9998ca2`.

[Independent verification](evidence/human-like-ai-v14/independent-verification.json) checked all 120 original mode/level/seed pairs, 360 seats, all 120 original per-match archives, recording from the first delivered frame and unchanged source hashes. The [protocol preregistration](evidence/human-like-ai-v14/protocol-preregistration.json), [raw-match manifest](evidence/human-like-ai-v14/raw-match-manifest.json) and [serializer proof](evidence/human-like-ai-v14/serializer-proof.json) retain configuration, byte hashes and native timeline digests. These are integrity checks, not acceptance passes.

The first ordinary collector attempt finished 60 Conquest simulations, then exceeded Node's 536,870,888-character string limit while writing the full JSON report. That attempt has no recoverable complete timeline report. Its source, progress and failure logs remain at `/tmp/human-ai-final-observed-runtime-v14`. The authorized external recovery reran every original seed through the frozen Worker API and streamed lossless per-match gzip records. It changed storage only, not source, populations, endpoints or bands. The first verifier rejected legitimate null seat populations; its failure log is preserved and the corrected verifier compares those nulls unchanged.

## Original gates and full populations

The original screen-v1 oracle population gates acceptance. Original and screen-observed-v1 populations are both retained, each with primary-only and explicit-linked scoring on identical native timelines. Only immutable same-frame aliases map a runtime event to an original stimulus; an original event with no perceived counterpart stays censored. Private grading flags do not enter planner memory. Completion of the first causal non-camera physical input remains the on-screen endpoint. Pointer or key preparation is a separate clock, and attempted/accepted commands are separate endpoints.

The [summary](evidence/human-like-ai-v14/summary.json) retains all nine groups, all four policy/scoring combinations, required/answered/censored counts, command endpoints, alias audits and exact original bounds. The [360-seat population archive](evidence/human-like-ai-v14/seat-populations.json.gz) preserves the same endpoint distinctions per seat. The [complete gate analysis](evidence/human-like-ai-v14/gate-analysis.json.gz) and full raw gzip retain the detailed censored intervals and survival curves. Primary-only and linked scoring always use the same required population. No unanswered event is dropped to make a median pass.

The original on-screen median bands remain Easy 0.9-1.4 s, Normal 0.5-0.8 s and Hard 0.3-0.45 s. The physical minute APM bands remain 20-35, 40-70 and 80-120; ten-second peak caps remain 60, 120 and 200. APM below is the median of seat means over all complete minute windows, including quiet periods. Screen seconds below are pooled Kaplan-Meier medians, with recording-end censoring. A null median means the curve never reached half answered; it is not zero or a pass.

| Mode / level | Original required / answered / censored | Original screen KM seconds | Physical minute APM median | Peak ten-second APM max |
|---|---|---|---|---|
| conquest / easy | 383 / 219 / 164 | 4.95 | 27 | 60 |
| conquest / normal | 485 / 317 / 168 | 1.6 | 41 | 120 |
| conquest / hard | 426 / 239 / 187 | 3.4 | 57.167 | 168 |
| classic / easy | 75 / 45 / 30 | 2.25 | 24.5 | 60 |
| classic / normal | 72 / 40 / 32 | 4.8 | 35.167 | 120 |
| classic / hard | 78 / 45 / 33 | 1.75 | 47.667 | 198 |
| world / easy | 14 / 5 / 9 | unknown | 30 | 60 |
| world / normal | 14 / 9 / 5 | 0.9 | 36.5 | 120 |
| world / hard | 13 / 7 / 6 | 0.8 | 47.5 | 162 |

All eight identifiable original screen medians fail. All eight identifiable observed-policy medians also fail; World Easy stays unidentifiable under both policies. The primary-only original median is identifiable only for World Normal, at 1.65 s, which also fails. Switching to a conditional answered median or a different policy cannot close this gate.

Physical APM fails Conquest Hard, Classic Normal/Hard and World Normal/Hard. Other group medians are in band, but the summary also preserves every out-of-band seat and minute window. Peak caps pass all nine groups. The first-order ranges remain 4-8/3-6/2-4 seconds; Conquest Hard, Classic Hard and all three World levels each contain one out-of-band seat. Their group medians are in band, so a median-only statement would hide these failures. Maximum first-order times are 4.05 s in the two Hard non-World groups and 9/6.85/4.05 s in World Easy/Normal/Hard.

Conditional answered off-screen medians are in band in all nine groups, but alert required-response eligibility was not measured. That gate remains not evaluable. Completed original and native screen responses respect the 0.2-second floor, command count never exceeds one per tick and quarter-second cross-screen command pairs are zero. These passing invariants do not outweigh the failed population gates.

## Opening families and useful-work diagnostics

The accepted opening gate uses the first five accepted purchase families during the first 45 seconds, over 20 Conquest seeds per faction and difficulty. It requires at least three meaningful sequences and no sequence above 50%. Coordinates contribute no novelty; rejected purchases do not count. Seven of nine groups fail concentration. Each cell shows distinct meaningful sequences / most common sequence share:

| Conquest difficulty | USA | Germany | USSR |
|---|---|---|---|
| easy | 5 / 70% (FAIL) | 3 / 65% (FAIL) | 3 / 75% (FAIL) |
| normal | 4 / 65% (FAIL) | 3 / 70% (FAIL) | 6 / 30% (PASS) |
| hard | 5 / 70% (FAIL) | 5 / 35% (PASS) | 6 / 55% (FAIL) |

First-purchase-family concentration is a separate diagnostic, not another mandatory gate. Classic and World have only ten seeds per faction and cannot certify the twenty-seed opening gate. All accepted sequence counts remain in the summary.

Across the campaign, 720 of 904 group bindings were never recalled within the recording (79.65%). All bindings remain in raw physical APM. This diagnoses low observed reuse; a binding unused in this short window is not automatically proven filler for an entire match. HUD inspection acquired its intended selection in 1,234 of 1,472 attempts; 238 failed acquisition (16.17%). This is the inspection-acquisition diagnostic, not the miss rate for every ordinary pointer click. Per-group attempts, outcomes and input counts are retained. Neither diagnostic is used to delete inconvenient inputs or redefine a failed gate.

## Performance, full suite and later corrections

The [fixed four-row performance protocol](evidence/human-like-ai-v14/performance-protocol.json) fails. Every row used 1,000 ticks, six fronts, six seats and logical CPU 6, in the predeclared exact legacy/current then stats-only legacy/current order. Its immutable archived sources matched before and after. The owned Classic runner was paused for 26.71 seconds and resumed with its identity guard. No unchanged-source repeat replaces these rows.

| Pair | AI p95 before / after | AI max before / after | Full ticks over 40 ms | Result |
|---|---|---|---|---|
| Exact CLI | 8.966 / 11.226 ms | 62.073 / 45.881 ms | Not instrumented | FAIL: p95 exceeds its 2 ms allowance |
| Stats-only counts | 9.544 / 10.895 ms | 55.203 / 60.264 ms | 3 / 10 | FAIL: seven additional over-budget ticks |

Both maximum checks and the counts-pair p95 check pass their original max(2 ms, 10% baseline) tolerance. The four individual reports remain beside the protocol. The counts patch changes only the final statistics helper, with the measured loop byte-identical. Concurrent profiles and later component improvements are not substitutes for this release benchmark.

The [frozen V14 full-suite record](evidence/human-like-ai-v14/full-suite-verification.json) reports exit 1, with all 611 file hashes and HEAD unchanged. The [full log](evidence/human-like-ai-v14/full-suite.log) has SHA-256 `1e9e06e4892fd6c12c792f465c1fd177fcb4f214f907d8e0cd64c25d94eb68e3`. The bridge rebuild assertion at test.js:7391 failed. Passing fog, hands and capture component portions do not certify that failed full run.

The later [bridge component proof](evidence/human-like-ai-v14/bridge-post-v14-proof.log) reports forty seeded native repairs, all within sixty seconds, with a maximum 51.4 seconds and positive/negative watched-cue controls. That proof belongs to the post-V14 repair correction, whose planner and attention source differ from the frozen checkpoint. The server setup-order WebSocket checks are also separate component evidence. These later corrections neither overwrite the V14 failure nor establish a new full-suite, performance, humanity, balance or browser pass. Later moving-target selection and partial-selection corrections pass their component tests on subsequent source. Attention corrections are still being integrated. They require their own source freeze and release verification.

## Artifact size and audit limits

The durable bundle keeps the full raw gzip, the gate-analysis gzip, small group and seat summaries, source archive, manifests, four benchmark rows and verification logs. It excludes the 429 MB decompressed full JSON, the redundant 107 MB compact JSON and duplicate per-match raw archives. The compressed raw report still contains every match's full graph. Individual original gzip byte hashes remain in the manifest and independent proof; rerunning that particular 120-file check requires the original raw-matches directory. The supplied historical scripts have their original /tmp paths and must be repointed deliberately for a different checkout.

Verify compressed and decompressed full-report hashes by streaming gzip chunks, rather than allocating a campaign-sized string. The complete source tar and manifest let a reviewer restore the exact executable oracle and collector. Original baseline reactions remain unknown because the old commander had no matching event instrumentation; the baseline screen span 160 and current 113 also prevent direct spatial comparison. The sample's acceptance failure does not waive faction balance, old-commander duels, browser evidence or human calibration.

The historical Classic balance batch completed all thirty original matches, with no timeout, at the archived V14 source. USA/Germany/USSR won 7/8/14 games with one draw, or 24.14/27.59/48.28% of decisive wins. This fails the original 25-42% faction range; every match finished and the median remained 1,600 seconds. The corrected old-commander baseline was 12/7/10 wins and one draw (41.38/24.14/34.48%), also failing Germany's lower bound. The exact thirty-seed pairs, source differences and independent reducer are retained in `evidence/human-like-ai-v14/classic-historical-final-report.json`; `classic-copy-manifest.json` hashes the raw results, checkpoint, completion log and source evidence. This is historical evidence and does not certify the later R5 corrections.
