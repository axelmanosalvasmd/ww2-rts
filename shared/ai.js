// Simple AI player. Runs on the server every couple of seconds and plays through command(),
// exactly like a human would. Planning receives only a detached per-seat observation.
import { UNITS, CELL, CFG, COVER, MOVE, TRENCH, FORTS, command, SUPPORT, abCost, canBuild, allied, supCost, siteNear, priceOf } from './sim.js';
import { viewFor } from './ai-view.js';
import { gridFor, rebuildGrid } from './grid.js';

const d = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const SUPPORT_PLANE = (kind) => kind === 'strafe' || kind === 'bombing' || kind === 'dive' || kind === 'para';

function houseNear(view, p, r) {
  let best = null, bd = Infinity;
  for (let y = Math.floor((p.z - r) / CELL); y <= (p.z + r) / CELL; y++)
    for (let x = Math.floor((p.x - r) / CELL); x <= (p.x + r) / CELL; x++) {
      if (x < 0 || y < 0 || x >= view.w || y >= view.h || view.chars[y * view.w + x] !== 'B') continue;
      const c = { x: (x + 0.5) * CELL, z: (y + 0.5) * CELL }, dd = d(c, p);
      if (dd < bd) { bd = dd; best = c; }
    }
  return best;
}

function trenchesNear(view, p, r) {
  let n = 0;
  for (let y = Math.floor((p.z - r) / CELL); y <= (p.z + r) / CELL; y++)
    for (let x = Math.floor((p.x - r) / CELL); x <= (p.x + r) / CELL; x++)
      if (x >= 0 && y >= 0 && x < view.w && y < view.h && view.flags[y * view.w + x] & TRENCH) n++;
  return n;
}

// how many of my side's mines lie within r of p (the view's terrain shows only the mines my side laid)
const minesNear = (view, p, r) => view.mines.filter(m => d(p, m) <= r).length;

// A blown bridge to put back: the map's bridge cells are noted on the first look, and one that is river now gets a
// builder squad. The span runs along the shorter stretch of water through the cell. One job per look.
function rebuildBridge(view, slot, squads, enemies, busy, mem, submit) {
  const me = view.players[slot], now = view.tick / 20;
  mem.bridges ??= view.mapChars.flatMap((ch, c) => (ch === '=' ? [c] : []));
  // The squad this AI sent to dig a bridge is remembered, since a view shows that a squad digs but not what.
  const crew = mem.bridgeCrew ??= new Map(), byId = new Map(squads.map(u => [u.id, u]));
  for (const [id, job] of crew) {
    const u = byId.get(id);
    if (!u || (job.dug && !u.dig) || now - job.t > 90) crew.delete(id); else if (u.dig) job.dug = true;
  }
  if (me.mp < FORTS.bridge.cost + 150 || squads.some(u => u.dig && crew.has(u.id))) return;
  const at = (c) => ({ x: (c % view.w + 0.5) * CELL, z: (Math.floor(c / view.w) + 0.5) * CELL });
  const idle = squads.filter(u => CFG.fortBuilders.includes(u.type) && !u.retreating && !u.targetId && !u.dig && u.garrison < 0);
  const gap = mem.bridges.filter(c => view.chars[c] === 'W' && !enemies.some(e => d(e, at(c)) < 35))
    .sort((a, b) => d(at(a), me.spawn) - d(at(b), me.spawn))[0];
  if (gap === undefined || !idle.length) return;
  // how far the water runs each way from the gap, along x and along y
  const run = (step) => { let lo = 0, hi = 0; while (lo > -8 && view.chars[gap + (lo - 1) * step] === 'W') lo--; while (hi < 8 && view.chars[gap + (hi + 1) * step] === 'W') hi++; return [lo, hi]; };
  const [x0, x1] = run(1), [y0, y1] = run(view.w), alongX = x1 - x0 <= y1 - y0;
  const mid = at(gap), off = (alongX ? x0 + x1 : y0 + y1) / 2 * CELL;
  const spot = { x: mid.x + (alongX ? off : 0), z: mid.z + (alongX ? 0 : off) };
  const u = idle.sort((a, b) => d(a, spot) - d(b, spot))[0];
  busy.add(u.id);
  // out of sight (every cell of the span must be seen, and a bomb crater hides them from afar): walk up to its own
  // bank first, to a point just inside the builders' reach (the middle of the river has no reachable nearest cell)
  const refused = submit({ t: 'dig', ids: [u.id], kind: 'bridge', x: spot.x, z: spot.z, dir: alongX ? 0 : Math.PI / 2 });
  if (refused === undefined) crew.set(u.id, { t: now, dug: false });
  else if (!u.path.length) {
    const k = Math.min(1, (FORTS.bridge.reach - 2) / (d(u, spot) || 1));
    submit({ t: 'move', orders: [[u.id, spot.x + (u.x - spot.x) * k, spot.z + (u.z - spot.z) * k]] });
  }
}

// a random cover cell near the point, so squads dig in instead of standing in the open
function spotNear(view, p) {
  const r = Math.floor((CFG.pointRadius - 2) / CELL), cx = Math.floor(p.x / CELL), cy = Math.floor(p.z / CELL), cover = [];
  for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
    const f = view.flags[y * view.w + x];
    if (x >= 0 && y >= 0 && x < view.w && y < view.h && f & COVER && !(f & MOVE)) cover.push({ x: (x + 0.5) * CELL, z: (y + 0.5) * CELL });
  }
  if (cover.length) return cover[Math.floor(Math.random() * cover.length)];
  const a = Math.random() * Math.PI * 2;
  return { x: p.x + Math.cos(a) * 4, z: p.z + Math.sin(a) * 4 };
}

// What each AI remembers seeing: enemy unit id -> { type, owner, x, z, t (seconds), val (cost x health) }.
// Kept out of the game state; only fed by what the AI's team can see.
const MEMORY = new WeakMap();
const memoryOf = (g, slot) => { if (!MEMORY.has(g)) MEMORY.set(g, []); const m = MEMORY.get(g); return (m[slot] ??= {}); };
const knownBuildings = (view) => view.ghosts;
const inCover = (_view, u) => u.cover === 1 || u.cover === 2;

// Refresh on the same beat as human snapshots. A think between beats uses the previous view.
export function observe(g, slot, cache) { return viewFor(g, slot, memoryOf(g, slot), cache); }
const worth = (u) => UNITS[u.type].cost * u.hp / (UNITS[u.type].models * UNITS[u.type].hpPer);

// opts.adaptive = false plays the plain scripted Classic AI; opts.rules = [1..5] turns on only those adaptive rules
// (both for measuring the rules against the scripted AI).
// opts.view supplies the latest delivered observation, opts.memory isolates a history, and opts.submit intercepts orders.
export function think(g, slot, opts = {}) {
  const mem = opts.memory ?? memoryOf(g, slot);
  mem.seen ??= new Map(); mem.node ??= new Map();
  const view = opts.view ?? viewFor(g, slot, mem);
  return plan(view, slot, opts, mem, opts.submit ?? (cmd => command(g, slot, cmd)));
}

// This function has no reference to authoritative state. All actions use the slot-bound submit handle.
function plan(observation, slot, opts, mem, send) {
  // Mirror accepted orders locally so later decisions in this turn see their own spending and throws.
  const view = { ...observation, players: observation.players.map(p => ({ ...p, sup: p.sup && { ...p.sup } })),
    units: new Map([...observation.units].map(([id, u]) => [id, structuredClone(u)])) };
  const submit = (cmd) => {
    const result = send(cmd);
    if (result !== undefined) return result;
    const me = view.players[slot];
    if (cmd.t === 'buy') { const price = priceOf(view, cmd.unit); me.mp -= price.mp; if (price.fuel) me.fuel -= price.fuel; }
    else if (cmd.t === 'support') { const { cur, cost } = supCost(view, cmd.kind); me[cur] -= cost; me.sup[cmd.kind] = SUPPORT[cmd.kind].cd; }
    else if (cmd.t === 'build') me.mp -= UNITS[cmd.kind].cost;
    else if (cmd.t === 'dig') me.mp -= FORTS[cmd.kind ?? 'trench']?.cost ?? CFG.digCost;
    for (const id of cmd.ids ?? []) {
      const u = view.units.get(id);
      if (!u || u.owner !== slot) continue;
      if (cmd.t === 'ability') {
        const ab = UNITS[u.type].ab;
        if (['grenade', 'satchel', 'barrage'].includes(ab.id)) u.nade = { x: cmd.x, z: cmd.z };
        else { const cost = abCost(view, ab); if (cost) me.mun -= cost; u.cd = ab.cd; if (ab.id === 'ura') u.supp = 0; }
      } else if (cmd.t === 'build' || cmd.t === 'assist') u.build = 1;
      else if (cmd.t === 'garrison') u.enter = 0;
      else if (cmd.t === 'fireat') u.fireAt = 0;
      else if (cmd.t === 'dig') u.dig = { x: cmd.x, z: cmd.z };
      else if (cmd.t === 'entrench') u.entrench = { x: cmd.x, z: cmd.z };
      else if (cmd.t === 'stance') u[cmd.key] = cmd.on;
    }
  };
  const grid = rebuildGrid(view);
  const me = view.players[slot];
  if (me.out) return;
  const all = grid.ownedBy(slot).filter(u => !UNITS[u.type].structure);
  const horde = view.mode?.kind === 'horde' && slot === view.mode.slot; // the horde itself: no shopping, no retreat, straight at the bunker
  const assault = view.mode?.kind === 'assault' || view.mode?.kind === 'annihilation' || view.mode?.kind === 'horde', defending = assault && me.team === view.mode.defenderTeam, classic = view.mode?.kind === 'classic';
  // what the army marches on: assault bunkers, or in Classic the enemy's Production Buildings
  // (Classic: only buildings its team has seen, remembered under fog; with none known, head for the enemy spawns)
  const known = classic ? knownBuildings(view, slot).filter(b => UNITS[b.type].produces && view.players[b.owner].team !== me.team) : [];
  const bunkers = (assault ? [...view.units.values()].filter(u => UNITS[u.type].structure && !UNITS[u.type].building && me.visible.has(u.id) && view.players[u.owner].team !== me.team)
    : !classic ? [] : known.length ? known : view.players.filter(q => q.team !== me.team && !q.out).map(q => q.spawn))
    .sort((a, b) => d(a, me.spawn) - d(b, me.spawn)); // nearest first, so nobody gangs up on whoever was created first
  const count = (t) => all.filter(u => u.type === t).length;
  // ---- Classic adaptive AI: remember the last minute of sightings, then react ----
  const adapt = classic && opts.adaptive !== false, now = view.tick / 20, rule = (n) => adapt && (!opts.rules || opts.rules.includes(n));
  const recent = adapt ? [...mem.seen.values()] : [];
  const ownB = classic ? grid.ownedBy(slot).filter(b => UNITS[b.type].building) : [];
  // rule 2, rush defense: enemy fighters at my buildings in the first 4 minutes
  const rush = rule(2) && now < 240 ? recent.filter(e => now - e.t < 5 && ownB.some(b => d(b, e) < 35)) : [];
  // rule 1, counters: tanks seen lately push the Motor Pool (for AT guns) up the build order
  const seenArmor = recent.filter(e => e.type === 'tank' || e.type === 'tiger').length, seenInf = recent.filter(e => UNITS[e.type].infantry).length;
  const reserve = classic ? (rush.length ? 0 : 1) * buildEconomy(view, slot, all.filter(u => u.type === 'engineer'), rule(1) && seenArmor > 0, mem, submit) : 0;
  // Classic: only what my finished buildings can train
  const trains = (t) => !classic || grid.ownedBy(slot).some(b => b.built >= 1 && UNITS[b.type].makes?.includes(t));
  const mine = all.filter(u => u.type !== 'engineer'); // Engineers build; everyone else fights
  // auto-retreat on for the whole army: a broken unit runs the moment it breaks, not at the next decision
  const steady = all.filter(u => !u.air && !u.autoRetreat);
  if (steady.length) submit({ t: 'stance', ids: steady.map(u => u.id), key: 'autoRetreat', on: true });
  const seenTanks = Math.max([...me.visible].filter(id => view.units.get(id)?.type === 'tank').length, rule(1) ? seenArmor : 0);

  // shopping: counter tanks it has seen, get one tank once the infantry is out, a mortar for dug-in enemies, a sniper
  // against infantry crowds, an armored car to scout and raid, else 2 rifles per MG
  const seenGarrison = [...me.visible].some(id => view.units.get(id)?.garrison >= 0);
  const seenDugIn = [...me.visible].some(id => { const e = view.units.get(id); return e && !allied(view, e.owner, slot) && (e.type === 'mg' || e.type === 'at') && inCover(view, e); });
  const tanks = count('tank') + count('medium') + count('tiger');
  // air: enemy planes it can see now (they're visible from far away), its own anti-air and planes
  const enemyPlanes = [...me.visible].filter(id => view.units.get(id)?.air).length, flakN = count('flak') + count('flaktrack');
  const airWant = enemyPlanes && flakN < Math.min(3, Math.ceil(enemyPlanes / 2)) ? (trains('flaktrack') && tanks ? 'flaktrack' : 'flak')
    : enemyPlanes > count('fighter') && trains('fighter') ? 'fighter' : count('attacker') < 2 && mine.length >= 8 && trains('attacker') ? 'attacker' : null;
  const want = airWant ? airWant : seenTanks > count('at') ? 'at' : seenGarrison && count('rocket') < 1 ? 'rocket' : tanks < 1 && mine.length >= 4 ? 'tank'
    : (seenDugIn || mine.length >= 6) && count('mortar') < 1 ? 'mortar' : seenInf >= 6 && count('sniper') < 1 && mine.length >= 5 ? 'sniper'
    : count('armoredcar') < 1 && mine.length >= 7 ? 'armoredcar' : tanks < 2 && mine.length >= 8 ? 'tank'
    : count('mg') * 2 < count('rifle') || (rule(1) && seenInf >= 6 && count('mg') < 3) ? 'mg' : 'rifle'; // many infantry seen: more MGs
  // faction flavor: USA mixes in Rangers, Germany saves up for its Tiger, USSR fields Conscripts instead of rifles
  let buy = want;
  // the medium tank is the mainline tank once it can be afforded; the light tank is the cheap fallback
  const affords = (t) => { const pr = priceOf(view, t); return me.mp >= pr.mp && !(pr.fuel > (me.fuel ?? 0)); };
  if (want === 'tank' && trains('medium') && affords('medium')) buy = 'medium';
  if (want === 'rifle' && canBuild('conscript', me.faction)) buy = 'conscript';
  if (want === 'rifle' && canBuild('ranger', me.faction) && count('ranger') < 2 && count('rifle') >= 1) buy = 'ranger';
  // Tiger only when it's affordable right now: saving up for it starved the German army
  if (canBuild('tiger', me.faction) && count('tiger') < 1 && mine.length >= 5 && affords('tiger') && (want === 'tank' || want === 'rifle')) buy = 'tiger';
  // Classic: keep an Engineer while there are nodes to build on
  // Classic: no building for it, or no Fuel for a vehicle: infantry instead
  if (!trains(buy) || !canBuild(buy, me.faction) || priceOf(view, buy).fuel > (me.fuel ?? 0)) buy = trains('conscript') && canBuild('conscript', me.faction) ? 'conscript' : 'rifle';
  if (classic && count('engineer') < (view.nodes.some((_, i) => !view.claimedNodes.has(i)) ? 2 : 1)) buy = 'engineer';
  // Classic: save up for the next building, unless the army is nearly gone
  // big armies: buy several at a time (one per decision can't keep a 60-unit army topped up)
  if (!horde) for (let k = 0; k < (view.army?.pop > 1 ? 4 : 1); k++) if (me.mp - (mine.length >= 3 ? reserve : 0) >= priceOf(view, buy).mp) submit({ t: 'buy', unit: buy });

  // how many of my units are at or heading to each point
  const pointOf = (pos) => view.points.findIndex(p => d(pos, p) <= CFG.pointRadius);
  const load = view.points.map(() => 0), holding = view.points.map(() => 0);
  for (const u of mine) {
    const i = pointOf(u.path.length ? u.path.at(-1) : u);
    if (i >= 0) load[i]++;
  }

  const orders = [], assault_ = [], retreat = [], pending = view.points.map(() => []), heading = [...load];
  const enemies = [...me.visible].map(id => view.units.get(id)).filter(Boolean);
  const enemyOrder = new Map(enemies.map((u, i) => [u.id, i]));
  const enemiesNear = (at, r) => grid.radius(at, r).filter(u => enemyOrder.has(u.id)).sort((a, b) => enemyOrder.get(a.id) - enemyOrder.get(b.id));

  // off-map support, keeping 100 MP back so reinforcing never stalls
  const can = (k) => { const { cur, cost } = supCost(view, k); return me.sup[k] <= 0 && me[cur] >= cost + (cur === 'mp' ? 100 : 0); };
  const cluster = (min, r, test = () => true) => {
    for (const e of enemies) {
      const near = enemiesNear(e, r).filter(o => test(o) && d(o, e) <= r);
      if (near.length >= min) return { x: near.reduce((a, o) => a + o.x, 0) / near.length, z: near.reduce((a, o) => a + o.z, 0) / near.length };
    }
  };
  const call = (kind, at, dir) => at && submit({ t: 'support', kind, x: at.x, z: at.z, dir });
  // bombs for tanks and for squads holed up in houses
  // an enemy air strike announced near my units: put fighter cover over it (cover arrives in 2s, strikes take 3-6s)
  const incoming = view.strikes.find(q => q.t > 0 && !allied(view, q.owner, slot) && SUPPORT_PLANE(q.kind) && mine.some(u => d(u, q) < 25));
  if (incoming && can('cover')) call('cover', incoming);
  const heavy = enemies.find(e => e.type === 'tank' || e.type === 'medium' || e.type === 'tiger' || e.type === 'flaktrack');
  if (heavy && can('dive')) call('dive', heavy);
  const dropZone = view.points.find(q => q.owner >= 0 && !allied(view, q.owner, slot) && view.sees(q));
  if (dropZone && !horde && mine.length >= 6 && can('para')) call('para', dropZone);
  const bombTarget = enemies.find(e => e.type === 'tank') || enemies.find(e => e.garrison >= 0);
  if (bombTarget && can('bombing')) call('bombing', bombTarget);
  else if (can('artillery')) call('artillery', cluster(2, 8) || enemies.find(e => (e.type === 'mg' || e.type === 'at') && now - e.firstStillAt > 3));
  else if (can('strafe')) call('strafe', cluster(2, 10, o => UNITS[o.type].infantry));
  if (can('recon') && !enemies.length && (classic || me.mp > 250)) call('recon', view.points.find(p => p.owner >= 0 && !allied(view, p.owner, slot)));
  const busy = new Set();
  rebuildBridge(view, slot, mine.filter(u => !u.air), enemies, busy, mem, submit);
  if (adapt) {
    const free = mine.filter(u => !u.retreating && !u.targetId);
    // a hurt squad is left to the normal logic, which pulls it back to reinforce
    const send = (u, at) => { if (worth(u) < UNITS[u.type].cost * 0.4) return; busy.add(u.id); if (!u.amove || d(u.amove, at) > 6) assault_.push([u.id, at.x, at.z]); };
    if (rush.length) {
      // everyone home to meet it, Engineers out of the way
      const c = { x: rush.reduce((a, e) => a + e.x, 0) / rush.length, z: rush.reduce((a, e) => a + e.z, 0) / rush.length };
      for (const u of mine) if (!u.retreating) send(u, c);
      for (const u of all.filter(u => u.type === 'engineer' && d(u, c) < 25)) submit({ t: 'move', orders: [[u.id, me.spawn.x, me.spawn.z]] });
      if (can('artillery')) call('artillery', c);
    } else {
      // rule 5, scout when blind: no enemy base known yet, so fly recon over the likeliest spawn
      // (a lone scouting squad just died on the way; the army already heads for the spawns when it attacks)
      const spawns = view.players.filter(q => q.team !== me.team && !q.out).map(q => q.spawn).sort((a, b) => d(a, me.spawn) - d(b, me.spawn));
      if (rule(5) && !known.length && spawns.length && can('recon')) call('recon', spawns[0]);
      // rule 4, raid a depot nobody has been seen guarding for 30s
      const raiders = mem.raid ? mem.raid.ids.map(id => view.units.get(id)).filter(u => u && u.owner === slot) : [];
      if (mem.raid && (!raiders.length || !knownBuildings(view, slot).some(b => b.id === mem.raid.id))) mem.raid = null;
      if (rule(4) && !mem.raid) {
        const depot = knownBuildings(view, slot).filter(b => b.type === 'depot' && view.players[b.owner].team !== me.team && !recent.some(e => now - e.t < 30 && d(e, b) < 25))
          .sort((a, b) => d(a, me.spawn) - d(b, me.spawn))[0];
        const fast = (u) => (u.type === 'armoredcar' ? 0 : 1); // armored cars are the raiders
        const pick = depot && free.filter(u => !busy.has(u.id) && !['mg', 'at', 'mortar', 'sniper'].includes(u.type)).sort((a, b) => fast(a) - fast(b) || d(a, depot) - d(b, depot)).slice(0, 2);
        if (pick?.length === 2) mem.raid = { id: depot.id, ids: pick.map(u => u.id), at: { x: depot.x, z: depot.z } };
      }
      if (mem.raid) for (const u of mem.raid.ids.map(id => view.units.get(id)).filter(u => u && u.owner === slot)) send(u, mem.raid.at);
    }
  }
  // rule 3, attack timing: march on a base only with an army worth 1.3x what that enemy was recently seen fielding
  const target = bunkers[0], myVal = mine.reduce((a, u) => a + worth(u), 0);
  const theirVal = target?.owner === undefined ? 0 : recent.filter(e => now - e.t < CFG.classic.aiSeenWindow && view.players[e.owner].team === view.players[target.owner].team).reduce((a, e) => a + e.val, 0);
  const strongEnough = !rule(3) || myVal > CFG.classic.aiAttackRatio * theirVal;

  // planes: a ready ground-attack plane goes for the nearest enemy tank or gun it can see near the army; a ready fighter
  // hunts enemy planes it can see, else covers the army. They come home on their own when fuel or ammo runs out.
  const army = mine.filter(u => !u.air), front = army.length ? { x: army.reduce((a, u) => a + u.x, 0) / army.length, z: army.reduce((a, u) => a + u.z, 0) / army.length } : me.spawn;
  for (const u of mine.filter(u => u.air && u.air.state === 'base')) {
    if (u.type === 'attacker') {
      const t = enemies.filter(e => !e.air && !UNITS[e.type].building && (!UNITS[e.type].infantry || e.type === 'at' || e.type === 'flak' || e.type === 'mortar')).sort((a, b) => d(a, front) - d(b, front))[0];
      if (t && d(t, front) < 120) submit({ t: 'attack', ids: [u.id], target: t.id });
    } else {
      const e = enemies.filter(e => e.air).sort((a, b) => d(a, front) - d(b, front))[0];
      submit({ t: 'move', orders: [[u.id, (e ?? front).x, (e ?? front).z]] });
    }
  }
  for (const u of mine) {
    if (u.air) continue; // planes are flown above
    if (busy.has(u.id)) continue;
    const def = UNITS[u.type], frac = u.hp / (def.models * def.hpPer), home = d(u, me.spawn) <= CFG.reinforceRadius;
    if (u.retreating) continue;

    // abilities
    const target = view.units.get(u.targetId);
    if (u.cd <= 0) {
      if (def.ab.id === 'grenade') {
        // lob it at a dug-in MG or AT gun, or any squad sitting in cover
        const t = enemiesNear(u, def.ab.range + 4).find(e => UNITS[e.type].infantry && d(u, e) <= def.ab.range + 4 && (e.type !== 'rifle' || inCover(view, e)));
        if (t) submit({ t: 'ability', ids: [u.id], x: t.x, z: t.z });
      } else if (def.ab.id === 'suppress' && target) submit({ t: 'ability', ids: [u.id] });
      else if (def.ab.id === 'ap' && target?.type === 'tank') submit({ t: 'ability', ids: [u.id] });
      else if (def.ab.id === 'smoke' && frac < 0.5 && !home) submit({ t: 'ability', ids: [u.id] });
      else if (def.ab.id === 'satchel') {
        // demolish a house the enemy is holding, or plant it on a tank
        const t = enemiesNear(u, 20).find(e => (e.garrison >= 0 || !UNITS[e.type].infantry) && d(u, e) <= 20);
        if (t) submit({ t: 'ability', ids: [u.id], x: t.x, z: t.z });
      } else if (def.ab.id === 'ura' && (u.supp >= 50 || (u.amove && enemiesNear(u, 30).some(e => d(u, e) < 30)))) submit({ t: 'ability', ids: [u.id] });
      else if (def.ab.id === 'barrage') { const t = enemiesNear(u, def.ab.range).find(e => e.garrison >= 0 && d(u, e) <= def.ab.range); if (t) submit({ t: 'ability', ids: [u.id], x: t.x, z: t.z }); }
    }
    // save hurt units instead of letting them die: retreat, get reinforced, come back
    if (!horde && !home && (frac < 0.35 || (u.supp >= 90 && frac < 0.6))) { retreat.push(u.id); continue; }
    if (!horde && home && frac < 1 && me.mp >= 20) continue; // wait for reinforcements
    // tanks knock down houses that enemy squads are hiding in
    if (def.w.shellTerrain && !u.targetId && u.fireAt < 0) {
      const house = enemiesNear(u, 60).find(e => e.garrison >= 0 && d(u, e) < 60);
      if (house) { submit({ t: 'fireat', ids: [u.id], x: house.x, z: house.z }); continue; }
    }
    if (u.path.length || u.attackId || u.nade || u.dig || u.enter >= 0 || u.fireAt >= 0) continue;
    if (u.targetId) continue; // in a fight: hold
    if (horde) { if (bunkers[0]) assault_.push([u.id, bunkers[0].x, bunkers[0].z]); continue; }
    const here = pointOf(u);
    // infantry stays to capture, and one squad stays behind to hold each captured point (and digs in)
    if (here >= 0 && def.infantry) {
      const p = view.points[here];
      if (!allied(view, p.owner, slot)) continue;
      if (holding[here]++ === 0) {
        // hold it from a house if there is one close by, otherwise dig in
        const house = u.garrison < 0 && def.garrisons && houseNear(view, p, CFG.pointRadius + 3);
        if (house && submit({ t: 'garrison', ids: [u.id], x: house.x, z: house.z }) === undefined) continue;
        const foe = view.players.filter(q => q.team !== me.team).sort((a, b) => d(a.spawn, p) - d(b.spawn, p))[0]?.spawn;
        if (!foe) continue;
        const l = d(foe, p) || 1, free = !u.dig && !u.entrench && CFG.fortBuilders.includes(u.type);
        // mines first, across the approach from the closest enemy HQ and just outside the point (laid from inside it,
        // so the squad still holds the point), then the trenches
        if (free && me.mp >= FORTS.mines.cost + 150 && minesNear(view, p, CFG.pointRadius + 10) < 2
          && submit({ t: 'dig', ids: [u.id], kind: 'mines', x: p.x + (foe.x - p.x) / l * (CFG.pointRadius + 2), z: p.z + (foe.z - p.z) / l * (CFG.pointRadius + 2), dir: Math.atan2(foe.z - p.z, foe.x - p.x) + Math.PI / 2 }) === undefined) continue;
        if (u.garrison < 0 && free && me.mp >= CFG.digCost + 150 && trenchesNear(view, p, CFG.pointRadius + 4) < 6) {
          // entrench toward the closest enemy HQ: an arc of trench, or a strongpoint when there is manpower to spare
          submit({ t: 'entrench', ids: [u.id], pattern: me.mp >= 600 ? 'strongpoint' : 'arc', x: p.x, z: p.z, x2: p.x + (foe.x - p.x) / l * 6, z2: p.z + (foe.z - p.z) / l * 6 });
        } else if (u.garrison < 0 && !u.dig && !u.entrench && !inCover(view, u)) submit({ t: 'cover', ids: [u.id] }); // stand in the trench, not beside it
        continue;
      }
    }
    // otherwise go for the closest point we don't hold, spreading out across targets
    let best = -1, bestScore = Infinity;
    // attackers with a big enough army go for the bunkers
    if (bunkers.length && mine.length >= 6 && strongEnough) {
      const b = bunkers.sort((a, c) => d(u, a) - d(u, c))[0];
      assault_.push([u.id, b.x, b.z]);
      continue;
    }
    view.points.forEach((p, i) => {
      if (allied(view, p.owner, slot)) return;
      if (defending && d(p, me.spawn) > 70) return; // defenders stay near home
      // the center is worth double VP, villages feed manpower
      const score = d(u, p) + load[i] * 40 - (p.vp - 1) * 25 - p.mp * 10;
      if (score < bestScore) { bestScore = score; best = i; }
    });
    if (best < 0) continue; // we hold everything: stay put
    load[best]++;
    pending[best].push(u);
  }
  // grab neutral points with whoever is free, but only hit enemy-held points as a group
  const need = Math.min(3, mine.length);
  pending.forEach((group, i) => {
    const p = view.points[i];
    if (p.owner >= 0 && !allied(view, p.owner, slot) && group.length + heading[i] < need) return;
    // screen the assault on a held point with smoke, 60% of the way in
    if (p.owner >= 0 && !allied(view, p.owner, slot) && group.length && can('smoke')) {
      const cx = group.reduce((a, u) => a + u.x, 0) / group.length, cz = group.reduce((a, u) => a + u.z, 0) / group.length;
      call('smoke', { x: cx + (p.x - cx) * 0.6, z: cz + (p.z - cz) * 0.6 }, Math.atan2(p.z - cz, p.x - cx) + Math.PI / 2); // wall across the approach
    }
    // assaults on held points attack-move, so they fight their way in instead of walking past defenders
    const held = p.owner >= 0 && !allied(view, p.owner, slot);
    for (const u of group) { const s = spotNear(view, p); (held ? assault_ : orders).push([u.id, s.x, s.z]); }
  });
  if (retreat.length) submit({ t: 'retreat', ids: retreat });
  if (orders.length) submit({ t: 'move', orders });
  if (assault_.length) submit({ t: 'amove', orders: assault_ });
}

// a Fuel node (tanks) is worth about as much to the AI as a 2.5 MP/s node
const worthOf = (n) => (n.fuel ? 2.5 : n.rate);
// Classic build order for idle Engineers: two depots, a Barracks, a Motor Pool, then the remaining nodes.
// Damaged buildings get repaired and unfinished sites get help first. Returns the MP to keep for the next building.
function buildEconomy(view, slot, engineers, needArmor, mem, submit) {
  const me = view.players[slot], own = gridFor(view).ownedBy(slot).filter(b => UNITS[b.type].building);
  const has = (t, done) => own.some(b => b.type === t && (!done || b.built >= 1));
  const hq = own.find(b => b.type === 'hq') ?? me.spawn, cx = view.w * CELL / 2, cz = view.h * CELL / 2;
  const depots = own.filter(b => b.type === 'depot').length, free = view.nodes.filter((_, i) => !view.claimedNodes.has(i));
  const planesNear = gridFor(view).radius(hq, 60).some(e => me.visible.has(e.id) && e.air && !allied(view, e.owner, slot) && d(e, hq) < 60);
  const next = depots < 2 && free.length && !(needArmor && has('barracks', true) && !has('motorpool')) ? 'depot' : !has('barracks') ? 'barracks' : has('barracks', true) && !has('motorpool') ? 'motorpool'
    : planesNear && own.filter(b => b.type === 'flakpos').length < 2 ? 'flakpos' : free.length ? 'depot' : has('motorpool', true) && !has('airfield') && depots >= 3 ? 'airfield' : null;
  const ids = new Set(engineers.map(u => u.id));
  for (const id of mem.node.keys()) if (!ids.has(id)) mem.node.delete(id);
  const taken = new Set(engineers.map(u => mem.node.get(u.id)).filter(n => n !== undefined));
  for (const u of engineers) {
    if (u.retreating || u.build) continue;
    const fix = own.filter(b => b.built < 1 || b.hp < UNITS[b.type].hpPer * 0.7).sort((a, b) => d(u, a) - d(u, b))[0];
    if (fix && d(u, fix) < 60) { submit({ t: 'assist', ids: [u.id], id: fix.id }); continue; }
    if (next === 'depot') {
      const pick = free.map(n => ({ n, i: view.nodes.indexOf(n) })).filter(({ i }) => !taken.has(i) || mem.node.get(u.id) === i).sort((a, b) => d(u, a.n) - worthOf(a.n) * 20 - (d(u, b.n) - worthOf(b.n) * 20))[0]; // richer nodes are worth a walk
      if (!pick) continue;
      mem.node.set(u.id, pick.i); taken.add(pick.i);
      if (me.mp >= UNITS.depot.cost && view.sees(pick.n)) submit({ t: 'build', ids: [u.id], kind: 'depot', x: pick.n.x, z: pick.n.z });
      else if (!u.path.length) submit({ t: 'move', orders: [[u.id, pick.n.x, pick.n.z]] });
    } else if (next) {
      // behind the HQ's front: a little toward the map center, off to one side
      const a = Math.atan2(cz - hq.z, cx - hq.x) + ({ barracks: 0.9, motorpool: -0.9, airfield: Math.PI, flakpos: (Math.random() - 0.5) * 2 }[next] ?? 0), spot = siteNear(view, hq.x + Math.cos(a) * 16, hq.z + Math.sin(a) * 16, UNITS[next].size);
      if (spot && me.mp >= UNITS[next].cost) submit({ t: 'build', ids: [u.id], kind: next, x: spot.x, z: spot.z });
    }
  }
  return next && next !== 'depot' ? UNITS[next].cost : 0;
}
