# AI lab proposal

All work remains under `/tmp/ai-lab-proposal`. No checkout source, registration, changelog, design document, game route or dependency was changed.

The interactive sandbox is the primary iteration loop. It shares the actual incremental runner with the CLI. Authoring resets its history before making a new case. Browser output separates perceived detail from an explicitly labeled authoritative author toggle. Real camera geometry comes from `cameraFootprint`.

Proposal files: `tools/ai-lab.mjs`, `tools/ai-lab-node.mjs`, `tools/ai-lab-server.mjs`, `tools/ai-lab-runner.mjs`, `tools/ai-lab-browser.mjs`, `tools/ai-lab.html`, `tools/ai-lab-report.mjs`, `test-ai-lab.js`, `docs/ai-lab.md`. The patch adds exactly those files. Root owns adoption and test registration.

Verification on current native source:

- Focused test passed in 1427.1ms: complete-trace deterministic seed; actual screen negative control; unseen HP/type input/order invariant; minimap-only observer invariant through real camera reveal; all five preset conditions; timed motor start/completion/native receipt; command-per-tick constraint; caller-mutation isolation; scene reset; author cue delivery; static serving, MIME and neighboring denied paths.
- CLI guard example completed 20 simulated seconds in 202.6ms, with 19 real inputs, six native receipts and two public events. Refused commands remain in the trace.
- Invalid CLI duration 61 exits with an error before creating its output directory.
- Native browser integration initially exposed the existing hands import of `client/keys.js`. The static server now serves exactly that client dependency with realpath containment. Root owns the live browser verification.

Focused native runs total approximately 1.63 seconds for the final focused proof plus CLI report. This is measured tool runtime, not the time spent implementing. Earlier diagnostic runs were also short, with no full matches, campaigns or full suite launched. Root's existing full-suite and campaign processes were left alone.

The five presets are deliberately small authored scenes, not a replacement for arbitrary author setup. CLI custom scene JSON and the browser editor use the same case factory. Enemies have no scripted commander; normal automatic combat can still fire. Author hit injection deliberately changes health and emits a delivered hurt cue, and is labeled as authored. It is not described as a real weapon hit. The unseen-fire preset's damage is genuine MG fire.

Known limits: this is a top-down diagnostic view rather than the 3D game renderer; source reload requires browser refresh; arbitrary factions/support/UI production menus are not reconstructed. Unsupported fixture purchases return their actual engine error. Session/data limits keep the sandbox small. Nothing in the runner imports measurement or acceptance oracles.

Prototype launch:

```sh
node /tmp/ai-lab-proposal/tools/ai-lab.mjs --serve --root /home/judiazm/.t3/worktrees/ww2-rts/ai-human-commander --host 100.92.252.116 --port 3106
AI_LAB_ROOT=/home/judiazm/.t3/worktrees/ww2-rts/ai-human-commander node /tmp/ai-lab-proposal/test-ai-lab.js
```
