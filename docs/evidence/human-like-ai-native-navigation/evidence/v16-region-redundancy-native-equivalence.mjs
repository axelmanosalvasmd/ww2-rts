import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const root='/tmp/v16-region-redundancy-candidate', baseline='/tmp/human-ai-perf-v16-frozen';
const testRoot='/home/judiazm/.t3/worktrees/ww2-rts/ai-human-commander';
const test=readFileSync(testRoot+'/test-engine-ai-human.js','utf8').split("for (const level of ['easy', 'normal', 'hard'])")[0]
 .replace('return { inputs, commands, first, tick: g.tick };','return { inputs, commands, first, tick: g.tick, memory, game: g };');
async function harness(at){
 const source=test.replace(/from '(\.\/[^']+)'/g,(_,specifier)=>`from '${new URL(specifier,pathToFileURL(at+'/test-engine-ai-human.js'))}'`)+ '\nexport { run };';
 const old=Math.random; Math.random=()=>.5;
 try{return await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));}finally{Math.random=old;}
}
function encode(root){
 const seen=new Map();
 function value(x){
  if(x===null)return null;
  if(typeof x==='number')return ['number',String(x),Object.is(x,-0)];
  if(typeof x==='bigint')return ['bigint',String(x)];
  if(typeof x==='undefined')return ['undefined'];
  if(typeof x==='function')return ['function',String(x)];
  if(typeof x!=='object')return x;
  if(seen.has(x))return ['ref',seen.get(x)];
  const id=seen.size;seen.set(x,id);
  if(x instanceof Map)return ['Map',id,[...x].map(([k,v])=>[value(k),value(v)])];
  if(x instanceof Set)return ['Set',id,[...x].map(value)];
  if(ArrayBuffer.isView(x))return [x.constructor.name,id,[...new Uint8Array(x.buffer,x.byteOffset,x.byteLength)]];
  if(x instanceof ArrayBuffer)return ['ArrayBuffer',id,[...new Uint8Array(x)]];
  if(Array.isArray(x))return ['Array',id,x.length,Object.keys(x).map(k=>[k,value(x[k])])];
  return [x.constructor?.name??'null prototype',id,Object.keys(x).map(k=>[k,value(x[k])])];
 }
 return value(root);
}
const old=await harness(baseline), candidate=await harness(root), evidence=[];
for(const [level,seed,ticks,startedTick,handoff]of [['easy',183,2400,0,false],['normal',183,2400,0,false],['hard',183,2400,0,false],['normal',907,900,0,false],['normal',908,900,0,false],['hard',911,600,600,true]]){
 const a=old.run(level,seed,ticks,startedTick,handoff),b=candidate.run(level,seed,ticks,startedTick,handoff);
 assert.deepEqual(b.inputs,a.inputs);assert.deepEqual(b.commands,a.commands);
 const stateA=JSON.stringify(encode({memory:a.memory,game:a.game})),stateB=JSON.stringify(encode({memory:b.memory,game:b.game}));
 assert.equal(stateB,stateA,`${level}/${seed}: full commander memory and full enumerable authoritative game graph match including aliases`);
 const row={level,seed,ticks,startedTick,handoff,inputs:a.inputs.length,commands:a.commands.length,stateSHA256:createHash('sha256').update(stateA).digest('hex')};evidence.push(row);console.log(JSON.stringify(row));
}
writeFileSync('/tmp/v16-region-redundancy-native-equivalence.json',JSON.stringify({baseline,equivalence:'Exact input logs, commands, and full enumerable game+commander memory graph including aliases/cycles and function source text',cases:evidence},null,2));
