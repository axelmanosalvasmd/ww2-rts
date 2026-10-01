// Military map symbols, one per unit and building type (the keys of UNITS in shared/sim.js), in the style of the
// period US Army field manuals and close to NATO's: a rectangle frame with the branch mark inside, plus small
// modifiers above or below the frame. The HUD uses symbolSVG() and the 3D world uses drawSymbol() on a canvas.
//
// Everything is drawn in a 0..100 box. The unit frame sits at x 8..92, y 24..80 (1.5:1); modifiers go above it
// (y 2..20: elite chevron, conscript dots, tank weight bars, the building bar) or below it (y 84..97: wheels, bomb).
// Lines look like grease pencil: round caps and joins, a 7-unit stroke and a slight wobble. The wobble is seeded by
// the type name, so a symbol looks the same every time it is drawn.
//
// Families, so a player can read a symbol without the tooltip:
//   infantry  crossed box (rifle); elite = chevron above (rangers), mass = three dots above (conscripts)
//   armor     an oval; weight bars above: one light, two medium, three heavy (and the heavy oval is filled)
//   recon     the cavalry slash; with the armor oval and wheels it is the armored car
//   fire support and weapons  mortar arrow on a ring, rocket arrows, MG on its tripod, anti-tank chevron, sniper reticle
//   air defense  the dome (a half circle on the bottom edge, NATO's anti-aircraft mark) over what carries the guns:
//             a dot (flak gun), the armor oval (mobile flak), or the installation bar (flak emplacement)
//   aircraft  a plane seen from above: swept wing and a propeller bar at the nose (fighter); broad straight wing with
//             a bomb below the frame (ground-attack plane)
//   buildings a short solid bar on top of the frame (NATO's installation mark); the airfield adds a runway (two
//             parallel slanted lines)
//   support calls  a mission, not a unit, so they sit in a round frame: eye (recon flight), burst (artillery), plane with
//             tracer dots (strafe), cloud (smoke), bombs (bombing run), diving plane (dive bomber), parachute (paratroopers),
//             fighter (fighter cover). Their names are the keys of SUPPORT and must stay different from every UNITS key.
//
// An unknown type draws an empty frame with a "?". symbolSVG() and drawSymbol() never throw for it; symbolInfo(type)
// gives its entry, and hasSymbol(type) tells whether a symbol was drawn for the type.

export const STROKE = 7;
export const VIEWBOX = '0 0 100 100';
export const FRAME = { x: 8, y: 24, w: 84, h: 56 };

const L = 8, T = 24, R = 92, B = 80, CX = 50;

// Small seeded random source (FNV-1a hash of the seed, then mulberry32).
function rng(seed) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const n = (v) => Math.round(v * 10) / 10;

// A pen collects path data for one symbol: frame (outline, also the background), s (stroked marks) and f (filled marks).
function pen(seed) {
  const r = rng(seed), j = (a) => (r() * 2 - 1) * a;
  const out = { frame: '', s: '', f: '' };
  const pt = ([x, y], a = 0.6) => [x + j(a), y + j(a)];
  // a polyline whose segments bow a little to one side, like a hand following a ruler loosely
  const trace = (pts, closed, overshoot = 0) => {
    const q = pts.map((v) => pt(v));
    let d = `M${n(q[0][0])} ${n(q[0][1])}`, a = q[0];
    for (const b of closed ? [...q.slice(1), q[0]] : q.slice(1)) {
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1, bow = j(Math.min(1.3, len * 0.03));
      d += `Q${n((a[0] + b[0]) / 2 - (dy / len) * bow)} ${n((a[1] + b[1]) / 2 + (dx / len) * bow)} ${n(b[0])} ${n(b[1])}`;
      a = b;
    }
    // the pencil runs a little past the corner where it closes the shape
    if (overshoot) { const b = q[1], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1; d += `L${n(a[0] + (dx / len) * overshoot)} ${n(a[1] + (dy / len) * overshoot)}`; }
    else if (closed) d += 'Z';
    return d;
  };
  // a hand-drawn circle: a slightly squashed, slightly turned ellipse
  const ellipse = (cx, cy, rad) => {
    const rx = rad + j(0.5), ry = rad + j(0.5), deg = r() * 180, a = (deg * Math.PI) / 180, c = Math.cos(a) * rx, s = Math.sin(a) * rx;
    return `M${n(cx + c)} ${n(cy + s)}A${n(rx)} ${n(ry)} ${n(deg)} 1 1 ${n(cx - c)} ${n(cy - s)}A${n(rx)} ${n(ry)} ${n(deg)} 1 1 ${n(cx + c)} ${n(cy + s)}Z`;
  };
  // a stadium (the armor "oval"), x0..x1 by y0..y1
  const stadium = (x0, y0, x1, y1) => {
    const rad = (y1 - y0) / 2, [ax, ay] = pt([x0 + rad, y0]), [bx, by] = pt([x1 - rad, y0]);
    const [cx2, cy2] = pt([x1 - rad, y1]), [dx2, dy2] = pt([x0 + rad, y1]);
    return `M${n(ax)} ${n(ay)}L${n(bx)} ${n(by)}A${n(rad)} ${n(rad)} 0 0 1 ${n(cx2)} ${n(cy2)}L${n(dx2)} ${n(dy2)}A${n(rad)} ${n(rad)} 0 0 1 ${n(ax)} ${n(ay)}Z`;
  };
  return {
    out,
    frame() { out.frame = trace([[L, T], [R, T], [R, B], [L, B]], true, 3.5); },
    // the round frame of a support call (a mission, not a unit)
    circle() { out.frame = ellipse(CX, 50, 44); },
    // a frame whose top edge is a battlement: a fortified position
    fort() {
      const w = (R - L) / 5, d = 9, top = [];
      for (let k = 0; k < 5; k++) { const y = k % 2 ? T + d : T; top.push([L + k * w, y], [L + (k + 1) * w, y]); }
      out.frame = trace([[L, B], ...top, [R, B]], true);
    },
    line(...pts) { out.s += trace(pts, false); },
    // the air defense dome: a half circle standing on y, from cx - rad to cx + rad
    dome(cx, y, rad) {
      const [ax, ay] = pt([cx - rad, y]), [bx, by] = pt([cx + rad, y]);
      out.s += `M${n(ax)} ${n(ay)}A${n(rad)} ${n(rad)} 0 0 1 ${n(bx)} ${n(by)}`;
    },
    ring(cx, cy, rad) { out.s += ellipse(cx, cy, rad); },
    dot(cx, cy, rad) { out.f += ellipse(cx, cy, rad); },
    poly(...pts) { out.f += trace(pts, true); },
    oval(x0, y0, x1, y1, filled) { const d = stadium(x0, y0, x1, y1); out.s += d; if (filled) out.f += d; },
    arc(d) { out.s += d; },
  };
}

// shared marks
const cross = (p) => { p.line([L, T], [R, B]); p.line([L, B], [R, T]); };
const elite = (p) => p.line([31, 15], [50, 4], [69, 15]);
const mass = (p) => { p.dot(34, 11, 5); p.dot(50, 11, 5); p.dot(66, 11, 5); };
const bars = (p, k) => { for (let i = 0; i < k; i++) p.line([CX + (i - (k - 1) / 2) * 12, 4], [CX + (i - (k - 1) / 2) * 12, 16]); };
const wheels = (p) => { p.dot(33, 91, 5.5); p.dot(67, 91, 5.5); };
const site = (p) => p.poly([34, 10], [66, 10], [66, T], [34, T]);
const arrowUp = (p, x, y0, y1, head) => { p.line([x, y0], [x, y1 + head * 0.8]); p.poly([x - head * 0.75, y1 + head], [x, y1], [x + head * 0.75, y1 + head]); };
// An aircraft seen from above, nose up: fuselage, a solid wing (swept back, or straight and broad) and a tailplane,
// centered on (cx, cy) and scaled by s.
// rot turns it clockwise in degrees (a plane in a dive points down).
const plane = (p, cx, cy, s, straight = false, rot = 0) => {
  const c = Math.cos((rot * Math.PI) / 180), d = Math.sin((rot * Math.PI) / 180);
  const P = (x, y) => [cx + s * (x * c - y * d), cy + s * (x * d + y * c)];
  p.line(P(0, -15), P(0, 19));
  if (straight) p.poly(P(-35, -3), P(35, -3), P(35, 6), P(-35, 6));
  else p.poly(P(0, -5), P(31, 9), P(31, 13), P(0, 5), P(-31, 13), P(-31, 9));
  p.line(P(-10, 19), P(10, 19));
};
// ordnance below the frame: a solid head pointing down
const bomb = (p) => p.poly([41, 85], [59, 85], [50, 96]);
// a falling bomb at (cx, cy): a solid body with a pointed nose, flat tail up (a stroke is too wide to draw fins on it)
const bombAt = (p, cx, cy) => p.poly([cx, cy + 19], [cx + 7, cy + 9], [cx + 7, cy - 17], [cx - 7, cy - 17], [cx - 7, cy + 9]);
// The air defense dome: a half circle on the bottom edge of the frame, the NATO mark for anti-aircraft.
const domeMark = (p, rad = 30) => p.dome(CX, B, rad);

// type -> name, branch (family), meaning (what the drawing shows, for tooltips) and how to draw it
const DEFS = {
  rifle: { name: 'Rifle Squad', branch: 'infantry', meaning: 'Infantry: a crossed box', draw: (p) => cross(p) },
  ranger: { name: 'Ranger Squad', branch: 'infantry', mods: ['elite'], meaning: 'Elite infantry: crossed box under a chevron',
    draw: (p) => { cross(p); elite(p); } },
  conscript: { name: 'Conscripts', branch: 'infantry', mods: ['mass'], meaning: 'Mass infantry: crossed box under three dots',
    draw: (p) => { cross(p); mass(p); } },
  engineer: { name: 'Engineer Squad', branch: 'engineer', meaning: 'Engineers: the castle mark',
    draw: (p) => { p.line([27, 66], [27, 40], [73, 40], [73, 66]); p.line([CX, 40], [CX, 66]); } },
  mg: { name: 'MG Team', branch: 'weapon', meaning: 'Machine gun: a gun on its tripod',
    draw: (p) => { p.line([20, 43], [76, 43]); p.poly([70, 35], [82, 43], [70, 51]); p.line([44, 43], [32, 69]); p.line([44, 43], [56, 69]); } },
  mortar: { name: 'Mortar Team', branch: 'artillery', meaning: 'Mortar: an arrow standing on a ring',
    draw: (p) => { p.ring(CX, 66, 5.5); arrowUp(p, CX, 60, 31, 14); } },
  sniper: { name: 'Sniper', branch: 'infantry', meaning: 'Sniper: a scope reticle',
    draw: (p) => { p.ring(CX, 52, 15); p.line([CX, 30], [CX, 45]); p.line([CX, 59], [CX, 74]); p.line([26, 52], [43, 52]); p.line([57, 52], [74, 52]); } },
  at: { name: 'AT Gun', branch: 'antitank', meaning: 'Anti-tank gun: the anti-armor chevron over a gun',
    draw: (p) => { p.line([L, B], [CX, T], [R, B]); p.dot(CX, 64, 6.5); } },
  armoredcar: { name: 'Armored Car', branch: 'recon', mods: ['wheeled'], meaning: 'Armored recon: armor oval with the cavalry slash, on wheels',
    draw: (p) => { p.oval(28, 42, 72, 62); p.line([L, B], [R, T]); wheels(p); } },
  tank: { name: 'Light Tank', branch: 'armor', mods: ['light'], meaning: 'Light tank: armor oval, one bar',
    draw: (p) => { p.oval(30, 43, 70, 61); bars(p, 1); } },
  medium: { name: 'Medium Tank', branch: 'armor', mods: ['medium'], meaning: 'Medium tank: armor oval, two bars',
    draw: (p) => { p.oval(24, 40, 76, 64); bars(p, 2); } },
  tiger: { name: 'Tiger', branch: 'armor', mods: ['heavy'], meaning: 'Heavy tank: solid armor oval, three bars',
    draw: (p) => { p.oval(19, 37, 81, 67, true); bars(p, 3); } },
  rocket: { name: 'Rocket Launcher', branch: 'artillery', mods: ['wheeled'], meaning: 'Rocket artillery: a salvo of arrows, on wheels',
    draw: (p) => { for (const x of [30, CX, 70]) arrowUp(p, x, 70, 32, 12); wheels(p); } },
  bunker: { name: 'Command Bunker', branch: 'fort', meaning: 'Fortified command post: battlements and a firing slit',
    draw: (p) => { p.fort(); p.poly([26, 52], [74, 52], [74, 62], [26, 62]); } },
  hq: { name: 'HQ', branch: 'building', mods: ['installation'], meaning: 'Headquarters: a command flag',
    draw: (p) => { site(p); p.line([33, 73], [33, 33]); p.poly([33, 32], [50, 29], [68, 34], [68, 52], [50, 47], [33, 50]); } },
  barracks: { name: 'Barracks', branch: 'building', mods: ['installation'], meaning: 'Barracks: an infantry installation',
    draw: (p) => { site(p); cross(p); } },
  motorpool: { name: 'Motor Pool', branch: 'building', mods: ['installation'], meaning: 'Motor pool: a vehicle maintenance installation (the wrench)',
    draw: (p) => { site(p); p.line([31, 52], [69, 52]); p.arc(`M22 44A8 8 0 0 1 22 60`); p.arc(`M78 44A8 8 0 0 0 78 60`); } },
  depot: { name: 'Supply Depot', branch: 'building', mods: ['installation'], meaning: 'Supply depot: a supply installation (the base line)',
    draw: (p) => { site(p); p.line([L, 66], [R, 66]); } },
  // air defense: the dome on the bottom edge, with what carries the guns inside it
  flak: { name: 'Flak Gun', branch: 'airdefense', meaning: 'Anti-aircraft gun: the air defense dome over a gun',
    draw: (p) => { domeMark(p); p.dot(CX, 68, 6.5); } },
  flaktrack: { name: 'Mobile Flak', branch: 'airdefense', mods: ['tracked'], meaning: 'Self-propelled anti-aircraft: the air defense dome over the armor oval',
    draw: (p) => { p.dome(CX, 58, 19); p.oval(20, 58, 80, 76); } },
  flakpos: { name: 'Flak Emplacement', branch: 'building', mods: ['installation'], meaning: 'Anti-aircraft position: an installation with the air defense dome',
    draw: (p) => { site(p); domeMark(p, 26); p.dot(CX, 68, 6); } },
  // aircraft: a plane seen from above. The fighter has a propeller at the nose; the ground-attack plane carries bombs.
  fighter: { name: 'Fighter', branch: 'air', meaning: 'Fighter: an aircraft with a propeller',
    draw: (p) => { plane(p, CX, 53, 1); p.line([43, 33], [57, 33]); } },
  attacker: { name: 'Ground-attack Plane', branch: 'air', mods: ['bombs'], meaning: 'Ground attack: a broad-winged aircraft with a bomb below',
    draw: (p) => { plane(p, CX, 52, 1, true); bomb(p); } },
  airfield: { name: 'Airfield', branch: 'building', mods: ['installation'], meaning: 'Airfield: an installation with a runway',
    draw: (p) => { site(p); p.line([20, 70], [62, 36]); p.line([36, 74], [78, 40]); } },

  // Support calls (the keys of SUPPORT in shared/sim.js). A call is a mission, not a unit, so it sits in a round frame.
  // None of these names may be reused as a UNITS key.
  recon: { name: 'Recon Flight', branch: 'support', meaning: 'Recon flight: an eye',
    draw: (p) => { p.arc('M15 50Q50 20 85 50Q50 80 15 50Z'); p.dot(CX, 50, 9); } },
  artillery: { name: 'Artillery Barrage', branch: 'support', meaning: 'Artillery barrage: a shell burst',
    draw: (p) => { const pts = []; for (let k = 0; k < 16; k++) { const a = (k * Math.PI) / 8, r = k % 2 ? 13 : 31; pts.push([CX + Math.cos(a) * r, 50 + Math.sin(a) * r]); } p.poly(...pts); } },
  strafe: { name: 'Strafing Run', branch: 'support', meaning: 'Strafing run: a plane with tracer fire ahead of it',
    draw: (p) => { plane(p, CX, 66, 0.8); p.dot(CX, 40, 3.5); p.dot(CX, 29, 3.5); p.dot(CX, 18, 3.5); } },
  smoke: { name: 'Smoke Barrage', branch: 'support', meaning: 'Smoke barrage: a cloud',
    draw: (p) => p.arc('M27 68A10 10 0 0 1 27 48A15 15 0 0 1 55 41A12 12 0 0 1 75 50A10 10 0 0 1 73 68Z') },
  bombing: { name: 'Bombing Run', branch: 'support', meaning: 'Bombing run: a stick of bombs falling',
    draw: (p) => { for (const x of [29, CX, 71]) bombAt(p, x, 50); } },
  dive: { name: 'Dive Bomber', branch: 'support', meaning: 'Dive bomber: a plane diving on its target',
    draw: (p) => plane(p, 48, 48, 0.98, false, 135) },
  para: { name: 'Paratroopers', branch: 'support', meaning: 'Paratroopers: a parachute',
    draw: (p) => { p.poly([20, 46], [24, 34], [36, 26], [50, 23], [64, 26], [76, 34], [80, 46]); p.line([20, 46], [50, 70]); p.line([80, 46], [50, 70]); p.line([CX, 46], [CX, 70]); p.dot(CX, 76, 5); } },
  cover: { name: 'Fighter Cover', branch: 'support', meaning: 'Fighter cover: a fighter on patrol',
    draw: (p) => { plane(p, CX, 53, 1); p.line([43, 33], [57, 33]); } },
};

// SYMBOLS[type] = { name, branch, mods, meaning, frame, stroke, fill }: frame is the outline path (also the
// background), stroke the line marks, fill the solid marks. All are SVG path data in the 0..100 box.
// It has no prototype, so a name like "constructor" is simply unknown. Use symbolInfo(type) to always get an entry.
export const SYMBOLS = Object.create(null);
for (const [type, def] of Object.entries(DEFS)) {
  const p = pen(type);
  if (def.branch === 'support') p.circle();
  else if (def.branch !== 'fort') p.frame();
  def.draw(p);
  SYMBOLS[type] = { name: def.name, branch: def.branch, mods: def.mods ?? [], meaning: def.meaning, frame: p.out.frame, stroke: p.out.s, fill: p.out.f };
}
// An unknown type (a name no symbol is drawn for, or something that is not a string at all) gets an empty frame with a
// question mark. symbolSVG, drawSymbol and symbolInfo never throw for it, so a new unit type shows up as "?" in the HUD
// instead of breaking it.
const UNKNOWN = (() => {
  const p = pen('?'); p.frame(); p.arc('M38 45C38 32 62 32 62 44C62 54 50 54 50 63'); p.dot(CX, 72, 4.5);
  return { name: '', branch: 'unknown', mods: [], meaning: 'Unknown type', frame: p.out.frame, stroke: p.out.s, fill: p.out.f };
})();
const get = (type) => SYMBOLS[type] ?? UNKNOWN;
export const hasSymbol = (type) => type in SYMBOLS;
// The entry for a type, or the "?" fallback: use this instead of SYMBOLS[type] when the type may be new.
export const symbolInfo = (type) => get(type);

// small symbols get a slightly heavier line so they stay readable
const autoStroke = (size) => (size && size <= 22 ? 8 : STROKE);

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// Inline SVG string for the HUD.
//   color  ink for lines and solid marks (default currentColor, so CSS `color` sets it)
//   stroke line width in box units (default 7, or 8 when size is 22 px or less)
//   fill   frame background (default none)
//   halo   optional outline color drawn under the ink, for symbols over busy ground
//   size   width and height in px (default: none, size it with CSS)
//   title  optional tooltip text
export function symbolSVG(type, { color = 'currentColor', stroke = null, fill = 'none', halo = null, size = null, title = null } = {}) {
  const s = get(type), w = +(stroke ?? autoStroke(size)), dim = size ? ` width="${+size}" height="${+size}"` : '';
  const ink = (c, extra) => `<path d="${s.frame}${s.stroke}" fill="none" stroke="${esc(c)}" stroke-width="${n(w + extra)}"/>` +
    (s.fill ? `<path d="${s.fill}" fill="${esc(c)}" stroke="${esc(c)}" stroke-width="${n(w * 0.35 + extra)}"/>` : '');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEWBOX}"${dim} class="sym sym-${esc(type)}" stroke-linecap="round" stroke-linejoin="round" ${title ? 'role="img"' : 'aria-hidden="true"'}>` +
    (title ? `<title>${esc(title)}</title>` : '') +
    (fill && fill !== 'none' ? `<path d="${s.frame}" fill="${esc(fill)}" stroke="none"/>` : '') +
    (halo ? ink(halo, w * 0.7) : '') + ink(color, 0) + '</svg>';
}

// Draws a symbol on a 2D canvas, centered on (x, y), `size` px across the 0..100 box.
// Options as symbolSVG: color (default '#2b2418' ink), fill (frame background, default none), stroke, halo.
const paths = new WeakMap(); // keyed by the symbol entry, so odd type names never grow it
function path2d(type) {
  const s = get(type);
  let p = paths.get(s);
  if (!p) { p = { frame: new Path2D(s.frame), lines: new Path2D(s.frame + s.stroke), fill: s.fill ? new Path2D(s.fill) : null }; paths.set(s, p); }
  return p;
}
export function drawSymbol(ctx, type, x, y, size, { color = '#2b2418', fill = null, stroke = null, halo = null } = {}) {
  const p = path2d(type), k = size / 100;
  stroke = +(stroke ?? autoStroke(size));
  ctx.save();
  ctx.translate(x - size / 2, y - size / 2);
  ctx.scale(k, k);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (fill && fill !== 'none') { ctx.fillStyle = fill; ctx.fill(p.frame); }
  const ink = (c, extra) => {
    ctx.strokeStyle = ctx.fillStyle = c;
    ctx.lineWidth = stroke + extra; ctx.stroke(p.lines);
    if (p.fill) { ctx.fill(p.fill); ctx.lineWidth = stroke * 0.35 + extra; ctx.stroke(p.fill); }
  };
  if (halo) ink(halo, stroke * 0.7);
  ink(color, 0);
  ctx.restore();
}
