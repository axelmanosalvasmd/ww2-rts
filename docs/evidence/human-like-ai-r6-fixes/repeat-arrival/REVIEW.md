# Accepted movement destination receipts

The proposed commander-only patch fixes repeated movement clicks when a squad has arrived at the actual accepted formation or trench destination but that destination differs from the planner's point by more than the existing 2 metre arrival threshold. Production and the archived V15 source remain untouched.

## Scope and receipt

Only a real movement submit returning `undefined` earns a receipt. The existing callback convention means `undefined` is acceptance; any returned refusal earns no receipt. The receipt joins the actual actor destination to the complete corresponding planned physical job. It checks actual and planned actor sets, movement type and queue mode. Its canonical key preserves actor order, all row coordinates, membership and other command options, including facing. P1's actual narrowed job provides the intended rows after partial selection. There is no receipt for an unselected actor and no knowledge obtained from hidden units.

Arrival pruning happens after `mergeMovements`, using the complete physical operation key. It removes a row only when that actor has the same accepted intended operation and is within the original 2 metre threshold of its accepted native destination. Current danger moves and the existing local base response remain eligible. The ordinary per-actor commitment and oscillation guards remain intact. No tolerance, motor timing, budget, reaction, grouping or scoring parameter changes.

After removing proven arrived members, the smaller operation is checked again. This is necessary when one actor retains the accepted pair receipt and its companion later has a real accepted singleton receipt. Each pass removes at least one actor, so the loop is bounded by the operation's actor count. A changed group without a matching accepted full-operation receipt remains eligible. No global equivalence between nearby destinations is introduced.

## Exact replay

`replay-seed12.mjs` uses copied immutable V15 modules, the real simulator, all three human commanders and native input logs for the original Normal Conquest seed12 over 120 seconds. The unmodified source reproduced the ten reported squad16 clicks exactly at ticks 2281, 2301, 2305, 2310, 2339, 2343, 2347, 2351, 2356 and 2381. The proposed source issued only the genuine first movement at 2281. Every native submitted command through the candidate's final submit is an identical prefix of the baseline timeline when comparing tick, slot, command and acceptance. Every physical input through tick2281 is identical.

The planner point is 119,61. The first native accepted point is 119.72605263735505,63.323926875111816. The actor reaches 119,65, within 2 metres of that actual point. The receipt therefore stops the unchanged intent without widening the planned-point threshold.

Only this exact cited replay was repeated. Four cited raw chain files were inspected, and all four cited chains use singleton movements. Other cited seeds were not replayed. The actual merged-pair proof below establishes group behavior, not campaign prevalence. Removing redundant actions can alter later unrelated choices, and no campaign APM or win-rate conclusion is claimed.

## Focused proof

`test-engine-ai-accepted-destinations.js` is a proposed permanent relative-import test. It runs `runCommander`, real physical selection and orders, the real command gate and simulator movement. The original source fails its first post-arrival repetition assertion. The candidate passes controls for actual trench snapping, unchanged actor arrival, nearby changed point, genuine movement away, move versus attack move, queue and facing changes, current danger and base overrides, actual gate refusal then paid retry, actor row order, changed operation membership, merged individual planner intents and P1 partial selection. The partial selection fixture deliberately moves one intended actor outside the selection footprint at the actual click completion; the real hit test acquires only the two surviving companions and the missing actor earns no receipt.

Copied `test-engine-ai-causal-orders.js` passes on the candidate. Copied `test-engine-ai-commitment.js` fails at line55 on both the unmodified captured current source and the candidate with the identical assertion, `the delayed support formation reaches the ordinary submission boundary`. This is preserved as a baseline failure, not treated as a passing compatibility check. No original assertions were changed.

The final patch applies cleanly to commander SHA256 27ea7d5b6a05c29e01c1ee1aa630d2d9e486242f364273e7ab1d863b5ae87617. Both copied source trees differ only in `shared/ai-commander.js`. Current and V15 commander files naturally have different preexisting content; the proposal's four edit blocks are identical in both. `proof.json` records exact source and artifact hashes.

Recommended adoption: the narrow commander patch and permanent test, with registration and gameplay documentation left to root. Run the consolidated repository suite after adoption. This proposal does not claim that every possible repeated movement loop is eliminated.
