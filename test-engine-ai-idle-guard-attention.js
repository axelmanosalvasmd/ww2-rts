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
const scenes={"flank": {"seconds": 60, "initialOrders": [{"owner": 1, "command": {"t": "amove", "orders": [[10, 151, 139]], "together": true}}], "scene": {"units": [{"owner": 0, "type": "rifle", "x": 78, "z": 79, "holdFire": false}, {"owner": 0, "type": "rifle", "x": 82, "z": 79, "holdFire": false}, {"owner": 0, "type": "mg", "x": 151, "z": 139, "holdFire": false}, {"owner": 1, "type": "rifle", "x": 170, "z": 80, "holdFire": false}], "points": [{"x": 80, "z": 80, "owner": 0}, {"x": 151, "z": 139, "owner": 0}], "camera": {"x": 80, "z": 79, "yaw": 0}, "resources": [{"mp": 0, "fuel": 0, "mun": 200}, {"mp": 0, "fuel": 0, "mun": 200}]}}, "quietguard": {"seconds": 60, "initialOrders": [], "scene": {"units": [{"owner": 0, "type": "rifle", "x": 78, "z": 79, "holdFire": false}, {"owner": 0, "type": "rifle", "x": 82, "z": 79, "holdFire": false}, {"owner": 0, "type": "mg", "x": 151, "z": 139, "holdFire": false}], "points": [{"x": 80, "z": 80, "owner": 0}, {"x": 151, "z": 139, "owner": 0}], "camera": {"x": 80, "z": 79, "yaw": 0}, "resources": [{"mp": 0, "fuel": 0, "mun": 200}, {"mp": 0, "fuel": 0, "mun": 200}]}}, "lateflank": {"seconds": 60, "initialOrders": [{"owner": 1, "command": {"t": "amove", "orders": [[10, 151, 139]], "together": true}}], "scene": {"units": [{"owner": 0, "type": "rifle", "x": 78, "z": 79, "holdFire": false}, {"owner": 0, "type": "rifle", "x": 82, "z": 79, "holdFire": false}, {"owner": 0, "type": "mg", "x": 151, "z": 139, "holdFire": false}, {"owner": 1, "type": "rifle", "x": 191, "z": 1, "holdFire": false}], "points": [{"x": 80, "z": 80, "owner": 0}, {"x": 151, "z": 139, "owner": 0}], "camera": {"x": 80, "z": 79, "yaw": 0}, "resources": [{"mp": 0, "fuel": 0, "mun": 200}, {"mp": 0, "fuel": 0, "mun": 200}]}}, "plainidle": {"seconds": 30, "initialOrders": [], "scene": {"units": [{"owner": 0, "type": "rifle", "x": 78, "z": 79, "holdFire": false}, {"owner": 0, "type": "rifle", "x": 82, "z": 79, "holdFire": false}, {"owner": 0, "type": "mg", "x": 151, "z": 139, "holdFire": false}], "points": [], "camera": {"x": 80, "z": 79, "yaw": 0}, "resources": [{"mp": 0, "fuel": 0, "mun": 200}, {"mp": 0, "fuel": 0, "mun": 200}]}}, "guardgrenade": {"seconds": 20, "scene": {"units": [{"owner": 0, "type": "rifle", "x": 78, "z": 79, "holdFire": false}, {"owner": 1, "type": "mg", "x": 88, "z": 79, "holdFire": false}], "points": [{"x": 80, "z": 80, "owner": 0}], "camera": {"x": 80, "z": 79, "yaw": 0}, "resources": [{"mp": 0, "fuel": 0, "mun": 200}, {"mp": 0, "fuel": 0, "mun": 200}]}}};
export async function run(name,level,seed,measured=true){
 const {scene,seconds,initialOrders=[]}=scenes[name],log={events:[],inputs:[],commands:[],physicalInputsRecorded:true},authorOrders=[],publicDiagnostics=[],authorFrames=[],nativePhysics=[];let capture,alerts,lastGame;
 const engineSim={...sim,step(game){if(game.tick===0)for(const row of initialOrders){const receipt=sim.command(game,row.owner,row.command);authorOrders.push({tick:0,authoredBeforeRun:true,owner:row.owner,command:structuredClone(row.command),accepted:receipt===undefined,rejection:receipt??null});assert.equal(receipt,undefined,'initial authored native order is legal');}const result=sim.step(game);if(game.shots.length)nativePhysics.push({tick:game.tick,authoritativeProofOnly:true,nativeShotRecords:structuredClone(game.shots)});return result;}};
 const engineAI={...ai,think(game,slot,opts){lastGame=game;if(measured&&!capture){capture=createManualCapture({slot,log,memory:opts.memory,rules:{...sim,bindings},perceive:perception.perceive,observer:{measureRaw:()=>null,onMeasurements:()=>{}}});alerts=alert.createPublicAlertCapture({slot,log,memory:opts.memory,startedTick:0});}
 ai.think(game,slot,{...opts,...(measured?{perceptionMeasurements:alerts.wrapMeasurements(capture.perceptionMeasurements)}:{}),inputLog:input=>{opts.inputLog(input);log.inputs.push(structuredClone(input));if(measured){capture.input(log.inputs.at(-1),log.inputs.length-1);alerts.input(log.inputs.at(-1),log.inputs.length-1);}},submit:command=>{const p=game.players[slot],before={mp:p.mp,mun:p.mun,fuel:p.fuel},result=opts.submit(command);log.commands.push({tick:game.tick,command:structuredClone(command),accepted:result===undefined,rejection:result??null,resourcesBefore:before,resourcesAfter:{mp:p.mp,mun:p.mun,fuel:p.fuel}});return result;}});
 for(const event of opts.memory.human.events??[])if(!log.events.some(row=>row.id===event.id))log.events.push(structuredClone(event));if(measured){capture.afterThink(game.tick);alerts.afterThink(game.tick);}
 if(game.tick%10===0){const h=opts.memory.human;publicDiagnostics.push({tick:game.tick,concern:structuredClone(h.concern),operation:structuredClone(opts.memory.mind?.operation),pendingInspection:structuredClone(h.pendingInspection),noWorkUntil:h.noWorkUntil,emptyCombatVisits:structuredClone(h.emptyCombatVisits),emptyIdleGuards:structuredClone([...(h.emptyIdleGuards??new Map())]),camera:structuredClone(h.camera),selected:[...h.hands.selected],motor:structuredClone(h.hands.motor),production:structuredClone(h.production),queue:h.hands.queue.map(j=>({command:structuredClone(j.command),queuedTick:j.queuedTick,context:structuredClone(j.context)}))});authorFrames.push({tick:game.tick,authoritativeProofOnly:true,points:game.points.map(p=>({x:p.x,z:p.z,owner:p.owner,contested:p.contested})),units:[...game.units.values()].map(u=>({id:u.id,type:u.type,owner:u.owner,x:u.x,z:u.z,hp:u.hp,targetId:u.targetId,path:u.path.length,retreating:u.retreating,orders:u.orders.length,amove:structuredClone(u.amove),dig:!!u.dig,holdPos:u.holdPos,cd:u.cd})),resources:game.players.map(p=>({mp:p.mp,mun:p.mun,fuel:p.fuel}))});}
 }};
 const c=createAIcase({sim:engineSim,ai:engineAI,perception,hands,view},{scenario:name==='safehold'?'hold':'contact-threat',level,seed,seconds},scene);c.advance(1);let report;for(let left=Math.round(seconds*20)-1;left>0;left-=Math.min(left,200))report=c.advance(Math.min(left,200));
 let manualScore,alertScore;if(measured){alerts.finish(lastGame.tick);manualScore=capture.policy.scoreManualResponses(log,lastGame.tick/20,kaplanMeier);alertScore=alert.scorePublicAlerts(log);}
 return{sceneName:name,level,seed,seconds:report.completedTicks/20,report,authoritativeEnd:c.authorView(),authorOrders,publicDiagnostics,authorFrames,nativePhysics,...(measured?{log,manualScore,alertScore}:{})};
}

const reports = [];
for (const level of ['easy', 'normal', 'hard']) {
  const raw = await run('flank', level, 1);
  assert.equal(raw.report.completedTicks, 1200);
  assert.equal(raw.authorOrders.length, 1);
  assert.ok(raw.authorOrders[0].accepted);
  assert.equal(raw.alertScore.samples.length, 1, 'native late flank creates its complete public alert row');
  assert.ok(raw.alertScore.samples[0].observed, 'new native damage remains a paid camera response');
  assert.ok(raw.authoritativeEnd.units.find(unit => unit.id === 9)?.hp > 0, 'the original guard survives');
  assert.ok(raw.authorFrames.at(-1).points.every(point => point.owner === 0 && !point.contested));
  assert.ok(raw.log.commands.some(row => row.accepted && ['dig', 'entrench'].includes(row.command.t)), 'useful watched maintenance remains native accepted work');
  reports.push(raw);
}
const quiet = await run('quietguard', 'hard', 1);
const quietTrips = quiet.log.inputs.filter(input => input.concern === 'idle:9' && input.kind.startsWith('camera-'));
const visits = [];
for (const input of quietTrips) {
  if (!visits.length || input.tick - visits.at(-1).at(-1).tick > 100) visits.push([]);
  visits.at(-1).push(input);
}
assert.equal(visits.length, 2, 'the unchanged guard gets an initial inspection and a later periodic reinspection');
assert.ok(visits[1][0].tick - visits[0].at(-1).tick >= 600, 'empty idle guard visits do not immediately repeat');
assert.equal(quiet.authoritativeEnd.units.find(unit => unit.id === 9).hp, 75);
assert.ok(quiet.log.commands.some(row => row.accepted && row.command.t === 'dig' && row.resourcesBefore.mp - row.resourcesAfter.mp === 40), 'newly affordable local maintenance pays its real native cost');
assert.ok(quiet.authorFrames.some(frame => frame.units.some(unit => [7, 8].includes(unit.id) && unit.dig)), 'the accepted native construction actually starts');
reports.push(quiet);
const late = await run('lateflank', 'hard', 1);
assert.ok(late.publicDiagnostics.some(frame => frame.emptyIdleGuards.some(([id]) => id === 9)), 'a previous real empty visit precedes the later flank');
assert.equal(late.alertScore.samples.length, 1);
assert.ok(late.alertScore.samples[0].observed, 'later natural damage reopens paid attention');
assert.ok(late.log.inputs.some(input => input.kind === 'camera-alert' && input.tick > 500));
assert.ok(late.log.commands.some(row => row.accepted && row.command.t === 'ability' && row.command.ids.includes(9)));
assert.ok(late.authoritativeEnd.units.find(unit => unit.id === 9).hp > 0);
reports.push(late);
const plain = await run('plainidle', 'hard', 1);
assert.ok(plain.log.inputs.some(input => input.kind.startsWith('camera-')), 'eventless unguarded actors still receive paid inspection');
assert.ok(plain.publicDiagnostics.every(frame => frame.emptyIdleGuards.length === 0), 'ordinary idle squads are not treated as fulfilled guards');
reports.push(plain);
const grenade = await run('guardgrenade', 'hard', 1);
assert.ok(grenade.log.inputs.some(input => input.kind.startsWith('select-')), 'a useful grenade still pays for current actor selection');
assert.ok(grenade.log.commands.some(row => row.accepted && row.command.t === 'ability' && row.command.ids.includes(7) && row.command.x != null));
assert.ok(grenade.nativePhysics.some(row => row.nativeShotRecords.some(shot => shot.k === 'flight' && shot.f === 7 && shot.effect === 'boom')), 'the paid watched guard produces the actual native grenade flight');
assert.ok(grenade.authoritativeEnd.units.find(unit => unit.id === 8).hp < 75, 'native guarded combat damages the actual enemy');
reports.push(grenade);
if (process.env.AI_IDLE_GUARD_PROOF) await writeFile(process.env.AI_IDLE_GUARD_PROOF, JSON.stringify(reports));
console.log('PASS idle guard attention: periodic native inspection, flank alerts, paid construction, plain idle and guarded grenade');
