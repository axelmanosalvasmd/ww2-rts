import { UNITS } from './sim.js';

// Capability is gameplay behavior, independent of reaction-population labels.
export function armedContactActor(unit) {
  const def = unit && UNITS[unit.type], weapon = def?.w;
  return !!unit && unit.hp > 0 && !!weapon && weapon.range > 0 && (weapon.inf > 0 || weapon.veh > 0)
    && !def.structure && !def.air && !def.medic && unit.type !== 'engineer' && !(unit.flags & (512 | 262144));
}
export function commandServesObservedEvent(cmd, event, view, slot) {
  if (!event || ['buy','build','dig','entrench','recover','assist','inspect'].includes(cmd.t)) return false;
  const near = (a,b,r) => !!a && !!b && Math.hypot(a.x-b.x,a.z-b.z) <= r;
  const movement = cmd.t === 'move' || cmd.t === 'amove';
  const ids = movement ? cmd.orders?.map(row=>row[0]) ?? [] : cmd.ids ?? [];
  const own = ids.map(id=>view.units.get(id)).filter(unit=>unit?.owner===slot && unit.hp>0 && view.screenIds.has(unit.id));
  const hostile = unit => unit && unit.hp>0 && view.screenIds.has(unit.id)
    && view.players[unit.owner]?.team !== view.players[slot].team;
  const idle = unit => armedContactActor(unit) && !unit.retreating && !unit.path.length && !unit.orders.length
    && !unit.targetId && !unit.attackId && !unit.amove && !unit.dig && !unit.build && !unit.nade
    && !unit.entrench && unit.enter<0 && unit.fireAt<0;
  let focus=event;
  if(event.kind==='screen-contact') {
    focus=view.units.get(event.targetId);if(!hostile(focus))return false;
    if(cmd.t!=='support' && !own.some(unit=>idle(unit)&&near(unit,focus,45)))return false;
  } else if(event.kind==='screen-damage') {
    focus=view.units.get(event.unitId);
    if(!focus || focus.owner!==slot || focus.hp<=0 || !view.screenIds.has(focus.id))return false;
  } else if(cmd.t!=='support' && !own.some(unit=>near(unit,focus,48))) return false;
  const victim = own.some(unit=>unit.id===event.unitId);
  if(movement) return cmd.orders.some(row=>own.some(unit=>unit.id===row[0])
    && (event.kind!=='screen-damage'||row[0]===event.unitId) && near({x:row[1],z:row[2]},focus,24));
  if(['retreat','stance','cover'].includes(cmd.t)) return event.kind==='screen-damage' ? victim : own.some(unit=>near(unit,focus,24));
  const target = view.units.get(cmd.target);
  if(cmd.t==='attack') return hostile(target) && near(target,focus,24)
    && own.some(unit=>near(unit,target,UNITS[unit.type]?.w?.range??0));
  const at = Number.isFinite(cmd.x)&&Number.isFinite(cmd.z) ? cmd : null;
  const nearbyHostile = [...view.units.values()].find(unit=>hostile(unit)&&near(unit,focus,24)&&near(unit,at,24));
  if(cmd.t==='support') {
    if(!at || !near(at,focus,24))return false;
    if(cmd.kind==='smoke')return true;
    return ['artillery','strafe','bombing','dive'].includes(cmd.kind) && !!nearbyHostile;
  }
  if(cmd.t==='ability') {
    if(own.some(unit=>UNITS[unit.type]?.ab?.id==='smoke'&&near(unit,focus,24)))return true;
    if(at) return near(at,focus,24) && own.some(unit=>{
      const ability=UNITS[unit.type]?.ab;
      return ['grenade','barrage','satchel'].includes(ability?.id)
        && !!nearbyHostile && near(unit,at,ability.range??0);
    });
    return own.some(unit=>{
      const ability=UNITS[unit.type]?.ab, current=view.units.get(unit.targetId);
      return ['suppress','ap'].includes(ability?.id)&&hostile(current)&&near(current,focus,24)
        && near(unit,current,UNITS[unit.type]?.w?.range??0);
    });
  }
  return false;
}

// Use actual observations and intended actors to order useful work within the current visit.
export function prioritizeVisit(intents, inspections, view, concern, answered, slot, tick) {
  const ids = cmd => cmd.ids ?? cmd.orders?.map(row => row[0]) ?? [];
  const near = (a, b, range) => Math.hypot(a.x - b.x, a.z - b.z) <= range;
  const point = cmd => cmd.orders?.length ? { x: cmd.orders.reduce((n, row) => n + row[1], 0) / cmd.orders.length,
    z: cmd.orders.reduce((n, row) => n + row[2], 0) / cmd.orders.length } : Number.isFinite(cmd.x) ? cmd : null;
  const movement = cmd => ['move', 'amove'].includes(cmd.t);
  const stimuli = (view.events ?? []).filter(event => ['screen-contact', 'screen-damage', 'base'].includes(event.kind)
    && !answered?.has(event.id) && event.tick <= tick && tick - event.tick <= 240);
  const relevance = cmd => {
    const relevant = stimuli.filter(event => commandServesObservedEvent(cmd, event, view, slot));
    const attended = relevant.find(event => event.id === concern?.eventId);
    if (attended) return { attended: 1, creation: attended.tick };
    if (concern?.kind === 'idle' && ids(cmd).includes(concern.unitId))
      return { attended: 1, creation: concern.since ?? tick };
    const at = point(cmd);
    if (concern?.kind === 'expansion' && movement(cmd) && at && near(at, concern, 24))
      return { attended: 1, creation: concern.since ?? tick };
    return { attended: 0, creation: Math.max(-1, ...relevant.map(event => event.tick)) };
  };
  const scores = new Map(intents.map(cmd => [cmd, relevance(cmd)]));
  intents.sort((a, b) => Number(b.t === 'retreat') - Number(a.t === 'retreat')
    || scores.get(b).attended - scores.get(a).attended || scores.get(b).creation - scores.get(a).creation);
  const useful = intents.filter(cmd => scores.get(cmd).creation >= 0);
  const readyActors = new Set(useful.flatMap(ids));
  const retainedInspections = inspections.filter(cmd => !useful.length || ids(cmd).some(id => readyActors.has(id)));
  // Pending reads use the same observed relevance when no useful action is already ready.
  const rankedInspections = useful.length ? retainedInspections : retainedInspections
    .map((cmd, index) => ({ cmd, index, score: relevance(cmd) }))
    .sort((a, b) => b.score.attended - a.score.attended || b.score.creation - a.score.creation || a.index - b.index)
    .map(candidate => candidate.cmd);
  return { intents, inspections: rankedInspections };
}
