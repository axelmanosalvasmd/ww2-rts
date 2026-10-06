// Controlled fixtures use internal placement. Acceptance actions and observations use real WebSockets.
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import * as sim from './shared/sim.js';

Object.assign(process.env, { PORT: '0', EDIT_PASSWORD: 'test', PUBLIC_URL: 'http://test' });
const server = await import('./server.js');
clearInterval(server.loop);
if (!server.server.listening) await new Promise(resolve => server.server.once('listening', resolve));
server.clock.setTimeout = () => null;
let fixtureNow = Date.now();
server.clock.now = () => fixtureNow;
const clients = [], failures = [], fixtures = new Map();
const originalRead = server.mapFiles.read, originalList = server.mapFiles.list;
server.mapFiles.list = async () => [...await originalList(), ...[...fixtures.keys()].map(name => `${name}.json`)];
server.mapFiles.read = name => fixtures.has(name) ? Promise.resolve(JSON.stringify(fixtures.get(name))) : originalRead(name);
const settle = () => new Promise(resolve => setTimeout(resolve, 8));
async function until(fn, label) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) { const result = fn(); if (result) return result; await settle(); }
  assert.fail(label);
}
async function connect(room, token, spectate = false) {
  const ws = new WebSocket(`ws://127.0.0.1:${server.server.address().port}/ws?room=${room}`, { perMessageDeflate: true });
  const messages = [], rows = new Map(), terrain = new Map(), held = {};
  const client = { ws, token, messages, terrain, latest: type => messages.filter(m => m.t === type).at(-1),
    async send(msg) { ws.send(JSON.stringify(msg)); await settle(); },
    wait: (type, after = 0) => until(() => messages.slice(after).find(m => m.t === type), `missing ${type} for ${token}`) };
  clients.push(client);
  ws.on('message', data => {
    const msg = JSON.parse(data);
    if (msg.t === 'start') { rows.clear(); terrain.clear(); }
    for (const row of msg.cells ?? []) terrain.set(row[0], row);
    if (msg.t === 's') {
      if (msg.all) rows.clear();
      for (const id of msg.gone ?? []) rows.delete(id);
      for (const row of msg.units) rows.set(row[0], row);
      msg.units = [...rows.values()];
      for (const key of ['nodes', 'wrecks']) { if (msg[key]) held[key] = msg[key]; else msg[key] = held[key] ?? []; }
    }
    messages.push(msg);
  });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  await client.send({ t: 'hello', token, name: token, spectate });
  await client.wait('lobby');
  return client;
}
const blankMap = () => ({ name: 'Engine acceptance fixture', w: 96, h: 96, rows: Array(96).fill('.'.repeat(96)),
  spawns: [{ x: 8, y: 8 }, { x: 8, y: 87 }, { x: 87, y: 87 }], points: [{ id: 'crossroads', x: 48, y: 48 }] });
async function tick(count = 2) {
  for (let n = 0; n < count; n++) server.tickRooms();
  await settle();
  for (const room of server.rooms.values()) if (room.game) {
    const target = room.game.tick - (room.snapEvery ?? 2);
    for (const peer of [...room.players, ...room.spectators]) {
      const client = clients.findLast(candidate => candidate.token === peer.token);
      if (client?.ws.readyState === WebSocket.OPEN) await until(() => client.latest('s')?.tick >= target, 'compressed snapshots catch up to the stepped server');
    }
  }
}
async function start(code, map = blankMap(), mode = 'classic', teams = [0, 0, 1]) {
  assert.equal(sim.validateMap(map), null, 'the public validator accepts the fixture');
  const name = `engine-${code}`; fixtures.set(name, map);
  const seats = [];
  for (let i = 0; i < teams.length; i++) seats.push(await connect(code, `${code}${i}`));
  for (let i = 0; i < teams.length; i++) await seats[0].send({ t: 'team', slot: i, v: teams[i] });
  await seats[0].send({ t: 'map', name });
  await seats[0].send({ t: 'mode', v: mode });
  await seats[0].send({ t: 'weather', v: 'clear' });
  await seats[0].send({ t: 'start' });
  for (const seat of seats) await seat.wait('start');
  const room = server.rooms.get(code), g = room.game;
  assert.equal(room.map.name, map.name, 'the real match loaded the authored fixture');
  for (const u of g.units.values()) Object.assign(u, { holdFire: true, auto: false, autoRetreat: false });
  await tick();
  return { g, seats, room };
}
function place(unit, x, z) {
  Object.assign(unit, { x, z, path: [], orders: [], attackId: 0, targetId: 0, worldGoal: null, amove: null,
    build: 0, retreating: false, holdPos: true, still: 5, rot: 0, aim: 0, speed: 0, vx: 0, vz: 0 });
}
const owned = (g, owner, type) => [...g.units.values()].find(u => u.owner === owner && u.type === type);
function fixtureUnit(g, owner, type, x, z) {
  const unit = structuredClone(owned(g, owner, 'rifle'));
  Object.assign(unit, { id: g.nextId++, type, hp: sim.UNITS[type].hpPer * sim.UNITS[type].models, cooldown: 0 });
  place(unit, x, z); g.units.set(unit.id, unit); return unit;
}
const row = (client, id) => client.latest('s').units.find(u => u[0] === id);
const events = (client, since = 0) => client.messages.slice(since).filter(m => m.t === 's').flatMap(m => m.shots ?? []);
const jobs = (client, id) => client.latest('s').productionJobs.find(pair => pair[0] === id)?.[1] ?? [];
async function deny(client, command, reason) {
  fixtureNow += 1100;
  const after = client.messages.length; await client.send(command);
  assert.equal((await client.wait('deny', after)).reason, reason);
}
async function check(name, fn) {
  if (process.argv[2] && !name.includes(process.argv[2])) return;
  try { await fn(); console.log(`PASS engine acceptance: ${name}`); }
  catch (error) { failures.push(name); console.error(`FAIL engine acceptance: ${name}`, error); }
  finally {
    server.rooms.clear();
    for (const client of clients.splice(0)) client.ws.terminate();
    await settle();
  }
}

try {
  await check('waiting recruitment identity, refund, head progress and recipient ownership', async () => {
    const { g, seats: [owner, ally, rival] } = await start('queue');
    const producer = owned(g, 0, 'hq'); g.players[0].mp = 10000;
    for (let n = 0; n < 3; n++) await owner.send({ t: 'buy', unit: 'rifle', from: producer.id });
    await tick(40);
    const paid = jobs(owner, producer.id), headProgress = owner.latest('s').queues.find(q => q[0] === producer.id)[1];
    assert.equal(paid.length, 3, 'three ordinary purchases produce three jobs');
    assert.equal(new Set(paid.map(job => job.id)).size, 3, 'identical recruits have distinct identities');
    assert.deepEqual(paid.map(job => job.status), ['active', 'waiting', 'waiting']);
    const watch = await connect('queue', 'queuewatch', true); await watch.wait('start'); await tick();
    assert.ok(!ally.latest('s').productionJobs.some(pair => pair[0] === producer.id), 'allied vision grants no authority over another owner queue');
    assert.ok(!rival.latest('s').productionJobs.some(pair => pair[0] === producer.id), 'rival receives no production identities');
    assert.ok(watch.latest('s').productionJobs === undefined || watch.latest('s').productionJobs.length === 0, 'spectator receives no actionable production identities');
    await deny(ally, { t: 'cancelProduction', id: producer.id, job: paid[2].id }, 'unseen');
    await deny(rival, { t: 'cancelProduction', id: producer.id, job: paid[2].id }, 'unseen');
    await deny(owner, { t: 'cancelProduction', id: producer.id, job: paid[0].id }, 'notWaiting');
    const before = owner.latest('s');
    await owner.send({ t: 'cancelProduction', id: producer.id, job: paid[2].id }); await tick();
    const after = owner.latest('s');
    assert.deepEqual(jobs(owner, producer.id).map(job => job.id), paid.slice(0, 2).map(job => job.id), 'canceling the second identical waiter preserves the other identities and order');
    assert.ok(Math.abs(after.mp - before.mp - paid[2].mp - after.inc * sim.TICK * 2) < 1.01, 'refund restores the original charged MP once, allowing integer snapshots and normal income');
    assert.ok(Math.abs(after.fuel - before.fuel - paid[2].fuel - (after.fuelInc ?? 0) * sim.TICK * 2) < 1.01, 'refund restores the original charged Fuel once');
    assert.ok(after.queues.find(q => q[0] === producer.id)[1] >= headProgress, 'waiting cancellation preserves active training progress');
    await deny(owner, { t: 'cancelProduction', id: producer.id, job: paid[2].id }, 'notWaiting'); await tick();
    assert.deepEqual(jobs(owner, producer.id).map(job => job.id), paid.slice(0, 2).map(job => job.id), 'a duplicate cannot cancel the neighboring waiter');
    assert.ok(owner.latest('s').mp - after.mp < 2, 'duplicate delivery does not issue another refund');
    const rejoined = await connect('queue', 'queue0'); await rejoined.wait('start'); await tick();
    assert.deepEqual(jobs(rejoined, producer.id).map(job => job.id), paid.slice(0, 2).map(job => job.id), 'reconnect retains the live queue identities');
    g.players[0].out = true;
    await deny(rejoined, { t: 'cancelProduction', id: producer.id, job: paid[1].id }, 'blocked');
    g.players[0].out = false;
    await tick(300);
    assert.equal(jobs(rejoined, producer.id)[0].id, paid[1].id, 'the untouched waiter becomes the new active head');
    assert.equal(jobs(rejoined, producer.id)[0].status, 'active');
    await deny(rejoined, { t: 'cancelProduction', id: producer.id, job: paid[1].id }, 'notWaiting');
    await deny(rejoined, { t: 'cancelProduction', id: producer.id, job: paid[0].id }, 'notWaiting');
  });

  await check('scenario capture ownership, exactly once rewards and durable private objectives', async () => {
    const map = blankMap();
    map.scenario = { version: 1, areas: [], groups: [{ id: 'arrival', units: [] }],
      objectives: [{ id: 'hold', text: { en: 'Hold the crossroads', es: 'Defiende el cruce' }, recipients: 'side', side: 0 }],
      triggers: [{ id: 'captured', scope: 'match', side: 0, recipients: 'side', condition: { kind: 'capture', target: 'crossroads', side: 0 }, repeat: { mode: 'once' },
        actions: [{ kind: 'objectiveActivate', objective: 'hold' }, { kind: 'reinforce', group: 'arrival', side: 0, roster: [{ type: 'rifle', count: 2 }], at: [50, 48], order: { kind: 'hold' }, expires: 5 },
          { kind: 'say', text: { en: 'Crossroads held', es: 'Cruce defendido' }, recipients: 'side', side: 0 }] },
        { id: 'completed', scope: 'match', side: 0, recipients: 'side', condition: { kind: 'triggerComplete', trigger: 'captured' }, repeat: { mode: 'once' }, actions: [{ kind: 'objectiveComplete', objective: 'hold' }] }] };
    const { g, seats: [host, ally, rival] } = await start('mission', map, 'conquest');
    const squad = owned(g, 0, 'rifle'), point = g.points[0];
    place(squad, point.x - 12, point.z); await tick();
    const beforeUnits = host.latest('s').units.filter(u => u[2] === 0 && u[1] === 'rifle').length, since = host.messages.length;
    assert.equal(host.latest('s').scenario.objectives.length, 0, 'objective waits for an actual capture');
    await host.send({ t: 'move', orders: [[squad.id, point.x, point.z]] }); await tick(400);
    assert.equal(host.latest('s').points[0][0], 0, `normal infantry movement captures the authored objective for its owner (${JSON.stringify({ unit: row(host, squad.id), point: host.latest('s').points[0], denied: host.messages.filter(m => m.t === 'deny') })})`);
    const objective = host.latest('s').scenario.objectives.find(o => o.id === 'hold');
    assert.equal(objective.state, 'complete'); assert.ok(objective.execution, 'durable objective identifies its execution');
    assert.equal(host.latest('s').units.filter(u => u[2] === 0 && u[1] === 'rifle').length, beforeUnits + 2, 'capture gives exactly the authored reinforcements to the selected owner');
    assert.equal(events(host, since).filter(event => event.text === 'Crossroads held').length, 1, 'persistent condition announces once');
    assert.equal(ally.latest('s').scenario.objectives.length, 0, 'private side objective stays private from an ally');
    assert.equal(rival.latest('s').scenario.objectives.length, 0, 'private side objective stays private from an enemy');
    assert.ok(!events(rival).some(event => event.text === 'Crossroads held'), 'enemy receives no private scenario announcement');
    const resumed = await connect('mission', 'mission0'); await resumed.wait('start'); await tick(40);
    assert.deepEqual(resumed.latest('s').scenario.objectives.find(o => o.id === 'hold'), objective, 'reconnect preserves objective state and execution');
    assert.equal(resumed.latest('s').units.filter(u => u[2] === 0 && u[1] === 'rifle').length, beforeUnits + 2, 'reconnect does not repeat the reward');
    assert.ok(!events(resumed).some(event => event.text === 'Crossroads held'), 'reconnect does not replay a completed cue');
  });

  await check('road mine placement, clearing, hidden memory and separate bombardment', async () => {
    const map = blankMap(), ground = map.rows.map(row => [...row]), objects = map.rows.map(row => [...row]);
    for (let x = 20; x < 42; x++) ground[30][x] = 'D';
    map.worldVersion = 2; map.layers = { ground: ground.map(row => row.join('')), objects: objects.map(row => row.join('')) };
    map.rows = [...map.layers.ground];
    const { g, seats: [host, , rival] } = await start('road', map);
    const engineer = owned(g, 0, 'engineer'); place(engineer, 59, 59); g.players[0].mp = 10000;
    await tick(8); const unseenSince = rival.messages.length;
    await host.send({ t: 'dig', ids: [engineer.id], kind: 'mines', x: 61, z: 61, dir: 0 }); await tick(400);
    const mines = [...host.terrain.values()].filter(cell => cell[4]?.mine === true);
    assert.ok(mines.length, 'normal Engineer orders place mines on the road');
    for (const cell of mines) {
      assert.equal(cell[4].ground, 'D', 'mine placement keeps its base road');
      assert.equal(cell[4].object, '.', 'a mine preserves the separate object layer');
    }
    const cells = new Set(mines.map(cell => cell[0]));
    assert.ok(!rival.messages.slice(unseenSince).some(msg => msg.cells?.some(cell => cells.has(cell[0]))), 'a remote rival receives no mine update');
    const hiddenReconnect = await connect('road', 'road2'); await hiddenReconnect.wait('start'); await tick();
    assert.ok(!hiddenReconnect.latest('start').cells.some(cell => cells.has(cell[0]) && cell[4]?.mine === true), 'reconnect cannot expose an undiscovered mine');
    await host.send({ t: 'dig', ids: [engineer.id], kind: 'demine', x: 61, z: 61, dir: 0 }); await tick(400);
    for (const c of cells) {
      assert.equal(host.terrain.get(c)[1], 'D', 'clearing restores the same road surface');
      assert.equal(host.terrain.get(c)[4].object, '.', 'clearing preserves the separate object layer');
      assert.ok(!host.terrain.get(c)[4].mine, 'clearing removes the mine layer');
    }
    const resume = await connect('road', 'road0'); await resume.wait('start'); await tick();
    for (const c of cells) assert.equal(resume.terrain.get(c)[4].ground, 'D', 'reconnect restores the cleared durable road');
    await resume.send({ t: 'move', orders: [[engineer.id, 59, 75]] }); await tick(80);
    const gun = fixtureUnit(g, 0, 'mortar', 41, 61); g.players[0].mun = 10000; await tick(8);
    const originalRandom = Math.random; Math.random = () => 0;
    try { await resume.send({ t: 'ability', ids: [gun.id], x: 61, z: 61 }); await tick(200); }
    finally { Math.random = originalRandom; }
    assert.ok([...cells].some(c => resume.terrain.get(c)?.[4].ground !== 'D'), 'a later normal shell impact can damage the road itself');
    assert.ok(!events(hiddenReconnect).some(event => ['collapse', 'contact', 'impact', 'boom'].includes(event.k) && Math.hypot(event.x - 61, event.z - 61) < 12), 'hidden local destruction creates no distant cue');
  });

  await check('local support failure, settled route and remembered reconnect', async () => {
    const map = blankMap(), rows = map.rows.map(row => [...row]), sections = [30, 31, 32].map((x, n) => ({
      id: `part${n}`, c: 30 * map.w + x, hp: 100, material: 'stone', anchor: n !== 1, supports: n === 1 ? ['part0'] : [] }));
    for (const section of sections) rows[30][section.c % map.w] = 'B';
    map.rows = rows.map(row => row.join('')); map.structures = [{ id: 'corner', kind: 'house', sections }];
    const { g, seats: [host, , rival] } = await start('support', map);
    const scout = owned(g, 0, 'rifle'); place(scout, 49, 75);
    const vehicle = fixtureUnit(g, 0, 'tank', 55, 65); await tick(8);
    assert.equal(typeof sim.damageWorldSection, 'function', 'section damage seam is installed');
    const since = host.messages.length, hiddenSince = rival.messages.length;
    await host.send({ t: 'move', orders: [[vehicle.id, 73, 65]] });
    sim.damageWorldSection(g, sections[0].c, 1000, { contactId: 'acceptance-collapse', direction: { x: 0, z: 1 }, owner: 0 });
    await tick(20);
    const failed = sections.slice(0, 2).map(section => host.terrain.get(section.c));
    for (const cell of failed) assert.equal(cell[4].section.state, 'failed', 'the breach and its unsupported dependent fail');
    assert.equal(host.terrain.get(sections[2].c)?.[1] ?? host.latest('start').map.rows[30][32], 'B', 'the independent supported section survives');
    const collapsed = events(host, since).filter(event => event.k === 'collapse');
    assert.equal(collapsed.length, 2, 'each failed section collapses once');
    assert.ok(!events(rival, hiddenSince).some(event => event.k === 'collapse'), 'unobserved section collapse is private');
    sim.damageWorldSection(g, sections[0].c, 1000, { contactId: 'acceptance-collapse', direction: { x: 1, z: 0 }, owner: 0 }); await tick(8);
    assert.equal(events(host, since).filter(event => event.k === 'collapse').length, 2, 'duplicate contact cannot repeat collapse');
    await tick(240);
    const deliveredVehicle = row(host, vehicle.id), deliveredPlan = host.latest('s').plans.find(plan => plan[0] === vehicle.id);
    const remembered = failed.map(cell => structuredClone(cell));
    place(scout, g.players[0].spawn.x, g.players[0].spawn.z);
    place(vehicle, g.players[0].spawn.x + 8, g.players[0].spawn.z); await tick(8);
    const rejoined = await connect('support', 'support0'); await rejoined.wait('start'); await tick();
    for (const cell of remembered) assert.deepEqual(rejoined.terrain.get(cell[0]), cell, 'reconnect retains the last observed settled section');
    assert.ok(!events(rejoined).some(event => event.k === 'collapse'), 'reconnect does not play old collapse events');
    assert.ok(Math.hypot(deliveredVehicle[3] - 73, deliveredVehicle[4] - 65) < 1.5, `the existing vehicle order reaches its destination after rubble enters its planned route (${JSON.stringify({ current: deliveredVehicle, plan: deliveredPlan })})`);
  });

  await check('two way crowded crossing completes infantry, tank and support orders', async () => {
    const map = blankMap(), rows = map.rows.map(row => [...row]);
    for (let y = 0; y < map.h; y++) for (let x = 46; x <= 50; x++) rows[y][x] = y >= 45 && y <= 50 ? '=' : 'W';
    map.rows = rows.map(row => row.join(''));
    const { g, seats: [left, right] } = await start('traffic', map, 'conquest', [0, 1]);
    const orders = [[], []], targets = new Map();
    for (let owner = 0; owner < 2; owner++) for (let n = 0; n < 8; n++) {
      const type = n === 0 ? owner === 0 ? 'tank' : 'at' : 'rifle';
      const unit = fixtureUnit(g, owner, type, owner === 0 ? 77 - Math.floor(n / 4) * 5 : 117 + Math.floor(n / 4) * 5, 88 + n % 4 * 6);
      const target = [owner === 0 ? 121 + Math.floor(n / 4) * 5 : 73 - Math.floor(n / 4) * 5, 88 + n % 4 * 6];
      orders[owner].push([unit.id, ...target]); targets.set(unit.id, { owner, at: target });
    }
    await tick(8);
    await left.send({ t: 'move', orders: orders[0] }); await right.send({ t: 'move', orders: orders[1] });
    await tick(800);
    for (const [id, target] of targets) {
      const current = row(target.owner === 0 ? left : right, id);
      assert.ok(current, 'crossing traffic keeps every ordered unit alive');
      assert.ok(Math.hypot(current[3] - target.at[0], current[4] - target.at[1]) < 2, `${current[1]} ${id} completes its reachable crossing within 40 seconds (${JSON.stringify({ current, destination: target.at, plan: (target.owner === 0 ? left : right).latest('s').plans.find(plan => plan[0] === id) })})`);
    }
    for (const seat of [left, right]) assert.ok(!seat.messages.some(msg => msg.t === 'deny' && msg.reason === 'unreachable'), 'traffic cannot report reachable destinations as disconnected');
  });

  for (const outcome of ['stationary', 'moving', 'wall']) await check(`authoritative gun flight ${outcome}, arrival and hidden cue privacy`, async () => {
    const originalRandom = Math.random; Math.random = () => 0;
    try {
      const code = `gun${outcome.slice(0, 6)}`, { g, seats: [host, targetOwner, distant] } = await start(code, blankMap(), 'conquest', [0, 1, 2]);
      for (const unit of g.units.values()) if (unit.owner === 2) place(unit, 175, 175);
      const weaponType = outcome === 'moving' ? 'mortar' : 'at', targetType = outcome === 'moving' ? 'rifle' : 'tank';
      const gun = fixtureUnit(g, 0, weaponType, 15, 35), target = fixtureUnit(g, 1, targetType, 53, 35), laneFriend = owned(g, 0, 'rifle');
      place(laneFriend, 35, 35); target.rot = 0; await tick(8);
      const beforeHP = row(host, target.id)[7], friendHP = row(host, laneFriend.id)[7], since = host.messages.length, hiddenSince = distant.messages.length;
      await host.send({ t: 'attack', ids: [gun.id], target: target.id });
      // Compressed commands can arrive after the fixture's short settle delay under load.
      await until(() => gun.attackId === target.id, 'the server accepts the attack before simulation advances');
      await tick(2);
      const launch = await until(() => events(host, since).find(event => event.k === 'flight' && event.kind === weaponType), 'the launched flight snapshot reaches its recipient');
      assert.ok(launch?.flight, 'ordinary attack creates an identified authoritative flight');
      assert.equal(row(host, target.id)[7], beforeHP, 'a launched shell causes no pre-arrival damage');
      assert.ok(host.latest('s').flights.some(flight => flight.flight === launch.flight), 'the recipient sees the live flight');
      assert.ok(!distant.latest('s').flights.some(flight => flight.flight === launch.flight), 'an uninformed recipient receives no hidden trajectory');
      await host.send({ t: 'stop', ids: [gun.id] });
      await until(() => gun.attackId === 0, 'the server stops further fire before advancing the flight');
      if (outcome === 'moving') {
        await targetOwner.send({ t: 'move', orders: [[target.id, 53, 60]] });
        await until(() => target.worldGoal?.z === 60, 'the server accepts the evasion order before simulation advances');
      }
      if (outcome === 'wall') {
        assert.equal(typeof sim.mutateWorldCell, 'function');
        sim.mutateWorldCell(g, 17 * g.w + 17, { object: 'B' });
      }
      if (outcome === 'stationary') gun.hp = 0;
      await tick(40);
      const contacts = events(host, since).filter(event => event.k === 'contact' && event.flight === launch.flight);
      if (outcome === 'stationary') {
        assert.ok(row(host, target.id)[7] < beforeHP, 'the shell hits after its shooter dies');
        assert.equal(contacts.filter(event => event.hit && event.terminal).length, 1, 'the identified flight damages its target once');
      } else {
        assert.equal(row(targetOwner, target.id)[7], beforeHP, 'a target outside the traveled lane is not chased or damaged through the wall');
        if (outcome === 'wall') assert.ok(contacts.some(event => event.terminal && event.x < 38), 'the thin intervening wall receives the first swept terminal contact');
      }
      assert.equal(row(host, laneFriend.id)[7], friendHP, outcome === 'moving' ? 'a friend outside the eventual blast radius stays unharmed' : 'ordinary direct rounds preserve friendly lane safety');
      assert.ok(!events(distant, hiddenSince).some(event => event.flight === launch.flight), 'hidden launch and impact cues remain private');
      const hp = row(targetOwner, target.id)[7], contactCount = contacts.length;
      await host.send({ t: 'resync' }); await targetOwner.send({ t: 'resync' }); await tick(8);
      assert.equal(row(targetOwner, target.id)[7], hp, 'snapshot redelivery cannot damage the target again');
      assert.equal(events(host, since).filter(event => event.k === 'contact' && event.flight === launch.flight).length, contactCount, 'full snapshot redelivery does not replay the consumed contact');
    } finally { Math.random = originalRandom; }
  });

  await check('Horde broad warning agrees with legal delivered first Wave', async () => {
    const map = blankMap(); map.defend = [0];
    const { g, seats: [host] } = await start('horde', map, 'horde', [0]);
    const warning = host.latest('s').mode.nextProfile;
    assert.ok(['mixed', 'infantry'].includes(warning), 'Wave 1 announces only a category with affordable unlocked units');
    for (const key of ['reserve', 'budget', 'profileSeed', 'roster']) assert.equal(host.latest('s').mode[key], undefined, 'a broad warning exposes no private roster or budget');
    const watcher = await connect('horde', 'hordewatch', true); await watcher.wait('start');
    await host.send({ t: 'nextwave' }); await tick(20);
    assert.equal(host.latest('s').mode.profile, warning, 'the active category agrees with the warning');
    assert.equal(host.latest('s').mode.nextProfile, undefined, 'active Wave has no next-Wave announcement');
    const delivered = watcher.latest('s').units.filter(unit => unit[2] === g.mode.slot && !sim.UNITS[unit[1]].air);
    assert.ok(delivered.length, 'the Wave fielded actual troops');
    const legal = new Set(sim.CFG.horde.unlock.filter(([, wave]) => wave <= 1).map(([type]) => type));
    for (const unit of delivered) assert.ok(legal.has(unit[1]), 'every delivered purchase obeys the existing unlock rule');
    assert.ok(delivered.length <= sim.CFG.horde.field, 'first Wave obeys its field limit');
    const currentWave = host.latest('s').mode.wave;
    await host.send({ t: 'nextwave' }); await tick(40);
    assert.equal(host.latest('s').mode.wave, currentWave, 'a Wave cannot advance while its fielded forces remain alive');
    assert.equal(host.latest('s').mode.active, true);
  });
} finally {
  server.clock.setTimeout = () => null;
  server.mapFiles.read = originalRead; server.mapFiles.list = originalList;
  for (const client of clients) client.ws.terminate();
  for (const ws of server.wss.clients) ws.terminate();
  server.rooms.clear();
  await new Promise(resolve => server.wss.close(resolve));
  await new Promise(resolve => server.server.close(resolve));
}
if (failures.length) { console.error(`${failures.length} engine acceptance group(s) failed: ${failures.join('; ')}`); process.exitCode = 1; }
else console.log('Integrated engine acceptance checks passed');
