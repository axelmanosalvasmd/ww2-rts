import assert from 'node:assert/strict';
import { createGame, step, snapshotFor, UNITS, TICK, placementCheck, CFG } from './shared/sim.js';
import { LOGISTICS } from './shared/logistics.js';
import { fixtureCommand as command } from './test-fixtures.js';

import { placementState, denySentence } from './client/availability.js';

const map = () => ({ w: 80, h: 60, rows: Array(60).fill('.'.repeat(80)), spawns: [{ x: 5, y: 25 }, { x: 74, y: 25 }], points: [] });
const game = (mode = 'conquest', teams = [0, 1]) => createGame(map(), ['one', 'two'], false, teams, [0, 1], { mode, logistics: true, weather: 'clear' });
const advance = (g, seconds) => { for (let n = 0; n < Math.ceil(seconds / TICK); n++) step(g); };
const troops = (g, owner = 0) => [...g.units.values()].filter(u => u.owner === owner && u.type === 'rifle');
// Reserve and truck mechanics without territory refill: an empty, frozen supply network cuts every unit off, so trucks
// serve them as they serve units cut off in a match. Returns the call that unfreezes the network.
const unsupplied = (g) => {
  const every = CFG.supply.network; CFG.supply.network = 0; g.supplyNet = {};
  for (const u of g.units.values()) if (u.logistics) Object.assign(u.logistics, { supplyRate: 0, cutFor: LOGISTICS.supplyGrace });
  return () => { CFG.supply.network = every; };
};
// work for the trucks: every troop low on provisions
const needSupplies = (g) => { for (const u of g.units.values()) if (u.logistics) u.logistics.provisions = 40; };
const trucksOf = (g, owner = 0) => [...g.units.values()].filter(u => u.owner === owner && u.type === 'truck');

{
  const g = game(), u = troops(g)[0];
  assert.ok(u.logistics, 'selected match troops start with real reserves');
  assert.equal(u.logistics.provisions, 120);
  const before = u.logistics.provisions;
  advance(g, 1);
  assert.ok(u.logistics.provisions >= before - 1.1, 'ordinary source service keeps initial troops supplied');
  const own = snapshotFor(g, 0, []).logistics;
  assert.ok(own.units.some(row => row.id === u.id), 'owner receives detailed reserves');
  assert.ok(!snapshotFor(g, 1, []).logistics.units.some(row => row.id === u.id), 'opponent never receives private reserves');
}

{
  // troops in supply refill from the territory, far from the HQ too, and no truck is needed
  const g = game(), u = troops(g)[0];
  Object.assign(u, { x: 70, z: 25, holdFire: true, holdPos: true, autoRetreat: false });
  advance(g, 6);
  u.logistics.provisions = 40;
  advance(g, 10);
  assert.ok(u.logistics.provisions > 55, 'territory supply refills remote troops');
  assert.equal(trucksOf(g).length, 0, 'no trucks while everything is in supply');
  const enemy = troops(g, 1)[0];
  Object.assign(enemy, { x: u.x + 4, z: u.z, holdFire: true, holdPos: true, auto: false, autoRetreat: false });
  advance(g, 2);
  assert.equal(snapshotFor(g, 0, []).logistics.units.find(row => row.id === u.id).grace > 0, true, 'an enemy beside the troop starts the grace countdown');
  advance(g, 10);
  assert.equal(snapshotFor(g, 0, []).logistics.units.find(row => row.id === u.id).cut, true, 'enemy zone of control cuts it off once the grace runs out');
}

{
  const g = game(), u = troops(g)[0], restore = unsupplied(g);
  Object.assign(u, { x: 70, z: 25, holdFire: true, holdPos: true, autoRetreat: false });
  u.logistics.provisions = 40;
  advance(g, 6);
  const trucks = trucksOf(g);
  assert.ok(trucks.length >= 1, 'troops cut off from supply get a truck without a player convoy command');
  let travelled = false;
  for (let n=0;n<35/TICK;n++) { step(g); travelled ||= trucks.some(t => Math.hypot(t.x - 11,t.z - 51)>15); }
  assert.ok(u.logistics.provisions > 40, 'autonomous physical delivery replenishes remote troops');
  assert.ok(travelled, 'supplies travel on actual moving trucks');
  // idle trucks retire once nothing is out of supply: new work brings one out for the hold check
  u.logistics.provisions = 40; advance(g, 6);
  const truck = trucksOf(g)[0];
  assert.ok(truck, 'new work for cut-off troops sends a truck again');
  assert.equal(command(g, 0, { t: 'stop', ids: [truck.id] }), undefined);
  advance(g, 1); // a moving truck brakes before it stands
  const at = { x: truck.x, z: truck.z };
  advance(g, 3);
  assert.ok(Math.hypot(truck.x - at.x, truck.z - at.z) < 0.5, 'explicit convoy hold stays held');
  assert.equal(command(g, 0, { t: 'logisticsResume', ids: [truck.id] }), undefined);
  assert.equal(truck.convoy.hold, false, 'resume returns the truck to automatic service');
  restore();
}

{
  const g = game(), u = troops(g)[0], restore = unsupplied(g);
  Object.assign(u, { x: 70, z: 20, autoRetreat: false, holdFire: true });
  advance(g, 6);
  u.logistics.provisions = 0;
  for (const t of g.units.values()) if (t.owner === 0 && t.type === 'truck') t.convoy.hold = true;
  // Keep deliveries paused for the entire shortage, including trucks spawned after the initial hold.
  for (let n = 0; n < Math.ceil(21 / TICK); n++) {
    for (const t of g.units.values()) if (t.owner === 0 && t.type === 'truck') t.convoy.hold = true;
    step(g);
  }
  assert.equal(u.logistics.forced, true, 'exhaustion overrides the ordinary auto-retreat toggle');
  command(g, 0, { t: 'attack', ids: [u.id], target: troops(g, 1)[0].id });
  assert.equal(u.logistics.forced, true, 'ordinary attack cannot cancel supply withdrawal');
  restore();
}

{
  const m = map(); m.rows = m.rows.map(row => row.slice(0,25) + 'W' + row.slice(26));
  const g = createGame(m, ['one','two'], false, [0,1], [0,1], {logistics:true,weather:'clear'}), u=troops(g)[0];
  Object.assign(u, { x: 70, z: 20, holdFire: true, autoRetreat: false });
  u.logistics.provisions = 0;
  advance(g, 23);
  assert.equal(u.logistics.forced, true, 'failed escape remains mandatory');
  assert.equal(u.logistics.stranded, true, 'unreachable home leaves the pocket stranded');
  assert.equal(u.retreating, false, 'stranded troops receive no retreat protection');
}

{
  const g = game('classic');
  const truck = UNITS.truck;
  assert.ok(truck && truck.pop === 0 && !truck.w?.range, 'truck is an unarmed logistics vehicle without combat population');
  assert.ok(UNITS.supplycache, 'forward cache has a separate identity from resource-producing depots');
  const u = troops(g)[0];
  const ammo = u.logistics.ammo;
  Object.assign(u, { holdFire: true });
  advance(g, 3);
  assert.equal(u.logistics.ammo, ammo, 'idle troops do not consume ammunition');
}

// Isolate weapon accounting from deliveries and unrelated battlefield activity.
{
  const g=game(), u=troops(g)[0], enemy=troops(g,1)[0];
  g.units=new Map([[u.id,u],[enemy.id,enemy]]);g.convoys=null;g.skipFog=true;
  Object.assign(u,{x:60,z:60,holdPos:true,auto:false,autoRetreat:false});
  Object.assign(enemy,{x:75,z:60,hp:10000,holdFire:true,holdPos:true,auto:false,autoRetreat:false});
  u.logistics.ammo=7;
  advance(g,5);
  assert.equal(u.logistics.ammo,0,'rifle volleys debit only actual rounds including a partial final volley');
  const flights=g.nextFlight;advance(g,3);
  assert.equal(g.nextFlight,flights,'an empty weapon cannot launch further projectiles');
  u.cd=0;assert.equal(command(g,0,{t:'ability',ids:[u.id],x:enemy.x,z:enemy.z}),'ammo','empty ammo blocks explosives');
  u.logistics.ammo=1;assert.equal(command(g,0,{t:'ability',ids:[u.id],x:enemy.x,z:enemy.z}),'ammo','one rifle round cannot fund a full grenade volley');
}
{
  const g=game(),restore=unsupplied(g);g.players[0].mp=10000;
  assert.equal(command(g,0,{t:'buy',unit:'tank'}),undefined);
  const tank=[...g.units.values()].find(u=>u.owner===0&&u.type==='tank');
  Object.assign(tank,{x:80,z:70,holdFire:true,auto:false,autoRetreat:false});
  const fuel=tank.logistics.fuel;advance(g,3);
  assert.equal(tank.logistics.fuel,fuel,'a parked tank burns no driving fuel');
  assert.equal(command(g,0,{t:'move',orders:[[tank.id,110,70]]}),undefined);
  advance(g,2);
  assert.ok(tank.x>80&&tank.logistics.fuel<fuel,'fuel is consumed by actual powered tank movement');
  assert.equal(tank.logistics.emergency,60,'ordinary travel preserves withdrawal fuel');
  tank.logistics.fuel=.01;advance(g,.5);
  assert.equal(tank.logistics.forced,true,'empty ordinary fuel forces immediate withdrawal');
  assert.ok(tank.logistics.emergency<60,'emergency fuel powers the escape toward supplies');
  restore();
}
{
  const g=game(),u=troops(g)[0];Object.assign(u,{x:70,z:30,holdFire:true,auto:false,autoRetreat:false});
  u.logistics.forced=true;u.logistics.exhausted=true;u.logistics.provisions=0;
  assert.equal(command(g,0,{t:'stop',ids:[u.id]}),undefined);advance(g,3);
  assert.equal(u.path.length,0,'stop pauses an escape while retaining mandatory withdrawal');
  assert.equal(u.logistics.forced,true);
  command(g,0,{t:'move',orders:[[u.id,85,30]]});advance(g,.5);
  assert.ok(u.x>70&&u.retreating,'a direct escape moves as a withdrawal');
}
{
  const m=map();m.rows=m.rows.map(row=>row.slice(0,25)+'W'+row.slice(26));
  const g=createGame(m,['one','two'],false,[0,1],[0,1],{logistics:true,weather:'clear'}),u=troops(g)[0],restore=unsupplied(g);
  needSupplies(g);advance(g,3);
  Object.assign(u,{x:53,z:51,holdFire:true,holdPos:true});u.logistics.provisions=40;
  const truck=trucksOf(g)[0];
  Object.assign(truck,{x:47,z:51,path:[],worldGoal:null});
  Object.assign(truck.convoy,{hold:false,state:'unloading',timer:8,target:{id:`unit:${u.id}`,unit:u.id,members:[u.id],x:u.x,z:u.z},cargo:{ammo:0,provisions:120,fuel:0}});
  step(g);assert.ok(u.logistics.provisions<40,'a close truck cannot unload across impassable water');
  restore();
}
{
  const m=map(),g=game(),s=snapshotFor(g,0,[]),preview=placementState(s,m,m.rows.map(row=>[...row]),[0,1]);
  assert.equal(placementCheck(preview.game,{kind:'supplycache',x:33,z:51,team:0}).ok,true,'the client placement preview accepts enabled supply caches');
  assert.equal(command(g,0,{t:'build',ids:[troops(g)[0].id],kind:'supplycache',x:33,z:51}),undefined,'Conquest builders can place a forward cache');
  assert.ok([...g.units.values()].some(u=>u.owner===0&&u.type==='supplycache'&&u.built===0));
  assert.equal(denySentence('ammo'),'Not enough carried ammunition','an empty weapon gets a readable denial');
}

{
  const m=map(); m.w=200; m.rows=Array(m.h).fill('.'.repeat(m.w)); m.spawns[1].x=194;
  const g=createGame(m,['one','two'],false,[0,1],[0,1],{logistics:true,weather:'clear'}),u=troops(g)[0];
  Object.assign(u,{x:300,z:30,holdFire:true,auto:false,autoRetreat:false});
  u.logistics.forced=true;u.logistics.exhausted=true;u.logistics.provisions=0;
  for(const t of g.units.values()) if(t.convoy) t.convoy.hold=true;
  advance(g,.5);
  assert.equal(u.logistics.stranded,false,'a connected distant source accepts bounded navigation legs');
  assert.ok(u.x<300&&u.worldGoal?.x<30,'mandatory withdrawal keeps the full distant goal');
}
{
  const g=game(),u=troops(g)[0];Object.assign(u,{x:70,z:30,holdFire:true,auto:false,autoRetreat:false});
  u.logistics.forced=true;u.logistics.exhausted=true;u.logistics.provisions=0;
  command(g,0,{t:'stop',ids:[u.id]});advance(g,.1);
  assert.equal(u.supplyHold,true);
  Object.assign(u.logistics,{forced:false,exhausted:false,provisions:120});advance(g,.1);
  assert.equal(u.supplyHold,false,'recovery clears the previous escape hold');
  Object.assign(u.logistics,{forced:true,exhausted:true,provisions:0});advance(g,.5);
  assert.ok(u.path.length&&u.retreating,'a later shortage starts a fresh mandatory escape');
}

{
  const m=map(); m.w=200;m.rows=Array(m.h).fill('.'.repeat(m.w));m.spawns[1].x=194;
  const g=createGame(m,['one','two'],false,[0,1],[0,1],{mode:'classic',logistics:true,weather:'clear'}),restore=unsupplied(g);
  needSupplies(g);advance(g,3);
  const truck=trucksOf(g)[0],from={x:truck.x,z:truck.z},at={x:300,z:30};
  g.players[0].fuel=.8;
  assert.equal(command(g,0,{t:'move',orders:[[truck.id,at.x,at.z]]}),'fuel','a long truck trip cannot start with only enough Fuel for its first leg');
  g.players[0].fuel=100;
  assert.equal(command(g,0,{t:'move',orders:[[truck.id,at.x,at.z]]}),undefined);
  const source=[...g.convoys.stores.values()].find(s=>s.owner===0&&s.source);
  const roundTrip=Math.hypot(at.x-from.x,at.z-from.z)+Math.hypot(at.x-source.x,at.z-source.z);
  assert.ok(truck.convoy.operatingMetres>=roundTrip*1.2-5,'the entire distant outward and return journey is prepaid');
  restore();
}
{
  const m=map();m.rows=m.rows.map(row=>row.slice(0,25)+'W'+row.slice(26));
  const g=createGame(m,['one','two'],false,[0,1],[0,1],{logistics:true,weather:'clear'}),u=troops(g)[0],enemy=troops(g,1)[0];
  Object.assign(u,{x:70,z:30,auto:false,autoRetreat:false});Object.assign(enemy,{x:130,z:30,holdPos:true,holdFire:true,auto:false,autoRetreat:false});
  u.logistics.forced=true;u.logistics.exhausted=true;u.logistics.provisions=0;g.skipFog=true;advance(g,.1);
  assert.equal(u.logistics.stranded,true);g.players[0].visible.add(enemy.id);const before={x:u.x,z:u.z};
  assert.equal(command(g,0,{t:'attack',ids:[u.id],target:enemy.id}),undefined);advance(g,.5);
  assert.ok(Math.hypot(u.x-before.x,u.z-before.z)<.05,'stranded defense cannot chase an out-of-range target');
  assert.equal(u.path.length,0);
}
{
  // allies share supply sources, but each player's new trucks come from that player's own HQ
  const g = game('conquest', [0, 0]), restore = unsupplied(g);
  needSupplies(g); advance(g, 6);
  for (const owner of [0, 1]) {
    const trucks = [...g.units.values()].filter(u => u.owner === owner && u.type === 'truck'), own = g.players[owner].spawn, ally = g.players[1 - owner].spawn;
    assert.ok(trucks.length && trucks.every(t => Math.hypot(t.x - own.x, t.z - own.z) < Math.hypot(t.x - ally.x, t.z - ally.z)), `player ${owner} trucks start at their own HQ`);
  }
  restore();
}
console.log('PASS territory refill and cut-off, physical deliveries, privacy, hold/resume, combat ammunition, actual driving fuel, blocked withdrawals and own-HQ trucks');
