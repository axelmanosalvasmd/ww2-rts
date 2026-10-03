// Match-local delivered Alerts. Reopening one reads its saved text and location only.
export function createAlertHistory(limit = 100) {
  let entries = [], serial = 0, match = null, cursor = null, lastTick = -1;
  return {
    start(id) {
      if (id != null && id === match) return false;
      match = id; entries = []; serial = 0; cursor = null; lastTick = -1;
      return true;
    },
    reset() { entries = []; serial = 0; cursor = null; lastTick = -1; },
    acceptTick(tick) {
      if (!Number.isFinite(tick) || tick <= lastTick) return false;
      lastTick = tick; return true;
    },
    add({ kind, text, x, z, time }) {
      const entry = Object.freeze({ id: ++serial, kind, text, x, z, time });
      entries.unshift(entry);
      if (entries.length > limit) entries.length = limit;
      if (cursor != null && !entries.some(a => a.id === cursor)) cursor = null;
      return entry;
    },
    select(id) { const entry = entries.find(a => a.id === id); if (entry) cursor = id; return entry ?? null; },
    navigate(direction) {
      const eligible = entries.filter(a => Number.isFinite(a.x) && Number.isFinite(a.z));
      if (!eligible.length) return null;
      const current = eligible.findIndex(a => a.id === cursor);
      const index = current < 0 ? 0 : Math.max(0, Math.min(eligible.length - 1, current + direction));
      cursor = eligible[index].id;
      return eligible[index];
    },
    get entries() { return [...entries]; },
    get selected() { return cursor; }
  };
}
