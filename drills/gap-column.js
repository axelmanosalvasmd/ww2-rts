// Twelve units ordered through the only gap in a wall (6 m, room for one tank or two squads abreast) should file
// through it, not jam in the mouth. params.kind: any ground unit type, or 'mixed' (rifles and light tanks in turn);
// default rifle. params.twoWay: half start north of the wall and cross south at the same time.
import { UNITS } from '../shared/sim.js';
import { facingSpots, slotSize } from '../shared/formation.js';
import { fixtureCommand } from '../test-fixtures.js';

export const about = 'How long does a group ordered through a narrow gap take to get through?';
const W = 60, H = 60, WALL = 30, GAP = 3, N = 12;
export const map = {
  w: W, h: H, spawns: [{ x: 5, y: 55 }, { x: 55, y: 5 }],
  rows: Array.from({ length: H }, (_, y) => y !== WALL ? '.'.repeat(W) : 'B'.repeat((W - GAP) / 2 | 0) + '.'.repeat(GAP) + 'B'.repeat(W - GAP - ((W - GAP) / 2 | 0))),
};
// A block of twelve 16 to 28 m south of the wall; the goal is 30 m north of it.
export const units = [
  ...Array.from({ length: N }, (_, i) => ({ owner: 0, type: 'rifle', x: 38 + (i % 6) * 9, z: 76 + Math.floor(i / 6) * 10, holdFire: true })),
  { owner: 1, type: 'rifle', x: 110, z: 10, holdFire: true },
];
export const seconds = 90;
const north = { x: 60, z: 30 }, south = { x: 60, z: 90 }, crossed = new Map(), goals = new Map();
// Whether a unit has cleared the wall on the side it was sent to.
const across = (u, goal) => goal === north ? u.z < WALL * 2 - 2 : u.z > WALL * 2 + 4;
function move(g, group, goal) {
  const c = { x: group.reduce((s, u) => s + u.x, 0) / group.length, z: group.reduce((s, u) => s + u.z, 0) / group.length };
  const spots = facingSpots(group.map(u => ({ id: u.id, x: u.x, z: u.z, size: slotSize(UNITS[u.type]) })), goal, Math.atan2(goal.z - c.z, goal.x - c.x), 0);
  const refused = fixtureCommand(g, 0, { t: 'move', orders: spots });
  if (refused) throw new Error('move refused: ' + refused);
}
export const script = [
  { at: 0, run: ({ g, units: placed, params }) => {
    crossed.clear(); goals.clear();
    const kind = params.kind ?? 'rifle', group = placed.slice(0, N);
    // Math.random is seeded per run: each seed shuffles the block up to 2 m and turns each unit a little.
    group.forEach((u, i) => {
      const type = kind === 'mixed' ? (i % 2 ? 'tank' : 'rifle') : kind, flip = params.twoWay && i % 2;
      Object.assign(u, { ghost: 0, x: u.x + (Math.random() - 0.5) * 4, z: u.z + (Math.random() - 0.5) * 4, rot: -Math.PI / 2 + (Math.random() - 0.5), type, hp: UNITS[type].hpPer * UNITS[type].models });
      if (flip) Object.assign(u, { z: 4 * WALL - u.z, rot: u.rot + Math.PI });
      goals.set(u.id, flip ? south : north);
    });
    for (const goal of [north, south]) { const side = group.filter(u => goals.get(u.id) === goal); if (side.length) move(g, side, goal); }
  } },
  // Note when each unit clears the wall, every half second.
  ...Array.from({ length: 180 }, (_, i) => ({ at: i / 2, run: ({ units: placed }) => {
    for (const u of placed.slice(0, N)) if (across(u, goals.get(u.id)) && !crossed.has(u.id)) crossed.set(u.id, i / 2);
  } })),
];

export function measure() {
  const at = [...crossed.values()].sort((a, b) => a - b);
  return { through: at.length, all: at.length === N, half: at[N / 2 - 1], last: at.length === N ? at.at(-1) : undefined };
}
