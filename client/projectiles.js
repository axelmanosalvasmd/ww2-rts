// Network flight state drives presentation only. Health always comes from authoritative unit rows.
export function createProjectileView({ trail = () => {}, remove = () => {}, launch = () => {}, contact = () => {} } = {}) {
  const flights = new Map(), events = new Map();
  let serverTime = 0, arrival = 0, tick = -1;
  const fresh = (id, sequence) => {
    const old = events.get(id) ?? -1;
    if (sequence <= old) return false;
    events.set(id, sequence);
    if (events.size > 4096) events.delete(events.keys().next().value);
    return true;
  };
  function snapshot(s, clock = performance.now() / 1000) {
    if (s.tick < tick) return;
    tick = s.tick; serverTime = s.tick / 20; arrival = clock;
    const keep = new Set();
    for (const row of s.flights ?? []) {
      const terminal = events.get(row.flight) ?? -1;
      if (terminal > row.seq) continue;
      flights.set(row.flight, row); keep.add(row.flight);
    }
    for (const id of flights.keys()) if (!keep.has(id)) { flights.delete(id); remove(id); }
    for (const sh of s.shots ?? []) {
      if (sh.k === 'flight') {
        if (fresh(sh.flight, 0) && serverTime - sh.time < 0.2) launch(sh);
      } else if (sh.k === 'contact' || sh.k === 'expiry') {
        if (!fresh(sh.flight, sh.seq)) continue;
        // Remove the old path before displaying its contact, including a ricochet correction.
        remove(sh.flight);
        if (sh.terminal || sh.k === 'expiry') flights.delete(sh.flight);
        if (sh.k === 'contact' && serverTime - sh.time < 0.25) contact(sh);
      }
    }
  }
  function frame(clock = performance.now() / 1000) {
    const time = serverTime + Math.max(0, Math.min(0.15, clock - arrival));
    for (const [id, p] of flights) {
      if (time > p.until || time >= p.expires) { remove(id); flights.delete(id); continue; }
      const dt = Math.max(0, time - p.time), v = { x: p.v[0], y: p.v[1] - p.gravity * dt, z: p.v[2] };
      trail(id, { x: p.x + p.v[0] * dt, y: p.y + p.v[1] * dt - 0.5 * p.gravity * dt * dt, z: p.z + p.v[2] * dt }, v, p.kind, p.effect);
    }
  }
  function reset() {
    for (const id of flights.keys()) remove(id);
    flights.clear(); events.clear(); serverTime = 0; arrival = 0; tick = -1;
  }
  return { snapshot, frame, reset, get count() { return flights.size; } };
}
