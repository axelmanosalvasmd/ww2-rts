// Export unbaked naval geometry, with owner and vehicle paint isolated as masks.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { navalModel } from '../../client/models/naval.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
const types = option('--types', 'lcvp,gunboat,destroyer').split(',');
const factions = option('--factions', '0,1,2,3').split(',').map(Number);
if (types.some((t) => !['lcvp', 'gunboat', 'destroyer'].includes(t))) throw new Error('Unsupported naval type');
if (factions.some((f) => !Number.isInteger(f) || f < 0 || f > 3)) throw new Error('Unsupported faction');
const output = resolve(option('--output', `${root}/.cache/blender-mcp/naval-source.json`));
const models = {};
const sources = {};
for (const file of ['client/models/naval.js', 'client/models/geom.js']) sources[file] = createHash('sha256').update(await readFile(`${root}/${file}`)).digest('hex');
for (const type of types) for (const fac of factions) {
  const raw = navalModel(type, fac, { color: 0xff00ff, vehicle: 0x00ffff });
  const model = { mounts: raw.mounts ?? [], tip: raw.tip ?? null };
  for (const part of ['hull', 'turret']) {
    const geo = raw[part]; if (!geo) continue;
    const attributes = {};
    for (const [name, a] of Object.entries(geo.attributes)) attributes[name] = { itemSize: a.itemSize, array: Array.from(a.array) };
    const color = attributes.color.array, ownerTint = [], vehicleTint = [];
    for (let i = 0; i < color.length; i += 3) {
      const owner = color[i] > 0 && color[i + 1] === 0 && color[i + 2] === color[i];
      const vehicle = color[i] === 0 && color[i + 1] > 0 && color[i + 2] === color[i + 1];
      ownerTint.push(owner ? color[i] : 0); vehicleTint.push(vehicle ? color[i + 1] : 0);
      if (owner || vehicle) color.fill(0, i, i + 3);
    }
    attributes.ownerTint = { itemSize: 1, array: ownerTint };
    attributes.vehicleTint = { itemSize: 1, array: vehicleTint };
    const count = attributes.position.array.length / 3;
    const index = geo.index ? Array.from(geo.index.array) : Array.from({ length: count }, (_, i) => i);
    if (!Object.values(attributes).every((a) => a.array.length === count * a.itemSize && a.array.every(Number.isFinite))) throw new Error(`Invalid attributes in ${type}|${fac}|${part}`);
    if (index.length % 3 || index.some((i) => i < 0 || i >= count)) throw new Error('Invalid indices');
    model[part] = { attributes, index };
  }
  models[`${type}|${fac}`] = model;
}
const payload = { format: 'ww2-blender-naval-source-v1', source: { files: sources, navalSha256: sources['client/models/naval.js'], axes: 'local Three.js x,y,z', color: 'linear fixed RGB plus ownerTint/vehicleTint masks; matId is unbaked' }, models };
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(payload));
console.log(JSON.stringify({ output, source: payload.source, models: Object.entries(models).map(([key, m]) => ({ key, triangles: Object.fromEntries(['hull', 'turret'].filter((p) => m[p]).map((p) => [p, m[p].index.length / 3])) })) }, null, 2));
