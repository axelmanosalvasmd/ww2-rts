import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {verifyArchive} from './archive-check.mjs';
import {createGunzip} from 'node:zlib';
import {spawn} from 'node:child_process';
import {performance} from 'node:perf_hooks';
const planIndex=process.argv.indexOf('--protocol');assert.ok(planIndex>0);assert.ok(process.argv.includes('--launch-authorized'),'Requires root campaign launch authorization.');
const plan=JSON.parse(await readFile(process.argv[planIndex+1],'utf8'));
assert.equal(plan.matches,120);assert.equal(plan.requestedSeconds,180);assert.equal(plan.workers,2);assert.deepEqual(plan.workerCPUs,[6,10]);assert.ok(plan.freezeAnnouncement);assert.ok(plan.sourceArchiveDirectory);assert.equal(plan.manualPolicy?.approved,true,'Manual policy needs root-approved public rule and finalized collector option.');assert.equal(plan.sourceApproved,true,'Final V16 source approval is required.');assert.equal(plan.manualPolicy.name,'screen-manual-v2');assert.equal(plan.manualPolicy.streamSchema,'ww2-public-manual-response-v2');assert.equal(plan.manualPolicy.ruleDeclarationPath,`${plan.sourceArchiveDirectory}/docs/human-like-ai-manual-response-v2.md`);assert.equal(plan.manualPolicy.ruleDeclarationSHA256,'88b35c9f241b60af78fbadd7392d3f14203869c18b4d7e931ce64112f6d91030');assert.ok(plan.manualPolicy.helperSHA256);assert.ok(plan.manualPolicy.adapterSHA256);assert.ok(plan.manualPolicy.perceptionSHA256);assert.ok(plan.manualPolicy.collectorSHA256);
const source=plan.sourceArchiveDirectory,dir=plan.evidenceDirectory,tool=await import(`${source}/tools/ai-humanity.mjs`),storage=await import(`${source}/tools/json-stream.mjs`),expected=plan.expectedRuntimeCheckpointSHA256;
let frozenRules;
async function recomputeSeat(log,seconds){frozenRules ??= Promise.all([import(`${source}/shared/sim.js`),import(`${source}/client/keys.js`)]);const[sim,keys]=await frozenRules;return {...tool.summarizeSeat(log,seconds,113),manualResponsePolicy:tool.manualResponseMetrics(log,seconds,{...sim,bindings:keys.bindings})};}
function frozenDefinitions(text){const marker='definitions: {',start=text.indexOf(marker,text.indexOf('const summary = aggregate(results)'));assert.ok(start>=0);const end=text.indexOf('}, elapsedSeconds:',start);assert.ok(end>start);return Function(`return (${text.slice(start+12,end+1)});`)();}
const definitions=frozenDefinitions(await readFile(`${source}/tools/ai-humanity.mjs`,'utf8'));
const modes=[['conquest',20],['classic',10],['world',10]],levels=['easy','normal','hard'];
const manualIssue=(seat,log)=>{const score=seat.metrics.manualResponsePolicy,stream=log?.manualMeasurements,issues=[];
 if(stream?.schema!=='ww2-public-manual-response-v2'||stream?.policy!=='screen-manual-v2')issues.push('missing-or-mismatched-public-manual-stream');
 if(stream?.startedTick!==0||stream?.operationLinksRecorded!==true)issues.push('incomplete-manual-capture');
 if(score?.physicalEndpointKnown!==true)issues.push('manual-physical-endpoint-unknown');
 if(!Array.isArray(log?.events)||log?.physicalInputsRecorded!==true)issues.push('missing-native-creation-or-input-coverage');
 if(score?.policy!=='screen-manual-v2')issues.push('missing-manual-metric');
 if(!Number.isSafeInteger(score?.creationEvents)||!Number.isSafeInteger(score?.requiredEvents)||!Number.isSafeInteger(score?.unknownEvents))issues.push('missing-manual-population-counts');
 if(score?.unknownEvents!==0||score?.audit?.inconsistentClassifications!==0||score?.audit?.missingCreationProofs!==0)issues.push('unknown-or-inconsistent-manual-creation');
 if(score?.requiredEvents>0&&score?.evaluable!==true)issues.push('positive-population-not-evaluable');
 for(const endpoint of ['firstCompletedAction','acceptedCommand'])if(score?.[endpoint]?.required!==score?.requiredEvents||score?.[endpoint]?.answered+score?.[endpoint]?.censored!==score?.requiredEvents)issues.push(`incomplete-${endpoint}-censor-accounting`);
 return issues;};
const manualGroupIssue=(key,group)=>{const score=group?.manualResponsePolicy,issues=[];
 if(score?.policy!=='screen-manual-v2'||score?.recordedSeats!==group?.seats)issues.push('missing-group-manual-coverage');
 if(!Number.isSafeInteger(score?.requiredEvents)||score.requiredEvents<=0)issues.push('zero-or-unknown-required-population');
 if(score?.unknownEvents!==0)issues.push('unknown-group-creations');
 if(!Number.isSafeInteger(score?.evaluableSeats)||score.evaluableSeats<=0)issues.push('zero-evaluable-seats');
 for(const endpoint of ['firstCompletedAction','acceptedCommand'])if(score?.[endpoint]?.answered+score?.[endpoint]?.censored!==score?.requiredEvents)issues.push(`incomplete-group-${endpoint}-censor-accounting`);
 if(score?.firstCompletedAction?.survival?.medianIdentifiable!==true||!Number.isFinite(score.firstCompletedAction.survival.medianSeconds))issues.push('unidentified-firstCompletedAction-KM');
 return issues.map(reason=>({group:key,reason}));};
const write=(path,value)=>storage.writeJSON(path,value,{space:2,newline:true});
async function immutable(){
 await verifyArchive(source,plan.sourceManifest,storage.hashFile);
 assert.equal((await storage.hashFile(plan.manualPolicy.ruleDeclarationPath)).sha256,plan.manualPolicy.ruleDeclarationSHA256);
 assert.equal((await storage.hashFile(`${source}/tools/ai-manual-response-policy.mjs`)).sha256,plan.manualPolicy.helperSHA256);
 assert.equal((await storage.hashFile(`${source}/tools/ai-manual-response-capture.mjs`)).sha256,plan.manualPolicy.adapterSHA256);
 assert.equal((await storage.hashFile(`${source}/shared/ai-perception.js`)).sha256,plan.manualPolicy.perceptionSHA256);
 assert.equal((await storage.hashFile(`${source}/tools/ai-humanity.mjs`)).sha256,plan.manualPolicy.collectorSHA256);
 assert.equal((await tool.sourceCheckpoint(false)).sha256,expected);
}
async function decompressedHash(path){let bytes=0;const hash=createHash('sha256');for await(const chunk of createReadStream(path).pipe(createGunzip())){hash.update(chunk);bytes+=chunk.length;}return{sha256:hash.digest('hex'),bytes};}
function validMetrics(result){
 assert.equal(result.sourceCheckpointSHA256,expected);assert.equal(result.seats.length,3);assert.ok(result.seconds===180||result.ended===true);
 for(const seat of result.seats){const policies=seat.metrics.measurementPolicyComparison;if(!policies)continue;
  for(const policy of ['originalOracle','observed'])assert.equal(policies[policy].primaryOnly.requiredScreenPopulation?.requiredEvents,policies[policy].explicitLinked.requiredScreenPopulation?.requiredEvents);
  assert.deepEqual(seat.metrics.requiredScreenPopulation,policies.originalOracle.explicitLinked.requiredScreenPopulation);
 }
}
async function modeBatch(mode,count){
 await immutable();
 const tasks=levels.flatMap(level=>Array.from({length:count},(_,i)=>({mode,level,seed:i+1})));
 const results=[],checkpointRows={},rawFiles=new Map(),archives=[],hosts=[],manualCoverageIssues=[],started=performance.now(),spool=`${dir}/raw-matches/${mode}`;
 await mkdir(spool,{recursive:true});await mkdir(`${dir}/compact-spool`,{recursive:true});await mkdir(`${dir}/worker-config`,{recursive:true});
 const options={mode,level:'all',seconds:180,workers:2,map:'default',legacy:false,logs:true,screenSpan:113,manualPolicy:'screen-manual-v2'};
 const receive=async message=>{
  if(message.type==='sourceCheckpoint'){assert.equal(message.checkpoint.sha256,expected);checkpointRows[expected]=message.checkpoint;return;}
  assert.equal(message.type,'match');
  const result=JSON.parse(await readFile(message.compactFile,'utf8')),spoolFile=message.spoolFile;
  assert.equal(result.mode,mode);assert.equal(result.level,message.level);assert.equal(result.seed,message.seed);
  validMetrics(result);assert.ok((await stat(spoolFile)).size>0);
  const archive=`${spoolFile}.gz`,staged=await storage.stageGzip(spoolFile,archive);
  try{assert.deepEqual(await decompressedHash(staged.staged.path),staged.raw);await staged.staged.commit();}
  finally{await staged.staged.cleanup();}
  const graph=JSON.parse(await readFile(spoolFile,'utf8'));assert.equal(graph.logs.length,result.seats.length);
  const digests=[];
  for(const seat of result.seats){const log=graph.logs[seat.slot];assert.deepEqual(await recomputeSeat(log,graph.seconds),seat.metrics);const manual=manualIssue(seat,log);if(manual.length)manualCoverageIssues.push({mode,level:result.level,seed:result.seed,slot:seat.slot,issues:manual});digests.push({slot:seat.slot,sha256:(await storage.hashJSON(log)).sha256,commands:log.commands.length,inputs:log.inputs.length,events:log.events?.length??0,measurementFrames:log.perceptionMeasurements?.frames?.length??0,measurementStreamSHA256:log.perceptionMeasurements?(await storage.hashJSON(log.perceptionMeasurements)).sha256:null,manualStreamSHA256:log.manualMeasurements?(await storage.hashJSON(log.manualMeasurements)).sha256:null});}
  results.push(result);rawFiles.set(result,spoolFile);
  archives.push({mode,level:result.level,seed:result.seed,file:spoolFile,gzipFile:archive,raw:staged.raw,gzip:staged.gzip,timelineDigests:digests});
  await write(`${dir}/${mode}-raw-manifest.json`,archives);
  await write(`${dir}/progress-${mode}.json`,{completed:results.length,total:tasks.length,latest:{level:result.level,seed:result.seed},fullNativePrivateRawRetained:true,sourceCheckpointSHA256:expected});
  process.stderr.write(`${mode}/${result.level} seed ${result.seed}: ${results.length}/${tasks.length} complete raw verified\n`);
 };
 try{await Promise.all([0,1].map(async index=>{
  const cpu=plan.workerCPUs[index],configPath=`${dir}/worker-config/${mode}-${index}.json`;
  await write(configPath,{cpu,source,expectedRuntimeCheckpointSHA256:expected,options,tasks:tasks.filter((_,i)=>i%2===index),spoolDirectory:spool,compactDirectory:`${dir}/compact-spool`});
  await new Promise((resolve,reject)=>{
   const host=spawn('taskset',['-c',String(cpu),'node','/tmp/human-ai-final-v16-v4-preparation/worker-host.mjs',configPath],{stdio:['ignore','pipe','pipe']});
   hosts.push(host);let lines='',pending=Promise.resolve(),settled=false;
   const fail=error=>{if(!settled){settled=true;reject(error);}};
   host.stdout.on('data',chunk=>{lines+=chunk.toString('utf8');for(let cut;(cut=lines.indexOf('\n'))>=0;){const line=lines.slice(0,cut);lines=lines.slice(cut+1);if(line)pending=pending.then(()=>receive(JSON.parse(line)));pending.catch(fail);}});
   host.stderr.on('data',chunk=>process.stderr.write(chunk));
   host.on('error',fail);
   host.on('exit',code=>pending.then(()=>{if(lines.trim())throw Error('Incomplete worker message');if(code!==0)throw Error(`CPU${cpu} worker host exited ${code}`);if(!settled){settled=true;resolve();}},fail));
  });
 }));}
 catch(error){for(const host of hosts)host.kill();throw error;}
 results.sort((a,b)=>levels.indexOf(a.level)-levels.indexOf(b.level)||a.seed-b.seed);
 assert.equal(results.length,count*3);for(const level of levels)assert.deepEqual(results.filter(r=>r.level===level).map(r=>r.seed),Array.from({length:count},(_,i)=>i+1));
 const report={schemaVersion:1,source:'current',configuration:{modes:[mode],levels,seeds:Array.from({length:count},(_,i)=>i+1),seconds:180,map:'default',army:'standard',worldSize:'huge',screenSpan:113,manualPolicy:'screen-manual-v2'},definitions,elapsedSeconds:(performance.now()-started)/1000,sourceCheckpoints:checkpointRows,summary:tool.aggregate(results),results};
 await storage.writeJSON(`${dir}/${mode}-full.json`,{...report,results:results.map(r=>storage.rawJSONFile(rawFiles.get(r)))},{space:2,newline:true});
 await tool.packageReport(`${dir}/${mode}-full.json`,`${dir}/${mode}-compact.json`,`${dir}/${mode}-full.json.gz`);
 await immutable();await write(`${dir}/${mode}-manual-coverage-issues.json`,manualCoverageIssues);return report;
}
async function child(args,log){await new Promise((resolve,reject)=>{const process=spawn('node',args,{stdio:['ignore','pipe','pipe']}),chunks=[];process.stdout.on('data',chunk=>chunks.push(chunk));process.stderr.on('data',chunk=>chunks.push(chunk));process.on('error',reject);process.on('exit',async code=>{try{await writeFile(log,Buffer.concat(chunks));code?reject(Error(`Command exit ${code}`)):resolve();}catch(error){reject(error);}});});}
async function verifyMerged(){let matches=0,seats=0;const seen=new Set(),incompleteMeasurementSeats=[],manualCoverageIssues=[],manualZeroExposureSeats=[];const compact=await storage.readReport(`${dir}/final120-full.json.gz`,async result=>{matches++;validMetrics(result);const{logs,...row}=result;seats+=result.seats.length;for(const seat of result.seats){const issues=manualIssue(seat,logs[seat.slot]);if(issues.length)manualCoverageIssues.push({mode:result.mode,level:result.level,seed:result.seed,slot:seat.slot,issues});if(seat.metrics.manualResponsePolicy?.requiredEvents===0&&!issues.length)manualZeroExposureSeats.push({mode:result.mode,level:result.level,seed:result.seed,slot:seat.slot});const coverage=seat.metrics.measurementPolicyComparison?.coverage;if(coverage?.originalFromMatchStart!==true)incompleteMeasurementSeats.push({mode:result.mode,level:result.level,seed:result.seed,slot:seat.slot,coverage:coverage??null});}seen.add(`${result.mode}/${result.level}/${result.seed}`);for(const seat of result.seats)assert.deepEqual(await recomputeSeat(logs[seat.slot],result.seconds),seat.metrics);return row;},{gzip:true});
 assert.equal(matches,120);assert.equal(seats,360);for(const[mode,count]of modes)for(const level of levels)for(let seed=1;seed<=count;seed++)assert.ok(seen.has(`${mode}/${level}/${seed}`));assert.deepEqual(tool.aggregate(compact.results),compact.summary);assert.deepEqual(Object.keys(compact.sourceCheckpoints),[expected]);const manualGroupIssues=Object.entries(compact.summary).flatMap(([key,group])=>manualGroupIssue(key,group));await immutable();return{status:'PASS',matches,seats,allFrozenSeatMetricsRecomputed:true,pooledMetricsEqual:true,allPoliciesDualScoresCensorsPreserved:true,sourceCheckpointSHA256:expected,incompleteMeasurementSeats,manualGateEvaluable:manualCoverageIssues.length===0&&manualGroupIssues.length===0,manualCoverageIssues,manualZeroExposureSeats,manualGroupIssues,acceptedCommandKMDiagnostics:Object.entries(compact.summary).map(([group,row])=>({group,medianSeconds:row.manualResponsePolicy?.acceptedCommand?.survival?.medianSeconds??null,medianIdentifiable:row.manualResponsePolicy?.acceptedCommand?.survival?.medianIdentifiable===true})),earlyEndedMatches:compact.results.filter(r=>r.seconds<180).map(({mode,level,seed,seconds})=>({mode,level,seed,seconds}))};}
try{
 await immutable();for(const[mode,count]of modes){await write(`${dir}/status.json`,{state:'running',pid:process.pid,mode,sourceCheckpointSHA256:expected});await modeBatch(mode,count);}
 const archiveRows=[];for(const[mode]of modes)archiveRows.push(...JSON.parse(await readFile(`${dir}/${mode}-raw-manifest.json`)));await write(`${dir}/raw-match-manifest.json`,archiveRows);
 await child([`${source}/tools/ai-humanity.mjs`,'--merge',modes.map(([mode])=>`${dir}/${mode}-full.json`).join(','),'--compare',`${source}/docs/ai-humanity-before.json`,'--out',`${dir}/final120-full.json`],`${dir}/merge.log`);
 await tool.packageReport(`${dir}/final120-full.json`,`${dir}/final120-compact.json`,`${dir}/final120-full.json.gz`);const verification=await verifyMerged();await write(`${dir}/independent-verification.json`,verification);
 await write(`${dir}/status.json`,{state:verification.manualGateEvaluable?'completeEvidenceReadyForReview':'completeEvidenceManualGateUnknown',...verification,acceptance:'No automatic waiver or pass. Original thresholds/populations and all unknown manual rows retained; current results require review.'});
}catch(error){await write(`${dir}/status.json`,{state:'failedAllOutputsRetained',error:String(error),stack:error.stack,sourceCheckpointSHA256:expected});throw error;}
