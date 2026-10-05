import {readFileSync,writeFileSync} from 'node:fs';
import {serialize,deserialize} from 'node:v8';
const base='/tmp/human-once-hesitation/baseline',candidate='/tmp/human-once-hesitation/candidate';
const sim=await import(base+'/shared/sim.js'),ai=await import(base+'/shared/ai.js');
const seed=1,level='easy';let rngValue=seed;function simRandom(){let t=rngValue+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;}
const prior=Math.random;Math.random=simRandom;
const map=JSON.parse(readFileSync(base+'/maps/default.json')),slots=sim.spawnsFor(map,'conquest').length;
const game=sim.createGame(map,Array.from({length:slots},(_,i)=>'AI '+i),true,Array.from({length:slots},(_,i)=>i),Array.from({length:slots},(_,i)=>i%3),{mode:'conquest',worldSeed:seed,army:'standard'});
const memories=game.players.map(()=>({})),views=game.players.map((_,slot)=>{ai.startCommander(game,slot,{w:game.w,h:game.h,spawn:game.players[slot].spawn,level,seed},{memory:memories[slot]});return null;});
try{
 for(let t=0;t<1594;t++){
  sim.step(game);if(game.tick%2===0){const cache=sim.snapshotCache(game);game.players.forEach((_,slot)=>views[slot]=ai.observe(game,slot,cache));}
  game.players.forEach((_,slot)=>views[slot]&&ai.think(game,slot,{level,seed,memory:memories[slot],view:views[slot],submit:cmd=>sim.command(game,slot,cmd)}));
  if(game.tick%2===0){game.shots=[];game.newCells=[];}
 }
 // A labeled branch checkpoint preserves native game data and local memory. Recreate delivered views normally.
 for(const memory of memories){memory.human.view=undefined;memory.human.deliveredTick=undefined;memory.human.hands.resolveMinimap=undefined;}
 function portable(value, seen = new Map()) {
  if (typeof value === 'function') return undefined;
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return value;
  const out = value instanceof Map ? new Map() : value instanceof Set ? new Set() : Array.isArray(value) ? [] : {}; seen.set(value,out);
  if (value instanceof Map) for(const [key,item] of value) out.set(portable(key,seen),portable(item,seen));
  else if (value instanceof Set) for(const item of value) out.add(portable(item,seen));
  else for(const [key,item] of Object.entries(value)) if(typeof item !== 'function') out[key]=portable(item,seen);
  return out;
 }
 const checkpoint=serialize(portable({game,memories,rngValue}));writeFileSync('/tmp/human-once-hesitation/baseline-tick1594.v8',checkpoint);
 for(const [name,root]of [['baseline',base],['candidate',candidate]]){
  const nativeSim=await import(root+'/shared/sim.js'),nativeAI=await import(root+'/shared/ai.js');
  const branch=deserialize(checkpoint),g=branch.game,mems=branch.memories;let delivered=g.players.map((_,slot)=>nativeAI.observe(g,slot,nativeSim.snapshotCache(g)));rngValue=branch.rngValue;
  const out={name,checkpointTick:g.tick,level,seed,inputs:[],commands:[],states:[]};
  for(let t=0;t<90;t++){
   nativeSim.step(g);if(g.tick%2===0){const cache=nativeSim.snapshotCache(g);g.players.forEach((_,slot)=>delivered[slot]=nativeAI.observe(g,slot,cache));}
   g.players.forEach((_,slot)=>nativeAI.think(g,slot,{level,seed,memory:mems[slot],view:delivered[slot],inputLog:input=>slot===0&&out.inputs.push(structuredClone(input)),submit:cmd=>{const result=nativeSim.command(g,slot,cmd);if(slot===0)out.commands.push({tick:g.tick,command:structuredClone(cmd),accepted:result===undefined,result:result??null});return result;}}));
   const h=mems[0].human;out.states.push({tick:g.tick,concern:structuredClone(h.concern),hesitation:structuredClone(h.advanceHesitation),noWorkUntil:h.noWorkUntil,active:!!h.hands.active,queue:h.hands.queue.map(job=>structuredClone(job.command)),actor14:structuredClone(g.units.get(14))});
   if(g.tick%2===0){g.shots=[];g.newCells=[];}
  }
  writeFileSync(`/tmp/human-once-hesitation/checkpoint-${name}.json`,JSON.stringify(out));
 }
}finally{Math.random=prior;}
