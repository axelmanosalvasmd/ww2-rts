// Independent of the simulation RNG: looking and clicking cannot change combat rolls.
export function createRng(seed = 1, slot = 0) {
  let state = 2166136261;
  for (const ch of `${seed}:${slot}`) state = Math.imul(state ^ ch.charCodeAt(0), 16777619) >>> 0;
  return { state: state || 1 };
}

export function random(rng) {
  let x = rng.state >>> 0;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  rng.state = x >>> 0;
  return rng.state / 4294967296;
}

export const between = (rng, lo, hi) => lo + random(rng) * (hi - lo);
export const choose = (rng, values) => values.length ? values[Math.floor(random(rng) * values.length)] : undefined;
