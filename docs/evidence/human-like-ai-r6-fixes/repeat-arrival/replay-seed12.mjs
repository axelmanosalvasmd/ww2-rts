import {readFileSync,writeFileSync} from 'node:fs';
const root=process.env.SRC??'/tmp/r6-repeat-intent/v15-before',seed=12,level='normal';
const sim=await import(root+'/shared/sim.js'),ai=await import(root+'/shared/ai.js');
function seededRandom(initial){let value=initial>>>0;return()=>{let t=value+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
const old=Math.random;Math.random=seededRandom(seed);
const out={root,seed,level,commands:[],inputs:[],actorTrace:[]};
try{
 const map=JSON.parse(readFileSync(root+'/maps/default.json','utf8')),slots=sim.spawnsFor(map,'conquest').length;
 const g=sim.createGame(map,Array.from({length:slots},(_,i)=>'AI '+i),true,Array.from({length:slots},(_,i)=>i),Array.from({length:slots},(_,i)=>i%3),{mode:'conquest',worldSeed:seed,army:'standard'});
 const memories=g.players.map(()=>({})),views=g.players.map((_,slot)=>{ai.startCommander(g,slot,{w:g.w,h:g.h,spawn:g.players[slot].spawn,level,seed},{memory:memories[slot]});return null;});
 for(let t=0;t<2400&&g.winner===null;t++){
  sim.step(g);if(g.tick%2===0){const cache=sim.snapshotCache(g);g.players.forEach((p,slot)=>views[slot]=ai.observe(g,slot,cache));}
  g.players.forEach((p,slot)=>{if(!views[slot])return;const mem=memories[slot];ai.think(g,slot,{level,seed,memory:mem,view:views[slot],inputLog:input=>{if(slot===2)out.inputs.push(structuredClone(input));},submit:cmd=>{
   const planned=mem.human.hands.active?.job.command,unit=g.units.get(16);
   const row={tick:g.tick,slot,command:structuredClone(cmd),planned:structuredClone(planned),actor16:unit?{x:unit.x,z:unit.z,path:unit.path.length}:null,history16:structuredClone(mem.human.orderHistory?.get(16))};
   const result=sim.command(g,slot,cmd);row.accepted=result===undefined;row.result=result;out.commands.push(row);return result;
  }});});
  if(g.tick>=2250&&g.tick%2===0){const u=g.units.get(16),s=memories[2].human;out.actorTrace.push({tick:g.tick,x:u?.x,z:u?.z,path:u?.path?.length,history:structuredClone(s.orderHistory?.get(16)),attention:s.concern?.id});}
  if(g.tick%2===0){g.shots=[];g.newCells=[];}
 }
}finally{Math.random=old;}
writeFileSync(process.env.OUT??'/tmp/r6-repeat-intent/v15-replay.json',JSON.stringify(out));
console.log(JSON.stringify(out.commands.filter(r=>r.slot===2&&r.command.orders?.some(o=>o[0]===16)&&r.tick>=2250),null,2));
