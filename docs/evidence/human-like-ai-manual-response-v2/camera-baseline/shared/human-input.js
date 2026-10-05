// The human recorder accepts input metadata, never authoritative units or hidden state.
export const HUMAN_INPUT_SCHEMA = 'ww2-human-input-v1';
export const HUMAN_INPUT_KINDS = ['click', 'key', 'wheel'];
const commands = new Set(['recover', 'orders', 'move', 'amove', 'fireat', 'garrison', 'attack', 'stop', 'escort', 'board', 'unload', 'retreat', 'stance', 'cover', 'ability', 'autocast', 'dig', 'entrench', 'support', 'build', 'assist', 'cancelProduction', 'cancel', 'rally', 'buy']);
const finite = n => typeof n === 'number' && Number.isFinite(n);
const coordinate = n => finite(n) && Math.abs(n) <= 1e6;
const point = p => p && coordinate(p.x) && coordinate(p.z) ? { x: p.x, z: p.z } : null;
const safeRoom = value => typeof value === 'string' && /^[a-zA-Z0-9-]{1,32}$/.test(value) ? value : null;

export function cleanHumanBeat(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const camera = point(input.camera);
  if (!camera || !finite(input.camera.w) || !finite(input.camera.h) || input.camera.w <= 0 || input.camera.h <= 0 || input.camera.w > 1e6 || input.camera.h > 1e6) return null;
  return { camera: { ...camera, w: input.camera.w, h: input.camera.h }, cursor: point(input.cursor),
    selected: finite(input.selected) ? Math.min(1000, Math.max(0, Math.floor(input.selected))) : null };
}

export function humanCommandTarget(cmd) {
  const explicit = point(cmd); if (explicit) return explicit;
  const rows = cmd?.t === 'orders' && Array.isArray(cmd.commands) ? cmd.commands.flatMap(c => Array.isArray(c.orders) ? c.orders.slice(0, 1000) : []) : cmd?.orders;
  if (!Array.isArray(rows)) return null;
  const targets = rows.slice(0, 1000).flatMap(row => Array.isArray(row) ? [point({ x: row[1], z: row[2] })].filter(Boolean) : []);
  return targets.length ? { x: targets.reduce((sum, p) => sum + p.x, 0) / targets.length, z: targets.reduce((sum, p) => sum + p.z, 0) / targets.length } : null;
}

function commandSummary(cmd) {
  const result = { t: cmd.t };
  for (const key of ['unit', 'kind', 'stance', 'ability']) if (typeof cmd[key] === 'string' && /^[a-zA-Z0-9_-]{1,32}$/.test(cmd[key])) result[key] = cmd[key];
  for (const key of ['x', 'z', 'face', 'from', 'target']) if (coordinate(cmd[key])) result[key] = cmd[key];
  for (const key of ['queue', 'together']) if (typeof cmd[key] === 'boolean') result[key] = cmd[key];
  if (Array.isArray(cmd.ids)) result.ids = cmd.ids.slice(0, 1000).filter(Number.isSafeInteger);
  if (Array.isArray(cmd.orders)) result.orders = cmd.orders.slice(0, 1000).filter(row => Array.isArray(row) && Number.isSafeInteger(row[0]) && coordinate(row[1]) && coordinate(row[2])).map(row => row.slice(0, 3));
  if (cmd.t === 'orders' && Array.isArray(cmd.commands)) result.commands = cmd.commands.slice(0, 32).filter(c => c && commands.has(c.t) && c.t !== 'orders').map(commandSummary);
  return result;
}

export function createHumanInputClient({ enabled = false, send, state, every = 0.1 } = {}) {
  let on = enabled === true, elapsed = 0;
  const post = (kind, target) => {
    if (!on) return false;
    const beat = cleanHumanBeat(state?.()); if (!beat) return false;
    return send?.({ t: 'humanInput', kind, ...beat, ...(point(target) && { target: point(target) }) }) === true;
  };
  return {
    setEnabled(value) { on = value === true; elapsed = 0; },
    get enabled() { return on; },
    frame(dt) { if (!on || !finite(dt)) return; elapsed += dt; if (elapsed >= Math.max(0.1, every)) { elapsed = 0; post('beat'); } },
    input(kind, target) { return HUMAN_INPUT_KINDS.includes(kind) ? post(kind, target) : false; },
  };
}

// Disabled construction performs no filesystem work. Enabled recordings stay on this server's disk.
export async function createLocalHumanRecorder({ enabled = false, dir, maxBytes = 8 * 1024 * 1024, maxFiles = 16, maxQueued = 256, writeLine } = {}) {
  if (enabled !== true) return null;
  const bytesLimit = Math.max(1024, Math.min(64 * 1024 * 1024, maxBytes));
  const fileLimit = Math.max(1, Math.min(64, Math.floor(maxFiles)));
  const queueLimit = Math.max(1, Math.min(1024, Math.floor(maxQueued)));
  let fs, join, diskFiles = new Set();
  if (!writeLine) {
    if (typeof dir !== 'string' || !dir) throw new Error('Human recording needs a local directory');
    fs = await import('node:fs/promises'); ({ join } = await import('node:path'));
    await fs.mkdir(dir, { recursive: true });
    diskFiles = new Set((await fs.readdir(dir)).filter(name => /^human-input-[a-zA-Z0-9-]+\.jsonl$/.test(name)));
  }
  const streams = new Map();
  let tail = Promise.resolve(), queued = 0, queuedBytes = 0, dropped = 0, error = null;
  function stream(context) {
    const room = safeRoom(context?.room);
    if (!room || !Number.isSafeInteger(context.matchId) || context.matchId < 0 || !Number.isInteger(context.slot) || context.slot < 0 || context.slot > 15 || !Number.isSafeInteger(context.tick) || context.tick < 0) return null;
    const key = `${room}-${context.matchId}-${context.slot}`;
    if (!streams.has(key)) {
      if (streams.size >= fileLimit) return null;
      const file = `human-input-${key}.jsonl`;
      if (!diskFiles.has(file) && diskFiles.size >= fileLimit) return null;
      diskFiles.add(file);
      streams.set(key, { file, bytes: 0, beat: null, beatTick: -Infinity, inputs: 0, inputTick: -1 });
    }
    return { room, matchId: context.matchId, slot: context.slot, tick: context.tick, value: streams.get(key) };
  }
  function record(s, kind, more = {}) {
    if (!s || queued >= queueLimit || error) { dropped++; return false; }
    const beat = s.value.beat;
    const row = { schema: HUMAN_INPUT_SCHEMA, actor: 'human', room: s.room, matchId: s.matchId, slot: s.slot, tick: s.tick, kind,
      camera: beat?.camera ?? null, cursor: beat?.cursor ?? null, selected: beat?.selected ?? null, target: null,
      event: null, latency: null, concern: null, accepted: null,
      observed: { commands: true, physicalInputs: kind !== 'command', camera: !!beat, selection: beat?.selected !== null && beat?.selected !== undefined, reaction: false, concern: false }, ...more };
    const line = JSON.stringify(row) + '\n', bytes = new TextEncoder().encode(line).length;
    if (bytes > 64 * 1024 || queuedBytes + bytes > 256 * 1024 || s.value.bytes + bytes > bytesLimit) { dropped++; return false; }
    s.value.bytes += bytes; queued++; queuedBytes += bytes;
    tail = tail.then(async () => {
      try {
        if (writeLine) await writeLine(s.value.file, line);
        else {
          // A prior process may already have filled this file. Never append past the cap.
          const path = join(dir, s.value.file), stat = await fs.stat(path).catch(e => { if (e.code === 'ENOENT') return { size: 0 }; throw e; });
          if (stat.size + bytes <= bytesLimit) await fs.appendFile(path, line); else dropped++;
        }
      } catch (e) { error = e; } finally { queued--; queuedBytes -= bytes; }
    });
    return true;
  }
  return {
    command(context, cmd, accepted = true) {
      if (!commands.has(cmd?.t)) return false;
      const s = stream(context);
      return record(s, 'command', { commandKind: cmd.t, command: commandSummary(cmd), target: humanCommandTarget(cmd), accepted: accepted === true });
    },
    input(context, input) {
      const s = stream(context), beat = cleanHumanBeat(input);
      if (!s || !beat || !['beat', ...HUMAN_INPUT_KINDS].includes(input.kind)) return false;
      if (s.value.inputTick !== s.tick) { s.value.inputTick = s.tick; s.value.inputs = 0; }
      if (++s.value.inputs > 4 || (input.kind === 'beat' && s.tick - s.value.beatTick < 2)) return false;
      if (input.kind === 'beat') s.value.beatTick = s.tick;
      s.value.beat = beat;
      return record(s, input.kind, { target: point(input.target) });
    },
    async flush() { await tail; },
    stats() { return { files: streams.size, queued, queuedBytes, dropped, error: error?.message ?? null }; },
  };
}
