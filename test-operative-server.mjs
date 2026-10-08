import assert from 'node:assert/strict';
import WebSocket from 'ws';
Object.assign(process.env,{PORT:'0',HOST:'127.0.0.1',EDIT_PASSWORD:'test',PUBLIC_URL:'http://test'});
const srv=await import('./server.js'); clearInterval(srv.loop);
if(!srv.server.listening) await new Promise(r=>srv.server.once('listening',r));
const clients=[]; const settle=()=>new Promise(r=>setTimeout(r,25));
async function wait(fn) {for(let i=0;i<120;i++){const v=fn();if(v)return v;await settle();}assert.fail('missing expected socket message');}
async function connect(token,role,commander=0){
 const ws=new WebSocket(`ws://127.0.0.1:${srv.server.address().port}/ws?room=fpscheck`),messages=[];
 ws.on('message',raw=>messages.push(JSON.parse(raw)));clients.push(ws);
 await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j);});
 const c={ws,messages,last:t=>messages.filter(m=>m.t===t).at(-1),send:m=>ws.send(JSON.stringify(m))};
 c.send({t:'hello',token,name:token,role,commander});await wait(()=>c.last('lobby')||c.last('deny')); return c;
}
try{
 const host=await connect('host'), enemy=await connect('enemy');
 const op=await connect('friend','operative');
 assert.equal(op.last('lobby').role,'operative','operative joins as companion, not commander or full-map spectator');
 const room=srv.rooms.get('fpscheck'); assert.equal(room.players.length,2);
 let releaseList; const oldList=srv.mapFiles.list;
 srv.mapFiles.list=()=>new Promise(r=>{releaseList=()=>r(oldList());});
 host.send({t:'start'});await wait(()=>room.game && releaseList);srv.tickRooms();srv.tickRooms();await settle();
 assert.equal(op.last('s'),undefined,'no snapshots before start initializes battlefield');
 releaseList();srv.mapFiles.list=oldList; await wait(()=>op.last('start'));
 assert.equal(op.last('start').role,'operative'); assert.ok(op.last('start').fog,'operative gets actual fog mask');
 const g=room.game, state=g.operatives.get('friend'), unit=g.units.get(state.unitId);
 const own=[...g.units.values()].find(u=>u.owner===0&&u.type==='rifle'&&!u.operative);
 const before=own.path.length;op.send({t:'move',orders:[[own.id,100,100]]});await settle();assert.equal(own.path.length,before,'operative cannot command army');
 host.send({t:'move',orders:[[unit.id,100,100]]});await settle();assert.equal(unit.path.length,0,'commander cannot order operative');
 op.send({t:'fps',seq:0,forward:1,strafe:0,yaw:0,pitch:0});await wait(()=>state.lastSeq===0);const x=unit.x;
 for(let i=0;i<4;i++)srv.tickRooms(); await wait(()=>op.last('s'));
 assert.ok(unit.x>x,'socket input advances authoritative soldier');
 const snap=op.last('s'); assert.equal(snap.operative.id,unit.id);assert.ok(snap.units.every(row=>row[2]!==1),'hidden enemy is not leaked');
 assert.equal(snap.plans,undefined,'operative does not receive private army orders');
 assert.equal(snap.productionJobs,undefined);
 const hidden=[...g.units.values()].find(u=>u.owner===1);
 const first=state.unitId;op.ws.close(); await wait(()=>!state.online);
 assert.equal(room.pause,null,'companion drop does not pause commander');
 const reconnect=await connect('friend','operative');await wait(()=>reconnect.last('start'));assert.equal(state.unitId,first);
 assert.equal(state.online,true); reconnect.send({t:'fps',seq:0,forward:0,strafe:0,yaw:1,pitch:0});await wait(()=>state.lastSeq===0);assert.equal(state.lastSeq,0,'reconnect sequence resets');
 host.send({t:'end'});await wait(()=>room.state==='lobby');
 assert.equal(reconnect.last('lobby').role,'operative','role survives match end');
 console.log('PASS real WS role/join, same sim movement, army authority, fog privacy, independent delta stream, disconnect/reconnect and match end');
}finally{for(const ws of clients)ws.terminate();srv.wss.close();await new Promise(r=>srv.server.close(r));}
