import assert from 'node:assert/strict';
import {createGame,command,step,snapshotCache,UNITS} from './shared/sim.js';
import {observe} from './shared/ai.js';
import {perceive} from './shared/ai-perception.js';
import {createHands,enqueueDecision,advanceHands} from './shared/ai-hands.js';
function seat({staticWorld=false,level='hard',mode='conquest'}={}){
 const old=Math.random;Math.random=()=>.5;let game;
 try{game=createGame({w:80,h:80,rows:Array(80).fill('.'.repeat(80)),spawns:[{x:20,y:20},{x:60,y:60}],points:[]},['AI','enemy'],true,[0,1],[0,1],{mode,army:'massive',weather:false});}finally{Math.random=old;}
 for(let i=0;i<100;i++)step(game);
 const log=[],sent=[],hands=createHands({slot:0,seed:31,level,camera:{x:122,z:120},log});hands.tick=game.tick;hands.openingUntil=0;hands.openingDone=true;
 const state={camera:hands.camera,hands,skill:hands.skill},s={game,hands,log,sent,state,staticWorld};
 s.refresh=()=>s.view=perceive(observe(game,0,snapshotCache(game)),0,state,game.tick);s.refresh();
 s.run=(slot=0,afterSubmit)=>{let limit=game.tick+2000;while(hands.active||hands.queue.length){assert.ok(game.tick<limit,'motor program completes with unchanged caps');if(staticWorld)game.tick++;else step(game);s.refresh();advanceHands(hands,game.tick,s.view,cmd=>{const captured={tick:game.tick,command:structuredClone(cmd),selected:[...hands.selected],clickedAt:{...hands.active.job.clickedAt},units:structuredClone(s.view.units),jobUnits:structuredClone(hands.active.job.units)};const result=command(game,slot,cmd);sent.push({...captured,result});afterSubmit?.(cmd,result);return result;});}s.refresh();};
 s.order=(ids,destination,context={},slot=0,afterSubmit)=>{s.refresh();const begin=log.length;assert.ok(enqueueDecision(hands,{t:'move',orders:ids.map((id,i)=>[id,destination.x+i*2,destination.z])},s.view,{operation:'advance',concern:'operation',...context}));s.run(slot,afterSubmit);return log.slice(begin);};
 return s;
}
const orderedIds=row=>row.command.orders?.map(order=>order[0])??row.command.ids??[];

const {createOrders}=await import('./client/orders.js');const {createSelection}=await import('./client/selection.js');const {formation}=await import('./shared/formation.js');
function humanCommand(s,row,at){
 const selected=new Set(),groups={1:[...row.selected]},sent=[];
 const selection=createSelection({units:s.view.units,selected,groups,owner:()=>0,definitions:UNITS,screenOf:()=>({front:true,x:960,y:540}),viewport:()=>({width:1920,height:1080}),center:()=>{}});selection.group(1);
 const fm={shape:'line',spread:1,together:true,snap:true};
 const orders=createOrders({selected,units:s.view.units,me:0,defs:UNITS,diggers:[],formation:(units,at,face,reach)=>formation(units,at,{defs:UNITS,cell:2,width:s.view.w*2,height:s.view.h*2,face,reach,...fm,terrainAt:(x,z)=>x>=0&&z>=0&&x<s.view.w&&z<s.view.h&&!!(s.view.flags[z*s.view.w+x]&8)}),together:()=>fm.together,send:cmd=>sent.push(cmd),feedback:()=>{}});
 assert.ok(orders.dispatch({ground:at}));return sent[0];
}
const results=[];
function compare(s,label){const row=s.sent.at(-1);assert.equal(row.result,undefined,'native operation passes the ordinary engine command gate');const client=humanCommand({...s,view:{...s.view,units:row.units}},row,row.clickedAt);const equal=JSON.stringify(row.command.orders)===JSON.stringify(client.orders);results.push({label,selected:row.selected,inputUnits:row.selected.map(id=>row.units.get(id)),jobUnits:row.jobUnits,clickedAt:row.clickedAt,face:row.command.face,ai:row.command.orders,client:client.orders,equal,accepted:row.result===undefined});return equal;}
{
 const s=seat({staticWorld:true});s.order([1,3],{x:130,z:128});s.order([1,3],{x:137,z:129});assert.deepEqual(s.hands.groups.get(1),[1,3]);s.order([2],{x:125,z:130});Object.assign(s.game.units.get(1),{x:122,z:120});Object.assign(s.game.units.get(3),{x:122,z:120});s.refresh();
 s.order([3,1],{x:138,z:134});assert.ok(s.log.findLast(row=>row.kind==='group-recall'));compare(s,'recalled exact set with reversed planner order and same-position ties');
}
{
 const s=seat({staticWorld:true});s.order([1,2,3],{x:130,z:128});s.order([1,2,3],{x:137,z:129});assert.deepEqual(s.hands.groups.get(1),[1,2,3]);s.game.units.delete(2);Object.assign(s.game.units.get(1),{x:122,z:120});Object.assign(s.game.units.get(3),{x:122,z:120});s.refresh();s.hands.selected=[];
 s.order([3,1],{x:138,z:134});assert.deepEqual(s.hands.groups.get(1),[1,3]);compare(s,'dead-member-pruned real recall and reversed tied survivors');s.game.units.delete(3);s.refresh();s.hands.selected=[];s.order([1],{x:142,z:135});compare(s,'real paid group surviving singleton');
}
{
 const s=seat({staticWorld:true});s.order([1,3],{x:130,z:128});Object.assign(s.game.units.get(1),{x:122,z:120});Object.assign(s.game.units.get(3),{x:122,z:120});s.refresh();const before=s.log.length;
 s.order([3,1],{x:138,z:134});assert.ok(!s.log.slice(before).some(row=>row.kind.startsWith('select-')||row.kind==='group-recall'),'already restored selection stays actual without another input');compare(s,'persistent actual selection with reversed planner order and tied positions');
}

{
 const s=seat({staticWorld:true});Object.assign(s.game.units.get(1),{x:120,z:120});Object.assign(s.game.units.get(3),{x:124,z:120});s.refresh();s.order([3,1],{x:139,z:133});compare(s,'physical box selection order differs from planner order without ties');
}

{
 const s=seat({staticWorld:true});Object.assign(s.game.units.get(1),{x:122,z:120});Object.assign(s.game.units.get(3),{x:122,z:120});s.refresh();
 assert.ok(enqueueDecision(s.hands,{t:'move',orders:[[3,139,133],[2,139,133],[1,139,133]]},s.view,{operation:'advance',responseActorIds:[3,2,1]}));
 advanceHands(s.hands,s.game.tick,s.view,()=>assert.fail());const due=s.hands.active.due;
 while(s.hands.active||s.hands.queue.length){s.game.tick++;if(s.game.tick===due)Object.assign(s.game.units.get(2),{x:180,z:180});s.refresh();advanceHands(s.hands,s.game.tick,s.view,cmd=>{const captured={tick:s.game.tick,command:structuredClone(cmd),selected:[...s.hands.selected],clickedAt:{...s.hands.active.job.clickedAt},units:structuredClone(s.view.units),jobUnits:structuredClone(s.hands.active.job.units)};const result=command(s.game,0,cmd);s.sent.push({...captured,result});return result;});}
 assert.deepEqual(s.hands.selected,[1,3]);assert.deepEqual(s.sent[0].command.orders.map(row=>row[0]).sort((a,b)=>a-b),[1,3]);compare(s,'P1 partial physical box with reversed planner order and tied actual survivors');
}
assert.ok(results.every(row=>row.equal),'all actual formation orders match the human dispatcher with the restored selection');
console.log('AI formations match actual client selection order for tied recall, retained selection, dead pruning, singleton and physical partial selection');
