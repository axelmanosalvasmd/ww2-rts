import assert from 'node:assert/strict';
function fakeClock() {
  let now = 0, nextId = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(fn, ms) { const id = ++nextId; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimeout(id) { timers.delete(id); },
    advance(ms) {
      const until = now + ms;
      for (;;) {
        const due = [...timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!due) break;
        now = due[1].at; timers.delete(due[0]); due[1].fn();
      }
      now = until;
    },
  };
}
let serverModule = null;
async function serverHarness() {
  serverModule ??= (async () => {
    const env = { PORT: '0', EDIT_PASSWORD: 'test', PUBLIC_URL: 'http://test' }; // no .edit-password file, no tailscale call
    const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
    Object.assign(process.env, env);
    let module;
    try { module = await import('./server.js'); }
    finally { for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    clearInterval(module.loop);
    if (!module.server.listening) await new Promise((resolve, reject) => { module.server.once('listening', resolve); module.server.once('error', reject); });
    // Server-side sockets in accept order; connect() waits for its own (clients connect one at a time).
    const accepting = [];
    module.wss.on('connection', ws => accepting.shift()?.(ws));
    return { module, accepting, originalClock: { ...module.clock }, originalMaps: { ...module.mapFiles } };
  })();
  const { module, accepting, originalMaps } = await serverModule;
  const { default: WebSocket } = await import('ws');
  const clock = fakeClock(), clients = [];
  Object.assign(module.clock, clock);
  Object.assign(module.mapFiles, originalMaps);
  let mapGate = null;
  const settleServer = async () => {
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setTimeout(resolve, 4));
    await new Promise(resolve => setImmediate(resolve));
  };
  // real-time limit: generous because starting a Massive six-army match can take seconds on a loaded machine
  const waitFor = async (predicate, label) => {
    const until = Date.now() + (+process.env.WW2_TEST_WAIT_MS || 15000);
    for (;;) {
      const result = predicate();
      if (result) return result;
      assert.ok(Date.now() < until, label);
      await settleServer();
    }
  };
  const connect = async (code, { token = 'token-' + clients.length, name = 'Soldier', hello = true } = {}) => {
    const serverSide = new Promise(resolve => accepting.push(resolve));
    // no compression: zlib runs off the main thread, and settleServer's few milliseconds assume a message is sent at once
    const ws = new WebSocket(`ws://127.0.0.1:${module.server.address().port}/ws?room=${code}`, { perMessageDeflate: false });
    const messages = [], errors = [];
    const client = {
      code, token, ws, messages, log: messages, errors, closed: false, serverSide,
      async send(message) { await new Promise((resolve, reject) => ws.send(JSON.stringify(message), error => error ? reject(error) : resolve())); await settleServer(); },
      async late(message) { (await serverSide).emit('message', Buffer.from(JSON.stringify(message)), false); await settleServer(); },
      lobby: () => messages.filter(message => message.t === 'lobby').at(-1),
      async close() { if (ws.readyState !== 3) ws.close(); await waitFor(() => client.closed, 'client closes'); await settleServer(); },
      wait(type, predicate = () => true, after = 0) { return waitFor(() => messages.slice(after).find(message => message.t === type && predicate(message)), `client receives ${type}`); },
    };
    // snapshots carry changed unit rows, gone ids and the wrecks and nodes only when they change: rebuild them as client/main.js does
    const rows = new Map(); let prev = null;
    ws.on('message', raw => {
      const m = JSON.parse(String(raw));
      if (m.t === 'start') { rows.clear(); prev = null; }
      if (m.t === 's') {
        for (const id of m.gone ?? []) rows.delete(id);
        for (const row of m.units) rows.set(row[0], row);
        m.sent = m.units; m.units = [...rows.values()]; m.wrecks ??= prev?.wrecks; m.nodes ??= prev?.nodes; prev = m;
      }
      messages.push(m);
    });
    ws.on('close', () => { client.closed = true; });
    ws.on('error', error => errors.push(error)); clients.push(client);
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    if (!hello) return client;
    await client.send({ t: 'hello', token, name });
    await waitFor(() => messages.find(message => ['lobby', 'full'].includes(message.t)), 'hello is answered');
    return client;
  };
  return {
    clock, connect, settleServer, waitFor, rooms: module.rooms,
    game: code => module.rooms.get(code)?.game,
    snapshots: client => client.messages.filter(message => message.t === 's'),
    async tick(n = 1) { for (let i = 0; i < n; i++) module.tickRooms(); await settleServer(); },
    holdMaps() {
      let open; mapGate = new Promise(resolve => (open = resolve)); mapGate.open = open;
      const read = module.mapFiles.read, gate = mapGate;
      module.mapFiles.read = async (name) => { await gate; return read(name); };
    },
    releaseMaps() { mapGate?.open(); mapGate = null; },
    useMap(json) { module.mapFiles.read = async () => json; },
    async clear(code) { await Promise.all(clients.filter(client => client.code === code && !client.closed).map(client => client.close())); module.rooms.delete(code); },
    async close() {
      mapGate?.open(); mapGate = null; Object.assign(module.mapFiles, originalMaps);
      await Promise.all(clients.filter(client => !client.closed).map(client => client.close()));
      for (const code of new Set(clients.map(client => client.code))) module.rooms.delete(code);
    },
  };
}
async function stopServerHarness() {
  if (!serverModule) return;
  const { module, originalClock, originalMaps } = await serverModule;
  for (const ws of module.wss.clients) ws.terminate();
  module.rooms.clear(); Object.assign(module.clock, originalClock); Object.assign(module.mapFiles, originalMaps);
  await new Promise(resolve => module.wss.close(() => resolve()));
  if (module.server.listening) await new Promise(resolve => module.server.close(resolve));
}

  async function roomLifecycleChecks(h) {
    let caseId = 0;
    const last = (client, type) => client.messages.findLast(message => message.t === type);
    const check = async fn => { const code = 'r3t' + ++caseId; try { await fn(code); } finally { await h.clear(code); } };
    const humans = async (code, names = ['Ana', 'Ben']) => {
      const players = [];
      for (const name of names) players.push(await h.connect(code, { token: code + name, name }));
      return players;
    };
    const start = async (code, host) => {
      const after = host.messages.length; await host.send({ t: 'start' }); await host.wait('start', () => true, after); return h.rooms.get(code);
    };

    await check(async code => {
      const [ana] = await humans(code, ['Ana']);
      await ana.close();
      assert.equal(h.rooms.get(code).emptySince, 0, 'an empty room can start its grace period at fake time zero');
      h.clock.advance(60_000); await h.tick();
      assert.ok(h.rooms.has(code), 'an empty room survives the full one-minute grace period');
      h.clock.advance(1); await h.tick();
      assert.equal(h.rooms.has(code), false, 'an empty room expires after its grace period');
    });
    await check(async code => {
      const [ana, ben, cy] = await humans(code, ['Ana', 'Ben', 'Cy']);
      await ana.close();
      await ben.wait('lobby', message => message.host === 1 && !message.players[0].connected);
      assert.equal(last(ben, 'lobby').host, 1, 'the next connected human inherits host controls');
      const room = h.rooms.get(code); h.clock.advance(9999); await h.settleServer();
      assert.equal(room.players.length, 3, 'an offline seat is held for ten seconds');
      await cy.send({ t: 'kick', slot: 0 });
      assert.equal(room.players.length, 3, 'only the host can kick an offline human');
      await ben.send({ t: 'kick', slot: 0 });
      assert.equal(room.players.length, 2, 'the host can kick an offline human');
      await ben.wait('lobby', message => message.you === 0 && message.host === 0);
      await ben.send({ t: 'kick', slot: 1 });
      assert.equal(room.players.length, 2, 'a connected human cannot be kicked');
    });
    await check(async code => {
      const [ana, ben] = await humans(code), room = h.rooms.get(code), player = room.players[1];
      await ben.close(); h.clock.advance(9999); await h.settleServer();
      assert.equal(room.players.length, 2, 'cleanup does not free a seat early');
      const refresh = await h.connect(code, { token: ben.token, name: 'Ben' });
      h.clock.advance(1); await h.settleServer();
      assert.equal(room.players[1], player, 'a refresh retains the player object and cancels cleanup');
      await refresh.close(); h.clock.advance(10_000); await h.settleServer();
      assert.equal(room.players.length, 1, 'an unrecovered lobby seat is freed after ten seconds');
      await ana.wait('lobby', message => message.players.length === 1);
    });
    await check(async code => {
      const [ana, ben, cy] = await humans(code, ['Ana', 'Ben', 'Cy']);
      const room = await start(code, ana), player = room.players[1];
      await ben.close();
      assert.equal(room.pause?.player, player, 'a human drop pauses their match');
      await cy.send({ t: 'handAi', slot: 1 });
      assert.equal(player.ai, undefined, 'a non-host cannot hand an army to AI');
      await ana.send({ t: 'handAi', slot: '1' });
      assert.equal(player.ai, undefined, 'hand to AI requires an integer seat');
      await ana.send({ t: 'handAi', slot: 1 });
      assert.equal(room.players[1], player, 'hand to AI keeps the army seat');
      assert.equal(player.ai, true); assert.equal(player.token, ''); assert.equal(player.ws, null);
      assert.equal(room.pause, null, 'hand to AI ends that player drop pause');
      await h.tick(); assert.equal(room.game.players[1].away, false, 'the AI army is active');
      await cy.send({ t: 'leave' }); await cy.wait('left');
      assert.equal(room.players[2].ai, true, 'leave uses the same AI handover');
    });
    await check(async code => {
      const [ana, ben, cy] = await humans(code, ['Ana', 'Ben', 'Cy']);
      const room = await start(code, ana), retained = [room.players[1], room.players[2]];
      const { finish } = await import('./shared/sim.js');
      await ana.close(); await ben.send({ t: 'resume' }); finish(room.game, 1, 'vp');
      for (let i = 0; i < 200 && room.state === 'play'; i++) await h.tick(); // the 6 s closing hold, then the lobby
      assert.equal(room.state, 'lobby', 'natural match end returns to the lobby');
      assert.deepEqual(room.players, retained, 'match end frees offline humans and retains player objects');
      assert.deepEqual(room.players.map(player => player.lastMatch), [{ outcome: 'victory', team: 1 }, { outcome: 'defeat', team: 2 }], 'per-player reports survive seat freeing');
      assert.equal(room.result.story.length, 3, 'the story keeps a row per seat');
      assert.deepEqual(room.result.teams, [1, 2, 0], 'result teams follow current seats before freed players');
      assert.deepEqual(room.result.names, ['Ben', 'Cy', 'Ana'], 'result names use the same order');
      const lobby = await ben.wait('lobby', message => message.state === 'lobby' && message.result?.winner === 1);
      assert.equal(lobby.result.teams[lobby.you], lobby.result.winner, 'the remaining winner still sees Victory after their seat shifts');
      const dana = await h.connect(code, { token: code + 'Dana', name: 'Dana' });
      assert.equal(room.players[2].team, 0, 'a new seat receives an unused team');
      assert.deepEqual(room.result.teams, [1, 2, null, 0], 'newcomers do not inherit the freed player result');
      assert.deepEqual(last(dana, 'lobby').result.names, ['Ben', 'Cy', '', 'Ana']);
      await cy.close(); h.clock.advance(10_000); await h.settleServer();
      assert.deepEqual(room.result.teams, [1, null, 2, 0], 'later lobby cleanup keeps the result aligned');
    });
    await check(async code => {
      const [ana, ben] = await humans(code), room = await start(code, ana), player = room.players[0], matchId = room.matchId;
      assert.ok(Number.isSafeInteger(matchId) && matchId > 0, 'start identifies the match');
      const replacement = await h.connect(code, { token: ana.token, name: 'Ana' });
      await ana.wait('replaced'); await h.settleServer();
      assert.equal(ana.closed, true, 'the replaced socket is closed after its message');
      assert.equal(room.players[0], player, 'replacement keeps the same player object');
      assert.equal(room.pause, null, 'replacement does not trigger a drop pause');
      assert.equal((await replacement.wait('start')).matchId, matchId, 'same-match reconnect keeps its match id');
      await replacement.send({ t: 'pause' });
      const joining = await h.connect(code, { token: ben.token, name: 'Ben' }); await joining.wait('start');
      const types = joining.messages.map(message => message.t);
      assert.ok(types.indexOf('start') < types.indexOf('pause'), 'a reconnect gets start before the pause state');
      assert.equal(last(joining, 'pause').reason, 'host', 'a reconnect sees the current host pause');
      const after = replacement.messages.length; await replacement.send({ t: 'restart' });
      const restarted = await replacement.wait('start', message => message.matchId === matchId + 1, after);
      assert.equal(restarted.matchId, matchId + 1, 'restart increments the match counter');
      assert.equal(room.pause, null, 'restart clears pause');
      assert.equal(last(replacement, 'pause').paused, false, 'restart broadcasts resume');
    });
    await check(async code => {
      const [ana, ben] = await humans(code); await ana.send({ t: 'addAi' });
      const room = await start(code, ana), g = room.game;
      await ben.send({ t: 'pause' }); assert.equal(room.pause, null, 'only the host can pause');
      await ana.send({ t: 'pause' });
      assert.deepEqual(last(ana, 'pause'), { t: 'pause', paused: true, by: 'Ana', reason: 'host', left: 0 });
      const before = { tick: g.tick, nextId: g.nextId, mp: g.players[0].mp, units: g.units.size };
      await ana.send({ t: 'buy', unit: 'rifle' }); await h.tick(40);
      assert.deepEqual({ tick: g.tick, nextId: g.nextId, mp: g.players[0].mp, units: g.units.size }, before, 'pause rejects commands and skips simulation and AI');
      const count = h.snapshots(ana).length;
      h.clock.advance(999); await h.tick(); assert.equal(h.snapshots(ana).length, count, 'paused snapshots wait one second');
      h.clock.advance(1); await h.tick(); assert.equal(h.snapshots(ana).length, count + 1, 'paused matches send a snapshot once a second');
      await h.tick(20); assert.equal(h.snapshots(ana).length, count + 1, 'paused snapshots do not repeat before time advances');
      await ben.send({ t: 'resume' }); assert.ok(room.pause, 'only the host can resume');
      await ana.send({ t: 'resume' }); assert.equal(room.pause, null);
      await h.tick(); assert.equal(g.tick, before.tick + 1, 'host resume restarts simulation');
      await ana.send({ t: 'pause' }); await ben.close(); await ana.send({ t: 'end' });
      assert.equal(room.pause, null, 'host end clears pause');
      assert.equal(room.state, 'lobby'); assert.equal(room.players.length, 2, 'host end frees the offline human and keeps the AI');
      assert.equal(last(ana, 'pause').paused, false, 'host end broadcasts resume');
    });
    await check(async code => {
      const [ana, ben] = await humans(code), room = await start(code, ana), g = room.game;
      await ben.close();
      assert.deepEqual(last(ana, 'pause'), { t: 'pause', paused: true, by: 'Ben', reason: 'drop', left: 30 });
      h.clock.advance(6000); await h.tick(); assert.equal(last(ana, 'pause').left, 24, 'drop pause shows whole seconds remaining');
      h.clock.advance(23_999); await h.tick(); assert.ok(room.pause, 'drop pause lasts until its deadline');
      assert.equal(g.tick, 0, 'simulation stays stopped while waiting');
      h.clock.advance(1); await h.tick(); assert.equal(room.pause, null, 'drop pause expires at thirty seconds');
      assert.equal(g.tick, 1, 'the first tick after the deadline advances the match');
      const returned = await h.connect(code, { token: ben.token, name: 'Ben' }); await returned.wait('start'); await returned.close();
      assert.equal(room.pause, null, 'the same player cannot auto-pause twice in one match');
      const returnedAgain = await h.connect(code, { token: ben.token, name: 'Ben' });
      const after = ana.messages.length; await ana.send({ t: 'restart' }); await ana.wait('start', () => true, after);
      await returnedAgain.close(); assert.equal(room.pause?.reason, 'drop', 'a new match resets the auto-pause allowance');
      const restored = await h.connect(code, { token: ben.token, name: 'Ben' }); await restored.wait('start');
      assert.equal(room.pause, null, 'reconnect ends a drop pause');
      assert.equal(last(ana, 'pause').paused, false, 'reconnect broadcasts resume');
      await ana.close(); assert.equal(room.pause?.by, 'Ana', 'each human has their own pause allowance');
      await restored.send({ t: 'resume' }); assert.equal(room.pause, null, 'the current host can end a drop pause');
    });
    await check(async code => {
      const [ana] = await humans(code, ['Ana']);
      const { MAX_PLAYERS } = await import('./shared/sim.js');
      for (let i = 1; i < MAX_PLAYERS; i++) await ana.send({ t: 'addAi' });
      const invite = await h.connect(code, { token: code + 'invite', name: 'Invite' });
      assert.equal(last(invite, 'lobby').spectator, true, 'a full lobby seats nobody else: the invite watches');
      assert.equal(last(invite, 'lobby').you, -1, 'a spectator has no seat');
      for (let i = 1; i < 8; i++) await h.connect(code, { token: code + 'watch' + i, name: 'Watch' });
      const full = await h.connect(code, { token: code + 'late', name: 'Late' });
      assert.equal(last(full, 'full').reason, 'seats', 'a room with eight spectators turns the next one away');
    });
    // Spectators: a late invite watches the running match with the fog lifted, commands nothing and can sit down afterwards.
    await check(async code => {
      const [ana, ben] = await humans(code), room = await start(code, ana);
      const invite = await h.connect(code, { token: code + 'invite', name: 'Invite' });
      assert.equal(last(invite, 'lobby').spectator, true, 'an invite cannot claim a new seat during play: it watches');
      const begin = await invite.wait('start');
      assert.equal(begin.you, 0, 'a spectator watches from the first seat');
      assert.equal(begin.fog, undefined, 'a spectator gets no fog mask');
      const after = invite.messages.length; await h.tick(2);
      const seen = await invite.wait('s', () => true, after);
      assert.equal(seen.units.length, room.game.units.size, 'a spectator sees every unit');
      assert.equal(seen.fog, undefined, 'a spectator gets no fog changes');
      assert.ok(last(ana, 's').units.length < seen.units.length, 'the seat it watches from still sees only its own side');
      const tick = room.game.tick;
      await invite.send({ t: 'leave' }); await invite.send({ t: 'end' }); await invite.send({ t: 'pause' }); await invite.send({ t: 'stop', ids: [...room.game.units.keys()] });
      assert.ok(room.state === 'play' && !room.pause && room.players.every(p => !p.ai), 'a spectator cannot leave for a player, end or pause the match');
      assert.ok(!last(invite, 'deny'), 'the orders of a spectator are dropped without an answer');
      await h.tick(); assert.equal(room.game.tick, tick + 1, 'the match runs on');
      await ben.close();
      const beforeEnd = invite.messages.length; await ana.send({ t: 'end' });
      await invite.wait('lobby', message => message.state === 'lobby', beforeEnd);
      assert.equal(last(invite, 'lobby').state, 'lobby', 'the spectator is back in the lobby with everyone');
      const beforeSit = invite.messages.length; await invite.send({ t: 'sit' });
      await invite.wait('lobby', message => message.state === 'lobby' && message.spectator === false, beforeSit);
      assert.equal(last(invite, 'lobby').spectator, false, 'a spectator can take a seat in the lobby');
      assert.equal(room.players.length, 2, 'the disconnected match seat was freed for the invite');
      const beforeSpectate = invite.messages.length; await invite.send({ t: 'spectate' });
      await invite.wait('lobby', message => message.state === 'lobby' && message.spectator === true && message.you === -1, beforeSpectate);
      assert.deepEqual([room.players.length, room.spectators.length, last(invite, 'lobby').you], [1, 1, -1], 'a seated player can step back to watch');
    });
    // An all-AI room: the host steps back to watch, still hosts, and the room lives while a spectator is connected.
    await check(async code => {
      const [ana] = await humans(code, ['Ana']), room = h.rooms.get(code);
      await ana.send({ t: 'spectate' }); await ana.send({ t: 'start' });
      assert.equal(room.state, 'lobby', 'a match needs at least one seat');
      await ana.send({ t: 'addAi' }); await ana.send({ t: 'addAi' });
      assert.deepEqual(room.players.map(p => !!p.ai), [true, true], 'a spectator hosts a room of AIs');
      assert.equal(last(ana, 'lobby').amHost, true, 'the spectator is told it hosts');
      await start(code, ana);
      const after = ana.messages.length; await h.tick(2);
      assert.equal((await ana.wait('s', () => true, after)).units.length, room.game.units.size, 'the spectator sees both AI armies');
      assert.equal(room.emptySince ?? null, null, 'a watched room is not empty');
      await ana.send({ t: 'end' }); assert.equal(room.state, 'lobby', 'the spectating host can end the match');
      await ana.close();
      assert.ok(room.emptySince != null && !room.spectators.length, 'a spectator who disconnects is gone, and the room starts its grace period');
    });
    console.log(`Room lifecycle: ${caseId} scenarios passed`);
  }

const harness=await serverHarness();
try { await roomLifecycleChecks(harness); } finally { await harness.close(); await stopServerHarness(); }
