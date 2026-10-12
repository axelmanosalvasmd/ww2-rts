import { chromium } from 'playwright-core';
import { start } from './server.mjs';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
const dir=new URL('./artifacts/',import.meta.url);mkdirSync(dir,{recursive:true});
writeFileSync(new URL('runs.jsonl',dir),'');
const s=await start();let browser;
const quantile=(a,p)=>{const b=[...a].sort((x,y)=>x-y);return b[Math.min(b.length-1,Math.floor(p*b.length))]??null;};
const summarize=r=>({...r,rtts:undefined,ages:undefined,gaps:undefined,received:undefined,delivered:r.received.length,metrics:Object.fromEntries(['rtts','ages','gaps'].map(k=>[k,{p50:quantile(r[k],.5),p95:quantile(r[k],.95),p99:quantile(r[k],.99)}]))});
try {
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--disable-gpu',`--log-net-log=${new URL('chromium-netlog.json',dir).pathname}`]});
 const page=await browser.newPage();await page.goto(s.httpURL);await page.waitForFunction(()=>window.run);
 const proof=await page.evaluate(o=>window.run(o),{secret:s.seatSecret,optIn:true,count:12,interval:15});
 console.log('INITIAL PROOF',JSON.stringify(proof));
 assert.equal(proof.transport,'webtransport');assert.match(proof.reliability,/supports-unreliable|API absent: requireUnreliable handshake/);assert.equal(proof.received.length,12);assert.equal(proof.finalX,12);assert.equal(proof.orderAcks,12);
 const denial=await page.evaluate(o=>window.deny(o),{url:s.wtURL,hash:s.hash});assert.equal(denial.ok,false);
 const runs=[];
 for(const impair of [false,true])for(let round=0;round<3;round++)for(const optIn of (round%2?[true,false]:[false,true])){
  const r=await page.evaluate(o=>window.run(o),{secret:s.seatSecret,optIn,impair,count:60,interval:10});
  assert.equal(r.transport,optIn?'webtransport':'websocket');assert.equal(r.orderAcks,60);assert.equal(r.finalSeq,60);assert.equal(r.finalX,60);
  const row={round,...r};runs.push(row);appendFileSync(new URL('runs.jsonl',dir),JSON.stringify(row)+'\n');
 }
 const lossFallback=await page.evaluate(o=>window.run(o),{secret:s.seatSecret,optIn:true,count:12,closeAt:5});assert.equal(lossFallback.transport,'websocket');assert.equal(lossFallback.finalSeq,12);assert.equal(lossFallback.orderAcks,12);
 const certFallback=await page.evaluate(o=>window.run(o),{secret:s.seatSecret,optIn:true,count:5,badHash:true});assert.equal(certFallback.transport,'websocket');assert(certFallback.fallbackReason);assert.equal(certFallback.finalSeq,5);
 await page.evaluate(()=>{window.WebTransport=undefined;});
 const fallback=await page.evaluate(o=>window.run(o),{secret:s.seatSecret,optIn:true,count:5});assert.equal(fallback.transport,'websocket');assert.equal(fallback.finalSeq,5);
 const summary={browser:browser.version(),nativeServer:'Http3Server only (UDP QUIC, no HTTP2 backend)',proof:summarize(proof),authDenial:denial,lossFallback:summarize(lossFallback),certFallback:summarize(certFallback),fallback:summarize(fallback),serverStats:s.stats,runs:runs.map(summarize),limitation:'Deterministic application echo drop/delay, NOT network packet loss or TCP head-of-line proof.'};
 writeFileSync(new URL('browser-summary.json',dir),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
}finally{await browser?.close();await s.stop();}
