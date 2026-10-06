import {isDeepStrictEqual as equal} from 'node:util';
import {match} from '../client/keys.js';
import {createPublicAlertCaptureV2,scorePublicAlertsV2,publicAlertOnScreen} from './ai-public-alert-response-v2.mjs';
import {classifyPublicAlert,publicAlertKM} from './ai-public-alert-response.mjs';
export const PUBLIC_ALERT_POLICY_V3='public-danger-alert-v3';
export const PUBLIC_ALERT_STREAM_V3='ww2-public-alert-response-v3';
const sealed=new WeakMap(),key=e=>`${e.id}/${e.tick}`,tick=n=>Number.isSafeInteger(n)&&n>=0;
const pose=c=>c&&({x:c.x,z:c.z,yaw:c.yaw??0,distance:c.distance??60});
function receiptFor(log,index){
 const stream=log.alertMeasurementsV2,receipt=stream.completions.find(r=>r.inputIndex===index),start=stream.starts.find(s=>s.id===receipt?.startId),op=stream.operations.find(o=>o.id===receipt?.operationId),input=log.inputs[index];
 if(!receipt||!start||!op||!input||start.operationId!==op.id||!equal(receipt.nativeDescriptor,input)||!equal(start.input,input.input)
  ||![op.queuedTick,start.startedTick,receipt.completedTick].every(tick)||op.queuedTick!==op.registeredAtTick||start.startedTick!==start.registeredAtTick||receipt.completedTick!==receipt.registeredAtTick
  ||input.queuedTick!==op.queuedTick||input.inputStartedTick!==start.startedTick||input.motorTicks!==start.motorTicks||input.kind!==start.kind||input.tick!==receipt.completedTick
  ||start.motorTicks<=0||receipt.completedTick<start.startedTick+start.motorTicks||receipt.completedTick>stream.endedTick||input.countsAPM===false)return null;
 return{receipt,start,op,input};
}
export function classifyKnownNonresponse(log,e,index,witnesses){
 if(classifyPublicAlert(e)!=='required')return null;
 const native=receiptFor(log,index);if(!native)return null;
 const{receipt,start,op,input}=native,created=log.alertMeasurementsV2.creations.find(r=>equal(r.creation,e));
 if(!created||created.createdAtTick!==created.capturedAtTick||created.observationTick!==e.tick||op.queuedTick<created.createdAtTick||!op.causes.some(c=>equal(c,e)))return null;
 if(start.kind==='cancel-key'&&!start.fire&&!input.command&&equal(start.cameraBefore,receipt.cameraAfter)&&equal(start.selectedBefore,receipt.selected)){
  const witness=witnesses.find(w=>w.inputIndex===index&&w.operationId===op.id&&w.startId===start.id&&w.tick===receipt.completedTick);
  const code=input.input;
  if(witness?.cancelTargetingBefore===true&&witness.cancelTargetingAfter===false&&witness.afterThinkTick===receipt.completedTick
   &&match({code:code.code,ctrlKey:code.ctrl,shiftKey:code.shift,altKey:code.alt},['targeting'])==='cancelAim'
   &&!log.alertMeasurementsV2.commands.some(c=>c.operationId===op.id&&c.tick===receipt.completedTick))return{event:key(e),inputIndex:index,tick:input.tick,kind:input.kind,reason:'proved-cancelAim-only',witness:structuredClone(witness)};
 }
 const shape=receipt.geometry.find(g=>g.event===key(e))?.proof;
 if(op.camera&&!start.fire&&['alert','minimap'].includes(start.mode)&&receipt.cameraApplied===true&&!input.command
  &&input.method===start.mode&&equal(pose(input.camera),receipt.cameraAfter)&&equal(shape?.camera,receipt.cameraAfter)&&equal(shape?.marker,e)
  &&publicAlertOnScreen(shape)===false&&input.target?.x===receipt.cameraAfter.x&&input.target?.z===receipt.cameraAfter.z)
  return{event:key(e),inputIndex:index,tick:input.tick,kind:input.kind,reason:'proved-camera-arrival-misses-original-marker',geometry:structuredClone(shape)};
 return null;
}
export function createPublicAlertCaptureV3({slot,log,memory,startedTick=0,recordCancelWitness=true,onWitness=null}){
 const base=createPublicAlertCaptureV2({slot,log,memory,startedTick}),stream=log.alertMeasurementsV3={schema:PUBLIC_ALERT_STREAM_V3,policy:PUBLIC_ALERT_POLICY_V3,toolOnly:true,startedTick,cancelWitnesses:[]};
 return{wrapMeasurements:base.wrapMeasurements,wrapSubmit:base.wrapSubmit,input(input,index){base.input(input,index);if(recordCancelWitness&&input.kind==='cancel-key'){
   const receipt=log.alertMeasurementsV2.completions.find(r=>r.inputIndex===index);if(receipt)stream.cancelWitnesses.push({inputIndex:index,operationId:receipt.operationId,startId:receipt.startId,tick:receipt.completedTick,cancelTargetingBefore:memory.human?.hands?.cancelTargeting===true,cancelTargetingAfter:null,afterThinkTick:null});
  }},afterThink(at){base.afterThink(at);for(const row of stream.cancelWitnesses)if(row.tick===at&&row.afterThinkTick===null){row.cancelTargetingAfter=memory.human?.hands?.cancelTargeting===true;row.afterThinkTick=at;if(onWitness)onWitness(structuredClone(row));}},finish(at){base.finish(at);stream.endedTick=at;sealed.set(stream,{stream:structuredClone(stream),v2:structuredClone(log.alertMeasurementsV2),inputs:structuredClone(log.inputs),events:structuredClone(log.events),commands:structuredClone(log.commands)});}};
}
export function scorePublicAlertsV3(log){
 const stream=log.alertMeasurementsV3,proof=stream&&sealed.get(stream),originalV2=scorePublicAlertsV2(log);
 if(!proof||!equal(proof.stream,stream)||!equal(proof.v2,log.alertMeasurementsV2)||!equal(proof.inputs,log.inputs)||!equal(proof.events,log.events)||!equal(proof.commands,log.commands)||!originalV2.recorded)
  return{policy:PUBLIC_ALERT_POLICY_V3,recorded:false,evaluable:false,reason:'missing-or-altered-live-native-v3-capture',samples:[],originalV2,originalV1:originalV2.originalV1};
 const knownNonresponseRows=[],unknownRows=[];
 for(const row of originalV2.unknownRows){const e=originalV2.rawAlerts.find(e=>key(e)===row.event),known=e&&row.kind!=='creation'&&classifyKnownNonresponse(log,e,row.inputIndex,stream.cancelWitnesses);if(known)knownNonresponseRows.push(known);else unknownRows.push(structuredClone(row));}
 const v2=log.alertMeasurementsV2,evaluable=stream.startedTick===0&&stream.endedTick===v2.endedTick&&tick(v2.endedTick)&&originalV2.rawAlerts.length===v2.creations.length
  &&new Set(originalV2.rawAlerts.map(key)).size===originalV2.rawAlerts.length&&Object.values(v2.coverage).every(n=>n===0)
  &&originalV2.audit.unknownCreations===0&&originalV2.audit.invalidCreationProof===0&&unknownRows.length===0;
 return{...structuredClone(originalV2),policy:PUBLIC_ALERT_POLICY_V3,evaluable,knownNonresponseRows,unknownRows,originalV2,originalV1:originalV2.originalV1,
  audit:{...originalV2.audit,knownNonresponseInputs:knownNonresponseRows.length,remainingUnknownCausalInputs:unknownRows.filter(r=>r.kind!=='creation').length}};
}
export function poolPublicAlertsV3(scores,level){
 const limits={easy:[3,6],normal:[1.5,3],hard:[.8,1.6]},survival=publicAlertKM(scores.flatMap(s=>s.samples??[])),coverageComplete=scores.length>0&&scores.every(s=>s.policy===PUBLIC_ALERT_POLICY_V3&&s.recorded&&s.evaluable),[lo,hi]=limits[level];
 return{policy:PUBLIC_ALERT_POLICY_V3,totalSeats:scores.length,recordedSeats:scores.filter(s=>s.recorded).length,eventlessSeats:scores.filter(s=>s.recorded&&s.requiredEvents===0).length,coverageComplete,firstCompletedAction:{survival,answered:survival.curve.reduce((n,r)=>n+r.observed,0),censored:survival.curve.reduce((n,r)=>n+r.censored,0)},limitSeconds:[lo,hi],gate:!coverageComplete||!survival.medianIdentifiable?'unknown':survival.medianSeconds>=lo&&survival.medianSeconds<=hi?'pass':'fail'};
}
