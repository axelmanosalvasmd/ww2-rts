An attended idle engineer currently cannot call the existing economy planner. That planner is limited to production and expansion visits, and the commander also refuses build/assist during an idle visit. This leaves a real on-screen engineer idle beside useful local work.

The retained Classic Hard seed 9, slot 0, tick 2164 observation shows engineer 14 idle at (75,19), 150 MP, and an unclaimed known resource node at (60,22). The retained World Hard seed 10, slot 1, tick 494 observation shows idle engineer 198 at (955,959) and own unfinished depot 195 at (968,972), built 0.975. These examples establish the denied work from delivered observations. They do not establish an APM improvement.

The proposal lets a specifically named, currently on-screen idle engineer use the existing planner for build/assist targets within 24 m that the actual camera and team sight both reveal. The engineer cannot be moving, fighting, retreating, entering, garrisoned, throwing, digging, constructing, entrenching, or reserved for bridge/fill/demine work. It preserves production and expansion behavior, shopping gates, prices, reaction, selection, command execution, and hands budgets. Rush behavior remains as before.

Apply these review artifacts from the repository root:

- /tmp/human-local-idle-engineer.patch
- /tmp/human-local-idle-engineer-test.patch

Both pass git apply --check against ai.js SHA256 1e601a848c53b1d31493d3fff18648ead11721d5c4a389a50ea1a14aa691a2e0 and commander SHA256 27ea7d5b6a05c29e01c1ee1aa630d2d9e486242f364273e7ab1d863b5ae87617. Candidate ai.js SHA256 07aa8806246fd6f6b869629a17214df19da5f18af01f00d8f819989bd361af38; commander e63680683fc8ab97ee45d1648197c151a32f4e6de4e5bbc82daa7d8ae9187af2.

The portable test is test-engine-ai-local-engineer.js. It uses ordinary imports, native creation, delivered snapshots, paid hands inputs, native command dispatch once per input, and native stepping. LCG 23 is scoped over each complete fixture and restored in finally. It prints one PASS line. The candidate passes all 13 fixtures. The unchanged baseline fails the original named idle assistance assertion, actual zero versus expected one.

Native paid proof is retained in /tmp/human-local-engineer-paid-proof.json:

- Assistance: select click tick 51, native accepted right click tick 55; actor path empty and build zero before dispatch; unfinished barracks built fraction 0 to 0.613333333333334 after native movement and construction.
- Depot: select click tick 48, build key tick 50, native accepted placement tick 55; actor path empty and build zero before dispatch; MP decreases by the actual unchanged depot cost, 60 MP; native depot built fraction reaches 1.
- Eleven negative controls: remote site, foreign site, native movement, off-camera actor, stale remembered actor, native active assistance, a pending repair reservation, wrong named actor, anonymous idle, nearby camera-hidden site, and a nearby node genuinely hidden by native LOS behind an authored building wall.

Some negative fixtures later do legitimate work during production or expansion. Assertions preserve that behavior and require zero build/assist inputs belonging to the original denied idle visit. An owned building supplies sight of itself, so the site visibility negative uses actual camera exclusion, while the resource node negative checks genuine team fog. The pending repair control supplies the existing local reservation record before any repair dispatch; it does not fake an accepted command.

First failed depot setup and subsequent fixture failures are retained in /tmp/human-local-engineer-depot-failure.log, /tmp/human-local-engineer-depot-stop.log, and /tmp/human-local-engineer-final-guards-first.log through -third.log. The first setup relocated an engineer while leaving its native old move live. Native stop corrected the fixture. A later overly broad depot test forbade legitimate production shopping; the idle shopping assertion now checks its actual visit. Wrong-name identity and LOS fixtures were also corrected against observed native state before passing. No game source changed to satisfy those setup failures.

The full diagnostic source, three complete retained native traces, and timeline equality checks are qualified in /tmp/human-v15-diagnosis-qualified-results.json. All native commands, inputs, and events in all nine seats equal the original V15 JSON rows. Sources were unchanged. The instrumented comparison's original isDeepStrictEqual inputs false reflects omitted undefined keys versus parsed JSON, so the qualification compares serialized JSON values. All original censoring and cohort limitations remain.

The ability cap stays unchanged in this proposal. Across every attended combat/support tick, the retained matches never had two on-screen non-air, non-retreating actors with verified HUD cdKnown=true and cd<=0, even before tactical target and price checks. Conquest seed 10 slot 0 has 1960 ticks with zero and 330 with one; Classic seed 9 slot 0 has 612 with zero and 227 with one; World seed 10 slot 1 has 338 with zero and 27 with one. The source increments casts only after accepted enqueue and after HUD and resource checks. These cases supply no native evidence that casts:1 suppressed a useful second verified ability.

Validation is focused native construction and guards plus exact baseline failure. No full match retries, campaign, benchmark, or claimed APM gain. Root owns adoption, registration, full suite, and final source certification. No repository files were edited, staged, or committed by this diagnosis.
