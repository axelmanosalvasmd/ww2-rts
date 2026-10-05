import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {distribution} from '/tmp/human-ai-final-observed-runtime-v14-source/tools/ai-humanity.mjs';
const dir='/tmp/human-ai-final-observed-runtime-v14-streaming';
const status=JSON.parse(await readFile(`${dir}/status.json`));
if(status.state!=='completeEvidenceReadyForReview')throw Error('Full campaign is not complete');
const report=JSON.parse(await readFile(`${dir}/final120-compact.json`));
const bounds={easy:{screen:[.9,1.4],off:[3,6],apm:[20,35],peak:60,opening:[4,8]},normal:{screen:[.5,.8],off:[1.5,3],apm:[40,70],peak:120,opening:[3,6]},hard:{screen:[.3,.45],off:[.8,1.6],apm:[80,120],peak:200,opening:[2,4]}};
const range=(n,b)=>!Number.isFinite(n)?'not-evaluable':n>=b[0]&&n<=b[1]?'within-original-band':'outside-original-band';
const physical=i=>i.countsAPM!==false&&i.kind!=='beat'&&!(i.actor==='human'&&i.kind==='command');
const camera=i=>i.kind==='camera'||i.kind==='cameraJump'||i.kind?.startsWith('camera-');
const family=u=>({rifle:'infantry',conscript:'infantry',mg:'machineGun',mortar:'mortar',at:'antiTank',engineer:'engineer'}[u]??u??null);
const count=rows=>{const counts={};for(const row of rows){const k=JSON.stringify(row);counts[k]=(counts[k]??0)+1;}return {matches:rows.length,counts,distinct:Object.keys(counts).length,mostCommonShare:rows.length?Math.max(...Object.values(counts))/rows.length:null};};
const seats=[];
for(const archived of report.results){const match=JSON.parse(gunzipSync(await readFile(`${dir}/${archived.rawArchive}`)));for(const seat of match.seats){
 const m=seat.metrics,log=match.logs[seat.slot],inputs=log.inputs.filter(physical),accepted=log.commands.filter(c=>c.accepted===true),bindings=[],active=new Map();
 for(const input of inputs){
  const number=/^Digit([1-9])$/.exec(input.input?.code??'')?.[1];
  if(input.kind==='group-set'){const binding={number:number??null,tick:input.tick,ids:input.ids??[],recalls:0};bindings.push(binding);if(number)active.set(number,binding);}
  else if(['group-recall','camera-group'].includes(input.kind)&&number&&active.has(number))active.get(number).recalls++;
 }
 const physical60=[];for(let start=0;start+1200<=Math.round(match.seconds*20);start+=1200)physical60.push(inputs.filter(i=>i.tick>start&&i.tick<=start+1200).length);
 const purchases=accepted.filter(c=>c.command.t==='buy'&&c.tick<=900).slice(0,5).map(c=>c.command.unit),inspections=inputs.filter(i=>i.inspection);
 const primary=m.measurementPolicyComparison.originalOracle.primaryOnly.requiredScreenPopulation;
 const observed=m.measurementPolicyComparison.observed.explicitLinked.requiredScreenPopulation,observedPrimary=m.measurementPolicyComparison.observed.primaryOnly.requiredScreenPopulation;
 seats.push({mode:match.mode,level:match.level,seed:match.seed,slot:seat.slot,faction:seat.faction,seconds:match.seconds,sourceCheckpointSHA256:match.sourceCheckpointSHA256,
 physicalAPM60Windows:physical60,physicalAPM60Mean:m.physicalInputAPM.windows60.mean,physicalAPM60Status:range(m.physicalInputAPM.windows60.mean,bounds[match.level].apm),physicalAPM10Peak:m.physicalInputAPM.windows10.max,
 commands:m.commands,acceptedCommands:m.acceptedCommands,rejectedCommands:m.rejectedCommands,commandAPM:m.commandAPM.matchMean,firstOrderSeconds:m.firstOrderSeconds,firstBuySeconds:m.firstBuySeconds,
 originalRequired:m.requiredScreenPopulation,originalPrimaryOnlyRequired:primary,observedRequired:observed,observedPrimaryOnlyRequired:observedPrimary,policyComparison:m.measurementPolicyComparison,
 originalRequiredKMStatus:range(m.requiredScreenPopulation?.firstAction.survival.medianSeconds,bounds[match.level].screen),
 cameraInputs:inputs.filter(camera).length,physicalInputs:inputs.length,physicalKinds:inputs.reduce((out,i)=>(out[i.kind]=(out[i.kind]??0)+1,out),{}),
 groupSets:bindings.length,singleUnitBindings:bindings.filter(b=>b.ids.length===1).length,neverRecalledBindings:bindings.filter(b=>!b.recalls).length,neverRecalledSingleBindings:bindings.filter(b=>b.ids.length===1&&!b.recalls).length,
 groupRecallInputs:inputs.filter(i=>i.kind==='group-recall').length,cameraGroupInputs:inputs.filter(i=>i.kind==='camera-group').length,
 inspections:{attempts:inspections.length,acquired:inspections.filter(i=>i.inspectionAcquired===true).length,missed:inspections.filter(i=>i.inspectionAcquired===false).length},
 acceptedNonBuyCommands:accepted.filter(c=>c.command.t!=='buy').length,acceptedPurchases:accepted.filter(c=>c.command.t==='buy').length,acceptedAbilityCommands:accepted.filter(c=>c.command.t==='ability').length,
 rejectionReasons:log.commands.filter(c=>c.accepted===false).reduce((out,c)=>(out[c.rejectionReason]=(out[c.rejectionReason]??0)+1,out),{}),
 firstAcceptedPurchaseFamily:family(purchases[0]),acceptedPurchaseSequenceFirst45Seconds:purchases,purchaseFamilySequence:purchases.map(family),
 concernAlignment:m.concernAlignment,crossMap:m.crossMap,minimumOriginalOnScreenCompletedReactionSeconds:m.reactionEvents?.onScreen.firstAction.seconds.min,
 minimumNativeOnScreenCompletedReactionSeconds:m.nativeReactionEvents?.onScreen.firstAction.seconds.min});
}}
const groups={};
for(const [key,summary]of Object.entries(report.summary)){
 const rows=seats.filter(s=>`${s.mode}/${s.level}`===key),level=rows[0].level,b=bounds[level],sum=k=>rows.reduce((n,r)=>n+r[k],0),policies=summary.measurementPolicyComparison;
 const windows=rows.flatMap(r=>r.physicalAPM60Windows),peak=summary.physicalInputAPM10WindowPeak.max,first=summary.firstOrderSeconds;
 const firstFamily=Object.fromEntries(['USA','Germany','USSR'].map(faction=>[faction,count(rows.filter(r=>r.faction===faction).map(r=>r.firstAcceptedPurchaseFamily))]));
 groups[key]={matches:summary.matches,seats:rows.length,bounds:b,
 originalRequiredFirstCompletedKMSeconds:summary.requiredScreenPopulation?.firstAction.medianSeconds??null,
 originalRequiredKMStatus:range(summary.requiredScreenPopulation?.firstAction.medianSeconds,b.screen),
 originalRequired:summary.requiredScreenPopulation,policyComparison:policies,
 physicalAPM60SeatMeanMedian:summary.physicalInputAPM60WindowMean.median,physicalAPM60Status:range(summary.physicalInputAPM60WindowMean.median,b.apm),physicalAPM60AllWindows:distribution(windows),windowsWithinBand:windows.filter(n=>range(n,b.apm)==='within-original-band').length,totalWindows:windows.length,
 physicalAPM60OutsideSeats:rows.filter(r=>r.physicalAPM60Status!=='within-original-band').map(r=>({seed:r.seed,slot:r.slot,faction:r.faction,value:r.physicalAPM60Mean})),
 peak10Max:peak,peak10Status:peak<=b.peak?'within-original-cap':'outside-original-cap',firstOrder:first,firstOrderStatus:first.min>=b.opening[0]&&first.max<=b.opening[1]?'all-within-original-band':'outside-original-band',
 conditionalOffScreenSeatMedianSeconds:summary.offScreenAlertFirstActionMedianSeconds.median,conditionalOffScreenStatus:range(summary.offScreenAlertFirstActionMedianSeconds.median,b.off),offScreenRequiredGate:'not-evaluable: alerts lack a prospective required-response policy; conditional answered medians are not population acceptance',
 maxCommandsPerTick:summary.maxCommandsPerTick.max,
 physicalInputs:sum('physicalInputs'),cameraInputs:sum('cameraInputs'),acceptedNonBuyCommands:sum('acceptedNonBuyCommands'),acceptedPurchases:sum('acceptedPurchases'),acceptedAbilityCommands:sum('acceptedAbilityCommands'),
 groups:{bindings:sum('groupSets'),single:sum('singleUnitBindings'),neverRecalled:sum('neverRecalledBindings'),neverRecalledSingle:sum('neverRecalledSingleBindings'),recallInputs:sum('groupRecallInputs'),cameraGroupInputs:sum('cameraGroupInputs')},
 inspections:Object.fromEntries(['attempts','acquired','missed'].map(k=>[k,rows.reduce((n,r)=>n+r.inspections[k],0)])),
 concernAlignment:summary.concernAlignment,
 originalOnScreenFloorSeconds:distribution(rows.map(r=>r.minimumOriginalOnScreenCompletedReactionSeconds)).min,nativeOnScreenFloorSeconds:distribution(rows.map(r=>r.minimumNativeOnScreenCompletedReactionSeconds)).min,
 openingByFaction:Object.fromEntries(['USA','Germany','USSR'].map(faction=>{const fr=rows.filter(r=>r.faction===faction),first=count(fr.map(r=>r.firstAcceptedPurchaseFamily)),seq=count(fr.map(r=>r.purchaseFamilySequence)),meaningfulFirst=count(fr.map(r=>r.firstAcceptedPurchaseFamily).filter(Boolean)),meaningfulSequence=count(fr.map(r=>r.purchaseFamilySequence).filter(row=>row.length));return[faction,{firstAcceptedFamily:first,acceptedFamilySequence:seq,meaningfulFirstFamilies:meaningfulFirst.distinct,meaningfulFamilySequences:meaningfulSequence.distinct,gate:fr.length>=20?{firstFamilyDiagnosticStatus:meaningfulFirst.distinct>=3&&first.mostCommonShare<=.5?'pass':'fail',familySequenceStatus:meaningfulSequence.distinct>=3&&seq.mostCommonShare<=.5?'pass':'fail'}:{status:'not-evaluable: fewer than20seeds'},coordinateNoveltyUsed:false}];}))};
 groups[key].quarterSecondCrossScreenPairs=rows.reduce((n,r)=>n+r.crossMap.commandPairsWithinQuarterSecond,0);
}
const output={openingInterpretation:'The original opening gate uses accepted purchase-family sequences over20seeds per faction; first-purchase-family concentration is diagnostic only, not an additional mandatory gate.',status:'Complete final120 evidence, no automatic acceptance. Failed gates and unknown populations retained.',source:report.source,configuration:report.configuration,sourceCheckpoints:report.sourceCheckpoints,
 method:'Original bounds and completed endpoints are unchanged. Top-level gates retain original screen-v1 oracle populations, including unperceived censored stimuli. Observed policy and primary-only/explicit-linked scores are separate. All full60-second windows and every seat are retained. Opening evidence uses accepted purchase families, never coordinate novelty. Group non-recall counts are diagnostic, not removed from original APM.',groups,seats};
await writeFile(`${dir}/gate-analysis.json`,JSON.stringify(output,null,2)+'\n');
await writeFile(`${dir}/seats.tsv`,['mode\tlevel\tseed\tslot\tfaction\tphysicalAPM60Mean\tpeak10\toriginalRequired\toriginalAnswered\toriginalCensored\toriginalKM\tobservedRequired\tobservedAnswered\tobservedCensored\tobservedKM\toriginalPrimaryAnswered\toriginalPrimaryCensored\toriginalPrimaryKM\tobservedPrimaryAnswered\tobservedPrimaryCensored\tobservedPrimaryKM\tacceptedNonBuy\tcameras',...seats.map(s=>[s.mode,s.level,s.seed,s.slot,s.faction,s.physicalAPM60Mean,s.physicalAPM10Peak,s.originalRequired?.requiredEvents??'',s.originalRequired?.firstAction.answered??'',s.originalRequired?.firstAction.unanswered??'',s.originalRequired?.firstAction.survival.medianSeconds??'',s.observedRequired?.requiredEvents??'',s.observedRequired?.firstAction.answered??'',s.observedRequired?.firstAction.unanswered??'',s.observedRequired?.firstAction.survival.medianSeconds??'',s.originalPrimaryOnlyRequired?.firstAction.answered??'',s.originalPrimaryOnlyRequired?.firstAction.unanswered??'',s.originalPrimaryOnlyRequired?.firstAction.survival.medianSeconds??'',s.observedPrimaryOnlyRequired?.firstAction.answered??'',s.observedPrimaryOnlyRequired?.firstAction.unanswered??'',s.observedPrimaryOnlyRequired?.firstAction.survival.medianSeconds??'',s.acceptedNonBuyCommands,s.cameraInputs].join('\t'))].join('\n')+'\n');
console.log(JSON.stringify(Object.fromEntries(Object.entries(groups).map(([key,g])=>[key,{requiredKM:g.originalRequiredFirstCompletedKMSeconds,RT:g.originalRequiredKMStatus,physicalAPM60:g.physicalAPM60SeatMeanMedian,APM:g.physicalAPM60Status,peak:g.peak10Max,first:g.firstOrderStatus,required:g.originalRequired?.requiredEvents,answered:g.originalRequired?.firstAction.observed,censored:g.originalRequired?.firstAction.censored,observedKM:g.policyComparison.observed.explicitLinked.requiredScreenPopulation?.firstAction.medianSeconds,acceptedNonBuy:g.acceptedNonBuyCommands,cameras:g.cameraInputs}]))));
