// Reconstruct Blender-finished local geometry once per faction and paint scheme.
// The authoring payload carries linear vertex colors and separate owner/vehicle tint weights.
import * as THREE from 'three';

const caches = new WeakMap();
const ARRAY_TYPES = { f32: Float32Array, u32: Uint32Array, u16: Uint16Array };

// Decode the shared asset once while its ES module loads. Model construction stays synchronous.
export async function inflateModelArrays(encoded) {
  const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).json();
}

function unpack(spec) {
  const Type = ARRAY_TYPES[spec.type];
  if (!Type) throw new Error(`Unsupported Blender array type: ${spec.type}`);
  const binary = atob(spec.data), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  if (bytes.byteLength % Type.BYTES_PER_ELEMENT) throw new Error('Truncated Blender geometry array');
  return new Type(bytes.buffer);
}

function geometry(spec, owner, vehicle) {
  const g = new THREE.BufferGeometry(), masks = {};
  for (const [name, attr] of Object.entries(spec.attributes)) {
    const values = unpack(attr);
    if (name === 'ownerTint' || name === 'vehicleTint') masks[name] = values;
    else g.setAttribute(name, new THREE.BufferAttribute(values, attr.itemSize));
  }
  g.setIndex(new THREE.BufferAttribute(unpack(spec.index), 1));
  const colors = g.attributes.color;
  for (let i = 0; i < colors.count; i++) {
    const o = masks.ownerTint?.[i] ?? 0, v = masks.vehicleTint?.[i] ?? 0;
    colors.setXYZ(i, colors.getX(i) + owner.r * o + vehicle.r * v,
      colors.getY(i) + owner.g * o + vehicle.g * v, colors.getZ(i) + owner.b * o + vehicle.b * v);
  }
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

export function bakedNavalModel(payload, type, faction, look) {
  if (payload.format !== 'ww2-blender-naval-v1') throw new Error('Unsupported Blender naval payload');
  let cache = caches.get(payload);
  if (!cache) caches.set(payload, cache = new Map());
  const key = `${type}|${faction}|${look.vehicle}|${look.color}`;
  if (cache.has(key)) return cache.get(key);
  const spec = payload.models[`${type}|${faction}`];
  if (!spec) throw new Error(`Missing Blender naval model: ${type}/${faction}`);
  const owner = new THREE.Color(look.color), vehicle = new THREE.Color(look.vehicle);
  const result = { hull: geometry(spec.hull, owner, vehicle) };
  if (spec.turret) result.turret = geometry(spec.turret, owner, vehicle);
  if (spec.mounts) result.mounts = spec.mounts.map((at) => [...at]);
  if (spec.tip) result.tip = [...spec.tip];
  cache.set(key, result);
  return result;
}
