import assert from 'node:assert/strict';
import {readFile,writeFile,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {createGunzip} from 'node:zlib';
const root='/tmp/human-ai-opening-paired';
async function hashStream(stream){const hash=createHash('sha256');let bytes=0;for await(const chunk of stream){hash.update(chunk);bytes+=chunk.length;}return{sha256:hash.digest('hex'),bytes};}
const result={status:'PASS',treatments:{}};
for(const treatment of ['base','candidate']){
 const source=`/tmp/human-ai-opening-paired-${treatment}-source`,dir=`${root}/${treatment}`,tool=await import(`${source}/tools/ai-humanity.mjs`),stream=await import(`${source}/tools/json-stream.mjs`),manifest=JSON.parse(await readFile(`${source}/source-archive.json`,'utf8'));
 for(const[file,expected]of Object.entries(manifest.files)){assert.equal(createHash('sha256').update(await readFile(`${source}/${file}`)).digest('hex'),expected);assert.equal((await stat(`${source}/${file}`)).mode&0o222,0);}
 const compact=JSON.parse(await readFile(`${dir}/compact.json`,'utf8')),rawSHA=await hashStream(createReadStream(`${dir}/full.json`)),gunzipSHA=await hashStream(createReadStream(`${dir}/full.json.gz`).pipe(createGunzip())),gzipSHA=await hashStream(createReadStream(`${dir}/full.json.gz`));assert.deepEqual(rawSHA,gunzipSHA);assert.equal(rawSHA.sha256,compact.evidenceArchive.uncompressedSHA256);assert.equal(gzipSHA.sha256,compact.evidenceArchive.sha256);
 let seats=0,inputs=0,commands=0,events=0,frames=0;
 const reduced=await stream.readReport(`${dir}/full.json.gz`,async(match,index)=>{
  for(const seat of match.seats){assert.deepEqual(tool.summarizeSeat(match.logs[seat.slot],match.seconds,113),seat.metrics);seats++;}
  for(const log of match.logs){inputs+=log.inputs.length;commands+=log.commands.length;events+=log.events.length;frames+=log.perceptionMeasurements.frames.length;assert.ok(log.perceptionMeasurements.frames[0].original.baselineTick <= log.perceptionMeasurements.startedTick);}
  const{logs,...noLogs}=match;const cmp=compact.results[index];const{timelineDigests,timelinesSHA256,...cmpRest}=cmp;assert.deepEqual(noLogs,cmpRest);assert.equal((await stream.hashJSON(logs)).sha256,timelinesSHA256);
  for(const digest of timelineDigests){const log=logs[digest.slot];assert.equal((await stream.hashJSON(log)).sha256,digest.sha256);assert.equal((await stream.hashJSON(log.perceptionMeasurements)).sha256,digest.measurementStreamSHA256);}return noLogs;
 },{gzip:true});assert.equal(reduced.results.length,60);assert.equal(seats,180);assert.deepEqual(tool.aggregate(reduced.results),compact.summary);assert.deepEqual(reduced.summary,compact.summary);
 result.treatments[treatment]={matches:60,seats,inputs,commands,events,frames,unchangedReadonlySourceFiles:Object.keys(manifest.files).length,rawSHA,gzipSHA,checks:['exact gzip roundtrip bytes','all seat metrics recomputed with unchanged native reducers','pooled aggregate matches','all compact timeline and private-stream digests','both policies and dual scoring preserved','original oracle injected from match start']};
}
await writeFile(`${root}/independent-verification.json`,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
