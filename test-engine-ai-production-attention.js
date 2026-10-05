import assert from 'node:assert/strict';
import {mkdtemp,cp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createAIcase} from './tools/ai-lab-runner.mjs';
const root=import.meta.dirname,temporary=await mkdtemp(join(tmpdir(),'ww2-production-attention-'));
const load=async base=>{
 const [sim,ai,perception,hands,view,attention,rng]=await Promise.all(['sim','ai','ai-perception','ai-hands','ai-view','ai-attention','ai-rng'].map(name=>import(pathToFileURL(resolve(base,`shared/${name}.js`)).href)));
 return{sim,ai,perception,hands,view,attention,rng};
};
try{
 for(const name of ['shared','client'])await cp(resolve(root,name),join(temporary,name),{recursive:true});
 await cp(resolve(root,'package.json'),join(temporary,'package.json'));
 const path=join(temporary,'shared/ai-attention.js'),text=await readFile(path,'utf8');
 const guarded='productionDeferred(perception, slot, state.production) || !affordableRecruit && !homeSquad';
 assert.ok(text.includes(guarded),'The reviewed public-budget guard must be installed.');
 await writeFile(path,text.replace(guarded,'productionDeferred(perception, slot, state.production)'));
 const [current,original]=await Promise.all([load(root),load(temporary)]);
 assert.deepEqual(current.hands.HUMAN_SKILLS,original.hands.HUMAN_SKILLS,'No reaction/motor/APM profile changed.');
 const scene={units:Array.from({length:4},(_,i)=>({owner:0,type:'rifle',x:76+i%3*5,z:77+Math.floor(i/3)*4,holdFire:true,autoRetreat:false,cooldown:60})),
  points:[{x:81,z:79,owner:0}],camera:{x:80,z:79,yaw:0},resources:[{mp:20,fuel:0,mun:200},{mp:0}],cues:[{kind:'hit',tick:160,unitId:8,damage:65}]};
 scene.units.push({owner:1,type:'mg',x:103,z:79,holdFire:true,autoRetreat:false});
 const run=(engine,authored)=>createAIcase(engine,{scenario:'guard',level:'hard',seed:42,seconds:15},authored).advance(300);
 const before=run(original,scene),after=run(current,scene);
 const visit=row=>row.inputs.filter(i=>i.kind.startsWith('camera')&&i.concern==='production'&&i.tick<160);
 assert.ok(visit(before).length,'Control reproduces the pointless initial home camera visit.');
 assert.equal(visit(after).length,0,'Publicly unaffordable recruitment does not pull the camera away.');
 const retreat=row=>row.commands.find(c=>c.accepted&&c.command.t==='retreat'&&c.command.ids.includes(8)&&c.tick>=160);
 assert.ok(retreat(before)&&retreat(after),'Both traces retain real useful withdrawal.');
 assert.ok(retreat(after).tick<retreat(before).tick,'Avoiding the pointless trip improves actual native withdrawal.');
 assert.ok(after.events.some(e=>e.kind==='screen-damage'&&e.tick===160&&e.unitId===8),'Late hurt stays in the actual screen.');
 for(const record of [before,after])for(const command of record.commands){
  const input=record.inputs.find(i=>i.tick===command.tick&&JSON.stringify(i.command)===JSON.stringify(command.command));
  assert.ok(input&&Number.isSafeInteger(input.inputStartedTick)&&input.motorTicks>=1);
  assert.ok(input.tick>=input.inputStartedTick+input.motorTicks,'Every accepted or refused command pays its full native gesture.');
  for(const event of input.responseEvents??[])assert.ok(input.tick>=event.tick+4,'Existing causal input floor remains.');
 }
 const rich={...structuredClone(scene),resources:[{mp:10000,fuel:1000,mun:200},{mp:0}]};
 const home={...structuredClone(scene),camera:{x:41,z:41,yaw:0},points:[{x:81,z:79,owner:-1}],units:scene.units.map(u=>u.owner===0?{...u,x:u.x-36,z:u.z-38}:u)};
 for(const [label,authored] of [['affordable',rich],['home-deployment',home]]){
  const a=run(original,authored),b=run(current,authored);
  assert.deepEqual(b.inputs,a.inputs,`${label}: exact native input trace retained`);assert.deepEqual(b.commands,a.commands,`${label}: exact native receipts retained`);
  assert.ok(a.commands.some(c=>c.accepted&&(label==='affordable'?c.command.t==='buy':['move','amove'].includes(c.command.t))),`${label} contains useful native work`);
 }
 // Construction-mode controls start from real delivered views, without injecting planning labels.
 for(const mode of ['classic','world']){
  const map={w:96,h:96,rows:Array(96).fill('.'.repeat(96)),spawns:[{x:20,y:20},{x:85,y:85}],points:[]};
  const game=current.sim.createGame(map,['Own','Other'],false,[0,1],[0,1],{weather:false,mode});
  game.players[0].mp=0;game.players[0].fuel=0;
  for(const unit of game.units.values())if(unit.owner===0){unit.x=100;unit.z=100;}
  const camera={x:100,z:100,yaw:0,distance:60},view=current.view.viewFor(game,0,{}),state={camera};
  const seen=current.perception.perceive(view,0,state,0);assert.equal(seen.mode.kind,mode);
  const a={},b={},ra=current.rng.createRng(42,0),rb=original.rng.createRng(42,0);
  assert.deepEqual(current.attention.chooseConcern(seen,0,a,'hard',ra),original.attention.chooseConcern(seen,0,b,'hard',rb),`${mode} attention unchanged`);
  assert.deepEqual(a,b);assert.deepEqual(ra,rb,`${mode} random consumption unchanged`);
 }
 console.log(JSON.stringify({test:'production attention',authoredNativePairs:3,constructionViewControls:2,publicBudget:true,lateHurt:true,affordableRecruitmentAndHomeDeployment:true,physicalFloorsAndMotor:true}));
}finally{await rm(temporary,{recursive:true,force:true});}
