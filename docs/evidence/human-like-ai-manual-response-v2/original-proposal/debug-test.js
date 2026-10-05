import assert from 'node:assert/strict';
import { createGame, command, step, UNITS } from './shared/sim.js';
import { viewFor } from './shared/ai-view.js';
import { perceive } from './shared/ai-perception.js';
import { createHands, enqueueDecision, advanceHands } from './shared/ai-hands.js';
import { kaplanMeier } from './tools/ai-humanity.mjs';
import { MANUAL_RESPONSE_POLICY, MANUAL_RESPONSE_STREAM, capturePublicScene, classifyManualCreation,
  commandServesManualCreation, scoreManualResponses } from './tools/ai-manual-response-policy.mjs';

const originalRandom = Math.random;
let randomState = 23;
Math.random = () => { randomState = Math.imul(randomState, 1664525) + 1013904223; return (randomState >>> 0) / 4294967296; };
const camera = { x: 85, z: 80, yaw: 0, distance: 60 };
function fixture(ownType = 'rifle', enemyType = 'rifle', house = false) {
  const rows = Array(80).fill('.'.repeat(80));
  if (house) rows[40] = '.'.repeat(40) + 'B' + '.'.repeat(39);
  const g = createGame({ w: 80, h: 80, rows, spawns: [{x:10,y:40},{x:70,y:40}], points: [] },
    ['human','enemy'], false, [0,1], [0,1], { weather: false });
  g.units.clear(); g.players.forEach(player => { player.mp = 10000; player.mun = 1000; });
  assert.equal(command(g, 0, { t: 'buy', unit: ownType }), undefined);
  assert.equal(command(g, 1, { t: 'buy', unit: enemyType }), undefined);
  const own = [...g.units.values()].find(unit => unit.owner === 0), foe = [...g.units.values()].find(unit => unit.owner === 1);
  Object.assign(own, { x:80,z:80,path:[],orders:[],targetId:0,attackId:0,amove:null,auto:false,autoRetreat:false });
  Object.assign(foe, { x:100,z:80,path:[],orders:[],targetId:0,attackId:0,amove:null,holdFire:true,auto:false,autoRetreat:false });
  g.tick = 99; own.holdFire=true; step(g); own.holdFire=false;
  const memory = {}, state = { camera: { ...camera }, hands: { selected: [] } };
  const scene = () => capturePublicScene(perceive(viewFor(g,0,memory),0,state,g.tick),0);
  return { g, own, foe, memory, state, scene };
}
const eventFor = (f, kind = 'screen-contact') => ({ id: `test:${f.g.tick}:${kind}`, tick:f.g.tick, observationTick:f.g.tick,
  source:'screen',onScreen:true,kind,x:kind === 'screen-contact' ? f.foe.x : f.own.x,z:f.own.z,
  ...(kind === 'screen-contact' ? { targetId:f.foe.id } : { unitId:f.own.id }) });
let assertions = 0;
const check = (actual, expected, label) => { assert.equal(actual, expected, label); assertions++; };
try {
  // A newly seen in-range enemy is acquired by step(), without any human input.
  const f = fixture(), scene = f.scene(), event = eventFor(f);
  const covered = classifyManualCreation(event, scene);
 console.log(JSON.stringify({scene,covered,visible:[...f.g.players[0].visible]}));
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
  const queuedTick=response.g.tick;
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
    command:cmd,events:[record.creation],publicScene:startScene,inputIndexes:inputs.map((_,index)=>index)};
  const log={inputs,commands:receipts,manualMeasurements:{schema:MANUAL_RESPONSE_STREAM,policy:MANUAL_RESPONSE_POLICY,
    startedTick:0,creations:[record],operations:[operation]}};
  const scored=scoreManualResponses(log,10,kaplanMeier);
  check(scored.firstCompletedAction.answered,1,'the paid completed selection has a causal first-action endpoint');
  check(scored.acceptedCommand.answered,1,'the actual accepted retreat has a separate endpoint');
  check(scored.physicalInputCount,inputs.length,'linking does not manufacture physical inputs');
  const unlinked=structuredClone(log);unlinked.manualMeasurements.operations=[];
  check(scoreManualResponses(unlinked,10,kaplanMeier).firstCompletedAction.censored,1,'a later unlinked command cannot be inferred as a response');
  const future=structuredClone(log);future.manualMeasurements.operations[0].queuedTick=99;
  check(scoreManualResponses(future,10,kaplanMeier).firstCompletedAction.censored,1,'a new event after enqueue cannot be linked');
  const stale=structuredClone(log);stale.manualMeasurements.operations[0].queuedTick=341;
  check(scoreManualResponses(stale,20,kaplanMeier).firstCompletedAction.censored,1,'links older than240ticks at enqueue are rejected');
  const changed=structuredClone(log);changed.manualMeasurements.operations[0].events[0].targetId=999;
  check(scoreManualResponses(changed,10,kaplanMeier).firstCompletedAction.censored,1,'changed creation metadata is rejected');
  const missed=structuredClone(log);missed.commands[0].command.ids=[999];missed.inputs.at(-1).command.ids=[999];
  check(scoreManualResponses(missed,10,kaplanMeier).firstCompletedAction.answered,1,'a missed selection remains a deliberate attempt');
  check(scoreManualResponses(missed,10,kaplanMeier).acceptedCommand.answered,0,'the wrong actual command actor gets no accepted-response credit');

  const second=structuredClone(record);second.creation.id='second-same-frame';
  const grouped=structuredClone(log);grouped.manualMeasurements.creations.push(second);grouped.manualMeasurements.operations[0].events.push(second.creation);
  check(scoreManualResponses(grouped,10,kaplanMeier).acceptedCommand.answered,2,'one real retreat can protect two independently delivered stimuli');
  check(scoreManualResponses(grouped,10,kaplanMeier).physicalInputCount,inputs.length,'multi-event answers count each input once');
  const low=structuredClone(log);low.inputs=low.inputs.map(input=>({...input,tick:103,inputStartedTick:101}));
  low.manualMeasurements.operations[0].inputStartedTick=101;
  check(scoreManualResponses(low,10,kaplanMeier).firstCompletedAction.answered,0,'completion under0.2s never receives manual credit');

  const flight={source:'physical-key-start',kind:'retreat-key',command:cmd,actualSelectedIds:cmd.ids,
    queuedTick:100,inputStartedTick:110,declaredAtTick:110,completedTick:null,
    cause:{id:'earlier',kind:'screen-damage',tick:98,observationTick:98,source:'screen',onScreen:true,x:80,z:80,unitId:response.own.id},
    causeRecord:{policy:MANUAL_RESPONSE_POLICY,decision:'required',manualUnits:cmd.ids}};
  flight.causeRecord.creation=structuredClone(flight.cause);
  const laterScene=structuredClone(startScene);laterScene.recordedTick=laterScene.observationTick=112;
  const later={...contact,id:'newer',tick:112,observationTick:112};
  check(classifyManualCreation(later,laterScene,null,[flight]).coverage[0]?.reason,'paid-protection-in-flight','an already-started protective key covers a later contact');
  const queuedOnly=structuredClone(flight);queuedOnly.inputStartedTick=113;
  check(classifyManualCreation(later,laterScene,null,[queuedOnly]).decision,'required','a merely queued future input cannot cover creation');
  const selecting=structuredClone(flight);selecting.kind='select-click';
  check(classifyManualCreation(later,laterScene,null,[selecting]).decision,'required','a selection gesture is not protection');
  const unrelatedFlight=structuredClone(flight);unrelatedFlight.actualSelectedIds=[999];
  check(classifyManualCreation(later,laterScene,null,[unrelatedFlight]).decision,'required','wrong actual selection cannot provide in-flight protection');

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
  const missing={...log,manualMeasurements:{...log.manualMeasurements,creations:[unknown]}};
  check(scoreManualResponses(missing,10,kaplanMeier).evaluable,false,'missing public creation facts never become a passing population');
  check(scoreManualResponses({inputs},10,kaplanMeier).evaluable,false,'historical and human command-only logs stay unknown');
  const untouched=JSON.stringify(log);scoreManualResponses(log,10,kaplanMeier);
  check(JSON.stringify(log),untouched,'the derived policy does not rewrite native inputs or original streams');
  console.log(JSON.stringify({status:'PASS',policy:MANUAL_RESPONSE_POLICY,assertions,nativeInputs:inputs.length,nativeCommands:receipts.length}));
} finally { Math.random=originalRandom; }
