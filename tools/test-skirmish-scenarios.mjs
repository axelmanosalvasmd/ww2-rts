// Plays every skirmish base mode for 4 simulated minutes on the server's AI schedule and lists what got built.
import {readFileSync} from 'node:fs';
import {UNITS} from '../shared/sim.js';
import {playMatch} from '../shared/ai-schedule.js';
const map=JSON.parse(readFileSync(new URL('../maps/default.json',import.meta.url)));
const results=[];
for(const mode of ['conquest','assault','annihilation','horde']) for(const seed of [11,29]) {
  const scenarioMap=mode==='horde'?JSON.parse(readFileSync(new URL('../maps/bastogne.json',import.meta.url))):map;
  const built=new Set(),produced=new Set();
  const g=playMatch({map:scenarioMap,names:['a','b'],teams:[0,1],factions:[0,1],options:{mode,defenderTeam:1,weather:false},shuffle:false,seed,maxTicks:4800,onTick:g=>{
    for(const u of g.units.values())if(u.owner!==g.mode?.slot){if(UNITS[u.type].building&&u.built>=1)built.add(u.type);if(!UNITS[u.type].structure)produced.add(u.type);if(!Number.isFinite(u.hp)||!Number.isFinite(u.x)||!Number.isFinite(u.z))throw Error('invalid unit state');}
  }});
  if(mode!=='conquest' && g.mode?.kind!==mode)throw Error('wrong scenario mode');
  results.push({mode,seed,seconds:g.tick/20,winner:g.winner,wave:g.mode?.wave,completed:[...built],units:[...produced]});
}
console.log(JSON.stringify(results,null,2));
