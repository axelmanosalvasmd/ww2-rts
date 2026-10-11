// What this player holds of the match, rebuilt from snapshots. The server sends only the unit rows that changed, the ids
// that left (gone), and the wrecks and nodes only when they change; held is [count, xor of ids] of what the server
// thinks this client now holds. No DOM and no three.js: the client applies every snapshot here, and tests can feed it
// the server's own snapshots.
export function createWorldState() {
  const rows = new Map();
  let last = null;
  return {
    // Completes s in place (every unit row held, wrecks and nodes carried over; s.sent keeps the rows that came) and
    // returns true when the rows disagree with what the server says this client holds.
    apply(s) {
      // a full resend replaces everything held; so does a snapshot without held, from a server older than the deltas
      // that sends every row each time and never a gone list (a server left running across an update)
      if (s.all || !s.held) rows.clear();
      for (const id of s.gone ?? []) rows.delete(id);
      for (const row of s.units) rows.set(row[0], row);
      let outOfSync = false;
      if (s.held) {
        let xor = 0;
        for (const id of rows.keys()) xor ^= id;
        outOfSync = rows.size !== s.held[0] || xor !== s.held[1];
      }
      s.sent = s.units; s.units = [...rows.values()];
      s.wrecks ??= last?.wrecks; s.nodes ??= last?.nodes;
      last = s;
      return outOfSync;
    },
    reset() { rows.clear(); last = null; },
    get size() { return rows.size; },
  };
}
