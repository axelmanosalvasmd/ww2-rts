import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createOrders } from './client/orders.js';
import { formation } from './shared/formation.js';
import { UNITS } from './shared/sim.js';
import { createHands, enqueueDecision, advanceHands, unprojectPointer } from './shared/ai-hands.js';
import { perceive } from './shared/ai-perception.js';
import { viewFor } from './shared/ai-view.js';
import { createGame, command } from './shared/sim.js';
const map=JSON.parse(fs.readFileSync(new URL('./maps/default.json',import.meta.url),'utf8'));
const originalRandom=Math.random;let randomSeed=4;Math.random=()=>{let t=randomSeed+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;};
let g;try {g=createGame(map,['A','B','C'],true,[0,1,2],[0,1,2],{mode:'world',worldSeed:4,army:'standard'});} finally {Math.random=originalRandom;}
const camera={x:43,z:79,yaw:-2.316304353498293,distance:60}, memory={}, state={camera}, observed=viewFor(g,0,memory);
const view=perceive(observed,0,state,0), unit=[...view.units.values()].find(u=>u.owner===0&&u.type==='rifle');
assert.ok(unit,'actual World-start rifle is delivered');
const evidence=[];
for(const fixture of [{level:'normal',actualClickPixel:{x:1805.143665551924,y:1062.7393399411144}},
 {level:'easy',actualClickPixel:{x:1810.96239058062,y:1062.6801656545426}}]) {
 const selected=new Set([unit.id]),commands=[];
 const ctx={selected,units:view.units,me:0,defs:UNITS,diggers:[],moveColor:0,formation:(troops,at)=>formation(troops,at,{defs:UNITS,width:g.w*2,height:g.h*2,terrainAt:()=>false}),together:()=>true,send:cmd=>commands.push(cmd),feedback:()=>{}};
 const ground=unprojectPointer(fixture.actualClickPixel,camera,view,{minimap:true});
 assert.ok(ground.x<0,'archived physical click falls outside the rotated world diamond');
 assert.equal(createOrders(ctx).dispatch({ground},{ctrlKey:true}),true,'human native order dispatcher accepts the canvas click');
 assert.equal(commands[0].orders[0][1],1,'human shared formation clamps the final actor destination');
 let outsideWorld=0;
 for(let seed=1;seed<=20;seed++) {
 const inputs=[],hands=createHands({slot:0,level:fixture.level,seed,camera,log:input=>inputs.push(structuredClone(input))});
 hands.selected=[unit.id];hands.openingDone=true;
 assert.ok(enqueueDecision(hands,{t:'amove',orders:[[unit.id,1,94]]},view,{concern:'edge'}));
 const accepted=[];
 for(let tick=30;tick<160;tick++)advanceHands(hands,tick,view,cmd=>{accepted.push(cmd);return command(g,0,cmd);});
 const input=inputs.find(c=>c.kind==='minimap-rightclick');assert.ok(input,'legal edge order has an actual paid minimap gesture');
 if(!accepted.length)continue;
 const actualGround=unprojectPointer(input.pointer.to,camera,view,{minimap:true});
 if(actualGround.x<0){outsideWorld++;assert.equal(accepted[0].orders[0][1],1,'off-world physical click clamps final slots like the human');}
 commands.length=0;createOrders(ctx).dispatch({ground:actualGround},{ctrlKey:true});
 assert.deepEqual({...accepted[0],queue:!!accepted[0].queue},commands[0],'actual native AI and human dispatcher produce identical complete commands at the same physical pixel');
 evidence.push({level:fixture.level,seed,actualGround,physical:input.pointer,human:commands[0],nativeAI:accepted[0]});
 }
 assert.ok(outsideWorld>0,'the fixed20seed fixture contains genuine noisy off-world pixels from legal intended destinations');
}
{
 const inputs=[],hands=createHands({slot:0,seed:4,camera,log:i=>inputs.push(i)});hands.selected=[unit.id];hands.openingDone=true;
 assert.ok(enqueueDecision(hands,{t:'move',orders:[[unit.id,-2048,-2048]]},view,{concern:'physical-miss'}));
 const commands=[];for(let tick=30;tick<180;tick++)advanceHands(hands,tick,view,cmd=>commands.push(cmd));
 assert.equal(commands.length,0,'a click physically outside the minimap canvas still misses');
 assert.ok(inputs.some(i=>i.kind==='minimap-rightclick'&&!i.command),'the missed physical gesture remains honestly recorded');
}
assert.equal(evidence.length,40,'both fixed20seed legal-edge populations complete real physical commands');
console.log('Actual human canvas dispatch and native AI off-world destination clipping passed.');
