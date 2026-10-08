// Saved matches: the whole sim (v8 structured clone, gzipped) plus the room settings and seats that started it, one
// file per save under SAVES_DIR. Saves belong to the room code they were made in; a room lists only its own.
import v8 from 'node:v8';
import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const pack = promisify(gzip), unpack = promisify(gunzip);
export const SAVES_DIR = process.env.SAVES_DIR ?? join(import.meta.dirname, '..', 'saves');
export const AUTOSAVES_KEPT = 3, SAVES_KEPT = 10;
const ID = /^[a-z0-9]{3,12}-\d{13}-(auto|manual)$/i;
export const validSaveId = (id) => typeof id === 'string' && ID.test(id);

// Everything a sim holds is plain data (Maps, Sets, typed arrays); the local defenders' player sits at players[-1],
// which is not enumerable, so it travels on its own. ai: the AI seats' memories (plain data too, or left out).
export function snapshotState(g, extra = {}) {
  const state = { g, guard: g.players[-1], ...extra };
  try { return v8.serialize(state); }
  catch { return v8.serialize({ ...state, ai: undefined }); } // an AI memory that cannot be cloned: the AI starts afresh
}
export function restoreState(buf) {
  const state = v8.deserialize(buf);
  if (state.guard) Object.defineProperty(state.g.players, -1, { value: state.guard, writable: true, configurable: true });
  return state;
}

export async function writeSave(dir, room, kind, buf, meta) {
  await mkdir(dir, { recursive: true });
  const id = `${room}-${Date.now()}-${kind}`, body = await pack(buf);
  await writeFile(join(dir, id + '.tmp'), body); await rename(join(dir, id + '.tmp'), join(dir, id + '.save'));
  await writeFile(join(dir, id + '.json'), JSON.stringify({ id, kind, savedAt: Date.now(), bytes: body.length, ...meta }));
  // keep the newest few of each kind for this room
  const mine = (await listSaves(dir, room)).filter(s => s.kind === kind);
  for (const old of mine.slice(kind === 'auto' ? AUTOSAVES_KEPT : SAVES_KEPT)) await removeSave(dir, old.id);
  return id;
}
// synchronous on purpose: the lobby lists saves on every broadcast, and an extra await there let later lobby messages
// overtake earlier ones. ponytail: a directory scan per lobby, keep a per-room index if save folders grow large.
export function listSaves(dir, room) {
  let files;
  try { files = readdirSync(dir); } catch { return []; }
  const out = [];
  for (const f of files) if (f.endsWith('.json') && f.startsWith(room + '-')) {
    try { out.push(JSON.parse(readFileSync(join(dir, f), 'utf8'))); } catch { /* half-written: skip it */ }
  }
  return out.sort((a, b) => b.savedAt - a.savedAt);
}
export async function readSave(dir, id) {
  if (!validSaveId(id)) throw new Error('bad save id');
  return restoreState(await unpack(await readFile(join(dir, id + '.save'))));
}
export async function removeSave(dir, id) {
  if (!validSaveId(id)) return;
  for (const ext of ['.save', '.json']) await unlink(join(dir, id + ext)).catch(() => {});
}
