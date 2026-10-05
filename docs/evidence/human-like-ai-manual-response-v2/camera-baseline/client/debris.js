// Interpolate delivered poses. Reconnects start at the current pose without replaying motion or impacts.
export function createDebrisView({ pose = () => {}, remove = () => {}, contact = () => {} } = {}) {
  const bodies = new Map(), events = new Set();
  let tick = -1, arrival = 0, duration = 0.1;
  function snapshot(s, clock = performance.now() / 1000) {
    if (s.tick < tick) return;
    duration = tick >= 0 ? Math.max(0.05, Math.min(0.2, (s.tick - tick) / 20)) : 0.1;
    tick = s.tick; arrival = clock;
    const keep = new Set(), rows = [...(s.falling ?? []), ...(s.wrecks ?? []).flatMap(w => w[6] ? [{ ...w[6], wreckId: w[0], hullDir: w[5] }] : [])];
    for (const row of rows) {
      const old = bodies.get(row.id);
      bodies.set(row.id, { previous: old?.current ?? row, current: row }); keep.add(row.id);
      if (!old) pose(row.id, row);
    }
    for (const id of bodies.keys()) if (!keep.has(id)) { bodies.delete(id); remove(id); }
    for (const sh of s.shots ?? []) {
      if (sh.k !== 'collapse' || !sh.id || events.has(sh.id)) continue;
      events.add(sh.id);
      if (events.size > 4096) events.delete(events.values().next().value);
      if (s.tick / 20 - sh.at < 0.25) contact(sh);
    }
  }
  function frame(clock = performance.now() / 1000) {
    const fraction = Math.max(0, Math.min(1, (clock - arrival) / duration));
    for (const [id, { previous, current }] of bodies) {
      const row = { ...current };
      for (const key of ['x', 'y', 'z', 'tilt']) row[key] = previous[key] + (current[key] - previous[key]) * fraction;
      pose(id, row);
    }
  }
  function reset() {
    for (const id of bodies.keys()) remove(id);
    bodies.clear(); events.clear(); tick = -1; arrival = 0;
  }
  return { snapshot, frame, reset, get count() { return bodies.size; } };
}
