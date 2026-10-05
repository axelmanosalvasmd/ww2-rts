// Data-only authored missions. Runtime hooks use the ordinary world and unit contracts.
export const SCENARIO_LIMITS = Object.freeze({ triggers: 32, actions: 8, conditions: 32, depth: 6, objectives: 32, groups: 32, areas: 32, units: 128, executions: 32, roster: 32, boxCells: 256, tickWork: 4096, deferred: 256 });
const idOK = v => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9:_-]{0,63}$/.test(v);
const num = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi;
const int = (v, lo, hi) => Number.isInteger(v) && num(v, lo, hi);
const localized = t => typeof t === 'string' ? t.length > 0 && t.length <= 280 : t && typeof t === 'object' && Object.keys(t).length > 0 && Object.keys(t).length <= 8 && Object.values(t).every(v => typeof v === 'string' && v.length > 0 && v.length <= 280);
export function migrateScenario(map) {
  if (map.scenario) return structuredClone(map.scenario);
  if (!map.triggers?.length) return null;
  return { version: 1, areas: [], groups: [], objectives: [], triggers: map.triggers.map((t, i) => ({ id: `legacy:${i}`, scope: 'match', recipients: 'public', condition: { kind: 'time', seconds: t.at }, repeat: { mode: 'once' }, actions: [...(t.say ? [{ kind: 'say', text: { en: t.say }, recipients: 'public' }] : []), ...(t.blow ? [{ kind: 'destroy', box: [...t.blow] }] : [])] })) };
}
export function validateScenario(map, unitTypes = {}) {
  const s = migrateScenario(map); if (!s) return null;
  const L = SCENARIO_LIMITS, fail = detail => `scenario: ${detail}`;
  if (s.version !== 1) return fail('version must be 1');
  const names = {};
  for (const [key, limit] of [['triggers', L.triggers], ['objectives', L.objectives], ['groups', L.groups], ['areas', L.areas]]) {
    const list = s[key] ?? [];
    if (!Array.isArray(list) || list.length > limit) return fail(`${key} exceeds ${limit}`);
    names[key] = new Set();
    for (const v of list) { if (!v || !idOK(v.id) || names[key].has(v.id)) return fail(`${key} needs unique stable IDs`); names[key].add(v.id); }
  }
  const side = v => int(v, 0, map.spawns.length - 1);
  const at = v => Array.isArray(v) && v.length === 2 && int(v[0], 0, map.w - 1) && int(v[1], 0, map.h - 1);
  const box = v => Array.isArray(v) && v.length === 4 && at([v[0],v[1]]) && at([v[2],v[3]]) && v[0] <= v[2] && v[1] <= v[3] && (v[2]-v[0]+1)*(v[3]-v[1]+1) <= L.boxCells;
  const recipients = v => v === undefined || ['public','side','team'].includes(v);
  const type = v => Object.hasOwn(unitTypes, v) && !unitTypes[v].structure && !unitTypes[v].building && !unitTypes[v].air;
  const units = new Set(); let unitCount = 0;
  for (const a of s.areas ?? []) if (!box(a.box)) return fail(`area ${a.id} needs a valid box of up to ${L.boxCells} cells`);
  for (const o of s.objectives ?? []) if (!localized(o.text) || !recipients(o.recipients) || (o.side !== undefined && !side(o.side)) || (o.recipients && o.recipients !== 'public' && !side(o.side))) return fail(`objective ${o.id} needs text and valid recipients`);
  for (const group of s.groups ?? []) {
    if (!Array.isArray(group.units) || (unitCount += group.units.length) > L.units) return fail('too many authored units');
    for (const u of group.units) { if (!u || !idOK(u.id) || units.has(u.id) || !type(u.type) || !side(u.side) || !at([u.x,u.y])) return fail(`group ${group.id} has an invalid unit`); units.add(u.id); }
  }
  if ((map.points ?? []).some(p => p.id !== undefined && !idOK(p.id))) return fail('capture targets need stable IDs');
  const targets = new Set((map.points ?? []).map((p,i) => p.id ?? `point:${i}`));
  for (const r of map.world?.regions ?? []) targets.add(`region:${r.id}`);
  if (targets.size !== (map.points?.length ?? 0) + (map.world?.regions?.length ?? 0)) return fail('capture targets need unique IDs');
  const edges = new Map(); let work = 0;
  for (const t of s.triggers ?? []) {
    if (!['match','player','team'].includes(t.scope) || !recipients(t.recipients) || (t.side !== undefined && !side(t.side)) || (t.scope === 'match' && t.recipients && t.recipients !== 'public' && !side(t.side))) return fail(`trigger ${t.id} has invalid scope or recipients`);
    const repeat = t.repeat ?? { mode:'once' };
    if (!['once','risingEdge','whileTrue'].includes(repeat.mode) || (repeat.mode !== 'once' && (!num(repeat.cooldown, 0.05, 7200) || !int(repeat.max, 1, L.executions)))) return fail(`trigger ${t.id} needs a positive cooldown and finite execution limit`);
    let count = 0; const dependencies = [];
    function condition(c, depth = 0) {
      if (!c || ++count > L.conditions || depth > L.depth) return false;
      if (c.kind === 'all' || c.kind === 'any') return Array.isArray(c.conditions) && c.conditions.length > 0 && c.conditions.length <= L.conditions && c.conditions.every(q => condition(q, depth+1));
      if (c.side !== undefined && !side(c.side)) return false;
      if (c.kind === 'time') return num(c.seconds,0,7200);
      if (c.kind === 'ownership' || c.kind === 'capture') return targets.has(c.target) && (side(c.side) || t.scope !== 'match' || side(t.side));
      if (c.kind === 'unitLost') return units.has(c.unit);
      if (c.kind === 'groupLost') return names.groups.has(c.group);
      if (c.kind === 'groupCount') return names.groups.has(c.group) && int(c.count,0,L.units) && ['atMost','atLeast','equal'].includes(c.op);
      if (c.kind === 'areaEntry') return names.areas.has(c.area) && (c.group === undefined || names.groups.has(c.group)) && (c.group !== undefined || side(c.side) || t.scope !== 'match' || side(t.side));
      if (c.kind === 'objectiveComplete') { dependencies.push(`o:${c.objective}`); return names.objectives.has(c.objective); }
      if (c.kind === 'triggerComplete') { dependencies.push(`t:${c.trigger}`); return names.triggers.has(c.trigger); }
      return false;
    }
    if (!condition(t.condition)) return fail(`trigger ${t.id} has an invalid condition or reference`);
    edges.set(`t:${t.id}`,dependencies);
    if (!Array.isArray(t.actions) || !t.actions.length || t.actions.length > L.actions) return fail(`trigger ${t.id} needs 1-${L.actions} actions`);
    let actionWork = 0;
    for (const a of t.actions) {
      if (!a || !recipients(a.recipients) || (a.side !== undefined && !side(a.side))) return fail(`trigger ${t.id} has invalid action recipients`);
      if (a.kind === 'say') { if (!localized(a.text) || ((a.recipients ?? t.recipients ?? 'public') !== 'public' && t.scope === 'match' && !side(a.side ?? t.side))) return fail(`trigger ${t.id} has invalid announcement`); }
      else if (a.kind === 'objectiveActivate' || a.kind === 'objectiveComplete') { if (!names.objectives.has(a.objective)) return fail(`trigger ${t.id} references an unknown objective`); if (a.kind === 'objectiveComplete') { const k = `o:${a.objective}`; edges.set(k,[...(edges.get(k) ?? []),`t:${t.id}`]); } }
      else if (a.kind === 'reinforce') {
        if (!names.groups.has(a.group) || !side(a.side) || !at(a.at) || !num(a.expires,0.05,7200) || !Array.isArray(a.roster) || !a.roster.length || a.roster.length > L.roster || a.roster.some(r => !r || !type(r.type) || !int(r.count,1,L.roster)) || a.roster.reduce((n,r)=>n+r.count,0)>L.roster || !a.order || !['move','attackMove','hold'].includes(a.order.kind) || (a.order.kind !== 'hold' && !at(a.order.at))) return fail(`trigger ${t.id} has invalid reinforcements`);
        actionWork += a.roster.reduce((n,r)=>n+r.count,0);
      } else if (a.kind === 'damage' || a.kind === 'destroy') { if (!box(a.box) || (a.kind === 'damage' && !num(a.damage,0.01,100000))) return fail(`trigger ${t.id} has an invalid damage area`); actionWork += (a.box[2]-a.box[0]+1)*(a.box[3]-a.box[1]+1); }
      else return fail(`trigger ${t.id} has an unknown action`);
      actionWork++;
    }
    work += (count + actionWork) * (t.scope === 'match' ? 1 : map.spawns.length);
  }
  if (work > L.tickWork) return fail(`total trigger work exceeds ${L.tickWork}`);
  const visited = new Set(), active = new Set();
  function cyclic(k) { if(active.has(k)) return true; if(visited.has(k)) return false; active.add(k); if((edges.get(k)??[]).some(cyclic)) return true; active.delete(k); visited.add(k); return false; }
  if ([...edges.keys()].some(cyclic)) return fail('objective or trigger dependencies form a cycle');
  return null;
}

const ownerFor = (g, target) => target.startsWith('region:') ? g.world?.regions.find(r => `region:${r.id}` === target)?.team : g.points.find(p => p.scenarioId === target)?.owner;
const contextKey = c => c.kind === 'match' ? 'match' : `${c.kind}:${c.id}`;
const objectiveKey = (id,c) => `${id}@${contextKey(c)}`;
const sideFor = (a,t,c) => a.side ?? t.side ?? c.slot;
function permitted(g, policy, side, slot) { return policy === 'public' || (policy === 'side' ? side === slot : g.players[side]?.team === g.players[slot]?.team); }
export function setupScenario(g, map, tools) {
  const data = migrateScenario(map); if (!data) return;
  g.scenario = { data, triggers:{}, objectives:{}, groups:{}, groupStarted:{}, units:{}, deferred:[], captured:{}, owners:{}, nextExecution:1 };
  for (const p of g.points) g.scenario.owners[p.scenarioId] = p.owner;
  for (const r of g.world?.regions ?? []) g.scenario.owners[`region:${r.id}`] = r.team;
  for (const group of data.groups ?? []) {
    g.scenario.groups[group.id] = [];
    for (const u of group.units) g.scenario.deferred.push({ id:`initial:${u.id}`, group:group.id, side:u.side, units:[{type:u.type, authored:u.id}], at:[u.x,u.y], order:{kind:'hold'}, expires:7200 });
  }
  // The caller validates once before setup. Runtime hooks are kept outside persisted state.
  runDeferred(g,tools,0);
}
function contexts(g,t) {
  if(t.scope === 'match') return [{kind:'match',id:0,slot:t.side ?? 0}];
  if(t.scope === 'player') return g.players.filter(p=>!p.out && (t.side === undefined || p.slot === t.side)).map(p=>({kind:'player',id:p.slot,slot:p.slot}));
  return [...new Set(g.players.filter(p=>!p.out && (t.side === undefined || p.team === g.players[t.side]?.team)).map(p=>p.team))].map(team=>({kind:'team',id:team,slot:g.players.find(p=>p.team===team && !p.out).slot}));
}
const WORK_EXHAUSTED = Symbol('scenario work exhausted');
function spend(budget) { if (--budget.left < 0) throw WORK_EXHAUSTED; }
function groupAlive(g,id,budget) { const out=[]; for (const unitId of g.scenario.groups[id] ?? []) { spend(budget); const u=g.units.get(unitId); if (u?.hp>0) out.push(u); } return out; }
function check(g,q,t,c,now,budget) {
  spend(budget);
  const s=g.scenario, side=sideFor(q,t,c);
  if(q.kind==='all') return q.conditions.every(v=>check(g,v,t,c,now,budget));
  if(q.kind==='any') return q.conditions.some(v=>check(g,v,t,c,now,budget));
  if(q.kind==='time') return now>=q.seconds;
  if(q.kind==='ownership') { const owner=ownerFor(g,q.target); return q.target.startsWith('region:') ? owner===g.players[side]?.team : c.kind==='team' && q.side===undefined ? g.players[owner]?.team===c.id : owner===side; }
  if(q.kind==='capture') { if(c.kind==='team' && q.side===undefined && !q.target.startsWith('region:')) return g.players.some(p=>p.team===c.id && s.captured[`${q.target}:${p.slot}`]); return !!s.captured[`${q.target}:${q.target.startsWith('region:') ? g.players[side]?.team : side}`]; }
  if(q.kind==='unitLost') return s.units[q.unit] !== undefined && !(g.units.get(s.units[q.unit])?.hp > 0);
  if(q.kind==='groupLost') return s.groupStarted[q.group]===true && !groupAlive(g,q.group,budget).length && !s.deferred.some(d=>d.group===q.group);
  if(q.kind==='groupCount') { const n=groupAlive(g,q.group,budget).length; return q.op==='atMost'? n<=q.count:q.op==='atLeast'?n>=q.count:n===q.count; }
  if(q.kind==='areaEntry') { const box=s.data.areas.find(a=>a.id===q.area).box; for (const u of q.group ? groupAlive(g,q.group,budget) : g.units.values()) { spend(budget); if ((q.group || u.owner===side) && u.hp>0 && u.x>=box[0]*2 && u.x<(box[2]+1)*2 && u.z>=box[1]*2 && u.z<(box[3]+1)*2) return true; } return false; }
  if(q.kind==='objectiveComplete') return s.objectives[objectiveKey(q.objective,c)]?.state==='complete' || s.objectives[`${q.objective}@match`]?.state==='complete';
  if(q.kind==='triggerComplete') return (s.triggers[`${q.trigger}@${contextKey(c)}`]?.count ?? s.triggers[`${q.trigger}@match`]?.count ?? 0)>0;
  return false;
}
function runDeferred(g,tools,now) {
  const s=g.scenario; let work=0;
  s.deferred=s.deferred.filter(d=>{
    if(now>=d.expires || g.players[d.side]?.out) return false;
    while(d.units.length && work++<SCENARIO_LIMITS.deferred) {
      const spec=d.units[0], u=tools.arrive(g,d.side,spec.type,d.at,d.order);
      if(!u) break;
      d.units.shift(); s.groupStarted[d.group]=true; s.groups[d.group].push(u.id); if(spec.authored) s.units[spec.authored]=u.id;
    }
    return d.units.length>0;
  });
}
export function stepScenario(g,tools) {
  const s=g.scenario; if(!s) return; const now=tools.now(g);
  for(const target of Object.keys(s.owners)) { const owner=ownerFor(g,target); if(owner>=0 && owner!==s.owners[target]) s.captured[`${target}:${owner}`]=true; s.owners[target]=owner; }
  // Keep group membership bounded by current field limits, rather than every past arrival.
  for (const group of Object.keys(s.groups)) s.groups[group]=s.groups[group].filter(id=>g.units.get(id)?.hp>0);
  runDeferred(g,tools,now);
  const budget={left:SCENARIO_LIMITS.tickWork};
  for(const t of s.data.triggers ?? []) for(const c of contexts(g,t)) {
    const key=`${t.id}@${contextKey(c)}`, state=s.triggers[key] ??= {count:0,next:0,previous:false};
    let yes; try { yes=check(g,t.condition,t,c,now,budget); } catch(error) { if(error===WORK_EXHAUSTED) return; throw error; }
    const actionCost=t.actions.reduce((n,a)=>n+(a.box?(a.box[2]-a.box[0]+1)*(a.box[3]-a.box[1]+1):a.roster?a.roster.reduce((k,r)=>k+r.count,0):1),0);
    if(budget.left<actionCost) return;
    const edge=yes && !state.previous; state.previous=yes;
    const r=t.repeat ?? {mode:'once'}, max=r.mode==='once'?1:r.max;
    if(!yes || state.count>=max || now<state.next || (r.mode==='risingEdge' && !edge)) continue;
    const arrivals=t.actions.filter(a=>a.kind==='reinforce');
    if(s.deferred.length+arrivals.length>SCENARIO_LIMITS.deferred) continue;
    const execution=`scenario:${s.nextExecution++}`;
    // Preflight every effect before reserving this execution, so a rejected batch changes nothing.
    if(t.actions.some(a=>!tools.allowed(g,a,sideFor(a,t,c)))) continue;
    budget.left-=actionCost;
    state.count++; state.next=now+(r.cooldown ?? 0); state.execution=execution;
    t.actions.forEach((a,i)=>{
      const side=sideFor(a,t,c), policy=a.recipients ?? t.recipients ?? 'public';
      if(a.kind==='say') g.shots.push({k:'say',text:typeof a.text==='string'?a.text:a.text.en ?? Object.values(a.text)[0],localized:a.text,scenarioRecipients:policy,scenarioSide:side,pub:policy==='public',execution,atTick:g.tick});
      else if(a.kind==='objectiveActivate' || a.kind==='objectiveComplete') {
        const o=s.data.objectives.find(o=>o.id===a.objective), k=objectiveKey(o.id,c), old=s.objectives[k];
        if(old?.state==='complete' && a.kind==='objectiveActivate') return;
        s.objectives[k]={id:o.id,scope:contextKey(c),text:o.text,state:a.kind==='objectiveComplete'?'complete':'active',recipients:o.recipients ?? policy,side:o.side ?? side,updated:now,execution};
      } else if(a.kind==='reinforce') s.deferred.push({id:`${execution}:${i}`,group:a.group,side,units:a.roster.flatMap(r=>Array.from({length:r.count},()=>({type:r.type}))),at:[...a.at],order:structuredClone(a.order),expires:now+a.expires});
      else tools.damage(g,a,`${execution}:${i}`);
    });
  }
  runDeferred(g,tools,now);
}
export function scenarioFor(g,slot) {
  if(!g.scenario) return undefined;
  return {version:1,objectives:Object.values(g.scenario.objectives).filter(o=>permitted(g,o.recipients,o.side,slot)).map(o=>structuredClone(o))};
}
export function scenarioShotFor(g,s,slot) { return s.scenarioRecipients === undefined || permitted(g,s.scenarioRecipients,s.scenarioSide,slot); }
