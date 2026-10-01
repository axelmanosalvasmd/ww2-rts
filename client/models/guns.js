// Crew-served weapons as detailed miniatures: the M1919, MG 42 and Maxim machine guns, the 81 mm, GrW 34 and 82 mm
// mortars, the 57 mm, PaK 40 and 45 mm anti-tank guns, the Bofors, Flak 38 and 61-K anti-aircraft guns and the
// emplacement twin gun of the flak position.
//
// Each gun is built once per look as ONE vertex-colored geometry (the weapon, its ammunition and its owner marking), so a
// gun stays one draw call of the shared PAINT material. client/unit-models.js calls gunModel() and bakes the result:
//   { geo }                      a static weapon in the unit's local space (+x forward, +y up): mg and mortar, and the
//                                gun of a flak position
//   { geo, pivot, tip }          a gun that traverses (at, flak): geo is in the space of v.turret, which sits at `pivot`
//                                in the unit's space, and `tip` is the muzzle in that same space (v.fxTip)
// All dimensions are metres in the unit's space (the same space as the crew slots). Weapons are about true to size
// next to the soldiers, who are a little heroic, and the shapes follow the reference sheets: tripods with one front
// leg, a wheeled Sokolov mount with a shield, a baseplate and bipod mortar, split-trail guns with spades and angled
// shields, a cruciform Bofors platform, a three-legged Flak 38 base and a four-wheeled 61-K carriage.
//
// Paint: the faction's vehicle color for carriages and shields, gunmetal for barrels and mechanisms, rubber tires,
// brass rounds. The owner's color sits on a tactical band (shield top, ammunition box lid, baseplate ring) so
// players can tell whose gun it is. National markings (star, Balkenkreuz) are decals on the shields.
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

// A parts list that merges into one colored geometry.
function kit() {
  const items = [];
  const k = {
    items,
    add(geo, color, m) { items.push({ geo, color: color ?? 0xffffff, matrix: mat(m) }); return k; },
    // a box centered on (x, y, z), turned by XYZ Euler angles; c > 0 cuts its edges flat
    box(color, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0, c = 0) {
      return k.add(c > 0 ? G.chamferBox(w, h, d, c) : new THREE.BoxGeometry(w, h, d), color, G.xf(x, y, z, rx, ry, rz));
    },
    // a box from point a to point b: h and w are its section (h stays vertical-ish)
    beam(color, a, b, h, w, c = 0) {
      const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), x = B.clone().sub(A), L = x.length();
      x.normalize();
      const up = Math.abs(x.y) > 0.98 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
      const z = new THREE.Vector3().crossVectors(x, up).normalize(), y = new THREE.Vector3().crossVectors(z, x);
      const m = new THREE.Matrix4().makeBasis(x, y, z).setPosition(A.add(B).multiplyScalar(0.5));
      return k.add(c > 0 ? G.chamferBox(L, h, w, c) : new THREE.BoxGeometry(L, h, w), color, m);
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
    panel(color, outline, t, x, y, z, lean = 0, yaw = 0, holes = [], bevel = 0.006) {
      const g = G.extrudeProfile(outline, t, bevel, { holes, segments: 1 });
      return k.add(g, color, M(x, y, z).ry(yaw).rz(lean).ry(-Math.PI / 2));
    },
    // a sub-assembly merged on its own, then placed (the gun of a mount that elevates)
    group(sub, m) { return k.add(sub.geometry(), 0xffffff, m); },
    geometry() { return G.merge(items); },
  };
  return k;
}

// Paint and finish: the body color darkens toward the ground and under overhangs, and top faces get a dry-brushed lift.
function finish(geo, { dark = 0.74, under = 0.2, lift = 0.1, span } = {}) {
  geo.computeBoundingBox();
  const y0 = geo.boundingBox.min.y, h = Math.max(0.3, span ?? 0.38 * (geo.boundingBox.max.y - geo.boundingBox.min.y));
  const out = G.ao(geo, { falloff: (p, n) => (dark + (1 - dark) * smooth((p.y - y0) / h)) * (1 - under * Math.max(0, -n.y)) * (1 + lift * Math.max(0, n.y)) });
  out.computeBoundingBox(); out.computeBoundingSphere();
  return out;
}

function palette(look) {
  const paint = mix(look.vehicle, 0xffffff, 0.08);
  return {
    paint, dark: shade(paint, 0.7), light: mix(paint, 0xffffff, 0.2),
    steel: new THREE.Color(0x777a7e), black: new THREE.Color(0x4f5256), tire: new THREE.Color(0x3a382f),
    brass: new THREE.Color(0xd0a844), wood: new THREE.Color(0x7c5832), tan: new THREE.Color(0xa8975e),
    owner: col(look.color).clone(), white: new THREE.Color(0xece6d6), red: new THREE.Color(0xb8301f),
  };
}

// ---------------------------------------------------------------- shared pieces

// a wheel with its axle along z, centered on the origin: a rubber tire on a pressed steel disc, or spokes
function wheelGeo(R, w, paint, tire, { spokes = 0, seg = 12, dish = 'both' } = {}) {
  const k = kit(), ri = R * 0.8, hub = R * 0.2, fw = w * 0.5;
  k.turn(tire, [[ri, -w / 2], [R, -w * 0.38], [R, w * 0.38], [ri, w / 2], [ri, -w / 2]], seg, 0, 0, 0, 'z');
  if (spokes) {
    k.turn(paint, [[ri * 0.86, -w * 0.28], [ri, -w * 0.28], [ri, w * 0.28], [ri * 0.86, w * 0.28], [ri * 0.86, -w * 0.28]], seg, 0, 0, 0, 'z');
    k.turn(paint, [[0, -w * 0.62], [hub * 1.2, -w * 0.62], [hub * 1.2, w * 0.62], [0, w * 0.62]], 8, 0, 0, 0, 'z');
    const len = ri * 0.86 - hub, sp = new THREE.BoxGeometry(len, R * 0.07, w * 0.3);
    for (let i = 0; i < spokes; i++) k.add(sp, paint, M().rz((i / spokes) * TAU).t(hub + len / 2, 0, 0));
  } else if (dish === 'both') {
    k.turn(paint, [[0, -fw], [hub, -fw], [hub * 1.5, -w * 0.2], [ri, -w * 0.2], [ri, w * 0.2], [hub * 1.5, w * 0.2], [hub, fw], [0, fw]], seg, 0, 0, 0, 'z');
  } else {
    k.turn(paint, [[0, fw], [hub, fw], [hub * 1.5, w * 0.2], [ri, w * 0.2], [ri, -w * 0.2], [0, -w * 0.2]], seg, 0, 0, 0, 'z');
  }
  return k.geometry();
}

// A trail or foot spade: a flat slab pushed into the ground at an angle
const spade = (k, color, x, y, z, w, h, rz) => k.box(color, 0.045, h, w, x, y, z, 0, 0, rz, 0.01);

// An ammunition box with an owner band on the lid. rot turns it about the vertical; cross paints the stamped X.
function ammoBox(k, P, color, x, z, rot, w = 0.34, h = 0.2, d = 0.15, cross = false) {
  k.add(G.chamferBox(w, h, d, 0.018), color, M(x, h / 2, z).ry(rot));
  k.add(new THREE.BoxGeometry(w * 0.22, 0.03, d * 0.45), shade(color, 0.6), M(x, h + 0.012, z).ry(rot));      // the handle
  k.add(new THREE.BoxGeometry(w * 0.55, 0.014, 0.035), P.owner, M(x, h + 0.003, z).ry(rot).t(0, 0, d * 0.3)); // owner band on the lid
  if (cross) for (const s of [-1, 1]) for (const a of [0.55, -0.55]) k.add(new THREE.BoxGeometry(h * 0.95, 0.008, 0.012), shade(color, 0.55), M(x, h * 0.5, z).ry(rot).t(0, 0, s * (d / 2 + 0.002)).rz(a).rx(Math.PI / 2));
  return k;
}

// a shell standing on its base: base radius r, total length L
const shellProfile = (r, L, nose = 0.4) => [[0, 0], [r, 0], [r, L * (1 - nose)], [r * 0.55, L * (1 - nose * 0.4)], [0, L]];

// a ring lying flat (axis y), e.g. an owner marking on a baseplate
const flatRing = (k, color, r0, r1, y, x, z, h = 0.014) => k.turn(color, [[r0, 0], [r1, 0], [r1, h], [r0, h], [r0, 0]], 14, x, y, z, 'y');

// a ring sight: a flat annulus on a post, facing +x
function ringSight(k, color, x, y, z, r = 0.085) {
  const g = G.extrudeProfile(circle(r, 8), 0.016, 0, { holes: [circle(r * 0.72, 8)], segments: 1 });
  k.add(g, color, M(x, y, z).ry(-Math.PI / 2));
  k.rod(color, [x, y - r - 0.16, z], [x, y - r + 0.01, z], 0.013, 5, false);
}

// ---------------------------------------------------------------- machine guns

// +x forward. The bore sits at y = 0.45 and the muzzle at x = 1.72, where client/fx.js starts the tracers.
function mgGun(fac, P) {
  const k = kit(), y = 0.45;
  let boxColor;
  if (fac === 0) {
    // M1919A4 on the M2 tripod: boxy receiver, perforated jacket, one front leg and two rear legs, all gunmetal
    k.box(P.black, 0.42, 0.21, 0.15, 0.99, y, 0, 0, 0, 0, 0.014);
    k.box(P.steel, 0.27, 0.05, 0.14, 1.0, y + 0.125, 0, 0, 0, 0, 0.012);               // feed cover
    k.box(P.black, 0.04, 0.2, 0.17, 0.775, y, 0, 0, 0, 0, 0.012);                      // back plate
    for (const s of [-1, 1]) k.rod(P.black, [0.79, y + 0.05, s * 0.06], [0.75, y + 0.17, s * 0.065], 0.016, 5);
    k.cyl(P.steel, 0.052, 0.052, 0.46, 8, 1.2, y, 0, 'x');                              // perforated jacket
    for (const x of [1.29, 1.38, 1.47, 1.56]) k.cyl(P.black, 0.057, 0.057, 0.035, 8, x, y, 0, 'x');
    k.cyl(P.black, 0.065, 0.045, 0.1, 8, 1.62, y, 0, 'x');                              // flash hider, ends at 1.72
    k.box(P.black, 0.02, 0.05, 0.02, 1.55, y + 0.075, 0);                                // front sight
    k.cyl(P.black, 0.055, 0.05, 0.14, 8, 1.0, 0.27, 0);                                  // pintle
    k.box(P.black, 0.2, 0.07, 0.14, 1.0, 0.31, 0, 0, 0, 0, 0.012);
    const head = [1.0, 0.3, 0], front = [1.5, 0.05, 0], rear = [0.52, 0.05, 0.46];
    k.rod(P.black, head, front, 0.027, 6); k.cyl(P.steel, 0.09, 0.09, 0.04, 8, front[0], 0.0, 0);
    for (const s of [-1, 1]) {
      k.rod(P.black, [0.97, 0.3, s * 0.045], [rear[0], rear[1], s * rear[2]], 0.027, 6);
      k.cyl(P.steel, 0.09, 0.09, 0.04, 8, rear[0], 0.0, s * rear[2]);
    }
    k.rod(P.steel, [0.82, 0.18, 0], [0.95, 0.34, 0], 0.017, 5);                          // elevating screw
    boxColor = mix(P.paint, 0x56603a, 0.4);
  } else if (fac === 1) {
    // MG 42 on the Lafette 34: slotted jacket, bell flash hider, wooden stock, olive tripod with a front leg
    const tri = new THREE.Color(0x4d5538);
    k.box(P.black, 0.5, 0.13, 0.13, 0.88, y - 0.01, 0, 0, 0, 0, 0.012);                // receiver
    k.box(P.steel, 0.22, 0.05, 0.14, 0.96, y + 0.085, 0, 0, 0, 0, 0.01);                // feed cover
    k.box(P.wood, 0.22, 0.11, 0.08, 0.55, y - 0.03, 0, 0, 0, 0.1, 0.012);              // stock
    k.box(P.black, 0.055, 0.12, 0.05, 0.9, y - 0.12, 0, 0, 0, -0.35);                   // pistol grip
    k.box(P.black, 0.03, 0.05, 0.03, 0.74, y + 0.08, 0);                                 // rear sight
    k.cyl(P.steel, 0.046, 0.046, 0.46, 8, 1.13, y, 0, 'x');                             // slotted jacket
    for (const x of [1.22, 1.33, 1.44]) for (const s of [-1, 1]) k.box(P.black, 0.08, 0.035, 0.012, x, y + 0.012, s * 0.045);
    k.cyl(P.black, 0.035, 0.065, 0.14, 8, 1.58, y, 0, 'x');                             // bell hider, ends at 1.72
    k.box(P.black, 0.02, 0.04, 0.02, 1.5, y + 0.06, 0);
    k.cyl(tri, 0.055, 0.055, 0.12, 8, 0.96, 0.25, 0);                                    // Lafette 34
    k.box(tri, 0.22, 0.09, 0.17, 0.95, 0.34, 0, 0, 0, 0, 0.012);
    const head = [0.96, 0.27, 0], front = [1.5, 0.04, 0], rear = [0.5, 0.04, 0.5];
    k.beam(tri, head, front, 0.07, 0.06, 0.01);
    k.box(tri, 0.17, 0.035, 0.12, front[0], 0.02, 0, 0, 0, 0, 0.008);
    for (const s of [-1, 1]) {
      k.beam(tri, [0.92, 0.27, s * 0.05], [rear[0], rear[1], s * rear[2]], 0.07, 0.06, 0.01);
      k.box(tri, 0.17, 0.035, 0.12, rear[0], 0.02, s * rear[2], 0, 0, 0, 0.008);
    }
    k.rod(tri, [0.68, 0.14, -0.32], [0.68, 0.14, 0.32], 0.02, 5);                        // cross bar between the rear legs
    // the spare barrel in its case lies on the ground
    k.box(P.black, 0.34, 0.07, 0.1, 0.35, 0.035, -0.62, 0, 0.3, 0, 0.01);
    k.rod(P.steel, [0.28, 0.1, -0.6], [0.44, 0.1, -0.66], 0.012, 4);
    boxColor = P.paint;
  } else {
    // Maxim on the Sokolov mount: water jacket, spade grips, a shield and two spoked wheels with a single trail
    k.box(P.black, 0.4, 0.21, 0.15, 0.82, y, 0, 0, 0, 0, 0.014);                        // receiver
    k.box(P.black, 0.035, 0.14, 0.22, 0.61, y, 0, 0, 0, 0, 0.008);                       // back plate
    for (const s of [-1, 1]) k.rod(P.black, [0.62, y + 0.02, s * 0.1], [0.6, y + 0.12, s * 0.11], 0.016, 5);
    k.cyl(P.paint, 0.085, 0.085, 0.58, 10, 1.02, y, 0, 'x');                            // water jacket
    for (const x of [1.12, 1.22, 1.32, 1.42, 1.52]) k.cyl(P.dark, 0.093, 0.093, 0.035, 10, x, y, 0, 'x');
    k.cyl(P.black, 0.058, 0.044, 0.1, 8, 1.62, y, 0, 'x');                              // muzzle booster, ends at 1.72
    k.rod(P.black, [1.2, y + 0.07, 0.05], [0.95, y + 0.19, 0.02], 0.016, 5);              // steam hose
    // Sokolov carriage
    const wr = 0.29, ax = 1.08;
    const wheel = wheelGeo(wr, 0.06, P.paint, P.tire, { spokes: 10, seg: 14 });
    for (const s of [-1, 1]) k.add(wheel, 0xffffff, M(ax, wr, s * 0.45));
    k.rod(P.dark, [ax, wr, -0.45], [ax, wr, 0.45], 0.028, 6);
    k.box(P.dark, 0.22, 0.12, 0.18, ax, wr + 0.1, 0, 0, 0, 0, 0.012);
    k.rod(P.dark, [ax - 0.03, 0.4, 0], [ax + 0.0, y - 0.06, 0], 0.034, 6);
    k.beam(P.dark, [ax - 0.05, wr + 0.05, 0], [-0.3, 0.05, 0], 0.08, 0.09, 0.012);        // the single trail
    k.box(P.dark, 0.12, 0.05, 0.18, -0.32, 0.03, 0, 0, 0, 0, 0.01);
    // shield: a plate with a slot for the barrel, tilted back
    const sh = [[-0.29, 0], [0.29, 0], [0.29, 0.62], [0.07, 0.62], [0.07, 0.42], [-0.07, 0.42], [-0.07, 0.62], [-0.29, 0.62]];
    k.panel(P.paint, sh, 0.03, 1.2, 0.13, 0, 0.12);
    k.add(G.star(0.07, { color: P.red }), 0xffffff, G.place([1.2 + 0.034, 0.26, 0.0], [1, 0.12, 0], [-0.12, 1, 0], 1));
    boxColor = shade(P.paint, 0.92);
  }
  // ammunition: a can by the gunner's left hand and a belt of brass rounds to the feed
  ammoBox(k, P, boxColor, 0.55, 0.42, 0.25, 0.34, 0.2, 0.15, true);
  const feed = [fac === 1 ? 0.98 : fac === 2 ? 0.86 : 1.0, y + (fac === 1 ? 0.06 : 0.0), 0.075];
  k.add(G.tube([[0.58, 0.21, 0.42], [0.72, 0.36, 0.26], feed], 0.026, { radial: 4, segments: 6 }), P.brass);
  if (fac === 1) ammoBox(k, P, boxColor, 0.8, -0.5, -0.2, 0.34, 0.18, 0.13, true);
  return finish(k.geometry(), { span: 0.3 });
}

// ---------------------------------------------------------------- mortars

// +x forward. The tube leans toward +x and its top is at (1.05, 0.87, 0), where client/fx.js launches the shell.
function mortarGun(fac, P) {
  const k = kit(), top = [1.05, 0.87], L = 0.95, by = 0.1;
  const tilt = Math.acos((top[1] - by) / L), bx = top[0] - L * Math.sin(tilt);
  const metal = fac === 1 ? P.tan : fac === 0 ? mix(P.paint, 0xffffff, 0.04) : P.paint;
  const darkMetal = shade(metal, 0.66);
  // baseplate: round and perforated (M1), or square with diagonal ribs (GrW 34, 82 mm)
  if (fac === 0) {
    const holes = [0, 1, 2].map((i) => circle(0.05, 6).map(([x, y]) => [x + 0.2 * Math.cos(i * TAU / 3 + 0.5), y + 0.2 * Math.sin(i * TAU / 3 + 0.5)]));
    k.add(G.extrudeProfile(circle(0.34, 14), 0.04, 0.008, { holes, segments: 1 }), metal, M(bx, 0.02, 0).rx(-Math.PI / 2));
    flatRing(k, P.owner, 0.27, 0.31, 0.04, bx, 0, 0.012);
    k.turn(darkMetal, [[0, 0], [0.12, 0], [0.12, 0.035], [0.07, 0.07], [0, 0.075]], 10, bx, 0.04, 0);
  } else {
    const s = fac === 1 ? 0.6 : 0.64;
    k.box(metal, s, 0.04, s, bx, 0.02, 0, 0, 0, 0, 0.012);
    for (const a of [Math.PI / 4, -Math.PI / 4]) k.box(darkMetal, s * 1.3, 0.035, 0.05, bx, 0.05, 0, 0, a, 0);
    for (const sg of [-1, 1]) { k.box(darkMetal, s, 0.035, 0.035, bx, 0.045, sg * (s / 2 - 0.0175)); k.box(darkMetal, 0.035, 0.035, s, bx + sg * (s / 2 - 0.0175), 0.045, 0); }
    k.box(P.owner, 0.15, 0.014, 0.15, bx - s * 0.27, 0.046, s * 0.27);
    k.turn(darkMetal, [[0, 0], [0.11, 0], [0.11, 0.045], [0.07, 0.08], [0, 0.085]], 10, bx, 0.04, 0);
  }
  // tube: closed breech, thickened collar near the top, dark bore
  const r = fac === 2 ? 0.06 : 0.054, base = M(bx, by, 0).rz(-tilt);
  k.add(G.lathe([[0, 0], [r * 1.35, 0], [r * 1.35, 0.07], [r, 0.11], [r, L - 0.06], [r * 1.15, L - 0.06], [r * 1.15, L], [r * 0.7, L], [r * 0.7, L - 0.14], [0, L - 0.14]], 12, { axis: 'y' }), metal, base);
  k.add(G.lathe([[r * 1.08, 0.3], [r * 1.2, 0.3], [r * 1.2, 0.35], [r * 1.08, 0.35]], 10, { axis: 'y' }), darkMetal, base);
  // sight and cross-leveling gear on the tube
  const onTube = (s, z) => base.m.clone().multiply(new THREE.Matrix4().makeTranslation(0, L * s, z));
  k.add(new THREE.BoxGeometry(0.07, 0.11, 0.045), P.black, onTube(0.58, 0.09));
  k.add(G.lathe([[0, 0], [0.03, 0], [0.03, 0.055], [0, 0.055]], 6, { axis: 'z' }), P.steel, onTube(0.7, 0.1));
  // bipod: a clamp on the tube and two legs out to the front
  const along = (s) => [bx + Math.sin(tilt) * s, by + Math.cos(tilt) * s];
  const [cx, cy] = along(L * 0.6);
  k.add(G.lathe([[r * 1.08, 0], [r * 1.5, 0], [r * 1.5, 0.07], [r * 1.08, 0.07]], 10, { axis: 'y' }), darkMetal, M(cx, cy - 0.035, 0).rz(-tilt));
  k.rod(darkMetal, [cx, cy, -0.09], [cx, cy, 0.09], 0.028, 6);
  const fx = cx + 0.5, fz = fac === 0 ? 0.44 : 0.48;
  for (const s of [-1, 1]) {
    k.rod(metal, [cx + 0.02, cy, s * 0.08], [fx, 0.05, s * fz], 0.024, 6);
    k.cyl(darkMetal, 0.055, 0.04, 0.07, 6, fx, 0.0, s * fz);
  }
  k.rod(darkMetal, [cx + 0.05, cy - 0.05, 0], [bx + 0.35, 0.1, 0], 0.016, 5);               // the elevating screw
  // ammunition: two crates of rounds behind the plate
  const wood = fac === 0 ? shade(P.paint, 0.8) : P.wood, shellColor = fac === 0 ? P.paint : mix(P.paint, P.steel, 0.5);
  for (const [x, z, rot] of [[0.05, 0.55, 0.15], [0.05, -0.55, -0.15]]) {
    k.add(G.chamferBox(0.36, 0.14, 0.26, 0.012), wood, M(x, 0.07, z).ry(rot));
    k.add(new THREE.BoxGeometry(0.32, 0.02, 0.22), P.black, M(x, 0.135, z).ry(rot));
    for (let i = 0; i < 3; i++) k.add(G.lathe(shellProfile(0.036, 0.17), 6, { axis: 'y' }), shellColor, M(x, 0.13, z).ry(rot).t(-0.1 + i * 0.1, 0, 0));
    k.box(P.owner, 0.34, 0.012, 0.04, x, 0.15, z, 0, rot, 0);
  }
  return finish(k.geometry(), { span: 0.4 });
}

// ---------------------------------------------------------------- anti-tank guns

const AT = [
  // 57 mm M1: tall leaning shield with a stepped lower part, box-section trails, rubber tires on pressed discs
  { barrel: 3.0, bore: 0.05, brake: 'drum', yb: 0.95, R: 0.43, track: 0.8, lean: 14, trail: 2.1, spread: 28, box: true, spoke: 0, shield: 'us', pivot: 0.55 },
  // PaK 40: angled three-plate shield, big box muzzle brake, tubular trails
  { barrel: 3.2, bore: 0.056, brake: 'box', yb: 0.95, R: 0.42, track: 0.8, lean: 16, trail: 2.3, spread: 26, box: false, spoke: 0, shield: 'de', pivot: 0.55 },
  // 45 mm 53-K: short barrel, narrow upright shield, spoked wheels, thin tubular trails
  { barrel: 2.35, bore: 0.04, brake: null, yb: 0.9, R: 0.46, track: 0.78, lean: 10, trail: 2.0, spread: 28, box: false, spoke: 8, shield: 'ru', pivot: 0.5 },
];

function atGun(fac, P) {
  const S = AT[fac], k = kit(), yb = S.yb, R = S.R, x0 = -0.42;
  // wheels and axle
  const wheel = wheelGeo(R, 0.2, P.paint, P.tire, { spokes: S.spoke, seg: S.spoke ? 14 : 12 });
  for (const s of [-1, 1]) k.add(wheel, 0xffffff, M(0, R, s * S.track));
  k.rod(P.dark, [0, R, -S.track], [0, R, S.track], 0.045, 6);
  // carriage body, cradle, breech and the gunner's wheel
  k.box(P.paint, 0.5, 0.2, 0.5, 0.05, 0.56, 0, 0, 0, 0, 0.02);
  k.box(P.dark, 0.3, 0.28, 0.3, 0.0, 0.76, 0, 0, 0, 0, 0.015);
  for (const s of [-1, 1]) k.box(P.paint, 0.36, 0.34, 0.05, 0.0, yb - 0.08, s * 0.15, 0, 0, 0, 0.012);
  k.cyl(P.steel, 0.085, 0.085, 0.95, 8, 0.0, yb, 0, 'x');                                     // the sleeve over the barrel
  for (const s of [-1, 1]) k.cyl(P.steel, 0.038, 0.038, 0.75, 6, 0.05, yb - 0.16, s * 0.11, 'x'); // recoil cylinders
  k.box(P.black, 0.3, 0.18, 0.16, x0 + 0.06, yb, 0, 0, 0, 0, 0.015);                           // breech block
  k.cyl(P.steel, 0.11, 0.11, 0.07, 8, -0.12, 0.82, 0.2, 'z');                                 // elevating handwheel
  k.rod(P.steel, [-0.12, 0.82, 0.17], [-0.12, 0.9, 0.2], 0.022, 5);
  k.rod(P.black, [-0.15, yb + 0.11, 0.12], [0.22, yb + 0.13, 0.12], 0.022, 5);                 // sight
  // barrel
  k.add(G.barrel(S.barrel, S.bore, { segments: 8, brake: false }), P.black, M(x0, yb, 0));
  const bx = x0 + S.barrel - 0.3;
  if (S.brake === 'drum') {
    k.add(G.lathe([[0, 0], [0.09, 0], [0.105, 0.03], [0.105, 0.27], [0.09, 0.3], [0.055, 0.3], [0.055, 0.26], [0, 0.26]], 8, { axis: 'x' }), P.black, M(bx, yb, 0));
    for (const s of [-1, 1]) k.box(P.steel, 0.14, 0.06, 0.02, bx + 0.14, yb, s * 0.1);           // the side ports
  } else if (S.brake === 'box') {
    k.box(P.black, 0.34, 0.18, 0.2, bx + 0.12, yb, 0, 0, 0, 0, 0.02);                          // a boxy two-baffle brake
    for (const s of [-1, 1]) for (const dx of [0.04, 0.2]) k.box(P.steel, 0.06, 0.1, 0.012, bx + dx, yb, s * 0.1);
    k.box(P.steel, 0.3, 0.012, 0.08, bx + 0.12, yb + 0.092, 0);
  }
  // trails: split, spread, with spades
  const a = S.spread * RAD;
  for (const s of [-1, 1]) {
    const hinge = [-0.05, 0.55, s * 0.14], end = [-0.05 - S.trail * Math.cos(a), 0.08, s * (0.14 + S.trail * Math.sin(a))];
    if (S.box) k.beam(P.paint, hinge, end, 0.17, 0.11, 0.016); else k.rod(P.paint, hinge, end, 0.068, 6);
    k.box(P.dark, 0.13, 0.12, 0.06, hinge[0], 0.55, s * 0.14, 0, 0, 0, 0.012);
    spade(k, P.dark, end[0] - 0.05, 0.14, end[2] + s * 0.04, 0.4, 0.32, -0.6);
    k.rod(P.dark, [end[0] + 0.25 * Math.cos(a), 0.2, end[2] - s * 0.25 * Math.sin(a)], [end[0] + 0.3 * Math.cos(a), 0.34, end[2] - s * 0.3 * Math.sin(a)], 0.02, 4, false); // the carrying handle
  }
  shield(k, P, S);
  return { geo: finish(k.geometry(), { span: 0.55 }), pivot: [S.pivot, 0, 0], tip: [x0 + S.barrel, yb, 0] };
}

function shield(k, P, S) {
  const y0 = 0.46, xs = 0.34, lean = S.lean * RAD, t = 0.028, paint = P.paint;
  // where a point of the plate (across u, up v, off the face) lands, for the markings
  const at = (u, v, off) => [xs - Math.sin(lean) * v + Math.cos(lean) * off, y0 + Math.cos(lean) * v + Math.sin(lean) * off, u];
  const norm = [Math.cos(lean), Math.sin(lean), 0], up = [-Math.sin(lean), Math.cos(lean), 0];
  // the owner's band along the top edge
  const top = (w, v, u = 0) => k.add(new THREE.BoxGeometry(0.04, 0.034, w), P.owner, M(...at(u, v - 0.012, t / 2 + 0.002)).rz(lean));
  if (S.shield === 'us') {
    const out = [[-0.5, 0], [0.5, 0], [0.5, 0.3], [0.78, 0.3], [0.78, 1.0], [-0.78, 1.0], [-0.78, 0.3], [-0.5, 0.3]];
    k.panel(paint, out, t, xs, y0, 0, lean, 0, [[[-0.1, 0.4], [0.1, 0.4], [0.1, 0.62], [-0.1, 0.62]], [[0.42, 0.74], [0.56, 0.74], [0.56, 0.86], [0.42, 0.86]]]);
    k.add(new THREE.BoxGeometry(0.035, 0.92, 0.03), P.dark, M(...at(0.12, 0.5, t / 2)).rz(lean));       // the fold between the plates
    top(0.8, 1.0);
    k.add(G.star(0.13, { color: P.white, disc: 0x2a3d6a }), 0xffffff, G.place(at(-0.4, 0.66, t / 2 + 0.014), norm, up, 1));
  } else if (S.shield === 'de') {
    const wing = [[0, 0], [0.42, 0], [0.42, 0.74], [0.2, 1.0], [0, 1.0]];
    const centre = [[-0.46, 0], [0.46, 0], [0.46, 1.0], [-0.46, 1.0]];
    k.panel(paint, centre, t, xs, y0, 0, lean, 0, [[[-0.08, 0.38], [0.08, 0.38], [0.08, 0.62], [-0.08, 0.62]], [[0.2, 0.7], [0.32, 0.7], [0.32, 0.8], [0.2, 0.8]]]);
    const half = kit();
    half.panel(paint, wing, t, xs, y0, 0.46, lean, -25 * RAD);
    k.add(G.mirrorZ(half.geometry()), 0xffffff);
    top(0.6, 1.0);
    k.add(G.balkenkreuz(0.1, { color: 0x1c1b18, border: P.white }), 0xffffff, G.place(at(-0.28, 0.76, t / 2 + 0.014), norm, up, 1));
  } else {
    const out = [[-0.6, 0], [0.6, 0], [0.6, 0.82], [0.26, 0.82], [0.26, 0.93], [-0.6, 0.93]];
    k.panel(paint, out, t, xs, y0, 0, lean, 0, [[[-0.08, 0.36], [0.08, 0.36], [0.08, 0.6], [-0.08, 0.6]], [[0.34, 0.5], [0.46, 0.5], [0.46, 0.6], [0.34, 0.6]]]);
    for (const s of [-1, 1]) k.box(paint, 0.05, 0.6, 0.05, xs, y0 + 0.4, s * 0.6, 0, 0, lean, 0.008);   // folded side flanges
    top(0.5, 0.93, -0.34);
    k.add(G.star(0.1, { color: P.red, border: 0xece6d6, edge: 0.1 }), 0xffffff, G.place(at(-0.3, 0.3, t / 2 + 0.014), norm, up, 1));
  }
}

// ---------------------------------------------------------------- anti-aircraft guns

// the shared mount: a low turntable and a saddle
function mount(k, P, slim = false) {
  k.turn(P.dark, [[0, 0.16], [0.36, 0.16], [0.36, 0.28], [0.3, 0.32], [0, 0.32]], 12, 0, 0, 0);
  if (slim) k.turn(P.paint, [[0, 0.32], [0.23, 0.32], [0.2, 0.6], [0.28, 0.62], [0.28, 0.68], [0, 0.68]], 10, 0, 0, 0);
  else k.turn(P.paint, [[0, 0.32], [0.29, 0.32], [0.29, 0.56], [0.25, 0.6], [0, 0.6]], 12, 0, 0, 0);
}

// a leg (outrigger) from the hub to a jack and pad
function outrigger(k, P, ang, len, wide = 0.16) {
  const tx = Math.cos(ang) * len, tz = Math.sin(ang) * len;
  k.beam(P.paint, [0, 0.3, 0], [tx, 0.24, tz], 0.14, wide, 0.012);
  k.rod(P.steel, [tx, 0.1, tz], [tx, 0.4, tz], 0.034, 6);
  k.box(P.dark, 0.1, 0.06, 0.1, tx, 0.27, tz, 0, -ang, 0, 0.008);
  k.turn(P.dark, [[0, 0], [0.17, 0], [0.17, 0.035], [0.06, 0.07], [0, 0.07]], 10, tx, 0, tz);
}

function seat(k, P, x, z, back = -1, y = 0.6) {
  k.rod(P.dark, [x, y - 0.2, z], [x, y, z], 0.022, 5, false);
  k.box(P.wood, 0.22, 0.04, 0.2, x, y + 0.02, z, 0, 0, 0, 0.01);
  k.box(P.wood, 0.04, 0.16, 0.2, x + back * 0.1, y + 0.12, z, 0, 0, -back * 0.2, 0.008);
}

function handwheel(k, P, x, y, z, r = 0.12) {
  k.cyl(P.steel, r, r, 0.03, 8, x, y, z, 'z');
  k.cyl(P.dark, r * 0.35, r * 0.35, 0.06, 6, x, y, z - 0.015, 'z');
}

// the elevating gun group in its own frame: breech at x = 0, barrel along +x. Returns the muzzle x.
function aaGun(P, fac) {
  const g = kit();
  if (fac === 0) {
    // Bofors: long barrel with a flash hider, recoil sleeve, clip feed on top with brass rounds
    g.add(G.barrel(1.9, 0.05, { segments: 8 }), P.black, M(-0.12, 0, 0));
    g.cyl(P.steel, 0.09, 0.09, 0.6, 8, 0.0, 0, 0, 'x');
    for (const s of [-1, 1]) g.cyl(P.steel, 0.04, 0.04, 0.7, 6, 0.0, -0.14, s * 0.11, 'x');
    g.box(P.black, 0.36, 0.22, 0.24, -0.2, 0, 0, 0, 0, 0, 0.015);
    g.box(P.steel, 0.14, 0.26, 0.34, -0.12, 0.24, 0, 0, 0, 0, 0.012);
    g.box(P.brass, 0.1, 0.05, 0.28, -0.12, 0.39, 0);
    for (const s of [-1, 1]) g.box(P.paint, 0.4, 0.3, 0.05, -0.05, -0.08, s * 0.19, 0, 0, 0, 0.012);
    return { g, muzzle: 1.78 };
  }
  if (fac === 1) {
    // 2 cm Flak 38: slim barrel, flash hider, a box magazine on the left of the receiver
    g.add(G.barrel(1.7, 0.032, { segments: 6 }), P.black, M(-0.1, 0, 0));
    g.cyl(P.steel, 0.06, 0.06, 0.5, 8, 0.0, 0, 0, 'x');
    g.box(P.black, 0.36, 0.18, 0.18, -0.2, 0, 0, 0, 0, 0, 0.012);
    g.box(P.steel, 0.13, 0.32, 0.11, -0.1, 0.03, -0.18, 0, 0, 0.12, 0.01);
    g.box(P.brass, 0.1, 0.045, 0.08, -0.1, 0.2, -0.18);
    for (const s of [-1, 1]) g.box(P.paint, 0.3, 0.22, 0.04, -0.05, -0.06, s * 0.14, 0, 0, 0, 0.01);
    return { g, muzzle: 1.6 };
  }
  // 37 mm 61-K: long barrel with a slotted brake and a feed on the side
  g.add(G.barrel(2.15, 0.038, { segments: 6, brake: 2 }), P.black, M(-0.1, 0, 0));
  g.cyl(P.steel, 0.075, 0.075, 0.6, 8, 0.0, 0, 0, 'x');
  for (const s of [-1, 1]) g.cyl(P.steel, 0.034, 0.034, 0.7, 6, 0.0, -0.12, s * 0.1, 'x');
  g.box(P.black, 0.38, 0.2, 0.2, -0.2, 0, 0, 0, 0, 0, 0.014);
  g.box(P.steel, 0.12, 0.2, 0.26, -0.1, 0.2, 0, 0, 0, 0, 0.01);
  g.box(P.brass, 0.1, 0.045, 0.2, -0.1, 0.32, 0);
  return { g, muzzle: 2.05 };
}

function flakGun(fac, P) {
  const k = kit();
  let P0, e;
  if (fac === 0) {
    // Bofors: cruciform platform with four outriggers
    P0 = [0.15, 1.02]; e = 32 * RAD;
    mount(k, P, true);
    for (const a of [42, 138, -42, -138]) outrigger(k, P, a * RAD, 1.28, 0.18);
    k.box(P.paint, 0.5, 0.3, 0.5, 0.0, 0.72, 0, 0, 0, 0, 0.02);
    for (const s of [-1, 1]) k.box(P.paint, 0.46, 0.42, 0.05, 0.12, 0.98, s * 0.2, 0, 0, 0, 0.012);
    for (const s of [-1, 1]) {
      seat(k, P, -0.12, s * 0.62);
      handwheel(k, P, -0.02, 0.88, s * 0.42, 0.13);
      ringSight(k, P.black, 0.3, 1.46, s * 0.62, 0.09);
      k.panel(P.paint, [[-0.2, 0], [0.2, 0], [0.2, 0.78], [-0.2, 0.78]], 0.05, 0.5, 0.88, s * 0.34, 10 * RAD);
      k.add(new THREE.BoxGeometry(0.05, 0.034, 0.28), P.owner, M(0.5 - 0.1, 1.64, s * 0.34).rz(10 * RAD));
    }
    k.add(G.star(0.1, { color: P.white, disc: 0x2a3d6a }), 0xffffff, G.place([0.5 + 0.04, 1.12, 0.34], [1, 0.17, 0], [-0.17, 1, 0], 1));
  } else if (fac === 1) {
    // Flak 38: three-legged base on a slim column, two tall plates with folded wings, a seat and wheels for the gunner
    P0 = [0.05, 1.0]; e = 31 * RAD;
    mount(k, P, true);
    for (const a of [0, 122, -122]) outrigger(k, P, a * RAD, 1.3, 0.15);
    k.box(P.paint, 0.4, 0.26, 0.4, 0.0, 0.78, 0, 0, 0, 0, 0.02);
    for (const s of [-1, 1]) k.box(P.paint, 0.36, 0.38, 0.045, 0.06, 1.0, s * 0.16, 0, 0, 0, 0.012);
    seat(k, P, -0.36, 0.3, -1, 0.62);
    handwheel(k, P, -0.05, 0.88, 0.3, 0.11);
    handwheel(k, P, -0.05, 0.8, -0.3, 0.11);
    ringSight(k, P.black, 0.12, 1.56, -0.3, 0.08);
    const side = kit();
    side.panel(P.paint, [[-0.17, 0], [0.17, 0], [0.17, 0.66], [0.05, 0.74], [-0.17, 0.74]], 0.026, 0.34, 0.82, 0.3, 14 * RAD);
    side.panel(P.paint, [[0, 0], [0.2, 0], [0.2, 0.5], [0, 0.62]], 0.022, 0.34, 0.82, 0.47, 14 * RAD, -32 * RAD);
    k.add(G.mirrorZ(side.geometry()), 0xffffff);
    k.add(new THREE.BoxGeometry(0.05, 0.034, 0.3), P.owner, M(0.34 - 0.18, 1.55, 0.3).rz(14 * RAD));
    k.add(new THREE.BoxGeometry(0.05, 0.034, 0.3), P.owner, M(0.34 - 0.18, 1.55, -0.3).rz(14 * RAD));
    k.add(G.balkenkreuz(0.07, { color: 0x1c1b18, border: P.white }), 0xffffff, G.place([0.34 + 0.04, 1.2, 0.3], [1, 0.25, 0], [-0.25, 1, 0], 1));
  } else {
    // 61-K: four-wheeled carriage, drawbar, two big shields
    P0 = [0.1, 1.08]; e = 30 * RAD;
    mount(k, P);
    const wr = 0.33, wheel = wheelGeo(wr, 0.2, P.paint, P.tire, { seg: 8, dish: 'one' });
    for (const ax of [0.85, -0.85]) {
      for (const s of [-1, 1]) k.add(wheel, 0xffffff, M(ax, wr, s * 0.86).ry(s > 0 ? 0 : Math.PI));
      k.rod(P.dark, [ax, wr, -0.86], [ax, wr, 0.86], 0.04, 6);
    }
    for (const s of [-1, 1]) k.beam(P.paint, [1.05, 0.46, s * 0.5], [-1.05, 0.46, s * 0.5], 0.12, 0.12, 0.012);
    k.box(P.paint, 1.5, 0.05, 0.9, 0, 0.52, 0, 0, 0, 0, 0.01);
    for (const s of [-1, 1]) k.beam(P.paint, [-0.9, 0.44, s * 0.5], [-2.3, 0.36, 0], 0.09, 0.09, 0.01);
    k.turn(P.dark, [[0.06, 0], [0.12, 0], [0.12, 0.05], [0.06, 0.05], [0.06, 0]], 8, -2.34, 0.33, 0);
    k.box(P.paint, 0.46, 0.2, 0.46, 0.0, 0.72, 0, 0, 0, 0, 0.02);
    for (const s of [-1, 1]) {
      k.box(P.paint, 0.5, 0.42, 0.05, 0.1, 0.98, s * 0.22, 0, 0, 0, 0.012);
      seat(k, P, -0.2, s * 0.62, -1, 0.64);
      handwheel(k, P, -0.05, 0.88, s * 0.4, 0.12);
      k.panel(P.paint, [[-0.28, 0], [0.28, 0], [0.28, 0.96], [-0.28, 0.96]], 0.03, 0.55, 0.86, s * 0.35, 12 * RAD);
      k.add(new THREE.BoxGeometry(0.05, 0.034, 0.3), P.owner, M(0.55 - 0.12, 1.8, s * 0.35).rz(12 * RAD));
    }
    k.add(G.star(0.1, { color: P.red, border: 0xece6d6 }), 0xffffff, G.place([0.55 + 0.05, 1.3, 0.35], [1, 0.2, 0], [-0.2, 1, 0], 1));
    ringSight(k, P.black, 0.25, 1.56, 0.7, 0.08);
  }
  const { g, muzzle } = aaGun(P, fac);
  k.group(g, M(P0[0], P0[1], 0).rz(e));
  const tip = [P0[0] + muzzle * Math.cos(e), P0[1] + muzzle * Math.sin(e), 0];
  return { geo: finish(k.geometry(), { span: 0.5 }), pivot: [0, 0, 0], tip };
}

// the twin gun of the flak position, standing in its sandbag ring (x forward). Its muzzles end at (0.95, 2.1, +-0.2).
function flakposGun(P) {
  const k = kit();
  k.turn(P.dark, [[0, 0], [0.32, 0], [0.32, 0.07], [0.2, 0.13], [0.17, 0.68], [0.27, 0.72], [0.27, 0.86], [0, 0.86]], 12, 0, 0, 0);
  for (const s of [-1, 1]) k.box(P.paint, 0.5, 0.42, 0.06, 0.0, 1.05, s * 0.31, 0, 0, 0, 0.012);
  k.box(P.paint, 0.3, 0.2, 0.7, -0.05, 0.9, 0, 0, 0, 0, 0.015);
  const e = 49 * RAD, P0 = [0.05, 1.05], sub = kit();
  for (const s of [-1, 1]) {
    sub.add(G.barrel(1.45, 0.04, { segments: 6 }), P.black, M(-0.12, 0, s * 0.2));
    sub.cyl(P.steel, 0.065, 0.065, 0.4, 8, 0.0, 0, s * 0.2, 'x');
    sub.box(P.black, 0.3, 0.16, 0.14, -0.2, 0, s * 0.2, 0, 0, 0, 0.012);
    sub.cyl(P.steel, 0.17, 0.17, 0.09, 12, -0.1, 0.24, s * 0.2, 'z');
    sub.cyl(P.brass, 0.1, 0.1, 0.095, 8, -0.1, 0.24, s * 0.2, 'z');
  }
  sub.box(P.paint, 0.08, 0.1, 0.5, -0.28, 0.0, 0, 0, 0, 0, 0.01);
  k.group(sub, M(P0[0], P0[1], 0).rz(e));
  for (const s of [-1, 1]) k.panel(P.paint, [[-0.2, 0], [0.2, 0], [0.2, 0.62], [-0.2, 0.62]], 0.03, 0.34, 0.85, s * 0.46, 22 * RAD);
  for (const s of [-1, 1]) k.add(new THREE.BoxGeometry(0.05, 0.034, 0.3), P.owner, M(0.34 - 0.18, 1.45, s * 0.46).rz(22 * RAD));
  return finish(k.geometry(), { dark: 0.78, span: 0.5 });
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
  else if (type === 'flakpos') m = { geo: flakposGun(P) };
  else return null;
  memo.set(key, m);
  return m;
}
