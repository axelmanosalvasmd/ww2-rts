# Prospective public danger alert response, version 3

`public-danger-alert-v3` uses stream `ww2-public-alert-response-v3`. It wraps the native version 2 collector and retains the complete `originalV2` and `originalV1` scores per seat and pooled. It adds no response endpoint. Required creation populations, paid clocks, completed response samples, survival curves, recording-end censors and all numerical limits remain exactly version 2.

The original cohort remains 120 matches and 360 seats: Conquest seeds 1 through 20, Classic seeds 1 through 10 and World seeds 1 through 10 at each difficulty, requested 180 simulation seconds per match. Native early endings remain recorded. Easy offscreen limits remain 3 to 6 seconds, Normal 1.5 to 3 and Hard 0.8 to 1.6. Screen, physical APM, opening-order, locality and balance contracts are unchanged. An eventless pooled population or an unidentifiable median remains unknown.

Version 2 can retain an unknown causal input when a paid Space input reaches a newer alert, or Escape cancels targeting before the queued camera operation continues. Version 3 records two narrowly proved nonresponses separately in `knownNonresponseRows`:

- A completed native Space or minimap operation has an applied camera arrival, matching enqueue, motor start and completion receipts, and shared public geometry proving that the original alert marker is still offscreen. Its actual arrived pose and target must agree. This input does not answer the original alert.
- A native `cancel-key` input binds to `cancelAim` in the targeting context. The same operation and motor start identify its receipt. The collector records the hands targeting-cancellation state as true inside the native input callback and false after the same think tick. Camera and selection stay unchanged, and no command is submitted by that operation at that tick. This proves only that the targeting cancellation completed.

Both rules require a native required alert, exact creation identity, creation before enqueue and paid motor timing. The cancellation witness records only input-state booleans and native operation identifiers. It neither exposes a game graph nor changes commander decisions. An optional witness callback receives a detached clone. Missing witnesses, false initial targeting state, interrupted actions, unsupported ability or retreat purposes, incomplete actor selection and other unproved operations remain unknown.

Every original unknown row stays available in `originalV2`. Version 3 partitions those rows into proved nonresponses and remaining unknowns. Its audit retains the original counters and adds `knownNonresponseInputs` and `remainingUnknownCausalInputs`. Required alerts remain present with their exact original completed response or recording-end censor. A nonresponse creates no replacement timestamp and does not discard an alert.

Scoring requires the live sealed version 3 stream, unchanged version 2 stream, raw physical inputs, events and actual command receipts. Deserialization, forged witnesses or mutations invalidate native provenance. Historical files never acquire a live seal. Pooling requires every seat to have complete native coverage and no remaining unknowns. Mixed policies cannot pass.

The collector CLI accepts `--alert-policy public-danger-alert-v3` for the current commander. It captures both version 2 and version 3 adapter hashes in every worker checkpoint. Legacy and unknown policy requests are rejected. The version 1 and version 2 modules and their CLI behavior remain available.

The native test runs the existing authored flat-map fixture through real perception, hands and command submission. It checks retargeted camera arrivals, true and false targeting cancellation, missing proof, valid existing endpoints, unsupported retreat and accepted ability purposes, incomplete selection, interruption and eventless censoring. Controls reject deserialized or altered streams and receipts. Collector-off and callback-mutation controls compare native inputs, commands, public observations, commander memory, game state and seeded RNG. Bounded collector controls also compare all four collection profiles and their original version 2 streams and scores.

```bash
node test-engine-ai-public-alert-v3.js
node test-engine-ai-public-alert-v3.js --proof-out /tmp/UNIQUE-native-v3-proof.json
node tools/ai-humanity.mjs --mode conquest --level normal --seeds 27-27 --seconds 9 --workers 1 --manual-policy screen-manual-v3 --alert-policy public-danger-alert-v3 --logs --out /tmp/UNIQUE-native-v3-collector.json
```

These bounded controls establish collector authenticity and the declared classification rules. They establish no full-cohort numerical acceptance result. Final evidence must run prospectively after the candidate and complete source closure are frozen, preserving original policies and every censor.
