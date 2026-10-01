// Pure timing history and per-room snapshot interval control. Durations are milliseconds.
const PHASES = ['tick', 'step', 'think', 'snapshot', 'snapshotBuild', 'snapshotStringify'];
const ring = (size) => ({ values: new Float64Array(size), next: 0, count: 0 });
const add = (r, value) => { r.values[r.next] = value; r.next = (r.next + 1) % r.values.length; r.count = Math.min(r.count + 1, r.values.length); };
const percentiles = (r) => {
  if (!r.count) return { p50: 0, p95: 0 };
  const sorted = Array.from(r.values.subarray(0, r.count)).sort((a, b) => a - b);
  return { p50: sorted[Math.ceil(r.count * 0.5) - 1], p95: sorted[Math.ceil(r.count * 0.95) - 1] };
};

export function createTickMeter(options = {}) {
  const { size = 200, snapshotSize = 50, budget = 40, recovery = 24, recoverFor = 10_000, checkEvery = 1000, minSamples = 10, now = 0 } = options;
  return { budget, recovery, recoverFor, checkEvery, minSamples, snapEvery: 2, nextCheck: now + checkEvery,
    lowSince: null, nextLog: now + 30_000, phases: Object.fromEntries(PHASES.map(p => [p, ring(size)])), snapshotTicks: ring(snapshotSize) };
}

export function tickStats(meter) {
  return { ...Object.fromEntries(PHASES.map(p => [p, percentiles(meter.phases[p])])), snapshotTick: percentiles(meter.snapshotTicks) };
}

export function recordTick(meter, sample, now) {
  for (const phase of PHASES) {
    if (phase.startsWith('snapshot') && !sample.sent) continue;
    add(meter.phases[phase], sample[phase] ?? 0);
  }
  if (sample.sent) add(meter.snapshotTicks, sample.tick);
  if (now < meter.nextCheck || meter.snapshotTicks.count < meter.minSamples) return meter.snapEvery;
  meter.nextCheck = now + meter.checkEvery;
  const p95 = percentiles(meter.snapshotTicks).p95;
  // Leave 10 ms of the 50 ms tick for room iteration, socket work and scheduling.
  if (p95 > meter.budget) {
    meter.snapEvery = Math.min(4, meter.snapEvery + 1);
    meter.lowSince = null;
  } else if (p95 < meter.recovery) {
    meter.lowSince ??= now;
    if (meter.snapEvery > 2 && now - meter.lowSince >= meter.recoverFor) {
      meter.snapEvery--;
      meter.lowSince = now;
    }
  } else meter.lowSince = null;
  return meter.snapEvery;
}
