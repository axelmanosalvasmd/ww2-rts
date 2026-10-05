import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createGunzip} from 'node:zlib';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
const source='/tmp/human-ai-v16-full-source',dir='/tmp/human-ai-final-v16';
const rows=JSON.parse(await readFile(`${dir}/conquest-raw-manifest.json`,'utf8')),item=rows.find(row=>row.level==='easy'&&row.seed===1);
assert.ok(item);
const stages=[];
async function measure(name,fn){const start=performance.now(),before=process.cpuUsage();const result=await fn(),cpu=process.cpuUsage(before);const row={name,wallSeconds:(performance.now()-start)/1000,cpuSeconds:(cpu.user+cpu.system)/1e6,rssBytes:process.memoryUsage().rss};stages.push(row);console.log(JSON.stringify(row));return result;}
const [tool,storage,sim,keys]=await measure('frozenImports',()=>Promise.all([import(`${source}/tools/ai-humanity.mjs`),import(`${source}/tools/json-stream.mjs`),import(`${source}/shared/sim.js`),import(`${source}/client/keys.js`)]));
const checkpoint=await tool.sourceCheckpoint(false);assert.equal(checkpoint.sha256,'3bac0c0923bcfe622dac10a8b76783d090eaf249a4c54e3e9a89a305c9e51ae9');
const compact=JSON.parse(await readFile(`${dir}/compact-spool/conquest-easy-1.json`,'utf8'));
let text=await measure('rawReadUTF8',()=>readFile(item.file,'utf8'));
const graph=await measure('JSONparse',()=>JSON.parse(text));text=null;
assert.equal(graph.logs.length,3);assert.equal(graph.sourceCheckpointSHA256,checkpoint.sha256);
for(const seat of compact.seats){const log=graph.logs[seat.slot];
 const base=await measure(`slot${seat.slot}.summarizeSeat`,()=>tool.summarizeSeat(log,graph.seconds,113));
 const manual=await measure(`slot${seat.slot}.manualResponseMetrics`,()=>tool.manualResponseMetrics(log,graph.seconds,{...sim,bindings:keys.bindings}));
 await measure(`slot${seat.slot}.deepEqual`,()=>assert.deepEqual({...base,manualResponsePolicy:manual},seat.metrics));
 const digest=await measure(`slot${seat.slot}.hashJSON.log`,()=>storage.hashJSON(log));
 assert.equal(digest.sha256,item.timelineDigests[seat.slot].sha256);
 const rawMeasure=await measure(`slot${seat.slot}.hashJSON.perceptionMeasurements`,()=>storage.hashJSON(log.perceptionMeasurements));
 assert.equal(rawMeasure.sha256,item.timelineDigests[seat.slot].measurementStreamSHA256);
 const publicMeasure=await measure(`slot${seat.slot}.hashJSON.manualMeasurements`,()=>storage.hashJSON(log.manualMeasurements));
 assert.equal(publicMeasure.sha256,item.timelineDigests[seat.slot].manualStreamSHA256);
}
await measure('gzipHashAndDecompressedHash',async()=>{
 assert.deepEqual(await storage.hashFile(item.gzipFile),item.gzip);
 const hash=createHash('sha256');let bytes=0;for await(const part of createReadStream(item.gzipFile).pipe(createGunzip())){hash.update(part);bytes+=part.length;}
 assert.deepEqual({sha256:hash.digest('hex'),bytes},item.raw);
});
const after=await tool.sourceCheckpoint(false);assert.deepEqual(after.files,checkpoint.files);
const result={status:'PASS_READ_ONLY_ONE_VERIFIED_MATCH',sourceCheckpoint:checkpoint.sha256,rawFile:item.file,rawBytes:item.raw.bytes,stages,assertions:'All frozen seat metrics, full/native/private/public stream digests and gzip/raw digests match already-verified manifest; source files unchanged.'};
await writeFile('/tmp/v16-verifier-proposal/profile.json',JSON.stringify(result,null,2)+'\n');
