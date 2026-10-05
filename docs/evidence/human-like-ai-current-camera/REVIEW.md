Current camera visibility correction

Only two runtime guards change. New concern routing and pending emergency routing check onScreen(target, state.camera, view), without suppressing a return because eventOnScreen was true at creation. The creation descriptor remains historical, immutable and unchanged. Hands, input duration/noise, opening, reaction floor, physics and controller budget are untouched.

Frozen baseline commander48a3f5014aa52b0b86e616515a176890bf3908d4495025cc35763a97eaba55d4.
Candidate commander27ea7d5b6a05c29e01c1ee1aa630d2d9e486242f364273e7ab1d863b5ae87617.
Full source manifests are source-manifest.json. No production edits.

Reproduction uses the reviewed human-ai-v15-response-group-fixture.patch first. This establishes its reused group through two actual accepted movements, rather than assuming a first-use binding. before.log preserves the original full response failure after this fixture migration. after-unchanged-response.log preserves the entire original response suite passing with exactly the two runtime guard corrections.

Additional fixture assertions keep all original interrupted and ordinary diagonal-arrival checks. They add: an actual currently visible damage response needs zero extra camera inputs; genuinely historical on-screen damage is currently off-screen after the held pan; the held KeyD still starts76 and finishes96, paying all20motor ticks; a real camera return then exposes the victim, with fresh deliberation before its accepted native retreat; immutable original damage creation remains screen source/onScreen true at78; emergency planning never loops through an off-screen inventory actor. A separately expired concern exercises fresh concern selection after the same physical pan.

Strict candidate full response log: after-extended-response-strict.log.
Pending emergency: observed cue78, original paid pan finishes96, real camera return120, accepted native retreat137.
Expired concern: cue78, same pan96 and return120, accepted native retreat139.
Uninterrupted diagonal visit stays exactly pans96/121, fresh plan128, native command136.
Real living-group fixture: accepted pair119/224, binding227, switch244, recall256, accepted survivor265.

Both single-guard variants are retained. only-pending-guard.log fails the original required retreat. only-concern-guard.log eventually accepts a delayed response at188, but only-concern-guard-strict.log rejects its intervening off-screen emergency planning. The additional strict assertion distinguishes the missing pending guard even when a later new concern eventually recovers. Earlier assertion-diagnostic logs are retained, including a corrected physical-start expectation76 (queue initiation was75).

All focused runs used CPU3 nice19. These are functional native controls, not latency acceptance measurements. No authoritative fog, terrain or raw planner information changes are made.

Apply runtime.patch to current root. Apply the already reviewed group fixture patch, then response-additions.patch, or copy after/test-engine-ai-response.js. Root owns test registration and metadata. No commits or staging were performed.
