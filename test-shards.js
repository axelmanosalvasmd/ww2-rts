// Rooms in several game processes (WW2_SHARDS, server/shards.js): players of one room meet in one process, the
// public lobby lists the rooms of every process, and a match runs in its process. Uses real sockets (it is the transport).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { shardOf } from './server/shards.js';

const proc = spawn(process.execPath, ['server.js'], { cwd: import.meta.dirname, stdio: ['ignore', 'pipe', 'inherit'],
  env: { ...process.env, WW2_SHARDS: '2', PORT: '0', HOST: '127.0.0.1', PUBLIC_URL: 'http://localhost', EDIT_PASSWORD: 'test-only' } });
const port = await new Promise((resolve, reject) => {
  let out = '';
  proc.stdout.on('data', d => { out += d; const m = /on http:\/\/127\.0\.0\.1:(\d+)/.exec(out); if (m) resolve(+m[1]); });
  proc.once('exit', code => reject(new Error(`server exited (${code})`)));
});
const base = `http://127.0.0.1:${port}`, clients = [];
const codeOn = shard => { for (let i = 0; ; i++) if (shardOf('room' + i, 2) === shard) return 'room' + i; };
async function connect(code, n, extra = {}) {
  const ws = new WebSocket(`${base.replace('http:', 'ws:')}/ws?room=${code}`), messages = [];
  clients.push(ws); ws.on('message', d => messages.push(JSON.parse(d)));
  await once(ws, 'open');
  ws.send(JSON.stringify({ t: 'hello', name: 'Player ' + n, token: `token-${code}-${n}`, ...extra }));
  return { ws, messages, send: m => ws.send(JSON.stringify(m)) };
}
const until = async (test, label, ms = 10000) => { const end = Date.now() + ms; while (!test()) { if (Date.now() > end) throw new Error(label); await new Promise(r => setTimeout(r, 20)); } };
try {
  const a = codeOn(0), b = codeOn(1);
  const host = await connect(a, 1, { listing: { public: true, title: 'On the first process' } });
  const friend = await connect(a, 2);
  await until(() => friend.messages.some(m => m.t === 'lobby' && m.players?.length === 2), 'both players of a room meet in one game process');
  await connect(b, 1, { listing: { public: true, title: 'On the second process' } });
  await until(() => clients[2].readyState === 1, 'the second room opens');
  const listed = (await (await fetch(base + '/api/rooms')).json()).rooms;
  assert.deepEqual(listed.map(r => r.title).sort(), ['On the first process', 'On the second process'], 'the public lobby lists the rooms of both game processes');
  host.send({ t: 'start' });
  await until(() => host.messages.some(m => m.t === 's') && friend.messages.some(m => m.t === 's'), 'the match runs in its game process and both players get snapshots');
  console.log('game processes: rooms routed, listed and run');
} finally {
  for (const ws of clients) ws.terminate();
  proc.kill();
}
