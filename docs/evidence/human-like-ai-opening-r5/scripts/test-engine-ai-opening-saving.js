import assert from 'node:assert/strict';
import {createGame,step,command,priceOf,UNITS} from './shared/sim.js';
import {think,observe,plan} from './shared/ai.js';
import {perceive} from './shared/ai-perception.js';
import {createRng} from './shared/ai-rng.js';
import {beginMind} from './shared/ai-mind.js';
import {PERSONAS,saveOpeningPreference} from './shared/ai-persona.js';
function expiredSavingControl(view,slot,opts,mem,submit){mem.human.startedTick=-100000;return plan(view,slot,opts,mem,submit);}
const map={w:80,h:80,rows:Array(80).fill('.'.repeat(80)),spawns:[{x:5,y:5},{x:75,y:75}],points:[{x:30,y:30},{x:50,y:50}]};
function state(family='support'){return{startedTick:0,buys:0,persona:{family,...PERSONAS[family],opening:[...PERSONAS[family].opening]}};}
function scene(family='support'){
 const g=createGame(map,['AI','enemy'],false,[0,1],[0,1],{weather:false});g.tick=30;g.players[0].mp=155;
 const human=state(family);human.camera={...g.players[0].spawn};const view=perceive(observe(g,0),0,human,30);
 return{g,human,view};
}
const checks=[];
for(const family of ['support','defensive']){
 const{human,view}=scene(family),unit=human.persona.opening[0],positive={armySize:3,tacticalCounter:false};
 assert.equal(saveOpeningPreference(human,view,0,unit,()=>true,positive),true);
 for(const [label,modify]of[
  ['expired',x=>x.view.tick=401],['accepted-first-buy',x=>x.human.buys=1],['depleted',x=>x.options.armySize=2],['unknown-army',x=>x.options.armySize=NaN],
  ['wrong-preference',x=>x.unit='rifle'],['untrainable',x=>x.trains=()=>false],['classic-fuel-economy',x=>x.view.mode={kind:'classic'}],['unknown-start',x=>delete x.human.startedTick],
  ...['armour','aircraft','garrison','dug-in','learned-counter','situation-counter','base-defense','crowd'].map(label=>[label,x=>x.options.tacticalCounter=true])]){
  const fresh=scene(family),x={human:fresh.human,view:fresh.view,unit,trains:()=>true,options:{...positive}};modify(x);
  assert.equal(saveOpeningPreference(x.human,x.view,0,x.unit,x.trains,x.options),false,label);checks.push(`${family}/${label}`);
 }
 assert.equal(saveOpeningPreference(human,{...view,tick:400},0,unit,()=>true,positive),true,'20-second boundary');
 const collect=(fn,mp=155,elapsed=30,buys=0)=>{const s=scene(family);s.view.players[0].mp=mp;s.view.tick=elapsed;s.human.buys=buys;const mem={human:s.human,rng:createRng(1,0)},commands=[];fn(s.view,0,{human:true,level:'normal',concern:{kind:'production',id:'production'}},mem,c=>(commands.push(structuredClone(c)),undefined));return{commands,production:mem.human.production};};
 const before=collect(expiredSavingControl),after=collect(plan);assert.ok(before.commands.some(c=>c.t==='buy'&&c.unit==='rifle'));assert.ok(!after.commands.some(c=>c.t==='buy'),'saving never attempts an unaffordable purchase');
 assert.ok(after.commands.some(c=>['move','amove'].includes(c.t)),'planning still produces useful starting-force movement while saving');
 assert.equal(after.production.requiredMP,priceOf(view,unit).mp);assert.equal(after.production.proposedBuys,0);
 assert.ok(collect(plan,priceOf(view,unit).mp).commands.some(c=>c.t==='buy'&&c.unit===unit),'funded preference becomes a real authored purchase');
 assert.deepEqual(collect(plan,155,401).commands,collect(expiredSavingControl,155,401).commands,'expiration preserves baseline fallback');
 checks.push(`${family}/actual-planner-saving-funding-expiration`);
}
const deliveredCounterControls=[];
for(const counter of ['armour','aircraft','garrison','dug-in','crowd','learned-armour','learned-infantry']){
 const collect=fn=>{
  const s=scene('support'),mem={human:s.human,rng:createRng(1,0)},commands=[];
  if(counter.startsWith('learned')){const mind=beginMind(s.view,0,mem,1);mind.respect[counter==='learned-armour'?'tank':'rifle']=3;}
  else{
   const type={armour:'tank',aircraft:'fighter',garrison:'rifle','dug-in':'mg',crowd:'rifle'}[counter];
   for(let n=0;n<(counter==='crowd'?6:1);n++){
    const own=[...s.view.units.values()][0],id=10000+n,enemy={...own,id,owner:1,type,x:own.x+20+n,z:own.z+8,hp:UNITS[type].hpPer*UNITS[type].models,
     air:UNITS[type].air?{state:'flight'}:null,cover:counter==='dug-in'?1:0,garrison:counter==='garrison'?0:-1,screenSeen:true,inventoryOnly:false};
    s.view.units.set(id,enemy);s.view.screenIds.add(id);s.view.players[0].visible.add(id);
    s.view.sightings.push({id,type,x:enemy.x,z:enemy.z,val:UNITS[type].cost,t:s.view.tick/20});
   }
  }
  fn(s.view,0,{human:true,level:'normal',concern:{kind:'production',id:'production'}},mem,c=>(commands.push(structuredClone(c)),undefined));return commands;
 };
 const before=collect(expiredSavingControl),after=collect(plan);assert.deepEqual(after,before,`${counter}: delivered counter keeps baseline purchase and work`);
 assert.ok(after.some(c=>c.t==='buy'),'counter control is not vacuous');deliveredCounterControls.push({counter,commands:after});
}
const native=[];
for(const family of ['support','defensive'])for(const level of ['easy','normal','hard']){
 const g=createGame(map,['AI','enemy'],false,[0,1],[0,1],{weather:false}),memory={human:state(family)},inputs=[],commands=[],initialPositions=new Map([...g.units.values()].filter(u=>u.owner===0).map(u=>[u.id,{x:u.x,z:u.z}]));let delivered=null,startingForceAtFirstBuy=null;
 for(let tick=0;tick<600;tick++){
  if(g.tick%2===0||!delivered)delivered=observe(g,0);
  think(g,0,{level,seed:1,memory,view:delivered,inputLog:i=>inputs.push(structuredClone(i)),submit:c=>{const before=g.players[0].mp,result=command(g,0,c);commands.push({tick:g.tick,command:structuredClone(c),accepted:result===undefined,reason:result??null,mp:before});if(result===undefined&&c.t==='buy'&&!startingForceAtFirstBuy)startingForceAtFirstBuy=[...initialPositions].map(([id,initial])=>({id,initial,current:g.units.has(id)?{x:g.units.get(id).x,z:g.units.get(id).z}:null}));return result;}});
  step(g);
 }
 const first=commands.find(c=>c.accepted&&c.command.t==='buy');assert.ok(first,`${level}/${family}: real first purchase occurs`);assert.equal(first.command.unit,PERSONAS[family].opening[0]);assert.ok(first.mp>=priceOf(g,first.command.unit).mp);
 const actualMovedUnitsWhileWaiting=startingForceAtFirstBuy.filter(u=>u.current&&Math.hypot(u.current.x-u.initial.x,u.current.z-u.initial.z)>2).length;assert.ok(actualMovedUnitsWhileWaiting,'actual simulated starting units move while saving');
 const waiting=commands.filter(c=>c.tick<first.tick&&c.accepted&&['move','amove'].includes(c.command.t));assert.ok(waiting.length,`${level}/${family}: actual starting-force moves accepted before first purchase`);
 assert.ok(!commands.some(c=>c.tick<=first.tick&&c.command.t==='buy'&&!c.accepted),'saving attempts no dummy or refused first purchase');
 native.push({family,level,firstAcceptedBuy:first,usefulAcceptedMovesWhileWaiting:waiting.length,actualMovedUnitsWhileWaiting,startingForceAtFirstBuy,inputs:inputs.length,laterRejectedPurchases:commands.filter(c=>c.tick>first.tick&&c.command.t==='buy'&&!c.accepted),commands,physicalInputs:inputs});
}
// The planner computes its selected opening once per visit; retain this existing behavior in the treatment.
const dup=scene('support'),duplicateCommands=[];dup.view.players[0].mp=500;
plan(dup.view,0,{human:true,level:'hard',concern:{kind:'production',id:'production'}},{human:dup.human,rng:createRng(1,0)},c=>(duplicateCommands.push(c),undefined));
const authored=duplicateCommands.filter(c=>c.t==='buy');assert.equal(authored.length,2);assert.ok(authored.every(c=>c.unit==='mortar'),'later loop iterations retain the selected preference until accepted progress');
console.log('AI opening preference saving passed ('+checks.length+' guard/planner checks, '+deliveredCounterControls.length+' delivered counter controls, '+native.length+' native simulations).');
