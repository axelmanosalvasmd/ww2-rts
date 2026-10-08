// Two squads holding fire are hit by an enemy squad. With the camera on the fight (default) the commander should
// answer within its reaction time and send the squads at the attacker; with params.offScreen it should notice the
// alert later and answer by moving the camera there first.
import { commanderCamera, SCREEN } from '../shared/ai-human.js';

export const about = 'How fast does the commander answer a hit on its squads, on screen or off screen?';
export const map = { w: 160, h: 160, spawns: [{ x: 20, y: 20 }, { x: 140, y: 140 }] };
// Everyone holds fire, so only the commander can answer.
export const units = [
  { owner: 0, type: 'rifle', x: 190, z: 200, holdFire: true },
  { owner: 0, type: 'rifle', x: 196, z: 204, holdFire: true },
  { owner: 1, type: 'rifle', x: 205, z: 215, holdFire: true },
];
const spots = units;
export const ai = [0];
export const warmup = 10;
export const seconds = 10;
export const script = [{ at: 0, run: ({ g, units: placed, params }) => {
  // Back to the starting spots (the warmup may have moved them), then the hit.
  placed.forEach((u, i) => Object.assign(u, { x: spots[i].x, z: spots[i].z, path: [], targetId: 0 }));
  Object.assign(commanderCamera(g, 0), params.offScreen ? { x: 40, z: 40 } : { x: 195, z: 205 });
  const [hit] = placed;
  g.shots.push({ k: 'hurt', t: hit.id, fo: 1, to: 0, x: hit.x, z: hit.z, kill: false });
} }];

export function measure({ alerts, inputs, units, tick }) {
  const alert = alerts[0].find(a => a.id === units[0].id), start = alert?.tick;
  const answer = alert?.answered ?? null, first = inputs[0].find(i => i.tick === answer);
  return {
    alerted: !!alert, onScreen: alert?.onScreen, answered: answer !== null,
    seconds: answer !== null ? (answer - start) / 20 : undefined,
    firstInput: first?.kind,
    cameraOnFight: first ? Math.abs(first.camera.x - alert.x) <= SCREEN.x && Math.abs(first.camera.z - alert.z) <= SCREEN.z : undefined,
    attackedFoe: inputs[0].some(i => i.cmd?.t === 'attack' && i.cmd.target === units[2].id && i.accepted && i.tick >= start),
  };
}
