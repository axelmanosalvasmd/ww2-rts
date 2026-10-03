# Engine and game-feel verification

Recorded on 2026-10-03. This record describes controlled acceptance fixtures and measured workloads. It does not establish balance, browser performance, deployment status or completion of every scene in the specification.

## Multiplayer acceptance

Run `node test-engine-acceptance.js`. The harness joins the existing room server with real WebSocket clients, negotiates compression, sends ordinary commands, and inspects each recipient's delivered messages. It stops the automatic loop and advances the server deliberately. Fixture maps, unit placement, starting funds, deterministic dispersion and one structural damage contact arrange the scenes. Commands, refunds, health, terrain, objectives, denials and reconnect state are observed through the protocol.

The nine groups in [the harness](../test-engine-acceptance.js) cover these outcomes:

| Scene | Observed outcome | Current result |
| --- | --- | --- |
| Three identical recruits | Owner cancels the second waiter by its stable ID, receives its original charge, keeps head progress and order, and cannot refund it twice. Rival, ally and defeated-owner commands fail; active and stale IDs fail. Spectators receive no job IDs. Reconnect retains IDs. | Passed |
| Authored capture | Normal infantry movement captures a point, gives exactly two reinforcements to the authored owner, and completes a private objective once. Reconnect retains execution identity and creates no reward or announcement replay. | Passed |
| Road mine | Ordinary Engineer mine and clear orders preserve the base road. A later Mortar Barrage damages the road itself. A remote opponent and its reconnect receive no undiscovered mine or local impact cue. | Passed |
| Local support failure | One anchor breach fails its dependent section once and leaves an independent anchored section standing. A tank retains its travel order, replans around newly settled rubble and reaches its goal. Reconnect restores remembered sections without old collapse playback. | Passed |
| Two-way crossing | Sixteen opposing units, including a tank and an AT Gun, reach distinct destinations across a 12-metre-wide bridge within 800 ticks, or 40 seconds of simulation time. | Passed |
| Direct shell after shooter death | The target takes no launch-time damage. The shell remains live after the shooter dies, hits once, ignores a friendly unit in its lane and does not replay on resync. | Passed |
| Target leaves a shell lane | A rifle squad receives a normal move command after Mortar launch, leaves the impact area and takes no damage. The shell follows its launch solution. | Passed |
| Thin wall during flight | A wall placed after direct-shell launch receives its first swept terminal contact. The target behind it takes no damage. A distant team receives neither trajectory nor impact cue. | Passed |
| Horde warning | The public first-Wave category matches the active category and legal delivered unlocks. It exposes no private roster, budget or seed. A host cannot advance an active Wave with living forces. | Passed |

The final nine-group run passed at `2026-10-03T19:22:37.883129+00:00` after the mine, physical-debris, navigation, Horde dispatch and traffic-privacy changes. No group was skipped. The runner checked 143 source and asset hashes before and after execution and found no change. Its log is `/tmp/ww2-engine-acceptance-final.log`; the manifest is `/tmp/ww2-engine-acceptance-final-source.json`. The tested harness SHA-256 is `cbc427ed6c976dfdce04b488f20afe07fc7ff6f782cf38d4ad2fd3169243b5bd`; the tested simulation SHA-256 is `6440994b42efaff809784cf0fc8c354abbdbfda22820eeebf8a3b97d1f0cb028`. The log SHA-256 is `5ddbc79525e0862789c499d6ee3aff0b927be660bfd8dd9c99e23dd9fe111199`.

Queue fuel coverage also lives in [test-engine-controls.js](../test-engine-controls.js). Its normal buy and cancel commands use a staged Motorpool with nonzero Fuel charges, and assert exact MP, Fuel, spending and population changes. [World section tests](../test-engine-world.js), [projectile tests](../test-engine-projectiles.js), [movement tests](../test-engine-movement.js), [scenario tests](../test-engine-scenarios.js) and [AI tests](../test-engine-ai.js) cover narrower contracts. Their separate results do not replace the integrated crossing check. [Traffic privacy tests](../test-engine-traffic-privacy.js) also passed over real WebSockets: paired rooms delivered identical voluntary movement before observing or contacting hidden rubble and wrecks. The isolated live-terrain and live-cover controls reproduced opposite choices. The log is `/tmp/ww2-engine-traffic-privacy-final.log`.

## Measured workloads

Run `node tools/bench-engine.mjs --ticks 160 --out /tmp/ww2-engine-bench.json`. [The benchmark](../tools/bench-engine.mjs) records p50, p95 and p99 tick timings, server phase timings, recipient payload sizes and hashes, receive gaps, one command-to-changed-unit latency, process memory, final state and peak active/settled state counts. It records the CPU, runtime, seed and SHA-256 of the measured source and fixture maps.

The first complete measured state is archived in `/tmp/ww2-engine-bench-frozen-baseline.json`, `/tmp/ww2-engine-bench-frozen-current.json`, `/tmp/ww2-engine-bench-frozen-profile.json` and `/tmp/ww2-engine-world-frozen-current.json`. Its simulation SHA-256 was `6cc6fd7480a13f084d99b1d30e290640fc10419115ab5077a17ba1b9ce8b88e0`, before the final dispatch and privacy fixes. The Horde stress fixture reached the 240-unit field and 240-unit reserve limits for 151 ticks. Its baseline tick maximum was 711.377 ms; the integrated maximum was 1,047.132 ms, including 1,044.446 ms in the AI phase. The integrated run recorded 241 path searches and 1,774,910 expansions. Its 14.239-ms p99 does not describe that largest stall.

Final measurements are pending the concentrated-path-work fix prompted by that result. The completed reports will use the same benchmark script for the isolated baseline and integrated engine, with a separate inspector CPU sample report for navigation, projectile, support and AI costs. The authored-collapse run began before damage, failed 192 sections, reached 96 active falling sections and cleared falling motion one simulation second after its final hit.

The additional World Conquest Huge/Massive runs use [the existing World Conquest benchmark](../tools/bench-world-conquest.mjs). That tool uses random live world seeds and disables WebSocket compression. Its controlled funds, construction and unit-placement conditions must be reported with its results. The Horde field-limit workload stages a late Wave and measures its bounded field; it does not demonstrate organic progression through earlier Waves.

The measured source hashes, runtime, hardware, seed, workload sizes, payload conditions and timing percentiles will be recorded from the final report files. Short runs on this shared host cannot isolate a hardware support range or a causal engine speedup when combat states differ.

## Remaining evidence

The mandatory `node test.js`, final nine-scene acceptance run and final benchmark must refer to the same completed engine state. Browser screenshots, recordings, audio checks, graphics settings, camera-return behavior and frame-time percentiles remain separate evidence. Node renderer adapters and server timings cannot establish those outcomes.

## Integrated engine pilot

The final integrated pilot ran on 2026-10-03 from frozen copies in `/tmp/ww2-39-integrated-pilot/`. The directory contains `run.mjs`, `conditions.json`, `results.json`, `verification.json`, raw `orders.jsonl` and `operations.jsonl`, and `artifact-sha256.json`. The results SHA-256 is `bfc0a10c4864e39251aad4d6490d077f4138ec87b9228ae93f62eea9209dd079`; the harness SHA-256 is `e043ada01b5852fe5d1d783938d5788f74c24b8fc3cab8c9f74ecad8710ff9a3`.

The baseline is the complete engine at commit `6bde9945f494a37fc9fa92e20f5f516d936daf96`; the final variant is the integrated engine before commit. This comparison includes the other engine changes and cannot isolate the AI change. `conditions.json` records every archived shared-module, map, server, package and AI-balance tool hash: 43 baseline files and 51 final files. All 94 files matched their archived copies and source roots after the pilot. The derived AI module exposes a read-only memory probe; its separate hash is recorded, and its sampled memory never changes decisions.

| Source | Baseline SHA-256 | Final SHA-256 |
| --- | --- | --- |
| `server.js` | `88bfa1df44a190a7c58805523a5b6f5d14af41f766ef91acf3985538cf6a857d` | `242c29c4a6c2ecf949b874222598360f30f4e8e344e4451095220ab6ab499e18` |
| `shared/sim.js` | `400fac457f5370ed82ea90ca5d39ef9fa14d4a21e904e20d4eb867269971c6ac` | `6440994b42efaff809784cf0fc8c354abbdbfda22820eeebf8a3b97d1f0cb028` |

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

Both variants ran on the shared host alongside the mandatory behavior suite. The raw CPU and wall-time fields include ledger/probe work and contention; they are runtime diagnostics, not an isolated performance comparison. Renderer changes and unrelated client assets are outside these engine source manifests. The earlier partial-engine pilot remains archived at `/tmp/ww2-39-ai-pilot-evidence/`, but these final integrated results supersede it for this verification record.

## Muted browser proof on the Vostro

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
