// Rooms on every core (#58). With WW2_SHARDS=N the process started first serves the pages, the maps and the public
// lobby list, and forwards each game connection (/ws?room=code) to one of N game processes, chosen from the room code,
// so every player of a room reaches the same process. Each game process is server.js itself with WW2_SHARD set; a
// room's whole simulation runs there, so one busy match no longer slows the others down.
import { fork } from 'node:child_process';
import net from 'node:net';

// FNV-1a over the room code: the same code always lands on the same game process
export function shardOf(code, n) {
  let h = 2166136261;
  for (let i = 0; i < code.length; i++) h = Math.imul(h ^ code.charCodeAt(i), 16777619);
  return (h >>> 0) % n;
}

// entry: the game process's script. onMessage(shard, message): anything a game process sends besides 'ready'.
export function startShards(entry, n, { onMessage = () => {}, log = console } = {}) {
  let stopping = false;
  const shards = Array.from({ length: n }, (_, i) => ({ i, port: 0, ready: null, child: null }));
  const spawn = (s) => {
    s.ready = new Promise(resolve => {
      const child = s.child = fork(entry, [], { env: { ...process.env, WW2_SHARD: String(s.i), PORT: '0', HOST: '127.0.0.1' } });
      child.on('message', m => { if (m?.t === 'ready') { s.port = m.port; resolve(); } else onMessage(s, m); });
      child.on('exit', code => {
        if (stopping) return;
        log.error(`game process ${s.i} exited (${code}); starting it again`);
        s.port = 0; setTimeout(() => spawn(s), 1000);
      });
    });
  };
  shards.forEach(spawn);
  return {
    shards,
    ready: () => Promise.all(shards.map(s => s.ready)),
    send(m) { for (const s of shards) if (s.child?.connected) s.child.send(m); },
    // An HTTP upgrade for /ws: replay the request to the room's game process and join the two sockets.
    async upgrade(req, socket, head) {
      const url = new URL(req.url, 'http://x');
      if (url.pathname !== '/ws') { socket.destroy(); return; }
      const s = shards[shardOf(url.searchParams.get('room') || '', n)];
      await s.ready;
      const up = net.connect(s.port, '127.0.0.1');
      const close = () => { socket.destroy(); up.destroy(); };
      up.on('error', close); socket.on('error', close); up.on('close', close); socket.on('close', close);
      up.once('connect', () => {
        const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
        for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
        up.write(lines.join('\r\n') + '\r\n\r\n');
        if (head?.length) up.write(head);
        socket.setNoDelay(true); up.setNoDelay(true);
        socket.pipe(up); up.pipe(socket);
      });
    },
    // every game process's listed rooms, for the public lobby
    async rooms() {
      const lists = await Promise.all(shards.map(async s => {
        try { await s.ready; return (await (await fetch(`http://127.0.0.1:${s.port}/api/rooms`)).json()).rooms; } catch { return []; }
      }));
      return lists.flat();
    },
    stop() { stopping = true; for (const s of shards) s.child?.kill(); },
  };
}
