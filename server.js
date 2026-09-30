// One process: serves the client and runs game rooms over WebSocket.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, normalize, extname } from 'node:path';
import { WebSocketServer } from 'ws';
import { createGame, step, command, snapshotFor, TICK } from './shared/sim.js';
import { think } from './shared/ai.js';

const PORT = +(process.env.PORT || 3000), HOST = process.env.HOST || '127.0.0.1';
const ROOT = import.meta.dirname;
const MAP = JSON.parse(readFileSync(join(ROOT, 'maps/default.json'), 'utf8'));
const STATIC = { '/client/': 'client', '/shared/': 'shared', '/vendor/': 'node_modules/three/build' };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  let file = url.pathname === '/' ? join(ROOT, 'client/index.html') : null;
  for (const [prefix, dir] of Object.entries(STATIC)) {
    if (!url.pathname.startsWith(prefix)) continue;
    const base = join(ROOT, dir), p = normalize(join(base, url.pathname.slice(prefix.length)));
    if (p.startsWith(base)) file = p; // no path traversal
  }
  try {
    if (!file) throw 0;
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
});

// room: { code, players: [{ token, name, ws, ai }], state: 'lobby'|'play'|'over', game, emptySince }
// A player's slot in the game is their index in players; the host is the first human.
const rooms = new Map();
const cleanName = (n) => String(n || '').replace(/[<>&"']/g, '').trim().slice(0, 16) || 'Soldier';
const send = (ws, msg) => ws?.readyState === 1 && ws.send(JSON.stringify(msg));
const hostOf = (room) => room.players.findIndex(p => !p.ai);

function lobby(room) {
  room.players.forEach((p, i) => send(p.ws, {
    t: 'lobby', code: room.code, state: room.state, you: i, host: hostOf(room),
    players: room.players.map(q => ({ name: q.name, connected: !!q.ws || !!q.ai, ai: !!q.ai })),
  }));
}

function sendStart(room, i) {
  send(room.players[i].ws, { t: 'start', map: MAP, you: i, spawn: room.game.players[i].spawn, names: room.players.map(p => p.name) });
}

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
wss.on('connection', (ws, req) => {
  const code = new URL(req.url, 'http://x').searchParams.get('room') || '';
  if (!/^[a-z0-9]{3,12}$/i.test(code)) return ws.close(1008, 'bad room');
  let room = null, me = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    if (!me) {
      if (msg.t !== 'hello') return;
      room = rooms.get(code) || rooms.set(code, { code, players: [], state: 'lobby', game: null }).get(code);
      const token = String(msg.token || '').slice(0, 40), name = cleanName(msg.name);
      me = room.players.find(p => p.token === token && token);
      if (me) { me.ws?.close(); me.ws = ws; me.name = name; }
      else if (room.state === 'lobby' && room.players.length < 3) room.players.push(me = { token, name, ws });
      else { send(ws, { t: 'full' }); return ws.close(); }
      room.emptySince = 0;
      lobby(room);
      if (room.state !== 'lobby') sendStart(room, room.players.indexOf(me));
      return;
    }
    const slot = room.players.indexOf(me);
    if (msg.t === 'name') { me.name = cleanName(msg.name); lobby(room); }
    else if (msg.t === 'addAi' && slot === hostOf(room) && room.state === 'lobby' && room.players.length < 3) {
      room.players.push({ token: '', name: `AI ${room.players.filter(p => p.ai).length + 1}`, ws: null, ai: true });
      lobby(room);
    } else if (msg.t === 'kick' && slot === hostOf(room) && room.state === 'lobby' && room.players[msg.slot]?.ai) {
      room.players.splice(msg.slot, 1);
      lobby(room);
    } else if (msg.t === 'start' && slot === hostOf(room) && room.state !== 'play') {
      room.game = createGame(MAP, room.players.map(p => p.name));
      room.state = 'play';
      lobby(room);
      room.players.forEach((_, i) => sendStart(room, i));
    } else if (room.state === 'play') command(room.game, slot, msg);
  });

  ws.on('close', () => {
    if (!me || me.ws !== ws) return;
    me.ws = null;
    if (!room.players.some(p => p.ws)) room.emptySince = Date.now();
    lobby(room);
    // in the lobby, free the slot unless they come back (e.g. a page refresh) within 10s
    setTimeout(() => {
      if (me.ws || room.state !== 'lobby' || !room.players.includes(me)) return;
      room.players.splice(room.players.indexOf(me), 1);
      lobby(room);
    }, 10_000);
  });
});

setInterval(() => {
  for (const room of rooms.values()) {
    if (room.emptySince && Date.now() - room.emptySince > 60_000) { rooms.delete(room.code); continue; }
    if (room.state !== 'play') continue;
    const g = room.game;
    step(g);
    // AIs think every 2s, staggered so they don't all act on the same tick
    room.players.forEach((p, i) => p.ai && (g.tick + i * 13) % 40 === 0 && think(g, i));
    if (g.tick % 2 === 0 || g.winner !== null) {
      const shots = g.shots; g.shots = [];
      room.players.forEach((p, i) => send(p.ws, snapshotFor(g, i, shots)));
    }
    if (g.winner !== null) { room.state = 'over'; lobby(room); }
  }
}, TICK * 1000);

server.listen(PORT, HOST, () => console.log(`ww2-rts on http://${HOST}:${PORT}`));
