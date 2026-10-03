# Engine and game-feel verification

Recorded on 2026-10-03. This record describes controlled acceptance fixtures, source checks and measured workloads. Faction balance, native GPU performance and deployment status remain unverified.

## Multiplayer acceptance

Run `node test-engine-acceptance.js`. The harness joins the existing room server with real WebSocket clients, negotiates compression, sends ordinary commands, and inspects each recipient's delivered messages. It stops the automatic loop and advances the server deliberately. Fixture maps, unit placement, starting funds, deterministic dispersion and one structural damage contact arrange the scenes. Commands, refunds, health, terrain, objectives, denials and reconnect state are observed through the protocol.

The nine groups in [the harness](../test-engine-acceptance.js) cover these outcomes:

| Scene | Observed outcome | Current result |
| --- | --- | --- |
| Three identical recruits | Owner cancels the second waiter by its stable ID, receives its original charge, keeps head progress and order, and cannot refund it twice. Rival, ally and defeated-owner commands fail; active and stale IDs fail. Spectators receive no job IDs. Reconnect retains IDs. | Passed |
| Saved authored mission | Authenticated save/reload retains combined elapsed-time, area-entry and capture conditions. Normal infantry capture cannot bypass the delay; two reinforcements arrive under ordinary orders. Bounded repeats fire twice at the authored cooldown, local destruction preserves its neighbor, and private objectives survive reconnect without rewards or cue replay. | Passed |
| Road mine | Ordinary Engineer mine and clear orders preserve the base road. A later Mortar Barrage damages the road itself. A remote opponent and its reconnect receive no undiscovered mine or local impact cue. | Passed |
| Local support failure | One anchor breach fails its dependent section once and leaves an independent anchored section standing. A tank retains its travel order, replans around newly settled rubble and reaches its goal. Reconnect restores remembered sections without old collapse playback. | Passed |
| Two-way crossing | Sixteen opposing units, including a tank and an AT Gun, reach distinct destinations across a 12-metre-wide bridge within 800 ticks, or 40 seconds of simulation time. | Passed |
| Direct shell after shooter death | The target takes no launch-time damage. The shell remains live after the shooter dies, hits once, ignores a friendly unit in its lane and does not replay on resync. | Passed |
| Target leaves a shell lane | A rifle squad receives a normal move command after Mortar launch, leaves the impact area and takes no damage. The shell follows its launch solution. | Passed |
| Thin wall during flight | A wall placed after direct-shell launch receives its first swept terminal contact. The target behind it takes no damage. A distant team receives neither trajectory nor impact cue. | Passed |
| Horde warning | The public first-Wave category matches the active category and legal delivered unlocks. It exposes no private roster, budget or seed. A host cannot advance an active Wave with living forces. | Passed |

The final nine-group run passed at `2026-10-03T20:43:35.867450+00:00` on the frozen working source after commit `5d507830e66f3bdc1b105eddb86f01af0b9f08b2`, including the mined-obstacle helper, saved-mission proof and Tank Destroyer counter fix. No group was skipped. The runner checked 148 source and asset hashes before and after execution and found no change. Its log is `/tmp/ww2-engine-acceptance-current-head.log`; the manifest is `/tmp/ww2-engine-acceptance-current-head-source.json`. The tested harness SHA-256 is `cd9f2e236195cb937016380c0efe1724d09e6c1dcebf3e0af7c69cca3b746e7c`; the tested simulation SHA-256 is `e8f736b82b7349eae083d44cf4a3d44540c0af241ede76c0ae07165d8bda8fc8`. The log SHA-256 is `54d7294841a9fdd625f9da63911a1d9d5c44f0720170feaae3fd256ec42b878e`.

The saved combined mission is preserved at `/tmp/ww2-saved-mission-TiyTJy/mission.json`, with delivered objective, repeat, reinforcement, destruction and reconnect readbacks in `readback.json`. The harness used the existing authenticated map route through a temporary fixture symlink and removed that symlink afterward; it added no production endpoint or deployed map.

Queue fuel coverage also lives in [test-engine-controls.js](../test-engine-controls.js). Its normal buy and cancel commands use a staged Motorpool with nonzero Fuel charges, and assert exact MP, Fuel, spending and population changes. [World section tests](../test-engine-world.js), [projectile tests](../test-engine-projectiles.js), [movement tests](../test-engine-movement.js), [scenario tests](../test-engine-scenarios.js) and [AI tests](../test-engine-ai.js) cover narrower contracts. Their separate results do not replace the integrated crossing check. [Traffic privacy tests](../test-engine-traffic-privacy.js) also passed over real WebSockets: paired rooms delivered identical voluntary movement before observing or contacting hidden rubble and wrecks. The isolated live-terrain and live-cover controls reproduced opposite choices. The log is `/tmp/ww2-engine-traffic-privacy-final.log`.

## Measured workloads

[The benchmark](../tools/bench-engine.mjs) measured the frozen working source after commit `5d507830e66f3bdc1b105eddb86f01af0b9f08b2` on 2026-10-03, including the final helper and AI counter fixes. Its script SHA-256 and seed `3936341` remain unchanged from the historical baseline. The baseline report at `/tmp/ww2-engine-bench-release-baseline.json` was recorded at 19:43:56 UTC against commit `6bde9945f494a37fc9fa92e20f5f516d936daf96`; it was not rerun for this final source. Current/profile/World reports began at 20:43:35/20:43:42/20:43:45 UTC and ran sequentially. All used Node `v24.21.0`, Linux x64, an Intel Core i5-12400 with 12 logical CPUs and 33,329,643,520 bytes of host RAM. Chrome was closed, and behavior suites and AI pilots were held until this timing window ended. Agent services and light source checks remained on the shared host. These conditions do not establish a supported hardware range. Earlier release and rebased reports remain archived under their original `/tmp/ww2-engine-*-release-*` and `/tmp/ww2-engine-*-rebased-*` names.

Reproduce the normal cases with `node tools/bench-engine.mjs --ticks 160 --out /tmp/ww2-engine-bench.json`. Direct cases use Massive armies, weather off and supply off. Each runs 160 ticks and excludes the first ten from its 150 timing samples. Navigation commands and structural damage calls are measured separately from tick timing. The server cases use Standard armies, map weather, supply on, six initial units and 24 staged rifles. Combat, paths and delivered state differ between revisions, so these measurements do not isolate a causal engine speedup.

| Workload | Baseline p50 / p95 / p99, ms | Current p50 / p95 / p99, ms | Current maximum, ms |
| --- | --- | --- | --- |
| Quiet, 6 units | 0.060 / 0.321 / 0.388 | 0.067 / 0.377 / 0.539 | 0.704 |
| 24 ordered bridge movers, 30 units | 0.262 / 1.477 / 1.719 | 0.295 / 1.581 / 1.871 | 2.178 |
| Artillery support, 30 units | 0.264 / 1.189 / 4.471 | 0.292 / 1.766 / 4.198 | 9.358 |
| 16 opposed tanks, 22 initial units | 0.315 / 1.870 / 2.265 | 0.850 / 2.448 / 3.392 | 5.942 |
| 24-unit move commands, 30 units | 0.220 / 0.916 / 1.157 | 0.339 / 1.067 / 1.302 | 1.454 |
| 24 authored support chains, 6 units | Unavailable | 0.066 / 1.193 / 1.642 | 5.503 |
| Six AI seats, 18 to 46 units | 0.610 / 3.407 / 3.884 | 0.854 / 6.137 / 21.280 | 30.213 |
| Four defenders, staged Wave 10 | 3.098 / 5.558 / 13.181 | 4.598 / 26.769 / 30.278 | 32.620 |
| Production timer, two compressed clients | 1.351 / 3.973 / 5.897 | 1.687 / 4.059 / 6.186 | 6.186 |
| Manually stepped server, two clients | 0.266 / 0.569 / 0.649 | 0.285 / 0.618 / 0.796 | 1.082 |

The production-timer case measured exactly 60 ticks over 2,991.606 ms, with startup samples excluded, 30 snapshot phases and 60 decoded recipient snapshots over two sockets. Current step p50/p95/p99 was 1.145/3.057/5.119 ms; snapshot build was 0.937/3.019/3.229 ms; stringify was 0.107/0.135/0.141 ms. The 58 receive gaps were 100.435/105.776/108.645 ms, while one normal move-to-changed-unit probe measured 103.599 ms before and 106.655 ms after; that single probe cannot establish a latency distribution.

Both sockets negotiated `permessage-deflate`, and payloads crossed the 1,024-byte compression threshold. Current decoded snapshot size p50/p95/p99 was 818/1,435/2,278 bytes, compared with 758/1,341/2,218 before. These are JSON byte counts after decoding, not compressed wire bytes. Each report includes three payload samples and their SHA-256 values. Current process RSS at the end of the timer case was 365,658,112 bytes; it includes preceding cases in the same process and is not a standalone room-memory estimate.

The navigation case issued 20 ordinary move commands for 24 units. Command p50/p95/p99 was 2.611/7.740/13.867 ms, including validation and search. Exact counters recorded 480 path calls and 44,848 expansions, with no failed, deferred or dropped search. A separate cached `navigationLeg` probe measured 5.275/24.959/471.190 microseconds; it excludes full path search. The projectile case peaked at 16 live flights and two moving wrecks, with three settled wrecks.

The collapse case began before its first damage contact. Twenty-four `damageWorldSection` calls failed 192 sections in 24 independent eight-section chains. It reached the 96-body falling limit, settled 207 rubble cells and cleared falling motion one simulation second after the final hit. Separate support-update p50/p95/p99 was 0.120/1.355/1.597 ms, including support traversal, section failure and cell changes. Those calls sit outside the tick values in the table. Baseline lacks this API, so there is no paired collapse timing.

The Horde fixture stages 238 boss rifles on open west-bank cells before normal Wave 10 purchasing and gates run. Both revisions reached 240 field units and 240 reserves, with 151 ticks at the field cap. This exercises a bounded late Wave, not organic progression through earlier Waves. Baseline maximum tick time was 728.910 ms. The earlier integrated report, preserved at `/tmp/ww2-engine-bench-frozen-current.json`, reached 1,047.132 ms before the dispatch fix. Current maximum was 32.620 ms, including a 29.036-ms maximum AI phase. Current p95 rose to 26.769 ms from baseline 5.558 ms: the queue distributes path work across more ticks rather than reducing total CPU work. Final counters recorded 242 path calls and 1,964,150 expansions, compared with 240 and 1,779,898 before, with no failed, deferred or dropped search in either. [Queue tests](../test-engine-horde-queue.js) bound dispatch to four ground movement commands per observation and drain the staged 238-unit queue in 5.9 seconds at 100-ms observations, or 11.8 seconds at adaptive 200-ms observations. Those dispatch delays remain part of the tradeoff.

A separate `--profile` run requested 250-microsecond V8 inspector samples. The table shows sample count times that requested interval, over the whole bounded case including setup and warmup. These estimates include profiler overhead; inclusive stacks overlap and must not be added. An unsampled cost is below this run's resolution, not zero. The unprofiled timing table above is separate.

| Case and function | Self samples / estimated ms | Inclusive samples / estimated ms |
| --- | --- | --- |
| Navigation: `findPath` | 59 / 14.75 | 169 / 42.25 |
| Navigation: `navigationLeg` | 9 / 2.25 | 15 / 3.75 |
| Projectile: `stepFlights` | 1 / 0.25 | 12 / 3.00 |
| Projectile: `stepWorldDebris` | 1 / 0.25 | 6 / 1.50 |
| Collapse: `damageWorldSection` | 1 / 0.25 | 20 / 5.00 |
| Collapse: `supportedSections` | Unsampled | Unsampled |
| Collapse: `stepWorldDebris` | 3 / 0.75 | 19 / 4.75 |
| Collapse: `stepDebris` | 5 / 1.25 | 18 / 4.50 |
| Collapse: `settleSection` | 3 / 0.75 | 6 / 1.50 |
| Six AI seats: `think` | 7 / 1.75 | 497 / 124.25 |
| Horde: `flushHordeMovement` | 7 / 1.75 | 3,962 / 990.50 |
| Horde: `findPath` | 2,297 / 574.25 | 4,004 / 1001.00 |

The sampled navigation/projectile/collapse/six-AI/Horde windows lasted 183.329/310.718/61.373/416.090/2,079.127 ms. Horde flushing runs during observation as well as decision work, so `think` alone omits substantial dispatch cost. The report retains sample counts for all named functions in [navigation](../shared/navigation.js), [projectiles](../shared/projectiles.js), [structures](../shared/structures.js), [debris motion](../shared/debris-motion.js) and [AI](../shared/ai.js).

The additional current-only World Conquest run used [the existing benchmark](../tools/bench-world-conquest.mjs), `--mobile=24 --ticks=120 --no-pacing`, six real sockets and teams `[0,0,1,1,2,2]`. It generated random live Huge/Massive worlds, staged 100,000 starting resources per seat, bought producers and units through each owner's socket, accelerated construction/training, spread deployment and then restored controlled resources. It purchased 24 mobile units per seat; total units also include world forces and buildings. Compression was disabled. Eighteen long-distance moves and 30 AI observation/plan probes occurred outside measured ticks; no bot seat ran full AI during those ticks. This tool retains p50/p95/maximum rather than raw samples, so World p99 is unavailable. There is no matching World baseline.

| Current World fixture | Seed | Total units | Tick call p50 / p95 / maximum, ms | Snapshot bytes p50 / p95 / maximum | End RSS, bytes |
| --- | --- | --- | --- | --- | --- |
| Huge | 1462007241 | 336 | 12.942 / 27.586 / 41.917 | 7,655 / 14,834 / 19,388 | 731,176,960 |
| Massive | 3887014494 | 528 | 10.772 / 31.432 / 60.322 | 7,676 / 14,340 / 15,979 | 1,089,982,464 |

Both World maximums exceed the specification's 40-ms tick budget. The earlier pre-rebase Huge/Massive run used different random worlds, so its 42.063/58.508-ms maximums cannot establish a causal geography regression or speedup. Their six-second simulation windows were accelerated, not paced server sessions. The normal server, Horde and World reports describe different workloads and cannot substitute for one another.

Final JSON artifacts and SHA-256 values are:

| Artifact | SHA-256 |
| --- | --- |
| `/tmp/ww2-engine-bench-release-baseline.json` | `63edb467095331a11cf9a3ede04c60b79e4768574d6e6efc8b54af53d807947a` |
| `/tmp/ww2-engine-bench-current-head.json` | `db9d9d105be49d574973fc141bed234e24fd57f1cf9aedb16badd9e1dc750515` |
| `/tmp/ww2-engine-bench-current-head-profile.json` | `a11a1e726260a0d79458faf37dc9c1ade0fcba4bbcff9092267be1bd0feac4b9` |
| `/tmp/ww2-engine-world-current-head.json` | `9e60ec611e918c109a40b9e7c2b6aeca24b6b5572de21f9c0e9925bd4ea5bc30` |

The shared baseline/current/profile benchmark SHA-256 is `1877e42af8cb7e04c4e0d5d77d5152f0e4b943546b0c3251add94dcc00d3d269`. Every current report source hash matches the final acceptance manifest. The final server SHA-256 is `242c29c4a6c2ecf949b874222598360f30f4e8e344e4451095220ab6ab499e18`; simulation is `e8f736b82b7349eae083d44cf4a3d44540c0af241ede76c0ae07165d8bda8fc8`; AI is `8fc9dfc5f94b5f5f315846dc56ab7f7cd38672d37474ecc611aadb78267fc0ba`; navigation is `c1301d09571b1c3afd9ee212b0d28b2ef8f21fd6da0a7205b47bf6acdee11398`; local traffic is `7c6e933d4e7a3bb904b4f2741ca115434319653493da5df6e0f6d279f660f05e`. The final AI mind SHA-256 is `5a511dc116233358ea9f26b0e3841bd937d33eac8fa20684de51217bbe3ea439`. The JSON manifests record the other measured module and fixture-map hashes.

## Regression checks and limits

The final `node test.js` passed with exit code 0 in 666.910 seconds on merged base `6c7c5750802e649cfbede7379067cfa46246806a` plus the frozen follow-up source. All 28 subprocess groups ran, followed by the original 4,489 paired AI fog turns, 2,021 command-only orders, the full AI match, 11 server room-lifecycle scenarios and the remaining core and performance checks. Separate `node test-world.js` and `node test-path-performance.mjs` runs passed in 0.312 and 0.151 seconds. All 367 source, test and asset hashes remained identical across the three gates, with manifest digest `158f6fbb1e80312496e5caf4edc65d1722958913464a5e838f0e57cd9a854ba6`. Root verified the JSON results, before/after manifests and current files. Results are in `/tmp/ww2-39-scenario-final-gate-results.json`; logs and manifests use the `/tmp/ww2-39-scenario-final-` prefix.

An earlier attempt failed at the World scouting detour assertion before the squad reached the wall. The fixture cleared the HQ's terrain footprint but retained its live body; atomically updating layers while preserving that footprint fixed the setup without changing movement code. The reproduced seed `142761591` and independent seeds `1` and `2` passed the original 150 m goal, queue, Stop and Retreat bounds. Detour verification now requires movement beside the actual wall. The failed run remains archived under `/tmp/ww2-39-failed-scouting-`. The successful fixture SHA-256 is `1b308c92d99e7dc252fdaa7bbf2618fc5b0ff59bd524a192ac07e34cf21854c1`.

The nine-scene acceptance, benchmark, final AI pilot and browser source manifests agree with the corresponding final gameplay files. Timing processes had exited before behavioral and final browser work began. Earlier rebased and pre-rebase passes remain archived under their original names and do not replace this final run. Browser captures below have separate settings and software-rendering limits. Faction balance, native GPU performance and deployment remain unverified; the measured World tick-budget misses remain documented above.

## Integrated engine pilot

This pilot was rerun after the strategic World geography merge and Tank Destroyer matchup correction. Its frozen source includes those changes; the historical baseline predates them.

The final integrated pilot ran on 2026-10-03 from frozen copies in `/tmp/ww2-39-integrated-pilot-final-counter/`. The directory contains `run.mjs`, `conditions.json`, `results.json`, `verification.json`, raw `orders.jsonl` and `operations.jsonl`, and `artifact-sha256.json`. The results SHA-256 is `e8311c171c591fa635f0064d244901842a1fef2c93e583a9bd40e53b3acd1d9a`; the harness SHA-256 is `e043ada01b5852fe5d1d783938d5788f74c24b8fc3cab8c9f74ecad8710ff9a3`.

The baseline is the complete engine at commit `6bde9945f494a37fc9fa92e20f5f516d936daf96`; the final variant is the frozen integrated working tree on commit `5d507830e66f3bdc1b105eddb86f01af0b9f08b2`. This comparison includes the other engine changes and cannot isolate the AI change. `conditions.json` records every archived shared-module, map, server, package and AI-balance tool hash: 43 baseline files and 54 final files. All 97 files matched their archived copies and source roots after the pilot. The derived AI module exposes a read-only memory probe; its separate hash is recorded, and its sampled memory never changes decisions.

| Source | Baseline SHA-256 | Final SHA-256 |
| --- | --- | --- |
| `server.js` | `88bfa1df44a190a7c58805523a5b6f5d14af41f766ef91acf3985538cf6a857d` | `242c29c4a6c2ecf949b874222598360f30f4e8e344e4451095220ab6ab499e18` |
| `shared/sim.js` | `400fac457f5370ed82ea90ca5d39ef9fa14d4a21e904e20d4eb867269971c6ac` | `e8f736b82b7349eae083d44cf4a3d44540c0af241ede76c0ae07165d8bda8fc8` |
| `shared/ai-mind.js` | `fcca2d2d2e166bacc866b717df5fd6722fe77e495f487454d3887c0af600ad6a` | `5a511dc116233358ea9f26b0e3841bd937d33eac8fa20684de51217bbe3ea439` |

The Default map SHA-256 is identical in both source archives: `e9362e35e16a6982d15c2e45129f213b0af3d526376c18b9c89379aa7bcce04d`. The final source includes the current World geography generator, while the historical baseline uses its earlier geography. These Default Conquest matches do not exercise World Conquest geography or establish results for that mode.

Both variants use `maps/default.json`, Conquest, three separate teams `[0,1,2]`, USA/Germany/USSR seats, Normal AI, Standard armies, fixed spawn assignment and a 1,800-second limit. Each pair restarts the same Mulberry32 seed; subsequent random consumption diverges with gameplay. Simulation steps run at 20 Hz, observations refresh every two ticks at 10 Hz, and decisions follow `(tick + slot * 13) % thinkEvery(normal) === 0`. Ordinary authoritative commands apply the AI's choices. The harness follows the server schedule in accelerated headless Node `v24.21.0` on Linux x64; it does not run WebSocket delivery or claim real-time pacing.

| Seed | First time all points owned, baseline / final, seconds | Match duration baseline / final, seconds | Combat kills baseline / final | Winner baseline / final |
| --- | --- | --- | --- | --- |
| 41 | 56.60 / 58.55 | 592.50 / 628.80 | 25 / 18 | USA / USA |
| 92 | 43.30 / 32.55 | 802.15 / 456.55 | 30 / 10 | USSR / Germany |
| 173 | 37.30 / 35.75 | 488.30 / 605.20 | 13 / 12 | Germany / USA |
| 271 | 41.55 / 59.00 | 504.35 / 584.90 | 12 / 16 | USA / USSR |

All eight matches ended by Victory Points. Median match duration was 548.425 seconds before and 595.050 seconds after; median first ownership of all points was 42.425 and 47.150 seconds. Authoritative story counters recorded 80 baseline combat kills and 56 final combat kills. Each four-match variant produced two USA wins, one Germany win and one USSR win. These four paired seeds provide behavior examples, not a faction-balance or AI-strength conclusion.

Every accepted nonqueued ground move or attack-move receives a ledger identity. Completion requires a fresh authoritative completed result or an exhausted path within 2.5 metres of its captured route endpoint. Explicit command replacement, authoritative interruption and changed jobs interrupt an entry; unit deaths and orders still pending at match end stay separate. Repeated movement commands count separately from physical destinations. Every issued entry reconciles to one terminal ledger category:

| Variant | Issued | Completed | Interrupted | Authoritative unreachable | Ended without arrival | Destroyed | Pending at match end |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Baseline | 865 | 402 | 407 | Unavailable | 3 | 27 | 26 |
| Final | 3,582 | 1,760 | 1,763 | 0 | 0 | 15 | 44 |

The baseline has no equivalent authoritative unreachable field. Its raw ledger counter is zero because the result is unavailable; that zero is not comparable to the final engine's observed zero. Its three `ended_without_arrival` entries describe cleared movement goals away from the endpoint and remain separate. An empty path alone does not prove an unreachable destination.

The final variant recorded these unique observed operation states across the four matches:

| State | Unique `(seat, operation ID, state)` observations |
| --- | --- |
| Assemble | 91 |
| Advance | 53 |
| Engage | 59 |
| Regroup | 39 |
| Withdraw | 68 |
| Complete | 20 |
| Abandon | 76 |

The probe samples after decision turns and records each state once per operation. It does not count every internal transition, repeated return to a state, or tactical success. The baseline has no equivalent persistent assault state records.

Both variants ran on the shared host alongside the mandatory behavior suite. The raw CPU and wall-time fields include ledger/probe work and contention; they are runtime diagnostics, not an isolated performance comparison. Renderer changes and unrelated client assets are outside these engine source manifests. The earlier partial-engine pilot at `/tmp/ww2-39-ai-pilot-evidence/` and pre-rebase pilot at `/tmp/ww2-39-integrated-pilot/` remain intact. This fresh run reproduced the pre-rebase pilot's selected gameplay outcomes, movement totals and observed operation counts on the final source; its own manifests and results establish the rerun.

## Muted browser proof on the Vostro

The archived editor, physics, repair and initial presentation captures below predate the strategic World geography
merge. Their original settings and source limitations remain recorded. Later audio and fresh-backend completion
sessions are labeled separately.

Visual checks used local Linux Chrome through `agent-browser`, rather than the Mac-hosted T3 preview. Every local browser launched with `--mute-audio`; `ww2-volume` was set to `0` before entering the app and read back as `0`. The Mac preview tabs opened during this task were muted and closed. No listening test or native GPU performance claim is made.

The editor/control session used a 1440 by 1000 viewport. Actual English and Spanish UI interactions added a capture trigger, chose its capture point and rejected malformed scenario JSON. These edits stayed unsaved. Keyboard `Ctrl+1`, `Alt+2` and recall proved that transferred units leave their old group. The visible destination selector and Move to group button repeated the transfer to group 3. Two ordinary public `ping` commands produced server-delivered Alert history; selecting the newest and previous entries moved the camera to their recorded coordinates. Screenshots and short recordings were inspected. Browser error readback was empty. Detailed capture notes remain at `/tmp/pr-proof-39/editor-controls-evidence.md`.

The queue comparison used the ordinary default Classic map: baseline commit `6bde9945f494a37fc9fa92e20f5f516d936daf96` showed a training/waiting summary, while the implementation showed each waiting job's cancellation and refund. Clicking cancellation removed the waiter while active progress continued. Screenshots and the recording remain at `/tmp/pr-proof-39/queue-before.png`, `vostro-after-queue.png`, `vostro-after-cancel.png` and `queue-cancel.mp4`. The exact refund and fuel accounting are established by the protocol tests, not inferred from screenshots with ongoing income.

The destruction recording used an **uncommitted local authored map fixture**, served by the existing server's `mapFiles` test seam on port 3040. It included a road, a hill, a nine-section stone house, authored Tank/Mortar/Rifle units and a capture objective. Normal `stance`, `move` and `fireat` commands moved the tank from `(87,97)` to `(109.1,101)` and fired the Mortar at terrain beside the house. Delivered flight/contact/falling state and inspected frames showed impact, local collapse, fire and persistent rubble. The fixture did not add a production route or change deployed maps. Its source and server wrapper remain in `/tmp/ww2-39-browser-proof/`; before/after screenshots and H.264 recording are in `/tmp/pr-proof-39/physics-before.png`, `physics-after.png` and `physics-destruction.mp4`.

The same active, visible-tab capture measured 146 positive `requestAnimationFrame` intervals over roughly 14 seconds. Chrome was `152.0.0.0`, viewport 1280 by 633, quality Low, camera `(107,97)`, distance 45 and yaw 0.8. Frame p50/p95/p99 were **83.4 / 116.7 / 249.9 ms**. Its renderer was ANGLE Vulkan SwiftShader (software rendering), on the i5-12400 Vostro. The browser had no access to the host's render device, and other task processes were running. These numbers describe this short software-rendered recording; they do not establish GPU frame rate, a speedup or a supported hardware range. The capture observed at most one live flight and two falling sections, with zero new runtime errors. Raw intervals, observed events, browser settings and audio readback are in `/tmp/pr-proof-39/physics-browser-report.json`.

The presentation session used the same authored fixture in a fresh room on port 3040, at 1280 by 760. After normal movement placed the tank at `(106.2,97)`, cancelling follow, clearing selection and moving the camera to `(10,10)` established `animationDetailed=false` and `terrainPose.suspended=true`. The real Three camera frustum did not intersect the tank's 25 m presentation margin, while its delivered model remained visible to its owner. A normal move order then reached `(108.1,101)` offscreen. Within two animation frames of camera return, current and delivered positions agreed, detailed animation resumed, and the current chassis pose was already pitch `-0.16`, roll `0.12`; the base stayed level. Inspected screenshots and the H.264 clip remain at `/tmp/pr-proof-39/tank-offscreen-suspended.png`, `tank-current-pose-return.png` and `tank-camera-return.mp4`. Exact readbacks are in `presentation-browser-readback.json`.

Muted runtime audio readbacks followed camera changes through known terrain. At the river `(42,97)`, the water target gain was `0.13608`; at woodland `(75,82)`, the woodland target gain was `0.09234`. At the distant unknown corner `(185,180)`, both terrain targets were zero. Public wind remained active and clear-weather rain stayed zero. The running audio context reused its existing beds with master volume zero. These observations establish target routing while muted, not the audible quality of the crossfades.

A separate temporary wrapper on port 3041 staged authoritative tank health once at `108/360`, using the exported `server.rooms` test seam. Ordinary stance commands disabled auto-retreat and enabled hold position and hold fire before staging. A normal move order toward home led to paid spawn repair at `(33,97)`: delivered health rose through `113`, `122`, `129`, `140` and later values to `360`. Damage hysteresis moved from stage 2 at health `108`, to stage 1 at `140`, then stage 0 at `266`; the cue faded to zero and the particle count returned to zero. The final wire row carried health `360`. The inspected H.264 clip `/tmp/pr-proof-39/tank-damage-repair.mp4` and `tank-repair-browser-readback.json` preserve this controlled fixture and the ordinary repair behavior. This capture preceded the final smoke-anchor correction; it establishes the health and hysteresis contracts, which that correction preserved.

The first damaged capture exposed an emitter inside the native tank hull. The final render correction derives a cached rear mount above actual native hull bounds, excludes the traversing turret and UI, and follows chassis yaw, pitch and roll. A fresh muted capture with the corrected source delivered health `108/360`, stage 2 and seven live particles, with the native local mount at `(-1.9391,2.0251,0)`. The close view shows a restrained changing smoke cue above the rear hull; the hurt unit badge partly overlaps it at this angle, so this proof does not promise readability at every zoom or angle. Current-source screenshots, the inspected H.264 clip and readbacks remain at `/tmp/pr-proof-39/tank-smoke-corrected.png`, `tank-smoke-corrected-later.png`, `tank-smoke-corrected.mp4` and `tank-smoke-corrected-readback.json`. The renderer changed to Low near the end of this software-rendered capture. All browser sessions and the temporary repair server were closed afterward.

After the final anchor correction, `test-engine-presentation.mjs` passed actual native-hull ray and mount checks across nine vehicle families, and `test-engine-vehicle-pose.mjs`, `test-client-performance.mjs`, `test-ground-performance.mjs` and `test-corpse-performance.mjs` passed. Ground golden pixels were unchanged. These Node adapters establish their stated geometry, routing and resource contracts, not browser frame rate. Detailed presentation fixture notes remain at `/tmp/pr-proof-39/presentation-browser-evidence.md`.

A later completion capture recorded the actual internal audio buses on Linux Chrome while `--mute-audio`, saved volume `0` and master gain `0` remained in force. Proof-page instrumentation blocked the hardware audio destination and tapped the pre-mute buses into a recording stream; no production source changed and no speaker playback occurred. The client audio/presentation source was `5d507830e66f3bdc1b105eddb86f01af0b9f08b2`; the existing port 3040 backend wrapper had loaded before the final rebase and served the temporary authored fixture. Public Rain and an ordinary tank move revealed nearby river terrain. Inspected video and waveform show the known-river/woodland camera sequence, a deliberately invoked native attack Alert at second 8, ambience bus duck to `0.32048` and recovery, and zero water/woodland targets at the distant corner while rain remained `0.2`. This controlled Alert was not an incoming combat attack. The 16.98-second internal track is paired with the camera recording in `/tmp/pr-proof-39/audio/final-camera-audio.mp4` (H.264/AAC); independent recorder starts leave an unmeasured leading offset, so event times remain in `final-metadata.json` and the silent 18.2-second video and original Opus track are preserved. The waveform and unobscured motion frames were inspected; browser errors were empty and every owned Chrome session closed afterward. This establishes recorded signal and routing, not audible quality or speaker output. Detailed audio provenance and hashes are in `/tmp/pr-proof-39/audio/evidence.md`; the later session below supersedes that file's earlier list of missing browser scenes.

A final fresh-backend completion session on the Vostro closed the phase 8 death, hidden-enemy and large-army checks. It loaded the frozen simulation on port 3042 through the existing exported `mapFiles`/`rooms` seams; exact source hashes are in `/tmp/pr-proof-39/phase8-final/source-manifest.json`. The temporary fixture authored 120 Rifle squads, a tank and an enemy Tank Destroyer, then staged tank health `60/360` and population multiplier `12` once. Ordinary movement removed the damaged tank from the enemy client's delivered rows and detached its root; camera return while unobserved added no cue calls. Ordinary movement back restored current delivered health and a fresh live view. An ordinary attack then killed the tank: the living root disappeared, the enemy received wreck `128`, and fresh living-cue calls stopped while wreck/fire continued. The owner had no remaining sight source at the location, so its permanent wreck row was correctly withheld. The inspected 10.4-second H.264 death recording, screenshots, authoritative history and exact readbacks remain in `/tmp/pr-proof-39/phase8-final/`.

In that same match, an ordinary host pause held delivered state fixed while the Graphics menu switched Low to High. The 120 squads contained 1,800 native soldier models. A proof-page wrapper counted actual native `man.position.set` calls without changing the evaluated pose: both settings performed 1,800 per visible frame and zero offscreen. Over approximately 2.5-second windows, Low recorded 23,400 visible calls over 13 frames and zero over 21 offscreen frames; High recorded 3,600 over two visible frames and zero over 12 offscreen frames. Two animation frames after return had all 120 squads detailed, none suspended, current pose positions and zero error against delivered root positions. Delivered rows, health and simulation tick `91` stayed identical across settings. The staged fixture and short work-count windows establish these contracts, not GPU FPS, isolated total CPU time or a general speedup. The mandatory behavior suite ran concurrently; timing workers had exited before Chrome started. Master/saved volume remained zero and hardware audio stayed disconnected in both seat tabs. Chrome and the fixture server closed after inspected screenshots and recordings. Failed initial cap/paused-command attempts are labeled as diagnostics in the evidence notes.
