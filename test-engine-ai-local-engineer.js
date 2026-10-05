import assert from 'node:assert/strict';
import {createGame,command,step,UNITS} from './shared/sim.js';
import {think} from './shared/ai.js';
import {viewFor} from './shared/ai-view.js';
import {perceive} from './shared/ai-perception.js';
import {createHands} from './shared/ai-hands.js';
const map={w:80,h:80,rows:Array(80).fill('.'.repeat(80)),spawns:[{x:15,y:15},{x:70,y:70}],points:[]};
// The fixture owns its native RNG through setup, paid hands inputs, and construction.
function fixture(variant='positive') {
 const originalRandom=Math.random;let seed=23;Math.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
 try{return nativeFixture(variant)}finally{Math.random=originalRandom}
}
function nativeFixture(variant){
 const nativeMap=variant==='fogged-node'?{...map,rows:map.rows.map(row=>row.slice(0,28)+'B'+row.slice(29))}:map;
 const g=createGame(nativeMap,['a','b'],false,[0,1],[0,1],{mode:'classic',weather:false});
 const engineer=[...g.units.values()].find(u=>u.owner===0&&u.type==='engineer');assert.ok(engineer);
 for(const u of g.units.values())if(u.owner===0&&u.id!==engineer.id&&!UNITS[u.type].building)g.units.delete(u.id);
 g.players[0].mp=5000;
 assert.equal(command(g,0,{t:'build',ids:[engineer.id],kind:'barracks',x:45,z:45}),undefined);
 const site=[...g.units.values()].find(u=>u.owner===0&&u.type==='barracks');assert.ok(site&&site.built<1);
 assert.equal(command(g,0,{t:'move',orders:[[engineer.id,35,45]]}),undefined);
 Object.assign(engineer,{x:35,z:45,path:[],orders:[],autoRetreat:false,targetId:0,attackId:0,build:0});
 g.players[0].mp=0;
 if(['local-depot','fogged-node'].includes(variant)){g.units.delete(site.id);const node=g.nodes[0];assert.ok(node);Object.assign(engineer,{x:node.x+6,z:node.z+2});g.players[0].mp=150;assert.equal(command(g,0,{t:'stop',ids:[engineer.id]}),undefined);}
 if(variant==='remote-site')Object.assign(site,{x:95,z:45});
 if(variant==='foreign-site')site.owner=1;
 if(variant==='unseen-site')Object.assign(site,{x:55,z:45});
 if(variant==='busy-build')assert.equal(command(g,0,{t:'assist',ids:[engineer.id],id:site.id}),undefined);
 if(variant==='moving')assert.equal(command(g,0,{t:'move',orders:[[engineer.id,35,145]]}),undefined);
 step(g);
 if(variant==='fogged-node'){
  for(const u of g.units.values())if(u.owner===0&&UNITS[u.type].building)Object.assign(u,{x:140,z:140});
  step(g);
 }
 const camera={x:engineer.x,z:engineer.z,yaw:0,distance:60};if(['offcamera','stale'].includes(variant))Object.assign(camera,{x:135,z:135});
 if(variant==='unseen-site')Object.assign(camera,{x:10,z:45});
 const hands=createHands({slot:0,seed:17,level:'hard',camera,startedTick:0});hands.openingUntil=0;
 const concern={id:`idle:${engineer.id}`,kind:'idle',unitId:engineer.id,x:engineer.x,z:engineer.z,since:0,until:200};
 if(variant==='wrong-named-actor')concern.unitId=[...g.units.values()].find(u=>u.owner===0&&u.type==='hq').id;
 if(variant==='anonymous-idle')delete concern.unitId;
 if(['wrong-named-actor','anonymous-idle'].includes(variant))concern.id=`idle:${concern.unitId??'anonymous'}`;
 const memory={human:{camera,hands,concern,deliberateUntil:0,decisionStartedTick:0,attention:{current:concern,since:0,until:200,visits:new Map(),working:new Map([[concern.id,concern]]),waiting:new Map()}},seen:new Map(),node:new Map()};
 // A scheduled repair owns this actor until its delivered completion or expiry.
 if(variant==='pending-repair')memory.bridgeCrew=new Map([[engineer.id,{t:g.tick/20,dug:false}]]);
 if(variant==='stale'){const liveCamera={x:engineer.x,z:engineer.z,yaw:0,distance:60};memory.human.camera=liveCamera;perceive(viewFor(g,0,{}),0,memory.human,g.tick);memory.human.camera=camera;}
 const initialView=perceive(viewFor(g,0,{}),0,memory.human,g.tick);
 memory.human.interruptEvents=new Set(initialView.newEvents.map(event=>event.id));
 const commands=[],inputs=[];const builtBefore=site.built;
 if(variant==='unseen-site'){assert.ok(initialView.screenIds.has(engineer.id),'the named engineer is on screen');assert.equal(initialView.sees(site),false,'the nearby site is outside the actual camera');}
 if(variant==='fogged-node')assert.equal(initialView.sees(g.nodes[0]),false,'native wall keeps the nearby node unseen');
 if(variant==='stale'){assert.ok(initialView.units.has(engineer.id),'previous visit retained an actor memory');assert.ok(!initialView.screenIds.has(engineer.id),'the remembered actor is outside the actual camera');}
 for(let tick=0;tick<100;tick++){
  const delivered=viewFor(g,0,{});
  think(g,0,{level:'hard',memory,view:delivered,inputLog:input=>inputs.push(structuredClone(input)),submit:cmd=>{const actorPath=engineer.path.length,actorBuild=engineer.build,mpBefore=g.players[0].mp;const result=command(g,0,cmd);commands.push({tick:g.tick,cmd:structuredClone(cmd),result:result??null,actorPath,actorBuild,mpBefore,mpAfter:g.players[0].mp});return result}});
  step(g);
 }
 // Continue native movement and building after the five seconds of actual AI inputs.
 for(let tick=0;tick<400;tick++)step(g);
 return{variant,commands,inputs,idleWork:inputs.filter(i=>i.concern===concern.id&&['build','assist'].includes(i.command?.t)),nativeDepots:[...g.units.values()].filter(u=>u.owner===0&&u.type==='depot').map(u=>({id:u.id,built:u.built})),siteBuilt:site.built,builtBefore,engineerId:engineer.id,engineerBuild:engineer.build};
}
const p=fixture();assert.equal(p.idleWork.length,1,'the actual work belongs to the named idle visit');assert.ok(p.commands.some(c=>c.cmd.t==='assist'&&c.result===null&&c.actorPath===0&&c.actorBuild===0),'actual idle visit dispatches an accepted native assist');assert.ok(p.inputs.some(i=>i.kind.startsWith('select-')),'assist pays for physical selection');assert.ok(p.inputs.some(i=>i.command?.t==='assist'),'assist pays for actual order input');assert.ok(p.siteBuilt>p.builtBefore,'native assistance advances the unfinished construction');assert.ok(!p.commands.some(c=>c.cmd.t==='buy'),'local engineer work does not grant production shopping');
const depot=fixture('local-depot');assert.ok(depot.idleWork.some(i=>i.command.t==='build'&&i.command.kind==='depot'),'named idle engineer builds at a native nearby unclaimed resource node');assert.ok(depot.commands.some(c=>c.cmd.t==='build'&&c.result===null&&c.actorPath===0&&c.actorBuild===0&&c.mpBefore-c.mpAfter===UNITS.depot.cost),'actual native depot pays its unchanged native cost');assert.ok(depot.nativeDepots.some(u=>u.built>0),'native construction advances the paid depot');assert.ok(!depot.inputs.some(i=>i.concern===`idle:${depot.engineerId}`&&i.command?.t==='buy'),'idle engineering does not grant shopping');
const reports=[p,depot];for(const variant of ['remote-site','foreign-site','moving','offcamera','stale','busy-build','pending-repair','wrong-named-actor','anonymous-idle','unseen-site','fogged-node']){const r=fixture(variant);assert.equal(r.idleWork.length,0,'idle work remains local, owned, observed, and actually idle: '+variant);reports.push(r)}
console.log('PASS local idle engineer: native assistance, paid depot, and eleven guards');
