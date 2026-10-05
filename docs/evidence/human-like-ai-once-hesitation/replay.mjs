import {readFileSync,writeFileSync} from 'node:fs';
const root=process.env.SRC??'/tmp/r6-repeat-intent/v15-before',seed=1,level='easy';
const sim=await import(root+'/shared/sim.js'),ai=await import(root+'/shared/ai.js');
function seededRandom(initial){let value=initial>>>0;return()=>{let t=value+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
const old=Math.random;Math.random=seededRandom(seed);
globalThis.diagnosticProposals=[];globalThis.diagnosticDetails=[];const out={root,seed,level,commands:[],inputs:[],actorTrace:[],proposals:globalThis.diagnosticProposals,details:globalThis.diagnosticDetails};
try{
 const map=JSON.parse(readFileSync(root+'/maps/default.json','utf8')),slots=sim.spawnsFor(map,'conquest').length;
 const g=sim.createGame(map,Array.from({length:slots},(_,i)=>'AI '+i),true,Array.from({length:slots},(_,i)=>i),Array.from({length:slots},(_,i)=>i%3),{mode:'conquest',worldSeed:seed,army:'standard'});
 const memories=g.players.map(()=>({})),views=g.players.map((_,slot)=>{ai.startCommander(g,slot,{w:g.w,h:g.h,spawn:g.players[slot].spawn,level,seed},{memory:memories[slot]});return null;});
 for(let t=0;t<1660&&g.winner===null;t++){
  sim.step(g);if(g.tick%2===0){const cache=sim.snapshotCache(g);g.players.forEach((p,slot)=>views[slot]=ai.observe(g,slot,cache));}
  g.players.forEach((p,slot)=>{if(!views[slot])return;const mem=memories[slot];ai.think(g,slot,{level,seed,memory:mem,view:views[slot],inputLog:input=>{if(slot===0)out.inputs.push(structuredClone(input));},submit:cmd=>{
   const planned=mem.human.hands.active?.job.command,unit=g.units.get(3);
   const row={tick:g.tick,slot,command:structuredClone(cmd),planned:structuredClone(planned),actor16:unit?{x:unit.x,z:unit.z,path:unit.path.length}:null,history16:structuredClone(mem.human.orderHistory?.get(16))};
   const result=sim.command(g,slot,cmd);row.accepted=result===undefined;row.result=result;out.commands.push(row);return result;
  }});});
  if((g.tick>=780&&g.tick<=1040||g.tick>=1550&&g.tick<=1710||g.tick>=2440&&g.tick<=2640||g.tick>=2820&&g.tick<=3000)){const s=memories[0].human,h=s.hands;out.actorTrace.push({tick:g.tick,concern:structuredClone(s.concern),planned:s.planned,deliberateUntil:s.deliberateUntil,noWorkUntil:s.noWorkUntil,cameraVisit:s.cameraVisit,selected:[...h.selected],budget:h.inputTicks.length,hesitation:structuredClone(s.advanceHesitation),active:h.active?{command:h.active.job.command,context:h.active.job.context,index:h.active.index,action:h.active.actions[h.active.index]?.kind,start:h.active.start,due:h.active.due,reacting:h.active.reacting}:null,queue:h.queue.map(j=>({command:j.command,context:j.context})),situation:structuredClone(memories[0].mind?.sit)});}
  if(g.tick%2===0){g.shots=[];g.newCells=[];}
 }
}finally{Math.random=old;}
writeFileSync(process.env.OUT??'/tmp/r6-repeat-intent/v15-replay.json',JSON.stringify(out));
console.log('Diagnostic replay completed');
