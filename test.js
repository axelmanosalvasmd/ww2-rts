// Headless sim checks: `node test.js`. Fails loudly if core rules break.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createGame, step, command, los, findPath, validateMap, snapshotFor, inTrench, vet, spawnSlots, CFG, CELL, SUPPORT, UNITS } from './shared/sim.js';
import { think } from './shared/ai.js';
import { unitRole } from './client/unit-roles.js';

// Recruitment descriptions stay readable when the roster gains a unit without role copy.
{
  assert.equal(unitRole('flak', 'Flak Gun'), 'Shoots down enemy air support', 'Flak has a role description');
  assert.equal(unitRole('rifle', 'Rifle Squad'), 'Captures, all-round', 'existing role copy is preserved');
  assert.equal(unitRole('fieldgun', 'Field Gun'), 'Field Gun', 'missing roles use the unit name');
  assert.equal(unitRole('fieldgun'), 'Unit', 'missing names still produce readable text');
  assert.equal(unitRole('toString', 'Field Gun'), 'Field Gun', 'inherited properties are not role descriptions');
  for (const [type, def] of Object.entries(UNITS).filter(([, def]) => !def.structure)) {
    const role = unitRole(type, def.name);
    assert.equal(typeof role, 'string', `${type}: role is text`);
    assert.ok(role.trim() && role !== 'undefined', `${type}: role is readable`);
  }
}

const blank = (rows) => ({ w: rows[0].length, h: rows.length, rows, spawns: [{ x: 1, y: 1 }, { x: 18, y: 1 }, { x: 1, y: 18 }], points: [{ x: 10, y: 10 }] });
const empty = Array(20).fill('.'.repeat(20));
const run = (g, secs) => { for (let i = 0; i < secs * 20; i++) step(g); };
const fresh = (rows = empty, n = 2) => { const g = createGame(blank(rows), ['a', 'b', 'c'].slice(0, n), false); g.units.clear(); g.players.forEach(p => (p.spawn = { x: -1000, z: -1000 })); return g; };
const UNITS_COST = (t) => ({ rifle: 100, mg: 150, at: 200, tank: 300, rocket: 250, ranger: 185, tiger: 620, conscript: 80 })[t];
const put = (g, owner, type, x, z) => { command(g, owner, { t: 'buy', unit: type }); const u = [...g.units.values()].at(-1); u.x = x; u.z = z; return u; };

// LOS: a building between two points blocks sight; a wall does not.
{
  const rows = [...empty]; rows[5] = '.....B' + '.'.repeat(14); rows[7] = '.....#' + '.'.repeat(14);
  const g = fresh(rows);
  assert.equal(los(g, { x: 1, z: 11 }, { x: 21, z: 11 }), false, 'building blocks LOS');
  assert.equal(los(g, { x: 1, z: 15 }, { x: 21, z: 15 }), true, 'wall does not block LOS');
}

// Pathfinding routes around a wall of buildings.
{
  const rows = [...empty]; for (let y = 0; y < 15; y++) rows[y] = '.'.repeat(10) + 'B' + '.'.repeat(9);
  const g = fresh(rows);
  const path = findPath(g, { x: 5, z: 5 }, { x: 35, z: 5 });
  assert.ok(path.length >= 2, 'path found');
  assert.ok(path.some(p => p.z > 15 * CELL), 'path goes around the building column');
}

// Movement: a move order gets the unit there.
{
  const g = fresh(); g.players[0].mp = 1000;
  const u = put(g, 0, 'rifle', 5, 5);
  command(g, 0, { t: 'move', orders: [[u.id, 30, 30]] });
  run(g, 10);
  assert.ok(Math.hypot(u.x - 30, u.z - 30) < 1, `rifle arrived (${u.x},${u.z})`);
}

// Combat + fog: in range and in sight, squads damage each other; MG suppresses.
{
  const g = fresh(); g.players[0].mp = g.players[1].mp = 1000;
  const r = put(g, 0, 'rifle', 5, 5), m = put(g, 1, 'mg', 25, 5);
  run(g, 5);
  assert.ok(r.hp < 100, 'rifle took damage');
  assert.ok(r.supp > 40, `mg suppressed rifle (${r.supp})`);
  assert.ok(snapshotFor(g, 0, []).units.some(x => x[0] === m.id), 'enemy MG visible to player 0');
}

// Fog: an enemy behind a building is not in the snapshot.
{
  const rows = [...empty]; for (let y = 0; y < 20; y++) rows[y] = '.'.repeat(10) + 'B' + '.'.repeat(9);
  const g = fresh(rows); g.players[0].mp = g.players[1].mp = 1000;
  put(g, 0, 'rifle', 5, 5); const hidden = put(g, 1, 'rifle', 30, 5);
  run(g, 1);
  assert.ok(!snapshotFor(g, 0, []).units.some(x => x[0] === hidden.id), 'hidden enemy filtered out');
}

// Rear armor: AT shot from behind does double damage.
{
  const g = fresh(); g.players[0].mp = g.players[1].mp = 1000;
  const t = put(g, 1, 'tank', 20, 20); t.rot = 0; // facing +x
  const orig = Math.random; Math.random = () => 0;
  const a = put(g, 0, 'at', 0, 20); a.still = 5; // behind the tank
  run(g, 0.2);
  Math.random = orig;
  assert.equal(t.hp, 360 - 240, 'rear hit = 2x AT damage');
}

// Capture, VP and win.
{
  const g = fresh(); g.players[0].mp = 1000;
  put(g, 0, 'rifle', 21, 21);
  run(g, CFG.captureTime + 1);
  assert.equal(g.points[0].owner, 0, 'point captured');
  run(g, CFG.vpToWin + 5);
  assert.equal(g.winner, 0, 'player 0 wins on VP');
}

// Buying: costs manpower, rejects junk.
{
  const g = fresh(); g.players[0].mp = 150;
  command(g, 0, { t: 'buy', unit: 'rifle' }); command(g, 0, { t: 'buy', unit: 'tank' }); command(g, 0, { t: 'buy', unit: '__proto__' });
  command(g, 0, { t: 'move', orders: [[999, NaN, 'x'], 'junk'] });
  assert.equal(g.units.size, 1); assert.equal(g.players[0].mp, 50);
}

// Retreat: sprints home, takes a quarter of the damage, stops shooting.
{
  const g = fresh(); g.players[0].mp = g.players[1].mp = 1000;
  g.players[0].spawn = { x: 5, z: 38 };
  const r = put(g, 0, 'rifle', 5, 5), t = put(g, 1, 'tank', 20, 5);
  command(g, 0, { t: 'retreat', ids: [r.id] });
  assert.ok(r.retreating && r.path.length, 'retreat order sets a path home');
  const orig = Math.random; Math.random = () => 0;
  t.cooldown = 0; run(g, 0.3);
  Math.random = orig;
  assert.equal(r.hp, 100 - 30 * 0.25, 'retreating squad takes 25% damage');
  assert.equal(r.targetId, 0, 'retreating squad does not fire');
}

// Reinforce: a damaged squad at its spawn regains models for manpower.
{
  const g = fresh(); g.players[0].mp = 1000;
  g.players[0].spawn = { x: 20, z: 20 };
  const r = put(g, 0, 'rifle', 21, 21); r.hp = 40;
  const mp = g.players[0].mp;
  run(g, 5);
  assert.equal(r.hp, 80, 'two models restored in 5s');
  assert.ok(Math.abs(mp - g.players[0].mp - 2 * 10) < 25, 'reinforcing costs manpower'); // income runs meanwhile
}

// Grenade: walks into range, throws, blast hurts everyone nearby (cover doesn't help).
{
  const rows = [...empty]; rows[2] = '.'.repeat(15) + '#' + '.'.repeat(4);
  const g = fresh(rows); g.players[0].mp = g.players[1].mp = 1000;
  const r = put(g, 0, 'rifle', 3, 5), m = put(g, 1, 'mg', 31, 5);
  command(g, 0, { t: 'ability', ids: [r.id], x: 31, z: 5 });
  const before = m.hp;
  run(g, 4);
  assert.ok(r.cd > 0, 'grenade on cooldown');
  assert.ok(m.hp <= before - 30 || !g.units.has(m.id), `mg hit by grenade (${m.hp})`);
}

// Smoke blocks line of sight.
{
  const g = fresh(); g.players[0].mp = 1000;
  const t = put(g, 0, 'tank', 20, 20);
  assert.ok(los(g, { x: 5, z: 20 }, { x: 35, z: 20 }));
  command(g, 0, { t: 'ability', ids: [t.id] });
  assert.equal(los(g, { x: 5, z: 20 }, { x: 35, z: 20 }), false, 'smoke blocks LOS');
  run(g, 15);
  assert.ok(los(g, { x: 5, z: 20 }, { x: 35, z: 20 }), 'smoke clears');
}

// Catch-up: trailing players earn more manpower.
{
  const g = fresh(); g.players[0].vp = 400;
  run(g, 0.1);
  assert.ok(g.players[1].inc > g.players[0].inc + 3, 'trailing player gets catch-up income');
}

// Support: costs MP, goes on cooldown, rejects junk, and is announced before it lands.
{
  const g = fresh(); g.players[0].mp = 1000; g.players[0].spawn = { x: 0, z: 20 };
  command(g, 0, { t: 'support', kind: 'artillery', x: 30, z: 30 });
  command(g, 0, { t: 'support', kind: 'artillery', x: 30, z: 30 }); // on cooldown
  command(g, 0, { t: 'support', kind: 'nuke', x: 30, z: 30 });
  command(g, 0, { t: 'support', kind: 'recon', x: 'a', z: 30 });
  assert.equal(g.players[0].mp, 1000 - SUPPORT.artillery.cost);
  assert.equal(g.strikes.length, 1);
  assert.equal(snapshotFor(g, 1, []).strikes.length, 1, 'enemy sees the incoming barrage');
}

// Artillery: nothing before the delay, then shells wreck the area.
{
  const g = fresh(); g.players[0].mp = 1000; g.players[1].mp = 1000;
  const r = put(g, 1, 'rifle', 20, 20);
  command(g, 0, { t: 'support', kind: 'artillery', x: 20, z: 20 });
  run(g, SUPPORT.artillery.delay - 0.5);
  assert.equal(r.hp, 100, 'no damage during the warning');
  const orig = Math.random; Math.random = () => 0.5; // shells land dead center (real barrages scatter)
  run(g, 6);
  Math.random = orig;
  assert.ok(r.hp < 100 || !g.units.has(r.id), 'barrage hits the squad');
  assert.equal(g.strikes.length, 0, 'barrage finished');
  assert.equal(g.height.filter(l => l < 0).length, 1, 'shells dig a single cell (bombs dig more)');
}

// Strafe: hits along the line, misses off it.
{
  const g = fresh(); g.players[0].mp = 1000; g.players[1].mp = 1000; g.players[0].spawn = { x: 0, z: 20 };
  const on = put(g, 1, 'rifle', 30, 20), off = put(g, 1, 'rifle', 30, 38);
  command(g, 0, { t: 'support', kind: 'strafe', x: 30, z: 20 }); // flies along +x from the spawn
  run(g, SUPPORT.strafe.delay + 0.2);
  assert.ok(on.hp < 100, 'unit on the line is hit'); assert.equal(off.hp, 100, 'unit off the line is fine');
}

// Direction: the player picks it. A strafe along z hits units on that line, not the default one.
{
  const g = fresh(); g.players[0].mp = 1000; g.players[1].mp = 1000; g.players[0].spawn = { x: 0, z: 20 };
  const alongX = put(g, 1, 'rifle', 36, 20), alongZ = put(g, 1, 'rifle', 20, 36);
  command(g, 0, { t: 'support', kind: 'strafe', x: 20, z: 20, dir: Math.PI / 2 });
  run(g, SUPPORT.strafe.delay + 0.2);
  assert.ok(alongZ.hp < 100, 'unit on the chosen line is hit');
  assert.equal(alongX.hp, 100, 'unit on the default (from-HQ) line is not');
}

// Dig direction: dir sets the trench line.
{
  const g = fresh(); g.players[0].mp = 1000;
  const r = put(g, 0, 'rifle', 20, 20);
  command(g, 0, { t: 'dig', ids: [r.id], x: 20, z: 20, dir: 0 });
  const ys = new Set(r.dig.cells.map(([c]) => Math.floor(c / g.w)));
  assert.equal(ys.size, 1, 'dir 0 digs along one grid row');
}

// Recon: reveals an enemy hidden behind a building.
{
  const rows = [...empty]; for (let y = 0; y < 20; y++) rows[y] = '.'.repeat(10) + 'B' + '.'.repeat(9);
  const g = fresh(rows); g.players[0].mp = g.players[1].mp = 1000;
  put(g, 0, 'rifle', 5, 5); const hidden = put(g, 1, 'rifle', 30, 5);
  run(g, 1);
  assert.ok(!g.players[0].visible.has(hidden.id));
  command(g, 0, { t: 'support', kind: 'recon', x: 30, z: 5 });
  run(g, SUPPORT.recon.delay + 0.5);
  assert.ok(g.players[0].visible.has(hidden.id), 'recon reveals it');
  run(g, SUPPORT.recon.dur + 1);
  assert.ok(!g.players[0].visible.has(hidden.id), 'and it hides again after');
}

// Trench: heavier cover than a crater, and it halves blast damage.
{
  const rows = [...empty]; rows[10] = '.'.repeat(5) + 'T' + '.'.repeat(4) + '+' + '.'.repeat(9);
  const g = fresh(rows); g.players[0].mp = g.players[1].mp = 1000;
  const inT = put(g, 1, 'rifle', 11, 21), inC = put(g, 1, 'rifle', 21, 21);
  assert.ok(inTrench(g, inT) && !inTrench(g, inC));
  const mg = put(g, 0, 'mg', 16, 38); mg.still = 5;
  let tHits = 0, cHits = 0;
  for (let i = 0; i < 4000; i++) {
    const orig = Math.random; let roll = (i % 100) / 100; Math.random = () => roll;
    inT.hp = inC.hp = 100; mg.cooldown = 0; mg.targetId = inT.id;
    step(g); if (inT.hp < 100) tHits++;
    mg.cooldown = 0; mg.targetId = inC.id; mg.retarget = 1;
    step(g); if (inC.hp < 100) cHits++;
    Math.random = orig;
  }
  assert.ok(tHits < cHits * 0.8, `trench is harder to hit than a crater (${tHits} vs ${cHits})`);
}

// Digging: costs MP, the squad walks over, trench cells appear one by one and are broadcast.
{
  const g = fresh(); g.players[0].mp = 1000;
  const r = put(g, 0, 'rifle', 5, 20); g.players[0].mp = 100;
  command(g, 0, { t: 'dig', ids: [r.id], x: 25, z: 20 });
  assert.ok(Math.abs(g.players[0].mp - (100 - CFG.digCost)) < 1e-9);
  assert.ok(r.dig && r.dig.cells.length === CFG.digCells, 'plans a 4-cell line');
  run(g, 5 + CFG.digTime * CFG.digCells + 1);
  assert.equal(r.dig, null, 'done digging');
  assert.equal(g.cellLog.length, CFG.digCells, 'four trench cells logged');
  assert.ok(snapshotFor(g, 1, [], g.newCells).cells.length === CFG.digCells, 'changes go out in snapshots');
  g.players[0].mp = 1000;
  const mg = put(g, 0, 'mg', 5, 5);
  assert.equal(mg.type, 'mg');
  command(g, 0, { t: 'dig', ids: [mg.id], x: 25, z: 30 });
  assert.equal(mg.dig, null, 'MG teams do not build');
}

// Fortifications: every kind builds its cells; wire slows infantry and tanks flatten it; tank traps stop vehicles.
{
  const at = (g, x, z) => g.chars[Math.floor(z / CELL) * g.w + Math.floor(x / CELL)];
  const build = (kind, type = 'rifle') => {
    const g = fresh(); g.players[0].mp = 5000;
    const u = put(g, 0, 'rifle', 20, 30); u.type = type; // engineers are Classic-only, conscripts USSR-only
    command(g, 0, { t: 'dig', ids: [u.id], kind, x: 20, z: 20, dir: 0 });
    run(g, 40);
    return { g, chars: [...new Set(g.cellLog.map(([, ch]) => ch))].sort().join(''), n: g.cellLog.length, u };
  };
  assert.deepEqual([build('sandbags').chars, build('wire').chars, build('traps').chars], ['#', 'X', 'Y']);
  const nest = build('nest');
  assert.equal(nest.chars, '#T', 'MG nest: a trench pit and sandbags');
  assert.equal(nest.n, 6);
  // the sandbag horseshoe faces away from the builders (they came from below, so the front row is above the pit)
  assert.equal(at(nest.g, 20, 20), 'T'); assert.equal(at(nest.g, 20, 18), '#'); assert.equal(at(nest.g, 20, 22), '.');
  assert.equal(build('wire', 'engineer').chars, 'X', 'engineers build'); assert.equal(build('wire', 'conscript').chars, 'X', 'conscripts build');
  assert.equal(build('nope').n, 0, 'unknown kinds are ignored');
  // wire: infantry crawls through it, a tank flattens it
  {
    const rows = [...empty]; for (let y = 0; y < 20; y++) rows[y] = '.'.repeat(9) + 'XX' + '.'.repeat(9);
    const g = fresh(rows); g.players[0].mp = 5000;
    const r = put(g, 0, 'rifle', 4, 20), t = put(g, 0, 'tank', 4, 30);
    command(g, 0, { t: 'move', orders: [[r.id, 36, 20], [t.id, 36, 30]] });
    const free = 32 / UNITS.rifle.speed;
    run(g, free);
    assert.ok(r.x < 30, `wire slows the squad (at x=${r.x.toFixed(1)} after the open-ground time)`);
    run(g, 10);
    assert.ok(r.x > 34, 'but it gets through');
    assert.equal(at(g, 20, 30), '.', 'the tank flattened the wire it drove over');
  }
  // tank traps: a full line stops a tank's path, but not a squad's
  {
    const rows = [...empty]; rows[10] = 'Y'.repeat(20);
    const g = fresh(rows); g.players[0].mp = 5000;
    const r = put(g, 0, 'rifle', 20, 5), t = put(g, 0, 'tank', 20, 8);
    assert.equal(findPath(g, t, { x: 20, z: 35 }).length, 0, 'no way through for the tank');
    assert.ok(findPath(g, r, { x: 20, z: 35 }).length > 0, 'infantry walks through');
  }
}

// Smoke barrage: clouds appear after the warning and block sight.
{
  const g = fresh(); g.players[0].mp = 1000;
  command(g, 0, { t: 'support', kind: 'smoke', x: 20, z: 20 });
  assert.equal(g.smokes.length, 0);
  run(g, SUPPORT.smoke.delay + 0.2);
  assert.equal(g.smokes.length, SUPPORT.smoke.clouds);
  assert.equal(los(g, { x: 0, z: 20 }, { x: 40, z: 20 }), false, 'smoke screen blocks LOS through its center');
}

// Elevation: a 2-level ridge (5 m) across the middle of an empty map.
const ridge = (lvl, x0 = 9, x1 = 10) => Array.from({ length: 20 }, () => Array.from({ length: 20 }, (_, x) => (x >= x0 && x <= x1 ? lvl : 0)).join(''));
const hilly = (heights) => { const g = createGame({ ...blank(empty), heights }, ['a', 'b'], false); g.units.clear(); g.players.forEach(p => (p.spawn = { x: -1000, z: -1000 })); return g; };
{
  const g = hilly(ridge(2));
  assert.equal(los(g, { x: 5, z: 20 }, { x: 35, z: 20 }), false, 'a ridge blocks sight between the valleys');
  // ridge close to the observer: the sight line clears it (right behind a ridge is dead ground, even from a hill)
  const g2 = hilly(Array.from({ length: 20 }, () => '3333' + '0' + '22' + '0'.repeat(13)));
  assert.ok(los(g2, { x: 3, z: 20 }, { x: 35, z: 20 }), 'from higher ground you see over the ridge');
  assert.equal(los(g2, { x: 9, z: 20 }, { x: 35, z: 20 }), false, 'but not from the valley floor');
}
{
  // a 2-level jump is a cliff: the path detours to the gap at the bottom
  // a raised wall (cols 9-10) across rows 0-14, open ground below it
  const heights = Array.from({ length: 20 }, (_, y) => (y < 15 ? '0'.repeat(9) + '22' + '0'.repeat(9) : '0'.repeat(20)));
  const g = hilly(heights);
  const path = findPath(g, { x: 5, z: 5 }, { x: 35, z: 5 });
  assert.ok(path.length && path.some(p => p.z > 15 * CELL), 'cliff: path goes around it');
  // a 1-level step is a slope: straight across
  const g2 = hilly(heights.map(r => r.replace(/2/g, '1')));
  assert.ok(findPath(g2, { x: 5, z: 5 }, { x: 35, z: 5 }).every(p => p.z < 15 * CELL), 'slope: walks straight over');
}
{
  // high ground: same shot, better odds from above
  const hits = (shooterLvl) => {
    const heights = Array.from({ length: 20 }, () => String(shooterLvl).repeat(3) + '0'.repeat(17));
    const g = hilly(heights); g.players[0].mp = g.players[1].mp = 1000;
    const r = put(g, 0, 'rifle', 3, 20), t = put(g, 1, 'rifle', 25, 20);
    let n = 0;
    // total damage, not "was it hit": a 5-man volley almost always lands something, which hides the difference
    for (let i = 0; i < 3000; i++) { t.hp = 100; t.supp = 0; t.cooldown = 99; r.hp = 100; r.supp = 0; r.xp = 0; r.cooldown = 0; r.targetId = t.id; r.retarget = 1; step(g); n += 100 - t.hp; }
    return n;
  };
  const up = hits(2), flat = hits(0);
  assert.ok(up > flat * 1.15, `high ground does more damage (${up} vs ${flat})`);
}

// Depressions: a 2-deep gully hides whoever is in it from the flat ground beside it.
{
  const heights = Array.from({ length: 20 }, () => '0'.repeat(8) + 'bbbb' + '0'.repeat(8));
  const g = hilly(heights);
  assert.equal(los(g, { x: 5, z: 20 }, { x: 21, z: 20 }), false, 'gully floor is out of sight from beside it');
  assert.ok(los(g, { x: 18, z: 20 }, { x: 22, z: 20 }), 'but visible from inside');
  assert.ok(!findPath(g, { x: 5, z: 5 }, { x: 21, z: 5 }).length, 'a 2-deep drop is a cliff');
}

// Rivers, bridges, fords, destruction.
{
  // river down column 10 with a bridge at row 5 and a ford at row 15
  const rows = Array.from({ length: 20 }, (_, y) => '.'.repeat(10) + (y === 5 ? '=' : y === 15 ? 'F' : 'W') + '.'.repeat(9));
  const g = fresh(rows); g.players[0].mp = g.players[1].mp = 5000;
  const path = findPath(g, { x: 5, z: 3 }, { x: 35, z: 3 });
  assert.ok(path.length && path.every(p => Math.abs(p.z - 11) < 6 || p.x < 20 || p.x > 22), 'crosses at the bridge');
  assert.ok(los(g, { x: 5, z: 25 }, { x: 35, z: 25 }), 'you can see across water');
  // blow the bridge with artillery: it becomes river, and whoever stood on it is lost
  const onBridge = put(g, 1, 'rifle', 21, 11);
  const orig = Math.random; Math.random = () => 0.5;
  command(g, 0, { t: 'support', kind: 'artillery', x: 21, z: 11, dir: 0 });
  run(g, SUPPORT.artillery.delay + 5);
  Math.random = orig;
  assert.equal(g.chars[5 * 20 + 10], 'W', 'bridge destroyed');
  assert.ok(!g.units.has(onBridge.id), 'squad on the bridge went down with it');
  const detour = findPath(g, { x: 5, z: 3 }, { x: 35, z: 3 });
  assert.ok(detour.some(p => p.z > 25), 'now the only way over is the ford');
  assert.ok(g.cellLog.some(([c, ch]) => c === 5 * 20 + 10 && ch === 'W'), 'change is broadcast');
}
{
  // houses collapse into rubble; tanks crush hedges
  const rows = [...empty]; rows[10] = '.'.repeat(8) + 'BB' + '.'.repeat(4) + 'HH' + '.'.repeat(4);
  const g = fresh(rows); g.players[0].mp = 5000;
  const orig = Math.random; Math.random = () => 0.5;
  command(g, 0, { t: 'support', kind: 'artillery', x: 18, z: 21, dir: 0 });
  run(g, SUPPORT.artillery.delay + 5);
  Math.random = orig;
  assert.ok(g.chars.slice(10 * 20 + 8, 10 * 20 + 10).every(ch => ch === 'R'), 'house is rubble');
  assert.ok(findPath(g, { x: 17, z: 5 }, { x: 17, z: 35 }).every(p => p.x > 0), 'rubble is walkable');
  const t = put(g, 0, 'tank', 25, 5);
  command(g, 0, { t: 'move', orders: [[t.id, 31, 36]] });
  run(g, 12);
  assert.ok(g.chars.slice(10 * 20 + 14, 10 * 20 + 16).includes('.'), 'tank flattened the hedge');
}

// Attack-move: stops to fight what it meets, then carries on to the destination.
{
  const g = fresh(); g.players[0].mp = g.players[1].mp = 5000;
  const r = put(g, 0, 'rifle', 3, 20), foe = put(g, 1, 'rifle', 22, 30); foe.hp = 15;
  command(g, 0, { t: 'amove', orders: [[r.id, 37, 20]] });
  run(g, 2.5);
  assert.ok(r.x < 20, `halted to fight (${r.x.toFixed(1)})`);
  run(g, 20);
  assert.ok(!g.units.has(foe.id), 'enemy killed');
  assert.ok(Math.hypot(r.x - 37, r.z - 20) < 3, 'then reached the destination');
  // a plain move walks straight past
  const g2 = fresh(); g2.players[0].mp = g2.players[1].mp = 5000;
  const r2 = put(g2, 0, 'rifle', 3, 20); put(g2, 1, 'rifle', 22, 30);
  command(g2, 0, { t: 'move', orders: [[r2.id, 37, 20]] });
  run(g2, 9);
  assert.ok(r2.x > 30, 'move ignores enemies');
}

// Garrison: squads enter a house (one per cell), get heavy cover, and are thrown out when it's wrecked.
{
  const rows = [...empty]; rows[10] = '.'.repeat(9) + 'BB' + '.'.repeat(9);
  const g = fresh(rows); g.players[0].mp = g.players[1].mp = 5000;
  const a = put(g, 0, 'rifle', 5, 21), b = put(g, 0, 'mg', 5, 17), c = put(g, 0, 'rifle', 5, 25), t = put(g, 0, 'tank', 5, 30);
  command(g, 0, { t: 'garrison', ids: [a.id, b.id, c.id, t.id], x: 19, z: 21 });
  run(g, 8);
  assert.ok(a.garrison >= 0 && b.garrison >= 0 && a.garrison !== b.garrison, 'two squads inside, one per cell');
  assert.equal(c.garrison, -1, 'third squad: house is full');
  assert.equal(t.garrison, -1, 'tanks cannot garrison');
  assert.ok(snapshotFor(g, 0, []).units.find(u => u[0] === a.id)[12] & 32, 'snapshot flags it');
  // heavy cover: the same shots hit less often than in the open
  const foe = put(g, 1, 'mg', 19, 38); foe.still = 5; // the MG inside shoots back: foe's health is reset every step
  let inside = 0, open = 0;
  for (let i = 0; i < 1500; i++) { a.hp = 100; foe.hp = 75; foe.supp = 0; foe.cooldown = 0; foe.targetId = a.id; foe.retarget = 1; step(g); if (a.hp < 100) inside++; }
  command(g, 0, { t: 'move', orders: [[a.id, 19, 30]] });
  assert.equal(a.garrison, -1, 'a move order leaves the building');
  run(g, 3);
  for (let i = 0; i < 1500; i++) { a.hp = 100; a.x = 19; a.z = 30; foe.hp = 75; foe.supp = 0; foe.cooldown = 0; foe.targetId = a.id; foe.retarget = 1; step(g); if (a.hp < 100) open++; }
  assert.ok(inside < open * 0.8, `garrison is harder to hit (${inside} vs ${open})`);
  // wreck the house with the MG inside
  const orig = Math.random; Math.random = () => 0.5;
  command(g, 0, { t: 'support', kind: 'artillery', x: 19, z: 21, dir: 0 });
  run(g, SUPPORT.artillery.delay + 5);
  Math.random = orig;
  assert.ok(!g.units.has(b.id) || (b.garrison === -1 && b.hp < 75), 'squad thrown out and hurt when the house falls');
}

// Veterancy: damage dealt earns stars; stars make a squad better.
{
  const g = fresh(); g.players[0].mp = 5000;
  const r = put(g, 0, 'rifle', 5, 5);
  assert.equal(vet(r), 0);
  r.xp = UNITS_COST('rifle') * CFG.vetXp[1];
  assert.equal(vet(r), 2, 'two stars');
  assert.equal(snapshotFor(g, 0, []).units[0][13], 2, 'stars in the snapshot');
}

// Bombing: a stick of bombs flattens the houses along the line and craters the ground.
{
  const rows = [...empty]; rows[10] = '..' + 'BB..'.repeat(4) + '..';
  const g = fresh(rows); g.players[0].mp = g.players[1].mp = 5000;
  const houses = () => g.chars.filter(c => c === 'B').length, before = houses();
  const t = put(g, 1, 'tank', 20, 21);
  command(g, 0, { t: 'support', kind: 'bombing', x: 20, z: 21, dir: 0 });
  run(g, SUPPORT.bombing.delay + 3);
  assert.ok(houses() <= before / 4, `most of the row is gone (${before} -> ${houses()})`);
  assert.ok(g.chars.filter(c => c === '+').length >= 10, 'big craters');
  assert.ok(g.height && g.height.filter(l => l < 0).length >= 9 * 3, 'each bomb digs a 3x3 patch');
  assert.ok(g.cellLog.some(e => e[2] < 0), 'the dip is sent to clients');
  // repeated bombing never digs a pit deeper than one level below its neighbours
  for (let i = 0; i < 4; i++) { g.players[0].sup.bombing = 0; command(g, 0, { t: 'support', kind: 'bombing', x: 20, z: 21, dir: 0 }); run(g, SUPPORT.bombing.delay + 3); }
  for (let c = 0; c < g.height.length; c++) if (c % g.w > 0) assert.ok(Math.abs(g.height[c] - g.height[c - 1]) <= 1, 'no cliffs from craters');
  assert.ok(!g.units.has(t.id) || t.hp < 360 * 0.5, 'tank under the bombs is wrecked or badly hurt');
}

// Tank shells: ordered to fire at a house, the tank knocks it down.
{
  const rows = [...empty]; rows[10] = '.'.repeat(9) + 'B' + '.'.repeat(10);
  const g = fresh(rows); g.players[0].mp = 5000;
  const t = put(g, 0, 'tank', 20, 40);
  command(g, 0, { t: 'fireat', ids: [t.id], x: 19, z: 21 });
  run(g, 20);
  assert.equal(g.chars[10 * 20 + 9], 'R', 'house shelled into rubble');
  assert.equal(t.fireAt, -1, 'tank stops once it is down');
  const r = put(g, 0, 'rifle', 5, 5);
  command(g, 0, { t: 'fireat', ids: [r.id], x: 19, z: 21 });
  assert.equal(r.fireAt, -1, 'only tanks take fire-at orders');
}

// Directional cover: a wall on the shooter's side protects, the same wall does nothing against a flank shot.
{
  const rows = [...empty]; rows[10] = '.'.repeat(10) + '#' + '.'.repeat(9); // wall cell at x 20-22, z 20-22
  const g = fresh(rows); g.players[0].mp = g.players[1].mp = 5000;
  const r = put(g, 0, 'rifle', 23.5, 21), front = put(g, 1, 'mg', 3, 21), flank = put(g, 1, 'mg', 23.5, 40);
  front.still = flank.still = 5;
  const hits = (shooter, other) => { let n = 0; for (let i = 0; i < 1500; i++) { r.hp = 100; r.supp = 0; r.x = 23.5; r.z = 21; other.cooldown = 99; shooter.hp = 75; other.hp = 75; shooter.cooldown = 0; shooter.targetId = r.id; shooter.retarget = 1; r.cooldown = 99; step(g); if (r.hp < 100) n++; } return n; };
  const fromFront = hits(front, flank), fromFlank = hits(flank, front);
  assert.ok(fromFront < fromFlank * 0.8, `wall protects from the front (${fromFront}) but not the flank (${fromFlank})`);
  assert.equal(snapshotFor(g, 0, []).units.find(u => u[0] === r.id)[10], 3, 'snapshot marks "next to cover"');
}

// Rocket launcher: salvoes a garrisoned squad it can't see directly, and it hurts more than it would in the open.
{
  const rows = [...empty]; rows[10] = '.'.repeat(9) + 'BB' + '.'.repeat(9);
  const g = fresh(rows); g.players[0].mp = g.players[1].mp = 5000;
  const sq = put(g, 1, 'rifle', 19, 25);
  command(g, 1, { t: 'garrison', ids: [sq.id], x: 19, z: 21 });
  run(g, 5);
  assert.ok(sq.garrison >= 0, 'squad garrisoned');
  const spotter = put(g, 0, 'rifle', 19, 36), rk = put(g, 0, 'rocket', 19, 3);
  rk.still = 5; spotter.cooldown = 99;
  const orig = Math.random; Math.random = () => 0.01; // rockets land near the aim point (real salvos scatter up to 6 m)
  run(g, 5);
  Math.random = orig;
  assert.ok(sq.hp < 100 || !g.units.has(sq.id), 'salvo hit the garrison');
  assert.ok(g.cellHp[10 * 20 + 9] < 400 || g.chars[10 * 20 + 9] === 'R', 'and damaged the house');
  // manual barrage lands where you click, even unseen, and goes on cooldown
  const g2 = fresh(); g2.players[0].mp = 5000;
  const rk2 = put(g2, 0, 'rocket', 5, 5);
  command(g2, 0, { t: 'ability', ids: [rk2.id], x: 35, z: 35 });
  run(g2, 4);
  assert.ok(rk2.cd > 0 && g2.chars.length, 'barrage fired');
}

// Faction units: only your faction can build them; the Tiger is one at a time.
{
  const g = createGame({ ...blank(empty) }, ['a', 'b', 'c'], false); g.units.clear();
  g.players.forEach(p => (p.mp = 5000));
  command(g, 0, { t: 'buy', unit: 'tiger' }); command(g, 0, { t: 'buy', unit: 'conscript' }); command(g, 0, { t: 'buy', unit: 'ranger' });
  command(g, 1, { t: 'buy', unit: 'tiger' }); command(g, 1, { t: 'buy', unit: 'tiger' });
  command(g, 2, { t: 'buy', unit: 'conscript' });
  const types = (s) => [...g.units.values()].filter(u => u.owner === s).map(u => u.type).sort().join();
  assert.equal(types(0), 'ranger', 'USA: rangers only');
  assert.equal(types(1), 'tiger', 'Germany: one Tiger');
  assert.equal(types(2), 'conscript', 'USSR: conscripts');
}
{
  // Tiger: the front takes 60%, the rear 200%
  const g = fresh(); g.players[0].mp = g.players[1].mp = 5000;
  g.players[1].slot = 1;
  command(g, 1, { t: 'buy', unit: 'tiger' });
  const tg = [...g.units.values()].at(-1); tg.x = 20; tg.z = 20; tg.rot = 0; // facing +x
  const at = put(g, 0, 'at', 40, 20); at.still = 5;
  const orig = Math.random; Math.random = () => 0;
  run(g, 0.2); const front = 900 - tg.hp;
  tg.hp = 900; at.x = 1; at.cooldown = 0; run(g, 0.2); const rear = 900 - tg.hp;
  Math.random = orig;
  assert.equal(front, 120 * 0.7, 'front armor'); assert.equal(rear, 120 * 2, 'rear armor');
}
{
  // Rangers' satchel charge demolishes a house; Ura! shrugs off suppression and sprints
  const rows = [...empty]; rows[10] = '.'.repeat(9) + 'BB' + '.'.repeat(9);
  const g = createGame(blank(rows), ['a', 'b', 'c'], false); g.units.clear(); g.players.forEach(p => { p.mp = 5000; p.spawn = { x: -1000, z: -1000 }; });
  command(g, 0, { t: 'buy', unit: 'ranger' }); const rg = [...g.units.values()].at(-1); rg.x = 19; rg.z = 30;
  command(g, 0, { t: 'ability', ids: [rg.id], x: 19, z: 21 });
  run(g, 8);
  assert.ok(g.chars.slice(10 * 20 + 9, 10 * 20 + 11).every(c => c === 'R'), 'satchel demolished the house');
  command(g, 2, { t: 'buy', unit: 'conscript' }); const cs = [...g.units.values()].at(-1); cs.x = 5; cs.z = 35; cs.supp = 95;
  command(g, 2, { t: 'ability', ids: [cs.id] });
  command(g, 2, { t: 'move', orders: [[cs.id, 35, 35]] });
  run(g, 3);
  assert.equal(cs.supp < 50, true, 'suppression cleared');
  assert.ok(cs.x > 5 + 4.6 * 1.5 * 3 * 0.9, `sprinting (${cs.x.toFixed(1)})`);
}

// Teams: 2v2. Allies share vision, never shoot each other, hold each other's points, and win together.
{
  const six = { ...blank(Array(40).fill('.'.repeat(40))), spawns: [0, 1, 2, 3, 4, 5].map(k => ({ x: 20 + Math.round(Math.cos(k) * 15), y: 20 + Math.round(Math.sin(k) * 15) })), points: [{ x: 20, y: 20 }] };
  const g = createGame(six, ['a', 'b', 'c', 'd'], false, [0, 1, 0, 1], [0, 1, 1, 2]); g.units.clear();
  g.players.forEach(p => { p.mp = 5000; p.spawn = { x: -1000, z: -1000 }; });
  assert.equal(g.players[2].faction, 1, 'factions per player');
  command(g, 2, { t: 'buy', unit: 'tiger' }); assert.equal([...g.units.values()].at(-1)?.type, 'tiger', 'faction comes from the player, not the slot');
  g.units.clear();
  const a = put(g, 0, 'rifle', 40, 40), b = put(g, 2, 'rifle', 44, 40), foe = put(g, 1, 'rifle', 40, 70);
  run(g, 0.2);
  assert.ok(g.players[2].visible.has(foe.id), 'ally sees what I see');
  assert.equal(g.players[0].visible.has(b.id), false, 'allies are not "visible enemies"');
  assert.ok(snapshotFor(g, 0, []).units.some(u => u[0] === b.id), 'but allies are in the snapshot');
  command(g, 0, { t: 'attack', ids: [a.id], target: b.id }); assert.equal(a.attackId, 0, "can't attack an ally");
  foe.x = -500; a.x = b.x = 40; a.z = b.z = 40; // both on the point
  run(g, CFG.captureTime + 1);
  assert.ok(g.points[0].owner === 0 || g.points[0].owner === 2, 'allies capture together');
  g.players[0].vp = CFG.vpToWin * 1.2; g.players[2].vp = CFG.vpToWin; run(g, 0.1);
  assert.equal(g.winVp, CFG.vpToWin * 2, '2v2 plays to twice the VP');
  assert.equal(g.winner, 0, 'team 0 wins on combined VP');
}
{
  // spawn assignment: teammates neighbour, fewer players spread out
  assert.deepEqual(spawnSlots(6, [0, 1], false), [0, 3], '1v1 on a 6-spawn map sits opposite');
  assert.deepEqual(spawnSlots(6, [0, 1, 0, 1, 0, 1], false), [0, 3, 1, 4, 2, 5], '3v3 sides');
  assert.deepEqual(spawnSlots(6, [0, 1, 2], false), [0, 2, 4], '3-way FFA spread');
  for (let i = 0; i < 20; i++) { const s = spawnSlots(6, [0, 0, 1, 1, 2, 2]); assert.equal(new Set(s).size, 6, 'no shared spawns'); }
}

// Assault mode: the defender gets a bunker and fortifications; attackers must destroy it before time runs out.
{
  const map = JSON.parse(readFileSync('maps/default.json', 'utf8'));
  const mk = () => createGame(map, ['att', 'def'], false, [0, 1], [0, 1], { mode: 'assault', defenderTeam: 1 });
  const g = mk();
  const bunkers = [...g.units.values()].filter(u => u.type === 'bunker');
  assert.equal(bunkers.length, 1, 'one bunker');
  assert.equal(g.points.length, map.points.filter(p => (p.mp ?? 1) > 0).length, 'VP-only points are left out of assault');
  assert.ok(g.points.every(p => p.mp > 0)); assert.equal(bunkers[0].owner, 1, 'owned by the defender');
  assert.equal(vet(bunkers[0]), 0, 'a free unit is not a born veteran');
  assert.ok(g.cellLog.filter(([, ch]) => ch === 'T').length >= 8 && g.cellLog.some(([, ch]) => ch === '#'), 'trenches and walls around the base');
  assert.ok(g.players[0].mp > g.players[1].mp, 'attacker starts richer');
  // can't be ordered, doesn't count as pop
  const b = bunkers[0], bx = b.x;
  command(g, 1, { t: 'move', orders: [[b.id, 5, 5]] }); command(g, 1, { t: 'retreat', ids: [b.id] });
  run(g, 1);
  assert.equal(b.x, bx, 'bunker stays put');
  assert.ok(snapshotFor(g, 0, []).units.some(u => u[0] === b.id), 'attacker always sees the bunker');
  // direct fire barely scratches it; explosives do the work
  const t = [...g.units.values()].find(u => u.owner === 0 && u.type === 'rifle');
  g.players[0].mp = 5000; command(g, 0, { t: 'buy', unit: 'tank' });
  const tank = [...g.units.values()].at(-1); tank.x = b.x + 20; tank.z = b.z; tank.targetId = b.id; tank.retarget = 99; tank.cooldown = 0;
  const orig = Math.random; Math.random = () => 0;
  const h0 = b.hp; step(g); const shell = h0 - b.hp;
  Math.random = orig;
  assert.ok(shell > 0 && shell <= 45 * 0.25 + 0.01, `tank shell does 25% (${shell})`);
  // off-map support barely touches it: a full bombing run and a barrage dead on target do under 5%
  {
    const g2 = mk(), b2 = [...g2.units.values()].find(u => u.type === 'bunker');
    g2.players[0].mp = 5000;
    command(g2, 0, { t: 'support', kind: 'bombing', x: b2.x, z: b2.z, dir: 0 });
    command(g2, 0, { t: 'support', kind: 'artillery', x: b2.x, z: b2.z, dir: 0 });
    const orig2 = Math.random; Math.random = () => 0.5;
    run(g2, 12);
    Math.random = orig2;
    assert.ok(b2.hp < 3000 && b2.hp > 3000 * 0.95, `support strikes barely scratch the bunker (${Math.round(3000 - b2.hp)} dmg)`);
  }
  // clock runs out: defender wins
  g.mode.timeLeft = 0.01; run(g, 0.1);
  assert.equal(g.winner, 1, 'defender holds');
  // bunker destroyed: attacker wins
  const g2 = mk(), b2 = [...g2.units.values()].find(u => u.type === 'bunker');
  b2.hp = 1; g2.players[0].mp = 5000;
  command(g2, 0, { t: 'support', kind: 'artillery', x: b2.x, z: b2.z, dir: 0 }); // any hit finishes it
  const o3 = Math.random; Math.random = () => 0.5; // shells land on the aim point (random ones could all miss)
  run(g2, SUPPORT.artillery.delay + 5);
  Math.random = o3;
  assert.equal(g2.winner, 0, 'attacker wins when the bunker falls');
}

// Disconnected players: no VP and no manpower while away, then it resumes.
{
  const g = fresh(); g.players[0].mp = 1000;
  put(g, 0, 'rifle', 21, 21);
  run(g, CFG.captureTime + 1);
  g.players[0].away = true;
  const vp = g.players[0].vp, mp = g.players[0].mp;
  run(g, 10);
  assert.equal(g.players[0].vp, vp, 'no VP while away'); assert.equal(g.players[0].mp, mp, 'no manpower while away');
  g.players[0].away = false; run(g, 2);
  assert.ok(g.players[0].vp > vp, 'clock resumes on reconnect');
}

// Hill 112: in assault the defenders always get the hilltop, whatever the shuffle, and attackers can climb it.
{
  const map = JSON.parse(readFileSync('maps/hill-112.json', 'utf8'));
  assert.equal(validateMap(map), null);
  for (let i = 0; i < 10; i++) {
    const g = createGame(map, ['a', 'b', 'd'], true, [0, 0, 1], [0, 1, 2], { mode: 'assault', defenderTeam: 1 });
    const lv = (p) => g.height[Math.floor(p.spawn.z / CELL) * g.w + Math.floor(p.spawn.x / CELL)];
    assert.deepEqual(g.players.map(lv), [0, 0, 4], 'attackers below, defender on top');
    assert.ok(findPath(g, g.players[0].spawn, g.players[2].spawn).length, 'a way up');
  }
  assert.equal(validateMap({ ...map, defend: [0, 1, 2, 3] }), 'defend must list some (not all) spawn numbers');
}

// Classic mode: HQ on the spawn, resource nodes, Engineers build depots, Munitions pay for support, Annihilation.
{
  const map = JSON.parse(readFileSync('maps/default.json', 'utf8'));
  const mk = () => createGame(map, ['a', 'b'], false, [0, 1], [0, 1], { mode: 'classic' });
  const g = mk(), p = g.players[0], hq = [...g.units.values()].find(u => u.owner === 0 && u.type === 'hq');
  assert.ok(hq && hq.cells.length === 9 && hq.cells.every(c => g.chars[c] === 'K'), 'HQ stamped as a 3x3 building');
  assert.equal(p.mp, CFG.classic.mpStart); assert.equal(p.mun, 0);
  assert.ok(g.nodes.length >= 4, `resource nodes generated (${g.nodes.length})`);
  const eng = [...g.units.values()].find(u => u.owner === 0 && u.type === 'engineer');
  assert.ok(eng, 'starts with an Engineer');
  // Engineers exist only in Classic
  const cq = createGame(map, ['a', 'b'], false); cq.players[0].mp = 1000;
  const n0 = cq.units.size; command(cq, 0, { t: 'buy', unit: 'engineer' });
  assert.equal(cq.units.size, n0, 'no Engineers outside Classic');
  // build a depot on the nearest node: pays up front, stamps a site, and income rises once it's finished
  const node = g.nodes.slice().sort((a, b) => Math.hypot(a.x - eng.x, a.z - eng.z) - Math.hypot(b.x - eng.x, b.z - eng.z))[0];
  eng.x = node.x + 4; eng.z = node.z; run(g, 0.3);
  const mpBefore = p.mp;
  command(g, 0, { t: 'build', ids: [eng.id], kind: 'depot', x: node.x, z: node.z });
  const site = g.units.get(node.depot);
  assert.ok(site && site.type === 'depot' && site.built === 0, 'construction site placed');
  assert.equal(p.mp, mpBefore - 60, 'depot paid up front');
  command(g, 0, { t: 'build', ids: [eng.id], kind: 'depot', x: node.x, z: node.z });
  assert.equal(p.mp, mpBefore - 60, 'no second depot on a taken node');
  run(g, 25);
  assert.equal(site.built, 1, 'finished by one Engineer in about 20s');
  run(g, 0.2);
  const upkeep = [...g.units.values()].filter(u => u.owner === 0 && !u.cells).reduce((a, u) => a + UNITS[u.type].cost * CFG.classic.upkeep, 0);
  assert.ok(Math.abs(p.inc - (CFG.classic.trickle + node.rate - upkeep)) < 1e-9, `finished depot adds its node's rate, minus upkeep (${p.inc})`);
  assert.ok(g.nodes.some(n => n.fuel) && g.nodes.some(n => !n.fuel && n.rate === CFG.classic.homeRate), 'home MP nodes and contested Fuel nodes');
  assert.ok(upkeep > 0 && p.upkeep === upkeep, 'fielded units cost upkeep');
  // supports cost Munitions, not MP
  const mp = p.mp; p.mun = 100;
  command(g, 0, { t: 'support', kind: 'recon', x: 50, z: 50 });
  assert.equal(p.mun, 100 - SUPPORT.recon.mun, 'recon paid in Munitions'); assert.ok(p.mp >= mp, 'no MP spent');
  // holding a point earns Munitions
  const mun0 = p.mun; g.points[0].owner = 0; run(g, 2);
  assert.ok(p.mun > mun0, 'held point earns Munitions');
  // destroying the HQ eliminates the player: their stuff goes too and the other side wins
  const foeHq = [...g.units.values()].find(u => u.owner === 1 && u.type === 'hq');
  foeHq.hp = 0; run(g, 0.1);
  assert.ok(g.players[1].out, 'player without a Production Building is out');
  assert.ok(![...g.units.values()].some(u => u.owner === 1), 'their units and buildings are gone');
  assert.ok(foeHq.cells.every(c => g.chars[c] === 'R'), 'HQ collapses into rubble');
  assert.equal(g.winner, 0, 'last side standing wins');
}

// Classic production: Barracks and Motor Pool, training queues, rally, cancel, repair, retreat to the nearest building.
{
  const map = JSON.parse(readFileSync('maps/default.json', 'utf8'));
  const g = createGame(map, ['a', 'b'], false, [0, 1], [0, 1], { mode: 'classic' }), p = g.players[0];
  const eng = [...g.units.values()].find(u => u.owner === 0 && u.type === 'engineer'), hq = [...g.units.values()].find(u => u.owner === 0 && u.type === 'hq');
  p.mp = 5000;
  // HQ trains rifles, but only after the training time; MGs need a Barracks
  command(g, 0, { t: 'buy', unit: 'mg' });
  assert.equal(hq.queue.length, 0, 'no MG without a Barracks');
  const n0 = g.units.size;
  command(g, 0, { t: 'buy', unit: 'rifle' });
  assert.deepEqual(hq.queue, ['rifle'], 'rifle queued at the HQ');
  run(g, 5); assert.equal(g.units.size, n0, 'still training');
  run(g, 11); assert.equal(g.units.size, n0 + 1, 'rifle out after ~15s');
  // Motor Pool needs a finished Barracks
  const spot = (k, dx) => ({ x: hq.x + dx, z: hq.z + 16 });
  eng.x = hq.x; eng.z = hq.z + 10;
  command(g, 0, { t: 'build', ids: [eng.id], kind: 'motorpool', ...spot('motorpool', 12) });
  assert.ok(![...g.units.values()].some(u => u.type === 'motorpool'), 'no Motor Pool before a Barracks');
  command(g, 0, { t: 'build', ids: [eng.id], kind: 'barracks', ...spot('barracks', -8) });
  const bar = [...g.units.values()].find(u => u.type === 'barracks');
  assert.ok(bar && bar.built === 0 && bar.cells.length === 9, 'Barracks site placed');
  // cancel another site: 75% back and the ground is clear again
  const mp0 = p.mp;
  command(g, 0, { t: 'build', ids: [eng.id], kind: 'depot', x: g.nodes[0].x, z: g.nodes[0].z });
  const dep = [...g.units.values()].find(u => u.type === 'depot' && u.owner === 0);
  if (dep) {
    command(g, 0, { t: 'cancel', id: dep.id });
    assert.equal(g.units.has(dep.id), false, 'site gone'); assert.equal(p.mp, mp0 - 60 + 45, '75% refunded');
    assert.ok(dep.cells.every(c => g.chars[c] === '.'), 'ground cleared'); assert.equal(g.nodes[0].depot, 0, 'node free again');
  }
  command(g, 0, { t: 'assist', ids: [eng.id], id: bar.id });
  run(g, 35);
  assert.equal(bar.built, 1, 'Barracks finished');
  command(g, 0, { t: 'rally', id: bar.id, x: bar.x + 30, z: bar.z });
  command(g, 0, { t: 'buy', unit: 'mg', from: bar.id });
  assert.deepEqual(bar.queue, ['mg'], 'MG queued at the Barracks');
  run(g, 19);
  const mg = [...g.units.values()].find(u => u.owner === 0 && u.type === 'mg');
  assert.ok(mg && Math.hypot(mg.x - bar.x, mg.z - bar.z) < 12, 'MG steps out at the Barracks');
  assert.ok(mg.path.length > 0, 'and heads for the rally point');
  // queue is capped at 5, and queued units count toward the pop cap
  for (let i = 0; i < 7; i++) command(g, 0, { t: 'buy', unit: 'mg', from: bar.id });
  assert.equal(bar.queue.length, 5, 'queue holds 5');
  // Engineers repair a damaged building
  bar.queue = []; bar.hp -= 500; const hp0 = bar.hp;
  command(g, 0, { t: 'assist', ids: [eng.id], id: bar.id });
  run(g, 8);
  assert.ok(bar.hp > hp0, 'repaired');
  // retreat goes to the nearest finished Production Building
  mg.x = bar.x - 30; mg.z = bar.z; command(g, 0, { t: 'retreat', ids: [mg.id] });
  const end = mg.path.at(-1);
  assert.ok(Math.hypot(end.x - bar.x, end.z - bar.z) < Math.hypot(end.x - hq.x, end.z - hq.z), 'retreats to the Barracks, not the HQ');
}

// Classic endgame: Ghosts under fog, the army handed to a teammate, Sudden Death.
{
  const map = JSON.parse(readFileSync('maps/default.json', 'utf8'));
  // Ghosts: the enemy HQ is hidden until seen, then remembered where it was
  const g = createGame(map, ['a', 'b'], false, [0, 1], [0, 1], { mode: 'classic' });
  const foeHq = [...g.units.values()].find(u => u.owner === 1 && u.type === 'hq');
  run(g, 0.3);
  const sees = () => snapshotFor(g, 0, []).units.some(u => u[0] === foeHq.id), ghost = () => snapshotFor(g, 0, []).ghosts.some(q => q[0] === foeHq.id);
  assert.equal(sees(), false, 'enemy HQ hidden under fog'); assert.equal(ghost(), false, 'and not known yet');
  const scout = [...g.units.values()].find(u => u.owner === 0 && u.type === 'rifle');
  scout.x = foeHq.x + 12; scout.z = foeHq.z + 12; run(g, 0.3);
  assert.equal(sees(), true, 'seen up close');
  scout.x = 5; scout.z = 5; run(g, 0.3);
  assert.equal(sees(), false, 'out of sight again'); assert.equal(ghost(), true, 'but remembered as a ghost');

  // teams: an eliminated player's army goes to the surviving teammate
  const t = createGame(map, ['a', 'b', 'c'], false, [0, 0, 1], [0, 1, 2], { mode: 'classic' });
  const army = [...t.units.values()].filter(u => u.owner === 1 && !u.cells).map(u => u.id);
  [...t.units.values()].find(u => u.owner === 1 && u.type === 'hq').hp = 0;
  run(t, 0.1);
  assert.ok(t.players[1].out, 'player 1 out'); assert.equal(t.winner, null, 'team still alive');
  assert.ok(army.every(id => t.units.get(id)?.owner === 0), 'their squads now answer to the teammate');

  // Sudden Death: no training or building, Production Buildings crumble, last one standing wins
  const sd = createGame(map, ['a', 'b'], false, [0, 1], [0, 1], { mode: 'classic' });
  const hq0 = [...sd.units.values()].find(u => u.owner === 0 && u.type === 'hq'), hq1 = [...sd.units.values()].find(u => u.owner === 1 && u.type === 'hq');
  sd.players[0].mp = 1000; sd.mode.timeLeft = 0.05; run(sd, 0.2);
  assert.ok(sd.mode.suddenDeath, 'sudden death started');
  command(sd, 0, { t: 'buy', unit: 'rifle' }); assert.equal(hq0.queue.length, 0, 'no training');
  const h = hq0.hp; run(sd, 10);
  assert.ok(Math.abs(h - hq0.hp - UNITS.hq.hpPer * CFG.classic.decay * 10) < 5, `decays 1%/s (${h - hq0.hp})`);
  hq1.hp = hq0.hp - 50; run(sd, 100);
  assert.equal(sd.winner, 0, 'the sturdier base outlasts the other');
}

// Classic: unit abilities cost Munitions (and still have cooldowns); other modes stay free.
{
  const map = JSON.parse(readFileSync('maps/default.json', 'utf8'));
  const g = createGame(map, ['a', 'b'], false, [0, 1], [0, 1], { mode: 'classic' }), p = g.players[0];
  const rifle = [...g.units.values()].find(u => u.owner === 0 && u.type === 'rifle');
  p.mun = 0;
  command(g, 0, { t: 'ability', ids: [rifle.id], x: rifle.x + 5, z: rifle.z });
  assert.equal(rifle.nade, null, 'no grenade without Munitions');
  p.mun = 20;
  command(g, 0, { t: 'ability', ids: [rifle.id], x: rifle.x + 5, z: rifle.z });
  run(g, 0.2);
  assert.equal(p.mun < 20 - 14, true, `grenade paid when thrown (${p.mun})`); assert.ok(rifle.cd > 0, 'and on cooldown');
  const c = createGame(map, ['a', 'b'], false), r2 = [...c.units.values()].find(u => u.owner === 0 && u.type === 'rifle');
  command(c, 0, { t: 'ability', ids: [r2.id], x: r2.x + 5, z: r2.z }); run(c, 0.2);
  assert.ok(r2.cd > 0, 'free in Conquest');
}

// Fuel (Classic): contested depots and the HQ pay Fuel; vehicles need it. New units: camouflaged sniper, mortar barrage.
{
  const map = JSON.parse(readFileSync('maps/default.json', 'utf8'));
  const g = createGame(map, ['a', 'b'], false, [0, 1], [0, 1], { mode: 'classic' }), p = g.players[0];
  const hq = [...g.units.values()].find(u => u.owner === 0 && u.type === 'hq');
  run(g, 5);
  assert.ok(Math.abs(p.fuel - CFG.classic.hqFuel * 5) < 0.05, `HQ trickles Fuel (${p.fuel})`);
  // a Motor Pool that can train vehicles
  const c = g.units.size;
  const mp = { id: 0 }; p.mp = 5000;
  const bar = [...g.units.values()].find(u => u.type === 'hq' && u.owner === 0);
  for (const t of ['barracks', 'motorpool']) {
    const eng = [...g.units.values()].find(u => u.owner === 0 && u.type === 'engineer');
    eng.x = hq.x; eng.z = hq.z + 10;
    command(g, 0, { t: 'build', ids: [eng.id], kind: t, x: hq.x + (t === 'barracks' ? -8 : 8), z: hq.z + 16 });
    const b = [...g.units.values()].find(u => u.type === t && u.owner === 0);
    assert.ok(b, t + ' placed'); b.built = 1; b.hp = UNITS[t].hpPer;
  }
  const pool = [...g.units.values()].find(u => u.type === 'motorpool' && u.owner === 0);
  p.fuel = 10;
  command(g, 0, { t: 'buy', unit: 'tank', from: pool.id });
  assert.equal(pool.queue.length, 0, 'no tank without Fuel');
  p.fuel = 100; const mp0 = p.mp;
  command(g, 0, { t: 'buy', unit: 'tank', from: pool.id });
  assert.deepEqual(pool.queue, ['tank'], 'tank queued'); assert.equal(p.fuel, 100 - UNITS.tank.fuel); assert.equal(p.mp, mp0 - UNITS.tank.classicCost, 'cheaper in MP');
  // a depot on a contested node pays Fuel, not MP
  const fn = g.nodes.find(n => n.fuel), eng = [...g.units.values()].find(u => u.owner === 0 && u.type === 'engineer');
  // stand next to the node on open ground (village nodes have houses around them)
  const open = [[4, 0], [-4, 0], [0, 4], [0, -4], [4, 4], [-4, -4]].map(([dx, dz]) => ({ x: fn.x + dx, z: fn.z + dz })).find(q => g.chars[Math.floor(q.z / CELL) * g.w + Math.floor(q.x / CELL)] === '.');
  eng.x = open.x; eng.z = open.z; run(g, 0.3);
  command(g, 0, { t: 'build', ids: [eng.id], kind: 'depot', x: fn.x, z: fn.z });
  const dep = g.units.get(fn.depot); dep.built = 1; run(g, 0.2);
  assert.ok(Math.abs(p.fuelInc - (CFG.classic.hqFuel + CFG.classic.contestedFuel)) < 1e-9, `contested depot pays Fuel (${p.fuelInc})`);
}
{
  // sniper: seen while it shoots or moves, hidden from afar once it keeps still and quiet
  const g = fresh(); g.players[0].mp = g.players[1].mp = 1000;
  const sn = put(g, 0, 'sniper', 10, 10), spot = put(g, 1, 'rifle', 40, 10);
  spot.retarget = 999; spot.targetId = 0; spot.attackId = 0;
  sn.cooldown = 1e9; // holds fire (firing gives it away, checked below)
  run(g, 0.3);
  const seen = () => g.players[1].visible.has(sn.id);
  assert.equal(seen(), true, 'a fresh sniper is visible');
  run(g, 4);
  assert.equal(seen(), false, 'still and quiet: camouflaged at 30 m');
  spot.x = 18; run(g, 0.3);
  assert.equal(seen(), true, 'but seen up close');
  spot.x = 40; run(g, 0.3); assert.equal(seen(), false, 'hidden again from afar');
  sn.cooldown = 0; run(g, 0.5);
  assert.equal(seen(), true, 'firing gives it away');
  // mortar barrage: 4 shells on the spot, no line of sight needed
  const m = fresh(); m.players[0].mp = 1000;
  const mo = put(m, 0, 'mortar', 10, 10);
  command(m, 0, { t: 'ability', ids: [mo.id], x: 50, z: 10 });
  run(m, 0.1);
  assert.equal(m.salvos[0]?.left, 4, 'mortar barrage is 4 shells');
  // the new units are in Conquest too
  for (const t of ['mortar', 'sniper', 'armoredcar', 'medium']) { const q = fresh(); q.players[0].mp = 1000; command(q, 0, { t: 'buy', unit: t }); assert.equal(q.units.size, 1, t + ' buyable in Conquest'); }
}

// Classic resources on every shipped map: each player gets an HQ and 2 MP nodes close to home, and Fuel nodes sit
// halfway between enemies (nobody gets a private one next to their HQ).
for (const name of ['default', 'river-towns', 'six-fronts', 'hill-112']) {
  const map = JSON.parse(readFileSync(`maps/${name}.json`, 'utf8'));
  for (const n of [2, map.spawns.length]) {
    const names = Array.from({ length: n }, (_, i) => 'p' + i), g = createGame(map, names, false, names.map((_, i) => i), names.map((_, i) => i % 3), { mode: 'classic' });
    assert.ok(g.nodes.filter(nd => nd.fuel).length >= 2, `${name} ${n}p has Fuel nodes`);
    for (const p of g.players) {
      assert.ok([...g.units.values()].some(u => u.owner === p.slot && u.type === 'hq'), `${name} ${n}p: player ${p.slot} has an HQ`);
      const d = (nd) => Math.hypot(nd.x - p.spawn.x, nd.z - p.spawn.z);
      assert.ok(g.nodes.filter(nd => !nd.fuel && d(nd) < 40).length >= 2, `${name} ${n}p: player ${p.slot} has 2 MP nodes near home`);
      assert.ok(g.nodes.filter(nd => nd.fuel).every(nd => d(nd) > 20), `${name} ${n}p: no Fuel node in player ${p.slot}'s backyard`);
    }
  }
}

// XL assault maps: 6 spawns (3 defend), and a map can set its own assault clock.
for (const name of ['pegasus-bridge-xl', 'hill-112-xl', 'seawall-xl', 'monte-cassino-xl']) {
  const map = JSON.parse(readFileSync(`maps/${name}.json`, 'utf8'));
  assert.equal(validateMap(map), null, name + ' is valid');
  assert.equal(map.spawns.length, 6, name + ' has 6 spawns'); assert.deepEqual(map.defend, [0, 1, 2]);
  const g = createGame(map, ['a', 'b', 'c', 'd', 'e', 'f'], false, [0, 0, 0, 1, 1, 1], [0, 1, 2, 0, 1, 2], { mode: 'assault', defenderTeam: 0 });
  assert.equal(g.mode.timeLeft, map.assaultTime ?? CFG.assault.time, name + ' uses its own clock');
  assert.equal([...g.units.values()].filter(u => u.type === 'bunker').length, 3, name + ': a bunker per defender');
}
assert.equal(validateMap({ ...JSON.parse(readFileSync('maps/default.json', 'utf8')), assaultTime: 5 }), 'assaultTime must be 300-3600 seconds');
// Assault-only spawns: a spawn inside the defenders' fortress is skipped by every other mode
{
  const m = { ...JSON.parse(readFileSync('maps/default.json', 'utf8')) };
  m.spawns = [{ ...m.spawns[0], assault: true }, ...m.spawns.slice(1), { x: 40, y: 40 }];
  m.spawns[3] = { x: 40, y: 44 };
  for (let i = 0; i < 20; i++) {
    const g = createGame(m, ['a', 'b', 'c'], true);
    assert.ok(g.players.every(p => Math.abs(p.spawn.x - (m.spawns[0].x + 0.5) * CELL) > 1 || Math.abs(p.spawn.z - (m.spawns[0].y + 0.5) * CELL) > 1), 'Conquest never uses the Assault-only spawn');
  }
  const a = createGame({ ...m, defend: [0] }, ['d', 'a'], false, [0, 1], [0, 1], { mode: 'assault', defenderTeam: 0 });
  assert.deepEqual([a.players[0].spawn.x, a.players[0].spawn.z], [(m.spawns[0].x + 0.5) * CELL, (m.spawns[0].y + 0.5) * CELL], 'Assault defends from it');
  assert.equal(validateMap({ ...m, spawns: [{ ...m.spawns[0], assault: true }, { ...m.spawns[1], assault: true }, m.spawns[2]] }), 'needs 2+ spawns that every mode can use');
}

// Aviation: air support (dive bomber, paratroopers, fighter cover), flak shoot-downs, planes on sorties, anti-air.
{
  const R = Math.random;
  // dive bomber: one heavy bomb right on the spot
  const d = fresh(); d.players[0].mp = d.players[1].mp = 1000;
  const tank = put(d, 1, 'tank', 30, 30); run(d, 0.2);
  command(d, 0, { t: 'support', kind: 'dive', x: 30, z: 30 });
  run(d, SUPPORT.dive.delay + 0.5);
  assert.ok(tank.hp <= 0 || !d.units.has(tank.id), 'a dive bomber kills a tank it lands on');
  // paratroopers: only where your side can see, and they arrive as a rifle squad
  const pa = fresh(); pa.players[0].mp = 1000;
  const eye = put(pa, 0, 'rifle', 10, 10); run(pa, 0.3);
  command(pa, 0, { t: 'support', kind: 'para', x: 300, z: 300 });
  assert.equal(pa.strikes.length, 0, 'no drop where nobody sees');
  command(pa, 0, { t: 'support', kind: 'para', x: 20, z: 12 });
  run(pa, SUPPORT.para.delay + 0.5);
  assert.equal([...pa.units.values()].filter(u => u.owner === 0 && u.type === 'rifle').length, 2, 'a squad dropped in');
  // fighter cover intercepts the next enemy strike over it (but never recon)
  const fc = fresh(); fc.players[0].mp = fc.players[1].mp = 2000;
  const target = put(fc, 1, 'tank', 30, 30); run(fc, 0.2);
  command(fc, 1, { t: 'support', kind: 'cover', x: 30, z: 30 }); run(fc, SUPPORT.cover.delay + 0.2);
  command(fc, 0, { t: 'support', kind: 'recon', x: 30, z: 30, dir: 0 }); run(fc, SUPPORT.recon.delay + 0.2);
  assert.ok(fc.strikes.some(q => q.kind === 'recon' && q.live), 'recon flies through fighter cover');
  command(fc, 0, { t: 'support', kind: 'dive', x: 30, z: 30 }); run(fc, SUPPORT.dive.delay + 0.5);
  assert.ok(fc.units.has(target.id) && target.hp === UNITS.tank.hpPer, 'the dive bomber was shot down: no damage');
  assert.equal(fc.covers.length, 0, 'fighter cover is used up');
  // flak: each gun in range rolls its chance to shoot a support plane down
  const fk = fresh(); fk.players[0].mp = fk.players[1].mp = 2000;
  const t2 = put(fk, 1, 'tank', 30, 30), gun = put(fk, 1, 'flak', 34, 30); run(fk, 3);
  Math.random = () => 0; // every roll hits
  command(fk, 0, { t: 'support', kind: 'dive', x: 30, z: 30 }); run(fk, SUPPORT.dive.delay + 0.5);
  Math.random = R;
  assert.equal(t2.hp, UNITS.tank.hpPer, 'flak shot the dive bomber down');
  // flak can't hurt tanks
  const fv = fresh(); fv.players[0].mp = fv.players[1].mp = 2000;
  const tk = put(fv, 1, 'tank', 20, 20), fl = put(fv, 0, 'flak', 34, 20); run(fv, 6);
  assert.equal(tk.hp, UNITS.tank.hpPer, 'flak does nothing to a tank');
}
{
  // a plane's sortie: at base, out to the mission, circling, home when the fuel runs out, rearm, ready again
  const big = Array(60).fill('.'.repeat(60)); // 120 m: room to fly
  const g = fresh(big); g.players[0].mp = g.players[1].mp = 5000;
  g.players[0].spawn = { x: 10, z: 10 }; g.players[1].spawn = { x: 70, z: 70 };
  const f = put(g, 0, 'fighter', 0, 0); run(g, 0.1);
  assert.equal(f.air.state, 'base', 'a new plane waits at its base');
  assert.ok(snapshotFor(g, 0, []).units.find(u => u[0] === f.id)[12] & 512, 'flagged at base for its owner');
  command(g, 0, { t: 'move', orders: [[f.id, 40, 40]] });
  run(g, 3);
  assert.ok(f.air.state === 'out' || f.air.state === 'station', 'took off');
  run(g, 4);
  assert.equal(f.air.state, 'station', 'circling the mission');
  assert.ok(Math.hypot(f.x - 40, f.z - 40) < CFG.air.orbit + 3, 'over the spot');
  // enemies see it from afar without line of sight, rifles can't shoot it
  const watcher = put(g, 1, 'rifle', 40, 75); run(g, 0.3); // 35 m from the spot, the plane circles 18 m around it
  assert.equal(g.players[1].visible.has(f.id), true, 'seen from afar, over the circle');
  run(g, CFG.air.station + 6);
  assert.ok(f.air.state === 'home' || f.air.state === 'rearm', 'fuel spent: heading home');
  run(g, 6 + CFG.air.rearm);
  assert.equal(f.air.state, 'base', 'rearmed and ready');
  assert.equal(g.players[1].visible.has(f.id), false, 'invisible at base');
  // ground attack: a plane on an attack mission damages its target; flak over it shoots it down
  const ga = fresh(big); ga.players[0].mp = ga.players[1].mp = 5000;
  ga.players[0].spawn = { x: 10, z: 10 }; ga.players[1].spawn = { x: 80, z: 80 };
  const at = put(ga, 0, 'attacker', 0, 0), tank = put(ga, 1, 'tank', 50, 50), spot = put(ga, 0, 'rifle', 30, 50);
  run(ga, 0.5);
  command(ga, 0, { t: 'attack', ids: [at.id], target: tank.id });
  run(ga, 15);
  assert.ok(tank.hp < UNITS.tank.hpPer, `the ground-attack plane hit the tank (${tank.hp})`);
  const fl1 = put(ga, 1, 'flak', 52, 50), fl2 = put(ga, 1, 'flak', 48, 50);
  const mp1 = ga.players[1].mp;
  run(ga, 20);
  assert.ok(!ga.units.has(at.id), 'two flak guns shot the plane down');
  assert.ok(ga.players[1].mp > mp1 + UNITS.attacker.cost * CFG.bounty * 0.9, 'and paid the kill bounty');
}
{
  // Classic: an Airfield (needs a Motor Pool) trains planes, which use it as their base
  const map = JSON.parse(readFileSync('maps/default.json', 'utf8'));
  const g = createGame(map, ['a', 'b'], false, [0, 1], [0, 1], { mode: 'classic' }), p = g.players[0];
  const hq = [...g.units.values()].find(u => u.owner === 0 && u.type === 'hq'), eng = [...g.units.values()].find(u => u.owner === 0 && u.type === 'engineer');
  p.mp = 9000; p.fuel = 500; eng.x = hq.x; eng.z = hq.z + 10;
  command(g, 0, { t: 'build', ids: [eng.id], kind: 'airfield', x: hq.x + 10, z: hq.z + 18 });
  assert.ok(![...g.units.values()].some(u => u.type === 'airfield'), 'no Airfield without a Motor Pool');
  for (const [t, dx] of [['barracks', -8], ['motorpool', 8], ['airfield', 26]]) {
    command(g, 0, { t: 'build', ids: [eng.id], kind: t, x: hq.x + dx, z: hq.z + 18 });
    const b = [...g.units.values()].find(u => u.type === t && u.owner === 0); assert.ok(b, t + ' placed'); b.built = 1; b.hp = UNITS[t].hpPer;
  }
  const af = [...g.units.values()].find(u => u.type === 'airfield');
  command(g, 0, { t: 'buy', unit: 'fighter', from: af.id });
  assert.deepEqual(af.queue, ['fighter'], 'fighter queued at the Airfield');
  assert.equal(p.fuel, 500 - UNITS.fighter.fuel, 'planes cost Fuel in Classic');
  run(g, UNITS.fighter.train + 1);
  const f = [...g.units.values()].find(u => u.type === 'fighter');
  assert.ok(f && f.air.state === 'base' && Math.hypot(f.x - af.x, f.z - af.z) < 1, 'the new fighter sits at its Airfield');
}
{
  // kill bounty: 20% of the dead unit's cost to the enemy who finished it
  const g = fresh(); g.players[0].mp = g.players[1].mp = 1000;
  const a = put(g, 0, 'rifle', 10, 10), b = put(g, 1, 'rifle', 30, 10); b.hp = 1;
  const mp0 = g.players[0].mp;
  run(g, 3);
  assert.ok(!g.units.has(b.id), 'enemy squad died');
  assert.ok(g.players[0].mp >= mp0 + UNITS.rifle.cost * CFG.bounty - 0.01, `bounty paid (${g.players[0].mp - mp0})`);
}

// Plans: snapshots carry your own units' routes and locked targets, never anyone else's.
{
  const g = fresh(); g.players[0].mp = g.players[1].mp = 1000;
  const a = put(g, 0, 'rifle', 5, 5), b = put(g, 1, 'rifle', 20, 5);
  run(g, 0.3);
  command(g, 0, { t: 'move', orders: [[a.id, 30, 30]] });
  let plans = snapshotFor(g, 0, []).plans;
  assert.deepEqual(plans.map(q => q[0]), [a.id], 'only my units');
  assert.equal(plans[0][1], 1, 'moving'); assert.ok(plans[0].length > 4, 'with waypoints');
  command(g, 0, { t: 'attack', ids: [a.id], target: b.id });
  plans = snapshotFor(g, 0, []).plans;
  assert.deepEqual(plans[0].slice(1, 4), [4, b.x, b.z], 'locked onto the target it was ordered to attack');
}

// Every shipped map is valid, and every spawn can walk to every capture point and every other spawn.
for (const f of readdirSync('maps')) {
  const map = JSON.parse(readFileSync('maps/' + f, 'utf8'));
  assert.equal(validateMap(map), null, f);
  const g = createGame(map, ['a', 'b'], false), W = (p) => ({ x: (p.x + 0.5) * CELL, z: (p.y + 0.5) * CELL });
  for (const s of map.spawns) for (const p of [...map.points, ...map.spawns]) {
    if (p !== s) assert.ok(findPath(g, W(s), W(p)).length, `${f}: spawn ${s.x},${s.y} can reach ${p.x},${p.y}`);
  }
}

// Annihilation: everyone gets a fortified bunker; a side is out when its last bunker falls, no clock.
{
  const map = JSON.parse(readFileSync('maps/default.json', 'utf8'));
  const g = createGame(map, ['a', 'b', 'c', 'd'], false, [0, 0, 1, 1], [0, 1, 2, 0], { mode: 'annihilation' });
  const bunkers = [...g.units.values()].filter(u => u.type === 'bunker');
  assert.deepEqual(bunkers.map(b => b.owner).sort(), [0, 1, 2, 3], 'one bunker each');
  assert.ok(g.cellLog.filter(([, ch]) => ch === 'T').length >= 4 * 8, 'and trenches around every base');
  assert.ok(g.points.every(p => p.mp > 0), 'no VP-only points');
  assert.equal(g.players[0].mp, g.players[2].mp, 'both sides start equal');
  run(g, 20 * 60); // no clock: twenty quiet minutes later it's still on
  assert.equal(g.winner, null);
  bunkers.find(b => b.owner === 2).hp = 0; run(g, 0.1);
  assert.equal(g.winner, null, 'team 1 still has a bunker');
  bunkers.find(b => b.owner === 3).hp = 0; run(g, 0.1);
  assert.equal(g.winner, 0, 'last side with a bunker wins');
  const solo = createGame(map, ['a'], false, [0], [0], { mode: 'annihilation' });
  run(solo, 1); assert.equal(solo.winner, null, 'a solo test never ends by itself');
}

// Real map loads for 3 players, all spawns start with their force.
{
  const g = createGame(JSON.parse(readFileSync('maps/default.json', 'utf8')), ['a', 'b', 'c']);
  assert.equal(g.units.size, 9);
  run(g, 5);
}
// Three AIs play a full match on the real map: they must capture, fight, and finish.
{
  const g = createGame(JSON.parse(readFileSync('maps/default.json', 'utf8')), ['a', 'b', 'c']);
  let spawned = g.nextId, t0 = performance.now(), capturedAt = 0;
  for (let i = 0; i < 20 * 60 * 40 && g.winner === null; i++) {
    for (let s = 0; s < 3; s++) if ((g.tick + s * 13) % 40 === 0) think(g, s);
    step(g);
    if (!capturedAt && g.points.every(p => p.owner >= 0)) capturedAt = g.tick / 20;
  }
  const secs = g.tick / 20, bought = g.nextId - spawned, dead = g.nextId - 1 - g.units.size;
  console.log(`AI match: winner ${g.winner} after ${Math.round(secs)}s, all points taken at ${Math.round(capturedAt)}s, ${bought} bought, ${dead} killed, VP ${g.players.map(p => Math.floor(p.vp))}, sim ${Math.round((performance.now() - t0) / g.tick * 1000)}µs/tick`);
  assert.ok(capturedAt > 0 && capturedAt < 180, 'AIs take every point within 3 minutes');
  assert.ok(dead >= 5, 'AIs actually fight');
  assert.notEqual(g.winner, null, 'match ends within 30 minutes');
  assert.ok(g.story.every(s => s.mpSpent > 0) && g.story.some(s => s.kills > 0 && s.captures > 0), 'the story counts the match');
  assert.ok(g.timeline.length >= secs / 10, 'and samples it every 10 s');
}

// The end of a match (shared/story.js, finish() in sim.js, holdEnding() in server.js): every win records why and where,
// the story counts what each player did, and the server holds the ending for 6 s before the lobby shows the result.
{
  const map = JSON.parse(readFileSync('maps/default.json', 'utf8'));
  const near = (a, b) => Math.abs(a.x - b.x) < 0.11 && Math.abs(a.z - b.z) < 0.11;
  // Conquest: VP; the decisive spot is the point the winners took last
  const g = fresh(Array(60).fill('.'.repeat(60))); g.players[0].mp = g.players[1].mp = 1000;
  const pt = g.points[0], mp0 = g.players[0].mp, r = put(g, 0, 'rifle', pt.x, pt.z), e = put(g, 1, 'rifle', 110, 110);
  assert.equal(g.story[0].mpSpent, mp0 - g.players[0].mp, 'the story counts manpower spent');
  run(g, CFG.captureTime + 1);
  assert.equal(pt.owner, 0); assert.equal(g.story[0].captures, 1, 'and captures');
  assert.ok(!snapshotFor(g, 0, []).units.some(u => u[0] === e.id), 'fog holds while the match is on');
  assert.equal(snapshotFor(g, 0, []).end, undefined, 'no end data before the winner');
  assert.equal(g.timeline[0].t, 0); assert.equal(g.timeline[0].vp.length, 2, 'the timeline starts at 0 s with VP per team');
  g.players[0].vp = g.winVp - 0.01; run(g, 1);
  assert.equal(g.winner, 0); assert.equal(g.endReason, 'vp');
  assert.ok(near(g.endAt, pt), 'a VP win ends on the point the winners took last');
  const snap = snapshotFor(g, 0, []);
  assert.deepEqual(snap.end, { reason: 'vp', x: g.endAt.x, z: g.endAt.z });
  assert.ok(snap.units.some(u => u[0] === e.id) && snap.units.length === g.units.size, 'once decided, everyone sees everything');
  // after the winner the sim runs on (the server's hold) but orders, the story and the timeline stop
  const samples = g.timeline.length, ids = g.nextId;
  command(g, 1, { t: 'buy', unit: 'rifle' }); command(g, 1, { t: 'move', orders: [[e.id, 30, 30]] });
  assert.equal(g.nextId, ids, 'no buying after the end'); assert.equal(e.path.length, 0, 'no orders after the end');
  r.hp = 0; run(g, 11);
  assert.ok(!g.units.has(r.id), 'the sim still runs after the end');
  assert.equal(g.story[0].losses, 0, 'nothing counts after the end');
  assert.equal(g.timeline.length, samples, 'and the timeline stops');
  assert.equal(g.winner, 0, 'the winner never changes');

  // Assault: the last structure falling, or the clock
  const as = () => createGame(map, ['att', 'def'], false, [0, 1], [0, 1], { mode: 'assault', defenderTeam: 1 });
  const a = as(), structs = [...a.units.values()].filter(u => UNITS[u.type].structure), last = structs.at(-1);
  structs.slice(0, -1).forEach(s => (s.hp = 0)); run(a, 0.1);
  assert.equal(a.winner, null, 'a structure still stands');
  last.hp = 0; run(a, 0.1);
  assert.equal(a.winner, 0); assert.equal(a.endReason, 'structures');
  assert.ok(near(a.endAt, last), 'it ends where the last structure fell');
  const t = as(); t.mode.timeLeft = 0.01; run(t, 0.1);
  assert.equal(t.winner, 1); assert.equal(t.endReason, 'timer');
  assert.deepEqual(t.endAt, { x: t.w * CELL / 2, z: t.h * CELL / 2 }, 'a timer win ends over the middle of the map');

  // Annihilation: the last bunker; all of them at once is a draw
  const an = () => createGame(map, ['a', 'b', 'c', 'd'], false, [0, 0, 1, 1], [0, 1, 2, 0], { mode: 'annihilation' });
  const n = an(), bunker = (gg, o) => [...gg.units.values()].find(u => u.type === 'bunker' && u.owner === o);
  bunker(n, 2).hp = 0; run(n, 0.1);
  const b3 = bunker(n, 3); b3.hp = 0; run(n, 0.1);
  assert.equal(n.winner, 0); assert.equal(n.endReason, 'bunkers'); assert.ok(near(n.endAt, b3), 'it ends at the last bunker');
  assert.equal(n.story[0].losses + n.story[1].losses, 0); assert.equal(n.story[2].losses + n.story[3].losses, 2, 'bunkers count as losses');
  const d = an(); for (const u of d.units.values()) if (u.type === 'bunker') u.hp = 0;
  run(d, 0.1);
  assert.equal(d.winner, -1); assert.equal(d.endReason, 'draw', 'every bunker down together: a draw');
  assert.ok(d.timeline.at(-1).points && d.timeline.at(-1).structures.every(v => v === 0), 'the timeline counts points and structures');

  // Classic: the last Production Building
  const c = createGame(map, ['a', 'b'], false, [0, 1], [0, 1], { mode: 'classic' }), hq = [...c.units.values()].find(u => u.owner === 1 && u.type === 'hq');
  hq.hp = 0; run(c, 0.1);
  assert.equal(c.winner, 0); assert.equal(c.endReason, 'hq'); assert.ok(near(c.endAt, hq), 'it ends at the fallen HQ');

  // the counters: kills and losses, support calls, planes downed, field works
  const k = fresh(); k.players[0].mp = k.players[1].mp = 1000;
  put(k, 0, 'rifle', 5, 5); const victim = put(k, 1, 'rifle', 15, 5); victim.hp = 1;
  run(k, 5);
  assert.ok(!k.units.has(victim.id)); assert.equal(k.story[0].kills, 1); assert.equal(k.story[1].losses, 1);
  assert.equal(k.story[0].losses + k.story[1].kills, 0, 'kills and losses go to the right players');
  const fc = fresh(); fc.players[0].mp = fc.players[1].mp = 2000;
  put(fc, 1, 'tank', 30, 30); run(fc, 0.2);
  command(fc, 1, { t: 'support', kind: 'cover', x: 30, z: 30 }); run(fc, SUPPORT.cover.delay + 0.2);
  command(fc, 0, { t: 'support', kind: 'dive', x: 30, z: 30 }); run(fc, SUPPORT.dive.delay + 0.5);
  assert.deepEqual(fc.story.map(s => s.supportCalls), [1, 1], 'support calls');
  assert.equal(fc.story[1].planesDowned, 1, 'fighter cover downing a dive bomber');
  assert.equal(fc.story[1].mpSpent, UNITS.tank.cost + SUPPORT.cover.cost);
  const dg = fresh(); dg.players[0].mp = 1000;
  const digger = put(dg, 0, 'rifle', 20, 20);
  command(dg, 0, { t: 'dig', ids: [digger.id], x: 20, z: 20 }); run(dg, CFG.digTime * CFG.digCells + 5);
  assert.equal(digger.dig, null); assert.equal(dg.story[0].built, 1, 'a finished trench counts as built');
}

// The server's side of the end, in-process: the 6 s hold (half speed, orders refused, AIs idle, fog lifted), then the
// lobby with the result and each player's own outcome. Real WebSocket clients against server.js on a free port.
{
  process.env.PORT = '0'; process.env.PUBLIC_URL = 'http://test';
  const { WebSocket } = await import('ws');
  const realSetInterval = globalThis.setInterval, loops = [];
  globalThis.setInterval = (...a) => { const h = realSetInterval(...a); loops.push(h); return h; };
  const { rooms, server, wss } = await import('./server.js');
  globalThis.setInterval = realSetInterval;
  const sleep = (ms) => new Promise(ok => setTimeout(ok, ms));
  const until = async (fn, what, ms = 15000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timed out: ' + what); await sleep(5); } };
  await until(() => server.listening, 'server listening');
  const clients = [];
  const join = async (code, name) => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws?room=${code}`), c = { ws, snaps: [], lobbies: [], send: (m) => ws.send(JSON.stringify(m)) };
    clients.push(c);
    ws.on('message', (raw) => { const m = JSON.parse(raw); if (m.t === 's') c.snaps.push(m); if (m.t === 'lobby') c.lobbies.push(m); });
    await new Promise((ok, fail) => { ws.on('open', ok); ws.on('error', fail); });
    c.send({ t: 'hello', token: 'tok-' + name, name });
    await until(() => c.lobbies.length, name + ' in the lobby');
    return c;
  };
  const setUp = async (code, names) => {
    const people = [];
    for (const nm of names) people.push(await join(code, nm));
    const room = rooms.get(code), host = people[0], ai = names.length;
    host.send({ t: 'addAi' }); await until(() => room.players.length === ai + 1, 'AI added');
    host.send({ t: 'team', slot: ai, v: 1 }); host.send({ t: 'mode', v: 'annihilation' });
    await until(() => room.mode === 'annihilation' && room.players[ai].team === 1, 'settings');
    host.send({ t: 'start' }); await until(() => room.state === 'play' && room.game && host.snaps.length, 'match started');
    return { room, g: room.game, people };
  };
  const decided = (room) => until(() => room.game.winner !== null, 'a winner');
  const backInLobby = (room, c) => until(() => room.state === 'lobby' && c.lobbies.at(-1)?.result?.story, 'the lobby result', 12000);

  // win and loss: Ann (team 0) against Ben and an AI (team 1)
  const winLoss = async () => {
    const { room, g, people: [ann, ben] } = await setUp('endwin', ['Ann', 'Ben']);
    // count the AI's thinking: think() first reads its player's out flag
    let thinks = 0;
    Object.defineProperty(g.players[2], 'out', { get() { if (/\/ai\.js:/.test(new Error().stack)) thinks++; return undefined; }, set() {}, configurable: true });
    await until(() => thinks > 0, 'the AI thinks during the match');
    const mine = () => [...g.units.values()].filter(u => u.owner === 0).length, before = mine();
    ann.send({ t: 'buy', unit: 'rifle' }); await until(() => mine() === before + 1, 'orders work during the match');
    await sleep(150);
    const seenByAnn = new Set(ann.snaps.flatMap(s => s.units.map(u => u[0])));
    const hidden = [...g.units.values()].find(u => g.players[u.owner].team === 1 && !UNITS[u.type].structure && !seenByAnn.has(u.id));
    assert.ok(hidden, 'an enemy unit Ann never saw: the fog holds while the match is on');
    assert.ok([...ann.snaps, ...ben.snaps].every(s => s.end === undefined && s.winner === null && !('story' in s) && !('timeline' in s)), 'no end data while the match is on');
    assert.equal(ann.lobbies.at(-1).result, null, 'no result while the match is on');
    const nSnaps = ann.snaps.length;
    for (const u of g.units.values()) if (u.type === 'bunker' && g.players[u.owner].team === 1) u.hp = 0;
    await decided(room);
    const winTick = g.tick, thought = thinks, ids = g.nextId, benUnit = [...g.units.values()].find(u => u.owner === 1 && !UNITS[u.type].structure);
    assert.equal(g.winner, 0); assert.equal(g.endReason, 'bunkers');
    // the hold: orders refused, everything in sight
    ben.send({ t: 'buy', unit: 'rifle' }); ben.send({ t: 'move', orders: [[benUnit.id, 5, 5]] });
    await sleep(300);
    assert.equal(room.state, 'play', 'the match holds before the lobby');
    assert.equal(g.nextId, ids, 'no buying during the hold');
    assert.ok(!benUnit.path.length || Math.hypot(benUnit.path.at(-1).x - 5, benUnit.path.at(-1).z - 5) > 1, 'no orders during the hold');
    assert.equal(snapshotFor(g, 0, []).units.length, g.units.size, 'full vision during the hold');
    await backInLobby(room, ann);
    assert.equal(thinks, thought, 'the AI stops thinking during the hold');
    assert.equal(g.tick - winTick, 60, 'the hold runs the sim at half speed: 60 steps in 6 s');
    const held = ann.snaps.slice(nSnaps);
    assert.ok(held.length >= 55 && held.every(s => s.winner === 0 && s.end.reason === 'bunkers'), 'snapshots carry the end through the hold');
    assert.ok(held.some(s => s.units.some(u => u[0] === hidden.id)), 'the fog lifts for everyone');
    const ra = ann.lobbies.at(-1).result, rb = ben.lobbies.at(-1).result;
    assert.equal(ra.reason, 'bunkers'); assert.deepEqual(ra.at, g.endAt); assert.equal(ra.story.length, 3); assert.ok(ra.timeline.length >= 2);
    assert.ok(ra.story[1].losses + ra.story[2].losses >= 2, 'the bunkers are in the story');
    assert.deepEqual(ra.you, { outcome: 'victory', team: 0 }); assert.deepEqual(rb.you, { outcome: 'defeat', team: 1 });
    assert.deepEqual(room.players[2].lastMatch, { outcome: 'defeat', team: 1 }, 'the AI lost too');
  };
  // a draw: Cal against an AI, every bunker down on the same tick
  const draw = async () => {
    const { room, g, people: [cal] } = await setUp('enddraw', ['Cal']);
    for (const u of g.units.values()) if (u.type === 'bunker') u.hp = 0;
    await decided(room);
    assert.equal(g.winner, -1);
    await backInLobby(room, cal);
    const res = cal.lobbies.at(-1).result;
    assert.equal(res.winner, -1); assert.equal(res.reason, 'draw');
    assert.deepEqual(res.you, { outcome: 'draw', team: 0 }); assert.deepEqual(room.players[1].lastMatch, { outcome: 'draw', team: 1 });
    // the next start clears the result
    cal.send({ t: 'start' });
    await until(() => room.state === 'play' && room.game && cal.lobbies.at(-1).result === null, 'a new match without the old result');
  };
  try { await Promise.all([winLoss(), draw()]); }
  finally {
    for (const room of rooms.values()) room.players.forEach(p => (p.ws = null)); // no 10 s seat timers
    for (const c of clients) c.ws.terminate();
    for (const ws of wss.clients) ws.terminate();
    loops.forEach(clearInterval); wss.close(); server.close();
  }
  console.log('match end: hold, fog lift, result and story checked over the server');
}
console.log('all sim checks passed');
