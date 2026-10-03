import { migrateWorldMap, worldLayers, composeWorldCell, BASE_SURFACES } from '../shared/world-layers.js';

export function editableLayers(map) {
  const migrated = migrateWorldMap(map), derived = worldLayers(migrated);
  return { w: map.w, h: map.h, ground: migrated.layers.ground.map(row => [...row]), objects: Array.from({ length: map.h }, (_, y) => derived.objects.slice(y * map.w, (y + 1) * map.w)), groundMaterials: derived.baseMaterials, objectMaterials: derived.objectMaterials, mineMaterials: derived.mineMaterials, mines: Array.from({ length: map.h }, (_, y) => [...derived.mineLayer.slice(y * map.w, (y + 1) * map.w)].map(value => value ? 'N' : '.')) };
}
export function layerRows(layers) {
  return layers.ground.map((row, y) => row.map((ground, x) => composeWorldCell(ground, layers.objects[y][x], layers.mines[y][x] === 'N')).join(''));
}
export function savedLayers(layers) {
  return { ground: layers.ground.map(row => row.join('')), objects: layers.objects.map(row => row.join('')), mines: layers.mines.map(row => row.join('')), mineMaterials: [...layers.mineMaterials].map(([c, material]) => ({ c, material })), groundMaterials: [...layers.groundMaterials].map(([c, material]) => ({ c, material })), objectMaterials: [...layers.objectMaterials].map(([c, material]) => ({ c, material })) };
}
export function paintLayer(layers, x, y, ch, erase = false, material = '') {
  if (!layers.ground[y]?.[x]) return;
  const c = y * layers.w + x, object = layers.objects[y][x] !== '.', surface = BASE_SURFACES.includes(ch);
  let materials = ch === 'N' ? layers.mineMaterials : surface ? layers.groundMaterials : layers.objectMaterials;
  if (erase) {
    if (layers.mines[y][x] === 'N') { layers.mines[y][x] = '.'; materials = layers.mineMaterials; }
    else if (object) { layers.objects[y][x] = '.'; materials = layers.objectMaterials; }
    else { layers.ground[y][x] = '.'; materials = layers.groundMaterials; }
    materials.delete(c);
  } else {
    if (ch === 'N') layers.mines[y][x] = 'N';
    else if (surface) layers.ground[y][x] = ch;
    else layers.objects[y][x] = ch;
    if (material) materials.set(c, material); else materials.delete(c);
  }
}
export function removeLayerSelection(layers, picked) {
  const target = picked.ch === 'N' ? layers.mines : BASE_SURFACES.includes(picked.ch) ? layers.ground : layers.objects;
  for (const [x, y] of picked.cells) { target[y][x] = '.'; (picked.ch === 'N' ? layers.mineMaterials : BASE_SURFACES.includes(picked.ch) ? layers.groundMaterials : layers.objectMaterials).delete(y * layers.w + x); }
}
export function moveLayerSelection(layers, picked, dx, dy, map) {
  const mine = picked.ch === 'N', object = !BASE_SURFACES.includes(picked.ch), target = mine ? layers.mines : object ? layers.objects : layers.ground;
  const source = new Set(picked.cells.map(([x, y]) => y * layers.w + x));
  if (picked.cells.some(([x, y]) => x + dx < 0 || x + dx >= layers.w || y + dy < 0 || y + dy >= layers.h
    || object && target[y + dy][x + dx] !== '.' && !source.has((y + dy) * layers.w + x + dx))) return false;
  const moved = picked.cells.map(([x, y]) => ({ x: x + dx, y: y + dy, value: target[y][x], material: (mine ? layers.mineMaterials : object ? layers.objectMaterials : layers.groundMaterials).get(y * layers.w + x) }));
  removeLayerSelection(layers, picked);
  for (const cell of moved) { target[cell.y][cell.x] = cell.value; if (cell.material) (mine ? layers.mineMaterials : object ? layers.objectMaterials : layers.groundMaterials).set(cell.y * layers.w + cell.x, cell.material); }
  for (const structure of mine ? [] : map.structures ?? []) if (structure.sections.some(section => source.has(section.c))) for (const section of structure.sections) if (source.has(section.c)) section.c += dy * layers.w + dx;
  picked.cells = moved.map(cell => [cell.x, cell.y]);
  return true;
}
export function pruneLayerStructures(map, layers) {
  for (const structure of map.structures ?? []) {
    const expected = structure.kind === 'bridge' ? '=' : 'B';
    structure.sections = structure.sections.filter(section => layers.objects[Math.floor(section.c / layers.w)]?.[section.c % layers.w] === expected);
    const ids = new Set(structure.sections.map(section => section.id));
    for (const section of structure.sections) section.supports = section.supports.filter(id => ids.has(id));
  }
  map.structures = (map.structures ?? []).filter(structure => structure.sections.length);
}
