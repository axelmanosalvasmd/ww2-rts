// Stateful terrain delivery must match the prior full-reset recipient sequence.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as sim from './shared/sim.js';
import { viewFor } from './shared/ai-view.js';
const sourceURL = new URL('./shared/ai-view.js', import.meta.url);
const source = readFileSync(sourceURL, 'utf8');
const pending = 'terrainPending: world ? new Set(g.cellLog.keys()) : terrainPending(g, slot, memory)';
assert.ok(source.includes(pending));
const oracleSource = source.replace(pending, 'terrainPending: new Set(g.cellLog.keys())')
  .replace("from './sim.js'", `from '${new URL('./sim.js', sourceURL)}'`);
const { viewFor: fullResetView } = await import('data:text/javascript;base64,' + Buffer.from(oracleSource).toString('base64'));
const oldSim = sim, newSim = sim, oldView = fullResetView, newView = viewFor;
const sims=[oldSim,newSim],views=[oldView,newView],evidence=[];
const map={w:80,h:80,rows:Array(80).fill('.'.repeat(80)),spawns:[{x:10,y:10},{x:70,y:70}],points:[]};
function games(teams=[0,1]){return sims.map(sim=>{const prior=Math.random;Math.random=()=>.5;try{return sim.createGame(map,['A','B'],false,teams,[0,1],{weather:false,supply:false});}finally{Math.random=prior;}});}
for(const teams of [[0,1],[0,0]]){
 const gs=games(teams),mem=[Array.from({length:2},()=>({})),Array.from({length:2},()=>({}))];
 const cell=12*80+16,hidden=65*80+65;
 const apply=fn=>gs.forEach((g,i)=>fn(g,sims[i]));
 function deliver(label){
  for(let slot=0;slot<2;slot++){
   const before=gs.map(g=>structuredClone(g));const results=gs.map((g,i)=>views[i](g,slot,mem[i][slot],sims[i].snapshotCache(g)));
   assert.deepEqual({...results[1],sees:String(results[1].sees)},{...results[0],sees:String(results[0].sees)},`${teams}/${label}/${slot}: complete delivered view matches full reset`);
   assert.deepEqual(gs[0],before[0]);assert.deepEqual(gs[1],before[1]);
   assert.deepEqual(mem[1][slot],mem[0][slot],`${label}: planner-visible memory contains no source cache state`);
   const raw = new Set([gs[1], gs[1].cellLog, ...gs[1].cellLog]);
   const seen = new Set();
   function detached(value) {
     if (!value || typeof value !== 'object' || seen.has(value)) return;
     assert.equal(raw.has(value), false, 'planner-visible memory never exposes raw game/log/source rows');
     seen.add(value);
     if (value instanceof Map) for (const [key, entry] of value) { detached(key); detached(entry); }
     else if (value instanceof Set) for (const entry of value) detached(entry);
     else if (!ArrayBuffer.isView(value)) for (const entry of Object.values(value)) detached(entry);
   }
   detached(mem[1][slot]);
   evidence.push({teams,label,slot,cells:results[0].snapshot.cells.length});
  }
 }
 apply((g,sim)=>{sim.mutateWorldCell(g,cell,{object:'R',mine:true});sim.mutateWorldCell(g,hidden,{object:'B'});});deliver('hidden-mine-and-building');
 apply(g=>{g.mineSeen.set(cell,1);});deliver('mine-discovery-same-source-row-and-key');
 apply(g=>{g.mines.set(cell,1);});deliver('mine-owner-without-source-replacement');
 apply(g=>{g.wear[cell]+=.03;});deliver('unquantized-wear-without-source-replacement');
 apply((g,sim)=>{for(const u of g.units.values())if(u.owner===0){u.x=140;u.z=140;}g.visionTick=1;sim.mutateWorldCell(g,cell,{mine:false});});deliver('unseen-mine-removal');
 apply(g=>{for(const u of g.units.values())if(u.owner===0){u.x=25;u.z=25;}g.visionTick=2;});deliver('mine-removal-after-return');
 apply((g,sim)=>{sim.mutateWorldCell(g,cell,{object:'B'});});deliver('source-index-overwrite');
 apply((g,sim)=>{sim.mutateWorldCell(g,cell,{object:'R'});});deliver('same-index-overwrite-again');
 apply(g=>{g.cellLog=[...g.cellLog];});deliver('source-log-identity-reset');
 apply(g=>{g.players[1].team=1-g.players[1].team;});deliver('team-change-reset');
}
console.log('Private terrain delivery complete-view/game/memory equivalence',evidence.length,'cases passed');
