import { isDeepStrictEqual } from 'node:util';

export const MANUAL_RESPONSE_POLICY = 'screen-manual-v2-proposal';
export const MANUAL_RESPONSE_STREAM = 'ww2-public-manual-response-v2-proposal';
export function createManualResponsePolicy({ CELL, CFG, UNITS, SUPPORT, COVER, los, bindings = [] }) {
const retreatBinding = bindings.find(binding=>binding.id === 'retreat');
const near = (a, b, radius) => !!a && !!b && Math.hypot(a.x - b.x, a.z - b.z) <= radius;
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const idsOf = cmd => cmd.orders?.map(row => row[0]) ?? cmd.ids ?? [];
const descriptor = event => structuredClone(event);
const keyOf = event => `${event.id}/${event.tick}`;
const weapon = unit => UNITS[unit?.type]?.w;
const alive = unit => unit && unit.hp > 0 && !(unit.flags & (512 | 262144));
const enemy = (scene, unit) => alive(unit) && unit.team !== scene.team;
const combat = unit => alive(unit) && !!weapon(unit) && !UNITS[unit.type].structure && !UNITS[unit.type].air
  && !UNITS[unit.type].medic && unit.type !== 'engineer';
const stationaryReady = (scene, unit) => unit.moving ? weapon(unit)?.moveFire !== undefined
  : Number.isFinite(unit.firstStillTick) && scene.observationTick - unit.firstStillTick >= (weapon(unit)?.setup ?? 0) * 20;
const effective = (unit, target) => {
  const w = weapon(unit), def = UNITS[target?.type];
  if (!w || !def) return false;
  // Small arms can chip a vehicle without being a useful automatic answer to armor.
  return def.infantry ? w.inf > 0 || w.supp > 0 : w.veh > 0 && w.veh > w.inf;
};
const firingAllowed = (unit, target) => !unit.holdFire || unit.attackId === target.id;
const clear = (scene, a, b) => scene.sightlines.find(row => row.from === a.id && row.to === b.id)?.clear === true;
const canEngage = (scene, a, b) => !!weapon(a) && enemy({ ...scene, team: a.team }, b)
  && near(a, b, weapon(a).range) && (!weapon(a).salvo || distance(a, b) >= (weapon(a).minRange ?? 0)) && (weapon(a).salvo || clear(scene, a, b));
const publicRisk = unit => unit.healthShare < .35 || UNITS[unit.type].models > 1
  && Math.ceil(unit.hp / UNITS[unit.type].hpPer) <= 1 || unit.pinned && unit.healthShare < .6;
const provablyOutsideRisk = unit => unit.healthLower >= .35
  && (UNITS[unit.type].models <= 1 || Math.ceil(unit.healthLower * unit.full / UNITS[unit.type].hpPer) > 1)
  && !(unit.pinned && unit.healthLower < .6);

function publicClear(view, a, b) {
  if (!view.chars || !view.flags || !Array.isArray(view.smokes)) return null;
  // Unknown World cells cannot establish an automatic firing opportunity.
  const n = Math.ceil(distance(a, b) / (CELL / 2));
  for (let i = 0; i <= n; i++) {
    const t = n ? i / n : 0, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
    const cell = Math.floor(z / CELL) * view.w + Math.floor(x / CELL);
    if (view.chars[cell] === '?' || view.chars[cell] === undefined) return null;
  }
  return los({ w: view.w, h: view.h, flags: view.flags, height: view.height, smokes: view.smokes }, a, b);
}

// Accept only the masked human scene, not a raw snapshot or authoritative game.
function capturePublicScene(view, slot, recordedTick = view.tick) {
  if (!(view.screenIds instanceof Set) || !(view.units instanceof Map) || !Number.isSafeInteger(view.tick))
    throw new Error('A current public screen and its observation tick are required');
  if (!Number.isSafeInteger(recordedTick) || recordedTick < view.tick) throw new Error('Invalid public recording clock');
  const rows = [...view.screenIds].map(id => view.units.get(id)).filter(Boolean);
  const units = rows.map(unit => {
    const def = UNITS[unit.type], full = def.models * def.hpPer, share = unit.hp / full;
    if (!['world-bar','selected-hud'].includes(unit.hpSource) || unit.hpObservedTick !== view.tick)
      throw new Error('Fresh public health provenance is required');
    const exact = unit.hpSource === 'selected-hud' && unit.exactHPKnown === true;
    return { id: unit.id, type: unit.type, owner: unit.owner, team: view.players[unit.owner]?.team,
      x: unit.x, z: unit.z, hp: unit.hp, full, healthShare: share,
      healthLower: Math.max(0, exact ? (unit.hp - 1) / full : share - .025),
      healthUpper: Math.min(1, exact ? unit.hp / full : share + .025),
      hpSource: unit.hpSource, flags: unit.flags, pinned: unit.suppressionBand === 'pinned',
      suppressed: unit.suppressionBand === 'suppressed', targetId: unit.targetId, attackId: unit.attackId,
      retreating: unit.retreating, garrison: unit.garrison, cover: unit.cover, holdFire: unit.holdFire,
      holdPos: unit.holdPos, autoRetreat: unit.autoRetreat, moving: !!unit.path.length,
      pathEnd: unit.path.at(-1) ? { x: unit.path.at(-1).x, z: unit.path.at(-1).z } : null,
      firstStillTick: Number.isFinite(unit.firstStillAt) ? unit.firstStillAt * 20 : null,
      idle: !unit.retreating && !unit.path.length && !unit.orders.length && !unit.amove && !unit.attackId
        && !unit.targetId && !unit.dig && !unit.build && !unit.entrench && unit.enter < 0 && unit.fireAt < 0 && !unit.nade,
      cdKnown: unit.cdKnown === true, cd: unit.cdKnown === true ? unit.cd : null };
  });
  const possibleHomes = view.mode?.kind === 'world' ? null : [view.players[slot].spawn,
    ...(view.mode?.kind === 'classic' ? (view.minimap ?? []).filter(dot => dot.owner === slot
      && UNITS[view.units.get(dot.id)?.type]?.produces) : [])].filter(Boolean).map(at => ({ x: at.x, z: at.z }));
  return { schema: 'ww2-public-screen-proof-v1', observationTick: view.tick, recordedTick, slot, team: view.players[slot].team,
    mode: view.mode?.kind ?? 'conquest', scriptedSlot: view.mode?.slot ?? null, units, possibleHomes,
    coverSites: view.chars.flatMap((ch, cell) => ch !== '?' && view.flags[cell] & COVER ? [{ x:(cell % view.w + .5)*CELL, z:(Math.floor(cell/view.w)+.5)*CELL }] : []),
    fortifications: view.chars.flatMap((ch, cell) => ch === 'B' ? [{ x: (cell % view.w + .5) * CELL, z: (Math.floor(cell / view.w) + .5) * CELL }] : []),
    objectives: (view.points ?? []).map(point => ({ x: point.x, z: point.z, contested: point.contested })),
    sightlines: units.flatMap(a => units.filter(b => b.team !== a.team).map(b => ({ from: a.id, to: b.id, clear: publicClear(view, a, b) }))) };
}

function automaticRetreat(scene, unit) {
  return unit.autoRetreat && scene.slot !== scene.scriptedSlot && UNITS[unit.type].speed > 0 && !UNITS[unit.type].air
    && unit.healthUpper < CFG.autoRetreat && Array.isArray(scene.possibleHomes) && scene.possibleHomes.length > 0
    && scene.possibleHomes.every(home => distance(home, unit) > CFG.reinforceRadius);
}
function automaticCombat(scene, unit, contact) {
  if (!provablyOutsideRisk(unit) || !stationaryReady(scene, unit) || unit.retreating) return false;
  const foes = scene.units.filter(other => enemy(scene, other));
  if (UNITS[unit.type].infantry && foes.some(other => !UNITS[other.type].infantry && effective(other, unit)
    && canEngage(scene, other, unit) && !effective(unit, other))) return false;
  const target = scene.units.find(other => other.id === unit.targetId) ?? contact;
  return enemy(scene, target) && effective(unit, target) && firingAllowed(unit, target)
    && (!weapon(unit).area || unit.attackId === target.id) && canEngage(scene, unit, target);
}
function fortifiedHold(scene, unit) {
  return provablyOutsideRisk(unit) && (unit.garrison >= 0 || unit.cover === 2)
    && !scene.objectives.some(point => point.contested && near(point, unit, 24))
    && !scene.units.some(other => enemy(scene, other) && effective(other, unit) && canEngage(scene, other, unit));
}
function paidProtection(scene, event, unit, flights) {
  // Only a confirmed, already-started issuing gesture can cover a later cue. A selection or queued plan cannot.
  return flights.find(flight => flight.kind === 'retreat-key' && flight.command?.t === 'retreat'
    && idsOf(flight.command).includes(unit.id) && flight.actualSelectedIds?.includes(unit.id)
    && [flight.inputStartedTick,flight.queuedTick,flight.declaredAtTick,flight.activeAtTick].every(Number.isSafeInteger)
    && flight.activeAtTick === event.tick && flight.inputStartedTick < event.tick
    && flight.completedTick === null && flight.cause?.kind === 'screen-damage' && flight.cause.unitId === unit.id
    && flight.cause.tick < flight.inputStartedTick && flight.cause.tick <= flight.queuedTick
    && flight.queuedTick <= flight.inputStartedTick && flight.declaredAtTick <= flight.inputStartedTick
    && flight.source === 'physical-key-start' && !!retreatBinding
    && ['code','shift','ctrl','alt'].every(field=>flight.input?.[field] === retreatBinding[field])
    && flight.causeRecord?.decision === 'required'
    && flight.causeRecord.manualUnits?.includes(unit.id)
    && isDeepStrictEqual(flight.causeRecord.creation, descriptor(flight.cause))
    && classifyManualCreation(flight.cause,flight.causeRecord.publicProof,flight.causeRecord.publicBaseline,[]).manualUnits.includes(unit.id)
    && Array.isArray(scene.possibleHomes) && scene.possibleHomes.length > 0
    && scene.possibleHomes.every(home => !scene.units.some(foe => enemy(scene, foe) && weapon(foe)
      && near(home, foe, weapon(foe).range))));
}

function classifyManualCreation(event, scene, previous = null, flights = []) {
  const creation = descriptor(event);
  const row = { policy: MANUAL_RESPONSE_POLICY, creation, decision: 'unknown', reason: 'missing-public-creation-proof',
    creationUnits: [], manualUnits: [], coverage: [], publicProof: scene ? structuredClone(scene) : null,
    publicBaseline: previous ? structuredClone(previous) : null, inFlightProof: structuredClone(flights) };
  if (!scene || scene.schema !== 'ww2-public-screen-proof-v1' || event.observationTick !== scene.observationTick
    || event.tick !== scene.recordedTick) return row;
  if (event.source !== 'screen' || !event.onScreen || !['screen-contact','screen-damage'].includes(event.kind)) {
    row.reason = 'outside-screen-policy'; return row;
  }
  const own = unit => alive(unit) && unit.owner === scene.slot && !UNITS[unit.type].structure;
  const target = scene.units.find(unit => unit.id === event.targetId);
  const victim = scene.units.find(unit => unit.id === event.unitId);
  let candidates;
  if (event.kind === 'screen-contact') {
    if (!enemy(scene, target)) return row;
    candidates = scene.units.filter(unit => own(unit) && combat(unit) && unit.idle && near(unit, target, 45));
  } else {
    if (!own(victim)) return row;
    const old = previous?.units?.find(unit => unit.id === victim.id);
    if (!old || previous.observationTick >= scene.observationTick) { row.reason = 'missing-public-damage-baseline'; return row; }
    const heavy = (old.hp - victim.hp) / victim.full >= .25 - 1e-9;
    const risk = !publicRisk(old) && publicRisk(victim);
    candidates = heavy || risk ? [victim] : [];
  }
  row.creationUnits = candidates.map(unit => unit.id);
  for (const unit of candidates) {
    let reason = null, protection = null;
    if (unit.retreating) reason = 'already-retreating';
    else if (automaticRetreat(scene, unit)) reason = 'automatic-retreat-provable';
    else if ((protection = paidProtection(scene, event, unit, flights))) reason = 'paid-protection-in-flight';
    else if (automaticCombat(scene, unit, target)) reason = 'automatic-useful-combat';
    else if (event.kind === 'screen-contact' && fortifiedHold(scene, unit)) reason = 'fortified-monitoring-hold';
    if (reason) row.coverage.push({ actorId: unit.id, reason, ...(protection && { inputStartedTick: protection.inputStartedTick,
      command: structuredClone(protection.command), cause: descriptor(protection.cause) }) });
    else row.manualUnits.push(unit.id);
  }
  row.decision = row.manualUnits.length ? 'required' : 'monitoring';
  row.reason = row.manualUnits.length ? event.kind === 'screen-contact' ? 'idle-combat-contact' : 'public-heavy-or-risk-damage'
    : candidates.length ? 'covered-at-creation' : 'no-manual-demand';
  return row;
}

function threatening(scene, creation, unit) {
  const contact = scene.units.find(other => other.id === creation.targetId);
  return scene.units.filter(other => enemy(scene, other) && effective(other, unit) && canEngage(scene, other, unit)
    && (creation.kind === 'screen-damage' ? near(other, unit, 48) : other.id === contact?.id || near(other, contact, 24)));
}
function commandServesManualCreation(cmd, record, scene) {
  if (record.decision !== 'required' || !scene || scene.schema !== 'ww2-public-screen-proof-v1') return false;
  const event = record.creation, eligible = record.manualUnits;
  const own = idsOf(cmd).map(id => scene.units.find(unit => unit.id === id)).filter(unit => alive(unit) && unit.owner === scene.slot);
  const affected = own.filter(unit => eligible.includes(unit.id));
  const target = scene.units.find(unit => unit.id === cmd.target);
  const foesFor = unit => threatening(scene, event, unit);
  if (cmd.t === 'retreat') return affected.some(unit => event.kind === 'screen-damage' || foesFor(unit).length > 0);
  if (cmd.t === 'attack') return affected.some(unit => enemy(scene, target) && effective(unit, target)
    && canEngage(scene, unit, target) && (event.targetId === target.id || foesFor(unit).includes(target)));
  if (['move','amove'].includes(cmd.t)) return (cmd.orders ?? []).some(([id,x,z]) => {
    const unit = affected.find(unit => unit.id === id), at = { x,z };
    if (!unit || !Number.isFinite(x) || !Number.isFinite(z)) return false;
    const threats = foesFor(unit);
    // The 2.5m bound is the engine's attack-move arrival tolerance, not a fitted response-time threshold.
    const pullback = threats.some(foe => distance(at, foe) >= distance(unit, foe) + 2.5)
      && threats.every(foe => distance(at, foe) >= distance(unit, foe))
      && !scene.units.some(foe => enemy(scene, foe) && weapon(foe) && !near(unit, foe, weapon(foe).range)
        && near(at, foe, weapon(foe).range));
    if (pullback) return true;
    const contact = scene.units.find(foe => foe.id === event.targetId);
    return cmd.t === 'amove' && enemy(scene, contact) && effective(unit, contact) && near(at, contact, 24)
      && distance(at, contact) < distance(unit, contact) && near(at, contact, weapon(unit).range);
  });
  if (cmd.t === 'cover') return affected.some(unit => UNITS[unit.type].infantry && !unit.retreating
    && unit.cover !== 2 && unit.garrison < 0 && foesFor(unit).length > 0
    && scene.coverSites.some(site => near(site,unit,CFG.behavior.coverSeek)));
  if (cmd.t === 'garrison') return affected.some(unit => UNITS[unit.type].garrisons
    && unit.garrison < 0 && foesFor(unit).length > 0
    && (scene.fortifications ?? []).some(site => near(site, cmd, CELL / 2) && near(site, unit, 24)));
  const at = Number.isFinite(cmd.x) && Number.isFinite(cmd.z) ? cmd : null;
  const protectedUnits = scene.units.filter(unit => eligible.includes(unit.id));
  if (cmd.t === 'ability') return own.some(unit => {
    const ab = UNITS[unit.type].ab;
    if (!ab || !at || !unit.cdKnown || unit.cd > 0 || !near(unit, at, ab.range ?? 0)) return false;
    if (ab.id === 'grenade' || ab.id === 'satchel') return protectedUnits.some(victim => foesFor(victim)
      .some(foe => near(foe, at, ab.radius ?? 0))) && !scene.units.some(friend => friend.team === scene.team && near(friend, at, ab.radius ?? 0));
    return false;
  });
  if (cmd.t === 'support' && at && cmd.kind === 'smoke') return protectedUnits.some(unit => near(at, unit, 24)
    && (event.kind === 'screen-damage' || foesFor(unit).length > 0)
    && near(at, unit, SUPPORT.smoke.cloud));
  return false;
}

function defensiveEffect(receipt, record) {
  const before=receipt.publicScene, after=receipt.publicAfter;
  if (!after || after.schema !== 'ww2-public-screen-proof-v1' || after.recordedTick < receipt.tick
    || after.slot !== before.slot || after.observationTick < before.observationTick) return false;
  return idsOf(receipt.command).filter(id=>record.manualUnits.includes(id)).some(id=>{
    const a=before.units.find(unit=>unit.id===id), b=after.units.find(unit=>unit.id===id);
    if (!a || !b || b.owner!==a.owner) return false;
    if (receipt.command.t==='garrison') return b.garrison>=0 && a.garrison<0
      || b.pathEnd && before.fortifications.some(site=>near(site,b.pathEnd,CELL/2));
    return b.cover===2 && a.cover!==2 || b.cover===1 && ![1,2].includes(a.cover)
      || b.pathEnd && before.coverSites.some(site=>near(site,b.pathEnd,CELL/2));
  });
}
function scoreManualResponses(log, seconds, kaplanMeier) {
  const stream = log.manualMeasurements;
  if (stream?.schema !== MANUAL_RESPONSE_STREAM || stream.policy !== MANUAL_RESPONSE_POLICY)
    return { policy: MANUAL_RESPONSE_POLICY, evaluable: false, reason: 'missing-prospective-public-stream' };
  const supplied = stream.creations ?? [], records = supplied.map(row => classifyManualCreation(row.creation,
    row.publicProof, row.publicBaseline, row.inFlightProof));
  const inconsistent = supplied.filter((row,index) => !isDeepStrictEqual(row,records[index])).length;
  const nativeScreen = (log.events ?? []).filter(event => event.source === 'screen' && ['screen-contact','screen-damage'].includes(event.kind));
  const missing = nativeScreen.filter(event => !records.some(row => isDeepStrictEqual(row.creation,event)));
  for (const event of missing) records.push(classifyManualCreation(event,null));
  const population = new Map(records.map(row => [keyOf(row.creation), row]));
  const end = Math.round(seconds * 20), answers = new Map();
  const audit = { missingCreationProofs: missing.length, inconsistentClassifications: inconsistent, declared: 0, valid: 0, futureOrStale: 0, descriptorMismatch: 0, unknownCreation: 0, unrelatedCommand: 0,
    missingOperationProof: 0, belowReactionFloor: 0 };
  for (const operation of stream.operations ?? []) {
    for (const link of operation.events ?? []) {
      audit.declared++;
      const record = population.get(keyOf(link));
      if (!record || record.policy !== MANUAL_RESPONSE_POLICY) { audit.unknownCreation++; continue; }
      if (!isDeepStrictEqual(link, record.creation)) { audit.descriptorMismatch++; continue; }
      if (![operation.queuedTick,operation.inputStartedTick].every(Number.isSafeInteger)
        || link.tick > operation.queuedTick || link.tick > operation.inputStartedTick
        || operation.queuedTick > operation.inputStartedTick || operation.queuedTick - link.tick > 240) {
        audit.futureOrStale++; continue;
      }
      if (operation.publicScene?.recordedTick !== operation.queuedTick
        || operation.publicScene?.observationTick > operation.queuedTick
        || !commandServesManualCreation(operation.command, record, operation.publicScene)) { audit.unrelatedCommand++; continue; }
      const responses = operation.inputIndexes?.map(index => log.inputs?.[index]).filter(Boolean) ?? [];
      let first = responses.find(input => {
        if (input.countsAPM === false || input.kind === 'beat' || input.actor === 'human' && input.kind === 'command'
          || input.kind?.startsWith('camera-') || input.inputStartedTick < operation.inputStartedTick
          || input.tick < input.inputStartedTick || input.tick > end) return false;
        if (input.command) return isDeepStrictEqual(input.command, operation.command);
        const selection = ['select-click','select-add-click','select-box','group-recall'].includes(input.kind);
        const intended = input.responseActorIds ?? input.ids ?? [];
        return selection && idsOf(operation.command).some(id => intended.includes(id));
      });
      if (!first) audit.missingOperationProof++;
      if (first && first.tick - link.tick < 4) { audit.belowReactionFloor++; first = null; }
      const answer = answers.get(keyOf(link)) ?? { firstActionTick: null, acceptedCommandTick: null };
      if (first) answer.firstActionTick = Math.min(answer.firstActionTick ?? Infinity, first.tick);
      for (const input of responses) {
        const commandIndex = log.commands?.findIndex(row => row.tick === input.tick && isDeepStrictEqual(row.command, input.command));
        const nativeReceipt = commandIndex >= 0 ? log.commands[commandIndex] : null;
        const proof = (stream.receipts ?? []).find(row => row.commandIndex === commandIndex);
        const receipt = nativeReceipt && proof ? { ...nativeReceipt, publicScene: proof.publicScene, publicAfter: proof.publicAfter } : null;
        if (receipt?.accepted === true && input.tick - link.tick >= 4 && input.tick <= end
          && receipt.publicScene?.recordedTick === receipt.tick
          && (receipt.command.t === 'support' || idsOf(receipt.command).some(id => input.ids?.includes(id)))
          && commandServesManualCreation(receipt.command, record, receipt.publicScene)
          && (!['cover','garrison'].includes(receipt.command.t) || defensiveEffect(receipt, record)))
          answer.acceptedCommandTick = Math.min(answer.acceptedCommandTick ?? Infinity, input.tick);
      }
      answers.set(keyOf(link), answer); audit.valid++;
    }
  }
  const required = records.filter(row => row.policy === MANUAL_RESPONSE_POLICY && row.decision === 'required'),
    unknown = records.filter(row => row.policy !== MANUAL_RESPONSE_POLICY || row.decision === 'unknown');
  const endpoint = field => {
    const samples = required.map(record => ({ seconds: ((answers.get(keyOf(record.creation))?.[field] ?? end) - record.creation.tick) / 20,
      observed: answers.get(keyOf(record.creation))?.[field] != null }));
    return { required: required.length, answered: samples.filter(sample => sample.observed).length,
      censored: samples.filter(sample => !sample.observed).length, survival: kaplanMeier(samples) };
  };
  return { policy: MANUAL_RESPONSE_POLICY, evaluable: stream.startedTick === 0 && !unknown.length && !inconsistent && Array.isArray(log.events) && required.length > 0
      && log.physicalInputsRecorded === true && stream.operationLinksRecorded === true,
    creationEvents: records.length, requiredEvents: required.length, unknownEvents: unknown.length,
    monitoringEvents: records.filter(row => row.decision === 'monitoring').length,
    reasons: Object.fromEntries([...new Set(records.map(row=>row.reason))].map(reason=>[reason,records.filter(row=>row.reason===reason).length])),
    exclusions: records.flatMap(row => row.coverage), firstCompletedAction: endpoint('firstActionTick'),
    acceptedCommand: endpoint('acceptedCommandTick'), audit,
    physicalEndpointKnown: log.physicalInputsRecorded === true && stream.operationLinksRecorded === true,
    physicalInputCount: (log.inputs ?? []).filter(input => input.countsAPM !== false && input.kind !== 'beat'
      && !(input.actor === 'human' && input.kind === 'command')).length,
    rows: records.map(record => ({ ...record, answer: answers.get(keyOf(record.creation)) ?? null })) };
}

return { capturePublicScene, classifyManualCreation, commandServesManualCreation, scoreManualResponses };
}
