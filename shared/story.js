// The story of a match, for the report card in the lobby: what each player did, counted where it happens in the sim,
// and a timeline sampled every 10 s. Counting changes no rules. Nothing counts once the match is decided (the server
// holds the ending for a few seconds), and none of it reaches a player before then: the server sends it with the result.
//
// Per player (g.story[slot]):
//   kills         enemy units and structures this player finished off
//   losses        own units and structures destroyed (by anyone)
//   built         buildings and field works finished (Classic buildings; trenches, sandbags, wire, tank traps)
//   captures      points taken
//   mpSpent       manpower spent: units, buildings, field works, support, reinforcing and repairs (less refunds)
//   supportCalls  off-map support called in
//   planesDowned  planes shot down: aircraft by anti-air, support planes by flak or fighter cover
// Timeline (g.timeline): { t: seconds, vp: [per team] } in Conquest, { t, points: [per team], structures: [per team] }
// in the other modes. Arrays are indexed by team id.
export const STORY_KEYS = ['kills', 'losses', 'built', 'captures', 'mpSpent', 'supportCalls', 'planesDowned'];
export const SAMPLE_EVERY = 200; // ticks: 10 s at 20 a second

const storyOf = (g) => (g.story ??= g.players.map(() => Object.fromEntries(STORY_KEYS.map(k => [k, 0]))));
const counting = (g, slot) => g.winner === null && slot >= 0 && !!g.players[slot];

// count n of something for a player
export function tally(g, slot, key, n = 1) {
  if (counting(g, slot)) storyOf(g)[slot][key] += n;
}

// a unit or structure was destroyed (by: the enemy who finished it, or -1). Remembers where the last structure, bunker
// and Production Building fell: the decisive spot when that ends the match.
export function died(g, u, def, by) {
  if (g.winner !== null) return;
  tally(g, u.owner, 'losses');
  tally(g, by, 'kills');
  if (!def.structure) return;
  const at = { x: u.x, z: u.z }, fell = (g.fallen ??= {});
  fell.structure = at;
  if (u.type === 'bunker') fell.bunker = at;
  if (def.produces) fell.hq = at;
}

// a point was taken by slot
export function captured(g, p, slot) {
  if (g.winner !== null) return;
  p.capTick = g.tick;
  tally(g, slot, 'captures');
}

// the point a team took most recently among those it still holds (Conquest's decisive spot), or null
export function lastCapture(g, team) {
  const held = g.points.filter(p => p.owner >= 0 && g.players[p.owner].team === team);
  return held.sort((a, b) => (b.capTick ?? -1) - (a.capTick ?? -1))[0] ?? null;
}

// one point of the timeline; isStructure(u) says what counts as a structure (sim.js passes UNITS' flag)
export function sample(g, isStructure) {
  const n = Math.max(...g.players.map(p => p.team)) + 1, team = (slot) => g.players[slot]?.team ?? -1;
  const count = (fn) => { const a = Array(n).fill(0); fn((t, v = 1) => { if (t >= 0) a[t] += v; }); return a; };
  const s = { t: Math.round(g.tick / 20) };
  if (!g.mode) s.vp = count(add => g.players.forEach(p => add(p.team, p.vp))).map(Math.floor);
  else {
    s.points = count(add => g.points.forEach(p => p.owner >= 0 && add(team(p.owner))));
    s.structures = count(add => { for (const u of g.units.values()) if (u.hp > 0 && isStructure(u)) add(team(u.owner)); });
  }
  (g.timeline ??= []).push(s);
}

// what the server adds to room.result once the hold is over: why it ended, where, and the story
export const storyResult = (g) => ({
  reason: g.endReason, at: g.endAt, endTick: g.endTick,
  story: storyOf(g).map(s => Object.fromEntries(STORY_KEYS.map(k => [k, Math.round(s[k])]))),
  timeline: g.timeline ?? [], winVp: g.mode ? null : g.winVp, mode: g.mode?.kind ?? 'conquest',
});
