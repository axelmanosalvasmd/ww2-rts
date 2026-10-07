import assert from 'node:assert/strict';
import { createGame, step, validateMap, snapshotFor, UNITS, popOf, popCap, CELL } from './shared/sim.js';
import { migrateScenario, validateScenario } from './shared/scenarios.js';
import { migrateWorldMap, composeWorldCell } from './shared/world-layers.js';
const map = () => ({name:'mission',w:24,h:24,rows:Array(24).fill('.'.repeat(24)),spawns:[{x:2,y:2},{x:21,y:21}],points:[{id:'crossroads',x:12,y:12}]});
const mission = () => ({version:1,areas:[{id:'gate',box:[8,8,10,10]}],groups:[{id:'squad',units:[]}],objectives:[{id:'hold',text:{en:'Hold the gate',es:'Defiende la entrada'},recipients:'side',side:0}],triggers:[]});
const trigger = (id,condition,actions,repeat={mode:'once'},extra={}) => ({id,scope:'match',recipients:'side',side:0,condition,actions,repeat,...extra});
const say = text => ({kind:'say',text:{en:text},recipients:'side',side:0});
const start = m => createGame(m,['One','Two'],false,[0,1],[0,1],{weather:false,supply:false});
function ticks(g,n) { for(let i=0;i<n;i++) step(g); }
{
 const m=map(); m.triggers=[{at:1,say:'Public warning',blow:[11,11,12,12]}];
 assert.equal(validateMap(m),null); const s=migrateScenario(m); assert.equal(s.triggers[0].actions[0].recipients,'public');
 const g=start(m); ticks(g,20); assert.equal(g.scenario.triggers['legacy:0@match'].count,1);
 for(const slot of [0,1]) assert(snapshotFor(g,slot,g.shots).shots.some(s=>s.text==='Public warning'));
 ticks(g,20); assert.equal(g.scenario.triggers['legacy:0@match'].count,1);
}
{
 const m=map();m.scenario=mission(); m.scenario.triggers=[trigger('announce',{kind:'all',conditions:[{kind:'time',seconds:0},{kind:'ownership',target:'crossroads',side:0}]},[{kind:'objectiveActivate',objective:'hold'},say('Ready')]),trigger('done',{kind:'triggerComplete',trigger:'announce'},[{kind:'objectiveComplete',objective:'hold'}])];
 assert.equal(validateMap(m),null); const g=start(m); step(g); assert.equal(g.scenario.triggers['announce@match'].count,0);
 g.points[0].owner=0; step(g); assert.equal(g.scenario.triggers['announce@match'].count,1);
 assert.equal(snapshotFor(g,0,g.shots).scenario.objectives[0].state,'complete'); assert.equal(snapshotFor(g,1,g.shots).scenario.objectives.length,0);
 assert(snapshotFor(g,0,g.shots).shots.some(s=>s.text==='Ready')); assert(!snapshotFor(g,1,g.shots).shots.some(s=>s.text==='Ready'));
 const before=JSON.stringify(g.scenario); snapshotFor(g,0,[]); snapshotFor(g,0,[]); assert.equal(JSON.stringify(g.scenario),before,'reconnect reads durable state without executing');
 assert.equal(g.winner,null,'objective completion leaves normal victory authoritative');
}
{
 const m=map(); m.scenario=mission();m.scenario.triggers=[trigger('repeat',{kind:'ownership',target:'crossroads',side:0},[say('Pulse')],{mode:'risingEdge',cooldown:0.1,max:2})];
 const g=start(m); g.points[0].owner=0; ticks(g,5); assert.equal(g.scenario.triggers['repeat@match'].count,1);
 g.points[0].owner=-1;step(g);g.points[0].owner=0;step(g);assert.equal(g.scenario.triggers['repeat@match'].count,2);ticks(g,10);assert.equal(g.scenario.triggers['repeat@match'].count,2);
 m.scenario.triggers[0].repeat={mode:'whileTrue',cooldown:0.1,max:3};const h=start(m);h.points[0].owner=0;ticks(h,12);assert.equal(h.scenario.triggers['repeat@match'].count,3);
}
{
 const m=map();m.scenario=mission();m.scenario.triggers=[trigger('arrival',{kind:'time',seconds:0},[{kind:'reinforce',group:'squad',side:0,roster:[{type:'rifle',count:3}],at:[9,9],order:{kind:'move',at:[14,9]},expires:5}])];
 const g=start(m); step(g);assert.equal(g.scenario.groups.squad.length,3);assert(g.scenario.groups.squad.every(id=>g.units.get(id).path.length));ticks(g,10);assert.equal(g.scenario.groups.squad.length,3,'no duplicate arrival');assert(popOf(g,0)<=popCap(g,0));
 const h=start(m);while(popOf(h,0)<popCap(h,0)) { const u=structuredClone([...h.units.values()][0]);u.id=h.nextId++;h.units.set(u.id,u); }
 step(h);assert.equal(h.scenario.deferred.length,1);assert.equal(h.scenario.groups.squad.length,0);h.units.delete([...h.units.values()].find(u=>u.owner===0).id);step(h);assert.equal(h.scenario.groups.squad.length,1);ticks(h,120);assert.equal(h.scenario.deferred.length,0,'bounded expiry cancels blocked arrivals');
}
{
 for (const [ground, object, mine, blocked] of [['.','R',false,true],['.','R',true,true],['D','.',true,false],['.','.',true,false]]) {
  const m=migrateWorldMap(map());
  for (const [key,ch] of [['ground',ground],['objects',object],['mines',mine?'N':'.']]) { const row=[...m.layers[key][9]];row[9]=ch;m.layers[key][9]=row.join(''); }
  const row=[...m.rows[9]];row[9]=composeWorldCell(ground,object,mine);m.rows[9]=row.join('');
  m.scenario=mission();m.scenario.triggers=[trigger('vehicleEntry',{kind:'time',seconds:0},[{kind:'reinforce',group:'squad',side:0,roster:[{type:'armoredcar',count:1}],at:[9,9],order:{kind:'hold'},expires:5}])];
  assert.equal(validateMap(m),null,'layered entry fixture has a valid map contract');
  if (blocked) assert.throws(()=>start(m),/unavailable/,`rubble rejects vehicle entry with mine=${mine}`);
  else { const g=start(m);step(g);assert.equal(g.scenario.triggers['vehicleEntry@match'].count,1);assert.equal(g.scenario.groups.squad.length,1,`${ground} mine allows normal vehicle arrival`);assert.equal(g.scenario.deferred.length,0);assert.equal(g.units.get(g.scenario.groups.squad[0]).type,'armoredcar'); }
 }
}
{
 const m=map();m.scenario=mission();m.scenario.groups[0].units=[{id:'leader',type:'rifle',side:0,x:9,y:9}];m.scenario.triggers=[trigger('loss',{kind:'all',conditions:[{kind:'unitLost',unit:'leader'},{kind:'groupLost',group:'squad'}]},[say('Lost')]),trigger('entry',{kind:'all',conditions:[{kind:'areaEntry',area:'gate',group:'squad'},{kind:'groupCount',group:'squad',op:'equal',count:1}]},[say('Entered')])];
 const g=start(m);step(g);assert.equal(g.scenario.triggers['entry@match'].count,1);g.units.delete(g.scenario.units.leader);step(g);assert.equal(g.scenario.triggers['loss@match'].count,1);
}
{
 const m=map();m.scenario=mission();m.scenario.triggers=[trigger('capture',{kind:'capture',target:'crossroads',side:0},[say('Captured')]),trigger('scope',{kind:'time',seconds:0},[say('Team message')],{mode:'once'},{scope:'player',side:undefined,recipients:'side'})];
 const g=start(m);g.points[0].owner=0;step(g);assert.equal(g.scenario.triggers['capture@match'].count,1);assert.equal(g.scenario.triggers['scope@player:0'].count,1);assert.equal(g.scenario.triggers['scope@player:1'].count,1);
}
{
 const m=map();m.scenario=mission();m.scenario.triggers=[trigger('cycle',{kind:'objectiveComplete',objective:'hold'},[{kind:'objectiveComplete',objective:'hold'}])];assert.match(validateMap(m),/cycle/);assert.throws(()=>start(m),/cycle/);
 m.scenario.triggers=[trigger('bad',{kind:'unitLost',unit:'missing'},[say('Bad')])];assert.match(validateMap(m),/reference/);
 m.scenario.triggers=[trigger('bad',{kind:'time',seconds:0},[say('Bad')],{mode:'whileTrue',cooldown:0,max:2})];assert.match(validateMap(m),/cooldown/);
 m.scenario.triggers=[trigger('bad',{kind:'time',seconds:0},[{kind:'destroy',box:[0,0,23,23]}])];assert.match(validateMap(m),/damage area/);
 m.scenario.triggers=[trigger('bad',{kind:'time',seconds:NaN},[say('Bad')])];assert.match(validateScenario(m,UNITS),/condition/);
}
{
 const m=map(); const rows=m.rows.map(r=>[...r]); rows[8][8]='#'; rows[8][9]='#'; m.rows=rows.map(r=>r.join(''));
 m.scenario=mission();m.scenario.triggers=[trigger('damage',{kind:'time',seconds:0},[{kind:'damage',box:[8,8,8,8],damage:20}]),trigger('destroy',{kind:'time',seconds:0.1},[{kind:'destroy',box:[8,8,8,8]}])];
 const g=start(m), cell=8*g.w+8, neighbor=cell+1, hp=g.cellHp[cell];step(g);assert(g.cellHp[cell]<hp);assert.equal(g.cellHp[neighbor],hp,'damage remains in the authored local area');step(g);assert.equal(g.chars[cell],'+');assert.equal(g.chars[neighbor],'#');
}
{
 const m=map();m.defend=[0];m.scenario=mission();m.scenario.triggers=[trigger('hostileArrival',{kind:'time',seconds:0},[{kind:'reinforce',group:'squad',side:1,roster:[{type:'rifle',count:1}],at:[9,9],order:{kind:'hold'},expires:5}])];
 assert.throws(()=>createGame(m,['Defender'],false,[0],[0],{mode:'horde',weather:false}),/unavailable/,'scenario cannot inject uncounted Wave enemies');
 m.scenario.triggers[0].actions[0].side=0;const g=createGame(m,['Defender'],false,[0],[0],{mode:'horde',weather:false}); const reserve=[...g.mode.reserve];step(g);assert.deepEqual(g.mode.reserve,reserve,'scenario deferred arrivals are separate from Horde Reserve');
 assert.equal(g.scenario.groups.squad.length,1);
}
{
 const m=map();m.scenario=mission();m.scenario.triggers=[trigger('team',{kind:'ownership',target:'crossroads'},[{kind:'objectiveActivate',objective:'hold'}],{mode:'once'},{scope:'team',side:undefined,recipients:'team'})];
 const g=createGame(m,['A','B'],false,[0,0],[0,0],{weather:false,supply:false});g.points[0].owner=1;step(g);assert.equal(g.scenario.triggers['team@team:0'].count,1,'teammate ownership satisfies team scope');
 delete m.scenario.triggers[0].side;const json=JSON.parse(JSON.stringify(m));assert.deepEqual(json.scenario,m.scenario,'scenario contract round trips');
}
console.log('Structured scenario checks passed');
