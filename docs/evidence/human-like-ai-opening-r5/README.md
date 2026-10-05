# R5 opening diagnostics: durable evidence copy plan

This report covers two prospectively declared, isolated opening experiments. The first compares the original controller with a bounded first-preference saving guard. The second reuses the complete saving-guard output as its unchanged before treatment and adds only an actual accepted-buy receipt rule. Each treatment contains all 60 Conquest matches, seeds 1–20 at Easy, Normal and Hard, and all 180 seats for 45 seconds. No seed, seat, failure or censored event was selected out.

These are opening diagnostics. They do not certify reaction, physical APM, performance, balance or full-match behavior. Original metric definitions, screen-v1 population, numeric bands and all primary-only/explicit-link scoring views remain unchanged. The baseline opening failures and every refused command remain in the canonical reports.

| Treatment | Opening groups passing | Accepted purchases | Accepted non-buy commands | Refused purchases | Physical inputs | Camera inputs | Purchase MP spent |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Original | 1/9 | 400 | 1534 | 5 | 5239 | 1201 | 39510 |
| Saving guard | 9/9 | 332 | 1420 | 40 | 4929 | 1231 | 39490 |
| Saving with receipt | 9/9 | 341 | 1429 | 3 | 4874 | 1239 | 40280 |

Opening variety uses the first five actual accepted purchase families within 45 seconds. The original target requires at least three meaningful prefixes and no prefix above 50% among all 20 seats of each faction/difficulty. Coordinates never define a new family. All 180 first-family outcomes and first-buy timings are unchanged between the saving-only and receipt treatments. In the first trial, 30 seats change infantry to anti-tank and 39 change infantry to mortar. Each of those 69 seats issues meaningful accepted movement while saving; six native engine fixtures also prove actual unit displacement before purchasing.

| Group | Original distinct / largest share | Saving distinct / largest share | Receipt distinct / largest share |
| --- | --- | --- | --- |
| Easy USA | 5 / 60% (fail) | 7 / 30% | 7 / 30% |
| Easy Germany | 4 / 80% (fail) | 7 / 40% | 6 / 40% |
| Easy USSR | 3 / 75% (fail) | 8 / 30% | 8 / 35% |
| Normal USA | 4 / 55% (fail) | 8 / 20% | 8 / 20% |
| Normal Germany | 4 / 55% (fail) | 8 / 25% | 9 / 25% |
| Normal USSR | 7 / 35% | 9 / 20% | 10 / 20% |
| Hard USA | 6 / 60% (fail) | 9 / 25% | 9 / 25% |
| Hard Germany | 4 / 60% (fail) | 8 / 35% | 9 / 35% |
| Hard USSR | 4 / 70% (fail) | 8 / 35% | 7 / 40% |

First-family counts are identical across levels. USA changes infantry 16/MG 4 to infantry 7/AT 4/mortar 5/MG 4; Germany changes infantry 17/MG 3 to infantry 9/AT 3/mortar 5/MG 3; USSR changes infantry 15/MG 5 to infantry 9/AT 3/mortar 3/MG 5. Final accepted prefix counts, per-seat pairs, spending and every refusal are retained in the two accepted-openings reports and three-treatment comparison.

Exact immutable-source replay reproduces every native input and command/resource/acceptance record in all 35 affected first-trial prefixes. Of the saving treatment's 40 refusals, 38 follow an accepted purchase whose deduction is newer than the delivered resource reading. All six same-batch refusals are in that stale-reading class. Every batch's purchase prices fit the observed MP, and the existing planner already projects accepted proposal costs locally. The receipt treatment therefore adds no second money or type ledger.

All three remaining receipt-treatment refusals are genuine automatic reinforcement during pointer travel: Easy seed 8 Germany MG id 6 gains25 HP for25 MP at tick 798; Hard seed 14 USA MG id 3 gains27.9 HP for25 MP at tick 645; Hard seed 16 USSR rifle id 7 gains20 HP for10 MP at tick 765. Runtime receives no authoritative resource query to predict those costs. They remain refused in the report. The final treatment still has fewer non-buy commands than the original, so the short diagnostic does not establish stronger full-match play.

## Source scope

All three campaign snapshots use hands 7d531f35. Original and saving snapshots share commander 1a1417f0; receipt changes that commander only to record the accepted buy tick. The three runtime checkpoints are original 929d88cd, saving 4a8a9959 and receipt 52145bdf. All copied dependencies are preserved, including client/keys.js, tools/json-stream.mjs, the frozen screen-v1 oracle and its provenance. Each source archive contains the exact 42-file copied manifest and read-only source files.

The experiment snapshots precede later reusable-group/actor-coverage changes, the native minimap attack-key fix and public-start initialization. The current-root combined rebase was tested separately with hands a8df9cdd and AI7aa51979, then root adopted the reviewed saving and receipt hunks on its public-start source. None of the three archived campaigns measures that subsequently adopted source. The producer-trainability substitution candidate is also separate. It cannot be included in these results without a fresh frozen-source campaign.

Current source inspected at 2026-10-04T14:17:43.733061+00:00, for scope comparison only:

- `shared/ai-persona.js`: `34de5882046129d2000e5502e354123786f3ad7b7133f31e93863dcc36ba66cf`
- `shared/ai.js`: `8a09d98b855832f9c283a19b974b96e172c0bb9ccd268fca1bade286cbe21c41`
- `shared/ai-commander.js`: `48a3f5014aa52b0b86e616515a176890bf3908d4495025cc35763a97eaba55d4`
- `shared/ai-hands.js`: `a8df9cdda67ec8b10d20606a116d3c089d15ff59af7d450a90e66e57c8c46fdb`

## Archive verification and storage

The three canonical full gzip reports retain every native input, command, creation event and private measurement frame, plus the complete metrics and source checkpoints. Full raw spool files are not copied again. Historical spool manifests record the original per-match byte hashes and /tmp paths; those individual paths are provenance, not durable download locations. Each full report embeds those same complete raw graphs in its results array.

All full-report gzip hashes and decompressed byte hashes were independently checked again before preparing this map. Both original-pair and followup verification records recompute every compared seat metric and aggregate with their frozen reducers, check timeline/private-stream digests and verify all source hashes. Source tar files were independently opened and all 42 copied files matched their archived manifest. Staged compact/analysis/native-witness gzip files reproduce their exact source bytes on decompression. Compact reports preserve evidenceArchive.path full.json.gz by keeping each treatment in its own target subdirectory.

The exact source-to-destination map is copy-manifest.json. Every entry records SHA256 and byte size. Copy-inputs-roundtrip.json records fresh source-tar and canonical report checks. The selected payload is approximately 9 MiB. Repository files have not been written by this preparation. Root can review the mapping and copy the selected bytes after verification. Scripts retain their original /tmp source paths for exact historical reproduction; adapting locations is separate from copying evidence bytes.

| Treatment | Canonical gzip SHA256 | Decompressed raw SHA256 | Raw bytes |
| --- | --- | --- | ---: |
| original | `0675afa224139a41c67d71232b7a7eac38bfdacbaeed5d79a37ab15bf307ff99` | `5d901f52be7b3f4060e820db28419a8f4b78405f5f8dfa0b131cd8809e72321a` | 41499017 |
| saving | `405d3c9bd9f2ef19eb3e617282e04177bd64e511892f086b0477c0185510c24c` | `ad6099ee68ec87c02aeceb9ba369b3e5d748da0324c2721b756489b62fa2009b` | 38259168 |
| saving-receipt | `2bc11a29531c285171cc1804fb7783c180f10acb5f90db9cf635b9142f67517c` | `30f631312ffde4d1adad83e8c6437e9159949e856b19fe7d18d10d70aad68a8c` | 38394288 |

## Exact artifact copy map

Destination paths are relative to `docs/evidence/human-like-ai-opening-r5`. Every source is an existing immutable experiment artifact or a verified storage-only gzip staged under /tmp.

| Destination | Source | SHA256 | Bytes |
| --- | --- | --- | ---: |
| `original/full.json.gz` | `/tmp/human-ai-opening-paired/base/full.json.gz` | `0675afa224139a41c67d71232b7a7eac38bfdacbaeed5d79a37ab15bf307ff99` | 2012458 |
| `original/compact.json.gz` | `/tmp/human-ai-opening-r5-copy/original/compact.json.gz` | `dddfac34d505088877f79fc22c1ac2ffae7c7f17755da10b7c71eeb9a09fdd9b` | 684673 |
| `original/source-checkpoint.json` | `/tmp/human-ai-opening-paired/base/source-checkpoint.json` | `2f59865a7d2b168d8d5467489d7928abb49ea899e9ddba22efc9a3bc479886df` | 3677 |
| `original/source-manifest.json` | `/tmp/human-ai-opening-paired-base-source/source-archive.json` | `526d1a2fa41b8f6ad1e7db3cc7413b8a4ead5561412cbb9b252e217b53a15b8b` | 4377 |
| `original/source.tar.gz` | `/tmp/human-ai-opening-paired/base-source.tar.gz` | `429f97f2de81a8e04f5e7685adb79b6dfeb30761228cb77ccbf8f92deb68f072` | 398390 |
| `original/historical-spool-manifest.json` | `/tmp/human-ai-opening-paired/base/raw-manifest.json` | `e9feee98c88831f489728af058e47bab113ca4125843e84b2c9de6f0a9b12615` | 15329 |
| `saving/full.json.gz` | `/tmp/human-ai-opening-paired/candidate/full.json.gz` | `405d3c9bd9f2ef19eb3e617282e04177bd64e511892f086b0477c0185510c24c` | 1905997 |
| `saving/compact.json.gz` | `/tmp/human-ai-opening-r5-copy/saving/compact.json.gz` | `7fc250cbae3a2856936848223b1f7d84e46196be74f2f5f47f96d6a21972c705` | 671377 |
| `saving/source-checkpoint.json` | `/tmp/human-ai-opening-paired/candidate/source-checkpoint.json` | `362e24788332b174340c21ef9e4e99a6dfa35587752249a320315f60b58d8b06` | 3677 |
| `saving/source-manifest.json` | `/tmp/human-ai-opening-paired-candidate-source/source-archive.json` | `43acc0ee97b1eeec2c84eca68c8b10527031df8d4c562bdb8ceb0e369f1a5686` | 4740 |
| `saving/source.tar.gz` | `/tmp/human-ai-opening-paired/candidate-source.tar.gz` | `580136394ae5497f02d18a91d28c64ca22b6c5ca965031b3234dbb079488593f` | 398827 |
| `saving/historical-spool-manifest.json` | `/tmp/human-ai-opening-paired/candidate/raw-manifest.json` | `7f8d284868ed5378a1de1887072b2e5e7a950603a26c0bf59378c6a643c11710` | 15629 |
| `saving-receipt/full.json.gz` | `/tmp/human-ai-opening-receipt-followup/candidate/full.json.gz` | `2bc11a29531c285171cc1804fb7783c180f10acb5f90db9cf635b9142f67517c` | 1909069 |
| `saving-receipt/compact.json.gz` | `/tmp/human-ai-opening-r5-copy/saving-receipt/compact.json.gz` | `9aae9a4035f196b6337dae683980571561dc6c52eb2414f94d19912a6a5698ef` | 675422 |
| `saving-receipt/source-checkpoint.json` | `/tmp/human-ai-opening-receipt-followup/candidate/source-checkpoint.json` | `59b15fd3910d5d60421ad04d90d6666f7b7d59fd5eeac9aacf63a6a924d2f195` | 3677 |
| `saving-receipt/source-manifest.json` | `/tmp/human-ai-opening-receipt-source/source-archive.json` | `be6557730ae37e03d01f3b89951d8657ab9c1049c231eb1e72f820c9f938c2aa` | 4481 |
| `saving-receipt/source.tar.gz` | `/tmp/human-ai-opening-receipt-followup/candidate-source.tar.gz` | `80d3af5035c9e8c99f8bb65c7fcd958b2d8b24c166d1bd54c437601d89d92a78` | 381132 |
| `saving-receipt/historical-spool-manifest.json` | `/tmp/human-ai-opening-receipt-followup/candidate/raw-manifest.json` | `c51d9a74fb1320c8bb90c5334ce86f581cf3da5498a82fbc1fe7139db0989879` | 16229 |
| `protocols/saving-preregistration.json` | `/tmp/human-ai-opening-paired/protocol-preregistration.json` | `d7c0e9dff40c22b85fd73c66fac0661d6eb8a632cff6ed250b6fffef23f7ef32` | 2770 |
| `protocols/receipt-preregistration.json` | `/tmp/human-ai-opening-receipt-followup/protocol-preregistration.json` | `0dfe19f3b43962c622be2f25135d8b0d2fdd5f1983044cb050a507e2bdd82630` | 2191 |
| `protocols/saving-launch.json` | `/tmp/human-ai-opening-paired/launch.json` | `b02576438bfc36463d5a2af1cce757c3b21c9d1c1a84181fa5eedec8c7e21dd9` | 209 |
| `protocols/receipt-launch.json` | `/tmp/human-ai-opening-receipt-followup/launch.json` | `8188332d7bacac43cd4c1c71a45aac2dfac76d46db9448c5c0f120f670605ca4` | 387 |
| `protocols/saving-completion.json` | `/tmp/human-ai-opening-paired/status.json` | `779715a142269e1e96a0fa7391a2d4874a9167a3348d7ae8d1e3bffc96fd2b30` | 586 |
| `protocols/receipt-completion.json` | `/tmp/human-ai-opening-receipt-followup/status.json` | `f59a36cff8609587929f99256b2a9794904ca55a6f07e2c1b5d0577f58620bd8` | 593 |
| `protocols/saving-campaign.log` | `/tmp/human-ai-opening-paired/campaign.log` | `511dd02d347770d606f3432d8c2ca20d7ec6f1dfcc3599139610da959ec7dd99` | 4611 |
| `protocols/receipt-campaign.log` | `/tmp/human-ai-opening-receipt-followup/campaign.log` | `849a9421635d4d0c7cf2cd43180043b01ed4405e0f729bac37df16fd843ed81f` | 2634 |
| `verification/saving-roundtrip.json` | `/tmp/human-ai-opening-paired/independent-verification.json` | `0dad26c59999cf02cfbe613867dedda324b751ed0d8d3b2666c12a599a06fc3e` | 1660 |
| `verification/receipt-roundtrip.json` | `/tmp/human-ai-opening-receipt-followup/independent-verification.json` | `3467f022d990f3f6bfbb7f19c7784efc9bf4c9c7654dffeec5b07d75548119a5` | 1660 |
| `scripts/verify-saving.mjs` | `/tmp/human-ai-opening-paired/verify-human-ai-opening-paired.mjs` | `4f1cc581b1729105c0bc4b8723f5614496116ef057829db2c8475d4371d49d3c` | 3269 |
| `scripts/verify-receipt.mjs` | `/tmp/human-ai-opening-receipt-followup/verify.mjs` | `bfd9ca9bc1db5fc16a36006d370480c9118ea51c52bc927064f880318404e819` | 3334 |
| `scripts/run-saving.mjs` | `/tmp/human-ai-opening-paired/run-paired.mjs` | `70b752d2250a2d7146f6293ebd8f8d9db6855c2ef223eda8a4eb871e9f191371` | 5410 |
| `scripts/run-receipt.mjs` | `/tmp/human-ai-opening-receipt-followup/run-paired.mjs` | `b0bc36e33147a8bde2bc4e1471131e7cfe28fc3a39dd99b1cf3a5c331181e337` | 5741 |
| `scripts/analyze-saving.py` | `/tmp/human-ai-opening-paired/analyze-human-ai-opening-paired.py` | `a986a34e73ac6ebd493d3c44e83ce95b0ac4c19b36924fb29622db1ac26b5a7c` | 5821 |
| `scripts/analyze-receipt.py` | `/tmp/human-ai-opening-receipt-followup/analyze.py` | `3eaf3fbf0d2b3861e52273b75dadb8aa99106f9a1b840ab5f8bb81105fbe7afc` | 5831 |
| `patches/saving-persona.patch` | `/tmp/human-ai-opening-paired/persona.patch` | `b319431226c4db9c480cdcacc20dde3471dffb8b159387d992e2530c5e000be1` | 1739 |
| `patches/saving-purchase.patch` | `/tmp/human-ai-opening-paired/purchase.patch` | `08986c5f7ad512a192483aa78150dd4edb6484e49b373095898f985cf31cb5f6` | 3162 |
| `patches/receipt-commander.patch` | `/tmp/human-ai-opening-receipt-followup/ai-commander.patch` | `534cf6cf8618adceecde2bea51e57a9246d7ae325b42856c12f3a9a8d12d7c30` | 493 |
| `patches/receipt-planner.patch` | `/tmp/human-ai-opening-receipt-followup/ai.patch` | `1e39e8a9735c0a5410a6cf5c6e773c1c88686106896c53bed3613a3194486102` | 973 |
| `results/three-treatment-comparison.json` | `/tmp/human-ai-opening-receipt-followup/three-treatment-comparison.json` | `5ad00f6b357e1f9e31ba43d73baf6217730f0238729810dc0e7ed880e9ecbe6e` | 22149 |
| `witnesses/native-prefix-comparison.json` | `/tmp/human-ai-opening-receipt-followup/witness-result.json` | `47805f843acbf09dfe80a315565cafb43cbe14431510f3139d43d03d748def97` | 2398 |
| `scripts/native-prefix-comparison.mjs` | `/tmp/human-ai-opening-receipt-followup/witness.mjs` | `543abf0713efc134f5c8dcec35fb4ce0ddae05e7395d4be6694a642ba4291f67` | 2217 |
| `witnesses/receipt-engine-callbacks.json` | `/tmp/human-ai-opening-receipt-followup/fixture-result.json` | `13ec3302d8a97c9f1fbee49b05bbff7365714cc5f0508997eb51a71e6f5f49c4` | 1245 |
| `scripts/receipt-engine-fixtures.mjs` | `/tmp/human-ai-opening-receipt-followup/test-receipt.mjs` | `c3e15a54c8f2f0063d1efc403f42884eeb613c4ef88b5c55dddc42ba64b13b5c` | 5282 |
| `scripts/test-engine-ai-purchase-receipts.js` | `/tmp/human-ai-opening-receipt-followup/test-engine-ai-purchase-receipts.js` | `04e0039a90edc6d45c3ff03e651cfe0b38581375902c52fbf007f3160b2eb123` | 5465 |
| `scripts/test-engine-ai-opening-saving.js` | `/tmp/human-ai-opening-receipt-followup/test-engine-ai-opening-saving.js` | `9fa2f64fa702f015f098f528da71c264d76db4a5f576db491c77d8912b1d3d7b` | 7779 |
| `verification/receipt-permanent-test.log` | `/tmp/human-ai-opening-receipt-followup/permanent-test.log` | `7c940a94f633bf4186d446a3f6e40354ff85580d9f4f6812a39bf6c821a00668` | 47 |
| `scripts/original-opening-fixtures.mjs` | `/tmp/human-ai-opening-paired/human-ai-opening-candidate-fixtures.mjs` | `9a85f1057811a6074580cd5a7b8e08b97412497900349611f213b7e2e33374ef` | 8535 |
| `verification/original-opening-fixtures.log` | `/tmp/human-ai-opening-paired/human-ai-opening-candidate-fixtures.log` | `3c540a7474b17abca95b40494d054b8f6d4d181f7755a4bd409f63b88b131baa` | 3771 |
| `verification/original-fixture-initial-failure.log` | `/tmp/human-ai-opening-paired/human-ai-opening-candidate-fixtures-initial.log` | `2a06b431d119a9733fb81a1ac092bd46274fd2e8dd5888828457c64bf7717fad` | 652 |
| `verification/original-fixture-second-failure.log` | `/tmp/human-ai-opening-paired/human-ai-opening-candidate-fixtures-second.log` | `b2beb4a09939f7770ef8a71975e8f45236a6988d8c203984c9a1bf146c69dbb5` | 545 |
| `witnesses/saving-refusal-attribution.json` | `/tmp/human-ai-opening-paired/purchase-rejection-attribution.json` | `8827a2d2baa662adf812dd2eec4602b41b90220eba716e814172bc2e279d7615` | 80813 |
| `witnesses/saving-maintenance-attribution.json` | `/tmp/human-ai-opening-paired/automatic-reinforcement-rejection-attribution.json` | `b43425904b12ce176c3de2550744f50c3824ff09f770f19a14b4fd65593346b1` | 7070 |
| `witnesses/receipt-remaining-refusals.json` | `/tmp/human-ai-opening-receipt-followup/remaining-refusal-attribution.json` | `188a2dd4fe58d91a3509bf562969bef0bac350e09b74c4da696df2614a03bf50` | 5333 |
| `scripts/attribute-saving-refusals.mjs` | `/tmp/human-ai-opening-paired/attribute-human-ai-opening-rejections.mjs` | `6b4662a28e2bf2fcc9f5d12194a5254848a6ca36112f870cb92cdc1e5541b3a2` | 6070 |
| `scripts/attribute-saving-maintenance.mjs` | `/tmp/human-ai-opening-paired/attribute-human-ai-opening-automatic.mjs` | `f0d69eba561bbef9b134cb9a1cb2033d38eb144e49891e15fb47c310b6b067c8` | 6772 |
| `scripts/attribute-receipt-refusals.mjs` | `/tmp/human-ai-opening-receipt-followup/attribute-remaining.mjs` | `539b28cc41cd6c837ad749d40eb9e95b63fe0e4ee7d4b74fc17e7e37825322a4` | 6628 |
| `verification/saving-refusal-replays.log` | `/tmp/human-ai-opening-paired/rejection-replay.log` | `9d2828754003871f523fa364fd3519ec460ee2599519c55d664c284ce3789f1b` | 3606 |
| `verification/receipt-refusal-replays.log` | `/tmp/human-ai-opening-receipt-followup/remaining-replay.log` | `9ec800191b05cdb32aef175deae3321062a9d0d8626d552adf4264c1db8146c9` | 378 |
| `results/saving-accepted-openings.json.gz` | `/tmp/human-ai-opening-r5-copy/results/saving-accepted-openings.json.gz` | `64623b774e8e77d46989984f6bb0d0d65838c61309e440793655f321b8406e8a` | 23112 |
| `results/receipt-accepted-openings.json.gz` | `/tmp/human-ai-opening-r5-copy/results/receipt-accepted-openings.json.gz` | `059518963e61e9ac7512ac5783b919b2b5f8d06caf73c421add2c7e22e5f10b5` | 23504 |
| `witnesses/native-saving-movement.json.gz` | `/tmp/human-ai-opening-r5-copy/witnesses/native-saving-movement.json.gz` | `5856b995aadd8162b5bc6c7e1375b2edb772351b8132aee03d6f8478c5c96f23` | 11491 |
| `verification/copy-inputs-roundtrip.json` | `/tmp/human-ai-opening-r5-copy/verified-copy-inputs.json` | `a813d116c8067528c44735373a6961222307a33db24e079658dca7cf696a5eeb` | 1867 |
