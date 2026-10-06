import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import * as sim from './shared/sim.js';
import * as ai from './shared/ai.js';
import * as commander from './shared/ai-commander.js';
import * as hands from './shared/ai-hands.js';
import * as projection from './shared/ai-view.js';

export function runExpansionYield(control='positive',level='hard',engine={sim,ai,commander,hands,projection}) {
  const {sim,ai,commander,hands,projection}=engine,originalRandom=Math.random;
  let seed=1;Math.random=()=>{let t=seed+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};
  try {
    const game=sim.createGame({w:80,h:80,rows:Array(80).fill('.'.repeat(80)),spawns:[{x:20,y:40},{x:75,y:40}],points:[{x:65,y:40,vp:2},{x:20,y:10,vp:0}]},['AI','opponent'],false,[0,1],[0,1],{weather:false});
    game.units.clear();game.players[0].mp=5000;
    for(const [index,type]of ['rifle','rifle','mg'].entries()) {
      assert.equal(sim.command(game,0,{t:'buy',unit:type}),undefined);
      Object.assign([...game.units.values()].at(-1),{x:53+index*6,z:77+index*5,auto:false,autoRetreat:true});
    }
    game.points.forEach(point=>{point.owner=1;point.capper=1;point.progress=1;});
    game.players[0].mp=game.players[0].mun=game.players[0].fuel=0;game.tick=4000;
    const camera={x:61,z:81,yaw:0,distance:60},concern={id:'production',kind:'production',x:41,z:81,since:4000,until:10000};
    const state={camera,startedTick:0,concern,deliberateUntil:4002,decisionStartedTick:4000,
      attention:{visits:new Map(),current:{...concern},since:4000,until:10000},
      hands:hands.createHands({slot:0,level,seed:1,camera,startedTick:0}),
      persona:{family:'support',pressure:1,opening:['mg']},buys:3};
    state.hands.openingDone=true;state.hands.openingUntil=0;
    const memory={human:state},projectionMemory={},setupInputs=[],setupReceipts=[],riders=[],pendingGoals=[];
    let delivered;
    function turn(inputs,receipts,calls) {
      if(!delivered||game.tick%2===0)delivered=projection.commanderViewFor(game,0,projectionMemory);
      commander.runCommander(delivered,0,{tick:game.tick,level,seed:1,inputLog:input=>inputs.push(structuredClone(input))},memory,cmd=>{
        const result=sim.command(game,0,cmd);receipts.push({tick:game.tick,command:structuredClone(cmd),accepted:result===undefined,rejection:result??null,selected:[...state.hands.selected],concern:state.concern.id});return result;
      },(view,slot,opts,mem,submit)=>{
        const call={tick:game.tick,concern:structuredClone(opts.concern),proposals:[]};
        if(riders.length)call.riders=riders.map(({id})=>({unit:structuredClone(view.units.get(id)),screen:view.screenIds.has(id)}));
        if(pendingGoals.length)call.pendingMoves=pendingGoals.map(id=>({unit:structuredClone(view.units.get(id)),screen:view.screenIds.has(id)}));
        ai.plan(view,slot,opts,mem,cmd=>{const result=submit(cmd);call.proposals.push({command:structuredClone(cmd),result:result??null});return result;});calls?.push(call);
      });
    }
    // The real commander forms and physically stages its own persistent assault first.
    for(let i=0;i<500;i++) {
      turn(setupInputs,setupReceipts);
      const assault=memory.mind?.assault;
      if(assault?.state==='assemble'&&assault.members.length===3&&assault.members.every(member=>member.acknowledged))break;
      sim.step(game);
    }
    const assault=memory.mind?.assault;
    assert.equal(assault?.state,'assemble','the native planner really creates the staging operation');
    assert.ok([0,1].includes(assault.point));assert.equal(assault.members.length,3);
    assert.ok(assault.members.every(member=>member.acknowledged),'every staging member receives an accepted ordinary command');
    assert.ok(setupInputs.some(input=>input.kind.startsWith('select-'))&&setupInputs.some(input=>input.command?.orders),'staging pays real selections and issuing inputs');
    // The authored checkpoint resumes after those actual staging orders finish walking.
    for(let i=0;i<300&&[...game.units.values()].some(unit=>unit.path.length);i++)sim.step(game);
    assert.ok([...game.units.values()].every(unit=>!unit.path.length),'the engine completes staging before the expansion look');
    const actorIds=assault.members.filter(member=>member.role==='line').map(member=>member.id);
    if(control==='moving')for(const member of assault.members) {
      const goal=game.points[assault.point];
      assert.equal(sim.command(game,0,{t:'move',orders:[[member.id,goal.x,goal.z]]}),undefined);
    }
    if(control==='unseen')for(const member of assault.members)Object.assign(game.units.get(member.id),{x:145,z:145});
    if(control==='riding') {
      game.players[0].mp=5000;
      const accepted=cmd=>{
        const result=sim.command(game,0,cmd);
        setupReceipts.push({tick:game.tick,command:structuredClone(cmd),accepted:result===undefined,rejection:result??null,phase:'carrier-control'});
        assert.equal(result,undefined,'the native carrier control uses accepted ordinary commands');
      };
      for(const member of assault.members) {
        accepted({t:'buy',unit:'halftrack'});
        const carrier=[...game.units.values()].at(-1),actor=game.units.get(member.id);
        Object.assign(carrier,{x:actor.x,z:actor.z,holdPos:true,auto:false,autoRetreat:true});
        accepted({t:'board',ids:[actor.id],target:carrier.id});
        riders.push({id:actor.id,carrierId:carrier.id});
      }
      game.players[0].mp=0;sim.step(game);
      for(const rider of riders) {
        assert.equal(game.units.get(rider.id).riding,rider.carrierId,'the engine completes boarding before public delivery');
        accepted({t:'move',orders:[[rider.carrierId,145,145]]});
        assert.ok(game.units.get(rider.carrierId).path.length,'the carrier really moves while its squad is unavailable');
      }
    }
    if(control==='no-work') {
      game.points[assault.point].x=assault.stage.x;game.points[assault.point].z=assault.stage.z;
      game.points.forEach(point=>{point.owner=0;point.capper=0;point.progress=1;point.cut=false;});
    }
    const started=game.tick,until=started+50;
    const other=1-assault.point,point=game.points[other],concernId=`point:${other}`;
    state.concern={id:concernId,kind:'expansion',point:other,x:point.x,z:point.z,since:started,until};
    Object.assign(state.attention,{current:{...state.concern},since:started,until});
    state.planned=false;state.noWorkUntil=0;state.deliberateUntil=started+2;state.decisionStartedTick=started;
    delivered=null;
    const inputs=[],receipts=[],calls=[],frames=[];
    for(let i=0;i<160;i++) {
      if(control==='pending-move'&&i===2) {
        for(const member of assault.members) {
          const unit=game.units.get(member.id),cmd={t:'move',orders:[[member.id,unit.x+.3,unit.z]]};
          assert.equal(sim.command(game,0,cmd),undefined,'the pending-move control starts actual accepted movement');
          setupReceipts.push({tick:game.tick,command:cmd,accepted:true,rejection:null,phase:'pending-move-control'});
          pendingGoals.push(member.id);
        }
        for(let j=0;j<40&&pendingGoals.some(id=>game.units.get(id).path.length);j++)sim.step(game);
        assert.ok(pendingGoals.every(id=>!game.units.get(id).path.length&&game.units.get(id).worldGoal),'the engine reaches its actual empty-path frame before clearing the pending goal');
        delivered=null;
      }
      turn(inputs,receipts,calls);
      frames.push({tick:game.tick,concern:structuredClone(state.concern),noWorkUntil:state.noWorkUntil,screenIds:[...state.view.screenIds],camera:structuredClone(state.camera)});
      if(control==='pending-move'&&i===2)break;
      sim.step(game);
    }
    return {control,level,started,until,concernId,actorIds,riders,pendingGoals,setupInputs,setupReceipts,inputs,receipts,calls,frames};
  } finally {Math.random=originalRandom;}
}

if(import.meta.url===pathToFileURL(process.argv[1]).href) {
  const positive=runExpansionYield(),controls=['moving','unseen','no-work','riding','pending-move'].map(control=>runExpansionYield(control));
  const empty=positive.calls.find(call=>call.concern.id===positive.concernId);
  assert.ok(empty.proposals.some(row=>row.result==='attention'&&row.command.t==='amove'),'the native advance first reaches the actual unrelated-point attention boundary');
  const frame=positive.frames.find(frame=>frame.tick===empty.tick);
  assert.equal(frame.noWorkUntil,empty.tick+8,'yield retains the full Hard no-work interval');
  assert.equal(frame.concern.until,empty.tick,'the watched blocked advance ends only the empty attention visit');
  assert.ok(!positive.calls.some(call=>call.tick>empty.tick&&call.tick<frame.noWorkUntil),'no new plan skips the preserved wait');
  const response=positive.receipts.find(row=>row.accepted&&row.command.t==='amove'&&positive.actorIds.every(id=>row.command.orders.some(order=>order[0]===id)));
  assert.ok(response&&response.tick<positive.until,'an accepted useful advance follows the yield before the original dwell would end');
  assert.deepEqual([...response.selected].sort((a,b)=>a-b),[...positive.actorIds].sort((a,b)=>a-b),'the real dispatch selects exactly both line actors');
  const paid=positive.inputs.filter(input=>input.tick<=response.tick&&input.inputStartedTick>=frame.noWorkUntil);
  assert.ok(paid.some(input=>input.kind.startsWith('select-'))&&paid.some(input=>input.command?.t==='amove'),'the advance pays its actual selection and issuing input');
  assert.ok(paid.every(input=>input.motorTicks>0&&input.tick===input.inputStartedTick+input.motorTicks),'every completed motor gesture pays its full interval');
  const selections=paid.filter(input=>input.kind.startsWith('select-'));
  assert.deepEqual([...selections.at(-1).ids].sort((a,b)=>a-b),[...positive.actorIds].sort((a,b)=>a-b),'the completed physical selection contains both actual line members');
  assert.ok(selections.every(input=>input.ids.every(id=>positive.frames.find(frame=>frame.tick===input.tick).screenIds.includes(id))),'every actual selection is camera-local at completion');
  for(const control of controls) {
    const call=control.calls.find(call=>call.concern.id===control.concernId);
    if(call)assert.equal(control.frames.find(frame=>frame.tick===call.tick).concern.until,control.until,`${control.control}: no watched blocked advance shortens the visit`);
    assert.ok(!control.inputs.some(input=>input.tick<control.until),`${control.control}: no extra physical input is added during the original empty visit`);
  }
  assert.equal(controls.find(control=>control.control==='no-work').inputs.length,0,'the quiet owned guard scene adds no filler input');
  const riding=controls.find(control=>control.control==='riding'),ridingCall=riding.calls.find(call=>call.concern.id===riding.concernId);
  assert.ok(ridingCall.proposals.some(row=>row.result==='attention'&&row.command.t==='amove'&&riding.actorIds.every(id=>row.command.orders.some(order=>order[0]===id))),'native riding members still reach the same refused advance boundary');
  assert.ok(ridingCall.riders.every(row=>row.screen&&row.unit.flags&sim.RIDING_FLAG&&row.unit.enter<0&&!row.unit.path.length&&!row.unit.orders.length),'owner-visible riding flags exclude unavailable actors even after boarding clears');
  const pending=controls.find(control=>control.control==='pending-move'),pendingCall=pending.calls.find(call=>call.concern.id===pending.concernId);
  assert.ok(pendingCall.proposals.some(row=>row.result==='attention'&&row.command.t==='amove'),'the real pending movement reaches the same refused advance boundary');
  assert.ok(pendingCall.pendingMoves.every(row=>row.screen&&row.unit.worldGoal&&!row.unit.path.length),'the empty-path delivery still contains actual pending movement goals');
  for(const level of ['easy','normal']) {
    const neighbor=runExpansionYield('positive',level),call=neighbor.calls.find(call=>call.concern.id===neighbor.concernId);
    assert.equal(neighbor.frames.find(frame=>frame.tick===call.tick).concern.until,neighbor.until,`${level}: the Hard skill change does not alter the neighboring difficulty`);
  }
  if(process.env.AI_EXPANSION_YIELD_PROOF)await writeFile(process.env.AI_EXPANSION_YIELD_PROOF,JSON.stringify({positive,controls}));
  console.log(`PASS watched blocked assault advance: full eight-tick wait, paid selection and accepted movement ${response.tick}; moving, pending move, unseen, riding, quiet and neighboring difficulty controls pass.`);
}
