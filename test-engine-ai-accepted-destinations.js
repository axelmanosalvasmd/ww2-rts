import assert from 'node:assert/strict';
import {createGame,command,step,UNITS} from './shared/sim.js';
import {viewFor} from './shared/ai-view.js';
import {runCommander} from './shared/ai-commander.js';
function fixture(count=1){
 const rows=Array(80).fill('.'.repeat(80));rows[31]='.'.repeat(59)+'T'+'.'.repeat(20);
 const old=Math.random;Math.random=()=>.5;let game;try{game=createGame({w:80,h:80,rows,spawns:[{x:20,y:20},{x:70,y:70}],points:[]},['AI','enemy'],false,[0,1],[0,1],{weather:false});}finally{Math.random=old;}
 for(const [id,u]of game.units)if(u.owner===0)game.units.delete(id);game.players[0].mp=5000;
 for(let i=0;i<count;i++)assert.equal(command(game,0,{t:'buy',unit:'rifle'}),undefined);
 const actors=[...game.units.values()].filter(u=>u.owner===0&&!UNITS[u.type].structure);actors.forEach((u,i)=>Object.assign(u,{x:110+i*4,z:60,holdFire:true,auto:false,autoRetreat:false}));
 game.tick=100;const memory={human:{startedTick:0,camera:{x:115,z:62,yaw:0,distance:60},concern:{id:'local',kind:'expansion',x:119,z:61,since:0,until:10000}}};return{game,actors,memory,inputs:[],commands:[],proposals:[],desired:{t:'move',orders:actors.map(u=>[u.id,119,60.6])}};
}
function advance(f,n,{reject=false,danger=false,mutate=()=>{},base=false,split=false}={}){
 const end=f.game.tick+n;for(;f.game.tick<end;){step(f.game);mutate(f);const state=f.memory.human;state.planned=false;state.noWorkUntil=0;state.deliberateUntil=0;state.concern.until=10000;if(base)state.concern.event='base';
  const view=viewFor(f.game,0,{});runCommander(view,0,{tick:f.game.tick,level:'normal',seed:31,inputLog:input=>f.inputs.push(structuredClone(input))},f.memory,cmd=>{
   const planned=structuredClone(state.hands.active.job.command);if(reject)f.game.players[0].away=true;const result=command(f.game,0,cmd);f.game.players[0].away=false;f.commands.push({tick:f.game.tick,cmd:structuredClone(cmd),planned,result});return result;
  },(_v,_slot,opts,_mem,send)=>{if(danger)for(const [id,x,z]of f.desired.orders)opts.requestDangerMove(id,{x,z});if(split)for(const row of f.desired.orders)f.proposals.push(send({...structuredClone(f.desired),orders:[[...row]]}));else f.proposals.push(send(structuredClone(f.desired)));});
 }
}
function accepted(f){return f.commands.filter(row=>row.result===undefined);}
const proof=[];
{
 const f=fixture();advance(f,140);const arrivedCount=accepted(f).length;assert.ok(arrivedCount);advance(f,280);assert.equal(accepted(f).length,arrivedCount,'same planned point is not clicked repeatedly after arriving at its accepted snapped destination');
 const row=accepted(f)[0],id=f.actors[0].id,native=row.cmd.orders.find(r=>r[0]===id),planned=row.planned.orders.find(r=>r[0]===id);assert.ok(Math.hypot(native[1]-planned[1],native[2]-planned[2])>2,'the real shared formation snap exceeds the unchanged arrival tolerance');assert.ok(Math.hypot(f.actors[0].x-native[1],f.actors[0].z-native[2])<2,'the actor actually traveled to the accepted destination');assert.ok(f.inputs.some(row=>row.command)&&f.inputs.some(row=>row.kind.startsWith('select-')),'arrival receipt follows real native selection and click');
 const before=f.commands.length;f.desired.orders[0][1]=118.5;advance(f,90);assert.ok(f.commands.length>before,'a nearby but genuinely different planned point is not hidden by a wider tolerance');proof.push({acceptedBeforeArrival:arrivedCount,acceptedAfterArrival:0,snapDistance:Math.hypot(native[1]-planned[1],native[2]-planned[2]),changedPointAccepted:true});
}
{
 const f=fixture();advance(f,280);const before=accepted(f).length;const u=f.actors[0];assert.equal(command(f.game,0,{t:'move',orders:[[u.id,112,60]]}),undefined);advance(f,180);assert.ok(accepted(f).length>before,'moving away from the actual accepted destination permits the same intention again');proof.push({actualMovementAwayRetry:true});
}
for(const change of ['type','queue','face']){
 const f=fixture();advance(f,280);const before=accepted(f).length;if(change==='type')f.desired.t='amove';else if(change==='queue')f.desired.queue=true;else f.desired.face=.4;
 advance(f,90);assert.ok(accepted(f).length>before,`${change} changes a meaningful movement intention`);proof.push({intentOption:change,accepted:true});
}
for(const mode of ['danger','base']){
 const f=fixture();advance(f,280);const before=accepted(f).length;advance(f,65,{danger:mode==='danger',base:mode==='base'});assert.ok(accepted(f).length>before,'current source-authorized danger/base response remains eligible');proof.push({override:mode,accepted:true});
}
{
 const f=fixture();advance(f,90,{reject:true});assert.ok(f.commands.length&&f.commands.every(row=>row.result!==undefined),'actual command gate refuses attempted native clicks');assert.equal(f.memory.human.orderHistory?.size??0,0,'refusals earn no intent-to-destination receipt');advance(f,350);assert.ok(accepted(f).length,'ordinary paid retry remains possible after refusal backoff');const afterRetry=accepted(f).length;advance(f,120);assert.equal(accepted(f).length,afterRetry,'accepted retry stops repeating after actual arrival');proof.push({refusalDoesNotCredit:true,paidRetryAccepted:true});
}
{
 const f=fixture(2),[a,b]=f.actors;f.desired={t:'move',orders:[[b.id,119,60.6],[a.id,121,63.5]]};advance(f,280);
 const history=f.memory.human.orderHistory;assert.ok(history.has(a.id)&&history.has(b.id));assert.deepEqual(JSON.parse(history.get(a.id).intent).orders.find(row=>row[0]===a.id),[a.id,121,63.5],'actor correspondence survives changed row positions');assert.deepEqual(JSON.parse(history.get(b.id).intent).orders.find(row=>row[0]===b.id),[b.id,119,60.6]);
 const count=accepted(f).length;f.desired.orders=[[a.id,121,63.5],[b.id,119,60.6]];advance(f,70);assert.ok(accepted(f).length>count,'changed operation order remains a meaningful formation intention');proof.push({actorOrderMapping:true,changedOrderAccepted:true});
}
{
 const f=fixture(3),[missing,b,c]=f.actors;
 f.desired={t:'move',orders:[[c.id,119,60.6],[missing.id,119,60.6],[b.id,119,60.6]]};
 let displaced=false;advance(f,100,{mutate:()=>{const h=f.memory.human.hands,a=h?.active?.actions[h.active.index];if(!displaced && (a?.kind==='select-box' || a?.clickedId===missing.id) && f.game.tick>=h.active.due){Object.assign(missing,{x:30,z:30});displaced=true;}}});const first=accepted(f)[0];assert.ok(first&&first.cmd.orders.length===2,'the box physically acquires only intended surviving companions');
 assert.ok(!first.cmd.orders.some(row=>row[0]===missing.id));assert.ok(!f.memory.human.orderHistory?.has(missing.id),'the unselected actor gets no accepted destination or intended receipt');
 for(const [id,x,z]of first.planned.orders){assert.ok(JSON.parse(f.memory.human.orderHistory.get(id)?.intent).orders.some(row=>row[0]===id&&row[1]===x&&row[2]===z),'partial selection records corresponding intended rows only for actual accepted members');}
 proof.push({partialActualSelectionOnly:true});
}
{
 const f=fixture(2);advance(f,280);const chosen=f.actors.find(actor=>{const h=f.memory.human.orderHistory.get(actor.id),row=f.desired.orders.find(row=>row[0]===actor.id);return h?.intent && JSON.parse(h.intent).orders.length === f.desired.orders.length && Math.hypot(h.x-row[1],h.z-row[2])>2;});assert.ok(chosen,'the chosen survivor still has an accepted receipt for the complete original formation');
 assert.deepEqual(JSON.parse(f.memory.human.orderHistory.get(chosen.id).intent).orders, f.desired.orders, 'the changed-membership control starts from the actual original operation receipt');
 const before=accepted(f).length,boundaryTick=f.game.tick,planned=f.desired.orders.find(row=>row[0]===chosen.id);f.desired={t:'move',orders:[[...planned]]};advance(f,80);assert.ok(accepted(f).length>before,'changed operation membership permits a genuinely different formation even when the surviving actor raw point is unchanged');const changed = accepted(f).filter(row => row.tick > boundaryTick).at(-1);
 assert.deepEqual(changed.planned.orders, [[...planned]], 'the changed operation preserves the survivor raw intention');
 assert.deepEqual(changed.cmd.orders.map(row => row[0]), [chosen.id], 'the actual native formation contains only the newly chosen survivor');
 const selected = f.inputs.find(input => input.tick > boundaryTick && input.kind === 'select-click' && input.ids?.includes(chosen.id));
 const clicked = f.inputs.find(input => input.tick === changed.tick && input.command?.t === 'move');
 assert.ok(selected && clicked && selected.tick < clicked.tick, 'changed membership pays a real new actor selection before its movement click');
 for (const input of [selected, clicked]) assert.ok(input.motorTicks > 0 && input.tick >= input.inputStartedTick + input.motorTicks, 'each changed-membership input pays its complete native motor time');
 proof.push({changedGroupAccepted:true});
}
{
 const f=fixture(2);advance(f,140,{split:true});const arrivedCount=accepted(f).length;assert.ok(accepted(f).some(row=>row.cmd.orders.length===2),'separate planner intentions produce a genuinely merged physical operation');advance(f,140,{split:true});assert.equal(accepted(f).length,arrivedCount,'same formed operation is checked after merging, so original individual planner calls still stop after native arrival');proof.push({mergedOriginalIntentsStopAfterArrival:true});
}
console.log(JSON.stringify(proof));
