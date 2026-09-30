// One process: serves the client and runs game rooms over WebSocket.
import http from 'node:http';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { execFile } from 'node:child_process';
import { join, normalize, extname } from 'node:path';
import { WebSocketServer } from 'ws';
import { createGame, step, command, snapshotFor, validateMap, TICK } from './shared/sim.js';
import { think } from './shared/ai.js';

const PORT = +(process.env.PORT || 3000), HOST = process.env.HOST || '127.0.0.1';
// the address friends use: PUBLIC_URL, else this machine's Tailscale HTTPS name (served by `tailscale serve`)
let PUBLIC_URL = process.env.PUBLIC_URL || '';
if (!PUBLIC_URL) execFile('tailscale', ['status', '--json'], (err, out) => {
  try { const name = JSON.parse(out).Self.DNSName.replace(/\.$/, ''); if (name) PUBLIC_URL = 'https://' + name; } catch {}
});
const ROOT = import.meta.dirname;
const MAP = JSON.parse(readFileSync(join(ROOT, 'maps/default.json'), 'utf8'));
const MAPS = join(ROOT, 'maps'), MAP_NAME = /^[a-z0-9-]{1,32}$/;
const listMaps = async () => (await readdir(MAPS)).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).filter(n => MAP_NAME.test(n)).sort();
async function loadMap(name) {
  try { const m = JSON.parse(await readFile(join(MAPS, name + '.json'), 'utf8')); return validateMap(m) ? MAP : m; } catch { return MAP; }
}

// Map editor saves need a password: EDIT_PASSWORD, or one generated into .edit-password on first run.
const PW_FILE = join(ROOT, '.edit-password');
if (!process.env.EDIT_PASSWORD && !existsSync(PW_FILE)) writeFileSync(PW_FILE, randomBytes(6).toString('hex'));
const EDIT_PASSWORD = process.env.EDIT_PASSWORD || readFileSync(PW_FILE, 'utf8').trim();
const sha = (v) => createHash('sha256').update(String(v)).digest();
const passwordOk = (given) => timingSafeEqual(sha(given), sha(EDIT_PASSWORD));

async function saveMap(req, res, name) {
  const json = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (!passwordOk(req.headers['x-edit-password'] || '')) return json(403, { error: 'wrong password' });
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > 1_000_000) return json(413, { error: 'map too large' }); chunks.push(c); }
  let map;
  try { map = JSON.parse(Buffer.concat(chunks)); } catch { return json(400, { error: 'bad JSON' }); }
  const err = validateMap(map);
  if (err) return json(400, { error: err });
  const clean = { name: map.name, w: map.w, h: map.h, rows: map.rows, ...(map.heights && { heights: map.heights }), spawns: map.spawns.map(({ x, y }) => ({ x, y })),
    points: map.points.map(({ x, y, vp, mp }) => ({ x, y, vp: vp ?? 1, mp: mp ?? 1 })) };
  await writeFile(join(MAPS, name + '.json'), JSON.stringify(clean, null, 1));
  json(200, { ok: true });
}
const STATIC = { '/client/': 'client', '/shared/': 'shared', '/vendor/': 'node_modules/three/build' };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  // maps: list, fetch one, save one (password)
  if (url.pathname === '/maps') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await listMaps())); }
  const mm = /^\/maps\/([^/]+?)(\.json)?$/.exec(url.pathname);
  if (mm) {
    if (!MAP_NAME.test(mm[1])) { res.writeHead(400); return res.end('bad map name'); }
    if (req.method === 'POST') return saveMap(req, res, mm[1]);
    try { const body = await readFile(join(MAPS, mm[1] + '.json')); res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-cache' }); return res.end(body); }
    catch { res.writeHead(404); return res.end('no such map'); }
  }
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

// room: { code, players: [{ token, name, ws, ai }], state: 'lobby'|'play'|'over', game, map, mapName, emptySince }
// A player's slot in the game is their index in players; the host is the first human.
const rooms = new Map();
const cleanName = (n) => String(n || '').replace(/[<>&"']/g, '').trim().slice(0, 16) || 'Soldier';
const send = (ws, msg) => ws?.readyState === 1 && ws.send(JSON.stringify(msg));
const hostOf = (room) => room.players.findIndex(p => !p.ai);

async function lobby(room) {
  const maps = await listMaps();
  room.players.forEach((p, i) => send(p.ws, {
    t: 'lobby', code: room.code, state: room.state, you: i, host: hostOf(room), maps, mapName: room.mapName, publicUrl: PUBLIC_URL,
    players: room.players.map(q => ({ name: q.name, connected: !!q.ws || !!q.ai, ai: !!q.ai })),
  }));
}

function sendStart(room, i) {
  send(room.players[i].ws, { t: 'start', map: room.map, you: i, spawn: room.game.players[i].spawn, spawns: room.game.players.map(p => p.spawn), cells: room.game.cellLog, names: room.players.map(p => p.name) });
}

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
wss.on('connection', (ws, req) => {
  const code = new URL(req.url, 'http://x').searchParams.get('room') || '';
  if (!/^[a-z0-9]{3,12}$/i.test(code)) return ws.close(1008, 'bad room');
  let room = null, me = null;

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    if (!me) {
      if (msg.t !== 'hello') return;
      room = rooms.get(code) || rooms.set(code, { code, players: [], state: 'lobby', game: null, mapName: 'default' }).get(code);
      const token = String(msg.token || '').slice(0, 40), name = cleanName(msg.name);
      me = room.players.find(p => p.token === token && token);
      if (me) { me.ws?.close(); me.ws = ws; me.name = name; }
      else if (room.state === 'lobby' && room.players.length < 3) room.players.push(me = { token, name, ws });
      else { send(ws, { t: 'full' }); return ws.close(); }
      room.emptySince = 0;
      lobby(room);
      if (room.state !== 'lobby' && room.game) sendStart(room, room.players.indexOf(me));
      return;
    }
    const slot = room.players.indexOf(me);
    if (msg.t === 'ping') {
      if (Number.isFinite(msg.rtt)) me.rtt = Math.min(9999, Math.max(0, Math.round(msg.rtt)));
      return send(ws, { t: 'pong', c: msg.c });
    }
    if (msg.t === 'name') { me.name = cleanName(msg.name); lobby(room); }
    else if (msg.t === 'addAi' && slot === hostOf(room) && room.state === 'lobby' && room.players.length < 3) {
      room.players.push({ token: '', name: `AI ${room.players.filter(p => p.ai).length + 1}`, ws: null, ai: true });
      lobby(room);
    } else if (msg.t === 'kick' && slot === hostOf(room) && room.state === 'lobby' && room.players[msg.slot]?.ai) {
      room.players.splice(msg.slot, 1);
      lobby(room);
    } else if (msg.t === 'map' && slot === hostOf(room) && room.state !== 'play' && typeof msg.name === 'string' && (await listMaps()).includes(msg.name)) {
      room.mapName = msg.name; lobby(room);
    } else if (msg.t === 'start' && slot === hostOf(room) && room.state !== 'play') {
      room.state = 'play'; room.game = null; // claim it before the await so a double-click can't start twice
      room.map = await loadMap(room.mapName);
      room.game = createGame(room.map, room.players.map(p => p.name));
      lobby(room);
      room.players.forEach((_, i) => sendStart(room, i));
    } else if (room.state === 'play' && room.game) command(room.game, slot, msg);
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
    if (room.state !== 'play' || !room.game) continue; // game may still be loading its map
    const g = room.game;
    room.players.forEach((p, i) => (g.players[i].away = !p.ws && !p.ai));
    step(g);
    // AIs think every 2s, staggered so they don't all act on the same tick
    room.players.forEach((p, i) => p.ai && (g.tick + i * 13) % 40 === 0 && think(g, i));
    if (g.tick % 2 === 0 || g.winner !== null) {
      const shots = g.shots, cells = g.newCells; g.shots = []; g.newCells = [];
      const online = room.players.map(p => !!p.ws || !!p.ai), ping = room.players.map(p => (p.ai ? -1 : p.rtt ?? null));
      room.players.forEach((p, i) => send(p.ws, { ...snapshotFor(g, i, shots, cells), online, ping }));
    }
    if (g.winner !== null) { room.state = 'over'; lobby(room); }
  }
}, TICK * 1000);

server.listen(PORT, HOST, () => console.log(`ww2-rts on http://${HOST}:${PORT}`));
