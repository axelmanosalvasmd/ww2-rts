import * as THREE from 'three';

const identity = new THREE.Matrix4();
const lengths = points => {
  const out = [0];
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    out.push(out[i] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  return out;
};

// Preserve the native support band while complete tread links circulate above it.
export function tagTrack(geometry, points, side, original = geometry) {
  const P = geometry.attributes.position, source = original.attributes.position;
  let floor = Infinity;
  for (let i = 0; i < source.count; i++) floor = Math.min(floor, source.getY(i));
  const support = [];
  for (let i = 0; i < source.count; i++) {
    support.push(source.getX(i), source.getY(i), source.getZ(i));
  }
  const arc = lengths(points), total = arc.at(-1), data = new Float32Array(P.count * 4);
  for (let i = 0; i < P.count; i++) {
    let best = Infinity, along = 0;
    for (let j = 0; j < points.length; j++) {
      const a = points[j], b = points[(j + 1) % points.length], dx = b[0] - a[0], dy = b[1] - a[1];
      const square = dx * dx + dy * dy;
      if (square < 1e-16) continue;
      const t = Math.max(0, Math.min(1, ((P.getX(i) - a[0]) * dx + (P.getY(i) - a[1]) * dy) / square));
      const distance = (P.getX(i) - a[0] - dx * t) ** 2 + (P.getY(i) - a[1] - dy * t) ** 2;
      if (distance < best) { best = distance; along = arc[j] + Math.sqrt(square) * t; }
    }
    data.set([along / total, 0, side, floor], i * 4);
  }
  geometry.setAttribute('trackData', new THREE.BufferAttribute(data, 4));
  geometry.userData.trackLoops = [{ points: points.map(p => p.slice()) }];
  geometry.userData.trackSupport = support;
  return geometry;
}

// Native track transforms are translations, uniform scales and reflections across z.
export function mergeTracks(parts) {
  if (!parts.some(p => p.geo.attributes.trackData)) return null;
  const count = parts.reduce((n, p) => n + p.geo.attributes.position.count, 0);
  const data = new Float32Array(count * 4), loops = [], support = [], point = new THREE.Vector3();
  for (let i = 1; i < data.length; i += 4) data[i] = -1;
  let offset = 0;
  for (const p of parts) {
    const geo = p.geo, attr = geo.attributes.trackData, matrix = p.matrix ?? p.m ?? identity;
    const base = loops.length;
    for (const loop of geo.userData.trackLoops ?? []) loops.push({ points: loop.points.map(([x, y]) => {
      point.set(x, y, 0).applyMatrix4(matrix); return [point.x, point.y];
    }) });
    const band = geo.userData.trackSupport ?? [];
    for (let i = 0; i < band.length; i += 3) point.fromArray(band, i).applyMatrix4(matrix).toArray(support, support.length);
    if (attr) for (let i = 0; i < attr.count; i++) if (attr.getY(i) >= 0) {
      point.set(0, attr.getW(i), attr.getZ(i)).applyMatrix4(matrix);
      data.set([attr.getX(i), base + attr.getY(i), point.z, point.y], (offset + i) * 4);
    }
    offset += geo.attributes.position.count;
  }
  return { data, loops, support };
}

export function applyTracks(geometry, tracks) {
  if (tracks) {
    geometry.setAttribute('trackData', new THREE.BufferAttribute(tracks.data, 4));
    geometry.userData.trackLoops = tracks.loops; geometry.userData.trackSupport = tracks.support;
  }
  return geometry;
}

export function scaleTracks(geometry, scale) {
  const attr = geometry.attributes.trackData;
  if (attr) for (let i = 0; i < attr.count; i++) if (attr.getY(i) >= 0) {
    attr.setZ(i, attr.getZ(i) * scale); attr.setW(i, attr.getW(i) * scale);
  }
  for (const loop of geometry.userData.trackLoops ?? []) for (const p of loop.points) { p[0] *= scale; p[1] *= scale; }
  const support = geometry.userData.trackSupport ?? [];
  for (let i = 0; i < support.length; i++) support[i] *= scale;
  return geometry;
}
