// Historic battle maps: node tools/genmap-history.mjs
// Four maps after real WW2 battles, each built around what made that fight special:
//   Prokhorovka     (Kursk, July 1943)   Conquest. Open steppe for tanks: Hill 252.2 in the middle, a railway
//                                        embankment, anti-tank ditches with a few causeways, ravines to flank through.
//   Hurtgen Forest  (Autumn 1944)        Conquest. Dense woods cut by firebreaks, dragon's teeth, and the Kall gorge
//                                        down the middle, crossed only by a narrow trail bridge and two fords.
//   El Alamein      (October 1942)       Assault. The attackers must get through two belts of the Devil's Gardens
//                                        (minefields and wire) by staggered gaps, then up Miteirya Ridge.
//   Seelow Heights  (April 1945)         Assault. A muddy Oder floodplain cut by canals, then an escarpment with
//                                        ramps only at the roads, Seelow town on top, three trench lines.
// The two Conquest maps are point-symmetric (every cell has its twin through the center), so they are fair by
// construction. Every map is validated and every spawn is checked to reach every point.
import { writeFileSync } from 'node:fs';
import { validateMap, findPath, TERRAIN, levelOf, CELL } from '../shared/sim.js';

function canvas(W, H, seed, mirror = false) {
  const g = Array.from({ length: H }, () => Array(W).fill('.'));
  const hgt = Array.from({ length: H }, () => Array(W).fill(0));
  const inb = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  // with mirror on, everything drawn also lands on its twin through the center
  const twins = (x, y) => (mirror ? [[x, y], [W - 1 - x, H - 1 - y]] : [[x, y]]);
  const at = (x, y) => (inb(x, y) ? g[y][x] : null);
  const set = (x, y, ch, keep = '') => { x = Math.round(x); y = Math.round(y); for (const [a, b] of twins(x, y)) if (inb(a, b) && !keep.includes(g[b][a])) g[b][a] = ch; };
  const lift = (x, y, l) => { x = Math.round(x); y = Math.round(y); for (const [a, b] of twins(x, y)) if (inb(a, b)) hgt[b][a] = l; };
  const rect = (x0, y0, x1, y1, ch, keep) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, ch, keep); };
  const line = (x0, y0, x1, y1, ch, keep, width = 1) => {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2) || 1;
    for (let i = 0; i <= n; i++) for (let k = 0; k < width; k++) {
      const x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * i / n;
      Math.abs(x1 - x0) > Math.abs(y1 - y0) ? set(x, y + k, ch, keep) : set(x + k, y, ch, keep);
    }
  };
  const disc = (cx, cy, r, ch, p = 1, keep = '') => { for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) if (Math.hypot(x - cx, y - cy) < r && rnd() < p) set(x, y, ch, keep); };
  let s = seed; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  return { W, H, g, hgt, inb, at, set, lift, rect, line, disc, rnd };
}

// a level-2+ step is a cliff: soften every cliff not listed as wanted into a one-level slope
function slopes(c, keepCliff = () => false) {
  const { W, H, hgt, inb } = c;
  for (let pass = 0; pass < 4; pass++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, ny = y + dy;
    if (inb(nx, ny) && hgt[y][x] - hgt[ny][nx] >= 2 && !keepCliff(x, y, nx, ny)) hgt[ny][nx] = hgt[y][x] - 1;
  }
}

const lc = (l) => (l >= 0 ? String(l) : l === -1 ? 'a' : 'b');

function finish(c, file, map, extraRows = []) {
  const { W, H, g, hgt } = c;
  // clear a 5x5 yard on every spawn and point (water, roads and bridges stay)
  for (const p of [...map.spawns, ...map.points]) for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) if (c.inb(p.x + x, p.y + y) && !'.DW=FM'.includes(g[p.y + y][p.x + x])) g[p.y + y][p.x + x] = '.';
  const out = { name: map.name, w: W, h: H, rows: g.map(r => r.join('')), heights: hgt.map(r => r.map(lc).join('')), ...map };
  const err = validateMap(out);
  if (err) throw new Error(`${file}: ${err}`);
  // every spawn reaches every point on foot and by vehicle
  for (const rows of [out.rows, ...extraRows]) {
    const mg = { w: W, h: H, flags: Uint16Array.from(rows.join(''), ch => TERRAIN[ch]), height: Int8Array.from(out.heights.join(''), levelOf) };
    const world = (p) => ({ x: (p.x + 0.5) * CELL, z: (p.y + 0.5) * CELL });
    for (const sp of out.spawns) for (const p of out.points) for (const type of ['rifle', 'tank']) {
      if (!findPath(mg, { ...world(sp), type }, world(p)).length) throw new Error(`${file}: spawn ${sp.x},${sp.y} can't reach point ${p.x},${p.y} (${type})`);
    }
  }
  writeFileSync(new URL(`../maps/${file}.json`, import.meta.url), JSON.stringify(out, null, 1));
  console.log('wrote', file);
}

// ---------------------------------------------------------------- Prokhorovka
{
  const W = 120, H = 90, c = canvas(W, H, 1943, true), { set, lift, rect, line, disc, rnd, hgt } = c;
  // Hill 252.2 in the middle: a broad level-2 crown on a level-1 shoulder
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = Math.hypot((x - 59.5) / 1.4, y - 44.5);
    if (d < 6) hgt[y][x] = 2; else if (d < 13) hgt[y][x] = 1;
  }
  // the railway embankment: a level-1 bank running north-south past the hill, two underpasses each side
  for (let y = 0; y < 30; y++) for (const x of [47, 48]) if (y < 10 || y > 13) { lift(x, y, 1); }
  for (let y = 0; y < 30; y++) set(47, y, '#', 'B');
  // balkas: winding ravines (depth -1) the tanks can hide in, from the map edge toward the flanks of the hill
  for (let x = 4; x < 46; x++) { const y = Math.round(72 + 4 * Math.sin(x / 6)); for (let k = -1; k <= 1; k++) lift(x, y + k, -1); }
  for (let x = 30; x < 52; x++) { const y = Math.round(58 + 3 * Math.sin(x / 4)); lift(x, y, -1); }
  // the anti-tank ditch (depth -2, a cliff for everyone) in front of each side, with three causeways
  for (let y = 4; y < H - 4; y++) if (!(y >= 14 && y <= 17) && !(y >= 42 && y <= 47) && !(y >= 70 && y <= 73)) lift(32 + Math.round(2 * Math.sin(y / 9)), y, -2);
  // shelterbelts: rows of trees along the field edges, the only cover on the steppe
  for (const [x0, y0, x1, y1] of [[10, 30, 28, 30], [52, 22, 70, 22], [14, 52, 26, 52], [62, 66, 62, 80], [38, 4, 38, 14]]) line(x0, y0, x1, y1, 'O', 'B', 2);
  // the Oktyabrsky state farm (west) and its twin, a village by the rail line, Prokhorovka station
  for (const [x0, y0, x1, y1] of [[14, 38, 17, 41], [20, 37, 23, 40], [14, 45, 17, 48], [21, 46, 24, 48], [26, 41, 28, 44]]) rect(x0, y0, x1, y1, 'B');
  for (const [x0, y0, x1, y1] of [[52, 6, 55, 9], [56, 4, 59, 6], [42, 6, 44, 9]]) rect(x0, y0, x1, y1, 'B');
  rect(34, 80, 37, 83, 'B'); rect(40, 82, 42, 85, 'B');
  // the roads: east-west through the farm and over the hill, the railway service road
  for (const y of [43, 44]) line(0, y, W - 1, y, 'D', 'B');
  line(49, 0, 49, 44, 'D', 'B'); line(20, 44, 38, 82, 'D', 'B');
  // craters from the bombing and the barrage on the hill; a few burnt-out tanks (wrecks) from the morning
  for (let i = 0; i < 70; i++) set(40 + rnd() * 40, 28 + rnd() * 34, '+', 'BD');
  for (let i = 0; i < 25; i++) set(rnd() * W, rnd() * H, '+', 'BDO');
  for (const [x, y] of [[44, 36], [52, 54], [40, 50], [56, 30]]) set(x, y, 'Q');
  // the edge of the Psel valley (north): marsh along the river
  for (let x = 60; x < W; x++) for (let y = 0; y < 3 + Math.round(1.5 * Math.sin(x / 5)); y++) set(x, y, 'M', 'BD');
  slopes(c, (x, y, nx, ny) => hgt[ny][nx] === -2 || hgt[y][x] === -2);
  // 4 spawns, ring order: west pair, then their twins
  const spawns = [{ x: 6, y: 24 }, { x: 6, y: 64 }, { x: W - 7, y: H - 25 }, { x: W - 7, y: H - 65 }];
  const points = [
    { x: 59, y: 44, vp: 2, mp: 0 },          // Hill 252.2
    { x: 20, y: 43, vp: 1, mp: 1.5 },        // Oktyabrsky state farm
    { x: W - 21, y: H - 44, vp: 1, mp: 1.5 },
    { x: 50, y: 12, vp: 1, mp: 1, kind: 'depot' }, // Prokhorovka station
    { x: W - 51, y: H - 13, vp: 1, mp: 1, kind: 'depot' },
    { x: 38, y: 76, vp: 0, mp: 1 },          // the ravine hamlet: a home point off the main road
    { x: W - 39, y: H - 77, vp: 0, mp: 1 },
  ];
  finish(c, 'prokhorovka', { name: 'Prokhorovka', spawns, points,
    triggers: [{ at: 3, say: 'Prokhorovka, July 1943. Hold Hill 252.2. Mind the anti-tank ditch: only the causeways cross it.' }] });
}

// ---------------------------------------------------------------- Hurtgen Forest
{
  const W = 110, H = 100, c = canvas(W, H, 1944, true), { set, lift, rect, line, disc, rnd, hgt, at } = c;
  // the plateaus (level 2) either side of the Kall gorge; the gorge floor is level 0
  const kall = (y) => 54.5 + 3 * Math.sin((y - 49.5) / 8); // odd about the center, so the gorge is its own twin
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const d = Math.abs(x - kall(y)); hgt[y][x] = d < 4 ? 0 : d < 7 ? 1 : 2; }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (Math.abs(x - kall(y)) < 1.6) c.g[y][x] = 'W';
  // the gorge sides are cliffs (two levels in one step) except where the trails come down
  const trail = (y) => Math.abs(y - 49.5) < 3 || Math.abs(y - 16) < 2 || Math.abs(y - 83) < 2;
  for (let y = 0; y < H; y++) if (!trail(y)) for (let x = 0; x < W; x++) { const d = Math.abs(x - kall(y)); if (d >= 4 && d < 7) hgt[y][x] = 2; }
  // the forest: dense woods everywhere, thinned by firebreaks
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (at(x, y) === '.' && rnd() < 0.82) set(x, y, 'O');
  for (const x of [18, 36]) line(x, 0, x, 49, '.', 'W', 3);
  for (const y of [28, 70]) line(0, y, 50, y, '.', 'W', 3);
  // the Kall trail bridge in the middle, two fords up and down stream
  for (let y = 48; y <= 51; y++) for (let x = 0; x < W; x++) if (at(x, y) === 'W') set(x, y, '=');
  for (const y of [15, 16, 17]) for (let x = 0; x < W; x++) if (at(x, y) === 'W') set(x, y, 'F');
  // roads: the Kall trail over the bridge, a ridge road on each plateau, the road into each village
  for (const y of [49, 50]) line(0, y, W - 1, y, 'D', 'W=');
  line(26, 0, 26, H - 1, 'D', 'W='); line(8, 16, 54, 16, 'D', 'W=F');
  // Vossenack (west plateau, on the ridge road) and Germeter; their twins are Schmidt and Kommerscheidt
  for (const [x0, y0, x1, y1] of [[22, 36, 24, 39], [28, 36, 31, 38], [22, 42, 24, 45], [28, 41, 30, 44], [24, 31, 27, 33], [12, 10, 15, 13], [12, 19, 14, 22], [18, 12, 20, 14]]) rect(x0, y0, x1, y1, 'B');
  // the church of Vossenack (west) and its twin: a landmark with long sight from the ridge
  rect(31, 31, 33, 34, 'B');
  // the West Wall: dragon's teeth and pillboxes (sandbags) across each side's back woods
  for (let y = 4; y < H - 4; y += 2) if (Math.abs(y - 49.5) > 3 && Math.abs(y - 16) > 2) set(9, y, 'Y');
  for (const y of [30, 60, 76]) rect(6, y, 8, y, '#');
  // shell bursts in the canopy: clearings with craters
  for (let i = 0; i < 14; i++) { const x = 30 + rnd() * 20, y = rnd() * H; disc(Math.round(x), Math.round(y), 2.5, '+', 0.4, 'BWD='); }
  slopes(c, (x, y, nx, ny) => !trail(y) && !trail(ny) && Math.abs(x - kall(y)) < 9);
  const spawns = [{ x: 4, y: 26 }, { x: 4, y: 74 }, { x: W - 5, y: H - 27 }, { x: W - 5, y: H - 75 }];
  const points = [
    { x: 46, y: 49, vp: 2, mp: 0 },                        // the Kall trail bridge (west end)
    { x: W - 47, y: H - 50, vp: 2, mp: 0 },
    { x: 26, y: 40, vp: 1, mp: 1.5 },                      // Vossenack
    { x: W - 27, y: H - 41, vp: 1, mp: 1.5 },              // Schmidt
    { x: 16, y: 16, vp: 0, mp: 1, kind: 'radio' },         // Germeter
    { x: W - 17, y: H - 17, vp: 0, mp: 1, kind: 'radio' }, // Kommerscheidt
    { x: 57, y: 16, vp: 1, mp: 1 },                        // the north ford, in the water: nobody's ground
    { x: W - 58, y: H - 17, vp: 1, mp: 1 },
  ];
  finish(c, 'hurtgen-forest', { name: 'Hurtgen Forest', spawns, points, buildings: [{ x: 31, y: 31, kind: 'church' }, { x: W - 32, y: H - 32, kind: 'church' }],
    triggers: [{ at: 3, say: 'Hurtgen Forest, November 1944. Woods hide you but slow vehicles. The Kall gorge is crossed only at the trails.' }] });
}

// ---------------------------------------------------------------- El Alamein
{
  const W = 140, H = 100, c = canvas(W, H, 1942), { set, lift, rect, line, disc, rnd, hgt, at, g } = c;
  // the Mediterranean along the north edge, the coast road and railway just inland
  for (let x = 0; x < W; x++) for (let y = 0; y < 6 + Math.round(1.5 * Math.sin(x / 11)); y++) g[y][x] = 'W';
  for (const y of [11, 12]) line(0, y, W - 1, y, 'D', 'W');
  line(0, 16, W - 1, 16, '#', 'W'); // the railway embankment
  for (const x of [30, 70, 110]) set(x, 16, '.');
  // soft sand in the south: vehicles crawl
  for (let i = 0; i < 18; i++) disc(Math.round(10 + rnd() * 120), Math.round(80 + rnd() * 18), 4 + rnd() * 3, 'M', 0.8, 'W');
  // Miteirya Ridge (level 2) and Kidney Ridge (a level-1 bump in the middle of the field)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (x > 104 + 3 * Math.sin(y / 9) && y > 18) hgt[y][x] = 2; else if (x > 98 + 3 * Math.sin(y / 9) && y > 18) hgt[y][x] = 1;
    if (Math.hypot((x - 72) / 2, y - 50) < 4) hgt[y][x] = 1;
  }
  // Tel el Eisa: a coastal mound in the north
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (g[y][x] !== 'W' && Math.hypot(x - 88, y - 22) < 5) hgt[y][x] = 1;
  // the Devil's Gardens: two belts of mines, wire on the far edge, gaps that don't line up
  const belt = (x0, gaps) => {
    for (let y = 0; y < H; y++) {
      if (gaps.some(([a, b]) => y >= a && y <= b)) continue;
      // the coast road goes through both belts behind a wire gate: open, but in full view of Tel el Eisa
      if (y === 11 || y === 12) { set(x0 + 4, y, 'X', 'W'); continue; }
      const x = x0 + Math.round(2 * Math.sin(y / 7));
      for (let k = 0; k < 4; k++) if (rnd() < 0.45) set(x + k, y, 'N', 'W');
      set(x + 4, y, 'X', 'W');
    }
  };
  belt(48, [[24, 29], [44, 49], [64, 69], [86, 91]]);
  belt(84, [[34, 39], [54, 59], [74, 79]]);
  // the defenders: trenches and sandbags along the ridge, dug-in tanks (wrecks as hulls), the rail station
  for (let y = 20; y < H - 2; y++) if (y % 9) { const x = Math.round(103 + 3 * Math.sin(y / 9)); set(x, y, 'T'); }
  for (const y of [28, 46, 64, 82]) rect(107, y, 109, y, '#');
  for (const [x0, y0, x1, y1] of [[118, 20, 121, 23], [123, 21, 126, 24], [118, 26, 120, 28]]) rect(x0, y0, x1, y1, 'B'); // El Alamein station
  // the attackers' rear: supply dumps behind sandbags, scattered scrub
  for (const [x0, y0, x1, y1] of [[14, 30, 17, 32], [14, 66, 17, 68]]) rect(x0, y0, x1, y1, 'B');
  for (let i = 0; i < 40; i++) set(4 + rnd() * 130, 20 + rnd() * 78, rnd() < 0.5 ? 'H' : '+', 'WNXBTD#M');
  for (let i = 0; i < 30; i++) set(56 + rnd() * 28, 20 + rnd() * 78, '+', 'WNXBTD#M'); // the barrage on no man's land
  // a track from each attacker spawn to the gaps, and up the ridge behind the defenders
  line(6, 40, 46, 56, 'D', 'WNX'); line(6, 70, 46, 87, 'D', 'WNX'); line(112, 30, 112, 90, 'D', 'WNXBT');
  slopes(c);
  const spawns = [{ x: 118, y: 46 }, { x: 118, y: 70 }, { x: 6, y: 40 }, { x: 6, y: 70 }];
  const points = [
    { x: 30, y: 54, vp: 0, mp: 2 },                         // the start line
    { x: 72, y: 50, vp: 1, mp: 2.5 },                       // Kidney Ridge, between the belts
    { x: 88, y: 23, vp: 1, mp: 1 },                         // Tel el Eisa, by the coast road
    { x: 112, y: 40, vp: 2, mp: 1 },                        // Miteirya Ridge (north)
    { x: 112, y: 72, vp: 1, mp: 1 },                        // Miteirya Ridge (south)
    { x: 116, y: 25, vp: 1, mp: 1, kind: 'depot', needs: 3 }, // El Alamein station: only once the north ridge is held
  ];
  finish(c, 'el-alamein', { name: 'El Alamein', spawns, points, defend: [0, 1], assaultTime: 1800,
    triggers: [{ at: 3, say: "El Alamein, October 1942. Two belts of the Devil's Gardens: find the gaps, or bring engineers to clear a lane." }] });
}

// ---------------------------------------------------------------- Seelow Heights
{
  const W = 110, H = 120, c = canvas(W, H, 1945), { set, lift, rect, line, disc, rnd, hgt, at, g } = c;
  // attackers in the east on the Oder floodplain (level 0), the heights in the west (level 3); the escarpment edge
  // wanders around x = 40 and is a cliff except at the three roads that climb it
  const ramps = [[18, 25], [56, 64], [94, 101]];
  // the edge runs straight through each ramp and 2 rows past it: a wobble at a ramp's corner is a cell the relief can't seat
  const wobble = (y) => 40 + 3 * Math.sin(y / 9) + 1.5 * Math.sin(y / 3.7), near = (y) => ramps.find(([a, b]) => y >= a - 2 && y <= b + 2);
  const edge = (y) => (near(y) ? Math.round(wobble((near(y)[0] + near(y)[1]) / 2)) : wobble(y));
  const ramp = (y) => ramps.some(([a, b]) => y >= a && y <= b);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const e = edge(y);
    hgt[y][x] = x < e ? 3 : x < e + 2 && ramp(y) ? 2 : x < e + 4 && ramp(y) ? 1 : 0;
  }
  // the floodplain: wet meadows (mud), the Hauptgraben canal with three bridges and a ford, drainage ditches
  for (let i = 0; i < 26; i++) disc(Math.round(50 + rnd() * 55), Math.round(rnd() * H), 3 + rnd() * 4, 'M', 0.85);
  const canal = (y) => 66 + 2 * Math.sin(y / 13);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (Math.abs(x - canal(y)) < 1.6) g[y][x] = 'W';
  for (const [a, b, ch] of [[21, 23, '='], [59, 62, '='], [97, 99, '='], [40, 42, 'F'], [80, 82, 'F']]) for (let y = a; y <= b; y++) for (let x = 0; x < W; x++) if (at(x, y) === 'W') set(x, y, ch);
  for (const y of [10, 44, 78, 110]) line(72, y, 104, y, 'H', 'W=FD'); // willows along the ditches
  // the roads (Reichsstrasse 1 through the middle ramp to Seelow), and a lateral road along the foot of the heights
  for (const [a] of ramps) for (const y of [a + 1, a + 2]) line(0, y, W - 1, y, 'D', 'W=F');
  line(48, 2, 48, H - 3, 'D', 'W=F');
  // first line: trenches and wire at the foot of the escarpment
  for (let y = 4; y < H - 4; y++) if (!ramp(y) || y % 2) { const x = Math.round(edge(y) + 6); if (at(x, y) === '.' || at(x, y) === 'M') set(x, y, 'T'); if (at(x + 2, y) === '.' || at(x + 2, y) === 'M') set(x + 2, y, 'X'); }
  // second line: on the crest, sandbags and trenches covering the ramps
  for (const [a, b] of ramps) { line(Math.round(edge(a)) - 3, a - 5, Math.round(edge(a)) - 3, a - 1, 'T'); line(Math.round(edge(b)) - 3, b + 1, Math.round(edge(b)) - 3, b + 5, 'T'); rect(Math.round(edge(a)) - 6, a, Math.round(edge(a)) - 6, b, '#'); }
  // Seelow town on the heights, astride the middle road; a farm on each other road
  for (const [x0, y0, x1, y1] of [[22, 52, 25, 56], [28, 53, 31, 56], [22, 64, 25, 68], [28, 65, 31, 67], [16, 57, 19, 59], [16, 63, 19, 66]]) rect(x0, y0, x1, y1, 'B');
  rect(26, 48, 29, 50, 'B'); // the church
  for (const [x0, y0, x1, y1] of [[26, 16, 29, 19], [26, 26, 28, 28], [26, 92, 29, 95], [26, 102, 28, 104]]) rect(x0, y0, x1, y1, 'B');
  // third line (the Wotan position): a trench far back, covering the town
  line(10, 8, 10, 112, 'T', 'BD');
  // the barrage: craters thick on the foot line and the slopes
  for (let i = 0; i < 90; i++) set(36 + rnd() * 20, rnd() * H, '+', 'WDBT=F');
  slopes(c, (x, y, nx, ny) => !(ramp(y) && ramp(ny)) && Math.abs(x - edge(y)) < 6); // ramps are clean slopes walled by cliff
  const spawns = [{ x: 6, y: 40 }, { x: 6, y: 80 }, { x: 103, y: 30 }, { x: 103, y: 90 }];
  const points = [
    { x: 86, y: 60, vp: 0, mp: 1 },                         // the bridgehead (Kustrin road)
    { x: 52, y: 22, vp: 1, mp: 1 },                         // the foot of the north road
    { x: 52, y: 98, vp: 1, mp: 1 },                         // the foot of the south road
    { x: 32, y: 22, vp: 1, mp: 1.5 },                       // the north farm, on the crest
    { x: 32, y: 98, vp: 1, mp: 1.5 },                       // the south farm, on the crest
    { x: 26, y: 61, vp: 2, mp: 1.5, kind: 'radio' },        // Seelow
  ];
  finish(c, 'seelow-heights', { name: 'Seelow Heights', spawns, points, defend: [0, 1], assaultTime: 1800, buildings: [{ x: 26, y: 48, kind: 'church' }],
    triggers: [{ at: 3, say: 'Seelow Heights, April 1945. Cross the floodplain and the canal, then climb: the heights can only be taken by the roads.' }] });
}
