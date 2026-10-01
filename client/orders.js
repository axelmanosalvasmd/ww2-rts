// World and minimap clicks share one command dispatcher.
export function createOrders(ctx) {
  function dispatch(cursor, event = {}, options = {}) {
    const sel = [...ctx.selected].map(id => ctx.units.get(id)).filter(v => v && v.owner === ctx.me);
    const troops = sel.filter(v => !ctx.defs[v.type].structure);
    const buildings = sel.filter(v => ctx.defs[v.type].building && ctx.defs[v.type].makes?.length);
    const commands = [], g = cursor.ground;
    let at = g, color = ctx.moveColor, tone = 660, voice = 'move';
    const add = command => commands.push(command);
    if (troops.length) {
      const planes = troops.filter(v => ctx.defs[v.type].air);
      const eng = troops.filter(v => v.type === 'engineer'), b = cursor.building;
      if (cursor.friend && planes.length === troops.length) {
        at = cursor.friend; color = 0x9dd0ff; tone = 600; voice = null;
        add({ t: 'escort', ids: planes.map(v => v.id), target: at.id });
      } else if (b && eng.length && (b.built < 1 || b.hp < ctx.defs[b.type].hpPer)) {
        at = b; color = 0xe8c860; tone = 600; voice = null;
        add({ t: 'assist', ids: eng.map(v => v.id), id: b.id });
      } else if (cursor.works != null && troops.some(v => ctx.diggers.includes(v.type))) {
        // right-click a planned entrenchment: the selected builder squads join it
        at = g; color = 0xc8a060; tone = 600; voice = 'move';
        add({ t: 'entrench', ids: troops.filter(v => ctx.diggers.includes(v.type)).map(v => v.id), join: cursor.works });
      } else if (cursor.enemy) {
        at = cursor.enemy; color = 0xff4030; tone = 440; voice = 'attack';
        add({ t: 'attack', ids: troops.map(v => v.id), target: at.id });
      } else if (cursor.house) {
        at = cursor.house;
        const inf = troops.filter(v => ctx.defs[v.type].garrisons), guns = troops.filter(v => ctx.defs[v.type].w?.shellTerrain || ctx.defs[v.type].w?.salvo);
        const rest = troops.filter(v => !inf.includes(v) && !guns.includes(v));
        if (inf.length) add({ t: 'garrison', ids: inf.map(v => v.id), x: at.x, z: at.z });
        if (guns.length) add({ t: 'fireat', ids: guns.map(v => v.id), x: at.x, z: at.z });
        if (rest.length) add({ t: 'move', orders: ctx.formation(rest, at) });
        color = guns.length && !inf.length ? 0xff4030 : 0x9dd0ff; tone = 560; voice = null;
      } else if (g) {
        const attack = options.attack || event.ctrlKey;
        color = attack ? 0xff9a40 : ctx.moveColor; tone = attack ? 500 : 660; voice = attack ? 'attack' : 'move';
        add({ t: attack ? 'amove' : 'move', orders: ctx.formation(troops, g) });
      }
    }
    if (buildings.length && g) {
      add({ t: 'rally', ids: buildings.map(v => v.id), x: g.x, z: g.z });
      if (!troops.length) { at = g; color = 0x9dd0ff; tone = 620; voice = null; }
    }
    if (!commands.length) return false;
    const queue = !!event.shiftKey;
    ctx.send(commands.length === 1 ? { ...commands[0], queue } : { t: 'orders', queue, commands });
    if (at) ctx.feedback(at, color, tone, voice);
    return true;
  }
  return { dispatch };
}
