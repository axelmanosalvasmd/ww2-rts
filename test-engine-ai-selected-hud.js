// Selected HUD data follows actual physical selection; detector snapshots never enter planner memory.
import assert from 'node:assert/strict';
import { createGame, command, UNITS } from './shared/sim.js';
import { viewFor } from './shared/ai-view.js';
import { plan } from './shared/ai.js';
import { createHands, enqueueDecision, advanceHands } from './shared/ai-hands.js';
import { perceive, readinessFor, needsInspection } from './shared/ai-perception.js';
import { createHands as inspectionHands, queueInspection, advanceHands as advanceInspection } from './shared/ai-hands.js';
const map={w:160,h:160,rows:Array(160).fill('.'.repeat(160)),spawns:[{x:20,y:20},{x:140,y:140}],points:[]};
function fixture(){
 const rng=Math.random;Math.random=()=>.5;let g;try{g=createGame(map,['AI','enemy'],false,[0,1],[0,1],{weather:false});}finally{Math.random=rng;}
 g.units.clear();g.players[0].mp=g.players[1].mp=5000;g.players[0].mun=1000;g.players[0].sp=0;
 for(const [owner,unit]of [[0,'mg'],[0,'mg'],[1,'rifle']])assert.equal(command(g,owner,{t:'buy',unit}),undefined);
 const [a,b,e]=[...g.units.values()];
 Object.assign(a,{x:210,z:210,targetId:e.id,auto:false,autoRetreat:false});Object.assign(b,{x:218,z:210,targetId:e.id,auto:false,autoRetreat:false});Object.assign(e,{x:228,z:210});
 g.players[0].mp=0;g.tick=400;g.players[0].visible.add(e.id);
 return {g,a,b,e,state:{camera:{x:210,z:210,yaw:0,distance:60},hands:{selected:[]}}};
}
const observed=f=>viewFor(f.g,0,{});
const scene=f=>perceive(observed(f),0,f.state,f.g.tick);
function decisions(view){const out=[],mem={human:{persona:{pressure:1,opening:[]},mood:0}};plan(view,0,{level:'normal',human:true,seed:27,concern:{kind:'combat',x:210,z:210}},mem,c=>{out.push(structuredClone(c));return undefined;});return out;}
{
 const f=fixture();f.a.cd=0;const av=scene(f),a=decisions(av);f.a.cd=30;const bv=scene(f),b=decisions(bv);
 assert.deepEqual(b,a,'unselected own cooldown perturbations cannot change current real planner actions');
 assert.equal(av.units.get(f.a.id).cd,Infinity);assert.equal(bv.units.get(f.a.id).cd,Infinity);
 assert.equal(needsInspection(av,f.a.id),true);assert.equal(readinessFor(av,f.a.id).known,false);
 assert.ok(!a.some(c=>c.t==='ability'),'unknown readiness cannot generate an ability order');
 f.state.hands.selected=[f.a.id];f.a.cd=0;const ready=scene(f),readyCommands=decisions(ready);
 assert.equal(needsInspection(ready,f.a.id),false);assert.equal(readinessFor(ready,f.a.id).anyReady,true);
 assert.ok(readyCommands.some(c=>c.t==='ability'&&c.ids.includes(f.a.id)),'current planner consumes the actual selected singleton readiness');
 f.a.cd=3.2;const cooling=scene(f);assert.equal(cooling.units.get(f.a.id).cd,4);
 assert.ok(!decisions(cooling).some(c=>c.t==='ability'),'rounded selected HUD cooldown changes the next real ability decision');
 f.state.hands.selected=[];f.a.cd=0;const stale=scene(f);
 assert.equal(stale.units.get(f.a.id).cd,Infinity);assert.equal(stale.units.get(f.a.id).cdState,'stale-hud');
 assert.equal(stale.units.get(f.a.id).lastHUD.ability.cooldownSeconds,4,'only the explicit last rounded reading remains after deselection');
}
{
 const f=fixture();f.state.hands=createHands({slot:0,seed:27,level:'normal',camera:f.state.camera});
 const logs=[];f.state.hands.log=e=>logs.push(e);
 const before=scene(f);assert.ok(needsInspection(before,f.a.id));
 assert.ok(enqueueDecision(f.state.hands,{t:'stance',ids:[f.a.id],key:'holdPos',on:true},before));
 for(let tick=0;tick<500&&!f.state.hands.selected.includes(f.a.id);tick++)advanceHands(f.state.hands,tick,before,()=>undefined);
 assert.deepEqual(f.state.hands.selected,[f.a.id],'real hit-tested hands selection succeeds');
 assert.ok(logs.some(e=>e.kind==='select-click'&&e.ids.includes(f.a.id)));
 const after=scene(f);assert.equal(after.units.get(f.a.id).cdKnown,true);
 assert.ok(decisions(after).some(c=>c.t==='ability'&&c.ids.includes(f.a.id)),'physical selection unlocks the real ability branch');
 // Actual wrong or empty selection cannot unlock the intended actor.
 f.state.hands.selected=[f.b.id];const wrong=scene(f);assert.equal(wrong.units.get(f.a.id).cd,Infinity);
 assert.equal(wrong.units.get(f.b.id).cdKnown,true);f.state.hands.selected=[];assert.equal(scene(f).selectedHUD.ids.length,0);
}
for (const outcome of ['correct', 'wrong', 'miss']) {
 const f=fixture(),logs=[],sent=[];f.state.hands=inspectionHands({slot:0,seed:27,level:'normal',camera:f.state.camera,log:logs});
 f.state.hands.openingDone=true;f.state.hands.openingUntil=0;
 const before=scene(f);assert.ok(queueInspection(f.state.hands,[f.a.id],before,{eventTick:0,concern:'combat'}));
 advanceInspection(f.state.hands,0,before,c=>sent.push(c));
 while(f.state.hands.active.reacting)advanceInspection(f.state.hands,f.state.hands.tick+1,before,c=>sent.push(c));
 if(outcome!=='correct'){
  Object.assign(before.units.get(f.a.id),{x:450,z:450});Object.assign(f.a,{x:450,z:450});
  Object.assign(before.units.get(f.b.id),outcome==='wrong'?{x:210,z:210}:{x:450,z:450});
  Object.assign(f.b,outcome==='wrong'?{x:210,z:210}:{x:450,z:450});
 }
 for(let t=f.state.hands.tick;t<100;t++)advanceInspection(f.state.hands,t,before,c=>sent.push(c));
 assert.equal(sent.length,0,'inspection submits no command or synthetic response');assert.equal(logs.length,1);
 assert.equal(logs[0].inspection,true);assert.equal(logs[0].inspectionAcquired,outcome==='correct');
 const after=scene(f);
 if(outcome==='correct'){
  assert.deepEqual(f.state.hands.selected,[f.a.id]);assert.equal(readinessFor(after,f.a.id).known,true);
  assert.ok(decisions(after).some(c=>c.t==='ability'&&c.ids.includes(f.a.id)));
 }else{
  assert.deepEqual(f.state.hands.selected,outcome==='wrong'?[f.b.id]:[]);
  assert.equal(after.units.get(f.a.id).cd,Infinity,'wrong or missed inspection cannot reveal the intended actor readiness');
  assert.equal(after.selectedHUD.ids.includes(f.a.id),false);
  if(outcome==='wrong')assert.equal(readinessFor(after,f.b.id).known,true,'only the actual wrong selection supplies its own HUD');
 }
}
{
 const f=fixture(),full=UNITS.mg.models*UNITS.mg.hpPer;f.state.hands.selected=[f.a.id,f.b.id];
 f.a.cd=0;f.b.cd=12;f.a.hp=full*.61;f.b.hp=full*.74;const a=scene(f);
 f.a.cd=12;f.b.cd=0;f.a.hp=full*.62;f.b.hp=full*.73;const b=scene(f);
 assert.deepEqual(b.selectedHUD,a.selectedHUD,'identical group HUD masks which member is ready and exact member health');
 for(const id of [f.a.id,f.b.id]){assert.equal(a.units.get(id).cd,Infinity);assert.equal(a.units.get(id).cdState,'group-hud');assert.equal(a.units.get(id).exactHPKnown,false);}
 assert.deepEqual(decisions(b),decisions(a),'member cooldown swaps leave the next planner actions unchanged');
 assert.equal(readinessFor(a,f.a.id).known,false);assert.equal(readinessFor(a,f.a.id).aggregate.anyReady,true);
 f.a.cd=3.2;f.b.cd=8.7;const c=scene(f);assert.equal(c.selectedHUD.types[0].ability.cooldownSeconds,4);
 f.a.retreating=true;f.a.cd=0;const d=scene(f);assert.equal(d.selectedHUD.types[0].ability.cooldownSeconds,9,'retreating selected members cannot lower the active crew cooldown');
}
{
 const f=fixture();f.state.hands.selected=[f.a.id];scene(f);f.state.camera={x:80,z:80,yaw:0,distance:60};
 f.a.cd=6.3;f.a.hp=63;f.e.cd=25;f.e.hp=50;const v=scene(f);
 assert.equal(v.screenIds.has(f.a.id),false);assert.equal(v.units.get(f.a.id).cd,7);
 assert.equal(v.units.get(f.a.id).hp,63);assert.equal(v.units.get(f.a.id).hpSource,'selected-hud');
 assert.equal(v.units.get(f.e.id).cd,Infinity);assert.notEqual(v.units.get(f.e.id).hp,50,'selected own HUD never refreshes remembered enemy health');
 assert.equal(v.selectedHUD.ids.includes(f.e.id),false);
 f.state.hands.selected=[f.e.id,999999];assert.equal(scene(f).selectedHUD.ids.length,0,'enemy and nonexistent selection IDs supply no HUD detail');
}
{
 const f=fixture();f.state.hands.selected=[f.a.id];f.a.cd=3;const v=scene(f);
 const remembered=f.state.screenMemory.get(f.a.id),cached=f.state.hudMemory.get(f.a.id);
 v.selectedHUD.types[0].ability.cooldownSeconds=99;assert.equal(cached.ability.cooldownSeconds,3);
 v.units.get(f.a.id).lastHUD.ability.cooldownSeconds=88;assert.equal(remembered.lastHUD.ability.cooldownSeconds,3);
 remembered.lastHUD.ability.cooldownSeconds=77;assert.equal(cached.ability.cooldownSeconds,3);
 const detail=readinessFor(v,f.a.id);detail.cooldownSeconds=66;assert.equal(v.selectedHUD.types[0].ability.cooldownSeconds,99);
 f.state.hands.selected=[];const stale=scene(f);assert.equal(stale.units.get(f.a.id).cd,Infinity);
 assert.equal(stale.units.get(f.a.id).lastHUD.ability.cooldownSeconds,3,'mutable view and memory never corrupt retained selected HUD readings');
}
{
 const f=fixture(),full=UNITS.mg.models*UNITS.mg.hpPer;f.a.hp=full*.58;f.e.hp=123;f.e.cd=0;const a=scene(f);
 f.a.hp=full*.59;f.e.cd=99;const b=scene(f);
 assert.equal(a.units.get(f.a.id).hp,b.units.get(f.a.id).hp,'nearby world health perturbations share the approved 5% estimate');
 assert.equal(a.units.get(f.e.id).cd,Infinity);assert.equal(b.units.get(f.e.id).cd,Infinity);
 f.a.hp=full*.58;
 const eventState={camera:{...f.state.camera},hands:{selected:[]}};
 const initial=observed(f);perceive(initial,0,eventState);
 f.g.tick+=2;f.a.hp=full*.2;
 const event=perceive(observed(f),0,eventState).newEvents.find(event=>event.kind==='screen-damage');
 assert.equal(event.amount,29,'measurement retains the delivered HP delta rather than the coarser planner estimate');
 assert.equal(event.provenance,'heavy-damage');assert.equal(event.responseRequired,true);
 assert.equal(event.responseReason,'heavy-damage');assert.equal(event.responsePolicy,'screen-v1');
 assert.deepEqual(event.responseUnits,[f.a.id]);assert.equal(event.episode,`${f.a.id}:1`);assert.equal(event.episodeTick,402);
 const detached=scene(f);detached.selectedHUD.types.push({type:'tampered'});assert.equal(f.state.hudMemory.size,0);
}
{
 const f=fixture();f.e.x=f.e.z=600;const observation=observed(f),secret='detector-only-offscreen-row-probe';
 const row=observation.snapshot.units.find(row=>row[0]===f.e.id);assert.ok(row,'the delivered enemy exists outside the commander camera');
 row.push(secret);const view=perceive(observation,0,f.state);
 const visited=new Set(),values=[],keys=[];
 function walk(value){
  if(value===null||typeof value!=='object'){values.push(value);return;}
  if(visited.has(value))return;visited.add(value);
  if(value instanceof Map)for(const [k,v]of value){walk(k);walk(v);}
  if(value instanceof Set)for(const v of value)walk(v);
  for(const key of Reflect.ownKeys(value)){keys.push(key);const d=Object.getOwnPropertyDescriptor(value,key);if(d&&Object.hasOwn(d,'value'))walk(d.value);}
 }
 const memory={human:f.state};walk({view,memory});
 assert.equal(values.includes(secret),false,'a planner traversing every reachable memory graph cannot reach copied private offscreen rows');
 assert.equal(visited.has(observation.snapshot),false);assert.equal(visited.has(row),false);
 assert.equal(keys.includes('previousSnapshot'),false);assert.equal(keys.includes('previousScreen'),false);
 assert.equal(Object.hasOwn(f.state,'previousSnapshot'),false);assert.equal(Object.hasOwn(f.state,'previousScreen'),false);
 const commands=[];plan(view,0,{level:'normal',human:true,seed:27,concern:{kind:'combat',x:210,z:210}},
  {...memory,human:{...f.state,persona:{pressure:1,opening:[]}}},c=>commands.push(c));
 // Each cloned or new state has a fresh private detector baseline, not another seat's exact history.
 const first=structuredClone(f.state);const baseline=perceive(observation,0,first);
 assert.ok(!baseline.newEvents.some(event=>event.kind==='screen-damage'));
 assert.equal(Object.hasOwn(first,'previousScreen'),false);
}
{
 const f=fixture();f.state.camera={x:80,z:80,yaw:0,distance:60};
 const original=observed(f);perceive(original,0,f.state);
 // Mutating a delivered object after sensing cannot rewrite the private previous snapshot.
 for(const row of original.snapshot.units)row[7]=1;
 f.g.tick+=2;f.a.hp=60;
 const candidate=perceive(observed(f),0,f.state);
 assert.deepEqual(candidate.newEvents,[{id:'402:1',kind:'attack',text:`${UNITS.mg.name} under attack`,
   x:210,z:210,n:1,tick:402,onScreen:false,source:'alert'}],
   'the real off-camera 75-to-60 HP delta raises its human alert despite mutation of the earlier delivered rows');
 const fresh=perceive(observed(f),0,{camera:{...f.state.camera},hands:{selected:[]}});
 assert.equal(fresh.newEvents.length,0,'a fresh detector establishes a baseline without fabricating historical damage');
}
{
 for(const [type,def]of Object.entries(UNITS))assert.ok(Number.isFinite((def.models??1)*def.hpPer),`${type} has the real HUD denominator`);
 const a=fixture(),b=fixture();scene(a);b.a.hp=15;scene(b);a.g.tick+=2;b.g.tick+=2;a.a.hp=15;
 assert.ok(scene(a).newEvents.some(event=>event.kind==='screen-damage'));
 assert.ok(!scene(b).newEvents.some(event=>event.kind==='screen-damage'),'state identities never borrow another detector baseline');
}
{
 const f=fixture(),first=observed(f),previousScreen=new Map([...first.units.values()].map(unit=>[unit.id,{
   hp:unit.hp,supp:unit.supp,owner:unit.owner,team:first.players[unit.owner].team,observationTick:400}]));
 const migrating={camera:{...f.state.camera},hands:{selected:[]},previousScreen,
   previousSnapshot:structuredClone(first.snapshot),alertState:{tick:400},eventSerial:7,damageSerial:2,
   damageEpisodes:new Map([[f.a.id,{id:`${f.a.id}:2`,started:380,lastDamage:400}]])};
 f.g.tick+=2;f.a.hp=40;
 const event=perceive(observed(f),0,migrating).newEvents.find(event=>event.kind==='screen-damage');
 assert.equal(event.id,'screen:402:8');assert.equal(event.amount,35);assert.equal(event.provenance,'heavy-damage');
 assert.equal(event.episode,`${f.a.id}:2`);assert.equal(event.episodeTick,380);
 assert.equal(event.responseRequired,true);assert.deepEqual(event.responseUnits,[f.a.id]);
 assert.equal(Object.hasOwn(migrating,'previousScreen'),false);assert.equal(Object.hasOwn(migrating,'previousSnapshot'),false);
}
console.log('Selected HUD privacy, actual selection, planner controls, detached memory and private detector histories passed.');
