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
export function clearFixtureUnits(g) {
  // A combat-only fixture must clear the new starting footprints as well as the entities.
  for(const b of g.units.values()) for(const c of b.cells??[]) {
    const ch=g.initialTerrain.chars[c];g.chars[c]=ch;g.flags[c]=sim.TERRAIN[ch]??0;
    g.cellHp[c]=0;g.buildingCells?.delete(c);
  }
  g.units.clear();g.newCells=[];g.cellLog=[];
}
