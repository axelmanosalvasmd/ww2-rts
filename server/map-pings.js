import { CELL } from '../shared/sim.js';

export function mapPing(room, me, slot, msg, send) {
  if (room.state !== 'play' || !room.game?.players[slot] || room.players[slot] !== me || me.ai || !me.ws) return;
  const { x, z } = msg;
  if (typeof x !== 'number' || typeof z !== 'number' || !Number.isFinite(x) || !Number.isFinite(z) ||
      x < 0 || z < 0 || x > room.game.w * CELL || z > room.game.h * CELL) return;
  const now = Date.now(), recent = (me.mapPingTimes || []).filter(t => now - t < 5000);
  if (recent.length >= 3) return;
  recent.push(now); me.mapPingTimes = recent;
  const ping = { t: 'ping', from: slot, x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10 };
  for (const player of room.players) {
    if (!player.ai && player.team === me.team && player.ws?.readyState === 1) send(player.ws, ping);
  }
}
