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
 s.run=(slot=0,afterSubmit)=>{let limit=game.tick+2000;while(hands.active||hands.queue.length){assert.ok(game.tick<limit,'motor program completes with unchanged caps');if(staticWorld)game.tick++;else step(game);s.refresh();advanceHands(hands,game.tick,s.view,cmd=>{const result=command(game,slot,cmd);sent.push({tick:game.tick,command:structuredClone(cmd),result});afterSubmit?.(cmd,result);return result;});}s.refresh();};
 s.order=(ids,destination,context={},slot=0,afterSubmit)=>{s.refresh();const begin=log.length;assert.ok(enqueueDecision(hands,{t:'move',orders:ids.map((id,i)=>[id,destination.x+i*2,destination.z])},s.view,{operation:'advance',concern:'operation',...context}));s.run(slot,afterSubmit);return log.slice(begin);};
 return s;
}
const orderedIds=row=>row.command.orders?.map(order=>order[0])??row.command.ids??[];
const proof={policy:'The same actual set of 2 to 8 ground troops repeats an accepted marked movement within 60 seconds. Remember at most 32 recent sets and bind after the second accepted order.',cases:[]};
for(const level of ['easy','normal','hard']){
 const s=seat({level}),pair=[1,3];
 const first=s.order(pair,{x:130,z:128});assert.equal(s.sent[0].result,undefined);assert.equal(s.hands.groups.size,0);assert.equal(first.filter(row=>row.kind==='group-set').length,0);assert.equal(s.hands.operationHistory.size,1);
 const second=s.order(pair,{x:137,z:129});assert.equal(s.sent[1].result,undefined);assert.deepEqual(s.hands.groups.get(1),pair);assert.equal(second.filter(row=>row.kind==='group-set').length,1);
 const issued=second.find(row=>row.command),bound=second.find(row=>row.kind==='group-set');assert.ok(bound.tick>issued.tick,'bind is a separate completed motor after an actual accepted order');assert.equal(bound.input.ctrl,true);assert.equal(bound.input.code,'Digit1');assert.equal(bound.command,undefined);assert.ok(bound.motorTicks>=Math.ceil(s.hands.skill.key[0]*20));
 s.order([2],{x:125,z:130});assert.deepEqual(s.hands.selected,[2]);
 const third=s.order(pair,{x:140,z:136});assert.equal(s.sent[3].result,undefined);assert.equal(third.filter(row=>row.kind==='group-recall').length,1);assert.equal(third.filter(row=>row.kind==='group-set').length,0);assert.deepEqual([...orderedIds(s.sent[3])].sort((a,b)=>a-b),pair);assert.equal(s.hands.groups.size,1);assert.equal(s.log.filter(row=>row.kind==='group-set').length,1);
 proof.cases.push({level,firstAccepted:s.sent[0].tick,secondAccepted:s.sent[1].tick,bind:bound.tick,thirdAccepted:s.sent[3].tick,recalls:1,firstBindInputs:0});
}
{
 const s=seat();s.order([1,3],{x:130,z:128});const before=structuredClone([...s.hands.operationHistory]);
 const failed=s.order([1,3],{x:136,z:130},{},1);assert.notEqual(s.sent[1].result,undefined,'wrong-seat real simulation command is refused');assert.equal(s.hands.groups.size,0);assert.equal(failed.filter(row=>row.kind==='group-set').length,0);assert.deepEqual([...s.hands.operationHistory],before,'rejection does not buy an expected-reuse history entry');
 const retry=s.order([1,3],{x:139,z:134});assert.equal(s.sent[2].result,undefined);assert.equal(retry.filter(row=>row.kind==='group-set').length,1);
 proof.cases.push({rejectedSecondNoBinding:true,paidAcceptedRetryBinds:true});
}
{
 const s=seat();s.order([1,3],{x:130,z:128});s.order([1,2],{x:134,z:130});assert.equal(s.hands.groups.size,0,'changed actual set does not inherit readiness to bind');assert.equal(s.hands.operationHistory.size,2);
 s.game.units.delete(3);s.refresh();step(s.game);s.refresh();advanceHands(s.hands,s.game.tick,s.view,()=>assert.fail());assert.ok(!s.hands.operationHistory.has('1,3'),'dead-member history is forgotten rather than inventing an accepted living subset');
 s.order([1,2],{x:139,z:135});assert.deepEqual(s.hands.groups.get(1),[1,2]);s.game.units.delete(2);step(s.game);s.refresh();advanceHands(s.hands,s.game.tick,s.view,()=>assert.fail());assert.deepEqual(s.hands.groups.get(1),[1],'a genuinely paid group retains its surviving singleton');
 proof.cases.push({changedSetNoBinding:true,deadHistoryForgotten:true,realGroupDeadPruning:true});
}
{
 const s=seat();s.order([1,3],{x:130,z:128});const before=s.hands.tick;while(s.game.tick<before+1200){step(s.game);s.refresh();advanceHands(s.hands,s.game.tick,s.view,()=>assert.fail());}
 assert.equal(s.hands.operationHistory.size,0);const next=s.order([1,3],{x:136,z:135});assert.equal(next.filter(row=>row.kind==='group-set').length,0);assert.equal(s.hands.groups.size,0);
 proof.cases.push({sixtySecondExpiry:true,noStaleRebind:true});
}
{
 const s=seat({staticWorld:true});assert.ok(enqueueDecision(s.hands,{t:'move',orders:[[1,128,130],[3,130,130]]},s.view,{operation:'advance',concern:'operation'}));
 advanceHands(s.hands,s.game.tick,s.view,()=>assert.fail());const selectorDue=s.hands.active.due;
 while(s.hands.active||s.hands.queue.length){s.game.tick++;if(s.game.tick===selectorDue)Object.assign(s.game.units.get(3),{x:180,z:180});s.refresh();advanceHands(s.hands,s.game.tick,s.view,cmd=>{const result=command(s.game,0,cmd);s.sent.push({tick:s.game.tick,command:structuredClone(cmd),result});return result;});}
 assert.equal(s.hands.groups.size,0);assert.ok(!s.hands.operationHistory.has('1,3'),'a delivered actor leaving the box before release does not credit its intended set');assert.ok(s.log.some(row=>row.kind.startsWith('select-')));assert.ok(s.sent.every(row=>!orderedIds(row).includes(3)),'the departed actor is never virtually selected');
 proof.cases.push({selectionDepartureDoesNotCreditIntendedSet:true,actualSelection:s.hands.selected,submitted:s.sent.length});
}
{
 const s=seat({staticWorld:true});s.game.players[0].mp=50000;for(let n=0;n<36;n++)assert.equal(command(s.game,0,{t:'buy',unit:'rifle'}),undefined);
 const own=[...s.game.units.values()].filter(unit=>unit.owner===0&&!UNITS[unit.type].structure);assert.ok(own.length>=38);
 // Static delivered-position fixture isolates the history bound. All orders still pass the actual simulation command gate.
 own.forEach((unit,i)=>{unit.x=114+(i%7)*3;unit.z=111+Math.floor(i/7)*3;});Object.assign(s.hands.camera,{x:122,z:120});s.refresh();
 for(let i=1;i<=34;i++){const rows=s.order([own[0].id,own[i].id],{x:130,z:127});assert.equal(s.sent.at(-1).result,undefined);assert.equal(rows.filter(row=>row.kind==='group-set').length,0);assert.ok(s.hands.operationHistory.size<=32);}
 assert.equal(s.hands.operationHistory.size,32);assert.ok(!s.hands.operationHistory.has([own[0].id,own[1].id].sort((a,b)=>a-b).join(',')),'bounded history evicts the oldest exact set');
 proof.cases.push({historyBound:32,acceptedUniqueSets:34,allFirstUseBindings:0});
 const oversized=own.slice(0,9).map(unit=>unit.id);for(let repeat=0;repeat<2;repeat++){s.refresh();const before=s.sent.length;assert.ok(enqueueDecision(s.hands,{t:'move',orders:oversized.map(id=>[id,130+repeat*4,127+repeat*4])},s.view,{operation:'advance',concern:'operation'}));s.run();const actual=s.sent.slice(before).flatMap(orderedIds);assert.deepEqual([...actual].sort((a,b)=>a-b),[...oversized].sort((a,b)=>a-b),'the public path addresses all nine actors in real paid selections of at most eight');assert.ok(s.sent.slice(before).every(row=>orderedIds(row).length<=8));}assert.ok([...s.hands.groups.values()].every(ids=>ids.length<=8),'over-eight requests never create an oversized group');assert.ok([...s.hands.operationHistory.values()].every(item=>item.ids.length<=8));
 proof.cases.push({overEightGuard:true});
}
{
 const s=seat();s.order([1],{x:128,z:129});s.order([1],{x:132,z:130});assert.equal(s.hands.operationHistory.size,0);assert.equal(s.hands.groups.size,0,'single-squad moves have no automatic grouping');
 s.order([1,3],{x:135,z:132},{operation:false});s.order([1,3],{x:139,z:136},{operation:false});assert.equal(s.hands.operationHistory.size,0);assert.equal(s.hands.groups.size,0,'generic commands do not become grouping work');
 proof.cases.push({singletonAndUnmarkedGuards:true});
}
{
 const s=seat();s.game.players[0].mp=5000;s.game.players[0].fuel=1000;for(let i=0;i<2;i++)assert.equal(command(s.game,0,{t:'buy',unit:'fighter'}),undefined);s.refresh();const ids=[...s.game.units.values()].filter(unit=>unit.owner===0&&unit.air).map(unit=>unit.id);
 s.order(ids,{x:130,z:129});s.order(ids,{x:139,z:136});assert.ok(s.sent.every(row=>row.result===undefined));assert.ok(s.log.some(row=>row.kind==='select-air-panel'));assert.equal(s.hands.operationHistory.size,0);assert.equal(s.hands.groups.size,0,'air-panel missions do not become ground group bookkeeping');proof.cases.push({realAirPanelMemberGuard:true});
}
{
 const s=seat({mode:'classic'}),own=[...s.game.units.values()].filter(unit=>unit.owner===0),structure=own.find(unit=>UNITS[unit.type].structure),troop=own.find(unit=>!UNITS[unit.type].structure);assert.ok(structure&&troop);
 s.order([structure.id,troop.id],{x:130,z:129});s.order([structure.id,troop.id],{x:137,z:134});assert.equal(s.hands.operationHistory.size,0);assert.equal(s.hands.groups.size,0,'mixed producer selections never become ground operation groups');assert.ok(s.sent.length>0);proof.cases.push({realStructureMemberGuard:true,accepted:s.sent.filter(row=>row.result===undefined).length});
}
{
 const s=seat({staticWorld:true});s.game.players[0].mp=10000;for(let n=0;n<10;n++)assert.equal(command(s.game,0,{t:'buy',unit:'rifle'}),undefined);
 const own=[...s.game.units.values()].filter(unit=>unit.owner===0&&!UNITS[unit.type].structure);own.forEach((unit,i)=>{unit.x=115+(i%5)*3;unit.z=115+Math.floor(i/5)*3;});s.refresh();
 const pairs=Array.from({length:10},(_,i)=>[own[0].id,own[i+1].id]);
 for(const ids of pairs){const first=s.order(ids,{x:133,z:130}),second=s.order(ids,{x:135,z:132});assert.equal(first.filter(row=>row.kind==='group-set').length,0);assert.equal(second.filter(row=>row.kind==='group-set').length,1);assert.ok(s.sent.slice(-2).every(row=>row.result===undefined));assert.ok(s.hands.groups.size<=9);}
 assert.equal(s.hands.groups.size,9);assert.deepEqual(s.hands.groups.get(1),pairs.at(-1));assert.ok([...s.hands.groups.keys()].every(key=>key>=1&&key<=9));assert.equal(s.log.filter(row=>row.kind==='group-set').length,10);proof.cases.push({nineKeyLRU:true,realSecondAcceptedBindings:10,oldestEvicted:true});
}

{
 const s=seat();for(let n=0;n<2;n++){s.refresh();assert.ok(enqueueDecision(s.hands,{t:'stop',ids:[1,3]},s.view,{operation:'advance',concern:'operation'}));s.run();}assert.ok(s.sent.every(row=>row.result===undefined));assert.equal(s.hands.operationHistory.size,0);assert.equal(s.hands.groups.size,0);proof.cases.push({repeatedNonMovementNoBinding:true});
}

console.log('PASS accepted group reuse, actual subsets, rejection, bounded history, member guards and nine-key LRU');
