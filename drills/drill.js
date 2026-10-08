// Drills: small authored scenes played on the server's AI schedule (shared/ai-schedule.js), each with a measure.
// A test asserts a drill's measure, `node tools/drill.mjs` runs one over many seeds, so a behaviour question takes
// seconds instead of whole matches. A drill module exports:
//   about     one line: what the drill asks
//   map       { w, h, spawns, rows? } (rows default to open ground), mode (default conquest)
//   units     [{ owner, type, x, z, ...state }]: the scene's only units; the starting forces and bases are removed
//   ai        slots the human-like commander plays, at the run's level (other slots only follow the script)
//   warmup    seconds played before the script's clock starts (lets the commander's opening look pass)
//   script    [{ at, run(scene) }]: at seconds after the warmup; scene is { g, units, params, tick }
//   seconds   how long after the warmup the drill runs
//   measure(scene) returns the result; scene adds alerts and inputs recorded per AI slot
import { UNITS } from '../shared/sim.js';
import { playMatch } from '../shared/ai-schedule.js';
import { fixtureCommand, clearFixtureUnits } from '../test-fixtures.js';

const TPS = 20;
const openGround = (w, h) => Array(h).fill('.'.repeat(w));

export function runDrill(drill, { level = 'normal', seed = 1, params = {} } = {}) {
  const players = Math.max(...drill.units.map(u => u.owner)) + 1, slots = Array.from({ length: players }, (_, i) => i);
  const map = { rows: openGround(drill.map.w, drill.map.h), points: [], ...drill.map };
  const record = slots.map(() => ({ alerts: [], inputs: [] }));
  const scene = { units: [], params, alerts: record.map(r => r.alerts), inputs: record.map(r => r.inputs), tick: 0 };
  const warmup = Math.round((drill.warmup ?? 0) * TPS), script = [...(drill.script ?? [])].sort((a, b) => a.at - b.at);
  const seats = (drill.ai ?? []).map(slot => ({ slot, level, options: { onAlert: a => record[slot].alerts.push(a), onInput: i => record[slot].inputs.push(i) } }));
  const g = playMatch({
    map, names: slots.map(i => `P${i + 1}`), teams: slots, factions: slots.map(i => i % 3), shuffle: false, seed, seats,
    options: { mode: drill.mode ?? 'conquest', weather: false },
    maxTicks: warmup + Math.round(drill.seconds * TPS),
    setup: g => {
      clearFixtureUnits(g);
      for (const { owner, type, x, z, ...state } of drill.units) {
        if (!UNITS[type]) throw new Error(`drill ${drill.about}: unknown unit type ${type}`);
        const mp = g.players[owner].mp;
        g.players[owner].mp = 1e6;
        const failed = fixtureCommand(g, owner, { t: 'buy', unit: type });
        g.players[owner].mp = mp;
        if (failed) throw new Error(`drill ${drill.about}: cannot place ${type} (${failed})`);
        const u = [...g.units.values()].at(-1);
        Object.assign(u, { x, z, path: [], orders: [], targetId: 0, ...state });
        scene.units.push(u);
      }
      scene.g = g;
    },
    // Script steps run before the step, so a damage event they add is read by the AI on this tick.
    beforeStep: g => {
      scene.tick = g.tick - warmup;
      while (script.length && scene.tick >= Math.round(script[0].at * TPS)) script.shift().run(scene);
    },
  });
  scene.g = g; scene.tick = g.tick - warmup;
  return drill.measure(scene);
}

// Sums up many runs of one drill: numbers by median and range, booleans as a share, the rest by count.
export function summarize(results) {
  const out = {};
  for (const key of new Set(results.flatMap(r => Object.keys(r)))) {
    const values = results.map(r => r[key]).filter(v => v !== undefined && v !== null);
    if (values.every(v => typeof v === 'boolean')) out[key] = `${values.filter(Boolean).length}/${values.length}`;
    else if (values.every(v => typeof v === 'number')) {
      const sorted = [...values].sort((a, b) => a - b), mid = sorted.length >> 1;
      const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
      out[key] = { median: +median.toFixed(3), min: sorted[0], max: sorted.at(-1), runs: values.length };
    } else out[key] = Object.fromEntries([...new Set(values.map(String))].map(v => [v, values.filter(x => String(x) === v).length]));
  }
  return out;
}
