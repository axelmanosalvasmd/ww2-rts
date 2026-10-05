// Native decision-only matches retain the original staggered cadence and three-minute deadline.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createGame, command, step } from './shared/sim.js';
import { think } from './shared/ai.js';

const seeds = Array.from({ length: 40 }, (_, i) => i + 1);
const rawMap = readFileSync(new URL('./maps/default.json', import.meta.url), 'utf8');
const reports = [];
const failures = [];
for (const seed of seeds) {
  let randomState = seed;
  const random = () => { randomState = Math.imul(randomState, 1664525) + 1013904223 | 0; return (randomState >>> 0) / 4294967296; };
  const originalRandom = Math.random;
  let game;
  Math.random = random;
  try { game = createGame(JSON.parse(rawMap), ['a', 'b', 'c']); } finally { Math.random = originalRandom; }
  // Physical launch dispersion also draws random values. Scope those draws to this fixture for replay.
  Math.random = random;
  try {
    let capturedAt = 0, ownership = game.points.map(point => point.owner).join(','), ownershipChanges = 0;
    let accepted = 0, attempted = 0, paidPurchases = 0, acceptedMoves = 0, movingTicks = 0;
    const commandHash = createHash('sha256');
    for (let i = 0; i < 20 * 180 && !capturedAt && game.winner === null; i++) {
      for (let slot = 0; slot < 3; slot++) if ((game.tick + slot * 13) % 40 === 0) {
        think(game, slot, { decisionOnly: true, submit: cmd => {
          const beforeMP = game.players[slot].mp;
          const result = command(game, slot, cmd);
          attempted++;
          if (result === undefined) {
            accepted++;
            if (cmd.t === 'buy' && game.players[slot].mp < beforeMP) paidPurchases++;
            if ((cmd.t === 'move' || cmd.t === 'amove') && cmd.orders.some(row => game.units.get(row[0])?.path.length)) acceptedMoves++;
          }
          commandHash.update(JSON.stringify({ tick: game.tick, slot, cmd, result: result ?? null, mpBefore: beforeMP, mpAfter: game.players[slot].mp }));
          return result;
        } });
      }
      const previous = new Map([...game.units.values()].map(unit => [unit.id, [unit.x, unit.z]]));
      step(game);
      for (const unit of game.units.values()) {
        const from = previous.get(unit.id);
        if (from && Math.hypot(unit.x - from[0], unit.z - from[1]) > 0.001) movingTicks++;
      }
      const nextOwnership = game.points.map(point => point.owner).join(',');
      if (nextOwnership !== ownership) { ownershipChanges++; ownership = nextOwnership; }
      if (game.points.every(point => point.owner >= 0)) capturedAt = game.tick / 20;
    }
    assert.ok(attempted > 0 && accepted > 0 && acceptedMoves > 0 && paidPurchases > 0 && movingTicks > 0 && ownershipChanges > 0,
      `${seed}: ordinary commands pay for units, produce real movement, and change native point ownership`);
    const report = { seed, matchSeed: game.matchSeed, capturedAt, endTick: game.tick, winner: game.winner,
      owners: game.points.map(point => point.owner), attempted, accepted, acceptedMoves, paidPurchases, movingTicks,
      commandHash: commandHash.digest('hex'),
      stateHash: createHash('sha256').update(JSON.stringify({ seed: game.seed, players: game.players, points: game.points, units: [...game.units.values()] })).digest('hex') };
    reports.push(report);
    console.log(JSON.stringify(report));
    try {
      assert.ok(capturedAt > 0 && capturedAt < 180, 'AI decision layer takes every point within 3 minutes');
    } catch (error) { failures.push({ seed, message: error.message }); }
  } finally { Math.random = originalRandom; }
}
console.log(JSON.stringify({ seeds, passing: reports.length - failures.length, failures }));
assert.deepEqual(failures, [], 'every predeclared native capture fixture meets the original strict deadline');

let randomState=123;const originalRandom=Math.random;Math.random=()=>{randomState=Math.imul(randomState,1664525)+1013904223|0;return(randomState>>>0)/4294967296};
function fresh(locked=false){const game=createGame({w:50,h:30,rows:Array(30).fill('.'.repeat(50)),spawns:[{x:2,y:2},{x:47,y:27}],points:[{x:7,y:10,vp:2,mp:1.5},{x:20,y:10,vp:0,mp:1,...(locked?{needs:0}:{})}]},['a','b'],false);game.units.clear();game.players.forEach(p=>{p.spawn={x:-1000,z:-1000};p.mp=5000;p.mun=0});return game}
function put(game,slot,type,x,z){assert.equal(command(game,slot,{t:'buy',unit:type}),undefined);const unit=[...game.units.values()].at(-1);Object.assign(unit,{x,z,autoRetreat:false});return unit}
function fixture({held=false,vehicleOnly=false,moving=false,threat=false,locked=false,incoming=false}={}){
 const game=fresh(locked),foe=put(game,held?0:1,'rifle',15,21);for(let i=0;i<200;i++)step(game);assert.equal(game.points[0].owner,held?0:1);
 Object.assign(foe,{x:95,z:55});
 const foot=vehicleOnly?null:put(game,0,'rifle',held?15:5,21);
 const tank=put(game,0,'tank',41,21);game.players.forEach(p=>p.mp=0);
 if(held)game.units.delete(foe.id);
 if(moving)assert.equal(command(game,0,{t:'move',orders:[[foot.id,5,45]]}),undefined);
 if(incoming){game.players[0].mp=5000;const other=put(game,0,'rifle',21,21);game.players[0].mp=0;assert.equal(command(game,0,{t:'move',orders:[[other.id,41,21]]}),undefined);}
 if(threat){game.players[1].mp=5000;const enemy=put(game,1,'rifle',41,21);game.players[1].mp=0;step(game);assert.ok(game.players[0].visible.has(enemy.id),'the native observer really sees the hostile near the neutral point');}
 const memory={},commands=[];think(game,0,{decisionOnly:true,memory,submit:cmd=>{const result=command(game,0,cmd);commands.push({cmd:structuredClone(cmd),result});return result}});
 const sent=commands.filter(c=>(c.cmd.t==='move'||c.cmd.t==='amove')&&c.result===undefined).flatMap(c=>c.cmd.orders);
 const initialNeutralOrders=sent.filter(r=>Math.hypot(r[1]-41,r[2]-21)<=8);
 const before=foot&&{x:foot.x,z:foot.z};
 for(let tick=0;tick<20*40;tick++)step(game);
 return {neutralOwner:game.points[1].owner,initialNeutralOrders,footId:foot?.id,footMoved:!!foot&&Math.hypot(foot.x-before.x,foot.z-before.z)>1,commands};
}
try{
 const positive=fixture();assert.ok(positive.initialNeutralOrders.some(row=>row[0]===positive.footId),'idle infantry receives an actual native order to the neutral point despite a parked vehicle');assert.equal(positive.neutralOwner,0,'real infantry movement and native capture secure the neutral point');assert.ok(positive.footMoved);
 const vehicle=fixture({vehicleOnly:true});assert.equal(vehicle.neutralOwner,-1,'vehicles alone cannot capture neutral ground');
 const moving=fixture({moving:true});assert.ok(!moving.initialNeutralOrders.some(row=>row[0]===moving.footId),'a moving infantry squad keeps its current path');
 const held=fixture({held:true});assert.ok(!held.initialNeutralOrders.some(row=>row[0]===held.footId),'the actual point holder stays to protect owned ground');
 const threatened=fixture({threat:true});assert.ok(!threatened.initialNeutralOrders.some(row=>row[0]===threatened.footId),'an observed hostile blocks neutral coverage priority');
 const locked=fixture({locked:true});assert.ok(!locked.initialNeutralOrders.some(row=>row[0]===locked.footId),'an unmet native prerequisite blocks neutral coverage priority');
 const incoming=fixture({incoming:true});assert.ok(!incoming.initialNeutralOrders.some(row=>row[0]===incoming.footId),'real infantry already heading there reserves the neutral point');assert.equal(incoming.neutralOwner,0);
 console.log(JSON.stringify({positive,vehicle,moving,held,threatened,locked,incoming}));
}finally{Math.random=originalRandom}
