import assert from 'node:assert/strict';
import {mkdtemp,cp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import * as sim from './shared/sim.js';
import * as ai from './shared/ai.js';
import {viewFor} from './shared/ai-view.js';
import {enqueueDecision} from './shared/ai-hands.js';
function scoped(fn){let x=1;const saved=Math.random;Math.random=()=>{let t=x+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};try{return fn();}finally{Math.random=saved;}}
function fixture(controller=ai,level='hard',variant='ordinary',limit=300){return scoped(()=>{
 const game=sim.createGame({w:96,h:96,rows:Array(96).fill('.'.repeat(96)),spawns:[{x:20,y:20},{x:85,y:85}],points:[{x:40,y:40}]},['commander','opponent'],false,[0,1],[0,1],{weather:false});
 game.units.clear();game.players.forEach(p=>Object.assign(p,{mp:5000,fuel:5000}));
 const buy=(slot,type)=>{assert.equal(sim.command(game,slot,{t:'buy',unit:type}),undefined);return[...game.units.values()].at(-1);};
 const own=[buy(0,'rifle'),buy(0,'rifle')],enemy=buy(1,'medium');
 for(let i=0;i<2;i++)Object.assign(own[i],{x:78+i*4,z:79,holdFire:false,auto:false,autoRetreat:false,cd:0});
 Object.assign(enemy,{x:96,z:79,holdFire:true,auto:false});game.points[0].owner=0;
 game.players.forEach((p,index)=>Object.assign(p,{mp:index===0?20:0,fuel:0,mun:200}));
 if(variant==='held')own.forEach(u=>u.holdPos=true);
 const memory={human:{startedTick:0,camera:{x:80,z:79,yaw:0,distance:60}}},projection={},inputs=[],commands=[],trace=[];let delivered,hit;
 for(let n=0;n<limit;n++){
  sim.step(game);
  if(game.tick===220&&['paid-attack','paid-move'].includes(variant)){assert.ok(enqueueDecision(memory.human.hands,variant==='paid-attack'?{t:'attack',ids:[own[1].id],target:enemy.id}:{t:'amove',orders:[[own[1].id,110,79]]},memory.human.view,{concern:'authored-paid-control',cycle:memory.human.cycle}),'real authored operation enters ordinary hands');}
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
const directory=await mkdtemp(join(tmpdir(),'automatic-armor-control-'));
try{
 await cp(new URL('./shared',import.meta.url),join(directory,'shared'),{recursive:true});await cp(new URL('./client',import.meta.url),join(directory,'client'),{recursive:true});await writeFile(join(directory,'package.json'),'{"type":"module"}');
 const sourcePath=join(directory,'shared/ai.js'),source=await readFile(sourcePath,'utf8');
 const start=source.indexOf('  const attendedStationaryArmorRetreat = u => {'),end=source.indexOf('  for (const u of mine) {\n    if (u.air) continue;',start);assert.ok(start>=0&&end>start);
 const block='    // Automatic small-arms fire does not commit a rifle to a losing armor fight.\n    if (u.targetId && (!threats.some(enemy => enemy.id === u.targetId) || u.holdFire\n      || !(def.w.veh > 0) || def.w.veh > def.w.inf || def.w.area || def.w.salvo)) return false;\n';
 let helper=source.slice(start,end);assert.ok(helper.includes(block));helper=helper.replace(block,'');helper=helper.replace('|| u.cover === 2 || u.holdPos || u.attackId || u.path.length || u.amove || u.orders.length','|| u.cover === 2 || u.holdPos || u.targetId || u.attackId || u.path.length || u.amove || u.orders.length');await writeFile(sourcePath,source.slice(0,start)+helper+source.slice(end));const control=await import(pathToFileURL(sourcePath));
 const reports=[];
 for(const level of ['easy','normal','hard']){
  const before=fixture(control,level),after=fixture(ai,level);assert.ok(before.hit&&after.hit);assert.deepEqual(before.hit,after.hit,'same actual native public projectile event');
  const victim=after.hit.unitId,row=after.trace.find(r=>r.tick===after.hit.tick).units.find(u=>u.id===victim);assert.equal(row.hp,65,'actual medium shot causes heavy damage above the ordinary health retreat threshold');
  for(const field of ['inputs','commands'])assert.deepEqual(before[field].filter(r=>r.tick<after.hit.tick),after[field].filter(r=>r.tick<after.hit.tick),'exact native prefeature '+field);
  const response=after.commands.find(c=>c.accepted&&c.tick>=after.hit.tick&&c.command.t==='retreat'&&c.command.ids.includes(victim));assert.ok(response,level+' weak automatic small arms receive a useful paid retreat');assert.ok(!before.commands.some(c=>c.accepted&&c.tick>=before.hit.tick&&c.command.t==='retreat'),'old automatic-target guard reproduces omission');
  const paid=after.inputs.filter(i=>i.tick>=after.hit.tick&&i.tick<=response.tick);assert.ok(paid.some(i=>i.kind.startsWith('select-')));assert.ok(paid.some(i=>i.input?.code==='KeyR'));assert.ok(paid.every(i=>Number.isSafeInteger(i.inputStartedTick)&&i.tick-i.inputStartedTick>=i.motorTicks));assert.ok(paid[0].tick>=after.hit.tick+4);reports.push({level,hit:after.hit,response,paid});
 }
 for(const variant of ['held','paid-attack','paid-move']){
  const before=fixture(control,'hard',variant),after=fixture(ai,'hard',variant);for(const field of ['inputs','commands'])assert.deepEqual(before[field],after[field],variant+' protected native complete trace');
  if(variant.startsWith('paid-'))assert.ok(after.commands.some(c=>c.accepted&&c.tick<240&&c.command.t===(variant==='paid-attack'?'attack':'amove')),'control actually pays and accepts its operation');
  assert.ok(!after.commands.some(c=>c.accepted&&c.tick>=240&&c.command.t==='retreat'),'protected tactic stays intact');reports.push({variant,commands:after.commands,inputs:after.inputs});
 }
 console.log(JSON.stringify({status:'PASS',nativePairs:6,nativeRuns:12,reports}));
}finally{await rm(directory,{recursive:true,force:true});}
