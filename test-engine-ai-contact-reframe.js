import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import * as sim from './shared/sim.js';
import * as ai from './shared/ai.js';
import * as hands from './shared/ai-hands.js';
import * as perception from './shared/ai-perception.js';
import * as view from './shared/ai-view.js';
// The initial scene and camera trip are authored before the native commander resumes.
// Subsequent releases, camera trips, selections and orders use its ordinary physical loop.
export function runContactReframe(control='lost-frame',engine={sim,ai,hands,perception,view}) {
const {sim,ai,hands,perception,view}=engine;const root='native authored contact scene';
const original=Math.random;try {let n=1;Math.random=()=>{let t=n+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};
const game=sim.createGame({w:96,h:96,rows:Array(96).fill('.'.repeat(96)),spawns:[{x:20,y:20},{x:85,y:85}],points:[{x:40,y:60}]},['AI','authored opponent'],false,[0,1],[0,1],{weather:false});
game.units.clear();game.players.forEach(p=>{p.mp=5000;p.fuel=5000;});
const authored=[{owner:0,type:'rifle',x:78.6,z:128.2},{owner:0,type:'rifle',x:76,z:124.5},{owner:0,type:'rifle',x:108,z:112,hp:20,autoRetreat:true},{owner:1,type:'mg',x:110,z:110,holdFire:true},{owner:1,type:'rifle',x:110,z:115,holdFire:true}];
for(const row of authored){assert.equal(sim.command(game,row.owner,{t:'buy',unit:row.type}),undefined);Object.assign([...game.units.values()].at(-1),{autoRetreat:false,auto:false},row);}
game.players.forEach(p=>{p.mp=0;p.fuel=0;p.mun=0;});game.points[0].owner=0;game.tick=1000;
const camera={x:19.616270453949713,z:113.72276082671016,yaw:-1.0201207758826454,distance:60};
const panTarget=control==='already-framed'?{x:94,z:117}:{x:129.64,z:110.56};
if(control==='moving')for(const u of [...game.units.values()].filter(u=>u.owner===0&&u.hp>20))assert.equal(sim.command(game,0,{t:'move',orders:[[u.id,150,145]]}),undefined);
const inputs=[],commands=[],frames=[],events=[],seen=new Set(),memory={human:{startedTick:0,camera,concern:{id:'authored-camera-visit',kind:'combat',x:129.64,z:110.56,urgency:56,since:1000,until:1080},deliberateUntil:1000,cameraVisit:{id:'authored-camera-visit',dwell:80}}};
memory.human.hands=hands.createHands({slot:0,seed:1,level:'normal',camera,startedTick:0,log:inputs});
memory.human.hands.openingDone=true;memory.human.hands.openingUntil=0;
assert.equal(hands.queueCamera(memory.human.hands,panTarget,{concern:'authored-camera-visit',priority:56,concernKind:'combat'},'pan'),true);
let delivered;const projection={};
for(let i=0;i<160;i++){
 if(control==='actors-lost'&&game.tick===1019)for(const u of game.units.values())if(u.owner===0&&u.hp>20)u.hp=0;
 sim.step(game);if(!delivered||game.tick%2===0)delivered=view.viewFor(game,0,projection);
 ai.think(game,0,{level:'normal',seed:1,memory,view:delivered,inputLog:input=>inputs.push(structuredClone(input)),submit:command=>{const receipt=sim.command(game,0,command);commands.push({tick:game.tick,command:structuredClone(command),accepted:receipt===undefined,rejection:receipt??null,selected:[...memory.human.hands.selected]});return receipt;}});
 const h=memory.human;for(const ev of h.events??[])if(!seen.has(ev.id)){events.push(structuredClone(ev));seen.add(ev.id);}
 frames.push({tick:game.tick,camera:structuredClone(camera),screenIds:[...h.view.screenIds],concern:structuredClone(h.concern),noWorkUntil:h.noWorkUntil,emptyCombatVisits:structuredClone([...(h.emptyCombatVisits??new Map())])});
 if(game.tick%2===0){game.shots=[];game.newCells=[];}
}

const contacts=events.filter(e=>e.kind==='screen-contact'&&e.observedDanger.idleOwnUnits.length);const releases=inputs.filter(i=>i.panRelease);const responses=commands.filter(c=>c.accepted&&['move','amove','attack'].includes(c.command.t));
const result={root,control,authored,contacts,releases,inputs,commands,frames,summary:{contacts:contacts.map(e=>({id:e.id,tick:e.tick,idle:e.observedDanger.idleOwnUnits})),release:releases.map(i=>i.tick),responses}};
return result;
} finally {Math.random=original;}
}

const positive=runContactReframe(),framed=runContactReframe('already-framed'),moving=runContactReframe('moving'),lost=runContactReframe('actors-lost');
assert.equal(positive.contacts.length,2,'both original public idle-contact creations remain recorded');
assert.ok(positive.contacts.every(event=>event.source==='screen'&&event.onScreen&&event.observedDanger.idleOwnUnits.includes(7)&&event.observedDanger.idleOwnUnits.includes(8)));
const released=positive.releases.at(-1);
assert.ok(released?.panRelease&&released.motorTicks>0&&released.panRelease.releaseMotorTicks>0,'the original held key still pays for its physical release');
assert.equal(released.tick,1032,'framing does not alter the original paid release');
const excluded=positive.frames.find(frame=>frame.tick===released.tick);
assert.ok(!excluded.screenIds.includes(7)&&!excluded.screenIds.includes(8),'the completed original trip excludes both genuinely observed idle actors');
const reframing=positive.inputs.filter(input=>input.kind.startsWith('camera-')&&input.concern.startsWith('stimulus:')&&input.tick>released.tick);
assert.equal(reframing.length,2,'the return frame pays for both actual diagonal key gestures');
assert.ok(reframing.every(input=>input.motorTicks>0&&input.inputStartedTick>=released.tick));
const response=positive.commands.find(row=>row.accepted&&row.command.t==='amove');
assert.ok(response&&response.tick>reframing.at(-1).tick,'an accepted real attack-move follows the completed return-camera input');
assert.deepEqual(response.selected,[7,8]);
const selections=positive.inputs.filter(input=>input.kind.startsWith('select-')&&input.tick<response.tick&&input.inputStartedTick>=reframing.at(-1).tick);
assert.ok(selections.length,'the response pays for actual actor selection after camera arrival');
assert.ok(selections.every(input=>input.motorTicks>0&&input.tick===input.inputStartedTick+input.motorTicks),'every completed selection pays its full actual motor interval');
assert.deepEqual(selections.at(-1).ids,[7,8],'the completed physical selection contains exactly both actual responders');
assert.ok(selections.every(input=>input.ids.every(id=>positive.frames.find(frame=>frame.tick===input.tick).screenIds.includes(id))),'every actual selection is camera-local at its completion');
for(let i=1;i<selections.length;i++)assert.ok(selections[i].inputStartedTick>=selections[i-1].tick,'sequential selections pay their full nonoverlapping intervals');
const commandFrame=positive.frames.find(frame=>frame.tick===response.tick);
assert.ok([7,8,10,11].every(id=>commandFrame.screenIds.includes(id)),'both actual actors and contacts are visible at command dispatch');
assert.ok(response.tick>=positive.contacts.at(-1).tick+4,'the causal reaction floor remains intact');
assert.equal(positive.commands.filter(row=>row.tick===response.tick).length,1,'the real dispatch retains one command per tick');
for(const control of [framed,moving,lost]) {
 assert.ok(!control.inputs.some(input=>input.kind.startsWith('camera-')&&input.concern.startsWith('stimulus:')),'neighboring scenes do not add contact reframing');
}
assert.equal(framed.contacts.length,2,'an already framed idle contact keeps its real creation population');
assert.ok(framed.commands.some(row=>row.accepted&&row.command.t==='amove'),'an already framed fight keeps its existing paid response');
assert.equal(moving.contacts.length,0,'already moving squads create no new idle-contact demand');
assert.equal(lost.contacts.length,2,'losing actors keeps both original contact creations');
assert.ok(!lost.commands.some(row=>row.accepted&&['move','amove','attack'].includes(row.command.t)),'removed actors receive no response order');
if(process.env.AI_CONTACT_REFRAME_PROOF)await writeFile(process.env.AI_CONTACT_REFRAME_PROOF,JSON.stringify({positive,framed,moving,lost}));
console.log(`PASS contact reframing: original key release ${released.tick}, paid return ${reframing.map(input=>input.tick).join('/')}, real selection and accepted attack-move ${response.tick}; already framed, moving and removed-actor controls pass.`);
