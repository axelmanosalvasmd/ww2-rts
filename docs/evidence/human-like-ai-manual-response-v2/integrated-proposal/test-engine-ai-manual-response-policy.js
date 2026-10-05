import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createGame, command, step, UNITS, CELL, CFG, SUPPORT, COVER, los } from './shared/sim.js';
import { viewFor } from './shared/ai-view.js';
import { perceive } from './shared/ai-perception.js';
import { bindings } from './client/keys.js';
import {createManualCapture} from './tools/ai-manual-response-capture.mjs';
import { createHands, enqueueDecision, advanceHands } from './shared/ai-hands.js';
import { kaplanMeier } from './tools/ai-humanity.mjs';
import { MANUAL_RESPONSE_POLICY, MANUAL_RESPONSE_STREAM, createManualResponsePolicy } from './tools/ai-manual-response-policy.mjs';

const { capturePublicScene, classifyManualCreation, commandServesManualCreation, scoreManualResponses } =
  createManualResponsePolicy({ CELL, CFG, UNITS, SUPPORT, COVER, los, bindings });
function serialize(value) {
  const seen = new Map(), nodes = [];
  const visit = item => {
    if (item === undefined) return { $undefined: true };
    if (typeof item === 'number' && !Number.isFinite(item)) return { $number: String(item) };
    if (typeof item === 'bigint') return { $bigint: String(item) };
    if (typeof item === 'function') return { $function: Function.prototype.toString.call(item) };
    if (item === null || typeof item !== 'object') return item;
    if (seen.has(item)) return { $ref: seen.get(item) };
    const index = nodes.length; seen.set(item, index);
    const node = { type: item.constructor?.name ?? 'Object', properties: [] }; nodes.push(node);
    if (item instanceof Map) node.entries = [...item].map(([key, entry]) => [visit(key), visit(entry)]);
    if (item instanceof Set) node.entries = [...item].map(visit);
    if (item instanceof Date) node.value = item.toISOString();
    if (item instanceof ArrayBuffer) node.bytesBase64 = Buffer.from(item).toString('base64');
    if (ArrayBuffer.isView(item)) { node.buffer = visit(item.buffer); node.byteOffset = item.byteOffset; node.byteLength = item.byteLength; }
    if (Array.isArray(item)) node.values = Array.from({ length: item.length }, (_, index) => index in item ? visit(item[index]) : { $hole: true });
    for (const key of Object.keys(item)) {
      if ((Array.isArray(item) || ArrayBuffer.isView(item)) && /^(0|[1-9]\d*)$/.test(key)) continue;
      node.properties.push([key, visit(item[key])]);
    }
    return { $ref: index };
  };
  const root = visit(value); return JSON.stringify({ root, nodes });
}
const originalRandom = Math.random;
let randomState = 23;
Math.random = () => { randomState = Math.imul(randomState, 1664525) + 1013904223; return (randomState >>> 0) / 4294967296; };
const camera = { x: 85, z: 80, yaw: 0, distance: 60 };
function fixture(ownType = 'rifle', enemyType = 'rifle', house = false) {
  const rows = Array(80).fill('.'.repeat(80));
  if (house) rows[40] = house===true ? '.'.repeat(40)+'B'+'.'.repeat(39) : '.'.repeat(39)+house+'.'.repeat(40);
  const g = createGame({ w: 80, h: 80, rows, spawns: [{x:10,y:40},{x:70,y:40}], points: [] },
    ['human','enemy'], false, [0,1], [0,1], { weather: false });
  g.units.clear(); g.players.forEach(player => { player.mp = 10000; player.mun = 1000; });
  assert.equal(command(g, 0, { t: 'buy', unit: ownType }), undefined);
  assert.equal(command(g, 1, { t: 'buy', unit: enemyType }), undefined);
  const own = [...g.units.values()].find(unit => unit.owner === 0), foe = [...g.units.values()].find(unit => unit.owner === 1);
  Object.assign(own, { x:80,z:80,path:[],orders:[],targetId:0,attackId:0,amove:null,auto:false,autoRetreat:false });
  Object.assign(foe, { x:100,z:80,path:[],orders:[],targetId:0,attackId:0,amove:null,holdFire:true,auto:false,autoRetreat:false });
  g.tick = 96; own.holdFire=true; for(let i=0;i<4;i++) step(g); own.holdFire=false;
  const memory = {}, state = { camera: { ...camera }, hands: { selected: [] } };
  const scene = () => capturePublicScene(perceive(viewFor(g,0,memory),0,state,g.tick),0);
  return { g, own, foe, memory, state, scene };
}
const eventFor = (f, kind = 'screen-contact') => ({ id: `test:${f.g.tick}:${kind}`, tick:f.g.tick, observationTick:f.g.tick,
  source:'screen',onScreen:true,kind,x:kind === 'screen-contact' ? f.foe.x : f.own.x,z:f.own.z,
  ...(kind === 'screen-contact' ? { targetId:f.foe.id } : { unitId:f.own.id }) });

function bindNativeReceipts(log) {
 const stream=log.manualMeasurements;stream.physicalStarts=[];stream.inputReceipts=[];stream.publicFrames??=[];
 for(const [opIndex,op] of stream.operations.entries()) {
  op.id=`fixture-operation:${opIndex}`;
  for(const inputIndex of op.inputIndexes ?? []) {
   const input=log.inputs[inputIndex],id=`fixture-start:${opIndex}:${inputIndex}`;
   stream.physicalStarts.push({id,operationId:op.id,registeredAtTick:input.inputStartedTick,startedTick:input.inputStartedTick,queuedTick:input.queuedTick,
    kind:input.kind,input:structuredClone(input.input ?? null),fire:!!input.command,intendedIds:op.command.orders?.map(row=>row[0]) ?? op.command.ids ?? [],
    actualSelectedIds:input.ids ?? [],command:structuredClone(op.command),events:structuredClone(op.events)});
   stream.inputReceipts.push({inputIndex,operationId:op.id,startReceiptId:id,tick:input.tick,nativeDescriptor:structuredClone(input),recipe:structuredClone(op.command)});
   if(input.command) {
    const commandIndex=log.commands.findIndex(row=>row.tick===input.tick);
    Object.assign(stream.receipts.find(row=>row.commandIndex===commandIndex),{inputIndex,operationId:op.id,startReceiptId:id,tick:input.tick});
   }
  }
 }
 return log;
}

let assertions = 0;
const check = (actual, expected, label) => { assert.equal(actual, expected, label); assertions++; };
try {
  // A newly seen in-range enemy is acquired by step(), without any human input.
  const f = fixture(), scene = f.scene(), event = eventFor(f);
  const covered = classifyManualCreation(event, scene);
  check(covered.coverage[0]?.reason, 'automatic-useful-combat', 'public legal fire covers the contact');
  const commandsBefore = f.g.players[0].stats?.commands;
  for (let i=0;i<12;i++) step(f.g);
  check(f.own.targetId, f.foe.id, 'the actual simulation acquires the hostile automatically');
  assert.ok(f.own.shotAt >= 101, 'the actual unit fires with no issued command'); assertions++;
  check(f.g.players[0].stats?.commands, commandsBefore, 'automatic combat is not a human command');
  const held = structuredClone(scene); held.units.find(unit=>unit.id===f.own.id).holdFire = true;
  check(classifyManualCreation(event,held).decision,'required','Hold Fire makes the same contact require action');
  const blocked = structuredClone(scene); blocked.sightlines.forEach(row=>{row.clear=false;});
  check(classifyManualCreation(event,blocked).decision,'required','an obstructed firing line cannot cover the contact');
  const unknownLine = structuredClone(scene); unknownLine.sightlines.forEach(row=>{row.clear=null;});
  check(classifyManualCreation(event,unknownLine).decision,'required','unknown World terrain cannot prove fire');

  const crew = fixture('mg'), crewScene = crew.scene();
  check(classifyManualCreation(eventFor(crew),crewScene).decision,'required','a weapon still setting up is not ready protection');
  crewScene.units.find(unit=>unit.id===crew.own.id).firstStillTick=40;
  check(classifyManualCreation(eventFor(crew),crewScene).decision,'monitoring','the same settled crew can fire automatically');

  const armor = fixture('rifle','tank'); armor.foe.holdFire=false;
  const armorScene=armor.scene();
  check(classifyManualCreation(eventFor(armor),armorScene).decision,'required','small-arms fire does not excuse armor danger');
  const risk = structuredClone(scene), riskOwn=risk.units.find(unit=>unit.id===f.own.id);
  Object.assign(riskOwn,{hp:55,healthShare:.55,healthLower:.525,healthUpper:.575,pinned:true});
  check(classifyManualCreation(event,risk).decision,'required','pinned low-health fire remains a manual demand');

  // A real garrison can hold its defensive position against a contact beyond weapon ranges.
  const fort = fixture('rifle','rifle',true); fort.foe.x=118;
  assert.equal(command(fort.g,0,{t:'garrison',ids:[fort.own.id],x:81,z:81}),undefined);
  for(let i=0;i<20;i++) step(fort.g);
  assert.ok(fort.own.garrison>=0,'the real command has entered the building'); assertions++;
  const fortScene=fort.scene(), fortEvent=eventFor(fort);
  check(classifyManualCreation(fortEvent,fortScene).coverage[0]?.reason,'fortified-monitoring-hold','an unthreatened defensive hold is monitoring');
  const threatened=structuredClone(fortScene); const threat=threatened.units.find(unit=>unit.id===fort.foe.id);
  threat.x=90; threatened.sightlines.forEach(row=>{row.clear=true;});
  const defender=threatened.units.find(unit=>unit.id===fort.own.id); defender.holdFire=true;
  check(classifyManualCreation({...fortEvent,x:90},threatened).decision,'required','a garrison with disabled fire under a legal threat is not exempt');
  const open=structuredClone(fortScene); open.units.find(unit=>unit.id===fort.own.id).garrison=-1;
  check(classifyManualCreation(fortEvent,open).decision,'required','an idle squad in open ground is not a fortified hold');

  // A fresh public threshold and known distant home prove step() will retreat.
  const auto = fixture(); auto.own.hp=30; auto.own.autoRetreat=true;
  const previous=auto.scene(); previous.units.find(unit=>unit.id===auto.own.id).hp=100;
  previous.observationTick=98;
  const autoScene=auto.scene(), damage=eventFor(auto,'screen-damage');
  check(classifyManualCreation(damage,autoScene,previous).coverage[0]?.reason,'automatic-retreat-provable','the fresh public bar proves auto-retreat');
  step(auto.g); check(auto.own.retreating,true,'step() actually retreats without a human command');
  const disabled=structuredClone(autoScene); disabled.units.find(unit=>unit.id===auto.own.id).autoRetreat=false;
  check(classifyManualCreation(damage,disabled,previous).decision,'required','disabled auto-retreat preserves the demand');
  const nearby=structuredClone(autoScene); nearby.possibleHomes=[{x:80,z:80}];
  check(classifyManualCreation(damage,nearby,previous).decision,'required','a near home cannot prove automatic retreat');
  const world=structuredClone(autoScene); world.mode='world';world.possibleHomes=null;
  check(classifyManualCreation(damage,world,previous).decision,'required','unknown World nearest home cannot exempt damage');
  const carried=structuredClone(autoScene);carried.units.find(unit=>unit.id===auto.own.id).flags|=262144;
  check(classifyManualCreation(damage,carried,previous).reason,'outside-ground-damage-policy','carried damage stays outside the ground manual policy');
  const airborne=structuredClone(autoScene);airborne.units.find(unit=>unit.id===auto.own.id).type=Object.keys(UNITS).find(type=>UNITS[type].air);
  check(classifyManualCreation(damage,airborne,previous).reason,'outside-ground-damage-policy','aircraft damage stays outside the ground manual policy');
  const edge=structuredClone(autoScene), edgeUnit=edge.units.find(unit=>unit.id===auto.own.id);
  Object.assign(edgeUnit,{hp:35,healthShare:.35,healthLower:.325,healthUpper:.375});
  check(classifyManualCreation(damage,edge,previous).decision,'required','a threshold-straddling bar cannot prove automatic retreat');

  // A real, completed hands retreat and its selected actor serve a contact farther than24m.
  const response=fixture('rifle','mg'); response.foe.x=110;response.foe.holdFire=false;response.own.holdFire=true;
  const startScene=response.scene(), contact=eventFor(response), record=classifyManualCreation(contact,startScene);
  check(record.decision,'required','the out-of-range rifle under MG threat needs action');
  const cmd={t:'retreat',ids:[response.own.id]};
  check(commandServesManualCreation(cmd,record,startScene),true,'a valid retreat can answer a threat beyond24m');
  check(commandServesManualCreation({t:'buy',unit:'rifle'},record,startScene),false,'an unrelated purchase cannot answer it');
  check(commandServesManualCreation({t:'retreat',ids:[response.foe.id]},record,startScene),false,'the wrong actor cannot answer it');
  check(commandServesManualCreation({t:'move',orders:[[response.own.id,70,80]]},record,startScene),true,'a meaningful pullback away from the visible threat qualifies');
  check(commandServesManualCreation({t:'move',orders:[[response.own.id,79.9,80]]},record,startScene),false,'a tiny repeat or negligible displacement does not');
  check(commandServesManualCreation({t:'move',orders:[[response.own.id,100,80]]},record,startScene),false,'a move toward the MG without a useful attack does not');
  const inputs=[],receipts=[],hands=createHands({slot:0,seed:27,level:'hard',camera:{...camera},startedTick:0,log:input=>inputs.push(structuredClone(input))});
  hands.openingDone=true;hands.openingUntil=0;
  const planned=perceive(viewFor(response.g,0,response.memory),0,response.state,response.g.tick);
  const queuedTick=response.g.tick;hands.tick=queuedTick;
  assert.ok(enqueueDecision(hands,cmd,planned,{event:contact,eventTick:contact.tick,responseActorIds:cmd.ids,responseEvents:[contact]})); assertions++;
  for(let tick=queuedTick;tick<queuedTick+100&&!receipts.length;tick++) {
    response.g.tick=tick;
    const v=perceive(viewFor(response.g,0,response.memory),0,response.state,tick);
    advanceHands(hands,tick,v,actual=>{
      const publicScene=capturePublicScene(v,0,tick), result=command(response.g,0,actual);
      receipts.push({tick,command:structuredClone(actual),accepted:result===undefined,publicScene}); return result;
    });
  }
  assert.ok(receipts[0]?.accepted && response.own.retreating,'the actual hands key changes the real unit'); assertions++;
  const operation={queuedTick,inputStartedTick:Math.min(...inputs.map(input=>input.inputStartedTick)),
    command:cmd,events:[structuredClone(record.creation)],publicScene:startScene,inputIndexes:inputs.map((_,index)=>index)};
  const log={physicalInputsRecorded:true,events:[contact],inputs,commands:receipts.map(({publicScene,...native})=>native),manualMeasurements:{schema:MANUAL_RESPONSE_STREAM,policy:MANUAL_RESPONSE_POLICY,
    startedTick:0,operationLinksRecorded:true,creations:[record],operations:[operation],receipts:receipts.map(({publicScene},commandIndex)=>({commandIndex,publicScene}))}};
  bindNativeReceipts(log);
  const scored=scoreManualResponses(log,10,kaplanMeier);
  check(scored.firstCompletedAction.answered,1,'the paid completed selection has a causal first-action endpoint');
  check(scored.acceptedCommand.answered,1,'the actual accepted retreat has a separate endpoint');
  check(scored.physicalInputCount,inputs.length,'linking does not manufacture physical inputs');
  for(const field of ['queuedTick','inputStartedTick']) {
    const absent=structuredClone(log);absent.inputs.forEach(input=>delete input[field]);
    check(scoreManualResponses(absent,10,kaplanMeier).firstCompletedAction.answered,0,`missing native ${field} fails closed`);
    check(scoreManualResponses(absent,10,kaplanMeier).acceptedCommand.answered,0,`missing native ${field} also rejects command credit`);
  }
  const startsBeforeQueue=structuredClone(log);startsBeforeQueue.inputs.forEach(input=>input.inputStartedTick=99);
  check(scoreManualResponses(startsBeforeQueue,10,kaplanMeier).acceptedCommand.answered,0,'motor start before enqueue rejects command credit');
  const completionBeforeStart=structuredClone(log);completionBeforeStart.inputs.forEach(input=>input.tick=input.inputStartedTick-1);
  check(scoreManualResponses(completionBeforeStart,10,kaplanMeier).firstCompletedAction.answered,0,'completion before start rejects credit');
  const reusedIndex=structuredClone(log);reusedIndex.manualMeasurements.inputReceipts.push(structuredClone(reusedIndex.manualMeasurements.inputReceipts.at(-1)));
  check(scoreManualResponses(reusedIndex,10,kaplanMeier).acceptedCommand.answered,0,'one native input index cannot be used by duplicate receipts');
  const mismatchedStartLink=structuredClone(log);mismatchedStartLink.manualMeasurements.physicalStarts.forEach(start=>start.events[0].x++);
  check(scoreManualResponses(mismatchedStartLink,10,kaplanMeier).acceptedCommand.answered,0,'a changed linked creation descriptor in a motor receipt rejects credit');
  const borrowed=structuredClone(log);borrowed.manualMeasurements.inputReceipts.forEach(receipt=>receipt.operationId='another-job');
  check(scoreManualResponses(borrowed,10,kaplanMeier).firstCompletedAction.answered,0,'another operation cannot lend its selection');
  const wrongQueue=structuredClone(log);wrongQueue.inputs.forEach(input=>input.queuedTick++);
  check(scoreManualResponses(wrongQueue,10,kaplanMeier).firstCompletedAction.answered,0,'a mismatched actual enqueue clock rejects selection');
  const wrongReceipt=structuredClone(log);wrongReceipt.manualMeasurements.inputReceipts.forEach(receipt=>receipt.nativeDescriptor.ids=[999]);
  check(scoreManualResponses(wrongReceipt,10,kaplanMeier).firstCompletedAction.answered,0,'immutable native descriptor mismatch rejects selection');
  const unlinked=structuredClone(log);unlinked.manualMeasurements.operations=[];
  check(scoreManualResponses(unlinked,10,kaplanMeier).firstCompletedAction.censored,1,'a later unlinked command cannot be inferred as a response');
  const future=structuredClone(log);future.manualMeasurements.operations[0].queuedTick=99;
  check(scoreManualResponses(future,10,kaplanMeier).firstCompletedAction.censored,1,'a new event after enqueue cannot be linked');
  const stale=structuredClone(log);stale.manualMeasurements.operations[0].queuedTick=341;
  check(scoreManualResponses(stale,20,kaplanMeier).firstCompletedAction.censored,1,'links older than240ticks at enqueue are rejected');
  const delayed = (offset, moveQueue) => {
    const result=structuredClone(log), op=result.manualMeasurements.operations[0];
    if(moveQueue) {op.queuedTick+=offset;op.publicScene.recordedTick+=offset;op.publicScene.observationTick+=offset;}
    op.inputStartedTick+=offset;
    result.inputs.forEach(input=>{input.tick+=offset;input.inputStartedTick+=offset;if(moveQueue)input.queuedTick+=offset;});
    result.commands.forEach(receipt=>{receipt.tick+=offset;});
    result.manualMeasurements.receipts.forEach(proof=>{proof.publicScene.recordedTick+=offset;proof.publicScene.observationTick+=offset;});
    bindNativeReceipts(result);return result;
  };
  check(scoreManualResponses(delayed(240,true),30,kaplanMeier).acceptedCommand.answered,1,'an exactly240tick-old enqueue remains eligible');
  check(scoreManualResponses(delayed(241,true),30,kaplanMeier).acceptedCommand.answered,0,'a241tick-old enqueue is stale');
  check(scoreManualResponses(delayed(300,false),30,kaplanMeier).acceptedCommand.answered,1,'timely enqueue followed by a long cap wait remains eligible at completion');
  const changed=structuredClone(log);changed.manualMeasurements.operations[0].events[0].targetId=999;
  check(scoreManualResponses(changed,10,kaplanMeier).firstCompletedAction.censored,1,'changed creation metadata is rejected');
  const missed=structuredClone(log);missed.commands[0].command.ids=[999];missed.inputs.at(-1).command.ids=[999];
  check(scoreManualResponses(missed,10,kaplanMeier).firstCompletedAction.answered,1,'a missed selection remains a deliberate attempt');
  check(scoreManualResponses(missed,10,kaplanMeier).acceptedCommand.answered,0,'the wrong actual command actor gets no accepted-response credit');

  const second=classifyManualCreation({...contact,id:'second-same-frame'},startScene);
  const grouped=structuredClone(log);grouped.events.push(second.creation);grouped.manualMeasurements.creations.push(second);grouped.manualMeasurements.operations[0].events.push(second.creation);bindNativeReceipts(grouped);
  check(scoreManualResponses(grouped,10,kaplanMeier).acceptedCommand.answered,2,'one real retreat can protect two independently delivered stimuli');
  check(scoreManualResponses(grouped,10,kaplanMeier).physicalInputCount,inputs.length,'multi-event answers count each input once');
  const low=structuredClone(log);low.inputs=low.inputs.map(input=>({...input,tick:103,inputStartedTick:101}));
  low.manualMeasurements.operations[0].inputStartedTick=101;
  check(scoreManualResponses(low,10,kaplanMeier).firstCompletedAction.answered,0,'completion under0.2s never receives manual credit');

  const earlierScene=structuredClone(startScene),earlierBaseline=structuredClone(startScene);
  earlierScene.recordedTick=earlierScene.observationTick=98;earlierBaseline.recordedTick=earlierBaseline.observationTick=96;
  const earlierUnit=earlierScene.units.find(unit=>unit.id===response.own.id);
  Object.assign(earlierUnit,{hp:30,healthShare:.3,healthLower:.275,healthUpper:.325});
  const flight={source:'physical-key-start',input:{code:'KeyR',shift:false,ctrl:false,alt:false},kind:'retreat-key',command:cmd,actualSelectedIds:cmd.ids,
    queuedTick:100,inputStartedTick:110,declaredAtTick:110,activeAtTick:112,completedTick:null,
    cause:{id:'earlier',kind:'screen-damage',tick:98,observationTick:98,source:'screen',onScreen:true,x:80,z:80,unitId:response.own.id},
    causeRecord:null};
  flight.causeRecord=classifyManualCreation(flight.cause,earlierScene,earlierBaseline);
  const laterScene=structuredClone(startScene);laterScene.recordedTick=laterScene.observationTick=112;
  const later={...contact,id:'newer',tick:112,observationTick:112};
  const authority={nativeCreations:[flight.cause,later],records:[flight.causeRecord],physicalStarts:[{id:'paid-start',operationId:'paid-job',fire:true,registeredAtTick:flight.inputStartedTick,lastActiveTick:112,completedTick:null,queuedTick:flight.queuedTick,startedTick:flight.inputStartedTick,kind:flight.kind,input:flight.input,actualSelectedIds:flight.actualSelectedIds,command:flight.command,events:[flight.cause]}]};
  flight.startReceiptId='paid-start';flight.operationId='paid-job';
  check(classifyManualCreation(later,laterScene,null,[flight],authority).coverage[0]?.reason,'paid-protection-in-flight','an already-started protective key covers a later contact');
  check(classifyManualCreation(later,laterScene,null,[flight]).decision,'required','unregistered physical start cannot excuse the cue');
  const forgedRegistry={...authority,nativeCreations:[]};check(classifyManualCreation(later,laterScene,null,[flight],forgedRegistry).decision,'required','an unseen earlier native cause cannot cover creation');
  const nonRequiredCause=structuredClone(flight);nonRequiredCause.causeRecord.publicProof.units.find(unit=>unit.id===response.own.id).retreating=true;
  check(classifyManualCreation(later,laterScene,null,[nonRequiredCause],authority).decision,'required','a forged nonrequired earlier cause cannot exempt a later demand');
  const completedProtection=structuredClone(authority);completedProtection.physicalStarts[0].completedTick=111;
  check(classifyManualCreation(later,laterScene,null,[flight],completedProtection).decision,'required','a key already complete before creation is not in flight');
  const wrongKey=structuredClone(flight);wrongKey.input.shift=true;
  check(classifyManualCreation(later,laterScene,null,[wrongKey],authority).decision,'required','a different physical chord cannot claim a retreat is in flight');
  const falseCause=structuredClone(flight);delete falseCause.causeRecord.publicProof;
  check(classifyManualCreation(later,laterScene,null,[falseCause],authority).decision,'required','an earlier cause label without public creation evidence cannot provide protection');
  const queuedOnly=structuredClone(flight);queuedOnly.inputStartedTick=113;
  check(classifyManualCreation(later,laterScene,null,[queuedOnly],authority).decision,'required','a merely queued future input cannot cover creation');
  const selecting=structuredClone(flight);selecting.kind='select-click';
  check(classifyManualCreation(later,laterScene,null,[selecting],authority).decision,'required','a selection gesture is not protection');
  const unrelatedFlight=structuredClone(flight);unrelatedFlight.actualSelectedIds=[999];
  check(classifyManualCreation(later,laterScene,null,[unrelatedFlight],authority).decision,'required','wrong actual selection cannot provide in-flight protection');

  // Neighbor grenade: actual public ability, range, threat and blast geometry all matter.
  const supportScene=structuredClone(startScene), victim=supportScene.units.find(unit=>unit.id===response.own.id), hostile=supportScene.units.find(unit=>unit.id===response.foe.id);
  hostile.x=95;
  const helper={...victim,id:500,x:90,z:85,holdFire:false,cdKnown:true,cd:0};supportScene.units.push(helper);
  supportScene.sightlines.push({from:hostile.id,to:helper.id,clear:true},{from:helper.id,to:hostile.id,clear:true});
  const grenade={t:'ability',ids:[500],x:95,z:80};
  check(commandServesManualCreation(grenade,record,supportScene),true,'a ready neighboring grenade can serve the threatened squad');
  check(commandServesManualCreation({...grenade,x:101},record,supportScene),false,'a blast beyond the hostile footprint cannot serve it');
  check(commandServesManualCreation({...grenade,ids:[999]},record,supportScene),false,'an unrelated actor cannot provide the neighboring ability');
  check(commandServesManualCreation({t:'support',kind:'smoke',x:80,z:80},record,supportScene),true,'protective smoke on the threatened squad qualifies');
  check(commandServesManualCreation({t:'support',kind:'smoke',x:105,z:80},record,supportScene),false,'a support center25m away cannot qualify');
  const unknown=classifyManualCreation(contact,null);
  const omitted=structuredClone(log);omitted.manualMeasurements.creations=[];
  check(scoreManualResponses(omitted,10,kaplanMeier).unknownEvents,1,'omitted creation records remain explicit unknown events');
  const forged=structuredClone(log);forged.manualMeasurements.creations[0].decision='monitoring';
  check(scoreManualResponses(forged,10,kaplanMeier).evaluable,false,'a changed derived classification cannot make the stream pass');
  check(scoreManualResponses(forged,10,kaplanMeier).requiredEvents,1,'the required population is recomputed from its public proof');
  const labels=structuredClone(contact);labels.responseRequired=false;labels.responseReason='safe';labels.observedDanger={alreadyEngaged:true,autoRetreatCovered:true};
  check(classifyManualCreation(labels,startScene).decision,'required','planner or runtime grading labels cannot excuse a public manual demand');
  const missing={...log,manualMeasurements:{...log.manualMeasurements,creations:[unknown]}};
  check(scoreManualResponses(missing,10,kaplanMeier).evaluable,false,'missing public creation facts never become a passing population');
  check(scoreManualResponses({inputs},10,kaplanMeier).evaluable,false,'historical and human command-only logs stay unknown');
  const commandsOnly=structuredClone(log);commandsOnly.physicalInputsRecorded=false;commandsOnly.inputs.forEach(input=>{input.actor='human';input.kind='command';});
  check(scoreManualResponses(commandsOnly,10,kaplanMeier).firstCompletedAction.answered,0,'human command rows cannot impersonate physical reactions');
  check(scoreManualResponses(commandsOnly,10,kaplanMeier).evaluable,false,'human command-only capture cannot pass the physical endpoint');
  const untouched=JSON.stringify(log);scoreManualResponses(log,10,kaplanMeier);
  check(JSON.stringify(log),untouched,'the derived policy does not rewrite native inputs or original streams');
  
  const nativeGrenade=fixture('rifle','mg');nativeGrenade.own.holdFire=true;nativeGrenade.foe.x=95;
  assert.equal(command(nativeGrenade.g,0,{t:'buy',unit:'rifle'}),undefined);
  const helperActual=[...nativeGrenade.g.units.values()].filter(unit=>unit.owner===0).at(-1);
  Object.assign(helperActual,{x:90,z:85,path:[],orders:[],amove:{x:90,z:85},auto:false,holdFire:true,cd:0});
  nativeGrenade.state.hands.selected=[helperActual.id];
  const grenadeScene=nativeGrenade.scene(), grenadeEvent=eventFor(nativeGrenade), grenadeRecord=classifyManualCreation(grenadeEvent,grenadeScene);
  const nativeAbility={t:'ability',ids:[helperActual.id],x:95,z:80};
  check(commandServesManualCreation(nativeAbility,grenadeRecord,grenadeScene),true,'the neighboring real selected HUD supplies legitimate ability readiness');
  check(command(nativeGrenade.g,0,nativeAbility),undefined,'the neighboring public ability command really accepts');
  assert.ok(helperActual.nade,'the real helper starts the grenade action');assertions++;

  const nativeCover=fixture('rifle','mg','#');nativeCover.own.holdFire=true;nativeCover.foe.holdFire=false;
  const coverScene=nativeCover.scene(), coverEvent=eventFor(nativeCover),coverRecord=classifyManualCreation(coverEvent,coverScene);
  const coverCommand={t:'cover',ids:[nativeCover.own.id]};
  check(commandServesManualCreation(coverCommand,coverRecord,coverScene),true,'a known local cover site gives the defensive key a public purpose');
  check(command(nativeCover.g,0,coverCommand),undefined,'the real Take Cover key accepts');
  const publicAfter=nativeCover.scene();
  assert.ok(nativeCover.own.path.length,'the authoritative command produces a real cover path');assertions++;
  const coverInput={kind:'cover-key',tick:104,inputStartedTick:102,queuedTick:100,command:coverCommand,ids:coverCommand.ids};
  const coverReceipt={tick:104,command:coverCommand,accepted:true,publicScene:{...coverScene,recordedTick:104},publicAfter:{...publicAfter,observationTick:106,recordedTick:106}};
  const coverLog={physicalInputsRecorded:true,events:[coverEvent],inputs:[coverInput],commands:[{tick:coverReceipt.tick,command:coverCommand,accepted:true}],manualMeasurements:{schema:MANUAL_RESPONSE_STREAM,policy:MANUAL_RESPONSE_POLICY,startedTick:0,operationLinksRecorded:true,
    receipts:[{commandIndex:0,publicScene:coverReceipt.publicScene,publicAfter:coverReceipt.publicAfter}],creations:[coverRecord],operations:[{queuedTick:100,inputStartedTick:102,command:coverCommand,events:[coverRecord.creation],publicScene:coverScene,inputIndexes:[0]}]}};
  coverLog.manualMeasurements.publicFrames=[{id:'cover-frame',tick:106,scene:coverReceipt.publicAfter}];coverLog.manualMeasurements.receipts[0].publicAfterFrameId='cover-frame';bindNativeReceipts(coverLog);
  check(scoreManualResponses(coverLog,10,kaplanMeier).acceptedCommand.answered,1,'a visible newly issued real cover path validates the accepted defensive endpoint');
  const intervening=structuredClone(coverLog);intervening.commands.push({tick:105,command:{t:'move',orders:[[nativeCover.own.id,79,80]]},accepted:true});
  check(scoreManualResponses(intervening,10,kaplanMeier).acceptedCommand.answered,0,'a later cover path after another actor command is unrelated');
  const delayedCover=structuredClone(coverLog);delayedCover.manualMeasurements.publicFrames.unshift({id:'earlier-frame',tick:105,scene:{...coverScene,recordedTick:105,observationTick:105}});
  check(scoreManualResponses(delayedCover,10,kaplanMeier).acceptedCommand.answered,0,'defensive effect must use the first next delivered receipt');
  const noEffect=structuredClone(coverLog);delete noEffect.manualMeasurements.receipts[0].publicAfter;
  check(scoreManualResponses(noEffect,10,kaplanMeier).acceptedCommand.answered,0,'an accepted cover receipt without a public effect cannot claim protection');

  const twoCensored=structuredClone(grouped), third=classifyManualCreation({...contact,id:'third-same-frame'},startScene);
  twoCensored.events.push(third.creation);twoCensored.manualMeasurements.creations.push(third);
  twoCensored.manualMeasurements.operations[0].events=[structuredClone(record.creation)];bindNativeReceipts(twoCensored);
  check(scoreManualResponses(twoCensored,10,kaplanMeier).firstCompletedAction.survival.medianIdentifiable,false,'one response among three required events cannot pass via an answered-only median');
  check(scoreManualResponses(twoCensored,10,kaplanMeier).firstCompletedAction.censored,2,'every genuinely unanswered required event survives in censoring');
  const futureDeath=structuredClone(log);futureDeath.commands=[];futureDeath.manualMeasurements.operations=[];futureDeath.futureDeaths=[response.own.id];
  check(scoreManualResponses(futureDeath,10,kaplanMeier).firstCompletedAction.censored,1,'a later death cannot retroactively excuse a manual demand');


  // The capture adapter observes actual jobs and actual native input receipts, without injected links.
  const captured=fixture('rifle','mg');captured.own.holdFire=true;captured.foe.holdFire=false;captured.foe.x=110;
  const capturedLog={events:[],inputs:[],commands:[],physicalInputsRecorded:true},capturedMemory={human:captured.state};
  let adapter;
  const capturedHands=createHands({slot:0,seed:27,level:'hard',camera:captured.state.camera,startedTick:100,
    log:input=>{capturedLog.inputs.push(structuredClone(input));adapter.input(capturedLog.inputs.at(-1),capturedLog.inputs.length-1);}});
  capturedHands.openingUntil=0;capturedHands.openingDone=true;captured.state.hands=capturedHands;
  adapter=createManualCapture({slot:0,log:capturedLog,memory:capturedMemory,rules:{CELL,CFG,UNITS,SUPPORT,COVER,los,bindings},perceive,
    observer:{measureRaw:()=>null,onMeasurements:()=>{}}});
  const deliver=tick=>{
    captured.g.tick=tick;
    captured.state.view=perceive(viewFor(captured.g,0,captured.memory),0,captured.state,tick,adapter.perceptionMeasurements);
    for(const event of captured.state.events)if(!capturedLog.events.some(row=>row.id===event.id))capturedLog.events.push(structuredClone(event));
    adapter.afterThink(tick);return captured.state.view;
  };
  const capturedView=deliver(100);
  const capturedCmd={t:'retreat',ids:[captured.own.id]};
  assert.ok(enqueueDecision(capturedHands,capturedCmd,capturedView,{}),'natural enqueue needs no grading labels');assertions++;
  adapter.afterThink(100);
  for(let tick=100;tick<200 && !capturedLog.commands.length;tick++) {
    const v=deliver(tick);
    advanceHands(capturedHands,tick,v,cmd=>{const result=command(captured.g,0,cmd);capturedLog.commands.push({tick,command:structuredClone(cmd),accepted:result===undefined});return result;});
    adapter.afterThink(tick);
  }
  const nativeCaptureScore=scoreManualResponses(capturedLog,10,kaplanMeier);
  check(nativeCaptureScore.requiredEvents,1,'the adapter preserves its actual public required creation');
  check(nativeCaptureScore.firstCompletedAction.answered,1,'natural job/start/input receipts establish first-action attribution');
  check(nativeCaptureScore.acceptedCommand.answered,1,'natural native propagation establishes accepted-command attribution');
  check(nativeCaptureScore.audit.invalidNativeReceipt,0,'natural clocks and immutable native descriptors bind correctly');
  const actualCommandOnly=structuredClone(capturedLog);
  actualCommandOnly.inputs.forEach(input=>{input.actor='human';input.kind='command';});
  check(scoreManualResponses(actualCommandOnly,10,kaplanMeier).acceptedCommand.answered,0,'a command-only recorder cannot borrow a natural physical receipt');

  const isolation=[];
  for(const level of ['easy','normal','hard']) {
    const controls=[];
    for(const mode of ['disabled','public-policy','mutated-public-proof']) {
      randomState=813;
      const iso=fixture('rifle','mg');iso.own.holdFire=true;
      const nativeInputs=[],nativeCommands=[];
      const motor=createHands({slot:0,seed:813,level,camera:{...camera},startedTick:0,log:input=>nativeInputs.push(structuredClone(input))});
      motor.openingDone=true;motor.openingUntil=0;
      iso.state.hands=motor;
      let previousScene=null;
      const firstView=perceive(viewFor(iso.g,0,iso.memory),0,iso.state,iso.g.tick);
      const initialEvent=eventFor(iso),plannedRetreat={t:'retreat',ids:[iso.own.id]};
      assert.ok(enqueueDecision(motor,plannedRetreat,firstView,{event:initialEvent,eventTick:100,responseActorIds:plannedRetreat.ids,responseEvents:[initialEvent]}));assertions++;
      for(let i=0;i<160;i++) {
        step(iso.g);
        const publicView=perceive(viewFor(iso.g,0,iso.memory),0,iso.state,iso.g.tick);
        if(mode!=='disabled') {
          const proof=capturePublicScene(publicView,0);
          for(const cue of publicView.newEvents) {
            const result=classifyManualCreation(cue,proof,previousScene);
            if(mode==='mutated-public-proof') result.publicProof.units.length=0;
          }
          if(mode==='mutated-public-proof') proof.units.forEach(unit=>{unit.hp=0;});
          previousScene=proof;
        }
        advanceHands(motor,iso.g.tick,publicView,actual=>{
          const accepted=command(iso.g,0,actual)===undefined;
          nativeCommands.push({tick:iso.g.tick,command:structuredClone(actual),accepted});
          return accepted?undefined:'blocked';
        });
      }
      assert.ok(nativeInputs.length>0 && nativeCommands.length>0,'each isolation control has real paid physical inputs and authoritative receipts');assertions++;
      const gameGraph=serialize(iso.g);
      controls.push({level,mode,game:structuredClone(iso.g),gameGraph,gameGraphSHA256:createHash('sha256').update(gameGraph).digest('hex'),nativeInputs,nativeCommands,nextRandom:Math.random()});
    }
    assert.deepEqual(controls[1].game,controls[0].game,'the complete native game graph is unchanged by policy observation');assertions++;
    assert.deepEqual(controls[2].game,controls[0].game,'mutating detached public policy proof cannot change the native game');assertions++;
    check(controls[1].gameGraph,controls[0].gameGraph,'complete graph aliases and typed-array sharing stay identical');
    check(controls[2].gameGraph,controls[0].gameGraph,'proof mutation cannot change native graph aliases');
    assert.deepEqual(controls[1].nativeInputs,controls[0].nativeInputs,'the complete physical timeline stays identical');assertions++;
    assert.deepEqual(controls[2].nativeInputs,controls[0].nativeInputs,'proof mutation cannot change the physical timeline');assertions++;
    assert.deepEqual(controls[1].nativeCommands,controls[0].nativeCommands,'native accepted/refused commands stay identical');assertions++;
    assert.deepEqual(controls[2].nativeCommands,controls[0].nativeCommands,'mutated proof cannot change native receipts');assertions++;
    check(controls[1].nextRandom,controls[0].nextRandom,'public scoring consumes no native RNG');
    check(controls[2].nextRandom,controls[0].nextRandom,'proof mutation consumes no native RNG');
    isolation.push({level,controls:controls.map(({level,mode,nextRandom,gameGraphSHA256})=>({level,mode,nextRandom,gameGraphSHA256})),completeGameGraphEqual:true,nativeInputs:controls[0].nativeInputs,nativeCommands:controls[0].nativeCommands});
  }
  if(process.env.MANUAL_RESPONSE_EVIDENCE) writeFileSync(process.env.MANUAL_RESPONSE_EVIDENCE,JSON.stringify({policy:MANUAL_RESPONSE_POLICY,nativeLog:log,score:scored,coverLog,grenadeCommand:nativeAbility,isolation}));

  console.log(JSON.stringify({status:'PASS',policy:MANUAL_RESPONSE_POLICY,assertions,nativeInputs:inputs.length,nativeCommands:receipts.length}));
} finally { Math.random=originalRandom; }
