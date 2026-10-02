// Unit, building, support and order icons for the HUD (symbolSVG, icon) and the 3D markers (drawSymbol).
//
// Every icon is one flat silhouette: a single filled path in a 0..100 box, drawn with the even-odd rule, so a shape
// inside another one becomes a hole (road wheels, a firing slit, the gap under a gun shield, a window). There are no
// strokes. A part that has to look thin is a thin filled shape at least 4 units wide, so it still shows at 18 px.
//
// Soldiers, guns, vehicles and buildings are seen from the side, facing right, standing on a common baseline at y 84.
// Vehicles span about x 6..94 and soldiers are about 60 units tall. Aircraft are seen from above with the nose up,
// about 84 units across. Support calls, order buttons and UI glyphs share the same box and the same visual weight.
//
// The shapes are built from polygons with the helpers below and written out as absolute path data rounded to one
// decimal. Parts of one icon are placed so they do not overlap by accident: where two parts cross, even-odd cuts the
// crossing out, and a few icons use that on purpose (the rifle across a soldier's body shows as a dark line).

const r1 = (v) => Math.round(v * 10) / 10 + 0; // + 0 turns -0 into 0
const fmt = ([x, y]) => `${r1(x)} ${r1(y)}`;
// a closed polygon
const poly = (...pts) => 'M' + pts.map(fmt).join('L') + 'Z';
const rad = (deg) => (deg * Math.PI) / 180;
// points along an ellipse arc; angles in degrees, 0 = right, 90 = down (screen axes)
const arc = (cx, cy, rx, ry, a0, a1, n = Math.max(4, Math.ceil(Math.abs(a1 - a0) / 10))) =>
  Array.from({ length: n + 1 }, (_, k) => { const a = rad(a0 + ((a1 - a0) * k) / n); return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]; });
const ellipse = (cx, cy, rx, ry = rx) => poly(...arc(cx, cy, rx, ry, 0, 360, Math.max(16, Math.round(Math.max(rx, ry) * 2.2))).slice(1));
const circle = (cx, cy, r) => ellipse(cx, cy, r, r);
// points along a quadratic curve from p0 to p1 bent toward c (p0 left out, so runs of curves join without repeats)
const curve = (p0, c, p1, n = 6) => Array.from({ length: n }, (_, i) => {
  const t = (i + 1) / n, s = 1 - t;
  return [s * s * p0[0] + 2 * s * t * c[0] + t * t * p1[0], s * s * p0[1] + 2 * s * t * c[1] + t * t * p1[1]];
});
// a band along a polyline, w0 wide at the start and w1 at the end: barrels, poles, wire, curved arrows
function band(line, w0, w1 = w0) {
  const pts = line.filter((p, i) => i === 0 || Math.hypot(p[0] - line[i - 1][0], p[1] - line[i - 1][1]) > 0.01);
  const L = [], R = [], dist = [0];
  for (let i = 1; i < pts.length; i++) dist.push(dist[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = dist[dist.length - 1] || 1;
  pts.forEach((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, h = (w0 + ((w1 - w0) * dist[i]) / total) / 2;
    L.push([p[0] - (dy / l) * h, p[1] + (dx / l) * h]);
    R.push([p[0] + (dy / l) * h, p[1] - (dx / l) * h]);
  });
  return poly(...L, ...R.reverse());
}
const bar = (a, b, w0, w1 = w0) => band([a, b], w0, w1);
// a square h from its center to each side
const sq = (x, y, h) => poly([x - h, y - h], [x + h, y - h], [x + h, y + h], [x - h, y + h]);
// a point `along` units from p in direction deg, then `side` units to its right
const at = ([x, y], deg, along, side = 0) => {
  const c = Math.cos(rad(deg)), s = Math.sin(rad(deg));
  return [x + c * along - s * side, y + s * along + c * side];
};
// the outline of bars that all cross at (cx, cy), as one shape (no even-odd holes where they cross).
// arms: [angle, length] pairs, one per arm; w: bar width.
function star(cx, cy, arms, w) {
  const h = w / 2, list = [...arms].sort((p, q) => p[0] - q[0]), out = [];
  list.forEach(([a, len], i) => {
    const u = [Math.cos(rad(a)), Math.sin(rad(a))], n = [-u[1], u[0]], e = [cx + u[0] * len, cy + u[1] * len];
    out.push([e[0] - n[0] * h, e[1] - n[1] * h], [e[0] + n[0] * h, e[1] + n[1] * h]);
    const d = (((list[(i + 1) % list.length][0] - a) % 360) + 360) % 360 || 360, m = rad(a + d / 2), k = h / Math.sin(rad(d / 2));
    out.push([cx + Math.cos(m) * k, cy + Math.sin(m) * k]);
  });
  return poly(...out);
}
// The outline of a union of ellipses [x, y, rx, ry], found by casting rays from (cx, cy), cut flat at y = bottom:
// clouds and sandbag walls.
function blob(cx, cy, shapes, bottom = Infinity, n = 96) {
  const pts = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2, ux = Math.cos(a), uy = Math.sin(a);
    let t = 0;
    for (const [px, py, rx, ry = rx] of shapes) {
      const fx = (cx - px) / rx, fy = (cy - py) / ry, dx = ux / rx, dy = uy / ry;
      const A = dx * dx + dy * dy, B = fx * dx + fy * dy, C = fx * fx + fy * fy - 1, disc = B * B - A * C;
      if (disc >= 0) t = Math.max(t, (-B + Math.sqrt(disc)) / A);
    }
    if (uy > 0 && cy + uy * t > bottom) t = (bottom - cy) / uy;
    pts.push([cx + ux * t, cy + uy * t]);
  }
  return poly(...pts);
}
// maps every point of path data through f (all paths here use absolute "x y" pairs)
const mapPath = (d, f) => d.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (_, x, y) => fmt(f([+x, +y])));
// scales by s and turns by deg (clockwise) about (ox, oy), then moves by (dx, dy)
const place = (d, { s = 1, deg = 0, dx = 0, dy = 0, ox = 50, oy = 50 } = {}) => {
  const c = Math.cos(rad(deg)), sn = Math.sin(rad(deg));
  return mapPath(d, ([x, y]) => {
    const u = (x - ox) * s, v = (y - oy) * s;
    return [ox + u * c - v * sn + dx, oy + u * sn + v * c + dy];
  });
};
// a left-right symmetric outline from its right half, listed from the top of the center line down to the bottom
const mirror = (half) => [...half, ...half.slice().reverse().map(([x, y]) => [100 - x, y])];

// ---------- vehicle parts ----------

// The track run of a tracked vehicle as outline points, from the front (x1) round the bottom to the rear (x0). Its
// top is at y `top`; the hull outline joins it at both ends, so hull and track are one shape.
function run(x0, x1, top) {
  const r = (84 - top) * 0.38;
  return [...arc(x1 - r, top + r, r, r, -25, 70, 5), [x1 - r - 6, 84], [x0 + r + 6, 84], ...arc(x0 + r, top + r, r, r, 110, 205, 5)];
}
// road wheels: round holes in the track run
const wheels = (xs, cy, r) => xs.map((x) => circle(x, cy, r)).join('');
// a road wheel or a gun carriage wheel: a disc with a hole for the hub
const wheel = (cx, cy, r, hub) => circle(cx, cy, r) + circle(cx, cy, hub);
// the arch over a wheel, as outline points from its front foot to its rear foot
const arch = (cx, cy, r) => arc(cx, cy, r, r, -15, -165, 8);

// ---------- building parts ----------

// a wooden crate s units square at (x, y): a frame with a diagonal brace (two triangle holes)
function crate(x, y, s) {
  const a = x + 4, b = x + s - 4, c = y + 4, d = y + s - 4, k = 3.2;
  return poly([x, y], [x + s, y], [x + s, y + s], [x, y + s]) + poly([a, c], [b - k, c], [a, d - k]) + poly([b, d], [a + k, d], [b, c + k]);
}
// an open-ended wrench: the head at (cx, cy) is a disc of radius r with a jaw cut into it facing deg; the handle,
// w wide, runs len units back from the head
function wrench(cx, cy, r, deg, len, w) {
  const jw = r * 0.36, jd = r * 0.8, ja = (Math.asin(jw / r) * 180) / Math.PI, ha = (Math.asin(w / 2 / r) * 180) / Math.PI;
  const P = ([along, side]) => at([cx, cy], deg, along, side), back = -(r * Math.cos(rad(ha)) + len);
  return poly(...arc(0, 0, r, r, ja, 180 - ha, 10).map(P), P([back, w / 2]), P([back, -w / 2]),
    ...arc(0, 0, r, r, 180 + ha, 360 - ja, 10).map(P), P([r - jd, -jw]), P([r - jd, jw]));
}

// ---------- ordnance and aircraft parts ----------

// a fighter seen from above, nose up: propeller, tapered wings with round tips, tailplane
const FIGHTER = poly(...mirror([[50, 6], [52.5, 9], [53, 11], [63, 11], [63, 15], [54, 15], [55.5, 24], [56, 36], [86, 42],
  [90, 43.5], [92, 46], [90.5, 48.5], [86, 49.5], [56, 54], [54, 70], [53.5, 75], [68, 78.5], [69, 81], [68, 83.5], [53, 85],
  [51.5, 92], [50, 92]]));
// a fighter seen from the side, facing right: fin, canopy, propeller disc, wing root under the belly
const SIDE_PLANE = poly([10, 30], [17, 30], [26, 42], [44, 42], [49, 36], [57, 35.5], [63, 41], [78, 43], [80, 44], [80, 36],
  [84, 36], [84, 45], [87.5, 48], [84, 51], [84, 60], [80, 60], [80, 52], [70, 54.5], [66, 57.5], [46, 58], [40, 54], [22, 49],
  [16, 49], [6, 48.5], [6, 45], [12, 44.5]);
// a bomb falling nose down, centered on (cx, cy), scaled by s, with its tail fins at the top
const bomb = (cx, cy, s = 1) => poly(...[...arc(0, 6, 7, 11, 90, 0, 6), [7, -3], [3, -11], [8.5, -14], [8.5, -23], [-8.5, -23],
  [-8.5, -14], [-3, -11], [-7, -3], ...arc(0, 6, 7, 11, 180, 90, 6).slice(0, -1)].map(([x, y]) => [cx + x * s, cy + y * s]));
// an artillery shell falling nose down: w wide, body len long from y = top, then a pointed nose
const shell = (cx, top, w, len) => poly([cx - w / 2, top], [cx + w / 2, top], [cx + w / 2, top + len],
  ...curve([cx + w / 2, top + len], [cx + w / 2, top + len + w * 0.7], [cx, top + len + w * 1.15], 5),
  ...curve([cx, top + len + w * 1.15], [cx - w / 2, top + len + w * 0.7], [cx - w / 2, top + len], 5));
// a filled sandbag, w by h, with slightly bulging long sides
const bag = (cx, cy, w, h) => {
  const r = h / 2, l = cx - w / 2 + r, rr = cx + w / 2 - r;
  return poly(...arc(l, cy, r, r, 90, 270, 8), ...curve([l, cy - r], [cx, cy - r - 3], [rr, cy - r], 6),
    ...arc(rr, cy, r, r, -90, 90, 8).slice(1), ...curve([rr, cy + r], [cx, cy + r + 3], [l, cy + r], 6).slice(0, -1));
};

// ---------- soldiers ----------

// a soldier standing in a short stride, facing right: helmet, body, legs
const MAN = [[37.5, 33.5], [39, 27.5], [43.5, 23.5], [49.5, 22.5], [55, 25], [58, 29.5], [61, 32.5], [55.5, 33],
  [56.5, 37.5], [54, 41], [52.5, 42.5], [56.5, 44.5], [59, 50], [58.5, 56], [56, 60], [55.5, 62],
  [60, 71], [61.5, 80.5], [66, 82], [66, 84], [56.5, 84], [55, 73], [50, 66],
  [45.5, 73], [42, 84], [33.5, 84], [34.5, 81], [39.5, 71], [41.5, 61], [40.5, 51], [42.5, 45], [46, 41.5], [41, 35]];
// The rifle held up across the chest, muzzle in front of the face: its edges from the chest to the muzzle, then the
// forward hand and forearm back down to the body. Spliced into a figure's outline so rifle and body are one shape.
const RIFLE_UP = [[76, 17.6], [79.6, 20.2], [66.4, 39], [68, 41.5], [66.5, 44]];
// a rifleman: helmet, rifle held up, body, legs in a short stride
const RIFLEMAN = [...MAN.slice(0, 12), [56.8, 45.1], ...RIFLE_UP, [60, 54], [58.5, 56], ...MAN.slice(14)];
// a conscript in a side cap and a long greatcoat, rifle held up the same way
const COAT = [[40.5, 30], [41.5, 26.5], [47, 24.5], [53, 25], [56, 27.5], [56.5, 30.5], [57.5, 34], [58, 37], [56, 38],
  [56.5, 39.5], [54, 41.5], [52.5, 43], [56.5, 45], [56.6, 45.4], ...RIFLE_UP, [59.5, 54], [59, 62], [61, 72], [60, 74],
  [61.5, 82], [65, 83], [65, 84], [56, 84], [55, 75], [51, 73], [47, 75], [44, 84], [36, 84], [37, 82], [41, 74], [38.5, 72],
  [40, 60], [40.5, 50], [42.5, 45], [45.5, 42], [42, 38], [41, 33]];
// standing figures are drawn a little narrow, then widened k times about x 50 (and moved dx) to match the set's weight
const widen = (d, k = 1.1, dx = 0) => mapPath(d, ([x, y]) => [50 + (x - 50) * k + dx, y]);
const conscript = widen(poly(...COAT));
// a mortar bomb held nose up, its tail fins at the bottom
const mortarBomb = (cx, top) => poly([cx, top], ...curve([cx, top], [cx + 4, top + 1.5], [cx + 3.5, top + 6], 3),
  [cx + 2, top + 12], [cx + 3, top + 13.5], [cx + 3, top + 17], [cx - 3, top + 17], [cx - 3, top + 13.5], [cx - 2, top + 12],
  [cx - 3.5, top + 6], ...curve([cx - 3.5, top + 6], [cx - 4, top + 1.5], [cx, top], 3).slice(0, -1));

// type -> [name, branch, meaning (what the silhouette shows, for tooltips), path data]
const DEFS = {
  rifle: ['Rifle Squad', 'infantry', 'Rifleman: a helmeted soldier with his rifle held up across his chest',
    widen(poly(...RIFLEMAN))],
  conscript: ['Conscripts', 'infantry', 'Conscripts: two soldiers in side caps and greatcoats, one behind the other',
    place(conscript, { s: 0.86, ox: 50, oy: 84, dx: -31.5 }) + place(conscript, { s: 0.94, ox: 50, oy: 84, dx: 9 })],
  ranger: ['Ranger Squad', 'infantry', 'Ranger: a soldier advancing in a long stride, submachine gun held forward',
    widen(poly([42, 31], [43, 26], [47.5, 22.5], [53.5, 22], [58.5, 25], [61, 29.5], [64.5, 32], [59, 33], [59.5, 38], [57, 41.5],
      [56, 43], [60, 45.5], [62, 47.5], [77, 47.5], [77, 48.5], [91, 48.5], [91, 52.5], [77, 52.5], [75, 54], [73.5, 54],
      [73.5, 61], [69.5, 61], [69.5, 54], [64, 55.5], [59.5, 57], [57, 62], [63, 70], [69, 79.5], [73, 81.5], [73, 84],
      [63, 84], [60, 75], [54, 67.5], [49, 67], [41, 75], [33, 84], [24, 84], [25.5, 81.5], [34, 73], [39.5, 63],
      [41, 53], [44, 46], [48, 42], [43, 34]), 1.08, -2)],
  sniper: ['Sniper', 'infantry', 'Sniper: a prone soldier aiming a long rifle with a telescopic sight, on a bipod',
    poly([6, 84], [6, 80], [10, 77], [22, 77], [31, 74], [42, 72], [50, 70], [53, 68.5], [54, 67], [52.5, 64], [54, 59.5],
      [58.5, 56.5], [64, 56.5], [67.5, 59], [70, 62], [66, 62.5], [66.5, 66], [64, 68.5], [68, 70], [71, 74], [72, 80], [71, 84]) +
    band([[68.5, 66.8], [76, 66.3], [95, 65.6]], 6, 4) + bar([73, 60.5], [85, 60.2], 4.5) +
    poly([85, 84], [88, 69], [90, 69], [93, 84], [90.5, 84], [89, 75.5], [87.5, 84])],
  engineer: ['Engineer Squad', 'engineer', 'Engineer: a soldier sweeping a mine detector over the ground ahead',
    widen(poly([36.5, 33.5], [38, 27.5], [42.5, 23.5], [48.5, 22.5], [54, 25], [57, 29.5], [60, 32.5], [54.5, 33], [55.5, 37.5],
      [53, 41], [52, 42.5], [55.5, 44.5], [57.5, 50], [64, 56.5], [67, 58.5], [65.5, 62], [62, 61], [56, 57.5], [55, 62],
      [59.5, 71], [61, 80.5], [65.5, 82], [65.5, 84], [56, 84], [54.5, 73], [49.5, 66], [45, 73], [41.5, 84], [33, 84],
      [34, 81], [39, 71], [40.5, 61], [39.5, 51], [41.5, 44.5], [45, 41.5], [40, 35]) +
    bar([68.5, 62], [82, 76.6], 4) + ellipse(84, 79.8, 9.5, 3), 1.06, -3)],
  flamer: ['Flamethrower Squad', 'infantry', 'Flamethrower: a soldier with fuel tanks on his back, the flame gun at his hip spitting a tongue of fire',
    place(widen(poly(...MAN)) + poly([30, 36], [37, 36], [38, 38], [38, 59], [37, 61], [30, 61], [29, 59], [29, 38]) +
      bar([61.5, 55], [80, 51.5], 4.5) + poly([81, 49], [86, 47], [92, 42.5], [90.5, 48], [97, 49.5], [90.5, 52.5], [94, 58], [86, 54.5], [81, 54]),
    { dx: -4 })],
  medic: ['Medic Team', 'medical', 'Medic: a soldier beside a medical cross',
    place(widen(poly(...MAN)), { s: 0.8, ox: 50, oy: 84, dx: -20 }) + poly([68, 34], [78, 34], [78, 44], [92, 44], [92, 54], [78, 54], [78, 68], [68, 68], [68, 54], [54, 54], [54, 44], [68, 44])],
  mg: ['MG Team', 'weapon', 'Machine gun team: a prone gunner behind a machine gun on its tripod',
    poly([6, 84], [6, 80], [10, 77], [20, 76], [28, 73], [34, 70], [37, 68.5], [38, 66.5], [36.5, 63], [38, 58.5], [42.5, 55.5],
      [48, 55.5], [51.5, 58], [54, 61], [50, 61.5], [50.5, 65], [48, 67.5], [52, 69], [55, 73], [56, 80], [55, 84]) +
    poly([57, 62], [59, 58.5], [63, 57], [77, 57], [77, 58], [93, 58], [93, 62], [66, 62], [65, 65.5], [62, 65.5], [62, 62]) +
    poly([69, 62], [75, 62], [75, 65.5], [88, 84], [83.5, 84], [72, 69], [62.5, 84], [58, 84], [69, 65.5])],
  mortar: ['Mortar Team', 'artillery', 'Mortar team: a kneeling loader holding a bomb beside a mortar on its bipod and baseplate',
    place(poly([26, 42.5], [27.5, 37], [32, 33], [38, 32.5], [43, 35], [46, 39.5], [49, 42], [44, 42.5], [44.5, 47], [42, 50],
      [41, 51.5], [45, 53], [51, 56], [55, 57.5], [56, 60], [53.5, 61], [46, 60], [44, 62], [56, 66], [57, 70], [57, 82],
      [59, 84], [48, 84], [49, 74], [40, 74], [38, 84], [16, 84], [17, 80], [24, 78], [26, 72], [28, 62], [30, 53], [33, 49],
      [28, 43.5]) + mortarBomb(62, 44), { dx: -9 }) +
    poly([52, 84], [78, 84], [76, 80], [65.6, 80], [81.8, 45.1], [76, 42.3], [58.4, 80], [54, 80]) +
    poly([76.6, 59], [79.6, 59], [92, 84], [87.4, 84], [79.4, 67], [76.8, 80], [72.4, 80])],
  at: ['AT Gun', 'antitank', 'Anti-tank gun: a long barrel with a muzzle brake behind a sloped shield, on a wheel and a split trail',
    poly([5, 84], [12, 84], [12, 81.5], [34.5, 75], [34, 69.6], [8, 76.5], [5, 78.5]) + wheel(48, 72, 12, 5) +
    poly([47, 36], [55, 36], [58.5, 47], [88, 47], [88, 45.5], [94, 45.5], [94, 52.5], [88, 52.5], [88, 51], [59.8, 51],
      [62, 58], [49, 58], [48.6, 54], [38, 54], [36, 50.5], [38, 47], [48, 47])],
  howitzer: ['Field Howitzer', 'artillery', 'Field howitzer: a heavy barrel raised steeply behind a shield, on a big wheel and a split trail',
    poly([5, 84], [12, 84], [12, 81.5], [33.5, 75], [33, 69.6], [8, 76.5], [5, 78.5]) + wheel(46, 72, 12, 5) +
    poly(...[[-10, -5], [10, -5], [10, -3.2], [40, -3.2], [40, -4.2], [45, -4.2], [45, 4.2], [40, 4.2], [40, 3.2], [10, 3.2], [10, 5], [-10, 5]]
      .map(([a, sd]) => at([52, 48], -38, a, sd))) + poly([59, 50], [64, 49], [64.5, 66], [59.5, 66])],
  flak: ['Flak Gun', 'airdefense', 'Anti-aircraft gun: a light cannon raised steeply on a cross-shaped ground mount',
    poly([6, 84], [7, 79], [13, 77], [13, 74], [36, 74], [40, 64], [62, 64], [66, 74], [87, 74], [87, 77], [93, 79], [94, 84],
      [84, 84], [83, 80], [17, 80], [16, 84]) +
    poly(at([52, 57], -58, -2, -4.5), at([52, 57], -58, 13, -4.5), at([52, 57], -58, 13, 4.5), at([52, 57], -58, -2, 4.5)) +
    bar(at([52, 57], -58, 13), at([52, 57], -58, 56), 3.6) + bar(at([52, 57], -58, 56), at([52, 57], -58, 61), 5.2)],
  // vehicles: hull, turret and track run are one outline; road wheels are holes
  halftrack: ['Halftrack', 'infantry', 'Halftrack: an open-topped carrier with a wheel in front and a track behind',
    poly([7, 66], [7, 50], [52, 50], [55, 48], [62, 48], [64, 56], [86, 57], [92, 61],
      [93, 70], [89, 72], ...arch(78, 75.5, 11.5), ...run(8, 56, 68)) + wheel(78, 75, 9, 3.5) + wheels([20, 32, 44], 75.8, 4.2)],
  lcvp: ['Landing Craft', 'infantry', 'Landing craft: a flat boxy boat with a square bow ramp, riding on the water',
    poly([8, 56], [20, 56], [20, 48], [30, 48], [30, 56], [84, 56], [84, 50], [90, 50], [92, 70], [86, 76], [14, 76], [8, 70]) +
    poly([4, 80], [96, 80], [96, 84], [4, 84])],
  gunboat: ['Gunboat', 'antitank', 'Gunboat: a long low motor boat with a raised bridge and a gun aft, riding on the water',
    poly([6, 66], [70, 66], [70, 58], [82, 58], [84, 66], [94, 66], [86, 76], [12, 76]) + poly([24, 66], [24, 60], [32, 60], [32, 66]) +
    poly([16, 61], [30, 57], [30, 59], [16, 63]) + poly([4, 80], [96, 80], [96, 84], [4, 84])],
  destroyer: ['Destroyer', 'artillery', 'Destroyer: a long warship with gun mounts fore and aft, a bridge and two funnels',
    poly([4, 66], [96, 64], [90, 76], [8, 76]) + poly([44, 64], [44, 52], [54, 52], [54, 44], [60, 44], [60, 64]) +
    poly([32, 64], [32, 46], [37, 46], [37, 64]) + poly([22, 64], [22, 48], [27, 48], [27, 64]) +
    poly([70, 64], [70, 59], [76, 59], [76, 64]) + poly([74, 61], [90, 59], [90, 61], [74, 63]) +
    poly([10, 64], [10, 59], [16, 59], [16, 64]) + poly([4, 80], [96, 80], [96, 84], [4, 84])],
  armoredcar: ['Armored Car', 'recon', 'Armored car: an angled armored body on two axles with a small turret and a short gun',
    poly([7, 72], [7, 64], [13, 56.5], [41, 54.5], [43.5, 46], [58, 46], [61, 49], [80, 49], [80, 53], [62, 53], [63, 54.5],
      [70, 55], [90, 62], [93, 66], [93, 71], [86, 72], ...arch(73, 75.5, 12), ...arch(27, 75.5, 12), [12, 72]) +
    wheel(73, 75, 9, 3.5) + wheel(27, 75, 9, 3.5)],
  flaktrack: ['Mobile Flak', 'airdefense', 'Self-propelled flak: a half-track with twin anti-aircraft barrels raised on its open bed',
    poly([7, 66], [7, 58], [26, 58], [28, 52], [42, 52], [44, 58], [52, 58], [55, 48], [62, 48], [64, 56], [86, 57], [92, 61],
      [93, 70], [89, 72], ...arch(78, 75.5, 11.5), ...run(8, 56, 68)) + wheel(78, 75, 9, 3.5) + wheels([20, 32, 44], 75.8, 4.2) +
    bar(at([35, 46], -55, 2), at([35, 46], -55, 12), 11) +
    bar(at([35, 46], -55, 12, -3), at([35, 46], -55, 44, -3), 3.4) + bar(at([35, 46], -55, 12, 3), at([35, 46], -55, 44, 3), 3.4)],
  tank: ['Light Tank', 'armor', 'Light tank: a small tank with a short gun',
    place(poly([15, 66], [15, 57], [18, 54.5], [32, 54.5], [33, 46], [36, 43], [53, 43], [56.5, 45.5], [57.5, 47], [80, 47], [80, 51],
      [57.5, 51], [56.5, 54.5], [63, 54.5], [77, 62], [79.5, 65], [78.5, 69.5], ...run(16, 78, 68)) +
    wheels([27, 39, 51, 63], 75.8, 4.2), { s: 1.08, ox: 47, oy: 84, dx: 3 })],
  medium: ['Medium Tank', 'armor', 'Medium tank: a sloped front, a rounded turret with a cupola and a medium gun',
    poly([9, 64], [9, 55], [12, 52], [33, 52], [33, 46], [36, 41], [40.5, 39.5], [41.5, 36], [47.5, 36], [48.5, 39], [58, 39],
      [62.5, 41.5], [64, 44], [93, 44], [93, 48.5], [64, 48.5], [62.5, 50.5], [60, 52], [66, 52], [86, 61], [89, 64], [88, 68],
      ...run(10, 86, 66)) + wheels([22, 34, 46, 58, 70], 75.5, 4.5)],
  tiger: ['Tiger', 'armor', 'Heavy tank: a boxy hull and turret, big road wheels and a long gun with a muzzle brake',
    poly([7, 62], [7, 52], [9, 50], [29, 50], [29, 40], [32, 36], [35, 36], [36, 32], [43, 32], [44, 36], [62, 36], [64, 38.5],
      [70, 38.5], [70, 41.5], [88, 41.5], [88, 39.5], [95, 39.5], [95, 47.5], [88, 47.5], [88, 45.5], [70, 45.5], [70, 48],
      [64, 48], [64, 50], [85, 50], [88, 52], [88, 59], [84, 64.5], ...run(8, 84, 64)) + wheels([22, 36, 50, 64], 74.5, 5.5)],
  // the Churchill: a long, tall hull with the tracks running right over it, a small slab turret mid-hull, a short gun
  churchill: ['Churchill', 'armor', 'Infantry tank: a long, tall hull with tracks running over the top, a small square turret and a short gun',
    poly([5, 66], [5, 56], [9, 49], [36, 49], [36, 40], [39, 37], [58, 37], [60, 40], [74, 40], [74, 44], [60, 44], [60, 49],
      [89, 49], [95, 56], [95, 66], [88, 80], [84, 84], [16, 84], [12, 80]) + wheels([22, 34, 46, 58, 70, 80], 75, 3.6)],
  tankdestroyer: ['Tank Destroyer', 'antitank', 'Tank destroyer: a low casemate with no turret and a long gun out of its sloped front',
    poly([9, 66], [9, 57], [13, 54], [24, 54], [28, 46], [50, 46], [60, 51], [87, 51], [87, 49.5], [95, 49.5], [95, 56.5], [87, 56.5],
      [87, 55], [64.5, 55], [68, 57], [86, 62], [89, 64.5], [88, 68], ...run(10, 86, 66)) + wheels([22, 34, 46, 58, 70], 75.5, 4.5)],
  rocket: ['Rocket Launcher', 'artillery', 'Rocket artillery: a truck with a rack of launch rails raised over the cab',
    poly([8, 72], [8, 60], [60, 60], [60, 48], [63, 45], [72, 45], [77, 55], [88, 56.5], [92.5, 59], [93, 70], [90, 72],
      ...arc(80, 75, 10.5, 10.5, -15, -165, 8), ...arc(38, 75, 10.5, 10.5, -15, -90, 4), ...arc(22, 75, 10.5, 10.5, -90, -165, 4)) +
    poly([64, 49], [70, 49], [72.8, 54.5], [64, 54.5]) + wheel(80, 76, 8, 3) + wheel(38, 76, 8, 3) + wheel(22, 76, 8, 3) +
    bar([12, 52], [72, 29], 11) + bar([17.6, 49.9], [68.3, 30.4], 3.5) + poly([34, 60], [39, 60], [40.5, 47], [35.5, 48.9])],

  // aircraft, seen from above with the nose up
  fighter: ['Fighter', 'air', 'Fighter: a single-engine plane with tapered wings, seen from above', FIGHTER],
  attacker: ['Ground-attack Plane', 'air', 'Ground-attack plane: a heavy plane with broad straight wings and rockets under them, seen from above',
    poly(...mirror([[50, 7], [54, 8], [57, 10.5], [57.5, 12], [70, 12], [70, 16], [58, 16], [58.5, 26], [58.5, 38], [61.5, 38],
      [61.5, 30], [63.5, 26.5], [65.5, 30], [65.5, 38], [71.5, 38], [71.5, 30], [73.5, 26.5], [75.5, 30], [75.5, 38], [91, 38],
      [94, 40.5], [94, 55], [91, 58], [58.5, 58], [55, 74], [54.5, 77], [71, 79], [72, 82], [71, 86], [54, 86.5], [52, 92],
      [50, 92]]))],

  bomber: ['Bomber', 'air', 'Bomber: a twin-engine plane with long straight wings and a twin tail, seen from above',
    poly(...mirror([[50, 8], [53, 9.5], [55, 14], [55.5, 32], [62, 32], [63, 26], [66, 24], [69, 26], [70, 32], [92, 35], [94, 37.5],
      [94, 42], [92, 44], [70, 46], [69.5, 52], [66, 54], [62.5, 52], [62, 46], [55.5, 46], [54.5, 72], [54, 76], [68, 78], [69, 75],
      [73, 75], [73, 86], [69, 86], [68, 83], [53, 84], [51.5, 90], [50, 90]]))],

  // buildings, front elevation on the same baseline
  bunker: ['Command Bunker', 'fort', 'Bunker: a low concrete blockhouse with a firing slit, on an earth berm',
    poly([6, 84], [18, 70], [22, 69], [22, 52], [19, 52], [19, 44], [81, 44], [81, 52], [78, 52], [78, 69], [82, 70], [94, 84]) +
    poly([30, 56], [70, 56], [70, 62], [30, 62])],
  hq: ['HQ', 'building', 'Headquarters: a command tent with a flag on a pole',
    poly([8, 68], [38, 40], [68, 68], [64, 68], [64, 84], [44, 84], [38, 68], [32, 84], [12, 84], [12, 68]) +
    poly([74, 14], [78, 14], [78, 84], [74, 84]) + poly([78, 15], [86, 14], [94, 16], [94, 30], [86, 28], [78, 29])],
  depot: ['Supply Depot', 'building', 'Supply depot: stacked supply crates and a fuel drum',
    crate(8, 60, 24) + crate(35, 60, 24) + crate(21.5, 33, 24) +
    poly([66, 46], [88, 46], [90, 48.5], [90, 81.5], [88, 84], [66, 84], [64, 81.5], [64, 48.5]) +
    poly([68, 57], [86, 57], [86, 61], [68, 61]) + poly([68, 69], [86, 69], [86, 73], [68, 73])],
  barracks: ['Barracks', 'building', 'Barracks: a long hut with a pitched roof, a chimney, windows and a door',
    poly([6, 58], [14, 42], [68, 42], [68, 34], [75, 34], [75, 42], [86, 42], [94, 58]) +
    poly([10, 61], [90, 61], [90, 84], [55, 84], [55, 67], [45, 67], [45, 84], [10, 84]) +
    [16, 31, 59, 74].map((x) => poly([x, 66], [x + 10, 66], [x + 10, 75], [x, 75])).join('')],
  motorpool: ['Motor Pool', 'building', 'Motor pool: an open repair shed with a big wrench inside',
    poly([6, 34], [14, 18], [86, 18], [94, 34]) + poly([10, 37], [17, 37], [17, 84], [10, 84]) +
    poly([83, 37], [90, 37], [90, 84], [83, 84]) + wrench(60, 52, 12, -45, 28, 9)],
  airfield: ['Airfield', 'building', 'Airfield: an arched hangar with its doors open',
    poly(...arc(50, 84, 44, 50, 180, 360, 36), [75, 84], [75, 58], [25, 58], [25, 84]) + band(arc(50, 84, 36, 42, 233, 307, 12), 4)],
  shipyard: ['Shipyard', 'building', 'Shipyard: a slipway running down into the water under a crane',
    poly([6, 84], [6, 70], [60, 58], [60, 84]) + poly([66, 84], [66, 18], [72, 18], [72, 84]) + poly([72, 18], [94, 18], [94, 23], [72, 23]) +
    poly([90, 23], [92, 23], [92, 40], [90, 40]) + poly([4, 80], [96, 80], [96, 84], [4, 84])],
  flakpos: ['Flak Emplacement', 'building', 'Flak emplacement: a ring of sandbags with an anti-aircraft gun pointing up',
    blob(50, 76, [14, 28, 42, 56, 70, 84].map((x) => [x, 77.5, 8.5, 6.5]).concat([21, 35, 49, 63, 77].map((x) => [x, 66.5, 8.5, 6.5])), 84) +
    bar(at([50, 55], -60, 0), at([50, 55], -60, 11), 8) + bar(at([50, 55], -60, 11), at([50, 55], -60, 47), 3.6) +
    bar(at([50, 55], -60, 47), at([50, 55], -60, 52), 5.2)],

  // Support calls (the keys of SUPPORT in shared/sim.js). None of these names may be reused as a UNITS key.
  recon: ['Recon Flight', 'support', 'Recon flight: a pair of binoculars',
    poly([22, 18], [36, 18], [36, 28], [42, 32], [42, 72], ...arc(29, 72, 13, 13, 0, 180, 12).slice(1), [16, 32], [22, 28]) +
    poly([78, 18], [64, 18], [64, 28], [58, 32], [58, 72], ...arc(71, 72, 13, 13, 180, 0, 12).slice(1), [84, 32], [78, 28]) +
    circle(29, 71, 7) + circle(71, 71, 7) + poly([42, 38], [58, 38], [58, 50], [42, 50]) + poly([46, 24], [54, 24], [54, 34], [46, 34])],
  artillery: ['Artillery Barrage', 'support', 'Artillery barrage: a shell falling onto a burst',
    shell(50, 6, 16, 30) + poly(...Array.from({ length: 13 }, (_, k) => at([50, 92], 180 + k * 15, k % 2 ? 28 : 12)))],
  strafe: ['Strafing Run', 'support', 'Strafing run: a fighter diving with tracer fire ahead of it',
    place(SIDE_PLANE + [92, 104, 116].map((x) => bar([x, 48], [x + 8, 48], 5.8)).join(''), { s: 0.78, deg: 20, ox: 46, oy: 47, dx: -11, dy: 1 })],
  smoke: ['Smoke Barrage', 'support', 'Smoke barrage: a cloud of smoke',
    blob(50, 62, [[24, 66, 13], [40, 52, 17], [61, 48, 19], [78, 62, 14], [54, 66, 14]], 78) + circle(18, 34, 6)],
  bombing: ['Bombing Run', 'support', 'Bombing run: a stick of three bombs falling, fins up',
    bomb(27, 30) + bomb(50, 49) + bomb(73, 68)],
  dive: ['Dive Bomber', 'support', 'Dive bomber: a plane diving with a bomb released ahead of it',
    place(FIGHTER, { s: 0.62, deg: 135, dx: -10, dy: -10 }) + place(bomb(78, 78, 0.8), { deg: -45, ox: 78, oy: 78 })],
  para: ['Paratroopers', 'support', 'Paratroopers: a soldier hanging under a parachute',
    poly(...arc(50, 42, 38, 30, 180, 360, 24), ...[0, 1, 2, 3].flatMap((i) => arc(78.5 - 19 * i, 42, 9.5, 5, 0, -180, 8).slice(1))) +
    bar([15, 45], [43.5, 70.5], 4) + bar([85, 45], [56.5, 70.5], 4) + circle(50, 65.5, 5) +
    poly([43.5, 73], [56.5, 73], [56, 84], [54, 94], [51, 94], [50, 86], [49, 94], [46, 94], [44, 84])],
  cover: ['Fighter Cover', 'support', 'Fighter cover: a shield with a fighter cut out of it',
    poly([16, 10], [50, 14], [84, 10], [84, 44], ...curve([84, 44], [83, 76], [50, 94], 8), ...curve([50, 94], [17, 76], [16, 44], 8)) +
    place(FIGHTER, { s: 0.56, dy: -2 })],
};
const SUPPORT_KEYS = ['recon', 'artillery', 'strafe', 'smoke', 'bombing', 'dive', 'para', 'cover'];

// ---------- order and UI glyphs ----------

const Z = poly([54, 16], [84, 16], [84, 23], [64.5, 37], [84, 37], [84, 44], [54, 44], [54, 37], [73.5, 23], [54, 23]);
const GLYPH_RETREAT = band([[76, 88], [76, 46], ...arc(54, 46, 22, 22, 0, -180, 18).slice(1), [32, 58]], 11) + poly([18, 58], [46, 58], [32, 78]);
const GLYPH_DEFS = {
  // U-turn arrow: up, over and back down to the left
  retreat: GLYPH_RETREAT,
  // crosshair ring with an arrow pointing forward inside it
  amove: circle(50, 50, 34) + circle(50, 50, 26) + [0, 90, 180, 270].map((a) => bar(at([50, 50], a, 34), at([50, 50], a, 46), 7)).join('') +
    poly([32, 46], [50, 46], [50, 38], [66, 50], [50, 62], [50, 54], [32, 54]),
  stop: poly(...Array.from({ length: 8 }, (_, k) => at([50, 50], 22.5 + 45 * k, 44))) + poly([25, 44], [75, 44], [75, 56], [25, 56]),
  // a trench cut into the ground, with a firing step and a parapet in front
  trench: poly([6, 84], [6, 54], [28, 54], [33, 57], [35, 80], [60, 80], [61, 68], [67, 68], [68, 56], [72, 48], [82, 46], [94, 52], [94, 84]),
  sandbags: bag(29, 71, 38, 20) + bag(71, 71, 38, 20) + bag(50, 46, 38, 20),
  // barbed wire: two posts, a barbed top strand, a coil and a bottom strand
  wire: poly([10, 84], [10, 30], [13, 25], [16, 30], [16, 84]) + poly([84, 84], [84, 30], [87, 25], [90, 30], [90, 84]) +
    poly([16, 36], [30, 36], [33, 30], [36, 36], [47, 36], [50, 30], [53, 36], [64, 36], [67, 30], [70, 36], [84, 36], [84, 40], [16, 40]) +
    [27, 39, 51, 63, 75].map((x) => place(ellipse(x, 60, 8, 14) + ellipse(x, 60, 4, 10), { deg: 18, ox: x, oy: 60 })).join('') +
    poly([16, 78], [84, 78], [84, 82], [16, 82]),
  // Czech hedgehog: three steel beams crossing, standing on the ground
  traps: star(50, 52, [[52, 33], [128, 33], [200, 26], [232, 30], [308, 30], [20, 26]], 10) + poly([6, 84], [94, 84], [94, 90], [6, 90]),
  // machine gun nest: a sandbag wall with a machine gun resting on it
  nest: blob(50, 78, [18, 34, 50, 66, 82].map((x) => [x, 78, 9, 6.5]).concat([34, 50, 66].map((x) => [x, 67, 9, 6.5])), 84) +
    poly([20, 51], [34, 48], [56, 48], [56, 49], [90, 49], [90, 53], [56, 53], [54, 57.5], [50, 57.5], [49, 54], [34, 54], [20, 57]),
  grenade: place(poly([-44, -6], [-40, -6], [-40, -4], [14, -4], [14, -11], [38, -11], [41, -8], [41, 8], [38, 11], [14, 11],
    [14, 4], [-40, 4], [-40, 6], [-44, 6]) + poly([20, -7], [24, -7], [24, 7], [20, 7]), { ox: 0, oy: 0, deg: -50, dx: 50, dy: 50 }),
  // three bullets with short streaks behind them
  suppress: [[26, 52, 30], [50, 64, 36], [74, 52, 30]].map(([cy, x, len]) => poly([x, cy - 5], [x + 14, cy - 5],
    ...curve([x + 14, cy - 5], [x + 22, cy - 5], [x + 25, cy], 4), ...curve([x + 25, cy], [x + 22, cy + 5], [x + 14, cy + 5], 4), [x, cy + 5]) +
    bar([x - 5 - len, cy], [x - 5, cy], 4)).join(''),
  // armor-piercing shot: a sharp-nosed projectile with a driving band, flying up and right
  ap: place(poly([-34, -7], [-30, -10], [6, -10], ...curve([6, -10], [22, -9], [32, 0], 5), ...curve([32, 0], [22, 9], [6, 10], 5),
    [-30, 10], [-34, 7]) + poly([-22, -6], [-18, -6], [-18, 6], [-22, 6]), { ox: 0, oy: 0, deg: -40, dx: 50, dy: 52 }),
  barrage: [24, 50, 76].map((x) => shell(x, 26, 13, 22)).join('') + poly([8, 78], [92, 78], [92, 84], [8, 84]),
  // satchel charge: a bag with a flap and a carrying handle, a fuse and its spark
  satchel: poly([12, 40], [68, 40], [72, 44], [72, 82], [68, 86], [12, 86], [8, 82], [8, 44]) + poly([12, 52], [68, 52], [68, 56], [12, 56]) +
    band(arc(40, 40, 14, 14, 180, 360, 14), 5) + band([[75, 51], [81, 45], [80, 37], [85, 29]], 4) +
    star(87, 17, [30, 90, 150, 210, 270, 330].map((a) => [a, 6.5]), 4),
  ura: poly([14, 18], [30, 18], [54, 50], [30, 82], [14, 82], [38, 50]) + poly([46, 18], [62, 18], [86, 50], [62, 82], [46, 82], [70, 50]),
  // smoke grenade: a canister with a cloud rising beside it
  smokeab: poly([24, 44], [40, 44], [40, 49], [44, 49], [44, 86], [20, 86], [20, 49], [24, 49]) + poly([24, 62], [40, 62], [40, 66], [24, 66]) +
    blob(68, 30, [[56, 32, 11], [69, 22, 13], [82, 32, 10], [68, 37, 10]], 44),
  // take cover: a soldier crouched behind a low wall
  takecover: circle(34, 38, 8) + poly([20, 84], [20, 68], [24, 55], [34, 49], [46, 51], [52, 59], [52, 84]) +
    poly([58, 44], [92, 44], [92, 84], [58, 84]) + poly([6, 84], [94, 84], [94, 90], [6, 90]),
  // hold fire: a gun sight crossed out (the ring leaves gaps where the slash passes)
  holdFire: band(arc(50, 50, 26, 26, -30, 120, 16), 8) + band(arc(50, 50, 26, 26, 150, 300, 16), 8) +
    bar(at([50, 50], -45, 44), at([50, 50], 135, 44), 9),
  // hold position: an anchor
  holdPos: circle(50, 17, 9) + circle(50, 17, 4.5) + star(50, 36, [[-90, 10], [90, 40], [0, 20], [180, 20]], 9) +
    band(arc(50, 52, 32, 30, 25, 155, 16), 9) + poly([10, 58], [26, 52], [24, 68]) + poly([90, 58], [74, 52], [76, 68]),
  // auto-retreat: the retreat arrow beside a strength gauge that is nearly empty
  autoRetreat: place(GLYPH_RETREAT, { s: 0.74, ox: 50, oy: 50, dx: -12, dy: 4 }) +
    poly([72, 20], [92, 20], [92, 86], [72, 86]) + poly([77, 25], [87, 25], [87, 81], [77, 81]) + poly([80, 66], [84, 66], [84, 78], [80, 78]),
  // mass entrenchment patterns, seen from above: what the two clicks dig
  e_line: bar([17, 50], [83, 50], 11) + bar([7, 36], [7, 64], 6) + bar([93, 36], [93, 64], 6),
  // formations, seen from above with the front at the top: one square per unit
  f_line: [14, 32, 50, 68, 86].map((x) => sq(x, 50, 7)).join(''),
  f_block: [25, 50, 75].flatMap((y) => [25, 50, 75].map((x) => sq(x, y, 9))).join(''),
  f_column: [16, 39, 62, 85].flatMap((y) => [38, 62].map((x) => sq(x, y, 8))).join(''),
  f_wedge: [[50, 22], [34, 48], [66, 48], [18, 74], [50, 74], [82, 74]].map(([x, y]) => sq(x, y, 8)).join(''),
  f_tight: sq(38, 50, 8) + sq(62, 50, 8) + poly([6, 36], [22, 50], [6, 64]) + poly([94, 36], [78, 50], [94, 64]),
  f_spread: sq(40, 50, 7) + sq(60, 50, 7) + poly([84, 36], [98, 50], [84, 64]) + bar([72, 50], [85, 50], 6) + poly([16, 36], [2, 50], [16, 64]) + bar([28, 50], [15, 50], 6),
  f_together: [22, 50, 78].map((x) => sq(x, 36, 9)).join('') + bar([14, 70], [86, 70], 8) + bar([22, 51], [22, 64], 5) + bar([50, 51], [50, 64], 5) + bar([78, 51], [78, 64], 5),
  f_snap: sq(28, 26, 10) + sq(72, 26, 10) + poly([20, 44], [36, 44], [28, 54]) + poly([64, 44], [80, 44], [72, 54]) + bar([6, 72], [94, 72], 14),
  e_zigzag: band([[6, 66], [28, 34], [50, 66], [72, 34], [94, 66]], 10),
  e_double: bar([8, 34], [92, 34], 10) + bar([8, 66], [92, 66], 10),
  e_arc: band(arc(50, 80, 42, 42, 195, 345, 18), 10) + circle(50, 80, 6),
  e_ring: circle(50, 50, 38) + circle(50, 50, 28) + circle(50, 50, 6),
  e_strongpoint: poly([24, 34], [76, 34], [76, 86], [24, 86]) + poly([33, 43], [67, 43], [67, 77], [33, 77]) +
    bar([6, 10], [94, 10], 5) + [20, 40, 60, 80].map((x) => circle(x, 21, 5) + circle(x, 21, 2.2)).join(''),
  // mines: a flat anti-tank mine with its pressure cap
  mines: ellipse(50, 66, 40, 13) + poly([36, 42], [64, 42], [64, 52], [36, 52]) + poly([45, 34], [55, 34], [55, 42], [45, 42]),
  // bridge: a deck on an arch over the water
  bridge: poly([4, 36], [96, 36], [96, 45], [4, 45]) + band(arc(50, 86, 36, 34, 180, 360, 24), 9) +
    poly([4, 88], [96, 88], [96, 93], [4, 93]),
  menu: [22, 45, 68].map((y) => poly([14, y], [86, y], [86, y + 10], [14, y + 10])).join(''),
  fullscreen: poly([8, 8], [38, 8], [38, 17], [17, 17], [17, 38], [8, 38]) + poly([92, 8], [92, 38], [83, 38], [83, 17], [62, 17], [62, 8]) +
    poly([8, 92], [8, 62], [17, 62], [17, 83], [38, 83], [38, 92]) + poly([92, 92], [62, 92], [62, 83], [83, 83], [83, 62], [92, 62]),
  // capture the mouse: a pointer inside a frame
  capture: poly([6, 14], [94, 14], [94, 86], [6, 86]) + poly([13, 21], [87, 21], [87, 79], [13, 79]) +
    poly([38, 28], [38, 68], [47, 60], [53, 73], [59.5, 70], [53.5, 57.5], [65, 57.5]),
  // manpower: a steel helmet seen from the side
  mp: poly(...arc(50, 62, 34, 36, 180, 360, 24), [88, 64], [91, 67], [84, 68.5], [60, 66.5], [32, 68], [21, 77], [10, 76], [13, 68]),
  // munitions: a rifle cartridge standing up
  mun: poly([42, 34], ...curve([42, 34], [42, 16], [50, 7], 6), ...curve([50, 7], [58, 16], [58, 34], 6)) +
    poly([42, 37], [58, 37], [58, 44], [64, 52], [64, 79], [61.5, 81], [61.5, 83], [64.5, 83], [64.5, 90], [35.5, 90], [35.5, 83],
      [38.5, 83], [38.5, 81], [36, 79], [36, 52], [42, 44]),
  // fuel: a jerrycan with its three handles, spout and pressed X
  fuel: poly([28, 90], [24, 86], [24, 32], [28, 28], [28, 14], [31, 11], [61, 11], [64, 14], [64, 28], [66, 28], [70, 13], [80, 13],
    [76, 30], [76, 86], [72, 90]) + [32, 43, 54].map((x) => poly([x, 15], [x + 7, 15], [x + 7, 24], [x, 24])).join('') +
    star(50, 60, [[45, 20], [135, 20], [225, 20], [315, 20]], 5),
  // idle: a soldier standing at ease, asleep
  // fill in: earth going back into a hole; clear mines: a mine being lifted; field hospital: a cross; unload: out of the box
  fill: bar([6, 62], [30, 62], 9) + bar([70, 62], [94, 62], 9) + band(arc(50, 62, 22, 22, 0, 180, 12), 9) + poly([44, 10], [56, 10], [56, 34], [66, 34], [50, 54], [34, 34], [44, 34]),
  demine: ellipse(50, 74, 38, 12) + poly([44, 58], [56, 58], [56, 30], [66, 30], [50, 10], [34, 30], [44, 30]),
  aid: poly([38, 12], [62, 12], [62, 38], [88, 38], [88, 62], [62, 62], [62, 88], [38, 88], [38, 62], [12, 62], [12, 38], [38, 38]),
  unload: poly([6, 28], [50, 28], [50, 72], [6, 72]) + poly([14, 36], [42, 36], [42, 64], [14, 64]) + poly([56, 44], [76, 44], [76, 32], [96, 50], [76, 68], [76, 56], [56, 56]),
  idle: place(widen(poly(...MAN)), { s: 0.8, ox: 50, oy: 84, dx: -20 }) + Z + place(Z, { s: 0.6, ox: 54, oy: 16, dx: 12, dy: 36 }),
  unknown: poly([10, 10], [90, 10], [90, 90], [10, 90]) + poly([18, 18], [82, 18], [82, 82], [18, 82]) +
    band([...arc(50, 40, 13, 13, 190, 405, 18), [50, 56], [50, 62]], 9) + circle(50, 73, 5),
};

// ---------- API ----------

export const VIEWBOX = '0 0 100 100';

// SYMBOLS[type] = { name, branch, meaning, d } for every unit, building and support call; d is the filled path data.
// It has no prototype, so a name like "constructor" is simply unknown. Use symbolInfo(type) to always get an entry.
export const SYMBOLS = Object.create(null);
for (const [type, [name, branch, meaning, d]] of Object.entries(DEFS)) SYMBOLS[type] = { name, branch, meaning, d };
// ponytail: the newest units borrow a drawn symbol until they get their own
for (const [type, from, name, meaning] of [['commando', 'ranger', 'Commandos', 'Commando: a raider advancing with a submachine gun']]) SYMBOLS[type] = { ...SYMBOLS[from], name, meaning };

// GLYPHS[key] = path data for the order buttons and UI glyphs. The support calls resolve here too, to their symbol.
export const GLYPHS = Object.create(null);
for (const [key, d] of Object.entries(GLYPH_DEFS)) GLYPHS[key] = d;
for (const key of SUPPORT_KEYS) GLYPHS[key] = SYMBOLS[key].d;

// An unknown type (a name no symbol is drawn for, or something that is not a string at all) gets a question mark in a
// square. symbolSVG, drawSymbol, icon and symbolInfo never throw for it, so a new unit type shows up as "?" instead of
// breaking the HUD.
const UNKNOWN = { name: '', branch: 'unknown', meaning: 'Unknown type: a question mark in a square', d: GLYPHS.unknown };
export const hasSymbol = (type) => type in SYMBOLS;
export const symbolInfo = (type) => SYMBOLS[type] ?? UNKNOWN;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// Inline SVG string for the HUD: the silhouette filled in `color` (default currentColor, so CSS `color` sets it).
//   size   width and height in px (default: none, size it with CSS)
//   title  tooltip text; with it the SVG is role="img", without it aria-hidden
//   cls    extra class names
export function symbolSVG(type, { color = 'currentColor', size = null, title = null, cls = '' } = {}) {
  const s = symbolInfo(type), dim = size ? ` width="${+size}" height="${+size}"` : '';
  const name = typeof type === 'string' ? type : 'unknown';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEWBOX}"${dim} class="sym sym-${esc(name)}${cls ? ' ' + esc(cls) : ''}" ` +
    `${title ? 'role="img"' : 'aria-hidden="true"'}>${title ? `<title>${esc(title)}</title>` : ''}` +
    `<path fill-rule="evenodd" d="${s.d}" fill="${esc(color)}"/></svg>`;
}

// path data for any key: a glyph, then a symbol, else the question mark
const glyphPath = (key) => GLYPHS[key] ?? SYMBOLS[key]?.d ?? UNKNOWN.d;

// An order, support call or UI glyph for a button, drawn in the current text color.
export function icon(key) {
  return `<svg class="ico" viewBox="${VIEWBOX}" aria-hidden="true"><path fill-rule="evenodd" fill="currentColor" d="${glyphPath(key)}"/></svg>`;
}

// Draws a silhouette on a 2D canvas, centered on (x, y), `size` px across the 0..100 box, filled with `color`.
// halo: optional color stroked around the shape first (haloWidth in box units, round joins), so the icon stands out
// over busy ground. Path2D objects are made on first use (Path2D only exists in browsers) and kept per path.
const paths = new Map();
export function drawSymbol(ctx, type, x, y, size, { color = '#e2dfd3', halo = null, haloWidth = 10 } = {}) {
  const d = SYMBOLS[type]?.d ?? GLYPHS[type] ?? UNKNOWN.d;
  let p = paths.get(d);
  if (!p) paths.set(d, (p = new Path2D(d)));
  const k = size / 100;
  ctx.save();
  ctx.translate(x - size / 2, y - size / 2);
  ctx.scale(k, k);
  if (halo) {
    ctx.strokeStyle = halo; ctx.lineWidth = haloWidth; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.stroke(p);
  }
  ctx.fillStyle = color;
  ctx.fill(p, 'evenodd');
  ctx.restore();
}
