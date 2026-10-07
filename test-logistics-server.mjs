import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import WebSocket from 'ws';
import { createGame, snapshotFor } from './shared/sim.js';
import { viewFor } from './shared/ai-view.js';
import { think } from './shared/ai.js';

process.env.PORT = '0';
process.env.HOST = '127.0.0.1';
process.env.PUBLIC_URL = 'http://test';
process.env.EDIT_PASSWORD = 'test';
const { server, wss, loop, rooms, clock, tickRooms, watcherSnapshot, logisticsEnabledFor } = await import('./server.js');
clearInterval(loop);
if (!server.listening) await once(server, 'listening');
const map = JSON.parse(await readFile(new URL('./maps/default.json', import.meta.url), 'utf8'));
try {
  for (const mode of ['conquest', 'classic', 'annihilation', 'world']) assert.equal(logisticsEnabledFor(mode, map), true, mode);
  for (const mode of ['tutorial', 'horde', 'assault']) assert.equal(logisticsEnabledFor(mode, map), false, mode);
  assert.equal(logisticsEnabledFor('classic', { scenario: {} }), false, 'scripted scenarios preserve their baseline');
  assert.equal(logisticsEnabledFor('classic', { scenario: { logistics: true } }), true, 'explicit scenario opt-in');

  const game = createGame(map, ['One', 'Two'], false, [0, 1], [0, 1], { weather: false, logistics: true });
  const snapshot = snapshotFor(game, 0, []);
  assert.equal(snapshot.logistics.enabled, true, 'headless activation creates real logistics observations');
  assert.ok(snapshot.logistics.units.length > 0, 'initial stock appears before the first simulation tick');
  assert.ok(snapshot.logistics.units.every(row => game.units.get(row.id).owner === 0), 'unit reserves belong only to the recipient');
  assert.ok(snapshot.logistics.trucks.every(row => game.units.get(row.id).owner === 0), 'private convoy jobs belong only to the recipient');
  assert.equal(watcherSnapshot(game, [], []).logistics, undefined, 'real spectator snapshots omit private logistics');
  const otherSnapshot = snapshotFor(game, 1, []);
  const privateIds = new Set(snapshot.logistics.units.map(row => row.id));
  assert.ok(otherSnapshot.logistics.units.every(row => !privateIds.has(row.id)), 'opponents never receive the other seat stock rows');
  const privateLogistics = { enabled: true, units: [{ id: 1, ammo: 0.1 }], trucks: [{ id: 1, route: [{ x: 10, z: 10 }] }], stores: [], events: [] };
  assert.equal(watcherSnapshot(game, [], [], undefined, { logistics: privateLogistics }).logistics, undefined,
    'spectators receive no projected-seat stocks or route jobs');

  const view = viewFor(game, 0);
  assert.ok(view.logistics.units.every(row => view.units.get(row.id).owner === 0), 'AI stock observation belongs only to its seat');
  assert.ok([...view.units.values()].filter(u => u.owner !== 0).every(u => !u.logistics), 'visible opponents carry no AI reserve details');
  const squad = [...view.units.values()].find(u => u.owner === 0 && u.type === 'rifle');
  squad.x = 70; squad.z = 70;
  const healthy = { id: squad.id, ammo: 1, provisions: 120, fuel: null, emergency: null, forced: false, stranded: false };
  const memory = {}, sent = [];
  const run = () => { sent.length = 0; think(game, 0, { view, memory, submit: cmd => { sent.push(cmd); } }); return sent; };
  const refers = cmd => cmd.ids?.includes(squad.id) || cmd.orders?.some(row => row[0] === squad.id);
  squad.logistics = { ...healthy, forced: true };
  assert.ok(!run().some(refers), 'AI preserves mandatory withdrawal rather than reassigning the squad');
  squad.logistics = { ...healthy, ammo: 0 };
  assert.ok(run().some(cmd => cmd.t === 'retreat' && refers(cmd)), 'empty ammunition prompts voluntary retreat');
  squad.logistics = { ...healthy, ammo: 0.2 };
  assert.ok(!run().some(refers), 'partly restored squad waits until recovery threshold');
  squad.logistics = { ...healthy };
  run();
  assert.ok(!memory.supplyWaiting.has(squad.id), 'half-stock recovery releases the waiting squad');
  squad.logistics = { ...healthy, fuel: 30 };
  assert.ok(run().some(cmd => cmd.t === 'retreat' && refers(cmd)), 'low driving fuel prompts retreat');
  squad.logistics = healthy;
  view.logistics = { ...privateLogistics, trucks: [{ id: squad.id }] };
  assert.ok(!run().some(refers), 'convoys are excluded from ordinary AI combat planning');
  // Normal player rooms use their real default activation, without fixture opt-outs.
  for(const [index,mode] of ['conquest','classic','annihilation','world'].entries()) {
    const code=`supplylive${index}`,messages=[];
    const ws=new WebSocket(`ws://127.0.0.1:${server.address().port}/ws?room=${code}`,{perMessageDeflate:false});
    ws.on('message',raw=>messages.push(JSON.parse(raw)));
    await once(ws,'open');
    const wait=async predicate=>{
      const end=Date.now()+20000;
      for(;;) {const value=messages.find(predicate);if(value)return value;assert.ok(Date.now()<end,`${mode}: live room responds`);await new Promise(resolve=>setTimeout(resolve,5));}
    };
    ws.send(JSON.stringify({t:'hello',token:`live${index}`,name:'Supply test'}));
    await wait(m=>m.t==='lobby');
    ws.send(JSON.stringify({t:'mode',v:mode}));await wait(m=>m.t==='lobby'&&m.mode===mode);
    ws.send(JSON.stringify({t:'start'}));await wait(m=>m.t==='start');tickRooms();tickRooms();
    const live=await wait(m=>m.t==='s'&&m.logistics?.enabled);
    assert.equal(rooms.get(code).game.logisticsEnabled,true,`${mode}: ordinary live matches enable supplies`);
    assert.ok(live.logistics.units.length>0,`${mode}: initial snapshot includes stocks`);
    // everyone starts in supply, so no truck is needed yet
    assert.ok(live.logistics.units.every(row=>row.supply>0&&!row.cut)&&live.logistics.trucks.length===0,`${mode}: starting troops are in supply and no truck is needed`);
    assert.ok(live.logistics.units.every(row=>rooms.get(code).game.units.get(row.id).owner===0),`${mode}: live stock rows belong only to the player`);
  }
  console.log('logistics server activation, spectator privacy and AI withdrawal checks passed');
} finally {
  clock.setTimeout=()=>null;rooms.clear();
  for (const ws of wss.clients) ws.terminate();
  await new Promise(resolve => wss.close(resolve));
  await new Promise(resolve => server.close(resolve));
}
