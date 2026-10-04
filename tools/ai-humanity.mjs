// Seeded input and command measurements. Legacy command APM is not physical input APM.
import { readFile, writeFile, readdir, stat, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';

const script = fileURLToPath(import.meta.url);
const root = resolve(dirname(script), '..');
const MODES = ['conquest', 'classic', 'world'];
const LEVELS = ['easy', 'normal', 'hard'];
const TICK = .05;
// shared/ai-perception.js HUMAN_CAMERA/cameraFootprint gives 112.876m at distance60.
// Scale the recorded distance85 width159.908m and round up. Keep game imports after worker checkpoints.
export const DEFAULT_SCREEN_SPAN = Math.ceil(159.908 * 60 / 85);
const round = n => Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null;
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const validPoint = p => p && Number.isFinite(p.x) && Number.isFinite(p.z);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function distribution(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const percentile = q => { if (!sorted.length) return null; const i = (sorted.length - 1) * q, lo = Math.floor(i); return round(sorted[lo] + (sorted[Math.ceil(i)] - sorted[lo]) * (i - lo)); };
  return { count: sorted.length, mean: round(sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : NaN), min: round(sorted[0]), p10: percentile(.1), median: percentile(.5), p90: percentile(.9), p95: percentile(.95), max: round(sorted.at(-1)) };
}
function seededRandom(initial) {
  let value = initial >>> 0;
  return () => { let t = value += 0x6D2B79F5; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function windows(events, seconds, width) {
  if (seconds < width) return [];
  const values = [];
  // Full windows keep quiet time in the denominator. Ten-second peaks slide each tick.
  const durationTicks = Math.round(seconds / TICK), widthTicks = Math.round(width / TICK);
  for (let start = 0; start + widthTicks <= durationTicks; start += width === 10 ? 1 : widthTicks) values.push(events.filter(e => e.tick > start && e.tick <= start + widthTicks).length * 60 / width);
  return values;
}
function selection(command) { return command.ids ?? command.orders?.map(o => o[0]) ?? []; }
function openingOf(commands) {
  const first = commands.filter(c => c.tick * TICK <= 45);
  return { purchases: first.filter(c => c.command.t === 'buy').slice(0, 5).map(c => c.command.unit),
    moves: first.filter(c => ['move', 'amove'].includes(c.command.t)).slice(0, 3).map(c => c.region ?? null) };
}
const isCameraInput = input => input.kind === 'camera' || input.kind === 'cameraJump' || input.kind?.startsWith('camera-');
const eventKey = event => `${event.id}/${event.tick}`;
const eventCategory = event => {
  if (event.source === 'minimap' || event.kind === 'minimap-contact') return 'minimapContactExploratory';
  if (event.source === 'screen' && event.onScreen === true && event.kind === 'screen-contact') return 'screenNewContact';
  if (event.source === 'screen' && event.onScreen === true && event.kind === 'screen-damage') return 'screenHpDamage';
  if (event.source === 'alert' && event.onScreen === true) return 'onScreenAlert';
  if (event.source === 'alert' && event.onScreen === false) return 'offScreenAlert';
  return 'otherEventExploratory';
};

export function kaplanMeier(samples) {
  const valid = samples.filter(sample => Number.isFinite(sample.seconds) && sample.seconds >= 0 && typeof sample.observed === 'boolean');
  const groups = new Map();
  for (const sample of valid) {
    const counts = groups.get(sample.seconds) ?? { observed: 0, censored: 0 };
    counts[sample.observed ? 'observed' : 'censored']++; groups.set(sample.seconds, counts);
  }
  const times = [...groups.keys()].sort((a, b) => a - b);
  let atRisk = valid.length, survival = 1, median = null;
  const curve = times.map(seconds => {
    const { observed, censored } = groups.get(seconds);
    const risk = atRisk;
    if (observed) survival *= 1 - observed / atRisk;
    if (median === null && survival <= .5) median = round(seconds);
    atRisk -= observed + censored;
    return { seconds: round(seconds), atRisk: risk, observed, censored, survival: round(survival) };
  });
  return { samples: valid.length, observed: valid.filter(sample => sample.observed).length, censored: valid.filter(sample => !sample.observed).length,
    medianSeconds: median, medianIdentifiable: median !== null, curve,
    method: 'Kaplan-Meier survival with completed responses counted before censoring at tied times. Recording-end censoring assumes no informative loss of follow-up. A null median means the observed curve did not reach 0.5.' };
}

export function concernMetrics(log) {
  if (!(log.inputs ?? []).some(input => typeof input.concern === 'string') && !Array.isArray(log.attentionVisits)) return null;
  const actual = log.commands ?? [], cycles = new Map();
  const expansion = { commands: 0, acceptedCommands: 0, commandsToConcern: 0, commandsToOther: 0, commandsUnmeasured: 0, acceptedCommandsToConcern: 0, acceptedCommandsToOther: 0,
    targets: 0, alignedTargets: 0, otherTargets: 0, unmeasuredTargets: 0, distancesMetres: [] };
  const production = { visits: 0, visitsWithAttemptedPurchase: 0, visitsWithAcceptedPurchase: 0, commandKinds: {}, attemptedPurchases: 0, acceptedPurchases: 0, rejectedPurchases: 0, rejectionReasons: {}, purchaseSpendMP: 0, purchaseSpendFuel: 0, allCommandSpendMP: 0, allCommandSpendFuel: 0, unmeasuredPurchaseSpend: 0 };
  let unmatchedCommandInputs = 0;
  for (const input of log.inputs ?? []) {
    if (typeof input.concern !== 'string') continue;
    const key = `${input.concern}/${input.cycle ?? input.cycleId ?? 'unknown'}`;
    const visit = cycles.get(key) ?? { concern: input.concern, commands: 0, acceptedCommands: 0, includesIdleUnit: false, acceptedIncludesIdleUnit: false, purchase: false, acceptedPurchase: false };
    cycles.set(key, visit);
    if (!input.command) continue;
    const submitted = actual.find(command => command.tick === input.tick && JSON.stringify(command.command) === JSON.stringify(input.command));
    if (!submitted) { unmatchedCommandInputs++; continue; }
    visit.commands++; if (submitted.accepted === true) visit.acceptedCommands++;
    const command = submitted.command;
    if (input.concern.startsWith('idle:')) {
      const id = Number(input.concern.slice(5));
      if (selection(command).includes(id)) { visit.includesIdleUnit = true; if (submitted.accepted === true) visit.acceptedIncludesIdleUnit = true; }
    }
    if ((input.concernKind === 'expansion' || /^(point|node):/.test(input.concern)) && ['move', 'amove'].includes(command.t)) {
      expansion.commands++; if (submitted.accepted === true) expansion.acceptedCommands++;
      const targets = command.orders?.map(order => ({ x: order[1], z: order[2] })) ?? (validPoint(command) ? [command] : []);
      let other = false, unmeasured = !targets.length;
      for (const target of targets) {
        expansion.targets++;
        if (!validPoint(input.concernTarget) || !validPoint(target)) { expansion.unmeasuredTargets++; unmeasured = true; continue; }
        const metres = distance(target, input.concernTarget); expansion.distancesMetres.push(metres);
        if (metres <= 20) expansion.alignedTargets++; else { expansion.otherTargets++; other = true; }
      }
      if (other) { expansion.commandsToOther++; if (submitted.accepted === true) expansion.acceptedCommandsToOther++; }
      else if (unmeasured) expansion.commandsUnmeasured++;
      else { expansion.commandsToConcern++; if (submitted.accepted === true) expansion.acceptedCommandsToConcern++; }
    }
    if (input.concern !== 'production') continue;
    production.commandKinds[command.t] = (production.commandKinds[command.t] ?? 0) + 1;
    if (submitted.accepted === true && Number.isFinite(submitted.spend?.mp)) {
      production.allCommandSpendMP += submitted.spend.mp; production.allCommandSpendFuel += submitted.spend.fuel ?? 0;
    }
    if (command.t !== 'buy') continue;
    visit.purchase = true; production.attemptedPurchases++;
    if (submitted.accepted === true) {
      visit.acceptedPurchase = true; production.acceptedPurchases++;
      if (Number.isFinite(submitted.spend?.mp)) { production.purchaseSpendMP += submitted.spend.mp; production.purchaseSpendFuel += submitted.spend.fuel ?? 0; }
      else production.unmeasuredPurchaseSpend++;
    } else if (submitted.accepted === false) {
      production.rejectedPurchases++;
      const reason = submitted.rejectionReason ?? 'unrecorded'; production.rejectionReasons[reason] = (production.rejectionReasons[reason] ?? 0) + 1;
    }
  }
  const idle = [...cycles.values()].filter(visit => visit.concern.startsWith('idle:'));
  const prod = [...cycles.values()].filter(visit => visit.concern === 'production');
  production.visits = prod.length; production.visitsWithAttemptedPurchase = prod.filter(visit => visit.purchase).length; production.visitsWithAcceptedPurchase = prod.filter(visit => visit.acceptedPurchase).length;
  const decisions = log.productionDecisions;
  production.planner = Array.isArray(decisions) ? { decisions: decisions.length, reasons: Object.fromEntries([...new Set(decisions.map(decision => decision.reason ?? 'unrecorded'))].map(reason => [reason, decisions.filter(decision => (decision.reason ?? 'unrecorded') === reason).length])),
    proposedBuys: decisions.reduce((n, decision) => n + (decision.proposedBuys ?? 0), 0), queuedBuys: decisions.reduce((n, decision) => n + (decision.queuedBuys ?? 0), 0),
    ownMP: distribution(decisions.map(decision => decision.mp)), wantedPriceMP: distribution(decisions.map(decision => decision.price?.mp)) } : null;
  const observedVisits = log.attentionVisits ?? null;
  return { version: 1, unmatchedCommandInputs,
    expansion: { ...expansion, distancesMetres: distribution(expansion.distancesMetres), alignmentThresholdMetres: 20 },
    idle: { inputContextCycles: idle.length, cyclesWithAnyCommand: idle.filter(visit => visit.commands).length, cyclesWithNoCommand: idle.filter(visit => !visit.commands).length,
      cyclesIncludingIdleUnit: idle.filter(visit => visit.includesIdleUnit).length, cyclesWithAcceptedIdleUnitCommand: idle.filter(visit => visit.acceptedIncludesIdleUnit).length,
      cyclesWithCommandsForOtherUnitsOnly: idle.filter(visit => visit.commands && !visit.includesIdleUnit).length },
    production, observedAttentionVisits: observedVisits ? { total: observedVisits.length, idle: observedVisits.filter(visit => visit.kind === 'idle').length, production: observedVisits.filter(visit => visit.kind === 'production').length } : null,
    method: 'Input-context cycles use concern plus cycle, matching the review denominator, and can include camera-only cycles. Expansion compares every actual move target with the delivered concern target within 20 metres. Idle inclusion measures command actors, not whether the unit subsequently became busy. Missing concern targets or spend instrumentation stay unmeasured.' };
}

// Event populations come from perception at creation, independently of which concerns receive attention.
export function reactionMetrics(log, seconds) {
  if (!log.eventsRecorded && !Array.isArray(log.events)) return { population: null, firstAction: null, command: null, requiredScreenPopulation: null };
  const endTick = Math.round(seconds / TICK), events = new Map();
  for (const event of log.events ?? []) if (event?.id != null && Number.isSafeInteger(event.tick) && event.tick >= 0 && event.tick <= endTick) {
    const key = eventKey(event);
    if (!events.has(key)) events.set(key, { event, category: eventCategory(event), firstAction: null, attemptedCommand: null, acceptedCommand: null,
      requiredFirstAction: null, requiredAttemptedCommand: null, requiredAcceptedCommand: null, intendedResponseInputs: 0, otherResponseInputs: 0,
      missingIntentMetadataInputs: 0, firstRequiredSelectionMatches: null });
  }
  const commands = log.commands ?? [];
  const inputs = [...(log.inputs ?? [])].filter(input => input.kind !== 'beat' && (input.command || input.countsAPM !== false && !(input.actor === 'human' && input.kind === 'command'))).sort((a, b) => a.tick - b.tick);
  let unmatchedCausalInputs = 0, unmatchedCommandInputs = 0, invalidTimingInputs = 0;
  for (const input of inputs) {
    if (!input.event || input.event.id == null) continue;
    const tick = input.eventTick ?? input.event.tick;
    const record = events.get(`${input.event.id}/${tick}`);
    if (!record) { unmatchedCausalInputs++; continue; }
    if (input.tick < record.event.tick) { invalidTimingInputs++; continue; }
    const latency = (input.tick - record.event.tick) * TICK;
    const screen = ['screenNewContact', 'screenHpDamage', 'onScreenAlert'].includes(record.category);
    const physical = input.countsAPM !== false && !(input.actor === 'human' && input.kind === 'command');
    if (physical && record.firstAction === null && (!screen || !isCameraInput(input))) record.firstAction = latency;
    const required = record.event.source === 'screen' && record.event.responseRequired === true;
    const responseUnits = record.event.responseUnits ?? [];
    const supportResponse = (input.kind?.startsWith('support-') || input.command?.t === 'support')
      && validPoint(input.responseTarget) && distance(input.responseTarget, record.event) <= 24;
    const intendedResponse = (input.responseActorIds ?? []).some(id => responseUnits.includes(id))
      || !(input.responseActorIds ?? []).length && supportResponse;
    if (required && physical && !isCameraInput(input)) {
      if (!Array.isArray(input.responseActorIds) && !validPoint(input.responseTarget)) record.missingIntentMetadataInputs++;
      if (intendedResponse) record.intendedResponseInputs++; else record.otherResponseInputs++;
      if (intendedResponse && record.requiredFirstAction === null) {
        record.requiredFirstAction = latency;
        record.firstRequiredSelectionMatches = Array.isArray(input.ids) ? input.ids.some(id => responseUnits.includes(id)) : input.selected === 0 ? false : null;
      }
    }
    if (!input.command) continue;
    const submitted = commands.find(command => command.tick === input.tick && JSON.stringify(command.command) === JSON.stringify(input.command));
    if (!submitted) { unmatchedCommandInputs++; continue; }
    if (record.attemptedCommand === null) record.attemptedCommand = latency;
    if (submitted.accepted === true && record.acceptedCommand === null) record.acceptedCommand = latency;
    const actualResponse = selection(submitted.command).some(id => responseUnits.includes(id))
      || submitted.command.t === 'support' && supportResponse;
    if (required && actualResponse) {
      if (record.requiredAttemptedCommand === null) record.requiredAttemptedCommand = latency;
      if (submitted.accepted === true && record.requiredAcceptedCommand === null) record.requiredAcceptedCommand = latency;
    }
  }
  const summarize = records => {
    const answer = field => {
      const answered = records.filter(record => record[field] !== null);
      const unanswered = records.filter(record => record[field] === null);
      return { answered: answered.length, unanswered: unanswered.length, seconds: distribution(answered.map(record => record[field])), unansweredCensoredSeconds: distribution(unanswered.map(record => Math.max(0, endTick - record.event.tick) * TICK)) };
    };
    return { events: records.length, firstAction: answer('firstAction'), attemptedCommand: answer('attemptedCommand'), acceptedCommand: answer('acceptedCommand') };
  };
  const all = [...events.values()];
  const byType = Object.fromEntries(['screenNewContact', 'screenHpDamage', 'onScreenAlert', 'offScreenAlert', 'minimapContactExploratory', 'otherEventExploratory'].map(category => [category, summarize(all.filter(record => record.category === category))]));
  const onScreen = summarize(all.filter(record => ['screenNewContact', 'screenHpDamage', 'onScreenAlert'].includes(record.category)));
  const offScreenAlert = byType.offScreenAlert;
  const annotated = all.filter(record => record.event.source === 'screen' && typeof record.event.responseRequired === 'boolean');
  const mandatory = annotated.filter(record => record.event.responseRequired);
  const requiredAnswer = field => {
    const answered = mandatory.filter(record => record[field] !== null), unanswered = mandatory.filter(record => record[field] === null);
    return { answered: answered.length, unanswered: unanswered.length, conditionalCompletedSeconds: distribution(answered.map(record => record[field])),
      unansweredCensoredSeconds: distribution(unanswered.map(record => Math.max(0, endTick - record.event.tick) * TICK)),
      survival: kaplanMeier(mandatory.map(record => ({ seconds: record[field] ?? Math.max(0, endTick - record.event.tick) * TICK, observed: record[field] !== null }))) };
  };
  const requiredScreenPopulation = annotated.length ? {
    policies: [...new Set(annotated.map(record => record.event.responsePolicy ?? 'unrecorded'))], annotatedEvents: annotated.length,
    unannotatedScreenEvents: all.filter(record => record.event.source === 'screen').length - annotated.length,
    requiredEvents: mandatory.length, exemptEvents: annotated.length - mandatory.length,
    reasons: Object.fromEntries([...new Set(annotated.map(record => record.event.responseReason ?? 'unrecorded'))].map(reason => [reason, {
      required: mandatory.filter(record => (record.event.responseReason ?? 'unrecorded') === reason).length,
      exempt: annotated.filter(record => !record.event.responseRequired && (record.event.responseReason ?? 'unrecorded') === reason).length }])),
    firstAction: requiredAnswer('requiredFirstAction'), attemptedCommand: requiredAnswer('requiredAttemptedCommand'), acceptedCommand: requiredAnswer('requiredAcceptedCommand'),
    causalAlignment: { intendedResponseInputs: mandatory.reduce((n, record) => n + record.intendedResponseInputs, 0), otherResponseInputs: mandatory.reduce((n, record) => n + record.otherResponseInputs, 0),
      missingIntentMetadataInputs: mandatory.reduce((n, record) => n + record.missingIntentMetadataInputs, 0),
      firstActionSelectionMatches: mandatory.filter(record => record.firstRequiredSelectionMatches === true).length,
      firstActionSelectionDiffers: mandatory.filter(record => record.firstRequiredSelectionMatches === false).length,
      firstActionSelectionUnmeasured: mandatory.filter(record => record.requiredFirstAction !== null && record.firstRequiredSelectionMatches === null).length },
    method: 'Eligibility is the perception annotation at event creation, equal across levels. Screen events without annotations stay unmeasured. First completed non-camera input requires intended response actors intersecting responseUnits, or an explicit support target within 24 metres. A missed relevant selection still counts as an attempted action; actual selected IDs are reported separately. Command responses require actual relevant actors or support targets. All unanswered required events remain in recording-end-censored survival estimates; conditional medians alone do not certify a population gate. Alerts and minimap events are outside this screen-only policy.'
  } : null;
  return {
    requiredScreenPopulation,
    population: { version: 2, recorded: true, events: all.length, unmatchedCausalInputs, unmatchedCommandInputs, invalidTimingInputs, onScreen, offScreenAlert, byType },
    firstAction: { onScreen: onScreen.firstAction.seconds, offScreenAlert: offScreenAlert.firstAction.seconds },
    command: { attempted: { onScreen: onScreen.attemptedCommand.seconds, offScreenAlert: offScreenAlert.attemptedCommand.seconds }, accepted: { onScreen: onScreen.acceptedCommand.seconds, offScreenAlert: offScreenAlert.acceptedCommand.seconds } },
  };
}

export function summarizeSeat(log, seconds, screenSpan = DEFAULT_SCREEN_SPAN) {
  const commands = log.commands ?? [];
  const accepted = commands.filter(c => c.accepted === true);
  const rejected = commands.filter(c => c.accepted === false);
  const inputs = [...(log.inputs ?? [])].sort((a, b) => a.tick - b.tick);
  const ticks = new Map();
  for (const c of commands) ticks.set(c.tick, (ticks.get(c.tick) ?? 0) + 1);
  const orders = commands.filter(c => !['buy', 'stance', 'recover'].includes(c.command.t));
  let crossMapPairs = 0, quarterSecondCrossMapPairs = 0, sameCommandCrossMap = 0;
  const spatial = orders.filter(c => c.locations?.length);
  for (let i = 0; i < spatial.length; i++) {
    const command = spatial[i];
    if (command.locations.some((a, k) => command.locations.slice(k + 1).some(b => distance(a, b) > screenSpan))) sameCommandCrossMap++;
    for (let j = i + 1; j < spatial.length && (spatial[j].tick - command.tick) * TICK <= 1 + 1e-9; j++) {
      if (!command.locations.some(a => spatial[j].locations.some(b => distance(a, b) > screenSpan))) continue;
      crossMapPairs++;
      if ((spatial[j].tick - command.tick) * TICK <= .25 + 1e-9) quarterSecondCrossMapPairs++;
    }
  }
  const physical = inputs.filter(i => i.countsAPM !== false && i.kind !== 'beat' && !(i.actor === 'human' && i.kind === 'command'));
  const physicalRecorded = physical.length > 0 || log.physicalInputsRecorded === true || inputs.some(i => i.observed?.physicalInputs === true);
  const reaction = reactionMetrics(log, seconds);
  const camera = inputs.filter(i => i.kind === 'camera' || i.kind === 'cameraJump' || i.kind?.startsWith('camera-'));
  const cycles = new Map();
  for (const input of physical) {
    const cycle = input.cycle ?? input.cycleId;
    if (cycle === undefined) continue;
    const data = cycles.get(cycle) ?? { start: input.tick, end: input.tick, actions: 0 };
    data.end = Math.max(data.end, input.tick); data.actions++; cycles.set(cycle, data);
  }
  return {
    commands: commands.length, acceptedCommands: accepted.length, rejectedCommands: rejected.length, unknownAcceptanceCommands: commands.length - accepted.length - rejected.length,
    commandsPerTick: { allTicksMean: round(commands.length / Math.max(1, seconds / TICK)), activeTicks: ticks.size, activeTickDistribution: distribution([...ticks.values()]), ticksOverOne: [...ticks.values()].filter(n => n > 1).length },
    commandAPM: { matchMean: round(commands.length * 60 / seconds), windows60: distribution(windows(commands, seconds, 60)), windows10: distribution(windows(commands, seconds, 10)) },
    physicalInputAPM: physicalRecorded ? { matchMean: round(physical.length * 60 / seconds), windows60: distribution(windows(physical, seconds, 60)), windows10: distribution(windows(physical, seconds, 10)) } : null,
    firstCommandSeconds: round(commands[0]?.tick * TICK), firstOrderSeconds: round(orders[0]?.tick * TICK), firstBuySeconds: round(commands.find(c => c.command.t === 'buy')?.tick * TICK),
    firstAcceptedOrderSeconds: round(orders.find(c => c.accepted === true)?.tick * TICK), firstAcceptedBuySeconds: round(commands.find(c => c.command.t === 'buy' && c.accepted === true)?.tick * TICK),
    reactionMeasurementVersion: 2, reactionEvents: reaction.population,
    reactionSeconds: reaction.firstAction, reactionCommandSeconds: reaction.command,
    requiredScreenPopulation: reaction.requiredScreenPopulation, concernAlignment: concernMetrics(log),
    contactToTargetCommandSeconds: distribution(log.contactReactions ?? []),
    crossMap: { screenSpan, commandPairsWithinOneSecond: crossMapPairs, commandPairsWithinQuarterSecond: quarterSecondCrossMapPairs, bundledCommandsSpanningScreen: sameCommandCrossMap },
    cameraJumpsPerMinute: (log.physicalInputsRecorded || camera.length || inputs.length && !inputs.some(i => i.actor === 'human')) ? round(camera.filter(i => i.kind !== 'camera-move' && i.method !== 'pan').length * 60 / seconds) : null,
    dwellSeconds: log.attentionDwellSeconds?.length ? distribution(log.attentionDwellSeconds) : null,
    cycleInputSpanSeconds: inputs.length ? distribution([...cycles.values()].map(c => (c.end - c.start) * TICK)) : null,
    actionsPerCycle: inputs.length ? distribution([...cycles.values()].map(c => c.actions)) : null,
    floatingMP: distribution(log.mp ?? []), idleSeconds: distribution(log.idleSeconds ?? []), unnoticedIdleSeconds: log.physicalInputsRecorded ? distribution(log.unnoticedIdleSeconds ?? []) : null,
    unnoticedIdleCensoredSeconds: log.physicalInputsRecorded ? distribution(log.unnoticedIdleCensoredSeconds ?? []) : null,
    opening: openingOf(commands), commandLogSHA256: digest(commands), inputLogSHA256: inputs.length ? digest(inputs) : null,
  };
}
export async function sourceCheckpoint(legacy) {
  const shared = (await readdir(resolve(root, 'shared'))).filter(name => name.endsWith('.js')).sort().map(name => `shared/${name}`);
  const files = ['tools/ai-humanity.mjs', ...shared, ...(legacy ? ['tools/legacy-ai/ai.js', 'tools/legacy-ai/ai-view.js', 'tools/legacy-ai/ai-mind.js'] : ['client/keys.js'])];
  const hashes = Object.fromEntries(await Promise.all(files.map(async file => [file, createHash('sha256').update(await readFile(resolve(root, file))).digest('hex')])));
  return { recordedAt: new Date().toISOString(), sha256: digest(hashes), files: hashes, method: 'File hashes captured in each worker immediately before its first commander import. The worker reuses those imported modules for its subsequent matches.' };
}
export async function packageReport(inputPath, outputPath, archivePath) {
  const input = resolve(inputPath), output = resolve(outputPath), archive = resolve(archivePath);
  if (new Set([input, output, archive]).size !== 3) throw Error('Source report, compact report and gzip archive must have different paths.');
  const bytes = await readFile(input), report = JSON.parse(bytes.toString('utf8'));
  if (!Array.isArray(report.results) || !report.results.length || report.results.some(result => !Array.isArray(result.logs) || result.logs.length !== result.seats?.length)) throw Error('Packaging requires full raw logs for every match and seat.');
  const compressed = await promisify(gzip)(bytes, { level: 9 });
  const sha256 = value => createHash('sha256').update(value).digest('hex');
  const compact = { ...report, results: report.results.map(({ logs, ...result }) => ({ ...result,
    timelinesSHA256: digest(logs), timelineDigests: logs.map((log, slot) => ({ slot, sha256: digest(log), commands: log.commands?.length ?? 0, inputs: log.inputs?.length ?? 0, events: log.events?.length ?? 0 })) })),
    evidenceArchive: { format: 'gzip', path: relative(dirname(output), archive), sha256: sha256(compressed), bytes: compressed.length,
      uncompressedSHA256: sha256(bytes), uncompressedBytes: bytes.length,
      method: 'The gzip archive contains the complete source report bytes, including every raw timeline. Compact timeline digests hash JSON.stringify of each original log in array order. No measurements or historical event annotations are changed.' } };
  await Promise.all([mkdir(dirname(output), { recursive: true }), mkdir(dirname(archive), { recursive: true })]);
  await writeFile(archive, compressed);
  await writeFile(output, JSON.stringify(compact) + '\n');
  return compact;
}
async function runMatch(options, task) {
  const sim = await import('../shared/sim.js');
  const ai = await import(options.legacy ? './legacy-ai/ai.js' : '../shared/ai.js');
  const map = JSON.parse(await readFile(resolve(root, `maps/${options.map}.json`), 'utf8'));
  const slots = task.mode === 'world' ? 3 : sim.spawnsFor(map, task.mode).length;
  const originalRandom = Math.random; Math.random = seededRandom(task.seed);
  try {
    const g = sim.createGame(map, Array.from({ length: slots }, (_, i) => `AI ${i}`), true, Array.from({ length: slots }, (_, i) => i), Array.from({ length: slots }, (_, i) => i % 3), { mode: task.mode, worldSeed: task.seed, army: 'standard' });
    const logs = g.players.map(() => ({ commands: [], inputs: [], physicalInputsRecorded: !!ai.humanCommander, mp: [], idleSeconds: [], unnoticedIdleSeconds: [], unnoticedIdleCensoredSeconds: [], attentionDwellSeconds: [], contactReactions: [], ...(ai.humanCommander ? { attentionVisits: [] } : {}) }));
    const noticed = g.players.map(() => new Map()), reacted = g.players.map(() => new Set()), idle = g.players.map(() => new Map()), attention = g.players.map(() => null);
    const idleNoticed = g.players.map(() => new Set()), recordedEvents = g.players.map(() => new Set()), recordedProduction = g.players.map(() => new Set());
    const initialCache = sim.snapshotCache(g);
    const views = g.players.map((_, slot) => ai.observe?.(g, slot, initialCache));
    const cameraSpan = options.screenSpan ?? DEFAULT_SCREEN_SPAN;
    const inputLog = (slot, input) => {
      const row = structuredClone(input), view = views[slot];
      if (!validPoint(row.concernTarget) && typeof row.concern === 'string') {
        const point = /^point:(.+)$/.exec(row.concern), node = /^node:(\d+)$/.exec(row.concern);
        const target = point ? (view?.points?.some(p => p.id != null) ? view.points.find(p => String(p.id) === point[1]) : view?.points?.[Number(point[1])])
          : node ? view?.nodes?.[Number(node[1])] : null;
        if (validPoint(target)) row.concernTarget = { x: target.x, z: target.z };
      }
      logs[slot].inputs.push(row);
    };
    for (let tick = 0; tick < Math.round(options.seconds / sim.TICK) && g.winner === null; tick++) {
      sim.step(g);
      if (g.tick % 2 === 0 || g.winner !== null) {
        const cache = sim.snapshotCache(g);
        g.players.forEach((p, slot) => {
          views[slot] = ai.observe?.(g, slot, cache);
          const view = views[slot];
          for (const id of view?.players?.[slot]?.visible ?? []) {
            const unit = view.units.get(id);
            if (unit && g.players[unit.owner]?.team !== p.team && !noticed[slot].has(id)) noticed[slot].set(id, g.tick);
          }
        });
      }
      g.players.forEach((p, slot) => {
        const submit = command => {
          const sourceLocations = selection(command).map(id => g.units.get(id)).filter(Boolean).map(u => ({ x: u.x, z: u.z }));
          const locations = [];
          if (command.orders) locations.push(...command.orders.map(o => ({ x: o[1], z: o[2] })));
          if (Number.isFinite(command.x) && Number.isFinite(command.z)) locations.push({ x: command.x, z: command.z });
          const target = views[slot]?.units?.get(command.target ?? command.id);
          if (target) locations.push({ x: target.x, z: target.z });
          if (!locations.length) locations.push(...sourceLocations);
          for (const id of selection(command)) if (idle[slot].has(id) && !idleNoticed[slot].has(id)) { logs[slot].unnoticedIdleSeconds.push((g.tick - idle[slot].get(id)) * TICK); idleNoticed[slot].add(id); }
          const resourcesBefore = { mp: p.mp, fuel: p.fuel ?? 0 };
          const purchasePrice = command.t === 'buy' && sim.UNITS[command.unit] ? sim.priceOf(views[slot], command.unit) : null;
          const result = sim.command(g, slot, command);
          const resourcesAfter = { mp: p.mp, fuel: p.fuel ?? 0 };
          const at = locations.at(-1);
          const region = at ? (task.mode === 'world' ? views[slot]?.world?.regions?.find(r => r.bounds && at.x >= r.bounds[0] && at.z >= r.bounds[1] && at.x < r.bounds[2] && at.z < r.bounds[3])?.id ?? null : g.points.length ? g.points.reduce((best, point, i) => distance(at, point) < best.distance ? { i, distance: distance(at, point) } : best, { i: null, distance: Infinity }).i : null) : null;
          logs[slot].commands.push({ tick: g.tick, command: structuredClone(command), accepted: result === undefined,
            rejectionReason: typeof result === 'string' ? result : result === undefined ? null : 'unknown', locations, sourceLocations, region,
            resourcesBefore, resourcesAfter, ...(purchasePrice ? { purchasePrice } : {}),
            spend: { mp: resourcesBefore.mp - resourcesAfter.mp, fuel: resourcesBefore.fuel - resourcesAfter.fuel } });
          if (target && noticed[slot].has(target.id) && !reacted[slot].has(target.id) && result === undefined) { logs[slot].contactReactions.push((g.tick - noticed[slot].get(target.id)) * TICK); reacted[slot].add(target.id); }
          return result;
        };
        const opts = { level: task.level, view: views[slot], submit, inputLog: input => inputLog(slot, input), seed: task.seed };
        if (ai.humanCommander || (g.tick + slot * 13) % (ai.thinkEvery?.(task.level) ?? 40) === 0) ai.think(g, slot, opts);
        const diagnostic = ai.aiDiagnostics?.(g, slot);
        if (diagnostic?.production?.id != null && !recordedProduction[slot].has(diagnostic.production.id)) {
          recordedProduction[slot].add(diagnostic.production.id);
          (logs[slot].productionDecisions ??= []).push(structuredClone(diagnostic.production));
        }
        if (Array.isArray(diagnostic?.events)) {
          logs[slot].eventsRecorded = true; logs[slot].events ??= [];
          for (const event of diagnostic.events) {
            const key = eventKey(event);
            if (!recordedEvents[slot].has(key)) { logs[slot].events.push(structuredClone(event)); recordedEvents[slot].add(key); }
          }
        }
        if (diagnostic?.attention) {
          const key = `${diagnostic.attention.id}/${diagnostic.attention.since}`;
          if (attention[slot]?.key !== key) {
            if (attention[slot]) logs[slot].attentionDwellSeconds.push((g.tick - attention[slot].start) * TICK);
            if (attention[slot]?.visit) attention[slot].visit.endTick = g.tick;
            const visit = { ...diagnostic.attention, startTick: g.tick, endTick: null };
            logs[slot].attentionVisits.push(visit); attention[slot] = { key, start: g.tick, visit };
          }
        }
        for (const id of diagnostic?.screenIds ?? []) if (idle[slot].has(id) && !idleNoticed[slot].has(id)) { logs[slot].unnoticedIdleSeconds.push((g.tick - idle[slot].get(id)) * TICK); idleNoticed[slot].add(id); }
        if (g.tick % 20 === 0) {
          logs[slot].mp.push(p.mp);
          const active = new Set();
          for (const u of g.units.values()) if (u.owner === slot && u.hp > 0 && !sim.UNITS[u.type].structure && !u.air && !u.retreating && !u.build && !u.dig && !u.entrench && !u.targetId && !u.path.length && !u.amove && !u.orders.length) {
            active.add(u.id); if (!idle[slot].has(u.id)) { idle[slot].set(u.id, g.tick); idleNoticed[slot].delete(u.id); if (diagnostic?.screenIds?.includes(u.id)) { logs[slot].unnoticedIdleSeconds.push(0); idleNoticed[slot].add(u.id); } }
          }
          for (const [id, start] of idle[slot]) if (!active.has(id)) { logs[slot].idleSeconds.push((g.tick - start) * TICK); if (!idleNoticed[slot].has(id)) logs[slot].unnoticedIdleCensoredSeconds.push((g.tick - start) * TICK); idle[slot].delete(id); idleNoticed[slot].delete(id); }
        }
      });
      if (g.tick % 2 === 0 || g.winner !== null) { g.shots = []; g.newCells = []; }
    }
    const seconds = g.tick * TICK;
    logs.forEach((log, slot) => { for (const [id, start] of idle[slot]) { log.idleSeconds.push((g.tick - start) * TICK); if (!idleNoticed[slot].has(id)) log.unnoticedIdleCensoredSeconds.push((g.tick - start) * TICK); } if (attention[slot]) { log.attentionDwellSeconds.push((g.tick - attention[slot].start) * TICK); attention[slot].visit.endTick = g.tick; } });
    return { ...task, seconds: round(seconds), ended: g.winner !== null, winner: g.winner, seats: logs.map((log, slot) => ({ slot, faction: ['USA', 'Germany', 'USSR'][g.players[slot].faction], metrics: summarizeSeat(log, seconds, cameraSpan) })), ...(options.logs ? { logs } : {}) };
  } finally { Math.random = originalRandom; }
}
export function aggregate(results) {
  const groups = {};
  for (const mode of MODES) for (const level of LEVELS) {
    const matches = results.filter(r => r.mode === mode && r.level === level);
    if (!matches.length) continue;
    const seats = matches.flatMap(m => m.seats.map(s => s.metrics));
    const screenSpans = [...new Set(seats.map(s => s.crossMap.screenSpan))];
    const peakWindowStrideTicks = [...new Set(matches.flatMap(match => match.seats.map(seat => { const count = seat.metrics.commandAPM.windows10.count; return count > 1 ? Math.round((match.seconds / TICK - 10 / TICK) / (count - 1)) : null; })))];
    const openingsByFaction = {};
    for (const faction of ['USA', 'Germany', 'USSR']) {
      const openings = matches.flatMap(m => m.seats.filter(s => s.faction === faction).map(s => JSON.stringify(s.metrics.opening)));
      const purchaseOpenings = openings.map(o => JSON.stringify(JSON.parse(o).purchases));
      const purchaseCounts = Object.fromEntries([...new Set(purchaseOpenings)].map(s => [s, purchaseOpenings.filter(o => o === s).length]));
      const counts = Object.fromEntries([...new Set(openings)].map(s => [s, openings.filter(o => o === s).length]));
      openingsByFaction[faction] = { matches: openings.length, distinct: Object.keys(counts).length, mostCommonShare: round(Math.max(0, ...Object.values(counts)) / Math.max(1, openings.length)), counts, purchaseOnly: { distinct: Object.keys(purchaseCounts).length, mostCommonShare: round(Math.max(0, ...Object.values(purchaseCounts)) / Math.max(1, openings.length)), counts: purchaseCounts } };
    }
    const field = f => distribution(seats.map(f));
    const mandatory = seats.map(seat => seat.requiredScreenPopulation).filter(Boolean);
    const pooledSurvival = kind => {
      const samples = [];
      for (const population of mandatory) for (const row of population[kind].survival.curve) {
        for (let i = 0; i < row.observed; i++) samples.push({ seconds: row.seconds, observed: true });
        for (let i = 0; i < row.censored; i++) samples.push({ seconds: row.seconds, observed: false });
      }
      return kaplanMeier(samples);
    };
    const requiredScreenPopulation = mandatory.length ? {
      recordedSeats: mandatory.length, totalSeats: seats.length, policies: [...new Set(mandatory.flatMap(population => population.policies))],
      annotatedEvents: mandatory.reduce((n, population) => n + population.annotatedEvents, 0),
      unannotatedScreenEvents: seats.reduce((n, seat) => n + (seat.reactionEvents?.byType.screenNewContact.events ?? 0) + (seat.reactionEvents?.byType.screenHpDamage.events ?? 0), 0) - mandatory.reduce((n, population) => n + population.annotatedEvents, 0),
      requiredEvents: mandatory.reduce((n, population) => n + population.requiredEvents, 0), exemptEvents: mandatory.reduce((n, population) => n + population.exemptEvents, 0),
      firstAction: pooledSurvival('firstAction'), attemptedCommand: pooledSurvival('attemptedCommand'), acceptedCommand: pooledSurvival('acceptedCommand'),
      perSeatFirstActionKMMedianSeconds: field(seat => seat.requiredScreenPopulation?.firstAction.survival.medianSeconds),
      perSeatConditionalFirstActionMedianSeconds: field(seat => seat.requiredScreenPopulation?.firstAction.conditionalCompletedSeconds.median),
      reasons: Object.fromEntries([...new Set(mandatory.flatMap(population => Object.keys(population.reasons)))].map(reason => [reason, {
        required: mandatory.reduce((n, population) => n + (population.reasons[reason]?.required ?? 0), 0),
        exempt: mandatory.reduce((n, population) => n + (population.reasons[reason]?.exempt ?? 0), 0) }]))
    } : null;
    const alignments = seats.map(seat => seat.concernAlignment).filter(Boolean);
    const totals = (kind, keys) => Object.fromEntries(keys.map(key => [key, alignments.reduce((n, alignment) => n + (alignment[kind][key] ?? 0), 0)]));
    const concernAlignment = alignments.length ? { recordedSeats: alignments.length, totalSeats: seats.length,
      expansion: totals('expansion', ['commands', 'acceptedCommands', 'commandsToConcern', 'commandsToOther', 'commandsUnmeasured', 'acceptedCommandsToConcern', 'acceptedCommandsToOther', 'targets', 'alignedTargets', 'otherTargets', 'unmeasuredTargets']),
      idle: totals('idle', ['inputContextCycles', 'cyclesWithAnyCommand', 'cyclesWithNoCommand', 'cyclesIncludingIdleUnit', 'cyclesWithAcceptedIdleUnitCommand', 'cyclesWithCommandsForOtherUnitsOnly']),
      production: { ...totals('production', ['visits', 'visitsWithAttemptedPurchase', 'visitsWithAcceptedPurchase', 'attemptedPurchases', 'acceptedPurchases', 'rejectedPurchases', 'purchaseSpendMP', 'purchaseSpendFuel', 'allCommandSpendMP', 'allCommandSpendFuel', 'unmeasuredPurchaseSpend']),
        commandKinds: Object.fromEntries([...new Set(alignments.flatMap(alignment => Object.keys(alignment.production.commandKinds)))].map(kind => [kind, alignments.reduce((n, alignment) => n + (alignment.production.commandKinds[kind] ?? 0), 0)])),
        rejectionReasons: Object.fromEntries([...new Set(alignments.flatMap(alignment => Object.keys(alignment.production.rejectionReasons)))].map(reason => [reason, alignments.reduce((n, alignment) => n + (alignment.production.rejectionReasons[reason] ?? 0), 0)])) }
    } : null;
    if (requiredScreenPopulation) requiredScreenPopulation.causalAlignment = Object.fromEntries(['intendedResponseInputs', 'otherResponseInputs', 'missingIntentMetadataInputs', 'firstActionSelectionMatches', 'firstActionSelectionDiffers', 'firstActionSelectionUnmeasured'].map(key => [key, mandatory.reduce((n, population) => n + population.causalAlignment[key], 0)]));
    if (concernAlignment) {
      const planner = alignments.map(alignment => alignment.production.planner).filter(Boolean);
      concernAlignment.production.planner = planner.length ? { recordedSeats: planner.length, decisions: planner.reduce((n, item) => n + item.decisions, 0),
        proposedBuys: planner.reduce((n, item) => n + item.proposedBuys, 0), queuedBuys: planner.reduce((n, item) => n + item.queuedBuys, 0),
        reasons: Object.fromEntries([...new Set(planner.flatMap(item => Object.keys(item.reasons)))].map(reason => [reason, planner.reduce((n, item) => n + (item.reasons[reason] ?? 0), 0)])) } : null;
    }
    const reactionPopulations = seats.map(seat => seat.reactionEvents).filter(Boolean);
    const reactionEventPopulation = reactionPopulations.length ? { recordedSeats: reactionPopulations.length, totalSeats: seats.length, byType: Object.fromEntries(['screenNewContact', 'screenHpDamage', 'onScreenAlert', 'offScreenAlert', 'minimapContactExploratory', 'otherEventExploratory'].map(type => [type, { events: reactionPopulations.reduce((n, population) => n + population.byType[type].events, 0), firstActionAnswered: reactionPopulations.reduce((n, population) => n + population.byType[type].firstAction.answered, 0), firstActionUnanswered: reactionPopulations.reduce((n, population) => n + population.byType[type].firstAction.unanswered, 0), commandAnswered: reactionPopulations.reduce((n, population) => n + population.byType[type].attemptedCommand.answered, 0), commandUnanswered: reactionPopulations.reduce((n, population) => n + population.byType[type].attemptedCommand.unanswered, 0), acceptedCommandAnswered: reactionPopulations.reduce((n, population) => n + population.byType[type].acceptedCommand.answered, 0), acceptedCommandUnanswered: reactionPopulations.reduce((n, population) => n + population.byType[type].acceptedCommand.unanswered, 0) }])) } : null;
    groups[`${mode}/${level}`] = { requiredScreenPopulation, concernAlignment, reactionEventPopulation, reactionMeasurementVersion: seats.every(seat => seat.reactionMeasurementVersion === 2) ? 2 : 1, screenSpans, peakWindowStrideTicks, matches: matches.length, seats: seats.length, seconds: distribution(matches.map(r => r.seconds)), commandAPM: field(s => s.commandAPM.matchMean), physicalInputAPM: field(s => s.physicalInputAPM?.matchMean), commandAPM60WindowMean: field(s => s.commandAPM.windows60.mean), commandAPM10WindowPeak: field(s => s.commandAPM.windows10.max), physicalInputAPM60WindowMean: field(s => s.physicalInputAPM?.windows60.mean), physicalInputAPM10WindowPeak: field(s => s.physicalInputAPM?.windows10.max), maxCommandsPerTick: field(s => s.commandsPerTick.activeTickDistribution.max), firstOrderSeconds: field(s => s.firstOrderSeconds), firstBuySeconds: field(s => s.firstBuySeconds), firstAcceptedOrderSeconds: field(s => s.firstAcceptedOrderSeconds), firstAcceptedBuySeconds: field(s => s.firstAcceptedBuySeconds), onScreenFirstNonCameraActionMedianSeconds: field(s => s.reactionSeconds?.onScreen?.median), onScreenReactionMedianSeconds: field(s => s.reactionSeconds?.onScreen?.median), offScreenAlertFirstActionMedianSeconds: field(s => s.reactionSeconds?.offScreenAlert?.median), offScreenAlertReactionMedianSeconds: field(s => s.reactionSeconds?.offScreenAlert?.median), onScreenCommandReactionMedianSeconds: field(s => s.reactionCommandSeconds?.attempted?.onScreen?.median), offScreenAlertCommandReactionMedianSeconds: field(s => s.reactionCommandSeconds?.attempted?.offScreenAlert?.median), crossMapPairsWithinOneSecond: field(s => s.crossMap.commandPairsWithinOneSecond), cameraJumpsPerMinute: field(s => s.cameraJumpsPerMinute), dwellMedianSeconds: field(s => s.dwellSeconds?.median), actionsPerCycleMedian: field(s => s.actionsPerCycle?.median), floatingMPMean: field(s => s.floatingMP.mean), idleMedianSeconds: field(s => (s.idleSeconds ?? s.unnoticedIdleSeconds)?.median), unnoticedIdleMedianSeconds: field(s => s.unnoticedIdleSeconds?.median), openingsByFaction };
  }
  return groups;
}
export function fitTiming(inputs) {
  const groups = {};
  const ordered = [...inputs].sort((a, b) => String(a.seat ?? a.slot ?? 0).localeCompare(String(b.seat ?? b.slot ?? 0)) || a.tick - b.tick);
  const previous = new Map(), keyIntervals = [];
  for (const input of ordered) {
    const seat = input.seat ?? input.slot ?? 0;
    const old = previous.get(seat); previous.set(seat, input);
    if (!old || input.tick < old.tick) continue;
    const interval = (input.tick - old.tick) * TICK;
    if (old.kind === 'key' && input.kind === 'key' && interval > 0 && interval <= 0.5) keyIntervals.push(interval);
    const key = `${old.kind}->${input.kind}`;
    (groups[key] ??= []).push((input.tick - old.tick) * TICK);
  }
  const keyStats = distribution(keyIntervals);
  const calibration = keyIntervals.length >= 5 ? { key: [keyStats.p10, keyStats.p90] } : {};
  return { calibration, keyIntervalSamples: keyStats, calibrationMethod: 'Fits key timing only from at least five positive consecutive key gaps of at most 0.5 seconds. These gaps can include decision time. Reaction, pointer and error parameters require measurements absent from ordinary recorder logs.', method: 'Empirical quantiles and log-normal moments of positive inter-input seconds. Zero gaps remain in counts.', transitions: Object.fromEntries(Object.entries(groups).map(([kind, values]) => {
    const logs = values.filter(v => v > 0).map(Math.log), mu = logs.reduce((a, b) => a + b, 0) / logs.length;
    return [kind, { ...distribution(values), logNormal: logs.length ? { mu: round(mu), sigma: round(Math.sqrt(logs.reduce((n, v) => n + (v - mu) ** 2, 0) / logs.length)), positiveSamples: logs.length } : null }];
  })), reactions: null, reactionUnavailableReason: 'Reaction fitting requires an independently recorded stimulus population; ordinary human recorder files do not capture one.' };
}
async function readLog(path) {
  if ((await stat(path)).isDirectory()) {
    const files = (await readdir(path)).filter(file => file.endsWith('.jsonl')).sort();
    if (!files.length) throw Error('No JSONL recordings found in the input directory.');
    return (await Promise.all(files.map(file => readLog(resolve(path, file))))).flat();
  }
  const text = await readFile(path, 'utf8');
  let value; try { value = JSON.parse(text); } catch { value = text.trim().split('\n').map(line => JSON.parse(line)); }
  return value;
}
function seedList(text) {
  if (/^\d+$/.test(text)) return Array.from({ length: Number(text) }, (_, i) => i + 1);
  const list = text.split(',').flatMap(part => { const range = /^(\d+)-(\d+)$/.exec(part); return range ? Array.from({ length: +range[2] - +range[1] + 1 }, (_, i) => +range[1] + i) : [+part]; });
  if (!list.length || list.some(n => !Number.isSafeInteger(n) || n < 0 || n > 0xffffffff)) throw Error('Seeds must be uint32 values, a count, or comma-separated ranges.');
  return [...new Set(list)];
}
function compareReports(before, after, path) {
  const summary = {};
  for (const [group, current] of Object.entries(after.summary)) {
    const old = before.summary?.[group];
    if (!old) continue;
    const delta = {};
    const comparableSpatial = digest(old.screenSpans ?? []) === digest(current.screenSpans ?? []);
    const comparableReactions = old.reactionMeasurementVersion === current.reactionMeasurementVersion;
    const comparablePeakWindows = digest(old.peakWindowStrideTicks ?? []) === digest(current.peakWindowStrideTicks ?? []);
    for (const [metric, values] of Object.entries(current)) {
      if (!values || typeof values !== 'object' || !Object.hasOwn(values, 'median')) continue;
      delta[metric] = { comparable: (metric !== 'crossMapPairsWithinOneSecond' || comparableSpatial) && (!metric.includes('10WindowPeak') || comparablePeakWindows) && (!(metric.includes('Reaction') || metric.includes('FirstNonCameraAction') || metric === 'offScreenAlertFirstActionMedianSeconds') || comparableReactions), beforeMedian: old[metric]?.median ?? null, afterMedian: values.median, medianChange: Number.isFinite(old[metric]?.median) && Number.isFinite(values.median) ? round(values.median - old[metric].median) : null, beforeMean: old[metric]?.mean ?? null, afterMean: values.mean };
    }
    summary[group] = delta;
  }
  const keys = ['seconds', 'map', 'army', 'worldSize', 'screenSpan'];
  return { before: path, compatibleConfiguration: keys.every(k => before.configuration?.[k] === after.configuration?.[k]) && after.results.every(r => before.results?.some(b => b.mode === r.mode && b.level === r.level && b.seed === r.seed)), summary };
}
async function main() {
  const options = { mode: 'conquest', level: 'normal', seeds: '20', seconds: 180, workers: 2, map: 'default', legacy: false, logs: false, screenSpan: DEFAULT_SCREEN_SPAN, out: 'docs/ai-humanity-after.json' };
  for (let i = 2; i < process.argv.length; i++) {
    const key = process.argv[i].slice(2);
    if (['legacy', 'logs'].includes(key)) { options[key] = true; continue; }
    if (!['mode', 'level', 'seeds', 'seconds', 'workers', 'map', 'out', 'compare', 'human-log', 'fit', 'screen-span', 'merge', 'package', 'archive'].includes(key) || !process.argv[i + 1]) throw Error('Usage: node tools/ai-humanity.mjs [--seeds N|1,3,8-10] [--mode conquest|classic|world|all] [--level easy|normal|hard|all] [--legacy] [--seconds N] [--workers N] [--out FILE] [--compare FILE] [--human-log FILE] [--fit FILE] [--logs] [--screen-span METRES] [--package FULL_REPORT --archive FILE.json.gz --out COMPACT_REPORT]');
    options[key] = process.argv[++i];
  }
  options.seconds = Number(options.seconds); options.workers = Number(options.workers); options.screenSpan = Number(options['screen-span'] ?? options.screenSpan);
  if (!Number.isFinite(options.seconds) || options.seconds < 1 || !Number.isSafeInteger(options.workers) || options.workers < 1 || !Number.isFinite(options.screenSpan) || options.screenSpan <= 0) throw Error('Seconds, workers and screen span must be positive.');
  if (options.package) {
    if (!options.archive) throw Error('--package requires --archive FILE.json.gz.');
    const report = await packageReport(options.package, options.out, options.archive);
    console.log(JSON.stringify({ source: report.source, matches: report.results.length, evidenceArchive: report.evidenceArchive }, null, 2)); return;
  }
  if (options.archive) throw Error('--archive requires --package FULL_REPORT.');
  if (options.merge) {
    const reports = await Promise.all(options.merge.split(',').map(path => readLog(path)));
    if (reports.some(r => r.source !== reports[0].source)) throw Error('Cannot merge different commander sources.');
    const results = reports.flatMap(r => r.results);
    for (const result of results) for (const seat of result.seats) if (!seat.metrics.idleSeconds && seat.metrics.unnoticedIdleSeconds) { seat.metrics.idleSeconds = seat.metrics.unnoticedIdleSeconds; seat.metrics.unnoticedIdleSeconds = null; }
    const seen = new Set();
    for (const result of results) { const key = `${result.mode}/${result.level}/${result.seed}`; if (seen.has(key)) throw Error(`Duplicate match in merged reports: ${key}`); seen.add(key); }
    const report = { ...reports[0], sourceCheckpoints: Object.assign({}, ...reports.map(r => r.sourceCheckpoints ?? {})), configuration: { ...reports[0].configuration, modes: [...new Set(results.map(r => r.mode))], levels: [...new Set(results.map(r => r.level))], seedsByMode: Object.fromEntries(MODES.filter(m => results.some(r => r.mode === m)).map(mode => [mode, [...new Set(results.filter(r => r.mode === mode).map(r => r.seed))]])) }, elapsedSeconds: round(reports.reduce((n, r) => n + r.elapsedSeconds, 0)), summary: aggregate(results), results };
    delete report.configuration.seeds;
    report.definitionsByMode = Object.fromEntries(reports.flatMap(r => r.configuration.modes.map(mode => [mode, r.definitions])));
    const spansByMode = Object.fromEntries(MODES.filter(mode => results.some(r => r.mode === mode)).map(mode => [mode, [...new Set(results.filter(r => r.mode === mode).flatMap(r => r.seats.map(s => s.metrics.crossMap.screenSpan)))]]));
    report.configuration.screenSpanByMode = spansByMode;
    const spans = [...new Set(Object.values(spansByMode).flat())];
    report.configuration.screenSpan = spans.length === 1 ? spans[0] : null;
    if (options.compare) report.comparison = compareReports(await readLog(options.compare), report, options.compare);
    await writeFile(resolve(options.out), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ source: report.source, matches: results.length, summary: report.summary }, null, 2)); return;
  }
  if (options['human-log'] || options.fit) {
    const value = await readLog(options['human-log'] ?? options.fit);
    const rows = Array.isArray(value) ? value : value.inputs ?? value.logs?.flatMap(l => l.inputs ?? []) ?? [];
    const groups = new Map();
    for (const row of rows) {
      if (!Number.isSafeInteger(row.tick) || row.tick < 0 || typeof row.kind !== 'string') throw Error('Recorded inputs need nonnegative integer ticks and kind labels.');
      const key = `${row.room ?? ''}/${row.matchId ?? 'match'}/${row.slot ?? row.seat ?? 0}`;
      const input = { ...row, countsAPM: row.countsAPM ?? (row.kind !== 'beat' && !(row.actor === 'human' && row.kind === 'command')) };
      (groups.get(key) ?? (groups.set(key, []), groups.get(key))).push(input);
    }
    const recordings = [...groups].map(([seat, inputs]) => {
      const seconds = Number(value.seconds ?? Math.max(1, ...inputs.map(i => i.tick)) * TICK);
      const commands = inputs.filter(i => i.kind === 'command' || i.command).map(i => ({ ...i, command: i.command ?? { t: i.commandKind ?? 'unknown' }, locations: validPoint(i.target) ? [i.target] : [] }));
      return { seat, seconds, metrics: summarizeSeat({ commands, inputs }, seconds, options.screenSpan), timingFit: fitTiming(inputs.filter(i => i.countsAPM !== false)) };
    });
    const report = { schemaVersion: 1, source: 'recorded-human', recordings, timingFit: fitTiming(rows.filter(i => i.kind !== 'beat' && !(i.actor === 'human' && i.kind === 'command')).map(i => ({ ...i, seat: `${i.room ?? ''}/${i.matchId ?? 'match'}/${i.slot ?? i.seat ?? 0}` }))) };
    report.calibration = report.timingFit.calibration;
    await writeFile(resolve(options.out), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2)); return;
  }
  const modes = options.mode === 'all' ? MODES : [options.mode], levels = options.level === 'all' ? LEVELS : [options.level];
  if (modes.some(m => !MODES.includes(m)) || levels.some(l => !LEVELS.includes(l))) throw Error('Unknown mode or difficulty.');
  const seeds = seedList(options.seeds); if (!seeds.length) throw Error('At least one seed is required.');
  const tasks = modes.flatMap(mode => levels.flatMap(level => seeds.map(seed => ({ mode, level, seed }))));
  const results = [], workers = [], sourceCheckpoints = {}; const started = performance.now();
  try {
    await Promise.all(Array.from({ length: Math.min(options.workers, tasks.length) }, (_, index) => new Promise((done, fail) => {
      const worker = new Worker(script, { workerData: { options, tasks: tasks.filter((_, i) => i % options.workers === index) } }); workers.push(worker);
      worker.on('message', result => { if (result.type === 'sourceCheckpoint') { sourceCheckpoints[result.checkpoint.sha256] = result.checkpoint; return; } results.push(result); process.stderr.write(`${result.mode}/${result.level} seed ${result.seed}: ${results.length}/${tasks.length}\n`); });
      worker.on('error', fail); worker.on('exit', code => code ? fail(Error(`Worker exited ${code}`)) : done());
    })));
  } catch (error) { await Promise.all(workers.map(w => w.terminate())); throw error; }
  results.sort((a, b) => MODES.indexOf(a.mode) - MODES.indexOf(b.mode) || LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level) || a.seed - b.seed);
  const summary = aggregate(results);
  const report = { schemaVersion: 1, source: options.legacy ? 'legacy-5293ddb' : 'current', configuration: { modes, levels, seeds, seconds: options.seconds, map: options.map, army: 'standard', worldSize: 'huge', screenSpan: options.screenSpan }, definitions: {
    commandAPM: 'Every submitted simulation command, including rejected attempts. A command can contain several unit orders. This is not physical input APM.', physicalInputAPM: 'Logged motor inputs with countsAPM other than false. Null when the commander does not emit physical input records.',
    firstOrder: 'First submitted command other than buy, stance or recover.', reactionSeconds: 'Version2: screen-contact and screen-damage events are stamped by perception at creation. On-screen first action (screen contact, screen damage, or an alert stamped on screen at creation) excludes camera inputs. Off-screen alerts allow a camera input as the first action. Actual attempted and accepted commands are reported separately. Minimap contacts are exploratory and excluded from both reaction gates. Missing event-population instrumentation yields null; historical logs retain their original definitions.',
    requiredScreenPopulation: 'Prospective annotations only. screen-v1 requires a novel hostile contact with an idle controllable ground combat unit within 45 metres, or damage of at least 25% maximum health, or crossing the fixed retreat risk (health below 35%, last model in a multi-model squad, or suppression at least 90 with health below 60%) without already retreating. All levels use the same rule. Source-proven automatic retreat and active firing exempt already handled events at creation; firing never exempts current retreat risk. Record every required and exempt reason at perception time, including unknown-home fallbacks that remain required. Alerts and minimap contacts have no required-population policy. First completed non-camera response requires intended actors in responseUnits or an explicit support target within 24 metres. Required unanswered events remain in Kaplan-Meier survival; an unidentified population median is null. Conditional completed medians alone cannot certify the gate. Historical events are never retrospectively classified.',
    concernAlignment: 'Actual expansion command targets within 20 metres of the delivered point or node concern. Idle input-context cycles count whether an actual attempted or accepted command includes the idle unit. Diagnostic attention visits use their own denominator. Production records actual own resource spending, rejection reasons, and explicit planner decisions; missing planner reasons remain unmeasured.',
    crossMap: 'Pairs of spatial commands no more than one second apart with target positions farther apart than screenSpan; commands without positions use addressed unit locations. Also reports quarter-second pairs and one command addressing multiple regions.',
    screenSpan: '113 metres by default, rounded up from cameraFootprint at HUMAN_CAMERA distance60: 112.876 metres at1920x1080, FOV42, pitch0.95. The camera faces the map centre for each seat; rotating the footprint preserves its maximum edge width. This constant derives from shared/ai-perception.js, not measurements fitted to the bot. Historical baseline span160 is retained and marked spatially incomparable. The distance threshold is a spatial proxy, not a full camera-locality proof.', reactionPopulation: 'All diagnostic.events are collected each tick before bounded history eviction. Answered and unanswered counts are reported per event type and response kind. Unanswered durations are right-censored at the recording end and never included as completed reaction samples. A stimulus may need no new input, for example while units already fire automatically, so unanswered counts are not an error rate.',
    dwell: 'Measured attention residence from diagnostics, including silence. cycleInputSpanSeconds separately measures first-to-last input time for logged cycle IDs.',
    idle: 'Idle episodes sampled each second. Unnoticed idle is the delay until an idle unit next appears in diagnostic screenIds or receives a command. Units idle on capture points may be holding intentionally; screen visibility is a notice proxy, not proof of awareness. Episodes ending without a notice are reported separately as censored lower bounds.', opening: 'First five purchases and first three move target regions in the first 45 seconds, grouped by faction.', windows: 'Full non-overlapping 60-second windows and 10-second windows sliding every simulation tick, including quiet windows.',
  }, elapsedSeconds: round((performance.now() - started) / 1000), sourceCheckpoints, summary, results };
  if (options.compare) { const before = JSON.parse(await readFile(resolve(options.compare), 'utf8')); report.comparison = compareReports(before, report, options.compare); }
  await writeFile(resolve(options.out), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify({ source: report.source, elapsedSeconds: report.elapsedSeconds, summary }, null, 2));
}
if (!isMainThread) { const checkpoint = await sourceCheckpoint(workerData.options.legacy); parentPort.postMessage({ type: 'sourceCheckpoint', checkpoint }); for (const task of workerData.tasks) { const result = await runMatch(workerData.options, task); result.sourceCheckpointSHA256 = checkpoint.sha256; parentPort.postMessage(result); } }
else if (process.argv[1] && resolve(process.argv[1]) === script) await main();
