// The scripted Wave director retains immediate planning and bounded observation-beat movement dispatch.
import assert from 'node:assert/strict';
import {createGame,command,step,snapshotCache,UNITS,CFG} from './shared/sim.js';
import {think,observe,flushHordeMovement,HORDE_ORDER_BATCH,resetAI} from './shared/ai.js';
import {viewFor} from './shared/ai-view.js';
const map={w:80,h:80,rows:Array(80).fill('.'.repeat(80)),spawns:[{x:40,y:5},{x:10,y:75},{x:70,y:75}],defend:[0],points:[]};
const make=(count=20)=>{const g=createGame(map,['a'],false,[0],[0],{mode:'horde'});g.mode.active=true;g.mode.wave=1;g.mode.profile='mixed';g.mode.purchaseRandom={seed:1};g.mode.budget=0;g.mode.reserve=[];const t=[...g.units.values()].find(u=>u.type==='rifle'),ids=[];
for(let i=0;i<count;i++){const u=structuredClone(t);Object.assign(u,{id:g.nextId++,owner:g.mode.slot,x:15+(i%20)*3,z:85+Math.floor(i/20)*3,path:[],orders:[],autoRetreat:false,auto:false});assert.ok(u.x>=0&&u.z>=0&&u.x<map.w*2&&u.z<map.h*2,'staged actors are inside playable space');g.units.set(u.id,u);ids.push(u.id);}g.players[g.mode.slot].visible.add(g.mode.bunker);return{g,ids};};
{
const{g,ids}=make(),mem={},slot=g.mode.slot,view=viewFor(g,slot,mem),sent=[];
think(g,slot,{decisionOnly:true,memory:mem,view,submit:c=>{sent.push(c);return command(g,slot,c);}});
assert.equal([...g.units.values()].filter(u=>u.owner===slot&&u.amove).length,HORDE_ORDER_BATCH,'large AI launch is bounded');
const first=sent.flatMap(c=>c.orders??[]).map(o=>o[0]);assert.deepEqual(first,ids.slice(0,HORDE_ORDER_BATCH),'launch uses stable original FIFO order');
assert.equal(mem.hordeOrders.pending.size,ids.length-HORDE_ORDER_BATCH);
const dead=ids[5],changed=ids[6],foreign=ids[7];g.units.delete(dead);command(g,slot,{t:'move',orders:[[changed,145,145]]});g.units.get(foreign).owner=0;
let ticks=0;for(;mem.hordeOrders.pending.size;ticks++){assert.ok(ticks<20);g.tick+=2;const v=viewFor(g,slot,mem),before=sent.length;flushHordeMovement(v,slot,mem,c=>{sent.push(c);return command(g,slot,c);});assert.ok(sent.length-before<=HORDE_ORDER_BATCH);}
assert.ok(!sent.some(c=>c.orders?.some(([id])=>[dead,changed,foreign].includes(id))),'dead, foreign and superseded own plans are discarded');
assert.ok(g.units.get(changed).worldGoal.x>140,'player-style replacement remains authoritative');
assert.ok(ids.filter(id=>![dead,changed,foreign].includes(id)).every(id=>g.units.get(id).amove),'all valid queued members receive ordinary attack-move');
assert.ok(ticks*0.1<=0.5,'20-unit batch launches promptly');
}
{
const{g,ids}=make(),slot=g.mode.slot;g.tick=0;let view=observe(g,slot,snapshotCache(g));think(g,slot,{decisionOnly:true,view});
let maxCalls=0;for(let t=0;t<14;t++){g.tick+=2;const before=g.pathStats.calls;observe(g,slot,snapshotCache(g));maxCalls=Math.max(maxCalls,g.pathStats.calls-before);}
assert.ok(maxCalls<=HORDE_ORDER_BATCH,'real observe callback submits only a bounded path slice');
assert.ok(ids.every(id=>g.units.get(id).amove),'actual server-style observe drains outstanding orders');
}
{
const{g,ids}=make(),slot=g.mode.slot,mem={};think(g,slot,{decisionOnly:true,memory:mem,view:viewFor(g,slot,mem)});assert.ok(mem.hordeOrders.pending.size);
g.mode.active=false;g.tick+=2;flushHordeMovement(viewFor(g,slot,mem),slot,mem,()=>assert.fail('old wave order cannot launch during break'));assert.equal(mem.hordeOrders,null);
g.mode.active=true;g.mode.wave=2;flushHordeMovement(viewFor(g,slot,mem),slot,mem,()=>assert.fail('old wave cannot launch in next wave'));assert.equal(mem.hordeOrders.pending.size,0);
}
{
const{g,ids}=make(),slot=g.mode.slot;command(g,slot,{t:'move',orders:ids.map(id=>[id,80,80])});assert.ok(ids.every(id=>g.units.get(id).worldGoal),'direct commands apply immediately to every unit');
}
{
const{g,ids}=make(),slot=g.mode.slot,mem={};think(g,slot,{decisionOnly:true,memory:mem,view:viewFor(g,slot,mem)});
const atCell=ids[5],stop=ids[6],u=g.units.get(atCell);command(g,slot,{t:'move',orders:[[atCell,u.x,u.z]]});command(g,slot,{t:'stop',ids:[stop]});
g.tick+=2;const sent=[];flushHordeMovement(viewFor(g,slot,mem),slot,mem,c=>{sent.push(c);return command(g,slot,c);});
assert.ok(!sent.some(c=>c.orders?.some(([id])=>id===atCell||id===stop)),'a same-cell replacement and idle Stop invalidate pending orders');
assert.ok(!mem.hordeOrders.pending.has(atCell)&&!mem.hordeOrders.pending.has(stop));
}
{
const{g}=make(),slot=g.mode.slot,mem={};think(g,slot,{decisionOnly:true,memory:mem,view:viewFor(g,slot,mem)});assert.ok(mem.hordeOrders.pending.size);
g.winner=0;g.endAt={x:80,z:80};g.endReason='fixture';g.tick+=2;flushHordeMovement(viewFor(g,slot,mem),slot,mem,()=>assert.fail('a decided match cannot dispatch pending orders'));assert.equal(mem.hordeOrders,null);
}
{
const{g,ids}=make(),slot=g.mode.slot;think(g,slot,{decisionOnly:true,view:observe(g,slot,snapshotCache(g))});const moving=ids.filter(id=>g.units.get(id).amove).length;resetAI(g,slot);g.tick+=2;observe(g,slot,snapshotCache(g));
assert.equal(ids.filter(id=>g.units.get(id).amove).length,moving,'controller reset discards pending dispatch before a later observation');
}
{
const{g}=make(),slot=g.mode.slot,mem={},old=viewFor(g,slot,mem),sent=[];g.mode.active=false;g.tick=40;
think(g,slot,{decisionOnly:true,memory:mem,view:old,submit:c=>{sent.push(c);return command(g,slot,c);}});
assert.equal(sent.length,0,'a stale active observation cannot dispatch after the public Wave ends');assert.equal(mem.hordeOrders,null);
g.mode.active=true;g.mode.wave=2;think(g,slot,{decisionOnly:true,memory:mem,view:old,submit:()=>assert.fail('old Wave observation cannot dispatch into the next Wave')});assert.equal(mem.hordeOrders,null);
}
{
const{g,ids}=make(238),slot=g.mode.slot,mem={};think(g,slot,{decisionOnly:true,memory:mem,view:viewFor(g,slot,mem)});
let beats=0;while(mem.hordeOrders.pending.size){assert.ok(beats<60,'238 staged units cannot wait past six seconds');g.tick+=2;flushHordeMovement(viewFor(g,slot,mem),slot,mem,c=>command(g,slot,c));beats++;}
assert.equal(ids.filter(id=>g.units.get(id).amove).length,238,'every valid fielded unit receives its original goal');
assert.equal(beats,59,'first four launch immediately and the remaining238 drain in59 observation beats');
assert.ok(beats*0.1<=6);
assert.ok(g.mode.active&&g.mode.wave===1,'outstanding fielded units keep their Wave active');
}
{
const{g,ids}=make(238),slot=g.mode.slot,mem={};think(g,slot,{decisionOnly:true,memory:mem,view:viewFor(g,slot,mem)});
let beats=0;while(mem.hordeOrders.pending.size){assert.ok(beats<60);g.tick+=4;flushHordeMovement(viewFor(g,slot,mem),slot,mem,c=>command(g,slot,c));beats++;}
assert.equal(ids.filter(id=>g.units.get(id).amove).length,238);
assert.ok(g.tick/20<=12,'adaptive five-Hz observations drain the staged batch within twelve seconds');
}
console.log('Horde bounded launch, FIFO, supersession, ownership, wave reset, actual observe and direct-command contracts passed.');
