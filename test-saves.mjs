// Saved matches: a restored sim plays on exactly like the original, and a room saves, lists and loads its matches.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { createGame, step } from './shared/sim.js';
import { generateWorldMap } from './shared/world-conquest.js';
import { snapshotState, restoreState } from './server/saves.js';
import { memoryConnect } from './test-socket.js';

const dir = mkdtempSync(join(tmpdir(), 'ww2-saves-'));
Object.assign(process.env, { PORT: '0', EDIT_PASSWORD: 'test', PUBLIC_URL: 'http://test', SAVES_DIR: dir });

// 1. the sim round trip: same state, same future
{
  const g = createGame(generateWorldMap({ seed: 7, players: 2, teams: [0, 1] }), ['a', 'b'], false, [0, 1], [0, 1], { mode: 'world', weather: 'clear', tech: true, logistics: true });
  for (let i = 0; i < 100; i++) step(g);
  const copy = restoreState(snapshotState(g)).g;
  assert.ok(copy.players[-1] && !Object.keys(copy.players).includes('-1'), 'the local defenders come back, still hidden from iteration');
  const seeded = (s) => () => ((s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5 | 0) >>> 0) / 4294967296;
  const future = (game) => {
    const random = Math.random; Math.random = seeded(11);
    try { for (let i = 0; i < 200; i++) step(game); } finally { Math.random = random; }
    return [game.units, [...game.players], game.world.regions];
  };
  // compared by value: a restored object may list its keys in another order
  assert.ok(isDeepStrictEqual(future(copy), future(g)), 'a restored match plays on exactly as the original');
  console.log('save round trip checked');
}

// 2. a room saves, lists and loads (it opens paused, on the saved tick, with its AI seat)
const server = await import('./server.js');
clearInterval(server.loop);
const settle = () => new Promise(resolve => setTimeout(resolve, 5));
async function waitFor(fn, label) { for (let i = 0; i < 3000; i++) { const v = fn(); if (v) return v; await settle(); } assert.fail(label); }
function connect(token) {
  const ws = memoryConnect(server.wss, '/ws?room=savecheck'), messages = [];
  ws.on('message', raw => messages.push(JSON.parse(String(raw))));
  const c = { messages, send: (m) => ws.send(JSON.stringify(m)), last: (t) => messages.filter(m => m.t === t).at(-1), close: () => ws.close() };
  c.send({ t: 'hello', token, name: token });
  return c;
}
try {
  const host = connect('host-token');
  await waitFor(() => host.last('lobby'), 'lobby');
  host.send({ t: 'mode', v: 'world' }); host.send({ t: 'addAi' });
  await waitFor(() => host.last('lobby')?.players.length === 2, 'AI seat');
  host.send({ t: 'start' });
  await waitFor(() => host.last('start'), 'start');
  const room = server.rooms.get('savecheck');
  for (let i = 0; i < 40; i++) server.tickRooms();
  const savedTick = room.game.tick;
  host.send({ t: 'save' });
  await waitFor(() => host.last('saved'), 'saved');
  const listed = await waitFor(() => host.last('lobby')?.saves?.find(s => s.kind === 'manual'), 'the lobby lists the save');
  assert.equal(listed.mode, 'world');
  assert.deepEqual(listed.names, ['host-token', 'AI 1']);
  host.send({ t: 'end' });
  await waitFor(() => host.last('lobby')?.state === 'lobby', 'back in the lobby');
  const starts = host.messages.filter(m => m.t === 'start').length;
  host.send({ t: 'loadSave', id: listed.id });
  await waitFor(() => host.messages.filter(m => m.t === 'start').length > starts, 'the loaded match starts');
  assert.equal(room.game.tick, savedTick, 'the match resumes from its saved tick');
  assert.ok(room.pause, 'and waits for the host to resume it');
  assert.ok(room.players[1].ai && room.players[0].token === 'host-token', 'seats come back: the AI as an AI, the host in its own seat');
  host.send({ t: 'resume' }); await settle();
  for (let i = 0; i < 20; i++) server.tickRooms();
  assert.ok(room.game.tick > savedTick, 'the loaded match runs');
  assert.equal(host.last('deny'), undefined);
  console.log('room save, list and load checked');
} finally {
  for (const ws of server.wss.clients) ws.terminate();
  server.rooms.clear();
  await new Promise(resolve => server.wss.close(resolve));
  await new Promise(resolve => server.server.close(resolve));
  rmSync(dir, { recursive: true, force: true });
}
