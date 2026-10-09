import { LOGISTICS as L, transferStock, recovered } from './logistics.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const keys = ['ammo', 'provisions', 'fuel'];
const empty = () => ({ ammo: 0, provisions: 0, fuel: 0 });
const quantity = stock => keys.reduce((n, k) => n + Math.max(0, stock[k] ?? 0), 0);
const scaleOf = g => Math.max(0.01, g.army?.pop ?? 1);
const capacity = (g, equivalents) => ({ ammo: equivalents * L.referenceAmmo * scaleOf(g), provisions: equivalents * L.referenceProvisions * scaleOf(g), fuel: equivalents * L.referenceFuel * scaleOf(g) });
const construction = g => ['classic', 'world'].includes(g.mode?.kind);
const friendly = (g, a, b) => a >= 0 && b >= 0 && g.players[a]?.team === g.players[b]?.team;
const round = n => Math.round(n * 100) / 100;

export function setupConvoys(g) {
  if (!g.logisticsEnabled) return;
  g.convoys = { stores: new Map(), nextSpawn: new Map(), losses: new Map(), events: [], alerts: new Map(), nextEvent: 1, nextSchedule: 0, refreshQueue: [], scheduleQueue: [], scheduled: new Set(), assignments: new Map(), routed: 0, jobs: new Map() };
}

function alert(g, owner, type, message, at, count = 1) {
  const s = g.convoys, id = `${owner}:${type}`, now = g.tick / 20;
  if (now - (s.alerts.get(id) ?? -Infinity) < L.alertSeconds) return;
  s.alerts.set(id, now);
  s.events.push({ id: s.nextEvent++, owner, type, count, x: at?.x, z: at?.z, message, at: now });
  s.events = s.events.filter(e => now - e.at <= 30).slice(-128);
}

function routeAlert(g, u, target) {
  const reason = u.convoy.routeFailure ?? 'unreachable';
  const messages = { dangerous: 'Supply delivery is waiting for a safe route', blocked: 'Supply route is blocked', unreachable: 'No reachable ground route for supplies' };
  alert(g, u.owner, reason, messages[reason] ?? messages.unreachable, target);
}

function addStore(g, id, owner, at, source = false, entity = null, equivalents = L.cacheEquivalents) {
  const s = { id, owner, x: at.x, z: at.z, source, entity, capacity: capacity(g, equivalents), buckets: new Map(), active: true };
  g.convoys.stores.set(id, s);
  return s;
}

function bucket(store, owner) {
  if (!store.buckets.has(owner)) store.buckets.set(owner, empty());
  return store.buckets.get(owner);
}

// Explicit cache relief stays in its payer's bucket. Recipient authorizations reserve only the quantities
// actually unloaded; automatic fleets cannot take that reserved stock or turn it into another payer's cargo.
function donation(store, payer, recipient) {
  store.donations ??= new Map();
  if (!store.donations.has(payer)) store.donations.set(payer, new Map());
  const recipients = store.donations.get(payer);
  if (!recipients.has(recipient)) recipients.set(recipient, empty());
  return recipients.get(recipient);
}

function stockPools(store, owner, relief = true) {
  const own = bucket(store, owner), privateStock = { ...own };
  for (const grant of store.donations?.get(owner)?.values() ?? []) for (const k of keys) privateStock[k] = Math.max(0, privateStock[k] - grant[k]);
  const pools = [{ stock: own, limit: privateStock }];
  if (relief) for (const [payer, recipients] of store.donations ?? []) {
    const grant = recipients.get(owner);
    if (grant) pools.push({ stock: bucket(store, payer), limit: grant, grant });
  }
  return pools;
}

function availableStock(store, owner, relief = true) {
  const stock = empty();
  for (const pool of stockPools(store, owner, relief)) for (const k of keys) stock[k] += Math.min(pool.stock[k], pool.limit[k]);
  return stock;
}

function consumeStock(store, owner, amounts, relief = true) {
  const remaining = Object.fromEntries(keys.map(k => [k, Number.isFinite(amounts[k]) ? Math.max(0, amounts[k]) : 0]));
  for (const pool of stockPools(store, owner, relief)) for (const k of keys) {
    const q = Math.min(Math.max(0, remaining[k] ?? 0), pool.stock[k], pool.limit[k]);
    pool.stock[k] -= q; remaining[k] -= q;
    if (pool.grant) pool.grant[k] -= q;
  }
}

function stockTotal(store) {
  const result = empty();
  for (const b of store.buckets.values()) for (const k of keys) result[k] += b[k] ?? 0;
  return result;
}

function storeSpace(store) {
  const used = stockTotal(store);
  return Object.fromEntries(keys.map(k => [k, Math.max(0, store.capacity[k] - used[k])]));
}

// Own sources first, so callers taking the first one (new trucks, a home to return to) use this player's HQ, not an ally's.
function sources(g, owner) {
  return [...g.convoys.stores.values()].filter(s => s.active && s.source && friendly(g, s.owner, owner)).sort((a, b) => (b.owner === owner) - (a.owner === owner));
}

function syncStores(g, hooks) {
  const s = g.convoys;
  for (const store of s.stores.values()) store.active = false;
  const ensure = (id, owner, at, source, entity, equivalents) => {
    let store = s.stores.get(id);
    if (store && store.owner !== owner) { s.stores.delete(id); store = null; }
    store ??= addStore(g, id, owner, at, source, entity, equivalents);
    Object.assign(store, { owner, x: at.x, z: at.z, source, entity, active: true });
    return store;
  };
  // Skirmish bases put an HQ on the old home position, so any match with HQs supplies from them.
  if (construction(g) || [...g.units.values()].some(u => u.type === 'hq')) {
    for (const u of g.units.values()) if (u.type === 'hq' && u.hp > 0 && u.built >= 1 && !g.players[u.owner]?.out) ensure(`source:${u.id}`, u.owner, u, true, u.id);
  } else {
    for (const p of g.players) if (!p.out && !p.away) ensure(`source:${p.slot}`, p.slot, p.spawn, true, null);
  }
  for (const u of g.units.values()) {
    if (u.hp <= 0 || u.owner < 0) continue;
    if (u.type === 'supplycache' && u.built >= 1 && u.regionCache === undefined) ensure(`cache:${u.id}`, u.owner, u, false, u.id);
    if (u.type === 'halftrack') {
      const id = `support:${u.id}`, fresh = !s.stores.has(id);
      const store = ensure(id, u.owner, u, false, u.id, L.supportEquivalents);
      if (fresh) Object.assign(bucket(store, u.owner), { ammo: store.capacity.ammo, provisions: store.capacity.provisions });
      store.support = true; store.active = u.still >= 2 || !!u.cargo?.length;
    }
  }
  for (const [c, owner] of g.aid ?? []) {
    const id = `hospital:${c}`, fresh = !s.stores.has(id), at = { x: (c % g.w + .5) * 2, z: (Math.floor(c / g.w) + .5) * 2 };
    if (g.chars[c] !== 'A') continue;
    const store = ensure(id, owner, at, false, null, L.supportEquivalents);
    if (fresh) Object.assign(bucket(store, owner), { ammo: store.capacity.ammo, provisions: store.capacity.provisions });
    store.support = true;
  }
  for (let i = 0; i < g.points.length; i++) {
    const p = g.points[i];
    if (p.kind === 'depot' && p.owner >= 0 && !p.contested) ensure(`point:${i}`, p.owner, p, false, null).point = i;
  }
  for (const [id, store] of s.stores) if (!store.active) {
    if (store.point !== undefined && g.points[store.point]?.owner === store.owner && g.points[store.point].contested) continue;
    if (store.region !== undefined && g.world?.regions.some(r => r.id === store.region && (r.team < 0 || store.lostAt !== undefined && g.players[store.owner]?.team === r.team))) continue;
    s.stores.delete(id);
  }
}

function missing(u) {
  const r = u.logistics;
  return { ammo: Math.max(0, (r.ammoMax - r.ammo) * r.ammoPrice - (r.ammoCredit ?? 0)), provisions: Math.max(0, L.provisions - r.provisions), fuel: r.fuel === null ? 0 : Math.max(0, L.fuel - r.fuel) + Math.max(0, L.emergency - r.emergency) };
}

// Sources are free and endless in every mode: supply lines limit ammunition and fuel, the currencies buy decisions.
// Cargo returned to a source is used up first.
function fillFromSource(source, owner, need, limit) {
  const stock = bucket(source, owner), cargo = empty();
  for (const k of keys) {
    cargo[k] = Math.min(Math.max(0, need[k] ?? 0), limit[k]);
    stock[k] -= Math.min(stock[k], cargo[k]);
  }
  return cargo;
}

// Territory supply (docs/territory-supply.md): every unit with reserves refills where it stands at its network rate
// (full in L.refillSeconds at a rate of 1). Cut off, it keeps its last rate for L.supplyGrace
// seconds, then gets nothing. Finite stores in supply (halftracks, aid stations, caches) restock the same way.
function territoryService(g, dt, hooks) {
  if (!hooks.supplyRate) return;
  const cut = new Map();
  for (const u of g.units.values()) {
    const r = u.logistics;
    if (!r || u.hp <= 0) continue;
    const rate = hooks.supplyRate(u.owner, u.riding ? g.units.get(u.riding) ?? u : u), wasCut = (r.cutFor ?? 0) >= L.supplyGrace;
    if (rate > 0) { r.supplyRate = rate; r.cutFor = 0; } else r.cutFor = (r.cutFor ?? 0) + dt;
    const isCut = r.cutFor >= L.supplyGrace;
    if (isCut && !wasCut) cut.set(u.owner, [...(cut.get(u.owner) ?? []), u]);
    if (wasCut && !isCut) alert(g, u.owner, 'restored', 'Supply line restored', u);
    const need = missing(u), share = isCut ? 0 : (r.supplyRate ?? 0) * dt / L.refillSeconds;
    if (!(share > 0) || quantity(need) < 1e-6) continue;
    const limit = { ammo: r.ammoMax * r.ammoPrice * share, provisions: L.provisions * share, fuel: (L.fuel + L.emergency) * share }, stock = empty();
    for (const k of keys) stock[k] = Math.min(need[k], limit[k]);
    transferStock(stock, u, dt);
  }
  for (const [owner, units] of cut) alert(g, owner, 'cut', `${units.length} unit${units.length === 1 ? '' : 's'} cut off from supply`, units[0], units.length);
  for (const store of g.convoys.stores.values()) {
    if (!store.active || store.source || store.owner < 0) continue;
    const rate = hooks.supplyRate(store.owner, store);
    if (!(rate > 0)) continue;
    const b = bucket(store, store.owner), space = storeSpace(store), share = rate * dt / L.refillSeconds;
    for (const k of keys) b[k] += Math.min(space[k], store.capacity[k] * share);
  }
}

function moveStock(from, to, limits) {
  let moved = 0;
  for (const k of keys) { const q = Math.min(Math.max(0, from[k] ?? 0), Math.max(0, limits[k] ?? 0)); from[k] -= q; to[k] = (to[k] ?? 0) + q; moved += q; }
  return moved;
}

function localService(g, dt, hooks) {
  const stores = [...g.convoys.stores.values()].filter(s => s.active);
  for (const u of g.units.values()) {
    if (!u.logistics || u.hp <= 0) continue;
    const host = u.riding ? g.units.get(u.riding) : u;
    const nearby = stores.filter(s => friendly(g, s.owner, u.owner) && distance(s, host ?? u) <= L.sourceRadius && hooks.handoff(u, s, L.sourceRadius)).sort((a, b) => distance(a, host ?? u) - distance(b, host ?? u));
    for (const store of nearby) {
      if (store.source) {
        const need = missing(u), stock = fillFromSource(store, u.owner, need, {
          ammo: u.logistics.ammoMax * u.logistics.ammoPrice * dt / L.unloadSeconds,
          provisions: L.provisions * dt / L.unloadSeconds, fuel: (L.fuel + L.emergency) * dt / L.unloadSeconds,
        });
        transferStock(stock, u, dt);
        moveStock(stock, bucket(store, u.owner), stock);
      } else {
        const stock = availableStock(store, u.owner);
        consumeStock(store, u.owner, transferStock(stock, u, dt));
      }
      if (recovered(u)) break;
    }
  }
}

function endpoint(from, target) {
  const d = distance(from, target) || 1, gap = Math.min(9, d);
  return { x: target.x + (from.x - target.x) / d * gap, z: target.z + (from.z - target.z) / d * gap };
}

function sendTruck(g, u, target, hooks, manual = false) {
  const c = u.convoy, at = endpoint(u, target), key = `${Math.round(at.x / 8)},${Math.round(at.z / 8)}`;
  // A failed route can search the whole world, so automatic retries to the same place back off from 2 s to 32 s
  // (they come from refreshRoutes and the waiting retry, each every 2 s). The last failure reason stays set.
  if (!manual && c.retry?.key === key && g.tick < c.retry.at) return false;
  const path = hooks.route(u, at, !manual); g.convoys.routed++;
  if (!path.length && distance(u, at) > L.truckRadius) {
    c.routeFailure = hooks.routeReason?.(u) ?? u.supplyRouteReason ?? 'unreachable';
    const wait = c.retry?.key === key ? Math.min(32, c.retry.wait * 2) : 2;
    c.retry = { key, wait, at: g.tick + wait * 20 };
    return false;
  }
  c.retry = null;
  c.routeFailure = null;
  u.path = path; u.worldGoal = { ...at }; u.repath = 2; u.retreating = false; u.attackId = 0; u.targetId = 0;
  c.destination = { x: target.x, z: target.z }; c.route = path.map(p => ({ x: p.x, z: p.z }));
  return true;
}

function targetsFor(g, owner, hooks) {
  const targets = [], occupied = new Set();
  for (const u of g.units.values()) if (u.type === 'truck' && u.owner === owner && u.hp > 0 && u.convoy?.target && !['idle', 'returning', 'waitingReturn'].includes(u.convoy.state)) {
    occupied.add(u.convoy.target.id);
    for (const id of u.convoy.target.members ?? []) occupied.add(`unit:${id}`);
  }
  const troops = [...g.units.values()].filter(u => u.owner === owner && u.hp > 0 && u.logistics);
  const assigned = new Set();
  for (const u of troops.sort((a, b) => a.logistics.provisions - b.logistics.provisions)) {
    if (assigned.has(u.id) || occupied.has(`unit:${u.id}`)) continue;
    const r = u.logistics;
    // troops in supply refill from the territory; trucks are for the ones cut off
    if ((r.cutFor ?? 0) < L.supplyGrace) continue;
    if (r.provisions > 90 && (!r.ammoMax || r.ammo / r.ammoMax > .75) && (r.fuel === null || r.fuel > L.fuel * .75) && !r.forced) continue;
    const members = troops.filter(t => !assigned.has(t.id) && !occupied.has(`unit:${t.id}`) && distance(t, u) <= 10);
    const need = empty();
    for (const t of members) { assigned.add(t.id); const n = missing(t); for (const k of keys) need[k] += n[k]; }
    targets.push({ id: `unit:${u.id}`, unit: u.id, owner, x: u.x, z: u.z, members: members.map(t => t.id), need, priority: r.provisions + (r.forced ? -200 : 0) });
  }
  for (const store of g.convoys.stores.values()) {
    if (!store.active || store.source || !friendly(g, store.owner, owner) || occupied.has(store.id)) continue;
    // stores in supply restock from the territory; trucks stock the ones beyond it
    if (hooks?.supplyRate?.(store.owner, store) > 0 || !troops.some(u => distance(u, store) < 200)) continue;
    const b = availableStock(store, owner), need = empty();
    for (const k of keys) need[k] = Math.min(storeSpace(store)[k], Math.max(0, store.capacity[k] * .5 - b[k]));
    if (quantity(need) > 1) targets.push({ id: store.id, store: store.id, owner, x: store.x, z: store.z, need, priority: store.support ? 170 : 180 + (store.region === undefined ? 0 : .01 * distance(store, g.players[owner].spawn)) });
  }
  return targets.sort((a, b) => a.priority - b.priority);
}

function originsFor(g, owner, target) {
  const candidates = [...g.convoys.stores.values()].filter(s => s.active && friendly(g, s.owner, owner) && s.id !== target.id && (s.source || quantity(availableStock(s, owner, false)) > 1));
  // Upstream inventories feed caches; troops may use any nearby remaining stock.
  const roots = sources(g, owner), rootDistance = at => Math.min(...roots.map(r => distance(r, at)));
  return candidates.filter(s => !target.store || s.source || rootDistance(s) + 8 < rootDistance(target)).sort((a, b) => distance(a, target) - distance(b, target));
}

function assignJob(g, u, target, origin, hooks, manual = false) {
  const c = u.convoy;
  const before = { ...c };
  const restore = () => { const reason = c.routeFailure, retry = c.retry; Object.assign(c, before); c.routeFailure = reason; c.retry = retry; return false; };
  c.target = target; c.origin = origin.id; c.manual = manual; c.hold = false; c.timer = L.loadSeconds;
  if (quantity(c.cargo)) {
    if (!sendTruck(g, u, target, hooks, manual)) return restore();
    c.state = 'delivering'; return true;
  }
  if (distance(u, origin) > L.sourceRadius || !hooks.handoff(u, origin, L.sourceRadius)) {
    if (!sendTruck(g, u, origin, hooks, manual)) return restore();
    c.state = 'collecting';
  } else {
    // Validate the delivery route before loading, but remain at the source.
    if (!sendTruck(g, u, target, hooks, manual)) return restore();
    c.state = 'loading'; u.path = []; u.worldGoal = null;
  }
  return true;
}

function loadJob(g, u, hooks) {
  const c = u.convoy, origin = g.convoys.stores.get(c.origin);
  if (!origin?.active || !c.target) { c.state = 'idle'; return; }
  const cap = capacity(g, L.cargoEquivalents), need = c.target.need ?? cap;
  if (origin.source) c.cargo = fillFromSource(origin, u.owner, need, cap);
  else {
    c.cargo = empty(); const stock = availableStock(origin, u.owner, false);
    moveStock(stock, c.cargo, Object.fromEntries(keys.map(k => [k, Math.min(need[k] ?? cap[k], cap[k])])));
    consumeStock(origin, u.owner, c.cargo, false);
  }
  if (!quantity(c.cargo)) { c.state = 'idle'; c.target = null; alert(g, u.owner, 'stock', 'No affordable supply stock is available for loading', u); return; }
  c.state = 'delivering';
  if (!sendTruck(g, u, c.target, hooks, c.manual)) { c.state = 'waiting'; routeAlert(g, u, c.target); }
}

function finishJob(g, u, hooks) {
  const c = u.convoy;
  c.target = null; c.manual = false;
  const previous = g.convoys.stores.get(c.origin);
  const origin = previous?.active && friendly(g, previous.owner, u.owner) ? previous : sources(g, u.owner).sort((a, b) => distance(a, u) - distance(b, u))[0];
  if (!origin) { c.state = 'waitingReturn'; c.hold = false; u.path = []; u.worldGoal = null; c.route = []; return; }
  c.state = 'returning'; c.origin = origin.id;
  if (!sendTruck(g, u, origin, hooks)) { c.state = 'waitingReturn'; u.path = []; u.worldGoal = null; }
}

function deliver(g, u, dt, hooks) {
  const c = u.convoy, target = c.target;
  if (!target) { finishJob(g, u, hooks); return; }
  if (target.store) {
    const store = g.convoys.stores.get(target.store);
    if (!store?.active || !friendly(g, store.owner, u.owner)) { finishJob(g, u, hooks); return; }
    if (distance(u, store) > L.truckRadius || !hooks.handoff(u, store, L.truckRadius)) {
      c.timer -= dt;
      if (c.timer <= 0) {
        Object.assign(target, { x: store.x, z: store.z });
        c.state = sendTruck(g, u, target, hooks, c.manual) ? 'delivering' : 'waiting';
      }
      return;
    }
    const cap = capacity(g, L.cargoEquivalents), limits = storeSpace(store);
    for (const k of keys) limits[k] = Math.min(limits[k], cap[k] * dt / L.unloadSeconds);
    const before = { ...c.cargo };
    moveStock(c.cargo, bucket(store, u.owner), limits);
    if (c.manual && target.relief && store.owner !== u.owner) {
      const grant = donation(store, u.owner, store.owner);
      for (const k of keys) grant[k] += before[k] - c.cargo[k];
    }
  } else {
    const members = (target.members ?? [target.unit]).map(id => g.units.get(id)).filter(t => t?.logistics && t.hp > 0 && friendly(g, t.owner, u.owner));
    let served = false;
    for (const troop of members.sort((a, b) => a.logistics.provisions - b.logistics.provisions)) {
      const at = troop.riding ? g.units.get(troop.riding) ?? troop : troop;
      if (distance(u, at) > L.truckRadius || !hooks.handoff(troop, u, L.truckRadius)) continue;
      transferStock(c.cargo, troop, dt); served = true;
    }
    if (!served) {
      c.timer -= dt;
      const troop = members[0];
      if (troop && c.timer <= 0) { Object.assign(target, { x: troop.x, z: troop.z }); c.state = 'delivering'; if (!sendTruck(g, u, target, hooks, c.manual)) c.state = 'waiting'; }
      else if (!troop) finishJob(g, u, hooks);
      return;
    }
  }
  c.timer -= dt;
  if (c.timer <= 0 || quantity(c.cargo) < .001) finishJob(g, u, hooks);
}

function fleet(g, hooks) {
  const now = g.tick / 20;
  for (const p of g.players) {
    if (p.out || p.away) continue;
    const own = [...g.units.values()].filter(u => u.owner === p.slot && u.hp > 0), active = own.filter(u => u.type === 'truck');
    // trucks only for what is out of supply: the busy ones plus open jobs
    const busy = active.filter(u => u.convoy.state !== 'idle' || u.convoy.manual || u.convoy.hold).length;
    const desired = Math.min(L.maxTrucks, Math.max(L.minTrucks, busy + (g.convoys.jobs.get(p.slot) ?? 0)));
    let surplus = active.length - desired;
    for (let i = active.length - 1; i >= 0 && surplus > 0; i--) {
      const u = active[i], c = u.convoy;
      if (c.state !== 'idle' || c.manual || c.hold || quantity(c.cargo) || u.path.length || u.worldGoal || u.orders.length) continue;
      if (!sources(g, p.slot).some(s => distance(s, u) <= L.sourceRadius && hooks.handoff(u, s, L.sourceRadius))) continue;
      if (hooks.retire) hooks.retire(u); else g.units.delete(u.id);
      active.splice(i, 1); surplus--;
    }
    const losses = (g.convoys.losses.get(p.slot) ?? []).filter(t => t > now);
    g.convoys.losses.set(p.slot, losses);
    if (active.length + losses.length >= desired || now < (g.convoys.nextSpawn.get(p.slot) ?? 0)) continue;
    const source = sources(g, p.slot)[0];
    if (!source) continue;
    addTruck(g, p.slot, source, hooks);
    g.convoys.nextSpawn.set(p.slot, now + L.spawnSeconds);
  }
}

// A new automatic truck, idle at a source.
export function addTruck(g, owner, source, hooks) {
  const u = hooks.spawn(owner, 'truck', source);
  u.autoRetreat = false; u.convoy = { state: 'idle', cargo: empty(), target: null, origin: source.id, timer: 0, manual: false, hold: false, route: [], destination: null };
  return u;
}

// The cycle queues every player. A player's pass stops when this tick's route plans are used up and goes on next
// tick; each idle truck is tried once per cycle.
function schedule(g, hooks) {
  const s = g.convoys;
  while (s.scheduleQueue.length) {
    const p = g.players[s.scheduleQueue[0]];
    if (p && !p.out && !p.away && !schedulePlayer(g, p, hooks)) return;
    s.scheduleQueue.shift();
  }
}
function schedulePlayer(g, p, hooks) {
  const s = g.convoys;
  const idle = [...g.units.values()].filter(u => u.owner === p.slot && u.type === 'truck' && u.hp > 0 && u.convoy.state === 'idle' && !u.convoy.manual && !u.convoy.hold && !s.scheduled.has(u.id));
  const targets = targetsFor(g, p.slot, hooks);
  s.jobs.set(p.slot, targets.length);
  for (const u of idle) {
    if (s.routed >= ROUTES_PER_TICK) return false;
    let pass = s.assignments.get(u.id);
    if (!pass) {
      pass = { targets: targets.map(t => t.id), target: 0, origins: null, origin: 0, blocked: false, noStock: false };
      s.assignments.set(u.id, pass);
    }
    let assigned = false;
    while (pass.target < pass.targets.length && !assigned) {
      const target = targets.find(t => t.id === pass.targets[pass.target]);
      if (target) {
        if (!pass.origins) {
          pass.origins = originsFor(g, p.slot, target).map(origin => origin.id); pass.origin = 0;
          pass.noStock ||= !pass.origins.length;
        }
        while (pass.origin < pass.origins.length) {
          if (s.routed >= ROUTES_PER_TICK) return false;
          const origin = s.stores.get(pass.origins[pass.origin++]);
          if (!origin?.active || !friendly(g, origin.owner, p.slot)) continue;
          if (assignJob(g, u, target, origin, hooks)) {
            assigned = true; targets.splice(targets.indexOf(target), 1); s.jobs.set(p.slot, targets.length); break;
          }
        }
        pass.blocked ||= pass.origins.length > 0 && !assigned;
      }
      pass.target++; pass.origins = null;
    }
    s.scheduled.add(u.id); s.assignments.delete(u.id);
    if (u.convoy.state === 'idle' && targets.length) {
      if (pass.blocked) routeAlert(g, u, targets[0]);
      else if (pass.noStock) alert(g, p.slot, 'stock', 'No available supply stock or source for delivery', targets[0]);
    }
  }
  const own = [...g.units.values()].filter(u => u.owner === p.slot && u.hp > 0 && u.logistics);
  const critical = own.filter(u => u.logistics.provisions < 30 || u.logistics.ammoMax && u.logistics.ammo / u.logistics.ammoMax < .25);
  if (critical.length) alert(g, p.slot, 'low', `${critical.length} unit${critical.length === 1 ? '' : 's'} running low on supplies`, critical[0], critical.length);
  const forced = own.filter(u => u.logistics.forced), stranded = own.filter(u => u.logistics.stranded);
  if (forced.length) alert(g, p.slot, 'withdrawal', `${forced.length} unit${forced.length === 1 ? '' : 's'} must withdraw for supplies`, forced[0], forced.length);
  if (stranded.length) alert(g, p.slot, 'stranded', `${stranded.length} unit${stranded.length === 1 ? '' : 's'} cannot complete supply withdrawal`, stranded[0], stranded.length);
  const incoming = new Set();
  for (const t of g.units.values()) if (t.owner === p.slot && t.hp > 0 && t.convoy && ['delivering', 'unloading'].includes(t.convoy.state) && quantity(t.convoy.cargo)) for (const id of t.convoy.target?.members ?? []) incoming.add(id);
  const transit = critical.filter(u => incoming.has(u.id));
  if (transit.length) alert(g, p.slot, 'transit', `Supplies are in transit to ${transit.length} unit${transit.length === 1 ? '' : 's'}`, transit[0], transit.length);
  return true;
}

// A world route plan costs about 4 ms (up to 50): rechecking every truck on the cycle tick put 10 to 40 of them in one
// tick. The cycle queues the trucks instead, and they are served a few route plans per tick, in order.
const ROUTES_PER_TICK = 3;
// A stuck truck on a trip that still holds plans only a detour back onto its route about 30 m ahead, not the whole
// trip again (a quarter of all route checks found a truck stuck, mostly in traffic near its HQ).
function repairRoute(g, u, hooks) {
  const i = u.path.findIndex(p => distance(u, p) >= 30), at = i < 0 ? u.path.length - 1 : i, rejoin = u.path[at];
  const detour = hooks.route(u, rejoin, true); g.convoys.routed++;
  if (!detour.length || distance(detour.at(-1), rejoin) > 1) return false;
  u.path = [...detour, ...u.path.slice(at + 1)]; u.stuck = 0;
  u.convoy.route = u.path.map(p => ({ x: p.x, z: p.z }));
  return true;
}
function refreshRoutes(g, hooks) {
  const s = g.convoys;
  while (s.refreshQueue.length && s.routed < ROUTES_PER_TICK) {
    const u = g.units.get(s.refreshQueue.shift()), c = u?.convoy;
    if (u?.type !== 'truck' || u.hp <= 0 || !c || c.manual || c.hold) continue;
    const resume = c.state === 'waitingCollect' ? 'collecting' : c.state === 'waiting' ? 'delivering' : c.state === 'waitingReturn' ? 'returning' : c.state;
    if (!['collecting', 'delivering', 'returning'].includes(resume)) continue;
    let target = resume === 'delivering' ? c.target : g.convoys.stores.get(c.origin);
    if (resume !== 'delivering' && (!target?.active || !friendly(g, target.owner, u.owner))) {
      target = sources(g, u.owner).sort((a, b) => distance(a, u) - distance(b, u))[0];
      if (!target) {
        c.state = resume === 'collecting' ? 'waitingCollect' : 'waitingReturn';
        u.path = []; u.worldGoal = null; c.route = [];
        alert(g, u.owner, 'stock', 'No available supply source for collection or return', u);
        continue;
      }
      c.origin = target.id;
    }
    if (!target) { finishJob(g, u, hooks); continue; }
    if (resume === 'delivering') {
      const recipient = target.store ? g.convoys.stores.get(target.store) : g.units.get(target.unit);
      if (recipient) Object.assign(target, { x: recipient.x, z: recipient.z });
    }
    // already driving there (a World Conquest truck follows worldGoal in legs, so its path may be empty between
    // them): keep the route. Re-routing every truck each dispatch cost two world-size path searches
    // apiece (there and home) and stalled the server every 2 s. A target that has moved off gets a new route.
    const onCourse = c.state === resume && c.destination && distance(c.destination, target) < L.truckRadius;
    if (onCourse && u.path.length && (u.stuck ?? 0) > .5 && repairRoute(g, u, hooks)) continue;
    if (onCourse && (u.path.length || u.worldGoal) && hooks.continueRoute?.(u, target) === true) continue;
    if (sendTruck(g, u, target, hooks)) c.state = resume;
    else {
      c.state = resume === 'collecting' ? 'waitingCollect' : resume === 'returning' ? 'waitingReturn' : 'waiting';
      u.path = []; u.worldGoal = null; c.route = [];
      routeAlert(g, u, target);
    }
  }
}

export function stepConvoys(g, dt, hooks) {
  if (!g.convoys || g.winner !== null) return;
  const s = g.convoys; s.routed = 0;
  if (g.tick >= s.nextSchedule) {
    syncStores(g, hooks);
    // an unfinished pass carries on first (with many trucks it can outlast a cycle), so no truck or player starves
    if (!s.refreshQueue.length) s.refreshQueue = [...g.units.values()].filter(u => u.type === 'truck' && u.convoy).map(u => u.id);
    if (!s.scheduleQueue.length) { s.scheduleQueue = g.players.map(p => p.slot); s.scheduled = new Set(); s.assignments.clear(); }
    // jobs counted before the fleet sizes itself, so a new job gets its truck this cycle
    for (const p of g.players) if (!p.out && !p.away) s.jobs.set(p.slot, targetsFor(g, p.slot, hooks).length);
    s.nextSchedule = g.tick + Math.round(L.dispatchSeconds * 20);
  }
  refreshRoutes(g, hooks); fleet(g, hooks); schedule(g, hooks);
  localService(g, dt, hooks);
  territoryService(g, dt, hooks);
  for (const u of g.units.values()) {
    if (u.type !== 'truck' || u.hp <= 0 || u.convoy.hold) continue;
    const c = u.convoy;
    if (c.state === 'manual') {
      if (!u.path.length && !u.worldGoal && !u.orders.length) { c.manual = false; c.state = 'idle'; }
      continue;
    }
    const arrived = c.destination && distance(u, c.destination) <= L.truckRadius && (!u.path.length || distance(u, u.worldGoal ?? c.destination) < 1);
    const origin = g.convoys.stores.get(c.origin);
    // Trucks parked around an HQ block the exact end of a route there (nine in ten stuck trucks were within 20 m of
    // their own HQ, most of them coming home): stuck within loading reach of the source counts as there.
    const atSource = ['collecting', 'returning'].includes(c.state) && (u.stuck ?? 0) > .5 && origin?.active && distance(u, origin) <= L.sourceRadius && hooks.handoff(u, origin, L.sourceRadius);
    if (c.state === 'collecting' && (arrived || atSource) && origin?.active && hooks.handoff(u, origin, L.sourceRadius)) { c.state = 'loading'; c.timer = L.loadSeconds; u.path = []; u.worldGoal = null; }
    if (c.state === 'loading') { c.timer -= dt; if (c.timer <= 0) loadJob(g, u, hooks); }
    else if (c.state === 'delivering' && arrived) { c.state = 'unloading'; c.timer = L.unloadSeconds; u.path = []; u.worldGoal = null; }
    else if (c.state === 'unloading') deliver(g, u, dt, hooks);
    else if (c.state === 'returning' && (arrived || atSource)) {
      if (!origin?.active || !hooks.handoff(u, origin, L.sourceRadius)) { c.state = 'waitingReturn'; continue; }
      moveStock(c.cargo, bucket(origin, u.owner), storeSpace(origin));
      c.state = 'idle'; c.target = null; c.destination = null; u.path = []; u.worldGoal = null;
    } else if (['waiting', 'waitingReturn', 'waitingCollect'].includes(c.state) && g.tick % 40 === u.id % 40) {
      const waiting = c.state, target = waiting === 'waiting' ? c.target : g.convoys.stores.get(c.origin);
      if (target && sendTruck(g, u, target, hooks, c.manual)) c.state = waiting === 'waiting' ? 'delivering' : waiting === 'waitingCollect' ? 'collecting' : 'returning';
    }
  }
}

export function convoyDeath(g, u) {
  if (!g.convoys) return;
  if (u.type === 'truck') {
    const list = g.convoys.losses.get(u.owner) ?? []; list.push(g.tick / 20 + L.replacementSeconds); g.convoys.losses.set(u.owner, list);
  }
  for (const [id, store] of g.convoys.stores) if (store.entity === u.id) {
    if (store.region !== undefined) { store.buckets.clear(); store.donations?.clear(); store.active = false; store.lostAt = g.tick / 20; }
    else g.convoys.stores.delete(id);
  }
}

export function supportProvision(g, at, owner, amount, hooks) {
  if (!g.convoys) return true;
  const stores = [...g.convoys.stores.values()].filter(s => s.active && friendly(g, s.owner, owner) && distance(s, at) <= L.sourceRadius && (!hooks?.handoff || hooks.handoff(at, s, L.sourceRadius)));
  for (const s of stores) {
    if (s.source) return true;
    if (availableStock(s, owner).provisions >= amount) { consumeStock(s, owner, { provisions: amount }); return true; }
  }
  if (at.owner === owner && at.hp > 0 && g.units.get(at.id) === at && at.logistics?.provisions >= amount) {
    at.logistics.provisions -= amount; return true;
  }
  return false;
}

export function commandConvoy(g, slot, cmd, hooks) {
  if (!g.convoys) return null;
  if (cmd.orders !== undefined && (!Array.isArray(cmd.orders) || cmd.orders.some(row => !Array.isArray(row) || row.length < 3 || !Number.isSafeInteger(row[0]) || !Number.isFinite(row[1]) || !Number.isFinite(row[2])))) return { result: 'blocked' };
  const ids = Array.isArray(cmd.ids) ? cmd.ids : Array.isArray(cmd.orders) ? cmd.orders.map(o => o[0]) : [];
  const trucks = ids.map(id => g.units.get(id)).filter(u => u?.type === 'truck' && u.owner === slot && u.hp > 0);
  if (cmd.t === 'logisticsResume') {
    if (!trucks.length) return { result: 'needs' };
    for (const u of trucks) {
      const c = u.convoy;
      c.manual = false; c.hold = false; u.path = []; u.worldGoal = null; u.orders = [];
      if (quantity(c.cargo)) {
        if (c.target) { c.state = sendTruck(g, u, c.target, hooks) ? 'delivering' : 'waiting'; }
        else finishJob(g, u, hooks);
      } else if (c.target) {
        const origin = g.convoys.stores.get(c.origin);
        if (!origin?.active || !assignJob(g, u, c.target, origin, hooks)) { c.state = 'idle'; c.target = null; }
      } else c.state = 'idle';
    }
    return { result: undefined };
  }
  if (cmd.t === 'supply') {
    const targetUnit = g.units.get(cmd.target);
    if (!trucks.length || !targetUnit || !friendly(g, targetUnit.owner, slot) || targetUnit.hp <= 0 || (!targetUnit.logistics && targetUnit.type !== 'supplycache')) return { result: 'needs' };
    if (targetUnit.type === 'supplycache' && !(targetUnit.built >= 1)) return { result: 'needs' };
    let store = [...g.convoys.stores.values()].find(s => s.entity === targetUnit.id && s.active && s.owner === targetUnit.owner);
    if (!store && targetUnit.type === 'supplycache') {
      if (targetUnit.regionCache !== undefined) return { result: 'needs' };
      store = addStore(g, `cache:${targetUnit.id}`, targetUnit.owner, targetUnit, false, targetUnit.id);
    }
    const target = { id: store?.id ?? `unit:${targetUnit.id}`, store: store?.id, unit: store ? undefined : targetUnit.id, members: store ? undefined : [targetUnit.id], owner: targetUnit.owner, x: targetUnit.x, z: targetUnit.z, need: store ? storeSpace(store) : missing(targetUnit), relief: targetUnit.type === 'supplycache' && targetUnit.owner !== slot };
    let success = false;
    for (const u of trucks) {
      if (quantity(u.convoy.cargo)) {
        if (sendTruck(g, u, target, hooks, true)) { u.convoy.target = { ...target }; u.convoy.manual = true; u.convoy.hold = false; u.convoy.state = 'delivering'; success = true; }
      }
      else { const origin = originsFor(g, slot, target)[0]; if (origin) success = assignJob(g, u, { ...target }, origin, hooks, true) || success; }
    }
    return { result: success ? undefined : 'blocked' };
  }
  if (trucks.length && ['move', 'amove', 'stop', 'retreat'].includes(cmd.t)) {
    if (cmd.t === 'move' || cmd.t === 'amove' || cmd.t === 'retreat') {
      for (const u of trucks) {
        const order = cmd.orders?.find(o => o[0] === u.id);
        const at = cmd.t === 'retreat' ? sources(g, u.owner).sort((a, b) => distance(a, u) - distance(b, u))[0] : order ? { x: order[1], z: order[2] } : { x: cmd.x, z: cmd.z };
        if (!at) return { result: 'blocked' };
        if (!Number.isFinite(at.x) || !Number.isFinite(at.z)) return { result: 'blocked' };
        let planned = [], from = u;
        if (cmd.queue && (u.path.length || u.orders.length || u.worldGoal || u.amove)) {
          const currentGoal=u.worldGoal ?? u.amove ?? u.path.at(-1);
          planned=currentGoal ? hooks.route(u,currentGoal,false) : [];
          if(currentGoal && !planned.length && distance(u,currentGoal)>1) return {result:'blocked'};
          from = planned.at(-1) ?? u;
          for (const queued of u.orders) {
            const row = queued.orders?.find(o => o[0] === u.id);
            const waypoint = row ? { x: row[1], z: row[2] } : queued;
            if (!Number.isFinite(waypoint.x) || !Number.isFinite(waypoint.z)) continue;
            const leg = hooks.route({ ...u, x: from.x, z: from.z }, waypoint, false);
            planned.push(...leg); from = leg.at(-1) ?? from;
          }
        }
        const route = hooks.route({ ...u, x: from.x, z: from.z }, at, false);
        if (!route.length && distance(from, at) > 1) return { result: 'blocked' };
      }
    }
    for (const u of trucks) {
      u.convoy.manual = true; u.convoy.hold = cmd.t === 'stop';
      if (cmd.t !== 'stop') u.convoy.target = null;
      u.convoy.state = cmd.t === 'stop' ? 'held' : 'manual';
    }
  }
  return null;
}

export function logisticsSnapshot(g, slot) {
  if (!g.convoys) return undefined;
  const p = g.players[slot], visible = store => friendly(g, store.owner, slot);
  return {
    enabled: true,
    units: [...g.units.values()].filter(u => u.owner === slot && u.logistics).map(u => ({ id: u.id, ammo: u.logistics.ammoMax ? round(u.logistics.ammo / u.logistics.ammoMax) : null, provisions: round(u.logistics.provisions), fuel: u.logistics.fuel === null ? null : round(u.logistics.fuel), emergency: u.logistics.emergency === null ? null : round(u.logistics.emergency), warning: u.logistics.warning === null ? null : round(u.logistics.warning), forced: u.logistics.forced, stranded: u.logistics.stranded,
      supply: round((u.logistics.cutFor ?? 0) >= L.supplyGrace ? 0 : u.logistics.supplyRate ?? 0), cut: (u.logistics.cutFor ?? 0) >= L.supplyGrace,
      grace: u.logistics.cutFor > 0 && u.logistics.cutFor < L.supplyGrace ? Math.ceil(L.supplyGrace - u.logistics.cutFor) : null })),
    regions: g.world && g.supplyNet?.[p.team]?.rate ? g.world.regions.flatMap((r, i) => r.team === p.team ? [[r.id, round(g.supplyNet[p.team].rate[i])]] : []) : undefined,
    trucks: [...g.units.values()].filter(u => u.owner === slot && u.convoy).map(u => ({ id: u.id, state: u.convoy.state, manual: u.convoy.manual, hold: u.convoy.hold, cargo: Object.fromEntries(keys.map(k => [k, round(u.convoy.cargo[k])])), destination: u.convoy.destination, route: u.path.map(at => ({ x: round(at.x), z: round(at.z) })) })),
    stores: [...g.convoys.stores.values()].filter(s => s.active && visible(s)).map(s => ({ id: s.id, owner: s.owner, x: round(s.x), z: round(s.z), source: s.source, stock: availableStock(s, slot), capacity: { ...s.capacity } })),
    events: g.convoys.events.filter(e => e.owner === slot).map(({ owner, at, ...e }) => e),
  };
}
