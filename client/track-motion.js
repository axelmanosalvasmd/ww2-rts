import * as THREE from 'three';

const samples = 1024, rows = 128, pixels = new Float32Array(samples * rows * 4);
const texture = new THREE.DataTexture(pixels, samples, rows, THREE.RGBAFormat, THREE.FloatType);
texture.magFilter = texture.minFilter = THREE.NearestFilter;
const profiles = [], keys = new Map(), attributes = new WeakMap();
export const trackUniform = { value: texture };

function register(loop) {
  const key = JSON.stringify(loop.points);
  if (keys.has(key)) return keys.get(key);
  const row = profiles.length;
  if (row >= rows) throw new Error('Native track path table is full');
  const arc = [0], points = loop.points;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    arc.push(arc[i] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const length = arc.at(-1);
  let segment = 0;
  for (let i = 0; i < samples; i++) {
    const distance = i * length / samples;
    while (segment < points.length - 1 && arc[segment + 1] < distance) segment++;
    const a = points[segment], b = points[(segment + 1) % points.length];
    const fraction = (distance - arc[segment]) / (arc[segment + 1] - arc[segment]);
    pixels.set([a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction, length, 0], (row * samples + i) * 4);
  }
  profiles.push({ length }); keys.set(key, row); texture.needsUpdate = true;
  return row;
}

export function trackAttribute(source) {
  const attr = source.attributes.trackData;
  if (!attr) return null;
  if (!attributes.has(attr)) {
    const ids = source.userData.trackLoops.map(register), out = attr.clone();
    for (let i = 0; i < out.count; i++) if (out.getY(i) >= 0) out.setY(i, ids[out.getY(i)]);
    attributes.set(attr, out);
  }
  return attributes.get(attr);
}

export const trackShader = `
uniform sampler2D uTrackPaths;
attribute vec4 trackData;
vec4 trackFrame(float phase) {
  float at = fract(phase) * 1024.0;
  int index = int(floor(at)), row = int(trackData.y);
  vec4 a = texelFetch(uTrackPaths, ivec2(index, row), 0);
  vec4 b = texelFetch(uTrackPaths, ivec2((index + 1) % 1024, row), 0);
  return vec4(mix(a.xy, b.xy, fract(at)), normalize(b.xy - a.xy));
}
vec2 trackTurn(vec2 point, vec4 a, vec4 b) {
  float c = dot(a.zw, b.zw), s = a.z * b.w - a.w * b.z;
  return vec2(c * point.x - s * point.y, s * point.x + c * point.y);
}
vec4 trackDestination() {
  float length = texelFetch(uTrackPaths, ivec2(0, int(trackData.y)), 0).z;
  return trackFrame(trackData.x - (wheelTravel.x + wheelTravel.y * trackData.z) / length);
}
`;

// CPU readback uses the same sampled path as the shader for workshop contact and motion inspection.
function frame(id, phase) {
  const at = ((phase % 1 + 1) % 1) * samples, index = Math.floor(at), fraction = at - index;
  const a = (id * samples + index) * 4, b = (id * samples + (index + 1) % samples) * 4;
  const dx = pixels[b] - pixels[a], dy = pixels[b + 1] - pixels[a + 1], length = Math.hypot(dx, dy);
  return [pixels[a] + dx * fraction, pixels[a + 1] + dy * fraction, dx / length, dy / length];
}
export function trackVertex(geometry, index, travel, turn) {
  const P = geometry.attributes.position, T = geometry.attributes.trackData;
  const point = new THREE.Vector3().fromBufferAttribute(P, index);
  if (!T || T.getY(index) < 0) return point;
  const id = T.getY(index), a = frame(id, T.getX(index));
  const b = frame(id, T.getX(index) - (travel + turn * T.getZ(index)) / pixels[id * samples * 4 + 2]);
  const c = a[2] * b[2] + a[3] * b[3], s = a[2] * b[3] - a[3] * b[2];
  const x = point.x - a[0], y = point.y - a[1];
  return point.set(b[0] + c * x - s * y, Math.max(T.getW(index), b[1] + s * x + c * y), point.z);
}

export function trackLength(geometry, index) {
  return pixels[geometry.attributes.trackData.getY(index) * samples * 4 + 2];
}
