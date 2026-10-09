// Map version 2 stores surfaces separately from placed objects. Legacy mines and rubble use open ground.
export const WORLD_VERSION = 2;
export const BASE_SURFACES = '.D+MWF';
export const OBJECT_TYPES = '.BH#TXY=RNAQKO';
// World Conquest region looks (shared/world-conquest.js). Clients get the index per discovered cell, never the region list.
export const BIOMES = ['farmland', 'pine', 'marsh', 'highland', 'orchard', 'steppe'];
export const MATERIALS = Object.freeze({
  soil: Object.freeze({ name: 'soil', hardness: 0.12, absorption: 0.9, rebound: 0.02, crater: 1, fire: 0 }),
  road: Object.freeze({ name: 'road', hardness: 0.45, absorption: 0.65, rebound: 0.12, crater: 0.5, fire: 0 }),
  wood: Object.freeze({ name: 'wood', hardness: 0.3, absorption: 0.8, rebound: 0.05, crater: 0, fire: 1 }),
  stone: Object.freeze({ name: 'stone', hardness: 0.85, absorption: 0.3, rebound: 0.55, crater: 0, fire: 0.4 }),
  concrete: Object.freeze({ name: 'concrete', hardness: 0.95, absorption: 0.25, rebound: 0.65, crater: 0, fire: 0.2 }),
  steel: Object.freeze({ name: 'steel', hardness: 1, absorption: 0.15, rebound: 0.75, crater: 0, fire: 0 }),
  water: Object.freeze({ name: 'water', hardness: 0, absorption: 1, rebound: 0, crater: 0, fire: 0 }),
});
export const composeWorldCell = (ground, object, mine = false) => mine ? 'N' : object && object !== '.' ? object : ground;
export const defaultMaterial = (ground, object = '.') => 'QY'.includes(object) ? 'steel' : '#BR'.includes(object) ? 'stone'
  : 'HK=TOXA'.includes(object) ? 'wood' : ground === 'D' ? 'road' : 'WF'.includes(ground) ? 'water' : 'soil';
export function migrateWorldMap(map) {
  if (map.worldVersion === WORLD_VERSION && map.layers) return structuredClone(map);
  const ground = [], objects = [], mines = [];
  for (const row of map.rows) {
    ground.push([...row].map(ch => BASE_SURFACES.includes(ch) ? ch : ch === '=' ? 'W' : '.').join(''));
    objects.push([...row].map(ch => BASE_SURFACES.includes(ch) || ch === 'N' ? '.' : ch).join(''));
    mines.push([...row].map(ch => ch === 'N' ? 'N' : '.').join(''));
  }
  return { ...structuredClone(map), worldVersion: WORLD_VERSION, layers: { ground, objects, mines } };
}
export function validateWorldLayers(map) {
  if (map.worldVersion !== undefined && map.worldVersion !== WORLD_VERSION) return 'worldVersion must be 2';
  if (map.layers === undefined) return map.worldVersion === WORLD_VERSION ? 'version 2 needs world layers' : null;
  if (map.worldVersion !== WORLD_VERSION) return 'world layers need worldVersion 2';
  for (const [key, allowed] of [['ground', BASE_SURFACES], ['objects', OBJECT_TYPES.replace(/[AKQ]/g, '')]]) {
    const rows = map.layers[key];
    if (!Array.isArray(rows) || rows.length !== map.h || rows.some(row => typeof row !== 'string' || row.length !== map.w || [...row].some(ch => !allowed.includes(ch)))) return `layers.${key} must contain ${map.h} rows of ${map.w} valid cells`;
  }
  if (map.layers.mines !== undefined && (!Array.isArray(map.layers.mines) || map.layers.mines.length !== map.h || map.layers.mines.some(row => typeof row !== 'string' || row.length !== map.w || !/^[.N]*$/.test(row)))) return 'layers.mines must contain valid rows of mine markers';
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
    const ground = map.layers.ground[y][x], authoredObject = map.layers.objects[y][x], object = authoredObject === 'N' ? '.' : authoredObject, mine = authoredObject === 'N' || map.layers.mines?.[y]?.[x] === 'N';
    if (composeWorldCell(ground, object, mine) !== map.rows[y][x]) return 'rows must match the composed world layers';
    if (mine && 'WF'.includes(ground)) return 'mines need dry ground';
    if (object === '=' && ground !== 'W') return 'bridge sections need water below them';
    if (object !== '.' && object !== '=' && 'WF'.includes(ground)) return 'land objects need dry ground';
  }
  for (const key of ['materials', 'groundMaterials', 'objectMaterials', 'mineMaterials']) {
    const list = map.layers[key];
    if (list !== undefined && (!Array.isArray(list) || list.length > map.w * map.h
      || list.some(row => !row || !Number.isInteger(row.c) || row.c < 0 || row.c >= map.w * map.h || !Object.hasOwn(MATERIALS, row.material))
      || new Set(list.map(row => row.c)).size !== list.length)) return 'materials need unique valid cells and material names';
  }
  return null;
}
export function worldLayers(map) {
  const migrated = migrateWorldMap(map), ground = [...migrated.layers.ground.join('')], authoredObjects = [...migrated.layers.objects.join('')], objects = authoredObjects.map(ch => ch === 'N' ? '.' : ch), mineLayer = Uint8Array.from(authoredObjects, (ch, c) => ch === 'N' || migrated.layers.mines?.[Math.floor(c / map.w)]?.[c % map.w] === 'N' ? 1 : 0);
  const legacy = new Map((migrated.layers.materials ?? []).map(row => [row.c, row.material]));
  const baseMaterials = new Map([...legacy].filter(([c]) => objects[c] === '.' && authoredObjects[c] !== 'N'));
  const objectMaterials = new Map([...legacy].filter(([c]) => objects[c] !== '.'));
  const mineMaterials = new Map([...legacy].filter(([c]) => mineLayer[c] && authoredObjects[c] === 'N'));
  for (const row of migrated.layers.groundMaterials ?? []) baseMaterials.set(row.c, row.material);
  for (const row of migrated.layers.objectMaterials ?? []) (authoredObjects[row.c] === 'N' ? mineMaterials : objectMaterials).set(row.c, row.material);
  for (const row of migrated.layers.mineMaterials ?? []) mineMaterials.set(row.c, row.material);
  const materials = new Map([...baseMaterials].filter(([c]) => objects[c] === '.'));
  for (const [c, material] of objectMaterials) if (objects[c] !== '.') materials.set(c, material);
  for (let c = 0; c < objects.length; c++) if (objects[c] === 'R' && !materials.has(c)) materials.set(c, 'stone');
  return { ground, objects, mineLayer, materials, baseMaterials, objectMaterials, mineMaterials };
}

export function mapForClient(map) {
  const result = migrateWorldMap(map);
  result.rows = result.rows.map((row, y) => [...row].map((ch, x) => ch === 'N' ? composeWorldCell(result.layers.ground[y][x], result.layers.objects[y][x] === 'N' ? '.' : result.layers.objects[y][x]) : ch).join(''));
  result.layers.objects = result.layers.objects.map(row => row.replaceAll('N', '.'));
  result.layers.mines = result.rows.map(row => '.'.repeat(row.length));
  const hidden = new Set((map.layers?.objects ?? map.rows).flatMap((row, y) => [...row].flatMap((ch, x) => ch === 'N' ? [y * map.w + x] : [])));
  if (result.layers.materials) result.layers.materials = result.layers.materials.filter(row => !hidden.has(row.c));
  if (result.layers.mineMaterials) result.layers.mineMaterials = [];
  if (result.layers.objectMaterials) result.layers.objectMaterials = result.layers.objectMaterials.filter(row => !hidden.has(row.c));
  // Authoring triggers contain future world changes and are server data.
  delete result.triggers; delete result.scenario;
  return result;
}
