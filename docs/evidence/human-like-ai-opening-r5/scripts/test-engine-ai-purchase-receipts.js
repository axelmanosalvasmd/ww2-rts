import assert from 'node:assert/strict';
import * as sim from './shared/sim.js';
import * as ai from './shared/ai.js';
import {perceive} from './shared/ai-perception.js';
import {PERSONAS} from './shared/ai-persona.js';
import {createRng} from './shared/ai-rng.js';
import {runCommander} from './shared/ai-commander.js';
const map={w:80,h:80,rows:Array(80).fill('.'.repeat(80)),spawns:[{x:5,y:5},{x:75,y:75}],points:[{x:30,y:30},{x:50,y:50}]};
function scene(){const g=sim.createGame(map,['AI','enemy'],false,[0,1],[0,1],{weather:false});g.tick=30;g.players[0].mp=500;const human={startedTick:0,buys:0,persona:{family:'support',...PERSONAS.support},camera:{...g.players[0].spawn}},view=perceive(ai.observe(g,0),0,human,30);return{g,human,view};}
function planned(module,{receipt,frame=30,decisionOnly=false,reject=false,humanOptions=true}={}){const{human,view}=scene();human.lastAcceptedBuyTick=receipt;view.tick=frame;const commands=[];module.plan(view,0,{human:humanOptions,decisionOnly,level:'normal',concern:{kind:'production',id:'production'}},{human,rng:createRng(1,0)},c=>{commands.push(structuredClone(c));return reject&&c.t==='buy'?'mp':undefined;});return{commands,human};}
const checks=[];
for(const frame of [29,30]){const x=planned(ai,{receipt:30,frame});assert.ok(!x.commands.some(c=>c.t==='buy'));assert.ok(x.commands.some(c=>['move','amove'].includes(c.t)));assert.equal(x.human.production.reason,'awaiting-buy-receipt-frame');checks.push(`stale-resource-frame${frame}/useful-nonbuy-still-proposed`);}
assert.ok(planned(ai,{receipt:30,frame:31}).commands.some(c=>c.t==='buy'));checks.push('strictly-newer-frame-resumes-buy-planning');
for(const receipt of [undefined,NaN])assert.deepEqual(planned(ai,{receipt}).commands,planned(ai).commands);checks.push('unknown-receipt-preserves-old-native-proposals');
assert.deepEqual(planned(ai,{receipt:30,decisionOnly:true}).commands,planned(ai,{decisionOnly:true}).commands);checks.push('explicit-decisionOnly-preserves-direct-planner-semantics');
assert.deepEqual(planned(ai,{receipt:30,humanOptions:false}).commands,planned(ai,{humanOptions:false}).commands);checks.push('nonhuman-direct-planner-ignores-receipt-bookkeeping');
assert.equal(planned(ai,{reject:true}).commands.filter(c=>c.t==='buy').length,1);checks.push('sender-refusal-stops-current-batch-without-receipt-or-cost-credit');
assert.equal(planned(ai).commands.filter(c=>c.t==='buy').length,2);checks.push('existing-local-price-projection-still-honors-two-affordable-mortars');
const actual=[];
for(const refusal of [false,true]){
 const g=sim.createGame(map,['AI','enemy'],false,[0,1],[0,1],{weather:false}),memory={},commands=[];let view=null;
 for(let tick=0;tick<400;tick++){
  if(g.tick%2===0||!view){view=ai.observe(g,0);view.players[0].mp=500;}
  runCommander(view,0,{tick:g.tick,level:'hard',seed:1},memory,c=>{if(refusal&&c.t==='buy')g.players[0].mp=0;const result=sim.command(g,0,c);commands.push({tick:g.tick,command:structuredClone(c),accepted:result===undefined,reason:result??null});return result;},(observation,slot,opts,mem,submit)=>{submit({t:'buy',unit:'rifle'});submit({t:'move',orders:[[1,30,30]]});});
  if(commands.some(c=>c.command.t==='buy'))break;sim.step(g);
 }
 const buy=commands.find(c=>c.command.t==='buy');assert.ok(buy);assert.equal(buy.accepted,!refusal);assert.equal(memory.human.lastAcceptedBuyTick,refusal?undefined:buy.tick);actual.push({refusal,actualBuy:buy,receiptTick:memory.human.lastAcceptedBuyTick??null});
}
checks.push('actual-engine-success-stamps-own-accepted-buy-tick','actual-engine-refusal-does-not-stamp-receipt');
const onlyMove=scene(),memory={human:onlyMove.human};runCommander(onlyMove.view,0,{tick:30,level:'hard',seed:1},memory,c=>sim.command(onlyMove.g,0,c),()=>{});assert.equal(memory.human.lastAcceptedBuyTick,undefined);checks.push('no-buy-callback-has-no-receipt');
async function pendingTrace(seed=1){
 const native=ai,engine=sim,commander={runCommander},g=engine.createGame(map,['AI','enemy'],false,[0,1],[0,1],{weather:false}),mem={},rows=[],commands=[];g.players[0].mp=500;let view=null;
 for(let tick=0;tick<400;tick++){
  if(g.tick%2===0||!view)view=native.observe(g,0);
  commander.runCommander(view,0,{tick:g.tick,level:'hard',seed,inputLog:row=>rows.push(JSON.parse(JSON.stringify(row)))},mem,c=>{const result=engine.command(g,0,c);commands.push({tick:g.tick,command:structuredClone(c),accepted:result===undefined,reason:result??null});return result;},(observation,slot,opts,m,submit)=>{submit({t:'buy',unit:'rifle'});submit({t:'buy',unit:'mg'});});
  if(commands.filter(c=>c.command.t==='buy').length>=2)break;engine.step(g);
 }
 assert.equal(commands.filter(c=>c.command.t==='buy'&&c.accepted).length,2);return{commands,rows};
}
const pending=await pendingTrace();const purchaseInputs=pending.rows.filter(row=>row.command?.t==='buy');assert.deepEqual(purchaseInputs.map(row=>row.command.unit),['rifle','mg']);assert.ok(purchaseInputs.every(row=>row.queuedTick<purchaseInputs[0].tick));assert.ok(purchaseInputs.every(row=>row.tick>=row.inputStartedTick+row.motorTicks));checks.push('already-queued-two-purchase-gestures-finish-with-complete-motor-durations-after-first-receipt');
assert.deepEqual(await pendingTrace(1),await pendingTrace(1));assert.notDeepEqual(await pendingTrace(1),await pendingTrace(2));checks.push('same-seat-seed-preserves-native-gesture-timing-different-seed-varies');
console.log('AI purchase receipt guards passed ('+checks.length+' checks).');
