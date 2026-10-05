# R9 four-row performance failure

All four original rows exited 0 and retained source checks pass. Overall performance acceptance is FAIL: counted AI-phase maximum 44.992 ms rose to 50.765 ms, exceeding the original 10-percent allowance (limit 49.4912 ms). Both p95 checks, the exact-pair maximum and the timed-tick count check pass. The counted maximum failure remains authoritative for this batch; the passing exact pair does not replace it.

| Original pair | AI p95 before/after (ms) | AI max before/after (ms) | Timed ticks over 40 ms |
| --- | --- | --- | --- |
| Exact | 8.789 / 9.925, PASS | 48.911 / 46.647, PASS |Not instrumented |
| Counted | 9.279 / 10.933, PASS | 44.992 / 50.765, FAIL | 3 / 1, PASS |

Each row runs 1000 native simulation ticks in the original order: exact legacy, exact current, counted legacy, counted current. Latency statistics retain 990 samples after the original ten-tick warmup exclusion. AI p95/max apply to the complete AI phase; over 40 ms applies to the timed step+AI+snapshot tick. Startup is displayed separately and has no new numerical gate. Legacy startup zero is the unexecuted human-start branch, not proof of cost-free initialization.

The four complete native JSON reports and logs retain their actual statistics and sample accounting. They contain no 990 individual timing arrays or slow-tick IDs. The three payload hash samples are snapshot-size evidence, not timing vectors. This archive cannot identify the particular maximum tick or establish a GC/cold-navigation cause.

The package contains original prospective/draft preparation, final authorization and preregistration, runner/wrapper bodies and diffs, launch receipt, identity-checked pause inventory, guardian journal/lease, final results and ROOT's six recorded successful resume checks. Historical PREPARED_ONLY metadata is preserved unchanged and is superseded by the final native results. Packaging sends no process signals and makes no claim about those process states now.

All 217 actual measured source files and the separately declared counts-only statistics helper are retained. The approved 17 core hashes are separately bound in the original source receipt and package qualification. Input and measured copies both match the final checkpoint 73a93aa1. The reviewed runtime includes equal-risk commander 03a8b1aa and AP attention 6f267465. Legacy 5293ddb changes only the AI on that same current engine; master a3564a6a is a historical reference, not the before engine. Earlier R8/V21 and other failed protocols remain untouched through the 44 original path/hash references, verified during packaging. Their large archives are not duplicated.

Manifest.json maps copied originals to physical paths, members, bytes and SHA256. SHA256SUMS and verification.json bind this archive. Run `python3 verify-evidence.py` here for archive and original-byte checks; `--archive-only` supports later review without temporary originals. This package and verifier establish copy integrity, not a new measurement, full-suite result or remaining numerical acceptance. No benchmark, test, simulation, source/HEAD edit, signal, staging or commit ran during packaging.
