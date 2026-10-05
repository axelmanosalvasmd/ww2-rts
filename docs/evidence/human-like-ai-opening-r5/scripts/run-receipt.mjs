import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {performance} from 'node:perf_hooks';
const directory='/tmp/human-ai-opening-receipt-followup',levels=['easy','normal','hard'];
const roots={base:'/tmp/human-ai-opening-paired-candidate-source',candidate:'/tmp/human-ai-opening-receipt-source'};
const json=(path,value)=>writeFile(path,JSON.stringify(value,null,2)+'\n');
async function immutable(root){const manifest=JSON.parse(await readFile(`${root}/source-archive.json`));for(const[file,sha]of Object.entries(manifest.files)){assert.equal(createHash('sha256').update(await readFile(`${root}/${file}`)).digest('hex'),sha,file);assert.equal((await stat(`${root}/${file}`)).mode&0o222,0,file);}return manifest;}
function definitions(source){const marker='definitions: {',start=source.indexOf(marker,source.indexOf('const summary = aggregate(results)'));assert.ok(start>=0);const end=source.indexOf('}, elapsedSeconds:',start);assert.ok(end>start);return Function(`return (${source.slice(start+12,end+1)});`)();}
let commonDefinitions;
async function run(label){
 const root=roots[label],out=`${directory}/${label}`;await immutable(root);await mkdir(`${out}/raw-matches`,{recursive:true});
 const tool=await import(`${root}/tools/ai-humanity.mjs`),stream=await import(`${root}/tools/json-stream.mjs`),expected=await tool.sourceCheckpoint(false);
 const defs=definitions(await readFile(`${root}/tools/ai-humanity.mjs`,'utf8'));if(commonDefinitions)assert.deepEqual(defs,commonDefinitions);else commonDefinitions=defs;
 await json(`${out}/source-checkpoint.json`,expected);
 const tasks=levels.flatMap(level=>Array.from({length:20},(_,i)=>({mode:'conquest',level,seed:i+1}))),options={mode:'conquest',level:'all',seconds:45,workers:2,map:'default',legacy:false,logs:true,screenSpan:113};
 const results=[],checkpoints={},rawFiles=new Map(),workers=[],started=performance.now();
 await json(`${directory}/status.json`,{state:'running',pid:process.pid,treatment:label,sourceCheckpointSHA256:expected.sha256});
 try{
  await Promise.all([0,1].map(index=>new Promise((resolve,reject)=>{
   const worker=new Worker(`${root}/tools/ai-humanity.mjs`,{workerData:{options,tasks:tasks.filter((_,i)=>i%2===index),spoolDirectory:`${out}/raw-matches`}});workers.push(worker);let pending=Promise.resolve();
   worker.on('message',value=>{pending=pending.then(async()=>{
    if(value.type==='sourceCheckpoint'){assert.equal(value.checkpoint.sha256,expected.sha256);checkpoints[expected.sha256]=value.checkpoint;return;}
    const{spoolFile,...result}=value;assert.equal(result.sourceCheckpointSHA256,expected.sha256);assert.equal(result.seats.length,3);assert.equal(result.seconds,45);
    for(const seat of result.seats){const p=seat.metrics.measurementPolicyComparison;assert.equal(p.coverage.originalFromMatchStart,true);assert.equal(p.coverage.originalRecorded,true);assert.deepEqual(seat.metrics.requiredScreenPopulation,p.originalOracle.explicitLinked.requiredScreenPopulation);}
    assert.ok((await stat(spoolFile)).size>0);results.push(result);rawFiles.set(result,spoolFile);await json(`${out}/progress.json`,{completed:results.length,total:60,latest:{level:result.level,seed:result.seed},persistentFullRaw:spoolFile});process.stderr.write(`${label}/${result.level} seed${result.seed}: ${results.length}/60 retained\n`);
   });pending.catch(reject);});
   worker.on('error',reject);worker.on('exit',code=>code?reject(Error(`Worker exited${code}`)):pending.then(resolve,reject));
  })));
 }catch(error){await Promise.all(workers.map(w=>w.terminate()));throw error;}
 results.sort((a,b)=>levels.indexOf(a.level)-levels.indexOf(b.level)||a.seed-b.seed);assert.equal(results.length,60);assert.equal(results.reduce((n,r)=>n+r.seats.length,0),180);
 const report={schemaVersion:1,source:'current',configuration:{modes:['conquest'],levels,seeds:Array.from({length:20},(_,i)=>i+1),seconds:45,map:'default',army:'standard',worldSize:'huge',screenSpan:113},definitions:defs,elapsedSeconds:(performance.now()-started)/1000,sourceCheckpoints:checkpoints,summary:tool.aggregate(results),results};
 await stream.writeJSON(`${out}/full.json`,{...report,results:results.map(result=>stream.rawJSONFile(rawFiles.get(result)))},{space:2,newline:true});
 await tool.packageReport(`${out}/full.json`,`${out}/compact.json`,`${out}/full.json.gz`);
 await json(`${out}/raw-manifest.json`,await Promise.all(results.map(async result=>({mode:result.mode,level:result.level,seed:result.seed,path:rawFiles.get(result),...await stream.hashFile(rawFiles.get(result))}))));
 await immutable(root);return{label,checkpoint:expected.sha256,matches:60,seats:180,elapsedSeconds:(performance.now()-started)/1000};
}
if(!process.argv.includes('--launch-authorized'))throw Error('Requires explicit --launch-authorized under tasksetCPU6.');
try{const results=[];const previous=JSON.parse(await readFile(`${directory}/base/compact.json`));assert.equal(previous.results.length,60);assert.equal(previous.results.reduce((n,r)=>n+r.seats.length,0),180);commonDefinitions=previous.definitions;results.push({label:'base',checkpoint:previous.results[0].sourceCheckpointSHA256,matches:60,seats:180,reusedExactPreviousTrial:true});results.push(await run('candidate'));await json(`${directory}/status.json`,{state:'completeEvidenceReadyForReview',results,acceptance:'Opening diagnostic only45seconds,all outcomes retained;no180second/performance acceptance.'});console.log(JSON.stringify({status:'complete',results}));}
catch(error){await json(`${directory}/status.json`,{state:'failedOutputsRetained',error:String(error),stack:error.stack});throw error;}
