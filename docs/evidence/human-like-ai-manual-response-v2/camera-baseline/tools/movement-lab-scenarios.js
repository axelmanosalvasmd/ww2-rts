// The browser lab and regression runner use the same authoritative simulation fixtures.
export const MOVEMENT_SCENARIOS = [
  { id: 'arrival', name: 'Angled arrival', seconds: 30, description: 'Brake at an exact destination after turning onto the route.' },
  { id: 'wall-arrival', name: 'Destination beside a wall', seconds: 30, description: 'Resolve an exact click whose cell is open but whose hull would touch a wall.' },
  { id: 'clearance', name: 'Hull clearance recovery', seconds: 60, description: 'Make room to rotate beside a wall without repeating short forward and reverse moves.' },
  { id: 'short', name: 'Short diagonal move', seconds: 20, description: 'Move less than a cell without circling the destination.' },
  { id: 'redirect', name: 'Redirect at speed', seconds: 30, description: 'Replace a running order with a nearby destination behind the vehicle.' },
  { id: 'stop', name: 'Stop and resume', seconds: 30, description: 'Brake on Stop, wait, then move toward a different destination.' },
  { id: 'clearance-stop', name: 'Stop during hull recovery', seconds: 25, description: 'Cancel an escape maneuver, settle, then accept a replacement move.' },
  { id: 'passing-redirect', name: 'Redirect during passing', seconds: 45, description: 'Replace a local passing maneuver with a new destination.' },
  { id: 'queue', name: 'Queued right-angle turns', seconds: 40, description: 'Finish three exact destinations in order.' },
  { id: 'reverse', name: 'Reverse under threat', seconds: 25, description: 'Back away from remembered fire while keeping front armor toward it.' },
  { id: 'reverse-obstacle', name: 'Reverse route disruption', seconds: 45, description: 'Keep a short reverse order when a newly observed obstacle changes its route.' },
  { id: 'corner', name: 'Wall corner', seconds: 40, description: 'Plan around a solid wall and sweep the whole hull through the turn.' },
  { id: 'road', name: 'Road bends', seconds: 45, description: 'Follow short road waypoints through two bends.' },
  { id: 'parked', name: 'Parked blocker', seconds: 45, description: 'Pass a protected stationary unit without displacing it.' },
  { id: 'opposing', name: 'Opposing vehicles', seconds: 55, description: 'Two vehicles exchange positions while preserving their destinations.' },
  { id: 'bridge', name: 'Two-way narrow crossing', seconds: 120, description: 'Armor and support guns share a six-metre crossing with opposing traffic.' },
  { id: 'obstacle', name: 'New obstacle', seconds: 50, description: 'A tank trap appears on a running route; keep the order and find a detour.' },
  { id: 'wreck', name: 'New wreck', seconds: 50, description: 'A wreck appears ahead and the route recovers around it.' },
  { id: 'hill', name: 'Terraced slope', seconds: 40, description: 'Cross a stepped hill without violating the hull or elevation limits.' },
  { id: 'cliff', name: 'Cliff and ramp', seconds: 55, description: 'Find a one-level ramp around a two-level cliff.' },
  { id: 'closure', name: 'Crossing closes', seconds: 60, description: 'A bridge closes ahead; use the surviving crossing farther downstream.' },
  { id: 'unreachable', name: 'Disconnected order and queue', seconds: 35, description: 'Report a disconnected destination and start the next queued move.' },
  { id: 'budget', name: 'Deferred route search', seconds: 35, description: 'Hold a route behind an empty search budget, then resume it.' },
  { id: 'retreat', name: 'Retreat interrupts traffic', seconds: 45, description: 'Replace a passing maneuver with a protected retreat home.' },
];

export const MOVEMENT_TYPES = ['tank', 'medium', 'tankdestroyer', 'tiger', 'churchill', 'armoredcar', 'halftrack', 'flaktrack', 'rocket', 'rifle', 'at'];
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export function createMovementCase(sim, id, { type = 'tank', heading = 0.15, seed = 7301 } = {}) {
  const scenario = MOVEMENT_SCENARIOS.find(row => row.id === id);
  if (!scenario || !MOVEMENT_TYPES.includes(type)) throw new Error('Unknown movement fixture');
  const w = 64, h = 64, rows = Array.from({ length: h }, () => Array(w).fill('.'));
  const heights = Array.from({ length: h }, () => Array(w).fill('0'));
  const paint = (x0, y0, x1, y1, char) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) rows[y][x] = char;
  };
  if (id === 'corner') paint(26, 19, 26, 30, 'B');
  if (id === 'wall-arrival') paint(30, 30, 30, 30, 'B');
  if (id === 'clearance' || id === 'clearance-stop') paint(30, 27, 30, 33, 'B');
  if (id === 'hill') for (let y = 22; y <= 40; y++) for (let x = 25; x <= 43; x++) heights[y][x] = x < 30 || x > 38 ? '1' : '2';
  if (id === 'cliff') for (let y = 0; y < h; y++) for (let x = 29; x <= 35; x++) heights[y][x] = y >= 42 && y <= 46 ? '1' : '2';
  if (id === 'road') { paint(14, 25, 29, 25, 'D'); paint(29, 25, 29, 36, 'D'); paint(29, 36, 43, 36, 'D'); }
  if (id === 'bridge' || id === 'closure' || id === 'unreachable') {
    paint(29, 0, 35, 63, 'W');
    if (id !== 'unreachable') paint(29, 27, 35, 29, '=');
    if (id === 'closure') paint(29, 42, 35, 46, 'F');
  }
  const map = { name: 'Movement lab', w, h, rows: rows.map(row => row.join('')), spawns: [{ x: 8, y: 8 }, { x: 55, y: 55 }], points: [] };
  if (id === 'hill' || id === 'cliff') map.heights = heights.map(row => row.join(''));
  const g = sim.createGame(map, ['Lab', 'Observer'], false, [0, 1], [0, 1], { weather: false, supply: false });
  g.seed = seed; g.weather = { now: 'clear', next: null, at: 0 }; g.points = []; g.pathRetryLimit = 3;
  const template = structuredClone([...g.units.values()].find(u => u.type === 'rifle'));
  g.units.clear();
  const goals = new Map(), anchors = new Map(), events = [], checkpoints = [], visits = new Map();
  const put = (unitType, x, z, rot = heading) => {
    const def = sim.UNITS[unitType], u = { ...structuredClone(template), id: g.nextId++, type: unitType, owner: 0, x, z, rot,
      hp: def.models * def.hpPer, holdFire: true, holdPos: true, auto: false, autoRetreat: false,
      path: [], orders: [], moveSpeed: 0, vx: 0, vz: 0, worldGoal: null, traffic: null, face: null };
    g.units.set(u.id, u); return u;
  };
  const issue = (u, target, extra = {}) => {
    const result = sim.command(g, 0, { t: 'move', orders: [[u.id, target.x, target.z]], ...extra });
    if (result) throw new Error(`Fixture move denied: ${result}`);
    goals.set(u.id, { ...target });
  };
  const at = (seconds, label, run) => events.push({ tick: Math.round(seconds / sim.TICK), label, run });
  let unit = put(type, 50.13, 50.27);
  if (id === 'corner') Object.assign(unit, { x: 40, z: 44, rot: 0 });
  if (id === 'wall-arrival') Object.assign(unit, { x: 54, z: 50, rot: 0 });
  if (id === 'clearance' || id === 'clearance-stop') Object.assign(unit, { x: 63.0272032, z: 69.9705177, rot: 1.94429849 });
  if (id === 'reverse-obstacle') Object.assign(unit, { x: 60, z: 60, rot: 0 });
  if (id === 'road') Object.assign(unit, { x: 29, z: 51, rot: 0 });
  if (['parked', 'passing-redirect', 'retreat', 'opposing', 'bridge', 'closure', 'unreachable', 'hill', 'cliff'].includes(id)) Object.assign(unit, { x: 40, z: 57, rot: 0 });
  const move = target => at(0, 'Move', () => issue(unit, target));
  switch (id) {
    case 'arrival': move({ x: 40.13, z: 50.27 }); break;
    case 'wall-arrival': move({ x: 61.3, z: 57.9 }); break;
    case 'clearance': move({ x: 69.3989857, z: 62.6076599 }); break;
    case 'clearance-stop':
      move({ x: 69.3989857, z: 62.6076599 });
      at(2, 'Stop recovery', () => { sim.command(g, 0, { t: 'stop', ids: [unit.id] }); goals.delete(unit.id); });
      at(4, 'Measure stopped recovery', () => checkpoints.push({ kind: 'stopped', x: unit.x, z: unit.z, speed: unit.moveSpeed, goal: unit.worldGoal, path: unit.path.length, clearance: !!unit.motionClearance }));
      at(6, 'Replacement move', () => { checkpoints.push({ kind: 'stopDrift', distance: distance(unit, checkpoints.at(-1)) }); issue(unit, { x: 82, z: 76 }); }); break;
    case 'short': move({ x: 50.5, z: 50.6 }); break;
    case 'redirect':
      move({ x: 110, z: 50.27 });
      at(4.5, 'Redirect three metres behind', () => issue(unit, { x: unit.x - 3, z: unit.z })); break;
    case 'stop':
      move({ x: 110, z: 50.27 });
      at(3, 'Stop', () => { sim.command(g, 0, { t: 'stop', ids: [unit.id] }); goals.delete(unit.id); });
      at(5, 'Measure stopped position', () => checkpoints.push({ kind: 'stopped', x: unit.x, z: unit.z, speed: unit.moveSpeed, goal: unit.worldGoal, path: unit.path.length }));
      at(7, 'Resume north', () => { const stopped = checkpoints.at(-1); checkpoints.push({ kind: 'stopDrift', distance: distance(unit, stopped) }); issue(unit, { x: unit.x, z: 80 }); }); break;
    case 'queue':
      visits.set(unit.id, [{ x: 70, z: 50.27 }, { x: 70, z: 75 }, { x: 45, z: 75 }]);
      move({ x: 70, z: 50.27 });
      at(0, 'Queue north', () => issue(unit, { x: 70, z: 75 }, { queue: true }));
      at(0, 'Queue west', () => issue(unit, { x: 45, z: 75 }, { queue: true })); break;
    case 'reverse':
      unit.hitFrom = { x: 85, z: 50.27 }; unit.hitAt = 1; unit.rot = 0;
      move({ x: 43, z: 50.27 });
      at(0.5, 'Measure reverse', () => checkpoints.push({ kind: 'reverse', x: unit.x, speed: unit.moveSpeed, rot: unit.rot })); break;
    case 'reverse-obstacle':
      unit.hitFrom = { x: 100, z: 60 }; unit.hitAt = 1;
      move({ x: 46, z: 60 });
      at(2, 'Block the reverse route', () => sim.mutateWorldCell(g, 30 * w + 25, { object: 'Y' }));
      break;
    case 'corner': move({ x: 64, z: 48 }); break;
    case 'road': move({ x: 87, z: 73 }); break;
    case 'parked': case 'passing-redirect': case 'retreat': {
      const blocker = put('rifle', 56, 57, 0); anchors.set(blocker.id, { x: blocker.x, z: blocker.z });
      move({ x: 85, z: 57 });
      if (id === 'retreat') at(4, 'Retreat', () => {
        const result = sim.command(g, 0, { t: 'retreat', ids: [unit.id] });
        if (result) throw new Error(`Fixture retreat denied: ${result}`);
        goals.set(unit.id, { ...g.players[0].spawn, retreat: true });
      }); break;
    }
    case 'opposing': {
      const other = put(type, 80, 57, Math.PI);
      move({ x: 80, z: 57 }); at(0, 'Opposing move', () => issue(other, { x: 40, z: 57 })); break;
    }
    case 'bridge': {
      const gun = put('at', 86, 57, Math.PI), leftFoot = put('rifle', 40, 51, 0), rightFoot = put('rifle', 92, 63, Math.PI);
      move({ x: 92, z: 57 });
      at(0, 'Opposing support gun', () => issue(gun, { x: 40, z: 57 }));
      at(0, 'Infantry east', () => issue(leftFoot, { x: 92, z: 53 }));
      at(0, 'Infantry west', () => issue(rightFoot, { x: 40, z: 61 })); break;
    }
    case 'obstacle': case 'wreck':
      move({ x: 100, z: 50.27 });
      at(2, id === 'wreck' ? 'Wrecks appear' : 'Tank traps appear', () => { for (let y = 22; y <= 28; y++) sim.mutateWorldCell(g, y * w + 36, { object: id === 'wreck' ? 'Q' : 'Y' }); }); break;
    case 'hill': case 'cliff': move({ x: 92, z: 57 }); break;
    case 'closure':
      move({ x: 92, z: 57 });
      at(1, 'Bridge closes', () => { for (let y = 27; y <= 29; y++) for (let x = 29; x <= 35; x++) sim.mutateWorldCell(g, y * w + x, { ground: 'W', object: '.' }); }); break;
    case 'unreachable':
      move({ x: 90, z: 57 });
      at(0, 'Queue reachable destination', () => issue(unit, { x: 25, z: 57 }, { queue: true })); break;
    case 'budget':
      g.pathBudget = 0; move({ x: 95, z: 50.27 });
      at(0, 'Discard initial route for deferred retry', () => { unit.path = []; unit.repath = 0; });
      at(2, 'Measure waiting', () => { checkpoints.push({ kind: 'budget', x: unit.x, z: unit.z, path: unit.path.length }); g.pathBudget = 4096; }); break;
  }
  if (id === 'passing-redirect') at(4, 'Replace passing destination', () => issue(unit, { x: 35, z: 82 }));
  // Visibility and the spatial index are initialized before normal orders arrive.
  sim.step(g);
  const startTick = g.tick;
  let eventIndex = 0;
  events.sort((a, b) => a.tick - b.tick);
  return { g, unit, scenario, type, heading, seed, goals, anchors, checkpoints, visits, events, startTick,
    advance() {
      const elapsed = g.tick - startTick;
      while (eventIndex < events.length && events[eventIndex].tick <= elapsed) events[eventIndex++].run();
      sim.step(g);
    },
    get elapsed() { return (g.tick - startTick) * sim.TICK; },
  };
}
