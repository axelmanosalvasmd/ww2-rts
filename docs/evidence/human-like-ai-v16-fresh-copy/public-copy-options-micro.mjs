import assert from 'node:assert/strict'; import {readFileSync,writeFileSync} from 'node:fs'; import {deserialize} from 'node:v8';
import{screenCopies}from'/tmp/public-copy-pair-v16-candidate/shared/ai-perception-probe.js';
import{detachedCopy,copyFresh}from'/tmp/public-copy-pair-v16-candidate/shared/ai-perception-baseline-probe.js';
import {copyFreshRoot} from '/tmp/ai-v16-fresh-root/shared/ai-perception.js';
const roots=deserialize(readFileSync('/tmp/ai-v16-copy-roots.bin')).filter(root=>root?.hpBasis && !root.screenSeen).map(root=>({...root}));
const metadata={firstStillAt:0,lastSeen:100,lastScreenTick:200,screenSeen:true,confidence:1};
const baseline=root=>{const seen={...detachedCopy(root),...metadata};return [seen,copyFresh(seen)];};
const rootOnly=root=>{const seen={...copyFreshRoot(root),...metadata};return [seen,copyFresh(seen)];};
for(const root of roots) assert.deepEqual(screenCopies(root,metadata),baseline(root));
const run=f=>{const start=performance.now();for(let k=0;k<40;k++)for(const root of roots)f(root,metadata);return performance.now()-start;};
for(let k=0;k<3;k++){run(baseline);run(rootOnly);run(screenCopies);}const pairs=[];for(let k=0;k<12;k++){const row={order:k%2?['pair','root','baseline']:['baseline','root','pair']};for(const side of row.order)row[side+'MS']=run(side==='baseline'?baseline:side==='root'?rootOnly:screenCopies);pairs.push(row);}
const median=key=>pairs.map(row=>row[key]).sort((a,b)=>a-b).slice(5,7).reduce((a,b)=>a+b)/2;
const result={diagnosticOnly:true,roots:roots.length,warmupPairs:3,measuredPairs:12,sweeps:40,baselineMedianMS:median('baselineMS'),rootMedianMS:median('rootMS'),candidateMedianMS:median('pairMS'),pairs};result.savingPercent=100*(1-result.candidateMedianMS/result.baselineMedianMS);writeFileSync('/tmp/public-copy-options-micro.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
