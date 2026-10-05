import assert from 'node:assert/strict';
import {createGame,command,step,UNITS} from './shared/sim.js';
import {viewFor} from './shared/ai-view.js';
import {perceive} from './shared/ai-perception.js';
import {runCommander} from './shared/ai-commander.js';
import {createHands} from './shared/ai-hands.js';
import {personaFor} from './shared/ai-persona.js';
import {plan} from './shared/ai.js';
import {prioritizeVisit,inspectionServesObservedEvent,commandServesObservedEvent} from './shared/ai-priority.js';

function fixture(retreat=false){
const game=createGame({w:80,h:80,rows:Array(80).fill('.'.repeat(80)),spawns:[{x:5,y:5},{x:75,y:75}],points:[]},['AI','enemy'],false,[0,1],[0,1],{weather:false});game.units.clear();for(const [owner,type]of[[0,'mg'],[0,'mg'],[1,'rifle'],[1,'rifle']]){game.players[owner].mp=5000;assert.equal(command(game,owner,{t:'buy',unit:type}),undefined);}
const [other,actor,targetOther,targetActor]=game.units.values();for(const[u,x]of[[other,65],[actor,105],[targetOther,75],[targetActor,120]])Object.assign(u,{x,z:80,auto:false,autoRetreat:true,holdFire:u.owner===1});step(game);assert.equal(command(game,0,{t:'attack',ids:[other.id],target:targetOther.id}),undefined);assert.equal(command(game,0,{t:'attack',ids:[actor.id],target:targetActor.id}),undefined);for(let i=0;i<5;i++)step(game);assert.equal(other.targetId,targetOther.id);assert.equal(actor.targetId,targetActor.id);game.players[0].mp=0;for(const kind in game.players[0].sup)game.players[0].sup[kind]=1000;game.tick=200;
const camera={x:85,z:80,distance:60,yaw:0},state={camera,startedTick:0,hands:createHands({slot:0,seed:27,level:'hard',camera,startedTick:0})},memory={human:state};personaFor(state,state.hands.rng);let view=perceive(viewFor(game,0,memory),0,state);for(let tick of[200,220]){game.tick=tick;view=perceive(viewFor(game,0,memory),0,state);plan(view,0,{human:true,level:'hard',concern:{kind:'combat',x:105,z:80},requestInspection:()=>{}},memory,()=>{});}
actor.hp=UNITS.mg.models*UNITS.mg.hpPer*(retreat?.2:.7);game.tick=222;view=perceive(viewFor(game,0,memory),0,state);const hit=view.newEvents.find(e=>e.kind==='screen-damage'&&e.unitId===actor.id);assert.ok(hit);state.concern={id:'stimulus:'+hit.id,kind:'combat',x:hit.x,z:hit.z,eventId:hit.id,eventTick:hit.tick,event:'screen-damage',eventOnScreen:true,since:222,until:450};state.deliberateUntil=222;

return {game,other,actor,targetOther,targetActor,state,memory,view,hit};
}
function runScene(f){
const {game,state,memory}=f;const inputs=[],commands=[],calls=[];let observation;
for(let tick=222;tick<430&&!commands.some(e=>['ability','retreat'].includes(e.cmd.t));tick++){game.tick=tick;if(!observation||tick%2===0)observation=viewFor(game,0,memory);runCommander(observation,0,{tick,seed:27,level:'hard',inputLog:e=>inputs.push(structuredClone(e))},memory,cmd=>{const result=command(game,0,cmd);commands.push({tick,cmd:structuredClone(cmd),result});return result;},(v,s,o,m,send)=>{const pending=[];plan(v,s,{...o,requestInspection:cmd=>{pending.push(structuredClone(cmd));o.requestInspection(cmd);}},m,send);calls.push({tick,pending,known:[...v.units.values()].filter(u=>u.owner===0).map(u=>[u.id,u.cdKnown])});});}

return {...f,inputs,commands,calls};
}

const f=runScene(fixture()),first=f.calls[0],inspection=f.inputs.find(input=>input.inspection),cast=f.commands.find(row=>row.cmd.t==='ability');
assert.deepEqual(first.pending.map(cmd=>cmd.ids[0]),[f.other.id,f.actor.id],'the ordinary planner requests both unknown readiness inspections in roster order');
assert.deepEqual(first.known,[[f.other.id,false],[f.actor.id,false]],'neither squad has a fabricated HUD readiness reading');
assert.deepEqual(inspection.ids,[f.actor.id],'the physical HUD selection belongs to the actually hurt squad');
assert.ok(inspection.inspectionAcquired&&inspection.tick>=f.hit.tick+4,'inspection pays actual motor and the event floor');
assert.equal(inspection.tick-inspection.inputStartedTick,inspection.motorTicks,'the complete selection motor remains intact');
assert.ok(cast&&cast.result===undefined);assert.deepEqual(cast.cmd.ids,[f.actor.id]);assert.ok(f.actor.buff>0,'the accepted native MG ability is actually active');
assert.ok(cast.tick>=inspection.tick+4,'the actual HUD is read before the native ability decision');
assert.equal(f.inputs.filter(input=>input.inspection).length,1,'no unrelated inspection is added before this response');
assert.ok(inspection.responseEvents.some(event=>event.id===f.hit.id&&event.tick===f.hit.tick),'the real HUD read retains its already observed damage cue');
assert.ok(!f.state.answeredEvents?.has(f.hit.id),'an accepted buff before observed weapon setup does not acknowledge useful firing');
const poisonedFixture=fixture();for(const event of [...poisonedFixture.state.events,...poisonedFixture.view.events])Object.assign(event,{responseRequired:false,responseUnits:[poisonedFixture.other.id],responsePolicy:'private',responseReason:'private'});
const poisonedRun=runScene(poisonedFixture),physical=run=>run.inputs.map(input=>({tick:input.tick,kind:input.kind,ids:input.ids,command:input.command}));
assert.deepEqual(physical(poisonedRun),physical(f),'private population labels cannot change the actual planner, physical selection or native ability sequence');
const base=fixture(),candidates=[];
plan(base.view,0,{human:true,level:'hard',concern:base.state.concern,requestInspection:cmd=>candidates.push(structuredClone(cmd))},base.memory,cmd=>assert.notEqual(cmd.t,'ability','both abilities still require real HUD selection'));
assert.equal(candidates.length,2);
assert.equal(inspectionServesObservedEvent(candidates[1],base.hit,base.view,0),true,'unknown native readiness can justify looking at the hurt actor HUD');
assert.equal(commandServesObservedEvent(candidates[1],base.hit,base.view,0),false,'the same unknown ability cannot prove an accepted useful response');
const copyView=()=>({...base.view,units:new Map(structuredClone([...base.view.units])),screenIds:new Set(base.view.screenIds),events:structuredClone(base.view.events)});
const choose=(view=copyView(),concern=base.state.concern,answered=new Set(),requests=candidates,intents=[])=>prioritizeVisit(structuredClone(intents),structuredClone(requests),view,concern,answered,0,view.tick);
const positive=choose();assert.equal(positive.inspections[0].ids[0],base.actor.id);
const missingActor=copyView();missingActor.screenIds.delete(base.actor.id);assert.equal(choose(missingActor).inspections[0].ids[0],base.other.id,'off-camera actors acquire no factual inspection priority');
const missingTarget=copyView();missingTarget.screenIds.delete(base.targetActor.id);assert.equal(choose(missingTarget).inspections[0].ids[0],base.other.id,'a currently absent hostile cannot make the ability relevant');
const unarmed=copyView();unarmed.units.get(base.actor.id).type='medic';assert.equal(choose(unarmed).inspections[0].ids[0],base.other.id,'an unarmed actor cannot earn the proposed offensive ability priority');
const answered=new Set(base.view.events.map(event=>event.id));assert.equal(choose(copyView(),base.state.concern,answered).inspections[0].ids[0],base.other.id,'answered episodes do not keep an inspection obligation');
const expired=copyView();expired.events.forEach(event=>event.tick-=241);assert.equal(choose(expired).inspections[0].ids[0],base.other.id,'expired episodes do not earn priority');
for(const responseRequired of[true,false,undefined])for(const responseUnits of[[],[base.other.id],[base.actor.id],[999]]){
 const view=copyView();for(const event of view.events)Object.assign(event,{responseRequired,responseUnits,responsePolicy:'private',responseReason:'private',counterfactualPopulation:999});
 view.privateScoring={responseUnits:[base.other.id]};assert.deepEqual(choose(view),positive,'private diagnostic permutations cannot change planner or selection ordering');
}
const noEvents=copyView();noEvents.events=[];
assert.deepEqual(choose(noEvents,null).inspections,candidates,'equal relevance retains the actual original request order');
assert.deepEqual(choose(noEvents,null,new Set(),[...candidates].reverse()).inspections,[...candidates].reverse(),'stable ties also preserve the reversed caller order');
assert.deepEqual(choose(copyView(),null,new Set(),[]).inspections,[],'no candidate produces no invented inspection');
base.other.hp=UNITS.mg.models*UNITS.mg.hpPer*.7;base.game.tick=224;const newer=perceive(viewFor(base.game,0,base.memory),0,base.state);const newHit=newer.newEvents.find(event=>event.kind==='screen-damage'&&event.unitId===base.other.id);assert.ok(newHit&&newHit.tick>base.hit.tick);
assert.equal(choose(newer,null).inspections[0].ids[0],base.other.id,'a newer actual observed hit earns priority without an attended episode');
assert.equal(choose(newer,base.state.concern).inspections[0].ids[0],base.actor.id,'the actually attended hit precedes a newer secondary episode');
const knownReady={t:'ability',ids:[base.other.id]};assert.deepEqual(choose(newer,base.state.concern,new Set(),candidates,[knownReady]).inspections,[candidates[0]],'the existing useful ready-actor inspection filter remains intact');
assert.deepEqual(choose(newer,base.state.concern,new Set(),candidates,[knownReady,{t:'ability',ids:[base.actor.id]}]).inspections,candidates,'existing useful ready actions retain their prior inspection order as well as the actor filter');
const retreat={t:'retreat',ids:[base.actor.id]};assert.equal(choose(newer,base.state.concern,new Set(),candidates,[knownReady,retreat]).intents[0].t,'retreat','urgent retreat intent stays first');
const urgent=runScene(fixture(true));assert.ok(!urgent.inputs.some(input=>input.inspection),'urgent retreat does not wait for any optional HUD inspection');assert.equal(urgent.commands[0].cmd.t,'retreat');assert.equal(urgent.commands[0].result,undefined);assert.ok(urgent.actor.retreating,'the native retreat actually begins');
console.log('Observed inspection relevance, physical HUD acquisition, native ability, stable ties and retreat guards pass.');
