import assert from 'node:assert/strict';
import {createGame,command,step,UNITS,abCost,supCost} from './shared/sim.js';
import {plan} from './shared/ai.js';
import {viewFor} from './shared/ai-view.js';
import {perceive,onScreen} from './shared/ai-perception.js';
import {chooseConcern,deferEmptyCombat,emptyCombatDeferred,emptyCombatFacts} from './shared/ai-attention.js';
import {runCommander} from './shared/ai-commander.js';
import {createHands,queueCamera,advanceHands} from './shared/ai-hands.js';
function protectedFight(level) {
  const rows = Array(80).fill('.'.repeat(80));
  rows[40] = '.'.repeat(65) + 'B' + '.'.repeat(14);
  const game = createGame({ w: 80, h: 80, rows,
    spawns: [{ x: 25, y: 40 }, { x: 75, y: 40 }], points: [{ x: 65, y: 40 }] },
  ['AI', 'enemy'], false, [0, 1], [0, 1], { weather: false });
  game.units.clear();
  game.players.forEach(player => { player.mp = 5000; });
  assert.equal(command(game, 0, { t: 'buy', unit: 'rifle' }), undefined);
  assert.equal(command(game, 1, { t: 'buy', unit: 'rifle' }), undefined);
  const [holder, enemy] = game.units.values();
  Object.assign(holder, { x: 129, z: 81, holdFire: true, auto: true, autoRetreat: true });
  Object.assign(enemy, { x: 145, z: 85, holdFire: true });
  step(game);
  assert.equal(command(game, 0, { t: 'garrison', ids: [holder.id], x: 131, z: 81 }), undefined);
  for (let i = 0; i < 40; i++) step(game);
  assert.ok(holder.garrison >= 0, 'the ordinary garrison command puts the real squad inside the house');
  Object.assign(holder, { targetId: enemy.id, holdFire: false });
  game.points[0].owner = 0; game.points[0].vp = 1;
  game.players[0].mp = 300; game.players[0].mun = 0;
  for (const kind of Object.keys(game.players[0].sup)) game.players[0].sup[kind] = 1000;
  game.tick = 200;
  const camera = { x: 131, z: 81, distance: 60, yaw: 0 }, inputs = [];
  const state = { camera, startedTick: 0,
    hands: createHands({ slot: 0, level, seed: 27, camera, startedTick: 0 }),
    persona: { family: 'support', pressure: 1, opening: ['mg'] }, buys: 0, cycle: 1 };
  const memory = { human: state }, view = perceive(viewFor(game, 0, memory), 0, state);
  assert.ok(view.screenIds.has(holder.id) && view.players[0].visible.has(enemy.id),
    'both the protected squad and its opponent are genuinely delivered on camera');
  assert.equal(view.units.get(holder.id).targetId, enemy.id);
  assert.ok(!onScreen(game.players[0].spawn, camera, view), 'production is outside the combat camera');
  state.concern = chooseConcern(view, 0, state, level, () => .5);
  assert.equal(state.concern.kind, 'combat', 'the delivered fight wins the initial attention competition');
  return { game, holder, enemy, memory, state, view, inputs };
}

function held(level='hard'){
 const f=protectedFight(level),c={...f.state.concern};deferEmptyCombat(f.view,0,f.state,c,200,level);
 f.game.tick=202;const v=perceive(viewFor(f.game,0,f.memory),0,f.state);
 const alias={...c,id:'alert:the-same-inspected-fight',x:c.x+1,z:c.z+1};
 assert.equal(deferEmptyCombat(v,0,f.state,alias,202,level),true,'two different aliases exhaust one actual inspected screen');
 assert.equal(emptyCombatDeferred(v,0,f.state,c),true);
 return {...f,c,alias,retryAt:f.state.emptyCombatVisits.get(alias.id).retryAt};
}
const results=[];
for(const level of ['easy','normal','hard']){
 const f=held(level),future={...f.view,tick:203};
 assert.equal(f.retryAt-202,{easy:160,normal:100,hard:60}[level],'existing retry interval is unchanged');
 for(const name of ['alert:older-alert','fight:another-cluster','stimulus:another-label'])assert.equal(emptyCombatDeferred(future,0,f.state,{...f.c,id:name}),true,'same-screen aliases share the yield');
 assert.equal(emptyCombatDeferred({...future,tick:f.retryAt},0,f.state,f.c),false,'bounded retry always restores eligibility');
 f.holder.hp-=5;f.enemy.hp-=5;f.enemy.x+=4;f.game.tick=204;
 const drift=perceive(viewFor(f.game,0,f.memory),0,f.state);
 assert.equal(emptyCombatDeferred(drift,0,f.state,f.c),true,'five-percent health drift and an eight-metre-coordinate boundary do not create work');
 const poisoned={...drift,events:drift.events.map(e=>({...e,responseRequired:true,responseUnits:[f.holder.id],responseReason:'heavy-loss',responsePolicy:'bogus'}))};
 assert.equal(emptyCombatFacts(drift,0,f.c,f.state.camera,level),emptyCombatFacts(poisoned,0,f.c,f.state.camera,level),'diagnostic population labels do not reopen the area');
 const oracle={...drift,snapshot:{units:[{id:987,hp:1,x:2,z:2}],flags:[999]},roomTerrain:{flags:[999]},counterfactual:{readyActors:[987]},units:new Map([...drift.units,[987,{...drift.units.get(f.holder.id),id:987,hp:1,x:2,z:2,owner:1}]])};
 assert.equal(emptyCombatFacts(drift,0,f.c,f.state.camera,level),emptyCombatFacts(oracle,0,f.c,f.state.camera,level),'raw snapshot, room terrain and off-camera oracle detail cannot create a delivered work cue');
 const dropped={...drift,screenIds:new Set([...drift.screenIds].filter(id=>id!==f.enemy.id))};assert.equal(emptyCombatDeferred(dropped,0,f.state,f.c),true,'one unit leaving the screen removes a possibility rather than creating work');
 const distant={...f.c,id:'fight:distant',x:20,z:20};assert.equal(emptyCombatDeferred(drift,0,f.state,distant),false,'a remote camera area is never suppressed');
 const pose={...f.state.camera};const fringe={...f.c,x:pose.x,z:pose.z-30};assert.ok(onScreen(fringe,pose,drift));f.state.camera={...pose,yaw:pose.yaw+Math.PI};assert.ok(!onScreen(fringe,f.state.camera,drift));assert.equal(emptyCombatDeferred(drift,0,f.state,fringe),false,'a concern outside the rotated camera cannot borrow old screen deferral');f.state.camera={...pose,distance:30};assert.ok(!onScreen(fringe,f.state.camera,drift));assert.equal(emptyCombatDeferred(drift,0,f.state,fringe),false,'zoom cannot suppress an area absent from the current frame');f.state.camera=pose;
 results.push({level,retryTicks:f.retryAt-202,aliasesSuppressed:true,minorDriftSuppressed:true,privateFieldsIgnored:true,distantAndYawNegative:true});
}
{
 const f=held(); f.game.players[0].mp=5000;assert.equal(command(f.game,0,{t:'buy',unit:'rifle'}),undefined);
 const ready=[...f.game.units.values()].at(-1);Object.assign(ready,{x:105,z:81,holdFire:true,autoRetreat:true});f.game.points.push({...f.game.points[0],x:100,z:90,owner:-1});f.game.tick=204;
 const v=perceive(viewFor(f.game,0,f.memory),0,f.state);assert.ok(v.screenIds.has(ready.id));assert.equal(emptyCombatDeferred(v,0,f.state,f.c),false,'a genuinely delivered idle companion supplies new usable work');
 const cmds=[];plan(v,0,{human:true,level:'hard',concern:{id:`idle:${ready.id}`,kind:'idle',unitId:ready.id,x:ready.x,z:ready.z}},f.memory,cmd=>{cmds.push(cmd);return undefined;});assert.ok(cmds.some(cmd=>cmd.orders?.some(row=>row[0]===ready.id)||cmd.ids?.includes(ready.id)),'the real planner can use the newly ready actor');for(const cmd of cmds)assert.equal(command(f.game,0,cmd),undefined,'new actor work crosses the ordinary command boundary');results.push({newActor:ready.id,actualPlannerCommands:cmds});
}
{
 for(const newHostile of [false,true]){
  const f=held(),oldCamera={...f.state.camera};let target;
  if(newHostile){f.game.players[1].mp=5000;assert.equal(command(f.game,1,{t:'buy',unit:'mg'}),undefined);target=[...f.game.units.values()].at(-1);Object.assign(target,{x:133,z:107,holdFire:true});for(let i=0;i<5;i++)step(f.game);}
  f.game.tick=208;let v=perceive(viewFor(f.game,0,f.memory),0,f.state);assert.equal(emptyCombatDeferred(v,0,f.state,f.c),true,'an off-camera hostile cannot reopen the already inspected area');
  assert.equal(queueCamera(f.state.hands,{x:131,z:91},{concern:'paid-overlapping-screen'},'pan'),true);const inputs=[];f.state.hands.log=row=>inputs.push(row);
  let tick=208;for(;tick<250&&(f.state.hands.active||f.state.hands.queue.length);tick++){f.game.tick=tick;advanceHands(f.state.hands,tick,v,()=>assert.fail('camera movement cannot issue a synthetic squad command'));}
  assert.ok(inputs.some(row=>row.kind.startsWith('camera')),'the overlapping screen is reached by an actual paid camera gesture');assert.ok(tick<f.retryAt);
  f.game.tick=tick;v=perceive(viewFor(f.game,0,f.memory),0,f.state);
  if(newHostile){assert.ok(!onScreen(target,oldCamera,v)&&v.screenIds.has(target.id),'the real hostile appears only in the new delivered overlap');assert.equal(emptyCombatDeferred(v,0,f.state,f.c),false,'new work at the edge of an overlapping screen restores eligibility');}
  else assert.equal(emptyCombatDeferred(v,0,f.state,f.c),true,'a paid small pan without new useful work shares the existing area deferral');
  results.push({paidCameraOverlap:true,newHostile,tick,camera:{...f.state.camera}});
 }
}
{
 const f=held();f.game.players[1].mp=5000;assert.equal(command(f.game,1,{t:'buy',unit:'mg'}),undefined);
 const enemy=[...f.game.units.values()].at(-1);Object.assign(enemy,{x:146,z:85,holdFire:true});for(let i=0;i<5;i++)step(f.game);f.game.tick=208;
 const v=perceive(viewFor(f.game,0,f.memory),0,f.state);assert.ok(v.screenIds.has(enemy.id),JSON.stringify({enemy: {id:enemy.id,type:enemy.type,x:enemy.x,z:enemy.z},units:[...v.units].map(([id,u])=>[id,u.type,u.x,u.z,u.inventoryOnly]),camera:f.state.camera}));assert.equal(emptyCombatDeferred(v,0,f.state,f.c),false,'a genuinely new hostile restores attention');
 const accepted=[],inputs=[];let observation;
 for(let tick=208;tick<700&&!accepted.some(row=>row.cmd.t==='ability');tick++){
  f.game.tick=tick;if(!observation||tick%2===0)observation=viewFor(f.game,0,f.memory);
  runCommander(observation,0,{tick,level:'hard',seed:27,inputLog:row=>inputs.push(structuredClone(row))},f.memory,cmd=>{const result=command(f.game,0,cmd);if(result===undefined)accepted.push({tick,cmd:structuredClone(cmd)});return result;},plan);
 }
 assert.ok(inputs.some(row=>row.kind.startsWith('select-')),'the guard pays a real selection for its HUD');
 assert.ok(accepted.some(row=>row.cmd.t==='ability'&&row.cmd.ids.includes(f.holder.id)),'the new visible MG unlocks a real accepted guard ability');
 assert.ok(!accepted.some(row=>row.cmd.orders?.some(order=>order[0]===f.holder.id)),'the protected holder receives no filler movement');results.push({newHostile:enemy.id,accepted,physicalInputs:inputs});
}
{
 const f=held();f.game.players[1].mp=5000;assert.equal(command(f.game,1,{t:'buy',unit:'mg'}),undefined);
 const enemy=[...f.game.units.values()].at(-1);Object.assign(enemy,{x:146,z:85,holdFire:true});f.holder.cd=10;
 for(let i=0;i<5;i++)step(f.game);let observation,inputs=[],accepted=[];
 for(let tick=208;tick<600;tick++){
  f.game.tick=tick;if(!observation||tick%2===0)observation=viewFor(f.game,0,f.memory);
  runCommander(observation,0,{tick,level:'hard',seed:27,inputLog:row=>inputs.push(structuredClone(row))},f.memory,cmd=>{const result=command(f.game,0,cmd);if(result===undefined)accepted.push({tick,cmd:structuredClone(cmd)});return result;},plan);
  if(f.state.hands.selected.includes(f.holder.id)&&[...f.state.emptyCombatAreas.values()].some(area=>area.retryAt>tick))break;
 }
 assert.ok(inputs.some(row=>row.kind.startsWith('select-')),'the existing guard cooldown is read after a paid actual selection');
 const current=perceive(viewFor(f.game,0,f.memory),0,f.state),concern={...f.state.concern,id:'fight:ready-hud-alias'};
 assert.ok(current.units.get(f.holder.id).cdKnown&&current.units.get(f.holder.id).cd>0,'the actual singleton HUD exposes the positive cooldown');
 // Count the two verified empty looks in the current area after the HUD inspection.
 deferEmptyCombat(current,0,f.state,concern,f.game.tick,'hard');f.game.tick+=2;
 let v=perceive(viewFor(f.game,0,f.memory),0,f.state);deferEmptyCombat(v,0,f.state,{...concern,id:'alert:cooldown-alias'},f.game.tick,'hard');
 assert.equal(emptyCombatDeferred(v,0,f.state,concern),true,'a selected cooling guard has no ready cast');
 const before=f.game.tick;f.holder.cd=0;f.game.tick+=2;v=perceive(viewFor(f.game,0,f.memory),0,f.state);
 assert.equal(v.units.get(f.holder.id).cdKnown,true);assert.equal(v.units.get(f.holder.id).cd,0);
 assert.equal(emptyCombatDeferred(v,0,f.state,concern),false,'a genuinely newly ready selected HUD creates usable work before retry');
 for(let tick=f.game.tick;tick<before+240&&!accepted.some(row=>row.cmd.t==='ability');tick++){
  f.game.tick=tick;if(tick%2===0)observation=viewFor(f.game,0,f.memory);
  runCommander(observation,0,{tick,level:'hard',seed:27,inputLog:row=>inputs.push(structuredClone(row))},f.memory,cmd=>{const result=command(f.game,0,cmd);if(result===undefined)accepted.push({tick,cmd:structuredClone(cmd)});return result;},plan);
 }
 assert.ok(accepted.some(row=>row.cmd.t==='ability'&&row.cmd.ids.includes(f.holder.id)),'the newly ready guard actually issues its ordinary ability');for(let i=0;i<80&&f.holder.cd<=0;i++)step(f.game);assert.ok(f.holder.cd>0,'the accepted grenade is actually thrown and starts its cooldown');
 results.push({selectedHUDReadiness:true,accepted,physicalInputs:inputs});
}
{
 const rows=Array(80).fill('.'.repeat(80));rows[40]='.'.repeat(65)+'B'+'.'.repeat(14);rows[42]='.'.repeat(72)+'T'+'.'.repeat(7);
 const game=createGame({w:80,h:80,rows,spawns:[{x:25,y:40},{x:75,y:40}],points:[{x:65,y:40}]},['AI','enemy'],false,[0,1],[0,1],{mode:'classic',weather:false});
 const holder=[...game.units.values()].find(unit=>unit.owner===0&&unit.type==='rifle'),enemy=[...game.units.values()].find(unit=>unit.owner===1&&unit.type==='rifle');
 assert.ok(holder&&enemy,'the actual Classic starting rosters contain ordinary rifle squads');Object.assign(holder,{x:129,z:81,holdFire:true,autoRetreat:true});Object.assign(enemy,{x:145,z:85,holdFire:true});step(game);
 assert.equal(command(game,0,{t:'garrison',ids:[holder.id],x:131,z:81}),undefined);for(let i=0;i<40;i++)step(game);
 assert.ok(holder.garrison>=0);Object.assign(holder,{targetId:enemy.id,holdFire:false});game.players[0].mun=0;for(const kind of Object.keys(game.players[0].sup))game.players[0].sup[kind]=1000;game.tick=200;
 const camera={x:131,z:81,distance:60,yaw:0},state={camera,hands:createHands({slot:0,level:'hard',seed:27,camera,startedTick:0})},memory={human:state};let view=perceive(viewFor(game,0,memory),0,state);const concern={id:'fight:classic-cost',kind:'combat',x:131,z:81};
 assert.ok(view.screenIds.has(holder.id)&&view.screenIds.has(enemy.id));assert.ok(view.units.get(enemy.id).cover===1||view.units.get(enemy.id).cover===2,'the delivered enemy stands in the authored trench');deferEmptyCombat(view,0,state,concern,200,'hard');deferEmptyCombat(view,0,state,{...concern,id:'alert:classic-cost'},202,'hard');
 const cost=abCost(view,UNITS[holder.type].ab);assert.equal(cost,15);assert.equal(emptyCombatDeferred(view,0,state,concern),true,'a real Classic rifle without grenade munitions cannot create an available cast');
 game.players[0].mun=cost;game.tick=204;view=perceive(viewFor(game,0,memory),0,state);assert.equal(emptyCombatDeferred(view,0,state,concern),false,'the actual Classic ability price becoming affordable supplies a useful new option');
 assert.equal(command(game,0,{t:'ability',ids:[holder.id],x:enemy.x,z:enemy.z}),undefined);let earned=0;for(let i=0;i<80&&holder.cd<=0;i++){step(game);earned+=(game.players[0].munInc??0)*.05;}
 assert.ok(holder.cd>0,'the ordinary paid Classic grenade actually starts its cooldown');assert.ok(Math.abs(game.players[0].mun-earned)<1e-6,'the actual throw spends the entire fifteen-munitions price');results.push({classicAbilityAffordability:true,cost,actualCooldown:holder.cd});
}
{
 const f=held();f.holder.hp=55;f.game.tick=204;let v=perceive(viewFor(f.game,0,f.memory),0,f.state);
 deferEmptyCombat(v,0,f.state,f.c,204,'hard');deferEmptyCombat(v,0,f.state,f.alias,206,'hard');
 f.holder.hp=45;f.game.tick=208;v=perceive(viewFor(f.game,0,f.memory),0,f.state);
 assert.equal(emptyCombatDeferred(v,0,f.state,f.c),false,'a real watched health band and Hard retreat threshold crossing restores attention');
 const heavy=held();heavy.holder.hp-=30;heavy.game.tick=204;v=perceive(viewFor(heavy.game,0,heavy.memory),0,heavy.state);
 assert.ok(v.newEvents.some(event=>event.kind==='screen-damage'&&event.observedDanger.lossShare>=.25));
 assert.equal(emptyCombatDeferred(v,0,heavy.state,heavy.c),false,'a genuine heavy watched hit is not postponed by no-work deferral');
 results.push({healthBandAndRetreatCrossing:true,heavyWatchedHit:true});
}
{
 const f=held();const price=supCost(f.view,'artillery');f.game.players[0].sup.artillery=0;f.game.players[0][price.cur]=price.cost+100;
 let v=perceive(viewFor(f.game,0,f.memory),0,f.state);deferEmptyCombat(v,0,f.state,f.c,204,'hard');deferEmptyCombat(v,0,f.state,f.alias,206,'hard');
 assert.equal(emptyCombatDeferred(v,0,f.state,f.c),true,'affordable artillery with only an isolated ordinary rifle supplies no useful target');
 assert.equal(command(f.game,1,{t:'buy',unit:'mg'}),undefined);const target=[...f.game.units.values()].at(-1);Object.assign(target,{x:146,z:85,holdFire:true});for(let i=0;i<5;i++)step(f.game);
 f.game.players[0][price.cur]=price.cost+99;f.game.tick=220;v=perceive(viewFor(f.game,0,f.memory),0,f.state);const cmds=[];plan(v,0,{human:true,level:'hard',concern:f.c,requestInspection:()=>{}},f.memory,cmd=>{cmds.push(cmd);return undefined;});
 deferEmptyCombat(v,0,f.state,f.c,220,'hard');deferEmptyCombat(v,0,f.state,f.alias,222,'hard');assert.equal(emptyCombatDeferred(v,0,f.state,f.c),true,'a useful support target below its ordinary price plus reserve offers no action');
 f.game.players[0][price.cur]=price.cost+100;f.game.tick=300;v=perceive(viewFor(f.game,0,f.memory),0,f.state);
 assert.equal(emptyCombatDeferred(v,0,f.state,f.c),false,'an actually affordable useful local support target restores attention');
 const actual=[];plan(v,0,{human:true,level:'hard',concern:f.c,requestInspection:()=>{}},f.memory,cmd=>{actual.push(cmd);return command(f.game,0,cmd);});assert.ok(actual.some(cmd=>cmd.t==='support'&&cmd.kind==='artillery'),'the real planner chooses the restored ordinary artillery call');
 results.push({supportAffordability:true,price,actualPlannerCommands:actual});
}

console.log('Camera-area empty visits share bounded yield and restore only delivered usable work.');
