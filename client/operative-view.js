import * as THREE from 'three';
import { inputFor, lookDelta, cameraYaw } from './operative-controls.js';

export function createOperativeView({ camera, scene, renderer, units, ground, send, playing, paused }) {
  const aim = { yaw: 0, pitch: 0 }, keys = new Set();
  let enabled = false, status = null, seq = 0, fire = false, flashUntil = 0, hitUntil = 0, hurtUntil = 0;
  const hud = document.createElement('div'); hud.id = 'fpsHud'; hud.className = 'hidden';
  hud.innerHTML = '<div id="fpsCrosshair">+</div><div id="fpsHit">×</div><div id="fpsDamage"></div><div id="fpsPanel" class="panel"><b>INFANTRY OPERATIVE</b><div id="fpsHealth"></div><div id="fpsStatus"></div><div class="muted">WASD move · Mouse aim · Hold left click to fire · Esc release mouse<br>Desktop keyboard and mouse required. No jump or sprint.</div><button id="fpsCapture">Click to enter first person</button><a href="/">Leave battlefield</a></div>';
  document.body.append(hud);
  const $ = id => document.getElementById(id);
  const text = (id, value) => { if ($(id).textContent !== value) $(id).textContent = value; };
  const locked = () => document.pointerLockElement === renderer.domElement;
  const active = () => enabled && playing();
  const transmit = () => {
    if (active()) send(inputFor(keys, aim.yaw, aim.pitch, fire && locked() && !paused(), seq++));
  };
  // Input is independent of rendering. A slow GPU must not swallow a short key press.
  setInterval(transmit, 50);
  const release = () => { keys.clear(); fire = false; transmit(); };
  async function capture() {
    if (!active() || !status?.id) return;
    try { await renderer.domElement.requestPointerLock(); }
    catch { $('fpsStatus').textContent = 'Mouse capture refused. Click the battlefield again. HTTPS and a desktop browser are required.'; }
  }
  $('fpsCapture').onclick = capture;
  document.addEventListener('pointerlockchange', () => { if (!locked()) release(); });
  addEventListener('blur', release);
  // Installed before the RTS handlers. Prevent every army shortcut and selection gesture in this role.
  for (const type of ['keydown','keyup','mousedown','mouseup','mousemove','wheel','contextmenu','pointerdown','pointerup','click']) {
    addEventListener(type, e => {
      if (!active() || (!locked() && e.target?.closest?.('#fpsPanel'))) return;
      if (type === 'keydown' && e.code === 'Escape') { release(); document.exitPointerLock(); }
      if (locked() && !paused() && status?.id) {
        if (type === 'keydown') keys.add(e.code);
        if (type === 'keyup') keys.delete(e.code);
        if (type === 'mousemove') Object.assign(aim, lookDelta(aim.yaw, aim.pitch, e.movementX, e.movementY));
        if (type === 'mousedown' && e.button === 0) fire = true;
        if (type === 'mouseup' && e.button === 0) fire = false;
        if (['keydown','keyup','mousedown','mouseup'].includes(type)) transmit();
      } else if (type === 'click' && e.target === renderer.domElement) capture();
      if (!(type === 'keydown' && e.code === 'Escape')) e.preventDefault();
      e.stopImmediatePropagation();
    }, { capture: true, passive: false });
  }
  const weapon = new THREE.Group(); weapon.name = 'operative-rifle'; camera.add(weapon); scene.add(camera);
  const wood = new THREE.MeshStandardMaterial({color:0x5a3522,roughness:0.85});
  const steel = new THREE.MeshStandardMaterial({color:0x34383a,metalness:0.65,roughness:0.45});
  const part = (w,h,d,x,y,z,mat) => {const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.position.set(x,y,z);weapon.add(m);return m;};
  part(0.07,0.09,0.42,0.19,-0.19,-0.4,wood); part(0.045,0.045,0.52,0.19,-0.15,-0.64,steel);
  part(0.08,0.17,0.18,0.19,-0.23,-0.2,wood); part(0.016,0.04,0.015,0.19,-0.11,-0.89,steel);
  const muzzle=part(0.065,0.065,0.065,0.19,-0.15,-0.92,new THREE.MeshBasicMaterial({color:0xffd07c}));
  weapon.visible=false; muzzle.visible=false;
  function setRole(on) {
    enabled = !!on; document.body.classList.toggle('operative', enabled);
    if (!enabled) { release(); if (locked()) document.exitPointerLock(); }
    camera.near = enabled ? 0.08 : 1; camera.fov = enabled ? 80 : 42; camera.updateProjectionMatrix();
  }
  function start(m) {
    setRole(m.role === 'operative'); release(); status=m.operative??null; seq=(status?.seq??-1)+1;
    aim.yaw=0;aim.pitch=0;
    if (enabled && m.spawn) aim.yaw=Math.atan2(m.map.h-m.spawn.z,m.map.w-m.spawn.x);
  }
  function snapshot(s) {
    if (!enabled) return;
    const next=s.operative;
    if (next) {
      if (next.shots > (status?.shots??0)) flashUntil=performance.now()+90;
      if (next.hits > (status?.hits??0)) hitUntil=performance.now()+180;
      if (status?.id && next.hp < status.hp) hurtUntil=performance.now()+300;
      if (!next.id || paused()) release();
      status=next;
    }
  }
  function frame(now, cam) {
    const on=active(); hud.classList.toggle('hidden',!on); weapon.visible=on&&!!status?.id;
    if (!on) return;
    text('fpsHealth', `HP ${status?.hp??0} / ${status?.maxHp??20}`);
    text('fpsStatus', paused() ? 'Battle paused by commander' : !status?.id ? `Killed. Respawn in ${status?.respawn??0}s. ${status?.waiting ? 'Waiting for' : 'Costs'} ${status?.cost??10} commander manpower.` : locked() ? 'Attached to your commander. Fight alongside the army.' : 'Mouse released. Click to resume aim and movement.');
    $('fpsCapture').classList.toggle('hidden',locked()||!status?.id);
    $('fpsCrosshair').style.opacity=status?.id?'1':'0'; $('fpsHit').style.opacity=now<hitUntil?'1':'0'; $('fpsDamage').style.opacity=now<hurtUntil?'1':'0';
    muzzle.visible=now<flashUntil; weapon.position.z=now<flashUntil?0.04:0;
    
    for(const v of units.values()) {
      v.bars.visible=false;v.base.visible=false;v.sel.visible=false;if(v.range)v.range.visible=false;
      if(v.id===status?.id) v.root.visible=false;
    }
    const unit=status?.id && units.get(status.id);
    if (unit) { camera.position.set(unit.x,ground(unit.x,unit.z)+1.65,unit.z);cam.x=unit.x;cam.z=unit.z;cam.y=ground(unit.x,unit.z); }
    camera.rotation.order='YXZ';camera.rotation.set(aim.pitch,cameraYaw(aim.yaw),0,'YXZ'); camera.updateMatrixWorld();
    // Use existing terrain, soldiers, weather and battle effects, with a near-ground camera and readable haze.
    cam.dist=42;cam.yaw=aim.yaw;
  }
  return { start, snapshot, frame, setRole, get active(){return active();}, get aim(){return {...aim};}, get status(){return status;} };
}
