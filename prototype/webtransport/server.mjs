import { Http3Server, quicheLoaded } from '@fails-components/webtransport';
import { WebSocketServer } from 'ws';
import http from 'node:http';
import { randomBytes, X509Certificate } from 'node:crypto';
import { readFileSync, mkdirSync, chmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { packet, decode, validMotion } from './protocol.mjs';
const root = fileURLToPath(new URL('.', import.meta.url));
export async function start() {
  const certDir = root + 'artifacts/private'; mkdirSync(certDir,{recursive:true,mode:0o700}); chmodSync(certDir,0o700);
  execFileSync('openssl',['req','-x509','-newkey','ec','-pkeyopt','ec_paramgen_curve:P-256','-nodes','-days','7','-keyout',certDir+'/key.pem','-out',certDir+'/cert.pem','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{stdio:'ignore'});
  chmodSync(certDir+'/key.pem',0o600);
  const cert = readFileSync(certDir+'/cert.pem'), key = readFileSync(certDir+'/key.pem');
  const fingerprint = [...new X509Certificate(cert).raw];
  const hash = [...(await import('node:crypto')).createHash('sha256').update(Buffer.from(fingerprint)).digest()];
  const seatSecret = randomBytes(24).toString('hex'), seats = new Map(), grants = new Map();
  const stats = {authAccepted:0,authDenied:0,datagramsReceived:0,datagramsSent:0,wsReceived:0,appDropped:0};
  const timers = new Set();
  const later = (fn,ms) => { if(timers.size>=128)return; const t=setTimeout(()=>{timers.delete(t);fn();},ms); timers.add(t); };
  const srv = http.createServer((req,res) => {
    const files = {'/':'index.html','/client.mjs':'client.mjs','/protocol.mjs':'protocol.mjs'};
    if (!files[req.url]) {res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type',req.url.endsWith('.mjs')?'text/javascript':'text/html');
    res.end(readFileSync(root+files[req.url]));
  });
  await new Promise(resolve=>srv.listen(0,'127.0.0.1',resolve));
  const wss = new WebSocketServer({server:srv,path:'/control',maxPayload:4096});
  function active(binding) {return seats.get(binding.seat)===binding && binding.ws.readyState===1;}
  function echo(binding,m,send) {
    if (!active(binding) || !validMotion(m) || m.session!==binding.session || m.revision!==1 || m.id!==1 || m.epoch!==1) return;
    if (m.impair && m.seq%7===0) {stats.appDropped++;return;}
    const ms=m.impair?(m.seq%5===0?45:4):0;
    later(()=>{if(active(binding)) send(m);},ms);
  }
  wss.on('connection',ws=>{
    let binding;
    const deadline=setTimeout(()=>ws.close(1008,'auth timeout'),2000);
    ws.on('message',raw=>{
      let m;try {m=JSON.parse(raw);}catch {ws.close(1008);return;}
      if (!binding) {
        if(m.t!=='hello'||m.seat!==0||m.secret!==seatSecret){clearTimeout(deadline);stats.authDenied++;ws.close(1008,'denied');return;}
        clearTimeout(deadline);
        const old=seats.get(0);if(old){old.wt?.close();old.ws.close(1000,'replaced');grants.delete(old.token);}
        binding={ws,seat:0,session:randomBytes(16).toString('hex'),token:randomBytes(24).toString('hex')};
        seats.set(0,binding);grants.set(binding.token,binding);
        ws.send(JSON.stringify({t:'grant',session:binding.session,token:binding.token,url:wtURL,hash}));
        ws.send(JSON.stringify({t:'baseline',session:binding.session,revision:1,units:[{id:1,epoch:1,seq:0,x:0,z:0,rot:0,hp:100}]}));return;
      }
      if(!active(binding))return;
      if(m.t==='motion'){stats.wsReceived++;echo(binding,m,row=>{if(ws.readyState===1)ws.send(JSON.stringify(row));});}
      if(m.t==='order')ws.send(JSON.stringify({t:'orderAck',id:m.id}));
      if(m.t==='resync')ws.send(JSON.stringify({t:'baseline',session:binding.session,revision:2,units:[{id:1,epoch:1,seq:999,x:999,z:0,rot:0,hp:100}]}));
    });
    ws.on('close',()=>{clearTimeout(deadline);if(binding){grants.delete(binding.token);binding.wt?.close();if(seats.get(binding.seat)===binding)seats.delete(binding.seat);}});
  });
  await quicheLoaded;
  const quic = new Http3Server({host:'127.0.0.1',port:0,secret:randomBytes(32).toString('hex'),cert:cert.toString(),privKey:key.toString()});
  const incoming=quic.sessionStream('/motion').getReader();
  quic.startServer(); await quic.ready;
  const wtURL=`https://127.0.0.1:${quic.address().port}/motion`;
  async function serve(session) {
    session.closed.catch(()=>{});
    let binding; const timeout=setTimeout(()=>session.close({closeCode:1,reason:'auth timeout'}),2000);
    try {
      const reader=session.incomingBidirectionalStreams.getReader();
      const {value:stream,done}=await reader.read();if(done)return;
      reader.releaseLock();
      const sr=stream.readable.getReader(), sw=stream.writable.getWriter();
      let bytes=new Uint8Array(0), auth;
      while(bytes.length<1024){const part=await sr.read();if(part.done)break;if(bytes.length+part.value.length>1024)throw Error('auth bounds');bytes=Uint8Array.from([...bytes,...part.value]);if(bytes.includes(10)){auth=JSON.parse(new TextDecoder().decode(bytes).trim());break;}}
      binding=auth && grants.get(auth.token);
      if (!binding||!active(binding)||auth.session!==binding.session||binding.wt) {
        stats.authDenied++;await sw.write(new TextEncoder().encode('{"ok":false}\n'));await sw.close();session.close({closeCode:1,reason:'denied'});return;
      }
      grants.delete(binding.token);binding.wt=session;stats.authAccepted++;
      await sw.write(new TextEncoder().encode('{"ok":true}\n'));await sw.close();await sr.cancel();
      clearTimeout(timeout);
      const dr=session.datagrams.readable.getReader(), dw=session.datagrams.writable.getWriter();
      while(active(binding)) {const {value,done}=await dr.read();if(done)break;stats.datagramsReceived++;let m;try{m=decode(value);}catch{continue;}
        echo(binding,m,row=>{dw.write(packet(row)).then(()=>stats.datagramsSent++).catch(()=>{});});
      }
    } catch {} finally {clearTimeout(timeout);if(binding?.wt===session)binding.wt=null;}
  }
  (async()=>{while(true){const {value,done}=await incoming.read();if(done)break;serve(value);}})().catch(()=>{});
  return {httpURL:`http://127.0.0.1:${srv.address().port}`,wtURL,seatSecret,hash,stats,async stop(){for(const t of timers)clearTimeout(t);for(const b of seats.values()){b.wt?.close();b.ws.terminate();}wss.close();await new Promise(resolve=>srv.close(resolve));quic.stopServer();}};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const s=await start();console.log(JSON.stringify({httpURL:s.httpURL,wtURL:s.wtURL,seatSecret:s.seatSecret,hash:s.hash}));
 process.on('SIGINT',async()=>{await s.stop();process.exit(0);});
}
