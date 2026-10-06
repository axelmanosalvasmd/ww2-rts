// Exercise native selection reuse before an actual planner's two-squad retreat.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGame, command, step } from './shared/sim.js';
import { viewFor } from './shared/ai-view.js';
import { perceive } from './shared/ai-perception.js';
import { plan } from './shared/ai.js';
import * as after from './shared/ai-hands.js';

// Derive a test-only baseline that disables just the new one-companion selection route.
// All current reaction, motor, hit-test, group, locality and capacity rules stay in this module.
const sourceURL = new URL('./shared/ai-hands.js', import.meta.url);
const source = readFileSync(sourceURL, 'utf8');
const reuseStart = source.indexOf('      const missing = job.units.filter(unit => !hands.selected.includes(unit.id));');
const reuseEnd = source.indexOf('    }\n  }\n  if (job.inspect)', reuseStart);
assert.ok(reuseStart >= 0 && reuseEnd > reuseStart, 'the source control identifies only the new selection route');
const oldSelectionRoute = String.raw`      const box = job.ids.length > 1 ? selectionBox(job.units, hands, view) : null;
      if (box && sameIds(boxUnits(box, hands, view).map(u => u.id), job.ids)
        && boxSelectionFaster(box, job.units, hands, view)) add('select-box', centroid(job.units), { ids: job.ids, box, input: { button: 0 } });
      else for (let i = 0; i < job.units.length; i++) {
        add(i ? 'select-add-click' : 'select-click', job.units[i], { ids: job.ids.slice(0, i + 1), clickedId: job.units[i].id,
          input: { button: 0, shift: i > 0 }, unitTarget: true, noise: true });
      }
`;
const baselineSource = (source.slice(0, reuseStart) + oldSelectionRoute + source.slice(reuseEnd))
  .replace(/from (['"])(\.[^'"]+)\1/g, (_match, quote, specifier) =>
    `from ${quote}${new URL(specifier, sourceURL).href}${quote}`);
const before = await import(`data:text/javascript;base64,${Buffer.from(baselineSource).toString('base64')}`);

function scene(api,selection){
 const original=Math.random;Math.random=()=>.5;
 const g=createGame({w:80,h:80,rows:Array(80).fill('.'.repeat(80)),spawns:[{x:5,y:5},{x:70,y:70}],points:[]},['AI','enemy'],false,[0,1],[0,1],{weather:false});Math.random=original;g.units.clear();g.players[0].mp=5000;
 const own=[];for(let i=0;i<3;i++){assert.equal(command(g,0,{t:'buy',unit:'rifle'}),undefined);const u=[...g.units.values()].at(-1);Object.assign(u,{x:75+i*6,z:80,auto:false,autoRetreat:false,holdFire:true});own.push(u);}
 g.tick=240;g.players[0].mp=0;const inputs=[],receipts=[],camera={x:80,z:80,yaw:0,distance:60};
 const hands=api.createHands({slot:0,seed:27,level:'hard',camera,log:i=>inputs.push(structuredClone(i))}),state={camera,hands};
 const observe=()=>perceive(viewFor(g,0,{}),0,state);
 let view=observe();
 const advance=()=>{view=observe();api.advanceHands(hands,g.tick,view,cmd=>{const result=command(g,0,cmd);receipts.push({tick:g.tick,cmd:structuredClone(cmd),result:result??'accepted'});return result;});step(g);};
 const selected=selection==='subset'?own[0]:own[2];
 assert.ok(api.queueInspection(hands,[selected.id],view,{concernKind:'combat'}));
 for(let i=0;i<1200&&hands.selected[0]!==selected.id;i++)advance();
 assert.deepEqual(hands.selected,[selected.id],'selection comes from actual physical inspection');
 if(selection==='exact'){
  view=observe();assert.ok(api.enqueueDecision(hands,{t:'stance',ids:own.slice(0,2).map(u=>u.id),key:'holdFire',on:false},view,{concernKind:'combat'}));
  for(let i=0;i<1200&&!receipts.length;i++)advance();assert.deepEqual(new Set(hands.selected),new Set(own.slice(0,2).map(u=>u.id)));
 }
 view=observe();const prior=structuredClone(inputs);own.slice(0,2).forEach(u=>{u.hp=30;});step(g);view=observe();const events=view.newEvents.filter(e=>e.kind==='screen-damage');assert.equal(events.length,2);
 const proposals=[],mem={human:{persona:{pressure:1,opening:['rifle','mg','rifle'],economy:'barracks'},startedTick:0,buys:0},seen:new Map(),node:new Map()};
 plan(view,0,{human:true,level:'hard',seed:27,concern:{id:'local-damage',kind:'combat',x:78,z:80}},mem,cmd=>{proposals.push(structuredClone(cmd));return undefined;});
 const retreat=proposals.find(cmd=>cmd.t==='retreat');assert.ok(retreat,'actual planner responds to observed hurt with group retreat');assert.deepEqual(new Set(retreat.ids),new Set(own.slice(0,2).map(u=>u.id)));
 const created=g.tick;assert.ok(api.enqueueDecision(hands,retreat,view,{concernKind:'combat',event:events[0],eventTick:created,reactionStartTick:created,responseEvents:events,responseActorIds:retreat.ids}));
 for(let i=0;i<1200&&!receipts.some(r=>r.cmd.t==='retreat');i++)advance();
 const receipt=receipts.find(r=>r.cmd.t==='retreat');assert.ok(receipt&&receipt.result==='accepted');assert.ok(own.slice(0,2).every(u=>u.retreating),'same actual two actors enter native retreat');assert.equal(own[2].retreating,false);
 const causal=inputs.filter(i=>i.tick>=created&&i.responseEvents?.some(e=>e.id===events[0].id));assert.ok(causal.length&&causal[0].tick-created>=4,'unchanged causal floor');
 for(const input of causal)assert.equal(input.tick-input.inputStartedTick,input.motorTicks,'every causal physical gesture completes its full motor duration');
 const selectionInputs=causal.filter(i=>i.kind.startsWith('select-'));
 return {selection,created,firstTick:causal[0].tick,firstLatency:(causal[0].tick-created)/20,acceptedTick:receipt.tick,acceptedLatency:(receipt.tick-created)/20,prior,selectionInputs,causal,receipt};
}
const rows=[];for(const selection of ['subset','outside','exact']){
 const b=scene(before,selection),a=scene(after,selection);assert.deepEqual(a.prior,b.prior,'native prior selection timeline identical');assert.deepEqual(a.receipt.cmd,b.receipt.cmd,'same actual native group command');
 if(selection==='subset'){assert.deepEqual(b.selectionInputs.map(input=>input.kind),['select-click','select-add-click']);assert.equal(a.selectionInputs[0]?.kind,'select-add-click');assert.equal(a.selectionInputs[0]?.input.shift,true);assert.equal(a.selectionInputs[0].input.button,0,'adding a companion pays an actual left click');assert.equal(a.selectionInputs.length,1);assert.equal(b.selectionInputs.length,2,'selection reuse saves a real repeated selection click');assert.deepEqual(new Set(a.selectionInputs[0].ids),new Set(a.receipt.cmd.ids),'the paid click retains exactly both native recipients');assert.ok(a.firstLatency>=.3&&b.firstLatency>=.3,'both real first selections retain the Hard reaction budget');assert.ok(a.acceptedLatency<b.acceptedLatency);}
 else {assert.deepEqual(a,b,'unrelated/exact actual selection retains complete native timeline');}
 rows.push({selection,before:b,after:a});
}
console.log('AI selection reuse: native two-squad retreat and unrelated/exact selection controls PASS.');
