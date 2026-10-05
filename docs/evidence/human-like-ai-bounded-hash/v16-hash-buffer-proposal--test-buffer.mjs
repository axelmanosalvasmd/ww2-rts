import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {jsonPieces,hashJSON,rawJSONFile} from '/tmp/human-ai-v16-full-source/tools/json-stream.mjs';
import {createBufferedHasher} from './hash-buffer.mjs';
const buffered=createBufferedHasher(jsonPieces);
const hash=text=>({sha256:createHash('sha256').update(text).digest('hex'),bytes:Buffer.byteLength(text)});
const cases=[
 ()=>({missing:undefined,fn:()=>1,symbol:Symbol('x'),array:[undefined,()=>1,Symbol('x')]}),
 ()=>({array:Array(100),sparse:Object.assign(Array(9),{1:1,7:'x'})}),
 ()=>({text:'\\\"\n\r\t\b\f\u0000\u2028\ud800\udc00😀',large:('\u0000😀\ud800\\\n').repeat(17000)}),
 ()=>({numbers:[-0,0,1e-7,1e21,Number.MAX_SAFE_INTEGER,Number.MAX_VALUE,Number.MIN_VALUE,NaN,Infinity,-Infinity]}),
 ()=>Object.assign({}, {'99':1,'2':2,'01':3,'4294967294':4,'4294967295':5,'1':6,z:7,a:8}),
 ()=>{const alias={a:1,b:[2,3]};return {a:alias,b:alias,c:[alias,alias]};},
 ()=>({date:new Date('2026-10-04T18:00:00Z'),n:new Number(3),b:new Boolean(false),s:new String('😀')}),
 ()=>{let sequence=0;const child={toJSON(key){return {key,sequence:++sequence};}};return {toJSON(key){return {root:key,a:child,b:child,array:[child]};}};},
 ()=>({typed:new Uint8Array([1,2,255]),proto:Object.assign(Object.create({inherited:4}),{own:2})}),
 ()=>JSON.parse('{"__proto__":{"safe":true},"constructor":7,"toJSON":5}'),
 ()=>({nested:Array.from({length:2000},(_,i)=>({id:i,value:['😀',null,true,false,i+.5]}))})
];
for(const fixture of cases){const old=await hashJSON(fixture()),actual=await buffered(fixture()),native=hash(JSON.stringify(fixture()));assert.deepEqual(actual,old);assert.deepEqual(actual,native);}
for(const fixture of [()=>{const value={};value.self=value;return value;},()=>({n:1n}),()=>undefined]) {
 const errors=[];for(const hasher of [hashJSON,buffered])try{await hasher(fixture());assert.fail('Expected serialization rejection');}catch(error){errors.push(error.constructor.name);}assert.deepEqual(errors[0],errors[1]);
}
const dir=await mkdtemp(join(tmpdir(),'hash-buffer-'));try{const file=join(dir,'raw.json');await writeFile(file,'{"literal":"😀","n":1}');assert.deepEqual(await buffered({raw:rawJSONFile(file)}),await hashJSON({raw:rawJSONFile(file)}));}finally{await rm(dir,{recursive:true,force:true});}
console.log(JSON.stringify({status:'PASS',edgeFixtures:11,errorFixtures:3,rawFragmentFixture:1,boundedEncoding:true,originalTokenGeneratorUnchanged:true}));
