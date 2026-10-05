import assert from 'node:assert/strict';
import { createGame, command, step, UNITS } from './shared/sim.js';
import { viewFor } from './shared/ai-view.js';
import { perceive } from './shared/ai-perception.js';
import { plan, think } from './shared/ai.js';
const summaries = [];
function fixture(terrain='.') {
 const rows=Array(80).fill('.'.repeat(80));if(terrain==='T')for(let y=37;y<=41;y++)rows[y]='.'.repeat(20)+'T'.repeat(5)+'.'.repeat(55);
 const game=createGame({w:80,h:80,rows,spawns:[{x:5,y:5},{x:75,y:75}],points:[]},['AI','enemy'],false,[0,1],[0,1],{weather:false});
 game.units.clear();
 for(const slot of [0,1]) {game.players[slot].mp=5000;assert.equal(command(game,slot,{t:'buy',unit:'rifle'}),undefined);}
 const unit=[...game.units.values()].find(u=>u.owner===0),enemy=[...game.units.values()].find(u=>u.owner===1);
 Object.assign(unit,{x:45,z:79,auto:false,holdFire:true,autoRetreat:false});
 Object.assign(enemy,{x:130,z:130,auto:false,holdFire:true});
 game.players.forEach(p=>Object.assign(p,{mp:0,mun:0,fuel:0}));
 const memory={seen:new Map(),node:new Map(),human:{camera:{x:55,z:75,yaw:0,distance:60},persona:{pressure:1,opening:[]}}},projection={};
 const look=()=>perceive(viewFor(game,0,projection),0,memory.human,game.tick);
 const decide=(view,concern,level='easy')=>{const out=[];plan(view,0,{human:true,level,concern},memory,cmd=>{out.push(structuredClone(cmd));return undefined;});return out;};
 return {game,unit,enemy,memory,projection,look,decide};
}
for(const level of ['easy','normal','hard'])for(const variant of ['suppressed-march','labels','no-event','chip','normal-suppression','missing-suppression','missing-health','missing-loss','suppression-ended','healthy-again','reacquired','off-camera','wrong-attended','production','stale','held','trench','garrison','combat','attack','grenade','dig','building','entrench','queued','entering','area-fire','retreating','automatic','homeward','counter-role','visible-threat','remembered-home-threat','already-at-home','suppression-reduced']) {
 const f=fixture(variant==='trench'?'T':'.'),u=f.unit;
 if(variant==='already-at-home'){Object.assign(u,{x:f.game.players[0].spawn.x,z:f.game.players[0].spawn.z});f.memory.human.camera.x=u.x;f.memory.human.camera.z=u.z;}
 step(f.game);f.game.tick=300;
 assert.equal(command(f.game,0,{t:'amove',orders:[[u.id,60,63]]}),undefined);
 f.look();f.game.tick+=8;u.hp=variant==='chip'?95:70;u.supp=variant==='normal-suppression'?0:55;
 if(variant==='visible-threat'){Object.assign(f.enemy,{x:65,z:79});step(f.game);}
 if(variant==='reacquired'){f.memory.human.camera.x=135;f.look();f.game.tick++;f.memory.human.camera.x=55;}
 const view=f.look(),row=view.units.get(u.id),event=view.events.find(e=>e.kind==='screen-damage'&&e.unitId===u.id);
 if(variant==='suppressed-march')assert.ok(event?.observedDanger.lossShare>=.25&&event.observedDanger.suppressionBand!=='normal');
 let concern={kind:'combat',event:'screen-damage',eventId:event?.id,unitId:u.id,x:u.x,z:u.z};
 if(variant==='no-event')view.events=[];
 if(variant==='healthy-again')row.hp=100;
 if(variant==='missing-suppression'&&event)delete event.observedDanger.suppressionBand;
 if(variant==='missing-health'&&event)delete event.observedDanger.healthShare;
 if(variant==='missing-loss'&&event)delete event.observedDanger.lossShare;
 if(variant==='suppression-ended')row.supp=0;
 if(variant==='suppression-reduced'){u.supp=45;const recovered=f.look();Object.assign(row,{supp:recovered.units.get(u.id).supp,suppressionBand:recovered.units.get(u.id).suppressionBand});assert.equal(row.suppressionBand,'normal');assert.ok(row.supp>0);}
 if(variant==='off-camera'){f.memory.human.camera.x=135;const real=f.look();assert.ok(!real.screenIds.has(u.id));view.screenIds=real.screenIds;}
 if(variant==='wrong-attended')concern.unitId=999;
 if(variant==='production')concern.kind='production';
 if(variant==='stale'&&event)event.tick=view.tick-81;
 if(variant==='labels'&&event)Object.assign(event,{amount:0,responseRequired:false,responseUnits:[999],responseReason:'fake',responsePolicy:'fake'});
 if(variant==='held')row.holdPos=true;
 if(variant==='trench')assert.equal(row.cover,2,'actual delivered authored trench cover');
 if(variant==='garrison')row.garrison=0;
 if(variant==='combat')row.targetId=99;
 if(variant==='attack')row.attackId=99;
 if(variant==='grenade')row.nade={x:55,z:75};
 if(variant==='dig')row.dig={x:55,z:75};
 if(variant==='building')row.build=1;
 if(variant==='entrench')row.entrench={};
 if(variant==='queued')row.orders=[{kind:2,x:60,z:60}];
 if(variant==='entering')row.enter=0;
 if(variant==='area-fire')row.fireAt=0;
 if(variant==='retreating')row.retreating=true;
 if(variant==='automatic'){row.autoRetreat=true;row.hp=34;if(event)event.observedDanger.autoRetreatCovered=true;}
 if(variant==='homeward')row.amove={...view.players[0].spawn};
 if(variant==='remembered-home-threat')view.sightings=[{id:f.enemy.id,type:'rifle',owner:1,x:view.players[0].spawn.x,z:view.players[0].spawn.z,t:view.tick/20,val:100}];
 if(variant==='counter-role')row.type='at';
 const commands=f.decide(view,concern,level),retreats=commands.filter(c=>c.t==='retreat'&&c.ids.includes(u.id));
 if(['suppressed-march','labels','suppression-reduced'].includes(variant))assert.equal(retreats.length,1,`${level}/${variant}: public injury can replace the unseen march`);
 else if(variant==='automatic')assert.equal(retreats.length,1,`${level}: the existing ordinary hurt policy remains eligible`);
 else assert.equal(retreats.length,0,`${level}/${variant}: no unjustified fallback`);

 summaries.push({level,variant,retreats});
}
function native(variant='suppressed-march',level='easy') {
 const f=fixture(),u=f.unit,inputs=[],accepted=[],trace=[];let delivered;
 if(variant==='already-at-home'){Object.assign(u,{x:f.game.players[0].spawn.x,z:f.game.players[0].spawn.z});f.memory.human.camera.x=u.x;f.memory.human.camera.z=u.z;}
 const advance=(count)=>{for(let i=0;i<count;i++){if(!delivered||f.game.tick%2===0)delivered=viewFor(f.game,0,f.projection);think(f.game,0,{memory:f.memory,view:delivered,seed:42,level,inputLog:r=>inputs.push(structuredClone(r)),submit:cmd=>{const result=command(f.game,0,cmd);if(result===undefined)accepted.push({tick:f.game.tick,command:structuredClone(cmd)});return result;}});trace.push({tick:f.game.tick,mp:f.game.players[0].mp,unit:{x:u.x,z:u.z,hp:u.hp,supp:u.supp,retreating:u.retreating,amove:u.amove,path:u.path.length},concern:f.memory.human.concern&&structuredClone(f.memory.human.concern)});step(f.game);}};
 f.game.tick=300;advance(100);assert.equal(command(f.game,0,{t:'amove',orders:[[u.id,60,63]]}),undefined);advance(4);
 const hitTick=f.game.tick;if(variant==='already-at-home')f.game.players[0].mp=0;u.hp=70;u.supp=variant==='normal-suppression'?0:55;
 if(variant==='combat')u.targetId=f.enemy.id;
 if(['suppression-reduced','suppression-ended'].includes(variant)){advance(2);u.supp=variant==='suppression-ended'?0:45;}
 advance(variant==='already-at-home'?40:180);
 const event=f.memory.human.events.find(e=>e.kind==='screen-damage'&&e.unitId===u.id&&e.tick>=hitTick),response=accepted.find(r=>r.tick>=hitTick&&r.command.t==='retreat'&&r.command.ids.includes(u.id));
 if(['suppressed-march','suppression-reduced'].includes(variant)){
  assert.ok(event&&response,'native default commander submits the protective retreat');
  const paid=inputs.filter(i=>i.tick>=event.tick&&i.tick<=response.tick);
  assert.ok(paid.some(i=>i.kind.startsWith('select-')),'paid real selection');
  assert.ok(paid.some(i=>i.input?.code==='KeyR'),'ordinary R key');
  assert.ok(response.tick>=event.tick+4,'original response floor retained');
  assert.ok(u.retreating||Math.hypot(u.x-f.game.players[0].spawn.x,u.z-f.game.players[0].spawn.z)<15,'real command heads home');
  summaries.push({native:variant,level,hitTick,eventTick:event.tick,responseTick:response.tick,inputs:paid,response,event,trace:trace.filter(i=>i.tick>=hitTick),unit:{x:u.x,z:u.z,retreating:u.retreating},home:f.game.players[0].spawn});
 } else {
  summaries.push({native:variant,level,hitTick,event,response:response??null,inputs:inputs.filter(i=>i.tick>=hitTick),accepted:accepted.filter(i=>i.tick>=hitTick),trace:trace.filter(i=>i.tick>=hitTick),unit:{x:u.x,z:u.z,hp:u.hp,supp:u.supp,retreating:u.retreating,amove:u.amove},home:f.game.players[0].spawn});
  assert.ok(!response,`${variant}: protected native state keeps its ordinary march`);
  if(variant==='already-at-home'){assert.ok(Math.hypot(u.x-f.game.players[0].spawn.x,u.z-f.game.players[0].spawn.z)<=15);assert.ok(u.amove,'paid retreat does not erase an outward march already at home');}
 }
}
for(const level of ['easy','normal','hard'])native('suppressed-march',level);
native('normal-suppression');
for(const level of ['easy','normal','hard']){native('already-at-home',level);native('suppression-reduced',level);native('suppression-ended',level);}
console.log('Public suppressed heavy-hit fallback: planner controls and native paid retreat PASS');
