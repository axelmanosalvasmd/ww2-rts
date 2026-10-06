import {readFileSync} from 'node:fs';
import {createGame,step,UNITS} from '../shared/sim.js';
import {think} from '../shared/ai.js';
const map=JSON.parse(readFileSync(new URL('../maps/default.json',import.meta.url)));
const results=[];
for(const mode of ['conquest','assault','annihilation','horde']) for(const seed of [11,29]) {
 let state=seed;const previous=Math.random;Math.random=()=>((state=(Math.imul(state,1664525)+1013904223)>>>0)/4294967296);
 try {
  const scenarioMap=mode==='horde'?JSON.parse(readFileSync(new URL('../maps/bastogne.json',import.meta.url))):map;
  const g=createGame(scenarioMap,['a','b'],false,[0,1],[0,1],{mode,defenderTeam:1,weather:false});
  if(mode!=='conquest' && g.mode?.kind!==mode)throw Error('wrong scenario mode');
  const built=new Set(),produced=new Set();
  for(let i=0;i<4800 && g.winner===null;i++) {
   step(g);if(i%40===0) for(const p of g.players)think(g,p.slot);
   for(const u of g.units.values())if(u.owner!==g.mode?.slot){if(UNITS[u.type].building&&u.built>=1)built.add(u.type);if(!UNITS[u.type].structure)produced.add(u.type);if(!Number.isFinite(u.hp)||!Number.isFinite(u.x)||!Number.isFinite(u.z))throw Error('invalid unit state');}
  }
  results.push({mode,seed,seconds:g.tick/20,winner:g.winner,wave:g.mode?.wave,completed:[...built],units:[...produced]});
 }finally{Math.random=previous;}
}
console.log(JSON.stringify(results,null,2));
