import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import * as sim from './shared/sim.js';
import * as ai from './shared/ai.js';
import * as perception from './shared/ai-perception.js';
import * as hands from './shared/ai-hands.js';
import * as view from './shared/ai-view.js';
import {bindings}from'./client/keys.js';
import {createAIcase}from'./tools/ai-lab-runner.mjs';
import {createManualCapture}from'./tools/ai-manual-response-capture-v3.mjs';
import * as alert from './tools/ai-public-alert-response.mjs';
import {kaplanMeier}from'./tools/ai-humanity.mjs';
const troop=(type,x,z,owner=0,extra={})=>({owner,type,x,z,holdFire:false,...extra});
const rows=Array(96).fill('.'.repeat(96));rows[40]=rows[40].slice(0,38)+'T'+rows[40].slice(39);
const scenes={"flank": {"seconds": 40, "initialOrders": [{"owner": 1, "command": {"t": "amove", "orders": [[10, 151, 139]], "together": true}}], "scene": {"units": [{"owner": 0, "type": "rifle", "x": 78, "z": 79, "holdFire": false}, {"owner": 0, "type": "rifle", "x": 82, "z": 79, "holdFire": false}, {"owner": 0, "type": "mg", "x": 151, "z": 139, "holdFire": false}, {"owner": 1, "type": "rifle", "x": 170, "z": 80, "holdFire": false}], "points": [{"x": 80, "z": 80, "owner": 0}, {"x": 151, "z": 139, "owner": 0}], "camera": {"x": 80, "z": 79, "yaw": 0}, "resources": [{"mp": 0, "fuel": 0, "mun": 200}, {"mp": 0, "fuel": 0, "mun": 200}]}}, "quiet": {"seconds": 40, "initialOrders": [], "scene": {"units": [{"owner": 0, "type": "rifle", "x": 78, "z": 79, "holdFire": false}, {"owner": 0, "type": "rifle", "x": 82, "z": 79, "holdFire": false}, {"owner": 0, "type": "mg", "x": 151, "z": 139, "holdFire": false}], "points": [{"x": 80, "z": 80, "owner": 0}, {"x": 151, "z": 139, "owner": 0}], "camera": {"x": 80, "z": 79, "yaw": 0}, "resources": [{"mp": 0, "fuel": 0, "mun": 200}, {"mp": 0, "fuel": 0, "mun": 200}]}}};
async function run(name,level,seed,measured=true){
 const {scene,seconds,initialOrders=[]}=scenes[name],log={events:[],inputs:[],commands:[],physicalInputsRecorded:true},authorOrders=[],publicDiagnostics=[],authorFrames=[],nativePhysics=[];let capture,alerts,lastGame;
 const engineSim={...sim,step(game){if(game.tick===0)for(const row of initialOrders){const receipt=sim.command(game,row.owner,row.command);authorOrders.push({tick:0,authoredBeforeRun:true,owner:row.owner,command:structuredClone(row.command),accepted:receipt===undefined,rejection:receipt??null});assert.equal(receipt,undefined,'initial authored native order is legal');}const result=sim.step(game);if(game.shots.length)nativePhysics.push({tick:game.tick,authoritativeProofOnly:true,nativeShotRecords:structuredClone(game.shots)});return result;}};
 const engineAI={...ai,think(game,slot,opts){lastGame=game;if(measured&&!capture){capture=createManualCapture({slot,log,memory:opts.memory,rules:{...sim,bindings},perceive:perception.perceive,observer:{measureRaw:()=>null,onMeasurements:()=>{}}});alerts=alert.createPublicAlertCapture({slot,log,memory:opts.memory,startedTick:0});}
 ai.think(game,slot,{...opts,...(measured?{perceptionMeasurements:alerts.wrapMeasurements(capture.perceptionMeasurements)}:{}),inputLog:input=>{opts.inputLog(input);log.inputs.push(structuredClone(input));if(measured){capture.input(log.inputs.at(-1),log.inputs.length-1);alerts.input(log.inputs.at(-1),log.inputs.length-1);}},submit:command=>{const p=game.players[slot],before={mp:p.mp,mun:p.mun,fuel:p.fuel},result=opts.submit(command);log.commands.push({tick:game.tick,command:structuredClone(command),accepted:result===undefined,rejection:result??null,resourcesBefore:before,resourcesAfter:{mp:p.mp,mun:p.mun,fuel:p.fuel}});return result;}});
 for(const event of opts.memory.human.events??[])if(!log.events.some(row=>row.id===event.id))log.events.push(structuredClone(event));if(measured){capture.afterThink(game.tick);alerts.afterThink(game.tick);}
 if(game.tick%10===0){const h=opts.memory.human;publicDiagnostics.push({tick:game.tick,concern:structuredClone(h.concern),operation:structuredClone(opts.memory.mind?.operation),pendingInspection:structuredClone(h.pendingInspection),noWorkUntil:h.noWorkUntil,emptyCombatVisits:structuredClone(h.emptyCombatVisits),production:structuredClone(h.production),publicMP:h.view?.players[slot]?.mp??null,camera:structuredClone(h.camera),selected:[...h.hands.selected],queue:h.hands.queue.map(j=>({command:structuredClone(j.command),queuedTick:j.queuedTick,context:structuredClone(j.context)}))});authorFrames.push({tick:game.tick,authoritativeProofOnly:true,points:game.points.map(p=>({x:p.x,z:p.z,owner:p.owner,contested:p.contested})),units:[...game.units.values()].map(u=>({id:u.id,type:u.type,owner:u.owner,x:u.x,z:u.z,hp:u.hp,targetId:u.targetId,path:u.path.length,retreating:u.retreating,orders:u.orders.length,amove:structuredClone(u.amove),dig:!!u.dig,holdPos:u.holdPos,cd:u.cd})),resources:game.players.map(p=>({mp:p.mp,mun:p.mun,fuel:p.fuel}))});}
 }};
 const c=createAIcase({sim:engineSim,ai:engineAI,perception,hands,view},{scenario:name==='safehold'?'hold':'contact-threat',level,seed,seconds},scene);c.advance(1);let report;for(let left=Math.round(seconds*20)-1;left>0;left-=Math.min(left,200))report=c.advance(Math.min(left,200));
 let manualScore,alertScore;if(measured){alerts.finish(lastGame.tick);manualScore=capture.policy.scoreManualResponses(log,lastGame.tick/20,kaplanMeier);alertScore=alert.scorePublicAlerts(log);}
 return{sceneName:name,level,seed,seconds:report.completedTicks/20,report,authoritativeEnd:c.authorView(),authorOrders,publicDiagnostics,authorFrames,nativePhysics,...(measured?{log,manualScore,alertScore}:{})};
}

function componentProof(raw) {
 const window = raw.authorFrames.filter(frame => frame.tick <= 120), id=9;
 assert.equal(window.length,12);
 for(const frame of window){const unit=frame.units.find(unit=>unit.id===id);assert.ok(unit&&unit.x===151&&unit.z===139&&unit.path===0&&unit.orders===0&&unit.targetId===0&&!unit.retreating);}
 assert.ok(raw.report.frames.filter(frame=>frame.tick<=120).every(frame=>frame.units.every(unit=>unit.id!==id)), 'the actual initially idle actor is outside the attended camera');
 assert.ok(raw.log.inputs.filter(input=>input.tick<=120).every(input=>!input.ids?.includes(id)), 'the off-screen idle actor receives no paid input in the initial six seconds');
 const at=tick=>raw.authorFrames.find(frame=>frame.tick===tick), start=at(150), end=at(350);
 assert.ok(end.resources[0].mp>start.resources[0].mp+50,'actual native income floats while the flank combat occupies play');
 assert.ok(raw.publicDiagnostics.find(frame=>frame.tick===340).publicMP>=100,'the seat receives its own affordable MP total through the real HUD');
 assert.ok(raw.log.commands.filter(row=>row.tick<=350).every(row=>row.resourcesAfter.mp===row.resourcesBefore.mp),'no MP expense explains away the retained float interval');
 assert.ok(raw.nativePhysics.some(frame=>frame.tick>=330&&frame.tick<=350&&frame.nativeShotRecords.some(shot=>shot.k==='flight'&&shot.f===9)),'ordinary native guard fire continues at the affordable float interval');
 const alert=raw.alertScore.requiredPopulation;
 assert.equal(alert.length,1);assert.equal(alert[0].createdAtTick,162);assert.ok(alert[0].completedTick>162);assert.equal(alert[0].censorTick,null);
 assert.ok(raw.alertScore.samples[0].observed);
 const input=raw.log.inputs.find(input=>input.tick===alert[0].completedTick&&input.kind==='camera-alert');
 assert.ok(input&&input.event?.id==='162:1'&&input.inputStartedTick>162&&input.tick>=input.inputStartedTick+input.motorTicks);
 assert.ok(raw.nativePhysics.some(frame=>frame.tick===162&&frame.nativeShotRecords.some(shot=>shot.k==='contact'&&shot.f===10&&shot.t===9&&shot.hit===true)), 'the later public flank cue comes from a real enemy weapon contact');
 assert.ok(raw.log.commands.some(row=>row.tick>162&&row.accepted&&row.command.t==='ability'&&row.command.ids.includes(id)),'the camera response leads to a paid accepted native guard action');
 assert.ok(raw.authoritativeEnd.units.find(unit=>unit.id===id).hp>0);
 return {level:raw.level,seed:raw.seed,seconds:raw.seconds,unnoticedNativeIdleAtLeastSeconds:6,firstWatchedTick:raw.report.frames.find(frame=>frame.units.some(unit=>unit.id===id)).tick,mpFloat:{startTick:150,startNativeMP:start.resources[0].mp,endTick:350,endNativeMP:end.resources[0].mp,publicMP340:raw.publicDiagnostics.find(frame=>frame.tick===340).publicMP,ongoingNativeFire:true},alert:{created:162,inputStarted:input.inputStartedTick,completed:input.tick,seconds:alert[0].seconds,observed:true,censor:null},manual:{required:raw.manualScore.requiredEvents,monitoring:raw.manualScore.monitoringEvents,censored:raw.manualScore.firstCompletedAction.censored,unknown:raw.manualScore.unknownEvents}};
}
function quietProof(raw){assert.equal(raw.nativePhysics.length,0);assert.equal(raw.alertScore.samples.length,0);assert.equal(raw.manualScore.requiredEvents,0);assert.ok(raw.report.frames.some(frame=>frame.units.some(unit=>unit.id===9)),'ordinary eventless idle inspection still happens');return {level:raw.level,seed:raw.seed,eventlessAlerts:true,eventlessScreen:true,firstWatchedTick:raw.report.frames.find(frame=>frame.units.some(unit=>unit.id===9)).tick};}

const proofs = [];
for(const level of ['easy','normal','hard']){const raw=await run('flank',level,1);componentProof(raw);proofs.push(raw);}
const quiet=await run('quiet','hard',1);quietProof(quiet);proofs.push(quiet);
const repeat=await run('flank','hard',1);assert.deepEqual(repeat,proofs[2],'fixed native seed repeats every full raw row');proofs.push(repeat);
if(process.env.AI_SLIPS_PROOF)await writeFile(process.env.AI_SLIPS_PROOF,JSON.stringify(proofs));
console.log('PASS human slips: real off-screen idle, own MP float during native combat, delayed paid flank response, seeded repeat and quiet control');
