// Crew-served weapons as detailed miniatures: the M1919, MG 42 and Maxim machine guns, the 81 mm, GrW 34 and 82 mm
// mortars, the 57 mm, PaK 40 and 45 mm anti-tank guns, the Bofors, Flak 38 and 61-K anti-aircraft guns and the
// emplacement twin gun of the flak position, plus the sandbag ring around that position.
//
// Each gun is built once per look as ONE vertex-colored geometry (the weapon, its ammunition and its owner marking), so a
// gun stays one draw call of the shared PAINT material. client/unit-models.js calls gunModel() and bakes the result:
//   { geo }                      a static weapon in the unit's local space (+x forward, +y up): mg and mortar, and the
//                                gun of a flak position
//   { geo, pivot, tip }          a gun that traverses (at, flak): geo is in the space of v.turret, which sits at `pivot`
//                                in the unit's space, and `tip` is the muzzle in that same space (v.fxTip)
// All dimensions are metres in the unit's space (the same space as the crew slots). Weapons are about true to size
// next to the soldiers, who are a little heroic, and the shapes follow the reference sheets: tripods with one front
// leg, a Sokolov mount with a single shield plate, a baseplate and bipod mortar, split-trail guns with arrow spades and
// V shields, a cruciform Bofors platform on four jacks, a three-legged Flak 38 base and a four-wheeled 61-K carriage.
// Left is -z (the side the M1919 and MG 42 belts feed from), right is +z.
//
// Paint: the faction's vehicle color for carriages and shields, light gunmetal for barrels and mechanisms, rubber tires,
// brass rounds. Edges of boxes and plates are lifted a little (a dry-brushed look) and the ground side is darkened. The
// owner's color sits on a tactical band (shield top edge, ammunition box lid, baseplate and tube bands) so players can
// tell whose gun it is. National markings (star, Balkenkreuz) are decals on the shields.
import * as THREE from 'three';
import * as G from './geom.js';

const TAU = Math.PI * 2, RAD = Math.PI / 180;
const col = (c) => (c && c.isColor ? c : new THREE.Color(c));
const shade = (c, k) => col(c).clone().multiplyScalar(k);
const mix = (a, b, t) => col(a).clone().lerp(col(b), t);
const smooth = (t) => { const k = Math.min(1, Math.max(0, t)); return k * k * (3 - 2 * k); };
const circle = (r, n, a0 = 0) => Array.from({ length: n }, (_, k) => [r * Math.cos(a0 + (k / n) * TAU), r * Math.sin(a0 + (k / n) * TAU)]);

// Matrix chain: M(x, y, z).rz(a).ry(b).m is translate * rotateZ * rotateY, so the last call acts on the shape first.
function M(x = 0, y = 0, z = 0) {
  const m = new THREE.Matrix4().makeTranslation(x, y, z), me = {
    m,
    t(a, b, c) { m.multiply(new THREE.Matrix4().makeTranslation(a, b, c)); return me; },
    rx(a) { m.multiply(new THREE.Matrix4().makeRotationX(a)); return me; },
    ry(a) { m.multiply(new THREE.Matrix4().makeRotationY(a)); return me; },
    rz(a) { m.multiply(new THREE.Matrix4().makeRotationZ(a)); return me; },
  };
  return me;
}
const mat = (m) => (m ? (m.m ?? m) : new THREE.Matrix4());

// Dry-brush: faces that are neither level nor upright (chamfers and bevels, where paint wears first) get a lighter tone.
// Writes a 'color' attribute of multipliers, which G.merge combines with the paint.
function lightEdges(geo, k = 1.2, thr = 0.1) {
  const N = geo.attributes.normal, c = new Float32Array(N.count * 3);
  for (let i = 0; i < N.count; i++) {
    const e = 1 - Math.max(Math.abs(N.getX(i)), Math.abs(N.getY(i)), Math.abs(N.getZ(i)));
    c.fill(e > thr ? k : 1, i * 3, i * 3 + 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}
const softCache = new Map();
function softBox(w, h, d, c) {
  const key = `${w}|${h}|${d}|${c}`;
  if (!softCache.has(key)) softCache.set(key, lightEdges(G.chamferBox(w, h, d, c)));
  return softCache.get(key);
}

const QUAD = new THREE.PlaneGeometry(1, 1);

// A parts list that merges into one colored geometry.
function kit() {
  const items = [];
  const k = {
    items,
    add(geo, color, m) { items.push({ geo, color: color ?? 0xffffff, matrix: mat(m) }); return k; },
    // a box centered on (x, y, z), turned by XYZ Euler angles; c > 0 cuts its edges flat and lifts their tone
    box(color, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0, c = 0) {
      return k.add(c > 0 ? softBox(w, h, d, c) : new THREE.BoxGeometry(w, h, d), color, G.xf(x, y, z, rx, ry, rz));
    },
    // a box from point a to point b: h and w are its section (h stays vertical-ish)
    beam(color, a, b, h, w, c = 0) {
      const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), x = B.clone().sub(A), L = x.length();
      x.normalize();
      const up = Math.abs(x.y) > 0.98 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
      const z = new THREE.Vector3().crossVectors(x, up).normalize(), y = new THREE.Vector3().crossVectors(z, x);
      const m = new THREE.Matrix4().makeBasis(x, y, z).setPosition(A.add(B).multiplyScalar(0.5));
      return k.add(c > 0 ? softBox(L, h, w, c) : new THREE.BoxGeometry(L, h, w), color, m);
    },
    // a box that narrows from section (w0 across, h0 up) at a to (w1, h1) at b: trails and outrigger arms
    taper(color, a, b, w0, h0, w1 = w0, h1 = h0) {
      const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), x = B.clone().sub(A), L = x.length();
      x.normalize();
      const up = Math.abs(x.y) > 0.98 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
      const z = new THREE.Vector3().crossVectors(x, up).normalize(), y = new THREE.Vector3().crossVectors(z, x);
      const rect = (w, h) => [[w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2], [-w / 2, -h / 2]];
      const g = G.loft([{ x: 0, pts: rect(w0, h0) }, { x: L, pts: rect(w1, h1) }], { normals: 'flat' });
      return k.add(g, color, new THREE.Matrix4().makeBasis(x, y, z).setPosition(A));
    },
    rod(color, a, b, r, radial = 6, caps = true) { return k.add(G.tube([a, b], r, { radial, caps }), color); },
    // a solid of revolution from [radius, height] points, lying along `axis`, base at (x, y, z)
    turn(color, profile, seg, x, y, z, axis = 'y', m) {
      return k.add(G.lathe(profile, seg, { axis }), color, m ?? M(x, y, z));
    },
    // a (tapered) cylinder or cone: radius r0 at the base, r1 at the top, `h` long
    cyl(color, r0, r1, h, seg, x, y, z, axis = 'y', m) {
      return k.turn(color, [[0, 0], [r0, 0], [r1, h], [0, h]], seg, x, y, z, axis, m);
    },
    // a flat panel from an outline of [u, v] points: u runs across (world z), v runs up, it is `t` thick along x.
    // The panel stands with its bottom edge at (x, y), leaning back by `lean` and turned by `yaw` about the vertical.
    // Returns the plate's frame (+x out of the front face, +y up the plate, +z along u) for onPlate().
    panel(color, outline, t, x, y, z, lean = 0, yaw = 0, holes = [], bevel = 0.006) {
      const g = lightEdges(G.extrudeProfile(outline, t, bevel, { holes, segments: 1 }), 1.18, 0.12);
      const frame = M(x, y, z).ry(yaw).rz(lean).m.clone();
      k.add(g, color, M(x, y, z).ry(yaw).rz(lean).ry(-Math.PI / 2));
      return frame;
    },
    // a flat marking facing along `normal`, w across and h up (toward `up`), through its own frame `parent` if given
    decal(color, w, h, at, normal, up = [0, 1, 0], parent) {
      const m = G.place(at, normal, up, 1).multiply(new THREE.Matrix4().makeScale(w, h, 1));
      return k.add(QUAD, color, parent ? mat(parent).clone().multiply(m) : m);
    },
    // a marking lying on the ground or a lid, w along x and d along z, turned by rot about the vertical
    flat(color, w, d, x, y, z, rot = 0) {
      return k.add(QUAD, color, mat(M(x, y, z).ry(rot).rx(-Math.PI / 2)).clone().multiply(new THREE.Matrix4().makeScale(w, d, 1)));
    },
    // a sub-assembly merged on its own, then placed (the gun of a mount that elevates)
    group(sub, m) { return k.add(sub.geometry(), 0xffffff, m); },
    geometry() { return G.merge(items); },
  };
  return k;
}

// a plate marking at (u across, v up, off out of the face) of a panel() frame
function onPlate(frame, u, v, off) {
  const at = new THREE.Vector3(off, v, u).applyMatrix4(frame);
  const n = new THREE.Vector3(1, 0, 0).transformDirection(frame), up = new THREE.Vector3(0, 1, 0).transformDirection(frame);
  return G.place(at, n, up, 1);
}

// an owner's band along a plate's top edge: w wide, centered at u across and v up (the edge) of a panel() frame
function plateBand(k, color, frame, u, v, w) {
  return k.add(new THREE.BoxGeometry(0.04, 0.034, w), color, new THREE.Matrix4().copy(frame).multiply(new THREE.Matrix4().makeTranslation(0, v - 0.012, u)));
}

// Paint and finish: the body color darkens toward the ground and under overhangs, and top faces get a dry-brushed lift.
function finish(geo, { dark = 0.8, under = 0.14, lift = 0.12, span } = {}) {
  geo.computeBoundingBox();
  const y0 = geo.boundingBox.min.y, h = Math.max(0.3, span ?? 0.38 * (geo.boundingBox.max.y - geo.boundingBox.min.y));
  const out = G.ao(geo, { falloff: (p, n) => (dark + (1 - dark) * smooth((p.y - y0) / h)) * (1 - under * Math.max(0, -n.y)) * (1 + lift * Math.max(0, n.y)) });
  out.computeBoundingBox(); out.computeBoundingSphere();
  return out;
}

function palette(look) {
  const paint = mix(look.vehicle, 0xffffff, 0.12), black = new THREE.Color(0x6b6f75);
  return {
    paint, dark: shade(paint, 0.74), light: mix(paint, 0xffffff, 0.22),
    steel: new THREE.Color(0xa0a4a9), black, hole: shade(black, 0.4), tire: new THREE.Color(0x2e2c28), lug: new THREE.Color(0x3f3d37),
    brass: new THREE.Color(0xc4a85e), wood: new THREE.Color(0x7a6446), tan: new THREE.Color(0xb8a66a),
    owner: col(look.color).clone(), white: new THREE.Color(0xece6d6), red: new THREE.Color(0xc23a2a),
  };
}

// ---------------------------------------------------------------- shared pieces

// a wheel with its axle along z, centered on the origin: a rubber tire with tread lugs on a pressed steel disc with a hub
// cap and bolt heads, or on spokes. The detailed face is +z (turn the wheel on the other side of a gun around); the
// back is a plain disc.
function wheelGeo(R, w, P, { spokes = 0, seg = 14, lugs = 12, bolts = 5, back = true } = {}) {
  const k = kit(), ri = R * 0.8, hub = R * 0.2, fw = w * 0.5;
  k.turn(P.tire, [[ri, -w / 2], [R, -w * 0.4], [R, w * 0.4], [ri, w / 2]], seg, 0, 0, 0, 'z');
  // tread: lighter blocks across the rubber, painted on
  const rt = R * Math.cos(Math.PI / seg) + 0.002;
  for (let i = 0; i < lugs; i++) {
    const a = ((i + 0.5) / lugs) * TAU, c = Math.cos(a), s = Math.sin(a);
    k.decal(P.lug, w * 0.62, R * 0.2, [c * rt, s * rt, 0], [c, s, 0], [0, 0, 1]);
  }
  if (spokes) {
    const len = ri * 0.95 - hub, sp = new THREE.BoxGeometry(len, R * 0.07, w * 0.26);
    for (let i = 0; i < spokes; i++) k.add(sp, P.paint, M().rz((i / spokes) * TAU).t(hub + len / 2, 0, 0));
    k.turn(P.paint, [[0, -w * 0.45], [hub * 1.4, -w * 0.45], [hub * 1.4, w * 0.45], [0, w * 0.45]], 8, 0, 0, 0, 'z');
    k.turn(P.dark, [[0, w * 0.55], [hub * 0.7, w * 0.55], [hub * 0.7, w * 0.45], [0, w * 0.45]], 6, 0, 0, 0, 'z');
  } else {
    k.turn(P.paint, [[0, fw * 1.3], [hub * 1.5, w * 0.2], [ri, w * 0.2]], seg, 0, 0, 0, 'z');
    if (back) k.turn(P.paint, [[0, -w * 0.2], [ri, -w * 0.2]], seg, 0, 0, 0, 'z');
    for (let i = 0; i < bolts; i++) {
      const a = (i / bolts) * TAU + 0.3, r = hub * 2.4;
      k.decal(P.dark, hub * 0.55, hub * 0.55, [r * Math.cos(a), r * Math.sin(a), w * 0.2 + 0.002], [0, 0, 1], [0, 1, 0]);
    }
  }
  return k.geometry();
}

// a trail or foot spade: an arrow plate lying near the ground with its tip pushed down, and a handle over the trail end
function spade(k, P, end, d) {
  const yaw = Math.atan2(-d[1], d[0]), outline = [[-0.24, -0.15], [0, -0.25], [0.28, 0], [0, 0.25], [-0.24, 0.15]];
  k.add(lightEdges(G.extrudeProfile(outline, 0.035, 0.008, { segments: 1 }), 1.18, 0.12), P.dark, M(end[0] + d[0] * 0.06, 0.07, end[2] + d[1] * 0.06).ry(yaw).rz(-0.22).rx(-Math.PI / 2));
  const side = [-d[1], d[0]];     // across the trail, in the plan
  for (const s of [-1, 1]) k.rod(P.dark, [end[0] + side[0] * 0.09 * s, 0.07, end[2] + side[1] * 0.09 * s], [end[0] + side[0] * 0.09 * s - d[0] * 0.04, 0.2, end[2] + side[1] * 0.09 * s - d[1] * 0.04], 0.014, 4, false);
  k.rod(P.dark, [end[0] + side[0] * 0.09 - d[0] * 0.04, 0.2, end[2] + side[1] * 0.09 - d[1] * 0.04], [end[0] - side[0] * 0.09 - d[0] * 0.04, 0.2, end[2] - side[1] * 0.09 - d[1] * 0.04], 0.014, 4, false);
}

// a ring lying flat (axis y), e.g. an owner marking on a baseplate
function flatRing(k, color, r0, r1, seg, x, y, z) {
  k.add(new THREE.RingGeometry(r0, r1, seg), color, M(x, y, z).rx(-Math.PI / 2));
}

// a ring sight: a flat annulus on a post, facing +x
function ringSight(k, color, x, y, z, r = 0.085, post = 0.16) {
  const g = G.extrudeProfile(circle(r, 8), 0.016, 0, { holes: [circle(r * 0.72, 8)], segments: 1 });
  k.add(g, color, M(x, y, z).ry(-Math.PI / 2));
  k.rod(color, [x, y - r - post, z], [x, y - r + 0.01, z], 0.014, 5, false);
}

// a cartridge standing for a clip or lying in a belt: brass case along +x from the base, tip toward +x
function round(k, P, x, y, z, len, r, tip = P.red) {
  k.turn(P.brass, [[0, 0], [r, 0], [r, len * 0.7]], 6, x, y, z, 'x');
  k.turn(tip, [[r * 0.96, 0], [0, len * 0.3]], 6, x + len * 0.7, y, z, 'x');
}

// a screw jack under the end of an outrigger at (x, z): pad, screw, spring and a crank bar
function jack(k, P, x, z) {
  k.cyl(P.dark, 0.14, 0.12, 0.035, 8, x, 0, z);
  k.cyl(P.steel, 0.03, 0.03, 0.34, 6, x, 0.035, z);
  k.cyl(P.dark, 0.05, 0.05, 0.1, 6, x, 0.07, z);
  k.cyl(P.dark, 0.055, 0.055, 0.05, 6, x, 0.31, z);
  k.rod(P.steel, [x, 0.4, z - 0.07], [x, 0.4, z + 0.07], 0.012, 4, false);
}

// ---------------------------------------------------------------- machine guns

// belts: a dark link strip along a path with brass rounds across it
function belt(k, P, path, n = 9) {
  const curve = new THREE.CatmullRomCurve3(path.map((p) => new THREE.Vector3(...p)), false, 'centripetal');
  k.add(G.tube(path, 0.011, { segments: 8, radial: 4, caps: false }), P.hole);
  const Y = new THREE.Vector3(0, 1, 0), box = new THREE.BoxGeometry(0.056, 0.05, 0.022);
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n, p = curve.getPointAt(u), t = curve.getTangentAt(u);
    const a = new THREE.Vector3().crossVectors(t, Y);
    if (a.lengthSq() < 1e-6) a.set(0, 0, 1);
    a.normalize();
    k.add(box, P.brass, new THREE.Matrix4().makeBasis(a, t, new THREE.Vector3().crossVectors(a, t)).setPosition(p));
  }
}

// An ammunition box for the faction's gun with an owner band across the lid: US olive can with a stamped X, German
// narrow steel can with a carry handle and latches, Soviet plain box with a rope handle and a strap.
function ammoBox(k, P, fac, x, z, rot, wide = 1) {
  const [w, h, d] = fac === 0 ? [0.4, 0.24, 0.18] : fac === 1 ? [0.28, 0.3, 0.13] : [0.36, 0.22, 0.17];
  const color = fac === 0 ? mix(P.paint, 0x56603a, 0.4) : fac === 1 ? mix(P.paint, P.steel, 0.25) : mix(P.wood, P.paint, 0.3);
  const at = M(x, 0, z).ry(rot).m.clone();
  k.add(softBox(w * wide, h, d, 0.02), color, M(x, h / 2, z).ry(rot));
  k.add(new THREE.BoxGeometry(w * wide * 0.8, 0.012, d * 0.54), P.owner, M(x, h + 0.004, z).ry(rot));
  const rail = shade(color, 0.6);
  if (fac === 0) {
    k.add(new THREE.BoxGeometry(0.09, 0.03, 0.05), rail, M(x, h + 0.02, z).ry(rot));
    for (const s of [-1, 1]) for (const a of [0.7, -0.7]) k.decal(rail, 0.02, h * 1.15, [0, h * 0.5, s * (d / 2 + 0.002)], [0, 0, s], [Math.sin(a), Math.cos(a), 0], at);
  } else if (fac === 1) {
    // a carry handle standing over the lid and two latches on the front face
    for (const s of [-1, 1]) k.add(new THREE.BoxGeometry(0.014, 0.045, 0.014), rail, M(x, h + 0.022, z).ry(rot).t(s * 0.075, 0, 0));
    k.add(new THREE.BoxGeometry(0.17, 0.014, 0.02), rail, M(x, h + 0.052, z).ry(rot));
    for (const s of [-1, 1]) k.add(new THREE.BoxGeometry(0.03, 0.05, 0.014), rail, M(x, h * 0.62, z).ry(rot).t(s * w * 0.28, 0, d / 2));
  } else {
    k.add(new THREE.BoxGeometry(0.1, 0.03, 0.03), rail, M(x, h + 0.02, z).ry(rot));
    k.add(new THREE.BoxGeometry(0.04, h * 1.02, d * 1.04), rail, M(x, h / 2, z).ry(rot).t(w * 0.28, 0, 0));
    k.add(new THREE.BoxGeometry(0.04, h * 1.02, d * 1.04), rail, M(x, h / 2, z).ry(rot).t(-w * 0.28, 0, 0));
  }
}

// small perforations or slots painted on a jacket along x: rows at the angles (degrees from the top toward +z)
function perforate(k, color, { x0, x1, n, angles, r, y, across, along }) {
  for (const a of angles) {
    const t = a * RAD, ny = Math.cos(t), nz = Math.sin(t);
    for (let i = 0; i < n; i++) {
      const x = x0 + (x1 - x0) * (n === 1 ? 0.5 : i / (n - 1));
      k.decal(color, across, along, [x, y + r * ny, r * nz], [0, ny, nz], [1, 0, 0]);
    }
  }
}

// a tripod foot: a small flat shoe
const foot = (k, P, x, z) => k.cyl(P.steel, 0.05, 0.036, 0.04, 8, x, 0, z);

// A water jacket with lengthwise flutes: a gear outline pushed out along +x from x0.
function flutedJacket(x0, y, len, rOut, rIn, flutes) {
  const pts = [], step = TAU / flutes;
  for (let i = 0; i < flutes; i++) for (const [f, r] of [[0.06, rOut], [0.4, rOut], [0.6, rIn], [0.94, rIn]]) pts.push([r * Math.cos((i + f) * step), r * Math.sin((i + f) * step)]);
  const g = G.extrudeProfile(pts, len, 0, { segments: 1, crease: 25 });
  g.rotateY(Math.PI / 2); g.translate(x0 + len / 2, y, 0);
  return g;
}

// +x forward. The bore sits at y = 0.45 and the muzzle at x = 1.72, where client/fx.js starts the tracers.
function mgGun(fac, P) {
  const k = kit(), y = 0.45, leg = mix(P.black, P.steel, 0.45);
  if (fac === 0) {
    // M1919A4 on the M2 tripod: boxy receiver with a raised top cover, a perforated jacket, one front leg and two rear legs
    k.box(P.black, 0.44, 0.2, 0.15, 0.99, y, 0, 0, 0, 0, 0.016);
    k.box(P.steel, 0.3, 0.05, 0.13, 1.02, y + 0.123, 0, 0, 0, 0, 0.012);               // raised top cover
    k.box(P.steel, 0.08, 0.03, 0.1, 1.15, y + 0.158, 0);                                  // feed cover latch
    k.box(P.black, 0.05, 0.22, 0.2, 0.77, y, 0, 0, 0, 0, 0.01);                          // back plate
    k.box(P.steel, 0.03, 0.05, 0.05, 0.86, y + 0.16, 0, 0, 0, -0.35);                    // rear sight leaf
    k.box(P.steel, 0.05, 0.02, 0.05, 0.9, y + 0.145, 0);
    for (const s of [-1, 1]) k.rod(P.black, [0.79, y + 0.05, s * 0.08], [0.74, y + 0.19, s * 0.085], 0.017, 5);       // spade grips
    k.box(P.black, 0.04, 0.02, 0.12, 0.74, y + 0.19, 0);                                  // thumb trigger bar
    k.box(P.black, 0.05, 0.13, 0.04, 0.88, y - 0.15, 0, 0, 0, 0.35);                      // pistol grip and trigger
    k.rod(P.steel, [0.95, y + 0.04, 0.075], [0.95, y + 0.05, 0.16], 0.013, 5);            // bolt handle stub on the right
    k.cyl(P.steel, 0.022, 0.022, 0.03, 6, 0.95, y + 0.05, 0.16, 'y');
    // perforated cooling jacket with bearing collars
    k.cyl(mix(P.steel, P.black, 0.35), 0.054, 0.054, 0.41, 10, 1.21, y, 0, 'x');
    perforate(k, P.hole, { x0: 1.27, x1: 1.57, n: 6, angles: [-72, -36, 0, 36, 72], r: 0.0525, y, across: 0.02, along: 0.026 });
    k.cyl(P.black, 0.062, 0.062, 0.03, 10, 1.2, y, 0, 'x');
    k.cyl(P.black, 0.06, 0.06, 0.03, 10, 1.6, y, 0, 'x');
    k.cyl(P.owner, 0.058, 0.058, 0.035, 8, 1.35, y, 0, 'x');                              // the owner's band
    k.cyl(P.black, 0.066, 0.046, 0.09, 8, 1.63, y, 0, 'x');                               // flash hider, ends at 1.72
    k.box(P.black, 0.02, 0.05, 0.02, 1.56, y + 0.075, 0);                                 // front sight
    // M2 tripod
    k.cyl(P.black, 0.055, 0.05, 0.14, 8, 1.0, 0.27, 0);
    k.box(P.black, 0.22, 0.07, 0.15, 1.0, 0.315, 0, 0, 0, 0, 0.012);
    const head = [1.0, 0.3, 0], front = [1.58, 0.045, 0], rear = [0.45, 0.045, 0.54];
    k.rod(leg, head, front, 0.031, 6); foot(k, P, front[0], 0);
    for (const s of [-1, 1]) {
      k.rod(leg, [0.97, 0.3, s * 0.05], [rear[0], rear[1], s * rear[2]], 0.031, 6);
      foot(k, P, rear[0], s * rear[2]);
    }
    k.rod(P.steel, [0.82, 0.17, 0], [0.95, 0.34, 0], 0.017, 5);                           // elevating screw
    k.cyl(P.steel, 0.045, 0.045, 0.02, 8, 0.8, 0.15, 0, 'z');
    ammoBox(k, P, 0, 0.6, -0.46, -0.25);
    belt(k, P, [[0.6, 0.26, -0.46], [0.66, 0.36, -0.36], [0.82, 0.4, -0.2], [0.96, y - 0.02, -0.085]]);
  } else if (fac === 1) {
    // MG 42 on the Lafette 34: one dark gun, a slotted jacket, a short muzzle booster, a black stock, an olive tripod
    const tri = new THREE.Color(0x77804f), pad = shade(P.black, 0.7);
    k.box(P.black, 0.5, 0.13, 0.13, 0.88, y - 0.01, 0, 0, 0, 0, 0.012);                  // receiver
    k.box(P.steel, 0.22, 0.05, 0.14, 0.96, y + 0.085, 0, 0, 0, 0, 0.01);                  // feed cover
    k.box(P.black, 0.22, 0.11, 0.08, 0.55, y - 0.03, 0, 0, 0, 0.1, 0.012);               // black stock
    k.box(P.black, 0.055, 0.12, 0.05, 0.9, y - 0.12, 0, 0, 0, -0.35);                    // pistol grip
    k.box(P.black, 0.03, 0.05, 0.03, 0.74, y + 0.08, 0);                                  // rear sight
    k.cyl(P.black, 0.042, 0.042, 0.41, 10, 1.13, y, 0, 'x');                              // slotted jacket
    perforate(k, P.hole, { x0: 1.2, x1: 1.5, n: 4, angles: [-72, 0, 72], r: 0.0405, y, across: 0.026, along: 0.05 });
    k.cyl(P.owner, 0.046, 0.046, 0.035, 8, 1.3, y, 0, 'x');                               // the owner's band
    k.cyl(P.black, 0.048, 0.048, 0.075, 8, 1.545, y, 0, 'x');                            // muzzle booster
    k.cyl(P.black, 0.036, 0.02, 0.1, 8, 1.62, y, 0, 'x');                                 // its cone tip, ends at 1.72
    k.box(P.black, 0.02, 0.04, 0.02, 1.5, y + 0.06, 0);
    // Lafette 34: a cradle with a sprung recoil buffer, tubular legs, padded rear legs
    k.cyl(tri, 0.055, 0.055, 0.12, 8, 0.96, 0.25, 0);
    k.box(tri, 0.24, 0.07, 0.19, 0.95, 0.335, 0, 0, 0, 0, 0.012);
    k.cyl(P.steel, 0.03, 0.03, 0.28, 6, 0.83, 0.39, 0, 'x');
    const head = [0.96, 0.27, 0], front = [1.55, 0.045, 0], rear = [0.46, 0.045, 0.54];
    k.rod(tri, head, front, 0.031, 6); foot(k, P, front[0], 0);
    for (const s of [-1, 1]) {
      const a = [0.92, 0.27, s * 0.05], b = [rear[0], rear[1], s * rear[2]];
      k.rod(tri, a, b, 0.031, 6); foot(k, P, rear[0], s * rear[2]);
      k.rod(pad, [a[0] + (b[0] - a[0]) * 0.12, a[1] + (b[1] - a[1]) * 0.12, a[2] + (b[2] - a[2]) * 0.12], [a[0] + (b[0] - a[0]) * 0.4, a[1] + (b[1] - a[1]) * 0.4, a[2] + (b[2] - a[2]) * 0.4], 0.045, 6);
    }
    k.rod(tri, [0.66, 0.16, -0.35], [0.66, 0.16, 0.35], 0.02, 5);
    // the spare barrel in its case lies on the ground, with end caps and a carry handle
    k.rod(P.black, [0.1, 0.045, 0.78], [0.62, 0.045, 0.7], 0.04, 6);
    for (const [x, z, w] of [[0.1, 0.78, 0], [0.62, 0.7, 1]]) k.rod(P.steel, [x - w * 0.03, 0.045, z], [x + (w ? 0.03 : 0.03), 0.045, z + (w ? 0 : 0)], 0.044, 6, false);
    k.rod(P.steel, [0.3, 0.083, 0.745], [0.46, 0.083, 0.725], 0.012, 4, false);
    ammoBox(k, P, 1, 0.6, -0.44, -0.25);
    ammoBox(k, P, 1, 1.0, 0.56, 0.2);
    belt(k, P, [[0.6, 0.3, -0.44], [0.68, 0.4, -0.34], [0.84, 0.44, -0.2], [0.98, y + 0.05, -0.07]]);
  } else {
    // Maxim on the Sokolov mount: fluted water jacket, spade grips, one shield plate, two small spoked wheels, a single trail
    k.box(P.black, 0.4, 0.21, 0.15, 0.82, y, 0, 0, 0, 0, 0.014);                          // receiver
    k.box(P.steel, 0.2, 0.04, 0.12, 0.8, y + 0.125, 0, 0, 0, 0, 0.01);                    // top cover
    k.box(P.black, 0.035, 0.14, 0.22, 0.61, y, 0, 0, 0, 0, 0.008);                         // back plate
    for (const s of [-1, 1]) k.rod(P.black, [0.62, y + 0.02, s * 0.1], [0.58, y + 0.15, s * 0.11], 0.017, 5);   // spade grips
    k.box(P.steel, 0.045, 0.014, 0.2, 0.58, y + 0.15, 0);                                  // thumb trigger bar
    k.add(flutedJacket(1.06, y, 0.56, 0.092, 0.078, 10), P.paint);
    k.cyl(P.dark, 0.04, 0.04, 0.04, 8, 1.3, y + 0.088, 0);                                // filler cap
    k.cyl(P.steel, 0.025, 0.025, 0.02, 6, 1.3, y + 0.128, 0);
    k.cyl(P.black, 0.05, 0.038, 0.1, 8, 1.62, y, 0, 'x');                                 // muzzle booster, ends at 1.72
    k.rod(P.black, [1.52, y + 0.07, 0.05], [1.0, y + 0.19, 0.02], 0.014, 4, false);       // steam hose
    // Sokolov carriage
    const wr = 0.19, ax = 1.12;
    const wheel = wheelGeo(wr, 0.05, P, { spokes: 8, seg: 12, lugs: 0 });
    for (const s of [-1, 1]) k.add(wheel, 0xffffff, M(ax, wr, s * 0.41));
    k.rod(P.dark, [ax, wr, -0.41], [ax, wr, 0.41], 0.026, 6);
    k.box(P.dark, 0.18, 0.12, 0.2, ax - 0.04, wr + 0.04, 0, 0, 0, 0, 0.012);
    k.rod(P.dark, [ax - 0.12, 0.3, 0], [0.9, y - 0.06, 0], 0.032, 6);
    k.beam(P.dark, [ax - 0.1, wr + 0.02, 0], [-0.32, 0.06, 0], 0.07, 0.08, 0.012);         // the single trail
    k.box(P.dark, 0.12, 0.04, 0.16, -0.34, 0.03, 0, 0, 0, 0, 0.01);
    k.add(G.tube([[-0.34, 0.07, 0.07], [-0.4, 0.08, 0], [-0.34, 0.07, -0.07], [-0.28, 0.07, 0]].concat([[-0.34, 0.07, 0.07]]), 0.012, { segments: 8, radial: 4, caps: false, closed: false }), P.dark); // the handle loop
    // the shield: one plate, clipped corners, a sight window and a low barrel hole, at the front of the receiver
    const lean = 0.12, sh = [[-0.29, 0], [0.29, 0], [0.29, 0.43], [0.2, 0.55], [-0.2, 0.55], [-0.29, 0.43]];
    const frame = k.panel(P.paint, sh, 0.03, 1.1, 0.13, 0, lean, 0, [circle(0.095, 10).map(([u, v]) => [u, v + 0.32]), [[-0.045, 0.44], [0.045, 0.44], [0.045, 0.52], [-0.045, 0.52]]]);
    k.add(G.star(0.055, { color: P.red }), 0xffffff, onPlate(frame, -0.2, 0.2, 0.0315));
    k.add(new THREE.BoxGeometry(0.036, 0.03, 0.34), P.owner, M(1.1, 0.13, 0).rz(lean).t(-0.012, 0.545, 0));                          // the owner's band on the top edge
    ammoBox(k, P, 2, 0.5, 0.42, 0.25);
    belt(k, P, [[0.5, 0.25, 0.42], [0.56, 0.34, 0.32], [0.72, 0.38, 0.2], [0.84, y - 0.02, 0.075]]);
  }
  return finish(k.geometry(), { span: 0.3 });
}

// ---------------------------------------------------------------- mortars

// a mortar bomb along +x from its tail fins: a teardrop body with a crossed fin tail
function bombParts(len, r) {
  const body = G.lathe([[0, 0], [r * 0.28, 0], [r * 0.28, len * 0.2], [r * 0.85, len * 0.42], [r, len * 0.58], [r * 0.78, len * 0.85], [0, len]], 6, { axis: 'x' });
  return { body, fin: new THREE.BoxGeometry(len * 0.24, r * 1.9, 0.004) };
}
function bomb(k, bp, bodyColor, finColor, m) {
  k.add(bp.body, bodyColor, m);
  const m2 = mat(m).clone();
  k.add(bp.fin, finColor, m2.clone().multiply(new THREE.Matrix4().makeTranslation(bp.len * 0.1, 0, 0)));
  k.add(bp.fin, finColor, m2.clone().multiply(new THREE.Matrix4().makeTranslation(bp.len * 0.1, 0, 0)).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
}

// +x forward. The tube leans toward +x and its top is at (1.05, 0.87, 0), where client/fx.js launches the shell.
function mortarGun(fac, P) {
  const k = kit(), top = [1.05, 0.87], L = 0.9, by = 0.075;
  const tilt = Math.acos((top[1] - by) / L), bx = top[0] - L * Math.sin(tilt);
  const metal = fac === 1 ? P.tan : fac === 0 ? mix(P.paint, 0xffffff, 0.04) : P.paint;
  const darkMetal = shade(metal, 0.66), lightMetal = mix(metal, 0xffffff, 0.2);
  // baseplates: M1 round and perforated; GrW 34 square with diagonal ribs and a raised ball socket; 82-PM-37 round with radial ribs
  if (fac === 0) {
    const holes = [0, 1, 2].map((i) => circle(0.06, 6).map(([x, y]) => [x + 0.22 * Math.cos(i * TAU / 3 + 0.5), y + 0.22 * Math.sin(i * TAU / 3 + 0.5)]));
    k.add(lightEdges(G.extrudeProfile(circle(0.39, 12), 0.04, 0.008, { holes, segments: 1 }), 1.18, 0.12), metal, M(bx, 0.02, 0).rx(-Math.PI / 2));
    flatRing(k, P.owner, 0.3, 0.37, 12, bx, 0.0425, 0);
    k.turn(darkMetal, [[0, 0], [0.13, 0], [0.13, 0.035], [0.08, 0.07], [0, 0.075]], 10, bx, 0.04, 0);
  } else if (fac === 1) {
    const s = 0.64;
    k.box(metal, s, 0.04, s, bx, 0.02, 0, 0, 0, 0, 0.012);
    for (const a of [Math.PI / 4, -Math.PI / 4]) k.box(darkMetal, s * 1.3, 0.035, 0.05, bx, 0.05, 0, 0, a, 0);
    for (const sg of [-1, 1]) { k.box(darkMetal, s, 0.035, 0.035, bx, 0.045, sg * (s / 2 - 0.0175)); k.box(darkMetal, 0.035, 0.035, s, bx + sg * (s / 2 - 0.0175), 0.045, 0); }
    k.box(P.owner, 0.05, 0.012, 0.5, bx - s / 2 + 0.05, 0.0475, 0);                          // the owner's band along the rear edge
    k.turn(lightMetal, [[0, 0], [0.19, 0], [0.19, 0.04], [0.13, 0.075], [0.12, 0.12], [0.07, 0.15], [0, 0.15]], 10, bx, 0.04, 0);
  } else {
    k.add(lightEdges(G.extrudeProfile(circle(0.41, 12), 0.04, 0.008, { segments: 1 }), 1.18, 0.12), metal, M(bx, 0.02, 0).rx(-Math.PI / 2));
    for (let i = 0; i < 6; i++) k.box(darkMetal, 0.4, 0.03, 0.045, bx + Math.cos(i * Math.PI / 3 + 0.3) * 0.2, 0.05, Math.sin(i * Math.PI / 3 + 0.3) * 0.2, 0, -(i * Math.PI / 3 + 0.3), 0);
    flatRing(k, P.owner, 0.32, 0.39, 12, bx, 0.0425, 0);
    k.turn(darkMetal, [[0, 0], [0.12, 0], [0.12, 0.045], [0.08, 0.08], [0, 0.085]], 10, bx, 0.04, 0);
  }
  // tube: closed breech ball, thickened collar near the top, dark bore
  const r = fac === 2 ? 0.062 : 0.056, base = M(bx, by, 0).rz(-tilt);
  k.add(G.lathe([[0, 0], [r * 1.4, 0], [r * 1.4, 0.07], [r, 0.12], [r, L - 0.06], [r * 1.15, L - 0.06], [r * 1.15, L], [r * 0.7, L], [r * 0.7, L - 0.14], [0, L - 0.14]], 10, { axis: 'y' }), metal, base);
  k.add(G.lathe([[0, 0], [r * 1.14, 0], [r * 1.14, 0.045], [0, 0.045]], 8, { axis: 'y' }), P.owner, base.m.clone().multiply(new THREE.Matrix4().makeTranslation(0, L * 0.74, 0)));   // the owner's band
  const onTube = (s, z, y = 0) => base.m.clone().multiply(new THREE.Matrix4().makeTranslation(y, L * s, z));
  // bipod: a clamp collar on the tube, a yoke, two telescoping legs with shock absorbers, a traverse wheel and the sight
  const along = (s) => [bx + Math.sin(tilt) * s, by + Math.cos(tilt) * s];
  const [cx, cy] = along(L * 0.58);
  k.add(G.lathe([[r * 1.04, 0], [r * 1.55, 0], [r * 1.55, 0.08], [r * 1.04, 0.08]], 10, { axis: 'y' }), darkMetal, M(cx, cy - 0.04, 0).rz(-tilt));
  k.rod(darkMetal, [cx, cy, -0.12], [cx, cy, 0.12], 0.03, 6);
  const fx = cx + 0.2, fz = 0.32;
  for (const s of [-1, 1]) {
    const hip = [cx + 0.02, cy - 0.02, s * 0.11], toe = [fx, 0.07, s * fz], mid = hip.map((v, i) => v + (toe[i] - v) * 0.5);
    k.rod(metal, hip, mid, 0.03, 6, false); k.rod(darkMetal, mid, toe, 0.022, 6);
    k.cyl(darkMetal, 0.012, 0.045, 0.075, 6, fx, 0.0, s * fz);
    // the shock absorber: a short cylinder from the yoke to the leg
    k.rod(P.steel, [cx + 0.03, cy + 0.07, s * 0.12], mid.map((v, i) => (i === 1 ? v + 0.02 : v)), 0.02, 5);
    if (fac === 2) {
      // the 82-PM-37's recoil springs: coils around the absorber
      for (let c = 0; c < 4; c++) { const u = 0.15 + c * 0.2; k.rod(P.steel, [cx + 0.03 + (mid[0] - cx - 0.03) * u, cy + 0.07 + (mid[1] + 0.02 - cy - 0.07) * u, s * (0.12 + (Math.abs(mid[2]) - 0.12) * u)], [cx + 0.03 + (mid[0] - cx - 0.03) * (u + 0.07), cy + 0.07 + (mid[1] + 0.02 - cy - 0.07) * (u + 0.07), s * (0.12 + (Math.abs(mid[2]) - 0.12) * (u + 0.07))], 0.034, 6, false); }
    }
  }
  k.rod(darkMetal, [cx + 0.02, cy - 0.06, 0], [bx + 0.3, 0.1, 0], 0.017, 5);                  // the elevating screw
  k.cyl(P.steel, 0.055, 0.055, 0.025, 8, cx + 0.02, cy - 0.06, 0.14, 'z');                    // the traverse handwheel on its crank
  k.rod(darkMetal, [cx + 0.02, cy - 0.06, 0.08], [cx + 0.02, cy - 0.06, 0.14], 0.012, 4, false);
  // the sight on the left of the yoke: a bracket, the collimator block and a short telescope
  k.add(new THREE.BoxGeometry(0.05, 0.1, 0.05), P.black, onTube(0.58, -0.1, 0.02));
  k.add(softBox(0.09, 0.12, 0.07, 0.012), P.steel, onTube(0.58, -0.12, 0.1));
  k.add(G.lathe([[0, 0], [0.026, 0], [0.026, 0.17], [0.034, 0.17], [0.034, 0.2], [0, 0.2]], 8, { axis: 'y' }), P.black, onTube(0.58, -0.12, 0.15));
  k.add(G.lathe([[0, 0], [0.018, 0], [0.018, 0.06], [0, 0.06]], 6, { axis: 'z' }), P.steel, onTube(0.58, -0.12, 0.1).multiply(new THREE.Matrix4().makeTranslation(0, 0.02, -0.035)));
  // ammunition: an open crate of bombs lying flat, and a bundle of fibre tubes
  const woodC = fac === 0 ? shade(P.paint, 0.8) : P.wood, bodyC = fac === 0 ? P.paint : fac === 1 ? P.black : mix(P.paint, P.steel, 0.3);
  const bp = bombParts(0.3, 0.034); bp.len = 0.3;
  {
    const x = 0.08, z = 0.52, rot = 0.15, w = 0.42, h = 0.15, d = 0.3;
    k.add(softBox(w, h, d, 0.012), woodC, M(x, h / 2, z).ry(rot));
    k.flat(P.hole, w - 0.05, d - 0.05, x, h + 0.0015, z, rot);
    k.add(new THREE.BoxGeometry(w * 0.9, 0.012, 0.03), P.owner, M(x, h + 0.003, z).ry(rot).t(0, 0, d / 2 - 0.013));   // the owner's band on the rim
    for (let i = 0; i < 4; i++) bomb(k, bp, bodyC, shade(bodyC, 0.7), M(x, h + 0.034, z).ry(rot).t(-0.15, 0, -0.105 + i * 0.07));
  }
  {
    const x = 0.1, z = -0.52, rot = -0.2;
    for (const dz of [-0.06, 0.06]) k.rod(mix(P.tan, P.paint, 0.55), [x - 0.2, 0.05, z + dz], [x + 0.2, 0.05, z + dz], 0.05, 6);
    k.rod(shade(P.paint, 0.7), [x - 0.1, 0.1, z - 0.05], [x - 0.1, 0.1, z + 0.05], 0.045, 5, false);
    k.rod(P.owner, [x + 0.08, 0.12, z - 0.04], [x + 0.08, 0.12, z + 0.04], 0.028, 5, false);
  }
  return finish(k.geometry(), { span: 0.4 });
}

// ---------------------------------------------------------------- anti-tank guns

const AT = [
  // 57 mm M1: wide stepped V shield, box trails, rubber tires on pressed discs
  { barrel: 3.0, yb: 0.95, R: 0.43, w: 0.2, track: 0.86, lean: 14, trail: 2.1, spread: 28, pivot: 0.55 },
  // PaK 40: low wide shield with bent wings and an apron, tapered box trails
  { barrel: 3.2, yb: 0.95, R: 0.42, w: 0.2, track: 0.84, lean: 16, trail: 2.3, spread: 26, pivot: 0.55 },
  // 45 mm 53-K: short barrel, stepped V shield with flanges, spoked wheels
  { barrel: 2.35, yb: 0.9, R: 0.46, w: 0.18, track: 0.8, lean: 10, trail: 2.0, spread: 28, pivot: 0.5 },
];

function atGun(fac, P) {
  const S = AT[fac], k = kit(), yb = S.yb, R = S.R, x0 = -0.42, L = S.barrel;
  // wheels and axle
  const wheel = wheelGeo(R, S.w, P, { spokes: fac === 2 ? 8 : 0, seg: 14, lugs: 12, bolts: 5 });
  for (const s of [-1, 1]) k.add(wheel, 0xffffff, M(0, R, s * S.track).ry(s > 0 ? 0 : Math.PI));
  k.rod(P.dark, [0, R, -S.track], [0, R, S.track], 0.05, 6);
  k.box(P.dark, 0.2, 0.18, 0.42, 0, R + 0.02, 0);
  // carriage body, cradle, breech and the gunner's wheel
  k.box(P.paint, 0.4, 0.18, 0.5, 0.0, 0.56, 0);
  k.box(P.dark, 0.3, 0.2, 0.3, 0.0, 0.74, 0);
  for (const s of [-1, 1]) k.box(P.paint, 0.4, 0.34, 0.05, 0.0, yb - 0.08, s * 0.15, 0, 0, 0, 0.012);
  k.box(P.paint, 0.95, 0.08, 0.3, 0.1, yb - 0.16, 0);                                              // the cradle trough
  k.cyl(P.steel, 0.105, 0.105, 0.9, 8, 0.0, yb, 0, 'x');                                          // the sleeve over the barrel
  k.cyl(P.dark, 0.118, 0.118, 0.06, 8, 0.8, yb, 0, 'x');
  for (const s of [-1, 1]) k.cyl(P.steel, 0.05, 0.05, 0.9, 6, -0.05, yb - 0.17, s * 0.12, 'x');       // recoil cylinders
  k.cyl(P.steel, 0.065, 0.065, 0.75, 6, 0.0, yb - 0.2, 0, 'x');                                    // the recuperator
  k.box(P.black, 0.42, 0.3, 0.26, x0 + 0.14, yb + 0.02, 0, 0, 0, 0, 0.015);                         // breech block
  k.box(P.dark, 0.16, 0.14, 0.18, x0 + 0.14, yb + 0.22, 0);                                         // the breech wedge
  k.box(P.steel, 0.14, 0.18, 0.2, x0 - 0.1, yb + 0.02, 0);
  k.box(P.black, 0.2, 0.12, 0.14, x0 + 0.1, yb - 0.2, -0.17);                                       // the elevating gear case
  k.rod(P.steel, [x0 + 0.05, yb + 0.06, -0.13], [x0 - 0.06, yb + 0.16, -0.22], 0.014, 4);            // breech lever
  k.cyl(P.steel, 0.026, 0.026, 0.03, 6, x0 - 0.06, yb + 0.16, -0.22, 'y');
  k.cyl(P.steel, 0.115, 0.115, 0.04, 10, -0.12, 0.82, -0.2, 'z');                                  // elevating handwheel with a hub and a crank
  k.cyl(P.dark, 0.035, 0.035, 0.07, 6, -0.12, 0.82, -0.215, 'z');
  k.rod(P.steel, [-0.12, 0.82, -0.2], [-0.12, 0.9, -0.24], 0.018, 4);
  k.rod(P.black, [-0.1, yb + 0.24, -0.12], [0.3, yb + 0.26, -0.12], 0.026, 6);                       // sight telescope
  k.box(P.black, 0.07, 0.07, 0.06, x0 + 0.02, yb + 0.24, -0.12);
  // barrel: heavy at the breech and stepping down along its length, then the muzzle device
  const muzzleBox = fac === 1, plain = fac === 2, bl = muzzleBox ? 0.34 : plain ? 0 : 0.2;
  const rb = [0.085, 0.07, 0.062][fac], rm = [0.047, 0.05, 0.04][fac];
  k.add(G.lathe([[0, 0], [rb * 1.05, 0], [rb * 1.05, 0.4], [rb * 0.82, 0.55], [rb * 0.78, 1.1], [rm * 1.1, 1.3], [rm, 1.6], [rm, L - bl - 0.05], [rm * (plain ? 1.45 : 1.15), L - bl - 0.05], [rm * (plain ? 1.45 : 1.15), L - bl], ...(plain ? [[rm * 0.55, L], [rm * 0.55, L - 0.05], [0, L - 0.05]] : [[rm * 1.0, L - bl], [rm * 0.7, L - bl], [0, L - bl]])], 8, { axis: 'x' }), P.black, M(x0, yb, 0));
  const bx = x0 + L - bl;
  if (fac === 0) {
    // a short slotted brake with its slots painted dark
    k.cyl(P.black, 0.07, 0.07, bl, 8, bx, yb, 0, 'x');
    k.cyl(P.steel, 0.075, 0.075, 0.025, 8, bx + bl - 0.025, yb, 0, 'x');
    for (const a of [0, 180]) k.decal(P.hole, 0.05, 0.08, [bx + 0.1, yb + 0.07 * Math.cos(a * RAD), 0.0], [0, Math.cos(a * RAD), 0], [1, 0, 0]);
    for (const s of [-1, 1]) k.decal(P.hole, 0.05, 0.08, [bx + 0.1, yb, s * 0.071], [0, 0, s], [1, 0, 0]);
    k.add(G.lathe([[0, 0], [0.04, 0], [0.04, 0.02], [0, 0.02]], 6, { axis: 'x' }), P.hole, M(x0 + L - 0.001, yb, 0));
  } else if (fac === 1) {
    // the double-baffle box brake with dark side openings
    k.box(P.black, bl, 0.19, 0.2, bx + bl / 2, yb, 0, 0, 0, 0, 0.02);
    for (const s of [-1, 1]) for (const dx of [0.11, 0.24]) k.decal(P.hole, 0.07, 0.1, [bx + dx, yb, s * 0.1015], [0, 0, s], [1, 0, 0]);
    k.decal(P.hole, 0.24, 0.07, [bx + bl / 2, yb + 0.0965, 0], [0, 1, 0], [1, 0, 0]);
    k.box(P.steel, 0.02, 0.2, 0.22, bx + bl - 0.01, yb, 0);
  }
  // trails: split, spread, tapering box beams with clamps, arrow spades and handles
  const a = S.spread * RAD;
  for (const s of [-1, 1]) {
    const hinge = [-0.05, 0.55, s * 0.14], end = [-0.05 - S.trail * Math.cos(a), 0.1, s * (0.14 + S.trail * Math.sin(a))];
    k.taper(P.paint, hinge, end, 0.13, 0.19, 0.09, 0.11);
    k.box(P.dark, 0.14, 0.13, 0.08, hinge[0], 0.55, s * 0.14);
    for (const u of [0.35, 0.7]) {
      const p = hinge.map((v, i) => v + (end[i] - v) * u), w = 0.13 + (0.09 - 0.13) * u + 0.02;
      k.add(new THREE.BoxGeometry(0.045, 0.19 + (0.11 - 0.19) * u + 0.025, w), P.dark, M(p[0], p[1], p[2]).ry(Math.atan2(-(end[2] - hinge[2]), end[0] - hinge[0])).rz(Math.atan2(end[1] - hinge[1], Math.hypot(end[0] - hinge[0], end[2] - hinge[2]))));
    }
    spade(k, P, end, [-Math.cos(a), s * Math.sin(a)]);
  }
  shield(k, P, S, fac);
  return { geo: finish(k.geometry(), { span: 0.55 }), pivot: [S.pivot, 0, 0], tip: [x0 + L, yb, 0] };
}

// the shield: US two plates in a shallow forward V, German centre plate with bent wings and a low apron, Soviet stepped V with flanges
function shield(k, P, S, fac) {
  const lean = S.lean * RAD, t = 0.028, paint = P.paint, xs = 0.4;
  const mirror = (pts) => pts.map(([u, v]) => [-u, v]);
  const topBand = (frame, u, v, w) => plateBand(k, P.owner, frame, u, v, w);
  if (fac === 0) {
    const y0 = 0.42, yaw = 8 * RAD;
    const half = [[0, 0], [0.4, 0], [0.4, 0.46], [0.7, 0.46], [0.7, 0.84], [0.58, 0.96], [0, 0.96], [0, 0.7], [0.13, 0.7], [0.13, 0.26], [0, 0.26]];
    const right = k.panel(paint, half, t, xs, y0, 0, lean, -yaw);
    const left = k.panel(paint, mirror(half), t, xs, y0, 0, lean, yaw, [[[-0.36, 0.64], [-0.5, 0.64], [-0.5, 0.78], [-0.36, 0.78]]]);
    topBand(right, 0.34, 0.96, 0.52); topBand(left, -0.34, 0.96, 0.52);
    k.add(G.star(0.12, { color: P.white, disc: 0x2a3d6a }), 0xffffff, onPlate(right, 0.52, 0.62, t / 2 + 0.012));
  } else if (fac === 1) {
    const y0 = 0.3, wing = 25 * RAD;
    const centre = [[-0.34, 0], [0.34, 0], [0.34, 0.76], [0.26, 0.9], [-0.26, 0.9], [-0.34, 0.76]];
    const fr = k.panel(paint, centre, t, xs, y0, 0, lean, 0, [[[-0.12, 0.46], [0.12, 0.46], [0.12, 0.8], [-0.12, 0.8]]]);
    const wingPts = [[0, 0.06], [0.32, 0.16], [0.32, 0.7], [0.18, 0.84], [0, 0.84]];
    const wr = k.panel(paint, wingPts, t, xs - 0.0, y0, 0.34, lean, -wing);
    const wl = k.panel(paint, mirror(wingPts), t, xs, y0, -0.34, lean, wing, [[[-0.18, 0.5], [-0.28, 0.5], [-0.28, 0.6], [-0.18, 0.6]]]);
    topBand(fr, 0, 0.9, 0.4); topBand(wr, 0.16, 0.84, 0.2); topBand(wl, -0.16, 0.84, 0.2);
    k.add(G.balkenkreuz(0.085, { color: 0x1c1b18, border: P.white }), 0xffffff, onPlate(fr, -0.23, 0.26, t / 2 + 0.012));
  } else {
    const y0 = 0.44, yaw = 6 * RAD;
    const half = [[0, 0], [0.4, 0], [0.4, 0.28], [0.54, 0.28], [0.54, 0.64], [0.34, 0.64], [0.34, 0.78], [0, 0.78], [0, 0.64], [0.11, 0.64], [0.11, 0.26], [0, 0.26]];
    const right = k.panel(paint, half, t, xs, y0, 0, lean, -yaw);
    const left = k.panel(paint, mirror(half), t, xs, y0, 0, lean, yaw, [[[-0.2, 0.42], [-0.32, 0.42], [-0.32, 0.54], [-0.2, 0.54]]]);
    const fl = [[0, 0.28], [0.12, 0.3], [0.12, 0.6], [0, 0.64]];
    k.panel(paint, fl, t, xs - 0.0, y0, 0.54, lean, -yaw - 45 * RAD);
    k.panel(paint, mirror(fl), t, xs, y0, -0.54, lean, yaw + 45 * RAD);
    topBand(right, 0.17, 0.78, 0.34); topBand(left, -0.27, 0.64, 0.5);
    k.add(G.star(0.1, { color: P.red, border: 0xece6d6, edge: 0.1 }), 0xffffff, onPlate(right, 0.3, 0.14, t / 2 + 0.012));
  }
}

// ---------------------------------------------------------------- anti-aircraft guns

// the shared turntable: a wide low disc sitting right on the platform, and the hub under the platform
function turntable(k, P, r, y0, h = 0.14) {
  k.turn(P.dark, [[0, y0], [r, y0], [r, y0 + h * 0.7], [r * 0.92, y0 + h], [0, y0 + h]], 12, 0, 0, 0);
  k.cyl(P.dark, r * 0.38, r * 0.45, y0 - 0.1, 8, 0, 0.08, 0);
}

// a platform arm from the hub to a jack
function outrigger(k, P, ang, len, wide = 0.16) {
  const tx = Math.cos(ang) * len, tz = Math.sin(ang) * len;
  k.taper(P.paint, [0, 0.3, 0], [tx, 0.25, tz], wide * 1.45, 0.17, wide * 0.9, 0.14);
  jack(k, P, tx, tz);
}

function seat(k, P, x, z, back = -1, y = 0.6) {
  k.rod(P.dark, [x, y - 0.2, z], [x, y, z], 0.022, 5, false);
  k.box(P.wood, 0.22, 0.04, 0.2, x, y + 0.02, z);
  k.box(P.wood, 0.04, 0.16, 0.2, x + back * 0.1, y + 0.12, z, 0, 0, -back * 0.2);
}

function handwheel(k, P, x, y, z, r = 0.12) {
  k.cyl(P.steel, r, r, 0.03, 8, x, y, z, 'z');
  k.cyl(P.dark, r * 0.35, r * 0.35, 0.06, 5, x, y, z - 0.015, 'z');
}

// a barrel along +x from its breech (x = 0): heavy at the breech, a muzzle device of the given kind
function aaBarrel(g, P, L, rb, rm, kind) {
  const prof = [[0, 0], [rb, 0], [rb, 0.35], [rm * 1.05, 0.6], [rm, L - 0.2]];
  if (kind === 'hider') prof.push([rm * 1.5, L - 0.2], [rm * 1.5, L], [rm * 0.8, L], [rm * 0.8, L - 0.05], [0, L - 0.05]);
  else if (kind === 'brake') prof.push([rm * 1.7, L - 0.2], [rm * 1.7, L - 0.12], [rm * 1.2, L - 0.1], [rm * 1.2, L - 0.07], [rm * 1.7, L - 0.05], [rm * 1.7, L], [rm * 0.8, L], [rm * 0.8, L - 0.05], [0, L - 0.05]);
  else prof.push([rm * 1.4, L - 0.1], [rm * 1.4, L], [rm * 0.8, L], [rm * 0.8, L - 0.05], [0, L - 0.05]);
  g.add(G.lathe(prof, 8, { axis: 'x' }), P.black);
}

// a vertical stack of n rounds standing in a clip above the breech (rounds along +x), between two guide plates
function clip(g, P, x, y, n, len, r) {
  for (let i = 0; i < n; i++) round(g, P, x, y + i * r * 2.15, 0, len, r);
  for (const s of [-1, 1]) g.box(P.steel, len * 0.9, n * r * 2.15 + 0.03, 0.012, x + len * 0.45, y + (n - 1) * r * 1.07, s * (r + 0.012));
}

// the elevating gun group in its own frame: breech at x = 0, barrel along +x. Returns the muzzle x.
function aaGun(P, fac) {
  const g = kit();
  if (fac === 0) {
    // Bofors: long barrel with a flash hider, recoil sleeve, cradle plates, a four-round clip standing in the feed
    g.add(G.lathe([[0, 0], [0.07, 0], [0.07, 0.35], [0.052, 0.6], [0.048, 1.58], [0.064, 1.58], [0.064, 1.9], [0.036, 1.9], [0.036, 1.84], [0, 1.84]], 8, { axis: 'x' }), P.black, M(-0.12, 0, 0));
    g.cyl(P.steel, 0.095, 0.095, 0.6, 8, 0.0, 0, 0, 'x');
    for (const s of [-1, 1]) g.cyl(P.steel, 0.04, 0.04, 0.7, 6, 0.0, -0.14, s * 0.11, 'x');
    g.box(P.black, 0.36, 0.22, 0.24, -0.2, 0, 0, 0, 0, 0, 0.015);
    for (const s of [-1, 1]) g.box(P.paint, 0.46, 0.32, 0.05, -0.05, -0.04, s * 0.155, 0, 0, 0, 0.012);
    g.box(P.steel, 0.2, 0.1, 0.17, -0.15, 0.17, 0, 0, 0, 0, 0.01);                          // the feed tray
    clip(g, P, -0.3, 0.255, 4, 0.3, 0.026);
    return { g, muzzle: 1.78 };
  }
  if (fac === 1) {
    // 2 cm Flak 38: bulky receiver, flash hider, a big curved box magazine on the left of the receiver
    aaBarrel(g, P, 1.7, 0.058, 0.038, 'hider');
    g.cyl(P.steel, 0.066, 0.066, 0.5, 8, 0.0, 0, 0, 'x');
    g.box(P.black, 0.5, 0.24, 0.22, -0.22, 0, 0, 0, 0, 0, 0.014);
    g.box(P.steel, 0.2, 0.05, 0.16, -0.18, 0.145, 0, 0, 0, 0, 0.01);
    // the 20-round magazine: three boxes bent into an arc, brass showing at the top, mounted on the receiver's left
    for (let i = 0; i < 3; i++) g.box(P.steel, 0.22, 0.17, 0.15, -0.12 - i * 0.03, 0.17 + i * 0.16, -0.21, 0, 0, i * 0.1 - 0.05, i === 0 ? 0.012 : 0);
    g.box(P.brass, 0.16, 0.03, 0.1, -0.16, 0.57, -0.21, 0, 0, 0.05);
    g.box(P.dark, 0.05, 0.4, 0.16, -0.2, 0.34, -0.21, 0, 0, 0.05);
    for (const s of [-1, 1]) g.box(P.paint, 0.32, 0.22, 0.04, -0.06, -0.04, s * 0.14);
    return { g, muzzle: 1.7 };
  }
  // 37 mm 61-K: long barrel with a slotted brake, a five-round clip on top
  g.add(G.lathe([[0, 0], [0.062, 0], [0.062, 0.35], [0.046, 0.6], [0.04, 1.85], [0.068, 1.85], [0.068, 2.05], [0.034, 2.05], [0.034, 2.0], [0, 2.0]], 8, { axis: 'x' }), P.black, M(-0.1, 0, 0));
  for (const dz of [-1, 1]) for (const bx of [1.78, 1.86]) g.decal(P.hole, 0.04, 0.05, [bx, 0, dz * 0.069], [0, 0, dz], [1, 0, 0]);
  g.cyl(P.steel, 0.078, 0.078, 0.6, 8, 0.0, 0, 0, 'x');
  for (const s of [-1, 1]) g.cyl(P.steel, 0.034, 0.034, 0.7, 6, 0.0, -0.12, s * 0.1, 'x');
  g.box(P.black, 0.38, 0.2, 0.2, -0.2, 0, 0, 0, 0, 0, 0.014);
  g.box(P.steel, 0.2, 0.08, 0.16, -0.15, 0.14, 0);
  clip(g, P, -0.3, 0.2, 5, 0.3, 0.022);
  return { g, muzzle: 1.95 };
}

function flakGun(fac, P) {
  const k = kit();
  let P0, e;
  if (fac === 0) {
    // Bofors: cruciform platform on four jacks, a wide low turntable, cradle housings with seats and ring sights
    P0 = [0.15, 1.04]; e = 32 * RAD;
    for (const a of [42, 138, -42, -138]) outrigger(k, P, a * RAD, 1.28, 0.2);
    turntable(k, P, 0.5, 0.3, 0.12);
    k.box(P.paint, 0.5, 0.36, 0.5, 0.0, 0.6, 0, 0, 0, 0, 0.02);
    for (const s of [-1, 1]) {
      k.box(P.paint, 0.46, 0.42, 0.16, 0.1, 0.96, s * 0.26, 0, 0, 0, 0.015);                  // the cradle housings
      k.add(new THREE.BoxGeometry(0.4, 0.012, 0.1), P.owner, M(0.1, 1.176, s * 0.26));         // the owner's band on top of each
      seat(k, P, -0.12, s * 0.62);
      handwheel(k, P, -0.02, 0.88, s * 0.42, 0.13);
      k.rod(P.dark, [-0.02, 0.88, s * 0.34], [-0.02, 0.88, s * 0.42], 0.016, 5, false);
      k.rod(P.dark, [0.2, 1.17, s * 0.3], [0.3, 1.36, s * 0.62], 0.018, 5, false);              // the sight arm
      ringSight(k, P.black, 0.3, 1.5, s * 0.62, 0.11, 0.12);
    }
    k.add(G.star(0.06, { color: P.white, disc: 0x2a3d6a }), 0xffffff, G.place([0.1 + 0.2325, 0.94, 0.26], [1, 0, 0], [0, 1, 0], 1));
  } else if (fac === 1) {
    // Flak 38: three-legged base on a low turntable, a continuous low front shield with folded wings, a seat and wheels for the gunner
    P0 = [0.05, 1.0]; e = 31 * RAD;
    for (const a of [0, 122, -122]) outrigger(k, P, a * RAD, 1.3, 0.15);
    turntable(k, P, 0.5, 0.3, 0.12);
    k.box(P.paint, 0.4, 0.3, 0.4, 0.0, 0.57, 0, 0, 0, 0, 0.02);
    for (const s of [-1, 1]) k.box(P.paint, 0.34, 0.34, 0.12, 0.04, 0.88, s * 0.18, 0, 0, 0, 0.015);
    seat(k, P, -0.36, -0.32, -1, 0.62);
    handwheel(k, P, -0.05, 0.8, -0.3, 0.13);
    handwheel(k, P, -0.05, 0.8, 0.3, 0.11);
    k.rod(P.dark, [0.02, 1.0, -0.2], [0.12, 1.34, -0.3], 0.016, 5, false);
    ringSight(k, P.black, 0.12, 1.46, -0.3, 0.09, 0.1);
    const lean = 14 * RAD, t = 0.026, xs = 0.36, y0 = 0.62;
    const front = [[-0.46, 0], [0.46, 0], [0.46, 0.5], [0.36, 0.7], [0.08, 0.7], [0.08, 0.44], [-0.08, 0.44], [-0.08, 0.7], [-0.36, 0.7], [-0.46, 0.5]];
    const fr = k.panel(P.paint, front, t, xs, y0, 0, lean, 0);
    const wingPts = [[0, 0], [0.3, 0.03], [0.3, 0.42], [0.14, 0.58], [0, 0.6]];
    const wr = k.panel(P.paint, wingPts, t, xs, y0, 0.46, lean, -35 * RAD);
    const wl = k.panel(P.paint, wingPts.map(([u, v]) => [-u, v]), t, xs, y0, -0.46, lean, 35 * RAD);
    plateBand(k, P.owner, fr, 0.22, 0.7, 0.26); plateBand(k, P.owner, fr, -0.22, 0.7, 0.26);
    plateBand(k, P.owner, wr, 0.15, 0.58, 0.16); plateBand(k, P.owner, wl, -0.15, 0.58, 0.16);
    k.add(G.balkenkreuz(0.085, { color: 0x1c1b18, border: P.white }), 0xffffff, onPlate(fr, -0.27, 0.24, t / 2 + 0.012));
  } else {
    // 61-K: four-wheeled carriage as an open frame, a triangular drawbar, two flared shields
    P0 = [0.1, 1.08]; e = 30 * RAD;
    const wr = 0.36, wheel = wheelGeo(wr, 0.2, P, { seg: 14, lugs: 8, bolts: 4, back: false });
    for (const ax of [0.85, -0.85]) {
      for (const s of [-1, 1]) k.add(wheel, 0xffffff, M(ax, wr, s * 0.86).ry(s > 0 ? 0 : Math.PI));
      k.rod(P.dark, [ax, wr, -0.86], [ax, wr, 0.86], 0.04, 6);
    }
    for (const s of [-1, 1]) k.beam(P.paint, [1.05, 0.46, s * 0.5], [-1.05, 0.46, s * 0.5], 0.11, 0.12, 0.01);
    for (const x of [0.7, -0.7]) k.beam(P.paint, [x, 0.46, -0.5], [x, 0.46, 0.5], 0.1, 0.1);
    for (const s of [-1, 1]) k.beam(P.paint, [0.7, 0.45, s * 0.5], [-0.7, 0.45, -s * 0.5], 0.07, 0.07);
    for (const s of [-1, 1]) k.taper(P.paint, [-0.9, 0.44, s * 0.5], [-2.3, 0.36, 0], 0.1, 0.1, 0.08, 0.08);
    k.turn(P.dark, [[0.06, 0], [0.12, 0], [0.12, 0.05], [0.06, 0.05], [0.06, 0]], 8, -2.34, 0.33, 0);
    turntable(k, P, 0.5, 0.5, 0.12);
    k.box(P.paint, 0.46, 0.2, 0.46, 0.0, 0.72, 0, 0, 0, 0, 0.02);
    for (const s of [-1, 1]) {
      k.box(P.paint, 0.5, 0.36, 0.1, 0.1, 0.92, s * 0.2, 0, 0, 0, 0.012);
      seat(k, P, -0.2, s * 0.62, -1, 0.64);
      handwheel(k, P, -0.05, 0.88, s * 0.4, 0.12);
      const sh = k.panel(P.paint, [[-0.3, 0], [0.3, 0], [0.36, 0.95], [-0.36, 0.95]], 0.03, 0.55, 0.84, s * 0.38, 12 * RAD, 0, [], 0.006);
      plateBand(k, P.owner, sh, 0, 0.95, 0.36);
    }
    k.add(G.star(0.1, { color: P.red, border: 0xece6d6 }), 0xffffff, G.place([0.55 + 0.05, 1.3, 0.38], [1, 0.2, 0], [-0.2, 1, 0], 1));
    ringSight(k, P.black, 0.25, 1.56, 0.7, 0.08, 0.1);
  }
  const { g, muzzle } = aaGun(P, fac);
  k.group(g, M(P0[0], P0[1], 0).rz(e));
  const tip = [P0[0] + muzzle * Math.cos(e), P0[1] + muzzle * Math.sin(e), 0];
  return { geo: finish(k.geometry(), { span: 0.5 }), pivot: [0, 0, 0], tip };
}

// the twin gun of the flak position, standing in its sandbag ring (x forward): a wide low turntable on a drum pedestal,
// a faction's own barrels, magazines and shield. Its muzzles end at (0.95, 2.1, +-0.2).
function flakposGun(fac, P) {
  const k = kit();
  k.turn(P.dark, [[0, 0], [0.7, 0], [0.7, 0.1], [0.5, 0.16], [0.5, 0.56], [0.62, 0.58], [0.62, 0.7], [0.52, 0.72], [0, 0.72]], 12, 0, 0, 0);
  k.box(P.paint, 0.5, 0.2, 0.6, -0.04, 0.82, 0, 0, 0, 0, 0.015);
  const e = 52 * RAD, P0 = [0.05, 0.95], out = kit();
  for (const s of [-1, 1]) {
    k.box(P.paint, 0.4, 0.34, 0.1, 0.0, 1.0, s * 0.32, 0, 0, 0, 0.012);   // the cradle housings
    // one gun of the pair, built at the origin and moved to its side
    const one = kit();
    if (fac === 0) { aaBarrel(one, P, 1.58, 0.064, 0.05, 'hider'); one.cyl(P.steel, 0.085, 0.085, 0.42, 8, 0, 0, 0, 'x'); }
    else if (fac === 1) { aaBarrel(one, P, 1.58, 0.058, 0.04, 'hider'); one.cyl(P.steel, 0.07, 0.07, 0.45, 8, 0, 0, 0, 'x'); }
    else { aaBarrel(one, P, 1.58, 0.06, 0.046, 'brake'); one.cyl(P.steel, 0.08, 0.08, 0.42, 8, 0, 0, 0, 'x'); }
    one.box(P.black, 0.3, 0.16, 0.15, -0.2, 0, 0, 0, 0, 0, 0.012);
    if (fac === 0) { clip(one, P, -0.3, 0.12, 3, 0.26, 0.022); }
    else if (fac === 1) one.box(P.steel, 0.2, 0.3, 0.12, -0.14, 0.14, 0, 0, 0, 0.1, 0.012);
    else clip(one, P, -0.28, 0.12, 4, 0.26, 0.02);
    out.group(one, M(-0.12, 0, s * 0.2));
  }
  out.box(P.paint, 0.08, 0.1, 0.5, -0.3, 0.0, 0, 0, 0, 0, 0.01);
  k.group(out, M(P0[0], P0[1], 0).rz(e));
  // the shield: a continuous front plate with a slot for the barrels (German), or a tall plate on each side
  const lean = 20 * RAD, y0 = 0.76;
  if (fac === 1) {
    const fr = k.panel(P.paint, [[-0.5, 0], [0.5, 0], [0.5, 0.45], [0.4, 0.58], [0.08, 0.58], [0.08, 0.38], [-0.08, 0.38], [-0.08, 0.58], [-0.4, 0.58], [-0.5, 0.45]], 0.03, 0.4, y0, 0, lean);
    plateBand(k, P.owner, fr, -0.24, 0.58, 0.3); plateBand(k, P.owner, fr, 0.24, 0.58, 0.3);
    k.add(G.balkenkreuz(0.07, { color: 0x1c1b18, border: P.white }), 0xffffff, onPlate(fr, 0.3, 0.22, 0.027));
  } else {
    for (const s of [-1, 1]) {
      const fr = k.panel(P.paint, fac === 0 ? [[-0.2, 0], [0.2, 0], [0.2, 0.55], [-0.2, 0.55]] : [[-0.22, 0], [0.22, 0], [0.26, 0.62], [-0.26, 0.62]], 0.03, 0.34, y0, s * 0.46, lean);
      plateBand(k, P.owner, fr, 0, fac === 0 ? 0.55 : 0.62, 0.3);
      if (s > 0) k.add(fac === 0 ? G.star(0.07, { color: P.white, disc: 0x2a3d6a }) : G.star(0.07, { color: P.red, border: 0xece6d6 }), 0xffffff, onPlate(fr, 0, 0.26, 0.027));
    }
  }
  return finish(k.geometry(), { dark: 0.82, span: 0.5 });
}

// ---------------------------------------------------------------- the sandbag ring

// The ring of sandbags around a flak position, as one geometry for the textured sandbag material (the texture is laid
// on in world space, so it needs no uv): two staggered courses of pillow-shaped bags that follow the circle, with a
// gap for the entrance. Returns one shared geometry in the position's local space (do not change it).
let ringGeo = null;
export function sandbagRing() {
  if (ringGeo) return ringGeo;
  // a bag: a squarish tube that swells a little in the middle, so it reads as a filled sack but keeps flat faces for the texture
  const L = 0.98, W = 0.5, H = 0.34, sec = (x, k) => ({ x, w: W * k, h: H * k, y: (H * k) / 2, p: 4 });
  const bag = G.loft([sec(-L / 2, 0.86), sec(0, 1), sec(L / 2, 0.86)], { segments: 8, normals: 40 });
  const parts = [], n = 12, gap = 8;
  for (let i = 0; i < n; i++) {
    if (i === gap) continue;
    const a = (i / n) * TAU, jig = ((i * 37) % 5 - 2) * 0.008;
    parts.push({ geo: bag, matrix: M(Math.cos(a) * 1.7, 0, Math.sin(a) * 1.7).ry(-a - Math.PI / 2 + jig).m });
  }
  for (let i = 0; i < n; i++) {
    if (i === gap || i === gap - 1) continue;
    const a = ((i + 0.5) / n) * TAU, jig = ((i * 53) % 5 - 2) * 0.008;
    parts.push({ geo: bag, matrix: M(Math.cos(a) * 1.68, 0.32, Math.sin(a) * 1.68).ry(-a - Math.PI / 2 + jig).m });
  }
  const g = G.merge(parts);
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  return (ringGeo = g);
}

// ---------------------------------------------------------------- public

// where each squad's crew stands around the weapon, in the units of unit-models.js SLOTS (x forward, multiplied by 1.3)
export const GUN_SLOTS = {
  mg: [[-0.12, 0.0], [-0.05, 0.85], [-0.05, -0.85]],
  mortar: [[0.15, 0.85], [0.15, -0.85], [-0.62, 0.0]],
  at: [[-0.1, 1.15], [-0.1, -1.15], [-0.85, 1.5], [-0.85, -1.5]],
  flak: [[0.0, 1.15], [0.0, -1.15], [-0.95, 1.2]],
};

const memo = new Map();
// The weapon of a squad type (mg, mortar, at, flak) or of the flak position (flakpos), for faction fac and the owner's look
// ({ vehicle, color }). null for every other type. Cached per look; the geometry is shared, do not change it.
export function gunModel(type, fac, look) {
  const key = `${type}|${fac}|${look.vehicle}|${look.color}`;
  let m = memo.get(key);
  if (m) return m;
  const P = palette(look);
  if (type === 'mg') m = { geo: mgGun(fac, P) };
  else if (type === 'mortar') m = { geo: mortarGun(fac, P) };
  else if (type === 'at') m = atGun(fac, P);
  else if (type === 'flak') m = flakGun(fac, P);
  else if (type === 'flakpos') m = { geo: flakposGun(fac, P) };
  else return null;
  memo.set(key, m);
  return m;
}
