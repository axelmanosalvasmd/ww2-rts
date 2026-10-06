// AI hands are visible only in a full-map spectator view and only after a local opt-in.
const finite = n => typeof n === 'number' && Number.isFinite(n);
const point = p => p && finite(p.x) && finite(p.z) ? { x: p.x, z: p.z } : null;
const kinds = new Set(['camera', 'select', 'recall', 'group', 'move', 'amove', 'attack', 'ability', 'buy', 'build', 'support', 'click', 'order', 'key']);

// This whitelist is also the server's spectator boundary. Never pass through an executor object.
export function spectatorHands(rows, { spectator = false, world = false } = {}) {
  if (!spectator || world || !Array.isArray(rows)) return [];
  return rows.slice(0, 16).flatMap(row => {
    const camera = point(row?.camera), cursor = point(row?.cursor);
    if (!Number.isInteger(row?.slot) || row.slot < 0 || !camera || !finite(row.camera.w) || !finite(row.camera.h) || row.camera.w <= 0 || row.camera.h <= 0) return [];
    const c = row.cursor;
    const corners = Array.isArray(row.camera.corners) && row.camera.corners.length === 4 ? row.camera.corners.map(point) : null;
    return [{ slot: row.slot, camera: { ...camera, w: row.camera.w, h: row.camera.h,
      ...(corners?.every(Boolean) && { corners }) },
      cursor: cursor && { ...cursor, fromX: finite(c.fromX) ? c.fromX : c.x, fromZ: finite(c.fromZ) ? c.fromZ : c.z,
        toX: finite(c.toX) ? c.toX : c.x, toZ: finite(c.toZ) ? c.toZ : c.z,
        startTick: finite(c.startTick) ? c.startTick : 0, endTick: finite(c.endTick) ? c.endTick : 0,
        ...(finite(c.observedTick) && { observedTick: c.observedTick }),
        mode: ['screen', 'minimap', 'ui'].includes(c.mode) ? c.mode : 'screen' },
      clicks: (Array.isArray(row.clicks) ? row.clicks : []).slice(-16).flatMap(click => {
        const at = point(click); return at && finite(click.tick) ? [{ ...at, tick: click.tick, kind: kinds.has(click.kind) ? click.kind : 'click' }] : [];
      }), selected: finite(row.selected) ? Math.min(1000, Math.max(0, Math.floor(row.selected))) : 0,
      concern: typeof row.concern === 'string' ? row.concern.split(':')[0].replace(/[^a-zA-Z -]/g, '').slice(0, 24) : '' }];
  });
}

export function ghostCursor(cursor, tick) {
  if (!cursor || cursor.mode === 'ui') return null;
  // Native samples already include both drag stages and the current camera projection.
  if (finite(cursor.observedTick)) return { x: cursor.x, z: cursor.z };
  const duration = cursor.endTick - cursor.startTick;
  // A keyboard camera jump keeps the screen pointer still and changes its ground projection.
  if (duration <= 0 || tick >= cursor.endTick) return { x: cursor.x, z: cursor.z };
  const t = duration > 0 ? Math.min(1, Math.max(0, (tick - cursor.startTick) / duration)) : 1;
  return { x: cursor.fromX + (cursor.toX - cursor.fromX) * t, z: cursor.fromZ + (cursor.toZ - cursor.fromZ) * t };
}

export function createAIOverlay({ enabled = false, spectator = () => false, world = () => false, colorOf = () => '#ffdc7b' } = {}) {
  let on = enabled === true;
  return {
    setEnabled(value) { on = value === true; },
    get enabled() { return on; },
    // The caller has already applied the existing minimap's world-to-canvas transform.
    draw(ctx, rows, { tick = 0, scale = 1 } = {}) {
      if (!on || !spectator() || world() || !finite(scale) || scale <= 0) return;
      const hands = spectatorHands(rows, { spectator: true });
      if (!hands.length) return;
      ctx.save();
      for (const hand of hands) {
        const { camera } = hand;
        ctx.strokeStyle = ctx.fillStyle = colorOf(hand.slot); ctx.globalAlpha = 0.75;
        ctx.lineWidth = 1.5 / scale; ctx.setLineDash([5 / scale, 3 / scale]);
        if (camera.corners) {
          ctx.beginPath(); camera.corners.forEach((p, i) => i ? ctx.lineTo(p.x, p.z) : ctx.moveTo(p.x, p.z));
          ctx.closePath(); ctx.stroke();
        } else ctx.strokeRect(camera.x - camera.w / 2, camera.z - camera.h / 2, camera.w, camera.h);
        ctx.setLineDash([]);
        const cursor = ghostCursor(hand.cursor, tick);
        if (cursor) {
          const r = 5 / scale;
          ctx.beginPath(); ctx.moveTo(cursor.x, cursor.z); ctx.lineTo(cursor.x + r, cursor.z + r * 1.8);
          ctx.lineTo(cursor.x + r * 0.3, cursor.z + r * 1.4); ctx.lineTo(cursor.x - r * 0.4, cursor.z + r * 2);
          ctx.closePath(); ctx.fill(); ctx.stroke();
        }
        for (const click of hand.clicks) {
          const age = tick - click.tick;
          if (age < 0 || age >= 16) continue;
          ctx.globalAlpha = 1 - age / 16;
          ctx.beginPath(); ctx.arc(click.x, click.z, (4 + age * 0.65) / scale, 0, Math.PI * 2); ctx.stroke();
        }
      }
      ctx.restore();
    },
  };
}
