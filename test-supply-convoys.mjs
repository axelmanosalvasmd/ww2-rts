import assert from 'node:assert/strict';
import { createGame, step, command, snapshotFor, UNITS, TICK, placementCheck } from './shared/sim.js';

import { placementState, denySentence } from './client/availability.js';

const map = () => ({ w: 80, h: 60, rows: Array(60).fill('.'.repeat(80)), spawns: [{ x: 5, y: 25 }, { x: 74, y: 25 }], points: [] });
const game = (mode = 'conquest', teams = [0, 1]) => createGame(map(), ['one', 'two'], false, teams, [0, 1], { mode, logistics: true, weather: 'clear' });
const advance = (g, seconds) => { for (let n = 0; n < Math.ceil(seconds / TICK); n++) step(g); };
const troops = (g, owner = 0) => [...g.units.values()].filter(u => u.owner === owner && u.type === 'rifle');

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
  const g = game(), u = troops(g)[0];
  Object.assign(u, { x: 70, z: 25, holdFire: true, holdPos: true, autoRetreat: false });
  advance(g, 6);
  const trucks = [...g.units.values()].filter(u => u.owner === 0 && u.type === 'truck');
  assert.ok(trucks.length >= 2, 'fleet is created without a player convoy command');
  u.logistics.provisions = 40;
  let travelled = false;
  for (let n=0;n<35/TICK;n++) { step(g); travelled ||= trucks.some(t => Math.hypot(t.x - 11,t.z - 51)>15); }
  assert.ok(u.logistics.provisions > 40, 'autonomous physical delivery replenishes remote troops');
  assert.ok(travelled, 'supplies travel on actual moving trucks');
  const truck = trucks.find(t => g.units.has(t.id));
  assert.equal(command(g, 0, { t: 'stop', ids: [truck.id] }), undefined);
  const at = { x: truck.x, z: truck.z };
  advance(g, 3);
  assert.ok(Math.hypot(truck.x - at.x, truck.z - at.z) < 0.5, 'explicit convoy hold stays held');
  assert.equal(command(g, 0, { t: 'logisticsResume', ids: [truck.id] }), undefined);
  assert.equal(truck.convoy.hold, false, 'resume returns the truck to automatic service');
}

{
  const g = game(), u = troops(g)[0];
  Object.assign(u, { x: 70, z: 20, autoRetreat: false, holdFire: true });
  advance(g, 6);
  u.logistics.provisions = 0;
  for (const t of g.units.values()) if (t.owner === 0 && t.type === 'truck') t.convoy.hold = true;
  advance(g, 21);
  assert.equal(u.logistics.forced, true, 'exhaustion overrides the ordinary auto-retreat toggle');
  command(g, 0, { t: 'attack', ids: [u.id], target: troops(g, 1)[0].id });
  assert.equal(u.logistics.forced, true, 'ordinary attack cannot cancel supply withdrawal');
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
  const g=game();g.players[0].mp=10000;
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
  const g=createGame(m,['one','two'],false,[0,1],[0,1],{logistics:true,weather:'clear'}),u=troops(g)[0];
  Object.assign(u,{x:53,z:51,holdFire:true,holdPos:true});u.logistics.provisions=40;
  const truck=[...g.units.values()].find(t=>t.type==='truck'&&t.owner===0);
  Object.assign(truck,{x:47,z:51,path:[],worldGoal:null});
  Object.assign(truck.convoy,{hold:false,state:'unloading',timer:8,target:{id:`unit:${u.id}`,unit:u.id,members:[u.id],x:u.x,z:u.z},cargo:{ammo:0,provisions:120,fuel:0}});
  step(g);assert.ok(u.logistics.provisions<40,'a close truck cannot unload across impassable water');
}
{
  const m=map(),g=game(),s=snapshotFor(g,0,[]),preview=placementState(s,m,m.rows.map(row=>[...row]),[0,1]);
  assert.equal(placementCheck(preview.game,{kind:'supplycache',x:25,z:51,team:0}).ok,true,'the client placement preview accepts enabled supply caches');
  assert.equal(command(g,0,{t:'build',ids:[troops(g)[0].id],kind:'supplycache',x:25,z:51}),undefined,'Conquest builders can place a forward cache');
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
  const g=createGame(m,['one','two'],false,[0,1],[0,1],{mode:'classic',logistics:true,weather:'clear'});
  const truck=[...g.units.values()].find(u=>u.type==='truck'&&u.owner===0),from={x:truck.x,z:truck.z},at={x:300,z:30};
  g.players[0].fuel=.8;
  assert.equal(command(g,0,{t:'move',orders:[[truck.id,at.x,at.z]]}),'fuel','a long truck trip cannot start with only enough Fuel for its first leg');
  g.players[0].fuel=100;
  assert.equal(command(g,0,{t:'move',orders:[[truck.id,at.x,at.z]]}),undefined);
  const source=[...g.convoys.stores.values()].find(s=>s.owner===0&&s.source);
  const roundTrip=Math.hypot(at.x-from.x,at.z-from.z)+Math.hypot(at.x-source.x,at.z-source.z);
  assert.ok(truck.convoy.operatingMetres>=roundTrip*1.2-5,'the entire distant outward and return journey is prepaid');
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
console.log('PASS physical deliveries, privacy, hold/resume, combat ammunition, actual driving fuel and blocked withdrawals');
