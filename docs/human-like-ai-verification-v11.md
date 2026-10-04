# Human commander: verified working slice

`node test.js` exited 0 on 2026-10-04. This is an implementation checkpoint, with release gates still open.
The run started at 08:54:58 UTC and finished at 09:16:35 UTC, on parent revision
`fc60be93907b9214a6699f4e88753180c9422dea`. Independent before/after manifests cover 588 tracked and untracked,
nonignored files. They are identical, with digest
`e60663270bcc8eb976bcd78d578376f94164d89ad747b2a0681b9a2a3dbc7f8d`.

The local retained log is `/tmp/human-ai-v11-final-full-test.log`, 12,409 bytes, SHA-256
`3708548b26de75ce517ee1882d69c72a42a4a1e78dae4bffb5cd6930adcc5602`.
The manifests are `/tmp/ai-v11-full-before.json` and `/tmp/ai-v11-full-after.json`.

The suite includes all 40 registered subprocesses, every `test-engine-ai*.js`, World observation, Horde queues,
the recorder and overlay, then the authoritative simulation, engineering, rendering, server and performance checks.
No registered test was skipped. The new checks cover screen/minimap separation, actual camera projection, physical
selection and targeting, opening and handover delays, seeded timelines, one command per tick, rolling input caps,
reaction floors, operation commitment, persona persistence and local telemetry privacy.

The fog perturbation test completed 4,489 paired turns and 1,886 decision-layer orders. Its command population
includes purchases, moves, attack-moves, attacks, abilities, retreats, cover, support, building and Engineer work.
It perturbed 30,213 hidden units, 9,566 visible units, 7,353 subprecision positions, 2,205 secret depots and
237,654 hidden mines, with 420 dropped-visible controls. Dry observations leave the authoritative state unchanged.
These proofs passed, but a separately discovered canonical effect-mask mismatch still needs correction.

The original planner capture probe retains its 40-tick decision-only cadence and unchanged 180-second limit.
It captures every point in 106 seconds. The new actual-input Normal match captures its first point at 23 seconds,
all points at 113 seconds, and ends with seat 2 winning at 567 seconds. It purchases 104 units; 81 die.
The gameplay probe verifies the ordinary input-to-submit path, command spacing and physical input caps.

Timing migrations are explicit: decision-layer tests use `decisionOnly`; gameplay tests deliver ordinary 10 Hz
observations and advance the hands each tick. They retain original capture deadlines and meaningful command
assertions. Horde Waves remain an explicitly tested scripted director. The engineering regression checks retain
their original 90-second mine, 30-second repeated-order, 300-second complete crater and 60-second bridge checks.

Release is still blocked by the separate humanity, balance, final visual and independent-review gates.
The 15-match diagnostic is insufficient for the required 120-match campaign. Its physical APM medians are
25.333/39/60.333 for Easy/Normal/Hard, and required-screen-event Kaplan-Meier medians are 7.35/2.25/1 seconds.
These fail the authored reaction targets and Hard activity floor. Censored stimuli remain in the population.
The V11 quiet release benchmark also fails: exact-baseline AI p95 changes from 8.658 to 11.149 ms, and ticks above
40 ms change from 3 to 5. Passing the ordinary suite's performance checks does not waive this additional gate.

Next corrections address shared effect visibility, useful singleton control groups, cancellable unpressed inputs
waiting for their budget, and explicit causal accounting for one order serving multiple already perceived events.
A faster second screen-memory copy has matched complete game and memory graphs in controlled candidate runs.
An early-attention-yield experiment was rejected: Hard gained 996 inputs, including 948 camera actions, while
accepted commands increased by only 24 and required reaction median worsened from 1 to 1.6 seconds.
