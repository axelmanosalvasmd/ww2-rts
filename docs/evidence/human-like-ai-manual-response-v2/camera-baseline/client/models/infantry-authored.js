import * as THREE from 'three';
import source from './infantry-authored-data.js';
import { matId } from './geom.js';

const V = p => p.isVector3 ? p.clone() : new THREE.Vector3(...p);
const inverse = source.rest.map(m => new THREE.Matrix4().fromArray(m).invert());
const p = source.attributes.position, n = source.attributes.normal;
const uv = source.attributes.uv, joints = source.attributes.joints, weights = source.attributes.weights;
const count = p.length / 3;
const sourceGrey = new THREE.Color(0x5d6668);
// The other factions retain their own shells or caps around the same fitted head.
const dressedBody = [], bareHead = [];
for (let i = 0; i < source.indices.length; i += 3) {
  const triangle = source.indices.slice(i, i + 3);
  const x = triangle.reduce((sum, v) => sum + p[v * 3], 0) / 3;
  const y = triangle.reduce((sum, v) => sum + p[v * 3 + 1], 0) / 3;
  const z = triangle.reduce((sum, v) => sum + p[v * 3 + 2], 0) / 3;
  // Fitted closed grips replace the reference's open hands at the sleeve cuffs.
  if (y < .715 && Math.abs(z) > .285) continue;
  dressedBody.push(...triangle);
  if (y < 1.23 || (y < 1.295 && x > .075 && triangle.every(v => Math.abs(p[v*3+2]) < .082))) bareHead.push(...triangle);
}

function frame(a, b, up = new THREE.Vector3(1, 0, 0)) {
  const x = V(b).sub(a).normalize(), y = V(up).addScaledVector(x, -up.dot(x));
  if (y.lengthSq() < 1e-10) y.set(0, 0, 1).addScaledVector(x, -x.z);
  y.normalize();
  return new THREE.Matrix4().makeBasis(x, y, new THREE.Vector3().crossVectors(x, y).normalize()).setPosition(a);
}

function transforms(r) {
  const deltas = [r.body.B, r.body.U,
    r.H.clone().multiply(new THREE.Matrix4().makeTranslation(-0.085, -1.27, -0.008))];
  const fittedFrame = (a, b, up) => {
    const index = deltas.length;
    const scale = a.distanceTo(b) / source.lengths[index];
    deltas.push(frame(a, b, up).scale(new THREE.Vector3(scale, 1, 1)));
  };
  for (let side = 0; side < 2; side++) {
    const leg = r.legs[side], arm = r.arms[side];
    const forward = new THREE.Vector3(1, 0, 0).transformDirection(r.body.U);
    const fore = arm.hand.clone().sub(arm.elbow).normalize();
    const wrist = arm.hand.clone().addScaledVector(fore, -0.040);
    const handUp = r.W ? new THREE.Vector3(...(side === 0 ? [0, -1, 0] : [0, 0, 1])).transformDirection(r.W) : forward;
    fittedFrame(leg.hip, leg.knee, leg.pole);
    fittedFrame(leg.knee, leg.ankle, leg.pole);
    fittedFrame(leg.ankle, leg.ankle.clone().addScaledVector(leg.toe, .13), leg.knee.clone().sub(leg.ankle).normalize());
    fittedFrame(arm.sho, arm.elbow, forward);
    fittedFrame(arm.elbow, wrist, handUp);
    fittedFrame(wrist, wrist.clone().addScaledVector(fore, .075), handUp);
  }
  return deltas.map((matrix, i) => i < 3 ? matrix : matrix.multiply(inverse[i]));
}

// Blender supplies the rest mesh, UVs and fitted weights. Only its poses are baked here,
// so the existing instanced crowd renderer retains one draw for each uniform and kit.
export function authoredInfantry(r, ctx) {
  const matrices = transforms(r), normals = matrices.map(m => new THREE.Matrix3().getNormalMatrix(m));
  const positions = new Float32Array(p.length), normal = new Float32Array(n.length);
  const colors = new Float32Array(p.length), coords = new Float32Array(p.length), materials = new Float32Array(count);
  const color = new THREE.Color(ctx.F.tunic);
  const tint = [color.r / sourceGrey.r, color.g / sourceGrey.g, color.b / sourceGrey.b];
  const point = new THREE.Vector3(), direction = new THREE.Vector3(), sum = new THREE.Vector3(), sumN = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    sum.set(0, 0, 0); sumN.set(0, 0, 0);
    for (let k = 0; k < 4; k++) {
      const weight = weights[i * 4 + k];
      if (!weight) continue;
      const bone = joints[i * 4 + k];
      sum.addScaledVector(point.fromArray(p, i * 3).applyMatrix4(matrices[bone]), weight);
      sumN.addScaledVector(direction.fromArray(n, i * 3).applyMatrix3(normals[bone]), weight);
    }
    sum.toArray(positions, i * 3); sumN.normalize().toArray(normal, i * 3);
    const cloth = source.attributes.fabric?.[i] ?? 0;
    materials[i] = matId(cloth > .5 ? 'wool' : 'plain');
    for (let k = 0; k < 3; k++) colors[i * 3 + k] = 1 + (tint[k] - 1) * cloth;
    coords[i * 3] = uv[i * 2]; coords[i * 3 + 1] = uv[i * 2 + 1]; coords[i * 3 + 2] = 1 + cloth;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('modelUV', new THREE.BufferAttribute(coords, 3));
  geometry.setAttribute('matId', new THREE.BufferAttribute(materials, 1));
  geometry.setIndex(ctx.fac === 1 ? dressedBody : bareHead);
  return geometry;
}
