import assert from 'node:assert/strict';
import { decodeLogistics, reserveLabels, truckLabels, storeForUnit, logisticsIndicator, overlayItems, createLogisticsAlerts } from './client/logistics.js';
import { createSelection } from './client/selection.js';
import { createOrders } from './client/orders.js';
import { spanish } from './client/i18n.js';
import { isWheeled, wheeledModel } from './client/models/wheeled.js';
import { symbolInfo, hasSymbol } from './client/symbols.js';
import * as THREE from 'three';
import { buildModel } from './client/unit-models.js';

const defs = { rifle: { infantry: true, w: { range: 20 } }, truck: {}, supplycache: { structure: true, building: true } };
const units = new Map([
  [1, { id: 1, type: 'rifle', owner: 0, hp: 100, x: 10, z: 10 }],
  [2, { id: 2, type: 'truck', owner: 0, hp: 120, x: 11, z: 10 }],
  [3, { id: 3, type: 'truck', owner: 1, hp: 120, x: 40, z: 10 }],
  [4, { id: 4, type: 'supplycache', owner: 0, hp: 400, x: 20, z: 10 }]
]);
const selected = new Set(), groups = {};
let logisticsSelection = false;
const selection = createSelection({ units, selected, groups, owner: () => 0, definitions: defs,
  logisticsSelection: () => logisticsSelection, screenOf: v => ({ x: v.x, y: v.z, front: true, radius: 2 }),
  viewport: () => ({ width: 100, height: 100 }), center: () => {} });
assert.deepEqual(selection.army().map(v => v.id), [1], 'army excludes automatic trucks');
assert.deepEqual(selection.box({ x0: 0, y0: 0, x1: 30, y1: 30 }).map(v => v.id), [1], 'combat drag excludes trucks');
assert.equal(selection.pick(11, 10).id, 2, 'truck can be clicked directly');
selection.click(units.get(2));
assert.deepEqual([...selected], [2]);
selection.group(1, 'set');
assert.deepEqual(groups[1], [], 'trucks stay outside combat groups');
assert.deepEqual(selection.idle().map(v => v.id), [1]);
logisticsSelection = true;
assert.deepEqual(selection.box({ x0: 0, y0: 0, x1: 30, y1: 30 }).map(v => v.id), [2], 'logistics drag selects only trucks');
assert.deepEqual(selection.army().map(v => v.id), [1], 'army remains combat only in logistics mode');

const sent = [];
selected.clear(); selected.add(2);
const orders = createOrders({ units, selected, me: 0, defs, diggers: [], send: v => sent.push(v),
  formation: (us, p) => us.map(v => ({ id: v.id, x: p.x, z: p.z })), moveColor: 0, feedback: () => {} });
assert.equal(orders.dispatch({ friend: units.get(1), ground: units.get(1) }), true);
assert.deepEqual(sent.pop(), { t: 'supply', ids: [2], target: 1, queue: false });
orders.dispatch({ building: units.get(4), ground: units.get(4) });
assert.equal(sent.pop().target, 4, 'cache accepts a direct relief command');
orders.dispatch({ enemy: units.get(3), ground: { x: 40, z: 10 } }, { ctrlKey: true });
assert.equal(sent.pop().t, 'move', 'unarmed trucks receive movement, never attack');

const snapshot = { logistics: { enabled: true,
  units: [{ id: 1, ammo: 0.2, provisions: 0, fuel: null, emergency: null, warning: 12, forced: false, stranded: false }],
  trucks: [{ id: 2, state: 'delivering', manual: false, hold: false, cargo: { ammo: 12, provisions: 500, fuel: 100 }, destination: { x: 20, z: 10 }, route: [{ x: 11, z: 10 }, { x: 20, z: 10 }] }, { id: 3, state: 'loading', cargo: { ammo: 99 }, route: [{ x: 90, z: 90 }] }],
  stores: [{ id: 4, owner: 0, x: 20, z: 10, source: false, stock: { ammo: 1, provisions: 2, fuel: 3 }, capacity: { ammo: 4, provisions: 5, fuel: 6 } }, { id: 9, owner: 1, x: 90, z: 90 }], events: [] } };
const decoded = decodeLogistics(snapshot, units, 0, owner => owner === 0);
assert.deepEqual([...decoded.trucks.keys()], [2], 'private enemy cargo is never accepted');
assert.deepEqual([...decoded.stores.keys()], [4], 'only allied cache details survive decoding');
assert.ok(reserveLabels(decoded.units.get(1)).includes('Withdrawal in 12 s'));
assert.ok(truckLabels(decoded.trucks.get(2)).includes('Ammunition cargo: 12.0'));
assert.equal(logisticsIndicator(decoded.units.get(1)), 'Low supplies');
assert.equal(logisticsIndicator({ forced: true, stranded: true }), 'Stranded');
const primitives = overlayItems(decoded, new Set([2]), units, p => p.x < 30);
assert.equal(primitives.routes.length, 1);
assert.equal(primitives.stores.length, 1);
assert.equal(overlayItems(decoded, new Set(), units).routes.length, 0, 'only selected trucks draw routes');
assert.equal(overlayItems(decoded, new Set([2]), units, p => p.x < 15).routes.length, 0, 'unknown route sections cannot reveal geography');
assert.equal(overlayItems(decoded, new Set([2]), units, p => p.x < 14 || p.x > 16).routes.length, 0, 'known endpoints cannot bridge unknown ground');
assert.equal(decodeLogistics({}, units, 0).enabled, false, 'old/excluded snapshots clear private data');

const alerts = createLogisticsAlerts();
const events = [{ id: 1, type: 'blocked', x: 10, z: 10, count: 2 }, { id: 2, type: 'blocked', x: 11, z: 10, count: 1 }];
assert.equal(alerts.update(events, 0).length, 1, 'nearby delivery warnings group');
assert.equal(alerts.update(events, 2).length, 0, 'retained events never redeliver');
assert.equal(alerts.update([{ id: 3, type: 'blocked', x: 11, z: 10 }], 19).length, 0, 'same situation has 20-second cooldown');
assert.equal(alerts.update([{ id: 4, type: 'blocked', x: 11, z: 10 }], 21).length, 1);
alerts.reset();
assert.equal(alerts.update(events, 0).length, 1, 'new match resets warnings');
assert.equal(spanish('Supply Truck'), 'Camión de suministros');
assert.equal(spanish('Supply Cache'), 'Almacén de suministros');
assert.equal(spanish('Withdrawal in 12 s'), 'Retirada en 12 s');
assert.equal(hasSymbol('truck'), true);
assert.equal(hasSymbol('supplycache'), true);
assert.notEqual(symbolInfo('truck').d, symbolInfo('rocket').d, 'unarmed logistics truck has a distinct symbol');
for (let faction = 0; faction < 4; faction++) {
  assert.equal(isWheeled('truck', faction), true);
  const model = wheeledModel('truck', faction, { vehicle: 0x59623d, color: 0x3b73d6 });
  assert.ok(model.hull.attributes.position.count > 100, 'truck has a complete wheeled hull');
  model.hull.computeBoundingBox();
  assert.ok(model.hull.boundingBox.max.x - model.hull.boundingBox.min.x > 4, 'truck has a readable cab and cargo bed');
  assert.ok([...model.hull.attributes.position.array].every(Number.isFinite), 'truck mesh contains finite coordinates');
  assert.equal(model.turret, null, 'supply truck carries no weapon turret');
}
for (const type of ['truck', 'supplycache']) {
  const root = new THREE.Group(), unit = { type, root, models: [] };
  buildModel(unit, root, { vehicle: 0x59623d, uniform: 0x6b7248, color: 0x3b73d6 }, 0,
    { infantry: false, models: 1, hpPer: type === 'truck' ? 120 : 400 });
  assert.equal(unit.models.length, 1, `${type} integrates with the ordinary unit model factory`);
  assert.ok(root.children.length > 0);
  const bounds = new THREE.Box3().setFromObject(root);
  assert.ok(bounds.max.y > 2, `${type} has a readable body`);
  if (type === 'supplycache') assert.ok(unit.body, 'cache supports ordinary construction scaling');
}
assert.equal(logisticsIndicator({ammo:null,provisions:120,fuel:null}), '', 'unarmed medics have no ammunition shortage');
assert.ok(reserveLabels({ammo:null,provisions:120,fuel:null}).every(text=>!text.startsWith('Ammunition:')), 'unarmed medics omit ammunition');
assert.equal(storeForUnit({enabled:true,stores:new Map([['region:0',{owner:0,x:10,z:12,stock:{provisions:20}}]])},{id:99,owner:0,x:10,z:12}).stock.provisions,20,'regional cache identity resolves to the selected physical cache');
console.log('Logistics client tests passed');
