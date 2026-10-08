// Where each man of an infantry squad stands, in the squad's own frame (+x forward, metres before SLOT_SCALE).
// The client draws men on these slots (client/unit-models.js) and the server tests the operative's shots against
// them (shared/sim.js fireOperative), so the soldier you see is the soldier you hit.
// Line infantry is drawn as a block of ranks with more men than the sim counts (def.models), front rank first, so
// health maps onto the men drawn (menDrawn) and the rear ranks thin out as the squad loses health.
const block = (cols, rows, gap = 0.65) => Array.from({ length: cols * rows }, (_, i) => [((rows - 1) / 2 - Math.floor(i / cols)) * gap, (i % cols - (cols - 1) / 2) * gap]);
// gun crews around the weapons of client/models/guns.js
export const GUN_SLOTS = {
  mg: [[-0.12, 0.0], [-0.05, 0.85], [-0.05, -0.85]],
  mortar: [[-0.45, 0.75], [-0.45, -0.75], [0.2, -1.0]],   // behind the baseplate and across from the crates, clear of the tube from the usual camera side
  at: [[-0.1, 1.15], [-0.1, -1.15], [-0.85, 1.5], [-0.85, -1.5]],
  flak: [[0.0, 1.15], [0.0, -1.15], [-0.95, 1.2]],
  howitzer: [[-0.35, 1.0], [-0.55, -0.95], [-1.3, 0.55], [-1.5, -0.6]],   // the layer at his hand wheel, loaders by the breech and the shells
};
export const SLOTS = {
  rifle: block(5, 3),
  ...GUN_SLOTS,
  sniper: [[0.4, 0], [-0.5, 0.6]],
  medic: [[0.3, 0.4], [-0.3, -0.4]],
  flamer: [[0.45, 0], [-0.25, 0.75], [-0.35, -0.7]], // the flamethrower ahead, a rifleman either side behind him
  engineer: block(3, 2),
  ranger: block(6, 2),
  commando: block(5, 3),
  conscript: block(7, 3),
};
export const SLOT_SCALE = 1.3;
// men drawn, not men counted
export const menDrawn = (type, hp, maxHp) => Math.ceil(hp * SLOTS[type].length / maxHp);
// World spots of the first `alive` men of squad u. A marching man trails his slot (client/squad-motion.js eases him
// toward it at about 9 per second), so the spots sit speed/9 behind the slots.
export function menAt(u, alive) {
  const c = Math.cos(u.rot), s = Math.sin(u.rot), lagX = (u.vx ?? 0) / 9, lagZ = (u.vz ?? 0) / 9;
  return SLOTS[u.type].slice(0, alive).map(([x, z]) => ({ x: u.x + (x * c - z * s) * SLOT_SCALE - lagX, z: u.z + (x * s + z * c) * SLOT_SCALE - lagZ }));
}
