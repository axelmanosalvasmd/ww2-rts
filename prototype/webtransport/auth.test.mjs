import {start} from './server.mjs';
import WebSocket from 'ws';
import assert from 'node:assert/strict';
const s=await start();const sockets=[];
const connect=async secret=>{const w=new WebSocket(s.httpURL.replace('http','ws')+'/control');sockets.push(w);await new Promise(r=>w.once('open',r));w.send(JSON.stringify({t:'hello',seat:0,secret}));return w;};
try{
 const bad=await connect('wrong');assert.equal(await new Promise(r=>bad.once('close',c=>r(c))),1008);
 const a=await connect(s.seatSecret);const grantA=await new Promise(r=>a.on('message',raw=>{const m=JSON.parse(raw);if(m.t==='grant')r(m);}));
 const closed=new Promise(r=>a.once('close',c=>r(c)));
 const b=await connect(s.seatSecret);const grantB=await new Promise(r=>b.on('message',raw=>{const m=JSON.parse(raw);if(m.t==='grant')r(m);}));
 assert.equal(await closed,1000);assert.notEqual(grantA.session,grantB.session);
 b.send(JSON.stringify({t:'motion',session:grantA.session,revision:1,id:1,epoch:1,seq:99,x:99,z:0,rot:0}));
 b.send(JSON.stringify({t:'order',id:1}));
 const got=await new Promise(r=>b.once('message',raw=>r(JSON.parse(raw))));assert.equal(got.t,'orderAck');
 b.send(JSON.stringify({t:'resync'}));const baseline=await new Promise(r=>b.once('message',raw=>r(JSON.parse(raw))));assert.equal(baseline.t,'baseline');assert.equal(baseline.revision,2);assert.equal(baseline.units[0].x,999);
 console.log(JSON.stringify({passed:4,failed:0,cases:['bad seat credential denied','replacement closes old reliable socket and changes session','old session cannot inject motion','reliable resync returns independent baseline']}));
}finally{for(const w of sockets)w.terminate();await s.stop();}
