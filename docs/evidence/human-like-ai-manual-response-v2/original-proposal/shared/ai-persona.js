// Match preferences and imperfect estimates use the seat's private, seeded stream.
import { random, choose } from './ai-rng.js';
import { UNITS, canBuild, priceOf, TICK } from './sim.js';

export const PERSONAS = Object.freeze({
  aggressive: { opening: ['rifle', 'mg', 'rifle'], economy: 'barracks', pressure: 0.9 },
  defensive: { opening: ['at', 'mg', 'rifle'], economy: 'depot', pressure: 1.15 },
  armour: { opening: ['mg', 'rifle', 'at'], economy: 'motorpool', pressure: 1 },
  infantry: { opening: ['rifle', 'rifle', 'mg'], economy: 'depot', pressure: 0.95 },
  support: { opening: ['mortar', 'mg', 'rifle'], economy: 'barracks', pressure: 1.1 },
});

export function personaFor(state, rng) {
  if (!state.persona) {
    const family = choose(rng, Object.keys(PERSONAS));
    state.persona = { family, ...PERSONAS[family], opening: [...PERSONAS[family].opening] };
    if (random(rng) < 0.35) [state.persona.opening[1], state.persona.opening[2]] = [state.persona.opening[2], state.persona.opening[1]];
    state.buys = 0;
  }
  return state.persona;
}

export function openingBuy(state, view, slot, fallback, trains) {
  const preferred = state.persona?.opening[state.buys ?? 0], me = view.players[slot];
  if (!preferred || fallback === 'engineer' || !trains(preferred)) return fallback;
  if (preferred === 'rifle' && canBuild('conscript', me.faction) && trains('conscript')) return 'conscript';
  return canBuild(preferred, me.faction) ? preferred : fallback;
}

// A viable starting force can save briefly for its chosen first ordinary purchase.
export function saveOpeningPreference(state, view, slot, candidate, trains, { armySize = 0, tacticalCounter = true } = {}) {
  const me = view.players[slot], elapsed = (view.tick - state.startedTick) * TICK;
  if (state.buys !== 0 || !Number.isFinite(elapsed) || elapsed < 0 || elapsed > 20
    || view.mode && view.mode.kind !== 'conquest' || !Number.isFinite(armySize) || armySize < 3 || tacticalCounter) return false;
  const preferred = openingBuy(state, view, slot, null, trains);
  if (!preferred || candidate !== preferred || !canBuild(candidate, me.faction) || !trains(candidate)) return false;
  const price = priceOf(view, candidate);
  return price.fuel === 0 && price.mp <= priceOf(view, 'at').mp;
}

export function estimateSightings(view, rng, skill, state = {}) {
  const uncertainty = { easy: 0.4, normal: 0.22, hard: 0.1 }[skill] ?? 0.22;
  const errors = state.estimateErrors ??= new Map(), live = new Set(view.sightings.map(s => s.id));
  for (const id of errors.keys()) if (!live.has(id)) errors.delete(id);
  return view.sightings.map(s => {
    const full = UNITS[s.type].cost;
    const health = Math.max(0.25, Math.round((s.val / full) * 4) / 4);
    const reacquired = (view.events ?? []).filter(event => event.kind === 'screen-contact' && (event.targetId ?? event.unitId) === s.id).at(-1)?.tick ?? -1;
    let estimate = errors.get(s.id);
    if (!estimate || reacquired > estimate.reacquired) {
      estimate = { factor: 1 + (random(rng) * 2 - 1) * uncertainty, reacquired };
      errors.set(s.id, estimate);
    }
    return { ...s, val: full * health * estimate.factor, uncertain: true };
  });
}

export function optionBias(state, rng, skill, now) {
  const temperature = { easy: 28, normal: 14, hard: 5 }[skill] ?? 14;
  if (!state.bias || now >= state.biasUntil) {
    state.bias = Array.from({ length: state.pointCount ?? 0 }, () => -Math.log(Math.max(1e-6, random(rng))) * temperature);
    state.biasUntil = now + ({ easy: 16, normal: 10, hard: 6 }[skill] ?? 10);
  }
  return state.bias;
}
