// One process: serves the client and runs game rooms over WebSocket.
import http from 'node:http';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { execFile } from 'node:child_process';
import { join, normalize, extname } from 'node:path';
import { WebSocketServer } from 'ws';
import { createGame, step, command, snapshotFor, validateMap, spawnsFor, TICK, MAX_PLAYERS } from './shared/sim.js';
import { think } from './shared/ai.js';

const PORT = +(process.env.PORT || 3000), HOST = process.env.HOST || '127.0.0.1';
export const clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (timer) => clearTimeout(timer),
};
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
    points: map.points.map(({ x, y, vp, mp }) => ({ x, y, vp: vp ?? 1, mp: mp ?? 1 })), ...(map.defend && { defend: map.defend }) };
  await writeFile(join(MAPS, name + '.json'), JSON.stringify(clean, null, 1));
  json(200, { ok: true });
}
const STATIC = { '/client/': 'client', '/shared/': 'shared', '/vendor/': 'node_modules/three/build' };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg' };

export const server = http.createServer(async (req, res) => {
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

// room: { code, players: [{ token, name, ws, ai, team, faction }], state: 'lobby'|'play', game, map, mapName, spawns, emptySince,
//   result: how the last match ended, shown in the lobby until the next one starts }
// A player's slot in the game is their index in players; connected humans get host priority.
export const rooms = new Map();
const cleanName = (n) => String(n || '').replace(/[<>&"']/g, '').trim().slice(0, 16) || 'Soldier';
const send = (ws, msg) => ws?.readyState === 1 && ws.send(JSON.stringify(msg));
const connected = (p) => p.ws?.readyState === 1;
const hostOf = (room) => {
  const online = room.players.findIndex(p => !p.ai && connected(p));
  return online >= 0 ? online : room.players.findIndex(p => !p.ai);
};
// new players default to their own team (free-for-all) and the next faction in the cycle
// assault needs someone on the defending team and someone attacking it
const assaultReady = (room) => room.mode !== 'assault' || (room.players.some(p => p.team === room.defenderTeam) && room.players.some(p => p.team !== room.defenderTeam));
const newPlayer = (room, p) => ({ ...p, team: Array.from({ length: MAX_PLAYERS }, (_, i) => i).find(t => !room.players.some(q => q.team === t)), faction: room.players.length % 3 });
// how many players the room's map seats in the room's mode (Assault-only spawns count only in Assault)
const setMap = async (room, name) => { room.mapName = name; room.mapSpawns = (await loadMap(name)).spawns; };
const seats = (room) => spawnsFor({ spawns: room.mapSpawns }, room.mode).length;

async function lobby(room) {
  const maps = await listMaps();
  room.players.forEach((p, i) => send(p.ws, {
    t: 'lobby', code: room.code, state: room.state, you: i, host: hostOf(room), maps, mapName: room.mapName, spawns: seats(room), publicUrl: PUBLIC_URL,
    mode: room.mode, defenderTeam: room.defenderTeam, army: room.army ?? 'standard', result: room.result ?? null,
    players: room.players.map(q => ({ name: q.name, connected: connected(q) || !!q.ai, ai: !!q.ai, team: q.team, faction: q.faction })),
  }));
}

// (re)start a match with the room's settings; everyone gets the new game
async function startMatch(room) {
  resumeRoom(room);
  room.autoPaused = new Set(); room.matchId = (room.matchId ?? 0) + 1; // a new match: nobody has used their auto-pause yet
  room.state = 'play'; room.game = null; room.result = null; // claim it before the await so a double-click can't start twice
  room.map = await loadMap(room.mapName);
  room.game = createGame(room.map, room.players.map(p => p.name), true, room.players.map(p => p.team), room.players.map(p => p.faction), { mode: room.mode, defenderTeam: room.defenderTeam, army: room.army });
  lobby(room);
  room.players.forEach((_, i) => sendStart(room, i));
}

function sendStart(room, i) {
  send(room.players[i].ws, { t: 'start', matchId: room.matchId, map: room.map, you: i, spawn: room.game.players[i].spawn, spawns: room.game.players.map(p => p.spawn), cells: room.game.cellLog, names: room.players.map(p => p.name), teams: room.game.players.map(p => p.team), factions: room.game.players.map(p => p.faction) });
  if (room.pause) send(room.players[i].ws, pauseMessage(room));
}

function pauseMessage(room) {
  const p = room.pause;
  return p ? { t: 'pause', paused: true, by: p.by, reason: p.reason, left: p.until ? Math.max(0, Math.ceil((p.until - clock.now()) / 1000)) : 0 }
    : { t: 'pause', paused: false, by: '', reason: 'host', left: 0 };
}

function broadcastPause(room) {
  const msg = pauseMessage(room);
  room.players.forEach(p => send(p.ws, msg));
}

function pauseRoom(room, player, reason) {
  if (room.state !== 'play' || !room.game || room.pause) return;
  room.pause = { reason, by: player.name, player, until: reason === 'drop' ? clock.now() + 30_000 : 0 };
  room.pauseSentAt = clock.now();
  broadcastPause(room);
}

function resumeRoom(room) {
  room.pause = null;
  broadcastPause(room);
}

// a human dropped mid-match: wait for them up to 30 s, once per player per match
function autoPause(room, player) {
  if (room.state !== 'play' || !room.game || player.ai || room.pause || room.autoPaused?.has(player)) return;
  (room.autoPaused ??= new Set()).add(player);
  pauseRoom(room, player, 'drop');
}

function pauseTick(room) {
  if (!room.pause) return false;
  if (room.pause.reason === 'drop' && (connected(room.pause.player) || room.pause.player.ai || clock.now() >= room.pause.until)) {
    resumeRoom(room); return false;
  }
  if (clock.now() - room.pauseSentAt >= 1000) {
    room.pauseSentAt = clock.now(); broadcastPause(room);
    const g = room.game;
    const shots = g.shots, cells = g.newCells; g.shots = []; g.newCells = [];
    const online = room.players.map(p => connected(p) || !!p.ai), ping = room.players.map(p => (p.ai ? -1 : p.rtt ?? null));
    room.players.forEach((p, i) => connected(p) && send(p.ws, { ...snapshotFor(g, i, shots, cells), online, ping }));
  }
  return true;
}

function handToAi(room, player) {
  Object.assign(player, { ai: true, ws: null, token: '', name: player.name + ' (AI)' });
  if (room.pause?.reason === 'drop' && room.pause.player === player) resumeRoom(room);
  if (!room.players.some(connected)) room.emptySince = clock.now();
  lobby(room);
}

function retainSeats(room, retained) {
  const removed = room.players.filter(p => !retained.includes(p));
  if (room.result?.teams && removed.length) {
    const count = room.players.length;
    const order = [...retained, ...removed].map(p => room.players.indexOf(p));
    room.result.teams = [...order.map(i => room.result.teams[i]), ...room.result.teams.slice(count)];
    room.result.names = [...order.map(i => room.result.names[i]), ...room.result.names.slice(count)];
  }
  removed.forEach(p => clock.clearTimeout(p.cleanupTimer));
  room.players = retained;
}

function freeOfflineSeats(room) {
  retainSeats(room, room.players.filter(p => p.ai || connected(p)));
}

function addSeat(room, player) {
  if (room.result?.teams) {
    room.result.teams.splice(room.players.length, 0, null);
    room.result.names.splice(room.players.length, 0, '');
  }
  room.players.push(player);
}

function finishMatch(room, result) {
  resumeRoom(room);
  room.state = 'lobby'; room.game = null; room.result = result;
  freeOfflineSeats(room);
  lobby(room);
}

function scheduleSeatCleanup(room, player) {
  clock.clearTimeout(player.cleanupTimer);
  player.cleanupTimer = clock.setTimeout(() => {
    if (player.ws || player.ai || room.state !== 'lobby' || !room.players.includes(player)) return;
    retainSeats(room, room.players.filter(p => p !== player));
    lobby(room);
  }, 10_000);
}

export const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
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
      room = rooms.get(code);
      if (!room) { rooms.set(code, room = { code, players: [], state: 'lobby', game: null, mode: 'conquest', defenderTeam: 0, matchId: 0 }); await setMap(room, 'default'); }
      const token = String(msg.token || '').slice(0, 40), name = cleanName(msg.name);
      me = room.players.find(p => p.token === token && token);
      if (me) {
        const old = me.ws;
        clock.clearTimeout(me.cleanupTimer);
        me.ws = ws; me.name = name;
        if (old && old !== ws) { send(old, { t: 'replaced' }); old.close(); }
      }
      else if (room.state === 'lobby' && room.players.length < MAX_PLAYERS) addSeat(room, me = newPlayer(room, { token, name, ws }));
      else { send(ws, { t: 'full', reason: room.state === 'play' ? 'started' : 'seats' }); return ws.close(); }
      room.emptySince = null;
      lobby(room);
      if (room.state !== 'lobby' && room.game) sendStart(room, room.players.indexOf(me));
      if (room.pause?.reason === 'drop' && room.pause.player === me) resumeRoom(room);
      return;
    }
    if (me.ws !== ws) return; // a replaced socket may still be open for a moment
    const slot = room.players.indexOf(me);
    if (msg.t === 'ping') {
      if (Number.isFinite(msg.rtt)) me.rtt = Math.min(9999, Math.max(0, Math.round(msg.rtt)));
      return send(ws, { t: 'pong', c: msg.c });
    }
    if (msg.t === 'name') { me.name = cleanName(msg.name); lobby(room); }
    else if (msg.t === 'addAi' && slot === hostOf(room) && room.state === 'lobby' && room.players.length < MAX_PLAYERS) {
      addSeat(room, newPlayer(room, { token: '', name: `AI ${room.players.filter(p => p.ai).length + 1}`, ws: null, ai: true }));
      lobby(room);
    } else if (msg.t === 'kick' && slot === hostOf(room) && room.state === 'lobby' && Number.isInteger(msg.slot) && room.players[msg.slot] && (room.players[msg.slot].ai || !connected(room.players[msg.slot]))) {
      retainSeats(room, room.players.filter((_, i) => i !== msg.slot));
      lobby(room);
    } else if (msg.t === 'handAi' && slot === hostOf(room) && room.state === 'play' && Number.isInteger(msg.slot) && room.players[msg.slot] && !room.players[msg.slot].ai && !connected(room.players[msg.slot])) {
      handToAi(room, room.players[msg.slot]);
    } else if (msg.t === 'map' && slot === hostOf(room) && room.state !== 'play' && typeof msg.name === 'string' && (await listMaps()).includes(msg.name)) {
      await setMap(room, msg.name); lobby(room);
    } else if ((msg.t === 'team' || msg.t === 'faction') && room.state !== 'play' && Number.isInteger(msg.v) && msg.v >= 0 && msg.v < (msg.t === 'team' ? MAX_PLAYERS : 3)) {
      // you pick your own faction; the host sets teams, and the AIs' factions
      const p = room.players[msg.slot];
      if (p && (slot === hostOf(room) ? msg.t === 'team' || p.ai || p === me : msg.t === 'faction' && p === me)) { p[msg.t] = msg.v; lobby(room); }
    } else if (msg.t === 'mode' && slot === hostOf(room) && room.state !== 'play' && ['conquest', 'assault', 'annihilation', 'classic'].includes(msg.v)) {
      room.mode = msg.v; lobby(room);
    } else if (msg.t === 'army' && slot === hostOf(room) && room.state !== 'play' && ['standard', 'large', 'massive'].includes(msg.v)) {
      room.army = msg.v; lobby(room);
    } else if (msg.t === 'defender' && slot === hostOf(room) && room.state !== 'play' && Number.isInteger(msg.v) && msg.v >= 0 && msg.v < MAX_PLAYERS) {
      room.defenderTeam = msg.v; lobby(room);
    } else if (msg.t === 'start' && slot === hostOf(room) && room.state !== 'play' && room.players.length <= seats(room) && assaultReady(room)) {
      await startMatch(room);
    } else if (msg.t === 'restart' && slot === hostOf(room) && room.state === 'play' && room.game) {
      await startMatch(room); // same map, mode and teams, from scratch
    } else if (msg.t === 'end' && slot === hostOf(room) && room.state === 'play') {
      finishMatch(room, { ended: true });
    } else if (msg.t === 'pause' && slot === hostOf(room) && room.state === 'play') {
      pauseRoom(room, me, 'host');
    } else if (msg.t === 'resume' && slot === hostOf(room) && room.state === 'play') {
      resumeRoom(room);
    } else if (msg.t === 'leave' && room.state === 'play' && !me.ai) {
      // an AI takes over your army so the match goes on for the others; you can join the lobby again afterwards
      handToAi(room, me);
      send(ws, { t: 'left' }); ws.close();
    } else if (room.state === 'play' && room.game && !room.pause) command(room.game, slot, msg);
  });

  ws.on('close', () => {
    if (!me || me.ws !== ws) return;
    me.ws = null;
    if (!room.players.some(connected)) room.emptySince = clock.now();
    autoPause(room, me);
    lobby(room);
    // in the lobby, free the slot unless they come back (e.g. a page refresh) within 10s
    scheduleSeatCleanup(room, me);
  });
});

export function tickRooms() {
  for (const room of rooms.values()) {
    if (room.emptySince != null && clock.now() - room.emptySince > 60_000) { rooms.delete(room.code); continue; }
    if (room.state !== 'play' || !room.game) continue; // game may still be loading its map
    if (pauseTick(room)) continue;
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
    // match over: straight back to the lobby (map, mode and teams can change; newcomers can join), with the result
    if (g.winner !== null) finishMatch(room, { winner: g.winner, teams: g.players.map(p => p.team), names: room.players.map(p => p.name) });
  }
}
export const loop = setInterval(tickRooms, TICK * 1000);

server.listen(PORT, HOST, () => console.log(`ww2-rts on http://${HOST}:${PORT}`));
