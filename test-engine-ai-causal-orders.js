import assert from 'node:assert/strict';
import { createGame, command } from './shared/sim.js';
import { viewFor } from './shared/ai-view.js';
import { runCommander } from './shared/ai-commander.js';
import { perceive } from './shared/ai-perception.js';
import { commandServesObservedEvent, armedContactActor } from './shared/ai-priority.js';
function fixture() {
 const g=createGame({w:80,h:80,rows:Array(80).fill('.'.repeat(80)),spawns:[{x:20,y:40},{x:75,y:40}],points:[]},['AI','enemy'],false,[0,1],[0,1],{weather:false,seed:27});
 g.seed=27;g.matchSeed=27;g.wind={a:.1,v:.5};g.units.clear();g.players[0].mp=5000;g.players[0].mun=1000;
 for(let i=0;i<2;i++)assert.equal(command(g,0,{t:'buy',unit:'rifle'}),undefined);
 const own=[...g.units.values()];own.forEach((u,i)=>Object.assign(u,{x:75+i*6,z:80,holdFire:true,auto:false,autoRetreat:false}));
 return {g,own,memory:{human:{startedTick:0,camera:{x:80,z:80,yaw:0,distance:60},concern:{id:'local',kind:'expansion',x:80,z:80,since:0,until:100000}}},inputs:[],accepted:[],results:[]};
}
function advance(f,limit,plan,hook=()=>{},frozen=false) {
 let view;
 for(let tick=0;tick<limit;tick++) {
  f.g.tick=tick;hook(tick);
  if(!view||!frozen&&tick%2===0)view=viewFor(f.g,0,f.memory);
  runCommander(view,0,{tick,level:'normal',seed:27,inputLog:x=>f.inputs.push(structuredClone(x))},f.memory,cmd=>{
   const refusing=f.rejectFirst&&!f.results.length;
   if(refusing)f.g.players[0].away=true;
   const result=command(f.g,0,cmd);
   if(refusing)f.g.players[0].away=false;
   f.results.push({tick,cmd:structuredClone(cmd),result});
   if(result===undefined)f.accepted.push({tick,cmd:structuredClone(cmd)});return result;
  },plan);
 }
}
{
 const f=fixture(),[busy,free]=f.own;
 f.memory.human.orderHistory=new Map([[busy.id,{x:110,z:80,tick:0}]]);
 assert.equal(command(f.g,0,{t:'move',orders:[[busy.id,110,80]]}),undefined);
 advance(f,210,(_v,_s,_o,_m,send)=>send({t:'move',orders:[[busy.id,60,80],[free.id,94,80]]}));
 assert.ok(f.accepted.some(e=>e.cmd.orders?.some(row=>row[0]===free.id)),'the free companion receives a real native movement order');
 assert.ok(f.accepted.every(e=>!e.cmd.orders?.some(row=>row[0]===busy.id)),'accepted committed actor continues its original authoritative route');
 assert.ok(f.inputs.some(x=>x.kind.startsWith('select-'))&&f.inputs.some(x=>x.command),'batch arbitration executes selection and physical command inputs');
}
{
 const f=fixture(),[danger,free]=f.own;f.memory.human.orderHistory=new Map([[danger.id,{x:110,z:80,tick:0}]]);
 advance(f,220,(_v,_s,opts,_m,send)=>{
  opts.requestDangerMove(danger.id,{x:68,z:80});
  send({t:'move',orders:[[danger.id,68,80]]});send({t:'move',orders:[[free.id,94,80]]});
 });
 assert.ok(f.accepted.some(e=>e.cmd.orders?.some(row=>row[0]===danger.id)),'an exact source-authorized danger destination overrides movement commitment');
 assert.ok(f.accepted.every(e=>!(e.cmd.orders?.some(row=>row[0]===danger.id)&&e.cmd.orders.some(row=>row[0]===free.id))),'danger and ordinary movement execute in separate native batches');
}
{
 const f=fixture(), actor=f.own[0];f.proposals=[];
 advance(f,340,(_v,_s,_o,_m,send)=>f.proposals.push(send({t:'stance',ids:[actor.id],key:'holdFire',on:false})),()=>{},true);
 assert.equal(f.accepted.filter(e=>e.cmd.t==='stance').length,1,'identical accepted stance has one native command while the delivered observation remains stale');
 assert.ok(f.proposals.includes('accepted'),'suppression is accepted-command specific');
 assert.ok(f.inputs.some(x=>x.command?.t==='stance'),'dedup test has nonempty actual physical command timeline');
 // A genuinely newer delivery clears the causal acceptance barrier.
 const before=f.accepted.length;actor.holdFire=true;f.g.tick=400;const view=viewFor(f.g,0,f.memory);
 for(let tick=400;tick<660;tick++)runCommander(view,0,{tick,level:'normal',seed:27,inputLog:x=>f.inputs.push(structuredClone(x))},f.memory,cmd=>{
  const result=command(f.g,0,cmd);if(result===undefined)f.accepted.push({tick,cmd:structuredClone(cmd)});return result;
 },(_v,_s,_o,_m,send)=>send({t:'stance',ids:[actor.id],key:'holdFire',on:false}));
 assert.ok(f.accepted.length>before,'new delivered observation allows the identical stance again');
}
{
 const f=fixture();f.proposals=[];
 advance(f,340,(_v,_s,_o,_m,send)=>f.proposals.push(send({t:'move',orders:[[f.own[0].id,81,80]]})),()=>{},true);
 assert.equal(f.accepted.filter(e=>e.cmd.t==='move').length,1,'noisy accepted physical formation maps to its identical original intent without repeated stale-view clicks');
 assert.ok(f.proposals.includes('accepted'),'the short unfinished move specifically exercises accepted-cache suppression rather than long-march commitment');
 const actual=f.accepted[0].cmd.orders[0];assert.ok(actual[1]!==81||actual[2]!==80,'the real hands executor adds nonzero source input error before the accepted command');
}
{
 const f=fixture();
 advance(f,340,(_v,_s,_o,_m,send)=>{
  const actors=f.accepted.length?[...f.own].reverse():f.own;
  send({t:'move',orders:actors.map(actor=>[actor.id,78,80])});
 },()=>{},true);
 assert.equal(f.accepted.filter(e=>e.cmd.t==='move').length,2,'a reordered actor formation is a changed intent even before a newer delivery');
 const [first,second]=f.accepted.map(e=>e.cmd.orders.find(row=>row[0]===f.own[0].id));
 assert.ok(Math.hypot(first[1]-second[1],first[2]-second[2])>0,'the distinct reordered intent reaches a second real physical formation');
}
{
 const f=fixture(),actor=f.own[0];
 advance(f,340,(_v,_s,_o,_m,send)=>{
  send({t:'stance',ids:[actor.id],key:'holdFire',on:false});
  if(f.accepted.some(e=>e.cmd.key==='holdFire'))send({t:'stance',ids:[actor.id],key:'holdPos',on:true});
 },()=>{},true);
 assert.deepEqual(f.accepted.map(e=>e.cmd.key),['holdFire','holdPos'],'different stance keys remain legitimate distinct physical commands despite a stale delivered view');
}
{
 const f=fixture();f.rejectFirst=true;
 advance(f,850,(_v,_s,_o,_m,send)=>send({t:'stance',ids:[f.own[0].id],key:'holdFire',on:false}),()=>{},true);
 assert.equal(f.results[0]?.result,'blocked','the authoritative command rejects a temporarily disconnected seat');
 assert.equal(f.accepted.length,1,'rejected input is not cached as accepted and can retry after the existing source backoff');
 assert.ok(f.results.length>=2,'negative control covers a later actual physical retry');
}
{
 const f=fixture(),[victim,neighbor]=f.own,state=f.memory.human;
 let v=perceive(viewFor(f.g,0,f.memory),0,state,0);victim.hp-=15;f.g.tick=2;v=perceive(viewFor(f.g,0,f.memory),0,state,2);
 const event=v.events.find(e=>e.kind==='screen-damage'&&e.unitId===victim.id);assert.ok(event,'actual delivered damage creates the causal cue');
 const cases=[
 [{t:'move',orders:[[neighbor.id,74,80]]},false],
 [{t:'move',orders:[[victim.id,74,80]]},true],
 [{t:'retreat',ids:[neighbor.id]},false],
 [{t:'retreat',ids:[victim.id]},true],
 [{t:'support',kind:'recon',x:75,z:80},false],
 [{t:'support',kind:'artillery',x:75,z:80},false],
 [{t:'support',kind:'smoke',x:75,z:80},true],
 [{t:'support',kind:'smoke',x:110,z:80},false]
 ];
 for(const [cmd,wanted]of cases)for(const responseRequired of [true,false])assert.equal(commandServesObservedEvent(cmd,{...event,responseRequired,responseReason:'altered',responsePolicy:'altered',responseUnits:[neighbor.id]},v,0),wanted);
 for(const type of ['medic','engineer'])assert.equal(armedContactActor({...victim,type}),false);
 for(const type of ['rifle','tank','at'])assert.equal(armedContactActor({...victim,type}),true);
 const before=structuredClone(v.units);for(const [cmd]of cases)commandServesObservedEvent(cmd,event,v,0);assert.deepEqual(v.units,before,'causal classification cannot mutate detached delivered units');
 assert.ok(!Object.hasOwn(state,'acceptedCommands'),'accepted duplicate cache exposes no authoritative references in planner memory');
}
function damageScene(actorIndex, labels={}) {
 const f=fixture();let proposed=false;
 advance(f,220,(_v,_s,_o,_m,send)=>{
  if(f.g.tick<100||proposed)return;
  const result=send({t:'move',orders:[[f.own[actorIndex].id,74,80]]});if(result===undefined)proposed=true;
 },tick=>{
  if(tick===100)f.own[0].hp-=15;
  for(const event of f.memory.human.events??[])Object.assign(event,labels);
 });
 const event=f.memory.human.events.find(e=>e.kind==='screen-damage'&&e.unitId===f.own[0].id);
 assert.ok(event&&f.accepted.length&&f.inputs.some(x=>x.command),'bookkeeping fixture includes real damage and accepted native movement');
 return {f,event};
}
{
 const wrong=damageScene(1),right=damageScene(0);
 assert.ok(!wrong.f.memory.human.answeredEvents?.has(wrong.event.id),'neighbor ordinary physical movement cannot acknowledge the injured victim');
 assert.ok(right.f.memory.human.answeredEvents.has(right.event.id),'victim physical movement acknowledges its own delivered damage');
 const labelled=damageScene(0,{responseRequired:false,responseReason:'counterfactual',responsePolicy:'test',responseUnits:[999]});
 const withoutLabels=value=>{
  const copies=new WeakMap();
  function clone(value){if(typeof value==='function')return '[callback]';if(!value||typeof value!=='object')return value;if(copies.has(value))return copies.get(value);
   const out=value instanceof Map?new Map():value instanceof Set?new Set():Array.isArray(value)?[]:Object.create(Object.getPrototypeOf(value));copies.set(value,out);
   if(value instanceof Map)for(const [k,v]of value)out.set(clone(k),clone(v));else if(value instanceof Set)for(const v of value)out.add(clone(v));else for(const key of Object.keys(value))out[key]=clone(value[key]);return out;
  }
  const result=clone(value),seen=new WeakSet();
  function visit(object){if(!object||typeof object!=='object'||seen.has(object))return;seen.add(object);
   for(const key of ['responseRequired','responseReason','responsePolicy','responseUnits'])delete object[key];
   if(object instanceof Map)for(const [key,value]of object){visit(key);visit(value);}
   else if(object instanceof Set)for(const value of object)visit(value);
   else for(const value of Object.values(object))visit(value);
  }visit(result);return result;
 };
 assert.deepEqual(withoutLabels(labelled.f.inputs),withoutLabels(right.f.inputs),'altered grader fields cannot change actual native timeline');
 assert.deepEqual(withoutLabels(labelled.f.memory),withoutLabels(right.f.memory),'all enumerable planner memory is equal apart from injected diagnostic fields');
 assert.deepEqual(structuredClone(labelled.f.g),structuredClone(right.f.g),'full actual authoritative game graph is unchanged by altered grading labels');
}
console.log('Causal native orders: per-row commitment, danger separation, accepted stale delivery deduplication and victim-scoped damage controls passed.');
