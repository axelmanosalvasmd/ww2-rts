import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const before='/tmp/human-ai-opening-paired-candidate-source',after='/tmp/human-ai-opening-receipt-source';
const sim=await import(`${after}/shared/sim.js`),ai=await import(`${after}/shared/ai.js`),old=await import(`${before}/shared/ai.js`),{perceive}=await import(`${after}/shared/ai-perception.js`),{PERSONAS}=await import(`${after}/shared/ai-persona.js`),{createRng}=await import(`${after}/shared/ai-rng.js`),{runCommander}=await import(`${after}/shared/ai-commander.js`);
const map={w:80,h:80,rows:Array(80).fill('.'.repeat(80)),spawns:[{x:5,y:5},{x:75,y:75}],points:[{x:30,y:30},{x:50,y:50}]};
function scene(){const g=sim.createGame(map,['AI','enemy'],false,[0,1],[0,1],{weather:false});g.tick=30;g.players[0].mp=500;const human={startedTick:0,buys:0,persona:{family:'support',...PERSONAS.support},camera:{...g.players[0].spawn}},view=perceive(ai.observe(g,0),0,human,30);return{g,human,view};}
function planned(module,{receipt,frame=30,decisionOnly=false,reject=false}={}){const{human,view}=scene();human.lastAcceptedBuyTick=receipt;view.tick=frame;const commands=[];module.plan(view,0,{human:true,decisionOnly,level:'normal',concern:{kind:'production',id:'production'}},{human,rng:createRng(1,0)},c=>{commands.push(structuredClone(c));return reject&&c.t==='buy'?'mp':undefined;});return{commands,human};}
const checks=[];
for(const frame of [29,30]){const x=planned(ai,{receipt:30,frame});assert.ok(!x.commands.some(c=>c.t==='buy'));assert.ok(x.commands.some(c=>['move','amove'].includes(c.t)));assert.equal(x.human.production.reason,'awaiting-buy-receipt-frame');checks.push(`stale-resource-frame${frame}/useful-nonbuy-still-proposed`);}
assert.ok(planned(ai,{receipt:30,frame:31}).commands.some(c=>c.t==='buy'));checks.push('strictly-newer-frame-resumes-buy-planning');
for(const receipt of [undefined,NaN])assert.deepEqual(planned(ai,{receipt}).commands,planned(old,{receipt}).commands);checks.push('unknown-receipt-preserves-old-native-proposals');
assert.deepEqual(planned(ai,{receipt:30,decisionOnly:true}).commands,planned(old,{receipt:30,decisionOnly:true}).commands);checks.push('explicit-decisionOnly-preserves-direct-planner-semantics');
assert.equal(planned(ai,{reject:true}).commands.filter(c=>c.t==='buy').length,1);checks.push('sender-refusal-stops-current-batch-without-receipt-or-cost-credit');
assert.equal(planned(ai).commands.filter(c=>c.t==='buy').length,2);checks.push('existing-local-price-projection-still-honors-two-affordable-mortars');
const actual=[];
for(const refusal of [false,true]){
 const g=sim.createGame(map,['AI','enemy'],false,[0,1],[0,1],{weather:false}),memory={},commands=[];let view=null;
 for(let tick=0;tick<400;tick++){
  if(g.tick%2===0||!view){view=ai.observe(g,0);view.players[0].mp=500;}
  runCommander(view,0,{tick:g.tick,level:'hard',seed:1},memory,c=>{if(refusal&&c.t==='buy')g.players[0].mp=0;const result=sim.command(g,0,c);commands.push({tick:g.tick,command:structuredClone(c),accepted:result===undefined,reason:result??null});return result;},(observation,slot,opts,mem,submit)=>{submit({t:'buy',unit:'rifle'});submit({t:'move',orders:[[1,30,30]]});});
  if(commands.some(c=>c.command.t==='buy'))break;sim.step(g);
 }
 const buy=commands.find(c=>c.command.t==='buy');assert.ok(buy);assert.equal(buy.accepted,!refusal);assert.equal(memory.human.lastAcceptedBuyTick,refusal?undefined:buy.tick);actual.push({refusal,actualBuy:buy,receiptTick:memory.human.lastAcceptedBuyTick??null});
}
checks.push('actual-engine-success-stamps-own-accepted-buy-tick','actual-engine-refusal-does-not-stamp-receipt');
const onlyMove=scene(),memory={human:onlyMove.human};runCommander(onlyMove.view,0,{tick:30,level:'hard',seed:1},memory,c=>sim.command(onlyMove.g,0,c),()=>{});assert.equal(memory.human.lastAcceptedBuyTick,undefined);checks.push('no-buy-callback-has-no-receipt');
async function pendingTrace(root){
 const native=await import(`${root}/shared/ai.js`),engine=await import(`${root}/shared/sim.js`),commander=await import(`${root}/shared/ai-commander.js`),g=engine.createGame(map,['AI','enemy'],false,[0,1],[0,1],{weather:false}),mem={},rows=[],commands=[];g.players[0].mp=500;let view=null;
 for(let tick=0;tick<400;tick++){
  if(g.tick%2===0||!view)view=native.observe(g,0);
  commander.runCommander(view,0,{tick:g.tick,level:'hard',seed:1,inputLog:row=>rows.push(JSON.parse(JSON.stringify(row)))},mem,c=>{const result=engine.command(g,0,c);commands.push({tick:g.tick,command:structuredClone(c),accepted:result===undefined,reason:result??null});return result;},(observation,slot,opts,m,submit)=>{submit({t:'buy',unit:'rifle'});submit({t:'buy',unit:'mg'});});
  if(commands.filter(c=>c.command.t==='buy').length>=2)break;engine.step(g);
 }
 assert.equal(commands.filter(c=>c.command.t==='buy'&&c.accepted).length,2);return{commands,rows};
}
assert.deepEqual(await pendingTrace(after),await pendingTrace(before));checks.push('existing-two-pending-buy-gestures-and-click-costs-remain-identical-after-first-receipt');
await writeFile('/tmp/human-ai-opening-receipt-followup/fixture-result.json',JSON.stringify({status:'PASS',checks,actual,noProductionEdits:true},null,2)+'\n');console.log(JSON.stringify({status:'PASS',checks,actual}));
