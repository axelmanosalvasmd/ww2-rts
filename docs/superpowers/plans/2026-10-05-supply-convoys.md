# Supply Convoys Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Implement automatic physical logistics, finite ground-unit reserves, and mandatory supply withdrawal in four modes.

**Architecture:** Keep inventory, reserve accounting, jobs, and observable logistics state in shared/logistics.js. Supply authoritative navigation and creation callbacks from shared/sim.js. Client details use a separate logistics module and existing snapshot ancillary arrays.

**Tech Stack:** JavaScript ES modules, Node.js authoritative 20 Hz simulation, Three.js client, WebSocket snapshots, node:assert tests.

**Spec:** docs/superpowers/specs/2026-10-05-supply-convoys-design.md

## Global Constraints

- Enable the new system in Conquest, Classic, Annihilation, and World Conquest.
- Keep excluded modes, aircraft, ships, neutral guards, recruitment prices, and resource income rules unchanged.
- Preserve unrelated concurrent work. Stage specific files and run node test.js before committing.
- Keep DESIGN.md and CHANGELOG.md synchronized with gameplay changes. Do not use em dashes.
- Ground reserves: ammunition about 90 seconds of firing, provisions 120 seconds, fuel 180 driving seconds, emergency fuel 60 driving seconds.
- Low threshold 25%, recovery threshold 50%, provision warning 20 seconds, replacement delay 30 seconds.
- Automatic convoys require no player interaction. Manual movement resumes automatic work when finished; hold persists.
- No private cargo, enemy reserves, hidden threats, or unexplored World terrain in recipient observations.

## Review Focus

- Changing geometry or an unreachable retreat path retains exhaustion and does not grant stationary retreat protection.
- Partial deliveries do not reset warning timers or duplicate cargo/currency.
- All firing paths, including AA and offensive abilities, honor ammunition once per accepted launch.
- World relays, reconstructed HQs, and allied stores preserve paid ownership and do not create inventory.
- Large army settings retain bounded fleet, grouped jobs, and owner-private reconnect/spectator data.

### Task 1: Reserve and inventory kernel

**Files:** Create shared/logistics.js and test-logistics.mjs.

**Interfaces:** Export LOGISTICS tuning, enabledFor(g), initializeUnit(g,u,def), consumeAmmo(u,count), canFire(u,count), tickReserves(g,u,dt,travelSeconds), shortageRate(u), recoveryRate(u), recovered(u), and transferStock(store,u,seconds). Detailed reserves live at u.logistics; inventory contains ammunition credit, provision seconds, driving-fuel seconds, paying owner, and bounded capacity.

- [x] Write behavior tests for enabled/excluded modes, 90-second weapon endurance, 120-second provision depletion, moving/idle/riding fuel, non-stacking shortages, finite inventory conservation, and partial recovery.
- [x] Run node test-logistics.mjs. Expected: new behavior fails before implementation.
- [x] Implement the kernel with per-projectile prices and latched shortage/warning state.
- [x] Run node test-logistics.mjs. Expected: all reserve/inventory behaviors pass.

### Task 2: Authoritative convoys, combat, retreat, observations, and AI

**Files:** Modify shared/logistics.js, shared/sim.js, shared/ai-view.js, shared/ai.js, server.js. Create test-supply-convoys.mjs.

**Interfaces:** stepLogistics(g,dt,hooks), logisticsSnapshot(g,slot), and commandLogistics(g,slot,cmd,hooks) use explicit navigation, spawn, shared-vision, and retreat callbacks. Owner-private snapshot logistics objects encode reserves, trucks, stores, and known routes. Existing unit rows stay compatible.

- [x] Add public-command simulations demonstrating automatic deliveries, real intercepted cargo, replacement, manual hold/resume, finite support, real fuel costs, source destruction, failed withdrawal, and relief recovery.
- [x] Add hidden-threat, paid-allied-inventory, currency-affordability, warning-latch, full/partial salvo, and private-spectator regressions. Run node test-supply-convoys.mjs and observe missing behavior.
- [x] Add an unarmed 120-HP truck at 7.5 m/s; add distinct finite Supply Caches. Implement base sources, Point stores, automatic World relays, grouped delivery jobs, fuel-prepaid trips, staggered fleet replacement, and manual control.
- [x] Hook creation, every firing entry, actual travel, recovery, death, and mandatory withdrawal into the kernel. Do not clear withdrawal on failed paths.
- [x] Extend recipient/AI observations, spectator filtering, and shortage-aware AI through public commands and known information.
- [x] Run both dedicated suites and mode/World acceptance regressions. Expected: every promised server behavior and privacy scenario passes.

### Task 3: Client controls, rendering, alerts, and full verification

**Files:** Create client/logistics.js. Modify client/main.js, client/selection.js, client/orders.js, client/hud.js, client/keys.js, client/alerts.js, client/overlay.js, client/symbols.js, client/models/wheeled.js, client/unit-models.js, client/index.html, client/es.js, DESIGN.md, CHANGELOG.md, test.js. Create test-logistics-client.mjs and focused physical-convoy integration suites.

**Interfaces:** Decode ancillary logistics state, render owner reserve/cargo cards, show known routes, and route selection/manual orders through existing command dispatch. Resume deliveries and logistics selection have explicit controls.

- [x] Write client behavior tests for ordinary army selection excluding trucks, direct convoy control, stock display, grouped alerts, and route privacy. Run node test-logistics-client.mjs and observe the missing behavior.
- [x] Implement truck/cache models and symbols, owner-only reserve indicators, warning countdowns, command-card stock/hold/resume controls, optional route overlay, and Spanish strings.
- [x] Register dedicated suites in test.js. Document exact tuning and any measured balance/performance findings in DESIGN.md and CHANGELOG.md.
- [x] Run node test-supply-convoys.mjs, node test-world-supply.mjs and node test-logistics-server.mjs for reproducible automatic supply, blockade/relief, economy, live activation and World relay runs, recording outputs and seeds.
- [x] Run node test.js, inspect all results, and inspect the rendered client through the browser. Fix actual regressions and rerun covering checks.
- [x] Request a fresh whole-change review and address actionable defects. Run the full required test command after final changes.
- [x] Integrate the verified feature into the shared checkout without overwriting concurrent changes. Stage only feature changes and record the completed slice.

## Execution decisions

The user explicitly instructed implementation without further prompts. Written-spec, plan, worktree, and execution-method approval prompts are waived. Use inline execution for the coupled simulation hooks, then a fresh whole-change reviewer. Keep progress and deviations in this plan's ledger. Integration into the user's local game is part of the authorized build; no GitHub publishing is requested.
