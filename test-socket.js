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

// In-memory sockets at the room seam: a test client connects to server.js without a network. Each message crosses
// at once in both directions, so a test that sends an order or steps the server reads exactly what the clients got,
// with no sleeps. The server side offers what server.js uses of a ws socket: readyState (a getter, as on ws),
// send(data, callback), close(), terminate() and the message and close events.
import { EventEmitter } from 'node:events';
class MemorySocket extends EventEmitter {
  constructor(state) { super(); this.state = state; }
  get readyState() { return this.state.open ? 1 : 3; }
  send(data, callback) {
    if (!this.state.open) { callback?.(new Error('socket closed')); return; }
    this.peer.emit('message', Buffer.from(String(data)), false);
    callback?.();
  }
  close(code, reason) {
    if (!this.state.open) return;
    this.state.open = false;
    this.emit('close', code, reason); this.peer.emit('close', code, reason);
  }
  terminate() { this.close(1006); }
}
// Opens a connection to the server's WebSocketServer (wss) for url (for example /ws?room=abc). Returns the client side.
export function memoryConnect(wss, url) {
  const state = { open: true }, client = new MemorySocket(state), server = new MemorySocket(state);
  client.peer = server; server.peer = client;
  wss.emit('connection', server, { url, headers: {} });
  return client;
}
