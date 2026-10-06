// Authored decisions pass through native perception, commander hands and authoritative commands.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as sim from './shared/sim.js';
import {viewFor} from './shared/ai-view.js';
import {perceive} from './shared/ai-perception.js';
import {createHands,enqueueDecision,queueCamera,advanceHands,startQueuedInput} from './shared/ai-hands.js';
import {runCommander} from './shared/ai-commander.js';
import {random} from './shared/ai-rng.js';
import {bindings} from './client/keys.js';
import {createManualCapture} from './tools/ai-manual-response-capture-v3.mjs';
import {createPublicAlertCaptureV3} from './tools/ai-public-alert-response-v3.mjs';

const sourceURL=new URL('./shared/ai-commander.js',import.meta.url),source=readFileSync(sourceURL,'utf8');
const activation='  if (hands) startQueuedInput(hands, opts.tick ?? observation.tick, hands.lastView);';
assert.equal(source.split(activation).length,2,'the control removes only post-planning first-job activation');
const unprimedSource=source.replace(activation,'').replace(/from (['"])(\.[^'"]+)\1/g,
 (_match,quote,path)=>`from ${quote}${new URL(path,sourceURL).href}${quote}`);
const {runCommander:unprimed}=await import(`data:text/javascript;base64,${Buffer.from(unprimedSource).toString('base64')}`);
const digest=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
function canonical(value,seen=new Map()) {
 if(typeof value==='function')return undefined;
 if(typeof value==='number'&&!Number.isFinite(value))return {$number:String(value)};
 if(!value||typeof value!=='object')return value;
 if(seen.has(value))return {$ref:seen.get(value)};
 seen.set(value,seen.size);
 if(ArrayBuffer.isView(value))return {$type:value.constructor.name,values:Array.from(value)};
 if(value instanceof ArrayBuffer)return {$type:'ArrayBuffer',values:Array.from(new Uint8Array(value))};
 if(value instanceof Map)return {$map:[...value].map(([key,item])=>[canonical(key,seen),canonical(item,seen)])};
 if(value instanceof Set)return {$set:[...value].map(item=>canonical(item,seen))};
 if(Array.isArray(value))return value.map(item=>canonical(item,seen));
 return Object.fromEntries(Object.keys(value).sort().filter(key=>typeof value[key]!=='function').map(key=>[key,canonical(value[key],seen)]));
}
function fixture(control='selection',recording='off',runner=runCommander) {
 const prior=Math.random;let simulationRng=23;
 Math.random=()=>((simulationRng=(Math.imul(simulationRng,1664525)+1013904223)>>>0)/4294967296);
 try {
  const g=sim.createGame({w:96,h:96,rows:Array(96).fill('.'.repeat(96)),heights:Array(96).fill('0'.repeat(96)),
   spawns:[{x:5,y:5},{x:91,y:91}],points:[]},['own','enemy'],false,[0,1],[0,1],{weather:false});
  g.units.clear();g.players.forEach(player=>Object.assign(player,{mp:5000,fuel:5000,mun:1000}));
  assert.equal(sim.command(g,0,{t:'buy',unit:'rifle'}),undefined);
  const own=[...g.units.values()].at(-1);Object.assign(own,{x:80,z:80,holdFire:true,auto:false,autoRetreat:false});
  assert.equal(sim.command(g,1,{t:'buy',unit:'rifle'}),undefined);
  const enemy=[...g.units.values()].at(-1);Object.assign(enemy,{x:94,z:79,holdFire:true,auto:false,autoRetreat:false});
  assert.equal(sim.command(g,0,{t:'buy',unit:'rifle'}),undefined);
  const remote=[...g.units.values()].at(-1);Object.assign(remote,{x:170,z:170,holdFire:true,auto:false,autoRetreat:false});
  g.players.forEach(player=>Object.assign(player,{mp:0,fuel:0,mun:0}));sim.step(g);
  const opening=control==='opening',created=opening?0:240;g.tick=created;
  const log={events:[],inputs:[],commands:[],physicalInputsRecorded:true},camera={x:80,z:80,yaw:0,distance:60};
  const memory={human:{startedTick:0,camera}},state=memory.human;
  state.hands=createHands({slot:0,seed:1,level:'hard',camera,startedTick:0});
  const hands=state.hands;
  if(!opening){hands.openingDone=true;hands.openingUntil=0;}
  if(control==='selected')hands.selected=[own.id];
  Object.assign(hands.pointer,{x:1797,y:1022,fromX:1797,fromY:1022,toX:1797,toY:1022});
  let proofMutations=0;
  const observer={measureRaw:()=>null,onMeasurements:()=>{}};
  const manual=recording==='manual'||recording==='both'||recording==='mutated'?createManualCapture({slot:0,log,memory,rules:{...sim,bindings},perceive,observer,
   onProof:recording==='mutated'?proof=>{proofMutations++;proof.units.forEach(unit=>unit.hp=1);proof.privateLabels={responseRequired:false};}:undefined}):null;
  const alert=recording==='alert'||recording==='both'||recording==='mutated'?createPublicAlertCaptureV3({slot:0,log,memory,startedTick:created}):null;
  const measurements=alert?.wrapMeasurements(manual?.perceptionMeasurements)??manual?.perceptionMeasurements;
  hands.log=input=>{log.inputs.push(structuredClone(input));manual?.input(log.inputs.at(-1),log.inputs.length-1);alert?.input(log.inputs.at(-1),log.inputs.length-1);};
  let queuedTick,queuedContext,planned=false,refused=false,view;const frames=[],plans=[];
  const projection={};
  const horizon=opening?90:control==='camera'?60:40;
  for(let tick=created;tick<=created+horizon;tick++) {
   g.tick=tick;
   if(control==='dead'&&queuedTick!==undefined&&tick===queuedTick+1)own.hp=0;
   if(control==='missed'&&queuedTick!==undefined&&tick===queuedTick+1){own.x=160;remote.x=80;remote.z=80;}
   if(control==='minute-cap')hands.inputTicks=Array(120).fill(created);
   if(control==='peak-cap')hands.inputTicks=Array(33).fill(created);
   if(control==='camera'&&tick===created+2){remote.hp*=.6;g.shots=[{t:remote.id,to:0,fo:1,x:remote.x,z:remote.z,k:'hurt',kill:false}];}
   if(!view||tick%2===0)view=viewFor(g,0,projection);
   if(['active','backlog','held-pan'].includes(control)&&tick===created){
    state.view=perceive(view,0,state,tick,measurements);
    advanceHands(hands,tick,state.view,()=>assert.fail('preparation cannot dispatch'));
    if(control==='held-pan')assert.ok(queueCamera(hands,{x:100,z:80},{concern:'authored-held-trip'},'pan'));
    else assert.ok(enqueueDecision(hands,{t:'stance',ids:[own.id],key:'holdFire',on:false},state.view,{concern:'authored-existing-work',cycle:0}));
    if(control==='active'||control==='held-pan')advanceHands(hands,tick,state.view,()=>assert.fail('existing action preparation cannot dispatch'));
    else hands.queue[0].queuedTick=tick-1;
   }
   const submit=cmd=>{
    if(control==='refused'&&!refused){g.players[0].away=true;refused=true;}
    const result=sim.command(g,0,cmd);
    log.commands.push({tick,command:structuredClone(cmd),accepted:result===undefined,rejection:result??null});
    return result;
   };
   const beforeInputs=log.inputs.length,beforeCommands=log.commands.length;
   runner(view,0,{tick,level:'hard',seed:1,inputLog:hands.log,perceptionMeasurements:measurements},memory,
    alert?alert.wrapSubmit(submit):submit,(_public,_slot,opts,_memory,send)=>{
     if(planned||['active','backlog','held-pan','no-work','camera'].includes(control))return;
     const before=hands.rng.state;
     // This authored choice draw must precede all first-motor preparation draws.
     const choice=random(hands.rng);plans.push({tick,before,choice,afterChoice:hands.rng.state,concern:opts.concern.kind});
     const result=send(control==='selected'?{t:'stance',ids:[own.id],key:'holdFire',on:false}:{t:'attack',ids:[own.id],target:enemy.id});
     assert.equal(result,undefined,'the attended native planner accepts the authored local intent');
     if(control==='pair-jobs')assert.equal(send({t:'stance',ids:[own.id],key:'holdFire',on:false}),undefined);
     planned=true;queuedTick=tick;
    });
   for(const event of state.events??[])if(!log.events.some(row=>row.id===event.id&&row.tick===event.tick))log.events.push(structuredClone(event));
   const job=hands.active?.job??hands.queue.find(job=>job.queuedTick===queuedTick);
   if(job&&queuedTick===tick){
    queuedContext=structuredClone(job.context);
    assert.ok(Object.isFrozen(job.context.responseEvents),'causal links remain frozen');
    assert.equal(log.inputs.length,beforeInputs,'new startup completes no input at its queue tick');
    assert.equal(log.commands.length,beforeCommands,'new startup submits no command at its queue tick');
   }
   manual?.afterThink(tick);alert?.afterThink(tick);
   frames.push({tick,game:digest(g),memory:digest(memory),delivery:digest(view),handsRng:hands.rng.state,simulationRng,
    active:!!hands.active,reacting:!!hands.active?.reacting,queued:hands.queue.length,firstStart:hands.active?.actions[0].startedTick??null,
    firstDue:hands.active?.due??null,selected:[...hands.selected]});
   if(tick%2===0)g.shots=[];
  }
  for(const input of log.inputs){
   assert.equal(input.tick-input.inputStartedTick,input.motorTicks,'every input pays its entire motor');
   for(const event of input.responseEvents??[])if(Number.isFinite(event.tick))assert.ok(input.tick>=event.tick+4,'every causal link keeps its four-tick floor');
  }
  assert.ok(log.commands.every((row,index)=>index===0||row.tick!==log.commands[index-1].tick),'one actual command per tick');
  return {control,recording,created,queuedTick,queuedContext,plans,proofMutations,log,frames,
   finalGame:digest(g),finalMemory:digest(memory),handsRng:hands.rng.state,simulationRng};
 } finally {Math.random=prior;}
}
const gameplay=result=>({created:result.created,queuedTick:result.queuedTick,queuedContext:result.queuedContext,plans:result.plans,
 inputs:result.log.inputs,commands:result.log.commands,events:result.log.events,frames:result.frames,finalGame:result.finalGame,
 finalMemory:result.finalMemory,handsRng:result.handsRng,simulationRng:result.simulationRng});
const proof=[],controls=['selection','selected','dead','missed','refused','minute-cap','peak-cap','opening','camera','active','backlog','held-pan','no-work','pair-jobs'];
for(const control of controls){
 const before=fixture(control,'off',unprimed),after=fixture(control);
 if(['selected','minute-cap','peak-cap','opening','camera','active','backlog','held-pan','no-work'].includes(control)){
  assert.deepEqual(after.log.inputs,before.log.inputs,control+' preserves its complete physical input timeline');
  assert.deepEqual(after.log.commands,before.log.commands,control+' preserves its actual command receipts');
 }
 if(['active','backlog','held-pan','camera','no-work'].includes(control))assert.deepEqual(gameplay(after),gameplay(before),control+' preserves all game, camera, public delivery and RNG frames');
 if(['selection','missed','refused','pair-jobs'].includes(control)){
  assert.equal(after.log.inputs[0].inputStartedTick,after.queuedTick,'eligible first motor starts in its planning tick');
  assert.equal(before.log.inputs[0].inputStartedTick,before.queuedTick+1,'the existing startup has its original separate tick');
  assert.equal(after.log.inputs[0].tick,before.log.inputs[0].tick-1,'only the first-job startup gap is removed');
  assert.equal(after.log.inputs[0].motorTicks,before.log.inputs[0].motorTicks);
  assert.deepEqual(after.log.inputs[0].pointer,before.log.inputs[0].pointer,'the exact endpoint, widths, travel, noise and motor coefficients remain');
  assert.deepEqual(after.plans,before.plans,'all intent choice draws precede motor preparation');
 }
 if(control==='selection'){
  assert.equal(after.log.inputs[0].motorTicks,7);
  assert.equal((before.log.inputs[0].tick-before.created)/20,.5);assert.equal((after.log.inputs[0].tick-after.created)/20,.45);
  assert.equal(after.log.commands.filter(row=>row.accepted).length,1);
  assert.equal(after.log.commands[0].command.t,'attack');
  assert.ok(after.frames.find(row=>row.tick===after.log.commands[0].tick).selected.length===1);
  assert.deepEqual(after.queuedContext,before.queuedContext,'the frozen public causal intent remains exact');
 }
 if(control==='dead'){
  assert.equal(after.frames.find(frame=>frame.tick===after.queuedTick).firstStart,after.queuedTick);
  assert.equal(after.log.inputs.length,0);assert.equal(after.log.commands.length,0);
  assert.ok(after.frames.some(frame=>frame.tick>after.queuedTick&&!frame.active),'a delivered native loss cancels its approach');
 }
 if(control==='missed'){assert.equal(after.log.inputs.length,1);assert.equal(after.log.commands.length,0);}
 if(control==='refused'){assert.equal(after.log.commands.length,1);assert.equal(after.log.commands[0].accepted,false);assert.equal(after.log.commands[0].rejection,'blocked');}
 if(control==='minute-cap'||control==='peak-cap'){assert.equal(after.log.inputs.length,0);assert.equal(after.log.commands.length,0);}
 if(control==='opening')assert.ok(after.log.inputs.every(row=>row.tick>=30),'the full opening look remains');
 if(control==='camera')assert.ok(after.log.events.some(event=>event.source==='alert'&&!event.onScreen),'camera neighbor has a genuine public offscreen alert');
 if(control==='pair-jobs'){assert.equal(after.log.commands.length,2);assert.ok(after.log.inputs.some(input=>input.inputStartedTick>input.queuedTick),'the older second job retains its ordinary later activation');}
 proof.push({control,before,after});
}
for(const control of ['selection','selected','dead','missed','refused','pair-jobs','camera']){
 const bare=fixture(control);
 for(const recording of ['manual','alert','both','mutated']){
  const recorded=fixture(control,recording);
  assert.deepEqual(gameplay(recorded),gameplay(bare),control+' '+recording+' capture cannot perturb native graphs, both RNGs, receipts, cues or deliveries');
  if(recording==='mutated')assert.ok(recorded.proofMutations>0,'detached proof callback actually mutates its proof');
  const manual=recorded.log.manualMeasurements,alert=recorded.log.alertMeasurementsV2;
  if(manual){
   assert.equal(manual.inputReceipts.length,recorded.log.inputs.filter(input=>!input.kind.startsWith('camera-')).length,'every native non-camera input has its real manual receipt');
   for(const start of manual.physicalStarts)assert.equal(start.registeredAtTick,start.startedTick,'manual collector records the actual physical start tick');
   for(const receipt of manual.inputReceipts)assert.deepEqual(receipt.nativeDescriptor,recorded.log.inputs[receipt.inputIndex]);
   for(const operation of manual.operations)assert.ok(operation.publicScene.observationTick<=operation.queuedTick,'no manufactured public delivery');
  }
  if(alert){
   assert.equal(alert.coverage.missingEnqueues,0);assert.equal(alert.coverage.missingStarts,0);
   assert.equal(alert.completions.length,recorded.log.inputs.length,'every native input has a real alert collector receipt');
   for(const operation of alert.operations)assert.equal(operation.registeredAtTick,operation.queuedTick);
   for(const start of alert.starts)assert.equal(start.registeredAtTick,start.startedTick);
   for(const receipt of alert.completions)assert.deepEqual(receipt.nativeDescriptor,recorded.log.inputs[receipt.inputIndex]);
  }
  proof.push({control,recording,recorded});
 }
}
// The starter never skips camera or older work and never changes an already active action.
{
 const view={tick:100,w:160,h:160,winner:null,players:[{out:false}],units:new Map([[1,{id:1,type:'rifle',owner:0,x:80,z:80}]])};
 const hands=createHands({slot:0,seed:1,level:'hard',camera:{x:80,z:80}});hands.openingDone=true;hands.openingUntil=0;
 advanceHands(hands,100,view,()=>assert.fail());assert.ok(queueCamera(hands,{x:100,z:80},{},'pan'));
 assert.ok(enqueueDecision(hands,{t:'stance',ids:[1],key:'holdFire',on:true},view,{}));
 const before=digest(hands);assert.equal(startQueuedInput(hands,100,view),false);assert.equal(digest(hands),before,'a camera head prevents starting a later command');
 assert.equal(startQueuedInput(hands,101,view),false);assert.equal(startQueuedInput(hands,100,structuredClone(view)),false);
 hands.queue.shift();hands.queue[0].queuedTick=99;const old=digest(hands);
 assert.equal(startQueuedInput(hands,100,view),false);assert.equal(digest(hands),old,'an older pending job keeps its prior activation path');
}
if(process.env.AI_INPUT_STARTUP_PROOF)writeFileSync(process.env.AI_INPUT_STARTUP_PROOF,JSON.stringify(proof));
console.log('Input startup: paid native selection .50 to .45 s; refusal, loss, caps, selected, opening, camera/backlog and native collector isolation PASS.');
