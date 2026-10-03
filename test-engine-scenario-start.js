// A rejected mission must restore the live room rather than leave a partial match.
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { validateMap } from './shared/sim.js';
Object.assign(process.env,{PORT:'0',PUBLIC_URL:'http://test',EDIT_PASSWORD:'test'});
const service=await import('./server.js');clearInterval(service.loop);
if(!service.server.listening) await new Promise(resolve=>service.server.once('listening',resolve));
service.clock.setTimeout=()=>null;
const originalRead=service.mapFiles.read, originalList=service.mapFiles.list, clients=[];
let fixture={name:'Start rollback',w:24,h:24,rows:Array(24).fill('.'.repeat(24)),spawns:[{x:2,y:2},{x:21,y:21}],points:[{x:12,y:12}],scenario:{version:1,areas:[],objectives:[],groups:[{id:'elite',units:[{id:'leader',type:'tiger',side:0,x:9,y:9}]}],triggers:[]}};
service.mapFiles.read=name=>name==='scenario-start-test'?Promise.resolve(JSON.stringify(fixture)):originalRead(name);
service.mapFiles.list=async()=>[...await originalList(),'scenario-start-test.json'];
const settle=()=>new Promise(resolve=>setTimeout(resolve,10));
async function until(fn,label) { const end=Date.now()+10000;while(Date.now()<end) { const value=fn();if(value)return value;await settle(); }assert.fail(label); }
async function connect(token) {
 const ws=new WebSocket(`ws://127.0.0.1:${service.server.address().port}/ws?room=scenstart`,{perMessageDeflate:false}), messages=[];
 const client={ws,messages,async send(value){ws.send(JSON.stringify(value));await settle();},wait:(t,after=0)=>until(()=>messages.slice(after).find(m=>m.t===t),`missing ${t}`)};clients.push(client);
 ws.on('message',data=>messages.push(JSON.parse(data)));await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});await client.send({t:'hello',token,name:token});await client.wait('lobby');return client;
}
try {
 assert.equal(validateMap(fixture),null,'map contract is valid before match faction selection');
 const host=await connect('host'), guest=await connect('guest');await host.send({t:'map',name:'scenario-start-test'});
 const room=service.rooms.get('scenstart');let before=host.messages.length;await host.send({t:'start'});
 assert.equal((await host.wait('deny',before)).reason,'scenario');await host.wait('lobby',before);
 assert.equal(room.state,'lobby');assert.equal(room.game,null);assert.equal(room.starting,null);assert.equal(room.matchId,0);
 assert.equal(host.messages.slice(before).filter(m=>m.t==='start').length,0,'failed setup sends no partial start');
 await host.send({t:'faction',slot:0,v:1});before=host.messages.length;await host.send({t:'start'});await host.wait('start',before);await guest.wait('start');
 const game=room.game,matchId=room.matchId,map=room.map;assert.equal(room.state,'play');assert(game.scenario.units.leader);
 fixture=structuredClone(fixture);fixture.scenario.groups[0].units[0].type='churchill';before=host.messages.length;await host.send({t:'restart'});
 assert.equal((await host.wait('deny',before)).reason,'scenario');await host.wait('lobby',before);
 assert.equal(room.state,'play');assert.equal(room.game,game,'failed restart retains prior authoritative world');assert.equal(room.map,map);assert.equal(room.matchId,matchId);assert.equal(room.starting,null);
 const tick=game.tick;service.tickRooms();assert(game.tick>tick,'prior match continues after rejected restart');
 await host.send({t:'ping',c:17});assert.equal((await host.wait('pong')).c,17,'server remains responsive');
 console.log('Scenario start rollback checks passed');
} finally {
 service.mapFiles.read=originalRead;service.mapFiles.list=originalList;for(const c of clients)c.ws.terminate();service.rooms.clear();service.wss.close();await new Promise(resolve=>service.server.close(resolve));
}
