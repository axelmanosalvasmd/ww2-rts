export function createSelection({ units, selected, groups, owner, definitions, screenOf, viewport, center, canUseBuilding = () => false, screenPointsOf = v => [screenOf(v)], logisticsSelection = () => false }) {
  const cursors = { army: -1, engineers: -1 };
  let lastGroup = null, lastRecall = -Infinity;
  const own = (v) => v && (v.owner === owner() || (owner() >= 0 && definitions[v.type]?.building && canUseBuilding(v))) && (v.hp === undefined || v.hp > 0);
  const rows = () => [...selected].map(id => units.get(id)).filter(own);
  const replace = (list) => { selected.clear(); for (const v of list) selected.add(v.id); return list; };
  const mobileOwn = v => own(v) && definitions[v.type] && !definitions[v.type].structure && !(v.flags & (512 | 262144));
  const armyUnit = (v) => own(v) && definitions[v.type] && !definitions[v.type].structure && v.type !== 'truck';
  const selectable = (v) => armyUnit(v) && mobileOwn(v); // not a plane at base, not a squad riding in a halftrack
  const selectableOwn = v => own(v) && definitions[v.type] && (mobileOwn(v) || definitions[v.type].building);
  const points = v => screenPointsOf(v).filter(p => p.front && Number.isFinite(p.x) && Number.isFinite(p.y));
  const inside = (p, b) => {
    if (p.bounds) return p.bounds.x1 >= b.x0 && p.bounds.x0 <= b.x1 && p.bounds.y1 >= b.y0 && p.bounds.y0 <= b.y1;
    const dx = Math.max(b.x0 - p.x, 0, p.x - b.x1), dy = Math.max(b.y0 - p.y, 0, p.y - b.y1);
    return Math.hypot(dx, dy) <= (p.boxRadius ?? 0);
  };
  const prune = () => {
    for (const key of Object.keys(groups)) groups[key] = [...new Set(groups[key])].filter(id => own(units.get(id)) && units.get(id).type !== 'truck');
  };
  function idle(engineers = false) {
    return [...units.values()].filter(v => armyUnit(v) && !definitions[v.type].air &&
      (!engineers || v.type === 'engineer') && !(v.flags & (1 | 16 | 32 | 128 | 262144)) &&
      (!v.plan || v.plan.kind === 0)).sort((a, b) => a.id - b.id);
  }
  return {
    pick(x, y) {
      const nearest = test => {
        let best = null, distance = Infinity;
        for (const v of units.values()) {
          if (!test(v)) continue;
          for (const p of points(v)) {
            const d = p.bounds ? Math.hypot(Math.max(p.bounds.x0 - x, 0, x - p.bounds.x1), Math.max(p.bounds.y0 - y, 0, y - p.bounds.y1)) : Math.hypot(p.x - x, p.y - y);
            const radius = p.radius ?? (definitions[v.type].building ? 60 : definitions[v.type].infantry ? 32 : 45);
            if (d < radius && d < distance) { best = v; distance = d; }
          }
        }
        return best;
      };
      return nearest(mobileOwn) ?? nearest(v => selectableOwn(v) && definitions[v.type].building);
    },
    click(v, event = {}) {
      if (!event.shiftKey) selected.clear();
      if (!selectableOwn(v)) return rows();
      if (event.shiftKey && selected.has(v.id)) selected.delete(v.id);
      else selected.add(v.id);
      return rows();
    },
    box(bounds, event = {}) {
      if (!event.shiftKey) selected.clear();
      for (const v of units.values()) {
        if (!(logisticsSelection() ? mobileOwn(v) && v.type === 'truck' : selectable(v))) continue;
        if (points(v).some(p => inside(p, bounds))) selected.add(v.id);
      }
      return rows();
    },
    doubleClick(v, event = {}) {
      if (!selectableOwn(v)) return rows();
      const mapWide = event.ctrlKey || event.metaKey, size = viewport();
      return replace([...units.values()].filter(candidate => {
        if (!selectableOwn(candidate) || candidate.type !== v.type) return false;
        if (mapWide) return true;
        return points(candidate).some(p => inside(p, { x0: 0, x1: size.width, y0: 0, y1: size.height }));
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
      if (operation === 'set' || operation === 'append' || operation === 'transfer') {
        const ids = rows().filter(v => v.type !== 'truck' && (operation !== 'transfer' || selectable(v))).map(v => v.id);
        if (operation === 'transfer') {
          const moving = new Set(ids);
          for (const key of Object.keys(groups)) if (String(key) !== String(number)) groups[key] = groups[key].filter(id => !moving.has(id));
        }
        groups[number] = operation !== 'set' ? [...new Set([...(groups[number] || []), ...ids])] : ids;
        lastGroup = null;
        lastRecall = -Infinity;
        return groups[number];
      }
      const list = replace((groups[number] || []).map(id => units.get(id)).filter(selectableOwn));
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

export const selectionDragged = (press, release) => Math.hypot(release.clientX - press.x, release.clientY - press.y) > 6;
