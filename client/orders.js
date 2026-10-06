// World and minimap clicks share one command dispatcher.
export function createOrders(ctx) {
  function selection() {
    const sel = [...ctx.selected].map(id => ctx.units.get(id)).filter(v => v && v.owner === ctx.me);
    const troops = sel.filter(v => !ctx.defs[v.type].structure);
    const buildings = sel.filter(v => ctx.defs[v.type].building && ctx.defs[v.type].makes?.length);
    return { troops, buildings, trucks: troops.filter(v => v.type === 'truck'), planes: troops.filter(v => ctx.defs[v.type].air), eng: troops.filter(v => v.type === 'engineer') };
  }
  function kind(cursor, { troops, trucks, planes, eng }) {
    if (!troops.length) return null;
    const b = cursor.building;
    if (trucks.length === troops.length) return cursor.friend || b ? 'supply' : cursor.ground ? 'move' : null;
    if (cursor.friend && planes.length === troops.length) return 'escort';
    if (cursor.friend && cursor.friend.owner === ctx.me && ctx.defs[cursor.friend.type].carries && troops.some(v => ctx.defs[v.type].infantry)) return 'board';
    if (b && eng.length && (b.built < 1 || b.hp < ctx.defs[b.type].hpPer)) return 'assist';
    if (cursor.works != null && troops.some(v => ctx.diggers.includes(v.type))) return 'entrench';
    if (cursor.enemy) return 'attack';
    if (cursor.house) return 'house';
    return cursor.ground ? 'move' : null;
  }
  function wouldMove(cursor) { return kind(cursor, selection()) === 'move'; }
  function dispatch(cursor, event = {}, options = {}) {
    const selected = selection(), { troops, trucks, buildings, planes, eng } = selected, order = kind(cursor, selected);
    const commands = [], g = cursor.ground;
    let at = g, color = ctx.moveColor, tone = 660, voice = 'move', after = null;
    const add = command => commands.push(command);
    if (troops.length) {
      const b = cursor.building;
      if (order === 'supply') {
        at = cursor.friend ?? b; color = 0xa8d680; tone = 600; voice = null;
        add({ t: 'supply', ids: trucks.map(v => v.id), target: at.id });
      } else if (order === 'escort') {
        at = cursor.friend; color = 0x9dd0ff; tone = 600; voice = null;
        add({ t: 'escort', ids: planes.map(v => v.id), target: at.id });
      } else if (order === 'board') {
        // right-click your own halftrack with infantry: the nearest squad climbs in
        at = cursor.friend; color = 0x9dd0ff; tone = 600;
        add({ t: 'board', ids: troops.filter(v => ctx.defs[v.type].infantry).map(v => v.id), target: at.id });
      } else if (order === 'assist') {
        at = b; color = 0xe8c860; tone = 600; voice = null;
        add({ t: 'assist', ids: eng.map(v => v.id), id: b.id });
      } else if (order === 'entrench') {
        // right-click a planned entrenchment: the selected builder squads join it
        at = g; color = 0xc8a060; tone = 600; voice = 'move';
        add({ t: 'entrench', ids: troops.filter(v => ctx.diggers.includes(v.type)).map(v => v.id), join: cursor.works });
      } else if (order === 'attack') {
        at = cursor.enemy; color = 0xff4030; tone = 440; voice = 'attack';
        const fighters = troops.filter(v => v.type !== 'truck');
        if (fighters.length) add({ t: 'attack', ids: fighters.map(v => v.id), target: at.id });
        if (trucks.length && g) add({ t: 'move', orders: ctx.formation(trucks, g) });
      } else if (order === 'house') {
        at = cursor.house;
        const inf = troops.filter(v => ctx.defs[v.type].garrisons), guns = troops.filter(v => ctx.defs[v.type].w?.shellTerrain || ctx.defs[v.type].w?.salvo);
        const rest = troops.filter(v => !inf.includes(v) && !guns.includes(v));
        if (inf.length) add({ t: 'garrison', ids: inf.map(v => v.id), x: at.x, z: at.z });
        if (guns.length) add({ t: 'fireat', ids: guns.map(v => v.id), x: at.x, z: at.z });
        if (rest.length) add({ t: 'move', orders: ctx.formation(rest, at) });
        color = guns.length && !inf.length ? 0xff4030 : 0x9dd0ff; tone = 560; voice = null;
      } else if (order === 'move') {
        const attack = trucks.length !== troops.length && (options.attack || event.ctrlKey);
        color = attack ? 0xff9a40 : ctx.moveColor; tone = attack ? 500 : 660; voice = attack ? 'attack' : 'move';
        const together = ctx.together?.() ? { together: true } : {};
        const marching = attack ? troops.filter(v => v.type !== 'truck') : troops;
        if (Number.isFinite(options.face)) add({ t: attack ? 'amove' : 'move', orders: ctx.formation(marching, g, options.face, options.reach), face: options.face, ...together });
        else add({ t: attack ? 'amove' : 'move', orders: ctx.formation(marching, g), ...together });
        if (attack && trucks.length) add({ t: 'move', orders: ctx.formation(trucks, g) });
      }
    }
    if (buildings.length && g) {
      add({ t: 'rally', ids: buildings.map(v => v.id), x: g.x, z: g.z });
      if (!troops.length) { at = g; color = 0x9dd0ff; tone = 620; voice = null; }
    }
    if (!commands.length) return false;
    const queue = !!event.shiftKey;
    ctx.send(commands.length === 1 ? { ...commands[0], queue } : { t: 'orders', queue, commands });
    if (after) ctx.send(after);
    if (at) ctx.feedback(at, color, tone, voice);
    return true;
  }
  return { dispatch, wouldMove };
}
