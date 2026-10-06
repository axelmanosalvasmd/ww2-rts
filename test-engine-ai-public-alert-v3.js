import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import { createGame, command, step } from './shared/sim.js';
import { viewFor } from './shared/ai-view.js';
import { perceive } from './shared/ai-perception.js';
import { createHands, enqueueDecision, queueCamera, advanceHands, interruptHands } from './shared/ai-hands.js';
import { think } from './shared/ai.js';
import { perceive as frozenOracle } from './tools/ai-screen-v1-oracle.js';
import { createPublicAlertCapture, scorePublicAlerts } from './tools/ai-public-alert-response.mjs';
import { createPublicAlertCaptureV2, scorePublicAlertsV2, poolPublicAlertsV2 } from './tools/ai-public-alert-response-v2.mjs';
import {createPublicAlertCaptureV3,scorePublicAlertsV3,poolPublicAlertsV3} from './tools/ai-public-alert-response-v3.mjs';
const map={w:160,h:160,rows:Array(160).fill('.'.repeat(160)),heights:Array(160).fill('0'.repeat(160)),spawns:[{x:20,y:20},{x:75,y:75}],points:[]};
const declaration={policy:'public-danger-alert-v3',priorFixtureSourceCheckpoint:'99484b839900c6e9957b222c01cc5a0397517af71a466b34d8951d3300c77c59',sourceCheckpointCapturedSeparately:true,seed:27,horizonTicks:180,
  map:'authored-160x160-flat',cueTick:40,camera:{x:80,z:80},victim:{x:190,z:200},defender:{x:170,z:200}};
const publicState=state=>JSON.parse(JSON.stringify(state,(_key,value)=>typeof value==='function'?undefined:value instanceof Map?[...value]:value instanceof Set?[...value]:value));
function game(){
  const g=createGame(map,['AI','enemy'],false,[0,1],[0,1],{weather:false});g.units.clear();g.players[0].mp=5000;
  for(let i=0;i<2;i++)assert.equal(command(g,0,{t:'buy',unit:'rifle'}),undefined);
  const own=[...g.units.values()];own.forEach((u,i)=>Object.assign(u,{x:i?170:190,z:200,holdFire:true,auto:false,autoRetreat:false}));
  return {g,own};
}
function hurt(f,index=0){const u=f.own[index];u.hp*=.6;f.g.shots=[{t:u.id,to:0,fo:1,x:u.x,z:u.z,k:'hurt',kill:false}];}
function retain(log,state){for(const e of state.events ?? [])if(!log.events.some(old=>old.id===e.id&&old.tick===e.tick))log.events.push(structuredClone(e));}
function fixture(control='defense',recording=true){
  const oldRandom=Math.random;let rng=777;Math.random=()=>((rng=(Math.imul(rng,1664525)+1013904223)>>>0)/4294967296);
  try{
    let witnessCallbacks=0;
    const f=game(),log={events:[],inputs:[],commands:[]},memory={human:{camera:{x:80,z:80,yaw:0,distance:60}}},state=memory.human;
    if(control==='pan-axis')f.own[0].x=80;
    const capture=recording==='v1'?createPublicAlertCapture({slot:0,log,memory}):typeof recording==='string'&&recording.startsWith('v3')?createPublicAlertCaptureV3({slot:0,log,memory,recordCancelWitness:control!=='cancel-target-missing-witness',onWitness:recording==='v3-mutated'?w=>{witnessCallbacks++;w.inputIndex=-1;w.cancelTargetingBefore=false;w.privateGraph={units:new Map([[999,{hp:-1}]])};}:null}):recording?createPublicAlertCaptureV2({slot:0,log,memory}):null;
    state.hands=createHands({slot:0,seed:27,level:'normal',camera:state.camera,
      log:input=>{log.inputs.push(structuredClone(input));capture?.input(log.inputs.at(-1),log.inputs.length-1);}});
    state.hands.groups.set(1,[f.own[1].id]);
    if(control.startsWith('cancel-target'))state.hands.cancelTargeting=true;
    if(control==='already-selected')state.hands.selected=[f.own[1].id];
    let extra;
    if(['partial','sequential-partial'].includes(control)){assert.equal(command(f.g,0,{t:'buy',unit:'rifle'}),undefined);extra=[...f.g.units.values()].at(-1);Object.assign(extra,{x:160,z:200,holdFire:true,auto:false,autoRetreat:false});state.hands.groups.set(1,[f.own[1].id,extra.id]);
      if(control==='sequential-partial'){Object.assign(f.own[0],{x:135,z:80});Object.assign(f.own[1],{x:100,z:80});Object.assign(extra,{x:120,z:80});assert.equal(command(f.g,0,{t:'buy',unit:'rifle'}),undefined);const intervening=[...f.g.units.values()].at(-1);Object.assign(intervening,{x:110,z:80,holdFire:true,auto:false,autoRetreat:false});state.hands.groups.clear();}}
    const submit=cmd=>{if(control==='rejected')f.own[1].owner=1;const result=command(f.g,0,cmd);log.commands.push({tick:f.g.tick,command:structuredClone(cmd),accepted:result===undefined,rejection:result ?? null});return result;};
    let view,original,queued=false,interrupted=false,retargeted=false,abilityQueued=false;
    const measurements=capture?.wrapMeasurements();
    for(let tick=0;tick<=180;tick++){
      f.g.tick=tick;
      if(tick===40 && control!=='eventless')hurt(f);
      if(tick===100 && control==='partial')f.g.units.delete(extra.id);
      if(control==='retargeted' && state.hands.active && !retargeted){f.own[1].x=280;f.own[1].z=45;hurt(f,1);retargeted=true;}
      if(tick%2===0 || retargeted&&f.g.shots.length){view=perceive(viewFor(f.g,0,{}),0,state,tick,measurements);state.view=view;retain(log,state);f.g.shots=[];}
      advanceHands(state.hands,tick,view,capture?.wrapSubmit?capture.wrapSubmit(submit):submit);
      if(control==='unsupported-ability' && original && !state.hands.active && !state.hands.queue.length && !abilityQueued && tick>40){
        const context={event:original,eventTick:original.tick,responseEvents:[original],concern:`alert:${original.id}`};
        assert.equal(enqueueDecision(state.hands,{t:'ability',ids:[f.own[1].id],x:original.x,z:original.z},view,context),true);abilityQueued=true;
      }
      if(tick===40 && control!=='eventless'){
        original=log.events.find(e=>e.source==='alert');assert.equal(original?.onScreen,false);
        const cause=control==='wrong-cause'?{...original,id:'unrelated'}:original;
        const context={event:cause,eventTick:original.tick,responseEvents:[cause],concern:`alert:${cause.id}`};
        if(['group-camera','retargeted','space','unsupported-ability','minimap-camera','pan-axis','pan-diagonal','cancel-target','cancel-target-missing-witness','cancel-target-false-state'].includes(control)){
          const mode=control==='group-camera'?'group':control==='minimap-camera'?'minimap':control.startsWith('pan-')?'pan':'alert';assert.equal(queueCamera(state.hands,control==='group-camera'?f.own[1]:original,control==='unsupported-ability'?{}:context,mode),true);
        } else if(control==='no-purpose') {
          assert.equal(enqueueDecision(state.hands,{t:'retreat',ids:[f.own[1].id]},view,context),true);
        } else {
          const at=control==='unrelated-target'?{x:280,z:280}:original;
          const cmd={t:'move',orders:[[f.own[1].id,at.x,at.z],...(['partial','sequential-partial'].includes(control)?[[extra.id,at.x,at.z]]:[])]};
          assert.equal(enqueueDecision(state.hands,cmd,view,context),true);
          if(control==='precreation')state.hands.queue.at(-1).queuedTick=39;
        }
        queued=true;
      }
      if(control==='cancel-target-false-state' && state.hands.active)state.hands.cancelTargeting=false;
      capture?.afterThink(tick);
      if(control==='interrupted'&&state.hands.active&&!state.hands.active.reacting&&!interrupted){interruptHands(state.hands,tick,view);interrupted=true;}
    }
    capture?.finish(180);
    return {log,original,state:publicState(state),game:publicState(f.g),rng,queued,witnessCallbacks,score:capture?(recording==='v1'?scorePublicAlerts(log):typeof recording==='string'&&recording.startsWith('v3')?scorePublicAlertsV3(log):scorePublicAlertsV2(log)):null};
  }finally{Math.random=oldRandom;}
}
function defaultCommander(recording){
  const oldRandom=Math.random;let rng=777;Math.random=()=>((rng=(Math.imul(rng,1664525)+1013904223)>>>0)/4294967296);
  try{
    const f=game(),memory={human:{startedTick:0,camera:{x:80,z:80,yaw:0,distance:60}}},log={events:[],inputs:[],commands:[]};
    const capture=recording==='v3'?createPublicAlertCaptureV3({slot:0,log,memory}):recording?createPublicAlertCaptureV2({slot:0,log,memory}):null,oracleFrames=[];
    const observer={measureRaw:frozenOracle,onMeasurements:payload=>oracleFrames.push(structuredClone(payload))};let view;
    for(let tick=0;tick<=180;tick++){
      if(tick>0)step(f.g);if(tick===40)hurt(f);if(tick%2===0)view=viewFor(f.g,0,{});
      const submit=cmd=>{const result=command(f.g,0,cmd);log.commands.push({tick,command:structuredClone(cmd),accepted:result===undefined,rejection:result ?? null});return result;};
      think(f.g,0,{memory,view,seed:27,level:'normal',perceptionMeasurements:capture?capture.wrapMeasurements(observer):observer,
        inputLog:input=>{log.inputs.push(structuredClone(input));capture?.input(log.inputs.at(-1),log.inputs.length-1);},submit:capture?.wrapSubmit?capture.wrapSubmit(submit):submit});
      retain(log,memory.human);capture?.afterThink(tick);if(tick%2===0)f.g.shots=[];
    }
    capture?.finish(180);
    return {inputs:log.inputs,commands:log.commands,events:log.events,oracleFrames,memory:publicState(memory),game:publicState(f.g),rng,
      ...(capture?{score:recording==='v3'?scorePublicAlertsV3(log):scorePublicAlertsV2(log)}:{})};
  }finally{Math.random=oldRandom;}
}
const checks=[],failures=[],results={};
function check(name,fn){try{fn();checks.push(name);}catch(error){failures.push({name,message:error.message,stack:error.stack});}}
for(const control of ['retargeted','space','minimap-camera','cancel-target','cancel-target-missing-witness','cancel-target-false-state','defense','no-purpose','unsupported-ability','partial','interrupted','eventless'])check(`native ${control}`,()=>{results[control]=fixture(control,'v3');});
check('proved retarget preserves required censor and every originalV2 score',()=>{const v3=results.retargeted,v2=fixture('retargeted',true);assert.deepEqual(v3.score.originalV2,v2.score);assert.deepEqual(v3.log.alertMeasurementsV2,v2.log.alertMeasurementsV2);assert.deepEqual(v3.log.inputs,v2.log.inputs);assert.deepEqual(v3.log.commands,v2.log.commands);assert.deepEqual(v3.game,v2.game);assert.deepEqual(v3.state,v2.state);assert.equal(v3.rng,v2.rng);assert.equal(v3.score.unknownRows.length,0);assert.equal(v3.score.knownNonresponseRows.length,1);assert.equal(v3.score.evaluable,true);const original=v3.score.requiredPopulation.find(r=>r.creation.id===v3.original.id);assert.equal(original.completedTick,null);assert.equal(original.censorTick,180);assert.equal(v3.score.requiredEvents,v2.score.requiredEvents);assert.deepEqual(v3.score.samples,v2.score.samples);assert.deepEqual(v3.score.survival,v2.score.survival);});
check('cancelAim public before-after witness changes no endpoint',()=>{const v3=results['cancel-target'],v2=fixture('cancel-target',true);assert.deepEqual(v3.score.originalV2,v2.score);assert.equal(v3.score.knownNonresponseRows.filter(r=>r.reason==='proved-cancelAim-only').length,1);assert.equal(v3.score.unknownRows.length,0);assert.equal(v3.score.evaluable,true);assert.deepEqual(v3.score.samples,v2.score.samples);assert.deepEqual(v3.log.inputs,v2.log.inputs);assert.deepEqual(v3.log.commands,v2.log.commands);assert.deepEqual(v3.state,v2.state);assert.deepEqual(v3.game,v2.game);assert.equal(v3.rng,v2.rng);});
for(const control of ['cancel-target-missing-witness','cancel-target-false-state','no-purpose','unsupported-ability','partial','interrupted'])check(`unproved ${control} stays unknown`,()=>{assert.equal(results[control].score.evaluable,false);assert.ok(results[control].score.unknownRows.length>0);});
check('native accepted ability does not acquire a response endpoint',()=>{const row=results['unsupported-ability'];assert.ok(row.log.commands.some(receipt=>receipt.accepted && receipt.command.t==='ability'));assert.deepEqual(row.score.samples,row.score.originalV2.samples);});
check('native valid arrivals keep original response samples',()=>{for(const control of ['space','minimap-camera','defense'])assert.deepEqual(results[control].score.samples,results[control].score.originalV2.samples);});
check('eventless remains unknown pooled median',()=>{assert.equal(results.eventless.score.evaluable,true);assert.equal(poolPublicAlertsV3([results.eventless.score],'normal').gate,'unknown');});
check('deserializedV3 cannot gain native provenance',()=>{assert.equal(scorePublicAlertsV3(structuredClone(results.retargeted.log)).recorded,false);});
check('missing or forged before-after proof invalidates live seal',()=>{const f=fixture('cancel-target','v3');f.log.alertMeasurementsV3.cancelWitnesses[0].cancelTargetingBefore=false;assert.equal(scorePublicAlertsV3(f.log).recorded,false);});
check('native V2 stream modification invalidates live seal',()=>{const f=fixture('retargeted','v3');f.log.alertMeasurementsV2.completions[0].cameraApplied=false;assert.equal(scorePublicAlertsV3(f.log).recorded,false);});
check('default commander capture leaves entire native graph and RNG unchanged',()=>{const off=defaultCommander(false),on=defaultCommander('v3'),old=defaultCommander(true);const {score,...rest}=on;assert.deepEqual(rest,off);assert.deepEqual(score.originalV2,old.score);assert.ok(off.inputs.length>0);results.defaultCommander={inputs:off.inputs.length,commands:off.commands.length,events:off.events.length,oracleFrames:off.oracleFrames.length,rng:off.rng,nativeEquality:true,score};});
check('changed raw native command receipts invalidate V3 provenance',()=>{const f=fixture('defense','v3');f.log.commands[0].accepted=false;assert.equal(scorePublicAlertsV3(f.log).recorded,false);});
check('mutated detached witness callback cannot alter native state or grading',()=>{const on=fixture('cancel-target','v3-mutated'),reference=results['cancel-target'];assert.equal(on.witnessCallbacks,1);assert.deepEqual(on.state,reference.state);assert.deepEqual(on.game,reference.game);assert.equal(on.rng,reference.rng);assert.deepEqual(on.log.inputs,reference.log.inputs);assert.deepEqual(on.log.commands,reference.log.commands);assert.deepEqual(on.log.events,reference.log.events);assert.deepEqual(on.score,reference.score);});
const output={schema:'ww2-public-alert-v3-native-proof-v1',declaration,checks,failures,results,status:failures.length?'FAIL':'PASS'};
const proofIndex=process.argv.indexOf('--proof-out');if(proofIndex>=0){assert.ok(process.argv[proofIndex+1]);writeFileSync(process.argv[proofIndex+1],JSON.stringify(output)+'\n',{flag:'wx'});}
const summary={schema:output.schema,status:output.status,checks:checks.length,failures,fixtures:Object.fromEntries(Object.entries(results).map(([name,r])=>[name,{inputs:r.log?.inputs.length??r.inputs,commands:r.log?.commands.length??r.commands,evaluable:r.score?.evaluable,requiredEvents:r.score?.requiredEvents,knownNonresponses:r.score?.knownNonresponseRows?.length,unknownRows:r.score?.unknownRows?.length,originalV2UnknownRows:r.score?.originalV2?.unknownRows?.length,unchangedSamples:r.score?JSON.stringify(r.score.samples)===JSON.stringify(r.score.originalV2?.samples):undefined}]))};
console.log(JSON.stringify(summary));process.exitCode=failures.length?1:0;
