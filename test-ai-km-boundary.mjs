import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { kaplanMeier as candidate,sourceCheckpoint } from './tools/ai-humanity.mjs';
import { publicAlertKM as alert } from './tools/ai-public-alert-response.mjs';
import { exactHalfBoundary,KM_MEDIAN_BOUNDARY_VERSION } from './tools/km-median-boundary.mjs';
const fixture=JSON.parse(readFileSync(new URL('./docs/evidence/human-like-ai-km-boundary/native-timestamps.json',import.meta.url)));
const cases=[];let controls=0;
// Historical floating reducer is a test-only reference, not a selectable scoring policy.
function baseline(samples) {
 const groups=new Map();for(const sample of samples){const row=groups.get(sample.seconds)??{observed:0,censored:0};row[sample.observed?'observed':'censored']++;groups.set(sample.seconds,row);}
 let risk=samples.length,survival=1,medianSeconds=null;
 for(const[seconds,row]of[...groups].sort(([a],[b])=>a-b)){if(row.observed)survival*=1-row.observed/risk;if(medianSeconds===null&&survival<=.5)medianSeconds=seconds;risk-=row.observed+row.censored;}
 return{medianSeconds};
}
const sample=(seconds,observed=true)=>({seconds,observed});
for(const [label,rows,median] of[
 ['even exact half',[sample(1),sample(2),sample(3),sample(4)],2],
 ['mixed censors',[sample(0,false),sample(1),sample(2),sample(2,false),sample(3),sample(4,false)],3],
 ['completion before tied censor',[sample(1),sample(1,false),sample(2),sample(3,false)],2],
 ['all censored',[sample(1,false),sample(2,false)],null],
 ['all completed',[sample(1),sample(1),sample(1)],1],
 ['empty',[],null]]){
 for(const fn of[candidate,alert]){const scored=fn(rows);assert.equal(scored.medianSeconds,median,label);assert.deepEqual(fn([...rows].reverse()),scored,label+' permutation');controls+=2;}
}
const big=2**51;
for(const [risk,observed,expected] of[[big+1,big/2,false],[big-1,big/2,true],[big,big/2,true]]){
 const numeric=1-observed/risk;assert.equal(exactHalfBoundary()(numeric,risk,observed),expected,'exact neighboring rational crossing');controls++;
}
// Exact products are evaluated only at the ambiguous candidate, then extended without rescanning.
const again=exactHalfBoundary();assert.equal(again(.5, big+1,big/2),false);assert.equal(again(.5,big/2+1,1),true);controls+=2;
const expand=curve=>curve.flatMap(row=>[...Array.from({length:row.observed},()=>sample(row.seconds)),...Array.from({length:row.censored},()=>sample(row.seconds,false))]);
for(const original of fixture.diagnosticCurves){const row={level:original.level};for(const key of['manual','acceptedCommand','alert']){const expected=original[key],rows=expected.samples,old=baseline(rows),now=candidate(rows),na=alert(rows);assert.equal(old.medianSeconds,expected.beforeMedian);assert.equal(now.medianSeconds,expected.afterMedian);assert.equal(na.medianSeconds,expected.afterPublicMedian);assert.deepEqual(now.curve,expected.curve,'historical rounded curve unchanged');assert.deepEqual(na.curve,expected.publicCurve,'historical unrounded public curve unchanged');assert.deepEqual(candidate([...rows].reverse()),now);assert.deepEqual(alert([...rows].reverse()),na);row[key]={...expected};controls+=7;}cases.push(row);}
assert.equal(fixture.rows.length,27);assert.equal(Object.keys(fixture.originalEpisodeSHA256).length,36);assert.match(fixture.originalDiagnosticSHA256,/^[a-f0-9]{64}$/);controls+=3;
for(const level of ['easy','normal','hard']) {
 const first=[],accepted=[];
 for(const row of fixture.rows.filter(row=>row.level===level)) {
  assert.match(fixture.originalEpisodeSHA256[row.episode],/^[a-f0-9]{64}$/);
  const input=row.answer?.firstActionTick??null,command=row.answer?.acceptedCommandTick??null;
  if(command!==null)assert.ok(input!==null&&command>=input,'actual accepted native command follows its physical input');
  const end=row.seconds*20;first.push(sample(((input??end)-row.creation.tick)/20,input!==null));accepted.push(sample(((command??end)-row.creation.tick)/20,command!==null));
 }
 const expected=cases.find(row=>row.level===level);
 assert.deepEqual(candidate(first),candidate(expected.manual.samples),'compact native timestamps reconstruct retained first-input curves');
 assert.deepEqual(candidate(accepted),candidate(expected.acceptedCommand.samples),'compact native timestamps reconstruct retained command curves');
 assert.ok(candidate(accepted).medianSeconds>=candidate(first).medianSeconds,'native KM command median follows input median');controls+=3;
}
const easy=cases.find(c=>c.level==='easy');assert.equal(easy.manual.beforeMedian,4.15);assert.equal(easy.manual.afterMedian,1.65);assert.ok(easy.acceptedCommand.afterMedian>=easy.manual.afterMedian);controls+=3;
const start=performance.now(),large=Array.from({length:100000},(_,i)=>sample(i));assert.equal(candidate(large).medianSeconds,49999);assert.ok(Number.isFinite(performance.now()-start));controls+=2;
const checkpoint=await sourceCheckpoint(false),helper=readFileSync(new URL('./tools/km-median-boundary.mjs',import.meta.url));
assert.equal(checkpoint.files['tools/km-median-boundary.mjs'],createHash('sha256').update(helper).digest('hex'),'prospective worker source checkpoint binds the actual numerical helper bytes');controls++;
console.log('PASS KM exact-half prospective boundary: '+controls+' checks; original timing bounds and historical reports unchanged.');
