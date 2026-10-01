export function createSelection({ units, selected, groups, owner, definitions, screenOf, viewport, center }) {
  const cursors = { army: -1, engineers: -1 };
  let lastGroup = null, lastRecall = -Infinity;
  const own = (v) => v && v.owner === owner() && (v.hp === undefined || v.hp > 0);
  const rows = () => [...selected].map(id => units.get(id)).filter(own);
  const replace = (list) => { selected.clear(); for (const v of list) selected.add(v.id); return list; };
  const armyUnit = (v) => own(v) && definitions[v.type] && !definitions[v.type].structure;
  const selectable = (v) => armyUnit(v) && !(v.flags & (512 | 262144)); // not a plane at base, not a squad riding in a halftrack
  const prune = () => {
    for (const key of Object.keys(groups)) groups[key] = [...new Set(groups[key])].filter(id => own(units.get(id)));
  };
  function idle(engineers = false) {
    return [...units.values()].filter(v => armyUnit(v) && !definitions[v.type].air &&
      (!engineers || v.type === 'engineer') && !(v.flags & (1 | 16 | 32 | 128 | 262144)) &&
      (!v.plan || v.plan.kind === 0)).sort((a, b) => a.id - b.id);
  }
  return {
    click(v, event = {}) {
      if (!event.shiftKey) selected.clear();
      if (!own(v)) return rows();
      if (event.shiftKey && selected.has(v.id)) selected.delete(v.id);
      else selected.add(v.id);
      return rows();
    },
    box(bounds, event = {}) {
      if (!event.shiftKey) selected.clear();
      for (const v of units.values()) {
        if (!selectable(v)) continue;
        const p = screenOf(v);
        if (p.front && p.x >= bounds.x0 && p.x <= bounds.x1 && p.y >= bounds.y0 && p.y <= bounds.y1) selected.add(v.id);
      }
      return rows();
    },
    doubleClick(v, event = {}) {
      if (!own(v)) return rows();
      const mapWide = event.ctrlKey || event.metaKey, size = viewport();
      return replace([...units.values()].filter(candidate => {
        if (!own(candidate) || candidate.type !== v.type) return false;
        if (mapWide) return true;
        const p = screenOf(candidate);
        return p.front && p.x >= 0 && p.x <= size.width && p.y >= 0 && p.y <= size.height;
      }));
    },
    army() { return replace([...units.values()].filter(selectable)); },
    type(type, event = {}) {
      const current = rows();
      return replace(current.filter(v => event.shiftKey ? v.type !== type : v.type === type));
    },
    idle,
    findIdle(all = false, engineers = false) {
      const list = idle(engineers);
      if (all) return replace(list);
      if (!list.length) return [];
      const key = engineers ? 'engineers' : 'army';
      cursors[key] = (cursors[key] + 1) % list.length;
      const chosen = replace([list[cursors[key]]]);
      center(chosen);
      return chosen;
    },
    group(number, operation = 'recall', now = Date.now()) {
      prune();
      if (operation === 'set' || operation === 'append') {
        const ids = rows().map(v => v.id);
        groups[number] = operation === 'append' ? [...new Set([...(groups[number] || []), ...ids])] : ids;
        lastGroup = null;
        lastRecall = -Infinity;
        return groups[number];
      }
      const list = replace((groups[number] || []).map(id => units.get(id)));
      if (list.length && lastGroup === number && now >= lastRecall && now - lastRecall <= 300) center(list);
      lastGroup = number;
      lastRecall = now;
      return list;
    },
    reset() {
      for (const key of Object.keys(groups)) delete groups[key];
      cursors.army = cursors.engineers = -1;
      lastGroup = null;
      lastRecall = -Infinity;
    }
  };
}
