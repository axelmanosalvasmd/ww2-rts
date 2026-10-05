import assert from 'node:assert/strict';
const source=process.env.SRC;
const {createGame,command,step,los,UNITS}=await import(source+'/shared/sim.js');
const {viewFor}=await import(source+'/shared/ai-view.js');
const {perceive,onScreen}=await import(source+'/shared/ai-perception.js');
const {plan}=await import(source+'/shared/ai.js');
function fixture(variant='attended'){
 const rows=Array(80).fill('.'.repeat(80));if(variant==='trench')rows[40]='.'.repeat(25)+'T'+'.'.repeat(54);if(variant==='blockedLOS')rows[41]='.'.repeat(27)+'B'+'.'.repeat(52);
 const prior=Math.random;Math.random=()=>.5;let game;try{game=createGame({w:80,h:80,rows,spawns:[{x:5,y:5},{x:75,y:75}],points:[{x:25,y:40}]},['AI','enemy'],false,[0,1],[0,1],{weather:false});}finally{Math.random=prior;}
 game.units.clear();game.players.forEach(p=>Object.assign(p,{mp:5000,fuel:5000}));assert.equal(command(game,0,{t:'buy',unit:'mg'}),undefined);assert.equal(command(game,1,{t:'buy',unit:'rifle'}),undefined);
 const own=[...game.units.values()].find(u=>u.owner===0),enemy=[...game.units.values()].find(u=>u.owner===1);Object.assign(own,{x:51,z:81,auto:false,holdFire:true});Object.assign(enemy,{x:60,z:84,auto:false,holdFire:true});if(variant==='blockedLOS'){assert.equal(command(game,0,{t:'buy',unit:'rifle'}),undefined);const friend=[...game.units.values()].find(u=>u.owner===0&&u.id!==own.id);Object.assign(friend,{x:58,z:88,holdFire:true,auto:false});assert.equal(los(game,own,enemy),false,'the guard genuinely lacks direct LOS through the delivered house');}game.points[0].owner=0;game.tick=100;game.players.forEach(p=>Object.assign(p,{mp:0,fuel:0,mun:0}));step(game);assert.equal(command(game,0,{t:'stance',ids:[own.id],key:'holdFire',on:false}),undefined);
 if(variant==='engaged')own.targetId=enemy.id;
 if(variant==='hurt')own.hp=20;
 if(variant==='fortified')Object.assign(own,{garrison:40*80+25,cover:3});
 if(variant==='held')assert.equal(command(game,0,{t:'stance',ids:[own.id],key:'holdPos',on:true}),undefined);
 if(variant==='amove')assert.equal(command(game,0,{t:'amove',orders:[[own.id,55,81]]}),undefined);
 if(variant==='walking')assert.equal(command(game,0,{t:'move',orders:[[own.id,55,81]]}),undefined);
 const memory={human:{camera:{x:55,z:75,yaw:0,distance:60},persona:{pressure:1,opening:[]}}};if(variant==='offcamera'){const camera=[85,90,95].map(x=>({...memory.human.camera,x})).find(camera=>!onScreen(own,camera)&&onScreen(enemy,camera));assert.ok(camera);memory.human.camera=camera;}const view=perceive(viewFor(game,0,{}),0,memory.human,game.tick);if(variant==='offcamera')assert.ok(!view.screenIds.has(own.id));if(variant==='trench')assert.equal(view.units.get(own.id).cover,2,'the stationary guard actually occupies delivered trench terrain');const event=view.events.find(e=>e.kind==='screen-contact'&&e.targetId===enemy.id);assert.ok(event,variant);if(variant==='missingActor')event.observedDanger.idleOwnUnits=[];
 if(variant==='private-fields')Object.assign(event,{responseRequired:false,responseUnits:[999],responseReason:'counterfactual',responsePolicy:'bogus',counterfactualPopulation:999});let concern={kind:'combat',x:event.x,z:event.z};if(variant!=='unattended')Object.assign(concern,{event:'screen-contact',eventId:event.id,targetId:enemy.id,observedDanger:event.observedDanger});
 const decisions=[];plan(view,0,{human:true,level:'easy',concern},memory,cmd=>{decisions.push(structuredClone(cmd));return undefined;});return{decisions,own,enemy,game,event};
}
const positive=fixture();const movement=positive.decisions.find(cmd=>cmd.t==='amove'&&cmd.orders.some(row=>row[0]===positive.own.id));assert.ok(movement,'an actually idle on-point guard responds to its attended local enemy');assert.equal(command(positive.game,0,movement),undefined,'the default planner order is accepted by the real command gate');
for(const negative of ['unattended','engaged','hurt','walking','fortified','trench','held','amove','missingActor','offcamera']){const f=fixture(negative);assert.ok(!f.decisions.some(cmd=>cmd.t==='amove'&&cmd.orders.some(row=>row[0]===f.own.id)),negative+' preserves its guarded or busy movement state');}
const blocked=fixture('blockedLOS');assert.ok(blocked.decisions.some(cmd=>cmd.t==='amove'&&cmd.orders.some(row=>row[0]===blocked.own.id)),'blocked LOS produces a real local repositioning intention');assert.ok(!blocked.decisions.some(cmd=>cmd.t==='attack'&&cmd.ids.includes(blocked.own.id)),'blocked LOS does not create a targeted attack through the obstruction');
assert.deepEqual(fixture('private-fields').decisions,positive.decisions,'private grading metadata cannot change the actual default-planner decision');console.log('Actual local guard positive and unattended/engaged/hurt/walking/fortified/held/amove/missing-actor/offcamera/private-field controls pass.');
