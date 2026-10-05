import { exactHalfBoundary } from './km-median-boundary.mjs';
// Prospective tool-only collection. No planner object receives these records.
import { isDeepStrictEqual as equal } from 'node:util';
import { CELL } from '../shared/sim.js';
import { onScreen } from '../shared/ai-perception.js';
export const PUBLIC_ALERT_POLICY = 'public-danger-alert-v1';
export const PUBLIC_ALERT_STREAM = 'ww2-public-alert-response-v1';
const limits = { easy: [3, 6], normal: [1.5, 3], hard: [.8, 1.6] };
const danger = new Set(['base', 'attack', 'air', 'unitLost', 'pointLost']);
const information = new Set(['ready', 'pointWon']);
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
export function classifyPublicAlert(e) {
  if (e?.source !== 'alert' || e.onScreen === true) return 'outside';
  if (e.onScreen !== false || e.id == null || !validTick(e.tick)) return 'unknown';
  if (information.has(e.kind)) return 'informational';
  return danger.has(e.kind) && point(e) ? 'required' : 'unknown';
}
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
export function publicAlertKM(samples) {
  const times = new Map();
  for (const s of samples) {
    if (!Number.isFinite(s.seconds) || s.seconds < 0 || typeof s.observed !== 'boolean') throw Error('Invalid alert survival sample');
    const row = times.get(s.seconds) ?? { observed: 0, censored: 0 };
    row[s.observed ? 'observed' : 'censored']++; times.set(s.seconds, row);
  }
  let risk = samples.length, survival = 1, medianSeconds = null;
  const medianBoundary = exactHalfBoundary();
  const curve = [...times].sort(([a], [b]) => a - b).map(([seconds, row]) => {
    const atRisk = risk;
    if (row.observed) survival *= 1 - row.observed / risk;
    if (medianSeconds === null && medianBoundary(survival, atRisk, row.observed)) medianSeconds = seconds;
    risk -= row.observed + row.censored; return { seconds, atRisk, ...row, survival };
  });
  return { samples: samples.length, medianSeconds, medianIdentifiable: medianSeconds !== null, curve };
}
export function createPublicAlertCapture({ slot, log, memory, startedTick = 0 }) {
  if (log.alertMeasurements) throw Error('Alert capture already installed');
  const stream = log.alertMeasurements = { schema: PUBLIC_ALERT_STREAM, panGestureVersion: 3, policy: PUBLIC_ALERT_POLICY, toolOnly: true, startedTick,
    creations: [], operations: [], starts: [], completions: [], interrupts: [], coverage: { missingEnqueues: 0, missingStarts: 0, invalidGeometry: 0, missingPerception: 0 } };
  const jobs = new WeakMap(), actions = new WeakMap(), events = new Map(), releases = new WeakSet();
  let perceptionFrames = 0;
  let observation, creationCamera, creationTick, observationTick, lastTick = startedTick, finished = false;
  const hands = () => memory.human?.hands;
  function operation(job, tick) {
    if (!job?.camera) return null;
    if (jobs.has(job)) return jobs.get(job);
    if (job.queuedTick !== tick) { stream.coverage.missingEnqueues++; return null; }
    const causes = [...events.values()].filter(row => linked(job.context, row.creation)).map(row => clone(row.creation));
    const row = { id: `${slot}:job:${stream.operations.length}`, queuedTick: job.queuedTick, registeredAtTick: tick,
      mode: job.mode, context: clone(job.context), causes };
    jobs.set(job, row); stream.operations.push(row); return row;
  }
  function start(tick) {
    const h = hands(), active = h?.active, a = active?.actions[active.index];
    if (!a?.camera || active.reacting || actions.has(a)) return;
    const op = operation(active.job, tick);
    if (!op || a.startedTick !== tick) { stream.coverage.missingStarts++; return; }
    const row = { id: `${slot}:input:${stream.starts.length}`, operationId: op.id, kind: a.kind, mode: a.mode,
      startedTick: a.startedTick, registeredAtTick: tick, motorTicks: a.duration, cameraBefore: pose(active.cameraFrom), input: clone(a.input),
      ...(a.mode === 'pan' ? { panHold: a.panHold, panPrep: a.panPrep, target: clone(a.at),
        ...(a.panAxis || a.panDirection ? { panAxis: clone(a.panAxis ?? a.panDirection), keyDownTick: a.startedTick + a.panPrep,
          keyUpTick: a.startedTick + a.duration } : {}) } : {}) };
    actions.set(a, row); stream.starts.push(row);
  }
  return {
    wrapMeasurements(base = {}) {
      return {
        measureRaw(view, seat, measured, tick) {
          observation = view; creationCamera = pose(measured.camera); creationTick = tick; observationTick = view.tick;
          return base.measureRaw?.(view, seat, measured, tick);
        },
        onMeasurements(payload) {
          base.onMeasurements?.(payload); perceptionFrames++;
          for (const e of memory.human?.events ?? []) if (e.source === 'alert' && !events.has(key(e))) {
            const proof = geometry(observation, e, creationCamera);
            const row = { creation: clone(e), createdAtTick: creationTick, capturedAtTick: payload.tick,
              observationTick, geometry: proof };
            if (point(e) && publicAlertOnScreen(proof) !== e.onScreen) stream.coverage.invalidGeometry++;
            events.set(key(e), row); stream.creations.push(row);
          }
        }
      };
    },
    afterThink(tick) {
      if (finished) throw Error('Alert capture finished');
      if (!validTick(tick) || tick < lastTick || tick - lastTick > 1) stream.coverage.missingStarts++;
      lastTick = tick;
      const h = hands();
      for (const job of [h?.active?.job, ...(h?.queue ?? [])]) if (job) operation(job, tick);
      start(tick);
      for (const a of h?.active?.actions ?? []) if (a.earlyRelease && !releases.has(a)) {
        releases.add(a);
        const release = a.earlyRelease, started = actions.get(a);
        const cause = h.lastView?.events?.find(e => equal(e, release.cause));
        stream.interrupts.push({ startId: started?.id ?? null, registeredAtTick: tick,
          release: clone(release), actualDeliveredCause: cause ? clone(cause) : null });
      }
    },
    input(input, inputIndex) {
      const h = hands(), active = h?.active, a = active?.actions[active.index], s = a && actions.get(a);
      if (!a?.camera) return;
      if (!s) { stream.coverage.missingStarts++; return; }
      const supported = ['minimap', 'alert', 'pan'].includes(a.mode);
      const latest = (h.lastView?.alerts ?? []).map((e, i) => ({ ...e, i })).filter(e => point(e) && h.tick - e.tick < 120)
        .sort((a, b) => b.tick - a.tick || b.i - a.i)[0];
      // These are the exact early-return branches preceding Object.assign(camera, action.at).
      const applied = supported && !a.outsideMinimap && !a.outsideScreen && (a.mode !== 'alert' || !!latest)
        && point(a.at) && h.camera.x === a.at.x && h.camera.z === a.at.z
        && (h.camera.x !== s.cameraBefore.x || h.camera.z !== s.cameraBefore.z);
      const stopAfterInput = h.interruptAfterInput || !!(active.interruptAfterCommand && a.fire);
      const op = jobs.get(active.job);
      stream.completions.push({ startId: s.id, operationId: op.id, completedTick: h.tick, registeredAtTick: h.tick,
        inputIndex, nativeDescriptor: clone(input), cameraAfter: pose(h.camera), applied, stopAfterInput,
        geometry: op.causes.map(e => ({ event: key(e), proof: geometry(observation, e, h.camera) })),
        ...(a.mode === 'pan' ? { panMotion: { from: pose(active.panFrom ?? active.cameraFrom), w: observation.w, h: observation.h,
          keys: (active.panKeys ?? [{ action: a, start: a.startedTick, down: a.startedTick + a.panPrep, up: a.startedTick + a.duration }]).map(held => ({ code: held.action.input.code, start: held.start,
            down: held.down, up: held.up, prep: held.action.panPrep, hold: held.action.panHold,
            axis: clone(held.action.panAxis ?? held.action.panDirection), ...(held.action.earlyRelease ? { earlyRelease: clone(held.action.earlyRelease) } : {}), ...(held.canceledAt !== undefined ? { canceledAt: held.canceledAt } : {}) })) } } : {}) });
    },
    finish(tick) {
      if (finished) throw Error('Alert capture finished twice');
      finished = true; stream.endedTick = tick;
      if (!perceptionFrames || !hands() || tick !== lastTick) stream.coverage.missingPerception++;
      sealed.set(stream, { stream: clone(stream), inputs: clone(log.inputs), rawAlerts: clone(log.events?.filter(e => e.source === 'alert') ?? []) });
    }
  };
}
function validEarlyRelease(stream, start, receipt, input) {
  const row = stream.interrupts?.find(row => row.startId === start.id);
  const release = input.panRelease;
  if (!release || !row || !equal(row.release, release) || !equal(row.actualDeliveredCause, release.cause)
    || row.registeredAtTick !== release.requestedTick
    || ![release.requestedTick, release.releaseStartTick, release.releasedTick, release.releaseMotorTicks,
      release.plannedUpTick, release.keyDownTick, release.cause?.tick].every(validTick)
    || release.releaseMotorTicks <= 0 || release.cause.tick > release.requestedTick
    || release.requestedTick < release.keyDownTick || release.requestedTick > release.releaseStartTick
    || release.releaseStartTick + release.releaseMotorTicks !== release.releasedTick
    || release.releasedTick < release.cause.tick + 4 || release.releasedTick >= release.plannedUpTick
    || release.plannedUpTick !== start.startedTick + start.motorTicks
    || release.keyDownTick !== start.startedTick + start.panPrep
    || receipt.completedTick !== release.releasedTick || input.motorTicks !== release.releasedTick - start.startedTick) return false;
  return true;
}

// Version 2 retains one native completed-input receipt per independently pressed pan key.
// The sealed live capture supplies every overlapping held interval, including canceled preparations.
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
    || actual.down !== start.keyDownTick || actual.up !== (receipt.nativeDescriptor.panRelease?.releasedTick ?? start.keyUpTick)
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

export function scorePublicAlerts(log) {
  const stream = log.alertMeasurements, proof = stream && sealed.get(stream);
  const rawAlerts = clone(log.events?.filter(e => e.source === 'alert') ?? []);
  const native = !!proof && equal(proof.stream, stream) && equal(proof.inputs, log.inputs) && equal(proof.rawAlerts, rawAlerts);
  if (!native) return { policy: PUBLIC_ALERT_POLICY, recorded: false, evaluable: false, reason: 'missing-or-altered-live-native-capture', rawAlerts, samples: [] };
  const audit = { unknownCreations: 0, invalidCreationProof: 0, rejectedReceipts: 0, unsupportedCausalInputs: 0 };
  const samples = [], requiredPopulation = [], decisions = [], seen = new Set();
  let complete = rawAlerts.length === stream.creations.length;
  for (const e of rawAlerts) {
    const decision = classifyPublicAlert(e); decisions.push({ event: key(e), decision });
    if (seen.has(key(e))) { complete = false; continue; } seen.add(key(e));
    if (decision === 'unknown') { audit.unknownCreations++; continue; }
    if (decision !== 'required') continue;
    const record = stream.creations.find(row => equal(row.creation, e));
    const creationValid = record && validTick(record.createdAtTick) && record.capturedAtTick === record.createdAtTick
      && record.observationTick === e.tick && record.observationTick <= record.createdAtTick
      && record.createdAtTick <= stream.endedTick && publicAlertOnScreen(record.geometry) === false;
    if (!creationValid) { audit.invalidCreationProof++; complete = false; }
    let answered = null;
    for (const receipt of creationValid ? stream.completions : []) {
      const op = stream.operations.find(row => row.id === receipt.operationId), s = stream.starts.find(row => row.id === receipt.startId);
      if (!op?.causes.some(cause => equal(cause, e))) continue;
      const input = log.inputs[receipt.inputIndex];
      const shape = receipt.geometry.find(row => row.event === key(e))?.proof;
      if (!s || !input || !equal(input, receipt.nativeDescriptor) || s.operationId !== op.id
        || ![op.queuedTick, s.startedTick, receipt.completedTick].every(validTick)
        || op.queuedTick !== op.registeredAtTick || s.startedTick !== s.registeredAtTick || receipt.completedTick !== receipt.registeredAtTick
        || record.createdAtTick > op.queuedTick || op.queuedTick > s.startedTick || receipt.completedTick <= s.startedTick
        || input.tick !== receipt.completedTick || input.inputStartedTick !== s.startedTick || input.queuedTick !== op.queuedTick
        || !(s.motorTicks > 0) || (input.panRelease ? !validEarlyRelease(stream, s, receipt, input)
          : input.motorTicks !== s.motorTicks || receipt.completedTick < s.startedTick + s.motorTicks)
        || input.kind !== s.kind || input.method !== s.mode || !equal(input.input, s.input) || !receipt.applied || input.countsAPM === false
        || s.mode === 'pan' && (!['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(s.input?.code)
          || !Number.isSafeInteger(s.panHold) || s.panHold <= 0 || !Number.isSafeInteger(s.panPrep) || s.panPrep <= 0
          || s.motorTicks !== s.panPrep + s.panHold
          || (s.panAxis ? !validConcurrentPan(s, receipt) : !input.panRelease && !equal(s.target, input.target)))
        || !equal(pose(input.camera), receipt.cameraAfter) || !equal(shape?.camera, receipt.cameraAfter)
        || !point(input.target) || input.target.x !== receipt.cameraAfter.x || input.target.z !== receipt.cameraAfter.z
        || !equal(shape?.marker, e) || publicAlertOnScreen(shape) !== true || receipt.completedTick > stream.endedTick) {
        audit.rejectedReceipts++; continue;
      }
      if (answered === null || receipt.completedTick < answered) answered = receipt.completedTick;
    }
    const unsupported = (creationValid ? log.inputs : []).filter(input => linked(input, e) && input.tick >= record.createdAtTick
      && (answered === null || input.tick < answered) && (!input.kind?.startsWith('camera-') || !['minimap', 'alert', 'pan'].includes(input.method)));
    if (unsupported.length) { audit.unsupportedCausalInputs += unsupported.length; complete = false; }
    const duration = validTick(record?.createdAtTick) && validTick(stream.endedTick) && stream.endedTick >= record.createdAtTick
      ? ((answered ?? stream.endedTick) - record.createdAtTick) / 20 : null;
    requiredPopulation.push({ creation: clone(e), createdAtTick: record?.createdAtTick ?? null, completedTick: answered,
      censorTick: answered === null ? stream.endedTick : null, seconds: duration });
    if (duration !== null) samples.push({ event: key(e), seconds: duration, observed: answered !== null });
  }
  const evaluable = complete && audit.unknownCreations === 0 && stream.startedTick === 0 && validTick(stream.endedTick)
    && Object.values(stream.coverage).every(n => n === 0);
  return { policy: PUBLIC_ALERT_POLICY, recorded: true, evaluable, rawAlerts, decisions, requiredEvents: requiredPopulation.length,
    requiredPopulation, audit, coverage: clone(stream.coverage), samples, survival: publicAlertKM(samples),
    nonCameraEndpoint: 'unknown-no-source-proven-purpose-adapter' };
}
export function poolPublicAlerts(scores, level) {
  if (!limits[level]) throw Error('Unknown alert difficulty');
  const survival = publicAlertKM(scores.flatMap(s => s.samples ?? []));
  const coverageComplete = scores.length > 0 && scores.every(s => s.recorded && s.evaluable);
  const [lo, hi] = limits[level];
  return { policy: PUBLIC_ALERT_POLICY, totalSeats: scores.length, recordedSeats: scores.filter(s => s.recorded).length,
    eventlessSeats: scores.filter(s => s.recorded && s.requiredEvents === 0).length, coverageComplete,
    firstCompletedAction: { survival, answered: survival.curve.reduce((n, r) => n + r.observed, 0), censored: survival.curve.reduce((n, r) => n + r.censored, 0) },
    limitSeconds: [lo, hi], gate: !coverageComplete || !survival.medianIdentifiable ? 'unknown' : survival.medianSeconds >= lo && survival.medianSeconds <= hi ? 'pass' : 'fail' };
}
