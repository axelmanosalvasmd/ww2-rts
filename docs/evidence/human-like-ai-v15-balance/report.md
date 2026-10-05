Historical V15 gameplay gates passed. These results do not qualify current R6 source. The separate V15 quiet-performance gate failed.

| Campaign | Matches | Wins | Draws | Timeouts | Median simulation seconds |
| --- | ---: | --- | ---: | ---: | ---: |
| Classic | 30 | USA 7, Germany 10, USSR 9 | 4 | 0 | 1600 |
| Conquest | 60 | USA 18, Germany 25, USSR 17 | 0 | 0 | 636.65 |
| Hard versus old Easy | 20 | 16/20 (80%) | 0 | 0 | 340.525 |
| Hard versus old Normal | 20 | 17/20 (85%) | 0 | 0 | 417.025 |
| Hard versus old Hard | 20 | 10/20 (50%) | 0 | 0 | 469.575 |

Classic decisive shares are USA 26.92%, Germany 38.46%, and USSR 34.62%. Conquest shares are USA 30.00%, Germany 41.67%, and USSR 28.33%. Both satisfy the required 25–42% range. All 150 original rows finished. The old Easy threshold of 70% passed. Old Normal and Hard are reported comparisons without a win threshold.

Corrected Classic baseline: USA 12, Germany 7, USSR 10, one draw, median 1600 seconds. V15: 7, 10, 9, four draws, median 1600 seconds. Conquest baseline: 29, 20, 11, median 596.175 seconds. V15: 18, 25, 17, median 636.65 seconds. Original seeds, map, spawn rows, army, faction count and simulation limits match.

All 763 frozen archive files and each campaign's 32 or 35 runner dependencies verified. Reports, checkpoints, final log records and independent reductions agree. The original Conquest baseline has no source fingerprint, which limits exact source attribution. The corrected Classic source tar is verified. Navigation and initial observed-wall code differ, with exact diffs retained; their equivalence is not independently established here. The simulation diff changes no unit, population cap, cost or economy code. Legacy 5293 source changes are import paths only, and both duel seats use the same V15 engine.

The retained progress reducer always passes complete=False, so its allFinish=false field is not a final audit result. The final audit verifies every original row and reports allFinish=true. Raw supervision remains untouched.

Keep the compact proof bundle as historical V15 evidence. Preserve the full common archive separately. Root should review durable placement before copying into repository evidence. No matches were rerun and no rows were omitted.
