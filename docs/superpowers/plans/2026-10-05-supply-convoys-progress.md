# Execution ledger: docs/superpowers/plans/2026-10-05-supply-convoys.md

Base: a3564a6. Workspace: native supply-convoys worktree, branch codex/supply-convoys.

The user explicitly waived further review/permission prompts and requested completion.

## Preflight

| Tasks | Shared interface | Resolution |
| --- | --- | --- |
| 1 and 2 | Unit reserve shape and stock transfer | Named kernel APIs and physical projectile counts agreed with reserve worker |
| 2 and 3 | Snapshot and public commands | Owner-private logistics object, logisticsResume and supply commands agreed with UI worker |
| All | Simulation and documentation | Root owns simulation/server/AI integration and documentation; workers own disjoint files |

## Decisions

- Split convoy scheduling into shared/supply-convoys.js and reserve accounting into shared/logistics.js. This keeps worker ownership independent and modules focused.
- Execute independent reserve and client work in parallel under dispatching-parallel-agents; root integrates the simulation. Fresh review performed; full verification remains required.
- Headless createGame fixtures opt in with opts.logistics; the live server automatically enables selected modes. Existing isolated engine fixtures retain their old rules, and new integration fixtures test enabled logistics explicitly.
- Preserve the original shared checkout and all other sessions' changes. Integrate only the verified feature after completion.

## Progress

- Planning and written spec complete; further prompt gates waived by explicit user instruction.
- Original shared-checkout baseline node test.js passed (session 8925).
- Task 1: reserve accounting complete, 17 focused RED/GREEN cases pass.
- Task 2: simulation and automatic scheduling integrated; 28 scheduler cases plus combat, delivery, fuel and World tests pass.
- Task 3: client controls, models, private decoding and bilingual presentation complete. Browser inspected models, overlay, reserves, hold and resume.

- Fresh review fixes: source loss/rebuild, neutral regional ownership, cross-water handoffs, mandatory capture/construction locks, paused escape, offensive volley costs and Engineer provision-funded repair.
- Existing World territorial fixtures disable logistics internally to retain isolated capture/income/observer proofs. New supply tests exercise enabled World gameplay and live-server privacy.

- Rebased onto b94aef6, retaining newer cliff presentation, recruitment tabs and Windows naval fingerprint fixes.
- Final review fixed bounded long-distance routes, full convoy round-trip prepayment, recovery clearing a paused escape, and stationary stranded defense.
- Huge seed 10555 controlled 300-tick review: logistics simulation work fell from 6,881 ms to 591 ms after preserving handoff navigation graphs; total p95 fell from 66.43 ms to 14.69 ms. This is a performance fixture, not a balance result.
- Removed unrelated Sandbox and AP-round edits accidentally carried from the shared checkout while preparing the initial server/AI slice. Those edits remain preserved in the shared checkout.
- The World AI timing fixture now removes its completed Massive room after verifying victory, preventing repeated full-map victory snapshots from contaminating active-room timing. Existing large victory-snapshot cost is recorded for later.
- Integrated 35 feature files into the shared checkout using checked three-way merges and saved its original file contents outside the checkout. Existing staged changes and other sessions' work were preserved.
- Shared-checkout focused physical, World, client, server/AI and newer discovery tests pass. Long queued convoy funding includes the current full destination even between navigation legs.

- Legacy server fixtures explicitly disable logistics at match start, while dedicated real WebSocket tests verify default activation in all four supported modes. Reserve and scheduler node:test cases run in child processes so core assertion failures terminate the main CLI clearly.
- Updated corpse animation verification to use living-pose muzzle metadata with the ordinary 23-frame field-crew fallback, retaining compatibility with another session's additional digging frames.
- A shared-checkout full-run attempt encountered a concurrently added bridge-group failure before supply tests executed. The other session fixed that movement issue and its focused bridge-group suite now passes. Full feature verification runs on the isolated branch to avoid concurrent source changes.

- Shared-checkout compatibility checks use the current, upward-rounded Kaiju health when validating its boss bar, rather than the pre-tick health before combat damage. The focused Kaiju fixture passes. This test-only adjustment stays with the other session's uncommitted Kaiju work in the shared checkout.

- Dedicated executable integration suites replace the proposed standalone verification tool; the main test CLI runs these physical-convoy, World and live-server fixtures directly.
- The combined remaining-check driver passed simulation, command feedback, availability, vehicle motion, naval, armor, wheeled, gun and aircraft checks. It then found the other session's new distant infantry spade geometry exceeding the existing 150-triangle budget. That unrelated asset change is excluded from the isolated supply branch.

- Final required verification: node test.js exited 0 on codex/supply-convoys (session 64569). Reserve 17/17, scheduler 28/28, physical delivery, World, real-server default activation and client fixtures pass. AI fog replay passed 4,489 paired turns and 1,975 orders; the full AI match and all 11 room-lifecycle scenarios passed. All simulation, model, browser-serving and performance regression checks passed. Game and test file fingerprints remained unchanged during the run.
- Feature changes are present in the shared checkout; its existing index and unrelated changes remain preserved. No GitHub publishing was requested. Keep the feature branch and its native worktree for recovery and review.
