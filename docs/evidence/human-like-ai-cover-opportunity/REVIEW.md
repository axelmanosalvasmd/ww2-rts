# Cover refusal loop proposal

The native objective-holder branch requests cover even when watched terrain contains no possible shelter. Its ordinary refusal backoff eventually expires and repeats the same paid key. A minimal real MG objective-holder scene reproduces noCover at ticks 61, 371 and 702 over 45 simulated seconds. This matches the reported bare-ground two-front failure without requiring a full match.

The proposed guard applies only to the human commander's final objective-holder cover fallback. It uses the delivered terrain flags and exact camera projection. A known watched cover cell within the native 10 m search radius permits the existing key. A watched solid sight obstruction within 14 m also permits it, because the native engine can choose an adjacent open cell protected by a wall or house corner. The extra 4 m is a conservative allowance for coverBehind's 3.7 m reach. The engine retains authority over destination, reachability, capture-circle constraints and refusal. Legacy decision behavior is unchanged.

This is an opportunity check, not a second implementation of coverSpot. It deliberately permits uncertain wall opportunities. It does not eliminate every possible noCover refusal near unreachable, occupied or badly oriented terrain.

Native proof:

- Bare ground: three noCover receipts become zero attempts. Inputs fall 13 to 9, commands fall 5 to 2. Lower input throughput is intentional removal of wasted actions, not a claimed APM-band fix.
- Nearby trench: complete input and command arrays remain deeply identical. Both accept cover at tick 61, after the full paid physical key, and the actual squad gains cover.
- Visible combat beside a wall: complete native input and receipt arrays remain identical. Neither control requests cover while engaged. This is a combat preservation control, not a claimed successful wall-cover example.
- Dynamic trench 7 m from an on-screen squad but outside its camera: a real object-layer mutation is asserted successful and the fog-visible update is actually delivered. Its inputs and commands remain identical to plain ground.
- Moving the authored camera onto the same changed terrain: the commander pays and accepts cover at tick 61. This is the camera-boundary negative control.

The first dynamic fixture attempt incorrectly passed ground:T to mutateWorldCell. The engine rejected this because trenches belong to the object layer. That failure remains in the session evidence; the final fixture asserts successful object:T mutation before claiming privacy.

Files:

- cover-opportunity.patch: production proposal plus permanent portable native fixture.
- test-engine-ai-cover-opportunity.js: ordinary root-relative imports; temporary detached control disables only the exact new guard and is cleaned in finally.
- native-controls.json: full public events, physical input starts/completions, command receipts and frames for every native control.
- summary.json: short before/after counts.
- hashes.json: exact ROOT and candidate graph hashes. Only shared/ai.js differs among runtime modules.
- Historical bare-base.json/trench-base.json and candidate equivalents are preserved.

Verification: CPU 3, nice 19, node runtime/test-engine-ai-cover-opportunity.js, PASS in 2.312 s on the final test. git apply --check passes against current ROOT. No ROOT edits, campaign, scorer, caps, motor coefficients or economy changes were made. Root owns registration, docs and adoption.
