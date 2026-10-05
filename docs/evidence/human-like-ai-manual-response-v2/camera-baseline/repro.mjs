import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {createGame,command,step,CELL,CFG,UNITS,SUPPORT,COVER,los} from './shared/sim.js';
import {viewFor} from './shared/ai-view.js';
import {perceive} from './shared/ai-perception.js';
import {createHands,queueCamera,advanceHands} from './shared/ai-hands.js';
import {bindings} from './client/keys.js';
import {createManualCapture as original} from './tools/ai-manual-response-capture-original.mjs';
import {createManualCapture as latest} from './tools/ai-manual-response-capture-latest.mjs';
let seed=37;Math.random=()=>((seed=Math.imul(seed,1664525)+1013904223)>>>0)/4294967296;
function run(capture,{reveal=true,damage=true,paid=false}={}) {
 const g=createGame({w:80,h:80,rows:Array(80).fill('.'.repeat(80)),spawns:[{x:10,y:40},{x:70,y:40}],points:[]},['human','enemy'],false,[0,1],[0,1],{weather:false});
 g.units.clear();g.players.forEach(p=>p.mp=10000);
 assert.equal(command(g,0,{t:'buy',unit:'rifle'}),undefined);assert.equal(command(g,1,{t:'buy',unit:'mg'}),undefined);
 const own=[...g.units.values()].find(u=>u.owner===0),enemy=[...g.units.values()].find(u=>u.owner===1);
 Object.assign(own,{x:80,z:80,path:[],orders:[],targetId:0,attackId:0,amove:null,auto:false,autoRetreat:false,holdFire:true});
 Object.assign(enemy,{x:110,z:80,path:[],orders:[],targetId:0,attackId:0,amove:null,auto:false,autoRetreat:false,holdFire:true});
 step(g);step(g);
 const camera={x:10,z:10,yaw:0,distance:60},hands=createHands({slot:0,seed:37,level:'hard',camera,startedTick:0});
 const memory={human:{camera,hands}},projection={},log={events:[],commands:[],inputs:[],physicalInputsRecorded:true};
 const adapter=capture({slot:0,log,memory,rules:{CELL,CFG,UNITS,SUPPORT,COVER,los,bindings},perceive,observer:{measureRaw:()=>null,onMeasurements:()=>{}}});
 function deliver(raw,tick) {
  memory.human.view=perceive(raw,0,memory.human,tick,adapter.perceptionMeasurements);
  for(const event of memory.human.events)if(!log.events.some(row=>row.id===event.id))log.events.push(structuredClone(event));
  adapter.afterThink(tick);
 }
 const beat2=viewFor(g,0,projection);deliver(beat2,2);
 const ownAt2=memory.human.view.screenIds.has(own.id);
 let revealTick=3, nextBeatTick=4;
 if(paid) {
  hands.openingDone=true;hands.openingUntil=0;hands.tick=2;hands.log=input=>{log.inputs.push(structuredClone(input));adapter.input(log.inputs.at(-1),log.inputs.length-1);};
  assert.ok(queueCamera(hands,{x:85,z:80},{},'minimap'));
  let raw=beat2,view=memory.human.view,lastCamera=JSON.stringify(hands.camera);
  for(let tick=3;tick<100&&!log.inputs.length;tick++) {
   g.tick=tick;if(tick%2===0)raw=viewFor(g,0,projection);
   const cameraKey=JSON.stringify(hands.camera);
   if(raw.tick!==view.tick || cameraKey!==lastCamera) {deliver(raw,tick);view=memory.human.view;lastCamera=cameraKey;}
   advanceHands(hands,tick,view,()=>{throw Error('a camera gesture cannot issue a command');});adapter.afterThink(tick);
  }
  assert.equal(log.inputs.length,1);assert.equal(log.inputs[0].kind,'camera-minimap');
  const completed=log.inputs[0].tick;assert.equal(completed%2,0,'paid camera completion must precede an odd same-frame look');
  revealTick=completed+1;nextBeatTick=completed+2;g.tick=revealTick;
  deliver(raw,revealTick);
 } else {if(reveal)Object.assign(hands.camera,{x:85,z:80});deliver(beat2,3);} 
 const ownAt3=memory.human.view.screenIds.has(own.id);
 if(damage)own.hp=70;
 g.tick=nextBeatTick;deliver(viewFor(g,0,projection),nextBeatTick);
 const nativeDamage=log.events.find(event=>event.kind==='screen-damage'),scoredDamage=adapter.stream.creations.find(row=>row.creation.id===nativeDamage?.id);
 return {ownAt2,ownAt3,revealTick,nextBeatTick,nativeDamage:nativeDamage??null,decision:scoredDamage?.decision??null,reason:scoredDamage?.reason??null,
  baseline:scoredDamage?.publicBaseline?{observationTick:scoredDamage.publicBaseline.observationTick,recordedTick:scoredDamage.publicBaseline.recordedTick,units:scoredDamage.publicBaseline.units.map(u=>({id:u.id,hp:u.hp}))}:null,
  events:log.events,inputs:log.inputs,commands:log.commands,frames:adapter.stream.publicFrames.map(f=>({tick:f.tick,observationTick:f.scene.observationTick,ids:f.scene.units.map(u=>u.id)}))};
}
const paidOld=run(original,{paid:true}),paidFixed=run(latest,{paid:true});
assert.equal(paidOld.reason,'missing-public-damage-baseline');assert.equal(paidFixed.decision,'required');assert.equal(paidFixed.baseline.recordedTick,paidFixed.revealTick);assert.deepEqual(paidOld.events,paidFixed.events);assert.deepEqual(paidOld.inputs,paidFixed.inputs);
const old=run(original),fixed=run(latest),invisible=run(latest,{reveal:false}),unchanged=run(latest,{damage:false});
assert.equal(old.ownAt2,false);assert.equal(old.ownAt3,true);assert.ok(old.nativeDamage);assert.equal(old.reason,'missing-public-damage-baseline');
assert.equal(fixed.decision,'required');assert.equal(fixed.baseline.recordedTick,3);assert.equal(fixed.baseline.observationTick,2);
assert.deepEqual(old.events,fixed.events);assert.deepEqual(old.inputs,fixed.inputs);assert.deepEqual(old.commands,fixed.commands);
assert.equal(invisible.nativeDamage,null);assert.equal(unchanged.nativeDamage,null);
writeFileSync('/tmp/manual-v2-camera-baseline-repro/results.json',JSON.stringify({status:'PASS_REPRODUCED',old,fixed,paidOld,paidFixed,invisible,unchanged},null,2)+'\n');
console.log(JSON.stringify({status:'PASS_REPRODUCED',old:old.reason,fixed:fixed.decision,baseline:fixed.baseline,unchangedNative:true,neighborNegatives:2,paidCamera:paidFixed.inputs[0].tick}));
