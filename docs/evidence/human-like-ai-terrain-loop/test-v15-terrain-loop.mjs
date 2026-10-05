import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {deserialize} from 'node:v8';
import {pathToFileURL} from 'node:url';
const [before='/tmp/ai-v15-terrain-loop-before',after='/tmp/ai-v15-terrain-loop-after',fixtures='/tmp/ai-exact-fog-fixtures.bin',out='/tmp/ai-v15-terrain-loop-controls.json']=process.argv.slice(2);
const modules=await Promise.all([before,after].map(root=>import(pathToFileURL(root+'/shared/sim.js'))));
let seed=10493,cases=0;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32};
const mutationCases=[
 g=>{},g=>g.flags[0]^=modules[0].SIGHT,g=>{if(g.height)g.height[0]++;},g=>g.height=null,g=>delete g.height,
 g=>g.height=Int8Array.from({length:g.w*g.h},(_,i)=>i%7-3),g=>g.fogTerrain.sight[0]^=1,
 g=>{if(g.fogTerrain.height)g.fogTerrain.height[0]++;},g=>g.fogTerrain.height=null,
 g=>g.fogTerrain.stamp[0]++,g=>g.fogTerrain.top[0]++,g=>g.fogTerrain.sat[0]++,g=>delete g.fogTerrain.stamp,
 g=>g.flags=new Uint16Array(g.flags),g=>g.fogTerrain.sight=new Uint8Array(0),g=>g.fogTerrain.stamp=new Uint32Array(0),
 g=>g.fogTerrain.stamp=g.fogTerrain.sight,g=>{if(g.height)g.fogTerrain.stamp=g.height;},
];
for(const[w,h]of[[0,0],[1,1],[2,7],[7,2],[8,8],[9,15],[17,19],[150,150]])for(const heightKind of ['null','undefined','levels']){
 const initial={w,h,flags:Uint16Array.from({length:w*h},()=>Math.floor(random()*4096)),height:heightKind==='levels'?Int8Array.from({length:w*h},()=>Math.floor(random()*8)-3):heightKind==='null'?null:undefined,terrainVersion:1};
 const pair=modules.map(()=>structuredClone(initial));const first=modules.map((m,i)=>m.fogTerrain(pair[i]));assert.deepEqual(first[0],first[1]);
 for(let i=0;i<2;i++){assert.equal(modules[i].fogTerrain(pair[i]),first[i]);if(pair[i].flags.length)pair[i].flags[0]^=modules[i].SIGHT;assert.equal(modules[i].fogTerrain(pair[i]),first[i],'same-key stale source preserves original cache');}
 for(const mutate of mutationCases){
  const games=pair.map(g=>structuredClone(g));games.forEach(mutate);const previous=games.map(g=>g.fogTerrain);games.forEach(g=>g.terrainVersion++);
  const result=modules.map((m,i)=>m.fogTerrain(games[i]));assert.deepEqual(games[0],games[1]);
  for(let i=0;i<2;i++){assert.equal(result[i],games[i].fogTerrain);if(previous[i].stamp!=null)assert.equal(result[i].stamp,previous[i].stamp);for(const key of ['sat','top','sight','height'])if(result[i][key]&&previous[i][key])assert.notEqual(result[i][key],previous[i][key]);}
  cases++;
 }
 // Repeated changes exercise timestamp history, negative elevation and dimensions crossing block edges.
 for(let pass=0;pass<5;pass++){
  const cell=w*h?Math.floor(random()*w*h):0;pair.forEach(g=>{if(g.flags.length)g.flags[cell]^=modules[0].SIGHT;if(g.height?.length)g.height[cell]=pass-3;g.terrainVersion++;});
  const old=pair.map(g=>g.fogTerrain);const result=modules.map((m,i)=>m.fogTerrain(pair[i]));assert.deepEqual(pair[0],pair[1]);for(let i=0;i<2;i++)assert.equal(old[i].stamp,result[i].stamp);cases++;
 }
}
// Access order matters if arrays or old cache fields are instrumented. This also checks stamp aliases.
for(const alias of [false,true]){
 const logs=[];
 const results=modules.map(m=>{
  const log=[];logs.push(log);const w=17,h=9,n=w*h,base=Array.from({length:n},(_,i)=>i%7-3);
  const tracked=(label,target)=>new Proxy(target,{get(t,k){log.push(['get',label,String(k)]);return Reflect.get(t,k);},set(t,k,v){log.push(['set',label,String(k),v]);return Reflect.set(t,k,v);}});
  const priorSight=tracked('oldSight',Array(n).fill(0)),priorHeight=tracked('oldHeight',[...base]);
  const height={slice:()=>tracked('height',[...base])};const old={version:0,sight:priorSight,height:priorHeight,stamp:alias?priorSight:tracked('stamp',Array(6).fill(0))};
  return m.fogTerrain({w,h,flags:new Uint16Array(n),height,terrainVersion:1,fogTerrain:old});
 });
 assert.deepEqual(logs[0],logs[1],'ordered reads and writes');assert.deepEqual(results[0],results[1]);cases++;
}
const captured=deserialize(readFileSync(fixtures));
for(const fixture of captured){
 const pair=modules.map(()=>structuredClone(fixture));const results=modules.map((m,i)=>{
  const f=pair[i];f.g.fogTerrain=f.f;f.g.terrainVersion=f.f.version+1;const terrain=m.fogTerrain(f.g);const result=m.fogSource(f.g,terrain,f.vis,f.u,f.list);return{fixture:f,result};
 });assert.deepEqual(results[0],results[1]);
}
const report={cacheCases:cases,capturedSources:captured.length,exactMasksOrderedListsAndObjects:true,staleKey:true,stampAliases:true,generationIsolation:true,orderedReadsAndWrites:true};writeFileSync(out,JSON.stringify(report,null,2));console.log(report);
