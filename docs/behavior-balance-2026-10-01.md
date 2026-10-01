# Completed behavior balance evidence

### Full paired comparison

Completed the issue #17 gate: 300 Conquest and 120 Classic matches per build on Three Crossroads, three adaptive AI seats, standard starting armies, shuffled spawns. Both builds use seeds 100003 through 100302 for Conquest and 100003 through 100122 for Classic. Each batch used two workers, with at most four workers across concurrent batches. Master is `41eefe8`; the final frozen build combines the reconciled unit behavior, formation simulation and integrated AI planner. The final sim SHA-256 is `d7013427a04ee4189d9f4a4b73226870ee575bbe716be736c2f52ad0045bb61e`; AI SHA-256 is `1614db36fd3086d579fcbeb3d46694e66a9719151734dc0a279f03f84760e16f`. All ten shared/map/package digests still matched the integration source when the completed results were checked.

| Measure | Master Conquest | Integrated Conquest | Master Classic | Integrated Classic |
| --- | --- | --- | --- | --- |
| Matches | 300 | 300 | 120 | 120 |
| Draws | 0 | 0 | 0 | 2 |
| USA/GER/USSR wins | 102/91/107 | 98/101/101 | 41/39/40 | 30/43/45 |
| Mean / median length (min) | 8.23 / 7.72 | 8.45 / 8.46 | 20.80 / 20.01 | 21.40 / 20.91 |
| 2nd-place VP / winner | 0.46 | 0.5 | n/a | n/a |
| Lead changes / match | 0.86 | 1.01 | n/a | n/a |
| Decided before Sudden Death | n/a | n/a | 76/120 (63.3%) | 74/120 (61.7%) |
| Sampled infantry time on cover tiles | 27.3% | 25.8% | 32.3% | 32.1% |
| Infantry occupancy samples | 458095 | 464877 | 744051 | 762203 |
| Infantry hits on cover tiles | 46.5% | 35.6% | 35.6% | 31.7% |
| Infantry hits with graded shelter | 48.2% | 37.7% | 41.1% | 37.4% |
| Crowded idle squads | 44.5% | 11.7% | 47.9% | 35.3% |
| Rear / front vehicle hits | 19.3% / 51.4% | 13.7% / 67% | 8.2% / 74.9% | 4.2% / 89.1% |
| AT shots on vehicles | 15.8% | 16.5% | 3.7% | 4.1% |
| MG shots on infantry | 91.3% | 90% | 45.2% | 54.9% |
| Kills / match | 10.9 | 11.8 | 72.3 | 70.4 |
| Measured wall runtime, 2 workers | 504 s | 637 s | 1476 s | 897 s |

All 840 matches ended normally: 838 had winners and two integrated Classic matches ended in Sudden Death draws at 26.67 min (seeds 100037 and 100115). Neither mode hit its runner cap (40 min Conquest, 60 min Classic). Runtime measures include concurrent host work and do not establish a performance difference. Faction wins in Conquest are 34.0/30.3/35.7% on master and 32.7/33.7/33.7% in the integrated build. Classic wins are 34.2/32.5/33.3% versus 25.0/35.8/37.5%. These samples measure the combined behavior and AI changes; they do not isolate either change's causal effect or establish exact faction equality.

The cover occupancy estimate and the hit-location shares answer different questions. The Conquest cover-time estimate falls 1.5 percentage points while hits on cover tiles fall 10.9 points. The diagnostic target-score variant shows that target choice can move hit share substantially. The final comparison does not directly measure damage saved by cover, so the lower hit share alone does not show weaker cover protection. No defense orders, unit prices, health or weapon stats were removed or tuned to obtain these measurements.

End reasons: master-conquest-300: {'vp': 300}; final-conquest-300: {'vp': 300}; master-classic-120: {'hq': 120}; final-classic-120: {'hq': 118, 'draw': 2}

Raw results and source manifests are in [balance-2026-10-01](balance-2026-10-01). Reproduce each result with `node tools/balance.mjs --root <source> --mode conquest --n 300 --seed 1 --workers 2`, or `--mode classic --n 120`. The master source is commit `41eefe8`; final source files must match the recorded SHA-256 values.
