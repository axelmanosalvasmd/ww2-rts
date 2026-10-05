import assert from 'node:assert/strict';import{readFileSync,writeFileSync}from'node:fs';import{deserialize}from'node:v8';
import{detachedCopy as before,copyFreshRoot as after}from'/tmp/ai-v16-fresh-root/shared/ai-perception.js';
const roots=deserialize(readFileSync('/tmp/ai-v16-copy-roots.bin')).filter(v=>v?.hpBasis && !v.screenSeen);
for(const root of roots)assert.deepEqual(before(root),after(root));
const run=fn=>{const start=performance.now();for(let i=0;i<100;i++)for(const root of roots)fn(root);return performance.now()-start;};
for(let i=0;i<2;i++){run(before);run(after);}const pairs=[];for(let i=0;i<12;i++){const row={order:i%2?['after','before']:['before','after']};for(const side of row.order)row[side]=run(side==='before'?before:after);pairs.push(row);}
const median=k=>pairs.map(p=>p[k]).sort((a,b)=>a-b).slice(5,7).reduce((a,b)=>a+b)/2;
const report={roots:roots.length,repeats:100,pairs,before:median('before'),after:median('after'),note:'CPU1 nice19 diagnostic only. Fresh ordinary unit roots selected by native provenance, two paired warmups, twelve alternating retained pairs.'};writeFileSync('/tmp/ai-v16-fresh-root-micro.json',JSON.stringify(report,null,2));console.log(report);
