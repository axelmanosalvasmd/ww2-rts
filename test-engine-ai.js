// Focused operation and Horde contracts: node test-engine-ai.js.
import assert from 'node:assert/strict';
import { createGame, step, snapshotFor, CFG, CELL, UNITS, MOVE, COVER, hordeWave, hordeProfile, HORDE_PROFILES } from './shared/sim.js';
import { fixtureCommand as command } from './test-fixtures.js';
import { beginMind, planAssault, operationPosition, ASSAULT_TUNING } from './shared/ai-mind.js';
import { viewFor } from './shared/ai-view.js';
import { think, resetAI } from './shared/ai.js';
const map = { w: 80, h: 80, rows: Array(80).fill('.'.repeat(80)), spawns: [{ x: 5, y: 40 }, { x: 75, y: 40 }], points: [{ x: 55, y: 40 }] };
const level = { notice: 1.25, wave: 3, firstAssault: 0 };
const fixture = () => {
  const g = createGame(map, ['AI', 'enemy'], false, [0,1], [0,1]); g.units.clear();
  for (const slot of [0,1]) g.players[slot].mp = 5000;
  for (const type of ['rifle','rifle','mg']) assert.equal(command(g, 0, { t: 'buy', unit: type }), undefined);
  [...g.units.values()].forEach((u,i) => Object.assign(u,{x:50+i*3,z:80}));
  g.points[0].owner=1;
  const mem = {}, view = viewFor(g,0,mem), mind = beginMind(view,0,mem,1);
  return {g,mem,view,mind,sit:{kind:'push',point:0,at:{x:g.points[0].x,z:g.points[0].z}}};
};
const execute = (f, result) => { for (const cmd of result.commands) assert.equal(command(f.g,0,cmd),undefined, 'operation submits accepted normal commands'); };
const refresh = (f, seconds) => { f.g.tick = seconds*20; f.view = viewFor(f.g,0,f.mem); f.mind = beginMind(f.view,0,f.mem,1); };
{
  const f = fixture(), first = planAssault(f.view,0,f.mind,f.sit,level,0);
  assert.equal(f.mind.assault.state,'assemble');
  assert.equal(f.mind.assault.members.length,3);
  assert.equal(f.mind.assault.members.filter(m=>m.role==='support').length,1);
  const ids=f.mind.assault.members.map(m=>m.id), support=f.mind.assault.members.find(m=>m.role==='support'), line=f.mind.assault.members.find(m=>m.role==='line');
  assert.ok(support.placement.x < line.placement.x, 'gun stages behind infantry');
  execute(f,first); refresh(f,2);
  planAssault(f.view,0,f.mind,f.sit,level,2);
  assert.deepEqual(f.mind.assault.members.map(m=>m.id),ids,'membership persists between looks');
  for (const m of f.mind.assault.members) Object.assign(f.g.units.get(m.id), m.placement);
  refresh(f,4); execute(f,planAssault(f.view,0,f.mind,f.sit,level,4));
  assert.equal(f.mind.assault.state,'advance','assembled line and gun begin the advance');
  f.g.points[0].owner=0; refresh(f,6); planAssault(f.view,0,f.mind,f.sit,level,6);
  assert.equal(f.mind.assault.state,'complete'); assert.equal(f.mind.assault.members.length,0);
}
{
  const f=fixture(), first=planAssault(f.view,0,f.mind,f.sit,level,0); execute(f,first);
  refresh(f,2); planAssault(f.view,0,f.mind,f.sit,level,2);
  const manual=f.mind.assault.members[0].id;
  assert.equal(command(f.g,0,{t:'move',orders:[[manual,15,15]]}),undefined);
  refresh(f,4); const next=planAssault(f.view,0,f.mind,f.sit,level,4);
  assert.ok(!next.claims.has(manual),'manual order releases the operation claim');
  assert.ok(!next.commands.some(c=>c.orders?.some(([id])=>id===manual)));
  planAssault(f.view,0,f.mind,f.sit,level,4,{handoff:true});
  assert.equal(f.mind.assault.state,'abandon'); assert.equal(f.mind.assault.members.length,0);
  resetAI(f.g,0);
}
{
  const f=fixture(); execute(f,planAssault(f.view,0,f.mind,f.sit,level,0));
  const blocked=f.mind.assault.members.find(m=>m.role==='support');
  f.mind.assault.state='regroup'; f.mind.assault.stateAt=0; f.mind.assault.stage={x:60,z:80};
  for (const m of f.mind.assault.members) if(m!==blocked) Object.assign(f.g.units.get(m.id),{x:60,z:80});
  Object.assign(f.g.units.get(blocked.id),{x:15,z:15}); refresh(f,ASSAULT_TUNING.regroup+1);
  planAssault(f.view,0,f.mind,f.sit,level,ASSAULT_TUNING.regroup+1);
  assert.equal(f.mind.assault.state,'advance','regroup has a fixed deadline');
  assert.ok(!f.mind.assault.members.some(m=>m.id===blocked.id),'blocked gun cannot freeze the line');
}
{
  const f=fixture(); execute(f,planAssault(f.view,0,f.mind,f.sit,level,0));
  f.mind.assault.state='engage'; f.mind.assault.stateAt=0;
  assert.equal(command(f.g,1,{t:'buy',unit:'tank'}),undefined);
  const tank=[...f.g.units.values()].find(u=>u.owner===1); Object.assign(tank,{x:68,z:80}); f.g.players[0].visible.add(tank.id);
  refresh(f,2); const fresh=planAssault(f.view,0,f.mind,f.sit,level,2); execute(f,fresh);
  assert.notEqual(f.mind.assault.state,'withdraw','reaction delay applies to a new tank');
  refresh(f,4); const withdrawal=planAssault(f.view,0,f.mind,f.sit,level,4);
  assert.equal(f.mind.assault.state,'withdraw','known armor withdraws an unmatched healthy assault');
  assert.ok([...f.g.units.values()].filter(u=>u.owner===0).every(u=>u.hp===UNITS[u.type].models*UNITS[u.type].hpPer));
  assert.ok(withdrawal.commands.length && withdrawal.commands.every(c=>c.t==='move'||c.t==='retreat'));
  execute(f,withdrawal); refresh(f,6); planAssault(f.view,0,f.mind,f.sit,level,6);
  assert.equal(f.mind.assault.state,'withdraw','cooldown prevents immediate charge reversal');
  const hidden=structuredClone(f.g); hidden.units.get(tank.id).x=145; hidden.players[0].visible.delete(tank.id); f.g.players[0].visible.delete(tank.id);
  const a=structuredClone(f.mem),b=structuredClone(f.mem),va=viewFor(f.g,0,a),vb=viewFor(hidden,0,b);
  assert.deepEqual(planAssault(va,0,beginMind(va,0,a,1),f.sit,level,6),planAssault(vb,0,beginMind(vb,0,b,1),f.sit,level,6),'unseen tank changes do not alter decisions');
}
{
  const f=fixture();f.view={...f.view,points:[...f.view.points,{x:30,z:30,owner:-1}]};
  const opening=planAssault(f.view,0,f.mind,f.sit,level,0);
  assert.equal(opening.claims.size,0,'opening neutral scouts finish captures before coordinated assaults claim the force');
  assert.equal(f.mind.assault,undefined);
}
{
  const f=fixture(); f.g.players[0].mp=0;think(f.g,0,{memory:f.mem});
  const hurt=f.mem.mind.assault.members[0].id, u=f.g.units.get(hurt);u.hp=UNITS[u.type].models*UNITS[u.type].hpPer*0.2;
  refresh(f,2);const sent=[];think(f.g,0,{memory:f.mem,submit:cmd=>{sent.push(cmd);return command(f.g,0,cmd);}});
  assert.ok(sent.some(c=>c.t==='retreat'&&c.ids.includes(hurt)),'critical injury keeps the existing retreat order instead of a claimed advance');
  assert.ok(!f.mem.mind.assault.members.some(m=>m.id===hurt));
}
{
  const f=fixture();f.g.players[0].mp=0;think(f.g,0,{memory:f.mem});
  const stopped=f.mem.mind.assault.members[0].id;
  command(f.g,0,{t:'stop',ids:[stopped]});refresh(f,2);const sent=[];
  think(f.g,0,{memory:f.mem,submit:cmd=>{sent.push(cmd);return command(f.g,0,cmd);}});
  assert.ok(!sent.some(c=>c.orders?.some(([id])=>id===stopped)),'Stop between the first order and next observation releases the claim');
}
{
  const f=fixture(); f.g.players[0].mp=0;
  think(f.g,0,{memory:f.mem});
  assert.equal(f.mem.mind.assault.state,'assemble','normal seat planner uses persistent operation commands');
  const ids=f.mem.mind.assault.members.map(m=>m.id);
  refresh(f,2); think(f.g,0,{memory:f.mem});
  const stopped=ids[0]; assert.equal(command(f.g,0,{t:'stop',ids:[stopped]}),undefined);
  refresh(f,4);const sent=[];
  think(f.g,0,{memory:f.mem,submit:cmd=>{sent.push(cmd);return command(f.g,0,cmd);}});
  assert.ok(!sent.some(c=>c.orders?.some(([id])=>id===stopped)),'manual Stop is not overwritten by the ordinary or operation planner');
}
{
  const f=fixture(); execute(f,planAssault(f.view,0,f.mind,f.sit,level,0)); f.mind.assault.state='engage';
  for(let i=0;i<2;i++) assert.equal(command(f.g,1,{t:'buy',unit:'mg'}),undefined);
  for(const u of f.g.units.values())if(u.owner===1){Object.assign(u,{x:70,z:80});f.g.players[0].visible.add(u.id);}
  refresh(f,2);execute(f,planAssault(f.view,0,f.mind,f.sit,level,2));
  refresh(f,4);planAssault(f.view,0,f.mind,f.sit,level,4);
  assert.equal(f.mind.assault.state,'withdraw','observed MG line withdraws healthy infantry without a counter');
  assert.equal(f.mind.assault.reason,'machine-gun');
}
{
  const f=fixture(), u=[...f.view.units.values()][0];
  const flags=[...f.view.flags],chars=[...f.view.chars];
  for(let z=0;z<f.view.h;z++){flags[z*f.view.w+30]=MOVE; chars[z*f.view.w+30]='W';}
  const v={...f.view,flags,chars}, at=operationPosition(v,u,{x:90,z:80});
  assert.ok(at.x<60,'support never crosses a known disconnected bank');
  const region={bounds:[40,60,60,100]}, bounded=operationPosition(f.view,u,{x:100,z:80},[],false,region);
  assert.ok(bounded.x<60 && bounded.x>=40,'local defender placement stays inside its region');
}
{
  for(const n of [1,2,3,4,5,7,8,12,20]) for(const defenders of [1,3,5]) for(const profile of Object.keys(HORDE_PROFILES)) {
    const budget=CFG.horde.budget*CFG.horde.growth**(n-1)*defenders;
    const picked=hordeProfile(n,budget,7,[],profile), options={profile,seed:179+n};
    const roster=hordeWave(n,defenders,1,options), spent=roster.reduce((s,t)=>s+UNITS[t].cost,0);
    assert.deepEqual(roster,hordeWave(n,defenders,1,options),'same seed reproduces the profile');
    assert.ok(spent<=budget && budget-spent<UNITS.rifle.cost,'each legal profile spends the original budget');
    assert.ok(roster.every(t=>CFG.horde.unlock.some(([unit,from])=>unit===t&&n>=from)),'all purchases obey unlocks');
    if(picked!=='mixed') assert.ok(roster.some(t=>HORDE_PROFILES[picked].types.includes(t)),'warning has a defining unit');
    if(n<3&&profile==='siege'||n<5&&profile==='armor') assert.equal(picked,'mixed');
  }
  let history=[];
  for(let n=1;n<150;n++){const p=hordeProfile(n,CFG.horde.budget*CFG.horde.growth**(n-1),991+n,history); assert.ok(!(history.length>=2&&history.slice(-2).every(t=>t===p)),'profile cannot repeat three times'); history.push(p);}
  const summaries={};
  for(const profile of ['infantry','armor','siege']){
    const roster=hordeWave(8,3,1,{profile,seed:55}),spent=roster.reduce((n,t)=>n+UNITS[t].cost,0),defining=roster.filter(t=>HORDE_PROFILES[profile].types.includes(t)).reduce((n,t)=>n+UNITS[t].cost,0);
    summaries[profile]={units:roster.length,spent,share:Math.round(100*defining/spent)};
    assert.ok(defining>=spent*HORDE_PROFILES[profile].share,'measured defining spend supports the warning');
  }
  console.log('Wave 8, three defenders, seed 55:',summaries);
}
{
  const hordeMap={...map,spawns:[{x:40,y:5},{x:10,y:75},{x:70,y:75}],defend:[0]};
  const g=createGame(hordeMap,['defender'],false,[0],[0],{mode:'horde'}),m=g.mode;
  const before=snapshotFor(g,0,[]).mode;
  assert.ok(typeof before.nextProfile==='string'&&!Object.hasOwn(before,'reserve')&&!Object.hasOwn(before,'profileSeed'),'break warning contains only a broad profile');
  m.wave=7;m.timeLeft=0;
  for(const u of g.units.values()){u.holdFire=true;u.auto=false;}
  do{step(g);}while(m.budget>0);
  const actual=[...m.reserve,...[...g.units.values()].filter(u=>u.owner===m.slot&&!u.air).map(u=>u.type)];
  assert.deepEqual(actual.sort(),hordeWave(8,1,1,{profile:m.profile,seed:m.profileSeed+8}).sort(),'delivered Wave matches its seeded announced profile');
  assert.equal(snapshotFor(g,0,[]).mode.nextProfile,undefined,'active wave carries no future roster');
  m.timeLeft=0; step(g); assert.equal(m.wave,8,'active field or reserve prevents early next wave');
  assert.ok(m.reserve.length<=CFG.horde.fieldMax);
  for(const u of [...g.units.values()])if(u.owner===m.slot)g.units.delete(u.id);
  m.reserve=[];m.budget=0;step(g);
  assert.equal(m.active,false);assert.ok(m.nextProfile);assert.equal(m.timeLeft,CFG.horde.break);
}
console.log('Engine AI and Horde contracts passed.');
