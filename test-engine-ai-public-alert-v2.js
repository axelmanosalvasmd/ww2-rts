import assert from 'node:assert/strict';
import { createGame, command, step } from './shared/sim.js';
import { viewFor } from './shared/ai-view.js';
import { perceive } from './shared/ai-perception.js';
import { createHands, enqueueDecision, queueCamera, advanceHands, interruptHands } from './shared/ai-hands.js';
import { think } from './shared/ai.js';
import { perceive as frozenOracle } from './tools/ai-screen-v1-oracle.js';
import { createPublicAlertCapture, scorePublicAlerts } from './tools/ai-public-alert-response.mjs';
import { createPublicAlertCaptureV2, scorePublicAlertsV2, poolPublicAlertsV2 } from './tools/ai-public-alert-response-v2.mjs';
const map={w:160,h:160,rows:Array(160).fill('.'.repeat(160)),heights:Array(160).fill('0'.repeat(160)),spawns:[{x:20,y:20},{x:75,y:75}],points:[]};
const declaration={sourceCheckpoint:'99484b839900c6e9957b222c01cc5a0397517af71a466b34d8951d3300c77c59',seed:27,horizonTicks:180,
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
    const f=game(),log={events:[],inputs:[],commands:[]},memory={human:{camera:{x:80,z:80,yaw:0,distance:60}}},state=memory.human;
    if(control==='pan-axis')f.own[0].x=80;
    const capture=recording==='v1'?createPublicAlertCapture({slot:0,log,memory}):recording?createPublicAlertCaptureV2({slot:0,log,memory}):null;
    state.hands=createHands({slot:0,seed:27,level:'normal',camera:state.camera,
      log:input=>{log.inputs.push(structuredClone(input));capture?.input(log.inputs.at(-1),log.inputs.length-1);}});
    state.hands.groups.set(1,[f.own[1].id]);
    if(control==='already-selected')state.hands.selected=[f.own[1].id];
    let extra;
    if(['partial','sequential-partial'].includes(control)){assert.equal(command(f.g,0,{t:'buy',unit:'rifle'}),undefined);extra=[...f.g.units.values()].at(-1);Object.assign(extra,{x:160,z:200,holdFire:true,auto:false,autoRetreat:false});state.hands.groups.set(1,[f.own[1].id,extra.id]);
      if(control==='sequential-partial'){Object.assign(f.own[0],{x:135,z:80});Object.assign(f.own[1],{x:100,z:80});Object.assign(extra,{x:120,z:80});assert.equal(command(f.g,0,{t:'buy',unit:'rifle'}),undefined);const intervening=[...f.g.units.values()].at(-1);Object.assign(intervening,{x:110,z:80,holdFire:true,auto:false,autoRetreat:false});state.hands.groups.clear();}}
    const submit=cmd=>{if(control==='rejected')f.own[1].owner=1;const result=command(f.g,0,cmd);log.commands.push({tick:f.g.tick,command:structuredClone(cmd),accepted:result===undefined,rejection:result ?? null});return result;};
    let view,original,queued=false,interrupted=false,retargeted=false;
    const measurements=capture?.wrapMeasurements();
    for(let tick=0;tick<=180;tick++){
      f.g.tick=tick;
      if(tick===40 && control!=='eventless')hurt(f);
      if(tick===100 && control==='partial')f.g.units.delete(extra.id);
      if(control==='retargeted' && state.hands.active && !retargeted){f.own[1].x=280;f.own[1].z=45;hurt(f,1);retargeted=true;}
      if(tick%2===0 || retargeted&&f.g.shots.length){view=perceive(viewFor(f.g,0,{}),0,state,tick,measurements);state.view=view;retain(log,state);f.g.shots=[];}
      advanceHands(state.hands,tick,view,capture?.wrapSubmit?capture.wrapSubmit(submit):submit);
      if(tick===40 && control!=='eventless'){
        original=log.events.find(e=>e.source==='alert');assert.equal(original?.onScreen,false);
        const cause=control==='wrong-cause'?{...original,id:'unrelated'}:original;
        const context={event:cause,eventTick:original.tick,responseEvents:[cause],concern:`alert:${cause.id}`};
        if(['group-camera','retargeted','space','minimap-camera','pan-axis','pan-diagonal'].includes(control)){
          const mode=control==='group-camera'?'group':control==='minimap-camera'?'minimap':control.startsWith('pan-')?'pan':'alert';assert.equal(queueCamera(state.hands,control==='group-camera'?f.own[1]:original,context,mode),true);
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
      capture?.afterThink(tick);
      if(control==='interrupted'&&state.hands.active&&!state.hands.active.reacting&&!interrupted){interruptHands(state.hands,tick,view);interrupted=true;}
    }
    capture?.finish(180);
    return {log,original,state:publicState(state),game:publicState(f.g),rng,queued,score:capture?(recording==='v1'?scorePublicAlerts(log):scorePublicAlertsV2(log)):null};
  }finally{Math.random=oldRandom;}
}
function defaultCommander(recording){
  const oldRandom=Math.random;let rng=777;Math.random=()=>((rng=(Math.imul(rng,1664525)+1013904223)>>>0)/4294967296);
  try{
    const f=game(),memory={human:{startedTick:0,camera:{x:80,z:80,yaw:0,distance:60}}},log={events:[],inputs:[],commands:[]};
    const capture=recording?createPublicAlertCaptureV2({slot:0,log,memory}):null,oracleFrames=[];
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
      ...(capture?{score:scorePublicAlertsV2(log)}:{})};
  }finally{Math.random=oldRandom;}
}
const checks=[],failures=[],results={};
function check(name,run){try{run();checks.push(name);}catch(error){failures.push({name,message:error.message,stack:error.stack});}}
const cases=['defense','already-selected','rejected','unrelated-target','no-purpose','precreation','wrong-cause','partial','sequential-partial','interrupted','group-camera','retargeted','space','minimap-camera','pan-axis','pan-diagonal','eventless'];
for(const control of cases)check(`native fixture ${control}`,()=>{results[control]=fixture(control);});
check('accepted same-operation selection is first action',()=>{
  const result=results.defense,score=result.score;assert.equal(score.requiredEvents,1);assert.equal(score.samples[0].observed,true);
  assert.equal(score.requiredPopulation[0].endpoint.kind,'accepted-operation-selection');assert.equal(score.requiredPopulation[0].completedTick,result.log.inputs[0].tick);
  assert.ok(score.requiredPopulation[0].endpoint.acceptedTick>result.log.inputs[0].tick);assert.equal(score.evaluable,true);
  assert.equal(score.originalV1.evaluable,false);assert.equal(score.originalV1.requiredEvents,score.requiredEvents);
  assert.equal(result.log.inputs[0].kind,'group-recall');assert.equal(result.log.inputs.at(-1).kind,'minimap-rightclick');
});
check('already selected defender is first actual paid order',()=>{const score=results['already-selected'].score;assert.equal(score.samples[0].observed,true);assert.equal(score.requiredPopulation[0].endpoint.kind,'accepted-order');});
for(const control of ['rejected','unrelated-target','no-purpose','precreation','wrong-cause','partial','interrupted'])check(`no endpoint for ${control}`,()=>{
  const score=results[control].score;assert.ok(score.requiredEvents>=1);assert.equal(score.samples.find(row=>row.event.startsWith(results[control].original.id+'/')).observed,false);
  assert.equal(score.requiredPopulation[0].censorTick,180);
});
check('actual partial recall cannot receive full operation credit',()=>{const result=results.partial;assert.ok(result.log.inputs.length>0);assert.ok(result.log.commands.some(row=>row.accepted));assert.ok(result.log.alertMeasurementsV2.operations.some(row=>row.ids.length===2));assert.ok(result.log.inputs.some(row=>row.ids?.length===1));});
check('native sequential partial selection is not credited as the full operation',()=>{const result=results['sequential-partial'];const clicks=result.log.inputs.filter(row=>['select-click','select-add-click'].includes(row.kind));assert.equal(clicks.length,2);assert.equal(clicks[0].ids.length,1);assert.equal(clicks[1].ids.length,2);assert.ok(result.log.commands.some(row=>row.accepted&&row.command.orders.length===2));const endpoint=result.score.requiredPopulation[0].endpoint;assert.ok(endpoint);assert.equal(endpoint.kind,'accepted-operation-selection');assert.equal(result.score.requiredPopulation[0].completedTick,clicks[1].tick);assert.ok(result.score.unknownRows.some(row=>row.inputIndex===result.log.inputs.indexOf(clicks[0])));assert.equal(result.score.evaluable,false);});
check('version 1 sidecar result stays identical to v1-only capture',()=>{const old=fixture('defense','v1');assert.deepEqual(results.defense.score.originalV1,old.score);assert.deepEqual(results.defense.log.alertMeasurements,old.log.alertMeasurements);});
check('native group jump proves actual camera endpoint',()=>{const score=results['group-camera'].score;assert.equal(score.samples[0].observed,true);assert.equal(score.requiredPopulation[0].endpoint.kind,'camera');});
for(const control of ['space','minimap-camera','pan-axis'])check(`native ${control} arrival`,()=>{const score=results[control].score;assert.equal(score.samples[0].observed,true);assert.equal(score.requiredPopulation[0].endpoint.kind,'camera');});
check('prospective overlap pan follows its declared native gesture version',()=>{const result=results['pan-diagonal'];const overlap=[2,3].includes(result.log.alertMeasurements.panGestureVersion);assert.equal(result.score.samples[0].observed,overlap);assert.equal(result.log.inputs.length,overlap?2:1);if(overlap)assert.ok(result.log.alertMeasurementsV2.completions.every(row=>row.panMotion));});
check('retargeted native Space does not answer original',()=>{const r=results.retargeted.score.requiredPopulation.find(row=>row.creation.id===results.retargeted.original.id);assert.equal(r.completedTick,null);});
check('eventless coverage retains unknown median',()=>{const score=results.eventless.score;assert.equal(score.evaluable,true);assert.equal(poolPublicAlertsV2([score],'normal').gate,'unknown');assert.equal(poolPublicAlertsV2([score],'normal').eventlessSeats,1);});
check('deserialized stream cannot acquire native provenance',()=>{assert.equal(scorePublicAlertsV2(structuredClone(results.defense.log)).recorded,false);});
check('sealed stream mutation invalidates provenance',()=>{const result=fixture();result.log.alertMeasurementsV2.commands[0].accepted=false;assert.equal(scorePublicAlertsV2(result.log).recorded,false);});
check('forged unrecorded native-looking log is rejected',()=>{assert.equal(scorePublicAlertsV2({events:results.defense.log.events,inputs:results.defense.log.inputs,alertMeasurementsV2:structuredClone(results.defense.log.alertMeasurementsV2)}).recorded,false);});
check('missing perception cannot certify an eventless seat',()=>{const log={events:[],inputs:[]},capture=createPublicAlertCaptureV2({slot:0,log,memory:{}});capture.afterThink(0);capture.finish(0);assert.equal(scorePublicAlertsV2(log).evaluable,false);assert.equal(poolPublicAlertsV2([scorePublicAlertsV2(log)],'normal').gate,'unknown');});
check('sealed raw creation tampering is rejected',()=>{const result=fixture();result.log.events[0].tick--;assert.equal(scorePublicAlertsV2(result.log).recorded,false);});
check('no private foe attributes in creation snapshot',()=>{for(const row of results.defense.log.alertMeasurementsV2.creations){const scene=row.publicScene;assert.ok(scene);assert.equal(scene.own.length,2);assert.equal(scene.dots.some(dot=>'type' in dot||'hp' in dot||'id' in dot),false);assert.equal(scene.own.some(unit=>'hp' in unit||'cd' in unit||'targetId' in unit),false);}});
check('fixture collector does not change native state or inputs',()=>{const on=results.defense,off=fixture('defense',false);assert.deepEqual({inputs:on.log.inputs,commands:on.log.commands,events:on.log.events,state:on.state,game:on.game,rng:on.rng},{inputs:off.log.inputs,commands:off.log.commands,events:off.log.events,state:off.state,game:off.game,rng:off.rng});});
check('default commander native capture noninterference',()=>{const off=defaultCommander(false),on=defaultCommander(true);const {score,...rest}=on;assert.deepEqual(rest,off);assert.ok(off.inputs.length>0);assert.ok(score.rawAlerts.length>0);results.defaultCommander={simulationSteps:180,score,inputs:off.inputs.length,commands:off.commands.length,oracleFrames:off.oracleFrames.length,rng:off.rng,equality:true};});
const output={schema:'ww2-public-alert-focused-proof-v2',declaration,checks,failures,results:Object.fromEntries(Object.entries(results).map(([name,r])=>[name,r.log?{inputs:r.log.inputs,commands:r.log.commands,score:r.score,capture:r.log.alertMeasurementsV2}:r])),status:failures.length?'FAIL':'PASS'};
console.log(JSON.stringify(output));process.exitCode=failures.length?1:0;
