// Sends from a test client to the real server that return only once the server has read the message.
// A fixed sleep after ws.send races a busy machine: the server could step ticks before the order arrived.
// Create one per server, before any client connects.
export function sendsReadBy(wss, timeoutMs = 15000) {
  let sent = 0, read = 0;
  wss.on('connection', socket => socket.on('message', () => { read++; }));
  return async (ws, message) => {
    const n = ++sent, deadline = Date.now() + timeoutMs;
    ws.send(JSON.stringify(message));
    while (read < n) {
      if (Date.now() > deadline) throw new Error(`the server did not read ${message.t} within ${timeoutMs / 1000} s`);
      await new Promise(resolve => setTimeout(resolve, 1));
    }
  };
}
