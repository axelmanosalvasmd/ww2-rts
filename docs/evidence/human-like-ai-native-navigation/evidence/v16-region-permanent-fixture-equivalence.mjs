import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const baseline='/tmp/human-ai-perf-v16-frozen',candidate='/tmp/v16-region-redundancy-candidate';
const full=readFileSync(candidate+'/test-path-performance.mjs','utf8');
const preamble=full.slice(0,full.indexOf('\n\n{\n  const map = mapWith();'));
let additions=readFileSync('/tmp/v16-region-permanent-additions.txt','utf8');
const needle="const publicRoute = (g, start, goal) => findPath(g, { type: 'rifle', ...point(g, start) }, point(g, goal)).map(p => [p.x, p.z]);";
assert.ok(additions.includes(needle));
additions=additions.replace(needle,"const publicRoute = (g, start, goal) => { const points = findPath(g, { type: 'rifle', ...point(g, start) }, point(g, goal)).map(p => [p.x, p.z]); evidence.push({ kind: 'public', w: g.w, h: g.h, start, goal, heightType: g.height?.constructor.name ?? null, heightKeys: g.height ? Object.keys(g.height) : null, height: g.height ? Array.from(g.height) : null, flags: [...g.flags], points, stats: {...g.pathStats} }); return points; };");
additions=additions.replace("assert.equal(g.pathStats.regionRejected, 0);\n  }\n}","assert.equal(g.pathStats.regionRejected, 0);\n    evidence.push({kind: 'native command', type, points: u.path.map(p => [p.x,p.z]), stats: {...g.pathStats}, worldGoal: u.worldGoal});\n  }\n}");
async function run(root,suffix='',skipStale=false) {
 const source=(preamble+'\nconst evidence = [];\n'+additions+'\nexport {evidence};').replaceAll("'./shared/","'file://"+root+'/shared/').replace("'/shared/sim.js'","'/shared/sim.js'");
 let spec=source.replace(root+'/shared/sim.js',root+'/shared/sim'+suffix+'.js');
 if(skipStale) spec=spec.slice(0,spec.indexOf('  const stale ='))+spec.slice(spec.indexOf('  const hole ='));
 const old=Math.random;Math.random=()=>.5;try{return (await import('data:text/javascript;base64,'+Buffer.from(spec).toString('base64'))).evidence;}finally{Math.random=old;}
}
const a=await run(baseline),b=await run(candidate);assert.deepEqual(b,a);
writeFileSync('/tmp/v16-region-permanent-fixture-equivalence.json',JSON.stringify({baseline,candidate,fixtures:a.length,exactRoutesCountersHeightHolesAndNativeCommands:'PASS',rows:a,SHA256:createHash('sha256').update(JSON.stringify(a)).digest('hex')},null,2));
let rejected=false,reason='';try{await run(candidate,'-global-region-bypass');}catch(error){rejected=error.code==='ERR_ASSERTION';reason=error.message;}
assert.ok(rejected,'public stale-version fixture rejects a candidate that skips every full-map region check');
let holeRejected=false,holeReason='';try{await run(candidate,'-global-region-bypass',true);}catch(error){holeRejected=error.code==='ERR_ASSERTION';holeReason=error.message;}
assert.ok(holeRejected,'public sparse-height fixture independently rejects an unrestricted region bypass');
writeFileSync('/tmp/v16-region-permanent-mutant-negative.json',JSON.stringify({globalRegionBypassStaleRejected:'PASS',reason,globalRegionBypassHoleRejected:'PASS',holeReason},null,2));console.log(`PASS ${a.length} exact public/native fixture outputs; both fallback controls independently reject unrestricted bypass`);
