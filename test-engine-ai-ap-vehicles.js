import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import * as sim from './shared/sim.js';
import * as ai from './shared/ai.js';
import * as perception from './shared/ai-perception.js';
import * as hands from './shared/ai-hands.js';
import * as view from './shared/ai-view.js';
import {bindings} from './client/keys.js';
import {createAIcase} from './tools/ai-lab-runner.mjs';
import {createManualCapture} from './tools/ai-manual-response-capture-v3.mjs';
import {kaplanMeier} from './tools/ai-humanity.mjs';

const proof=[];
function runCase(level, {enemy='medium',cooldown=0,unseen=false,held=false,naval=false,boatTarget=false,support=false}={}) {
 const log={events:[],inputs:[],commands:[],physicalInputsRecorded:true},effects=[];let capture;
 const engineSim=naval?{...sim,createGame:(map,...args)=>sim.createGame({...map,naval:true},...args)}:sim;
 const nativeAI={...ai,think(game,slot,opts){
  capture??=createManualCapture({slot,log,memory:opts.memory,rules:{...sim,bindings},perceive:perception.perceive,observer:{measureRaw:()=>null,onMeasurements:()=>{}}});
  for(const p of game.flights.values())if(p.ap&&!effects.some(e=>e.flightId===p.id))effects.push({tick:game.tick,flightId:p.id,ap:p.ap,apNaval:p.apNaval,intended:p.intended,apMultiplier:p.apMultiplier});
  effects.push({tick:game.tick,target:9,hp:game.units.get(9)?.hp??0,actorAP:!!game.units.get(7)?.ap});
  for(const shot of game.shots)if(shot.k==='contact'&&shot.f===7&&shot.hit)effects.push({tick:game.tick,nativeContact:structuredClone(shot)});
  ai.think(game,slot,{...opts,perceptionMeasurements:capture.perceptionMeasurements,
   inputLog:input=>{opts.inputLog(input);log.inputs.push(structuredClone(input));capture.input(log.inputs.at(-1),log.inputs.length-1);},
   submit:cmd=>{const result=opts.submit(cmd);log.commands.push({tick:game.tick,command:structuredClone(cmd),accepted:result===undefined,rejection:result??null});return result;}});
  for(const event of opts.memory.human.events??[])if(!log.events.some(row=>row.id===event.id))log.events.push(structuredClone(event));capture.afterThink(game.tick);
 }};
 const rows=naval?Array.from({length:96},(_,y)=>Array.from({length:96},(_,x)=>y>=30&&y<=50&&(x>=30&&x<=40||boatTarget&&x>=50&&x<=60)?'W':'.').join('')):undefined;
 const scene={...(rows?{rows}:{}),units:[{owner:0,type:naval?'gunboat':'at',x:80,z:80,cooldown,holdFire:held},{owner:0,type:'rifle',x:82,z:82,holdFire:true},
  {owner:1,type:boatTarget?'gunboat':enemy,x:unseen?168:110,z:80,holdFire:true}],camera:{x:90,z:80},resources:[{mp:support?800:0,fuel:0,mun:200}]};
 const lab=createAIcase({sim:engineSim,ai:nativeAI,perception,hands,view},{level,seed:42,scenario:'contact-threat',seconds:12},scene);
 lab.advance(1);lab.advance(119);const report=lab.advance(120);
 const score=capture.policy.scoreManualResponses(log,12,kaplanMeier);proof.push({level,scene,report,log,effects,score});return{report,log,effects,score};
}

for(const level of ['normal','hard']){
 for(const enemy of ['medium','tiger','tank']){
  // Use a real remaining AP cooldown beyond setup so enqueue has a fresh ready weapon proof.
  const f=runCase(level,{enemy,cooldown:sim.UNITS.at.w.setup+2*sim.TICK}),accepted=f.log.commands.filter(c=>c.accepted&&c.command.t==='ability'&&c.command.ids.includes(7));
  assert.equal(accepted.length,1,`${level} ${enemy}: native AP loaded once`);
  const ability=f.log.inputs.find(i=>i.kind==='ability-key'),selection=f.log.inputs.find(i=>i.kind==='select-click');
  assert.ok(selection.tick<ability.tick&&ability.tick===accepted[0].tick,'the actual actor is selected before its paid ability key');
  const receipt=f.log.manualMeasurements.receipts.find(r=>r.tick===ability.tick),actor=receipt.publicScene.units.find(u=>u.id===7);
  assert.ok(actor.cdKnown&&actor.cd<=0&&actor.hpSource==='selected-hud','AP follows actual fresh HUD readiness');
  if(enemy!=='tank')assert.ok(f.effects.some(e=>e.ap&&e.intended===9&&e.apMultiplier===1.5),'native fire creates an AP projectile for the observed armor');
  assert.ok(f.effects.some(e=>e.target===9&&e.tick>ability.tick&&e.hp<sim.UNITS[enemy].hpPer),'the actual armor takes native damage');
  assert.equal(f.score.acceptedCommand.answered,1,'actual v3 detector credits useful AP');
  assert.ok(f.score.rows.some(row=>row.answer?.acceptedCommandTick===accepted[0].tick),'the detector credit belongs to the actual paid AP receipt');assert.ok(f.score.acceptedCommand.survival.medianSeconds>0,'credit is paid and positive-time');
 }
 const supported=runCase(level,{support:true});assert.ok(supported.log.commands.some(c=>c.accepted&&c.command.t==='support'&&['dive','bombing'].includes(c.command.kind)),'native damaging support remains available alongside AP');assert.ok(supported.log.commands.some(c=>c.accepted&&c.command.t==='ability'),'the ready AP actor still gets its paid command');
 for(const options of [{enemy:'rifle'},{cooldown:30},{unseen:true},{held:true}]){
  const f=runCase(level,options);assert.equal(f.log.commands.filter(c=>c.accepted&&c.command.t==='ability').length,0,'infantry, cooling, unseen and held-fire scenes do not load AP');
  if(options.cooldown){assert.ok(f.log.inputs.some(i=>i.inspection&&i.kind==='select-click'),'unknown readiness is physically inspected');assert.ok(f.log.manualMeasurements.publicFrames.some(frame=>frame.scene.units.some(u=>u.id===7&&u.cdKnown&&u.cd>0)),'the native HUD exposes the unavailable ability');}
 }
 for(const enemy of ['tank','medium']){
  const f=runCase(level,{enemy,naval:true});assert.equal(f.log.commands.filter(c=>c.accepted&&c.command.t==='ability').length,0,'a naval torpedo is not loaded for a land vehicle');
 }
 const boat=runCase(level,{naval:true,boatTarget:true});assert.equal(boat.log.commands.filter(c=>c.accepted&&c.command.t==='ability').length,1,'a native gunboat loads its torpedo for an observed boat');assert.ok(boat.effects.some(e=>e.ap&&e.apNaval&&e.intended===9&&e.apMultiplier===25),'the native naval restriction survives into an actual torpedo projectile');assert.ok(boat.effects.some(e=>e.actorAP),'native torpedo loads after the paid ability');assert.ok(boat.effects.some(e=>e.nativeContact?.t===9&&e.tick>boat.log.commands.find(c=>c.command.t==='ability').tick),'the native boat fires at and damages the observed enemy boat');
}
if(process.env.AI_AP_VEHICLES_PROOF)writeFileSync(process.env.AI_AP_VEHICLES_PROOF,JSON.stringify(proof));
console.log('Native AP vehicle choices, paid HUD readiness, naval targets and v3 capture controls PASS.');
