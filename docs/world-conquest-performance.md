# World Conquest stress measurements

The final six-seat grown-army run measured complete server ticks at 27.32 ms p95 for Huge and 31.37 ms
p95 for Massive. Maximums were 32.05 and 32.90 ms, below the 50 ms tick interval in this bounded sample.
The maximum 64-unit movement-command barrier was 23.54 ms on Huge and 55.77 ms on Massive.

Measured on 2026-10-03 on an Apple M3 Max, 14 logical CPUs, 36 GiB RAM, macOS arm64, Node.js v24.20.0.
The user was doing other work on the computer. Desktop load was not controlled. These are local observations,
not guaranteed frame rates or completed-match performance. The final full local regression run and the
grown-army browser preview were stopped at the user's request; GitHub CI runs separately.

## Method

```sh
node tools/bench-world-conquest.mjs --mobile=64 --ticks=80 --pacing-ticks=600 --out=/tmp/world-conquest-bench.json
```

The harness creates six real WebSocket clients on teams `[0, 0, 1, 1, 2, 2]`. Through normal lobby messages,
it selects World Conquest and the existing Massive army setting, giving each seat a starting capacity of 120.
That army setting is separate from Huge or Massive map size.

Artificial resources, completed paid construction and accelerated paid training prepare 64 mobile units per
seat, mixing Engineers, Rifles, MGs, Mortars and Light Tanks. Construction and recruitment orders pass through
the owning socket and use normal costs, queues and capacity checks. All local guards and regional military
bases remain. This fixture does not represent normal starting forces or naturally earned armies.

Each seat sends three 64-unit long moves, followed by an ordered WebSocket ping barrier. Barrier time includes
command handling, route calculation and local callback scheduling, rather than travel time. Each preset has
80 warmup ticks and 80 measured ticks, covering four simulated seconds. Complete `tickRooms()` calls include
simulation, filtered snapshots, delta serialization and socket delivery. The loop advances faster than real
time, so it does not establish sustained wall-clock scheduling or match duration.

AI is sampled separately using 30 filtered observations and 30 Normal planning calls per preset. Plans submit
commands through the appropriate client socket. Internal tick samples have human seats. Many simultaneous
lobby AIs can add further cost. Compression is disabled, so payload sizes are decoded JSON sizes.

## Results

Baseline `af80478` used fresh seeds Huge `3032082317` and Massive `4040137623`. Final source used fresh seeds
Huge `263403618` and Massive `3729426846`. They use the same workload, without identical geography or controlled
desktop load. The final report records source SHA-256 digests; its simulation digest is
`af2f13e192381514b2914b5377573cabfff04682f8fa28fead1ca2ce1be0d4a4`.

| Measurement | Huge, 64 regions | Massive, 128 regions |
| --- | ---: | ---: |
| Map dimensions, metres | 1,024 x 1,024 | 2,048 x 1,024 |
| Player mobile units / local mobile guards | 384 / 116 | 384 / 244 |
| Total units including buildings | 576 | 768 |
| Baseline tick p95 / maximum, ms | 37.97 / 41.40 | 96.81 / 172.14 |
| Final tick p50 / p95 / maximum, ms | 9.61 / 27.32 / 32.05 | 11.23 / 31.37 / 32.90 |
| Baseline long move p50 / maximum, ms | 278.04 / 907.64 | 562.66 / 5,036.96 |
| Final long move p50 / maximum, ms | 12.55 / 23.54 | 15.21 / 55.77 |
| Start until all clients received it, ms | 326.54 | 709.42 |
| Generation p50 / maximum, ms | 29.39 / 33.03 | 29.93 / 44.08 |
| Start JSON bytes p50 / maximum per client | 562,521 / 563,967 | 1,085,982 / 1,087,253 |
| AI observation p50 / p95 / maximum, ms | 2.89 / 10.86 / 11.54 | 3.02 / 8.82 / 10.38 |
| AI planning p50 / p95 / maximum, ms | 10.59 / 14.68 / 17.77 | 17.55 / 19.21 / 19.51 |
| Snapshot JSON bytes p50 / p95 / maximum | 10,632 / 13,404 / 14,889 | 11,105 / 13,553 / 15,217 |
| Snapshots across six clients / final tick interval | 240 / 2 | 240 / 2 |
| RSS / used JavaScript heap, MiB | 309.0 / 45.7 | 479.6 / 215.2 |

Memory is a process-wide point sample, rather than a peak or per-room allocation. The process retains the
previous preset until garbage collection. Three generation samples and 18 movement samples per preset are
small samples. Unexplored start terrain retains full preset dimensions, explaining the roughly 0.54 and
1.04 MiB initial payloads. The private authoritative seed is absent from client messages.

The fixes plan distant moves in 64 metre legs while retaining the clicked destination. Remembered route arrays
update incrementally, and capture points query nearby infantry and production blockers. A real-socket regression
at seed `4111514762` reproduced the bank stall with the recovery disabled, then crossed a ford and completed both
Rifle and Light Tank destinations with the recovery restored. Recovery reads only remembered terrain.

## Expansion and limits

A prepared Huge expansion probe placed seat 0's grown army near a guarded region. In 600 ticks, or 30 simulated
seconds, its team grew from two regions to three. Its first gain arrived after 17.3 simulated seconds. Normal
AI issued 73 socket commands and ended with 66 mobile units. This demonstrates destruction, infantry claiming
and continued recruitment in that prepared fight. It does not establish normal economic growth, faction
balance, a completed match or the 45 to 60 minute Huge pacing target.

Earlier starting-force browser checks loaded both map sizes and exercised the battlefield and whole-world paper
map. A fresh browser load also verified the repaired English module initializes the game. Grown-army rendering
measurements were skipped at the user's request. There is no sustained late-game browser frame-rate claim.

Remote networks, many concurrent busy rooms, extensive reconnect history, long-session memory growth,
simultaneous lobby AIs and natural-start multiplayer pacing remain separate measurements.

For a future browser inspection, `node tools/bench-world-conquest.mjs --preview --port=3843 --mobile=64` prepares
`/play#benchhuge` and `/play#benchmassive`. Fresh visitors spectate. SIGINT or SIGTERM closes clients and the
listener. The final measured run exited 0 and closed its listener; the temporary preview was also stopped.
