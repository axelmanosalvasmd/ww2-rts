// Socket ownership and retry timing stay here so late events cannot replace a newer connection.
export function createConnection({ url, hello, WebSocket = globalThis.WebSocket, clock = {
  now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (id) => clearTimeout(id),
} }) {
  const handlers = new Map();
  let socket = null, running = false, timer = null, attempts = 0, answered = false, waitingForRoom = false;
  const emit = (type, data) => { for (const fn of handlers.get(type) || []) fn(data); };
  const clearRetry = () => { if (timer !== null) clock.clearTimeout(timer); timer = null; };
  const retire = () => { const old = socket; socket = null; if (old && old.readyState < 2) old.close(); };
  const send = (message) => { if (socket?.readyState !== 1) return false; socket.send(JSON.stringify(message)); return true; };
  const retry = (seconds, reason = 'lost') => {
    clearRetry();
    const until = clock.now() + seconds * 1000;
    const count = () => {
      if (!running) return;
      const left = Math.ceil((until - clock.now()) / 1000);
      if (left <= 0) { timer = null; open(); return; }
      emit('retry', { left, reason });
      timer = clock.setTimeout(count, Math.min(1000, until - clock.now()));
    };
    count();
  };
  const lost = () => { if (running) waitingForRoom ? retry(10, 'full') : retry(Math.min(8, 2 ** attempts++)); };
  function open() {
    if (!running) return;
    answered = false;
    let current;
    try { current = new WebSocket(typeof url === 'function' ? url() : url); }
    catch { lost(); return; }
    socket = current;
    current.onopen = () => {
      if (current !== socket || !running) return;
      send(typeof hello === 'function' ? hello() : hello);
    };
    current.onmessage = (event) => {
      if (current !== socket || !running) return;
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (!message || typeof message.t !== 'string') return;
      if (message.t === 'replaced') {
        running = false; clearRetry(); retire(); emit('replaced', message); return;
      }
      if (message.t === 'full') {
        waitingForRoom = true; attempts = 0;
        retire(); emit('full', message); retry(10, 'full'); return;
      }
      attempts = 0; waitingForRoom = false;
      if (!answered) { answered = true; emit('connected', message); }
      emit(message.t, message);
    };
    current.onclose = (event) => {
      if (current !== socket || !running) return;
      socket = null; emit('close', event); lost();
    };
  }
  return {
    send,
    on(type, fn) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(fn);
      return () => handlers.get(type)?.delete(fn);
    },
    start() { clearRetry(); retire(); attempts = 0; waitingForRoom = false; running = true; open(); },
    stop() { running = false; clearRetry(); retire(); },
    isOpen: () => socket?.readyState === 1,
  };
}
