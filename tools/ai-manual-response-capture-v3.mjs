import { isDeepStrictEqual } from 'node:util';
import { MANUAL_RESPONSE_POLICY, MANUAL_RESPONSE_STREAM, createManualResponsePolicy } from './ai-manual-response-policy-v3.mjs';

// The grader owns this state. No proof or classification is written into commander memory.
export function createManualCapture({slot,log,memory,rules,perceive,observer,onProof}) {
  const policy=createManualResponsePolicy(rules), jobs=new WeakMap(), actions=new WeakMap();
  const stream=log.manualMeasurements={schema:MANUAL_RESPONSE_STREAM,policy:MANUAL_RESPONSE_POLICY,startedTick:0,
    operationLinksRecorded:true,creations:[],operations:[],physicalStarts:[],inputReceipts:[],receipts:[],publicFrames:[]};
  const detachedState={camera:{},hands:{selected:[]}}, pending=[];
  let previous=null, nextId=0;
  const next=prefix=>`${prefix}:${slot}:${nextId++}`;
  const sceneAt=tick=>memory.human?.view ? policy.capturePublicScene(memory.human.view,slot,tick) : null;
  const operationFor=(job,tick)=>{
    if (!job?.command || !Number.isSafeInteger(job.queuedTick)) return null;
    if (jobs.has(job)) return jobs.get(job);
    // A job first seen after its enqueue clock has no prospective attribution proof.
    if (job.queuedTick!==tick) return null;
    const scene=sceneAt(tick); if(!scene) return null;
    const command=structuredClone(job.command);
    const operation={id:next('operation'),queuedTick:job.queuedTick,inputStartedTick:null,command,
      publicScene:scene,events:stream.creations.filter(row=>row.decision==='required' && row.creation.tick<=job.queuedTick
        && job.queuedTick-row.creation.tick<=240 && policy.commandServesManualCreation(command,row,scene))
        .map(row=>structuredClone(row.creation))};
    jobs.set(job,operation);stream.operations.push(operation);return operation;
  };
  const startFor=(hands,tick)=>{
    const active=hands?.active, action=active?.actions?.[active.index];
    if (!active || active.reacting || !Number.isSafeInteger(action?.startedTick)) return null;
    if(actions.has(action)) {const start=actions.get(action);start.lastActiveTick=tick;return start;}
    const operation=operationFor(active.job,tick);if(!operation)return null;
    const receipt={id:next('motor'),operationId:operation.id,registeredAtTick:tick,queuedTick:operation.queuedTick,
      startedTick:action.startedTick,lastActiveTick:tick,completedTick:null,kind:action.kind,input:structuredClone(action.input ?? null),fire:action.fire===true,
      intendedIds:structuredClone(active.job.ids ?? []),actualSelectedIds:[...hands.selected],command:structuredClone(operation.command),events:structuredClone(operation.events)};
    actions.set(action,receipt);stream.physicalStarts.push(receipt);
    operation.inputStartedTick=Math.min(operation.inputStartedTick ?? Infinity,receipt.startedTick);return receipt;
  };
  const flightsAt=(tick)=>{
    const hands=memory.human?.hands, active=hands?.active, start=startFor(hands,tick);
    if (!start || start.registeredAtTick!==start.startedTick || !(['retreat-key','place-click','rightclick'].includes(start.kind)) || !start.fire) return [];
    return start.events.filter(event=>start.kind==='retreat-key'?event.kind==='screen-damage':['screen-contact','screen-damage'].includes(event.kind)).map(cause=>({source:start.kind==='retreat-key'?'physical-key-start':'physical-pointer-start',
      startReceiptId:start.id,operationId:start.operationId,input:structuredClone(start.input),kind:start.kind,
      command:structuredClone(start.command),actualSelectedIds:structuredClone(start.actualSelectedIds),queuedTick:start.queuedTick,
      inputStartedTick:start.startedTick,declaredAtTick:start.registeredAtTick,activeAtTick:tick,completedTick:null,
      cause:structuredClone(cause),causeRecord:structuredClone(stream.creations.find(row=>isDeepStrictEqual(row.creation,cause)))}));
  };
  const flushCreations=()=>{
    const native=memory.human?.events ?? [];
    for(const packet of pending.splice(0)) {
      const frame={id:next('frame'),tick:packet.tick,scene:packet.scene};stream.publicFrames.push(frame);
      for(const hint of packet.events) {
        const event=native.find(event=>event.id===hint.id && event.tick===hint.tick);
        if(!event || event.source!=='screen' || stream.creations.some(row=>row.creation.id===event.id))continue;
        const authority={nativeCreations:native,records:stream.creations,physicalStarts:stream.physicalStarts};
        stream.creations.push(policy.classifyManualCreation(structuredClone(event),packet.scene,previous,packet.flights,authority));
      }
      for(const receipt of stream.receipts) if(receipt.publicAfterFrameId==null && packet.tick>receipt.tick
        && packet.scene.observationTick>receipt.publicScene.observationTick) {
        receipt.publicAfterFrameId=frame.id;receipt.publicAfter=structuredClone(packet.scene);
      }
      if(!previous || packet.scene.observationTick>=previous.observationTick) previous=structuredClone(packet.scene);
    }
  };
  const perceptionMeasurements={
    measureRaw(observation,seat,state,tick) {
      detachedState.camera=structuredClone(state.camera);detachedState.hands.selected=[...state.hands.selected];
      const publicView=perceive(observation,seat,detachedState,tick);
      const scene=policy.capturePublicScene(publicView,slot,tick);
      const proof=structuredClone(scene);onProof?.(proof);
      pending.push({tick,scene:proof,events:[],flights:flightsAt(tick)});
      return observer.measureRaw(observation,seat,state,tick);
    },
    onMeasurements(payload) {
      const packet=pending.at(-1);if(packet)packet.events=payload.observed?.newEvents ?? [];
      observer.onMeasurements(payload);
    }
  };
  function afterThink(tick) {
    flushCreations();const hands=memory.human?.hands;
    for(const job of [hands?.active?.job,...(hands?.queue ?? [])])operationFor(job,tick);
    startFor(hands,tick);
  }
  function input(input,index) {
    flushCreations();const hands=memory.human?.hands,start=startFor(hands,input.tick);
    if(!start)return;start.completedTick=input.tick;
    const operation=jobs.get(hands.active.job);
    stream.inputReceipts.push({inputIndex:index,operationId:operation.id,startReceiptId:start.id,tick:input.tick,
      recipe:structuredClone(operation.command),nativeDescriptor:structuredClone(input)});
    if(input.command) {
      const commandIndex=log.commands.findLastIndex(row=>row.tick===input.tick && isDeepStrictEqual(row.command,input.command));
      if(commandIndex>=0)stream.receipts.push({commandIndex,inputIndex:index,operationId:operation.id,startReceiptId:start.id,
        tick:input.tick,publicScene:sceneAt(input.tick),publicAfter:null,publicAfterFrameId:null});
    }
  }
  return {perceptionMeasurements,afterThink,input,stream,policy};
}
