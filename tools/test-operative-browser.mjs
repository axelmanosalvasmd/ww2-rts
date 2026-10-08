// Real WebGL and commander/companion acceptance. Native relative mouse requires a display.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {MOVE,SIGHT,CELL,UNITS} from '../shared/sim.js';
import {updateGrid} from '../shared/grid.js';
import {command} from '../shared/sim.js';
import WebSocket from 'ws';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || '/tmp/ww2-fps-browser/node_modules/playwright/index.mjs');
assert.ok(process.env.DISPLAY,'Run under Xvfb or a real desktop, not headless: Chromium CDP does not supply native relative mouse motion');
Object.assign(process.env,{PORT:'0',HOST:'127.0.0.1',EDIT_PASSWORD:'test',PUBLIC_URL:'http://test'});
const srv=await import('../server.js');
if(!srv.server.listening)await new Promise(r=>srv.server.once('listening',r));
const base=`http://127.0.0.1:${srv.server.address().port}`;
const browser=await chromium.launch({headless:false,args:['--no-sandbox','--enable-unsafe-swiftshader']});
const errors=[];
async function page(){const c=await browser.newContext({viewport:{width:1280,height:800}});await c.addInitScript(()=>{const raf=window.requestAnimationFrame.bind(window);window.requestAnimationFrame=fn=>raf(()=>setTimeout(()=>fn(performance.now()),50));window.__operativeHistory=[];const WS=WebSocket;window.WebSocket=class extends WS{constructor(...args){super(...args);this.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.t==='s'&&m.operative)window.__operativeHistory.push(m.operative);});}};
  localStorage.setItem('ww2-controls-seen','1');localStorage.setItem('ww2-gfx','low');});const p=await c.newPage();p.on('pageerror',e=>errors.push(e.stack));return p;}
const native=(...args)=>execFileSync(process.env.XDOTOOL || 'xdotool',args);
async function aimAt(p,yaw,pitch=0){const a=await p.evaluate(()=>__game.fps.aim);const delta=Math.atan2(Math.sin(yaw-a.yaw),Math.cos(yaw-a.yaw));native('mousemove_relative','--',String(Math.round(delta/0.0025)),String(Math.round((a.pitch-pitch)/0.0025)));await p.waitForTimeout(250);}
const out='/home/axel/ww2-fps-mvp/evidence';await mkdir(out,{recursive:true});
try{
 const commander=await page();await commander.goto(base+'/play?name=Commander#browserfps');
 await commander.locator('#addAi').waitFor({state:'visible'});
 const enemySocket=new WebSocket(base.replace('http:','ws:')+'/ws?room=browserfps');
 await new Promise((resolve,reject)=>{enemySocket.once('open',resolve);enemySocket.once('error',reject);});
 const enemyLobby=new Promise(resolve=>enemySocket.on('message',raw=>{if(JSON.parse(raw).t==='lobby')resolve();}));
 enemySocket.send(JSON.stringify({t:'hello',token:'browser-enemy',name:'Enemy commander'}));await enemyLobby;
 const companion=await page();await companion.goto(base+'/play?role=operative&commander=0&name=Operative#browserfps');
 await companion.waitForFunction(()=>document.body.classList.contains('operative'));await commander.locator('#start').click();
 await companion.waitForFunction(()=>__game?.snapshot?.operative?.id>0);
 for(const p of [commander,companion])await p.evaluate(()=>{__game.renderer.setPixelRatio(0.5);__game.renderer.shadowMap.enabled=false;});
 const room=srv.rooms.get('browserfps'),g=room.game,op=[...g.operatives.values()][0],u=g.units.get(op.unitId);
 // Deterministic fixtures in a genuinely open part of the existing map. No client positions or damage are trusted.
 let field=null;
 for(let y=4;y<g.h-4&&!field;y++)for(let x=4;x<g.w-4&&!field;x++){
  const level=g.height?.[y*g.w+x]??0;let clear=true;
  for(let dz=-3;dz<=3;dz++)for(let dx=-3;dx<=3;dx++){const c=(y+dz)*g.w+x+dx;if((g.flags[c]&(MOVE|SIGHT))||(g.height?.[c]??0)!==level)clear=false;}
  if(clear)field={x:(x+0.5)*CELL,z:(y+0.5)*CELL};
 }
 assert.ok(field,'authored map has a flat, traversable combat fixture area');
 assert.ok(room.players[1].ws?.readyState===1,'enemy is a connected commander, not an absent disabled AI');
 for(const v of g.units.values())if(!v.operative)Object.assign(v,{holdFire:true,auto:false,autoRetreat:false,holdPos:true,path:[],targetId:0,attackId:0});
 Object.assign(u,field);updateGrid(g,u);
 await companion.waitForFunction(pos=>{const s=__game.snapshot,r=s.units.find(r=>r[0]===s.operative.id);return r&&Math.abs(r[3]-pos.x)<0.2&&Math.abs(r[4]-pos.z)<0.2;},field);
 await companion.evaluate(()=>document.title='FPS acceptance operative');await companion.bringToFront();
 let win;
 for(let attempt=0;attempt<30&&!win;attempt++){
  const wins=native('search','--name','.').toString().trim().split('\n');
  win=wins.find(w=>native('getwindowname',w).toString().includes('FPS acceptance operative'));
  if(!win)await companion.waitForTimeout(100);
 }
 assert.ok(win,'companion X11 window exists');native('windowraise',win);native('windowfocus',win);
 await companion.locator('#fpsCapture').click({timeout:30000});
 await companion.waitForFunction(()=>document.pointerLockElement===__game.renderer.domElement);await aimAt(companion,0);
 const start=await companion.evaluate(()=>{const s=__game.snapshot;return s.units.find(r=>r[0]===s.operative.id).slice(3,5);});
 await companion.keyboard.down('KeyW');
 try{await companion.waitForFunction(pos=>{const s=__game.snapshot,r=s.units.find(r=>r[0]===s.operative.id);return r&&Math.hypot(r[3]-pos[0],r[4]-pos[1])>0.5;},start,{timeout:5000});}
 finally{await companion.keyboard.up('KeyW');}
 const end=await companion.evaluate(()=>{const s=__game.snapshot;return s.units.find(r=>r[0]===s.operative.id).slice(3,5);});
 assert.ok(Math.hypot(end[0]-start[0],end[1]-start[1])>0.5,'trusted WASD moves the server-owned soldier');
 const yaw=await companion.evaluate(()=>__game.fps.aim.yaw);native('mousemove_relative','--','100','0');await companion.waitForFunction(y=>__game.fps.aim.yaw!==y,yaw,{timeout:5000});
 assert.notEqual(await companion.evaluate(()=>__game.fps.aim.yaw),yaw,'native relative mouse changes aim');await aimAt(companion,0);
 const enemy=[...g.units.values()].find(v=>v.owner===1&&v.type==='rifle');assert.ok(enemy);
 Object.assign(enemy,{x:u.x+4,z:u.z,hp:UNITS.rifle.models*UNITS.rifle.hpPer});updateGrid(g,enemy);
 await companion.waitForFunction(id=>__game.snapshot.units.some(r=>r[0]===id),enemy.id);
 const hp=enemy.hp;native('mousedown','1');await companion.waitForTimeout(1100);native('mouseup','1');
 await companion.waitForFunction(()=>__game.snapshot.operative.hits>0);
 assert.ok(enemy.hp<hp,'native aim/fire damages a real enemy from the same authoritative army simulation');
 assert.ok(await companion.evaluate(()=>__game.snapshot.operative.shots>0));
 assert.equal(await companion.evaluate(()=>getComputedStyle(document.querySelector('#hud')).display),'none');
 assert.equal(await companion.evaluate(()=>__game.units.get(__game.snapshot.operative.id).root.visible),false,'own model stays hidden across network snapshots');
 await companion.waitForFunction(()=>Math.abs(__game.camera.position.y-__game.hAt(__game.camera.position.x,__game.camera.position.z)-1.65)<0.05);
 await companion.screenshot({path:out+'/operative-live.png',timeout:30000});await commander.screenshot({path:out+'/commander-live.png',timeout:30000});
 console.log('PASS live WebGL, simultaneous commander/operative, normal pointer-lock click, native WASD and mouse aim/fire, real enemy damage, eye height and own-model/HUD hiding');
 const original=op.unitId;Object.assign(enemy,{holdFire:false,cooldown:0,supp:0,retreating:false,garrison:-1,enter:-1,reinf:0,build:0,entrench:null});
 assert.equal(g.players[1].away,false,'normal enemy orders retain the server presence guarantee');
 assert.equal(command(g,1,{t:'attack',ids:[enemy.id],target:u.id}),undefined);
 await companion.waitForFunction(()=>__operativeHistory.some(s=>s.id===0),{},{timeout:20000});
 await companion.keyboard.press('Escape');await companion.waitForFunction(()=>document.querySelector('#fpsStatus').textContent.includes('Respawn'));
 await companion.screenshot({path:out+'/operative-death.png',timeout:15000});
 await companion.waitForFunction(id=>__game.snapshot?.operative?.id>0&&__game.snapshot.operative.id!==id,original,{timeout:14000});
 await companion.screenshot({path:out+'/operative-respawn.png',timeout:15000});
 const respawned=op.unitId;await companion.reload();await companion.waitForFunction(()=>__game.snapshot?.operative?.id>0);
 assert.equal(await companion.evaluate(()=>__game.snapshot.operative.id),respawned,'refresh preserves the respawned soldier, not a free new life');
 assert.equal(room.operatives.length,1,'refresh reconnects the same companion identity');assert.equal(room.players.length,2,'companions do not occupy army seats');
 assert.deepEqual(errors,[],'no browser JavaScript errors');
 console.log('PASS enemy-caused death, paid respawn, refresh/reconnect. Screenshots: '+out);
}finally{
 await browser.close();clearInterval(srv.loop);for(const ws of srv.wss.clients)ws.terminate();srv.wss.close();await new Promise(r=>srv.server.close(r));for(const room of srv.rooms.values())for(const p of room.players)srv.clock.clearTimeout(p.cleanupTimer);
}
