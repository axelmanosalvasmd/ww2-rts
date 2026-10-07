// Owner-private logistics data stays ancillary to the ordinary visible unit rows.
export function decodeLogistics(snapshot, visibleUnits, owner, friendly = slot => slot === owner) {
  const wire = snapshot?.logistics, enabled = wire?.enabled === true;
  const own = row => visibleUnits.get(row.id)?.owner === owner;
  return {
    enabled,
    units: new Map((enabled ? wire.units ?? [] : []).filter(own).map(row => [row.id, row])),
    trucks: new Map((enabled ? wire.trucks ?? [] : []).filter(own).map(row => [row.id, row])),
    stores: new Map((enabled ? wire.stores ?? [] : []).filter(row => friendly(row.owner) && position(row)).map(row => [row.id, row])),
    // World Conquest: own regions' supply rate (0 cut off, 1 full), for the overlay
    regions: new Map(enabled ? wire.regions ?? [] : []),
    events: enabled ? wire.events ?? [] : []
  };
}

const position = p => p && Number.isFinite(p.x) && Number.isFinite(p.z);
const amount = n => Math.max(0, Number.isFinite(n) ? n : 0);
const seconds = n => `${Math.ceil(amount(n))} s`;
export function reserveLabels(row) {
  if (!row) return [];
  const labels = [...(row.ammo == null ? [] : [`Ammunition: ${Math.round(amount(row.ammo) * 100)}%`]), `Provisions: ${seconds(row.provisions)}`];
  if (row.fuel != null) labels.push(`Fuel: ${seconds(row.fuel)}`);
  if (row.emergency != null) labels.push(`Emergency fuel: ${seconds(row.emergency)}`);
  if (row.warning != null && !row.forced) labels.push(`Withdrawal in ${Math.ceil(amount(row.warning))} s`);
  if (row.forced) labels.push(row.stranded ? 'Stranded' : 'Mandatory withdrawal');
  // territory supply: the line's strength, the grace countdown once out of it, or cut off
  if (row.cut) labels.push('Cut off from supply');
  else if (row.grace != null) labels.push(`Out of supply: refill stops in ${Math.ceil(amount(row.grace))} s`);
  else if (row.supply != null) labels.push(`Supply line: ${Math.round(amount(row.supply) * 100)}%`);
  return labels;
}

const JOBS = { idle: 'Ready for deliveries', loading: 'Loading cargo', unloading: 'Unloading cargo', delivering: 'Delivering supplies',
  collecting: 'Returning to source', waiting: 'Delivery route blocked', waitingCollect: 'Delivery route blocked', waitingReturn: 'Delivery route blocked', manual: 'Manual route', travelling: 'Delivering supplies', transit: 'Delivering supplies', returning: 'Returning to source', blocked: 'Delivery route blocked', hold: 'Deliveries held', held: 'Deliveries held' };
export function truckLabels(row) {
  if (!row) return [];
  const cargo = row.cargo ?? {};
  return [row.hold ? 'Deliveries held' : row.manual ? 'Manual route' : JOBS[row.state] ?? 'Automatic deliveries',
    `Ammunition cargo: ${amount(cargo.ammo).toFixed(1)}`, `Provisions cargo: ${seconds(cargo.provisions)}`, `Fuel cargo: ${seconds(cargo.fuel)}`,
    ...(position(row.destination) ? [`Destination: ${Math.round(row.destination.x)}, ${Math.round(row.destination.z)}`] : [])];
}
export function storeForUnit(data, unit) {
  if (!data?.enabled || !unit) return undefined;
  return [...data.stores.values()].find(store => store.owner === unit.owner && Math.hypot(store.x-unit.x,store.z-unit.z)<.5);
}
export function storeLabels(row) {
  if (!row) return [];
  const stock = row.stock ?? {}, capacity = row.capacity ?? {};
  return [row.source ? 'Supply source' : 'Finite supply store', ...['ammo', 'provisions', 'fuel'].map((key, i) =>
    `${['Ammunition stock', 'Provisions stock', 'Fuel stock'][i]}: ${Math.round(amount(stock[key]))}/${Math.round(amount(capacity[key]))}`)];
}
export function logisticsIndicator(row) {
  if (!row) return '';
  if (row.stranded) return 'Stranded';
  if (row.forced) return 'Mandatory withdrawal';
  if (row.cut) return 'Cut off from supply';
  return row.warning != null || row.ammo != null && row.ammo < 0.25 || row.provisions < 30 || row.fuel != null && row.fuel < 45 ? 'Low supplies' : '';
}

// A route is drawn only if every segment is known. Never bridge an unknown section.
export function overlayItems(data, selected, units, known = () => true) {
  if (!data?.enabled) return { stores: [], routes: [] };
  const routes = [];
  for (const [id, truck] of data.trucks) {
    if (!selected.has(id)) continue;
    const unit = units.get(id), route = truck.route ?? [];
    const points = unit && position(unit) ? [{ x: unit.x, z: unit.z }, ...route] : route;
    const knownRoute = points.every((p, i) => {
      if (!position(p) || !known(p)) return false;
      if (!i) return true;
      const a = points[i - 1], steps = Math.ceil(Math.hypot(p.x - a.x, p.z - a.z));
      for (let n = 1; n < steps; n++) if (!known({ x: a.x + (p.x - a.x) * n / steps, z: a.z + (p.z - a.z) * n / steps })) return false;
      return true;
    });
    if (points.length > 1 && knownRoute) routes.push({ id, points, manual: !!truck.manual, hold: !!truck.hold });
  }
  return { stores: [...data.stores.values()].filter(known), routes };
}

const EVENT_TEXT = { low: 'Low supplies', lowReserve: 'Low supplies', lowReserves: 'Low supplies', blocked: 'Delivery route blocked',
  unreachable: 'Delivery route unreachable', dangerous: 'Known danger blocks deliveries', danger: 'Known danger blocks deliveries',
  currency: 'Insufficient currency for supplies', funds: 'Insufficient currency for supplies', stock: 'Supply stockpile empty',
  insufficientStock: 'Supply stockpile empty', withdrawal: 'Mandatory withdrawal', forced: 'Mandatory withdrawal',
  transit: 'Supplies in transit', stranded: 'Stranded', cut: 'Cut off from supply', restored: 'Supply line restored' };
export function createLogisticsAlerts() {
  const seen = new Set(), recent = new Map();
  return {
    reset() { seen.clear(); recent.clear(); },
    update(events, time) {
      const grouped = new Map();
      for (const event of events ?? []) {
        if (seen.has(event.id)) continue;
        seen.add(event.id);
        // Convoy losses are cargo losses, not one combat loss Alert per truck.
        if (event.type === 'truckLost' || event.type === 'truckLoss') continue;
        const text = EVENT_TEXT[event.type] ?? 'Supply delivery delayed';
        const x = position(event) ? event.x : 0, z = position(event) ? event.z : 0;
        const key = `${text}|${Math.floor(x / 30)}|${Math.floor(z / 30)}`;
        const group = grouped.get(key) ?? { key, text, x, z, count: 0 };
        group.count += event.count ?? 1; grouped.set(key, group);
      }
      const alerts = [];
      for (const group of grouped.values()) {
        if (time - (recent.get(group.key) ?? -Infinity) < 20) continue;
        recent.set(group.key, time);
        alerts.push({ ...group, text: `${group.text}: ${group.count}` });
      }
      for (const [key, at] of recent) if (time - at > 120) recent.delete(key);
      if (seen.size > 2000) { const retained = [...seen].slice(-1000); seen.clear(); retained.forEach(id => seen.add(id)); }
      return alerts;
    }
  };
}
