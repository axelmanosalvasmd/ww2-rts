import {Http3Server,quicheLoaded} from '@fails-components/webtransport';
import {randomBytes,createHash,X509Certificate} from 'node:crypto';
import {readFileSync,mkdirSync,mkdtempSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {MOTION_FIELDS,encodeMotion} from '../../client/game-motion.js';
export async function startGameLane({port=3101,host='127.0.0.1',advertisedHost=host,allowedOrigin=null}={}){
 // Each instance gets private short-lived keys, never overwriting a live instance's certificate.
 const root=process.env.TMPDIR||join(homedir(),'.hermes/cache/scratch');mkdirSync(root,{recursive:true,mode:0o700});
 const dir=mkdtempSync(join(root,'ww2-quic-cert-'));chmodSync(dir,0o700);
 execFileSync('openssl',['req','-x509','-newkey','ec','-pkeyopt','ec_paramgen_curve:P-256','-nodes','-days','7','-keyout',join(dir,'game-key.pem'),'-out',join(dir,'game-cert.pem'),'-subj','/CN=localhost','-addext',`subjectAltName=DNS:localhost,IP:127.0.0.1,IP:${host}`],{stdio:'ignore'});chmodSync(join(dir,'game-key.pem'),0o600);
 const cert=readFileSync(join(dir,'game-cert.pem'),'utf8'),key=readFileSync(join(dir,'game-key.pem'),'utf8'),hash=[...createHash('sha256').update(new X509Certificate(cert).raw).digest()];
 await quicheLoaded;const quic=new Http3Server({host,port,secret:randomBytes(32).toString('hex'),cert,privKey:key});const incoming=quic.sessionStream('/game-motion').getReader();if(allowedOrigin)quic.setRequestCallback(async({header})=>({status:header.origin===allowedOrigin&&header[':path']==='/game-motion'?200:403,path:'/game-motion'}));quic.startServer();await quic.ready;
 const grants=new Map(),bindings=new Set();const stats={accepted:0,denied:0,sent:0,dropped:0,orders:0};
 const active=b=>b.person.ws===b.ws&&b.ws.readyState===1&&b.room.players.includes(b.person)&&!b.person.ai;
 const revoke=b=>{clearTimeout(b.expiry);grants.delete(b.token);b.session?.close();bindings.delete(b);};
 const bind=(room,person,ws)=>{for(const old of bindings)if(old.person===person)revoke(old);const b={room,person,ws,token:randomBytes(24).toString('hex'),generation:randomBytes(16).toString('hex'),revision:0,acked:0,members:'',pending:0};b.authGeneration=b.generation;bindings.add(b);grants.set(b.token,b);b.expiry=setTimeout(()=>grants.delete(b.token),5000);ws.once('close',()=>{clearTimeout(b.expiry);revoke(b);});ws.send(JSON.stringify({t:'wtGrant',token:b.token,generation:b.generation,url:`https://${advertisedHost}:${quic.address().port}/game-motion`,hash}));return b;};
 let pendingAuth=0;
 async function serve(session){session.closed.catch(()=>{});if(pendingAuth>=32){stats.denied++;session.close();return;}pendingAuth++;let pending=true;const timer=setTimeout(()=>session.close({closeCode:1,reason:'auth timeout'}),10000);let b;
 try{const r=session.incomingBidirectionalStreams.getReader();const part=await r.read();r.releaseLock();if(part.done){session.close();return;}const sr=part.value.readable.getReader(),sw=part.value.writable.getWriter();let bytes=new Uint8Array(),auth;while(bytes.length<=1024){const p=await sr.read();if(p.done)break;if(bytes.length+p.value.length>1024)throw Error('auth bounds');bytes=Uint8Array.from([...bytes,...p.value]);if(bytes.includes(10)){auth=JSON.parse(new TextDecoder().decode(bytes).trim());break;}}
 b=auth&&grants.get(auth.token);if(!b||!active(b)||b.authGeneration!==auth.generation||b.session){stats.denied++;await sw.write(new TextEncoder().encode('{"ok":false}\n'));await sw.close();session.close();return;}
 grants.delete(b.token);b.session=session;b.writer=session.datagrams.writable.getWriter();stats.accepted++;await sw.write(new TextEncoder().encode('{"ok":true}\n'));await sw.close();await sr.cancel();clearTimeout(timer);pendingAuth--;pending=false;await session.closed;
 }catch{session.close({closeCode:1,reason:'invalid auth'});}finally{clearTimeout(timer);if(pending)pendingAuth--;if(b?.session===session){b.session=null;b.writer=null;}}
 }
 (async()=>{while(true){const p=await incoming.read();if(p.done)break;serve(p.value);}})().catch(()=>{});
 return {stats,bind,revoke,ack(b,m){if(active(b)&&m.generation===b.generation&&m.revision===b.revision)b.acked=b.revision;},reset(b){if(!b)return;b.generation=randomBytes(16).toString('hex');b.revision=0;b.acked=0;b.members='';},publish(b,msg){if(!b||!active(b))return;const members=msg.units.map(r=>r[0]).sort((a,c)=>a-c).join(',');if(members!==b.members||!b.revision){b.members=members;b.revision++;b.acked=0;}msg.motion={generation:b.generation,revision:b.revision,tick:msg.tick};if(!b.writer||b.acked!==b.revision)return;
 // Never queue more than 32 independent rows. Reliable motion still recovers all drops.
 for(const row of msg.units){if(b.pending>=32){stats.dropped++;continue;}let bytes;try{bytes=encodeMotion([b.generation,b.revision,msg.tick,row[0],...MOTION_FIELDS.map(f=>row[f]??0)]);}catch{stats.dropped++;continue;}b.pending++;b.writer.write(bytes).then(()=>stats.sent++).catch(()=>stats.dropped++).finally(()=>b.pending--);}},async stop(){for(const b of bindings){clearTimeout(b.expiry);revoke(b);}quic.stopServer();}};
}
