// One running tick of a room: step, the AI seats, the snapshots, and the timing that sets how often snapshots go out.
// The server builds it from its own parts (server.js); tests build it from stand-ins, so they run this code itself.
// deps: step, aiTick, snapshotCache, snapshotFor, trimmed, sendSnapshot, sendWatchers, sendOperatives, connected,
// backedUp, createTickMeter, recordTick, tickStats.
export function createRoomTick({ step, aiTick, snapshotCache, snapshotFor, trimmed, sendSnapshot, sendWatchers, sendOperatives = () => {},
  connected, backedUp, createTickMeter, recordTick, tickStats }) {
  return function timedRoomTick(room) {
    const g = room.game, meter = room.tickMeter ??= createTickMeter({ now: Date.now() });
    room.snapEvery ??= 2;
    const began = process.hrtime.bigint();
    const stepAt = process.hrtime.bigint();
    step(g);
    const thinkAt = process.hrtime.bigint();
    const sent = g.tick % room.snapEvery === 0 || g.winner !== null;
    // The seats the server plays: the room's AIs and, in Horde, the horde itself (nobody's seat, but it gets the same view).
    const seats = [...room.players.keys()].filter(i => room.players[i].ai);
    if (g.mode?.kind === 'horde') seats.push(g.mode.slot);
    // The AI schedule lives in shared/ai-schedule.js, so the balance and bench tools play the same AI as this room:
    // seat AIs are human-like commanders (shared/ai-human.js), the Horde seat keeps the scripted planner.
    room.aiViews ??= [];
    const built = aiTick(g, seats.map(slot => ({ slot, level: room.players[slot]?.level })), room.aiViews, { sent }); // human snapshots reuse its cache
    const snapshotAt = process.hrtime.bigint();
    let snapshotBuild = 0, snapshotStringify = 0;
    if (sent) {
      const shots = g.shots, cells = g.newCells; g.shots = []; g.newCells = [];
      const recipients = [];
      room.players.forEach((p, i) => { if (p.ws?.readyState === 1 && !backedUp(p)) recipients.push(i); });
      const watched = !!room.spectators?.some(s => s.ws?.readyState === 1), accompanied = !!room.operatives?.some(connected);
      if (recipients.length || watched || accompanied) {
        const online = room.players.map(p => connected(p) || !!p.ai), ping = room.players.map(p => (p.ai ? -1 : p.rtt ?? null));
        const cacheAt = process.hrtime.bigint(), cache = built ?? snapshotCache(g);
        snapshotBuild += Number(process.hrtime.bigint() - cacheAt) / 1e6;
        for (const i of recipients) {
          const p = room.players[i], buildAt = process.hrtime.bigint(), msg = trimmed(room, p.net ??= { sent: new Map() }, { ...snapshotFor(g, i, shots, cells, cache), online, ping }, cache);
          snapshotBuild += Number(process.hrtime.bigint() - buildAt) / 1e6;
          const stringifyAt = process.hrtime.bigint(), json = JSON.stringify(msg);
          snapshotStringify += Number(process.hrtime.bigint() - stringifyAt) / 1e6;
          sendSnapshot(room, p, json);
        }
        if (watched) sendWatchers(room, shots, cells, cache, { online, ping });
        if (room.operatives?.length) sendOperatives(room, shots, cells, cache, { online, ping });
      }
    }
    const ended = process.hrtime.bigint(), now = Date.now();
    room.snapEvery = recordTick(meter, { tick: Number(ended - began) / 1e6, step: Number(thinkAt - stepAt) / 1e6,
      think: Number(snapshotAt - thinkAt) / 1e6, snapshot: Number(ended - snapshotAt) / 1e6, snapshotBuild, snapshotStringify, sent }, now);
    if (process.env.WW2_TICKLOG === '1' && now >= meter.nextLog) {
      meter.nextLog = now + 30_000;
      const stats = tickStats(meter), costs = Object.entries(stats).map(([phase, v]) => `${phase} ${v.p50.toFixed(2)}/${v.p95.toFixed(2)} ms`).join(', ');
      console.log(`[tick ${room.code}] p50/p95: ${costs}; snapshots every ${room.snapEvery} ticks`);
    }
  };
}
