// Watched danger changes an unsafe march, while point guards retain useful combat inputs.
import assert from 'node:assert/strict';
import { createGame, command, step, UNITS, inCover } from './shared/sim.js';
import { viewFor } from './shared/ai-view.js';
import { perceive } from './shared/ai-perception.js';
import { plan, think } from './shared/ai.js';

function fixture(types = ['rifle', 'tank'], guard = false, authoredCover = false) {
  const game = createGame({ w: 80, h: 80, rows: Array.from({length:80},(_,y)=>authoredCover&&y>=36&&y<=43 ? '.'.repeat(17)+'#'.repeat(5)+'.'.repeat(58) : '.'.repeat(80)),
    spawns: [{ x: 5, y: 5 }, { x: 75, y: 75 }], points: guard ? [{ x: 25, y: 40 }] : [] },
  ['AI', 'enemy'], false, [0, 1], [0, 1], { weather: false });
  game.units.clear();
  types.forEach((type, index) => {
    const slot = index === types.length - 1 ? 1 : 0;
    Object.assign(game.players[slot], { mp: 5000, fuel: 5000 });
    assert.equal(command(game, slot, { t: 'buy', unit: type }), undefined);
  });
  const own = [...game.units.values()].filter(unit => unit.owner === 0);
  const enemy = [...game.units.values()].find(unit => unit.owner === 1);
  own.forEach((unit, index) => Object.assign(unit,
    { x: 45 + index * 3, z: 79, auto: false, autoRetreat: true, holdFire: true }));
  Object.assign(enemy, { x: 75, z: 77, auto: false, holdFire: true });
  game.players.forEach(player => Object.assign(player, { mp: 0, mun: 200, fuel: 0 }));
  if (guard) game.points[0].owner = 0;
  const memory = { human: { camera: { x: 55, z: 75, yaw: 0, distance: 60 },
    persona: { pressure: 1, opening: [] } } }, projection = {}, inspections = [], danger = [];
  const look = () => perceive(viewFor(game, 0, projection), 0, memory.human, game.tick);
  // These calls test the production decision layer; physical dispatch is exercised separately below.
  const decide = (view = look(), concern = { kind: 'combat', x: 55, z: 75 }, level = 'normal') => {
    const decisions = [];
    plan(view, 0, { human: true, level, concern,
      requestInspection: cmd => inspections.push(cmd), requestDangerMove: (id, at) => danger.push({ id, ...at }) }, memory, cmd => {
      decisions.push(structuredClone(cmd));
      return undefined;
    });
    return decisions;
  };
  return { game, own, enemy, memory, look, decide, inspections, danger };
}
const ownMoves = (commands, id) => commands.filter(cmd => cmd.t === 'move'
  && cmd.orders.some(row => row[0] === id));


const summaries = [];
function caseScene(variant = 'stationary', enemyType = 'tank', softType = 'rifle') {
 const f = fixture([softType, enemyType]), unit=f.own[0];
 step(f.game); f.game.tick=300; f.look(); f.decide(); f.game.tick+=8;
 unit.hp=UNITS[softType].models*UNITS[softType].hpPer*.4;
 if(variant==='moving')assert.equal(command(f.game,0,{t:'amove',orders:[[unit.id,53,63]]}),undefined);
 if(variant==='healthy')unit.hp=UNITS[softType].models*UNITS[softType].hpPer;
 if(variant==='garrison')Object.assign(unit,{garrison:0,cover:3});
 if(variant==='retreating')unit.retreating=true;
 if(variant==='held')unit.nade={x:f.enemy.x,z:f.enemy.z,t:1};
 if(variant==='building')unit.build=1;
 if(variant==='digging')unit.dig={x:45,z:79};

 const view=f.look(), concern={kind:'combat',unitId:unit.id,x:unit.x,z:unit.z};
 if(variant==='no-safe')view.flags=Array(view.w*view.h).fill(1);
 if(variant==='offscreen')view.screenIds.delete(unit.id);
 if(variant==='remembered')view.screenIds.delete(f.enemy.id);
 if(variant==='not-attended')concern.kind='production';
 if(variant==='wrong-attended')concern.unitId=999;
 if(variant==='diagnostic-labels')for(const event of view.events)Object.assign(event,{responseRequired:false,responseUnits:[999],responsePolicy:'fake',responseReason:'ignored'});
 const commands=f.decide(view,concern), moves=ownMoves(commands,unit.id);
 return {f,unit,view,concern,commands,moves};
}
for(const variant of ['stationary','moving','diagnostic-labels','healthy','garrison','retreating','held','building','digging','offscreen','remembered','no-safe','not-attended','wrong-attended']) {
 const {f,unit,view,concern,commands,moves}=caseScene(variant);
 if(['stationary','moving','diagnostic-labels'].includes(variant)) {
  assert.equal(f.danger.length,1, `${variant}: one actual local danger destination`);
  assert.equal(moves.length,1);const row=moves[0].orders.find(row=>row[0]===unit.id);
  assert.ok(Math.hypot(row[1]-f.enemy.x,row[2]-f.enemy.z)>=UNITS.tank.w.range+4);
  assert.equal(command(f.game,0,moves[0]),undefined);
  f.game.tick+=2;assert.equal(f.decide(f.look(),concern).filter(c=>c.t==='move').length,0,'an existing safe escape is not replaced');
 } else assert.equal(f.danger.length,0, `${variant}: no new local danger response`);
 summaries.push({variant,danger:f.danger});
}
{
 const {f}=caseScene('stationary','tank','at');assert.equal(f.danger.length,0,'anti-tank crew retains its counter role');
}
{
 const {f}=caseScene('stationary','tankdestroyer');
 // At30m, a local24m destination can genuinely leave the destroyer's46m reach.
 assert.equal(f.danger.length,1,'actual visible tank destroyer is a threat, independent of narrow ARMOR taxonomy');
}
{
 const {f}=caseScene('stationary','rocket');
 assert.equal(f.danger.length,1,'a visible rocket weapon admits a real local minimum-range escape');
 assert.ok(Math.hypot(f.danger[0].x-f.enemy.x,f.danger[0].z-f.enemy.z)<=UNITS.rocket.w.minRange-4,'the known destination is inside the actual rocket dead zone');
}

function coverScene(variant='cover') {
 const f=fixture(variant==='neighbor-grenade'?['mg','rifle','rifle']:['mg','rifle'],false,true),unit=f.own[0];Object.assign(f.enemy,{x:47.6,z:79});
 // Known authored open-ground cover is broad enough to contain an ordinary imprecise formation endpoint.

 step(f.game);f.game.tick=300;f.look();f.decide();f.game.tick+=8;unit.hp=50;unit.supp=55;
 if(variant==='neighbor-grenade')assert.equal(command(f.game,0,{t:'ability',ids:[f.own[1].id],x:f.enemy.x,z:f.enemy.z}),undefined);
 const view=f.look(),event=view.events.find(e=>e.kind==='screen-damage'&&e.unitId===unit.id);
 assert.ok(event&&event.observedDanger.lossShare>=.25&&event.observedDanger.suppressionBand==='suppressed');
 const concern={kind:'combat',event:'screen-damage',eventId:event.id,unitId:unit.id,x:unit.x,z:unit.z};
 if(variant==='protected')view.units.get(unit.id).retreating=true;
 if(variant==='no-cue')view.events=[];
 if(variant==='no-cover')view.flags=Array(view.w*view.h).fill(0);
 if(variant==='covered'){view.flags=[...view.flags];const c=Math.floor(unit.z/2)*80+Math.floor(unit.x/2);view.flags[c]=4;}
 const decisions=f.decide(view,concern,'hard');
 if(variant==='cover') {assert.equal(f.danger.length,1);const at=f.danger[0];assert.ok(view.flags[Math.floor(at.z/2)*80+Math.floor(at.x/2)]&4);assert.ok(Math.hypot(at.x-f.enemy.x,at.z-f.enemy.z)>Math.hypot(unit.x-f.enemy.x,unit.z-f.enemy.z));}
 else assert.equal(f.danger.length,0, `${variant}: suppressed cue has no justified local improvement`);
 return {f,unit,event,concern};
}
for(const variant of ['cover','protected','no-cue','no-cover','covered','neighbor-grenade'])coverScene(variant);

function nativeScene(kind) {
 const f=fixture(kind==='cover'?['mg','rifle']:['rifle','tank'],false,kind==='cover'),unit=f.own[0],inputs=[],accepted=[],projection={};
 if(kind==='cover'){
  Object.assign(f.enemy,{x:47.6,z:79});

 }
 const level=kind==='cover'?'hard':'normal'; let delivered,event;
 step(f.game);f.game.tick=300;f.look();f.decide();f.game.tick=308;
 unit.hp=kind==='cover'?50:40;unit.supp=kind==='cover'?55:0;const hitTick=f.game.tick;
 // Real hands and perception establish their own baseline before the actual observed injury.
 for(let n=0;n<220;n++) {
  if(!delivered||f.game.tick%2===0)delivered=viewFor(f.game,0,projection);
  think(f.game,0,{memory:f.memory,view:delivered,seed:42,level,inputLog:input=>inputs.push(structuredClone(input)),submit:cmd=>{
   const result=command(f.game,0,cmd);if(result===undefined)accepted.push({tick:f.game.tick,command:structuredClone(cmd)});return result;
  }});
  if(!event){const created=f.memory.human.events?.find(e=>e.kind==='screen-damage'&&e.unitId===unit.id&&e.tick>=hitTick);if(created)event=structuredClone(created);}
  step(f.game);if(accepted.some(row=>row.command.t==='move'&&row.tick>=hitTick))break;
 }
 const response=accepted.find(row=>row.command.t==='move'&&row.tick>=hitTick);
 assert.ok(response,`${kind}: actual default commander issues accepted ordinary move`);
 assert.ok(inputs.some(input=>input.tick>=hitTick&&input.kind.startsWith('select-')),'actual physical selection precedes issuing');
 assert.ok(response.tick>=hitTick+4,'actual response retains the causal minimum');
 const issuing=inputs.find(input=>input.tick===response.tick&&input.command?.t==='move');
 assert.ok(issuing&&issuing.eventTick===event.tick,'physical response retains its actual immutable event creation clock');
 assert.deepEqual(f.memory.human.events.find(created=>created.id===event.id),event,'ordinary response preserves the original immutable creation descriptor');
 assert.ok(!Object.hasOwn(event,'responseRequired'),'runtime action does not consume grader labels');
 const row=response.command.orders.find(row=>row[0]===unit.id);
 if(kind==='cover')assert.ok(f.game.flags[Math.floor(row[2]/2)*80+Math.floor(row[1]/2)]&4,'actual noisy physical command lands in known better cover');
 else assert.ok(Math.hypot(row[1]-f.enemy.x,row[2]-f.enemy.z)>UNITS.tank.w.range,'actual physical destination leaves visible vehicle reach');
 for(let n=0;n<220&&unit.path.length;n++)step(f.game);
 if(kind==='cover')assert.ok(inCover(f.game,unit),'ordinary path movement really reaches protective cover');
 else assert.ok(Math.hypot(unit.x-f.enemy.x,unit.z-f.enemy.z)>UNITS.tank.w.range,'ordinary path movement actually leaves the watched weapon reach');
 console.log(`${kind}: hit${hitTick}, event${event.tick}, accepted native move${response.tick}`);
 return {kind,hitTick,eventTick:event.tick,acceptedTick:response.tick,inputs,accepted};
}
const native=[nativeScene('armor'),nativeScene('cover')];
console.log('Attended stationary armor and suppressed-hit cover: native actions, observed destinations, protected negatives and creation floors PASS');
