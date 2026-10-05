// Reproducible final-raster stress gate, not an isolated performance benchmark.
// Usage: node tools/test-world-waterway-seeds.mjs [map-count]
import assert from 'node:assert/strict';
import { generateWorldMap } from '../shared/world-conquest.js';
import { assertWorldReachable } from '../test-world-connectivity-helper.js';
const count=Number(process.argv[2]??80), layouts={};
assert.ok(Number.isInteger(count)&&count>0);
for(let i=0;i<count;i++) {
  const size=i%2?'huge':'massive', seed=Math.imul(i+1,2654435761)>>>0, players=1+i%6;
  const options={size,seed,players,teams:Array.from({length:players},(_,j)=>i%3?j:j%2)};
  const map=generateWorldMap(options);
  assertWorldReachable(map);
  assert.deepEqual(map,generateWorldMap(options),'identical seeds and settings reproduce exactly');
  assert.equal(map.world.total,size==='huge'?64:128);
  assert.equal(map.spawns.length,players);
  for(const r of map.world.regions) assert.equal(map.world.regionMap[r.y*map.w+r.x],r.id,'objectives keep their own territory');
  for(const river of map.world.waterways.rivers) for(const p of river.path) {
    assert.ok('WF='.includes(map.rows[p.y][p.x]),`seed ${seed}, channel ${river.id}: broken centerline`);
    assert.equal(map.heights[p.y][p.x],'0');
  }
  const mains=map.world.waterways.rivers.filter(r=>r.kind==='main').length;
  const tributaries=map.world.waterways.rivers.length-mains;
  const key=`${mains} main / ${tributaries} tributaries`;
  layouts[key]=(layouts[key]??0)+1;
  if((i+1)%20===0) console.log(`PASS ${i+1}/${count} worlds`);
}
console.log(JSON.stringify({maps:count,layouts,checks:['determinism','objective membership','channel continuity','bridge-destroyed tank-clearance connectivity']},null,2));
