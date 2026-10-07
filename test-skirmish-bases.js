import assert from 'node:assert/strict';
import * as sim from './shared/sim.js';
const {createGame, command, step, UNITS, CELL} = sim;
const map = {w:80,h:80,rows:Array(80).fill('.'.repeat(80)), spawns:[{x:12,y:40},{x:68,y:40},{x:40,y:68}],points:[],defend:[0]};
const game = (mode='conquest') => createGame(map,['a','b'],false,[0,1],[0,1],{mode,defenderTeam:1,weather:false});
const own = (g,slot=0) => [...g.units.values()].filter(u=>u.owner===slot);
for (const mode of ['conquest','assault','annihilation','horde']) {
 const g=game(mode), bs=[...g.units.values()].filter(u=>['hq','barracks'].includes(u.type));
 assert.equal(bs.length, mode==='horde'?2:4, `${mode} starts with HQ + Barracks per base`);
 assert.ok(bs.every(b=>b.built===1 && b.cells.length===9 && b.hp===UNITS[b.type].hpPer));
 assert.ok(bs.every(b=>!b.cells.some(c=>[...g.units.values()].some(u=>u.type==='bunker' && Math.hypot((c%g.w+.5)*CELL-u.x,(Math.floor(c/g.w)+.5)*CELL-u.z)<UNITS.bunker.radius+1))), 'bases avoid bunkers');
}
console.log('Skirmish base starts passed');
for (const mode of ['conquest','assault','annihilation','horde']) {
 const g=game(mode); g.players[0].mp=10000;
 const before=g.players[0].mp;
 assert.equal(command(g,0,{t:'buy',unit:'tank'}),'needs',`${mode} tanks require Motor Pool`);
 assert.equal(g.players[0].mp,before);
 const b=own(g).find(u=>u.type==='barracks');
 assert.equal(command(g,0,{t:'buy',unit:'mg',from:b.id}),undefined);
 const mg=own(g).filter(u=>u.type==='mg').at(-1);
 assert.ok(Math.hypot(mg.x-b.x,mg.z-b.z)<12,'instant unit spawns at building');
 assert.equal(b.queue.length,0);
 b.built=.5; assert.equal(command(g,0,{t:'buy',unit:'mg'}),'needs');
 b.built=1; b.hp=0; assert.equal(command(g,0,{t:'buy',unit:'mg'}),'needs');
}
{
 const g=createGame(map,['a','b'],false,[0,0],[0,1],{mode:'horde',weather:false});
 g.players[1].mp=10000;
 const b=own(g).find(u=>u.type==='barracks'), money=g.players[0].mp;
 assert.equal(command(g,1,{t:'buy',unit:'mg',from:b.id}),undefined,'shared Horde production');
 assert.ok(own(g,1).some(u=>u.type==='mg'));
 assert.equal(g.players[0].mp,money,'owner does not pay teammate purchases');
 assert.equal(command(g,1,{t:'buy',unit:'engineer'}),'needs');
}
console.log('Skirmish instant production passed');
for (const mode of ['conquest','assault','annihilation','horde']) {
 const g=game(mode); g.players[0].mp=10000;
 const rifle=own(g).find(u=>u.type==='rifle');
 const at=sim.siteNear(g,rifle.x,rifle.z,3);
 assert.equal(command(g,0,{t:'build',kind:'motorpool',ids:[rifle.id],...at}),undefined,`${mode} rifle builds Motor Pool`);
 const b=own(g).find(u=>u.type==='motorpool');
 assert.equal(command(g,0,{t:'buy',unit:'tank'}),'needs');
 for(let i=0;i<1600 && b.built<1;i++) step(g);
 assert.equal(b.built,1,`${mode} construction completes`);
 assert.equal(command(g,0,{t:'buy',unit:'tank',from:b.id}),undefined);
 b.hp=500;
 assert.equal(command(g,0,{t:'assist',ids:[rifle.id],id:b.id}),undefined);
 for(let i=0;i<100;i++) step(g);
 assert.ok(b.hp>500,'builders repair');
 b.hp=0; step(g);
 assert.ok(!g.units.has(b.id),'destroyed building removed');
 assert.ok(b.cells.every(c=>g.chars[c]==='R'),'destroyed footprint is rubble');
 assert.equal(command(g,0,{t:'buy',unit:'tank'}),'needs');
 assert.equal(command(g,0,{t:'build',kind:'motorpool',ids:[rifle.id],x:b.x,z:b.z}),undefined,'rebuild on rubble');
}
console.log('Skirmish construction repair and destruction passed');
{
 const g=game();g.players[0].mp=10000;
 const u=own(g).find(u=>u.type==='rifle'), hq=own(g).find(u=>u.type==='hq');
 u.hp=UNITS.rifle.hpPer;u.autoRetreat=false;u.auto=false;u.x=hq.x+5;u.z=hq.z;
 hq.hp=0;step(g);const hp=u.hp;
 for(let i=0;i<60;i++)step(g);
 assert.equal(u.hp,hp,'destroyed HQ no longer reinforces');
 const at=sim.siteNear(g,hq.x,hq.z,3);
 assert.equal(command(g,0,{t:'build',kind:'hq',ids:[u.id],...at}),undefined,'HQ can be rebuilt');
 assert.ok(UNITS.hq.cost>0 && UNITS.hq.buildTime>0);
}
{
 const g=createGame(map,['a','b'],false,[0,0],[0,1],{mode:'horde',weather:false});g.players[1].mp=10000;
 const u=own(g,1).find(u=>u.type==='rifle'), at=sim.siteNear(g,u.x,u.z,3);
 assert.equal(command(g,1,{t:'build',kind:'motorpool',ids:[u.id],...at}),undefined,'shared Barracks satisfies teammate prerequisite');
 const b=own(g,1).find(u=>u.type==='motorpool');
 const helper=own(g).find(u=>u.type==='rifle');
 assert.equal(command(g,0,{t:'assist',ids:[helper.id],id:b.id}),undefined);
 assert.equal(command(g,0,{t:'rally',ids:[b.id],x:80,z:80}),undefined,'shared building rally');
 for (const cache of [undefined,sim.snapshotCache(g,[],[])]) assert.ok(sim.snapshotFor(g,0,[],[],cache).queues.some(row=>row[0]===b.id && row[2]===80),'shared rally visible with and without cache');
}
console.log('HQ and shared Horde rules passed');
{
 const g=game(); g.players[0].mp=10000;
 const before=g.players[0].mp, foreign=own(g,1).find(u=>u.type==='barracks');
 assert.equal(command(g,0,{t:'buy',unit:'mg',from:foreign.id}),'needs');
 assert.equal(g.players[0].mp,before);
 const u=own(g).find(u=>u.type==='rifle');
 for(const type of ['motorpool','airfield']) {
  const at=sim.siteNear(g,u.x,u.z,3);
  assert.equal(command(g,0,{t:'build',kind:type,ids:[u.id],...at}),undefined);
  const b=own(g).find(u=>u.type===type);for(let i=0;i<1800&&b.built<1;i++)step(g);
  assert.equal(b.built,1);
 }
 const air=own(g).find(u=>u.type==='airfield');
 assert.equal(command(g,0,{t:'buy',unit:'fighter',from:air.id}),undefined);
 const plane=own(g).find(u=>u.type==='fighter');assert.equal(plane.x,air.x);assert.equal(plane.z,air.z);
 const rifleCount=own(g).filter(u=>u.type==='rifle').length;
 assert.equal(command(g,0,{t:'buy',unit:'rifle',from:own(g).find(u=>u.type==='barracks').id}),undefined);
 assert.equal(own(g).filter(u=>u.type==='rifle').length,rifleCount+1);
}
{
 const naval={...map,naval:true,rows:Array(80).fill('.'.repeat(48)+'W'.repeat(32)),spawns:[{x:42,y:20},{x:42,y:65}]};
 const g=createGame(naval,['a','b'],false,[0,1],[0,1],{weather:false});g.players[0].mp=10000;
 const u=own(g).find(u=>u.type==='rifle');
 assert.equal(command(g,0,{t:'buy',unit:'gunboat'}),'needs');
 let site;
 for(let y=8;y<32&&!site;y++)for(let x=44;x<48&&!site;x++)if(command(g,0,{t:'build',kind:'shipyard',ids:[u.id],x:x*CELL,z:y*CELL})===undefined)site=own(g).find(u=>u.type==='shipyard');
 assert.ok(site,'coastal Shipyard placement');for(let i=0;i<1800&&site.built<1;i++)step(g);
 assert.equal(site.built,1);
 assert.equal(command(g,0,{t:'buy',unit:'gunboat',from:site.id}),undefined);
 const boat=own(g).find(u=>u.type==='gunboat');assert.ok(boat.x>=48*CELL,'boat launches in water');
}
console.log('Airfield, coastal Shipyard and producer validation passed');
