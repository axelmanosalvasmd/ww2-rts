import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {jsonPieces,hashJSON,hashFile} from '/tmp/human-ai-v16-full-source/tools/json-stream.mjs';
import {sourceCheckpoint} from '/tmp/human-ai-v16-full-source/tools/ai-humanity.mjs';
import {createBufferedHasher} from './hash-buffer.mjs';
const buffered=createBufferedHasher(jsonPieces),before=await sourceCheckpoint(false),manifest=JSON.parse(await readFile('/tmp/human-ai-final-v16/conquest-raw-manifest.json','utf8'));
const cases=[['easy',1],['easy',20],['normal',1],['normal',20],['hard',1]].map(([level,seed])=>{const item=manifest.find(row=>row.level===level&&row.seed===seed);assert.ok(item,`Needs completed original verification:${level}/${seed}`);return item;});
const rows=[];async function timed(name,fn){const start=performance.now(),cpuBefore=process.cpuUsage(),result=await fn(),cpu=process.cpuUsage(cpuBefore);const row={name,wallSeconds:(performance.now()-start)/1000,cpuSeconds:(cpu.user+cpu.system)/1e6,...result};console.log(JSON.stringify(row));return row;}
for(const item of cases){
 const graph=JSON.parse(await readFile(item.file,'utf8')),native=[];
 const whole=await timed(`${item.level}/${item.seed}.completeNativeMatch`,()=>buffered(graph));
 assert.deepEqual({sha256:whole.sha256,bytes:whole.bytes},item.raw,'The frozen original writeJSON emitted this exact complete token stream');
 for(const seat of graph.seats){const log=graph.logs[seat.slot],record=item.timelineDigests.find(row=>row.slot===seat.slot);
  for(const[name,value,expected]of[['log',log,record.sha256],['perceptionMeasurements',log.perceptionMeasurements,record.measurementStreamSHA256],['manualMeasurements',log.manualMeasurements,record.manualStreamSHA256]]){
   const digest=await timed(`${item.level}/${item.seed}.slot${seat.slot}.${name}`,()=>buffered(value));assert.equal(digest.sha256,expected,'All digests match the already-completed original hashJSON verification');native.push(digest);
  }
 }
 assert.deepEqual(await hashFile(item.file),item.raw,'Raw input file remained unchanged');
 rows.push({level:item.level,seed:item.seed,rawBytes:item.raw.bytes,originalWholeMatchSHA256:item.raw.sha256,whole,native});
}
assert.deepEqual((await sourceCheckpoint(false)).files,before.files);
await writeFile('/tmp/v16-hash-buffer-proposal/native-controls.json',JSON.stringify({status:'PASS',sourceCheckpoint:before.sha256,cases:rows,sourceAndRawFilesUnchanged:true,originalDigestSource:'Completed immutable campaign manifest; complete match bytes emitted by frozen writeJSON(jsonChunks(jsonPieces)); per-log and each private/manual stream hashJSON recomputed by unchanged live verifier.'},null,2)+'\n');
