// Authored presentation fixtures. The workshop drives a scripted path, without simulation navigation or gravity.
import { CELL } from '../shared/sim.js';
import { generateWorldMap } from '../shared/world-conquest.js';

export const TERRAIN_SCENARIOS = [
  { id: 'ramp', name: 'Mountain climb and descent', description: 'A four-level mountain with a plateau and matching descent.' },
  { id: 'cross', name: 'Cross slope', description: 'Travel across the side of a mountain. The downhill track should sit lower.' },
  { id: 'hill', name: 'Rounded hill', description: 'A rounded four-level hill tests how adjoining ramps blend around a summit.' },
  { id: 'generated', name: 'Generated World Conquest hill', description: 'The full 512 by 512 game map, seed 20261003. Cross an ordinary hillside near cell 122,40.' },
  { id: 'cliff', name: 'Ramp beside a cliff', description: 'An ordinary ramp reaches a plateau beside a two-level cliff. The wall remains vertical.' },
  { id: 'crest', name: 'Narrow crest', description: 'A one-cell ridge tests ground support between the front and rear of the hull.' },
  { id: 'trench', name: 'Trench crossing', description: 'Cross the actual relief mesh trench cut, then return to level ground.' },
  { id: 'flat', name: 'Flat ground', description: 'Level ground checks normal suspension motion and ground clearance.' },
];
export const TERRAIN_TYPES = ['tank', 'medium', 'tiger', 'churchill', 'armoredcar', 'halftrack', 'flaktrack', 'rocket', 'tankdestroyer'];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function terrainFixture(id = 'ramp') {
  const scenario = TERRAIN_SCENARIOS.find(s => s.id === id);
  if (!scenario) throw new Error(`Unknown terrain scenario: ${id}`);
  if (id === 'generated') {
    const map = generateWorldMap({ seed: 20261003, size: 'huge', players: 4 });
    const length = 26 * CELL;
    return { ...scenario, map, length,
      point(distance) { return { x: 113 * CELL + clamp(Number(distance) || 0, 0, length), z: 40.5 * CELL, rot: 0 }; },
    };
  }
  const w = 32, h = 20;
  const level = (x, z) => {
    if (id === 'ramp') return clamp(Math.min(x - 6, 23 - x), 0, 4);
    if (id === 'cross') return clamp(z - 8, 0, 4);
    if (id === 'hill') return clamp(Math.floor(5 - Math.hypot((x - 15.5) * 0.65, (z - 10) * 0.9)), 0, 4);
    if (id === 'cliff') return x >= 12 ? 4 : clamp(x - 6, 0, 2);
    if (id === 'crest') return x === 11 ? 1 : 0;
    return 0;
  };
  const rows = Array.from({ length: h }, (_, z) => Array.from({ length: w }, (_, x) => id === 'trench' && x >= 13 && x <= 15 && z >= 5 && z <= 14 ? 'T' : '.').join(''));
  const heights = Array.from({ length: h }, (_, z) => Array.from({ length: w }, (_, x) => String(level(x, z))).join(''));
  const start = { x: 3 * CELL, z: 10.5 * CELL }, end = { x: 29 * CELL, z: start.z };
  const length = end.x - start.x;
  return {
    ...scenario, map: { name: scenario.name, w, h, rows, heights }, length,
    point(distance) { return { x: start.x + clamp(Number(distance) || 0, 0, length), z: start.z, rot: 0 }; },
  };
}
