// Native selected order markers retain the simulation's ordinary shelter destination.
import assert from 'node:assert/strict';
import {createGame,command,step} from './shared/sim.js';
import {viewFor} from './shared/ai-view.js';
import {runCommander} from './shared/ai-commander.js';
import {queueCamera} from './shared/ai-hands.js';
import {onScreen} from './shared/ai-perception.js';

function scene(variant='same') {
 const rows=Array(80).fill('.'.repeat(80)),trench=['cover-return','auto-cover'].includes(variant)?48:46;
 rows[40]=rows[40].slice(0,trench)+'T'+rows[40].slice(trench+1);
 // Keep ordinary enemy-base camera visits near the actor during the hidden-endpoint control.
 const old=Math.random;Math.random=()=>.5;let game;
 try {game=createGame({w:80,h:80,rows,spawns:[{x:20,y:40},{x:variant==='marker-offscreen'?40:75,y:40}],points:[]},['AI','enemy'],false,[0,1],[0,1],{weather:false});}
 finally {Math.random=old;}
 game.units.clear();game.players[0].mp=5000;assert.equal(command(game,0,{t:'buy',unit:variant==='auto-cover'?'rifle':'mg'}),undefined);
 const unit=[...game.units.values()][0];Object.assign(unit,{x:70,z:81,holdFire:true,auto:false,autoRetreat:false});
 let other,enemy;
 if(variant==='auto-cover') {assert.equal(command(game,1,{t:'buy',unit:'rifle'}),undefined);enemy=[...game.units.values()].at(-1);Object.assign(enemy,{x:110,z:81,holdFire:true,auto:false,autoRetreat:false});}
 if(['membership','unselected','cover-neighbor'].includes(variant)) {assert.equal(command(game,0,{t:'buy',unit:variant==='cover-neighbor'?'tank':'mg'}),undefined);other=[...game.units.values()].at(-1);Object.assign(other,{x:68,z:87,holdFire:true,auto:false,autoRetreat:false});}
 game.players[0].mp=0;game.players[0].mun=250;
 const memory={human:{startedTick:0,camera:{x:80,z:80,yaw:0,distance:60}}},projection={},accepted=[],inputs=[],markers=[],interventions=[],deniedDeliveries=new Set();
 let view,changed=false,gesture=false,deniedFrames=0,movedAway=false,automaticCoverObserved=false,witnessedAutomaticMarker=false;
 for(let tick=0;tick<1200;tick++) {
  step(game);
  if(game.tick%2===0)view=viewFor(game,0,projection);
  if(!view)continue;
  if(variant==='auto-cover'&&[600,700].includes(game.tick))assert.equal(command(game,1,{t:'stance',ids:[enemy.id],key:'holdFire',on:game.tick===700}),undefined);
  if(variant==='auto-cover'&&game.tick>=600&&unit.drift==='cover'&&unit.path.length)automaticCoverObserved=true;
  if(variant==='moved-away'&&game.tick>=600&&Math.hypot(unit.x-93,unit.z-81)>8)movedAway=true;
  if(variant==='offscreen'&&!gesture&&game.tick>=320) {assert.ok(queueCamera(memory.human.hands,{x:150,z:149},{concern:'privacy-control',priority:80},'minimap'));gesture=true;}
  const state=memory.human,visible=state.view&&onScreen(unit,state.camera,state.view);
  const privateMarker=variant==='offscreen'&&gesture&&!visible&&!state.view.screenIds.has(unit.id)
    || variant==='unselected'&&changed&&!state.hands.selected.includes(unit.id)
    || variant==='marker-offscreen'&&state.view?.screenIds.has(unit.id)&&state.hands.selected.includes(unit.id)
      &&state.view.units.get(unit.id)?.orderPlan?.kind===1&&!onScreen(state.view.units.get(unit.id).orderPlan,state.camera,state.view);
  if(privateMarker) {
   delete state.orderHistory.get(unit.id).markerGoal;
   // Reset only the test witness. Poison detached data denied by selection or actor visibility.
   if(variant!=='marker-offscreen')view.units.get(unit.id).orderPlan={kind:1,x:147,z:141};
  }
  runCommander(view,0,{tick:game.tick,level:'normal',seed:27,inputLog:input=>inputs.push(structuredClone(input))},memory,cmd=>{
   const before={x:unit.x,z:unit.z,path:structuredClone(unit.path),plan:structuredClone(memory.human.view.units.get(unit.id)?.orderPlan)};
   const historyBefore=structuredClone(memory.human.orderHistory?.get(unit.id));
   const result=command(game,0,cmd);
   if(result===undefined&&['cover','stop'].includes(cmd.t))interventions.push({command:structuredClone(cmd),before:historyBefore});
   if(result===undefined) {accepted.push({tick:game.tick,command:structuredClone(cmd),before});if(variant==='unselected'&&cmd.t==='stance'&&cmd.ids.includes(other.id))changed=true;}
   return result;
  },(_view,_slot,_opts,_memory,send)=>{
   if(['offscreen','unselected'].includes(variant)&&accepted.some(row=>row.command.t==='move')) {
    if(variant==='unselected'&&!changed&&game.tick>=320)send({t:'stance',ids:[other.id],key:'holdFire',on:false});
    return;
   }
   if(variant==='auto-cover'&&game.tick>=600&&game.tick<900)return;
   const intervention={'cover-return':'cover','stop-return':'stop','stance-preserves':'stance','ability-preserves':'ability','autocast-preserves':'autocast','cover-neighbor':'cover'}[variant];
   if(intervention&&game.tick>=600&&game.tick<900) {
    if(!accepted.some(row=>row.command.t===intervention))send({t:intervention,ids:variant==='cover-neighbor'?[unit.id,other.id]:[unit.id],...(intervention==='stance'?{key:'holdFire',on:false}:intervention==='autocast'?{on:true}:{})});
    return;
   }
   const base={t:'move',orders:[[unit.id,90,80]]};
   if(variant==='cover-neighbor')base.orders.push([other.id,77,84]);
   if(variant==='marker-offscreen'&&game.tick>=320)base.orders=[[unit.id,147,141]];
   if(variant==='moved-away'&&game.tick>=600&&game.tick<900)base.orders=[[unit.id,109,81]];
   if(game.tick>=600&&variant!=='same'&&variant!=='moved-away') {
    if(variant==='target')base.orders=[[unit.id,113,80]];
    if(variant==='membership')base.orders.push([other.id,90,80]);
    if(variant==='queue')base.queue=true;
    if(variant==='face')base.face=0;
    if(variant==='retreat')return send({t:'retreat',ids:[unit.id]});
   }
   send(base);
  });
  for(const row of interventions)if(!row.after)row.after=structuredClone(memory.human.orderHistory.get(unit.id));
  const current=memory.human.view,u=current?.units.get(unit.id);
  if(variant==='auto-cover'&&game.tick>=600&&game.tick<900&&unit.drift==='cover'&&current.screenIds.has(unit.id)
    &&memory.human.hands.selected.includes(unit.id)&&u?.orderPlan?.kind===1&&onScreen(u.orderPlan,memory.human.camera,current)) {
   const goal=memory.human.orderHistory.get(unit.id)?.markerGoal;
   if(goal&&Math.hypot(goal.x-u.orderPlan.x,goal.z-u.orderPlan.z)>2)witnessedAutomaticMarker=true;
  }
  if(u?.orderPlan?.kind===1)markers.push({tick:game.tick,selected:memory.human.hands.selected.includes(unit.id),goal:{x:u.orderPlan.x,z:u.orderPlan.z}});
  const deniedNow=variant==='offscreen'?!current.screenIds.has(unit.id):variant==='unselected'?!memory.human.hands.selected.includes(unit.id)
    :current.screenIds.has(unit.id)&&memory.human.hands.selected.includes(unit.id)&&u?.orderPlan?.kind===1&&!onScreen(u.orderPlan,memory.human.camera,current);
  if(privateMarker&&deniedNow) {
   assert.equal(memory.human.orderHistory.get(unit.id).markerGoal,undefined,`${variant}: a hidden or unselected marker is never remembered`);deniedFrames++;deniedDeliveries.add(view.tick);
  }
  if(game.tick%2===0) {game.shots=[];game.newCells=[];}
 }
 return {variant,game,unit,other,memory,accepted,inputs,markers,deniedFrames,deniedDeliveries:deniedDeliveries.size,movedAway,automaticCoverObserved,witnessedAutomaticMarker,interventions};
}
const results=[];
for(const variant of ['same','target','membership','queue','face','moved-away','retreat','offscreen','unselected','marker-offscreen','cover-return','stop-return','stance-preserves','ability-preserves','auto-cover','autocast-preserves','cover-neighbor']) {
 const f=scene(variant),moves=f.accepted.filter(row=>row.command.t==='move');
 assert.ok(moves.length>0,`${variant}: real paid movement passes the native command gate`);
 if(!['cover-return','auto-cover'].includes(variant))assert.ok(f.markers.some(row=>row.selected&&Math.hypot(row.goal.x-moves[0].command.orders[0][1],row.goal.z-moves[0].command.orders[0][2])>2),`${variant}: the drawn selected marker contains the native shelter adjustment`);
 if(variant==='auto-cover') {
  assert.ok(f.automaticCoverObserved,'real incoming rifle fire creates native automatic cover movement');
  assert.ok(f.witnessedAutomaticMarker,'a later selected visible generic path cannot overwrite the earlier witnessed destination');
  assert.ok(moves.some(row=>row.tick>=900),'an automatic generic path cannot replace the witnessed accepted endpoint');
 }
 if(['stance-preserves','ability-preserves','autocast-preserves'].includes(variant)) {
  const intervention=variant==='stance-preserves'?'stance':variant==='autocast-preserves'?'autocast':'ability';assert.ok(f.accepted.some(row=>row.command.t===intervention),'the preserving native input is accepted');
  assert.equal(moves.length,1,'stance and self ability buffs preserve the arrived movement association');
 }
 if(variant==='cover-neighbor') {
  assert.ok(f.accepted.some(row=>row.command.t==='cover'&&row.command.ids.includes(f.other.id)),'native cover accepts its infantry while ignoring the selected vehicle');
  assert.ok(f.memory.human.orderHistory.get(f.other.id).intent,'the ignored vehicle retains its movement association');
 }
 if(['cover-return','stop-return','cover-neighbor'].includes(variant)) {
  const row=f.interventions[0];assert.ok(row,'a native replacing receipt retains before and after evidence');
  assert.equal(row.after.intent,null,'an accepted replacing command invalidates the old exact movement intent');
  assert.equal(row.after.markerGoal,undefined,'the replaced movement marker is discarded');
  const preserved=value=>({tick:value.tick,x:value.x,z:value.z,previous:value.previous});
  assert.deepEqual(preserved(row.after),preserved(row.before),'timing, physical destination and anti-reversal history survive invalidation');
 }
 if(['cover-return','stop-return'].includes(variant)) {
  const intervention=variant==='cover-return'?'cover':'stop';assert.ok(f.accepted.some(row=>row.command.t===intervention),'the replacing native input is accepted');
  assert.ok(moves.some(row=>row.tick>=900),'an intervening native replacement cannot hijack or retain the earlier movement intent');
 }
 if(variant==='same')assert.equal(moves.length,1,'one completed shelter-adjusted operation receives one paid click');
 if(variant==='target')assert.ok(moves.some(row=>row.command.orders[0][1]>105),'a changed target remains eligible');
 if(variant==='membership')assert.ok(moves.some(row=>row.command.orders.length===2),'changed formation membership remains eligible');
 if(variant==='queue')assert.ok(moves.some(row=>row.command.queue===true),'a queued continuation remains eligible');
 if(variant==='face')assert.ok(moves.some(row=>row.command.face===0),'a changed facing remains eligible');
 if(variant==='moved-away') {assert.ok(f.movedAway,'the squad actually walks away through native movement');assert.ok(moves.some(row=>row.tick>=900),'native movement away permits a later order back to the shelter marker');}
 if(variant==='retreat')assert.ok(f.accepted.some(row=>row.command.t==='retreat'),'ordinary retreat remains eligible');
 if(['offscreen','unselected','marker-offscreen'].includes(variant)) {
  assert.ok(f.deniedFrames>20,`${variant}: the native privacy control exercises many delivered frames`);
  assert.ok(f.deniedDeliveries>20,`${variant}: the native privacy control exercises distinct snapshot deliveries`);
 }
 results.push({variant,acceptedMoves:moves.length,deniedFrames:f.deniedFrames,deniedDeliveries:f.deniedDeliveries,firstMoveTick:moves[0].tick,marker:f.memory.human.orderHistory.get(f.unit.id)?.markerGoal??null});
}
console.log(JSON.stringify(results));
console.log('Selected shelter destinations suppress repeated paid clicks and preserve changed orders, movement, retreat and marker privacy.');
