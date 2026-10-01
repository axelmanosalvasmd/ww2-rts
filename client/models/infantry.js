// Infantry figures: every soldier of every squad (riflemen, rangers, conscripts, engineers, snipers and the crews of
// the MG, mortar, AT gun and flak), near and far, ready for client/unit-models.js to bake. The guns themselves are
// built there, not here.
//
// A figure is a painted miniature at heroic proportions (a slightly big head, hands and weapon) on a round base.
// A small rig places the hips, knees, ankles, shoulders and hands for each job, the torso leans and turns at the
// waist, and the arms reach the weapon by two-bone IK. Everything but the base merges into one vertex-colored
// geometry: faction paint, webbing and kit, the owner's color in the helmet, then a painter's pass that darkens
// toward the feet and lightens faces that look up. The far model comes from the same rig with far fewer faces.
// unit-models.js keeps the posture system: it bakes the base first (its vertices carry the level morphs) and the body
// after it, so each soldier stays one draw of the shared vertex-colored material.
//
// Axes: +x forward, +y up, +z the soldier's right. Units are the soldier's own (unit-models.js scales a man by 1.35,
// conscripts by 1.25); the feet stand on the base top at y = 0.07. Each weapon's muzzle sits where client/fx.js
// HAND (and BAZ for the bazooka) puts the muzzle flash.
import * as THREE from 'three';
import { merge, helmet, loft, tube, lathe, extrudeProfile, star, ao } from './geom.js';

const Y = new THREE.Vector3(0, 1, 0), ONE = new THREE.Vector3(1, 1, 1), I4 = new THREE.Matrix4();
const V = (p) => (p.isVector3 ? p.clone() : new THREE.Vector3(p[0], p[1], p[2]));
const smooth = (t) => { const k = Math.min(1, Math.max(0, t)); return k * k * (3 - 2 * k); };
// a steady pseudo-random number in [0, 1) for a point: paint mottling that is the same on every build
const hash = (x, y, z) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };
// one of the colors in list, in patches about 1 / scale across
const pick = (list, p, scale) => list[Math.floor(hash(Math.round(p.x * scale), Math.round(p.y * scale), Math.round(p.z * scale)) * list.length)];
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
// translation, XYZ rotation and an even scale as a matrix
const TR = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(s, s, s));

const FEET = 0.07, SKIN = 0xd2a998, STEEL = 0x34332f, BRASS = 0xb08b3c, AMMO = 0x4c5232, OD = 0x525a36, ROLL = 0x5f5a4b, RED = 0xb8322a;
// faction paint: tunic, trousers, boots, leggings or puttees (null: tall jackboots), webbing, packs and bags, the
// helmet and its kind, rifle wood, and the rifle, submachine gun and carbine models
const FACTIONS = [
  // USA: olive drab wool, khaki canvas webbing and leggings, brown boots, the M1 helmet with its net
  { tunic: 0x626a55, legs: 0x5b604f, boots: 0x4f3725, wrap: 0xa49d84, web: 0x979179, bag: 0x7a7550, helmet: 0x5b6438, kind: 'm1', wood: 0x7d5532, rifle: 'garand', smg: 'thompson', carbine: 'carbine' },
  // Germany: field grey, black leather Y-straps and jackboots, bread bag, mess tin and gas mask can
  { tunic: 0x5c625e, legs: 0x545956, boots: 0x23211d, wrap: null, web: 0x252320, bag: 0x7e704e, helmet: 0x596152, kind: 'stahlhelm', wood: 0x60402a, rifle: 'kar98', smg: 'mp40', carbine: 'kar98' },
  // USSR: khaki gymnastyorka, puttees over ankle boots, brown leather, the rolled greatcoat
  { tunic: 0x8a8468, legs: 0x787258, boots: 0x272420, wrap: 0x8d8366, web: 0x5e4733, bag: 0x6e624a, helmet: 0x4f5a36, kind: 'ssh40', wood: 0x714728, rifle: 'mosin', smg: 'ppsh', carbine: 'mosin' },
];
// the owner's color, as a share mixed into the faction paint: a trace in the helmet or cap, more in the far model's
// headgear, most of it in the band around the helmet (or the armband under a cap or hood)
const OWN = { helmet: 0.06, far: 0.15, band: 0.8 };
// snipers, by helmet kind: camouflage patch colors (the German pea dots, the American and Soviet ghillie greens),
// the far model's single color, and the ghillie lathe profile ([radius, height]; the Germans wear no ghillie)
const CAMO = { m1: [0x626a55, 0x4a5530, 0x6b5a3a, 0x8a8456], stahlhelm: [0x6f6c42, 0x4b5631, 0x6a5a3c, 0x93905e], ssh40: [0x58613a, 0x3f4a2a, 0x76704a, 0x5e5236] };
const CAMO_FAR = { m1: 0x5c6236, stahlhelm: 0x676743, ssh40: 0x55603a };
const CAPE = { m1: [[0.07, 1.1], [0.21, 1.02], [0.25, 0.78]], ssh40: [[0.07, 1.1], [0.21, 1.02], [0.26, 0.78], [0.29, 0.4]] };

// ---------------------------------------------------------------- jobs and poses

// What soldier i of a squad does: his pose, weapon and load. unit-models.js keys the bake cache on it.
export function soldierKit(type, i) {
  switch (type) {
    case 'rifle': case 'conscript': return i === 0 ? 'leader' : 'rifle';
    case 'ranger': return i % 3 === 1 ? 'bazooka' : 'smg';
    case 'sniper': return i === 0 ? 'sniper' : 'spotter';
    case 'engineer': return 'engineer';
    case 'mg': return ['gunner', 'feeder'][i] ?? 'ammo';
    case 'mortar': return ['loader', 'ammo', 'spotter'][i] ?? 'ammo';
    case 'at': return ['gunner', 'shell', 'ammo', 'carbine'][i] ?? 'ammo';
    case 'flak': return ['shell', 'ammo', 'spotter'][i] ?? 'ammo';
    default: return 'rifle';
  }
}

// legs: hip height, left and right ankle, left and right foot turn (toes out); kneel puts the right knee down
const LEGS = {
  stand: [0.695, [0.02, 0.15, -0.1], [-0.02, 0.15, 0.1], 0.2, 0.2],
  stride: [0.68, [0.13, 0.15, -0.095], [-0.12, 0.15, 0.115], 0.12, 0.32],
  brace: [0.67, [0.13, 0.15, -0.15], [-0.11, 0.15, 0.16], 0.25, 0.5],
  kneel: [0.43, [0.24, 0.15, -0.11], [-0.27, 0.16, 0.12], 0.1, 0.1],
};
// Each job: legs; lean forward and turn at the waist (radians, a negative turn brings the left shoulder forward);
// head [turn back toward the front, nod]; the weapon [kind, muzzle point, pitch (null: rests on the shoulder),
// right and left hand along it as a share of its length] or free hands (absolute points); what else it carries.
// Muzzles as client/fx.js has them: rifle and conscript (0.72, 1.1, 0.2), ranger SMG (0.62, 0.9, 0.2), engineer
// (0.6, 1.0, 0.2), sniper (1.13, 1.08, 0.2) and the bazooka (0.63, 0.93, 0.25).
const JOBS = {
  rifle: { legs: 'stride', lean: 0.12, turn: -0.3, head: [0.25, 0.05], gun: ['rifle', [0.72, 1.1, 0.2], 0.3, 0.27, 0.56] },
  leader: { legs: 'brace', lean: 0.1, turn: -0.55, head: [0.5, 0.12], gun: ['smg', [0.72, 1.1, 0.2], 0.03, 0.4, 0.7] },
  smg: { legs: 'stride', lean: 0.16, turn: -0.25, head: [0.2, 0.08], gun: ['thompson', [0.62, 0.9, 0.2], 0.06, 0.38, 0.72] },
  bazooka: { legs: 'kneel', lean: 0.1, turn: -0.35, head: [0.45, 0.1], gun: ['bazooka', [0.63, 0.93, 0.25], null, 0.5, 0.7] },
  sniper: { legs: 'brace', lean: 0.12, turn: -0.6, head: [0.55, 0.14], gun: ['scoped', [1.13, 1.08, 0.2], 0.02, 0.2, 0.43] },
  engineer: { legs: 'stride', lean: 0.14, turn: -0.3, head: [0.25, 0.05], gun: ['carbine', [0.6, 1.0, 0.2], 0.28, 0.27, 0.56], pack: 1 },
  carbine: { legs: 'stand', lean: 0.06, turn: -0.3, head: [0.2, 0], gun: ['carbine', [0.6, 1.0, 0.2], 0.28, 0.27, 0.56] },
  spotter: { legs: 'stand', lean: 0.04, turn: 0, head: [0, 0.08], hold: 'binoculars', sling: 1 },
  gunner: { legs: 'kneel', lean: 0.32, turn: 0, head: [0, 0.2], hands: [[0.34, 0.5, 0.07], [0.38, 0.52, -0.07]], sling: 1 },
  ammo: { legs: 'stand', lean: 0.04, turn: 0.15, head: [-0.15, 0], hands: [[0.03, 0.6, 0.25], [0.12, 0.78, -0.2]], hold: 'box', sling: 1 },
  feeder: { legs: 'kneel', lean: 0.22, turn: -0.2, head: [0.05, 0.15], hands: [[0.24, 0.53, 0.13], [0.33, 0.47, 0.06]], hold: 'box', sling: 1 },
  loader: { legs: 'kneel', lean: 0.18, turn: 0, head: [0, 0.18], hands: [[0.3, 0.72, 0.06], [0.3, 0.72, -0.06]], hold: 'bomb', sling: 1 },
  shell: { legs: 'stand', lean: 0.08, turn: 0.1, head: [0, 0.1], hands: [[0.17, 0.86, 0.12], [0.17, 0.86, -0.12]], hold: 'shell', sling: 1 },
};

// ---------------------------------------------------------------- small shape helpers

// vertex colors from a function of a point and its normal (a hex number or a THREE.Color)
function paintBy(geo, fn) {
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const P = geo.attributes.position, N = geo.attributes.normal, out = new Float32Array(P.count * 3), c = new THREE.Color(), p = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < P.count; i++) { p.fromBufferAttribute(P, i); n.fromBufferAttribute(N, i); c.set(fn(p, n)); c.toArray(out, i * 3); }
  geo.setAttribute('color', new THREE.BufferAttribute(out, 3));
  return geo;
}
// a tapered open round rod from a (radius ra) to b (radius rb), as a part
function rod(a, b, ra, rb, sides, color) {
  const A = V(a), B = V(b), d = B.clone().sub(A);
  return { geo: new THREE.CylinderGeometry(rb, ra, d.length(), sides, 1, true), color, m: new THREE.Matrix4().compose(A.add(B).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(Y, d.normalize()), ONE) };
}
// the elbow (or knee) of a two-bone limb from a to c with bone lengths l1 and l2, bending toward pole
function bend(a, c, l1, l2, pole) {
  const A = V(a), d = V(c).sub(A), dist = Math.max(1e-4, Math.min(d.length(), (l1 + l2) * 0.999));
  d.normalize();
  const along = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist), h = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  const p = V(pole); p.addScaledVector(d, -p.dot(d)).normalize();
  return A.addScaledVector(d, along).addScaledVector(p, h).toArray();
}
// matrix whose +x runs from a toward b, +z as close to side as it can be, origin at a
function frame(a, b, side) {
  const x = V(b).sub(V(a)).normalize(), z = V(side).addScaledVector(x, -V(side).dot(x)).normalize(), y = new THREE.Vector3().crossVectors(z, x);
  return new THREE.Matrix4().makeBasis(x, y, z).setPosition(V(a));
}
// a boot seen from the side (heel at x = -0.075, toe at +0.155, sole on y = 0), 0.095 wide
const BOOT = extrudeProfile([[-0.075, 0], [0.13, 0], [0.155, 0.035], [0.09, 0.07], [-0.07, 0.078]], 0.105);

// ---------------------------------------------------------------- weapons and things carried

// A weapon in its own frame (+x from the butt at 0 to the muzzle at the returned length), as parts. Heroic sizes:
// a bit longer and thicker than true scale so it reads at game distance. kind: 'rifle', 'smg' and 'carbine' take
// the faction's model, 'scoped' is the faction rifle with a scope, 'thompson' and 'bazooka' are what they say.
// detail: 0 full, 1 far (one thin prism), 2 slung on a back (stock and barrel only).
const MODEL = { rifle: 'rifle', scoped: 'rifle', smg: 'smg', carbine: 'carbine' };
function weapon(kind, F, detail) {
  const model = MODEL[kind] ? F[MODEL[kind]] : kind, out = [], add = (geo, color, m = I4) => out.push({ geo, color, m });
  // a round piece along x from x0 to x1 at height y
  const X = (x0, x1, r, color, sides = 5, y = 0) => add(new THREE.CylinderGeometry(r, r, x1 - x0, sides, 1, true), color, TR((x0 + x1) / 2, y, 0, 0, 0, -Math.PI / 2));
  const rifle = model === 'garand' || model === 'kar98' || model === 'mosin' || model === 'carbine';
  const s = kind === 'carbine' ? 0.84 : 1, L = rifle ? (model === 'mosin' ? 0.97 : 0.92) * s * (kind === 'scoped' ? 1.18 : 1)
    : { thompson: 0.64, mp40: 0.64, ppsh: 0.68, bazooka: 1.15 }[model];
  const bayonet = model === 'mosin' && kind === 'rifle';
  if (detail === 1) {
    // far: one thin prism from the butt to the muzzle (a fat one for the bazooka), the bayonet with it
    const baz = model === 'bazooka';
    X(0, bayonet ? L + 0.24 : L, baz ? 0.05 : 0.03, baz ? OD : model === 'mp40' ? STEEL : F.wood, baz ? 4 : 3);
    return { parts: out, L };
  }
  if (rifle) {
    // stock and fore-end seen from the side, butt at x = 0, the bore line on y = 0
    const fore = L * (model === 'kar98' ? 0.74 : model === 'mosin' ? 0.8 : 0.72);
    add(extrudeProfile([[0, -0.08 * s], [0.025, -0.08 * s], [0.24 * s, -0.036], [0.3 * s, -0.042], [0.32 * s, -0.024], [fore, -0.02], [fore + 0.02, 0.002], [0.3 * s, 0.018], [0.2 * s, 0.006], [0, 0.014]], 0.042), F.wood);
    X(fore - 0.06, L, 0.012, STEEL, 4);
    if (detail === 2) return { parts: out, L };
    add(box(0.17 * s, 0.036, 0.034), STEEL, TR(0.37 * s, 0.014)); // receiver
    if (model === 'kar98' || model === 'mosin') add(box(0.014, 0.014, 0.05), STEEL, TR(0.33 * s, 0.02, 0.035)); // bolt handle
    if (model === 'garand') add(box(0.05, 0.022, 0.044), STEEL, TR(fore - 0.03, -0.004)); // front band
    if (bayonet) add(new THREE.CylinderGeometry(0, 0.011, 0.3, 3, 1), 0x8a8a84, TR(L + 0.14, -0.012, 0, 0, 0, -Math.PI / 2)); // the long spike bayonet
    if (kind === 'scoped') { X(0.3, 0.58, 0.021, 0x23221f, 6, 0.062); add(box(0.07, 0.035, 0.016), 0x23221f, TR(0.44, 0.035)); }
  } else if (model === 'thompson') {
    add(extrudeProfile([[0, -0.075], [0.025, -0.075], [0.19, -0.022], [0.2, 0.012], [0, 0.014]], 0.04), F.wood);
    add(box(0.21, 0.05, 0.036), STEEL, TR(0.3, 0.004));
    add(box(0.035, 0.08, 0.03), F.wood, TR(0.255, -0.05, 0, 0, 0, -0.25)); // pistol grip
    add(box(0.12, 0.035, 0.034), F.wood, TR(0.46, -0.012)); // fore-end
    add(box(0.03, 0.12, 0.022), STEEL, TR(0.34, -0.07)); // stick magazine
    X(0.4, L, 0.016, STEEL, 6);
  } else if (model === 'mp40') {
    X(0.17, 0.44, 0.022, STEEL, 6);
    add(box(0.18, 0.014, 0.036), STEEL, TR(0.09, -0.012)); // folding stock
    add(box(0.02, 0.07, 0.04), STEEL, TR(0.01, -0.03)); // butt plate
    add(box(0.035, 0.08, 0.03), 0x2f2924, TR(0.24, -0.055, 0, 0, 0, -0.25)); // grip
    add(box(0.03, 0.17, 0.024), STEEL, TR(0.34, -0.1)); // long magazine
    X(0.44, L, 0.011, STEEL);
  } else if (model === 'ppsh') {
    add(extrudeProfile([[0, -0.08], [0.025, -0.08], [0.2, -0.03], [0.36, -0.03], [0.36, 0.016], [0.2, 0.01], [0, 0.014]], 0.044), F.wood);
    X(0.36, 0.62, 0.024, STEEL, 6); // the perforated barrel jacket
    X(0.62, L, 0.016, STEEL);
    add(new THREE.CylinderGeometry(0.064, 0.064, 0.036, 8), STEEL, TR(0.33, -0.075, 0, Math.PI / 2)); // drum
  } else if (model === 'bazooka') {
    X(0.06, L, 0.042, OD, 8);
    add(new THREE.CylinderGeometry(0.042, 0.062, 0.09, 8, 1, true), OD, TR(0.02, 0, 0, 0, 0, -Math.PI / 2)); // flared back end
    add(box(0.2, 0.05, 0.03), F.wood, TR(0.5, -0.06)); // shoulder stock
    add(box(0.035, 0.09, 0.03), F.wood, TR(0.68, -0.07, 0, 0, 0, -0.2)); // grip
    add(box(0.04, 0.07, 0.11), 0x3c4228, TR(0.95, 0.02)); // blast shield
  }
  return { parts: out, L };
}

// things carried in the hands, in their own frame and centered: an ammo box, a shell or mortar bomb lying across
// (along z), binoculars looking along +x
function carried(kind, far) {
  if (kind === 'box') return [{ geo: box(0.21, 0.15, 0.1), color: AMMO }];
  if (far) return [{ geo: kind === 'binoculars' ? box(0.08, 0.05, 0.11) : box(0.08, 0.08, 0.3), color: kind === 'shell' ? BRASS : kind === 'bomb' ? 0x4f5536 : 0x2b2a26 }];
  if (kind === 'shell') return [{ geo: paintBy(lathe([[0, -0.17], [0.04, -0.17], [0.04, 0.05], [0.03, 0.09], [0, 0.17]], 6, { axis: 'z' }), (p) => (p.z > 0.06 ? 0x3d3f38 : BRASS)), color: 0xffffff }];
  if (kind === 'bomb') return [{ geo: paintBy(lathe([[0, -0.13], [0.026, -0.13], [0.014, -0.06], [0.04, 0.03], [0, 0.14]], 6, { axis: 'z' }), (p) => (Math.abs(p.z - 0.03) < 0.02 ? 0xb5a04a : 0x4f5536)), color: 0xffffff }];
  if (kind === 'binoculars') return [-1, 1].map((k) => ({ geo: new THREE.CylinderGeometry(0.024, 0.026, 0.08, 6), color: 0x2b2a26, m: TR(0, 0, k * 0.032, 0, 0, -Math.PI / 2) }));
  return [];
}

// ---------------------------------------------------------------- the figure

// far helmets: two bands of six sides, the rim flared for the Stahlhelm ([radius, height] in sizes)
const FAR_HELMET = { m1: [[1.16, -0.04], [0.85, 0.62], [0, 0.95]], stahlhelm: [[1.2, -0.12], [0.92, 0.5], [0, 1.0]], ssh40: [[1.06, -0.04], [0.88, 0.7], [0, 1.02]] };
// the owner's band around each helmet: top and bottom radius and middle height, in sizes (see geom.js helmet())
const BAND = { m1: [1.03, 1.04, 0.13], stahlhelm: [0.98, 1.04, 0.17], ssh40: [1.03, 1.04, 0.14] };
// a helmet of this kind and size, painted: a lighter crown like a dry-brushed highlight, the M1 mottled by its net;
// the far one has the owner's band painted on its rim
function paintedHelmet(kind, size, far, color, band) {
  const g = far ? lathe(FAR_HELMET[kind].map(([r, y]) => [r * size, y * size]), 6, { crease: 70 }) : helmet(kind, size, 8);
  const c = new THREE.Color(color), out = new THREE.Color();
  return paintBy(g, (p, n) => {
    if (far && p.y < 0.1 * size) return band;
    let k = 0.86 + 0.34 * smooth(p.y / size - 0.25) + 0.12 * Math.max(0, n.y);
    if (kind === 'm1' && !far) k *= 0.88 + 0.24 * hash(p.x * 9, p.y * 9, p.z * 9); // the net
    return out.copy(c).multiplyScalar(k);
  });
}

// One soldier's body (everything but the base) as one vertex-colored geometry. kit: his job (JOBS), F: faction
// paint, owner: the owner's color, far: the far model.
function figure(kit, F, owner, type, far) {
  const J = JOBS[kit], near = !far, parts = [], add = (geo, color, m = I4) => parts.push({ geo, color, m });
  const addAll = (list, m) => list.forEach((p) => add(p.geo, p.color, m.clone().multiply(p.m ?? I4)));
  const [hipY, ankL, ankR, outL, outR] = LEGS[J.legs], dy = hipY - 0.66, kneel = J.legs === 'kneel';
  const sniper = type === 'sniper', capped = type === 'conscript';
  // snipers' camouflage, as patches in the vertex colors: the German smock and trousers in pea dots, the American
  // and Soviet ghillie greens; the far model gets its average
  const camo = sniper && near ? CAMO[F.kind] : null, dots = camo && F.kind === 'stahlhelm';
  const camoPaint = (geo, scale) => paintBy(geo, (p) => pick(camo, p, scale));
  // the upper body leans forward and turns at the waist, more of it higher up; U is the full turn (shoulders up)
  const spine = (t) => new THREE.Matrix4().makeTranslation(0, hipY, 0).multiply(new THREE.Matrix4().makeRotationZ(-J.lean * t))
    .multiply(new THREE.Matrix4().makeRotationY(J.turn * t)).multiply(new THREE.Matrix4().makeTranslation(0, -hipY, 0));
  const waist = (y) => smooth((y - (0.6 + dy)) / 0.36), U = spine(1);
  const up = (p) => V(p).applyMatrix4(spine(waist(p[1])));
  // a part on the torso: placed upright (y as when standing) and carried along by the spine
  const onBody = (geo, color, x, y, z, rx = 0, ry = 0, rz = 0) => add(geo, color, spine(waist(y + dy)).multiply(TR(x, y + dy, z, rx, ry, rz)));

  // ---- legs: trousers to the ankle, then leggings, puttees or jackboots, and the boots
  for (const [s, ank, out] of [[-1, ankL, outL], [1, ankR, outR]]) {
    const hip = up([0, hipY, s * 0.09]).toArray();
    let knee = bend(hip, ank, 0.3, 0.29, [1, 0.1, s * 0.25]);
    if (kneel) knee = s > 0 ? [-0.04, 0.12, 0.12] : [0.26, 0.42, -0.11]; // the right knee down, the left foot forward
    const K = V(knee), A = V(ank);
    if (far) {
      // one thin tube, boots painted on below mid-shin
      const mid = (K.y + A.y) / 2;
      add(paintBy(tube([hip, knee, ank], (u) => 0.095 - 0.024 * u, { segments: 2, radial: 3, caps: false }), (p) => (p.y < mid + 0.02 ? F.boots : F.legs)), 0xffffff);
      continue;
    }
    const leg = tube([hip, knee, ank], (u) => 0.1 - 0.034 * u, { segments: 4, radial: 5, caps: false });
    add(dots ? camoPaint(leg, 16) : leg, dots ? 0xffffff : F.legs);
    // the lower leg: tall boots to below the knee, leggings and puttees halfway
    parts.push(rod(A.clone().lerp(K, -0.05), A.clone().lerp(K, F.wrap ? 0.52 : 0.78), 0.062, F.wrap ? 0.068 : 0.074, 5, F.wrap ?? F.boots));
    // the boot: heel under the ankle, toes forward and a little out; the kneeling back foot lies flat, toes back
    add(BOOT, F.boots, kneel && s > 0 ? TR(ank[0] - 0.03, FEET, ank[2], 0, Math.PI, 0) : TR(ank[0] + 0.01, FEET, ank[2], 0, -out * s, 0));
  }

  // ---- torso: a loft of rings from the hips to the neck ([height, width, depth, forward]), the tunic flaring over
  // the hips; built upright, then each vertex leans and turns with the spine at its height
  const RINGS = [[0.56, 0.27, 0.19, 0], [0.64, 0.32, 0.215, 0], [0.78, 0.3, 0.205, 0.006], [0.9, 0.345, 0.235, 0.014], [0.99, 0.4, 0.22, 0.004], [1.05, 0.31, 0.175, -0.008], [1.09, 0.13, 0.11, 0]];
  const torso = loft((near ? RINGS : [RINGS[0], RINGS[4], RINGS[6]]).map(([y, w, d, x]) => ({ x: y + dy, w, h: d, y: -x, p: 2.3 })), { segments: near ? 8 : 6, normals: 70, caps: false });
  torso.rotateZ(Math.PI / 2);
  {
    const P = torso.attributes.position, N = torso.attributes.normal, p = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3();
    for (let i = 0; i < P.count; i++) {
      p.fromBufferAttribute(P, i);
      const m = spine(waist(p.y));
      n.fromBufferAttribute(N, i).applyMatrix3(nm.getNormalMatrix(m)).normalize(); p.applyMatrix4(m);
      P.setXYZ(i, p.x, p.y, p.z); N.setXYZ(i, n.x, n.y, n.z);
    }
  }
  if (camo) camoPaint(torso, dots ? 16 : 12);
  add(torso, camo ? 0xffffff : sniper ? CAMO_FAR[F.kind] : F.tunic);

  // ---- neck, head and headgear; the head turns back toward the front by `look` and nods
  const [look, nod] = J.head, headAt = new THREE.Vector3(0.016, 1.2 + dy, 0).applyMatrix4(U);
  const H = new THREE.Matrix4().extractRotation(U).multiply(TR(0, 0, 0, 0, look, -nod)).setPosition(headAt);
  if (near) parts.push(rod(new THREE.Vector3(0, 1.03 + dy, 0).applyMatrix4(U), new THREE.Vector3(0.01, 1.13 + dy, 0).applyMatrix4(U), 0.058, 0.052, 5, SKIN));
  const R = 0.124, head = near ? new THREE.SphereGeometry(R, 8, 4) : new THREE.SphereGeometry(R, 5, 2);
  head.scale(1, 1.06, 0.94);
  if (capped && near) paintBy(head, (p) => (p.y > 0.03 || (p.x < -0.055 && p.y > -0.03) ? 0x3a2a1c : SKIN)); // short hair under the cap
  add(head, capped && near ? 0xffffff : SKIN, H);
  // the owner's color: the helmet or cap takes a little of it, a painted band (an armband under a cap or hood)
  // most of it; the far model, too small for a band, takes more of it in the headgear
  const own = new THREE.Color(owner), band = new THREE.Color(F.helmet).lerp(own, OWN.band);
  const tint = (c, k = near ? OWN.helmet : OWN.far) => new THREE.Color(c).lerp(own, k);
  let armband = false;
  if (capped) {
    // pilotka: a boat-shaped side cap tipped to the right, a red star at the front
    const ring = (x, h, w) => ({ x, pts: [[w, 0], [w * 0.55, h * 0.75], [0, h], [-w * 0.55, h * 0.75], [-w, 0]] });
    const cap = loft([ring(-0.15, 0.075, 0.07), ring(-0.05, 0.095, 0.085), ring(0.06, 0.095, 0.085), ring(0.15, 0.065, 0.065)], { normals: 45 });
    const capM = H.clone().multiply(TR(-0.005, 0.07, 0.018, 0.2, 0, 0.06));
    add(cap, tint(F.helmet), capM);
    if (near) add(star(0.028, { color: RED }), 0xffffff, capM.clone().multiply(TR(0.14, 0.048, 0, 0, Math.PI / 2, 0)));
    armband = true;
  } else if (sniper && F.kind === 'ssh40') {
    // Soviet sniper: the hood of the ghillie suit, open at the face
    const g = near ? camoPaint(new THREE.SphereGeometry(R * 1.3, 8, 4, Math.PI + 0.85, Math.PI * 2 - 1.7, 0, Math.PI * 0.62), 20) : new THREE.SphereGeometry(R * 1.3, 5, 2, 0, Math.PI * 2, 0, Math.PI * 0.6);
    add(g, near ? 0xffffff : tint(CAMO_FAR.ssh40), H);
    armband = true;
  } else {
    const size = F.kind === 'stahlhelm' ? 0.158 : F.kind === 'ssh40' ? 0.162 : 0.166, lift = F.kind === 'stahlhelm' ? 0.03 : F.kind === 'ssh40' ? 0.01 : 0.015;
    const hm = H.clone().multiply(TR(-0.01, lift, 0, 0, 0, 0.06));
    // the German sniper's helmet wears a cover in the smock's pattern
    const lid = paintedHelmet(F.kind, size, far, tint(F.helmet), band);
    add(dots ? camoPaint(lid, 45) : lid, 0xffffff, hm);
    if (near) {
      // the band: an open ring just outside the helmet's side, the same eight sides so it hugs it
      const [top, bottom, y] = BAND[F.kind], g = new THREE.CylinderGeometry(top * size, bottom * size, 0.11 * size, 8, 1, true);
      if (F.kind === 'stahlhelm') g.scale(1.08, 1, 0.97);
      add(g, band, hm.clone().multiply(TR(0, y * size, 0)));
    }
    if (near && F.kind === 'ssh40') add(star(0.03, { color: RED }), 0xffffff, hm.clone().multiply(TR(size * 0.97, size * 0.42, 0, 0, Math.PI / 2, -0.35)));
    if (sniper && near && !dots) {
      // burlap strips and foliage over the American sniper's helmet
      const g = paintBy(new THREE.SphereGeometry(size * 1.08, 8, 3, 0, Math.PI * 2, 0, Math.PI / 2), (p) => pick([0x6b6a40, 0x4a5530, 0x7c6a44], p, 30));
      const P = g.attributes.position;
      for (let i = 0; i < P.count; i++) P.setY(i, P.getY(i) + 0.025 * hash(P.getX(i) * 50, 1, P.getZ(i) * 50));
      add(g, 0xffffff, hm.clone().multiply(TR(0, 0.012, 0)));
    }
  }

  // ---- the weapon or what the hands hold, then the arms reach it: shoulder, elbow by IK, hand
  let hands = J.hands;
  if (J.gun) {
    const [kind, muzzle, pitch, tR, tL] = J.gun, g = weapon(kind, F, far ? 1 : 0);
    // the bazooka tips so its tube rests on the right shoulder
    const sh = up([0, 1.0 + dy, 0.175]), p = pitch ??Math.atan2(muzzle[1] - (sh.y + 0.08), muzzle[0] - sh.x);
    const d = new THREE.Vector3(Math.cos(p), Math.sin(p), 0), W = frame(V(muzzle).addScaledVector(d, -g.L), muzzle, [0, 0, 1]);
    addAll(g.parts, W);
    hands = [tR, tL].map((t) => new THREE.Vector3(g.L * t, -0.03, 0).applyMatrix4(W).toArray());
  }
  if (J.hold) {
    let m;
    if (J.hold === 'binoculars') {
      m = H.clone().multiply(TR(0.155, 0.0, 0));
      hands = [[0.0, -0.035, 0.045], [0.0, -0.035, -0.045]].map((h) => V(h).applyMatrix4(m).toArray());
    } else if (J.hold === 'box') m = TR(hands[0][0], hands[0][1] - 0.085, hands[0][2] + 0.01);
    else { const mid = V(hands[0]).add(V(hands[1])).multiplyScalar(0.5); m = TR(mid.x + 0.02, mid.y, mid.z); }
    addAll(carried(J.hold, far), m);
  }
  for (const [s, hand] of [[1, hands[0]], [-1, hands[1]]]) {
    const sh = up([0, 1.0 + dy, s * 0.175]).toArray(), elbow = bend(sh, hand, 0.27, 0.26, [-0.35, -1, s * 0.75]);
    const arm = tube([sh, elbow, hand], (u) => 0.068 - 0.02 * u, { segments: near ? 4 : 2, radial: near ? 5 : 3, caps: false });
    add(camo ? camoPaint(arm, 16) : arm, camo ? 0xffffff : sniper ? CAMO_FAR[F.kind] : F.tunic);
    if (near) add(new THREE.IcosahedronGeometry(0.05, 0), SKIN, new THREE.Matrix4().compose(V(hand), new THREE.Quaternion(), new THREE.Vector3(1.15, 0.95, 0.9)));
    // the owner's armband on the left upper arm, when there is no helmet to carry the band
    if (near && armband && s < 0) parts.push(rod(V(sh).lerp(V(elbow), 0.3), V(sh).lerp(V(elbow), 0.58), 0.072, 0.07, 6, band));
  }

  // ---- webbing and kit
  if (near) {
    const belt = new THREE.CylinderGeometry(1, 1, 0.05, 8, 1, true);
    belt.scale(0.112, 1, 0.16);
    onBody(belt, F.web, 0.006, 0.78, 0);
    const smock = sniper; // the sniper's smock and cape cover the straps and the back
    if (F.kind === 'm1') {
      // cartridge belt pouches, suspenders, canteen at the left hip, a small pack on the back
      for (const z of [-0.08, 0.08]) onBody(box(0.045, 0.065, 0.1), F.web, 0.112, 0.77, z, 0, z > 0 ? -0.35 : 0.35);
      if (!smock) for (const z of [-0.09, 0.09]) onBody(box(0.012, 0.25, 0.032), F.web, 0.114, 0.9, z, 0, 0, -0.12);
      onBody(new THREE.CylinderGeometry(0.045, 0.045, 0.11, 6), 0x6a6844, -0.06, 0.69, -0.155);
      if (!J.pack && !smock) onBody(box(0.09, 0.18, 0.2), F.bag, -0.15, 0.92, 0);
    } else if (F.kind === 'stahlhelm') {
      // ammo pouches, Y-straps, bread bag, mess tin and gas mask can, entrenching tool
      for (const z of [-0.085, 0.085]) onBody(box(0.05, 0.06, 0.11), F.web, 0.112, 0.77, z, 0, z > 0 ? -0.35 : 0.35);
      if (!smock) {
        for (const z of [-0.085, 0.085]) onBody(box(0.012, 0.26, 0.028), F.web, 0.114, 0.92, z, 0, 0, -0.12);
        onBody(box(0.012, 0.3, 0.028), F.web, -0.116, 0.92, 0, 0, 0, 0.1);
      }
      onBody(box(0.065, 0.12, 0.14), F.bag, -0.045, 0.68, 0.17, 0, 0.35, 0);
      if (!J.pack) onBody(box(0.055, 0.1, 0.09), 0x4b5141, -0.12, 0.72, 0.13, 0, 0.6, 0);
      onBody(new THREE.CylinderGeometry(0.048, 0.048, 0.21, 6), 0x56604e, -0.14, 0.72, -0.07, -0.2, 0, 0.35);
      onBody(box(0.03, 0.15, 0.08), 0x3e3a30, -0.02, 0.66, -0.17, 0.15, 0, 0.2);
    } else {
      // two brown ammo pouches, the rolled greatcoat over the left shoulder, the sack on the back
      for (const z of [-0.08, 0.08]) onBody(box(0.05, 0.065, 0.085), F.web, 0.112, 0.77, z, 0, z > 0 ? -0.35 : 0.35);
      if (!smock) {
        const sh = up([0, 1.07 + dy, -0.13]), hip = up([0, 0.7 + dy, 0.17]), c = sh.clone().add(hip).multiplyScalar(0.5), u = hip.clone().sub(sh), hl = u.length() / 2 + 0.07;
        u.normalize();
        const fwd = new THREE.Vector3(1, 0, 0).transformDirection(U), path = [];
        for (let k = 0; k < 9; k++) { const a = (k / 9) * Math.PI * 2; path.push(c.clone().addScaledVector(u, Math.cos(a) * hl).addScaledVector(fwd, Math.sin(a) * 0.165)); }
        add(tube(path, 0.064, { closed: true, segments: 9, radial: 4 }), ROLL);
        if (!J.pack) onBody(box(0.09, 0.16, 0.18), F.bag, -0.145, 0.86, 0.02);
      }
    }
    if (J.pack) {
      // engineer: a big pack with the shovel strapped on, a satchel charge at the left hip on its strap
      onBody(box(0.13, 0.27, 0.26), F.bag, -0.185, 0.9, 0);
      onBody(box(0.018, 0.5, 0.018), F.wood, -0.26, 1.05, 0.08, 0, 0, 0.12);
      onBody(box(0.016, 0.14, 0.11), STEEL, -0.29, 1.33, 0.08, 0, 0, 0.12);
      onBody(box(0.075, 0.1, 0.16), 0x6e6545, 0.02, 0.66, -0.18, 0, 0.25, 0);
      onBody(box(0.012, 0.42, 0.03), 0x6e6545, 0.122, 0.86, 0.0, 0.85, 0, -0.1);
    }
    if (J.sling) {
      // the rifle slung across the back, butt at the right hip, muzzle over the left shoulder at ear height
      addAll(weapon('rifle', F, 2).parts, spine(1).multiply(frame([-0.17, 0.55 + dy, 0.19], [-0.17, 1.2 + dy, -0.2], [-1, 0, 0])));
    }
    if (sniper && CAPE[F.kind]) {
      // ghillie: the American cape over the shoulders, the Soviet cloak to the shins, both with a ragged hem
      const g = lathe(CAPE[F.kind], 10, { crease: 80 }), P = g.attributes.position;
      for (let i = 0; i < P.count; i++) if (P.getY(i) < 0.9) P.setY(i, P.getY(i) - 0.07 * hash(P.getX(i) * 40, 2, P.getZ(i) * 40));
      g.scale(0.85, 1, 1); g.translate(0, dy, 0);
      add(paintBy(g, (p) => pick(CAMO.ssh40, p, 25)), 0xffffff, U);
    }
  } else {
    // far: only what changes the outline
    if (J.pack) onBody(box(0.13, 0.27, 0.26), F.bag, -0.185, 0.9, 0);
    else if (F.kind === 'ssh40' && !capped && !sniper) onBody(box(0.24, 0.42, 0.07), ROLL, 0, 0.88, 0, -0.6, 0, 0);
    if (sniper && CAPE[F.kind]) { const g = lathe(CAPE[F.kind].filter((_, k) => k !== 1), F.kind === 'ssh40' ? 5 : 6, { crease: 80 }); g.translate(0, dy, 0); add(g, CAMO_FAR.ssh40, U); }
  }

  // ---- paint: darker toward the feet, faces that look up a little lighter, faces that look down darker
  const body = merge(parts.map((p) => ({ geo: p.geo, color: p.color, matrix: p.m })));
  return ao(body, { falloff: (p, n) => (0.72 + 0.28 * smooth((p.y - FEET) / 0.45)) * (1 + 0.14 * Math.max(0, n.y)) * (1 - 0.22 * Math.max(0, -n.y)) });
}

// the round base: a dark beveled rim and an earthy top with a little variation
const BASES = [12, 6].map((sides) => paintBy(lathe([[0.36, 0], [0.3, 0.07], [0, 0.07]], sides, { crease: 30 }),
  (p) => (Math.hypot(p.x, p.z) > 0.31 || p.y < 0.06 ? 0x2b2a22 : pick([0x4b4a2c, 0x56572f, 0x4f4430], p, 31))));

// Soldier i of a squad of this type, faction fac and owner look f ({ color, uniform }): the near and far figures as
// groups of parts for unit-models.js bakeMeshes() (the base first, then the body), and the kit name for its cache.
const bodies = new Map();
export function soldier(type, fac, i, f) {
  const kit = soldierKit(type, i), F = FACTIONS[fac] ?? { ...FACTIONS[0], tunic: f.uniform };
  const group = (far) => {
    const key = `${type}|${fac}|${f.color}|${kit}|${far}`;
    if (!bodies.has(key)) bodies.set(key, figure(kit, F, f.color, type, far));
    const g = new THREE.Group();
    for (const geo of [BASES[far], bodies.get(key)]) { const o = new THREE.Object3D(); o.userData.geo = geo; o.userData.paint = 0xffffff; g.add(o); }
    return g;
  };
  return { kit, near: group(0), far: group(1) };
}
