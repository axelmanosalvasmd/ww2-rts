# Movement lab

The lab reproduces ground movement through the game's real `createGame`, `command` and `step` functions.
Terrain, weather, seed and command timing are controlled. The browser draws authoritative hull transforms,
route waypoints, the ordered destination, local yielding and hull recovery, with speed and turn measurements.
It uses a separate server bound to loopback and adds no route to the game server.

Run the interactive lab from the repository root:

```sh
node tools/serve-movement-lab.mjs --port 3047
```

Open `http://127.0.0.1:3047/tools/movement-lab.html`. Choose the scenario, type and starting heading, then Run,
pause or advance one tick. Right click to replace a destination. Stop, Retreat and the tank-trap toggle issue
real commands or terrain mutations. Scheduled fixture events still execute at their displayed times.
The full scenario button runs an independent fresh fixture; it does not change the live scene.

Run all 24 scenarios across nine ground vehicle profiles, rifles and AT guns:

```sh
node tools/movement-lab.mjs
node tools/movement-lab.mjs --headings 0,0.15,1.57,3.14159 --out /tmp/movement-report.json
node tools/movement-lab.mjs --type tank --scenario clearance,wall-arrival --trace --out /tmp/tank-traces.json
node test-movement-lab.js
```

Reports identify incomplete orders, excess turning on one open-route order, blocked hulls, illegal height
crossings, displaced protected units, lost reverse intent, missed intermediate queued destinations and failed
control interruptions. The tests include deliberately broken queue and cliff readers to verify that the lab
detects those failures. They also check profile acceleration and repeatable trajectory measurements.

Use the same fixtures against another checkout or an archived `shared` directory:

```sh
node tools/movement-lab.mjs --root /tmp/baseline --type tank --scenario clearance
node tools/serve-movement-lab.mjs --port 3048 --root /tmp/baseline
```

The lab files always come from this checkout; only the simulation modules come from the alternate root.
Keep reports and recordings outside the repository. The fixtures cover ground navigation; existing real-socket
movement tests also verify boarding, carrying passengers and unloading on naval routes.

## Reproductions and fixes

| Fixture | Reproduced behavior | Corrected behavior |
| --- | --- | --- |
| Armored car angled arrival | Overshoots, then turns 346.9 degrees on one open-route order | Discrete braking reaches the destination without the extra circle |
| Tank destination beside one wall cell | Stops 0.272 m short with the order still active | Resolves the click to a hull-safe endpoint and completes |
| Tank hull clearance beside a wall bar | Repeats forward and reverse maneuvers after 60 simulation seconds | Chooses room for the next turn and completes |
| Trap inserted on a short reverse route | Replacement waypoints discard reverse intent | Keeps reversing through the replacement route |
| Cliff with a one-level ramp | Smoothed route clips the cliff corner and stalls | Every crossed height cell is checked, retaining the safe ramp approach |
| Opposing heavy vehicles after correcting starting acceleration | Small contact overlap repeatedly resets speed | Keeps a numerical gap so yielding vehicles can accelerate clear |

The baseline is merged commit `4ca74ba82b0099bb8f09ee6a67ee271f035294fb`, including movement PR #41.
At headings `0,0.15,1.57,3.14159`, the baseline passes 926 of 1,056 cases; the corrected simulation passes
all 1,056. A separate four-heading run at quarter turns also passes all 1,056 cases.
Motion proof uses the same authored fixtures with the baseline and
corrected simulation, rather than a recorded player match. These checks establish bounded fixture behavior;
full-match faction balance and native renderer performance are separate measurements.
