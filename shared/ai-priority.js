import { UNITS, SUPPORT, los } from './sim.js';

// Capability is gameplay behavior, independent of reaction-population labels.
export function armedContactActor(unit) {
  const def = unit && UNITS[unit.type], weapon = def?.w;
  return !!unit && unit.hp > 0 && !!weapon && weapon.range > 0 && (weapon.inf > 0 || weapon.veh > 0)
    && !def.structure && !def.air && !def.medic && unit.type !== 'engineer' && !(unit.flags & (512 | 262144));
}
// Support can hurt either team. Inspect only the current delivered camera scene.
export function supportContains(cmd, point, view, slot, hazard = false) {
  const sp = SUPPORT[cmd.kind], spawn = view.players[slot]?.spawn;
  if (!sp || !Number.isFinite(cmd.x) || !Number.isFinite(cmd.z) || !point) return false;
  if (cmd.kind === 'dive') return Math.hypot(point.x-cmd.x, point.z-cmd.z) <= sp.blast;
  const dir = Number.isFinite(cmd.dir) ? cmd.dir : spawn && Math.atan2(cmd.z-spawn.z, cmd.x-spawn.x);
  if (!Number.isFinite(dir)) return false;
  const dx=point.x-cmd.x, dz=point.z-cmd.z, margin=hazard ? sp.blast??0 : 0;
  return Math.abs(dx*Math.cos(dir)+dz*Math.sin(dir)) <= sp.len/2+margin
    && Math.abs(-dx*Math.sin(dir)+dz*Math.cos(dir)) <= (cmd.kind==='bombing'?3:sp.width)/2+margin;
}
export function supportClearOfObservedFriends(cmd, view, slot) {
  return ![...view.screenIds].some(id => {
    const unit=view.units.get(id);
    return unit?.hp>0 && view.players[unit.owner]?.team===view.players[slot].team
      && supportContains(cmd,unit,view,slot,true);
  });
}
// A real HUD read can investigate a local cue before readiness is known. It does not answer the cue.
export function inspectionServesObservedEvent(cmd, event, view, slot) {
  if (!event || cmd.t !== 'ability' || cmd.ids?.length !== 1) return false;
  const unit = view.units.get(cmd.ids[0]), def = UNITS[unit?.type], ability = def?.ab;
  if (!armedContactActor(unit) || unit.owner !== slot || unit.retreating || !view.screenIds.has(unit.id)
    || !ability || ability.id === 'none') return false;
  const near = (a, b, radius) => !!a && !!b && Math.hypot(a.x - b.x, a.z - b.z) <= radius;
  const hostile = target => target?.hp > 0 && view.screenIds.has(target.id)
    && !(target.flags & (512 | 262144)) && view.players[target.owner]?.team !== view.players[slot].team;
  let focus;
  if (event.kind === 'screen-damage') {
    if (unit.id !== event.unitId) return false;
    focus = unit;
  } else if (event.kind === 'screen-contact') {
    focus = view.units.get(event.targetId);
    if (!hostile(focus) || !near(unit, focus, 45)) return false;
  } else return false;
  if (ability.id === 'smoke') return event.kind === 'screen-damage';
  const target = view.units.get(unit.targetId);
  if (['suppress', 'ap'].includes(ability.id)) return hostile(target) && near(target, focus, 24)
    && near(unit, target, def.w.range) && los(view, unit, target)
    && (ability.id === 'suppress' ? UNITS[target.type].infantry && !target.retreating && def.w.supp > 0
      : !UNITS[target.type].infantry && !UNITS[target.type].structure && def.w.veh > def.w.inf
        && (!ability.naval || UNITS[target.type].naval));
  if (!Number.isFinite(cmd.x) || !Number.isFinite(cmd.z) || !near(unit, cmd, ability.range ?? 0)) return false;
  return ['grenade', 'satchel', 'barrage'].includes(ability.id) && near(cmd, focus, 24)
    && [...view.screenIds].some(id => { const target = view.units.get(id);
      return hostile(target) && near(target, cmd, ability.radius ?? def.w?.blast ?? 0); });
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
  const effective = (unit,target) => {
    const w=UNITS[unit?.type]?.w, def=UNITS[target?.type];
    return !!w && !!def && (def.infantry ? w.inf>0 || w.supp>0 : w.veh>0 && w.veh>w.inf);
  };
  const engages = (unit,target) => {
    const w=UNITS[unit?.type]?.w;
    return !!w && target?.hp>0 && !(unit.flags & (512 | 262144)) && !(target.flags & (512 | 262144)) && view.screenIds.has(target.id)
      && view.players[unit.owner]?.team!==view.players[target.owner]?.team && effective(unit,target)
      && near(unit,target,w.range) && (!w.salvo || Math.hypot(unit.x-target.x,unit.z-target.z)>=(w.minRange??0))
      && (w.salvo || los(view,unit,target));
  };
  const protectedUnits=event.kind==='screen-damage' ? [focus]
    : [...view.screenIds].map(id=>view.units.get(id)).filter(unit=>unit?.owner===slot && idle(unit) && near(unit,focus,45));
  const threatens=foe=>protectedUnits.some(unit=>engages(foe,unit));

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
    return ['artillery','strafe','bombing','dive'].includes(cmd.kind) && supportClearOfObservedFriends(cmd,view,slot)
      && [...view.screenIds].some(id=>{
        const foe=view.units.get(id), def=UNITS[foe?.type], sp=SUPPORT[cmd.kind];
        return hostile(foe) && !def.air && near(foe,focus,24) && threatens(foe) && supportContains(cmd,foe,view,slot)
          && (def.infantry ? sp.inf>0 || sp.supp>0 : sp.veh>sp.inf);
      });
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
      const w=UNITS[unit.type]?.w;
      const stationary=unit.path.length ? w?.moveFire!==undefined
        : Number.isFinite(unit.firstStillAt) && view.tick/20-unit.firstStillAt>=(w?.setup??0);
      return ['suppress','ap'].includes(ability?.id) && unit.cdKnown===true && unit.cd<=0
        && unit.hpSource==='selected-hud' && !unit.retreating && stationary && (!unit.holdFire || unit.attackId===current?.id)
        && hostile(current) && near(current,focus,24) && engages(unit,current) && threatens(current)
        && (ability.id==='suppress' ? UNITS[current.type].infantry && !current.retreating && w.supp>0 && !(unit.flags&2)
          : !w.shellTerrain && !w.blast && !w.area && !w.salvo && !UNITS[current.type].infantry
            && !UNITS[current.type].structure && (!ability.naval || UNITS[current.type].naval) && !(unit.flags&4));
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
  const relevance = (cmd, inspection = false) => {
    const serves = inspection ? inspectionServesObservedEvent : commandServesObservedEvent;
    const relevant = stimuli.filter(event => serves(cmd, event, view, slot));
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
  // A planner-admitted local ability can proceed before unrelated reads without certifying an event answer.
  const ready = useful.length ? useful : intents.filter(cmd => cmd.t === 'ability' && relevance(cmd, true).creation >= 0);
  const readyActors = new Set(ready.flatMap(ids));
  const retainedInspections = inspections.filter(cmd => !ready.length || ids(cmd).some(id => readyActors.has(id)));
  // Pending reads use the same observed relevance when no useful action is already ready.
  const rankedInspections = ready.length ? retainedInspections : retainedInspections
    .map((cmd, index) => ({ cmd, index, score: relevance(cmd, true) }))
    .sort((a, b) => b.score.attended - a.score.attended || b.score.creation - a.score.creation || a.index - b.index)
    .map(candidate => candidate.cmd);
  return { intents, inspections: rankedInspections };
}
