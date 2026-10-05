import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { PerspectiveCamera } from 'three';
import * as sim from './shared/sim.js';
import * as perception from './shared/ai-perception.js';
import * as hands from './shared/ai-hands.js';
import * as view from './shared/ai-view.js';
import * as ai from './shared/ai.js';
import { createAIcase } from './tools/ai-lab-runner.mjs';
import { createPublicAlertCapture, scorePublicAlerts } from './tools/ai-public-alert-response.mjs';
// Load the actual client rig with only its import specifiers adapted for Node.
let cameraSource = await readFile(new URL('./client/camera.js',import.meta.url),'utf8');
cameraSource = cameraSource.replace("from 'three'",`from '${new URL('./node_modules/three/build/three.module.js',import.meta.url)}'`)
  .replace("from '/shared/sim.js'",`from '${new URL('./shared/sim.js',import.meta.url)}'`);
const {rig} = await import(`data:text/javascript;base64,${Buffer.from(cameraSource).toString('base64')}`);
globalThis.innerWidth=1920;globalThis.innerHeight=1080;globalThis.addEventListener=()=>{};
globalThis.localStorage={getItem:key=>key==='ww2-edge'?'0':'1'};
// A native fixture author supplies a 55% hit at a predeclared physical phase. The planner never sees author state.
export const authored = { units: [{ owner: 0, type: 'rifle', x: 78, z: 79, holdFire: true, autoRetreat: false },
  { owner: 0, type: 'mg', x: 160, z: 145, holdFire: true, autoRetreat: false },
  { owner: 1, type: 'mg', x: 96, z: 79, holdFire: true }],
  points: [{ x: 80, z: 80, owner: 0 }, { x: 165, z: 150, owner: -1 }], camera: { x: 80, z: 79, yaw: 0 },
  resources: [{ mp: 20, fuel: 0, mun: 200 }, { mp: 0, fuel: 0, mun: 200 }], cues: [] };
export function nativeEmergency(engine = { sim, perception, hands, view, ai }, recorded = false) {
  let memory, cue, capture; const log = { events: [], inputs: [] };
  const actual = { ...engine, ai: { ...engine.ai, think(game,slot,opts) {
    memory = opts.memory;
    if (recorded && !capture) capture = createPublicAlertCapture({ slot: 0, log, memory });
    const inputLog = opts.inputLog;
    const result = engine.ai.think(game,slot,{ ...opts,
      ...(capture ? { perceptionMeasurements: capture.wrapMeasurements(), inputLog: input => {
        inputLog(input); log.inputs.push(structuredClone(input)); capture.input(log.inputs.at(-1),log.inputs.length-1);
      } } : {}) });
    for (const event of memory.human.events ?? []) if (!log.events.some(e=>e.id===event.id)) log.events.push(structuredClone(event));
    capture?.afterThink(game.tick); return result;
  } }, view: { ...engine.view, viewFor(game,slot,cache) {
    const state = memory?.human, active = state?.hands?.active, action = active?.actions[active.index];
    const actor = game.units.get(state?.hands?.selected[0]);
    if (!cue && actor && state.hands.selected.length === 1 && active && !active.reacting && action.mode === 'pan'
      && game.tick >= active.start + action.panPrep && game.tick < active.due
      && engine.perception.onScreen(actor,state.camera)) {
      actor.hp *= .45; game.shots.push({ k: 'hurt', t: actor.id, to: 0, fo: 1, x: actor.x, z: actor.z, kill: false });
      cue = { tick: game.tick, actorId: actor.id, actualSelection: [...state.hands.selected], camera: { ...state.camera },
        active: { start: active.start, due: active.due, prep: action.panPrep, hold: action.panHold },
        note: 'Authored hit at first actual held pan while the actual selected actor remains on screen.' };
    }
    return engine.view.viewFor(game,slot,cache);
  } } };
  const lab = createAIcase(actual, { scenario: 'guard', level: 'hard', seed: 27, seconds: 12 }, authored);
  lab.advance(240); capture?.finish(lab.tick);
  return { authored, cue, trace: lab.record(), ...(capture ? { capture: log, score: scorePublicAlerts(log) } : {}) };
}
const plain = nativeEmergency(), measured = nativeEmergency(undefined,true);
assert.ok(plain.cue, 'the actual commander has an actual selection and held camera gesture before the authored hit');
assert.deepEqual(plain.trace, measured.trace, 'native collection changes no input, public frame, event, command or RNG behavior');
const event = plain.trace.events.find(e=>e.kind==='screen-damage' && e.tick===plain.cue.tick && e.unitId===plain.cue.actorId);
assert.ok(event?.onScreen && event.source==='screen');
const release = plain.trace.inputs.filter(i=>i.panRelease?.cause.id===event.id);
assert.equal(release.length,2,'both genuinely held directions receive real keyups');
for (const input of release) {
  assert.equal(input.tick,input.inputStartedTick+input.motorTicks);
  assert.equal(input.tick,input.panRelease.releaseStartTick+input.panRelease.releaseMotorTicks);
  assert.ok(input.panRelease.releaseMotorTicks>0 && input.tick>=event.tick+4 && input.tick<input.panRelease.plannedUpTick);
  assert.notEqual(input.event?.id,event.id,'the old pan purpose is never relabeled as the emergency');
}
const retreat = plain.trace.commands.find(c=>c.accepted && c.command.t==='retreat' && c.command.ids.includes(event.unitId));
assert.ok(retreat && retreat.tick>release.at(-1).tick,'the ordinary real KeyR issues an accepted retreat after actual releases');
assert.deepEqual(retreat.selected,[event.unitId]);
const issued = plain.trace.inputs.find(i=>i.tick===retreat.tick && i.command?.t==='retreat');
assert.ok(issued && issued.motorTicks>0 && issued.input.code==='KeyR' && issued.tick>=event.tick+4);
assert.ok(!plain.trace.inputs.some(i=>i.kind.startsWith('camera') && i.tick>release.at(-1).tick && i.tick<retreat.tick),
  'the useful early release preserves screen locality without a return-camera shortcut');
assert.ok(plain.trace.frames.some(f=>f.tick>=release.at(-1).tick && f.tick<=retreat.tick && f.units.some(u=>u.id===event.unitId)));
assert.equal(measured.capture.alertMeasurements.interrupts.length,2);
assert.ok(measured.capture.alertMeasurements.interrupts.every(row=>row.actualDeliveredCause.id===event.id));
assert.deepEqual(hands.HUMAN_SKILLS.hard.reaction,[.3,.45]);
if (process.env.AI_RELEASE_PROOF) await writeFile(process.env.AI_RELEASE_PROOF,JSON.stringify({diagnosticOnly:true,plain,measured},null,2));
console.log(`Native default commander: selected victim ${event.unitId}, damage ${event.tick}, real releases ${release.map(r=>r.tick).join('/')}, accepted retreat ${retreat.tick}. Capture on/off native parity passed.`);

// Native gesture controls author only an actual HP cue, then exercise the physical API directly.
function gestureCase(control, cardinal = false) {
  const saved = Math.random; let n = 42, game;
  Math.random = () => ((n = (Math.imul(n,1664525)+1013904223)>>>0)/4294967296);
  try { game = sim.createGame({ w:96,h:96,rows:Array(96).fill('.'.repeat(96)),spawns:[{x:20,y:20},{x:85,y:85}],points:[] },['AI','enemy'],false,[0,1],[0,1],{weather:false}); } finally { Math.random=saved; }
  game.units.clear(); game.players[0].mp=1000;
  assert.equal(sim.command(game,0,{t:'buy',unit:'rifle'}),undefined);
  const actor=[...game.units.values()][0]; Object.assign(actor,{x:100,z:100,holdFire:true,autoRetreat:false});
  game.tick=1000;
  const state={camera:{x:100,z:100,yaw:0,distance:60}}, inputs=[];
  const h=hands.createHands({slot:0,seed:27,level:'hard',camera:state.camera,startedTick:1000,log:inputs});
  h.openingUntil=1000; h.openingDone=true; state.hands=h;
  const target={x:190,z:cardinal?100:160};
  hands.queueCamera(h,target,{concern:'original authored camera purpose'},'pan');
  if(control==='budget')h.inputTicks=Array(120).fill(1000);
  const cam={x:100,z:100,y:0,yaw:0,dist:60},keys=new Set(),button=()=>({setAttribute(){}}),gestures=new Map();
  rig.init({cam,keys,camera:new PerspectiveCamera(42,1920/1080,1,2200),pitch:.95,
    bounds:()=>({w:96*sim.CELL,h:96*sim.CELL}),hAt:()=>0,units:new Map(),tryStore:f=>f(),edgeButton:button(),panButton:button(),band:()=>({top:0,bottom:1080})});
  let cause, interrupted, observed;
  const cueTick=control==='preparation'?1001:control==='secondary-preparation'?1003:control==='after-release'?1040:1006;
  const frames=[];
  for(let tick=1000;tick<=1060;tick++) {
    game.tick=tick;
    if(tick===cueTick || control==='new-cause'&&tick===1010) {
      actor.hp*=.6; game.shots.push({k:'hurt',t:actor.id,to:0,fo:1,x:actor.x,z:actor.z,kill:false});
    }
    observed=perception.perceive(view.viewFor(game,0,{}),0,state,tick);game.shots=[];
    const active=h.active;
    for(const action of active?.actions??[])if(action.startedTick!==undefined&&!gestures.has(action))
      gestures.set(action,{start:action.startedTick,down:action.startedTick+action.panPrep,up:action.startedTick+action.duration});
    if(tick===cueTick || control==='new-cause'&&tick===1010) {
      const actual=observed.newEvents.find(e=>e.kind==='screen-damage'||e.source==='alert'&&e.kind==='attack');
      assert.ok(actual,'the physical control uses a real delivered public cue');
      if(tick===cueTick)cause=structuredClone(actual);
      interrupted=hands.interruptHands(h,tick,observed,{event:control==='wrong-cause'?{...actual,id:'not-delivered'}:actual});
    }
    keys.clear();
    for(const [action,gesture]of gestures) {
      if(action.earlyRelease)gesture.up=action.earlyRelease.releasedTick;
      const canceled=active?.panKeys?.find(key=>key.action===action)?.canceledAt;
      if(canceled!==undefined)gesture.canceledAt=canceled;
      if(!h.active&&tick<gesture.down)gesture.canceledAt=tick;
      if(gesture.canceledAt===undefined&&tick>gesture.down&&tick<=gesture.up)keys.add(action.input.code);
    }
    rig.update(.05);
    hands.advanceHands(h,tick,observed,()=>assert.fail('a camera key cannot issue a unit command'));
    assert.ok(Math.abs(h.camera.x-cam.x)<1e-8&&Math.abs(h.camera.z-cam.z)<1e-8,'actual client keyup motion matches every executed native frame');
    frames.push({tick,camera:{...h.camera},completed:inputs.length});sim.step(game);
  }
  const shortened=inputs.filter(i=>i.panRelease);
  if(['preparation','budget'].includes(control)) {
    assert.equal(interrupted,true);assert.equal(inputs.length,0);assert.deepEqual(h.camera,{x:100,z:100,yaw:0,distance:60});
  } else if(['wrong-cause','after-release'].includes(control)) {
    assert.equal(shortened.length,0,'wrong or late causes cannot forge an earlier shortened pan');
    assert.equal(inputs.length,cardinal?1:2);
  } else {
    assert.equal(shortened.length,control==='secondary-preparation'||cardinal?1:2);
    for(const input of shortened) {
      assert.equal(input.panRelease.cause.id,cause.id,'a later cue does not rewrite the original physical release cause');
      assert.ok(input.tick>=cause.tick+4 && input.panRelease.releaseMotorTicks>0);
      assert.equal(input.tick-input.inputStartedTick,input.motorTicks);
      assert.equal(input.panRelease.keyDownTick-input.inputStartedTick,2,'the unchanged sampled original key preparation is fully paid');
    }
    if(control==='secondary-preparation')assert.equal(h.camera.z,100,'an unpressed second key never moves the camera');
  }
  assert.ok(inputs.length<=2);assert.ok(h.inputTicks.length<=120);
  for(let i=1;i<frames.length;i++)assert.ok(Math.abs(frames[i].camera.x-frames[i-1].camera.x)<=3.3+1e-8
    && Math.abs(frames[i].camera.z-frames[i-1].camera.z)<=3.3+1e-8,'every executed hold uses actual client component speed');
  return {control,cardinal,cause,inputs,frames};
}
const physicalControls=['held','preparation','secondary-preparation','wrong-cause','after-release','new-cause','budget'].map(c=>gestureCase(c));
physicalControls.push(gestureCase('held',true));
if(process.env.AI_RELEASE_CONTROLS)await writeFile(process.env.AI_RELEASE_CONTROLS,JSON.stringify({diagnosticOnly:true,physicalControls},null,2));
console.log('Native cardinal/concurrent early-keyup, unpressed preparations, released keys, wrong/new causes and exhausted-budget controls passed.');
