import assert from 'node:assert/strict';
import { createGame, teamFog, TERRAIN, CELL } from './shared/sim.js';
import { observe, think } from './shared/ai.js';
import { viewFor, commanderViewFor } from './shared/ai-view.js';
const map={w:40,h:40,rows:Array(40).fill('.'.repeat(40)),spawns:[{x:5,y:5},{x:35,y:35}],points:[]};
let checks=0;
function fixture(){const g=createGame(map,['A','B'],false,[0,1],[0,1],{weather:false,supply:false});const own=[...g.units.values()].find(u=>u.owner===0),enemy=[...g.units.values()].find(u=>u.owner===1);g.units=new Map([[own.id,own],[enemy.id,enemy]]);Object.assign(own,{x:20,z:20,type:'rifle',garrison:-1});Object.assign(enemy,{x:65,z:65,type:'rifle',garrison:-1});for(const p of g.players)p.visible=new Set();g.height=new Int8Array(g.w*g.h);return {g,own,enemy,memory:{}};}
function shots(g,cells=Array.from({length:g.w*g.h},(_,i)=>i)){g.shots=cells.map(cell=>({k:'contact',local:true,tag:cell,x:(cell%g.w+.5)*CELL,z:(Math.floor(cell/g.w)+.5)*CELL,y:1,time:g.tick/20,f:999999,fo:1}));}
function compare(f,label,cells){shots(f.g,cells);const before=structuredClone(f.g),full=viewFor(f.g,0,f.memory),fast=observe(f.g,0);assert.deepEqual(fast.snapshot,full.snapshot,label);assert.deepEqual(f.g,before,label+' authoritative immutability');assert.equal(fast.snapshot.shots.some(s=>s.f===999999),false);if(label==='initial moving source')assert.ok(fast.snapshot.shots.length>0&&fast.snapshot.shots.length<3,'positive and negative cell controls');checks++;return fast;}
const f=fixture();f.g.visionTick=0;compare(f,'initial moving source',[0,410,1599]);
// Ask new cells only after all live context has changed under the same key.
f.own.x=35;f.g.smokes=[{x:28,z:20,r:9}];f.g.flags[10*f.g.w+12]=TERRAIN.B;f.g.height[10*f.g.w+13]=4;f.g.terrainVersion++;compare(f,'same-key frozen source and terrain');
f.g.visionTick=1;compare(f,'moved source generation');f.g.visionTick=2;compare(f,'stationary source generation');
f.g.smokes[0].x=50;f.g.smokes[0].r=22;f.g.visionTick=3;compare(f,'same smoke identity preserves historical cached cells');
f.g.smokes=[{...f.g.smokes[0]}];f.g.visionTick=4;compare(f,'replacement smoke invalidates cached cells');
f.g.flags[10*f.g.w+12]=0;f.g.height[10*f.g.w+13]=0;f.g.terrainVersion++;f.g.visionTick=5;compare(f,'terrain block invalidation');
f.g.wx={rain:.8,wet:0,wind:0,strength:0};f.g.visionTick=6;compare(f,'rain changes source range');
Object.assign(f.own,{type:'bunker',x:20,z:20});f.g.visionTick=7;compare(f,'building unconditional sight');
Object.assign(f.own,{type:'fighter',air:{state:'out'}});f.g.visionTick=8;compare(f,'airborne unrestricted sight');f.own.air.state='base';f.g.visionTick=9;compare(f,'grounded aircraft contributes no sight');
f.g.strikes=[{kind:'recon',live:true,owner:0,x:60,z:40,dir:.73}];f.g.visionTick=10;compare(f,'recon strip exact bounds');
f.g.strikes=[];f.enemy.cells=[0,1,40,41];f.g.players[0].visible.add(f.enemy.id);f.g.visionTick=11;compare(f,'seen footprint override');
delete f.enemy.cells;f.g.visionTick=12;compare(f,'seen point override');
Object.assign(f.own,{type:'rifle',x:-4,z:10});delete f.own.air;f.g.visionTick=13;compare(f,'off-map source exact los fallback');
// A canonical mask realized before movement must win over a fresh sparse context.
const h=fixture();h.g.visionTick=0;teamFog(h.g,0);h.own.x=40;compare(h,'matching canonical history');h.g.visionTick=1;compare(h,'stale canonical private fallback');
// Hidden enemy details cannot change effect filtering; visible footprint is a separate negative control.
const q=fixture();q.g.visionTick=0;const before=compare(q,'hidden baseline');q.enemy.hp=1;q.enemy.type='bunker';q.g.visionTick=1;const after=compare(q,'hidden perturbation');assert.deepEqual(after.snapshot.shots,before.snapshot.shots);
// Reusing a caller token in a different game cannot reuse the first game's context.
const one=fixture(),two=fixture(),shared={};one.g.visionTick=0;two.g.visionTick=0;two.own.x=60;shots(one.g);shots(two.g);
commanderViewFor(one.g,0,shared);
const reused=commanderViewFor(two.g,0,shared),fresh=viewFor(two.g,0,{});
assert.deepEqual(reused.snapshot.shots,fresh.snapshot.shots,'new game resets sparse context despite same token and key');checks++;
// Public and commander histories remain independent when their calls interleave.
const inter=fixture();inter.g.visionTick=0;shots(inter.g);const ref={};
viewFor(inter.g,0,ref);observe(inter.g,0);inter.own.x+=15;
assert.deepEqual(observe(inter.g,0).snapshot.shots,viewFor(inter.g,0,ref).snapshot.shots,'fast then public history retains same-key context');
inter.g.visionTick=1;assert.deepEqual(viewFor(inter.g,0,ref).snapshot.shots,observe(inter.g,0).snapshot.shots,'public then fast next-key history');checks+=2;
// Default think without opts.view must retain the same effect-observation history.
const direct=fixture();direct.g.visionTick=0;shots(direct.g);const directRef={};const expected=viewFor(direct.g,0,directRef);
think(direct.g,0,{level:'normal',submit:()=>undefined});direct.own.x+=15;
assert.deepEqual(observe(direct.g,0).snapshot.shots,expected.snapshot.shots,'default think uses frozen sparse context');checks++;
// Walk the same planner-visible graphs used by the selected-HUD privacy proof.
const privacy=fixture(),plannerMemory={},secret='point-fog-private-context-probe';privacy.g.visionTick=0;shots(privacy.g);
privacy.g.privateProbe=secret;privacy.own.privateProbe=secret;privacy.enemy.privateProbe=secret;
privacy.g.smokes=[{x:28,z:20,r:3,privateProbe:secret}];privacy.g.privateOracle=()=>secret;
think(privacy.g,0,{memory:plannerMemory,level:'normal',submit:()=>undefined});
const visited=new Set(),values=[],functions=[];
function walk(value){
 if(value===null||(typeof value!=='object'&&typeof value!=='function')){values.push(value);return;}
 if(visited.has(value))return;visited.add(value);if(typeof value==='function')functions.push(value.name);
 if(value instanceof Map)for(const[k,v]of value){walk(k);walk(v);}
 if(value instanceof Set)for(const v of value)walk(v);
 for(const key of Reflect.ownKeys(value)){const descriptor=Object.getOwnPropertyDescriptor(value,key);if(descriptor&&Object.hasOwn(descriptor,'value'))walk(descriptor.value);}
}
assert.ok(plannerMemory.human?.view,'default think exposes its ordinary perceived view to the planner');
walk({view:plannerMemory.human.view,memory:plannerMemory});
for(const raw of [privacy.g,privacy.g.units,privacy.own,privacy.enemy,privacy.g.flags,privacy.g.height,privacy.g.smokes,privacy.g.smokes[0],privacy.g.privateOracle])
 assert.equal(visited.has(raw),false,'planner graph cannot reach an authoritative object or callback');
assert.equal(values.includes(secret),false,'planner graph cannot reach private sparse context data');
for(const name of ['pointFogVisible','pointSource','query'])assert.equal(functions.includes(name),false,'sparse query callbacks stay private');checks++;
// World still produces the full private mask and visible-cell list required by world terrain.
const world=createGame(map,['A','B'],false,[0,1],[0,1],{mode:'world',worldSize:'huge',worldSeed:183,weather:false,supply:false});
const worldOwn=[...world.units.values()].find(u=>u.owner===0);world.shots=[{k:'contact',local:true,x:worldOwn.x,z:worldOwn.z,y:1,time:.1,f:999999,fo:1}];
const worldSlow={},worldFast={},worldExpected=viewFor(world,0,worldSlow),worldBefore=structuredClone(world);
const worldActual=commanderViewFor(world,0,worldFast);assert.deepEqual(worldActual.snapshot,worldExpected.snapshot,'World commander preserves full-mask snapshot behavior');
const worldMask=worldFast.fog.get(world.players[0].team);assert.ok(worldMask?.vis instanceof Uint8Array);assert.equal(worldMask.vis.length,world.w*world.h);assert.ok(Array.isArray(worldMask.visibleCells));
assert.deepEqual(world,worldBefore,'World fallback leaves authoritative state unchanged');checks++;
console.log(`AI sparse point fog: ${checks} history, visibility, planner privacy and World fallback checks passed`);
