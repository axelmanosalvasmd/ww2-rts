import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {hashFile,hashJSON} from '/tmp/human-ai-v16-full-source/tools/json-stream.mjs';
import {createBoundedNativeHasher} from './tools/hash-json-native.mjs';
const candidate=createBoundedNativeHasher(hashJSON),results=[];
const sourceFiles=['/tmp/human-ai-v16-full-source/tools/json-stream.mjs','/tmp/human-ai-v15-full-source/tools/ai-humanity.mjs','/tmp/human-ai-v15-full-source/tools/json-stream.mjs'];
const before=await Promise.all(sourceFiles.map(hashFile));
for(const mode of ['classic','world']) {
 const manifest=`/tmp/human-ai-final-v15/${mode}-raw-manifest.json`,manifestBefore=await hashFile(manifest),rows=JSON.parse(await readFile(manifest,'utf8'));
 for(const level of ['easy','normal','hard']) {
  const row=rows.find(r=>r.level===level&&r.seed===1),graph=JSON.parse(await readFile(row.file,'utf8'));
  assert.deepEqual(await hashFile(row.file),row.raw);assert.deepEqual(await hashFile(row.gzipFile),row.gzip);
  assert.deepEqual(await candidate(graph),row.raw);assert.deepEqual(await candidate(graph),await hashJSON(graph));
  const checks=[];
  for(const expected of row.timelineDigests) {
   const log=graph.logs[expected.slot];for(const [kind,value,digest] of [['log',log,expected.sha256],['perceptionMeasurements',log.perceptionMeasurements,expected.measurementStreamSHA256]]) {
    const actual=await candidate(value);assert.equal(actual.sha256,digest);assert.deepEqual(actual,await hashJSON(value));checks.push({slot:expected.slot,kind,...actual});
   }
  }
  assert.deepEqual(await hashFile(row.file),row.raw);results.push({mode,level,seed:1,rawFile:row.file,raw:row.raw,gzip:row.gzip,checks});
 }
 assert.deepEqual(await hashFile(manifest),manifestBefore);
}
assert.deepEqual(await Promise.all(sourceFiles.map(hashFile)),before);
await writeFile('/tmp/v16-hash-repo-candidate/historical-controls.json',JSON.stringify({status:'PASS',qualifier:'Historical V15 objects only. No current V16 World proof and no rescoring.',matches:results.length,wholeAndStreamDigestComparisons:results.length*7,originalRawGzipManifestAndSourceFilesUnchanged:true,results},null,2)+'\n');
console.log(JSON.stringify({status:'PASS',historicalV15Matches:results.length,wholeAndStreamComparisons:results.length*7,sourceAndRawUnchanged:true}));
