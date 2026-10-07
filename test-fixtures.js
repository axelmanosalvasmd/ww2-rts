// Legacy combat tests recruit arbitrary armies to isolate combat, pathing and resource rules.
// Supply a temporary completed producer during fixture purchases, then remove it before stepping.
// Production gating itself is tested against the unwrapped command in test-skirmish-bases.js.
import * as sim from './shared/sim.js';
export function fixtureCommand(g, slot, cmd, ...args) {
  if (cmd?.t !== 'buy' || !sim.isSkirmishBaseMode(g) || !g.players[slot] || typeof cmd.unit !== 'string' || !Object.hasOwn(sim.UNITS,cmd.unit) || Object.hasOwn(cmd,'from')) return sim.command(g,slot,cmd,...args);
  if (sim.productionBuildings(g,slot,cmd.unit).length) return sim.command(g,slot,cmd,...args);
  const type=Object.keys(sim.UNITS).find(t=>sim.UNITS[t].makes?.includes(cmd.unit));
  if (!type) return sim.command(g,slot,cmd,...args);
  const id=-100-slot, b={id,type,owner:slot,...g.players[slot].spawn,hp:sim.UNITS[type].hpPer,built:1,queue:[]};
  g.units.set(id,b);
  try {
    const result=sim.command(g,slot,cmd,...args);
    if(result===undefined && sim.UNITS[cmd.unit].air) {
      const u=[...g.units.values()].at(-1), p=g.players[slot].spawn, cx=g.w*sim.CELL/2, cz=g.h*sim.CELL/2, length=Math.hypot(p.x-cx,p.z-cz)||1;
      // The temporary airfield is gone before the first tick: the fixture plane parks at the fallback base.
      Object.assign(u,{x:p.x+(p.x-cx)/length*sim.CFG.air.offmap,z:p.z+(p.z-cz)/length*sim.CFG.air.offmap});
    }
    return result;
  } finally {g.units.delete(id);}
}
export function clearFixtureUnits(g, which) {
  // A combat-only fixture must clear the new starting footprints as well as the entities. which: only these units.
  for(const b of g.units.values()) {
    if(which && !which(b)) continue;
    if(which) g.units.delete(b.id);
    if(b.structureId) g.structures?.delete(b.structureId);
    for(const c of b.cells??[]) {
      g.structuralCells?.delete(c);g.buildingCells?.delete(c);
      sim.mutateWorldCell(g,c,{ground:g.initialTerrain.ground[c],object:g.initialTerrain.objects[c],mine:!!g.initialTerrain.mineLayer[c],height:g.initialTerrain.height?.[c]??0});
    }
  }
  if(!which) g.units.clear();
  g.newCells=[];g.cellLog=[];
}
export function fixtureFactories(g, slot, types = ['hq', 'barracks', 'motorpool', 'airfield']) {
  // A cleared AI fixture keeps finished producers, so a purchase tests the AI's choice, not the tech tree.
  types.forEach((type, i) => { const id = -200 - slot * 10 - i; g.units.set(id, { id, type, owner: slot, ...g.players[slot].spawn, hp: sim.UNITS[type].hpPer, built: 1, queue: [] }); });
}
