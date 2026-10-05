import assert from 'node:assert/strict';
import {mkdtemp,cp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import * as sim from './shared/sim.js';
import * as ai from './shared/ai.js';
import {viewFor} from './shared/ai-view.js';
import {perceive} from './shared/ai-perception.js';
function scoped(fn){let x=1;const saved=Math.random;Math.random=()=>{let t=x+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};try{return fn();}finally{Math.random=saved;}}
function fixture(controller=ai,level='hard',variant='ordinary',limit=300){return scoped(()=>{
 const game=sim.createGame({w:96,h:96,rows:Array(96).fill('.'.repeat(96)),spawns:[{x:20,y:20},{x:85,y:85}],points:[{x:40,y:40}]},['commander','opponent'],false,[0,1],[0,1],{weather:false});
 game.units.clear();game.players.forEach(p=>Object.assign(p,{mp:5000,fuel:5000}));
 const buy=(slot,type)=>{assert.equal(sim.command(game,slot,{t:'buy',unit:type}),undefined);return[...game.units.values()].at(-1);};
 const own=[buy(0,'rifle'),buy(0,'rifle')],enemy=buy(1,'medium');
 for(let i=0;i<2;i++)Object.assign(own[i],{x:78+i*4,z:79,holdFire:true,auto:false,autoRetreat:false,cd:60});
 Object.assign(enemy,{x:96,z:79,holdFire:true,auto:false});game.points[0].owner=0;
 game.players.forEach((p,index)=>Object.assign(p,{mp:index===0?20:0,fuel:0,mun:200}));
 if(variant==='held')own.forEach(u=>u.holdPos=true);
 const memory={human:{startedTick:0,camera:{x:80,z:79,yaw:0,distance:60}}},projection={},inputs=[],commands=[],trace=[];let delivered,hit;
 for(let n=0;n<limit;n++){
  sim.step(game);
  if(game.tick===240)assert.equal(sim.command(game,1,{t:'stance',ids:[enemy.id],key:'holdFire',on:false}),undefined,'opponent releases its real weapon');
  if(!delivered||game.tick%2===0)delivered=viewFor(game,0,projection);
  controller.think(game,0,{level,seed:1,memory,view:delivered,inputLog:r=>inputs.push(structuredClone(r)),submit:cmd=>{const error=sim.command(game,0,cmd);commands.push({tick:game.tick,command:structuredClone(cmd),accepted:error===undefined,rejection:error??null});return error;}});
  const event=memory.human.events?.find(e=>e.kind==='screen-damage'&&e.tick>=240&&e.observedDanger?.lossShare>=.25);
  if(event&&!hit)hit=structuredClone(event);
  trace.push({tick:game.tick,concern:structuredClone(memory.human.concern),units:own.map(u=>({id:u.id,hp:u.hp,x:u.x,z:u.z,retreating:u.retreating})),active:memory.human.hands?.active?.actions[memory.human.hands.active.index]?.kind??null,queue:memory.human.hands?.queue.length??0});
  if(limit===245&&hit)break;
 }
 return{game,memory,own,enemy,inputs,commands,trace,hit,delivered};
});}
const directory=await mkdtemp(join(tmpdir(),'stationary-armor-control-'));
try{
 await cp(new URL('./shared',import.meta.url),join(directory,'shared'),{recursive:true});await cp(new URL('./client',import.meta.url),join(directory,'client'),{recursive:true});await writeFile(join(directory,'package.json'),' {"type":"module"} ');
 const sourcePath=join(directory,'shared/ai.js'),source=await readFile(sourcePath,'utf8');
 const call='    if (attendedStationaryArmorRetreat(u)) { retreat.push(u.id); busy.add(u.id); continue; }';
 assert.equal(source.split(call).length,2,'exact prospective fallback call exists');await writeFile(sourcePath,source.replace(call,''));
 const control=await import(pathToFileURL(sourcePath));
 const before=fixture(control),after=fixture(ai),victim=after.hit.unitId;
 assert.ok(before.hit&&after.hit,'actual native medium projectile creates a heavy public health drop');
 assert.equal(before.hit.tick,after.hit.tick,'native prefixes keep the same damage creation');
 assert.deepEqual(before.inputs.filter(i=>i.tick<before.hit.tick),after.inputs.filter(i=>i.tick<after.hit.tick),'complete native physical prefix unchanged');
 assert.deepEqual(before.commands.filter(i=>i.tick<before.hit.tick),after.commands.filter(i=>i.tick<after.hit.tick),'complete command prefix unchanged');
 const response=after.commands.find(c=>c.tick>=after.hit.tick&&c.command.t==='retreat'&&c.command.ids.includes(victim)&&c.accepted);
 assert.ok(response,'real ordinary retreat protects the stationary injured infantry');
 assert.ok(!before.commands.some(c=>c.tick>=before.hit.tick&&c.command.t==='retreat'&&c.command.ids.includes(victim)),'control reproduces missing useful response before the next native shot');
 const paid=after.inputs.filter(i=>i.tick>=after.hit.tick&&i.tick<=response.tick);
 assert.ok(paid.some(i=>i.input?.code==='KeyR'),'ordinary paid retreat key');assert.ok(response.tick>=after.hit.tick+4,'original causal response floor remains');
 assert.ok(paid.every(i=>Number.isSafeInteger(i.inputStartedTick)&&i.tick-i.inputStartedTick>=i.motorTicks),'full paid motor duration remains');
 assert.ok(after.game.units.get(victim).retreating,'engine actually starts retreat');
 // Neighboring rule controls start from the same real native heavy-hit public scene.
 const variants=['ordinary','labels','light','infantry','engaged','held','trench','garrison','moving','attack','dig','build','entrench','queued','enter','area-fire','grenade','automatic','home','unsafe-memory','unsafe-screen','stale','off-camera','wrong-event','wrong-actor','no-event','classic','world','local-safe','counter-role'];
 const controls=[];
 for(const level of ['easy','normal','hard'])for(const variant of variants){
  const f=fixture(control,'hard','ordinary',245),view=perceive(viewFor(f.game,0,f.memory),0,f.memory.human,f.game.tick),event=view.events.find(e=>e.id===f.hit.id),u=view.units.get(event.unitId),enemy=view.units.get(f.enemy.id);
  assert.ok(u.hp>50&&u.hp<75,'real medium hit lies above every ordinary retreat health threshold');
  const concern={kind:'combat',event:'screen-damage',eventId:event.id,unitId:u.id,x:u.x,z:u.z};
  if(variant==='labels')Object.assign(event,{responseRequired:false,responsePolicy:'forged',responseUnits:[]});
  if(variant==='light')event.observedDanger.lossShare=.20;
  if(variant==='infantry')enemy.type='mg';
  if(variant==='engaged')u.targetId=enemy.id;
  if(variant==='held')u.holdPos=true;
  if(variant==='trench')u.cover=2;
  if(variant==='garrison')u.garrison=0;
  if(variant==='moving')u.path=[{x:70,z:79}];
  if(variant==='attack')u.attackId=enemy.id;
  if(variant==='dig')u.dig={};
  if(variant==='build')u.build=1;
  if(variant==='entrench')u.entrench={};
  if(variant==='queued')u.orders=[{t:'move',x:70,z:70}];
  if(variant==='enter')u.enter=1;
  if(variant==='area-fire')u.fireAt=0;
  if(variant==='grenade')u.nade={x:enemy.x,z:enemy.z};
  if(variant==='automatic')event.observedDanger.autoRetreatCovered=true;
  if(variant==='home')Object.assign(view.players[0].spawn,{x:u.x,z:u.z});
  if(variant==='unsafe-memory')view.sightings=[{type:'medium',x:view.players[0].spawn.x,z:view.players[0].spawn.z}];
  if(variant==='unsafe-screen')Object.assign(view.players[0].spawn,{x:enemy.x,z:enemy.z});
  if(variant==='stale')event.tick=view.tick-81;
  if(variant==='off-camera')view.screenIds.delete(u.id);
  if(variant==='wrong-event')concern.eventId='other';
  if(variant==='wrong-actor')concern.unitId=999;
  if(variant==='no-event')view.events=[];
  if(variant==='classic')view.mode={kind:'classic'};
  if(variant==='world')view.mode={kind:'world',regions:[]};
  if(variant==='local-safe')enemy.x=u.x+30;
  if(variant==='counter-role')u.type='at';
  const out=[];ai.plan(view,0,{human:true,level,concern},f.memory,c=>{out.push(structuredClone(c));return undefined;});
  const retreats=out.filter(c=>c.t==='retreat'&&c.ids.includes(u.id));
  assert.equal(retreats.length,['ordinary','labels'].includes(variant)?1:0,level+'/'+variant+': fallback has public cause and preserves protected or safer local choices');
  controls.push({level,variant,retreats});
 }
 console.log(JSON.stringify({status:'PASS',native:{hit:after.hit,response,paid,before:before.commands,after:after.commands},neighborControls:controls.length}));
}finally{await rm(directory,{recursive:true,force:true});}
