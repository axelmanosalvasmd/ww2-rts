import assert from 'node:assert/strict';
import {createGame,command,step,UNITS,teamSees} from './shared/sim.js';
import {think} from './shared/ai.js';
import {viewFor} from './shared/ai-view.js';
import {createHands} from './shared/ai-hands.js';
import {perceive,onScreen} from './shared/ai-perception.js';
function fixture(variant='positive') {
 const originalRandom=Math.random;let seed=23;Math.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
 try{return nativeFixture(variant)}finally{Math.random=originalRandom}
}
function nativeFixture(variant){
 const rows=Array(80).fill('.'.repeat(80));
 rows[60]=rows[60].slice(0,43)+(variant==='wrong-house'?'H':'B')+rows[60].slice(44);
 if(variant==='unseen-house')for(let z=60;z<62;z++)rows[z]=rows[z].slice(0,43)+'BB'+rows[z].slice(45);
 const map={w:80,h:80,rows,spawns:[{x:69,y:57},{x:11,y:57}],points:[{x:40,y:60,vp:1,mp:0}]};
 const game=createGame(map,['a','b'],false,[0,1],[0,1],{weather:false,...(variant==='ground-placement'?{mode:'classic'}:{})});
 const actor=variant==='ground-placement'?[...game.units.values()].find(u=>u.owner===0&&u.type==='engineer'):[...game.units.values()].filter(u=>u.owner===0&&u.type==='rifle')[1];assert.ok(actor);
 for(const unit of game.units.values())if(unit.owner===0&&unit.id!==actor.id&&!UNITS[unit.type].building)game.units.delete(unit.id);
 Object.assign(actor,{x:83.2,z:125.8,hp:70,autoRetreat:false,auto:false});
 if(variant==='ground-placement')Object.assign(actor,{x:game.nodes[0].x-6,z:game.nodes[0].z+2,hp:60});
 assert.equal(command(game,0,{t:'stop',ids:[actor.id]}),undefined);
 game.points[0].owner=0;game.points[0].progress=1;game.players[0].mp=variant==='ground-placement'?150:0;
 step(game);
 const camera={x:63.95989188197758,z:114.88339091961933,yaw:1.035376784858271,distance:60};
 if(variant==='already-framed')camera.x+=4;
 if(variant==='ground-placement')Object.assign(camera,{x:actor.x,z:actor.z});
 const hands=createHands({slot:0,seed:17,level:'hard',camera,startedTick:0});hands.openingUntil=0;
 const concern={id:`idle:${actor.id}`,kind:'idle',unitId:actor.id,x:actor.x,z:actor.z,since:0,until:200};
 const memory={human:{camera,hands,concern,deliberateUntil:0,decisionStartedTick:0,attention:{current:concern,since:0,until:200,visits:new Map(),working:new Map([[concern.id,concern]]),waiting:new Map()}},seen:new Map(),node:new Map()};
 const initial=perceive(viewFor(game,0,{}),0,memory.human,game.tick);
 memory.human.interruptEvents=new Set(initial.newEvents.map(event=>event.id));
 assert.ok(initial.screenIds.has(actor.id));assert.equal(onScreen(variant==='ground-placement'?game.nodes[0]:{x:87,z:121},camera,initial),['already-framed','ground-placement'].includes(variant));
 if(variant==='remembered-only'){Object.assign(actor,{x:120,z:40});assert.equal(command(game,0,{t:'stop',ids:[actor.id]}),undefined);step(game);}
 const commands=[],inputs=[];
 for(let tick=0;tick<120;tick++){
  const delivered=viewFor(game,0,{});
  think(game,0,{level:'hard',memory,view:delivered,inputLog:input=>inputs.push(structuredClone(input)),submit:cmd=>{const selected=[...hands.selected],visible=['garrison','build'].includes(cmd.t)?teamSees(game,0,cmd):null,screen=['garrison','build'].includes(cmd.t)?onScreen(cmd,camera,delivered):null,mpBefore=game.players[0].mp;const result=command(game,0,cmd);commands.push({tick:game.tick,cmd:structuredClone(cmd),result:result??null,selected,visible,screen,mpBefore,mpAfter:game.players[0].mp});return result}});
  if(variant==='unavailable-actor'&&inputs.some(input=>input.concern===concern.id&&input.kind==='camera-pan'))actor.hp=0;
  step(game);
 }
 for(let tick=0;tick<120;tick++)step(game);
 return{variant,inputs,commands,garrison:actor.garrison,enter:actor.enter,actorId:actor.id,actorAlive:game.units.has(actor.id)&&actor.hp>0,depots:[...game.units.values()].filter(u=>u.owner===0&&u.type==='depot').map(u=>({id:u.id,built:u.built}))};
}
const positive=fixture();
assert.ok(positive.inputs.some(input=>input.kind==='camera-pan'),'the nearby house requires paid physical camera motion');
const accepted=positive.commands.find(row=>row.cmd.t==='garrison'&&row.result===null);assert.ok(accepted,'a native garrison command is accepted');
assert.deepEqual(accepted.selected,[positive.actorId]);assert.ok(accepted.visible&&accepted.screen,'the final clicked house is actually on screen and team visible');
assert.ok(positive.garrison>=0,'the native squad physically enters the house');
const pan=positive.inputs.find(input=>input.kind==='camera-pan'&&input.concern===`idle:${positive.actorId}`);
assert.equal(pan.tick-pan.inputStartedTick,pan.motorTicks,'the camera input pays its complete motor duration');
const select=positive.inputs.find(input=>input.kind.startsWith('select-')&&input.ids.includes(positive.actorId));const order=positive.inputs.find(input=>input.command?.t==='garrison');
assert.ok(pan.tick<select.tick&&select.tick<order.tick,'the real camera input precedes physical selection and right click');
assert.ok(!positive.inputs.some(input=>input.kind==='minimap-rightclick'&&input.command?.t==='garrison'),'garrison never uses a minimap order');
const reports=[positive];
for(const variant of ['remembered-only','unseen-house','wrong-house','unavailable-actor']){const negative=fixture(variant);assert.ok(!negative.commands.some(row=>row.cmd.t==='garrison'&&row.result===null),'no accepted garrison with missing facts or actors: '+variant);if(variant==='unavailable-actor')assert.equal(negative.actorAlive,false,'the unavailable actor actually died in native stepping');reports.push(negative);}
const framed=fixture('already-framed');assert.ok(framed.commands.some(row=>row.cmd.t==='garrison'&&row.result===null));assert.ok(!framed.inputs.some(input=>input.kind==='camera-pan'&&input.concern===`idle:${framed.actorId}`),'an already framed house needs no extra camera input');reports.push(framed);
const ground=fixture('ground-placement');assert.ok(ground.inputs.some(input=>input.kind==='place-click'&&input.command?.t==='build'),'existing ground placement still pays for its physical click');assert.ok(ground.commands.some(row=>row.cmd.t==='build'&&row.result===null&&row.cmd.kind==='depot'&&row.visible&&row.screen&&row.mpBefore-row.mpAfter===UNITS.depot.cost),'the original ground placement still pays its native cost and succeeds');assert.ok(ground.depots.some(site=>site.built>0),'native construction actually advances the paid ground placement');reports.push(ground);
console.log('PASS paid native garrison framing and six controls');
