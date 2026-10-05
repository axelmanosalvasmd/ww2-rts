# Current native human-slip component evidence

The fixed current-source fixture demonstrates all three Phase 3 human-slip components: an owned off-screen MG remains truly idle and unwatched for at least six seconds; own MP accumulates during ordinary native combat; and a naturally arriving flank receives a delayed, paid camera response. This supports the behavior checkbox separately from the original numeric release gates. All timing, APM, opening-variety, population and other numeric gates remain unchanged and open.

The archive preserves all 92 original members without changing any archive byte. It includes the full predeclared setup, five complete raw native episodes, copied source modules and their SHA map, portable fixture, reducer, results, logs and review. Native inputs, commands, events, creation-time detector streams, private proof and complete eventless/censor rows remain available. There is no population trimming or historical rescoring.

| Component | Exact native result |
| --- | --- |
| Initially unnoticed owned idle | MG 9 has no path, queued order, target, retreat or physical input and stays outside the actual camera through tick 120 (six seconds). |
| Own MP float during combat | At each difficulty, MP rises from 44.98750000000013 at tick 150 to 104.97083333333279 at 350. Actual native MG projectiles continue during the interval, no command spends MP before its end, and the public HUD reports 101 MP at 340. |
| Paid flank response | A native enemy projectile hits the rear MG at tick 162. Paid camera input completes at Easy 254 (4.60 seconds), Normal 217 (2.75), and Hard 183 (1.05). Each response is observed, pays its actual motor time and leads to an accepted MG ability. |
| Seeded repeat and quiet boundary | The complete Hard seed-1 trace repeats exactly. Removing the enemy before tick 0 produces no native shot, alert sample or required screen event; ordinary idle inspection still occurs at tick 194. |

The unchanged attention source uses conditional seeded optional-attention probabilities of Easy 0.5, Normal 0.3 and Hard 0.15. The condition is an attended public fight; a sampled slip lowers noncombat concern scores by 28 points for that cycle. These probabilities are not empirical per-event error rates. The five fixed 40-second episodes do not estimate population slip frequency, prove every seed orders the levels monotonically, or establish campaign acceptance.

The initial scene authors positions, camera, objectives and resources. Only the enemy receives a legal native attack-move before tick 0. Subsequent movement, shots, contacts and inputs come from the actual engine and default commander. There are no later HP/cooldown edits, teleports, shot injections, owned setup orders or hold-fire restrictions. Private actor/resource/projectile records are proof only and never enter planning or classification.

The source binds commander 54ac57367727010017122c1d29c9050890537eced8c9d2b547f84927dc67f0f2, hands d209f6861bf1d4165012372d21398c46985d51e357b79009c5b7e4b8dffbdaa9 and priority 8bf45be46b77ac78436356190de8b2b2e26005e65879cf61b0a87f840484dc60. The pending equal-risk proposal is excluded. source-bindings.json contains every original source path and exact hash; verification.json records readback and comparison to Root at packaging time.

Files in this directory:

- native-component-evidence.tar.gz: unchanged original archive, 688,797 bytes, SHA256 49589269744c81a2df1e3b01405f6274fb2bd6e4179a28f8e437cbc3738d4b91.
- original-member-manifest.json: all 92 archive paths with exact byte sizes and SHA256 values, including the embedded manifest itself.
- source-bindings.json: the original preregistered source path and SHA map.
- verification.json: archive identity, complete readback results and scope limits.
- SHA256SUMS: checksums for these packaged files and this README.

Extract the archive with `tar -xzf native-component-evidence.tar.gz -C /tmp`. The internal prefix is ai-human-slips-r8-current/. REVIEW.md and component-results.json provide the full qualification; test-engine-ai-human-slips.js is the portable fixture. Its imports are relative to the game root. To independently check current Root without modifying it, copy its shared/ directory, client/keys.js and tools/*.mjs into a fresh temporary module directory, then copy that fixture to the directory's top level and run it there. Proof output is optional through AI_SLIPS_PROOF. The fixture was not registered in Root and no runtime or scoring change is included in this evidence package.
