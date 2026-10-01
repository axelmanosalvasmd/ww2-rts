// Simple AI player. Runs on the server every couple of seconds and plays through command(),
// exactly like a human would. It only reacts to enemies its own player can see.
import { UNITS, CELL, CFG, COVER, MOVE, TRENCH, command, inCover, canBuild, allied, supCost, teamSees, siteNear, knownBuildings, priceOf, airborne, alive, los } from './sim.js';
import { gridFor, rebuildGrid } from './grid.js';

const d = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const SUPPORT_PLANE = (kind) => kind === 'strafe' || kind === 'bombing' || kind === 'dive' || kind === 'para';

function houseNear(g, p, r) {
  let best = null, bd = Infinity;
  for (let y = Math.floor((p.z - r) / CELL); y <= (p.z + r) / CELL; y++)
    for (let x = Math.floor((p.x - r) / CELL); x <= (p.x + r) / CELL; x++) {
      if (x < 0 || y < 0 || x >= g.w || y >= g.h || g.chars[y * g.w + x] !== 'B') continue;
      const c = { x: (x + 0.5) * CELL, z: (y + 0.5) * CELL }, dd = d(c, p);
      if (dd < bd) { bd = dd; best = c; }
    }
  return best;
}

function trenchesNear(g, p, r) {
  let n = 0;
  for (let y = Math.floor((p.z - r) / CELL); y <= (p.z + r) / CELL; y++)
    for (let x = Math.floor((p.x - r) / CELL); x <= (p.x + r) / CELL; x++)
      if (x >= 0 && y >= 0 && x < g.w && y < g.h && g.flags[y * g.w + x] & TRENCH) n++;
  return n;
}

// a random cover cell near the point, so squads dig in instead of standing in the open
function spotNear(g, p) {
  const r = Math.floor((CFG.pointRadius - 2) / CELL), cx = Math.floor(p.x / CELL), cy = Math.floor(p.z / CELL), cover = [];
  for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
    const f = g.flags[y * g.w + x];
    if (x >= 0 && y >= 0 && x < g.w && y < g.h && f & COVER && !(f & MOVE)) cover.push({ x: (x + 0.5) * CELL, z: (y + 0.5) * CELL });
  }
  if (cover.length) return cover[Math.floor(Math.random() * cover.length)];
  const a = Math.random() * Math.PI * 2;
  return { x: p.x + Math.cos(a) * 4, z: p.z + Math.sin(a) * 4 };
}

// What each AI remembers seeing: enemy unit id -> { type, owner, x, z, t (seconds), val (cost x health) }.
// Kept out of the game state; only fed by what the AI's team can see.
const MEMORY = new WeakMap();
const memoryOf = (g, slot) => { if (!MEMORY.has(g)) MEMORY.set(g, []); const m = MEMORY.get(g); return (m[slot] ??= { seen: new Map(), raid: null, scout: 0, called: -1e9 }); };
const worth = (u) => UNITS[u.type].cost * u.hp / (UNITS[u.type].models * UNITS[u.type].hpPer);
const centroid = (us) => ({ x: us.reduce((a, u) => a + u.x, 0) / us.length, z: us.reduce((a, u) => a + u.z, 0) / us.length });
// the spot k meters from a toward b (b itself when that's closer)
const toward = (a, b, k) => { const l = d(a, b) || 1, s = Math.min(k, l) / l; return { x: a.x + (b.x - a.x) * s, z: a.z + (b.z - a.z) * s }; };
const HEAVY = new Set(['tank', 'medium', 'tiger']);

// Difficulty, picked per AI seat in the lobby. No level gets extra income or vision: they differ in how fast they react
// and how well they play. Normal is the default (and what takes over a player who leaves).
//   every       ticks between decisions (the server calls think on this beat, staggered by slot)
//   adaptive    Classic's adaptive rules (DESIGN.md)    memory  remembers enemy sightings in every mode, not only Classic
//   supReserve  MP kept back when calling off-map support (munReserve: Munitions in Classic); supGap: seconds between calls
//   cluster     the smallest enemy group worth a barrage or strafing run (best: aim at the biggest one, clear of its own)
//   wave        units it sends together at an enemy-held point; firstAssault: not before
//               this many seconds; ratio: the wave must be worth this much more than the enemies seen there (0 = any)
//   baseArmy    army size before it marches on an enemy base    retreat: health share at which a squad falls back
//   focus       units in a fight shoot the same target          guard: defend the points it holds in Conquest
export const AI_LEVELS = {
  easy: { every: 120, adaptive: false, supReserve: 250, munReserve: 40, supGap: 45, cluster: 2, wave: 3, firstAssault: 150, ratio: 0, baseArmy: 10, retreat: 0.35 },
  normal: { every: 40, adaptive: true, supReserve: 100, munReserve: 0, supGap: 0, cluster: 2, wave: 3, firstAssault: 0, ratio: 0, baseArmy: 6, retreat: 0.35 },
  hard: { every: 20, adaptive: true, memory: true, supReserve: 100, munReserve: 0, supGap: 0, cluster: 3, best: true, wave: 2, firstAssault: 0, ratio: 1.2, baseArmy: 6, retreat: 0.5, focus: true, guard: true },
};
export const AI_LEVEL_NAMES = Object.keys(AI_LEVELS);
export const thinkEvery = (level) => (AI_LEVELS[level] ?? AI_LEVELS.normal).every;

// opts.level = 'easy' | 'normal' | 'hard' (default normal); opts.tweak overrides some of that level's settings (for
// tools/ai-duel.mjs). opts.adaptive = false plays the plain scripted Classic AI; opts.rules = [1..5] turns on only those
// adaptive rules (both for measuring the rules against the scripted AI)
export function think(g, slot, opts = {}) {
  const grid = rebuildGrid(g);
  const me = g.players[slot];
  if (me.out) return;
  const L = { ...(AI_LEVELS[opts.level] ?? AI_LEVELS.normal), ...opts.tweak };
  const all = grid.ownedBy(slot).filter(u => !UNITS[u.type].structure);
  const assault = g.mode?.kind === 'assault' || g.mode?.kind === 'annihilation', defending = assault && me.team === g.mode.defenderTeam, classic = g.mode?.kind === 'classic';
  // what the army marches on: assault bunkers, or in Classic the enemy's Production Buildings
  // (Classic: only buildings its team has seen, remembered under fog; with none known, head for the enemy spawns)
  const known = classic ? knownBuildings(g, slot).filter(b => UNITS[b.type].produces && g.players[b.owner].team !== me.team) : [];
  const bunkers = (assault ? [...g.units.values()].filter(u => UNITS[u.type].structure && g.players[u.owner].team !== me.team)
    : !classic ? [] : known.length ? known : g.players.filter(q => q.team !== me.team && !q.out).map(q => q.spawn))
    .sort((a, b) => d(a, me.spawn) - d(b, me.spawn)); // nearest first, so nobody gangs up on whoever was created first
  const count = (t) => all.filter(u => u.type === t).length;
  // ---- Classic adaptive AI: remember the last minute of sightings, then react ----
  const adapt = classic && opts.adaptive !== false && L.adaptive, now = g.tick / 20, mem = memoryOf(g, slot), rule = (n) => adapt && (!opts.rules || opts.rules.includes(n));
  if (adapt || L.memory) {
    for (const id of me.visible) {
      const e = g.units.get(id);
      if (e && !UNITS[e.type].structure && !allied(g, e.owner, slot)) mem.seen.set(id, { type: e.type, owner: e.owner, x: e.x, z: e.z, t: now, val: worth(e) });
    }
    for (const [id, e] of mem.seen) if (now - e.t > 60) mem.seen.delete(id);
  }
  const recent = [...mem.seen.values()];
  const ownB = classic ? grid.ownedBy(slot).filter(b => UNITS[b.type].building) : [];
  // rule 2, rush defense: enemy fighters at my buildings in the first 4 minutes
  const rush = rule(2) && now < 240 ? recent.filter(e => now - e.t < 5 && ownB.some(b => d(b, e) < 35)) : [];
  // rule 1, counters: tanks seen lately push the Motor Pool (for AT guns) up the build order (Hard does it in every mode)
  const counters = rule(1) || !!L.memory;
  const seenArmor = recent.filter(e => HEAVY.has(e.type)).length, seenInf = recent.filter(e => UNITS[e.type].infantry).length;
  const reserve = classic ? (rush.length ? 0 : 1) * buildEconomy(g, slot, all.filter(u => u.type === 'engineer'), counters && seenArmor > 0) : 0;
  // Classic: only what my finished buildings can train
  const trains = (t) => !classic || grid.ownedBy(slot).some(b => b.built >= 1 && UNITS[b.type].makes?.includes(t));
  const mine = all.filter(u => u.type !== 'engineer'); // Engineers build; everyone else fights
  // every tank counts, not only the light one (medium tanks and Tigers used to get no AT guns at all)
  const seenTanks = Math.max([...me.visible].filter(id => HEAVY.has(g.units.get(id)?.type)).length, counters ? seenArmor : 0);

  // shopping: counter tanks it has seen, get one tank once the infantry is out, a mortar for dug-in enemies, a sniper
  // against infantry crowds, an armored car to scout and raid, else 2 rifles per MG
  const seenGarrison = [...me.visible].some(id => g.units.get(id)?.garrison >= 0);
  const seenDugIn = [...me.visible].some(id => { const e = g.units.get(id); return e && !allied(g, e.owner, slot) && (e.type === 'mg' || e.type === 'at') && inCover(g, e); });
  const tanks = count('tank') + count('medium') + count('tiger');
  // air: enemy planes it can see now (they're visible from far away), its own anti-air and planes
  // (Hard also counts planes it saw in the last 30s, so it has flak up before the next sortie)
  const enemyPlanes = Math.max([...me.visible].filter(id => g.units.get(id)?.air).length, L.memory ? recent.filter(e => UNITS[e.type].air && now - e.t < 30).length : 0), flakN = count('flak') + count('flaktrack');
  const airWant = enemyPlanes && flakN < Math.min(3, Math.ceil(enemyPlanes / 2)) ? (trains('flaktrack') && tanks ? 'flaktrack' : 'flak')
    : enemyPlanes > count('fighter') && trains('fighter') ? 'fighter' : count('attacker') < 2 && mine.length >= 8 && trains('attacker') ? 'attacker' : null;
  const want = airWant ? airWant : seenTanks > count('at') ? 'at' : seenGarrison && count('rocket') < 1 ? 'rocket' : tanks < 1 && mine.length >= 4 ? 'tank'
    : (seenDugIn || mine.length >= 6) && count('mortar') < 1 ? 'mortar' : seenInf >= 6 && count('sniper') < 1 && mine.length >= 5 ? 'sniper'
    : count('armoredcar') < 1 && mine.length >= 7 ? 'armoredcar' : tanks < 2 && mine.length >= 8 ? 'tank'
    : count('mg') * 2 < count('rifle') || (rule(1) && seenInf >= 6 && count('mg') < 3) ? 'mg' : 'rifle'; // many infantry seen: more MGs
  // faction flavor: USA mixes in Rangers, Germany saves up for its Tiger, USSR fields Conscripts instead of rifles
  let buy = want;
  // the medium tank is the mainline tank once it can be afforded; the light tank is the cheap fallback
  const affords = (t) => { const pr = priceOf(g, t); return me.mp >= pr.mp && !(pr.fuel > (me.fuel ?? 0)); };
  if (want === 'tank' && trains('medium') && affords('medium')) buy = 'medium';
  if (want === 'rifle' && canBuild('conscript', me.faction)) buy = 'conscript';
  if (want === 'rifle' && canBuild('ranger', me.faction) && count('ranger') < 2 && count('rifle') >= 1) buy = 'ranger';
  // Tiger only when it's affordable right now: saving up for it starved the German army
  if (canBuild('tiger', me.faction) && count('tiger') < 1 && mine.length >= 5 && affords('tiger') && (want === 'tank' || want === 'rifle')) buy = 'tiger';
  // Classic: keep an Engineer while there are nodes to build on
  // Classic: no building for it, or no Fuel for a vehicle: infantry instead
  if (!trains(buy) || !canBuild(buy, me.faction) || priceOf(g, buy).fuel > (me.fuel ?? 0)) buy = trains('conscript') && canBuild('conscript', me.faction) ? 'conscript' : 'rifle';
  if (classic && count('engineer') < (g.nodes.some(n => !n.depot) ? 2 : 1)) buy = 'engineer';
  // Classic: save up for the next building, unless the army is nearly gone
  // big armies: buy several at a time (one per decision can't keep a 60-unit army topped up)
  for (let k = 0; k < (g.army?.pop > 1 ? 4 : 1); k++) if (me.mp - (mine.length >= 3 ? reserve : 0) >= priceOf(g, buy).mp) command(g, slot, { t: 'buy', unit: buy });

  // how many of my units are at or heading to each point
  const pointOf = (pos) => g.points.findIndex(p => d(pos, p) <= CFG.pointRadius);
  const load = g.points.map(() => 0), holding = g.points.map(() => 0);
  for (const u of mine) {
    const i = pointOf(u.path.length ? u.path.at(-1) : u);
    if (i >= 0) load[i]++;
  }

  const orders = [], assault_ = [], retreat = [], pending = g.points.map(() => []), heading = [...load];
  const enemies = [...me.visible].map(id => g.units.get(id)).filter(Boolean);
  const enemyOrder = new Map(enemies.map((u, i) => [u.id, i]));
  const enemiesNear = (at, r) => grid.radius(at, r).filter(u => enemyOrder.has(u.id)).sort((a, b) => enemyOrder.get(a.id) - enemyOrder.get(b.id));

  // off-map support, keeping some MP back so reinforcing never stalls (Easy keeps more, and waits between calls)
  const can = (k) => { const { cur, cost } = supCost(g, k); return me.sup[k] <= 0 && me[cur] >= cost + (cur === 'mp' ? L.supReserve : L.munReserve) && now - mem.called >= L.supGap; };
  // a group of at least min enemies within r: the first one found, or (Hard) the biggest with none of its own units close
  const cluster = (min, r, test = () => true) => {
    let best = null, most = min - 1;
    for (const e of enemies) {
      const near = enemiesNear(e, r).filter(o => test(o) && d(o, e) <= r);
      if (near.length <= most) continue;
      const at = { x: near.reduce((a, o) => a + o.x, 0) / near.length, z: near.reduce((a, o) => a + o.z, 0) / near.length };
      if (!L.best) return at;
      if (grid.radius(at, 10).some(u => u.owner === slot && !u.air && d(u, at) < 10)) continue;
      best = at; most = near.length;
    }
    return best;
  };
  const call = (kind, at, dir) => { if (at && !command(g, slot, { t: 'support', kind, x: at.x, z: at.z, dir })) mem.called = now; };
  // bombs for tanks and for squads holed up in houses
  // an enemy air strike announced near my units: put fighter cover over it (cover arrives in 2s, strikes take 3-6s)
  const incoming = g.strikes.find(q => !q.live && !allied(g, q.owner, slot) && SUPPORT_PLANE(q.kind) && mine.some(u => d(u, q) < 25));
  if (incoming && can('cover')) call('cover', incoming);
  const heavy = enemies.find(e => e.type === 'tank' || e.type === 'medium' || e.type === 'tiger' || e.type === 'flaktrack');
  if (heavy && can('dive')) call('dive', heavy);
  const dropZone = g.points.find(q => q.owner >= 0 && !allied(g, q.owner, slot) && teamSees(g, me.team, q));
  if (dropZone && mine.length >= 6 && can('para')) call('para', dropZone);
  const bombTarget = enemies.find(e => e.type === 'tank') || enemies.find(e => e.garrison >= 0);
  if (bombTarget && can('bombing')) call('bombing', bombTarget);
  else if (can('artillery')) call('artillery', cluster(L.cluster, 8) || enemies.find(e => (e.type === 'mg' || e.type === 'at') && e.still > 3));
  else if (can('strafe')) call('strafe', cluster(L.cluster, 10, o => UNITS[o.type].infantry));
  if (can('recon') && !enemies.length && (classic || me.mp > 250)) call('recon', g.points.find(p => p.owner >= 0 && !allied(g, p.owner, slot)));
  const busy = new Set();
  if (adapt) {
    const free = mine.filter(u => !u.retreating && !u.targetId);
    // a hurt squad is left to the normal logic, which pulls it back to reinforce
    const send = (u, at) => { if (worth(u) < UNITS[u.type].cost * 0.4) return; busy.add(u.id); if (!u.amove || d(u.amove, at) > 6) assault_.push([u.id, at.x, at.z]); };
    if (rush.length) {
      // everyone home to meet it, Engineers out of the way
      const c = { x: rush.reduce((a, e) => a + e.x, 0) / rush.length, z: rush.reduce((a, e) => a + e.z, 0) / rush.length };
      for (const u of mine) if (!u.retreating) send(u, c);
      for (const u of all.filter(u => u.type === 'engineer' && d(u, c) < 25)) command(g, slot, { t: 'move', orders: [[u.id, me.spawn.x, me.spawn.z]] });
      if (can('artillery')) call('artillery', c);
    } else {
      // rule 5, scout when blind: no enemy base known yet, so fly recon over the likeliest spawn
      // (a lone scouting squad just died on the way; the army already heads for the spawns when it attacks)
      const spawns = g.players.filter(q => q.team !== me.team && !q.out).map(q => q.spawn).sort((a, b) => d(a, me.spawn) - d(b, me.spawn));
      if (rule(5) && !known.length && spawns.length && can('recon')) call('recon', spawns[0]);
      // rule 4, raid a depot nobody has been seen guarding for 30s
      const raiders = mem.raid ? mem.raid.ids.map(id => g.units.get(id)).filter(u => u && u.owner === slot) : [];
      if (mem.raid && (!raiders.length || !knownBuildings(g, slot).some(b => b.id === mem.raid.id))) mem.raid = null;
      if (rule(4) && !mem.raid) {
        const depot = knownBuildings(g, slot).filter(b => b.type === 'depot' && g.players[b.owner].team !== me.team && !recent.some(e => now - e.t < 30 && d(e, b) < 25))
          .sort((a, b) => d(a, me.spawn) - d(b, me.spawn))[0];
        const fast = (u) => (u.type === 'armoredcar' ? 0 : 1); // armored cars are the raiders
        const pick = depot && free.filter(u => !busy.has(u.id) && !['mg', 'at', 'mortar', 'sniper'].includes(u.type)).sort((a, b) => fast(a) - fast(b) || d(a, depot) - d(b, depot)).slice(0, 2);
        if (pick?.length === 2) mem.raid = { id: depot.id, ids: pick.map(u => u.id), at: { x: depot.x, z: depot.z } };
      }
      if (mem.raid) for (const u of mem.raid.ids.map(id => g.units.get(id)).filter(u => u && u.owner === slot)) send(u, mem.raid.at);
    }
  }
  // enemies it can see at one of its Classic depots (or, Hard, a point it holds in Conquest). The nearest free units go to
  // fight them off, but only when together they're worth more than the attackers (else they'd just feed them); units
  // already there count, and stay where they are (in their house or trench). A lost depot is lost income at any level.
  const guarded = [...ownB.filter(b => b.type === 'depot'), ...(L.guard && !classic ? g.points.filter(p => p.owner === slot) : [])];
  for (const at of guarded) {
    const foes = enemiesNear(at, 24).filter(e => !UNITS[e.type].structure && !e.air && d(e, at) <= 24);
    if (!foes.length) continue;
    const foeVal = foes.reduce((a, e) => a + worth(e), 0), go = [];
    let val = 0;
    for (const u of mine.filter(u => !u.air && !u.retreating && !busy.has(u.id) && (!u.targetId || d(u, at) < 30) && d(u, at) < 70 && worth(u) >= UNITS[u.type].cost * 0.4).sort((a, b) => d(a, at) - d(b, at))) {
      if (val >= foeVal * 1.3) break;
      go.push(u); val += worth(u);
    }
    if (val < foeVal) continue;
    for (const u of go) { busy.add(u.id); if (d(u, at) > 12 && (!u.amove || d(u.amove, at) > 6)) assault_.push([u.id, at.x, at.z]); }
  }
  // rule 3, attack timing: march on a base only with an army worth 1.1x what that enemy was recently seen fielding
  const target = bunkers[0], myVal = mine.reduce((a, u) => a + worth(u), 0);
  const theirVal = target?.owner === undefined ? 0 : recent.filter(e => now - e.t < CFG.classic.aiSeenWindow && g.players[e.owner].team === g.players[target.owner].team).reduce((a, e) => a + e.val, 0);
  const strongEnough = !rule(3) || myVal > CFG.classic.aiAttackRatio * theirVal;

  // planes: a ready ground-attack plane goes for the nearest enemy tank or gun it can see near the army; a ready fighter
  // hunts enemy planes it can see, else covers the army. They come home on their own when fuel or ammo runs out.
  const army = mine.filter(u => !u.air), front = army.length ? { x: army.reduce((a, u) => a + u.x, 0) / army.length, z: army.reduce((a, u) => a + u.z, 0) / army.length } : me.spawn;
  for (const u of mine.filter(u => u.air && u.air.state === 'base')) {
    if (u.type === 'attacker') {
      const t = enemies.filter(e => !e.air && !UNITS[e.type].building && (!UNITS[e.type].infantry || e.type === 'at' || e.type === 'flak' || e.type === 'mortar')).sort((a, b) => d(a, front) - d(b, front))[0];
      if (t && d(t, front) < 120) command(g, slot, { t: 'attack', ids: [u.id], target: t.id });
    } else {
      const e = enemies.filter(e => e.air).sort((a, b) => d(a, front) - d(b, front))[0];
      command(g, slot, { t: 'move', orders: [[u.id, (e ?? front).x, (e ?? front).z]] });
    }
  }
  // where squads get reinforced: near the spawn, or in Classic near any finished Production Building of its team (a squad
  // that fell back to a Barracks away from the HQ used to head out again half empty)
  const bases = classic ? [...g.units.values()].filter(b => UNITS[b.type].produces && b.built >= 1 && b.hp > 0 && allied(g, b.owner, slot)) : null;
  const atBase = (u) => (bases ? bases.some(b => d(u, b) <= CFG.reinforceRadius) : d(u, me.spawn) <= CFG.reinforceRadius);
  const marchers = [];
  for (const u of mine) {
    if (u.air) continue; // planes are flown above
    if (busy.has(u.id)) continue;
    const def = UNITS[u.type], frac = u.hp / (def.models * def.hpPer), home = atBase(u);
    if (u.retreating) continue;

    // abilities
    const target = g.units.get(u.targetId);
    if (u.cd <= 0) {
      if (def.ab.id === 'grenade') {
        // lob it at a dug-in MG or AT gun, or any squad sitting in cover
        const t = enemiesNear(u, def.ab.range + 4).find(e => UNITS[e.type].infantry && d(u, e) <= def.ab.range + 4 && (e.type !== 'rifle' || inCover(g, e)));
        if (t) command(g, slot, { t: 'ability', ids: [u.id], x: t.x, z: t.z });
      } else if (def.ab.id === 'suppress' && target) command(g, slot, { t: 'ability', ids: [u.id] });
      else if (def.ab.id === 'ap' && target?.type === 'tank') command(g, slot, { t: 'ability', ids: [u.id] });
      else if (def.ab.id === 'smoke' && frac < 0.5 && !home) command(g, slot, { t: 'ability', ids: [u.id] });
      else if (def.ab.id === 'satchel') {
        // demolish a house the enemy is holding, or plant it on a tank
        const t = enemiesNear(u, 20).find(e => (e.garrison >= 0 || !UNITS[e.type].infantry) && d(u, e) <= 20);
        if (t) command(g, slot, { t: 'ability', ids: [u.id], x: t.x, z: t.z });
      } else if (def.ab.id === 'ura' && (u.supp >= 50 || (u.amove && enemiesNear(u, 30).some(e => d(u, e) < 30)))) command(g, slot, { t: 'ability', ids: [u.id] });
      else if (def.ab.id === 'barrage') { const t = enemiesNear(u, def.ab.range).find(e => e.garrison >= 0 && d(u, e) <= def.ab.range); if (t) command(g, slot, { t: 'ability', ids: [u.id], x: t.x, z: t.z }); }
    }
    // save hurt units instead of letting them die: retreat, get reinforced, come back (also a squad down to its last
    // model: a sniper team at 1 of 2 used to fight on until it died)
    if (!home && (frac < L.retreat || (def.models > 1 && alive(u) <= 1) || (u.supp >= 90 && frac < 0.6))) { retreat.push(u.id); continue; }
    if (home && frac < 1 && me.mp >= 20) continue; // wait for reinforcements
    // tanks knock down houses that enemy squads are hiding in
    if (def.w.shellTerrain && !u.targetId && u.fireAt < 0) {
      const house = enemiesNear(u, 60).find(e => e.garrison >= 0 && d(u, e) < 60);
      if (house) { command(g, slot, { t: 'fireat', ids: [u.id], x: house.x, z: house.z }); continue; }
    }
    if (u.path.length || u.attackId || u.nade || u.dig || u.enter >= 0 || u.fireAt >= 0) continue;
    if (u.targetId) continue; // in a fight: hold
    const here = pointOf(u);
    // infantry stays to capture, and one squad stays behind to hold each captured point (and digs in)
    if (here >= 0 && def.infantry) {
      const p = g.points[here];
      if (!allied(g, p.owner, slot)) continue;
      if (holding[here]++ === 0) {
        // hold it from a house if there is one close by, otherwise dig in
        const house = u.garrison < 0 && def.garrisons && houseNear(g, p, CFG.pointRadius + 3);
        if (house) { command(g, slot, { t: 'garrison', ids: [u.id], x: house.x, z: house.z }); if (u.enter >= 0) continue; }
        if (u.garrison < 0 && u.type === 'rifle' && !u.dig && me.mp >= CFG.digCost + 150 && trenchesNear(g, p, CFG.pointRadius + 4) < 6) {
          // dig a line between the point and the closest enemy HQ
          const foe = g.players.filter(q => q.team !== me.team).sort((a, b) => d(a.spawn, p) - d(b.spawn, p))[0]?.spawn;
          if (!foe) continue;
          const l = d(foe, p) || 1;
          command(g, slot, { t: 'dig', ids: [u.id], x: p.x + (foe.x - p.x) / l * 5, z: p.z + (foe.z - p.z) / l * 5, dir: Math.atan2(foe.z - p.z, foe.x - p.x) + Math.PI / 2 });
        }
        continue;
      }
    }
    // otherwise go for the closest point we don't hold, spreading out across targets
    let best = -1, bestScore = Infinity;
    // attackers with a big enough army go for the bunkers (below)
    if (bunkers.length && mine.length >= L.baseArmy && strongEnough) { marchers.push(u); continue; }
    g.points.forEach((p, i) => {
      if (allied(g, p.owner, slot)) return;
      if (defending && d(p, me.spawn) > 70) return; // defenders stay near home
      // the center is worth double VP, villages feed manpower
      const score = d(u, p) + load[i] * 40 - (p.vp - 1) * 25 - p.mp * 10;
      if (score < bestScore) { bestScore = score; best = i; }
    });
    if (best < 0) continue; // we hold everything: stay put
    load[best]++;
    pending[best].push(u);
  }
  // each marches on the enemy building nearest to it (waves gathered at a rally point made 3-player Classic matches drag
  // into Sudden Death: 17 of 30 decided before it instead of 22, see DESIGN.md)
  for (const u of marchers) { const b = bunkers.reduce((a, c) => (d(u, c) < d(u, a) ? c : a)); assault_.push([u.id, b.x, b.z]); }
  // grab neutral points with whoever is free, but only hit enemy-held points as a group (and, Hard, one worth more than
  // the enemies seen there). Nobody joins a fight there that is clearly lost: more units would only feed the defenders.
  pending.forEach((group, i) => {
    const p = g.points[i];
    if (p.owner < 0 || allied(g, p.owner, slot)) { for (const u of group) { const s = spotNear(g, p); orders.push([u.id, s.x, s.z]); } return; }
    if (now < L.firstAssault || !group.length || group.length + heading[i] < Math.min(L.wave, mine.length)) return;
    const ids = new Set(group.map(u => u.id));
    const there = mine.filter(u => !u.air && !u.retreating && !ids.has(u.id) && (d(u, p) <= 25 || [u.amove, u.path.at(-1)].some(at => at && d(at, p) <= CFG.pointRadius + 2)));
    // what holds it: enemies seen there now, or (Hard) in the last 30s unless its own units have since seen the spot empty
    const foes = L.memory ? [...mem.seen].filter(([id, e]) => now - e.t < 30 && d(e, p) <= 25 && (me.visible.has(id) || !teamSees(g, me.team, e))).map(([, e]) => e.val)
      : enemiesNear(p, 25).filter(e => d(e, p) <= 25 && !UNITS[e.type].structure).map(worth);
    const foeVal = foes.reduce((a, v) => a + v, 0), ourVal = [...group, ...there].reduce((a, u) => a + worth(u), 0);
    if (there.length && foeVal > 1.5 * ourVal) return;
    if (ourVal < L.ratio * foeVal && group.length < 8) return;
    // screen the assault with smoke, 60% of the way in; attack-move, so they fight their way in past the defenders
    const c = centroid(group);
    if (can('smoke')) call('smoke', toward(c, p, d(c, p) * 0.6), Math.atan2(p.z - c.z, p.x - c.x) + Math.PI / 2); // wall across the approach
    for (const u of group) { const s = spotNear(g, p); assault_.push([u.id, s.x, s.z]); }
  });
  // Hard: units in a fight shoot together at the target they can kill best (the most value per second of their combined
  // fire, finishing hurt units first), instead of each picking its own. Only units already in range, out in the open.
  if (L.focus) {
    const hit = (u, inf) => { const w = UNITS[u.type].w; return inf ? w.inf * w.accInf : w.veh * w.accVeh; };
    const dps = (u, inf) => hit(u, inf) * (UNITS[u.type].w.perModel ? alive(u) : 1) / UNITS[u.type].w.interval;
    const shooters = mine.filter(u => !u.air && !u.retreating && u.targetId && u.garrison < 0 && !u.nade && !u.dig && u.fireAt < 0 && !UNITS[u.type].w.salvo && !retreat.includes(u.id));
    // (a squad running away isn't chased: they'd follow it into its own lines)
    const targets = enemies.filter(e => !e.air && !UNITS[e.type].structure && e.hp > 0 && !e.retreating), used = new Set();
    // a focus target that moved out of range or behind cover isn't chased either: back to the attack-move (or hold here)
    const stop = mine.filter(u => !u.air && u.attackId && !retreat.includes(u.id) && (t => t && (d(u, t) > UNITS[u.type].w.range || !los(g, u, t)))(g.units.get(u.attackId)));
    const next = (u) => u.orders?.find(o => o.t === 'amove') ?? u;
    if (stop.length) command(g, slot, { t: 'amove', orders: stop.map(u => [u.id, next(u).x, next(u).z]) });
    for (let k = 0; k < 4 && shooters.length - used.size >= 2; k++) {
      let best = null, bestScore = 0, team = null;
      for (const e of targets) {
        const def = UNITS[e.type], full = def.models * def.hpPer, inf = def.infantry;
        // only units that can shoot it from where they stand, and are good against this kind of target (no AT guns on
        // squads, no rifles on tanks)
        const ids = shooters.filter(u => !used.has(u.id) && d(u, e) <= UNITS[u.type].w.range && hit(u, inf) >= 0.5 * Math.max(hit(u, true), hit(u, false)) && los(g, u, e));
        if (ids.length < 2) continue;
        const score = ids.reduce((a, u) => a + dps(u, inf), 0) * def.cost / full * (2 - e.hp / full);
        if (score > bestScore) { best = e; bestScore = score; team = ids; }
      }
      if (!best) break;
      team.forEach(u => used.add(u.id));
      const go = team.filter(u => u.attackId !== best.id && u.targetId !== best.id);
      if (!go.length) continue;
      // an attack order drops the attack-move, so queue it again: once the target is down they carry on to the point
      const resume = go.filter(u => u.amove).map(u => [u.id, u.amove.x, u.amove.z]);
      command(g, slot, { t: 'attack', ids: go.map(u => u.id), target: best.id });
      if (resume.length) command(g, slot, { t: 'amove', orders: resume, queue: true });
    }
  }
  if (retreat.length) command(g, slot, { t: 'retreat', ids: retreat });
  if (orders.length) command(g, slot, { t: 'move', orders });
  if (assault_.length) command(g, slot, { t: 'amove', orders: assault_ });
}

// a Fuel node (tanks) is worth about as much to the AI as a 2.5 MP/s node
const worthOf = (n) => (n.fuel ? 2.5 : n.rate);
// Classic build order for idle Engineers: two depots, a Barracks, a Motor Pool, then the remaining nodes.
// Damaged buildings get repaired and unfinished sites get help first. Returns the MP to keep for the next building.
function buildEconomy(g, slot, engineers, needArmor) {
  const me = g.players[slot], own = gridFor(g).ownedBy(slot).filter(b => UNITS[b.type].building);
  const has = (t, done) => own.some(b => b.type === t && (!done || b.built >= 1));
  const hq = own.find(b => b.type === 'hq') ?? me.spawn, cx = g.w * CELL / 2, cz = g.h * CELL / 2;
  const depots = own.filter(b => b.type === 'depot').length, free = g.nodes.filter(n => !n.depot);
  const planesNear = gridFor(g).radius(hq, 60).some(e => me.visible.has(e.id) && e.air && airborne(e) && !allied(g, e.owner, slot) && d(e, hq) < 60);
  const next = depots < 2 && free.length && !(needArmor && has('barracks', true) && !has('motorpool')) ? 'depot' : !has('barracks') ? 'barracks' : has('barracks', true) && !has('motorpool') ? 'motorpool'
    : planesNear && own.filter(b => b.type === 'flakpos').length < 2 ? 'flakpos' : free.length ? 'depot' : has('motorpool', true) && !has('airfield') && depots >= 3 ? 'airfield' : null;
  const taken = new Set(engineers.map(u => u.aiNode).filter(n => n !== undefined));
  for (const u of engineers) {
    if (u.retreating || u.build) continue;
    const fix = own.filter(b => b.built < 1 || b.hp < UNITS[b.type].hpPer * 0.7).sort((a, b) => d(u, a) - d(u, b))[0];
    if (fix && d(u, fix) < 60) { command(g, slot, { t: 'assist', ids: [u.id], id: fix.id }); continue; }
    if (next === 'depot') {
      const pick = free.map(n => ({ n, i: g.nodes.indexOf(n) })).filter(({ i }) => !taken.has(i) || u.aiNode === i).sort((a, b) => d(u, a.n) - worthOf(a.n) * 20 - (d(u, b.n) - worthOf(b.n) * 20))[0]; // richer nodes are worth a walk
      if (!pick) continue;
      u.aiNode = pick.i; taken.add(pick.i);
      if (me.mp >= UNITS.depot.cost && teamSees(g, me.team, pick.n)) command(g, slot, { t: 'build', ids: [u.id], kind: 'depot', x: pick.n.x, z: pick.n.z });
      else if (!u.path.length) command(g, slot, { t: 'move', orders: [[u.id, pick.n.x, pick.n.z]] });
    } else if (next) {
      // behind the HQ's front: a little toward the map center, off to one side
      const a = Math.atan2(cz - hq.z, cx - hq.x) + ({ barracks: 0.9, motorpool: -0.9, airfield: Math.PI, flakpos: (Math.random() - 0.5) * 2 }[next] ?? 0), spot = siteNear(g, hq.x + Math.cos(a) * 16, hq.z + Math.sin(a) * 16, UNITS[next].size);
      if (spot && me.mp >= UNITS[next].cost) command(g, slot, { t: 'build', ids: [u.id], kind: next, x: spot.x, z: spot.z });
    }
  }
  return next && next !== 'depot' ? UNITS[next].cost : 0;
}
