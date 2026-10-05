// The tutorial (mode 'tutorial', maps/tutorial.json): Sergeant Hollis walks a new player from a glider landing to a
// bridge, one goal at a time. A step says its lines and spawns what it needs when it starts; the next one starts once
// its done() holds, and finishing the last wins the match. The enemy is an extra player that no one sits in and nothing
// thinks for (createGame adds it after the last name): its units stay where a step puts them, or go where it sends them,
// and fight whatever comes in range. sim.js hands in what this needs (tools), so there is no import cycle.
//
// Coordinates are map cells. A step's `at` is the cell its lines point to (the alert's minimap ping and jump).
// spawn: [type, x, y, { hp: share of full strength, go: [x, y] attack-move, house: [x, y] garrison }]
export const STEPS = [
  {
    goal: 'Move your squads up to the hedgerow', at: [13, 22],
    say: ['Sgt. Hollis: Morning, Lieutenant. The glider pilot missed the field by two miles, so we walk.',
      'Drag a box over the boys to select them, then right-click to move. Hedgerow first.'],
    done: (c) => c.mine().every(u => u.x >= 12 * c.CELL),
  },
  {
    goal: 'Clear the enemy sentries out of the orchard', at: [24, 22],
    say: ['Two enemy sentry posts in the orchard. Right-click an enemy to attack it.',
      'Shell holes, hedges and woods halve the hits you take. Open fields get men killed.'],
    spawn: [['rifle', 24, 14, { hp: 0.6 }], ['rifle', 24, 29, { hp: 0.6 }]],
    done: (c) => c.cleared(),
  },
  {
    goal: 'Take the crossroads: keep a squad by the flag', at: [34, 22],
    say: ['Orchard is clear. Now the crossroads: park a squad by the flag until it turns our colour.',
      'Points pay manpower, and manpower buys men.'],
    done: (c) => c.held(0),
  },
  {
    goal: 'Recruit an AT gun: Tab, W, E, or click its card', at: [34, 22], mp: 250,
    say: ['Bad news from the farm: an enemy tank is fuelling up. Rifles cannot scratch armour.',
      'Recruit an AT gun: press Tab, then W, then E. Or click its card at the bottom. HQ sent you the manpower.'],
    done: (c) => c.mine('at').length > 0,
  },
  {
    goal: 'Knock out the tank with your AT gun', at: [44, 22],
    say: ['Here it comes down the road! Set the AT gun where it can see the road and let the tank come to it.',
      'Keep the rifles out of its way. Hit it from the side or behind and it hurts twice as much.'],
    spawn: [['tank', 53, 21, { go: [41, 22] }]],
    done: (c) => c.cleared(),
  },
  {
    goal: 'Clear the farm trench. Rifles: F throws a grenade', at: [45, 22],
    say: ['They still hold the farm trench. Men in a trench shrug off bullets, not grenades.',
      'Select a rifle squad, press F and click the trench. Your MG can pin them down first.'],
    spawn: [['rifle', 45, 17], ['rifle', 45, 26]],
    done: (c) => c.cleared(),
  },
  {
    goal: 'Send a squad home to refill: select it and press R', at: [5, 22],
    say: ['Good work, but the boys are bleeding. Select a squad and press R: they run for home.',
      'Near the HQ a squad gets its men back, for manpower. A live veteran beats a dead hero.'],
    done: (c) => c.mine().some(u => u.retreating),
  },
  {
    goal: 'Shell the stone house: press C, click it, aim, click', at: [63, 17], mp: 200,
    say: ['Last stop, the bridge. The enemy holds the stone house beside it, and stone eats bullets.',
      'Call artillery: press C, click the house, move the mouse to aim the barrage and click again.'],
    spawn: [['mg', 63, 21, { house: [63, 17] }], ['rifle', 62, 21, { house: [63, 17] }]],
    done: (c) => c.called('artillery'),
  },
  {
    goal: 'Cross the bridge and take the bridgehead', at: [62, 22],
    say: ['Shells away! When they land, push across and take the bridgehead.',
      'Anyone left in that house will fight for it. Finish them, then hold the flag.'],
    done: (c) => c.held(1),
  },
];

// what a step's done() can ask about the players' side (team 0)
function checks(g, mode, CELL) {
  const mine = (type) => [...g.units.values()].filter(u => u.hp > 0 && g.players[u.owner].team === 0 && (!type || u.type === type));
  return {
    mine,
    CELL,
    cleared: () => mode.spawned.every(id => !(g.units.get(id)?.hp > 0)),
    held: (i) => g.points[i].owner >= 0 && g.players[g.points[i].owner].team === 0,
    called: (kind) => g.players.some(p => p.team === 0 && p.sup[kind] > 0),
  };
}

// a step begins: its lines, its manpower for every player, its enemies
function begin(g, tools) {
  const mode = g.mode, s = STEPS[mode.step], { CELL } = tools, cell = ([x, y]) => ({ x: (x + 0.5) * CELL, z: (y + 0.5) * CELL });
  mode.goal = s.goal; mode.spawned = [];
  mode.lines.push(...s.say.map(text => ({ k: 'say', text, ...cell(s.at), pub: true })));
  if (s.mp) for (const p of g.players) if (p.team === 0) p.mp = Math.max(p.mp, s.mp);
  const enemy = g.players[mode.slot];
  for (const [type, x, y, o = {}] of s.spawn ?? []) {
    // ponytail: spawnUnit places its first unit 4 m east of the owner's HQ, so the HQ moves beside the spot for the call
    const home = enemy.spawn; enemy.spawn = { x: cell([x, y]).x - 4, z: cell([x, y]).z };
    const u = tools.spawnUnit(g, mode.slot, type, 0);
    enemy.spawn = home;
    u.autoRetreat = false; // a sentry that runs home never gets cleared
    if (o.hp) u.hp = Math.ceil(u.hp * o.hp);
    if (o.go) tools.command(g, mode.slot, { t: 'amove', orders: [[u.id, cell(o.go).x, cell(o.go).z]] });
    if (o.house) tools.command(g, mode.slot, { t: 'garrison', ids: [u.id], ...cell(o.house) });
    mode.spawned.push(u.id);
  }
}

export function setupTutorial(g, slot, tools) {
  g.mode = { kind: 'tutorial', slot, step: 0, steps: STEPS.length, goal: '', spawned: [], lines: [] };
  g.players[slot].mp = 0;
  begin(g, tools);
}

// every tick: the next step once this one is done, and the win after the last
export function stepTutorial(g, tools) {
  const mode = g.mode;
  // a step's lines go out from 2 s in: the client takes the first snapshot as its baseline and shows no alerts from it
  if (mode.lines.length && g.tick >= 40) g.shots.push(...mode.lines.splice(0));
  if (g.winner !== null || !STEPS[mode.step].done(checks(g, mode, tools.CELL))) return;
  if (mode.step + 1 >= STEPS.length) return tools.finish(g, 0, 'tutorial', g.points[1]);
  mode.step++;
  begin(g, tools);
}
