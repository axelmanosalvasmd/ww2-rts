import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as sim from './shared/sim.js';
import * as ai from './shared/ai.js';
import { initializePublicStart } from './shared/ai-commander.js';
const allowed = new Set(['w','h','spawn','level','seed']);
const setup = new Proxy({ w: 64, h: 64, spawn: { x: 20, z: 30 }, level: 'hard', seed: 6 }, {
  get(target,key) { assert.ok(allowed.has(key), `Forbidden setup read: ${String(key)}`); return target[key]; },
  ownKeys() { throw Error('Public start must not enumerate a hidden graph'); }
});
const mem = {}, game = new Proxy({tick:0}, { get(target,key) { assert.equal(key,'tick'); return target[key]; } });
assert.equal(ai.startCommander(game,1,setup,{memory:mem}),true);
assert.equal(mem.human.startedTick,0); assert.equal(mem.human.hands.openingUntil,30);
assert.equal(mem.human.hands.openingDeadline,80);
assert.deepEqual(Object.keys(mem),['human']);
assert.equal(mem.human.hands.queue.length,0); assert.equal(mem.human.hands.active,null);
assert.equal(mem.human.hands.inputTicks.length,0); assert.equal(mem.human.hands.selected.length,0);
assert.equal(mem.human.hands.resolveMinimap,undefined);
assert.equal(mem.human.camera.x,20);setup.spawn.x=999; assert.equal(mem.human.camera.x,20);
const captured=structuredClone({...mem.human,hands:{...mem.human.hands,rng:{...mem.human.hands.rng}}});
assert.equal(initializePublicStart(setup,1,mem),false);assert.deepEqual(mem.human,captured);
for (const tick of [1,2,29,30,1.5]) {
 const late={}; assert.equal(ai.startCommander({tick},1,setup,{memory:late}),false);assert.deepEqual(late,{});
}
for (const option of [{decisionOnly:true},{handoff:true}]) {
 const skipped={}; assert.equal(ai.startCommander({tick:0},1,setup,{...option,memory:skipped}),false);assert.deepEqual(skipped,{});
}
const legacy=await import('./tools/legacy-ai/ai.js');
assert.equal(legacy.startCommander,undefined,'legacy module has no initializer and uses its old schedule');
const map=JSON.parse(fs.readFileSync(new URL('./maps/default.json',import.meta.url)));
function seededRandom(initial){let value=initial>>>0;return()=>{let t=value+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;};}
const originalRandom=Math.random,rows=[];
try {
 for(const [mode,level,seed] of [['conquest','hard',6],['classic','hard',6],['world','hard',6],['world','normal',4],['world','easy',4]]) {
  Math.random=seededRandom(seed);
  const g=sim.createGame(map,['A','B','C'],true,[0,1,2],[0,1,2],{mode,worldSeed:seed,army:'standard'});
  const before=structuredClone(g),views=[],logs=g.players.map(()=>({inputs:[],commands:[]}));
  for(let slot=0;slot<g.players.length;slot++) ai.startCommander(g,slot,{w:g.w,h:g.h,spawn:g.players[slot].spawn,level,seed});
  assert.deepEqual(g,before,'public setup changes no authoritative state');
  assert.ok(logs.every(log=>!log.inputs.length&&!log.commands.length));
  let firstDelivery;
  for(let n=0;n<182;n++) {
   sim.step(g);
   if(g.tick%2===0) { const cache=sim.snapshotCache(g);g.players.forEach((_,slot)=>views[slot]=ai.observe(g,slot,cache));firstDelivery??=g.tick; }
   for(let slot=0;slot<g.players.length;slot++) if(views[slot]) ai.think(g,slot,{view:views[slot],level,seed,
    inputLog:input=>logs[slot].inputs.push(structuredClone(input)),submit:cmd=>{const result=sim.command(g,slot,cmd);logs[slot].commands.push({tick:g.tick,command:structuredClone(cmd),accepted:result===undefined});return result;}});
  }
  assert.equal(firstDelivery,2);
  assert.ok(logs.every(log=>log.inputs.every(input=>input.tick>=30)));
  assert.ok(logs.every(log=>log.commands[0]?.accepted === true), 'first native order is actually accepted');
  const first=logs.map(log=>log.commands[0]?.tick);
  const [lo,hi]={hard:[40,80],normal:[60,120],easy:[80,160]}[level];
  assert.ok(first.every(tick=>tick>=lo&&tick<=hi),`${mode} ${level}: ${first}`);
  if(level==='hard')assert.equal(first[1],80);
  rows.push({mode,level,seed,firstDelivery,firstNativeTicks:first,logs});
 }
 // A takeover without public-start setup still begins its own full fresh look at the actual late frame.
 Math.random=seededRandom(6);
 const g=sim.createGame(map,['A','B','C'],true,[0,1,2],[0,1,2]);
 while(g.tick<90)sim.step(g);
 const lateMemory={},lateInputs=[],lateCommands=[];
 const delivered=ai.observe(g,1,sim.snapshotCache(g));
 ai.think(g,1,{view:delivered,memory:lateMemory,level:'hard',seed:6,handoff:true,inputLog:i=>lateInputs.push(i),submit:c=>lateCommands.push(c)});
 assert.equal(lateMemory.human.startedTick,90);assert.equal(lateMemory.human.hands.openingUntil,120);
 assert.equal(lateInputs.length,0);assert.equal(lateCommands.length,0);
 if (process.env.WW2_AI_PUBLIC_START_PROOF) fs.writeFileSync(process.env.WW2_AI_PUBLIC_START_PROOF,JSON.stringify({rows,lateStartedTick:90,lateOpeningUntil:120},null,2));
 console.log(JSON.stringify(rows.map(({logs,...row})=>row),null,2));
 console.log('AI public start: forbidden reads, detached setup, no commands, actor delivery2, original bands and late fresh look PASS');
} finally {Math.random=originalRandom;}
