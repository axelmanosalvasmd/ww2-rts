// Authoring checks verify persisted layers and the same support validation used when hosting.
import assert from 'node:assert/strict';
import { editableLayers, layerRows, savedLayers, paintLayer, moveLayerSelection, removeLayerSelection, pruneLayerStructures } from './client/layer-edit.js';
import { inferredSelectionStructure } from './client/structure-editor.js';
import { formatWorldAuthoringError } from './client/world-authoring-error.js';
import { migrateWorldMap, mapForClient, worldLayers } from './shared/world-layers.js';
import { validateMap, createGame, worldMaterial } from './shared/sim.js';
const blank=()=>({name:'Authoring fixture',w:24,h:24,rows:Array(24).fill('.'.repeat(24)),spawns:[{x:2,y:2},{x:21,y:21}],points:[{id:'point:0',x:12,y:12}],pointSequence:1});
const save=(map,layers)=>({...map,worldVersion:2,layers:savedLayers(layers),rows:layerRows(layers)});
{
 const legacy=blank(), rows=legacy.rows.map(row=>[...row]);rows[8][8]='N';rows[8][9]='R';rows[9][8]='=';legacy.rows=rows.map(row=>row.join(''));
 const migrated=migrateWorldMap(legacy);assert.equal(migrated.layers.ground[8][8],'.');assert.equal(migrated.layers.ground[8][9],'.');assert.equal(migrated.layers.ground[9][8],'W');assert.equal(migrated.layers.objects[9][8],'=');assert.deepEqual(legacy.rows,rows.map(row=>row.join('')),'migration does not mutate the source');
}
{
 const m=blank(),layers=editableLayers(m),cell=8*m.w+8;
 paintLayer(layers,8,8,'D',false,'concrete');paintLayer(layers,8,8,'N',false,'steel');
 let saved=save(m,layers);assert.equal(validateMap(saved),null);assert.equal(saved.rows[8][8],'N');assert.equal(saved.layers.ground[8][8],'D');assert.equal(saved.layers.groundMaterials[0].material,'concrete');assert.equal(saved.layers.mineMaterials[0].material,'steel');
 const roundTrip=editableLayers(JSON.parse(JSON.stringify(saved)));assert.equal(roundTrip.groundMaterials.get(cell),'concrete');assert.equal(roundTrip.mineMaterials.get(cell),'steel');
 const hidden=mapForClient(saved);assert.equal(hidden.rows[8][8],'D');assert.equal(hidden.layers.mineMaterials.length,0);assert.equal(hidden.layers.groundMaterials[0].material,'concrete');
 paintLayer(layers,8,8,'.',true);saved=save(m,layers);assert.equal(saved.rows[8][8],'D');assert.equal(layers.groundMaterials.get(cell),'concrete');assert(!layers.mineMaterials.has(cell));
 paintLayer(layers,8,8,'N');const derived=worldLayers(save(m,layers));assert.equal(derived.materials.get(cell),'concrete','mine material leaves the physical ground material unchanged');assert.equal(derived.baseMaterials.get(cell),'concrete');
 paintLayer(layers,8,8,'H');const covered=worldLayers(save(m,layers));assert(!covered.materials.has(cell),'ground material does not become the covering object material');
 const g=createGame(save(m,layers),['A','B'],false,[0,1],[0,1],{weather:false});assert.equal(worldMaterial(g,cell).name,'wood');assert.equal(worldMaterial(g,cell,true).name,'concrete');
}
{
 const m=blank(),layers=editableLayers(m);paintLayer(layers,8,8,'D',false,'concrete');paintLayer(layers,9,8,'M',false,'soil');paintLayer(layers,8,8,'B',false,'wood');paintLayer(layers,9,8,'B',false,'stone');
 const selection={ch:'B',cells:[[8,8],[9,8]]}, authored=save(m,layers),structure=inferredSelectionStructure(authored,selection);assert.equal(structure.sections.length,2);structure.sections[0].hp=321;structure.sections[0].material='steel';structure.sections[1].anchor=false;structure.sections[1].supports=[structure.sections[0].id];m.structures=[structure];
 assert.equal(validateMap(save(m,layers)),null);
 assert(moveLayerSelection(layers,selection,2,0,m));assert.equal(layers.ground[8][8],'D');assert.equal(layers.ground[8][9],'M');assert.equal(layers.objects[8][10],'B');assert.equal(layers.objectMaterials.get(8*m.w+10),'wood');assert.equal(m.structures[0].sections[0].c,8*m.w+10);assert.equal(m.structures[0].sections[0].hp,321);assert.deepEqual(m.structures[0].sections[1].supports,[structure.sections[0].id]);
 const saved=JSON.parse(JSON.stringify(save(m,layers)));assert.equal(validateMap(saved),null);assert.deepEqual(saved.structures,m.structures);assert.deepEqual(saved.layers,savedLayers(layers));
 const before=JSON.stringify(savedLayers(layers));assert.equal(moveLayerSelection(layers,selection,30,0,m),false);assert.equal(JSON.stringify(savedLayers(layers)),before,'an invalid move changes neither layer');
 removeLayerSelection(layers,{ch:'B',cells:[[10,8]]});pruneLayerStructures(m,layers);assert.equal(m.structures[0].sections.length,1);assert.deepEqual(m.structures[0].sections[0].supports,[]);assert.match(validateMap(save(m,layers)),/anchor/,'removing support cannot silently leave a valid unsupported structure');
}
{
 const m=blank(),layers=editableLayers(m);paintLayer(layers,8,8,'B');paintLayer(layers,9,8,'B');m.structures=[inferredSelectionStructure(save(m,layers),{ch:'B',cells:[[8,8],[9,8]]})];m.structures[0].sections.forEach(section=>section.anchor=false);
 const error=validateMap(save(m,layers));assert.match(error,/anchor/);assert.match(formatWorldAuthoringError(error,'es'),/anclaje/);assert.match(formatWorldAuthoringError('supports must reference neighboring sections in the same structure','es'),/vecinas/);
 paintLayer(layers,8,8,'W');assert.match(validateMap(save(m,layers)),/dry ground/);assert.match(formatWorldAuthoringError('land objects need dry ground','es'),/terreno seco/);
}
{
 const m=blank(),layers=editableLayers(m),c=8*m.w+8;
 paintLayer(layers,8,8,'D',false,'concrete');paintLayer(layers,8,8,'R',false,'stone');paintLayer(layers,8,8,'N',false,'steel');
 let saved=save(m,layers);assert.equal(validateMap(saved),null);assert.equal(saved.layers.objects[8][8],'R');assert.equal(saved.layers.mines[8][8],'N');assert.equal(saved.layers.objectMaterials[0].material,'stone');assert.equal(saved.layers.mineMaterials[0].material,'steel');
 const publicMap=mapForClient(saved);assert.equal(publicMap.rows[8][8],'R');assert.equal(publicMap.layers.objects[8][8],'R');assert.equal(publicMap.layers.objectMaterials[0].material,'stone');assert.equal(publicMap.layers.mineMaterials.length,0);
 paintLayer(layers,8,8,'.',true);assert.equal(layerRows(layers)[8][8],'R');assert.equal(layers.objectMaterials.get(c),'stone');assert.equal(layers.groundMaterials.get(c),'concrete');assert(!layers.mineMaterials.has(c));
 const old=migrateWorldMap(m);const rows=old.layers.objects.map(row=>[...row]);rows[8][8]='N';old.layers.objects=rows.map(row=>row.join(''));old.rows=old.rows.map((row,y)=>y===8?row.slice(0,8)+'N'+row.slice(9):row);
 delete old.layers.mines;const migrated=editableLayers(old);assert.equal(migrated.objects[8][8],'.');assert.equal(migrated.mines[8][8],'N');paintLayer(migrated,8,8,'.',true);assert.equal(layerRows(migrated)[8][8],'.','legacy version 2 mine migrates before erase');
}
{
 const m=blank(),layers=editableLayers(m);paintLayer(layers,8,8,'B',false,'concrete');const saved=save(m,layers),cell=8*m.w+8;
 const inferred=inferredSelectionStructure(saved,{ch:'B',cells:[[8,8]]});assert.equal(inferred.sections[0].material,'concrete','section editing starts from the authored object material');
 const g=createGame(saved,['A','B'],false,[0,1],[0,1],{weather:false});assert.equal(worldMaterial(g,cell).name,'concrete','authored object material controls inferred section behavior');
}
console.log('World authoring checks passed');
