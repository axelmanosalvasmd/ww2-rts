import { Receiver, packet, decode, chooseTransport } from './protocol.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const bounded=(p,ms=3000)=>Promise.race([p,new Promise((_,reject)=>setTimeout(()=>reject(new Error('timeout')),ms))]);
window.run=async({secret,optIn=false,impair=false,count=60,interval=10,closeAt=null,badHash=false})=>{
 const ws=new WebSocket(location.origin.replace('http','ws')+'/control');
 const receiver=new Receiver(), received=[], rtts=[], ages=[], gaps=[], acks=[];
 let grant, grantResolve, baselineResolve, lastArrival, session;
 const gp=new Promise(r=>grantResolve=r), bp=new Promise(r=>baselineResolve=r);
 const sent=new Map();
 function accept(m){
  const now=performance.now();
  if(m.t==='grant'){grant=m;receiver.bind(m.session);grantResolve();return;}
  if(m.t==='baseline'){receiver.baseline(m);baselineResolve();return;}
  if(m.t==='orderAck'){acks.push(m.id);return;}
  received.push(m.seq);if(sent.has(m.seq))rtts.push(now-sent.get(m.seq));
  if(receiver.motion(m)) {if(lastArrival!==undefined)gaps.push(now-lastArrival);lastArrival=now;}
 }
 ws.onmessage=e=>accept(JSON.parse(e.data));
 await bounded(new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;}));
 ws.send(JSON.stringify({t:'hello',seat:0,secret}));await bounded(gp);await bounded(bp);
 let transport='websocket', reliability=null,maxDatagramSize=null,fallbackReason=null,writer;
 if(optIn && 'WebTransport' in window){
  try{
   session=new WebTransport(grant.url,{serverCertificateHashes:[{algorithm:'sha-256',value:new Uint8Array(badHash ? new Array(32).fill(0) : grant.hash)}],requireUnreliable:true});
   session.closed.catch(()=>{});await bounded(session.ready);reliability=session.reliability ?? 'API absent: requireUnreliable handshake';maxDatagramSize=session.datagrams.maxDatagramSize;
   if(session.reliability !== undefined && session.reliability !== 'supports-unreliable')throw new Error('unreliable not supported');
   if(maxDatagramSize<1000)throw new Error('datagram size below protocol cap');
   const stream=await bounded(session.createBidirectionalStream()),aw=stream.writable.getWriter(),ar=stream.readable.getReader();
   await aw.write(new TextEncoder().encode(JSON.stringify({token:grant.token,session:grant.session})+'\n'));await aw.close();
   let txt='';while(!txt.includes('\n')){const x=await bounded(ar.read());if(x.done)break;txt+=new TextDecoder().decode(x.value);}
   if(!JSON.parse(txt).ok)throw new Error('auth denied');
   writer=session.datagrams.writable.getWriter();const reader=session.datagrams.readable.getReader();
   (async()=>{try{while(true){const x=await reader.read();if(x.done)break;accept(decode(x.value));}}catch{}})();
   transport='webtransport';
   session.closed.then(()=>{transport='websocket';writer=null;},()=>{transport='websocket';writer=null;});
  }catch(e){fallbackReason=String(e);session?.close();session=null;}
 }
 const start=performance.now();
 for(let seq=1;seq<=count;seq++){
  if(seq===closeAt){session?.close();await sleep(30);transport='websocket';writer=null;}
  const m={t:'motion',session:grant.session,revision:1,id:1,epoch:1,seq,x:seq,z:0,rot:0,impair};sent.set(seq,performance.now());
  if(transport==='webtransport')await writer.write(packet(m));else ws.send(JSON.stringify(m));
  ws.send(JSON.stringify({t:'order',id:seq}));
  await sleep(interval);
  const held=receiver.units.get(1);ages.push(performance.now()-(sent.get(held?.seq)??start));
 }
 await sleep(180);
 const held=receiver.units.get(1);
 const result={transport,reliability,maxDatagramSize,fallbackReason,secureContext:isSecureContext,count,interval,impair,received,rtts,ages,gaps,orderAcks:acks.length,finalSeq:held.seq,finalX:held.x};
 session?.close();ws.close();return result;
};
window.deny=async({url,hash})=>{
 const t=new WebTransport(url,{serverCertificateHashes:[{algorithm:'sha-256',value:new Uint8Array(hash)}],requireUnreliable:true});t.closed.catch(()=>{});await bounded(t.ready);
 const s=await t.createBidirectionalStream(),w=s.writable.getWriter(),r=s.readable.getReader();
 await w.write(new TextEncoder().encode('{"token":"not-a-grant","session":"wrong"}\n'));await w.close();
 let txt='';while(!txt.includes('\n')){const x=await bounded(r.read());if(x.done)break;txt+=new TextDecoder().decode(x.value);}t.close();return JSON.parse(txt);
};
