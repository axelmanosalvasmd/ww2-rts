// Weather (DESIGN.md, Weather): one state at a time with effects on sight and movement, picked per match from the
// lobby setting, the map and a seed, plus at most one change during the match that everyone hears about first.
// The sim reads two multipliers from here, sightMul() in vision and speedMul() in movement; the unit stats never change.

// sight: how far ground units and buildings see (planes and recon flights are not affected).
// inf, veh: infantry and vehicle speed everywhere. offRoad: vehicle speed off the roads, on top of veh.
export const WEATHER = {
  clear: { name: 'Clear', sight: 1, inf: 1, veh: 1, offRoad: 1 },
  fog: { name: 'Ground fog', sight: 0.7, inf: 1, veh: 1, offRoad: 1 },
  rain: { name: 'Rain', sight: 0.85, inf: 1, veh: 1, offRoad: 0.8 },
  mud: { name: 'Mud', sight: 1, inf: 0.9, veh: 1, offRoad: 0.7 },
  snow: { name: 'Snow', sight: 0.9, inf: 0.9, veh: 0.85, offRoad: 1 },
};
export const WEATHER_KINDS = Object.keys(WEATHER);
// the lobby setting: the map's own weather, one of the states, or a seeded random pick
export const WEATHER_CHOICES = ['map', ...WEATHER_KINDS, 'random'];
export const WEATHER_WARN = 10; // seconds of notice before the weather changes
const TPS = 20; // sim ticks per second (sim.js TICK)

// ---------- the map's mood ----------

// A map's mood comes from a "mood" field in the map file, else from its name; client/atmosphere.js paints it (sun,
// sky, haze) and the Map default weather below follows it.
export const MOOD_NAMES = ['warm', 'dawn', 'overcast', 'snow', 'dust'];
export const MOOD_RULES = [
  ['snow', /ardennes|bastogne|bulge|winter|snow/i],
  ['dust', /kasserine|desert|tobruk|alamein|africa|tunis/i],
  ['dawn', /pegasus|polder|river|canal|marsh/i],
  ['overcast', /bocage|cassino|stalingrad|seawall|rain|storm/i],
];
export function mapMood(map, key) {
  if (MOOD_NAMES.includes(map?.mood)) return map.mood;
  const text = `${map?.name ?? ''} ${key ?? ''}`;
  return MOOD_RULES.find(([, re]) => re.test(text))?.[0] ?? 'warm';
}

// ---------- the plan for a match ----------

// What a map brings on Map default: a "weather" field in the map file, else its mood. Snowy maps snow; misty river
// dawns start in ground fog that lifts after 4 minutes; every other map is clear.
export function mapWeather(map, key) {
  if (WEATHER[map?.weather]) return { now: map.weather };
  const mood = mapMood(map, key);
  return mood === 'snow' ? { now: 'snow' } : mood === 'dawn' ? { now: 'fog', next: 'clear', at: 240 } : { now: 'clear' };
}

const seeded = (s) => () => {
  let t = (s = (s + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// The weather for one match: { now, next, at } with at in sim ticks (0 when nothing changes). The same choice, map and
// seed always give the same plan. A host's pick holds all match; Random may turn once (fog lifts after about 4
// minutes, rain leaves mud after 5 to 7), and Map default follows mapWeather().
export function planWeather(choice, map, key, seed = 1) {
  let plan;
  if (choice === 'random') {
    const rnd = seeded(seed >>> 0), now = WEATHER_KINDS[Math.floor(rnd() * WEATHER_KINDS.length)], turn = rnd() < 0.5, when = rnd();
    plan = turn && now === 'fog' ? { now, next: 'clear', at: 210 + Math.floor(when * 60) }
      : turn && now === 'rain' ? { now, next: 'mud', at: 300 + Math.floor(when * 120) } : { now };
  } else plan = WEATHER[choice] ? { now: choice } : mapWeather(map, key);
  return { now: plan.now, next: plan.next ?? null, at: plan.next ? plan.at * TPS : 0 };
}

// once per sim tick: the announced change happens on time
export function stepWeather(g) {
  const w = g.weather;
  if (w?.next && g.tick >= w.at) { w.now = w.next; w.next = null; w.at = 0; }
}

// ---------- the two multipliers the sim reads ----------

// vision range of a ground observer (sim.js multiplies only non-air units by this)
export const sightMul = (g) => WEATHER[g.weather?.now]?.sight ?? 1;

// Roads. The sim has no road layer, so this follows the ground painter (client/ground.js): open ground next to one of
// the map's houses is a village street, unless it lies by water, and bridges are roads. A crater ends the road there.
export function roadMask(map) {
  const { w, h, rows } = map, out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ch = rows[y][x];
    if (ch === '=') { out[y * w + x] = 1; continue; }
    if (ch !== '.') continue;
    let town = false, wet = false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const c = rows[y + dy]?.[x + dx];
      if (c === 'B') town = true; else if (c === 'W' || c === 'F' || c === '=') wet = true;
    }
    if (town && !wet) out[y * w + x] = 1;
  }
  return out;
}
export const onRoad = (g, c) => g.roads?.[c] === 1 && (g.chars[c] === '.' || g.chars[c] === '=');

// speed of a unit of this kind standing on cell c (planes fly over the weather)
export function speedMul(g, def, c) {
  const w = WEATHER[g.weather?.now];
  if (!w || def.air) return 1;
  if (def.infantry) return w.inf;
  return w.offRoad < 1 && !onRoad(g, c) ? w.veh * w.offRoad : w.veh;
}

// ---------- what players and the AI are told ----------

// public, in every snapshot: [now] or, in the last WEATHER_WARN seconds before a change, [now, next, seconds left]
export function weatherRow(g) {
  const w = g.weather;
  if (!w) return ['clear'];
  const left = w.next ? (w.at - g.tick) / TPS : Infinity;
  return left <= WEATHER_WARN ? [w.now, w.next, Math.max(0, Math.ceil(left))] : [w.now];
}

// "sight -30%", "vehicles -20% off roads": the effects in plain words, for the score strip and the lobby
export function weatherEffects(kind) {
  const w = WEATHER[kind] ?? WEATHER.clear, pct = (m) => `-${Math.round((1 - m) * 100)}%`, out = [];
  if (w.sight < 1) out.push(`sight ${pct(w.sight)}`);
  if (w.inf < 1) out.push(`infantry ${pct(w.inf)}`);
  if (w.veh < 1) out.push(`vehicles ${pct(w.veh)}`);
  if (w.offRoad < 1) out.push(`vehicles ${pct(w.offRoad)} off roads`);
  return out;
}

// How much bigger an AI wants its army before it attacks: in poor sight it has seen less of the enemy than is there,
// and with slow vehicles its tanks arrive late, so it waits for more. 1 in clear weather.
export function aiCaution(g) {
  const w = WEATHER[g.weather?.now] ?? WEATHER.clear;
  return 1 / (w.sight * Math.sqrt(Math.min(1, w.veh * w.offRoad)));
}
