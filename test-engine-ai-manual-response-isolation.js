import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {runMatch,aggregate,sourceCheckpoint,MANUAL_RESPONSE_POLICY} from './tools/ai-humanity.mjs';
function serialize(value) {
  const seen = new Map(), nodes = [];
  const visit = item => {
    if (item === undefined) return { $undefined: true };
    if (typeof item === 'number' && !Number.isFinite(item)) return { $number: String(item) };
    if (typeof item === 'bigint') return { $bigint: String(item) };
    if (typeof item === 'function') return { $function: Function.prototype.toString.call(item) };
    if (item === null || typeof item !== 'object') return item;
    if (seen.has(item)) return { $ref: seen.get(item) };
    const index = nodes.length; seen.set(item, index);
    const node = { type: item.constructor?.name ?? 'Object', properties: [] }; nodes.push(node);
    if (item instanceof Map) node.entries = [...item].map(([key, entry]) => [visit(key), visit(entry)]);
    if (item instanceof Set) node.entries = [...item].map(visit);
    if (item instanceof Date) node.value = item.toISOString();
    if (item instanceof ArrayBuffer) node.bytesBase64 = Buffer.from(item).toString('base64');
    if (ArrayBuffer.isView(item)) { node.buffer = visit(item.buffer); node.byteOffset = item.byteOffset; node.byteLength = item.byteLength; }
    if (Array.isArray(item)) node.values = Array.from({ length: item.length }, (_, index) => index in item ? visit(item[index]) : { $hole: true });
    for (const key of Object.keys(item)) {
      if ((Array.isArray(item) || ArrayBuffer.isView(item)) && /^(0|[1-9]\d*)$/.test(key)) continue;
      node.properties.push([key, visit(item[key])]);
    }
    return { $ref: index };
  };
  const root = visit(value); return JSON.stringify({ root, nodes });
}

const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const checkpointBefore=await sourceCheckpoint(false);
const evidence=[];
for(const mode of ['conquest','classic','world']) for(const level of ['easy','normal','hard']) {
 const controls=[];
 for(const treatment of ['disabled','enabled','mutated-proof']) {
  let proof;
  const options={map:'default',seconds:15,logs:true,screenSpan:113,
   ...(treatment!=='disabled'?{manualPolicy:MANUAL_RESPONSE_POLICY}:{}),
   ...(treatment==='mutated-proof'?{manualProofTransform:scene=>{scene.units.length=0;scene.possibleHomes=null;scene.slot=99;}}:{}),
   nativeIsolationCapture(g,logs,nextRandom) {
    const nativeLogs=logs.map(({manualMeasurements,...native})=>native);
    proof={gameGraphSHA256:hash(serialize(g)),nativeLogsSHA256:hash(nativeLogs),nextRandom,
     commands:nativeLogs.reduce((n,log)=>n+log.commands.length,0),inputs:nativeLogs.reduce((n,log)=>n+log.inputs.length,0),
     actorDeliveryTicks:[...new Set(nativeLogs.flatMap(log=>log.perceptionMeasurements.frames.filter(frame=>frame.observed.newEvents.length).map(frame=>frame.observationTick)))]};
   }};
  const result=await runMatch(options,{mode,level,seed:1});
  const legacySeats=result.seats.map(({metrics,...seat})=>{const {manualResponsePolicy,...legacy}=metrics;return {...seat,metrics:legacy};});
  proof.legacySeatMetricsSHA256=hash(legacySeats);
  assert.ok(proof.commands>0 && proof.inputs>0,`${mode}/${level}/${treatment} must contain real commands and inputs`);
  if(treatment!=='disabled') {
   assert.equal(result.logs[0].manualMeasurements.policy,MANUAL_RESPONSE_POLICY);
   assert.ok(result.logs.every(log=>log.manualMeasurements.publicFrames.length>0),'actual public delivery frames retained');
   assert.ok(result.logs.every(log=>log.manualMeasurements.operations.every(op=>Number.isSafeInteger(op.queuedTick))));
  }
  controls.push({treatment,...proof});
 }
 for(const actual of controls.slice(1)) {const {treatment,...a}=actual,{treatment:baseline,...b}=controls[0];assert.deepEqual(a,b,`${mode}/${level} instrumentation must preserve complete native graph/logs/RNG/original scores`);}
 evidence.push({mode,level,controls});
 console.log(JSON.stringify({mode,level,status:'PASS',commands:controls[0].commands,inputs:controls[0].inputs}));
}
const checkpointAfter=await sourceCheckpoint(false);
assert.deepEqual(checkpointAfter.files,checkpointBefore.files,'all loaded source/checkpoint bindings remain frozen');
if(process.env.MANUAL_RESPONSE_EVIDENCE)writeFileSync(process.env.MANUAL_RESPONSE_EVIDENCE,JSON.stringify({status:'PASS',seconds:15,treatments:27,sourceCheckpoint:checkpointBefore,sourceHashesUnchanged:true,cases:evidence},null,2)+'\n');
console.log(JSON.stringify({status:'PASS',policy:MANUAL_RESPONSE_POLICY,modeLevels:9,treatments:27,seconds:15}));
