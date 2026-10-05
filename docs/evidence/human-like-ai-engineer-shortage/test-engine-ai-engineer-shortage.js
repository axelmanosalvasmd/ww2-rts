import assert from 'node:assert/strict';
import { plan } from './shared/ai.js';
import { createGame, command, step, UNITS } from './shared/sim.js';
import { viewFor } from './shared/ai-view.js';
import { perceive, startCamera } from './shared/ai-perception.js';
import { createHands, enqueueDecision, queueInspection, queueCamera, advanceHands } from './shared/ai-hands.js';
const map={w:80,h:80,rows:Array(80).fill('.'.repeat(80)),spawns:[{x:25,y:40},{x:75,y:40}],points:[]};
function fixture(faction, existing=1, mode='classic') {
 const game=createGame(map,['AI','enemy'],false,[0,1],[faction,(faction+1)%3],{mode,weather:false});
 if(existing===0)for(const unit of [...game.units.values()])if(unit.owner===0&&unit.type==='engineer')game.units.delete(unit.id);
 game.players[0].mp=2000;game.tick=200;
 const projection={},camera=startCamera(viewFor(game,0,projection),0),inputs=[];
 const memory={seen:new Map(),node:new Map(),human:{startedTick:0,camera,cycle:1,buys:0,persona:{family:'aggressive',pressure:1,opening:[]}}};
 const hands=memory.human.hands=createHands({slot:0,seed:1,level:'hard',camera,startedTick:0,log:x=>inputs.push(structuredClone(x))});
 const inspect=()=>perceive(viewFor(game,0,projection),0,memory.human);
 return {game,memory,hands,inputs,inspect,hq:[...game.units.values()].find(u=>u.owner===0&&u.type==='hq')};
}
function actualInspect(f,id) {
 assert.equal(queueInspection(f.hands,[id],f.inspect(),{concern:'inspection',concernKind:'production',cycle:0}),true);
 for(let i=0;i<200&&(f.hands.active||f.hands.queue.length);i++){step(f.game);advanceHands(f.hands,f.game.tick,f.inspect(),()=>assert.fail('inspection cannot issue an order'));}
 assert.deepEqual(f.hands.selected,[id]);
 assert.ok(f.inputs.some(input=>input.kind==='select-click'||input.kind==='select-box'));
}
function execute({faction=0,level='normal',existing=1,queued=0,selection='none',stale=false,mode='classic'}={}) {
 const f=fixture(faction,existing,mode);
 if(selection==='multi-buildings') {
  const second=structuredClone(f.hq);second.id=f.game.nextId++;second.type='barracks';second.x+=12;second.queue=[];second.productionJobs=[];f.game.units.set(second.id,second);
  f.secondProducer=second;
  for(const unit of f.game.units.values())if(unit.owner===0&&!UNITS[unit.type].structure){unit.x=40;unit.z=105;}
 }
 const setupPurchases=[];
 for(let i=0;i<queued;i++) {
  if(!['hq','multi-buildings','building-unit','offscreen','missing-hud','wrong-slot'].includes(selection)) { assert.equal(command(f.game,0,{t:'buy',unit:'engineer',from:f.hq.id}),undefined); continue; }
  assert.equal(enqueueDecision(f.hands,{t:'buy',unit:'engineer'},f.inspect(),{concern:'production',concernKind:'production',cycle:0}),true);
  for(let tick=0;tick<200&&(f.hands.active||f.hands.queue.length);tick++) {
   step(f.game);advanceHands(f.hands,f.game.tick,f.inspect(),cmd=>{const result=command(f.game,0,cmd);setupPurchases.push({tick:f.game.tick,command:structuredClone(cmd),accepted:result===undefined});return result;});
  }
  assert.deepEqual(f.hands.selected,[f.hq.id]);assert.equal(setupPurchases.at(-1).accepted,true);
 }
 const executionInputStart=f.inputs.length;
 if(selection==='rifle')actualInspect(f,[...f.game.units.values()].find(u=>u.owner===0&&u.type==='rifle').id);
 if(['multi-buildings','building-unit'].includes(selection)) {
  const other=selection==='multi-buildings'?f.secondProducer:[...f.game.units.values()].find(u=>u.owner===0&&u.type==='rifle');
  assert.equal(enqueueDecision(f.hands,{t:'rally',ids:[f.hq.id,other.id],x:f.game.players[0].spawn.x+8,z:f.game.players[0].spawn.z+8},f.inspect(),{concern:'production',concernKind:'production',cycle:0}),true);
  for(let tick=0;tick<200&&(f.hands.active||f.hands.queue.length);tick++){step(f.game);advanceHands(f.hands,f.game.tick,f.inspect(),cmd=>command(f.game,0,cmd));}
  assert.ok(f.hands.selected.includes(f.hq.id)&&f.hands.selected.includes(other.id)&&f.hands.selected.length>=2,'negative control physically selects both intended actors');
  if(selection==='multi-buildings')assert.ok(f.hands.selected.every(id=>UNITS[f.game.units.get(id).type].building));
 }
 if(selection==='offscreen') {
  assert.equal(queueCamera(f.hands,{x:140,z:140,yaw:0,distance:60},{concern:'offscreen-test',concernKind:'expansion',cycle:0},'minimap'),true);
  for(let tick=0;tick<400&&(f.hands.active||f.hands.queue.length);tick++){step(f.game);advanceHands(f.hands,f.game.tick,f.inspect(),()=>assert.fail('camera gesture cannot issue a simulation order'));}
  assert.equal(f.inspect().screenIds.has(f.hq.id),false);
 }
 const view=f.inspect();if(stale)view.selectedHUD.observedTick-=2;
 if(selection==='missing-hud')delete view.selectedHUD;
 if(selection==='wrong-slot')view.selectedHUD.slot=1;
 let queueTypeReadAttempts=0;
 for (const producer of view.units.values()) if (producer.owner === 0 && UNITS[producer.type].building && Array.isArray(producer.queue))
  Object.defineProperty(producer.queue, 'filter', { enumerable: false, value: function (...args) {
   queueTypeReadAttempts++; return Array.prototype.filter.call(this, ...args);
  } });
 const planned=[];
 plan(view,0,{human:true,level,concern:{id:'production',kind:'production',x:f.game.players[0].spawn.x,z:f.game.players[0].spawn.z}},f.memory,cmd=>{
  // This focused boundary executes purchases; other planner work remains outside the fixture.
  if(cmd.t!=='buy')return 'attention';planned.push(structuredClone(cmd));return undefined;
 });
 const startMP=f.game.players[0].mp,accepted=[];
 if(selection==='offscreen') {
  assert.equal(queueCamera(f.hands,f.game.players[0].spawn,{concern:'return-to-producer',concernKind:'production',cycle:1},'minimap'),true);
  for(let tick=0;tick<400&&(f.hands.active||f.hands.queue.length);tick++){step(f.game);advanceHands(f.hands,f.game.tick,f.inspect(),()=>assert.fail('camera gesture cannot issue a simulation order'));}
 }
 for(const cmd of planned)assert.equal(enqueueDecision(f.hands,cmd,f.inspect(),{concern:'production',concernKind:'production',cycle:1}),true);
 for(let i=0;i<300&&(f.hands.active||f.hands.queue.length);i++) {
  step(f.game);advanceHands(f.hands,f.game.tick,f.inspect(),cmd=>{
   const mpBefore=f.game.players[0].mp,result=command(f.game,0,cmd);accepted.push({tick:f.game.tick,command:structuredClone(cmd),accepted:result===undefined,reason:result??null,mpBefore,mpAfter:f.game.players[0].mp,actualTrainingQueue:f.hq?[...f.hq.queue]:null});return result;
  });
 }
 assert.equal(f.hands.active,null);assert.equal(f.hands.queue.length,0);assert.ok(accepted.every(row=>row.accepted));
 const buys=accepted.filter(row=>row.command.t==='buy'),buyInputs=f.inputs.slice(executionInputStart).filter(row=>row.command?.t==='buy');assert.equal(buyInputs.length,buys.length);
 const row={faction,level,existingEngineers:existing,preexistingQueuedEngineers:queued,selection,stale,mode,setupPurchases,actualSelectionAtPlan:view.selectedHUD?.ids??[],queueTypeReadAttempts,planned,acceptedBuys:buys,nativeBuyInputCount:buyInputs.length,productionDecision:f.memory.human.production,mpAtExecutionStart:startMP};return row;
}
// One observed engineer needs one more, regardless of the difficulty's batch size.
for (const faction of [0, 1, 2]) for (const level of ['easy', 'normal', 'hard']) {
 const result = execute({ faction, level });
 assert.equal(result.acceptedBuys.filter(row => row.command.unit === 'engineer').length, 1);
 assert.equal(result.nativeBuyInputCount, 1, 'one actual production click fills the observed shortage');
 assert.ok(result.acceptedBuys.every(row => row.mpBefore - row.mpAfter === UNITS.engineer.cost));
}
for (const level of ['normal', 'hard']) {
 const limit = level === 'normal' ? 2 : 3;
 const empty = execute({ level, existing: 0 });
 assert.equal(empty.acceptedBuys.length, 2, 'zero observed engineers still permits the existing target of two');
 const known = execute({ level, queued: 1, selection: 'hq' });
 assert.equal(known.acceptedBuys.filter(row => row.command.unit === 'engineer').length, 0);
 assert.equal(known.queueTypeReadAttempts, 1, 'the actual singleton producer HUD supplies its queue types');
 assert.equal(known.acceptedBuys.length, limit, 'satisfying the engineer target leaves ordinary Classic combat batches intact');
 assert.ok(known.acceptedBuys.every(row => row.command.unit === 'rifle'));
 for (const [selection, stale] of [
  ['none', false], ['rifle', false], ['hq', true], ['missing-hud', false],
  ['wrong-slot', false], ['offscreen', false], ['multi-buildings', false], ['building-unit', false],
 ]) {
  const negative = execute({ level, queued: 1, selection, stale });
  assert.equal(negative.acceptedBuys.filter(row => row.command.unit === 'engineer').length, 1,
   `${selection}: unavailable queue types cannot reduce the observed shortage`);
  assert.equal(negative.queueTypeReadAttempts, 0, `${selection}: no hidden queue types are inspected`);
 }
 const ordinary = execute({ level, mode: 'conquest' });
 assert.equal(ordinary.acceptedBuys.length, limit, 'ordinary combat multi-purchase remains unchanged');
 assert.ok(ordinary.acceptedBuys.every(row => row.command.unit !== 'engineer'));
 assert.equal(ordinary.queueTypeReadAttempts, 0, 'other modes do no engineer queue work');
}
console.log('Human engineer target shortage: native purchases, singleton HUD and selection negatives passed.');
