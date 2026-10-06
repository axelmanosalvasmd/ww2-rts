// Remaining World Conquest acceptance checks. Fixture setup is internal; orders and observations use real sockets.
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { CELL, TICK, CFG, TERRAIN, MOVE, VBLOCK, UNITS, createGame, validateMap, placementCheck, damageCells, unpackRuns } from './shared/sim.js';
import { generateWorldMap, WORLD_TUNING } from './shared/world-conquest.js';

Object.assign(process.env, { PORT: '0', EDIT_PASSWORD: 'test', PUBLIC_URL: 'http://test' });
const server = await import('./server.js');
clearInterval(server.loop);
if (!server.server.listening) await new Promise(resolve => server.server.once('listening', resolve));
const clients = [], failures = [];
const settle = () => new Promise(resolve => setTimeout(resolve, 12));
async function waitFor(fn, label) {
  const until = Date.now() + 15000;
  while (Date.now() < until) { const value = fn(); if (value) return value; await settle(); }
  assert.fail(label);
}
async function connect(room, token) {
  const ws = new WebSocket(`ws://127.0.0.1:${server.server.address().port}/ws?room=${room}`, { perMessageDeflate: false });
  const messages = [], rows = new Map(), terrain = new Map(), lists = {};
  const c = { ws, messages, terrain, room, latest: t => messages.filter(m => m.t === t).at(-1),
    async send(m) { ws.send(JSON.stringify(m)); await settle(); },
    wait: (t, after = 0) => waitFor(() => messages.slice(after).find(m => m.t === t), `missing ${t} for ${token}`) };
  clients.push(c);
  ws.on('message', raw => {
    const m = JSON.parse(raw);
    if (m.t === 'start') { rows.clear(); terrain.clear(); }
    for (const row of m.cells ?? []) terrain.set(row[0], row);
    if (m.t === 's') {
      if (m.all) rows.clear();
      for (const id of m.gone ?? []) rows.delete(id);
      for (const row of m.units) rows.set(row[0], row);
      m.units = [...rows.values()];
      for (const key of ['nodes', 'wrecks']) { if (m[key]) lists[key] = m[key]; else m[key] = lists[key] ?? []; }
    }
    messages.push(m);
  });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  await c.send({ t: 'hello', token, name: token });
  await c.wait('lobby');
  return c;
}
async function tick(n = 4) {
  for (let i = 0; i < n; i++) server.tickRooms();
  // Large synchronous advances can leave snapshots queued beyond a fixed 12 ms delay.
  await waitFor(() => clients.every(c => {
    if (c.ws.readyState !== WebSocket.OPEN) return true;
    const room = server.rooms.get(c.room), game = room?.game;
    return !game || (c.latest('s')?.tick ?? -1) >= game.tick - Math.max(4, room.snapEvery ?? 2) + 1;
  }), 'clients did not receive the final simulation snapshots');
}
async function start(code, teams = [0, 1], size = 'huge') {
  const seats = [];
  for (let i = 0; i < teams.length; i++) seats.push(await connect(code, `${code}${i}`));
  for (let i = 0; i < teams.length; i++) await seats[0].send({ t: 'team', slot: i, v: teams[i] });
  await seats[0].send({ t: 'mode', v: 'world' });
  await seats[0].send({ t: 'worldSize', v: size });
  await seats[0].send({ t: 'weather', v: 'clear' });
  // These territorial fixtures exclude incidental combat and convoys. Dedicated logistics suites cover supplies.
  server.rooms.get(code).logistics = false;
  await seats[0].send({ t: 'start' });
  for (const c of seats) await c.wait('start');
  const g = server.rooms.get(code).game;
  // Remove incidental combat and ability use without changing the ownership or capture rules under test.
  for (const u of g.units.values()) Object.assign(u, { holdFire: true, auto: false, autoRetreat: false });
  await tick();
  return { g, seats };
}
function place(u, at) { Object.assign(u, at, { path: [], orders: [], attackId: 0, targetId: 0, worldGoal: null, amove: null, build: 0, retreating: false, holdPos: true }); }
const ownedUnit = (g, owner, type) => [...g.units.values()].find(u => u.owner === owner && u.type === type);
const regionView = (c, id) => c.latest('s').world.regions.find(r => r.id === id);
const inRegion = (r, at) => at[0] >= r.bounds[0] && at[1] >= r.bounds[1] && at[0] < r.bounds[2] && at[1] < r.bounds[3];
async function deny(c, msg, reason) {
  const after = c.messages.length;
  await c.send(msg);
  assert.equal((await c.wait('deny', after)).reason, reason);
}
async function check(name, fn) {
  if (process.argv[2] && !name.includes(process.argv[2])) return;
  const began = Date.now();
  try { await fn(); console.log(`PASS ${name} (${Date.now() - began} ms)`); }
  catch (error) { failures.push(name); console.error(`FAIL ${name}:`, error); }
  finally {
    server.clock.setTimeout = () => null;
    server.rooms.clear();
    for (const c of clients.splice(0)) c.ws.terminate();
    await settle();
  }
}

try {
  await check('contested capture, production-locked recapture, income and capacity loss', async () => {
    const { g, seats: [host, rival] } = await start('claimcheck');
    const r = g.world.regions.find(r => r.team < 0 && r.kind === 'city');
    assert.ok(r, 'fixture has an unclaimed city');
    const rifle = ownedUnit(g, 0, 'rifle'), enemy = ownedUnit(g, 1, 'rifle'), engineer = ownedUnit(g, 0, 'engineer');
    // The destruction-before-capture suite covers the original guard fight. Arrange its cleared aftermath here.
    for (const u of g.units.values()) if (u.owner === -1 && Math.hypot(u.x - r.x, u.z - r.z) < 25) {
      if (u.type === 'worldbase') u.hp = 0;
      else { place(u, { x: r.x + 20, z: r.z + 20 }); u.guardHome = { x: u.x, z: u.z }; }
    }
    place(rifle, { x: r.x + 10, z: r.z }); place(enemy, { x: r.x - 10, z: r.z });
    place(engineer, { x: r.x + 5, z: r.z - 5 });
    g.players[0].mp = 10000;
    await tick(8);
    const beforeBuild = host.latest('s');
    await deny(host, { t: 'build', ids: [engineer.id], kind: 'barracks', x: r.x + 5, z: r.z - 8 }, 'territory');
    await tick();
    assert.equal(host.latest('s').units.filter(u => u[1] === 'barracks' && u[2] === 0).length, 0, 'denied construction creates no site');
    assert.ok(host.latest('s').mp >= beforeBuild.mp, 'denied construction spends no manpower');
    // Engineers are infantry too, so keep the builder outside the capture radius.
    await host.send({ t: 'move', orders: [[engineer.id, r.x + 10, r.z - 10], [rifle.id, r.x, r.z]] });
    await rival.send({ t: 'move', orders: [[enemy.id, r.x, r.z]] });
    await tick(80);
    assert.equal(regionView(host, r.id).contested, true, 'host sees two hostile infantry sides contesting the claim');
    assert.equal(regionView(rival, r.id).contested, true, 'both clients receive the contest');
    assert.equal(regionView(host, r.id).team, -1, 'a contested cleared region stays unclaimed');
    const contestedProgress = regionView(host, r.id).progress;
    await tick(240);
    assert.equal(regionView(host, r.id).progress, contestedProgress, 'an established contest gains no further claim progress');
    await rival.send({ t: 'move', orders: [[enemy.id, r.x - 12, r.z]] });
    await tick(240);
    assert.equal(regionView(host, r.id).team, 0, 'uncontested normal infantry movement completes the claim');
    assert.equal(host.latest('s').world.owned, 2);
    assert.equal(host.latest('s').world.cap, 26);
    await host.send({ t: 'build', ids: [engineer.id], kind: 'barracks', x: r.x + 5, z: r.z - 8 });
    await tick(900);
    const site = host.latest('s').units.find(u => u[1] === 'barracks' && u[2] === 0);
    assert.ok(site, 'owned land permits the same paid placement');
    assert.equal(site[14], 1, 'the Engineers finish the Production Building');
    await host.send({ t: 'move', orders: [[rifle.id, r.x + 12, r.z], [engineer.id, r.x + 12, r.z - 10]] });
    await rival.send({ t: 'move', orders: [[enemy.id, r.x, r.z]] });
    await tick(400);
    assert.equal(regionView(rival, r.id).team, 0, 'the defender retains land while its Production Building survives');
    assert.equal(regionView(rival, r.id).locked, true, 'the delivered region explains the surviving production lock');
    await rival.send({ t: 'move', orders: [[enemy.id, r.x - 12, r.z]] });
    await tick(80);
    g.units.get(site[0]).hp = 1;
    await rival.send({ t: 'stance', ids: [enemy.id], key: 'holdFire', on: false });
    await rival.send({ t: 'attack', ids: [enemy.id], target: site[0] });
    await tick(120);
    assert.ok(!rival.latest('s').units.some(u => u[0] === site[0]), 'a normal hostile attack destroys the defending Production Building');
    assert.equal(regionView(rival, r.id).team, 0, 'destruction alone does not recapture the region');
    await rival.send({ t: 'stance', ids: [enemy.id], key: 'holdFire', on: true });
    await rival.send({ t: 'stop', ids: [enemy.id] });
    // Arrange 25 paid-equivalent existing population: legal at 26, above the 24 cap after territorial loss.
    const home = g.players[0].spawn;
    for (let i = 0; i < 23; i++) {
      const u = structuredClone(rifle); u.id = g.nextId++;
      place(u, { x: home.x + 8, z: home.z + 8 }); g.units.set(u.id, u);
    }
    await tick(8);
    const beforeLoss = host.latest('s'), fielded = beforeLoss.units.filter(u => u[2] === 0 && !UNITS[u[1]].structure).map(u => u[0]).sort((a,b) => a-b);
    assert.equal(fielded.length, 25, 'fixture supplies existing units above the reduced capacity');
    await rival.send({ t: 'move', orders: [[enemy.id, r.x, r.z]] });
    await tick(400);
    assert.equal(regionView(rival, r.id).team, 1, 'normal infantry capture neutralizes then recaptures the region');
    assert.equal(host.latest('s').world.owned, 1, 'recapture removes exactly one owned region');
    assert.equal(host.latest('s').world.cap, 24, 'recapture removes the gained capacity');
    assert.equal(rival.latest('s').world.owned, 2, 'recapture awards exactly one region to the attacker');
    assert.equal(rival.latest('s').world.cap, 26);
    assert.equal(host.latest('s').out[0], false, 'the remaining home keeps the defender active');
    assert.deepEqual(host.latest('s').units.filter(u => u[2] === 0 && !UNITS[u[1]].structure).map(u => u[0]).sort((a,b) => a-b), fielded, 'capacity loss preserves every existing unit and its owner');
    assert.ok(Math.abs((beforeLoss.inc - host.latest('s').inc) - (WORLD_TUNING.regionMP + WORLD_TUNING.cityMP)) <= 0.11, 'future income loses exactly the city contribution, allowing snapshot rounding');
    const afterLoss = host.latest('s'), hq = ownedUnit(g, 0, 'hq');
    await deny(host, { t: 'buy', unit: 'rifle', from: hq.id }, 'pop');
    await tick(8);
    assert.ok(host.latest('s').mp >= afterLoss.mp, 'capacity denial spends no manpower');
    assert.deepEqual(host.latest('s').queues.find(q => q[0] === hq.id).slice(4), [], 'capacity denial creates no queue entry');
    const stable = host.latest('s');
    await tick(80);
    assert.equal(host.latest('s').world.owned, stable.world.owned, 'continued occupation cannot duplicate a territorial reward');
    assert.equal(host.latest('s').inc, stable.inc, 'continued occupation cannot duplicate regional income');
  });

  await check('team home loss keeps command ownership and relocates retreat', async () => {
    const { g, seats: [host, ally, rival] } = await start('homecheck', [0, 0, 1]);
    const oldHome = g.world.regions.find(r => r.home === 0), friendly = g.world.regions.find(r => r.home === 1);
    const rifle = ownedUnit(g, 0, 'rifle'), engineer = ownedUnit(g, 0, 'engineer'), enemy = ownedUnit(g, 2, 'rifle');
    ownedUnit(g, 0, 'hq').hp = 0;
    place(rifle, { x: friendly.x + 12, z: friendly.z + 12 });
    place(engineer, { x: friendly.x + 12, z: friendly.z - 8 });
    place(enemy, { x: oldHome.x + 10, z: oldHome.z });
    await tick(8);
    await rival.send({ t: 'move', orders: [[enemy.id, oldHome.x, oldHome.z]] });
    await tick(400);
    assert.equal(regionView(rival, oldHome.id).team, 1, 'enemy infantry recaptures the original home after HQ destruction');
    assert.equal(host.latest('s').world.owned, 1);
    assert.equal(ally.latest('s').world.owned, 1, 'both teammates retain shared surviving territory');
    assert.equal(host.latest('s').out[0], false, 'home loss does not eliminate the member');
    assert.equal(host.latest('s').out[1], false);
    assert.ok(host.latest('s').units.some(u => u[0] === rifle.id && u[2] === 0), 'the member retains command ownership of surviving troops');
    assert.ok(inRegion(friendly, host.latest('s').home), 'home shortcut relocates into surviving team land');
    assert.deepEqual(host.latest('s').home, host.latest('s').world.home, 'both home protocol surfaces agree');
    // Start outside the arrival radius for the four ticks used to observe the active retreat.
    const beforeRetreat = host.latest('s'), walker = beforeRetreat.units.find(u => u[0] === rifle.id);
    assert.ok(Math.hypot(walker[3] - beforeRetreat.home[0], walker[4] - beforeRetreat.home[1])
      > CFG.reinforceRadius + UNITS.rifle.speed * CFG.retreatSpeed * TICK * 4, 'fixture leaves time to observe retreat');
    await host.send({ t: 'retreat', ids: [rifle.id] });
    await tick(4);
    const plan = host.latest('s').plans.find(p => p[0] === rifle.id);
    assert.equal(plan[1], 3, 'the surviving member can issue a normal retreat');
    assert.ok(inRegion(friendly, plan.slice(2,4)), 'retreat target belongs to the surviving team');
    await tick(160);
    const returned = host.latest('s').units.find(u => u[0] === rifle.id);
    assert.ok(inRegion(friendly, returned.slice(3,5)), 'the retreat finishes on friendly ground');
    assert.equal(returned[12] & 1, 0, 'retreat completes rather than getting stuck');
    g.players[0].mp = 1000;
    await tick();
    const before = host.latest('s').mp;
    await host.send({ t: 'recover' });
    await tick();
    const restored = host.latest('s').units.find(u => u[2] === 0 && u[1] === 'hq');
    assert.ok(restored && inRegion(friendly, restored.slice(3,5)), 'paid HQ recovery remains available on allied territory');
    assert.ok(host.latest('s').mp <= before - WORLD_TUNING.recoverHQ + 3, 'relocated HQ recovery charges its normal cost');
  });

  await check('reconnect restores discovered terrain without revealing remote updates', async () => {
    const code = 'reconcheck', { g, seats: [host] } = await start(code);
    const scout = ownedUnit(g, 0, 'rifle'), home = { ...g.players[0].spawn };
    const unknown = g.world.regions.find(r => r.team < 0 && !regionView(host, r.id));
    assert.ok(unknown, 'fixture has unexplored terrain');
    const road = g.chars.findIndex((ch,c) => ch === 'D' && Math.hypot((c % g.w + .5) * CELL - unknown.x, (Math.floor(c / g.w) + .5) * CELL - unknown.z) < 24 && !host.terrain.has(c));
    assert.ok(road >= 0, 'fixture has an unknown road near the objective');
    const at = { x: (road % g.w + .5) * CELL, z: (Math.floor(road / g.w) + .5) * CELL };
    place(scout, { x: at.x + 3, z: at.z });
    await tick(8);
    assert.equal(host.terrain.get(road)?.[1], 'D', 'scouting delivers the newly discovered road');
    damageCells(g, [...g.units.values()], at, 0, 1000);
    await tick(8);
    const remembered = [...host.terrain.get(road)];
    assert.equal(remembered[1], '+', 'visible road destruction is delivered as changed terrain');
    assert.ok(host.messages.filter(m => m.t === 's').some(m => m.cells.some(c => c[0] === road && c[1] === '+')), 'the change arrives through an incremental snapshot');
    place(scout, home);
    await tick(8);
    // Mutate a known place after the scout leaves. Reconnect must retain the last observed state.
    damageCells(g, [...g.units.values()], at, 0, 1000, 1);
    await tick(8);
    assert.notEqual(g.height[road], remembered[2], 'fixture actually changes the hidden road elevation');
    assert.deepEqual(host.terrain.get(road), remembered, 'out-of-vision terrain changes remain undisclosed');
    const rejoined = await connect(code, `${code}0`), reStart = await rejoined.wait('start');
    assert.equal(reStart.matchId, host.latest('start').matchId, 'reconnect resumes the same match');
    assert.deepEqual(reStart.cells.find(c => c[0] === road), remembered, 'reconnect restores the last discovered terrain update');
    assert.equal(reStart.map.rows[Math.floor(road / g.w)][road % g.w], '+', 'reconnect map uses remembered terrain');
    const mask = new Uint8Array(g.w * g.h);
    unpackRuns(reStart.fog.e, (first,n) => mask.fill(1,first,first+n));
    assert.equal(mask[road], 1, 'the reconnect fog remembers the explored road');
    const neverSeen = g.chars.findIndex((ch,c) => ch !== '.' && !host.terrain.has(c));
    assert.ok(neverSeen >= 0, 'there is still unknown authoritative terrain');
    assert.ok(!reStart.cells.some(c => c[0] === neverSeen), 'reconnect omits never-discovered terrain cells');
    assert.equal(reStart.map.rows[Math.floor(neverSeen/g.w)][neverSeen%g.w], '.', 'reconnect does not serialize hidden geography');
    assert.equal(reStart.spawns[1], null, 'reconnect still hides the enemy spawn');
    await tick(8);
    assert.ok(rejoined.latest('s').world.regions.length < g.world.total, 'reconnect keeps undiscovered regions hidden');
    place(scout, { x: at.x + 3, z: at.z });
    await tick(8);
    assert.equal(rejoined.terrain.get(road)?.[2], g.height[road], 'scouting the site again reveals its current elevation');
  });

  await check('World Conquest crosses the Classic deadline without Sudden Death', async () => {
    const { g, seats: [host] } = await start('clockcheck');
    const hq = ownedUnit(g, 0, 'hq'), engineer = ownedUnit(g, 0, 'engineer'), home = g.players[0].spawn;
    g.tick = Math.floor(CFG.classic.time / TICK) - 4;
    // Even an old imported timer field must not activate Classic behavior in World Conquest.
    g.mode.timeLeft = 0.1;
    g.players[0].mp = 10000;
    place(engineer, { x: home.x + 7, z: home.z - 5 });
    await host.send({ t: 'buy', unit: 'rifle', from: hq.id });
    await host.send({ t: 'build', ids: [engineer.id], kind: 'barracks', x: home.x + 5, z: home.z - 8 });
    await tick(8);
    const crossing = host.latest('s'), site = crossing.units.find(u => u[1] === 'barracks' && u[2] === 0);
    assert.ok(crossing.tick > CFG.classic.time / TICK, 'fixture actually crosses the old deadline');
    assert.equal(crossing.mode.suddenDeath, false, 'World Conquest never enters Classic Sudden Death');
    assert.equal(crossing.winner, null, 'elapsed Classic time cannot decide World Conquest');
    assert.ok(crossing.queues.find(q => q[0] === hq.id).includes('rifle'), 'crossing the deadline preserves the paid queue');
    assert.ok(site && site[14] < 1, 'construction continues as a paid site across the deadline');
    await tick(700);
    assert.equal(host.latest('s').units.find(u => u[0] === hq.id)[7], UNITS.hq.hpPer, 'Production Buildings do not decay at the Classic deadline');
    assert.equal(host.latest('s').units.find(u => u[0] === site[0])[14], 1, 'normal construction finishes after the old deadline');
    assert.equal(host.latest('s').units.filter(u => u[2] === 0 && u[1] === 'rifle').length, 2, 'paid training finishes after the old deadline');
    await host.send({ t: 'buy', unit: 'rifle', from: hq.id });
    await tick();
    assert.ok(host.latest('s').queues.find(q => q[0] === hq.id).includes('rifle'), 'new recruitment remains legal after the deadline');
  });

  await check('hidden-state perturbations do not change the recipient world', async () => {
    const code = 'privacycheck', { g, seats: [host] } = await start(code);
    const unseen = g.world.regions.find(r => r.team < 0 && !regionView(host,r.id));
    const hiddenBase = [...g.units.values()].find(u => u.region === unseen.id && u.type === 'worldbase');
    assert.ok(hiddenBase && !host.latest('s').units.some(u => u[0] === hiddenBase.id));
    const before = structuredClone(host.latest('s')), beforeTerrain = new Map(host.terrain);
    const previousStart = host.latest('start');
    // Only private facts change. The receiving player's units, territory, vision and resource rates are unchanged.
    unseen.name = 'Hidden renamed region'; unseen.kind = 'resource'; unseen.team = 1; unseen.progress = .37; unseen.capper = 1;
    hiddenBase.hp /= 2;
    const hiddenRoad = g.chars.findIndex((ch,c) => ch === 'D' && !host.terrain.has(c));
    assert.ok(hiddenRoad >= 0);
    const at = { x: (hiddenRoad % g.w + .5) * CELL, z: (Math.floor(hiddenRoad/g.w) + .5) * CELL };
    damageCells(g, [...g.units.values()], at, 0, 1000);
    assert.equal(g.chars[hiddenRoad], '+', 'fixture actually changes hidden geography');
    await tick(8);
    const after = host.latest('s');
    for (const key of ['world', 'nodes', 'ghosts', 'wrecks', 'fires', 'strikes']) assert.deepEqual(after[key], before[key], `hidden perturbations do not alter delivered ${key}`);
    assert.deepEqual(host.terrain, beforeTerrain, 'hidden terrain mutation delivers no cell update');
    const rejoined = await connect(code, `${code}0`), newStart = await rejoined.wait('start');
    assert.deepEqual(newStart.map, previousStart.map, 'reconnect map is independent of those hidden facts');
    assert.deepEqual(newStart.cells, previousStart.cells, 'reconnect cell payload is independent of hidden terrain');
    assert.equal(newStart.map.world.seed, undefined);
    await tick(8);
    assert.deepEqual(rejoined.latest('s').world, after.world, 'reconnect world observation is independent of hidden ownership and capture progress');
  });

  await check('Huge and Massive seeded connectivity and usable homes', async () => {
    const seeds = [1, 0x31415926, 0xffffffff];
    for (const size of ['huge', 'massive']) for (const seed of seeds) {
      const n = seed === 1 ? 2 : 6, teams = Array.from({ length: n }, (_,i) => i), map = generateWorldMap({ size, seed, players: n, teams });
      const label = `${size} seed ${seed} (${n} homes)`;
      assert.equal(validateMap(map), null, `${label}: public server map validation accepts the world`);
      assert.equal(map.world.total, size === 'huge' ? 64 : 128);
      // Independent cardinal BFS for both infantry and vehicles, including slope limits. Durable fords are passable.
      for (const blocked of [MOVE, MOVE | VBLOCK]) {
        const seen = new Uint8Array(map.w * map.h), queue = new Int32Array(seen.length), first = map.spawns[0].y * map.w + map.spawns[0].x;
        seen[first] = 1; queue[0] = first; let end = 1;
        for (let i = 0; i < end; i++) {
          const c = queue[i], x = c % map.w, y = Math.floor(c / map.w);
          for (const k of [x > 0 ? c-1 : -1, x+1 < map.w ? c+1 : -1, c-map.w, c+map.w]) {
            if (k < 0 || k >= seen.length || seen[k]) continue;
            const yy = Math.floor(k/map.w), xx = k%map.w;
            if ((TERRAIN[map.rows[yy][xx]] & blocked) || Math.abs(Number(map.heights[yy][xx]) - Number(map.heights[y][x])) > 1) continue;
            seen[k] = 1; queue[end++] = k;
          }
        }
        for (const r of map.world.regions) assert.equal(seen[r.y*map.w+r.x], 1, `${label}: region ${r.id} has a ${blocked === MOVE ? 'infantry' : 'vehicle'} ground route`);
      }
      const g = createGame(map, teams.map(i => `seat${i}`), false, teams, teams.map(i => i%3), { mode: 'world', weather: 'clear' });
      const usable = [];
      for (const p of g.players) {
        const home = g.world.regions.find(r => r.home === p.slot);
        assert.equal(home.team, p.team, `${label}: each player owns its own starting region`);
        const packageTypes = [...g.units.values()].filter(u => u.owner === p.slot).map(u => u.type).sort();
        assert.deepEqual(packageTypes, ['engineer','hq','rifle'], `${label}: every home starts with the same small force`);
        let sites = 0;
        // Count usable nearby barracks footprints through the public placement seam, after actual HQ setup.
        for (let dz = -10; dz <= 10; dz += 2) for (let dx = -10; dx <= 10; dx += 2) if (placementCheck(g, { kind: 'barracks', x: home.x+dx, z: home.z+dz, team: p.team }).ok) sites++;
        assert.ok(sites >= 20, `${label}: home ${p.slot} has room for paid facilities (${sites} placements)`);
        usable.push(sites);
        const nearestNeutral = g.world.regions.filter(r => r.team < 0).reduce((d,r) => Math.min(d, Math.hypot(home.x-r.x,home.z-r.z)),Infinity);
        assert.ok(nearestNeutral >= 100 && nearestNeutral <= 140, `${label}: home ${p.slot} has nearby neutral expansion (${nearestNeutral.toFixed(1)} metres)`);
      }
      assert.ok(Math.max(...usable) - Math.min(...usable) <= 5, `${label}: nearby construction space is comparable (${usable.join(', ')})`);
    }
  });
} finally {
  server.clock.setTimeout = () => null;
  for (const c of clients) c.ws.terminate();
  for (const ws of server.wss.clients) ws.terminate();
  server.rooms.clear();
  await new Promise(resolve => server.wss.close(resolve));
  await new Promise(resolve => server.server.close(resolve));
}
if (failures.length) { console.error(`${failures.length} World acceptance group(s) failed: ${failures.join('; ')}`); process.exitCode = 1; }
else console.log('Remaining World Conquest acceptance checks passed');
