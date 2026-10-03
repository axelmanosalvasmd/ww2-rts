// Long movement and discovery acceptance through the browser's real room protocol.
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { CELL, TERRAIN, CFG } from './shared/sim.js';
Object.assign(process.env, { PORT: '0', HOST: '127.0.0.1', EDIT_PASSWORD: 'test', PUBLIC_URL: 'http://test' });
const server = await import('./server.js');
clearInterval(server.loop);
if (!server.server.listening) await new Promise(resolve => server.server.once('listening', resolve));
const clients = [], settle = () => new Promise(resolve => setTimeout(resolve, 2));
let ping = 0;
async function until(fn, label) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { const value = fn(); if (value) return value; await settle(); }
  assert.fail(label);
}
async function connect(token) {
  const ws = new WebSocket(`ws://127.0.0.1:${server.server.address().port}/ws?room=worldmove`, { perMessageDeflate: false });
  const c = { ws, units: new Map(), pongs: new Set(), denied: [] }; clients.push(c);
  ws.on('message', raw => {
    const m = JSON.parse(raw);
    if (m.t === 'lobby') c.lobby = m;
    if (m.t === 'start') { c.start = m; c.units.clear(); }
    if (m.t === 's') {
      if (m.all) c.units.clear();
      for (const id of m.gone ?? []) c.units.delete(id);
      for (const row of m.units) c.units.set(row[0], row);
      c.latest = m;
    }
    if (m.t === 'pong') c.pongs.add(m.c);
    if (m.t === 'deny') c.denied.push(m);
  });
  await new Promise((resolve,reject) => { ws.once('open',resolve); ws.once('error',reject); });
  c.send = m => ws.send(JSON.stringify(m));
  c.barrier = async () => { const id = ++ping; c.send({t:'ping',c:id}); await until(() => c.pongs.delete(id), 'ordered ping returned'); };
  c.send({t:'hello',name:token,token}); await until(() => c.lobby,'lobby received'); return c;
}
async function tick(n = 2) {
  for (let i = 0; i < n; i++) { server.tickRooms(); await new Promise(resolve => setImmediate(resolve)); }
  await settle();
}
try {
  const host = await connect('movement-host'); await connect('movement-rival');
  host.send({t:'mode',v:'world'}); host.send({t:'start'}); await host.barrier();
  await until(() => host.start,'world start received'); await tick(4);
  const g = server.rooms.get('worldmove').game;
  const rifle = [...g.units.values()].find(u => u.owner === 0 && u.type === 'rifle');
  const start = {...g.players[0].spawn}, direction = start.x < g.w*CELL/2 ? 1 : -1;
  const target = {x:start.x+direction*150,z:start.z};
  // A clear 150 m route with a short wall beyond initial vision. This setup avoids random geography deciding the test.
  const wallX = Math.floor((start.x+direction*52)/CELL), wallZ = Math.floor(start.z/CELL);
  const put = (x,y,ch,height=0) => { const c=y*g.w+x; g.chars[c]=ch; g.flags[c]=TERRAIN[ch]; g.height[c]=height; g.cellHp[c]=ch==='B'?100000:0; };
  for (let y = wallZ-12; y <= wallZ+12; y++)
    for (let x = Math.floor(Math.min(start.x,target.x)/CELL)-8; x <= Math.floor(Math.max(start.x,target.x)/CELL)+8; x++) put(x,y,'.');
  for (let y = wallZ-3; y <= wallZ+3; y++) put(wallX,y,'B');
  for (const u of g.units.values()) { u.holdFire=true; u.autoRetreat=false; }
  g.terrainVersion++; await tick(4);
  const pausedSnapshot = async () => {
    host.send({t:'pause'}); await host.barrier();
    server.rooms.get('worldmove').pauseSentAt = server.clock.now()-1001;
    await tick(2);
  };
  host.send({t:'move',orders:[[rifle.id,target.x,target.z]]}); await host.barrier(); await pausedSnapshot();
  const plan = host.latest.plans.find(p => p[0]===rifle.id);
  assert.deepEqual(plan.slice(1,4),[1,target.x,target.z], 'long move retains its clicked destination in the delivered order');
  assert.ok(plan.length >= 6, 'a long move has a usable first route leg');
  assert.ok(Math.hypot(plan.at(-2)-start.x,plan.at(-1)-start.z) < 100, 'the first scouting leg stays near the squad');
  // Change a private distant cell and repeat the same order from the same position.
  const before = [...plan];
  host.send({t:'resume'}); await host.barrier();
  put(wallX+direction*90,wallZ+10,'B',3); g.terrainVersion++;
  host.send({t:'move',orders:[[rifle.id,target.x,target.z]]}); await host.barrier();
  await pausedSnapshot();
  assert.deepEqual(host.latest.plans.find(p=>p[0]===rifle.id),before, 'unseen terrain cannot alter the same visible movement plan');
  host.send({t:'resume'}); await host.barrier();
  const queued = {x:start.x+direction*90,z:start.z};
  host.send({t:'move',queue:true,orders:[[rifle.id,queued.x,queued.z]]}); await host.barrier();
  let reached = false, detoured = false;
  for (let n=0; n<1000 && !reached; n+=2) {
    await tick(2); const row=host.units.get(rifle.id); assert.ok(row,'moving squad remains in its own snapshot');
    const x=Math.floor(row[3]/CELL), z=Math.floor(row[4]/CELL);
    assert.ok(x!==wallX || z<wallZ-3 || z>wallZ+3, 'ordinary movement never enters the wall');
    detoured ||= Math.abs(row[4]-start.z)>5;
    reached = Math.hypot(row[3]-target.x,row[4]-target.z)<3;
  }
  assert.ok(detoured,'scouting finds and routes around the newly discovered wall');
  assert.ok(reached,'the original order completes across several route legs before the queued order starts');
  let queuedReached = false;
  for (let n=0; n<500 && !queuedReached; n+=2) {
    await tick(2); const row=host.units.get(rifle.id);
    queuedReached = Math.hypot(row[3]-queued.x,row[4]-queued.z)<3;
  }
  assert.ok(queuedReached,'the waiting move executes after the complete long move');
  // A stop cancels a second long move and prevents a frontier retry from resuming it.
  host.send({t:'move',orders:[[rifle.id,target.x+direction*90,start.z]]}); await host.barrier();
  host.send({t:'stop',ids:[rifle.id]}); await host.barrier(); await tick(4);
  const stopped = host.units.get(rifle.id).slice(3,5); await tick(30);
  assert.deepEqual(host.units.get(rifle.id).slice(3,5),stopped,'stop keeps a canceled long move stopped');
  // Retreat has the same continuation requirement when its friendly destination is distant.
  host.send({t:'move',orders:[[rifle.id,target.x,target.z]]}); await host.barrier();
  let far = false;
  for (let n=0;n<400 && !far;n+=2) { await tick(2); const row=host.units.get(rifle.id); far=Math.hypot(row[3]-target.x,row[4]-target.z)<3; }
  assert.ok(far,'squad can make another long approach');
  host.send({t:'retreat',ids:[rifle.id]}); await host.barrier();
  let returned = false;
  for (let n=0;n<800 && !returned;n+=2) {
    await tick(2); const row=host.units.get(rifle.id);
    returned=Math.hypot(row[3]-start.x,row[4]-start.z)<CFG.reinforceRadius+1 && !(row[12]&1);
  }
  assert.ok(returned,'retreat continues through its route legs to friendly ground');
  assert.equal(host.denied.length,0,'movement and stop use accepted normal commands');
  console.log('World long movement, hidden terrain, collision, continued arrival and stop checked');
} finally {
  server.clock.setTimeout=()=>null;
  for (const c of clients) c.ws.terminate();
  for (const ws of server.wss.clients) ws.terminate();
  server.rooms.clear();
  await new Promise(resolve=>server.wss.close(resolve));
  await new Promise(resolve=>server.server.close(resolve));
}
