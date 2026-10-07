import assert from 'node:assert/strict';
import { createGame, step, command, snapshotFor, popOf, CFG } from './shared/sim.js';
import { generateWorldMap } from './shared/world-conquest.js';
import { LOGISTICS } from './shared/logistics.js';
const advance = (seconds) => { for (let n = 0; n < seconds * 20; n++) step(g); };
const g=createGame(generateWorldMap({seed:42,players:2}),['one','two'],false,[0,1],[0,1],{mode:'world',logistics:true,weather:'clear'});
const troops=[...g.units.values()].filter(u=>u.owner===0&&!u.convoy&&!u.cells);
assert.equal(popOf(g,0),troops.length,'supply trucks use no combat population');
assert.ok([...g.units.values()].filter(u=>u.owner<0).every(u=>!u.logistics),'local neutral defenders remain outside player logistics');
assert.equal([...g.convoys.stores.values()].filter(s=>s.region!==undefined).length,0,'territory supply replaces the regional relay caches');

// Supply runs through owned regions that border each other, one step weaker per region beyond the first.
const map=g.world.regionMap, regionOf=at=>map[Math.floor(at.z/2)*g.w+Math.floor(at.x/2)];
const hq=[...g.units.values()].find(u=>u.owner===0&&u.type==='hq'), home=regionOf(hq), rate=i=>snapshotFor(g,0,[]).logistics.regions.find(([id])=>id===g.world.regions[i].id)?.[1];
const squad=troops.find(u=>u.logistics);
assert.equal(snapshotFor(g,0,[]).logistics.units.find(row=>row.id===squad.id).supply,1,'troops at home are in full supply');
const edges=g.supplyGraph.edges, near=[...edges[home]].find(i=>g.world.regions[i].team<0);
const beyond=[...edges[near]].find(i=>i!==home&&!edges[home].has(i)&&g.world.regions[i].team<0);
assert.ok(near!==undefined&&beyond!==undefined,'the seed has a neutral neighbour and one beyond it');
const region=g.world.regions[near];
// the local defenders there would fight the squad; this test is about supply
for(const u of [...g.units.values()]) if(u.owner<0&&[near,beyond].includes(regionOf(u))) g.units.delete(u.id);
// inside the region but outside its capture circle, so the squad does not claim it
const spot=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1]].map(([dx,dz])=>({x:region.x+dx*(CFG.pointRadius+8),z:region.z+dz*(CFG.pointRadius+8)})).find(at=>regionOf(at)===near);
assert.ok(spot,'a spot in the region outside its capture circle');
Object.assign(squad,spot,{holdFire:true,holdPos:true,auto:false,autoRetreat:false});
advance(2);
assert.ok(snapshotFor(g,0,[]).logistics.units.find(row=>row.id===squad.id).grace>0,'a squad in a neutral region starts its grace countdown');
advance(LOGISTICS.supplyGrace);
assert.equal(snapshotFor(g,0,[]).logistics.units.find(row=>row.id===squad.id).cut,true,'beyond owned territory it is cut off');
region.team=0;region.progress=1;advance(2);
assert.equal(rate(near),1,'a captured neighbour is one region out: full supply');
assert.equal(snapshotFor(g,0,[]).logistics.units.find(row=>row.id===squad.id).cut,false,'capturing the region restores the line');
const far=g.world.regions[beyond];far.team=0;far.progress=1;advance(2);
assert.ok(Math.abs(rate(beyond)-(1-CFG.supply.hop))<0.02,'each region further out is weaker');
region.team=-1;advance(2);
assert.equal(rate(beyond),0,'losing the region between cuts off everything beyond it');
region.team=0;advance(2);

const hqDead=[...g.units.values()].find(u=>u.owner===0&&u.type==='hq');hqDead.hp=0;
step(g);assert.equal(!!g.players[0].out,false,'HQ destruction does not eliminate World armies');
g.players[0].mp=10000;
assert.equal(command(g,0,{t:'recover'}),undefined,'a rebuilt HQ remains available');
for(let n=0;n<40;n++)step(g);
assert.ok([...g.convoys.stores.values()].some(s=>s.source&&s.owner===0&&s.active),'rebuilt HQ restores the physical supply source');
const own=snapshotFor(g,0,[]),enemy=snapshotFor(g,1,[]);
assert.ok(own.logistics.units.length>0);
assert.ok(enemy.logistics.units.every(u=>g.units.get(u.id).owner===1),'World private reserves never leak to enemies');
assert.ok(enemy.logistics.stores.every(s=>s.owner===1),'World cache details stay with the allied team');
assert.ok(enemy.logistics.regions.every(([id])=>g.world.regions.find(r=>r.id===id).team===1),'region supply is shown only for the own team');
console.log('PASS World territory supply: region chain and distance, cut-off grace, capture and loss, neutral exemption, HQ recovery, population and privacy');
