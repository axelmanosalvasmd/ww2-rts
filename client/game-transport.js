import {createMotionGate,decodeMotion,MOTION_FIELDS} from './game-motion.js';
export function createGameTransport({connection,units,optIn}){
 if(!optIn)return {baseline(){},overlay(){},close(){},mode:'WebSocket',stats:{received:0,applied:0,rejected:0}};
 const gate=createMotionGate(),stats={received:0,applied:0,rejected:0,lastTick:0,lastId:0,lastX:0};let wt=null,attempt=0,last=0,acked='',mode='WebSocket',reason=optIn?'connecting':'default';
 const el=document.createElement('div');el.id='transportIndicator';Object.assign(el.style,{position:'fixed',bottom:'6px',left:'6px',zIndex:10000,background:'#111d',color:'#bdeac0',font:'12px monospace',padding:'6px',pointerEvents:'none'});document.body.append(el);
 const render=()=>{el.textContent=`${mode} | QUIC rows ${stats.applied}/${stats.received} | orders/state WS${reason?' | '+reason:''}`;};render();
 const fallback=(why)=>{mode='WebSocket';reason=why;gate.reset();render();};
 const close=(why)=>{attempt++;wt?.close();wt=null;acked='';fallback(why);};
 connection.on('retry',()=>close('reconnecting'));connection.on('replaced',()=>close('seat replaced'));connection.on('left',()=>close('left'));connection.on('start',()=>{gate.reset();acked='';});connection.on('wtUnavailable',m=>close(m.reason));
 connection.on('wtGrant',async m=>{close('connecting');const current=attempt;
 try{if(!optIn||!globalThis.WebTransport||!isSecureContext)throw Error('native WebTransport unavailable');
 const transport=new WebTransport(m.url,{requireUnreliable:true,serverCertificateHashes:[{algorithm:'sha-256',value:new Uint8Array(m.hash)}]});wt=transport;transport.closed.then(()=>{if(current===attempt)fallback('QUIC closed');},()=>{if(current===attempt)fallback('QUIC closed');});
 await Promise.race([transport.ready,new Promise((_,reject)=>setTimeout(()=>reject(Error('QUIC timeout')),3000))]);if(current!==attempt){transport.close();return;}if(transport.reliability==='reliable-only'||transport.datagrams.maxDatagramSize<1000)throw Error('unreliable datagrams unavailable');
 const stream=await transport.createBidirectionalStream(),w=stream.writable.getWriter();await w.write(new TextEncoder().encode(JSON.stringify({token:m.token,generation:m.generation})+'\n'));await w.close();const r=stream.readable.getReader();let bytes='';while(bytes.length<1024){const p=await r.read();if(p.done)break;bytes+=new TextDecoder().decode(p.value);if(bytes.includes('\n'))break;}if(!JSON.parse(bytes).ok)throw Error('QUIC auth denied');await r.cancel();if(current!==attempt){transport.close();return;}mode='WebTransport';reason='additive motion, reliable recovery';last=performance.now();render();
 const dr=transport.datagrams.readable.getReader();while(current===attempt){const p=await dr.read();if(p.done)break;stats.received++;let row;try{row=decodeMotion(p.value);}catch{stats.rejected++;continue;}if(!gate.accept(row)){stats.rejected++;continue;}const v=units.get(row[3]);if(!v){stats.rejected++;continue;}
 const [x,z,rot,aim,speed,vx,vz,travelDir]=row.slice(4);Object.assign(v,{tx:x,tz:z,trot:rot,taim:aim,moveSpeed:v.flags&16?0:speed,vx,vz,travelDir});stats.applied++;stats.lastTick=row[2];stats.lastId=row[3];stats.lastX=x;last=performance.now();mode='WebTransport';reason='additive motion, reliable recovery';render();}
 }catch(e){if(current===attempt){attempt++;wt?.close();wt=null;fallback(e.message);}}
 });
 setInterval(()=>{if(mode==='WebTransport'&&performance.now()-last>2000){mode='WebSocket';reason='QUIC idle; reliable motion';render();}},1000);
 return {stats,get mode(){return mode;},get native(){return wt;},close,baseline(s){gate.baseline(s.motion,s.units);gate.overlay(s.units,s.tick);if(s.motion){const key=s.motion.generation+':'+s.motion.revision;if(acked!==key){connection.send({t:'wtAck',generation:s.motion.generation,revision:s.motion.revision});acked=key;}}},overlay(rows,tick){gate.overlay(rows,tick);}};
}
