import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,stat,readdir,open} from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createGzip,createGunzip,gunzipSync} from 'node:zlib';
import {Worker} from 'node:worker_threads';
import {spawn} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {aggregate,summarizeSeat} from '/tmp/human-ai-final-observed-runtime-v14-source/tools/ai-humanity.mjs';
const source='/tmp/human-ai-final-observed-runtime-v14-source',failed='/tmp/human-ai-final-observed-runtime-v14',dir='/tmp/human-ai-final-observed-runtime-v14-streaming';
const collector=`${source}/tools/ai-humanity.mjs`,expected='7c87de19ed1196044efbabad0d63bb8774d52acdd35e7695efac053a1f7c74a9';
const modes=[['conquest',20],['classic',10],['world',10]],levels=['easy','normal','hard'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const write=(path,value)=>writeFile(path,JSON.stringify(value,null,2)+'\n');
const containers=new Set(['logs','frames','inputs','commands','events','productionDecisions','seats']);
let maxLeaf=0;
function* jsonPieces(value){
 if(Array.isArray(value)){
  yield '[';for(let i=0;i<value.length;i++){if(i)yield ',';yield* jsonPieces(value[i]===undefined?null:value[i]);}yield ']';return;
 }
 if(value&&typeof value==='object'&&Object.keys(value).some(key=>containers.has(key))){
  yield '{';let first=true;for(const key of Object.keys(value)){if(value[key]===undefined)continue;if(!first)yield ',';first=false;yield JSON.stringify(key)+':';yield* jsonPieces(value[key]);}yield '}';return;
 }
 const encoded=JSON.stringify(value);if(encoded===undefined)throw Error('Unsupported undefined root');
 const bytes=Buffer.byteLength(encoded);maxLeaf=Math.max(maxLeaf,bytes);if(bytes>32*1024*1024)throw Error('Serialized leaf exceeds32MiB; retain outputs and stop rather than omit data.');yield encoded;
}
async function* chunks(pieces){let pending='',size=0;for await(const piece of pieces){if(Buffer.isBuffer(piece)){if(pending){yield Buffer.from(pending);pending='';size=0;}yield piece;continue;}pending+=piece;size+=Buffer.byteLength(piece);if(size>=65536){yield Buffer.from(pending);pending='';size=0;}}if(pending)yield Buffer.from(pending);}
async function hashPieces(pieces){const hash=createHash('sha256');let bytes=0;for await(const chunk of chunks(pieces)){hash.update(chunk);bytes+=chunk.length;}return{sha256:hash.digest('hex'),bytes};}
async function hashFile(file){const hash=createHash('sha256');let bytes=0;for await(const chunk of createReadStream(file)){hash.update(chunk);bytes+=chunk.length;}return{sha256:hash.digest('hex'),bytes};}
async function hashDecompressed(file){const hash=createHash('sha256');let bytes=0;for await(const chunk of createReadStream(file).pipe(createGunzip())){hash.update(chunk);bytes+=chunk.length;}return{sha256:hash.digest('hex'),bytes};}
async function gzipPieces(file,pieces){
 const hash=createHash('sha256');let bytes=0;
 const tap=new Transform({transform(chunk,encoding,done){hash.update(chunk);bytes+=chunk.length;done(null,chunk);}});
 await pipeline(Readable.from(chunks(pieces)),tap,createGzip({level:9}),createWriteStream(file,{flags:'wx'}));
 const raw={sha256:hash.digest('hex'),bytes},gzip=await hashFile(file),roundtrip=await hashDecompressed(file);
 assert.deepEqual(roundtrip,raw,'gzip recovers exact emitted JSON bytes');return{raw,gzip};
}
const nativeProof=log=>Promise.all(['inputs','events','commands'].map(async key=>[key,{...await hashPieces(jsonPieces(log[key]??[])),rows:log[key]?.length??0}])).then(Object.fromEntries);
async function immutable(){const manifest=JSON.parse(await readFile(`${source}/source-archive.json`));for(const[file,digest]of Object.entries(manifest.files))assert.equal((await hashFile(`${source}/${file}`)).sha256,digest,file);}
async function selfTest(){
 await mkdir(`${dir}/serializer-proof`,{recursive:true});
 const smoke=JSON.parse(await readFile('/tmp/human-ai-observed-streams-smoke.json'));
 assert.deepEqual(Object.keys(smoke.sourceCheckpoints),[expected]);assert.equal(smoke.results.length,3);assert.equal(smoke.results.reduce((n,r)=>n+r.seats.length,0),9);
 const edges={inputs:[undefined,NaN,Infinity,-Infinity,null,{text:'é " \\ \n',missing:undefined}],frames:[{original:{events:[],newEvents:[]}}]};
 assert.equal([...jsonPieces(edges)].join(''),JSON.stringify(edges));
 const proofs=[],archives=[];
 for(const match of smoke.results){
  const file=`${dir}/serializer-proof/${match.mode}-${match.level}-${match.seed}.json.gz`;
  const bytes=JSON.stringify(match),proof=await gzipPieces(file,jsonPieces(match)),restored=JSON.parse(gunzipSync(await readFile(file)));
  assert.deepEqual(restored,JSON.parse(bytes));assert.equal(proof.raw.sha256,sha(bytes));
  for(const seat of match.seats){assert.deepEqual(summarizeSeat(restored.logs[seat.slot],match.seconds,113),seat.metrics);assert.deepEqual(summarizeSeat(restored.logs[seat.slot],match.seconds,113),summarizeSeat(match.logs[seat.slot],match.seconds,113));}
  archives.push({file:`serializer-proof/${match.mode}-${match.level}-${match.seed}.json.gz`});
  proofs.push({mode:match.mode,level:match.level,seed:match.seed,seats:match.seats.length,...proof});
 }
 const mergedProof=await gzipPieces(`${dir}/serializer-proof/full-smoke.json.gz`,fullReportPieces(smoke,archives));
 assert.deepEqual(JSON.parse(gunzipSync(await readFile(`${dir}/serializer-proof/full-smoke.json.gz`))),smoke,'streamed merged full report preserves the complete smoke graph');
 assert.deepEqual(aggregate(smoke.results),smoke.summary);await immutable();
 const proof={verifiedAt:new Date().toISOString(),sourceCheckpointSHA256:expected,matches:3,seats:9,exactCompactJSONString:true,fullGraphRoundtrip:true,allNativeReducerMetrics:true,pooledMetrics:true,streamedMergedGraph:true,mergedProof,undefinedNonfiniteUTF8:true,maxSerializedLeafBytes:maxLeaf,proofs};
 await write(`${dir}/serializer-proof.json`,proof);console.log(JSON.stringify({selfTest:'PASS',matches:3,seats:9,maxSerializedLeafBytes:maxLeaf}));
}
async function archiveMatch(result){
 assert.equal(result.sourceCheckpointSHA256,expected);assert.equal(result.logs.length,result.seats.length);assert.equal(result.seats.length,3);assert.ok(result.seconds===180||result.ended===true);
 for(const seat of result.seats){const policies=seat.metrics.measurementPolicyComparison;assert.equal(policies.coverage.originalFromMatchStart,true);assert.equal(policies.coverage.originalRecorded,true);
  for(const policy of ['originalOracle','observed'])assert.equal(policies[policy].primaryOnly.requiredScreenPopulation?.requiredEvents,policies[policy].explicitLinked.requiredScreenPopulation?.requiredEvents);
  assert.deepEqual(seat.metrics.requiredScreenPopulation,policies.originalOracle.explicitLinked.requiredScreenPopulation);
 }
 const name=`${result.mode}-${result.level}-${String(result.seed).padStart(2,'0')}.json.gz`,file=`${dir}/raw-matches/${name}`;
 const proof=await gzipPieces(file,jsonPieces(result));
 // Validate the decompressed graph one match at a time, never the campaign-sized JSON string.
 assert.ok(proof.raw.bytes<536870888,'individual match exceeds V8 parse size; archive retained for row-wise recovery');
 const restored=JSON.parse(gunzipSync(await readFile(file)));
 assert.deepEqual(restored,JSON.parse(JSON.stringify(result)),'full raw timeline/creation graphs survive gzip');
 const timelineDigests=[];
 for(let slot=0;slot<result.logs.length;slot++){
  const log=result.logs[slot],copy=restored.logs[slot],native=await nativeProof(log);assert.deepEqual(await nativeProof(copy),native);
  timelineDigests.push({slot,...await hashPieces(jsonPieces(log)),commands:log.commands.length,inputs:log.inputs.length,events:log.events?.length??0,native,measurementStream:await hashPieces(jsonPieces(log.perceptionMeasurements)),measurementFrames:log.perceptionMeasurements.frames.length});
 }
 const{logs,...compact}=result;return{compact:{...compact,rawArchive:`raw-matches/${name}`,rawSHA256:proof.raw.sha256,rawBytes:proof.raw.bytes,timelineDigests},archive:{mode:result.mode,level:result.level,seed:result.seed,file:`raw-matches/${name}`,...proof}};
}
async function runMode(mode,count,definitions){
 const tasks=levels.flatMap(level=>Array.from({length:count},(_,i)=>({mode,level,seed:i+1}))),results=[],archives=[],checkpoints={},workers=[];
 const options={mode,level:'all',seconds:180,workers:2,map:'default',legacy:false,logs:true,screenSpan:113};const started=performance.now();
 try{
  await Promise.all([0,1].map(index=>new Promise((resolve,reject)=>{
   const worker=new Worker(collector,{workerData:{options,tasks:tasks.filter((_,i)=>i%2===index)}});workers.push(worker);let writes=Promise.resolve();
   worker.on('message',result=>{if(result.type==='sourceCheckpoint'){try{assert.equal(result.checkpoint.sha256,expected);checkpoints[expected]=result.checkpoint;}catch(error){reject(error);}return;}
    writes=writes.then(async()=>{const saved=await archiveMatch(result);results.push(saved.compact);archives.push(saved.archive);await write(`${dir}/progress-${mode}.json`,{mode,completed:results.length,total:tasks.length,latest:{level:result.level,seed:result.seed},archivedRaw:true});process.stderr.write(`${mode}/${result.level} seed${result.seed}: ${results.length}/${tasks.length} raw archived\n`);});writes.catch(reject);
   });worker.on('error',reject);worker.on('exit',code=>{if(code)reject(Error(`Worker exit${code}`));else writes.then(resolve,reject);});
  })));
 }catch(error){await Promise.all(workers.map(worker=>worker.terminate()));throw error;}
 results.sort((a,b)=>levels.indexOf(a.level)-levels.indexOf(b.level)||a.seed-b.seed);archives.sort((a,b)=>levels.indexOf(a.level)-levels.indexOf(b.level)||a.seed-b.seed);
 assert.equal(results.length,count*3);const report={schemaVersion:1,source:'current',configuration:{modes:[mode],levels,seeds:Array.from({length:count},(_,i)=>i+1),seconds:180,map:'default',army:'standard',worldSize:'huge',screenSpan:113},definitions,elapsedSeconds:(performance.now()-started)/1000,sourceCheckpoints:checkpoints,summary:aggregate(results),results};
 await write(`${dir}/${mode}-compact.json`,report);await write(`${dir}/${mode}-raw-manifest.json`,archives);await immutable();return{report,archives};
}
async function commandDone(args,log){const output=await open(log,'wx');try{await new Promise((resolve,reject)=>{const child=spawn('node',args,{stdio:['ignore',output.fd,output.fd]});child.on('error',reject);child.on('exit',code=>code?reject(Error(`Merge exit${code}`)):resolve());});}finally{await output.close();}}
async function* fullReportPieces(compact,archives){
 yield '{';let first=true;for(const[key,value]of Object.entries(compact)){if(key==='results')continue;if(!first)yield ',';first=false;yield JSON.stringify(key)+':';yield* jsonPieces(value);}
 yield ',"results":[';for(let index=0;index<archives.length;index++){if(index)yield ',';for await(const chunk of createReadStream(`${dir}/${archives[index].file}`).pipe(createGunzip()))yield chunk;}yield ']}\n';
}
async function launch(){
 assert.equal(JSON.parse(await readFile(`${dir}/serializer-proof.json`)).seats,9);await immutable();await mkdir(`${dir}/raw-matches`,{recursive:true});
 const prior=JSON.parse(await readFile(`${failed}/protocol-preregistration.json`)),smoke=JSON.parse(await readFile('/tmp/human-ai-observed-streams-smoke.json'));
 await write(`${dir}/protocol-preregistration.json`,{...prior,recovery:'Storage-only external frozen Worker API. Rerun every original120seed/config; immediate per-match exact compact JSON gzip/native graph checks; streamed full gzip; original failed archive preserved.',failedFirstLaunch:failed,serializerProof:'serializer-proof.json',pinning:'All process/worker/libuv affinity CPU6 inherited from taskset.',externalWrapperSHA256:(await hashFile('/tmp/human-ai-v14-streaming-recovery.mjs')).sha256});
 const started=performance.now(),allArchives=[],reports=[];
 for(const[mode,count]of modes){await write(`${dir}/status.json`,{state:'running',pid:process.pid,mode,completedModes:reports.map(report=>report.configuration.modes[0]),sourceCheckpointSHA256:expected});const completed=await runMode(mode,count,smoke.definitions);reports.push(completed.report);allArchives.push(...completed.archives);}
 const args=[collector,'--merge',modes.map(([mode])=>`${dir}/${mode}-compact.json`).join(','),'--compare',`${source}/docs/ai-humanity-before.json`,'--out',`${dir}/final120-compact-base.json`];
 await commandDone(args,`${dir}/merge.log`);const compact=JSON.parse(await readFile(`${dir}/final120-compact-base.json`));
 assert.equal(compact.results.length,120);assert.equal(compact.results.reduce((n,r)=>n+r.seats.length,0),360);assert.deepEqual(Object.keys(compact.sourceCheckpoints),[expected]);
 const expectedPairs=new Set(modes.flatMap(([mode,count])=>levels.flatMap(level=>Array.from({length:count},(_,i)=>`${mode}/${level}/${i+1}`))));
 assert.deepEqual(new Set(compact.results.map(r=>`${r.mode}/${r.level}/${r.seed}`)),expectedPairs);
 const rawProof=await gzipPieces(`${dir}/final120-full.json.gz`,fullReportPieces(compact,allArchives));
 compact.evidenceArchive={format:'gzip',path:'final120-full.json.gz',sha256:rawProof.gzip.sha256,bytes:rawProof.gzip.bytes,uncompressedSHA256:rawProof.raw.sha256,uncompressedBytes:rawProof.raw.bytes,method:'Exact streamed full report bytes, assembled from independently verified full raw match JSON archives; never serialized or parsed as one campaign-sized string.'};
 await write(`${dir}/final120-compact.json`,compact);await write(`${dir}/raw-match-manifest.json`,allArchives);await immutable();
 await write(`${dir}/status.json`,{state:'completeEvidenceReadyForReview',matches:120,seats:360,sourceCheckpointSHA256:expected,sourceArchiveDirectory:source,failedFirstLaunch:failed,elapsedSeconds:(performance.now()-started)/1000,maxSerializedLeafBytes:maxLeaf,evidenceArchive:compact.evidenceArchive,acceptance:'No automatic pass or waiver; original numeric gates and all censored stimuli retained.'});
 await write(`${dir}/evidence-sha256.json`,Object.fromEntries(await Promise.all((await readdir(dir)).filter(name=>name!=='evidence-sha256.json').map(async name=>[name,(await stat(`${dir}/${name}`)).isFile()?(await hashFile(`${dir}/${name}`)).sha256:null]))));
 console.log(JSON.stringify({status:'complete',matches:120,seats:360,sourceCheckpointSHA256:expected,evidenceArchive:compact.evidenceArchive}));
}
if(process.argv.includes('--self-test'))await selfTest();
else if(process.argv.includes('--launch-authorized')){try{await launch();}catch(error){await write(`${dir}/status.json`,{state:'failedOutputsRetained',error:String(error),stack:error.stack});throw error;}}
else throw Error('Use --self-test, then explicit --launch-authorized under CPU6 taskset.');
