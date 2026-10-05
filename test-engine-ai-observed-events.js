// Observed events respect the 5% human model. Diagnostic populations stay outside planning.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createGame,command,UNITS} from './shared/sim.js';
import {viewFor} from './shared/ai-view.js';
import {createHands,enqueueDecision,advanceHands} from './shared/ai-hands.js';
import {plan} from './shared/ai.js';
import {chooseConcern} from './shared/ai-attention.js';
import {postureOf} from './client/unit-models.js';
import {GUN_SLOTS} from './client/models/guns.js';
import {perceive} from './shared/ai-perception.js';
import {perceive as original} from './tools/ai-screen-v1-oracle.js';
const map={w:80,h:80,rows:Array(80).fill('.'.repeat(80)),spawns:[{x:20,y:20},{x:60,y:60}],points:[]};
const main=readFileSync('./client/main.js','utf8');
const start=main.indexOf('    const frac = Math.max(0, hp / (def.models * def.hpPer));');
const stop=main.indexOf('\n  }\n  autocast.adopt',start);assert.ok(start>0&&stop>start);
const renderer=new Function('hp','supp','def','v','owner','look',main.slice(start,stop));
const alive=main.match(/const def = UNITS\[type\], alive = (.*);/)[1];
const count=new Function('hp','v','def',`return ${alive}`);
function render(hp,supp=0){
 const mesh=()=>({scale:{},position:{},material:{color:{set(v){this.value=v;}}}});
 const v={hpBar:mesh(),suppBar:mesh(),models:GUN_SLOTS.mg};
 renderer(hp,supp,UNITS.mg,v,0,()=>({color:0xabcdef}));
 return{hpScale:v.hpBar.scale.x,suppScale:v.suppBar.scale.x,hpColor:v.hpColor,suppColor:v.suppColor,suppVisible:v.suppBar.visible,crew:count(hp,v,UNITS.mg),posture:postureOf(supp,0,0)};
}
function setup(hp=50,count=1){
 const old=Math.random;Math.random=()=>.5;let game;try{game=createGame(map,['AI','enemy'],false,[0,1],[0,1],{weather:false});}finally{Math.random=old;}
 game.units.clear();game.players[0].mp=5000;for(let i=0;i<count;i++)command(game,0,{t:'buy',unit:'mg'});game.players[0].mp=0;
 const own=[...game.units.values()];own.forEach((u,i)=>Object.assign(u,{x:210+i*8,z:210,hp,auto:false,autoRetreat:false,targetId:0}));game.tick=400;
 return{game,own,state:{camera:{x:210,z:210,yaw:0,distance:60},hands:{selected:[]}},rawState:{camera:{x:210,z:210,yaw:0,distance:60},hands:{selected:[]}}};
}
function capture(f,hps,tick=400,supps=[]){
 f.own.forEach((u,i)=>{u.hp=Array.isArray(hps)?hps[i]:hps;u.supp=supps[i]??u.supp;});f.game.tick=tick;
 const observation=viewFor(f.game,0,{});f.rawState.camera={...f.state.camera};f.rawState.hands.selected=[...f.state.hands.selected];
 const raw=original(observation,0,f.rawState,tick),view=perceive(observation,0,f.state,tick,{onMeasurements:payload=>{f.measurements=payload;},measureRaw:original});
 assert.deepEqual(f.measurements.original.events,f.rawState.events,'private raw event history equals frozen V13, including IDs, clocks, episodes and actors');
 return{view,raw,observation};
}
function graph(value){
 const seen=new Map();function enc(v){
  if(typeof v==='function')return '[function]';if(typeof v==='number'&&!Number.isFinite(v))return String(v);
  if(v===undefined)return '[undefined]';if(v===null||typeof v!=='object')return v;
  if(seen.has(v))return{ref:seen.get(v)};const id=seen.size;seen.set(v,id);
  if(v instanceof Map)return{id,map:[...v].map(([k,x])=>[enc(k),enc(x)])};if(v instanceof Set)return{id,set:[...v].map(enc)};
  return{id,props:Reflect.ownKeys(v).map(k=>[String(k),enc(v[k])])};
 }return JSON.stringify(enc(value));
}
function decisions(view,state){
 const out=[],mem={human:{...state,persona:{pressure:1,opening:[]},mood:0}};
 plan(view,0,{level:'normal',human:true,seed:27,concern:{kind:'combat',x:210,z:210}},mem,c=>{out.push(structuredClone(c));return undefined;});
 return{out,mem};
}
const results=[];
function negative(name,initial,a,b,prepare,supps){
 const fa=setup(initial),fb=setup(initial);capture(fa,initial);capture(fb,initial);if(prepare){prepare(fa);prepare(fb);}
 const av=capture(fa,a,404,supps?.[0]),bv=capture(fb,b,404,supps?.[1]);
 assert.equal(graph({view:av.view,state:fa.state}),graph({view:bv.view,state:fb.state}),name+' byte-identical public graphs');
 const caState={},cbState={};const ca=chooseConcern(av.view,0,caState,'normal',()=>.5),cb=chooseConcern(bv.view,0,cbState,'normal',()=>.5);
 assert.equal(graph({concern:ca,state:caState}),graph({concern:cb,state:cbState}),name+' same attention');
 assert.equal(graph(decisions(av.view,fa.state)),graph(decisions(bv.view,fb.state)),name+' same actual planner actions and memory');
 results.push({name,runtimeEvents:av.view.newEvents,privateOriginalEvents:[av.raw.newEvents,bv.raw.newEvents],samePublicGraph:true,sameAttention:true,samePlan:true});
 return{fa,fb,av,bv};
}
const one=negative('50→50/49, equal 5% estimates and actual renderer categories',50,50,49);
assert.equal(one.av.view.newEvents.length,0);assert.equal(one.bv.raw.newEvents[0].amount,1);
assert.deepEqual(one.fb.measurements.links.flatMap(link=>link.originalIds),[],'unperceived raw event receives no runtime link');
negative('75→57/56, hidden raw heavy classification',75,57,56);
negative('40→30→27/26, hidden raw retreat-risk crossing',40,27,26,f=>capture(f,30,402));
negative('suppression43/44 equal estimate45 and posture/color',50,50,50,null,[[43],[44]]);
for(const [a,b]of [[50,49],[57,56],[27,26]]){
 const va=render(a),vb=render(b);assert.notEqual(va.hpScale,vb.hpScale,'real renderer continuous bars are NOT pixel-identical');
 assert.deepEqual({...va,hpScale:null},{...vb,hpScale:null},'real source renderer color/crew/posture equal');
}
assert.notEqual(render(50,43).suppScale,render(50,44).suppScale,'real suppression bars continuously differ');
assert.equal(render(50,43).posture,render(50,44).posture);
{
 const f=setup(50);capture(f,50);const a=capture(f,45,402);
 assert.ok(a.view.newEvents.some(e=>e.kind==='screen-damage'),'5% health estimate change produces runtime damage stimulus');
 const event=a.view.newEvents.find(e=>e.kind==='screen-damage');assert.equal(event.amount,3.75);assert.equal(f.measurements.observed.events.find(e=>e.id===event.id).responsePolicy,'screen-observed-v1');assert.equal(Object.hasOwn(event,'responsePolicy'),false);
 assert.deepEqual(f.measurements.links.find(link=>link.runtimeId===event.id).originalIds,[a.raw.newEvents[0].id]);
 results.push({name:'positive5% world-bar estimate',runtime:event,privateOriginal:a.raw.newEvents[0]});
}
{
 const f=setup(30);f.state.hands.selected=[f.own[0].id];capture(f,30);const a=capture(f,27,402),b=capture(f,26,404);
 assert.equal(a.view.units.get(f.own[0].id).hp,27);assert.equal(b.view.units.get(f.own[0].id).hp,26);
 assert.equal(f.measurements.observed.events.find(e=>e.id===a.view.newEvents.at(-1).id).responseRequired,false);assert.equal(f.measurements.observed.events.find(e=>e.id===b.view.newEvents.at(-1).id).responseRequired,true);
 assert.ok(!decisions(a.view,f.state).out.some(c=>c.t==='retreat'));
 assert.ok(decisions(b.view,f.state).out.some(c=>c.t==='retreat'),'actual selected HP text crossing changes real retreat action');
 results.push({name:'positive actual selected singleton HP text',events:[a.view.newEvents,b.view.newEvents],actions:[decisions(a.view,f.state).out,decisions(b.view,f.state).out]});
}
{
 const a=setup(50,2),b=setup(50,2);a.state.hands.selected=a.own.map(u=>u.id);b.state.hands.selected=b.own.map(u=>u.id);
 capture(a,[50,50]);capture(b,[50,50]);const av=capture(a,[50,49],402),bv=capture(b,[49,50],402);
 assert.equal(graph({view:av.view,state:a.state}),graph({view:bv.view,state:b.state}),'group aggregate99 cannot identify member damaged by1HP');
 assert.equal(av.view.selectedHUD.types[0].hp,99);assert.notEqual(av.raw.newEvents[0].unitId,bv.raw.newEvents[0].unitId);
 assert.equal(av.view.newEvents.length,0);assert.deepEqual(a.measurements.links.flatMap(link=>link.originalIds),[]);
 results.push({name:'same group HP aggregate99, member identity masked',samePublicGraph:true,rawActors:[av.raw.newEvents[0].unitId,bv.raw.newEvents[0].unitId]});
}
{
 const f=setup(49);capture(f,49);f.state.hands.selected=[f.own[0].id];const a=capture(f,49,402);
 assert.equal(a.view.newEvents.length,0,'switching from 5% estimate to actual HUD does not fabricate damage');
 f.state.camera={x:80,z:80,yaw:0,distance:60};const b=capture(f,49,404,[51]);
 assert.equal(b.view.screenIds.has(f.own[0].id),false);assert.equal(b.view.units.get(f.own[0].id).supp,50);
 assert.equal(b.view.units.get(f.own[0].id).suppSource,'selected-hud-tag');assert.equal(b.view.selectedHUD.types[0].suppressionTags.suppressed,true);
 assert.equal(b.view.newEvents.length,0,'off-camera selected tags do not fabricate a screen damage event');
}
{
 const f=setup(50);capture(f,50);const a=capture(f,38,402),b=capture(f,37,404);
 assert.equal(a.view.units.get(f.own[0].id).hp,b.view.units.get(f.own[0].id).hp,'same 50% world estimate');
 assert.notEqual(a.view.units.get(f.own[0].id).healthBand,b.view.units.get(f.own[0].id).healthBand,'actual renderer HP color boundary remains visible');
 assert.notEqual(render(38).hpColor,render(37).hpColor);
 f.own[0].hp=45;const c=capture(f,45,406,[89]),d=capture(f,45,408,[90]);
 assert.equal(c.view.units.get(f.own[0].id).suppressionBand,'suppressed');assert.equal(d.view.units.get(f.own[0].id).suppressionBand,'pinned');
 assert.notEqual(render(45,89).posture,render(45,90).posture);assert.notEqual(render(45,89).suppColor,render(45,90).suppColor);
}
{
 const f=setup(75);capture(f,75);const a=capture(f,56,402);const sensitiveRawAmount=19;
 const runtimeGraph=graph({view:a.view,memory:{human:f.state}});assert.ok(!runtimeGraph.includes('"amount",19'),'raw19HP diagnostic amount never enters planning');
 for(const key of ['responseRequired','responseReason','responsePolicy','responseUnits'])assert.ok(!runtimeGraph.includes(key),'no measurement flags in public planning graph');assert.ok(!runtimeGraph.includes('measurementStates'));assert.ok(!runtimeGraph.includes('previousSnapshot'));assert.ok(!runtimeGraph.includes('previousScreen'));
 const diagnostic=f.measurements.original.events;assert.equal(diagnostic[0].amount,sensitiveRawAmount);diagnostic[0].amount=999;
 capture(f,56,404);assert.equal(f.measurements.original.events[0].amount,19,'diagnostic callback graphs are detached');
 const rawId=f.measurements.original.events[0].id;assert.ok(!runtimeGraph.includes('"'+rawId+'"'),'raw event IDs are private');
}
{
 const f=setup(50);delete f.state.camera;const a=capture(f,50);assert.ok(Number.isFinite(f.state.camera.x));
 assert.deepEqual(f.measurements.original.events,f.rawState.events,'default pose establishes independent raw measurement correctly');
}
function physical(view,commands) {
 const log=[],sent=[],hands=createHands({slot:0,seed:27,level:'normal',camera:{...view.camera},log});
 hands.openingDone=true;hands.openingUntil=0;
 for(const command of commands)enqueueDecision(hands,command,view,{concern:'combat',eventTick:view.tick});
 for(let tick=view.tick;tick<view.tick+400;tick++)advanceHands(hands,tick,view,command=>{sent.push(structuredClone(command));return undefined;});
 return{log,sent};
}
{
 const on=setup(50),off=setup(50),timeline=[];
 for(const [hp,tick,supp]of [[50,400,43],[49,402,44],[45,404,50],[25,406,91]]) {
  const a=capture(on,hp,tick,[supp]);off.own[0].hp=hp;off.own[0].supp=supp;off.game.tick=tick;
  const b=perceive(viewFor(off.game,0,{}),0,off.state,tick);
  assert.equal(graph({view:a.view,state:on.state}),graph({view:b,state:off.state}),'diagnostic callback enabled/disabled leaves full public graph and event IDs/clocks exact');
  assert.equal(graph(chooseConcern(a.view,0,{},'normal',()=>.5)),graph(chooseConcern(b,0,{},'normal',()=>.5)));
  const ad=decisions(a.view,on.state),bd=decisions(b,off.state);assert.equal(graph(ad),graph(bd));
  const ap=physical(a.view,ad.out),bp=physical(b,bd.out);assert.equal(graph(ap),graph(bp),'actual physical input log and sent commands identical diagnostic on/off');
  timeline.push({hp,tick,commands:ad.out,inputs:ap.log});
 }
 assert.ok(timeline.some(frame=>frame.inputs.length),'physical input equivalence has a nonempty positive fixture');
 results.push({name:'optional diagnostic callback exact runtime independence',timeline});
}
{
 const f=setup(50);capture(f,50);capture(f,49,402);const visible=capture(f,45,404);
 const event=visible.view.newEvents.find(event=>event.kind==='screen-damage');assert.ok(event);
 assert.equal(visible.raw.newEvents.length,0,'oracle damage episode already began on the earlier raw1HP delta');
 assert.deepEqual(f.measurements.links.find(link=>link.runtimeId===event.id).originalIds,[],
   'a later perceived stimulus cannot retroactively answer the unperceived original episode');
}
{
 const f=setup(50),frames=[];let calls=0;
 const oracle=()=>{calls++;throw new Error('diagnostic oracle must be opt-in');};
 const observation=viewFor(f.game,0,{});
 const noLog=perceive(observation,0,f.state,400,{measureRaw:oracle});assert.equal(calls,0);
 const logged=perceive(observation,0,f.state,400,{onMeasurements:payload=>frames.push(payload)});
 assert.equal(frames[0].original,null);assert.deepEqual(frames[0].links,[]);
 assert.equal(frames[0].tick,400);assert.equal(frames[0].observationTick,400);
 assert.equal(graph(noLog),graph(logged),'observed-only callback cannot fabricate raw baseline or alter view');
}
{
 const f=setup(75,2);f.own[1].x=310;f.state.camera={x:80,z:80,yaw:0,distance:60};
 capture(f,[75,75]);const alerts=capture(f,[74,74],402);
 assert.equal(alerts.view.newEvents.length,2,'two off-camera damage groups produce actual human alerts');
 for(const event of alerts.view.newEvents){
  assert.equal(event.source,'alert');const links=f.measurements.links.find(link=>link.runtimeId===event.id);
  assert.deepEqual(links.originalIds,[event.id],'actorless alert requires exact ID and geometry, never unrelated same-frame cluster');
 }
}
console.log('PASS: fair public graphs, attention, real plan, actual renderer controls, selected/group HUD, private original population and links');
