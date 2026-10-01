// Keep denial traffic bounded per player, including across reconnects.
export function allowDeny(player, now = Date.now()) {
  const recent = (player.denyTimes ?? []).filter(t => now - t < 1000);
  player.denyTimes = recent;
  if (recent.length >= 4) return false;
  recent.push(now);
  return true;
}
