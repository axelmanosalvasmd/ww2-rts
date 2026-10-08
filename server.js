// One process: serves the client and runs game rooms over WebSocket.
import http from 'node:http';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { execFile } from 'node:child_process';
import { join, normalize, extname } from 'node:path';
import { WebSocketServer } from 'ws';
import { createGame, step, command, snapshotFor, snapshotCache, unitDelta, terrainFor, fogFor, validateMap, spawnsFor, worldMapFor, TICK, MAX_PLAYERS, FACTION_COUNT } from './shared/sim.js';
import { generateWorldMap } from './shared/world-conquest.js';
import { mapForClient } from './shared/world-layers.js';
import { WEATHER_CHOICES, weatherRow } from './shared/weather.js';
import { observe, resetAI, aiMemories, restoreAIMemories, AI_LEVEL_NAMES } from './shared/ai.js';
import { SAVES_DIR, snapshotState, writeSave, listSaves, readSave, validSaveId } from './server/saves.js';
import { aiTick } from './shared/ai-schedule.js';
import { resetCommander } from './shared/ai-human.js';
import { mapPing } from './server/map-pings.js';
import { allowDeny } from './shared/command-feedback.js';
import { storyResult } from './shared/story.js';
import { createTickMeter, recordTick, tickStats } from './tickmeter.js';
import { createDiag, cleanClient } from './server/diag.js';

const PORT = +(process.env.PORT || 3000), HOST = process.env.HOST || '127.0.0.1';
const diag = process.env.WW2_DIAG === '1' ? createDiag({ dir: join(import.meta.dirname, 'logs') }) : null;
const MAX_ROOMS = Math.max(1, Math.min(256, Math.floor(Number(process.env.MAX_ROOMS) || 32)));
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
const TUTORIAL_SPAWNS = JSON.parse(readFileSync(join(ROOT, 'maps/tutorial.json'), 'utf8')).spawns;
const MAPS = join(ROOT, 'maps'), MAP_NAME = /^[a-z0-9-]{1,32}$/;
// Map files on disk for the lobby and match starts. Tests swap list and read to hold a load or serve a fixture map.
export const mapFiles = { list: () => readdir(MAPS), read: (name) => readFile(join(MAPS, name + '.json'), 'utf8') };
const listMaps = async () => (await mapFiles.list()).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).filter(n => MAP_NAME.test(n)).sort();
async function loadMap(name, strict = false) {
  try {
    const m = JSON.parse(await mapFiles.read(name)), error = validateMap(m);
    if (error) throw new Error(error);
    return m;
  } catch (error) {
    if (strict) throw error;
    return MAP;
  }
}
// Horde runs on maps with defender spawns. The list is read once, and again after a map is saved (or a test swaps the reader).
let hordeList = null, hordeRead = null;
const hordeMaps = async () => (hordeRead === mapFiles.read && hordeList) || (hordeRead = mapFiles.read, hordeList = (await Promise.all((await listMaps()).map(async n => [n, await loadMap(n)]))).filter(([, m]) => m.defend?.length).map(([n]) => n));
// Horde records: the best wave per map, team size and army size, kept in one JSON file. Tests swap read and write.
const RECORDS = join(ROOT, 'horde-records.json');
export const recordFile = { read: () => readFileSync(RECORDS, 'utf8'), write: (json) => writeFileSync(RECORDS, json) };
let records = null;
const recordKey = (room) => `${room.mapName}|${room.players.length}|${room.army ?? 'standard'}`;
const recordOf = (room) => { if (!records) { try { records = JSON.parse(recordFile.read()); } catch { records = {}; } } return records[recordKey(room)] ?? null; };
// a finished run: its wave, the horde units killed and its length; saved when it beats the record. Returns the result's horde part.
function hordeResult(room, g) {
  const run = { wave: g.mode.wave, kills: g.story?.slice(0, g.mode.slot).reduce((a, p) => a + p.kills, 0) ?? 0, time: Math.round(g.tick * TICK), names: room.players.map(p => p.name) };
  const best = recordOf(room), record = !best || run.wave > best.wave || (run.wave === best.wave && run.time > best.time);
  if (record) { records[recordKey(room)] = run; try { recordFile.write(JSON.stringify(records, null, 1)); } catch (e) { console.error('horde records not saved:', e.message); } }
  return { ...run, record, best };
}

// Map editor saves need a password: EDIT_PASSWORD, or one generated into .edit-password on first run.
const PW_FILE = join(ROOT, '.edit-password');
if (!process.env.EDIT_PASSWORD && !existsSync(PW_FILE)) writeFileSync(PW_FILE, randomBytes(6).toString('hex'));
const EDIT_PASSWORD = process.env.EDIT_PASSWORD || readFileSync(PW_FILE, 'utf8').trim();
const sha = (v) => createHash('sha256').update(String(v)).digest();
const passwordOk = (given) => timingSafeEqual(sha(given), sha(EDIT_PASSWORD));
const MAX_MAP_BYTES = 8 * 1024 * 1024;

async function saveMap(req, res, name) {
  const json = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (!passwordOk(req.headers['x-edit-password'] || '')) return json(403, { error: 'wrong password' });
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size <= MAX_MAP_BYTES) chunks.push(c); }
  if (size > MAX_MAP_BYTES) return json(413, { error: 'map too large' });
  let map;
  try { map = JSON.parse(Buffer.concat(chunks)); } catch { return json(400, { error: 'bad JSON' }); }
  const err = validateMap(map);
  if (err) return json(400, { error: err });
  // every field validateMap checks, and nothing else
  const clean = { name: map.name, w: map.w, h: map.h, rows: map.rows, ...(map.heights && { heights: map.heights }),
    spawns: map.spawns.map(({ x, y, assault }) => ({ x, y, ...(assault && { assault }) })),
    points: map.points.map(({ id, x, y, vp, mp, kind, needs }) => ({ ...(id && { id }), x, y, vp: vp ?? 1, mp: mp ?? 1, ...(kind && { kind }), ...(needs !== undefined && { needs }) })),
    ...(map.pointSequence !== undefined && { pointSequence: map.pointSequence }),
    ...(map.worldVersion && { worldVersion: map.worldVersion }),
    ...(map.layers && { layers: { ground: [...map.layers.ground], objects: [...map.layers.objects],
      ...(map.layers.mines && { mines: [...map.layers.mines] }),
      ...Object.fromEntries(['materials', 'groundMaterials', 'objectMaterials', 'mineMaterials']
        .filter(key => map.layers[key] !== undefined)
        .map(key => [key, map.layers[key].map(({ c, material }) => ({ c, material }))])) } }),
    ...(map.structures && { structures: map.structures.map(({ id, kind, sections }) => ({ id, kind,
      sections: sections.map(({ id: sectionId, c, hp, material, anchor, supports }) =>
        ({ id: sectionId, c, hp, material, anchor, supports: [...supports] })) })) }),
    ...(map.scenario && { scenario: structuredClone(map.scenario) }),
    ...(map.defend && { defend: map.defend }), ...(map.assaultTime !== undefined && { assaultTime: map.assaultTime }),
    ...(map.naval && { naval: true }), ...(map.trenchFacing && { trenchFacing: true }),
    ...(map.buildings?.length && { buildings: map.buildings.map(({ x, y, kind }) => ({ x, y, kind })) }),
    ...(map.triggers?.length && { triggers: map.triggers.map(({ at, say, blow }) => ({ at, ...(say !== undefined && { say }), ...(blow && { blow }) })) }) };
  await writeFile(join(MAPS, name + '.json'), JSON.stringify(clean, null, 1));
  hordeList = null;
  json(200, { ok: true });
}
const STATIC = { '/client/': 'client', '/shared/': 'shared', '/vendor/': 'node_modules/three/build', '/vendor-jsm/': 'node_modules/three/examples/jsm' };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg' };

export const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/rooms' && req.method === 'GET') {
    const list = [...rooms.values()].filter(r => r.listed && r.players.some(p => !p.ai && connected(p))).map(r => ({
      code: r.code, title: r.title, mode: r.mode, map: r.mode === 'world' ? 'world' : r.mapName, state: r.state, ...(r.mode === 'world' && { worldSize: r.worldSize ?? 'huge' }),
      humans: r.players.filter(p => !p.ai && connected(p)).length, ai: r.players.filter(p => p.ai).length,
      occupied: r.players.length, capacity: seats(r), joinable: r.state === 'lobby' && r.players.length < seats(r),
    }));
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end(JSON.stringify({ rooms: list }));
  }
  // maps: list, fetch one, save one (password)
  if (url.pathname === '/maps') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await listMaps())); }
  const mm = /^\/maps\/([^/]+?)(\.json)?$/.exec(url.pathname);
  if (mm) {
    if (!MAP_NAME.test(mm[1])) { res.writeHead(400); return res.end('bad map name'); }
    if (req.method === 'POST') return saveMap(req, res, mm[1]);
    if (req.method !== 'GET') { res.writeHead(405); return res.end('method not allowed'); }
    const credential = req.headers['x-edit-password'];
    if (credential !== undefined && !passwordOk(credential)) { res.writeHead(403); return res.end('wrong password'); }
    try {
      const source = await mapFiles.read(mm[1]);
      const body = credential === undefined ? JSON.stringify(mapForClient(JSON.parse(source))) : source;
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      return res.end(body);
    }
    catch { res.writeHead(404); return res.end('no such map'); }
  }
  let file = url.pathname === '/play' || (url.pathname === '/' && url.searchParams.has('edit')) ? join(ROOT, 'client/index.html')
    : url.pathname === '/' ? join(ROOT, 'client/public-lobby.html') : null;
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
// Spectators have no seat: they watch the whole match from the first seat's side of the table, with the fog lifted.
// Their view is a projection like the AI's (shared/ai-view.js), so the real seat's terrain memory and fog stay its own.
// A room whose seats are all AIs is hosted by its first connected spectator.
const MAX_SPECTATORS = 8, EVERYTHING = { has: () => true };
const everyone = (room) => [...room.players, ...room.spectators];
const isHost = (room, p) => { const h = hostOf(room); return h >= 0 ? room.players[h] === p : room.spectators.find(connected) === p; };
// The spectators share one terrain memory on the game (logCell feeds g.watchPending), so a snapshot replays only new
// cells; a spectator's start gets a fresh memory (the defaults) and so the whole terrain.
function worldWatchGame(g, watcher) {
  const source = g.players[0], players = [...g.players];
  if (g.players[-1]) players[-1] = g.players[-1];
  const memory = watcher.worldView ??= { terrainMemory: new Map(source.terrainMemory ?? []), terrainPending: new Set(g.cellLog.keys()), worldTerrainSent: new Map(), fog: { version: 0, base: new Uint8Array(g.w * g.h) } };
  for (const index of g.cellLog.keys()) memory.terrainPending.add(index);
  players[0] = { ...source, ...memory };
  return { ...g, players, reveal: false };
}
function watchGame(g, terrainMemory = new Map(), terrainPending = new Set(g.cellLog.keys())) {
  const players = [...g.players];
  players[0] = { ...players[0], terrainMemory, terrainPending, visible: EVERYTHING };
  return { ...g, players, reveal: true, skipFog: true };
}
// What a client already holds, so a snapshot carries only what changed: unit rows (unitDelta), and the wrecks and
// resource nodes, resent only when their version moves. Seats keep their own (p.net, reset by sendStart); spectators
// share one stream (room.watchNet), sent in full again when one joins.
const LISTS = ['wrecks', 'nodes'];
function trimmed(room, net, msg, cache) {
  if (room.mode === 'world') {
    Object.assign(msg, unitDelta(net.sent, msg.units, net.full));
    for (const k of LISTS) {
      const json = JSON.stringify(msg[k] ?? null);
      if (!net.full && net[k] === json) delete msg[k];
      else net[k] = json;
    }
    net.full = false;
    return msg;
  }
  if (room.listCache !== cache) {
    room.listCache = cache;
    for (const k of LISTS) { const json = JSON.stringify(cache[k] ?? null), l = (room.lists ??= {})[k] ??= { v: 0 }; if (l.json !== json) Object.assign(l, { json, v: l.v + 1 }); }
  }
  Object.assign(msg, unitDelta(net.sent, msg.units, net.full));
  for (const k of LISTS) { if (!net.full && net[k] === room.lists[k].v) delete msg[k]; else net[k] = room.lists[k].v; }
  net.full = false;
  return msg;
}
const sendSeat = (room, i, shots, cells, cache, extra) => { const p = room.players[i]; if (connected(p)) sendSnapshot(room, p, JSON.stringify(trimmed(room, p.net ??= { sent: new Map() }, { ...snapshotFor(room.game, i, shots, cells, cache), ...extra }, cache))); };
export function watcherSnapshot(g, shots, cells, cache, extra) {
  const msg = { ...snapshotFor(g, 0, shots, cells, cache), ...extra };
  // A spectator has no seat. The projected seat supplies terrain and visible units,
  // but its private jobs, orders and authored mission messages belong to that player.
  for (const key of ['movement', 'queues', 'productionJobs', 'plans', 'orders', 'air', 'mp', 'inc', 'mun', 'fuel', 'fuelInc', 'upkeep', 'sup', 'rally', 'home', 'works', 'covers', 'logistics']) delete msg[key];
  if (msg.world) {
    msg.world = { ...msg.world };
    for (const key of ['home', 'owned', 'cap', 'recovery']) delete msg.world[key];
  }
  msg.units = msg.units.map(row => {
    if (row[2] !== 0) return row;
    const publicRow = [...row]; publicRow[11] = 0; publicRow[12] &= ~(2048 | 4096 | 8192 | 16384);
    return publicRow;
  });
  if (msg.scenario) msg.scenario = { ...msg.scenario,
    objectives: msg.scenario.objectives.filter(objective => objective.recipients === 'public') };
  msg.shots = msg.shots.filter(shot => shot.scenarioRecipients === undefined || shot.scenarioRecipients === 'public');
  return msg;
}
// one snapshot for all spectators, built and stringified once
function sendWatchers(room, shots, cells, cache, extra) {
  const watching = room.spectators.filter(connected), g = room.game;
  if (!watching.length) return;
  if (g.mode?.kind === 'world') {
    for (const s of watching) {
      const view = worldWatchGame(g, s);
      send(s.ws, trimmed(room, s.net ??= { sent: new Map() }, watcherSnapshot(view, shots, cells, cache, extra), cache));
    }
    return;
  }
  const view = watchGame(g, g.watchTerrain ??= new Map(), g.watchPending ??= new Set(g.cellLog.keys()));
  const json = JSON.stringify(trimmed(room, room.watchNet ??= { sent: new Map() }, watcherSnapshot(view, shots, cells, cache, extra), cache));
  for (const s of watching) s.ws.send(json);
}
// new players default to their own team (free-for-all) and the next faction in the cycle
// assault needs someone on the defending team and someone attacking it
const assaultReady = (room) => room.mode !== 'assault' || (room.players.some(p => p.team === room.defenderTeam) && room.players.some(p => p.team !== room.defenderTeam));
const newPlayer = (room, p) => ({ ...p, team: Array.from({ length: MAX_PLAYERS }, (_, i) => i).find(t => !room.players.some(q => q.team === t)), faction: room.players.length % 3 });
// how many players the room's map seats in the room's mode (Assault-only spawns count only in Assault)
// (Horde and Tutorial: everyone shares one HQ, and the enemy takes the last seat)
const seats = (room) => (room.mode === 'world' ? MAX_PLAYERS : room.mode === 'horde' || room.mode === 'tutorial' ? MAX_PLAYERS - 1 : spawnsFor({ spawns: room.mapSpawns }, room.mode).length);

async function lobby(room) {
  const maps = await listMaps(), horde = room.mode === 'horde' ? await hordeMaps() : undefined;
  const saves = listSaves(saves_dir(), room.code).map(s => ({ id: s.id, kind: s.kind, savedAt: s.savedAt, mode: s.mode, minutes: s.minutes, names: s.names, world: s.world }));
  everyone(room).forEach((p) => { const i = room.players.indexOf(p); send(p.ws, {
    spectator: i < 0, amHost: isHost(room, p), spectators: room.spectators.map(s => s.name),
    listed: !!room.listed, saves,
    hordeMaps: horde, hordeBest: room.mode === 'horde' ? recordOf(room) : null,
    t: 'lobby', code: room.code, state: room.state, you: i, host: hostOf(room), maps, mapName: room.mode === 'world' ? 'world' : room.mapName, spawns: seats(room), publicUrl: PUBLIC_URL,
    mode: room.mode, worldSize: room.worldSize ?? 'huge', defenderTeam: room.defenderTeam, army: room.army ?? 'standard', weather: room.weather ?? 'map',
    // a finished match's result carries this player's own outcome (you); a match the host ended has none
    result: room.result ? { ...room.result, you: room.result.story && i >= 0 ? p.lastMatch ?? null : null } : null,
    players: room.players.map(q => ({ name: q.name, connected: connected(q) || !!q.ai, ai: !!q.ai, team: q.team, faction: q.faction, level: q.ai ? q.level ?? 'normal' : null })),
  }); });
}

export function logisticsEnabledFor(mode, map) {
  if (map.scenario) return map.scenario.logistics === true;
  return ['conquest', 'classic', 'annihilation', 'world'].includes(mode);
}

// (re)start a match with the room's settings; everyone gets the new game
async function startMatch(room) {
  const starting = room.starting = {};
  const previous = { state: room.state, game: room.game };
  room.state = 'play'; room.game = null; // claim it before the await so a double-click can't start twice
  let map;
  try { map = room.mode === 'world' ? generateWorldMap({ size: room.worldSize ?? 'huge', seed: randomBytes(4).readUInt32LE(), players: room.players.length, teams: room.players.map(p => p.team) }) : await loadMap(room.mapName, true); }
  catch {
    if (room.starting !== starting || room.state !== 'play') return;
    Object.assign(room, previous); room.starting = null;
    for (const p of room.players) send(p.ws, { t: 'deny', cmd: 'start', reason: 'scenario' });
    await lobby(room); return;
  }
  if (room.starting !== starting || room.state !== 'play') return;
  if (room.mode === 'horde' && !map.defend?.length) {
    Object.assign(room, previous);
    for (const p of room.players) if (!connected(p)) autoPause(room, p);
    lobby(room); return;
  }
  let game;
  try {
    game = createGame(map, room.players.map(p => p.name), true, room.players.map(p => p.team), room.players.map(p => p.faction), { mode: room.mode, worldSize: room.worldSize ?? 'huge', defenderTeam: room.defenderTeam, army: room.army,
      weather: room.weather ?? 'map', mapKey: room.mapName, weatherSeed: Math.floor(Math.random() * 2 ** 31), logistics: room.logistics !== false && logisticsEnabledFor(room.mode, map), tech: room.tech !== false });
  } catch {
    Object.assign(room, previous);
    room.starting = null;
    for (const p of room.players) send(p.ws, { t: 'deny', cmd: 'start', reason: 'scenario' });
    await lobby(room);
    return;
  }
  await beginMatch(room, map, game);
}

// a new or loaded match takes the room: everyone gets the lobby, then its start
async function beginMatch(room, map, game, paused) {
  resumeRoom(room);
  room.autoPaused = new Set(); room.matchId = (room.matchId ?? 0) + 1; // a new match: nobody has used their auto-pause yet
  room.result = null;
  room.snapEvery = 2; room.tickMeter = createTickMeter({ now: Date.now() });
  room.map = map;
  room.game = game;
  room.savedTick = game.tick;
  const startView = snapshotCache(room.game), startSeats = [...room.players.keys()].filter(i => room.players[i].ai);
  if (room.game.mode?.kind === 'horde') startSeats.push(room.game.mode.slot); // the horde plays by the same view rules
  room.aiViews = [];
  for (const i of startSeats) room.aiViews[i] = observe(room.game, i, startView);
  // lobby() reads the map list first, so wait for it: everyone gets the lobby (playing, no old result) before the start
  await lobby(room);
  if (room.game !== game) return; // ended or restarted meanwhile
  if (paused) pauseRoom(room, paused, 'host'); // a loaded match waits for the host to resume it
  room.players.forEach((_, i) => sendStart(room, i));
  room.spectators.forEach(s => sendStart(room, 0, s));
}

// Saves: the host saves at any time, World Conquest saves itself every AUTOSAVE minutes of play. A loaded match puts
// each saved seat back: AIs as they were, a human seat to whoever in the room holds its token (the same browser), else
// to the next human in the room without one, else it waits offline for its owner to come back with the link.
const AUTOSAVE = 2, saves_dir = () => process.env.SAVES_DIR ?? SAVES_DIR;
const SETTINGS = ['mode', 'worldSize', 'mapName', 'mapSpawns', 'army', 'weather', 'defenderTeam', 'logistics', 'tech'];
async function saveRoom(room, kind) {
  const g = room.game;
  if (!g || room.saving) return null;
  room.saving = true;
  try {
    const seats = room.players.map(p => ({ name: p.name.replace(/ \(AI\)$/, ''), token: p.token, ai: !!p.ai, level: p.level, team: p.team, faction: p.faction }));
    const buf = snapshotState(g, { map: g.mode?.kind === 'world' ? null : room.map, seats, settings: Object.fromEntries(SETTINGS.map(k => [k, room[k]])), ai: aiMemories(g) });
    room.savedTick = g.tick;
    return await writeSave(saves_dir(), room.code, kind, buf, { mode: room.mode, minutes: Math.floor(g.tick * TICK / 60), names: seats.map(s => s.name),
      world: g.world ? { total: g.world.total, owned: [...new Set(g.players.map(p => p.team))].map(t => g.world.regions.filter(r => r.team === t).length) } : undefined });
  } catch (e) { console.error('save failed', e); return null; }
  finally { room.saving = false; }
}
async function loadRoom(room, id, host) {
  let state;
  try { state = await readSave(saves_dir(), id); } catch { return false; }
  if (room.state === 'play') return false;
  const { g, map, seats, settings, ai } = state;
  Object.assign(room, settings);
  const present = [...room.players, ...room.spectators].filter(p => !p.ai), owner = new Map(), free = (q) => ![...owner.values()].includes(q);
  seats.forEach((seat, i) => { const p = !seat.ai && present.find(q => q.token && q.token === seat.token && free(q)); if (p) owner.set(i, p); });
  seats.forEach((seat, i) => { const p = !seat.ai && !owner.has(i) && present.find(q => connected(q) && free(q)); if (p) owner.set(i, p); });
  const players = seats.map((seat, i) => seat.ai ? { token: '', name: seat.name, ws: null, ai: true, level: seat.level ?? 'normal', team: seat.team, faction: seat.faction }
    : owner.has(i) ? Object.assign(owner.get(i), { team: seat.team, faction: seat.faction }) : { token: seat.token, name: seat.name, ws: null, team: seat.team, faction: seat.faction });
  for (const p of present) clock.clearTimeout(p.cleanupTimer);
  room.spectators = present.filter(p => free(p) && connected(p));
  room.players = players;
  restoreAIMemories(g, ai);
  for (let i = 0; i < players.length; i++) if (!players[i].ai) { resetAI(g, i); resetCommander(g, i); }
  room.state = 'play';
  await beginMatch(room, map, g, host);
  return true;
}

// watcher: a spectator, who gets seat i's start without a fog mask (the client then hides nothing)
function sendStart(room, i, watcher) {
  const world = room.game.mode?.kind === 'world';
  if (watcher && world) { watcher.net = { sent: new Map(), full: true }; watcher.worldView = null; }
  else if (watcher) { if (room.watchNet) room.watchNet.full = true; }
  else room.players[i].net = { sent: new Map() };
  const g = watcher ? (world ? worldWatchGame(room.game, watcher) : watchGame(room.game)) : room.game;
  const ws = (watcher ?? room.players[i]).ws, players = world ? room.game.players.slice(0, room.players.length) : room.game.players;
  const team = room.game.players[i].team;
  send(ws, { t: 'start', matchId: room.matchId, map: world ? worldMapFor(g, i) : mapForClient(room.map), you: i,
    spawn: room.game.players[i].spawn, spawns: players.map(p => !world || p.team === team ? p.spawn : null),
    cells: terrainFor(g, i, true), fog: watcher && !world ? undefined : fogFor(g, i, true),
    names: players.map((p, k) => room.players[k]?.name ?? p.name), teams: players.map(p => p.team), factions: players.map(p => p.faction), weather: weatherRow(room.game) });
  if (room.pause) send(ws, pauseMessage(room));
}

function pauseMessage(room) {
  const p = room.pause;
  return p ? { t: 'pause', paused: true, by: p.by, reason: p.reason, left: p.until ? Math.max(0, Math.ceil((p.until - clock.now()) / 1000)) : 0 }
    : { t: 'pause', paused: false, by: '', reason: 'host', left: 0 };
}

function broadcastPause(room) {
  const msg = pauseMessage(room);
  everyone(room).forEach(p => send(p.ws, msg));
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
    const cache = snapshotCache(g);
    room.players.forEach((_, i) => sendSeat(room, i, shots, cells, cache, { online, ping }));
    sendWatchers(room, shots, cells, cache, { online, ping });
  }
  return true;
}

function handToAi(room, player) {
  Object.assign(player, { ai: true, ws: null, token: '', name: player.name + ' (AI)' });
  if (room.game) {
    const slot = room.players.indexOf(player);
    resetAI(room.game, slot); resetCommander(room.game, slot);
    (room.aiViews ??= [])[slot] = null;
  }
  if (room.pause?.reason === 'drop' && room.pause.player === player) resumeRoom(room);
  if (!everyone(room).some(connected)) room.emptySince = clock.now();
  lobby(room);
}

// the result's per-slot lists follow the seats when seats are freed or added (the report's rows stay with their player)
const SLOT_LISTS = [['teams', null], ['names', ''], ['story', null]];

function retainSeats(room, retained) {
  const removed = room.players.filter(p => !retained.includes(p));
  if (room.result?.teams && removed.length) {
    const count = room.players.length;
    const order = [...retained, ...removed].map(p => room.players.indexOf(p));
    for (const [key] of SLOT_LISTS) {
      const list = room.result[key];
      if (Array.isArray(list)) room.result[key] = [...order.map(i => list[i]), ...list.slice(count)];
    }
  }
  removed.forEach(p => clock.clearTimeout(p.cleanupTimer));
  room.players = retained;
}

function freeOfflineSeats(room) {
  retainSeats(room, room.players.filter(p => p.ai || connected(p)));
}

function addSeat(room, player) {
  if (room.result?.teams) {
    for (const [key, empty] of SLOT_LISTS) if (Array.isArray(room.result[key])) room.result[key].splice(room.players.length, 0, empty);
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

// compression cuts a late-game snapshot about threefold (11.6 KB to 3.7 KB); small messages go as they are
export const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024, perMessageDeflate: { threshold: 1024 } });
wss.on('connection', (ws, req) => {
  const code = new URL(req.url, 'http://x').searchParams.get('room') || '';
  if (!/^[a-z0-9]{3,12}$/i.test(code)) return ws.close(1008, 'bad room');
  let room = null, me = null;

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    if (!me) {
      if (msg.t !== 'hello' || typeof msg.token !== 'string' || typeof msg.name !== 'string') return;
      room = rooms.get(code);
      if (!room && rooms.size >= MAX_ROOMS) { send(ws, { t: 'full', reason: 'capacity' }); return ws.close(); }
      // the Tutorial button makes a private room that starts the tutorial as soon as its player is in
      const tutorial = !room && msg.listing?.tutorial === true;
      if (!room) rooms.set(code, room = { code, listed: msg.listing?.public === true && !tutorial, title: (typeof msg.listing?.title === 'string' ? msg.listing.title : 'Open skirmish').replace(/[<>&"'\x00-\x1f]/g, '').trim().slice(0, 48) || 'Open skirmish', players: [], spectators: [], state: 'lobby', game: null, mode: tutorial ? 'tutorial' : 'conquest', defenderTeam: 0, matchId: 0, mapName: tutorial ? 'tutorial' : 'default', mapSpawns: tutorial ? TUTORIAL_SPAWNS : MAP.spawns });
      const token = String(msg.token || '').slice(0, 40), name = cleanName(msg.name);
      me = everyone(room).find(p => p.token === token && token);
      if (me) {
        const old = me.ws;
        clock.clearTimeout(me.cleanupTimer);
        me.ws = ws; me.name = name;
        if (room.game && room.players.includes(me) && !me.ai) { resetAI(room.game, room.players.indexOf(me)); resetCommander(room.game, room.players.indexOf(me)); }
        if (old && old !== ws) { send(old, { t: 'replaced' }); old.close(); }
      }
      else if (room.state === 'lobby' && room.players.length < MAX_PLAYERS && (!room.listed || room.players.length < seats(room)) && msg.spectate !== true) addSeat(room, me = newPlayer(room, { token, name, ws }));
      else if (room.spectators.length < MAX_SPECTATORS) room.spectators.push(me = { token, name, ws }); // no seat to take, or asked to watch
      else { send(ws, { t: 'full', reason: room.state === 'play' ? 'started' : 'seats' }); return ws.close(); }
      room.emptySince = null;
      lobby(room);
      if (room.state !== 'lobby' && room.game) room.players.includes(me) ? sendStart(room, room.players.indexOf(me)) : sendStart(room, 0, me);
      if (room.pause?.reason === 'drop' && room.pause.player === me) resumeRoom(room);
      if (tutorial && room.players[0] === me) await startMatch(room);
      return;
    }
    const slot = room.players.indexOf(me), seated = slot >= 0, host = isHost(room, me);
    if (me.ws !== ws || (!seated && !room.spectators.includes(me))) return; // a replaced socket may still be open for a moment; a freed seat has no slot
    if (msg.t === 'ping') {
      if ('x' in msg || 'z' in msg) return mapPing(room, me, slot, msg, send);
      if (Number.isFinite(msg.rtt)) me.rtt = Math.min(9999, Math.max(0, Math.round(msg.rtt)));
      if (diag) { me.diagAt = Date.now(); me.diagClient = cleanClient(msg.d); }
      // srv, for the stats overlay (client/stats.js): the slowest 5% of recent ticks that sent a snapshot in ms (the
      // number the tick meter holds to its 40 ms budget) and the ticks between snapshots
      const meter = room.state === 'play' && room.tickMeter;
      return send(ws, { t: 'pong', c: msg.c, ...(meter && { srv: [Math.round(tickStats(meter).snapshotTick.p95 * 10) / 10, room.snapEvery] }) });
    }
    if (msg.t === 'name' && typeof msg.name === 'string') { me.name = cleanName(msg.name); lobby(room); }
    else if (msg.t === 'addAi' && host && room.state === 'lobby' && room.players.length < MAX_PLAYERS && (!room.listed || room.players.length < seats(room))) {
      addSeat(room, newPlayer(room, { token: '', name: `AI ${room.players.filter(p => p.ai).length + 1}`, ws: null, ai: true, level: 'normal' }));
      lobby(room);
    } else if (msg.t === 'level' && host && room.state === 'lobby' && Number.isInteger(msg.slot) && room.players[msg.slot]?.ai && AI_LEVEL_NAMES.includes(msg.v)) {
      room.players[msg.slot].level = msg.v; lobby(room);
    } else if (msg.t === 'kick' && host && room.state === 'lobby' && Number.isInteger(msg.slot) && msg.slot >= 0 && room.players[msg.slot] && (room.players[msg.slot].ai || !connected(room.players[msg.slot]))) {
      retainSeats(room, room.players.filter((_, i) => i !== msg.slot));
      lobby(room);
    } else if (msg.t === 'handAi' && host && room.state === 'play' && Number.isInteger(msg.slot) && room.players[msg.slot] && !room.players[msg.slot].ai && !connected(room.players[msg.slot])) {
      handToAi(room, room.players[msg.slot]);
    } else if (msg.t === 'map' && host && room.state !== 'play' && typeof msg.name === 'string' && (await listMaps()).includes(msg.name)) {
      const map = await loadMap(msg.name);
      if (room.state === 'play' || me.ws !== ws || !isHost(room, me)) return;
      if (room.mode === 'horde' && !map.defend?.length) return; // Horde needs defender spawns
      if (room.mode === 'tutorial') return; // the tutorial is scripted for its own map
      room.mapName = msg.name; room.mapSpawns = map.spawns; lobby(room);
    } else if ((msg.t === 'team' || msg.t === 'faction') && room.state !== 'play' && Number.isInteger(msg.slot) && msg.slot >= 0 && Number.isInteger(msg.v) && msg.v >= 0 && msg.v < (msg.t === 'team' ? MAX_PLAYERS : FACTION_COUNT)) {
      // you pick your own faction; the host sets teams, and the AIs' factions
      const p = room.players[msg.slot];
      if (p && (host ? msg.t === 'team' || p.ai || p === me : msg.t === 'faction' && p === me)) { p[msg.t] = msg.v; lobby(room); }
    } else if (msg.t === 'mode' && host && room.state !== 'play' && ['conquest', 'assault', 'annihilation', 'classic', 'horde', 'tutorial', 'world'].includes(msg.v)) {
      const selection = room.modeRequest = {};
      if (msg.v === 'tutorial') Object.assign(room, { mapName: 'tutorial', mapSpawns: TUTORIAL_SPAWNS });
      if (msg.v === 'horde') {
        // Horde: a map with defender spawns (the first one, if the current map has none), and never Endless
        const ok = await hordeMaps(), name = ok.includes(room.mapName) ? room.mapName : ok[0];
        if (!name || room.state === 'play' || me.ws !== ws || !isHost(room, me) || room.modeRequest !== selection) return;
        const map = name !== room.mapName ? await loadMap(name) : null;
        if (room.state === 'play' || me.ws !== ws || !isHost(room, me) || room.modeRequest !== selection) return;
        if (map) { room.mapName = name; room.mapSpawns = map.spawns; }
        if (room.army === 'endless') room.army = 'standard';
      }
      room.mode = msg.v; lobby(room);
    } else if (msg.t === 'worldSize' && host && room.state !== 'play' && ['huge', 'massive'].includes(msg.v ?? msg.size)) {
      room.worldSize = msg.v ?? msg.size; lobby(room);
    } else if (msg.t === 'army' && host && room.state !== 'play' && ['standard', 'large', 'massive', 'endless'].includes(msg.v) && !(room.mode === 'horde' && msg.v === 'endless')) {
      room.army = msg.v; lobby(room);
    } else if (msg.t === 'weather' && host && room.state !== 'play' && WEATHER_CHOICES.includes(msg.v)) {
      room.weather = msg.v; lobby(room);
    } else if (msg.t === 'defender' && host && room.state !== 'play' && Number.isInteger(msg.v) && msg.v >= 0 && msg.v < MAX_PLAYERS) {
      room.defenderTeam = msg.v; lobby(room);
    } else if (msg.t === 'start' && host && room.state !== 'play' && room.players.length > 0 && room.players.length <= seats(room) && assaultReady(room)) {
      await startMatch(room);
    } else if (msg.t === 'resync' && room.state === 'play') {
      // the client's unit rows drifted from what we sent (it checks held): the next snapshot replaces them all
      const net = seated || room.mode === 'world' ? me.net : room.watchNet;
      if (net) net.full = true;
    } else if (msg.t === 'restart' && host && room.state === 'play' && room.game) {
      await startMatch(room); // same map, mode and teams, from scratch
    } else if (msg.t === 'save' && host && room.state === 'play' && room.game) {
      const id = await saveRoom(room, 'manual');
      send(ws, id ? { t: 'saved', id } : { t: 'deny', cmd: 'save', reason: 'save' });
      if (id) lobby(room);
    } else if (msg.t === 'loadSave' && host && room.state === 'lobby' && validSaveId(msg.id) && msg.id.startsWith(room.code + '-')) {
      if (!await loadRoom(room, msg.id, me)) { send(ws, { t: 'deny', cmd: 'loadSave', reason: 'save' }); lobby(room); }
    } else if (msg.t === 'end' && host && room.state === 'play') {
      finishMatch(room, { ended: true });
    } else if (msg.t === 'nextwave' && host && room.state === 'play' && room.game?.mode?.kind === 'horde' && !room.pause) {
      if (!room.game.mode.active) room.game.mode.timeLeft = 0; // the host cuts the break short
    } else if (msg.t === 'pause' && host && room.state === 'play') {
      pauseRoom(room, me, 'host');
    } else if (msg.t === 'resume' && host && room.state === 'play') {
      resumeRoom(room);
    } else if (msg.t === 'spectate' && seated && room.state === 'lobby' && room.spectators.length < MAX_SPECTATORS) {
      retainSeats(room, room.players.filter(p => p !== me)); room.spectators.push(me); lobby(room); // give up the seat and watch
    } else if (msg.t === 'sit' && !seated && room.state === 'lobby' && room.players.length < MAX_PLAYERS && (!room.listed || room.players.length < seats(room))) {
      room.spectators = room.spectators.filter(s => s !== me); addSeat(room, Object.assign(me, newPlayer(room, me))); lobby(room);
    } else if (msg.t === 'leave' && seated && room.state === 'play' && !me.ai) {
      // an AI takes over your army so the match goes on for the others; you can join the lobby again afterwards
      handToAi(room, me);
      send(ws, { t: 'left' }); ws.close();
    } else if (seated && room.state === 'play' && room.game && !room.pause) {
      const reason = command(room.game, slot, msg);
      if (reason && allowDeny(me, clock.now())) send(ws, { t: 'deny', cmd: msg.t, reason });
    }
  });

  ws.on('close', () => {
    if (!me || me.ws !== ws) return;
    me.ws = null;
    const watching = room.spectators.includes(me);
    if (watching) room.spectators = room.spectators.filter(s => s !== me); // a spectator holds nothing to come back to
    if (!everyone(room).some(connected)) room.emptySince = clock.now();
    if (watching) return lobby(room);
    autoPause(room, me);
    lobby(room);
    // in the lobby, free the slot unless they come back (e.g. a page refresh) within 10s
    scheduleSeatCleanup(room, me);
  });
});

// The end of a match. Once the sim has a winner the room stays in play for 6 s: the sim runs at half speed (a step every
// other tick, a snapshot after each), orders are refused (command() ignores them once there is a winner), the AIs stop
// thinking and the fog is lifted (snapshotFor shows everything while g.reveal is set). Then back to the lobby (map, mode
// and teams can change; newcomers can join) with the result: why and where it ended, the story, and each player's own
// outcome in p.lastMatch (lobby() sends it as result.you). True while it has the room: the tick loop skips the rest.
const HOLD_TICKS = Math.round(6 / TICK);
function holdEnding(room) {
  const g = room.game;
  if (g.winner === null) return false;
  g.held = (g.held ?? 0) + 1;
  if (g.held % 2 === 0) {
    step(g);
    const shots = g.shots, cells = g.newCells; g.shots = []; g.newCells = [];
    const online = room.players.map(p => connected(p) || !!p.ai), ping = room.players.map(p => (p.ai ? -1 : p.rtt ?? null));
    const cache = snapshotCache(g);
    room.players.forEach((_, i) => sendSeat(room, i, shots, cells, cache, { online, ping }));
    sendWatchers(room, shots, cells, cache, { online, ping });
  }
  if (g.held < HOLD_TICKS) return true;
  room.players.forEach((p, i) => (p.lastMatch = { outcome: g.winner === -1 ? 'draw' : g.winner === g.players[i].team ? 'victory' : 'defeat', team: g.players[i].team }));
  finishMatch(room, { winner: g.winner, teams: g.players.map(p => p.team), names: g.players.map((p, k) => room.players[k]?.name ?? p.name), ...storyResult(g), ...(g.mode?.kind === 'horde' && { horde: hordeResult(room, g) }) });
  return true;
}

// One running tick: step, AI and snapshots. Timing and interval control stay together so every room measures the
// same work.
function timedRoomTick(room) {
  const g = room.game, meter = room.tickMeter ??= createTickMeter({ now: Date.now() });
  room.snapEvery ??= 2;
  const began = process.hrtime.bigint();
  const stepAt = process.hrtime.bigint();
  step(g);
  const thinkAt = process.hrtime.bigint();
  const sent = g.tick % room.snapEvery === 0 || g.winner !== null;
  // The seats the server plays: the room's AIs and, in Horde, the horde itself (nobody's seat, but it gets the same view).
  const seats = [...room.players.keys()].filter(i => room.players[i].ai);
  if (g.mode?.kind === 'horde') seats.push(g.mode.slot);
  // The AI schedule lives in shared/ai-schedule.js, so the balance and bench tools play the same AI as this room:
  // seat AIs are human-like commanders (shared/ai-human.js), the Horde seat keeps the scripted planner.
  room.aiViews ??= [];
  const built = aiTick(g, seats.map(slot => ({ slot, level: room.players[slot]?.level })), room.aiViews, { sent }); // human snapshots reuse its cache
  const snapshotAt = process.hrtime.bigint();
  let snapshotBuild = 0, snapshotStringify = 0;
  if (sent) {
    const shots = g.shots, cells = g.newCells; g.shots = []; g.newCells = [];
    const recipients = [];
    room.players.forEach((p, i) => { if (p.ws?.readyState === 1 && !backedUp(p)) recipients.push(i); });
    const watched = !!room.spectators?.some(s => s.ws?.readyState === 1);
    if (recipients.length || watched) {
      const online = room.players.map(p => !!p.ws || !!p.ai), ping = room.players.map(p => (p.ai ? -1 : p.rtt ?? null));
      const cacheAt = process.hrtime.bigint(), cache = built ?? snapshotCache(g);
      snapshotBuild += Number(process.hrtime.bigint() - cacheAt) / 1e6;
      for (const i of recipients) {
        const p = room.players[i], buildAt = process.hrtime.bigint(), msg = trimmed(room, p.net ??= { sent: new Map() }, { ...snapshotFor(g, i, shots, cells, cache), online, ping }, cache);
        snapshotBuild += Number(process.hrtime.bigint() - buildAt) / 1e6;
        const stringifyAt = process.hrtime.bigint(), json = JSON.stringify(msg);
        snapshotStringify += Number(process.hrtime.bigint() - stringifyAt) / 1e6;
        sendSnapshot(room, p, json);
      }
      if (watched) sendWatchers(room, shots, cells, cache, { online, ping });
    }
  }
  const ended = process.hrtime.bigint(), now = Date.now();
  room.snapEvery = recordTick(meter, { tick: Number(ended - began) / 1e6, step: Number(thinkAt - stepAt) / 1e6,
    think: Number(snapshotAt - thinkAt) / 1e6, snapshot: Number(ended - snapshotAt) / 1e6, snapshotBuild, snapshotStringify, sent }, now);
  if (process.env.WW2_TICKLOG === '1' && now >= meter.nextLog) {
    meter.nextLog = now + 30_000;
    const stats = tickStats(meter), costs = Object.entries(stats).map(([phase, v]) => `${phase} ${v.p50.toFixed(2)}/${v.p95.toFixed(2)} ms`).join(', ');
    console.log(`[tick ${room.code}] p50/p95: ${costs}; snapshots every ${room.snapEvery} ticks`);
  }
}

// A socket still writing 256 KB of old snapshots skips new ones: piling more on only queued its pongs behind megabytes
// (40 s pings in an overloaded match). ws.send's callback runs once a frame is written, so `inflight` counts the deflate
// queue too. When it clears the seat gets one fresh snapshot, its deltas counted from the last one sent.
function backedUp(p) { return (p.ws.inflight ?? 0) >= 256 * 1024 && (p.ws.owed = true); }
function sendSnapshot(room, p, json) {
  const ws = p.ws;
  ws.inflight = (ws.inflight ?? 0) + json.length;
  ws.send(json, () => {
    ws.inflight -= json.length;
    if (!ws.owed || ws.inflight >= 256 * 1024 || p.ws !== ws) return;
    ws.owed = false;
    const i = room.players.indexOf(p);
    if (i >= 0 && room.state === 'play' && room.game) sendSeat(room, i, [], [], snapshotCache(room.game), { online: room.players.map(q => !!q.ws || !!q.ai), ping: room.players.map(q => (q.ai ? -1 : q.rtt ?? null)) });
  });
}

export function tickRooms() {
  for (const room of rooms.values()) {
    if (room.emptySince != null && clock.now() - room.emptySince > 60_000) { rooms.delete(room.code); continue; }
    if (room.state !== 'play' || !room.game) continue; // game may still be loading its map
    if (pauseTick(room)) continue;
    const g = room.game;
    room.players.forEach((p, i) => (g.players[i].away = !p.ws && !p.ai));
    if (holdEnding(room)) continue;
    timedRoomTick(room);
    if (g.mode?.kind === 'world' && g.winner === null && g.tick - (room.savedTick ?? 0) >= AUTOSAVE * 60 / TICK) saveRoom(room, 'auto');
    diag?.tick(room, () => tickStats(room.tickMeter));
  }
}
// Windows timers fire in ~15.6 ms steps, so setInterval(50) really ran every ~62 ms (16 ticks/s, the game at 80%
// speed). Poll often and run the ticks the clock says are due. More than 4 behind (a stall): drop the backlog.
const TICK_NS = BigInt(Math.round(TICK * 1e9));
let dueAt = process.hrtime.bigint();
export const loop = setInterval(() => {
  const now = process.hrtime.bigint();
  if (dueAt <= now) diag?.lateBy(Number(now - dueAt) / 1e6);
  for (let n = 0; dueAt <= now && n < 4; n++) { tickRooms(); dueAt += TICK_NS; }
  if (dueAt <= now) dueAt = now + TICK_NS;
}, 10);

server.listen(PORT, HOST, () => console.log(`ww2-rts on http://${HOST}:${PORT}`));
