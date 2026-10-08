import assert from 'node:assert/strict';
import * as sim from './shared/sim.js';
const map = { w: 64, h: 64, rows: Array(64).fill('.'.repeat(64)), spawns: [{ x: 10, y: 32 }, { x: 54, y: 32 }], points: [] };
const g = sim.createGame(map, ['commander', 'enemy'], true, [0,1]);
assert.equal(typeof sim.joinOperative, 'function', 'simulation exposes authoritative operative joining');
const op = sim.joinOperative(g, 'friend', 0);
const u = g.units.get(op.unitId);
assert.equal(u.hp, sim.UNITS.rifle.hpPer, 'operative has one ordinary rifleman health');
assert.equal(u.operative, 'friend');
assert.equal(sim.joinOperative(g, 'friend', 0), op, 'reconnect reuses identity and soldier');
assert.equal(sim.joinOperative(g, 'bad', 99), null, 'invalid commander refused');
console.log('PASS operative join, single soldier and identity');
const start = { x: u.x, z: u.z };
assert.equal(sim.operativeInput(g, 'friend', { seq: 0, forward: 1, strafe: 1, yaw: 0, pitch: 0, fire: false }), true);
assert.equal(sim.operativeInput(g, 'friend', { seq: 0, forward: 1, strafe: 0, yaw: 0, pitch: 0 }), false, 'replay rejected');
assert.equal(sim.operativeInput(g, 'friend', { seq: 1, forward: 100, strafe: 0, yaw: 0, pitch: 0 }), false, 'invalid speed rejected');
assert.equal(sim.operativeInput(g, 'friend', { seq: 1, forward: 1, strafe: 0, yaw: Infinity, pitch: 0 }), false);
sim.command(g, 0, { t: 'move', orders: [[u.id, 80, 80]] });
assert.equal(u.path.length, 0, 'commander cannot redirect operative');
for (let i = 0; i < 5; i++) sim.step(g);
const travelled = Math.hypot(u.x - start.x, u.z - start.z);
assert.ok(travelled > 0.5 && travelled <= sim.UNITS.rifle.speed * sim.TICK * 5 + 0.001, 'diagonal speed capped');
for (let i = 0; i < 20; i++) sim.step(g);
const stopped = {x:u.x,z:u.z};
for (let i = 0; i < 10; i++) sim.step(g);
assert.deepEqual({x:u.x,z:u.z}, stopped, 'stale input stops movement');
assert.equal(u.hp, sim.UNITS.rifle.hpPer, 'no squad replenishment');
// Isolate terrain checks from friendly spacing.
for (const other of [...g.units.values()]) if (other !== u) g.units.delete(other.id);
u.x = 31; u.z = 31;
for (let y=0;y<64;y++) g.flags[y*64+16] |= sim.MOVE;
for (let i=0;i<20;i++) { sim.operativeInput(g, 'friend', {seq: i+10, forward:1,strafe:0,yaw:0,pitch:0}); sim.step(g); }
assert.ok(u.x < 32, 'wall collision');
g.height = new Int8Array(64*64);
for (let y=0;y<64;y++) { g.flags[y*64+16] &= ~sim.MOVE; g.height[y*64+16] = 4; }
for (let i=0;i<20;i++) { sim.operativeInput(g, 'friend', {seq:i+40,forward:1,strafe:0,yaw:0,pitch:0}); sim.step(g); }
assert.ok(u.x < 32, 'cliff collision');
console.log('PASS bounded movement, stale/replay/invalid input, commander isolation, walls and cliffs');
// A real enemy from the same simulation, with AI fire disabled for deterministic aim checks.
const combat = sim.createGame(map, ['commander','enemy'], true, [0,1]);
const cop = sim.joinOperative(combat, 'gunner', 0), shooter = combat.units.get(cop.unitId);
const enemy = [...combat.units.values()].find(v=>v.owner===1 && v.type==='rifle');
for (const v of [...combat.units.values()]) if (v !== enemy && v !== shooter) combat.units.delete(v.id);
Object.assign(shooter, {x:40,z:60}); Object.assign(enemy,{x:50,z:60,auto:false,autoRetreat:false,holdFire:true,holdPos:true});
for(let i=0;i<5;i++) sim.step(combat);
const initialHp=enemy.hp;
sim.operativeInput(combat,'gunner',{seq:1,forward:0,strafe:0,yaw:Math.PI/2,pitch:0,fire:true}); sim.step(combat);
assert.equal(enemy.hp,initialHp,'off-axis shot misses without auto-aim');
for(let i=0;i<15;i++) sim.step(combat);
sim.operativeInput(combat,'gunner',{seq:2,forward:0,strafe:0,yaw:0,pitch:0,fire:true}); sim.step(combat);
assert.ok(enemy.hp < initialHp,'aimed ray damages real enemy');
const afterHit=enemy.hp, shots=cop.shots;
for(let i=0;i<4;i++) {sim.operativeInput(combat,'gunner',{seq:i+3,forward:0,strafe:0,yaw:0,pitch:0,fire:true});sim.step(combat);}
assert.equal(cop.shots,shots,'server weapon cooldown bounds flood firing');
assert.equal(enemy.hp,afterHit);
sim.operativeInput(combat,'gunner',{seq:29,forward:0,strafe:0,yaw:0,pitch:0,fire:false});
for(let i=0;i<15;i++) sim.step(combat);
combat.players[0].visible.delete(enemy.id);
sim.operativeInput(combat,'gunner',{seq:30,forward:0,strafe:0,yaw:0,pitch:0,fire:true});sim.step(combat);
assert.equal(enemy.hp,afterHit,'hidden target cannot be hit');
for(let i=0;i<15;i++) sim.step(combat);
combat.players[0].visible.add(enemy.id);
combat.flags[30*64+23] |= sim.SIGHT; combat.flags[29*64+23] |= sim.SIGHT; // the shooter stands on the row boundary and hip fire spreads
sim.operativeInput(combat,'gunner',{seq:31,forward:0,strafe:0,yaw:0,pitch:0,fire:true});sim.step(combat);
assert.equal(enemy.hp,afterHit,'wall blocks ray');
shooter.hp=0; sim.step(combat);
assert.equal(cop.unitId,0,'death clears controlled soldier');
assert.ok(cop.respawnAt > combat.tick,'respawn is delayed');
combat.players[0].mp=0; combat.players[0].away=true;
combat.tick=cop.respawnAt; sim.step(combat);
assert.equal(cop.unitId,0,'respawn cannot bypass manpower cost');
combat.players[0].mp=100; const mp=combat.players[0].mp; sim.step(combat);
assert.ok(cop.unitId && cop.unitId !== shooter.id,'respawn gets fresh live soldier');
assert.ok(combat.players[0].mp <= mp-10,'respawn spends reinforcement resource');
assert.equal(combat.units.get(cop.unitId).hp,20);
cop.online=false; const live=combat.units.get(cop.unitId), pos={x:live.x,z:live.z};
sim.operativeInput(combat,'gunner',{seq:100,forward:1,strafe:0,yaw:0,pitch:0});sim.step(combat);
assert.deepEqual({x:live.x,z:live.z},pos,'disconnected operative stays idle');
console.log('PASS aimed hit/miss, fog/wall protection, rate limits, death, paid delay and disconnect');
// Loadout and movement: jump, sprint, crouch, weapon swap, magazines, reload and grenades.
const kit = sim.createGame(map, ['commander','enemy'], true, [0,1]);
const kop = sim.joinOperative(kit, 'kit', 0), me = kit.units.get(kop.unitId);
for (const v of [...kit.units.values()]) if (v !== me) kit.units.delete(v.id);
Object.assign(me, { x: 64, z: 64 });
let kseq = 0;
const hold = (extra, ticks = 1) => { for (let i = 0; i < ticks; i++) { sim.operativeInput(kit, 'kit', { seq: kseq++, forward: 0, strafe: 0, yaw: 0, pitch: 0, jump: 0, reload: 0, nade: 0, ...extra }); sim.step(kit); } };
hold({}, 2);
hold({ jump: 1 });
assert.ok(me.jy > 0, 'a new jump count lifts the soldier');
hold({ jump: 1 }, 20);
assert.equal(me.jy, 0, 'gravity brings him back down');
hold({ jump: 1 }, 5);
assert.equal(me.jy, 0, 'a repeated count is not a second jump');
hold({ forward: 1 }, 12); const walk = me.moveSpeed;
hold({ forward: 1, sprint: true }, 12); const sprint = me.moveSpeed;
hold({ forward: 1, crouch: true }, 12); const crouch = me.moveSpeed;
assert.ok(Math.abs(walk - sim.OPERATIVE.walk) < 0.01 && Math.abs(sprint - sim.OPERATIVE.sprint) < 0.01 && Math.abs(crouch - sim.OPERATIVE.crouch) < 0.01, `walk ${walk}, sprint ${sprint}, crouch ${crouch}`);
assert.equal(me.crouch, true);
hold({}, 10);
assert.equal(me.moveSpeed, 0, 'he slows to a stop without keys');
hold({ weapon: 1 });
assert.equal(me.weapon, 1, 'weapon swap'); assert.ok(me.cooldown >= sim.OPERATIVE.swap - 0.06, 'a swap takes time');
hold({ weapon: 1, fire: true, pitch: 0.5 }, 80);
assert.equal(me.mags[1], 0, 'the SMG empties its magazine');
assert.equal(kop.shots, sim.OPERATIVE_WEAPONS[1].mag);
assert.ok(me.reloadT > 0, 'an empty magazine reloads on the trigger');
hold({ weapon: 1 }, Math.ceil(sim.OPERATIVE_WEAPONS[1].reload / sim.TICK) + 1);
assert.equal(me.mags[1], sim.OPERATIVE_WEAPONS[1].mag, 'reload refills');
hold({ weapon: 0, reload: 1 }, 2);
assert.equal(me.reloadT, 0, 'a full rifle does not reload');
const before = kit.nades.length;
hold({ weapon: 0, reload: 1, nade: 1 }, 3);
assert.equal(me.nades, sim.OPERATIVE.nades - 1, 'one press, one grenade');
assert.equal(kit.nades.length, before + 1);
hold({ weapon: 0, reload: 1, nade: 1 }, 60);
console.log('PASS jump, sprint, crouch, weapon swap, magazine, reload and grenade');
// Per-man hits: a squad in the open is its drawn men (shared/squad-men.js), not one wide body.
{
  const m = sim.createGame(map, ['commander','enemy'], true, [0,1]);
  const mop = sim.joinOperative(m, 'aimer', 0), gun = m.units.get(mop.unitId);
  const foe = [...m.units.values()].find(v => v.owner === 1 && v.type === 'rifle');
  for (const v of [...m.units.values()]) if (v !== foe && v !== gun) m.units.delete(v.id);
  Object.assign(gun, { x: 40, z: 60 }); Object.assign(foe, { x: 50, z: 60, rot: 0, auto: false, autoRetreat: false, holdFire: true, holdPos: true });
  let seq = 0;
  const shoot = (z) => { foe.z = z; foe.vx = foe.vz = 0; sim.operativeInput(m, 'aimer', { seq: seq++, forward: 0, strafe: 0, yaw: 0, pitch: 0, fire: true, ads: true, crouch: true }); sim.step(m); sim.operativeInput(m, 'aimer', { seq: seq++, forward: 0, strafe: 0, yaw: 0, pitch: 0, fire: false, ads: true, crouch: true }); for (let i = 0; i < 15; i++) sim.step(m); return m.shots.filter(s => s.f === gun.id).at(-1); };
  for (let i = 0; i < 5; i++) sim.step(m);
  const hp = foe.hp;
  // the end man of the block stands 1.69 m off the squad centre, outside the old 1.2 m body
  const edge = shoot(60 - 1.69);
  assert.ok(foe.hp < hp && edge.m >= 0, 'a shot at the end man of the rank hits him and names him');
  const left = foe.hp;
  assert.equal(shoot(60 - 2.3).hit, undefined, 'a shot past the last man misses');
  assert.equal(foe.hp, left);
  console.log('PASS per-man hits on drawn squad men');
}
// Leading a squad: F picks the nearest own squad, it follows, a commander order takes it back, and a new soldier
// comes out of it instead of the HQ.
{
  const m = sim.createGame(map, ['commander','enemy'], true, [0,1]);
  const lop = sim.joinOperative(m, 'lead', 0), me = m.units.get(lop.unitId);
  const mine = [...m.units.values()].find(v => v.owner === 0 && v.type === 'rifle' && !v.operative);
  for (const v of [...m.units.values()]) if (v !== mine && v !== me) m.units.delete(v.id);
  Object.assign(me, { x: 20, z: 30 }); Object.assign(mine, { x: 20, z: 34 });
  let seq = 0;
  const go = (extra, ticks = 1) => { for (let i = 0; i < ticks; i++) { sim.operativeInput(m, 'lead', { seq: seq++, forward: 0, strafe: 0, yaw: 0, pitch: 0, squad: 0, ...extra }); sim.step(m); } };
  go({}, 2); go({ squad: 1 }, 2);
  assert.equal(lop.squadId, mine.id, 'F picks the squad within 8 m');
  go({ squad: 1, forward: 1 }, 80);
  assert.ok(mine.x > 28, `the squad follows the operative (squad at ${mine.x.toFixed(1)}, operative at ${me.x.toFixed(1)})`);
  sim.command(m, 0, { t: 'move', orders: [[mine.id, 10, 10]] });
  go({ squad: 1 }, 1);
  assert.equal(lop.squadId, 0, 'a commander order takes the squad back');
  Object.assign(mine, { x: me.x, z: me.z + 3 }); go({ squad: 2 }, 2);
  assert.equal(lop.squadId, mine.id, 'F leads it again');
  me.hp = 0; sim.step(m);
  m.players[0].mp = 0; m.tick = lop.respawnAt;
  const men = mine.hp; sim.step(m);
  const next = m.units.get(lop.unitId);
  assert.ok(next && Math.hypot(next.x - mine.x, next.z - mine.z) < 0.5, 'the new soldier comes from the led squad, free of MP');
  assert.equal(mine.hp, men - sim.UNITS.rifle.hpPer, 'and the squad gives up one man for him');
  console.log('PASS leading a squad, commander takes it back, respawn from the squad');
}
