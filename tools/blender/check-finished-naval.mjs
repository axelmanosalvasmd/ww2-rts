// Validate the actual authored payload, runtime adapter, source hashes and tint behavior.
import * as THREE from 'three';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bakedNavalModel } from '../../client/models/blender-baked.js';
import { navalModel } from '../../client/models/naval.js';
import { MATS } from '../../client/models/geom.js';
export async function checkFinishedNaval(path = 'client/models/naval-finished-data.js') {
const payloadPath = resolve(path);
const payload = (await import(pathToFileURL(payloadPath))).default;
const reports = [];
for (const [path, expected] of Object.entries(payload.source.files)) {
  const actual = createHash('sha256').update(await readFile(path)).digest('hex');
  if (actual !== expected) throw new Error(`Stale authored payload: ${path}`);
}
for (const key of Object.keys(payload.models)) {
  const [type, faction] = key.split('|'), fac = Number(faction);
  const look = {color: 0x3b73d6, vehicle: 0x59623d};
  const model = bakedNavalModel(payload, type, fac, look);
  const source = navalModel(type, fac, look);
  if (JSON.stringify(model.mounts ?? []) !== JSON.stringify(source.mounts ?? []) || JSON.stringify(model.tip ?? null) !== JSON.stringify(source.tip ?? null)) throw new Error('Mount or tip changed');
  if (model !== bakedNavalModel(payload, type, fac, look)) throw new Error('Geometry cache not reused');
  const alternate = bakedNavalModel(payload, type, fac, {...look, color: 0xff0000, vehicle: 0x4e5a38});
  if (model === alternate) throw new Error('Paint schemes share mutable geometry');
  const parts = {};
  for (const name of ['hull', 'turret']) {
    const g = model[name]; if (!g) continue;
    const P = g.attributes.position, N = g.attributes.normal, M = g.attributes.matId;
    for (const [attribute, spec] of Object.entries(g.attributes)) {
      if (spec.count !== P.count || !Array.from(spec.array).every(Number.isFinite)) throw new Error(`Invalid ${key} ${name} ${attribute}`);
    }
    if (Array.from(M.array).some((m) => m !== Math.floor(m) || m < -2 || m >= MATS.length)) throw new Error('Interpolated material tags');
    const index = g.index.array;
    if (index.length % 3 || Array.from(index).some((i) => i >= P.count)) throw new Error('Invalid triangle indices');
    let minArea = Infinity, maxNormalError = 0, minWindingDot = Infinity;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let at = 0; at < index.length; at += 3) {
      a.fromBufferAttribute(P,index[at]); b.fromBufferAttribute(P,index[at+1]); c.fromBufferAttribute(P,index[at+2]);
      const face=b.sub(a).cross(c.sub(a));
      const normal = new THREE.Vector3().fromBufferAttribute(N,index[at]).add(new THREE.Vector3().fromBufferAttribute(N,index[at+1])).add(new THREE.Vector3().fromBufferAttribute(N,index[at+2]));
      minArea = Math.min(minArea, face.lengthSq());
      minWindingDot=Math.min(minWindingDot,face.dot(normal));
    }
    for (let at = 0; at < N.count; at++) maxNormalError = Math.max(maxNormalError, Math.abs(Math.hypot(N.getX(at),N.getY(at),N.getZ(at))-1));
    if (minArea <= 1e-15 || minWindingDot < -1e-8 || maxNormalError > 1e-4) throw new Error('Invalid face or normals');
    const sourceBounds = new THREE.Box3().setFromBufferAttribute(source[name].attributes.position);
    const tolerance = payload.source.settings.width * 3 + 1e-4;
    for (const bound of ['min','max']) for (const axis of ['x','y','z']) if (Math.abs(g.boundingBox[bound][axis]-sourceBounds[bound][axis]) > tolerance) throw new Error('Finishing changed bounds unexpectedly');
    parts[name] = {triangles:index.length/3, vertices:P.count, minArea,maxNormalError,minWindingDot,materialIds:[...new Set(M.array)]};
  }
  const count = parts.hull.triangles + (parts.turret?.triangles ?? 0) * (model.mounts?.length ?? 1);
  const budgets = {lcvp:15000,gunboat:30000,destroyer:50000};
  if (count > budgets[type]) throw new Error(`Excessive mesh budget ${type}: ${count}`);
  reports.push({key,triangles:count,parts});
}
return {payload:payloadPath,models:reports};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = await checkFinishedNaval(process.argv[2]);
  console.log(JSON.stringify(report,null,2));
  if (process.argv[3]) await writeFile(resolve(process.argv[3]),JSON.stringify(report,null,2)+'\n');
}
