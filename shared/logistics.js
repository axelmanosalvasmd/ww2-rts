// All quantities use physical rounds or simulation seconds. Cargo ammunition is
// compatible Munitions credit, paid at its source and consumed only on transfer.
export const LOGISTICS = Object.freeze({
  ammoSeconds: 90, provisions: 120, fuel: 180, emergency: 60,
  low: 0.25, recovery: 0.5, warning: 20, unloadSeconds: 8,
  smallAmmoPrice: 0.01, shellAmmoPrice: 0.05, heavyAmmoPrice: 0.10,
  fuelPrice: 6 / 180,
  sourceRadius: 15, cacheRadius: 15, truckRadius: 12,
  referenceAmmo: 3, referenceProvisions: 120, referenceFuel: 180,
  cargoEquivalents: 8, cacheEquivalents: 32, supportEquivalents: 4,
  replacementSeconds: 30, loadSeconds: 4, dispatchSeconds: 2,
  // Territory supply refills full reserves in refillSeconds at a rate of 1; a unit cut off keeps its last rate for
  // supplyGrace seconds. Trucks serve only what is out of supply: at most maxTrucks each, none while nothing is.
  refillSeconds: 40, supplyGrace: 10,
  spawnSeconds: 1, minTrucks: 0, maxTrucks: 4,
  routeFuelPerMetre: 0.002, routeContingency: 1.2, alertSeconds: 20,
});

const EPS = 1e-9;
const positive = value => Number.isFinite(value) ? Math.max(0, value) : 0;
const rounds = value => Math.floor(positive(value));

export function enabledFor(g) {
  if (typeof g.logisticsEnabled === 'boolean') return g.logisticsEnabled;
  if (g.scenario) return false;
  return ['conquest', 'classic', 'annihilation', 'world'].includes(g.mode?.kind ?? 'conquest');
}

export function ammoPrice(def) {
  const w = def?.w;
  if (!w) return LOGISTICS.smallAmmoPrice;
  if (w.salvo) {
    return /howitzer|rocket/i.test(def.name ?? '') || (w.rockets ?? 1) > 1 || w.range >= 80
      ? LOGISTICS.heavyAmmoPrice : LOGISTICS.shellAmmoPrice;
  }
  return w.shellTerrain || w.veh >= 20 ? LOGISTICS.shellAmmoPrice : LOGISTICS.smallAmmoPrice;
}

export function initializeUnit(g, u, def) {
  if (!enabledFor(g) || !def || !Number.isInteger(u.owner) || u.owner < 0 || !g.players?.[u.owner]
    || u.guardHome || def.building || def.structure || def.air || def.naval || !(def.speed > 0)
    || def.logisticsTruck || def.rail || u.type === 'supplytruck') return null;
  // Repeated setup, commands and reconnects cannot manufacture starting stock.
  if (u.logistics) return u.logistics;
  const w = def.w, armed = w && w.range > 0 && w.interval > 0 && (w.inf > 0 || w.veh > 0);
  const volley = armed ? w.salvo ? Math.max(1, rounds(w.rockets ?? 1)) : w.perModel ? Math.max(1, rounds(def.models)) : 1 : 0;
  const ammoMax = armed ? Math.ceil(LOGISTICS.ammoSeconds / w.interval) * volley : 0;
  const vehicle = !def.infantry;
  u.logistics = {
    ammo: ammoMax, ammoMax, ammoPrice: ammoPrice(def), ammoCredit: 0,
    provisions: LOGISTICS.provisions, fuel: vehicle ? LOGISTICS.fuel : null,
    emergency: vehicle ? LOGISTICS.emergency : null,
    warning: null, forced: false, stranded: false, exhausted: false,
  };
  return u.logistics;
}

export function consumeAmmo(u, count) {
  const requested = rounds(count), r = u.logistics;
  if (!r) return requested;
  const launched = Math.min(requested, rounds(r.ammo));
  r.ammo -= launched;
  return launched;
}

export function canFire(u, count = 1) {
  const requested = rounds(count);
  return requested > 0 && (!u.logistics || u.logistics.ammo >= requested);
}

export function recovered(u) {
  const r = u.logistics;
  return !r || (r.provisions >= LOGISTICS.provisions * LOGISTICS.recovery
    && (!r.ammoMax || r.ammo >= r.ammoMax * LOGISTICS.recovery)
    && (r.fuel === null || r.fuel >= LOGISTICS.fuel * LOGISTICS.recovery));
}

function releaseRecovered(u) {
  const r = u.logistics;
  if (recovered(u)) {
    r.warning = null; r.exhausted = false; r.forced = false; r.stranded = false;
  }
}

export function tickReserves(g, u, dt, travelSeconds = 0) {
  const r = u.logistics;
  if (!r || !enabledFor(g)) return;
  const seconds = positive(dt);
  releaseRecovered(u);
  const before = r.provisions;
  r.provisions = Math.max(0, before - seconds);
  if (r.provisions === 0 && !r.exhausted) {
    r.exhausted = true; r.warning = LOGISTICS.warning;
    r.warning = Math.max(0, r.warning - Math.max(0, seconds - before));
  } else if (r.exhausted && r.warning !== null) {
    r.warning = Math.max(0, r.warning - seconds);
  }
  if (r.warning === 0) r.forced = true;
  consumeDrivingFuel(u, Math.min(seconds, positive(travelSeconds)));
}

// The movement solver supplies only actual powered travel time, after traffic,
// blocking, riding and external displacement have been resolved.
export function consumeDrivingFuel(u, travelSeconds) {
  const r = u.logistics;
  if (r && r.fuel !== null) {
    let driving = u.riding ? 0 : positive(travelSeconds);
    const ordinary = Math.min(r.fuel, driving);
    r.fuel -= ordinary; driving -= ordinary;
    if (r.fuel <= 0) {
      r.fuel = 0; r.forced = true;
      r.emergency = Math.max(0, r.emergency - driving);
    }
    if (r.fuel === 0 && r.emergency === 0) r.stranded = true;
  }
}

export function shortageState(u) {
  const r = u.logistics;
  return {
    lowAmmo: !!r && r.ammoMax > 0 && r.ammo < r.ammoMax * LOGISTICS.low,
    lowProvisions: !!r && r.provisions < LOGISTICS.provisions * LOGISTICS.low,
    exhausted: !!r?.exhausted, forced: !!r?.forced, stranded: !!r?.stranded,
  };
}

export function shortageRate(u) {
  const r = u.logistics;
  return r && (r.exhausted || (r.ammoMax > 0 && r.ammo < r.ammoMax * LOGISTICS.low)) ? 2 : 1;
}

export function recoveryRate(u) {
  const r = u.logistics;
  if (!r) return 1;
  if (r.exhausted || r.provisions <= 0) return 0;
  return r.provisions < LOGISTICS.provisions * LOGISTICS.low ? 0.5 : 1;
}

// Each commodity has independent unloading throughput. Fractional paid ammo
// credit is held until a whole projectile can be issued, preserving short ticks.
export function transferStock(store, u, seconds) {
  const moved = { ammo: 0, provisions: 0, fuel: 0 }, r = u.logistics;
  const fraction = positive(seconds) / LOGISTICS.unloadSeconds;
  if (!r || !store || !fraction) return moved;
  if (r.ammoMax > 0) {
    const price = r.ammoPrice;
    const pending = r.ammoCredit ?? 0;
    moved.ammo = Math.min(positive(store.ammo), Math.max(0, (r.ammoMax - r.ammo) * price - pending), r.ammoMax * price * fraction);
    const credit = pending + moved.ammo;
    const loaded = Math.min(r.ammoMax - r.ammo, Math.floor((credit + EPS) / price));
    r.ammo += loaded;
    r.ammoCredit = Math.max(0, credit - loaded * price);
  }
  moved.provisions = Math.min(positive(store.provisions), Math.max(0, LOGISTICS.provisions - r.provisions), LOGISTICS.provisions * fraction);
  r.provisions += moved.provisions;
  if (r.fuel !== null) {
    moved.fuel = Math.min(positive(store.fuel), Math.max(0, LOGISTICS.fuel - r.fuel) + Math.max(0, LOGISTICS.emergency - r.emergency), (LOGISTICS.fuel + LOGISTICS.emergency) * fraction);
    const ordinary = Math.min(moved.fuel, LOGISTICS.fuel - r.fuel);
    r.fuel += ordinary; r.emergency += moved.fuel - ordinary;
  }
  for (const key of ['ammo', 'provisions', 'fuel']) if (moved[key] > 0) store[key] = Math.max(0, store[key] - moved[key]);
  releaseRecovered(u);
  return moved;
}
