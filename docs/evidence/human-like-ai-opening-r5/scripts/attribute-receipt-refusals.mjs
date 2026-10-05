import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const evidence='/tmp/human-ai-opening-receipt-followup';
function rng(initial){let value=initial>>>0;return()=>{let t=value+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
const result={status:'PASS',method:'Exact immutable-source replay of every affected match only through its last rejected purchase; every emitted native input and actual command/resources/acceptance must equal retained original prefix. No source edits or new campaign.',cases:[],matches:[]};
for(const treatment of ['candidate']){
 const source='/tmp/human-ai-opening-receipt-source',sim=await import(`${source}/shared/sim.js`),ai=await import(`${source}/shared/ai.js`),oracle=await import(`${source}/tools/ai-screen-v1-oracle.js`),map=JSON.parse(await readFile(`${source}/maps/default.json`,'utf8'));
 const manifest=JSON.parse(await readFile(`${evidence}/${treatment}/raw-manifest.json`,'utf8'));
 for(const entry of manifest){
  const saved=JSON.parse(await readFile(entry.path,'utf8')),failures=saved.logs.flatMap((log,slot)=>log.commands.filter(c=>c.command.t==='buy'&&!c.accepted).map(command=>({slot,command})));if(!failures.length)continue;
  const end=Math.max(...failures.map(f=>f.command.tick));Math.random=rng(saved.seed);
  const slots=sim.spawnsFor(map,'conquest').length,g=sim.createGame(map,Array.from({length:slots},(_,i)=>`AI ${i}`),true,Array.from({length:slots},(_,i)=>i),Array.from({length:slots},(_,i)=>i%3),{mode:'conquest',worldSeed:saved.seed,army:'standard'});
  const cache=sim.snapshotCache(g),views=g.players.map((_,slot)=>ai.observe(g,slot,cache)),frames=new Map(),automatic=[],inputs=g.players.map(()=>[]),commands=g.players.map(()=>[]);
  while(g.tick<end){
   const previousMP=g.players.map(p=>p.mp),previousHP=new Map([...g.units].map(([id,u])=>[id,u.hp]));sim.step(g);g.players.forEach((p,slot)=>{if(p.mp<previousMP[slot]-1e-6)automatic.push({slot,tick:g.tick,mpBefore:previousMP[slot],mpAfter:p.mp,income:p.inc,unitHealthGains:[...g.units.values()].filter(u=>u.owner===slot&&previousHP.has(u.id)&&u.hp>previousHP.get(u.id)).map(u=>({id:u.id,type:u.type,beforeHP:previousHP.get(u.id),afterHP:u.hp,x:u.x,z:u.z}))});});if(g.tick%2===0||g.winner!==null){const cache=sim.snapshotCache(g);g.players.forEach((_,slot)=>views[slot]=ai.observe(g,slot,cache));}
   g.players.forEach((p,slot)=>{
    const view=views[slot];frames.set(`${slot}:${g.tick}`,{actualMP:p.mp,actualFuel:p.fuel??0,observationTick:view.tick,observedMP:view.players[slot].mp,observedFuel:view.players[slot].fuel??0});
    ai.think(g,slot,{level:saved.level,view,seed:saved.seed,perceptionMeasurements:{measureRaw:oracle.perceive,onMeasurements:()=>{}},inputLog:input=>{
     const row=structuredClone(input);if((!row.concernTarget||!Number.isFinite(row.concernTarget.x)||!Number.isFinite(row.concernTarget.z))&&typeof row.concern==='string'){const point=/^point:(.+)$/.exec(row.concern);const target=point?(view.points.some(p=>p.id!=null)?view.points.find(p=>String(p.id)===point[1]):view.points[Number(point[1])]):null;if(target&&Number.isFinite(target.x)&&Number.isFinite(target.z))row.concernTarget={x:target.x,z:target.z};}inputs[slot].push(row);
    },submit:command=>{const before={mp:p.mp,fuel:p.fuel??0},response=sim.command(g,slot,command),after={mp:p.mp,fuel:p.fuel??0};commands[slot].push({tick:g.tick,command:structuredClone(command),accepted:response===undefined,rejectionReason:typeof response==='string'?response:response===undefined?null:'unknown',resourcesBefore:before,resourcesAfter:after});return response;}});
   });
   if(g.tick%2===0||g.winner!==null){g.shots=[];g.newCells=[];}
  }
  for(let slot=0;slot<slots;slot++){
   assert.deepEqual(JSON.parse(JSON.stringify(inputs[slot])),saved.logs[slot].inputs.filter(i=>i.tick<=end),`native inputs ${treatment}/${saved.level}/${saved.seed}/${slot}`);
   assert.deepEqual(commands[slot],saved.logs[slot].commands.filter(c=>c.tick<=end).map(({tick,command,accepted,rejectionReason,resourcesBefore,resourcesAfter})=>({tick,command,accepted,rejectionReason,resourcesBefore,resourcesAfter})),`command/resource prefix ${treatment}/${saved.level}/${saved.seed}/${slot}`);
  }
  for(const{slot,command:c}of failures){
   const log=saved.logs[slot],input=log.inputs.find(i=>i.tick===c.tick&&JSON.stringify(i.command)===JSON.stringify(c.command)),frame=frames.get(`${slot}:${input.queuedTick}`);assert.ok(frame);
   const group=log.inputs.filter(i=>i.command?.t==='buy'&&i.cycle===input.cycle&&i.queuedTick===input.queuedTick).map(i=>({tick:i.tick,unit:i.command.unit,price:sim.priceOf(views[slot],i.command.unit),accepted:log.commands.find(c=>c.tick===i.tick&&JSON.stringify(c.command)===JSON.stringify(i.command))?.accepted}));
   const sinceObserved=log.commands.filter(q=>q.tick>=frame.observationTick&&q.tick<=input.queuedTick&&q.spend.mp>0),whileQueued=log.commands.filter(q=>q.tick>input.queuedTick&&q.tick<c.tick&&q.spend.mp>0),batchCost=group.reduce((n,i)=>n+i.price.mp,0);
   const classification=frame.actualMP<c.purchasePrice.mp&&frame.observedMP>=c.purchasePrice.mp?'stale-observation-after-accepted-deduction':batchCost>frame.observedMP?'decision-batch-observed-budget-overspend':whileQueued.length?'accepted-spending-after-enqueue':frame.observedMP<c.purchasePrice.mp?'planner-authorized-unaffordable-observed-purchase':'other';
   result.cases.push({treatment,level:saved.level,seed:saved.seed,slot,faction:saved.seats[slot].faction,refusedTick:c.tick,queuedTick:input.queuedTick,cycle:input.cycle,command:c.command,price:c.purchasePrice,rejectionReason:c.rejectionReason,enqueue:frame,click:c.resourcesBefore,acceptedDeductionsSinceObserved:sinceObserved,acceptedDeductionsWhileQueued:whileQueued,batchCost,batch:group,classification,automaticMPDecreasesWhileQueued:automatic.filter(a=>a.slot===slot&&a.tick>input.queuedTick&&a.tick<=c.tick)});
  }
  result.matches.push({treatment,level:saved.level,seed:saved.seed,throughTick:end,allNativeInputsExact:true,allCommandsResourcesAcceptanceExact:true});console.log(JSON.stringify({treatment,level:saved.level,seed:saved.seed,status:'exact-prefix-PASS',throughTick:end}));
 }
}
result.counts=Object.fromEntries(['base','candidate'].map(t=>[t,result.cases.filter(c=>c.treatment===t).reduce((n,c)=>(n[c.classification]=(n[c.classification]??0)+1,n),{})]));
await writeFile(`${evidence}/remaining-refusal-attribution.json`,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:result.status,counts:result.counts,cases:result.cases.length,matches:result.matches.length}));
