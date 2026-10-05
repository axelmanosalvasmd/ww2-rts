import { isDeepStrictEqual as equal } from 'node:util';
import { CELL, UNITS } from '../shared/sim.js';
import { onScreen } from '../shared/ai-perception.js';
import { bindings } from '../client/keys.js';
import { classifyPublicAlert, publicAlertKM, createPublicAlertCapture, scorePublicAlerts } from './ai-public-alert-response.mjs';
export const PUBLIC_ALERT_POLICY_V2 = 'public-danger-alert-v2';
export const PUBLIC_ALERT_STREAM_V2 = 'ww2-public-alert-response-v2';
const limits = { easy: [3,6], normal: [1.5,3], hard: [.8,1.6] };
const sealed = new WeakMap();
const validTick = n => Number.isSafeInteger(n) && n >= 0;
const point = p => Number.isFinite(p?.x) && Number.isFinite(p?.z);
const key = e => `${e.id}/${e.tick}`;
const clone = value => structuredClone(value);
function linked(context, e) {
  if (context?.responseEvents?.some(link => equal(link, e))) return true;
  const link = context?.event;
  return link?.source === 'alert' && link.id === e.id && link.kind === e.kind && link.onScreen === e.onScreen
    && link.x === e.x && link.z === e.z && context.eventTick === e.tick;
}
const pose = c => c && ({ x: c.x, z: c.z, yaw: c.yaw ?? 0, distance: c.distance ?? 60 });
function indices(view, positions) {
  const found = new Set();
  for (const at of positions) {
    const x = Math.min(view.w - 1, Math.max(0, Math.floor(at.x / CELL)));
    const z = Math.min(view.h - 1, Math.max(0, Math.floor(at.z / CELL)));
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++)
      found.add(Math.min(view.h - 1, Math.max(0, z + dz)) * view.w + Math.min(view.w - 1, Math.max(0, x + dx)));
  }
  return [...found];
}
// Save precisely the public cells used by groundRange for the marker and camera focus.
function geometry(view, marker, camera) {
  if (!point(marker) || !point(camera) || !Number.isSafeInteger(view?.w) || !Number.isSafeInteger(view?.h) || view.w < 1 || view.h < 1) return null;
  return { w: view.w, h: view.h, camera: pose(camera), marker: clone(marker), heightPresent: !!view.height,
    cells: view.height ? indices(view, [marker, camera]).map(i => ({ i, height: view.height[i], char: view.chars?.[i] })) : [] };
}
export function publicAlertOnScreen(proof) {
  if (!proof || !point(proof.marker) || !point(proof.camera) || !Number.isSafeInteger(proof.w) || !Number.isSafeInteger(proof.h)
    || proof.w < 1 || proof.h < 1 || typeof proof.heightPresent !== 'boolean') return null;
  const view = { w: proof.w, h: proof.h, height: null };
  if (proof.heightPresent) {
    const required = indices(view, [proof.marker, proof.camera]), cells = new Map((proof.cells ?? []).map(row => [row.i, row]));
    if (cells.size !== proof.cells?.length || required.some(i => !cells.has(i))) return null;
    view.height = new Array(proof.w * proof.h); view.chars = new Array(proof.w * proof.h);
    for (const i of required) { view.height[i] = cells.get(i).height; view.chars[i] = cells.get(i).char; }
  }
  return onScreen(proof.marker, proof.camera, view);
}
const distance = (a,b) => Math.hypot(a.x-b.x,a.z-b.z);
const sameIds = (a,b) => Array.isArray(a) && Array.isArray(b) && a.length===b.length && a.every(id=>b.includes(id));
const selectionKinds = new Set(['select-click','select-add-click','select-box','group-recall']);
const bindingOnlyKinds = new Set(['group-set']);
const idsOf = cmd => cmd?.orders?.map(row=>row[0]) ?? cmd?.ids ?? [];
const bindingMatches = (input,id) => {
  const binding = bindings.find(row=>row.id===id);
  return binding && ['code','shift','ctrl','alt'].every(field=>input?.[field]===binding[field]);
};
// This projection reads only the seat's already limited view and its own roster.
function scene(memory,slot,tick) {
  const state=memory.human, view=state?.view;
  if (!(view?.units instanceof Map) || !(state.inventory instanceof Map) || !validTick(view.tick) || view.tick>tick) return null;
  const own=(view.minimap ?? []).filter(dot=>dot.owner===slot && state.inventory.has(dot.id)).map(dot=>({
    id:dot.id,owner:slot,type:state.inventory.get(dot.id).type,x:dot.x,z:dot.z,screen:view.screenIds.has(dot.id)}));
  return {observationTick:view.tick,recordedTick:tick,slot,team:view.players[slot].team,own,
    dots:(view.minimap ?? []).map(dot=>({x:dot.x,z:dot.z,owner:dot.owner,team:view.players[dot.owner]?.team})),
    selected:[...(state.hands?.selected ?? [])]};
}
function actor(scene,id) {
  const unit=scene?.own.find(row=>row.id===id), def=UNITS[unit?.type], weapon=def?.w;
  return unit && def && !def.structure && !def.air && !def.medic && unit.type!=='engineer'
    && weapon?.range>0 && (weapon.inf>0 || weapon.veh>0) ? unit : null;
}
// An armed own defender moves toward the public danger locus. No recipient ID is inferred from alert text.
export function publicAlertMovementPurpose(command,creationRecord,current) {
  if (!['move','amove'].includes(command?.t) || command.queue===true || !Array.isArray(command.orders) || !command.orders.length) return false;
  const event=creationRecord.creation;
  if (classifyPublicAlert(event)!=='required' || !creationRecord.publicScene || !current) return false;
  return command.orders.every(([id,x,z])=>{
    const first=actor(creationRecord.publicScene,id), now=actor(current,id), target={x,z};
    return first && now && point(target) && distance(first,event)<=48 && distance(now,event)<=48
      && distance(target,event)<=24 && distance(target,event)+2.5<=distance(now,event);
  });
}
export function createPublicAlertCaptureV2({slot,log,memory,startedTick=0}) {
  if (log.alertMeasurementsV2) throw Error('V2 alert capture already installed');
  const original=createPublicAlertCapture({slot,log,memory,startedTick});
  const stream=log.alertMeasurementsV2={schema:PUBLIC_ALERT_STREAM_V2,policy:PUBLIC_ALERT_POLICY_V2,toolOnly:true,startedTick,
    creations:[],operations:[],starts:[],completions:[],commands:[],coverage:{missingEnqueues:0,missingStarts:0,missingPerception:0,invalidGeometry:0}};
  const jobs=new WeakMap(), actions=new WeakMap(), events=new Map();
  let observation,creationCamera,creationTick,observationTick,lastTick=startedTick,frames=0,finished=false;
  const hands=()=>memory.human?.hands;
  function flushCreations(tick) {
    const publicScene=scene(memory,slot,tick);
    for (const e of memory.human?.events ?? []) if(e.source==='alert' && !events.has(key(e))) {
      const proof=geometry(observation,e,creationCamera);
      const row={creation:clone(e),createdAtTick:creationTick,capturedAtTick:creationTick,observationTick,geometry:proof,
        publicScene: publicScene?.observationTick===observationTick ? publicScene : null};
      if (point(e) && publicAlertOnScreen(proof)!==e.onScreen) stream.coverage.invalidGeometry++;
      if (!row.publicScene) stream.coverage.missingPerception++;
      events.set(key(e),row);stream.creations.push(row);
    }
  }
  function operation(job,tick) {
    if(!job || !job.camera && !job.command && !job.inspect) return null;
    if(jobs.has(job)) return jobs.get(job);
    if(job.queuedTick!==tick) {stream.coverage.missingEnqueues++;return null;}
    const row={id:`${slot}:operation:${stream.operations.length}`,queuedTick:job.queuedTick,registeredAtTick:tick,
      camera:job.camera===true,inspect:job.inspect===true,mode:job.mode ?? null,ids:clone(job.ids ?? []),
      command:clone(job.command ?? null),context:clone(job.context),publicScene:scene(memory,slot,tick),
      causes:[...events.values()].filter(row=>linked(job.context,row.creation)).map(row=>clone(row.creation))};
    jobs.set(job,row);stream.operations.push(row);return row;
  }
  function start(tick) {
    const h=hands(),active=h?.active,a=active?.actions[active.index];
    if(!a || active.reacting || actions.has(a))return;
    const op=operation(active.job,tick);
    if(!op || a.startedTick!==tick){stream.coverage.missingStarts++;return;}
    const row={id:`${slot}:start:${stream.starts.length}`,operationId:op.id,kind:a.kind,mode:a.mode ?? null,
      startedTick:a.startedTick,registeredAtTick:tick,motorTicks:a.duration,input:clone(a.input ?? null),fire:a.fire===true,
      ids:clone(a.ids ?? []),selectedBefore:[...h.selected],group:a.group ?? null,groups:[...h.groups].map(([n,ids])=>[n,[...ids]]),
      lastGroup:h.lastGroup ?? null,lastGroupTick:h.lastGroupTick ?? null,cameraBefore:pose(active.cameraFrom ?? h.camera),
      ...(a.mode==='pan'?{panHold:a.panHold,panPrep:a.panPrep,target:clone(a.at),
        ...(a.panAxis?{panAxis:clone(a.panAxis),keyDownTick:a.startedTick+a.panPrep,keyUpTick:a.startedTick+a.duration}:{})}:{})};
    actions.set(a,row);stream.starts.push(row);
  }
  return {
    wrapMeasurements(base={}) {
      const wrapped=original.wrapMeasurements(base);
      return {measureRaw(view,seat,measured,tick){observation=view;creationCamera=pose(measured.camera);creationTick=tick;observationTick=view.tick;
        return wrapped.measureRaw(view,seat,measured,tick);},onMeasurements(payload){frames++;wrapped.onMeasurements(payload);}};
    },
    wrapSubmit(submit) {
      return command=>{
        const h=hands(),active=h?.active,a=active?.actions[active.index],s=a && actions.get(a),op=active && jobs.get(active.job);
        const result=submit(command);
        stream.commands.push({operationId:op?.id ?? null,startId:s?.id ?? null,tick:h?.tick ?? null,command:clone(command),
          accepted:result===undefined,rejection:typeof result==='string'?result:result===undefined?null:'unknown',
          selected:[...(h?.selected ?? [])],publicScene:scene(memory,slot,h?.tick)});
        return result;
      };
    },
    afterThink(tick) {
      if(finished)throw Error('V2 alert capture finished');
      original.afterThink(tick);flushCreations(tick);
      if(!validTick(tick) || tick<lastTick || tick-lastTick>1)stream.coverage.missingStarts++;
      lastTick=tick;
      const h=hands();for(const job of [h?.active?.job,...(h?.queue ?? [])])if(job)operation(job,tick);
      start(tick);
    },
    input(input,inputIndex) {
      original.input(input,inputIndex);
      const h=hands(),active=h?.active,a=active?.actions[active.index],s=a && actions.get(a);
      if(!a || !s){stream.coverage.missingStarts++;return;}
      const op=jobs.get(active.job);
      const latest=(h.lastView?.alerts ?? []).map((e,i)=>({...e,i})).filter(e=>point(e)&&h.tick-e.tick<120)
        .sort((a,b)=>b.tick-a.tick||b.i-a.i)[0];
      const groupMembers=clone(h.groups.get(a.group) ?? []);
      const groupUnits=groupMembers.map(id=>scene(memory,slot,h.tick)?.own.find(row=>row.id===id));
      const centroid=groupUnits.length && groupUnits.every(Boolean)?{x:groupUnits.reduce((n,u)=>n+u.x,0)/groupUnits.length,z:groupUnits.reduce((n,u)=>n+u.z,0)/groupUnits.length}:null;
      const groupApplied=a.mode==='group' && s.lastGroup===a.group && h.tick-s.lastGroupTick<=6
        && bindingMatches(a.input,`group:recall:${a.group}`) && point(centroid) && h.camera.x===centroid.x && h.camera.z===centroid.z;
      const cameraApplied=a.camera===true && ['minimap','alert','pan','group'].includes(a.mode) && !a.outsideMinimap && !a.outsideScreen
        && (a.mode!=='alert'||!!latest) && (a.mode!=='group'||groupApplied) && point(a.at)
        && h.camera.x===a.at.x && h.camera.z===a.at.z && (h.camera.x!==s.cameraBefore.x || h.camera.z!==s.cameraBefore.z);
      stream.completions.push({startId:s.id,operationId:op.id,completedTick:h.tick,registeredAtTick:h.tick,inputIndex,
        nativeDescriptor:clone(input),selected:[...h.selected],cameraAfter:pose(h.camera),cameraApplied,groupMembers,groupCentroid:centroid,
        geometry:op.causes.map(e=>({event:key(e),proof:geometry(observation,e,h.camera)})),
        ...(active.panKeys?{panMotion:{from:pose(active.panFrom),w:observation.w,h:observation.h,keys:active.panKeys.map(held=>({code:held.action.input.code,start:held.start,down:held.down,up:held.up,prep:held.action.panPrep,hold:held.action.panHold,axis:clone(held.action.panAxis),...(held.canceledAt!==undefined?{canceledAt:held.canceledAt}:{})}))}}:{})});
    },
    finish(tick) {
      if(finished)throw Error('V2 alert capture finished twice');finished=true;original.finish(tick);stream.endedTick=tick;
      if(!frames || !hands() || tick!==lastTick)stream.coverage.missingPerception++;
      sealed.set(stream,{stream:clone(stream),inputs:clone(log.inputs),events:clone(log.events?.filter(e=>e.source==='alert') ?? [])});
    }
  };
}
function validReceipt(stream,log,receipt) {
  const op=stream.operations.find(row=>row.id===receipt.operationId),s=stream.starts.find(row=>row.id===receipt.startId),input=log.inputs[receipt.inputIndex];
  if(!op || !s || !input || s.operationId!==op.id || !equal(input,receipt.nativeDescriptor)
    || ![op.queuedTick,s.startedTick,receipt.completedTick].every(validTick) || op.queuedTick!==op.registeredAtTick
    || s.startedTick!==s.registeredAtTick || receipt.completedTick!==receipt.registeredAtTick
    || op.queuedTick>s.startedTick || receipt.completedTick<=s.startedTick || input.tick!==receipt.completedTick
    || input.inputStartedTick!==s.startedTick || input.queuedTick!==op.queuedTick || input.motorTicks!==s.motorTicks
    || !(s.motorTicks>0) || receipt.completedTick<s.startedTick+s.motorTicks || input.kind!==s.kind
    || !equal(input.input,s.input) || input.countsAPM===false || receipt.completedTick>stream.endedTick)return null;
  return {op,s,input};
}
function validConcurrentPan(start, receipt) {
  const motion = receipt.panMotion;
  if (!motion || !point(motion.from) || !(motion.from.distance > 0) || !Number.isFinite(motion.from.yaw)
    || !Number.isSafeInteger(motion.w) || !Number.isSafeInteger(motion.h)
    || !Array.isArray(motion.keys) || motion.keys.length < 1 || motion.keys.length > 2) return false;
  const s = Math.sin(motion.from.yaw), c = Math.cos(motion.from.yaw);
  const axes = { KeyD: { x: c, z: -s }, KeyA: { x: -c, z: s }, KeyS: { x: s, z: c }, KeyW: { x: -s, z: -c } };
  const close = (a, b) => Math.abs(a - b) < 1e-8;
  const codes = new Set();
  for (const key of motion.keys) {
    const axis = axes[key.code];
    if (!axis || codes.has(key.code) || ![key.start, key.down, key.up, key.prep, key.hold].every(validTick)
      || key.prep <= 0 || key.hold <= 0 || key.down !== key.start + key.prep || key.up !== key.down + key.hold
      || !close(key.axis?.x, axis.x) || !close(key.axis?.z, axis.z)
      || key.canceledAt !== undefined && (!validTick(key.canceledAt) || key.canceledAt >= key.down)) return false;
    codes.add(key.code);
  }
  if (motion.keys.length === 2 && (!(codes.has('KeyA') || codes.has('KeyD')) || !(codes.has('KeyW') || codes.has('KeyS'))
    || motion.keys[1].start < motion.keys[0].down)) return false;
  const actual = motion.keys.find(key => key.code === start.input.code && key.start === start.startedTick);
  if (!actual || actual.canceledAt !== undefined || actual.up !== receipt.completedTick
    || actual.down !== start.keyDownTick || actual.up !== start.keyUpTick
    || !equal(actual.axis, start.panAxis)) return false;
  const camera = { ...motion.from }, first = Math.min(...motion.keys.map(key => key.start));
  for (let tick = first + 1; tick <= receipt.completedTick; tick++) {
    for (const key of motion.keys) if (key.canceledAt === undefined) {
      const elapsed = Math.max(0, Math.min(tick, key.up) - Math.max(tick - 1, key.down));
      camera.x += key.axis.x * motion.from.distance * 1.1 * elapsed / 20;
      camera.z += key.axis.z * motion.from.distance * 1.1 * elapsed / 20;
    }
    camera.x = Math.max(0, Math.min(motion.w * CELL, camera.x));
    camera.z = Math.max(0, Math.min(motion.h * CELL, camera.z));
  }
  return close(camera.x, receipt.cameraAfter.x) && close(camera.z, receipt.cameraAfter.z)
    && camera.yaw === receipt.cameraAfter.yaw && camera.distance === receipt.cameraAfter.distance;
}
function cameraPurpose(receipt,s,input,e) {
  const shape=receipt.geometry.find(row=>row.event===key(e))?.proof;
  if(!receipt.cameraApplied || input.method!==s.mode || !equal(pose(input.camera),receipt.cameraAfter)
    || !equal(shape?.camera,receipt.cameraAfter) || !equal(shape?.marker,e) || publicAlertOnScreen(shape)!==true
    || !point(input.target) || input.target.x!==receipt.cameraAfter.x || input.target.z!==receipt.cameraAfter.z)return false;
  if(s.mode==='pan' && (!['KeyW','KeyA','KeyS','KeyD'].includes(s.input?.code) || !validTick(s.panHold) || !s.panHold
    || !validTick(s.panPrep) || !s.panPrep || s.motorTicks!==s.panHold+s.panPrep || (s.panAxis?!validConcurrentPan(s,receipt):!equal(s.target,input.target))))return false;
  if(s.mode==='group')return bindingMatches(s.input,`group:recall:${s.group}`) && sameIds(receipt.selected,receipt.groupMembers)
    && point(receipt.groupCentroid) && receipt.cameraAfter.x===receipt.groupCentroid.x && receipt.cameraAfter.z===receipt.groupCentroid.z;
  return ['minimap','alert','pan'].includes(s.mode);
}
export function scorePublicAlertsV2(log) {
  const stream=log.alertMeasurementsV2,proof=stream && sealed.get(stream),rawAlerts=clone(log.events?.filter(e=>e.source==='alert') ?? []);
  const originalV1=scorePublicAlerts(log);
  if(!proof || !equal(proof.stream,stream) || !equal(proof.inputs,log.inputs) || !equal(proof.events,rawAlerts))
    return {policy:PUBLIC_ALERT_POLICY_V2,recorded:false,evaluable:false,reason:'missing-or-altered-live-native-capture',rawAlerts,samples:[],originalV1};
  const audit={unknownCreations:0,invalidCreationProof:0,rejectedReceipts:0,unknownCausalInputs:0,knownIrrelevantInputs:0};
  const samples=[],requiredPopulation=[],decisions=[],unknownRows=[],seen=new Set();
  let complete=rawAlerts.length===stream.creations.length;
  for(const e of rawAlerts) {
    const decision=classifyPublicAlert(e);decisions.push({event:key(e),decision});
    if(seen.has(key(e))){complete=false;continue;}seen.add(key(e));
    if(decision==='unknown'){audit.unknownCreations++;unknownRows.push({event:key(e),kind:'creation',reason:'unknown-original-v1-creation-classifier'});continue;}if(decision!=='required')continue;
    const record=stream.creations.find(row=>equal(row.creation,e));
    const creationValid=record && validTick(record.createdAtTick) && record.createdAtTick===record.capturedAtTick
      && record.observationTick===e.tick && record.observationTick<=record.createdAtTick && record.createdAtTick<=stream.endedTick
      && record.publicScene?.observationTick===record.observationTick && publicAlertOnScreen(record.geometry)===false;
    if(!creationValid){audit.invalidCreationProof++;complete=false;}
    let answered=null,endpoint=null;
    const candidates=[];
    for(const receipt of creationValid?stream.completions:[]) {
      const native=validReceipt(stream,log,receipt);
      if(!native){audit.rejectedReceipts++;continue;}
      const {op,s,input}=native;
      if(!op.causes.some(cause=>equal(cause,e)) || record.createdAtTick>op.queuedTick)continue;
      const firstGroupRecall=s.mode!=='group' || stream.completions.some(first=>{
        const earlier=validReceipt(stream,log,first);
        return earlier && earlier.op.id===op.id && earlier.s.kind==='group-recall' && earlier.s.group===s.group
          && bindingMatches(earlier.s.input,`group:recall:${s.group}`) && first.completedTick===s.lastGroupTick
          && first.completedTick<=s.startedTick && sameIds(first.selected,receipt.groupMembers);
      });
      if(op.camera && firstGroupRecall && cameraPurpose(receipt,s,input,e))candidates.push({tick:receipt.completedTick,kind:'camera',inputIndex:receipt.inputIndex});
      if(op.camera || op.inspect || !op.command)continue;
      // Credit earlier inputs only after this exact operation produced a native accepted useful order.
      const accepted=stream.commands.find(row=>row.operationId===op.id && row.accepted && row.tick>=receipt.completedTick
        && row.tick<=stream.endedTick && sameIds(row.selected,idsOf(row.command)) && sameIds(row.selected,op.ids)
        && row.command.t===op.command.t && publicAlertMovementPurpose(op.command,record,op.publicScene)
        && publicAlertMovementPurpose(row.command,record,op.publicScene) && publicAlertMovementPurpose(row.command,record,row.publicScene)
        && stream.completions.some(end=>end.operationId===op.id && end.startId===row.startId && end.completedTick===row.tick
          && validReceipt(stream,log,end) && equal(end.nativeDescriptor.command,row.command)));
      if(!accepted)continue;
      if(s.fire && input.command && equal(input.command,accepted.command) && sameIds(receipt.selected,idsOf(accepted.command)))
        candidates.push({tick:receipt.completedTick,kind:'accepted-order',inputIndex:receipt.inputIndex,acceptedTick:accepted.tick});
      else if(selectionKinds.has(s.kind) && !input.command && receipt.selected.length && sameIds(receipt.selected,idsOf(accepted.command)) && sameIds(receipt.selected,op.ids)
        && receipt.selected.every(id=>actor(record.publicScene,id) && actor(op.publicScene,id))
        && !sameIds(s.selectedBefore,receipt.selected) && sameIds(receipt.selected,s.ids)
        && (s.kind!=='group-recall' || bindingMatches(s.input,`group:recall:${s.group}`) && sameIds(receipt.selected,s.groups.find(row=>row[0]===s.group)?.[1])))
        candidates.push({tick:receipt.completedTick,kind:'accepted-operation-selection',inputIndex:receipt.inputIndex,acceptedTick:accepted.tick});
    }
    candidates.sort((a,b)=>a.tick-b.tick);if(candidates.length){answered=candidates[0].tick;endpoint=candidates[0];}
    for(const [index,input] of (log.inputs ?? []).entries()) if(creationValid && linked(input,e) && input.tick>=record.createdAtTick && (answered===null || input.tick<answered)) {
      const receipt=stream.completions.find(row=>row.inputIndex===index),native=receipt && validReceipt(stream,log,receipt);
      if(native && bindingOnlyKinds.has(native.s.kind) && !input.command
        && sameIds(native.s.selectedBefore,receipt.selected) && equal(native.s.cameraBefore,receipt.cameraAfter)) {audit.knownIrrelevantInputs++;continue;}
      audit.unknownCausalInputs++;complete=false;unknownRows.push({event:key(e),inputIndex:index,tick:input.tick,kind:input.kind,
        reason:!native?'missing-native-start-or-receipt':native.op.queuedTick<record.createdAtTick?'precreation-operation':
          native.op.camera?'unproved-camera-purpose':'no-same-operation-accepted-public-purpose'});
    }
    const duration=validTick(record?.createdAtTick) && validTick(stream.endedTick) && stream.endedTick>=record.createdAtTick
      ? ((answered ?? stream.endedTick)-record.createdAtTick)/20:null;
    requiredPopulation.push({creation:clone(e),createdAtTick:record?.createdAtTick ?? null,completedTick:answered,
      censorTick:answered===null?stream.endedTick:null,seconds:duration,endpoint});
    if(duration!==null)samples.push({event:key(e),seconds:duration,observed:answered!==null});
  }
  const evaluable=complete && audit.unknownCreations===0 && stream.startedTick===0 && validTick(stream.endedTick)
    && Object.values(stream.coverage).every(n=>n===0);
  return {policy:PUBLIC_ALERT_POLICY_V2,recorded:true,evaluable,rawAlerts,decisions,requiredEvents:requiredPopulation.length,
    requiredPopulation,audit,unknownRows,coverage:clone(stream.coverage),samples,survival:publicAlertKM(samples),originalV1};
}
export function poolPublicAlertsV2(scores,level) {
  if(!limits[level])throw Error('Unknown alert difficulty');
  const survival=publicAlertKM(scores.flatMap(score=>score.samples ?? []));
  const coverageComplete=scores.length>0 && scores.every(score=>score.recorded && score.evaluable);
  const [lo,hi]=limits[level];
  return {policy:PUBLIC_ALERT_POLICY_V2,totalSeats:scores.length,recordedSeats:scores.filter(score=>score.recorded).length,
    eventlessSeats:scores.filter(score=>score.recorded && score.requiredEvents===0).length,coverageComplete,
    firstCompletedAction:{survival,answered:survival.curve.reduce((n,row)=>n+row.observed,0),censored:survival.curve.reduce((n,row)=>n+row.censored,0)},
    limitSeconds:[lo,hi],gate:!coverageComplete || !survival.medianIdentifiable?'unknown':survival.medianSeconds>=lo && survival.medianSeconds<=hi?'pass':'fail'};
}
