// Long movement and discovery acceptance through the browser's real room protocol.
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { CELL, UNITS, createGame } from './shared/sim.js';
import { generateWorldMap } from './shared/world-conquest.js';
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
  const ws = new WebSocket(`ws://127.0.0.1:${server.server.address().port}/ws?room=worldriver`, { perMessageDeflate: false });
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
  const host = await connect('river-host'); await connect('river-rival');
  host.send({t:'mode',v:'world'}); host.send({t:'start'}); await host.barrier();
  await until(() => host.start,'world start received'); await tick(4);
  // Keep the previous movement-test seed by default; network cases override it. Orders cross real sockets.
  const room = server.rooms.get('worldriver');
  room.map = generateWorldMap({ seed: Number(process.env.WORLD_RIVER_SEED ?? 4111514762), players: 2, teams: [0, 1] });
  const g = room.game = createGame(room.map, ['river-host', 'river-rival'], true, [0, 1], [0, 1], { mode: 'world', weather: 'clear' });
  for (const p of room.players) p.net = { sent: new Map(), full: true };
  await tick(4);
  const mains=room.map.world.waterways.rivers.filter(r=>r.kind==='main');
  const fords=mains.map(r=>room.map.world.waterways.crossings.find(c=>c.river===r.id&&c.type==='F'));
  const fordY=fords[0].y, riverX=fords[0].x;
  assert.ok(riverX>0,'generated mainland has its river');
  const rifle = [...g.units.values()].find(u=>u.owner===0 && u.type==='rifle');
  // Controlled deployments isolate navigation from recruitment, damage and unrelated battles.
  const start = {x:riverX*CELL-40,z:fordY*CELL}, target={x:fords.at(-1).x*CELL+60,z:fords.at(-1).y*CELL};
  Object.assign(rifle,start,{path:[],orders:[],worldGoal:null,attackId:0,targetId:0,build:0});
  // beside the rifle on its river side: the town on this seed has a house just west of the start
  const tank={...rifle,id:g.nextId++,type:'tank',hp:UNITS.tank.hpPer,x:start.x+4,z:start.z+4,path:[],orders:[],worldGoal:null};
  g.units.set(tank.id,tank);
  for (const u of g.units.values()) {u.holdFire=true;u.autoRetreat=false;u.auto=false;}
  await tick(4);
  host.send({t:'move',orders:[[rifle.id,target.x,target.z],[tank.id,target.x,target.z+4]]}); await host.barrier();
  let reached=false, ford=false;
  const crossed=new Set(), bankStates=new Map();
  for(let n=0;n<2400*mains.length && !reached;n+=4){
    await tick(4);
    const rows=[host.units.get(rifle.id),host.units.get(tank.id)];
    assert.ok(rows.every(Boolean),'both controlled forces remain visible to their owner');
    for(const row of rows) {
      const x=Math.floor(row[3]/CELL),y=Math.floor(row[4]/CELL);
      assert.notEqual(g.chars[y*g.w+x],'W','ordinary units never cross impassable water');
      if(g.chars[y*g.w+x]==='F') ford=true;
      for(const river of mains) {
        const key=`${row[0]}:${river.id}`, channel=river.path[y], delta=x-channel.x;
        const bank=delta < -channel.radius-1 ? -1 : delta > channel.radius+1 ? 1 : 0;
        const state=bankStates.get(key) ?? {bank:0,ford:false};
        const declaredFord=room.map.world.waterways.crossings.some(c=>c.river===river.id && c.type==='F' && Math.abs(y-c.y)<=4);
        if(!bank && Math.abs(delta)<=channel.radius && g.chars[y*g.w+x]==='F' && declaredFord) state.ford=true;
        if(bank) {
          if(state.bank && bank!==state.bank && state.ford) crossed.add(key);
          state.bank=bank; state.ford=false;
        }
        bankStates.set(key,state);
      }
    }
    reached=Math.hypot(rows[0][3]-target.x,rows[0][4]-target.z)<4 && Math.hypot(rows[1][3]-target.x,rows[1][4]-(target.z+4))<4;
  }
  if(!ford || !reached) console.log(JSON.stringify({seed:g.world.seed,riverX,rows:[host.units.get(rifle.id),host.units.get(tank.id)],plans:host.latest.plans.filter(p=>p[0]===rifle.id||p[0]===tank.id),routes:[rifle.path,tank.path],goals:[rifle.worldGoal,tank.worldGoal]}));
  assert.ok(ford,'the original movement order discovers and uses a ford');
  assert.ok(reached,`both long destinations complete after crossing (seed ${g.world.seed})`);
  for(const unit of [rifle,tank]) for(const river of mains) assert.ok(crossed.has(`${unit.id}:${river.id}`),`${unit.type} crossed main river ${river.id} through a ford`);
  assert.equal(host.denied.length,0,'rifle and tank use accepted ordinary move orders');
  console.log(`World rifle and tank long orders crossed all ${mains.length} main rivers through generated fords`);
} finally {
  server.clock.setTimeout=()=>null;
  for(const c of clients)c.ws.terminate();
  for(const ws of server.wss.clients)ws.terminate();server.rooms.clear();
  await new Promise(resolve=>server.wss.close(resolve));await new Promise(resolve=>server.server.close(resolve));
}
