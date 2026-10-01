// Autocast, Warcraft 3 style: right-click an ability button and the selected units of that type use the ability by
// themselves (the server decides when, in autocastTarget). This file remembers each player's choice per unit type, kept
// apart for Classic (where abilities cost Munitions) and the other modes, so new units of that type start the same way.
import { AUTO_FLAG } from '../shared/sim.js';

const KEY = 'ww2-autocast';

export function createAutocast({ storage, send }) {
  let prefs = {};
  try { prefs = JSON.parse(storage?.getItem(KEY) ?? '{}') || {}; } catch { prefs = {}; }
  const fixed = new Set(); // own units already brought in line with the remembered choice
  const bucket = (classic) => (prefs[classic ? 'classic' : 'free'] ??= {});
  return {
    // on unless every one of them already has it on; remembered for the type
    toggle(type, list, classic) {
      if (!list.length) return null;
      const on = !list.every((v) => v.flags & AUTO_FLAG);
      bucket(classic)[type] = on;
      try { storage?.setItem(KEY, JSON.stringify(prefs)); } catch { /* private mode: this match only */ }
      send({ t: 'autocast', ids: list.map((v) => v.id), on });
      return on;
    },
    // snapshot unit rows: an own unit seen for the first time gets the remembered choice for its type, once
    adopt(rows, me, classic) {
      const want = bucket(classic), change = { on: [], off: [] };
      for (const row of rows) {
        const [id, type, owner] = row;
        if (owner !== me || fixed.has(id)) continue;
        fixed.add(id);
        if (typeof want[type] === 'boolean' && !!(row[12] & AUTO_FLAG) !== want[type]) change[want[type] ? 'on' : 'off'].push(id);
      }
      if (change.on.length) send({ t: 'autocast', ids: change.on, on: true });
      if (change.off.length) send({ t: 'autocast', ids: change.off, on: false });
    },
    reset() { fixed.clear(); }, // a new match numbers its units from scratch
  };
}
