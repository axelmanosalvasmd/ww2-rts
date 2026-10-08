// The server's AI schedule, shared by the server, the balance and bench tools and match tests, so every caller
// plays the AI that players face. Views refresh only on the snapshot beat, so an AI never plans from fresher news
// than the players got, and only for seats that want one: building a view copies the whole terrain memory.
import * as sim from './sim.js';
import * as currentAI from './ai.js';
import { tickCommander, commanderNeedsView } from './ai-human.js';

// A seat's brain: observe(g, slot, cache) builds a view, wantsView(g, slot, level) asks for one on this snapshot
// beat, and act(g, slot, { view, level }) runs every tick with the latest delivered view.
// The scripted planner thinks on a fixed beat per difficulty, staggered by seat, and observes just before.
// ai is a module with observe, think and thinkEvery (default shared/ai.js; tools pass another checkout's).
export const planner = (ai = currentAI) => ({
  observe: ai.observe,
  wantsView: (g, slot, level) => { const every = ai.thinkEvery(level); return (every - (g.tick + slot * 13) % every) % every < 4; },
  act: (g, slot, { view, level }) => { if ((g.tick + slot * 13) % ai.thinkEvery(level) === 0) ai.think(g, slot, { view, level }); },
});
// The human-like commander (shared/ai-human.js) looks through a camera and acts through timed inputs every tick.
export const commander = { observe: currentAI.observe, wantsView: commanderNeedsView, act: tickCommander };
const scripted = planner();

// Seat AIs play as commanders. The Horde seat is a wave director, not a player: it keeps the scripted planner and
// observes every beat (it drips out its queued orders there).
const brainOf = (g, slot) => g.mode?.kind === 'horde' && slot === g.mode.slot ? scripted : commander;

// One tick of AI work after step(g). seats: [{ slot, level, brain, options }] (brain defaults by seat, above;
// options reach act, for example input hooks). views[slot] holds each seat's latest delivered view. sim is the module that made g (another checkout's, when comparing).
// Returns the snapshot cache if it built one, so the caller's snapshots can reuse it.
export function aiTick(g, seats, views, { sent = g.tick % 2 === 0 || g.winner !== null, cache = null, sim: s = sim } = {}) {
  const horde = slot => g.mode?.kind === 'horde' && slot === g.mode.slot;
  for (const { slot, level, brain = brainOf(g, slot) } of seats) {
    if (sent && (horde(slot) || brain.wantsView(g, slot, level))) views[slot] = brain.observe(g, slot, cache ??= s.snapshotCache(g));
  }
  for (const { slot, level, brain = brainOf(g, slot), options } of seats) if (views[slot]) brain.act(g, slot, { ...options, view: views[slot], level });
  return cache;
}

function seeded(seed) {
  let value = seed >>> 0;
  return () => {
    let t = value += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// A headless match on the server's schedule. With a seed, Math.random is seeded for the whole match (creation
// included) and restored afterwards, so the same seed plays the same match. seats defaults to a Normal AI in every
// seat plus, in Horde, the Horde seat itself, as on the server. onTick(g, { sent }) runs after the AI and before the
// beat clears the tick's events (g.shots, g.newCells), like the server's snapshot. setup(g) runs once after creation
// (a drill places its units there); beforeStep(g) runs before each step, so events it adds reach this tick's AI. The match stops at a winner, after maxTicks, or when until(g) returns true.
export function playMatch({ map, names, teams, factions, options = {}, shuffle = true, seats, seed, maxTicks = Infinity, until, onTick, setup, beforeStep, sim: s = sim }) {
  const random = Math.random;
  if (seed !== undefined) Math.random = seeded(seed);
  try {
    const g = s.createGame(map, names, shuffle, teams, factions, options);
    setup?.(g);
    const playing = seats ?? g.players.map((_, slot) => ({ slot, level: 'normal' }));
    if (!seats && g.mode?.kind === 'horde') playing.push({ slot: g.mode.slot, level: 'normal' });
    const views = [], start = s.snapshotCache(g);
    for (const { slot, brain = brainOf(g, slot) } of playing) views[slot] = brain.observe(g, slot, start);
    while (g.winner === null && g.tick < maxTicks && !until?.(g)) {
      beforeStep?.(g);
      s.step(g);
      const sent = g.tick % 2 === 0 || g.winner !== null;
      aiTick(g, playing, views, { sent, sim: s });
      onTick?.(g, { sent });
      if (sent) { g.shots = []; g.newCells = []; }
    }
    return g;
  } finally { Math.random = random; }
}
