import assert from 'node:assert/strict';
import WebSocket from 'ws';
import {randomBytes} from 'node:crypto';
const base=process.argv[2];assert.ok(base?.startsWith('https://'),'public HTTPS URL required');
const room='fpsv'+randomBytes(3).toString('hex'),clients=[];
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(fn){const until=Date.now()+20000;while(Date.now()<until){const v=fn();if(v)return v;await delay(40);}throw Error('public WS expectation timed out');}
async function connect(name,role){const ws=new WebSocket(base.replace('https:','wss:')+'/ws?room='+room),messages=[],rows=new Map();clients.push(ws);ws.on('message',b=>{const m=JSON.parse(b);messages.push(m);if(m.t==='s'){if(m.all||!m.held)rows.clear();for(const id of m.gone??[])rows.delete(id);for(const r of m.units)rows.set(r[0],r);}});await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j);});const c={ws,rows,last:t=>messages.filter(m=>m.t===t).at(-1),send:m=>ws.send(JSON.stringify(m))};c.send({t:'hello',name,token:randomBytes(20).toString('hex'),role,commander:0});await wait(()=>c.last('lobby'));return c;}
try{
 for(const path of ['/','/play','/client/operative-view.js','/client/operative.css']){const r=await fetch(base+path);assert.equal(r.status,200,path);}
 const host=await connect('HTTPS commander'),enemy=await connect('HTTPS enemy'),op=await connect('HTTPS operative','operative');
 assert.equal(op.last('lobby').role,'operative');host.send({t:'start'});await wait(()=>op.last('start'));await wait(()=>op.last('s')?.operative?.id);
 const id=op.last('s').operative.id,before=op.rows.get(id).slice(3,5);let seq=0;
 for(const yaw of [Math.PI/2,0,-Math.PI/2,Math.PI]){for(let i=0;i<8;i++){op.send({t:'fps',seq:seq++,forward:1,strafe:0,yaw,pitch:0,fire:true});await delay(65);}const r=op.rows.get(id);if(r&&Math.hypot(r[3]-before[0],r[4]-before[1])>0.4)break;}
 const after=op.rows.get(id);assert.ok(Math.hypot(after[3]-before[0],after[4]-before[1])>0.4,'public WSS movement');assert.ok(op.last('s').operative.shots>0,'public WSS rifle fire');
 assert.equal(op.last('s').plans,undefined);assert.equal(op.last('s').productionJobs,undefined);assert.ok([...op.rows.values()].every(r=>r[2]!==1),'unseen enemy not leaked over public endpoint');
 host.send({t:'end'});await wait(()=>op.last('lobby').state==='lobby');
 console.log('PASS public HTTPS assets and three real WSS clients: commander + enemy + operative, match start, authoritative movement/fire, fog/private-order boundaries and match end. '+base);
}finally{for(const ws of clients)ws.close();}
