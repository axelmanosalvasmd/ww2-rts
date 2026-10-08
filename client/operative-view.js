import * as THREE from 'three';
import { inputFor, lookDelta, cameraYaw, predictStep } from './operative-controls.js';
import { OPERATIVE, OPERATIVE_WEAPONS as WEAPONS, TICK } from '../shared/sim.js';
import { audio } from './audio.js';

// First person for the infantry operative: input, movement prediction, the weapon in hand and its feedback.
// The server decides positions, hits and ammunition; everything drawn here is the client's best guess of it.
const HELP = 'WASD move · Shift sprint · Space jump · C crouch · Mouse aim · Left click fire · Right click aim down sights · R reload · G grenade · F lead the nearest squad · 1/2 or wheel switch weapon · Esc release mouse';
const FOV = { base: 75, sprint: 82, ads: [50, 62] };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

export function createOperativeView({ camera, scene, renderer, units, ground, send, playing, paused, effects = () => null, rtt = () => null }) {
  const aim = { yaw: 0, pitch: 0 }, keys = new Set(), counts = { jump: 0, reload: 0, nade: 0, squad: 0 };
  let enabled = false, status = null, seq = 0, fire = false, ads = false, crouch = false, weapon = 0, lastWeapon = 1;
  let jumpQueued = false, localShots = 0, lastLocalShot = 0, cooldownUntil = 0, reloadUntil = 0, swapUntil = 0, throwUntil = 0;
  let hitUntil = 0, killUntil = 0, hurtUntil = 0, hurtAngle = 0, deadAt = 0, lastFrame = performance.now();
  const pred = { x: 0, z: 0, vx: 0, vz: 0, jy: 0, vy: 0, crouch: false, sprint: false }, hist = [];
  let predId = 0, eye = OPERATIVE.eye, bobPhase = 0, landDip = 0, recoilPitch = 0, recoilYaw = 0, fov = FOV.base;
  const sway = { x: 0, y: 0 }, kick = { z: 0, rot: 0 };

  // ---------- HUD ----------
  const hud = document.createElement('div'); hud.id = 'fpsHud'; hud.className = 'hidden';
  hud.innerHTML = `<div id="fpsVignette"></div><div id="fpsDamage"></div><div id="fpsDir"><i></i></div>
    <div id="fpsCross"><i class="t"></i><i class="b"></i><i class="l"></i><i class="r"></i><b></b></div>
    <div id="fpsHit"><i></i><i></i><i></i><i></i></div><div id="fpsKill"></div>
    <div id="fpsVitals"><div id="fpsHpBar"><i></i></div><span id="fpsHealth"></span><span id="fpsSquad"></span></div>
    <div id="fpsLoadout"><div id="fpsWeapons"></div><div id="fpsAmmo"><b></b><span></span></div><div id="fpsReload"><i></i></div><div id="fpsNades"></div></div>
    <div id="fpsDead" class="hidden"><h2>Killed in action</h2><p id="fpsRespawn"></p></div>
    <div id="fpsPanel" class="panel"><b>INFANTRY OPERATIVE</b><div id="fpsStatus"></div><div class="muted">${HELP}<br>Desktop keyboard and mouse required.</div><button id="fpsCapture">Click to enter first person</button><a href="/">Leave battlefield</a></div>`;
  document.body.append(hud);
  const $ = id => document.getElementById(id);
  const text = (id, value) => { const el = $(id); if (el.textContent !== value) el.textContent = value; };
  const locked = () => document.pointerLockElement === renderer.domElement;
  const active = () => enabled && playing();
  const alive = () => !!status?.id;

  // ---------- small synthesized sounds: clicks, footsteps, hit ticks. The recorded gunfire comes from client/audio.js
  let actx = null, noise = null;
  function tone({ f = 800, f2 = f, dur = 0.05, gain = 0.2, type = 'square', at = 0, noisy = false, cut = 3000 }) {
    if (!audio.volume) return;
    try { actx ??= new AudioContext(); } catch { return; }
    if (actx.state !== 'running') { actx.resume?.(); if (actx.state !== 'running') return; }
    const t = actx.currentTime + at, g = actx.createGain(), lp = actx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = cut;
    g.gain.setValueAtTime(gain * audio.volume, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let src;
    if (noisy) {
      if (!noise) { noise = actx.createBuffer(1, actx.sampleRate * 0.5, actx.sampleRate); const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
      src = actx.createBufferSource(); src.buffer = noise;
    } else { src = actx.createOscillator(); src.type = type; src.frequency.setValueAtTime(f, t); src.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur); }
    src.connect(lp).connect(g).connect(actx.destination); src.start(t); src.stop(t + dur + 0.02);
  }
  const sfx = {
    step: (k) => tone({ noisy: true, dur: 0.07, gain: 0.05 * k, cut: 420 }),
    land: () => { tone({ noisy: true, dur: 0.12, gain: 0.12, cut: 300 }); tone({ f: 90, f2: 45, dur: 0.12, gain: 0.12, type: 'sine' }); },
    jump: () => tone({ noisy: true, dur: 0.06, gain: 0.05, cut: 700 }),
    dry: () => tone({ f: 2400, f2: 1800, dur: 0.03, gain: 0.08 }),
    hit: () => tone({ f: 1900, f2: 1500, dur: 0.06, gain: 0.07, type: 'triangle' }),
    kill: () => { tone({ f: 1500, dur: 0.07, gain: 0.08, type: 'triangle' }); tone({ f: 2200, dur: 0.09, gain: 0.07, type: 'triangle', at: 0.07 }); },
    mag: (at) => { tone({ f: 900, f2: 500, dur: 0.05, gain: 0.08, at }); tone({ noisy: true, dur: 0.05, gain: 0.06, cut: 2500, at }); },
    bolt: (at) => { tone({ f: 1300, f2: 700, dur: 0.06, gain: 0.08, at }); tone({ f: 600, f2: 900, dur: 0.06, gain: 0.07, at: at + 0.12 }); },
    swap: () => tone({ noisy: true, dur: 0.08, gain: 0.05, cut: 1600 }),
    pin: () => tone({ f: 3200, f2: 2600, dur: 0.04, gain: 0.06 }),
  };

  // ---------- input ----------
  const curWeapon = () => WEAPONS[weapon];
  const sprinting = () => (keys.has('ShiftLeft') || keys.has('ShiftRight')) && keys.has('KeyW') && !keys.has('KeyS') && !ads && !crouch;
  const transmit = () => {
    if (!active()) return;
    send(inputFor(keys, aim.yaw, aim.pitch, fire && locked() && !paused(), seq++,
      { sprint: sprinting(), crouch, ads: ads && locked(), weapon, jump: counts.jump, reload: counts.reload, nade: counts.nade, squad: counts.squad }));
  };
  // Input is independent of rendering. A slow GPU must not swallow a short key press.
  setInterval(transmit, 50);
  const release = () => { keys.clear(); fire = false; ads = false; transmit(); };
  async function capture() {
    if (!active() || !alive()) return;
    try { await renderer.domElement.requestPointerLock(); }
    catch { $('fpsStatus').textContent = 'Mouse capture refused. Click the battlefield again. HTTPS and a desktop browser are required.'; }
  }
  $('fpsCapture').onclick = capture;
  document.addEventListener('pointerlockchange', () => { if (!locked()) release(); });
  addEventListener('blur', release);
  function pickWeapon(i) {
    if (i === weapon || !WEAPONS[i]) return;
    lastWeapon = weapon; weapon = i; swapUntil = performance.now() + OPERATIVE.swap * 1000; reloadUntil = 0; sfx.swap();
  }
  function startReload() {
    const now = performance.now(), w = curWeapon();
    if (reloadUntil > now || swapUntil > now || ammo() >= w.mag) return;
    counts.reload++; reloadUntil = now + w.reload * 1000;
    if (w.id === 'smg') { sfx.mag(0.35); sfx.mag(1.4); sfx.bolt(1.75); } else { sfx.bolt(0.1); sfx.mag(0.9); sfx.bolt(1.9); }
  }
  function onKey(e) {
    if (e.repeat) return;
    if (e.code === 'Space') { counts.jump++; jumpQueued = true; }
    else if (e.code === 'KeyR') startReload();
    else if (e.code === 'KeyG') {
      const now = performance.now();
      if ((status?.nades ?? 0) > 0 && throwUntil < now - 400 && !sprinting()) { counts.nade++; throwUntil = now + 650; sfx.pin(); }
    }
    else if (e.code === 'KeyF') counts.squad++;
    else if (e.code === 'KeyC') crouch = !crouch;
    else if (e.code === 'Digit1') pickWeapon(0);
    else if (e.code === 'Digit2') pickWeapon(1);
    else if (e.code === 'KeyQ') pickWeapon(lastWeapon);
  }
  // Installed before the RTS handlers. Prevent every army shortcut and selection gesture in this role.
  for (const type of ['keydown', 'keyup', 'mousedown', 'mouseup', 'mousemove', 'wheel', 'contextmenu', 'pointerdown', 'pointerup', 'click']) {
    addEventListener(type, e => {
      if (!active() || (!locked() && e.target?.closest?.('#fpsPanel'))) return;
      if (type === 'keydown' && e.code === 'Escape') { release(); document.exitPointerLock(); }
      if (locked() && !paused() && alive()) {
        if (type === 'keydown') { keys.add(e.code); onKey(e); }
        if (type === 'keyup') keys.delete(e.code);
        if (type === 'mousemove') {
          const scale = fov / FOV.base; // slower aim through the sights
          Object.assign(aim, lookDelta(aim.yaw, aim.pitch, e.movementX, e.movementY, scale));
          sway.x = clamp(sway.x - e.movementX * 0.00035, -0.05, 0.05); sway.y = clamp(sway.y + e.movementY * 0.00035, -0.05, 0.05);
        }
        if (type === 'mousedown' && e.button === 0) fire = true;
        if (type === 'mouseup' && e.button === 0) fire = false;
        if (type === 'mousedown' && e.button === 2) ads = true;
        if (type === 'mouseup' && e.button === 2) ads = false;
        if (type === 'wheel') pickWeapon(weapon ? 0 : 1);
        if (['keydown', 'keyup', 'mousedown', 'mouseup', 'wheel'].includes(type)) transmit();
      } else if (type === 'click' && e.target === renderer.domElement) capture();
      if (!(type === 'keydown' && e.code === 'Escape')) e.preventDefault();
      e.stopImmediatePropagation();
    }, { capture: true, passive: false });
  }

  // ---------- the weapons in hand ----------
  const rig = new THREE.Group(); rig.name = 'operative-hands'; camera.add(rig); scene.add(camera);
  // walnut with a grain that runs along the stock (the canvas's x is the gun's length)
  const grain = (() => {
    const c = document.createElement('canvas'); c.width = 512; c.height = 64; const x = c.getContext('2d');
    x.fillStyle = '#6a3d22'; x.fillRect(0, 0, 512, 64);
    for (let i = 0; i < 70; i++) {
      x.strokeStyle = `rgba(${30 + Math.random() * 30},${14 + Math.random() * 14},6,${0.12 + Math.random() * 0.25})`; x.lineWidth = 0.6 + Math.random() * 1.8;
      x.beginPath(); let y = Math.random() * 64; x.moveTo(0, y);
      for (let px = 0; px <= 512; px += 32) { y += (Math.random() - 0.5) * 3; x.lineTo(px, y); }
      x.stroke();
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t;
  })();
  const M = {
    wood: new THREE.MeshStandardMaterial({ map: grain, color: 0xcfa58a, roughness: 0.48, metalness: 0 }),
    darkWood: new THREE.MeshStandardMaterial({ color: 0x2d1a0f, roughness: 0.6 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x3a3d40, roughness: 0.42, metalness: 0.75 }),
    blued: new THREE.MeshStandardMaterial({ color: 0x1c1f23, roughness: 0.32, metalness: 0.85 }),
    bakelite: new THREE.MeshStandardMaterial({ color: 0x2a1c14, roughness: 0.45 }),
    sleeve: new THREE.MeshStandardMaterial({ color: 0x4d5136, roughness: 0.96 }),
    cuff: new THREE.MeshStandardMaterial({ color: 0x3f422c, roughness: 0.96 }),
    skin: new THREE.MeshStandardMaterial({ color: 0xb98365, roughness: 0.68 }),
    nade: new THREE.MeshStandardMaterial({ color: 0x3d4434, roughness: 0.6, metalness: 0.3 }),
  };
  const box = (g, w, h, d, x, y, z, m, rx = 0) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.rotation.x = rx; g.add(o); return o; };
  const cyl = (g, r, len, x, y, z, m, seg = 14, r2 = r) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r2, len, seg), m); o.rotation.x = Math.PI / 2; o.position.set(x, y, z); g.add(o); return o; };
  // a side profile ([z, y] points, z toward the eye) extruded to a thickness, with rounded edges: stocks and grips
  function profile(g, pts, depth, m, x = 0) {
    const s = new THREE.Shape(pts.map(([zz, yy]) => new THREE.Vector2(zz, yy)));
    const geo = new THREE.ExtrudeGeometry(s, { depth: depth - 0.012, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.005, bevelSegments: 3, steps: 1, curveSegments: 8 });
    geo.translate(0, 0, -(depth - 0.012) / 2); geo.rotateY(-Math.PI / 2); // profile x becomes +z
    const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 1.6, uv.getY(i) * 4); // grain along the length
    const o = new THREE.Mesh(geo, m); o.position.x = x; g.add(o); return o;
  }
  // a hand closed around a bar along z at (x, y, z): fingers as a torus segment, a palm, a thumb over the top
  function hand(g, [x, y, z], r, side = 1) {
    const h = new THREE.Group(); h.position.set(x, y, z); g.add(h);
    const fingers = new THREE.Mesh(new THREE.TorusGeometry(r + 0.011, 0.011, 8, 16, Math.PI * 1.25), M.skin);
    fingers.rotation.z = side > 0 ? -0.35 : Math.PI + 0.35; fingers.scale.set(1, 1, 3.6); h.add(fingers);
    const palm = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 10), M.skin); palm.scale.set(0.7, 1, 1.5); palm.position.set(side * (r + 0.016), -0.006, 0.01); h.add(palm);
    const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.0085, 0.035, 4, 8), M.skin); thumb.rotation.x = Math.PI / 2 - 0.2; thumb.position.set(-side * (r * 0.4), r + 0.008, -0.02); h.add(thumb);
    return h;
  }
  function sleeve(g, wrist, elbow) {
    const a = new THREE.Vector3(...wrist), b = new THREE.Vector3(...elbow), len = a.distanceTo(b), q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.027, 0.04, len, 14), M.sleeve); fore.position.copy(a).lerp(b, 0.5); fore.quaternion.copy(q); g.add(fore);
    const wristM = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.025, 0.05, 12), M.skin); wristM.position.copy(a).lerp(b, -0.04); wristM.quaternion.copy(q); g.add(wristM);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.025, 14), M.cuff); cuff.position.copy(a).lerp(b, 0.06); cuff.quaternion.copy(q); g.add(cuff);
  }
  // Each gun's origin is its line of sight: aimed, the eye looks straight down it (the ADS pose is 0, 0, z).
  // A semi-automatic rifle with a peep sight: rear ring at the receiver, a guarded post at the muzzle.
  function rifle() {
    const g = new THREE.Group();
    // stock: butt, wrist and forend in one walnut piece; a handguard over the barrel; a steel butt plate
    profile(g, [[0.36, -0.06], [0.12, -0.05], [0.06, -0.075], [-0.01, -0.095], [-0.05, -0.08], [-0.08, -0.06], [-0.46, -0.058], [-0.47, -0.042], [-0.08, -0.036], [0.02, -0.036], [0.1, -0.036], [0.36, -0.04], [0.39, -0.042], [0.39, -0.155], [0.36, -0.16], [0.2, -0.105], [0.12, -0.095]], 0.042, M.wood);
    box(g, 0.044, 0.118, 0.008, 0, -0.098, 0.394, M.steel);
    cyl(g, 0.018, 0.27, 0, -0.03, -0.29, M.wood, 14).scale.set(1.05, 1, 0.7);
    // barrel, gas cylinder, receiver and trigger guard
    cyl(g, 0.0095, 0.5, 0, -0.033, -0.45, M.blued);
    cyl(g, 0.007, 0.2, 0, -0.05, -0.56, M.blued);
    box(g, 0.026, 0.024, 0.07, 0, -0.045, -0.655, M.steel);
    cyl(g, 0.018, 0.2, 0, -0.03, -0.02, M.steel);
    box(g, 0.03, 0.016, 0.16, 0, -0.016, -0.03, M.blued);
    const guard = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.0035, 6, 14, Math.PI), M.steel); guard.rotation.set(0, Math.PI / 2, Math.PI); guard.position.set(0, -0.06, 0.03); g.add(guard);
    box(g, 0.005, 0.022, 0.006, 0, -0.065, 0.035, M.blued);
    // sights: a rear ring the eye looks through, a front post between two ears; the line runs at y = 0
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0055, 0.0028, 8, 18), M.blued); ring.position.set(0, 0, 0.08); g.add(ring);
    box(g, 0.022, 0.016, 0.014, 0, -0.012, 0.08, M.blued);
    box(g, 0.004, 0.018, 0.012, -0.011, -0.004, 0.08, M.blued); box(g, 0.004, 0.018, 0.012, 0.011, -0.004, 0.08, M.blued);
    box(g, 0.0028, 0.03, 0.004, 0, -0.016, -0.67, M.blued);
    box(g, 0.003, 0.032, 0.01, -0.008, -0.018, -0.67, M.blued); box(g, 0.003, 0.032, 0.01, 0.008, -0.018, -0.67, M.blued);
    // operating handle, which jumps back on each shot and on the reload
    const bolt = new THREE.Group(); bolt.position.set(0.019, -0.02, -0.04); g.add(bolt);
    box(bolt, 0.008, 0.008, 0.06, 0, 0, 0, M.steel); box(bolt, 0.018, 0.01, 0.01, 0.009, 0, -0.026, M.steel);
    box(g, 0.044, 0.01, 0.018, 0, -0.06, -0.2, M.steel);
    const muzzle = new THREE.Object3D(); muzzle.position.set(0, -0.033, -0.71); g.add(muzzle);
    const eject = new THREE.Object3D(); eject.position.set(0.015, -0.012, -0.02); g.add(eject);
    hand(g, [0, -0.07, 0.11], 0.017, 1); sleeve(g, [0.03, -0.11, 0.17], [0.12, -0.28, 0.42]);
    hand(g, [0, -0.06, -0.26], 0.022, -1); sleeve(g, [-0.035, -0.095, -0.22], [-0.42, -0.4, 0.12]);
    return { g, muzzle, eject, bolt, boltZ: -0.04, hip: [0.12, -0.12, -0.5], ads: [0, 0, -0.3], flash: 0.13, kick: { z: 0.07, rot: 0.11, cam: 0.022, climb: 0.006 } };
  }
  // A blowback submachine gun: tube receiver, ribbed barrel, long box magazine, pistol grip, folded stock.
  function smg() {
    const g = new THREE.Group();
    cyl(g, 0.019, 0.26, 0, -0.04, -0.05, M.blued);
    for (let i = 0; i < 5; i++) cyl(g, 0.0205, 0.006, 0, -0.04, -0.13 - i * 0.022, M.blued);
    cyl(g, 0.011, 0.16, 0, -0.04, -0.26, M.steel);
    cyl(g, 0.015, 0.03, 0, -0.04, -0.35, M.blued);
    box(g, 0.012, 0.03, 0.012, 0, -0.07, -0.33, M.blued);
    box(g, 0.026, 0.035, 0.13, 0, -0.065, -0.02, M.blued);
    box(g, 0.026, 0.035, 0.045, 0, -0.085, -0.115, M.blued);
    const mag = box(g, 0.02, 0.19, 0.034, 0, -0.18, -0.115, M.steel, -0.06);
    profile(g, [[0.03, -0.075], [0.075, -0.075], [0.1, -0.18], [0.072, -0.188], [0.035, -0.09]], 0.028, M.bakelite);
    const guard = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.003, 6, 12, Math.PI), M.steel); guard.rotation.set(0, Math.PI / 2, Math.PI); guard.position.set(0, -0.085, 0.02); g.add(guard);
    box(g, 0.008, 0.008, 0.22, 0.017, -0.075, 0.16, M.steel); box(g, 0.008, 0.008, 0.22, -0.017, -0.075, 0.16, M.steel);
    box(g, 0.042, 0.03, 0.01, 0, -0.08, 0.27, M.steel);
    // sights: a notch on a short blade at the back, a hooded post at the muzzle; the line runs at y = 0
    box(g, 0.02, 0.022, 0.01, 0, -0.012, 0.07, M.blued);
    box(g, 0.006, 0.01, 0.01, -0.007, 0.004, 0.07, M.blued); box(g, 0.006, 0.01, 0.01, 0.007, 0.004, 0.07, M.blued);
    box(g, 0.003, 0.028, 0.006, 0, -0.016, -0.34, M.blued);
    const hood = new THREE.Mesh(new THREE.TorusGeometry(0.009, 0.002, 6, 12, Math.PI), M.blued); hood.position.set(0, -0.004, -0.34); g.add(hood);
    const bolt = new THREE.Group(); bolt.position.set(-0.022, -0.035, -0.02); g.add(bolt);
    box(bolt, 0.016, 0.008, 0.008, -0.008, 0, 0, M.steel);
    const muzzle = new THREE.Object3D(); muzzle.position.set(0, -0.04, -0.37); g.add(muzzle);
    const eject = new THREE.Object3D(); eject.position.set(0.02, -0.03, -0.04); g.add(eject);
    hand(g, [0, -0.115, 0.06], 0.018, 1); sleeve(g, [0.03, -0.16, 0.11], [0.13, -0.33, 0.36]);
    hand(g, [0, -0.13, -0.115], 0.02, -1); sleeve(g, [-0.035, -0.17, -0.08], [-0.4, -0.42, 0.2]);
    return { g, muzzle, eject, bolt, boltZ: -0.02, mag, magY: mag.position.y, hip: [0.11, -0.1, -0.44], ads: [0, 0, -0.27], flash: 0.1, kick: { z: 0.028, rot: 0.035, cam: 0.008, climb: 0.0025 } };
  }
  const guns = [rifle(), smg()];
  for (const w of guns) { w.g.visible = false; rig.add(w.g); w.g.traverse(o => { if (o.isMesh) { o.castShadow = false; o.frustumCulled = false; o.renderOrder = 10; } }); }
  // the stick grenade that swings out of view on a throw
  const grenade = new THREE.Group(); rig.add(grenade); grenade.visible = false;
  cyl(grenade, 0.011, 0.2, 0, 0, 0.06, M.wood); cyl(grenade, 0.033, 0.075, 0, 0, -0.07, M.nade, 14);
  hand(grenade, [0, 0, 0.09], 0.011, 1); sleeve(grenade, [0.03, -0.04, 0.14], [0.12, -0.22, 0.38]);

  // muzzle flash: two crossed additive quads and a light, a few frames long
  const flashTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
    const r = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, 'rgba(255,250,220,1)'); r.addColorStop(0.25, 'rgba(255,200,90,0.9)'); r.addColorStop(0.6, 'rgba(255,120,30,0.35)'); r.addColorStop(1, 'rgba(255,90,20,0)');
    x.fillStyle = r; x.beginPath();
    for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2, rr = i % 2 ? 11 : 31; x.lineTo(32 + Math.cos(a) * rr, 32 + Math.sin(a) * rr); }
    x.fill(); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const flashMat = new THREE.MeshBasicMaterial({ map: flashTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const flash = new THREE.Group();
  // a star seen down the barrel, and two long petals along it
  for (const [geo, rx, ry, z] of [[new THREE.PlaneGeometry(1, 1), 0, 0, 0], [new THREE.PlaneGeometry(2.2, 0.8), 0, Math.PI / 2, -0.7], [new THREE.PlaneGeometry(0.8, 2.2), Math.PI / 2, 0, -0.7]]) {
    const q = new THREE.Mesh(geo, flashMat); q.rotation.set(rx, ry, 0); q.position.z = z; q.renderOrder = 11; flash.add(q);
  }
  flash.visible = false;
  let flashLight = null, flashUntil = 0;

  // A sky for eye level: the RTS camera never sees above the horizon, a soldier mostly does. Its horizon is the
  // haze color, so it meets the fog; clouds drift on a plane; the sun sits where the shadows say.
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { horizon: { value: new THREE.Color() }, zenith: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunColor: { value: new THREE.Color() }, time: { value: 0 } },
    vertexShader: `varying vec3 vDir; void main() { vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: `uniform vec3 horizon, zenith, sunDir, sunColor; uniform float time; varying vec3 vDir;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
      float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
      void main() {
        vec3 d = normalize(vDir); float up = max(d.y, 0.0);
        vec3 col = mix(horizon, zenith, pow(up, 0.5));
        float s = max(dot(d, sunDir), 0.0);
        if (d.y > 0.0) {
          vec2 uv = d.xz / (d.y + 0.15) * 1.3 + vec2(time * 0.006, time * 0.002);
          float c = smoothstep(0.48, 0.78, fbm(uv)) * smoothstep(0.0, 0.2, d.y);
          vec3 cloud = mix(horizon * 0.82, horizon * 1.2 + sunColor * 0.08, smoothstep(0.5, 0.9, fbm(uv + sunDir.xz * 0.06)));
          col = mix(col, cloud, c * 0.85);
        }
        col += sunColor * (pow(s, 900.0) * 8.0 + pow(s, 12.0) * 0.18);
        col = mix(col, horizon, 1.0 - smoothstep(-0.02, 0.1, d.y));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), skyMat); sky.frustumCulled = false; sky.renderOrder = -10; sky.visible = false; scene.add(sky);
  const lights = {};
  function skyFrame(now) {
    if (!lights.sun) scene.traverse(o => { if (o.isDirectionalLight && !lights.sun) lights.sun = o; if (o.isHemisphereLight && !lights.hemi) lights.hemi = o; });
    const u = skyMat.uniforms;
    u.horizon.value.copy(scene.fog?.color ?? u.horizon.value);
    if (lights.hemi) u.zenith.value.copy(lights.hemi.color).lerp(new THREE.Color(0x4f74a8), 0.35).multiplyScalar(0.8);
    if (lights.sun) { u.sunDir.value.subVectors(lights.sun.position, lights.sun.target.position).normalize(); u.sunColor.value.copy(lights.sun.color).multiplyScalar(Math.min(1.5, lights.sun.intensity * 0.4)); }
    u.time.value = now / 1000;
    sky.position.copy(camera.position);
  }

  // tracers and spent casings live in the world
  const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffd58a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const tracerGeo = new THREE.BoxGeometry(1, 1, 1); tracerGeo.translate(0, 0, -0.5);
  const tracers = Array.from({ length: 16 }, () => { const m = new THREE.Mesh(tracerGeo, tracerMat); m.visible = false; m.frustumCulled = false; scene.add(m); return { m, t: 0, life: 0, from: new THREE.Vector3(), to: new THREE.Vector3() }; });
  const brass = new THREE.MeshStandardMaterial({ color: 0xb08a3c, metalness: 0.9, roughness: 0.35 });
  const caseGeo = new THREE.CylinderGeometry(0.005, 0.005, 0.03, 6);
  const casings = Array.from({ length: 14 }, () => { const m = new THREE.Mesh(caseGeo, brass); m.visible = false; scene.add(m); return { m, v: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0 }; });
  let tracerI = 0, caseI = 0;
  const v3 = new THREE.Vector3(), v3b = new THREE.Vector3(), quat = new THREE.Quaternion();

  function setRole(on) {
    enabled = !!on; document.body.classList.toggle('operative', enabled);
    if (!enabled) { release(); if (locked()) document.exitPointerLock(); }
    // one light, added once: a light appearing and vanishing would recompile every material in the scene
    if (enabled && !flashLight) { flashLight = new THREE.PointLight(0xffb060, 0, 9, 2); scene.add(flashLight); }
    camera.near = enabled ? 0.03 : 1; camera.fov = enabled ? FOV.base : 42; camera.updateProjectionMatrix();
  }
  function start(m) {
    setRole(m.role === 'operative'); release(); status = m.operative ?? null; seq = (status?.seq ?? -1) + 1;
    aim.yaw = 0; aim.pitch = 0; predId = 0; localShots = status?.shots ?? 0;
    if (enabled && m.spawn) aim.yaw = Math.atan2(m.map.h - m.spawn.z, m.map.w - m.spawn.x);
    if (status?.weapon != null) weapon = status.weapon;
  }
  function snapshot(s) {
    if (!enabled) return;
    const next = s.operative;
    if (!next) return;
    const now = performance.now();
    if (next.hits > (status?.hits ?? 0)) { hitUntil = now + 200; sfx.hit(); }
    if (next.kills > (status?.kills ?? 0)) { killUntil = now + 1400; sfx.kill(); text('fpsKill', `Enemy down  +${next.kills - (status?.kills ?? 0)}`); }
    if (status?.id && next.id === status.id && next.hp < status.hp) {
      hurtUntil = now + 450; landDip += 0.04; recoilPitch -= 0.02;
      if (next.from) { hurtAngle = Math.atan2(next.from[1] - pred.z, next.from[0] - pred.x) - aim.yaw; $('fpsDir').style.transform = `rotate(${hurtAngle}rad)`; }
    }
    if (status?.id && !next.id) deadAt = now;
    if (!next.id || paused()) release();
    if (next.id && next.id !== predId && next.x != null) {
      // a new life: start predicting from where the server put him
      Object.assign(pred, { x: next.x, z: next.z, vx: 0, vz: 0, jy: 0, vy: 0, crouch: false }); hist.length = 0; predId = next.id;
      localShots = next.shots; reloadUntil = 0; deadAt = 0; crouch = false;
    } else if (next.id && next.x != null) reconcile(next, now);
    if (next.shots >= localShots || now - lastLocalShot > 600) localShots = next.shots;
    status = next;
  }
  // The server's position is about one round trip behind our prediction: compare it with where we were then,
  // and fold the difference in. A big miss (a wall, a cliff) snaps.
  function reconcile(next, now) {
    const lag = (rtt() ?? 100) + 60, then = now - lag;
    let past = hist[0];
    for (const h of hist) { if (h.t > then) break; past = h; }
    if (!past) return;
    const ex = next.x - past.x, ez = next.z - past.z, err = Math.hypot(ex, ez);
    const k = err > 2.5 ? 1 : err > 0.05 ? 0.3 : 0;
    if (!k) return;
    pred.x += ex * k; pred.z += ez * k;
    for (const h of hist) { h.x += ex * k; h.z += ez * k; }
    if (Math.hypot(next.vx, next.vz) < 0.05 && err > 0.4) { pred.vx *= 0.5; pred.vz *= 0.5; } // the server is stuck: a wall
  }
  const ammo = () => {
    const pending = Math.max(0, localShots - (status?.shots ?? 0));
    return Math.max(0, (status?.mags?.[weapon] ?? curWeapon().mag) - (status?.weapon === weapon ? pending : 0));
  };
  const reloading = (now) => reloadUntil > now || (status?.reload > 0 && status.weapon === weapon);
  // spread the server would roll now (shared/sim.js fireOperative), for the crosshair and our own tracers
  function spread() {
    const w = curWeapon(), speed = Math.hypot(pred.vx, pred.vz);
    return (ads ? w.ads : w.hip) * (1 + Math.min(1.5, speed / OPERATIVE.walk)) * (pred.jy > 0 ? 3 : 1) * (pred.crouch ? 0.6 : 1);
  }
  function shoot(now) {
    const w = curWeapon(), gun = guns[weapon];
    localShots++; lastLocalShot = now;
    cooldownUntil = now + Math.ceil(w.interval / TICK - 1e-6) * TICK * 1000; // the server fires on its 20 Hz ticks
    kick.z += gun.kick.z; kick.rot += gun.kick.rot * (ads ? 0.5 : 1);
    recoilPitch += gun.kick.cam * (ads ? 0.6 : 1); recoilYaw += (Math.random() - 0.5) * gun.kick.cam * 0.6;
    aim.pitch = clamp(aim.pitch + gun.kick.climb * (crouch ? 0.6 : 1), -1.45, 1.45);
    flashUntil = now + 45; flash.rotation.z = Math.random() * Math.PI;
    audio.play('rifle', { x: pred.x, z: pred.z }, { name: 'operative', mix: { gain: w.id === 'smg' ? 0.55 : 0.85, max: 6, pitch: 0.05 }, rate: w.id === 'smg' ? 1.35 : 0.95 });
    // our guess of the bullet: the aim ray with a spread like the server's, to the first ground or body
    const r = spread() * Math.sqrt(Math.random()), a = Math.random() * Math.PI * 2;
    const yaw = aim.yaw + Math.cos(a) * r, pitch = aim.pitch + Math.sin(a) * r, cp = Math.cos(pitch);
    const dx = Math.cos(yaw) * cp, dy = Math.sin(pitch), dz = Math.sin(yaw) * cp;
    const ox = pred.x, oy = camera.position.y, oz = pred.z;
    let end = null, body = false;
    for (let d = 0.5; d <= w.range; d += 0.25) {
      const x = ox + dx * d, y = oy + dy * d, z = oz + dz * d;
      if (y <= ground(x, z)) { end = [x, ground(x, z), z]; break; }
      for (const u of units.values()) if (u.id !== status?.id && u.root.visible && Math.hypot(u.x - x, u.z - z) < (u.squad ? 0.9 : 1.6) && y - ground(u.x, u.z) < 1.9) { end = [x, y, z]; body = true; break; }
      if (end) break;
    }
    gun.muzzle.getWorldPosition(v3);
    const to = end ? v3b.set(...end) : v3b.set(ox + dx * w.range, oy + dy * w.range, oz + dz * w.range);
    if (w.id === 'rifle' || localShots % 3 === 0) {
      const t = tracers[tracerI++ % tracers.length];
      t.from.copy(v3); t.to.copy(to); t.t = 0; t.life = Math.max(0.05, t.from.distanceTo(t.to) / 420); t.m.visible = true;
    }
    if (end) effects()?.impactAt?.(end[0], end[1], end[2], body);
    // a spent case out of the ejection port
    const c = casings[caseI++ % casings.length];
    gun.eject.getWorldPosition(c.m.position); camera.getWorldQuaternion(quat);
    c.v.set(1.6 + Math.random() * 0.6, 1.4 + Math.random() * 0.6, 0.3).applyQuaternion(quat); c.spin.set(Math.random() * 20, Math.random() * 20, 0); c.life = 1.2; c.m.visible = true;
  }

  // ---------- per frame ----------
  function frame(now, cam) {
    const on = active(); hud.classList.toggle('hidden', !on);
    rig.visible = on && alive();
    const dt = Math.min(0.05, (now - lastFrame) / 1000); lastFrame = now;
    sky.visible = on;
    if (!on) { if (flashLight) flashLight.intensity = 0; return; }
    skyFrame(now);
    const live = alive() && locked() && !paused(), w = curWeapon(), gun = guns[weapon];
    // movement prediction, in small steps like the server's ticks
    const forward = live ? +keys.has('KeyW') - +keys.has('KeyS') : 0, strafe = live ? +keys.has('KeyD') - +keys.has('KeyA') : 0;
    if (alive()) {
      const wasAir = pred.jy > 0;
      for (let left = dt; left > 1e-4; left -= 1 / 120) {
        predictStep(pred, { forward, strafe, yaw: aim.yaw, sprint: live && sprinting(), crouch: live && crouch, ads: live && ads, jump: live && jumpQueued }, Math.min(1 / 120, left));
        jumpQueued = false;
      }
      if (!live) crouch = pred.crouch;
      if (pred.vy > 0 && !wasAir) sfx.jump();
      if (pred.landed) { pred.landed = false; landDip += 0.07; sfx.land(); }
      hist.push({ t: now, x: pred.x, z: pred.z }); while (hist.length && hist[0].t < now - 1500) hist.shift();
    }
    // firing, on our own clock; the server runs the same cooldown and counts the same magazine
    const busy = reloading(now) || swapUntil > now || throwUntil > now;
    if (live && fire && !busy && !pred.sprint && now >= cooldownUntil && ammo() > 0) shoot(now);
    if (live && fire && !busy && ammo() === 0 && now >= cooldownUntil) { if (w.id === 'rifle') fire = false; sfx.dry(); startReload(); }
    // camera: eye height, bob, landing dip, recoil
    const speed = Math.hypot(pred.vx, pred.vz), grounded = pred.jy <= 0;
    eye = damp(eye, pred.crouch ? OPERATIVE.crouchEye : OPERATIVE.eye, 12, dt);
    const stride = pred.sprint ? 2.6 : 1.9, before = Math.floor(bobPhase / Math.PI);
    if (grounded && speed > 0.3) bobPhase += speed / stride * Math.PI * dt; else bobPhase = damp(bobPhase, Math.round(bobPhase / Math.PI) * Math.PI, 6, dt);
    if (grounded && speed > 0.3 && Math.floor(bobPhase / Math.PI) !== before) sfx.step(pred.sprint ? 1.4 : pred.crouch ? 0.5 : 1);
    const bobK = grounded ? Math.min(1, speed / OPERATIVE.walk) * (ads ? 0.25 : 1) * (pred.sprint ? 1.5 : 1) : 0;
    landDip = damp(landDip, 0, 9, dt); recoilPitch = damp(recoilPitch, 0, 10, dt); recoilYaw = damp(recoilYaw, 0, 10, dt);
    const dead = !alive() && deadAt, fall = dead ? clamp((now - deadAt) / 700, 0, 1) : 0;
    const gx = pred.x, gz = pred.z, gy = ground(gx, gz);
    camera.position.set(gx, gy + pred.jy + eye - landDip - fall * 1.3 + Math.abs(Math.sin(bobPhase)) * 0.045 * bobK, gz);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(aim.pitch + recoilPitch, cameraYaw(aim.yaw) + recoilYaw, Math.sin(bobPhase) * 0.006 * bobK + fall * 1.1, 'YXZ');
    camera.updateMatrixWorld();
    cam.x = gx; cam.z = gz; cam.y = gy; cam.dist = 75; cam.yaw = aim.yaw; cam.fps = true;
    const wantFov = ads && live ? FOV.ads[weapon] : pred.sprint ? FOV.sprint : FOV.base;
    fov = damp(fov, wantFov, 14, dt);
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }

    // the gun: pose (hip, sights, sprint, reload, swap, throw), sway, bob and recoil springs
    guns.forEach((g, i) => (g.g.visible = i === weapon));
    const adsK = gun.adsK = damp(gun.adsK ?? 0, ads && live && !busy ? 1 : 0, 16, dt);
    const sprintK = gun.sprintK = damp(gun.sprintK ?? 0, pred.sprint ? 1 : 0, 10, dt);
    const reloadT = reloading(now) ? 1 - Math.max(0, (reloadUntil - now) / (w.reload * 1000)) : 1;
    const reloadK = reloading(now) ? Math.sin(Math.min(1, reloadT * 1.15) * Math.PI) : 0;
    const swapK = swapUntil > now ? Math.sin((swapUntil - now) / (OPERATIVE.swap * 1000) * Math.PI / 2) : 0;
    const throwK = throwUntil > now ? Math.sin((1 - (throwUntil - now) / 650) * Math.PI) : 0;
    sway.x = damp(sway.x, 0, 7, dt); sway.y = damp(sway.y, 0, 7, dt);
    kick.z = damp(kick.z, 0, 18, dt); kick.rot = damp(kick.rot, 0, 14, dt);
    const idle = Math.sin(now / 900) * 0.0025 * (1 - adsK * 0.7);
    const hip = gun.hip, ads3 = gun.ads, bx = Math.sin(bobPhase) * 0.012 * bobK, by = -Math.abs(Math.cos(bobPhase)) * 0.012 * bobK;
    gun.g.position.set(
      hip[0] + (ads3[0] - hip[0]) * adsK + sway.x * (1 - adsK * 0.8) + bx - sprintK * 0.04,
      hip[1] + (ads3[1] - hip[1]) * adsK + sway.y * (1 - adsK * 0.8) + by + idle - reloadK * 0.09 - swapK * 0.35 - throwK * 0.25 - sprintK * 0.03 - (pred.jy > 0 ? 0.015 : 0) + landDip * 0.4,
      hip[2] + (ads3[2] - hip[2]) * adsK + kick.z);
    gun.g.rotation.set(kick.rot + reloadK * 0.5 - sprintK * 0.35 + swapK * 0.6, sprintK * 0.75 + reloadK * 0.15 - (1 - adsK) * 0.05, reloadK * 0.7 + sprintK * 0.25 + sway.x * 2, 'YXZ');
    if (gun.mag) gun.mag.position.y = gun.magY - (reloadT > 0.2 && reloadT < 0.65 ? 0.25 : 0) * reloadK;
    if (gun.bolt) gun.bolt.position.z = gun.boltZ + (reloadK > 0.6 ? 0.05 : 0) + kick.z * 0.6;
    grenade.visible = throwK > 0.02 && alive();
    if (grenade.visible) { grenade.position.set(-0.18 + throwK * 0.1, -0.35 + throwK * 0.3, -0.35 - throwK * 0.15); grenade.rotation.set(-1 + throwK * 1.8, 0, 0); }

    // flash, light, tracers and casings
    gun.g.add(flash); flash.position.copy(gun.muzzle.position); flash.scale.setScalar(now < flashUntil ? gun.flash * (0.8 + Math.random() * 0.5) : 0.001);
    flash.visible = now < flashUntil;
    if (flashLight) { gun.muzzle.getWorldPosition(flashLight.position); flashLight.intensity = now < flashUntil ? 40 : 0; }
    for (const t of tracers) {
      if (!t.m.visible) continue;
      t.t += dt;
      const k0 = clamp(t.t / t.life - 0.35, 0, 1), k1 = clamp(t.t / t.life, 0, 1);
      t.m.position.lerpVectors(t.from, t.to, k1); v3.lerpVectors(t.from, t.to, k0);
      const len = Math.max(0.01, t.m.position.distanceTo(v3));
      t.m.lookAt(v3); t.m.scale.set(0.018, 0.018, len); t.m.rotateY(Math.PI);
      if (t.t >= t.life) t.m.visible = false;
    }
    for (const c of casings) {
      if (!c.m.visible) continue;
      c.life -= dt; c.v.y -= 9.8 * dt; c.m.position.addScaledVector(c.v, dt);
      c.m.rotation.x += c.spin.x * dt; c.m.rotation.z += c.spin.y * dt;
      const floor = ground(c.m.position.x, c.m.position.z) + 0.01;
      if (c.m.position.y < floor) { c.m.position.y = floor; c.v.multiplyScalar(0.3); c.v.y = Math.abs(c.v.y); c.spin.multiplyScalar(0.4); }
      if (c.life <= 0) c.m.visible = false;
    }

    // the battlefield's RTS overlays are not for a soldier
    for (const v of units.values()) {
      v.bars.visible = false; v.base.visible = false; v.sel.visible = false; if (v.range) v.range.visible = false;
      if (v.id === status?.id) v.root.visible = false;
    }
    hudFrame(now, w, live);
  }
  function hudFrame(now, w, live) {
    const hp = status?.hp ?? 0, max = status?.maxHp ?? OPERATIVE.hp;
    text('fpsHealth', String(hp));
    $('fpsHpBar').firstChild.style.width = `${clamp(hp / max, 0, 1) * 100}%`;
    hud.classList.toggle('low', alive() && hp <= max * 0.35);
    text('fpsStatus', paused() ? 'Battle paused by commander' : !alive() ? 'Killed. Waiting to respawn.' : locked() ? 'Attached to your commander. Fight alongside the army.' : 'Mouse released. Click to resume aim and movement.');
    $('fpsPanel').classList.toggle('hidden', locked() || !alive());
    $('fpsCapture').classList.toggle('hidden', locked() || !alive());
    $('fpsDead').classList.toggle('hidden', alive());
    const sq = status?.squad;
    text('fpsSquad', sq ? `${sq.name} · ${sq.men} men · F lets go` : 'F: lead a squad within 8 m');
    if (!alive() && sq && !status.waiting && status.squadSpawn) text('fpsRespawn', `Back in ${status.respawn ?? 0}s as one of your ${sq.name}'s men.`);
    else if (!alive()) text('fpsRespawn', status?.waiting ? `Waiting for ${status?.cost ?? 10} commander manpower to send a new soldier.` : `New soldier in ${status?.respawn ?? 0}s. Costs ${status?.cost ?? 10} commander manpower.`);
    text('fpsWeapons', WEAPONS.map((x, i) => `${i + 1} ${x.name}`).join('   '));
    $('fpsWeapons').dataset.on = weapon;
    $('fpsAmmo').firstChild.textContent = reloading(now) ? '--' : String(ammo());
    $('fpsAmmo').lastChild.textContent = ` / ${w.mag}  ${w.name.toUpperCase()}`;
    $('fpsAmmo').classList.toggle('empty', ammo() === 0);
    const rl = reloading(now) && reloadUntil > now ? 1 - (reloadUntil - now) / (w.reload * 1000) : 0;
    $('fpsReload').classList.toggle('hidden', !rl); $('fpsReload').firstChild.style.width = `${rl * 100}%`;
    text('fpsNades', '● '.repeat(status?.nades ?? 0).trim() + (status?.nades ? '  G' : 'no grenades'));
    // crosshair opens with spread: px per radian at the current field of view
    const gap = clamp(spread() * innerHeight / (2 * Math.tan(camera.fov * Math.PI / 360)), 3, 80);
    const cross = $('fpsCross'); cross.style.setProperty('--gap', `${gap + 4}px`);
    cross.classList.toggle('ads', !!guns[weapon].adsK && guns[weapon].adsK > 0.7); cross.style.opacity = !alive() ? '0' : guns[weapon].sprintK > 0.5 ? '0.15' : '1';
    $('fpsHit').className = now < hitUntil ? (now < killUntil ? 'on kill' : 'on') : '';
    $('fpsKill').style.opacity = now < killUntil ? '1' : '0';
    $('fpsDamage').style.opacity = now < hurtUntil ? String((hurtUntil - now) / 450) : '0';
    $('fpsDir').style.opacity = now < hurtUntil + 600 && status?.from ? '1' : '0';
  }
  // the server's answer about our own shots is already drawn and heard; the rest of the battle is not
  const ownShot = (sh) => enabled && !!status?.id && sh.f === status.id && sh.k !== 'throw';
  return { start, snapshot, frame, setRole, ownShot, get active() { return active(); }, get aim() { return { ...aim }; }, get status() { return status; }, get predicted() { return { ...pred }; } };
}
