import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { verifyArchive } from '/tmp/human-ai-final-v16-v4-preparation/archive-check.mjs';

const dir = '/tmp/human-ai-final-v16';
const plan = JSON.parse(await readFile('/tmp/human-ai-v16-campaign-predeclared.json', 'utf8'));
const progress = JSON.parse(await readFile(`${dir}/progress-conquest.json`, 'utf8'));
assert.equal(progress.completed, 60, 'Conquest fixed population is incomplete');
const manifest = JSON.parse(await readFile(`${dir}/conquest-raw-manifest.json`, 'utf8'));
const sourceHash = async path => ({ sha256: createHash('sha256').update(await readFile(path)).digest('hex') });
await verifyArchive(plan.sourceArchiveDirectory, plan.sourceManifest, sourceHash);
assert.equal(manifest.length, 60);
const report = { results: await Promise.all(manifest.map(async row => JSON.parse(await readFile(`${dir}/compact-spool/${row.mode}-${row.level}-${row.seed}.json`, 'utf8')))) };
assert.equal(report.results.reduce((n, result) => n + result.seats.length, 0), 180);

const modes = [['conquest', 20]], levels = ['easy', 'normal', 'hard'];
const pairs = new Set(modes.flatMap(([mode, count]) => levels.flatMap(level =>
  Array.from({ length: count }, (_, i) => `${mode}/${level}/${i + 1}`))));
const key = row => `${row.mode}/${row.level}/${row.seed}`;
assert.deepEqual(new Set(report.results.map(key)), pairs);
assert.deepEqual(new Set(manifest.map(key)), pairs);
const byPair = new Map(report.results.map(row => [key(row), row]));
const coverageIssues = [];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const median = values => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b), n = sorted.length;
  return n ? (sorted[(n - 1) >> 1] + sorted[n >> 1]) / 2 : null;
};
const band = (value, bounds) => !Number.isFinite(value) ? 'not-evaluable'
  : value >= bounds[0] && value <= bounds[1] ? 'pass' : 'fail';
const family = unit => ({
  rifle: 'infantry', conscript: 'infantry', mg: 'machineGun', mortar: 'mortar',
  at: 'antiTank', engineer: 'engineer',
})[unit] ?? unit ?? null;
const physical = input => input.countsAPM !== false && input.kind !== 'beat'
  && !(input.actor === 'human' && input.kind === 'command');
const round = value => Math.round(value * 1000) / 1000;
function maxTenSecondAPM(inputs, seconds) {
  const ticks = inputs.map(row => row.tick).sort((a, b) => a - b);
  const endTick = Math.round(seconds * 20), width = 200;
  let left = 0, right = 0, max = 0;
  for (let start = 0; start + width <= endTick; start++) {
    while (left < ticks.length && ticks[left] <= start) left++;
    while (right < ticks.length && ticks[right] <= start + width) right++;
    max = Math.max(max, (right - left) * 6);
  }
  return max;
}
function pooledKM(samples) {
  const rows = [...samples].sort((a, b) => a.seconds - b.seconds);
  let atRisk = rows.length, survival = 1, index = 0;
  while (index < rows.length) {
    const time = rows[index].seconds;
    let observed = 0, censored = 0;
    while (index < rows.length && rows[index].seconds === time) {
      if (rows[index].observed) observed++; else censored++;
      index++;
    }
    if (atRisk) survival *= 1 - observed / atRisk;
    if (survival <= .5) return round(time);
    atRisk -= observed + censored;
  }
  return null;
}
const groups = Object.fromEntries(modes.flatMap(([mode]) => levels.map(level =>
  [`${mode}/${level}`, { seats: [], samples: [], originalSamples: [], opening: Object.fromEntries(['USA', 'Germany', 'USSR'].map(f => [f, []])) }])));
const retained = [];
for (const item of manifest) {
  const archive = await readFile(item.gzipFile), raw = gunzipSync(archive);
  assert.equal(sha(archive), item.gzip.sha256, key(item));
  assert.equal(sha(raw), item.raw.sha256, key(item));
  assert.equal(raw.length, item.raw.bytes, key(item));
  const match = JSON.parse(raw), compact = byPair.get(key(item));
  assert.equal(match.sourceCheckpointSHA256, plan.expectedRuntimeCheckpointSHA256);
  assert.equal(match.seats.length, 3);
  assert.equal(match.seconds, compact.seconds);
  for (const seat of match.seats) {
    const metric = seat.metrics, log = match.logs[seat.slot], group = groups[`${match.mode}/${match.level}`];
    assert.deepEqual(metric, compact.seats[seat.slot].metrics);
    const inputs = log.inputs.filter(physical);
    const windows60 = [];
    for (let start = 0; start + 1200 <= Math.round(match.seconds * 20); start += 1200)
      windows60.push(inputs.filter(input => input.tick > start && input.tick <= start + 1200).length);
    const apm60Mean = windows60.length ? round(windows60.reduce((a, b) => a + b, 0) / windows60.length) : null;
    assert.equal(apm60Mean, metric.physicalInputAPM?.windows60?.mean ?? null);
    const peak = maxTenSecondAPM(inputs, match.seconds);
    assert.equal(peak, metric.physicalInputAPM?.windows10?.max ?? 0);
    const orders = log.commands.filter(row => !['buy', 'stance', 'recover'].includes(row.command.t));
    const firstOrderSeconds = orders.length ? round(orders[0].tick / 20) : null;
    assert.equal(firstOrderSeconds, metric.firstOrderSeconds);
    const acceptedPurchases = log.commands.filter(row => row.accepted === true && row.command.t === 'buy' && row.tick <= 900)
      .slice(0, 5).map(row => family(row.command.unit));
    group.opening[seat.faction].push({ seed: match.seed, slot: seat.slot, sequence: acceptedPurchases });
    const score = metric.manualResponsePolicy;
    const stream = log.manualMeasurements;
    const issues = [];
    if (stream?.schema !== 'ww2-public-manual-response-v2' || stream?.policy !== 'screen-manual-v2') issues.push('missing-or-mismatched-public-manual-stream');
    if (stream?.startedTick !== 0 || stream?.operationLinksRecorded !== true) issues.push('incomplete-manual-capture');
    if (score?.physicalEndpointKnown !== true || log.physicalInputsRecorded !== true || !Array.isArray(log.events)) issues.push('native-physical-or-creation-endpoint-unknown');
    if (score.unknownEvents !== 0 || score.audit.inconsistentClassifications !== 0 || score.audit.missingCreationProofs !== 0) issues.push('unknown-or-inconsistent-manual-creation');
    if (score.requiredEvents > 0 && score.evaluable !== true) issues.push('positive-population-not-evaluable');
    if (issues.length) coverageIssues.push({ mode: match.mode, level: match.level, seed: match.seed, slot: seat.slot, issues });
    assert.equal(score.policy, 'screen-manual-v2');
    assert.equal(score.creationEvents, score.rows.length);
    assert.equal(score.requiredEvents, score.rows.filter(row => row.decision === 'required').length);
    assert.equal(score.unknownEvents, score.rows.filter(row => row.decision === 'unknown').length);
    for (const row of score.rows) if (row.decision === 'required') {
      const tick = row.answer?.firstActionTick, observed = tick != null;
      const seconds = ((observed ? tick : Math.round(match.seconds * 20)) - row.creation.tick) / 20;
      group.samples.push({ seconds, observed });
    }
    const ownSamples = score.rows.filter(row => row.decision === 'required').map(row => {
      const tick = row.answer?.firstActionTick;
      return { seconds: ((tick ?? Math.round(match.seconds * 20)) - row.creation.tick) / 20, observed: tick != null };
    });
    assert.equal(pooledKM(ownSamples), score.firstCompletedAction.survival.medianSeconds, key(item));
    const privateFrames = log.perceptionMeasurements?.frames ?? [];
    const originalNewCreations = new Set(privateFrames.flatMap(frame => frame.original?.newEvents ?? [])
      .filter(event => event?.id != null).map(event => `${event.id}/${event.tick}`)).size;
    const originalHistoryCreations = new Set(privateFrames.flatMap(frame => frame.original?.events ?? [])
      .filter(event => event?.id != null).map(event => `${event.id}/${event.tick}`)).size;
    for (const row of metric.requiredScreenPopulation?.firstAction?.survival?.curve ?? []) {
      for (let i = 0; i < row.observed; i++) group.originalSamples.push({ seconds: row.seconds, observed: true });
      for (let i = 0; i < row.censored; i++) group.originalSamples.push({ seconds: row.seconds, observed: false });
    }
    group.seats.push({ mode: match.mode, level: match.level, seed: match.seed, slot: seat.slot, faction: seat.faction,
      seconds: match.seconds, apm60Mean, peakAPM10: peak, firstOrderSeconds, commandsPerTickMax: metric.commandsPerTick.activeTickDistribution.max,
      quarterSecondCrossScreenPairs: metric.crossMap.commandPairsWithinQuarterSecond,
      manualCreation: score.creationEvents, manualRequired: score.requiredEvents, manualUnknown: score.unknownEvents,
      manualEvaluable: score.evaluable, originalRequired: metric.requiredScreenPopulation?.requiredEvents ?? null,
      originalNewCreations, originalHistoryCreations,
      originalOracleCoverage: metric.measurementPolicyComparison?.coverage?.originalFromMatchStart ?? null,
      originalOracleKM: metric.requiredScreenPopulation?.firstAction?.survival?.medianSeconds ?? null });
  }
  retained.push({ mode: match.mode, level: match.level, seed: match.seed, seconds: match.seconds, rawBytes: raw.length });
}
const output = { status: 'CONQUEST_RECEIVER_VERIFIED_PACKAGING_PENDING_RETAINING_ALL_FAILURES', sourceCheckpointSHA256: plan.expectedRuntimeCheckpointSHA256,
  matches: retained.length, seats: 180, bounds: plan.bounds, campaignVerification: 'All Conquest per-match raw receiver checks passed. Mode packaging, Classic/World and final merged verification remain pending.', groups: {}, retained };
for (const [name, data] of Object.entries(groups)) {
  const level = name.split('/')[1], b = plan.bounds[level], manualMedian = pooledKM(data.samples),
    required = data.seats.reduce((n, seat) => n + seat.manualRequired, 0),
    unknown = data.seats.reduce((n, seat) => n + seat.manualUnknown, 0),
    seatMeans = data.seats.map(seat => seat.apm60Mean),
    apm60 = median(seatMeans) === null ? null : round(median(seatMeans)), peak = Math.max(...data.seats.map(seat => seat.peakAPM10)),
    first = data.seats.map(seat => seat.firstOrderSeconds).filter(Number.isFinite),
    opening = Object.fromEntries(Object.entries(data.opening).map(([faction, rows]) => {
      const sequences = rows.map(row => JSON.stringify(row.sequence));
      const counts = Object.fromEntries([...new Set(sequences)].map(value => [value, sequences.filter(row => row === value).length]));
      const largest = Math.max(0, ...Object.values(counts));
      return [faction, { seats: rows.length, distinct: Object.keys(counts).length, largestShare: rows.length ? largest / rows.length : null,
        gate: rows.length >= 20 ? Object.keys(counts).length >= 3 && largest / rows.length <= .5 ? 'pass' : 'fail' : 'not-evaluable-less-than-20-seeds', counts }];
    }));
  assert.equal(data.samples.length, required, name);
  const originalRequired = data.seats.reduce((n, seat) => n + (seat.originalRequired ?? 0), 0);
  const originalMedian = pooledKM(data.originalSamples);
  assert.equal(data.originalSamples.length, originalRequired, name);
  const allCovered = data.seats.every(seat => seat.manualUnknown === 0 && (seat.manualRequired === 0 || seat.manualEvaluable === true));
  const groupCaptureIssues = coverageIssues.filter(row => `${row.mode}/${row.level}` === name);
  const groupPolicyIssues = [
    ...(required > 0 ? [] : ['zero-or-unknown-required-population']),
    ...(unknown === 0 ? [] : ['unknown-group-creations']),
    ...(manualMedian !== null ? [] : ['unidentified-firstCompletedAction-KM']),
  ];
  const manualStatus = allCovered && groupCaptureIssues.length === 0 && groupPolicyIssues.length === 0 && required > 0 && manualMedian !== null
    ? band(manualMedian, b.screen) : 'not-evaluable';
  output.groups[name] = { matches: 20, seats: data.seats.length,
    manual: { creationEvents: data.seats.reduce((n, seat) => n + seat.manualCreation, 0), requiredEvents: required, unknownEvents: unknown,
      answered: data.samples.filter(row => row.observed).length, censored: data.samples.filter(row => !row.observed).length,
      pooledKMSeconds: manualMedian, status: manualStatus, captureIssues: groupCaptureIssues, policyIssues: groupPolicyIssues, zeroExposureSeats: data.seats.filter(seat => seat.manualRequired === 0).length },
    originalOracle: { requiredEvents: originalRequired, answered: data.originalSamples.filter(row => row.observed).length,
      censored: data.originalSamples.filter(row => !row.observed).length,
      pooledKMSeconds: originalMedian,
      rawNewCreationEvents: data.seats.reduce((n, seat) => n + seat.originalNewCreations, 0),
      capturedHistoryCreationEvents: data.seats.reduce((n, seat) => n + seat.originalHistoryCreations, 0),
      missingStartCoverageSeats: data.seats.filter(seat => seat.originalOracleCoverage !== true).length,
      status: data.seats.some(seat => seat.originalNewCreations > seat.originalHistoryCreations) ? 'frozen-scorer-instrumentation-gap'
        : originalRequired ? 'historical-diagnostic-retained' : 'not-evaluable-zero-original-population' },
    physicalAPM60SeatMeanMedian: apm60, physicalAPMStatus: band(apm60, b.physicalAPM60),
    peakAPM10: peak, peakStatus: peak <= b.peakAPM10 ? 'pass' : 'fail',
    firstOrderMinimum: first.length ? Math.min(...first) : null, firstOrderMaximum: first.length ? Math.max(...first) : null,
    firstOrderStatus: first.length === data.seats.length && Math.min(...first) >= b.opening[0] && Math.max(...first) <= b.opening[1] ? 'pass' : 'fail',
    maxCommandsPerTick: Math.max(...data.seats.map(seat => seat.commandsPerTickMax ?? 0)),
    quarterSecondCrossScreenPairs: data.seats.reduce((n, seat) => n + seat.quarterSecondCrossScreenPairs, 0),
    offScreenStatus: 'not-evaluable-no-required-alert-population', opening };
}
for (const item of manifest) {
  const archive = await readFile(item.gzipFile), raw = gunzipSync(archive);
  assert.equal(sha(archive), item.gzip.sha256, `${key(item)} after`);
  assert.equal(sha(raw), item.raw.sha256, `${key(item)} after`);
  assert.equal(raw.length, item.raw.bytes, `${key(item)} after`);
}
await verifyArchive(plan.sourceArchiveDirectory, plan.sourceManifest, sourceHash);
await writeFile(`${dir}/independent-conquest-direct-gates.json`, JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify(Object.fromEntries(Object.entries(output.groups).map(([name, row]) => [name, {
  manualKM: row.manual.pooledKMSeconds, manual: row.manual.status, required: row.manual.requiredEvents,
  unknown: row.manual.unknownEvents, apm60: row.physicalAPM60SeatMeanMedian, apm: row.physicalAPMStatus,
  peak: row.peakStatus, opening: row.firstOrderStatus,
}]))));
