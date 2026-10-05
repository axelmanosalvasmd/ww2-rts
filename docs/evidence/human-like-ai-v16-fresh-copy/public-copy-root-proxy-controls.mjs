import assert from 'node:assert/strict';import{writeFileSync}from'node:fs';
import{copyFreshRoot}from'/tmp/ai-v16-fresh-root/shared/ai-perception.js';
import{detachedCopy,copyFresh}from'/tmp/public-copy-pair-v16-candidate/shared/ai-perception-baseline-probe.js';
const baseline=root=>{const screen={...detachedCopy(root),proof:1};return [screen,copyFresh(screen)];};
const candidate=root=>{const screen={...copyFreshRoot(root),proof:1};return [screen,copyFresh(screen)];};
const factories=[
 ()=>{const shared={value:2},root={nested:{shared},shared};root.self=root;root.map=new Map([[shared,root]]);root.set=new Set([shared,root]);return root;},
 ()=>{const a=new Array(9);a[2]={n:1};a.extra=a[2];a.self=a;Object.defineProperty(a,'__proto__',{enumerable:true,value:{safe:1}});return{a};},
 ()=>{const a=Object.create(null);a.x={n:1};Object.defineProperty(a,'__proto__',{enumerable:true,value:{safe:1}});return{a};},
 ()=>{const buffer=new ArrayBuffer(8),date=new Date(5);return{date,buffer,bytes:new Uint8Array(buffer),map:new Map([[date,buffer]])};},
 log=>{const shared={n:1};return{nested:{a:shared,get b(){log.push('getter');return shared}},date:new Date(3)};},
 log=>{const p=new Proxy({n:1,nested:{n:2}},{ownKeys(t){log.push('keys');return Reflect.ownKeys(t)},getPrototypeOf(t){log.push('prototype');return Reflect.getPrototypeOf(t)},getOwnPropertyDescriptor(t,key){log.push('descriptor:'+key);return Reflect.getOwnPropertyDescriptor(t,key)}});return {nested:p,alias:p};},
 log=>{const p=new Proxy({n:1},{ownKeys(t){log.push('keys');return Reflect.ownKeys(t)},getPrototypeOf(t){log.push('prototype');return Reflect.getPrototypeOf(t)},getOwnPropertyDescriptor(t,key){log.push('descriptor:'+key);return Reflect.getOwnPropertyDescriptor(t,key)}});return{nested:p,date:new Date(3)};},
 ()=>({nested:{f:()=>1}}),()=>({nested:{symbol:Symbol('invalid')}})
];
const reports=[];for(let i=0;i<factories.length;i++){
 const rows=[baseline,candidate].map(fn=>{const log=[];let result,error;try{result=fn({...factories[i](log)});}catch(e){error=e.name;}return{result,error,log};});
 assert.deepEqual(rows[1],rows[0],'source trace/result equality case'+i);reports.push({case:i,error:rows[0].error??null,trace:rows[0].log});
 if(rows[1].result){const [screen,memory]=rows[1].result;assert.notEqual(screen,memory);if(screen.nested){assert.notEqual(screen.nested,memory.nested);} }
}
writeFileSync('/tmp/public-copy-root-proxy-controls.json',JSON.stringify({exact:true,cases:reports},null,2));console.log('Fresh-root source graph, accessor and Proxy trap controls passed');
