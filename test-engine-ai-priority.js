// Decision ordering uses observed actors and targets. Population labels do not choose the action.
import assert from 'node:assert/strict';
import { createGame, command, step, UNITS, supCost } from './shared/sim.js';
import { viewFor } from './shared/ai-view.js';
import { perceive } from './shared/ai-perception.js';
import { prioritizeVisit } from './shared/ai-priority.js';
const map = { w: 80, h: 80, rows: Array(80).fill('.'.repeat(80)),
  spawns: [{ x: 20, y: 40 }, { x: 75, y: 40 }], points: [{ x: 49, y: 40 }] };
const game = createGame(map, ['AI', 'enemy'], false, [0, 1], [0, 1], { weather: false });
game.units.clear();
for (const slot of [0, 0, 1]) {
  game.players[slot].mp = 5000;
  assert.equal(command(game, slot, { t: 'buy', unit: 'rifle' }), undefined);
}
const [ready, engaged, enemy] = [...game.units.values()];
Object.assign(ready, { x: 75, z: 80, holdFire: true, autoRetreat: false });
Object.assign(engaged, { x: 80, z: 80, autoRetreat: false });
Object.assign(enemy, { x: 95, z: 80, holdFire: true, autoRetreat: false });
assert.equal(command(game, 0, { t: 'move', orders: [[ready.id, 76, 80]] }), undefined);
step(game);
assert.equal(command(game, 0, { t: 'attack', ids: [engaged.id], target: enemy.id }), undefined);
const state = { camera: { x: 80, z: 80, yaw: 0, distance: 60 } }, memory = {};
step(game);
let view = perceive(viewFor(game, 0, memory), 0, state, game.tick);
const contact = view.events.find(event => event.kind === 'screen-contact' && event.targetId === enemy.id);
assert.ok(contact, 'an ordinary delivered enemy produces an actual on-screen contact');
assert.deepEqual(contact.observedDanger.idleOwnUnits, [], 'the contact starts while our actors already move or engage');
for (let tick = 0; tick < 20; tick++) step(game);
view = perceive(viewFor(game, 0, memory), 0, state, game.tick);
assert.equal(view.units.get(ready.id).path.length, 0, 'the first actor actually completes its previous move');
assert.ok(view.screenIds.has(enemy.id) && view.screenIds.has(ready.id), 'the actor and current hostile are observed on camera');
assert.ok(view.units.get(engaged.id).targetId, 'the other actor is already fighting');
const concern = { id: `stimulus:${contact.id}`, kind: 'combat', event: 'screen-contact',
  x: contact.x, z: contact.z, targetId: enemy.id, since: game.tick, until: game.tick + 60 };
const advance = { t: 'amove', orders: [[ready.id, enemy.x, enemy.z]] };
const optional = { t: 'ability', ids: [engaged.id], x: enemy.x, z: enemy.z };
const inspection = { ...optional };
const cloneView = () => ({ ...view, units: new Map(structuredClone([...view.units])),
  screenIds: new Set(view.screenIds), events: structuredClone(view.events) });
function decide(changes = {}) {
  const copied = cloneView(), current = { ...concern };
  for (const event of [...copied.events, current]) Object.assign(event, changes);
  return prioritizeVisit([structuredClone(optional), structuredClone(advance)], [structuredClone(inspection)],
    copied, current, new Set(), 0, game.tick);
}
const positive = decide();
assert.deepEqual(positive.intents[0], advance, 'a useful order for the now-idle actor precedes optional micro for the actor already fighting');
assert.deepEqual(positive.inspections, [], 'the unrelated inspection waits for the ready tactical order');
const support = { t: 'support', kind: 'smoke', x: enemy.x, z: enemy.z };
assert.equal(prioritizeVisit([support], [inspection], cloneView(), concern, new Set(), 0, game.tick).inspections.length, 0,
  'a useful support call without selected actors also precedes an unrelated inspection');
assert.equal(prioritizeVisit([{ ...support, x: enemy.x + 30 }], [inspection], cloneView(), concern,
  new Set(), 0, game.tick).inspections.length, 1, 'a distant support target does not postpone useful inspection');
assert.equal(prioritizeVisit([support], [inspection], cloneView(), null, new Set(), 0, game.tick).inspections.length, 0,
  'an actual observed contact can prioritize useful support without a current visit descriptor');
for (const responseRequired of [true, false, undefined]) for (const responseUnits of [[], [999], [engaged.id], [ready.id]])
  assert.deepEqual(decide({ responseRequired, responseUnits, responseReason: 'counterfactual', responsePolicy: 'test',
    counterfactualPopulation: 999 }), positive, 'diagnostic population permutations cannot change actual intent or inspection actor choice');
const competing = cloneView();
competing.events.push({ id: 'newer-local-hit', kind: 'screen-damage', tick: game.tick,
  unitId: engaged.id, x: engaged.x, z: engaged.z });
const otherResponse = { t: 'move', orders: [[engaged.id, engaged.x - 10, engaged.z]] };
const attended = prioritizeVisit([otherResponse, structuredClone(advance)], [], competing,
  { ...concern, eventId: contact.id }, new Set(), 0, game.tick);
assert.deepEqual(attended.intents[0], advance,
  'the event actually under attention precedes a newer secondary stimulus on the same screen');
const missing = cloneView(); missing.screenIds.delete(enemy.id);
assert.equal(prioritizeVisit([advance], [inspection], missing, concern, new Set(), 0, game.tick).inspections.length, 1,
  'a no-longer-observed hostile cannot suppress an optional inspection');
const expired = cloneView(); expired.events.forEach(event => { event.tick = game.tick - 241; });
assert.equal(prioritizeVisit([advance], [inspection], expired, concern, new Set(), 0, game.tick).inspections.length, 1,
  'an expired episode cannot earn new tactical priority');
const moved = cloneView(); moved.units.get(enemy.id).x += 35;
assert.equal(prioritizeVisit([advance], [inspection], moved, concern, new Set(), 0, game.tick).inspections.length, 1,
  'a stale destination away from the actual current hostile cannot earn priority');
const nowFiring = cloneView(); nowFiring.units.get(ready.id).targetId = enemy.id;
assert.equal(prioritizeVisit([advance], [inspection], nowFiring, concern, new Set(), 0, game.tick).inspections.length, 1,
  'an actor already fighting does not earn idle-contact priority');
assert.equal(prioritizeVisit([advance], [{ ...inspection, ids: [ready.id] }], cloneView(), concern,
  new Set(), 0, game.tick).inspections.length, 1, 'a useful inspection for the chosen actor retains its physical read');
const retreat = { t: 'retreat', ids: [engaged.id] };
assert.equal(prioritizeVisit([advance, retreat], [inspection], cloneView(), concern,
  new Set(), 0, game.tick).intents[0].t, 'retreat', 'an urgent retreat stays ahead of the new contact order');
const hit = cloneView(); hit.events = [{ id: 'actual-hit', kind: 'screen-damage', tick: game.tick,
  unitId: ready.id, x: ready.x, z: ready.z }];
const local = { t: 'move', orders: [[ready.id, ready.x - 10, ready.z]] };
assert.equal(prioritizeVisit([local], [inspection], hit, concern, new Set(), 0, game.tick).inspections.length, 0,
  'an actual affected actor can make a local tactical move after observed damage');
const remote = { t: 'move', orders: [[ready.id, ready.x + 70, ready.z]] };
assert.equal(prioritizeVisit([remote], [inspection], hit, concern, new Set(), 0, game.tick).inspections.length, 1,
  'an arbitrary remote march is not a local damage response');
const beyondRange = { t: 'ability', ids: [ready.id], x: ready.x + UNITS.rifle.ab.range + 1, z: ready.z };
assert.equal(prioritizeVisit([beyondRange], [inspection], hit, concern, new Set(), 0, game.tick).inspections.length, 1,
  'damage cannot make an out-of-range ability into useful ready work');
const answered = new Set([contact.id]);
assert.equal(prioritizeVisit([advance], [inspection], cloneView(), concern, answered, 0, game.tick).inspections.length, 1,
  'an actually answered event does not keep a priority obligation');
const idle = cloneView(); idle.events = [];
assert.equal(prioritizeVisit([local], [inspection], idle, { kind: 'idle', unitId: ready.id, since: game.tick },
  new Set(), 0, game.tick).inspections.length, 0, 'a named idle actor receives its ready local order before another actor is inspected');
const expansion = cloneView(); expansion.events = [];
const objective = view.points[0], capture = { t: 'move', orders: [[ready.id, objective.x, objective.z]] };
assert.equal(prioritizeVisit([capture], [inspection], expansion, { ...objective, kind: 'expansion', since: game.tick },
  new Set(), 0, game.tick).inspections.length, 0, 'a ready movement to the delivered objective precedes unrelated inspection');
assert.equal(command(game, 0, advance), undefined, 'the prioritized movement is an ordinary accepted command for the actual actor');
assert.deepEqual(ready.amove, { x: enemy.x, z: enemy.z }, 'the prioritized actor receives the actual threat destination');
const { cur, cost } = supCost(game, support.kind), bank = game.players[0][cur];
assert.equal(command(game, 0, support), undefined, 'the useful support proposal is an ordinary accepted purchase');
assert.equal(game.players[0][cur], bank - cost, 'the support call pays its actual game cost');
assert.ok(game.strikes.some(strike => strike.kind === support.kind && strike.owner === 0
  && strike.x === support.x && strike.z === support.z), 'the accepted support call targets the actual local contact');
console.log('Actual visit priority, diagnostic invariance, current-target controls and damage geometry passed.');
