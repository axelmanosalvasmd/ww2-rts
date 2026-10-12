// Standalone recipient-view protocol. Never accepts an authoritative whole-world object.
export const MAX_BYTES = 1000;
const enc = new TextEncoder(), dec = new TextDecoder();
const integer = n => Number.isSafeInteger(n) && n >= 0;
export function packet(row) {
  const bytes = enc.encode(JSON.stringify(row));
  if (bytes.length > MAX_BYTES) throw new RangeError('datagram exceeds 1000 bytes');
  return bytes;
}
export function decode(bytes) {
  if (bytes.byteLength > MAX_BYTES) throw new RangeError('oversize');
  return JSON.parse(dec.decode(bytes));
}
export function validMotion(m) {
  return typeof m.session === 'string' && m.session.length <= 64 &&
    ['revision','id','epoch','seq'].every(k => integer(m[k])) &&
    ['x','z','rot'].every(k => Number.isFinite(m[k]) && Math.abs(m[k]) <= 1e7);
}
export function chooseTransport({optIn=false, supported=false, reliability, ready=false}) {
  return optIn && supported && ready && reliability === 'supports-unreliable' ? 'webtransport' : 'websocket';
}
export class Receiver {
  constructor() { this.bind(null); }
  bind(session) { this.session = session; this.revision = -1; this.units = new Map(); this.needsBaseline = true; }
  baseline(b) {
    if (b.session !== this.session || !integer(b.revision) || b.revision <= this.revision ||
        !Array.isArray(b.units) || b.units.length > 4096) return false;
    const next = new Map();
    for (const row of b.units) {
      if (!validMotion({...row, session:b.session, revision:b.revision}) || next.has(row.id)) return false;
      const old = this.units.get(row.id);
      next.set(row.id, old && old.epoch === row.epoch && old.seq > row.seq ? {...row, x:old.x,z:old.z,rot:old.rot,seq:old.seq} : {...row});
    }
    this.units = next; this.revision = b.revision; this.needsBaseline = false; return true;
  }
  motion(m) {
    if (!validMotion(m) || m.session !== this.session) return false;
    if (m.revision > this.revision) this.needsBaseline = true;
    if (m.revision !== this.revision) return false; // No future/stale buffer, reliable resync is required.
    const u = this.units.get(m.id);
    if (!u || u.epoch !== m.epoch || m.seq <= u.seq) return false;
    Object.assign(u, {x:m.x,z:m.z,rot:m.rot,seq:m.seq}); return true;
  }
}
// Whitelist only recipient-visible motion. Visibility/lifecycle must come from a reliable recipient baseline.
export function motionFor(session, revision, visibleRows) {
  return visibleRows.map(({id,epoch,seq,x,z,rot}) => packet({session,revision,id,epoch,seq,x,z,rot}));
}
