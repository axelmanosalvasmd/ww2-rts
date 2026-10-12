import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import WebSocket from '../../node_modules/ws/wrapper.mjs';
import {writeFileSync} from 'node:fs';
const origin=process.env.WW2_SMOKE_ORIGIN;
if(!origin||new URL(origin).protocol!=='https:')throw Error('Set WW2_SMOKE_ORIGIN to the authorized tailnet HTTPS origin');
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader']});
try{
 const context=await browser.newContext({viewport:{width:800,height:600}});
 await context.addInitScript(()=>{localStorage.setItem('ww2-controls-seen','1');localStorage.setItem('ww2-gfx','low');const raf=requestAnimationFrame.bind(window);window.requestAnimationFrame=f=>raf(()=>setTimeout(()=>f(performance.now()),100));});
 const p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(origin+'/play?transport=webtransport&name=TailnetSmoke#t'+Date.now().toString(36));
 await p.locator('#start').waitFor({state:'visible'});
 await p.waitForFunction(()=>window.__gameTransport?.mode==='WebTransport',null,{timeout:12000}).catch(async e=>{console.log('CLIENT',await p.evaluate(()=>document.querySelector('#transportIndicator')?.textContent));throw e;});
 await p.locator('#sandboxChk').check();await p.locator('#start').click();
 await p.waitForFunction(()=>__gameTransport.stats.applied>0,null,{timeout:12000});
 const proof=await p.evaluate(()=>({secureContext:isSecureContext,native:__gameTransport.native instanceof WebTransport,url:__gameTransport.native.url,reliability:__gameTransport.native.reliability,maxDatagramSize:__gameTransport.native.datagrams.maxDatagramSize,mode:__gameTransport.mode,stats:{...__gameTransport.stats},indicator:document.querySelector('#transportIndicator').textContent}));
 const denied=await new Promise((resolve,reject)=>{const ws=new WebSocket(origin.replace('https:','wss:')+'/ws?room=originbad',{origin:'https://evil.invalid'});ws.on('open',()=>{ws.close();reject(Error('bad origin accepted'));});ws.on('unexpected-response',(_,res)=>{res.resume();ws.terminate();resolve(res.statusCode);});ws.on('error',()=>{});setTimeout(()=>reject(Error('origin test timeout')),5000).unref();});
 assert.equal(denied,401);assert(proof.secureContext&&proof.native&&proof.stats.applied>0);assert.deepEqual(errors,[]);
 // Cross-origin native connection is closed before any auth stream, even with a fresh real grant.
 const auth=await p.evaluate(async()=>{
  const ws=new WebSocket(location.origin.replace('https:','wss:')+'/ws?room=tailauth');
  const grant=new Promise(r=>ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.t==='wtGrant')r(m);});
  await new Promise(r=>ws.onopen=r);ws.send(JSON.stringify({t:'hello',token:crypto.randomUUID(),name:'Auth smoke',webtransport:true}));
  const g=await grant;
  async function connect(token){const t=new WebTransport(g.url,{requireUnreliable:true,serverCertificateHashes:[{algorithm:'sha-256',value:new Uint8Array(g.hash)}]});t.closed.catch(()=>{});await t.ready;const s=await t.createBidirectionalStream(),w=s.writable.getWriter();await w.write(new TextEncoder().encode(JSON.stringify({token,generation:g.generation})+'\n'));await w.close();const r=s.readable.getReader(),m=await r.read();const ok=JSON.parse(new TextDecoder().decode(m.value)).ok;await r.cancel();t.close();return ok;}
  const invalid=await connect('invalid').catch(()=>false),valid=await connect(g.token),replay=await connect(g.token).catch(()=>false);ws.close();return {url:g.url,hashLength:g.hash.length,invalid,valid,replay};
 });
 assert.equal(new URL(auth.url).pathname,'/game-motion');assert.equal(new URL(auth.url).protocol,'https:');assert.equal(auth.hashLength,32);assert(!auth.invalid&&auth.valid&&!auth.replay);
 const grant=await p.evaluate(async()=>{const ws=new WebSocket(location.origin.replace('https:','wss:')+'/ws?room=originquic');window.originProbeWs=ws;const g=new Promise(r=>ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.t==='wtGrant')r(m);});await new Promise(r=>ws.onopen=r);ws.send(JSON.stringify({t:'hello',token:crypto.randomUUID(),name:'Origin check',webtransport:true}));return g;});
 const other=await context.newPage();await other.goto(process.env.WW2_SMOKE_BACKEND||'http://127.0.0.1:3200/');
 const badQuicOriginDenied=await other.evaluate(async g=>{const t=new WebTransport(g.url,{requireUnreliable:true,serverCertificateHashes:[{algorithm:'sha-256',value:new Uint8Array(g.hash)}]});t.closed.catch(()=>{});try{await t.ready;t.close();return false;}catch{return true;}},grant);assert(badQuicOriginDenied);await other.close();await p.evaluate(()=>originProbeWs.close());
 const result={origin,proof,badWssOriginStatus:denied,badQuicOriginDenied,auth,errors,scope:'Local browser to actual tailnet HTTPS/WSS and UDP QUIC address, not remote peer browser'};
 writeFileSync(new URL('./artifacts/tailnet-smoke.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser.close();}
