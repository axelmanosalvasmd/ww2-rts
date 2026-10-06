import assert from 'node:assert/strict';
import {createGame,step,command,UNITS} from './shared/sim.js';
import {think} from './shared/ai.js';
const map={w:80,h:80,rows:Array(80).fill('.'.repeat(80)),spawns:[{x:12,y:40},{x:68,y:40},{x:40,y:68}],points:[],defend:[0]};
for(const mode of ['conquest','assault','annihilation','horde']){
 const g=createGame(map,['a','b'],false,[0,1],[0,1],{mode,defenderTeam:1,weather:false});
 g.players[0].mp=2000;step(g);
 think(g,0);
 assert.ok([...g.units.values()].some(u=>u.owner===0 && u.type==='motorpool'),`${mode} AI begins tech construction`);
 for(let i=0;i<1500;i++){step(g);if(i%40===0)think(g,0);}
 assert.ok([...g.units.values()].some(u=>u.owner===0 && u.type==='motorpool' && u.built>=1),`${mode} AI keeps builders working`);
 console.log(`${mode}: AI completed Motor Pool`);
}
{
 const g=createGame(map,['a','b'],false,[0,1],[0,1],{weather:false});g.players[0].mp=5000;
 const hq=[...g.units.values()].find(u=>u.owner===0&&u.type==='hq');hq.hp=0;step(g);think(g,0);
 const replacement=[...g.units.values()].find(u=>u.owner===0&&u.type==='hq');assert.ok(replacement && replacement.built<1,'AI rebuilds destroyed HQ');
 for(let i=0;i<1800&&replacement.built<1;i++){step(g);if(i%20===0)think(g,0);}
 assert.equal(replacement.built,1);
 replacement.hp=1000;for(let i=0;i<120;i++){step(g);if(i%20===0)think(g,0);}
 assert.ok(replacement.hp>1000,'AI repairs damaged HQ');
 console.log('AI rebuilt and repaired HQ');
}
