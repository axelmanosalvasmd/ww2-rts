import * as THREE from 'three';
import { trackUniform, trackAttribute, trackShader } from './track-motion.js';

const angle = value => Math.atan2(Math.sin(value), Math.cos(value));
const sideAttributes = new WeakMap();

// The authored wheels have local z axles. Static vertices have a zero radius.
export function wheelAngle(pivot, travel, turn) {
  return pivot[3] > 0 ? -(travel + turn * (pivot[4] ?? pivot[2])) / pivot[3] : 0;
}

export function wheelMaterial(material) {
  const before = material.onBeforeCompile, key = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    shader.uniforms.uTrackPaths = trackUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 wheelPivot;
attribute float wheelSide;
attribute vec2 wheelTravel;
${trackShader}
vec2 rotateWheel(vec2 point) {
  float a = wheelPivot.w > 0.0 ? -(wheelTravel.x + wheelTravel.y * wheelSide) / wheelPivot.w : 0.0;
  float c = cos(a), s = sin(a);
  return vec2(c * point.x - s * point.y, s * point.x + c * point.y);
}`)
      .replace('#include <skinnormal_vertex>', `#include <skinnormal_vertex>
objectNormal.xy = rotateWheel(objectNormal.xy);
if (trackData.y >= 0.0) objectNormal.xy = trackTurn(objectNormal.xy, trackFrame(trackData.x), trackDestination());`)
      .replace('#include <skinning_vertex>', `#include <skinning_vertex>
#ifdef MODEL_TEX
  // Texture coordinates remain in the wheel's authored space as its surface turns.
  if (wheelPivot.w > 0.0 || trackData.y >= 0.0) vModelNormal = normal;
#endif
transformed.xy = wheelPivot.xy + rotateWheel(transformed.xy - wheelPivot.xy);
if (trackData.y >= 0.0) {
  vec4 startTrack = trackFrame(trackData.x), endTrack = trackDestination();
  transformed.xy = endTrack.xy + trackTurn(transformed.xy - startTrack.xy, startTrack, endTrack);
  transformed.y = max(transformed.y, trackData.w);
}`);
  };
  material.customProgramCacheKey = () => `native-wheels-tracks|${key()}`;
  material.defaultAttributeValues = { ...material.defaultAttributeValues, wheelPivot: [0, 0, 0, 0], wheelSide: [0], wheelTravel: [0, 0], trackData: [0, -1, 0, 0] };
  return material;
}

const depth = wheelMaterial(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }));
const distance = wheelMaterial(new THREE.MeshDistanceMaterial());

// One instance supplies two motion values per vehicle, while all native vertex buffers stay shared.
export function wheelMesh(source, material) {
  if (!source.attributes.wheelPivot) return new THREE.Mesh(source, material);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = source.index; geometry.attributes = { ...source.attributes };
  const tracks = trackAttribute(source);
  if (tracks) geometry.setAttribute('trackData', tracks);
  if (!sideAttributes.has(source)) {
    const pivots = source.attributes.wheelPivot, centers = new Set();
    if (tracks) for (let i = 0; i < tracks.count; i++) if (tracks.getY(i) >= 0) centers.add(tracks.getZ(i));
    const sides = new Float32Array(pivots.count), candidates = [...centers];
    for (let i = 0; i < pivots.count; i++) {
      const z = pivots.getZ(i);
      sides[i] = candidates.reduce((best, side) => Math.abs(side - z) < Math.abs(best - z) ? side : best, z + 1000);
      if (!candidates.length) sides[i] = z;
    }
    sideAttributes.set(source, new THREE.BufferAttribute(sides, 1));
  }
  geometry.setAttribute('wheelSide', sideAttributes.get(source));
  geometry.userData = source.userData;
  geometry.boundingBox = source.boundingBox; geometry.boundingSphere = source.boundingSphere;
  geometry.instanceCount = 1;
  const travel = new THREE.InstancedBufferAttribute(new Float32Array(2), 2).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('wheelTravel', travel);
  // Disposing a vehicle frees its motion buffer and binding, without freeing another hull's shared buffers.
  geometry.dispose = function () {
    const attributes = this.attributes, index = this.index;
    this.attributes = { wheelTravel: travel }; this.index = null;
    THREE.BufferGeometry.prototype.dispose.call(this);
    this.attributes = attributes; this.index = index;
  };
  const mesh = new THREE.Mesh(geometry, material);
  mesh.customDepthMaterial = depth; mesh.customDistanceMaterial = distance;
  mesh.userData.wheelTravel = travel;
  return mesh;
}

export function moveWheels(v, dt) {
  let motion = v.wheelMotion;
  if (!motion) {
    const meshes = [], pivots = new Map();
    v.root.traverse(mesh => {
      if (!mesh.userData.wheelTravel) return;
      meshes.push(mesh);
      const attr = mesh.geometry.attributes.wheelPivot;
      for (let i = 0; i < attr.count; i++) if (attr.getW(i) > 0) {
        const pivot = [attr.getX(i), attr.getY(i), attr.getZ(i), attr.getW(i), mesh.geometry.attributes.wheelSide.getX(i)];
        pivots.set(pivot.join(','), pivot);
      }
    });
    motion = v.wheelMotion = { meshes, pivots: [...pivots.values()], travel: 0, turn: 0 };
  }
  if (!motion.meshes.length) return;
  const p = v.root.position, yaw = v.root.rotation.y;
  const dx = p.x - (motion.x ?? p.x), dy = p.y - (motion.y ?? p.y), dz = p.z - (motion.z ?? p.z);
  const turn = angle(yaw - (motion.yaw ?? yaw)), horizontal = Math.hypot(dx, dz);
  const skip = !(dt > 0) || !v.root.visible || motion.hidden || Math.hypot(dx, dy, dz) > 8;
  const middle = yaw - turn / 2;
  Object.assign(motion, { x: p.x, y: p.y, z: p.z, yaw, hidden: !v.root.visible });
  if (skip) return;
  // Height contributes travel on hills; suspension heave and settling do not move the gameplay root.
  const forward = dx * Math.cos(middle) - dz * Math.sin(middle);
  motion.travel += horizontal > 1e-9 ? forward * Math.hypot(horizontal, dy) / horizontal : 0;
  motion.turn += turn;
  if (!forward && !turn) return;
  for (const mesh of motion.meshes) {
    mesh.userData.wheelTravel.setXY(0, motion.travel, motion.turn);
    mesh.userData.wheelTravel.needsUpdate = true;
  }
}

export function releaseWheels(v) {
  v.root.traverse(mesh => { if (mesh.userData.wheelTravel) mesh.geometry.dispose(); });
}
