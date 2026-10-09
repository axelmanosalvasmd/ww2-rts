// Run independently with node test-public-lobby.js, also included by test.js.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
process.env.PORT = '0';
process.env.HOST = '127.0.0.1';
process.env.PUBLIC_URL = 'http://localhost';
process.env.EDIT_PASSWORD = 'test-only';
process.env.MAX_ROOMS = '4';
const { server, wss, loop, rooms, clock } = await import('./server.js');
clearInterval(loop);
if (!server.listening) await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
const clients = [];
async function connect(code, extra = {}) {
  const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws?room=' + code);
  clients.push(ws);
  const messages = [];
  ws.on('message', data => messages.push(JSON.parse(data)));
  await once(ws, 'open');
  ws.send(JSON.stringify({ t: 'hello', name: 'Tester', token: 'token-' + clients.length, ...extra }));
  const until = Date.now() + 3000;
  while (!messages.some(m => m.t === 'lobby' || m.t === 'full')) {
    if (Date.now() > until) throw new Error('No lobby response');
    await new Promise(r => setTimeout(r, 10));
  }
  return { ws, messages };
}
try {
  const response = await fetch(base + '/api/rooms');
  assert.equal(response.status, 200, 'public directory endpoint exists');
  assert.deepEqual((await response.json()).rooms, [], 'empty directory');
  const script = await fetch(base + '/client/main.js'), tag = script.headers.get('etag');
  assert.equal(script.headers.get('content-encoding'), 'gzip', 'scripts are sent gzipped');
  assert.match(await script.text(), /applySnapshot/);
  assert.equal((await fetch(base + '/client/main.js', { headers: { 'if-none-match': tag } })).status, 304, 'an unchanged script is not sent again');
  assert.equal((await fetch(base + '/client/')).status, 404, 'a folder is not a file');
  await connect('hidden');
  const host = await connect('publicone', { listing: { public: true, title: 'Saturday skirmish' } });
  const listing = await (await fetch(base + '/api/rooms')).json();
  assert.equal(listing.rooms.length, 1, 'legacy rooms remain unlisted');
  assert.equal(listing.rooms[0].code, 'publicone');
  assert.equal(listing.rooms[0].title, 'Saturday skirmish');
  assert.equal(listing.rooms[0].joinable, true);
  assert.equal(listing.rooms[0].humans, 1);
  assert.ok(!JSON.stringify(listing).includes('token-'), 'directory never discloses seat tokens');
  console.log('public directory visibility and safe summaries passed');
  await connect('publicone', { listing: { public: false, title: 'Hijacked' } });
  let entry = (await (await fetch(base + '/api/rooms')).json()).rooms[0];
  assert.equal(entry.title, 'Saturday skirmish', 'joiners cannot rename or hide a room');
  assert.equal(entry.humans, 2);
  await connect('publicone');
  entry = (await (await fetch(base + '/api/rooms')).json()).rooms[0];
  assert.equal(entry.joinable, false, 'map seat capacity, not global capacity');
  const late = await connect('publicone');
  assert.equal(late.messages.find(m => m.t === 'lobby')?.spectator, true, 'a late join cannot overfill a listed map');
  for (const [client, message] of [[host, { t: 'addAi' }], [late, { t: 'sit' }]]) {
    client.ws.send(JSON.stringify(message));
    client.ws.send(JSON.stringify({ t: 'ping', c: 42 }));
    const until = Date.now() + 3000;
    while (!client.messages.some(m => m.t === 'pong' && m.c === 42)) {
      if (Date.now() > until) throw new Error('No command barrier pong');
      await new Promise(r => setTimeout(r, 10));
    }
    assert.equal(rooms.get('publicone').players.length, 3, 'AI and spectators respect the listed map limit');
  }
  rooms.get('publicone').state = 'play';
  entry = (await (await fetch(base + '/api/rooms')).json()).rooms[0];
  assert.equal(entry.state, 'play');
  assert.equal(entry.joinable, false);
  rooms.get('publicone').listed = false;
  assert.equal((await (await fetch(base + '/api/rooms')).json()).rooms.length, 0);
  console.log('directory capacity, active matches and immutable creation metadata passed');
  const page = await (await fetch(base + '/')).text();
  assert.ok(page.includes('Browse matches'), 'root serves the public lobby');
  const gamePage = await (await fetch(base + '/play')).text();
  assert.ok(gamePage.includes('id="overlay"'), 'game is served at /play');
  // A missing ES module prevents the entire lobby and battlefield from initializing.
  const modules = [...gamePage.matchAll(/<script type="module" src="([^"]+)"/g)].map(m => new URL(m[1], base).href);
  const checked = new Set();
  while (modules.length) {
    const url = modules.pop(); if (checked.has(url)) continue;
    checked.add(url);
    const asset = await fetch(url);
    assert.equal(asset.status, 200, `browser module is served: ${url}`);
    assert.ok(asset.headers.get('content-type')?.includes('javascript'), `browser module has JavaScript content: ${url}`);
    const source = await asset.text();
    for (const match of source.matchAll(/(?:import|export)\s+(?:[^'";]+?\s+from\s*)?['"]([^'"]+)['"]/g)) {
      if (match[1].startsWith('.') || match[1].startsWith('/')) modules.push(new URL(match[1], url).href);
    }
  }
  console.log('browser entry modules and their local dependencies are served');
  assert.ok((await (await fetch(base + '/?edit')).text()).includes('id="overlay"'), 'editor URL still works');
  await connect('another', { listing: { public: true, title: { toString: 'not callable' } } });
  assert.equal(rooms.get('another').title, 'Open skirmish', 'malformed titles cannot crash room creation');
  await connect('lastroom');
  const denied = await connect('overflow');
  assert.equal(denied.messages.find(m => m.t === 'full')?.reason, 'capacity', 'new rooms respect server capacity');
  assert.equal(rooms.size, 4);
  const existing = await connect('hidden');
  assert.ok(existing.messages.some(m => m.t === 'lobby'), 'existing rooms remain reachable at capacity');
  console.log('room admission limit and existing-room access passed');
} finally {
  for (const ws of clients) ws.terminate();
  for (const room of rooms.values()) for (const p of room.players) clock.clearTimeout(p.cleanupTimer);
  for (const ws of wss.clients) ws.terminate();
  await new Promise(r => wss.close(r));
  await new Promise(r => server.close(r));
  for (const room of rooms.values()) for (const p of room.players) clock.clearTimeout(p.cleanupTimer);
}
