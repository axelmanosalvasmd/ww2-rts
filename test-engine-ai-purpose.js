// Native purpose, accepted physical response and actual planner regression scenes.
// The historical predicate is a fixed V21 reference, not a copy of the new implementation.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as sim from './shared/sim.js';
import { viewFor } from './shared/ai-view.js';
import { perceive } from './shared/ai-perception.js';
import { commandServesObservedEvent as newPurpose } from './shared/ai-priority.js';
import { runCommander as afterCommander } from './shared/ai-commander.js';
import { plan as afterPlan } from './shared/ai.js';
const { createGame, command, step } = sim;

// Load source controls in memory. No test copies or proof files are written at runtime.
function memoryModule(source, file, replacements = {}) {
  const url = new URL(file, import.meta.url);
  const linked = source.replace(/from (['"])(\.[^'"]+)\1/g, (_match, quote, specifier) =>
    `from ${quote}${replacements[specifier] ?? new URL(specifier, url).href}${quote}`);
  return `data:text/javascript;base64,${Buffer.from(linked).toString('base64')}`;
}

// SHA256 6b5d5a8a22968209fe03c8235648a859b36919b9eafd44cd390a8252ab6b3542.
const historicalPriority = String.raw`import { UNITS } from './sim.js';

// Capability is gameplay behavior, independent of reaction-population labels.
export function armedContactActor(unit) {
  const def = unit && UNITS[unit.type], weapon = def?.w;
  return !!unit && unit.hp > 0 && !!weapon && weapon.range > 0 && (weapon.inf > 0 || weapon.veh > 0)
    && !def.structure && !def.air && !def.medic && unit.type !== 'engineer' && !(unit.flags & (512 | 262144));
}
export function commandServesObservedEvent(cmd, event, view, slot) {
  if (!event || ['buy','build','dig','entrench','recover','assist','inspect'].includes(cmd.t)) return false;
  const near = (a,b,r) => !!a && !!b && Math.hypot(a.x-b.x,a.z-b.z) <= r;
  const movement = cmd.t === 'move' || cmd.t === 'amove';
  const ids = movement ? cmd.orders?.map(row=>row[0]) ?? [] : cmd.ids ?? [];
  const own = ids.map(id=>view.units.get(id)).filter(unit=>unit?.owner===slot && unit.hp>0 && view.screenIds.has(unit.id));
  const hostile = unit => unit && unit.hp>0 && view.screenIds.has(unit.id)
    && view.players[unit.owner]?.team !== view.players[slot].team;
  const idle = unit => armedContactActor(unit) && !unit.retreating && !unit.path.length && !unit.orders.length
    && !unit.targetId && !unit.attackId && !unit.amove && !unit.dig && !unit.build && !unit.nade
    && !unit.entrench && unit.enter<0 && unit.fireAt<0;
  let focus=event;
  if(event.kind==='screen-contact') {
    focus=view.units.get(event.targetId);if(!hostile(focus))return false;
    if(cmd.t!=='support' && !own.some(unit=>idle(unit)&&near(unit,focus,45)))return false;
  } else if(event.kind==='screen-damage') {
    focus=view.units.get(event.unitId);
    if(!focus || focus.owner!==slot || focus.hp<=0 || !view.screenIds.has(focus.id))return false;
  } else if(cmd.t!=='support' && !own.some(unit=>near(unit,focus,48))) return false;
  const victim = own.some(unit=>unit.id===event.unitId);
  if(movement) return cmd.orders.some(row=>own.some(unit=>unit.id===row[0])
    && (event.kind!=='screen-damage'||row[0]===event.unitId) && near({x:row[1],z:row[2]},focus,24));
  if(['retreat','stance','cover'].includes(cmd.t)) return event.kind==='screen-damage' ? victim : own.some(unit=>near(unit,focus,24));
  const target = view.units.get(cmd.target);
  if(cmd.t==='attack') return hostile(target) && near(target,focus,24)
    && own.some(unit=>near(unit,target,UNITS[unit.type]?.w?.range??0));
  const at = Number.isFinite(cmd.x)&&Number.isFinite(cmd.z) ? cmd : null;
  const nearbyHostile = [...view.units.values()].find(unit=>hostile(unit)&&near(unit,focus,24)&&near(unit,at,24));
  if(cmd.t==='support') {
    if(!at || !near(at,focus,24))return false;
    if(cmd.kind==='smoke')return true;
    return ['artillery','strafe','bombing','dive'].includes(cmd.kind) && !!nearbyHostile;
  }
  if(cmd.t==='ability') {
    if(own.some(unit=>UNITS[unit.type]?.ab?.id==='smoke'&&near(unit,focus,24)))return true;
    if(at) return near(at,focus,24) && own.some(unit=>{
      const ability=UNITS[unit.type]?.ab;
      return ['grenade','barrage','satchel'].includes(ability?.id)
        && !!nearbyHostile && near(unit,at,ability.range??0);
    });
    return own.some(unit=>{
      const ability=UNITS[unit.type]?.ab, current=view.units.get(unit.targetId);
      return ['suppress','ap'].includes(ability?.id)&&hostile(current)&&near(current,focus,24)
        && near(unit,current,UNITS[unit.type]?.w?.range??0);
    });
  }
  return false;
}

// Use actual observations and intended actors to order useful work within the current visit.
export function prioritizeVisit(intents, inspections, view, concern, answered, slot, tick) {
  const ids = cmd => cmd.ids ?? cmd.orders?.map(row => row[0]) ?? [];
  const near = (a, b, range) => Math.hypot(a.x - b.x, a.z - b.z) <= range;
  const point = cmd => cmd.orders?.length ? { x: cmd.orders.reduce((n, row) => n + row[1], 0) / cmd.orders.length,
    z: cmd.orders.reduce((n, row) => n + row[2], 0) / cmd.orders.length } : Number.isFinite(cmd.x) ? cmd : null;
  const movement = cmd => ['move', 'amove'].includes(cmd.t);
  const stimuli = (view.events ?? []).filter(event => ['screen-contact', 'screen-damage', 'base'].includes(event.kind)
    && !answered?.has(event.id) && event.tick <= tick && tick - event.tick <= 240);
  const relevance = cmd => {
    const relevant = stimuli.filter(event => commandServesObservedEvent(cmd, event, view, slot));
    const attended = relevant.find(event => event.id === concern?.eventId);
    if (attended) return { attended: 1, creation: attended.tick };
    if (concern?.kind === 'idle' && ids(cmd).includes(concern.unitId))
      return { attended: 1, creation: concern.since ?? tick };
    const at = point(cmd);
    if (concern?.kind === 'expansion' && movement(cmd) && at && near(at, concern, 24))
      return { attended: 1, creation: concern.since ?? tick };
    return { attended: 0, creation: Math.max(-1, ...relevant.map(event => event.tick)) };
  };
  const scores = new Map(intents.map(cmd => [cmd, relevance(cmd)]));
  intents.sort((a, b) => Number(b.t === 'retreat') - Number(a.t === 'retreat')
    || scores.get(b).attended - scores.get(a).attended || scores.get(b).creation - scores.get(a).creation);
  const useful = intents.filter(cmd => scores.get(cmd).creation >= 0);
  const readyActors = new Set(useful.flatMap(ids));
  const retainedInspections = inspections.filter(cmd => !useful.length || ids(cmd).some(id => readyActors.has(id)));
  // Pending reads use the same observed relevance when no useful action is already ready.
  const rankedInspections = useful.length ? retainedInspections : retainedInspections
    .map((cmd, index) => ({ cmd, index, score: relevance(cmd) }))
    .sort((a, b) => b.score.attended - a.score.attended || b.score.creation - a.score.creation || a.index - b.index)
    .map(candidate => candidate.cmd);
  return { intents, inspections: rankedInspections };
}
`;
// Keep the fixed accepted-purpose reference while sharing the independent inspection path.
const historicalURL = memoryModule(historicalPriority + "\nexport { inspectionServesObservedEvent } from './ai-priority.js';\n", './shared/ai-priority.js');
const { commandServesObservedEvent: oldPurpose } = await import(historicalURL);
const commanderSource = readFileSync(new URL('./shared/ai-commander.js', import.meta.url), 'utf8');
const { runCommander: beforeCommander } = await import(memoryModule(commanderSource,
  './shared/ai-commander.js', { './ai-priority.js': historicalURL }));
const plannerSource = readFileSync(new URL('./shared/ai.js', import.meta.url), 'utf8');
const friendGuards = plannerSource.split('\n').filter(line =>
  line.includes("if (opts.human && ['dive','bombing'].includes(kind) && !supportClearOfObservedFriends("));
assert.equal(friendGuards.length, 1,
  'the source control disables exactly the newly adopted human strike guard');
const { plan: beforePlan } = await import(memoryModule(plannerSource.replace(friendGuards[0], ''), './shared/ai.js'));

{
const rows=[];
function scene(type='rifle', ownType='mg', ownX=75) {
 const save=Math.random;Math.random=()=>.5;
 const g=sim.createGame({w:80,h:80,rows:Array(80).fill('.'.repeat(80)),spawns:[{x:5,y:5},{x:70,y:70}],points:[]},['AI','enemy'],false,[0,1],[0,1],{weather:false});Math.random=save;g.units.clear();
 function buy(owner,type,x,z){g.players[owner].mp=5000;g.players[owner].mun=1000;assert.equal(sim.command(g,owner,{t:'buy',unit:type}),undefined);const u=[...g.units.values()].at(-1);Object.assign(u,{x,z,auto:false,autoRetreat:false,holdFire:true});return u;}
 const own=buy(0,ownType,ownX,80),foe=buy(1,type,100,80),state={camera:{x:87,z:80,yaw:0,distance:60},hands:{selected:[own.id]}};
 for(let i=0;i<8;i++)sim.step(g);
 const view=perceive(viewFor(g,0,{}),0,state),event=view.newEvents.find(e=>e.kind==='screen-contact'&&e.targetId===foe.id);
 assert.ok(event&&view.screenIds.has(own.id)&&view.screenIds.has(foe.id),'native delivered scene generates actual contact');
 return {g,own,foe,state,view,event,buy};
}
function proof(label,f,cmd,expected,{native=true}={}){
 if(cmd.t==='ability')cmd.ids=[f.own.id];
 const before=oldPurpose(cmd,f.event,f.view,0),after=newPurpose(cmd,f.event,f.view,0);
 const result=native?sim.command(f.g,0,cmd):'public scene predicate control';
 rows.push({label,event:structuredClone(f.event),own:pick(f.view.units.get(f.own.id)),foe:pick(f.view.units.get(f.foe.id)),cmd,before,after,result:result??'accepted'});
 if(after!==expected)console.error(JSON.stringify(rows.at(-1)));
 assert.equal(after,expected,label);
 return result;
}
function pick(u){return Object.fromEntries(['id','type','owner','x','z','hp','hpSource','targetId','attackId','cd','cdKnown','flags','firstStillAt','holdFire','retreating'].map(k=>[k,u[k]]));}
for(const [label,cmd,expected]of[
 ['valid dive',{t:'support',kind:'dive',x:100,z:80,dir:0},true],
 ['dive misses by10m',{t:'support',kind:'dive',x:110,z:80,dir:0},false],
 ['artillery side miss8m',{t:'support',kind:'artillery',x:100,z:88,dir:0},false],
 ['valid strafe infantry',{t:'support',kind:'strafe',x:100,z:80,dir:Math.PI/2},true],
])assert.equal(proof(label,scene(),cmd,expected),undefined);
assert.equal(proof('strafe ineffective native armor',scene('tank'),{t:'support',kind:'strafe',x:100,z:80,dir:0},false),undefined);
{
 const f=scene('tank'); const friend=f.buy(0,'rifle',100,80);f.view=perceive(viewFor(f.g,0,{}),0,f.state);
 const hp=friend.hp;assert.equal(proof('dive contains current friendly',f,{t:'support',kind:'dive',x:100,z:80,dir:0},false),undefined);
 for(let i=0;i<sim.SUPPORT.dive.delay*20+3;i++)sim.step(f.g);
 rows.push({label:'actual native friendly damage',beforeHP:hp,afterHP:friend.hp});assert.equal(hp,100);assert.ok(Math.abs(friend.hp-32.8)<1e-9,'native dive inflicts the demonstrated friendly damage');
}
function abilityScene(ownType='mg',enemyType='rifle'){
 const f=scene(enemyType,ownType,80);
 for(let i=0;i<100;i++)sim.step(f.g);
 f.own.holdFire=false;assert.equal(sim.command(f.g,0,{t:'attack',ids:[f.own.id],target:f.foe.id}),undefined);sim.step(f.g);
 f.view=perceive(viewFor(f.g,0,{}),0,f.state);f.own.hp*=.6;sim.step(f.g);
 f.view=perceive(viewFor(f.g,0,{}),0,f.state);f.event=f.view.newEvents.find(e=>e.kind==='screen-damage'&&e.unitId===f.own.id);
 assert.ok(f.event,'genuine delivered damaged actor cue');assert.equal(f.view.units.get(f.own.id).hpSource,'selected-hud');assert.equal(f.view.units.get(f.own.id).targetId,f.foe.id);
 return f;
}
assert.equal(proof('ready selected HUD MG native suppress',abilityScene(),{t:'ability',ids:[1]},true),undefined);
for(const [label,alter]of[
 ['MG selected HUD absent',u=>{u.hpSource='world-bar';}],
 ['MG cooldown unknown',u=>{u.cdKnown=false;u.cd=Infinity;}],
 ['MG cooldown active',u=>{u.cd=5;}],
 ['MG moving',u=>{u.path=[{x:82,z:80}];}],
 ['MG setting up',u=>{u.firstStillAt=5.1;}],
 ['MG retreating',u=>{u.retreating=true;}],
 ['MG holding fire without attack',u=>{u.holdFire=true;u.attackId=0;}],
]){const f=abilityScene();alter(f.view.units.get(f.own.id));proof(label,f,{t:'ability',ids:[f.own.id]},false,{native:false});}
{const f=abilityScene();f.view.units.get(f.foe.id).retreating=true;proof('MG foe already retreating',f,{t:'ability',ids:[f.own.id]},false,{native:false});}
{const f=scene();f.state.camera.x=5;f.view=perceive(viewFor(f.g,0,{}),0,f.state);proof('offcamera hostile cannot justify strike',f,{t:'support',kind:'dive',x:100,z:80,dir:0},false,{native:false});}
assert.equal(proof('MG suppress native armor ineffective',abilityScene('mg','tank'),{t:'ability',ids:[1]},false),undefined);
assert.equal(proof('ready AP native armor',abilityScene('at','tank'),{t:'ability',ids:[1]},true),undefined);
assert.equal(proof('AP against native infantry ineffective',abilityScene('at','rifle'),{t:'ability',ids:[1]},false),undefined);
{const f=scene(),cmd={t:'support',kind:'dive',x:100,z:80,dir:0},baseline=newPurpose(cmd,f.event,f.view,0);f.event.responseRequired=false;f.event.responseUnits=[];f.event.privatePopulation=987;assert.equal(newPurpose(cmd,f.event,f.view,0),baseline,'private measurement fields do not drive behavior');}
assert.equal(rows.length, 20);
}

{
function scene(run,mode){
 const save=Math.random;Math.random=()=>.5;
 const g=createGame({w:80,h:80,rows:Array(80).fill('.'.repeat(80)),spawns:[{x:20,y:40},{x:75,y:40}],points:[]},['AI','enemy'],false,[0,1],[0,1],{weather:false});Math.random=save;g.units.clear();
 const buy=(owner,type,x,z)=>{g.players[owner].mp=5000;g.players[owner].mun=1000;assert.equal(command(g,owner,{t:'buy',unit:type}),undefined);const u=[...g.units.values()].at(-1);Object.assign(u,{x,z,holdFire:true,auto:false,autoRetreat:false});return u;};
 const own=buy(0,'rifle',80,80),foe=buy(1,'rifle',100,80),memory={human:{startedTick:0,camera:{x:87,z:80,yaw:0,distance:60}}},inputs=[],receipts=[];
 let observation,proposed=false,damage;
 for(let tick=0;tick<500;tick++){
  if(g.tick===100)own.hp*=.6;
  if(!observation||g.tick%2===0)observation=viewFor(g,0,{});
  run(observation,0,{tick:g.tick,level:'normal',seed:27,inputLog:i=>inputs.push(structuredClone(i))},memory,cmd=>{
   if(mode==='refuse')g.players[0].mp=0;
   const result=command(g,0,cmd);receipts.push({tick:g.tick,cmd:structuredClone(cmd),result:result??'accepted'});return result;
  },(_v,_s,_o,_m,send)=>{
   if(g.tick<100||proposed)return;
   send({t:'support',kind:'dive',x:100,z:mode==='miss'?90:80,dir:0});
  });
  damage??=memory.human.events.find(e=>e.kind==='screen-damage'&&e.unitId===own.id&&e.tick===100);
  if(receipts.length)break;step(g);
 }
 assert.ok(damage&&receipts.length===1,'actual delivered damage and one real physical issuing input');
 const issued=inputs.find(i=>i.command?.t==='support');assert.ok(issued);if(mode!=='miss'||run===beforeCommander)assert.ok(issued.responseEvents.some(e=>e.id===damage.id),mode);
 assert.ok(issued.tick-damage.tick>=4);const answered=memory.human.answeredEvents?.has(damage.id)??false;
 return {mode,event:structuredClone(damage),receipt:receipts[0],issued,answered};
}
const rows=[];
for(const mode of ['valid','miss','refuse']){
 const before=scene(beforeCommander,mode),after=scene(afterCommander,mode);
 assert.deepEqual(after.receipt,before.receipt,'same ordinary command and native receipt before/after');
 if(mode!=='miss')assert.deepEqual(after.issued,before.issued,'same physical inputs and original response descriptors');
 else assert.ok(!after.issued.responseEvents?.some(e=>e.id===after.event.id),'unhelpful decision does not acquire a causal response link');
 assert.equal(after.answered,mode==='valid');
 if(mode==='miss')assert.equal(before.answered,true,'baseline acknowledges the accepted footprint miss');
 if(mode==='refuse')assert.equal(before.answered,false,'baseline already prevents refused-command acknowledgement');
 rows.push({mode,before,after});
}
assert.equal(rows.length, 3);
}

{
function scene(run,friendNear,level,human=true){
 const save=Math.random;Math.random=()=>.5;
 const g=createGame({w:80,h:80,rows:Array(80).fill('.'.repeat(80)),spawns:[{x:5,y:5},{x:70,y:70}],points:[]},['AI','enemy'],false,[0,1],[0,1],{weather:false});Math.random=save;g.units.clear();
 const buy=(owner,type,x,z)=>{g.players[owner].mp=5000;assert.equal(command(g,owner,{t:'buy',unit:type}),undefined);const u=[...g.units.values()].at(-1);Object.assign(u,{x,z,holdFire:true,auto:false,autoRetreat:false});return u;};
 buy(0,'mg',75,80);const foe=buy(1,'tank',100,80);buy(0,'rifle',friendNear?100:75,friendNear?80:95);
 for(let i=0;i<8;i++)step(g);
 const state={camera:{x:87,z:80,yaw:0,distance:60},hands:{selected:[]},persona:{pressure:1,opening:['rifle','mg','rifle'],economy:'barracks'},startedTick:0,buys:0};
 const view=perceive(viewFor(g,0,{}),0,state),mem={human:state,seen:new Map(),node:new Map()},commands=[];
 assert.ok(view.screenIds.has(foe.id));
 run(view,0,{human,level,seed:27,decisionOnly:!human,concern:{id:'combat-fixture',kind:'combat',x:100,z:80}},mem,cmd=>{commands.push(structuredClone(cmd));return undefined;});
 return {friendNear,level,human,commands,support:commands.filter(cmd=>cmd.t==='support')};
}
const rows=[];
for(const level of ['easy','normal','hard'])for(const friendNear of [false,true]){
 const before=scene(beforePlan,friendNear,level),after=scene(afterPlan,friendNear,level);
 assert.ok(before.support.some(cmd=>cmd.kind==='dive'),'baseline planner proposes dive against actual watched tank');
 if(friendNear)assert.ok(!after.support.some(cmd=>['dive','bombing'].includes(cmd.kind)),'human plan never proposes observed friendly blast/stick hazard');
 else assert.deepEqual(after.commands,before.commands,'safe scene retains complete ordinary plan');
 rows.push({level,friendNear,before,after});
}
const legacyBefore=scene(beforePlan,true,'hard',false),legacyAfter=scene(afterPlan,true,'hard',false);
assert.deepEqual(legacyAfter.commands,legacyBefore.commands,'legacy decision layer is unchanged');rows.push({legacyBefore,legacyAfter});
assert.equal(rows.length, 7);
}

console.log('AI purpose: 20 public/native rows, 3 physical response scenes and 7 planner scenes PASS.');
