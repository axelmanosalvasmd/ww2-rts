// The game's mouse. It knows where the cursor is for edge scrolling, including the side it left the window by, draws
// the edge-scroll arrow, and runs Capture mouse: pointer lock with a cursor the game draws and moves by movementX/Y.
// While captured the browser sends every mouse event to the locked element at a frozen position, so this module stops
// each one at the window (capture phase, registered before the game's own listeners) and fires a copy at the element
// under the drawn cursor, carrying that position. The rest of the game reads clientX/clientY as usual: `send` below is
// the one place that decides what those coordinates are.
//
// Pointer lock, per MDN (Element/requestPointerLock, Pointer_Lock_API, MouseEvent/movementX, read 2026-10-01):
// - it needs transient activation (a click or key press), and after an Esc unlock the next request needs a new click;
// - it may return a Promise (newer browsers) or undefined (older ones); success and failure also arrive as
//   pointerlockchange and pointerlockerror on the document;
// - with fullscreen, request the lock first: requestFullscreen uses up the activation;
// - unadjustedMovement turns off OS mouse acceleration; it stays off here so the drawn cursor moves like the desktop one;
// - movementX units differ by browser and OS (device, logical or CSS pixels), so a CSS-pixel ratio is measured from
//   clientX while the mouse is free.

const SIZE = 32, INK = '#1b1d14', CHALK = '#f3e7b0';
const svg = (body) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">${body}</svg>`)}")`;
// screen directions of the edge push: n is up the screen
const ANGLES = { e: 0, se: 45, s: 90, sw: 135, w: 180, nw: 225, n: 270, ne: 315 };
const SPRITES = {
  arrow: { url: svg(`<path d="M3 2v22l5.6-5.2 3.9 8.8 3.6-1.6-3.9-8.6H20z" fill="${CHALK}" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>`), x: 3, y: 2 },
  cross: { url: svg(`<g fill="none" stroke-linecap="round"><g stroke="${INK}" stroke-width="4"><circle cx="16" cy="16" r="7"/><path d="M16 3v7M16 22v7M3 16h7M22 16h7"/></g><g stroke="${CHALK}" stroke-width="1.6"><circle cx="16" cy="16" r="7"/><path d="M16 3v7M16 22v7M3 16h7M22 16h7"/></g></g>`), x: 16, y: 16 },
};
for (const [dir, a] of Object.entries(ANGLES)) {
  // a block arrow pointing at the edge; the hot spot is its tip, so the arrow stays on screen at the very edge
  const r = a * Math.PI / 180;
  SPRITES[dir] = { url: svg(`<path transform="rotate(${a} 16 16)" d="M30 16 18 5v6H5v10h13v6z" fill="${CHALK}" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>`),
    x: Math.round(16 + 13 * Math.cos(r)), y: Math.round(16 + 13 * Math.sin(r)) };
}
const MODES = ['fullscreen', 'always', 'off'], LABELS = { fullscreen: 'In fullscreen', always: 'Always', off: 'Off' };
const MOUSE = ['mousemove', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu', 'wheel', 'mouseover', 'mouseout', 'mouseenter', 'mouseleave',
  'pointermove', 'pointerdown', 'pointerup', 'pointerover', 'pointerout', 'pointerenter', 'pointerleave', 'pointercancel', 'pointerrawupdate'];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function createPointer({ view, playing, tryStore, captureButton, captureNow }) {
  let x = innerWidth / 2, y = innerHeight / 2; // the cursor in CSS px: the real one, or the drawn one while captured
  // 'in': seen inside the window. 'out': left across an edge and pinned to it until it comes back.
  // 'none': not known (window blurred, tab hidden, just unlocked); edge scrolling waits for the next move.
  let where = 'none', over = null, buttons = 0, focused = true, vel = { x: 0, y: 0 }, real = null;
  let locked = false, sim = false, releasing = false, suspended = false, wasPlaying = false, ratio = 1;
  let hovered = null, pressed = [], clicks = { n: 0, t: 0, x: 0, y: 0, button: -1 }, slider = null, edgeDir = null, sprite = '';
  let mode = tryStore(() => localStorage.getItem('ww2-capture'));
  if (!MODES.includes(mode)) mode = 'fullscreen';

  const style = document.createElement('style');
  style.textContent = Object.keys(ANGLES).map((d) => `html[data-edge="${d}"], html[data-edge="${d}"] * { cursor: ${SPRITES[d].url} ${SPRITES[d].x} ${SPRITES[d].y}, ${d}-resize !important; }`).join('\n')
    + `\n#vcursor { position: fixed; left: 0; top: 0; width: ${SIZE}px; height: ${SIZE}px; pointer-events: none; z-index: 2147483647; background: no-repeat 0 0 / ${SIZE}px ${SIZE}px; }`
    + '\n#vcursor[hidden] { display: none; }';
  document.head.append(style);
  const drawn = document.createElement('div');
  drawn.id = 'vcursor'; drawn.hidden = true; drawn.setAttribute('aria-hidden', 'true');
  document.body.append(drawn);

  const captured = () => locked || sim;
  const wants = () => !suspended && !!playing() && (mode === 'always' || (mode === 'fullscreen' && !!document.fullscreenElement));
  const target = () => document.elementFromPoint(x, y) ?? document.documentElement;
  const off = (el) => !!el?.closest?.(':disabled');

  function capture() {
    if (locked || !view.requestPointerLock || !playing()) return;
    try { view.requestPointerLock()?.catch?.(() => {}); } catch {}
  }
  function release(byUser) {
    if (byUser) suspended = true;
    if (sim) { sim = false; switched(false); }
    if (locked) { releasing = true; document.exitPointerLock?.(); }
  }
  function switched(on) {
    if (on) where = 'in';
    else { mark(hovered, false); where = 'none'; }
    hovered = null; buttons = 0; pressed = []; slider = null; sprite = '';
    drawn.hidden = !on;
    preferences();
    draw();
  }
  function preferences() {
    if (captureButton) {
      captureButton.textContent = `Capture mouse: ${LABELS[mode]}`;
      captureButton.setAttribute('aria-pressed', String(mode !== 'off'));
    }
    captureNow?.setAttribute('aria-pressed', String(captured()));
  }

  // A cursor that leaves the window is pinned to the border where it crossed: the side the event says it went, or
  // the way it was last moving. Only coming back in, a blur or a hidden tab ends the push.
  function leave(ex, ey) {
    if (where !== 'in') return;
    const W = innerWidth, H = innerHeight, inside = ex >= 0 && ey >= 0 && ex < W && ey < H;
    const dx = inside ? vel.x : ex - x, dy = inside ? vel.y : ey - y;
    let px = x, py = y;
    if (dx || dy) {
      let t = Infinity;
      if (dx > 0) t = (W - 1 - x) / dx; else if (dx < 0) t = -x / dx;
      if (dy > 0) t = Math.min(t, (H - 1 - y) / dy); else if (dy < 0) t = Math.min(t, -y / dy);
      px = x + dx * t; py = y + dy * t;
    }
    px = clamp(px, 0, W - 1); py = clamp(py, 0, H - 1);
    const d = [px, W - 1 - px, py, H - 1 - py], m = Math.min(...d);
    if (m > 0.5) { if (m === d[0]) px = 0; else if (m === d[1]) px = W - 1; else if (m === d[2]) py = 0; else py = H - 1; }
    x = px; y = py; where = 'out'; over = null;
  }
  // The free mouse: watch, never interfere.
  function observe(e) {
    const type = e.type;
    if (type === 'mouseout') { if (!e.relatedTarget) leave(e.clientX, e.clientY); return; }
    if (type !== 'mousemove' && type !== 'mouseover' && type !== 'mousedown' && type !== 'mouseup') return;
    const ex = e.clientX, ey = e.clientY;
    buttons = e.buttons;
    if (type === 'mousemove' && real && Math.abs(e.movementX) >= 2) {
      const r = (ex - real.x) / e.movementX;
      if (r > 0.2 && r < 5) ratio += (r - ratio) * 0.1;
    }
    real = { x: ex, y: ey };
    if (type === 'mousedown') focused = true;
    else if (!focused && document.hasFocus()) focused = true;
    if (ex < 0 || ey < 0 || ex >= innerWidth || ey >= innerHeight) { leave(ex, ey); return; } // a drag held past the edge
    if (type === 'mousemove' && where === 'in' && (ex !== x || ey !== y)) vel = { x: ex - x, y: ey - y };
    else if (where !== 'in') vel = { x: 0, y: 0 };
    x = ex; y = ey; where = 'in'; over = e.target;
    if (type === 'mousedown' && e.target === view && wants()) capture();
  }

  // ---- captured: the drawn cursor ----
  function send(t, type, e, related = null, extra = {}) {
    const init = { bubbles: true, cancelable: true, composed: true, view: window, detail: 0,
      clientX: x, clientY: y, screenX: window.screenX + x, screenY: window.screenY + y,
      button: e?.button ?? 0, buttons, ctrlKey: !!e?.ctrlKey, shiftKey: !!e?.shiftKey, altKey: !!e?.altKey, metaKey: !!e?.metaKey,
      relatedTarget: related, ...extra };
    const ev = type.startsWith('pointer') ? new PointerEvent(type, { pointerId: 1, pointerType: 'mouse', isPrimary: true, width: 1, height: 1, pressure: buttons ? 0.5 : 0, ...init })
      : type === 'wheel' ? new WheelEvent(type, { ...init, deltaX: e.deltaX, deltaY: e.deltaY, deltaZ: e.deltaZ, deltaMode: e.deltaMode })
      : new MouseEvent(type, init);
    return t.dispatchEvent(ev);
  }
  // :hover cannot be set from script, so buttons under the drawn cursor get .vhover (index.html, alerts.css)
  const mark = (el, on) => el?.closest?.('button, .alert')?.classList.toggle('vhover', on);
  function hover(t, e) {
    over = t;
    if (t === hovered) return;
    const old = hovered; hovered = t;
    mark(old, false); mark(t, true);
    if (old?.isConnected) { send(old, 'pointerout', e, t, { button: -1 }); send(old, 'mouseout', e, t); }
    send(t, 'pointerover', e, old, { button: -1 }); send(t, 'mouseover', e, old);
  }
  function slide() {
    const r = slider.getBoundingClientRect(), min = +slider.min || 0, max = slider.max === '' ? 100 : +slider.max, step = +slider.step || 1;
    const v = min + Math.round(clamp((x - r.left) / (r.width || 1), 0, 1) * (max - min) / step) * step;
    if (+slider.value !== v) { slider.value = String(v); slider.dispatchEvent(new Event('input', { bubbles: true })); }
  }
  function moveBy(dx, dy, e) {
    x = clamp(x + dx, 0, innerWidth - 1); y = clamp(y + dy, 0, innerHeight - 1); where = 'in';
    const t = target();
    hover(t, e);
    send(t, 'pointermove', e, null, { button: -1, movementX: dx, movementY: dy });
    send(t, 'mousemove', e, null, { button: 0, movementX: dx, movementY: dy });
    if (slider) slide();
    draw();
  }
  function press(e) {
    buttons = e.buttons; focused = true;
    const t = target(), now = performance.now();
    hover(t, e);
    // a second press on the same spot within 500 ms, or within the system's double-click time (the browser's own count
    // in e.detail); the spot is checked here because the browser's position is frozen while locked
    const again = e.button === clicks.button && Math.hypot(x - clicks.x, y - clicks.y) < 6 && (now - clicks.t < 500 || e.detail > 1);
    clicks = again ? { ...clicks, n: clicks.n + 1, t: now } : { n: 1, t: now, x, y, button: e.button };
    pressed[e.button] = t;
    if (off(t)) return;
    if (send(t, 'pointerdown', e)) send(t, 'mousedown', e, null, { detail: clicks.n });
    if (e.button === 0 && t.matches?.('input[type=range]')) { slider = t; slide(); }
  }
  function lift(e) {
    buttons = e.buttons;
    const t = target(), from = pressed[e.button];
    pressed[e.button] = null;
    if (!off(t)) { send(t, 'pointerup', e); send(t, 'mouseup', e, null, { detail: clicks.n }); }
    // the click lands on the nearest element holding both the press and the release, as in a browser
    let common = from;
    while (common && !common.contains(t)) common = common.parentNode;
    if (common?.nodeType === 1 && !off(common)) {
      if (e.button === 0) { send(common, 'click', e, null, { detail: clicks.n }); if (clicks.n === 2) send(common, 'dblclick', e, null, { detail: 2 }); }
      else send(common, 'auxclick', e, null, { detail: clicks.n });
    }
    if (e.button === 0 && slider) { slider.dispatchEvent(new Event('change', { bubbles: true })); slider = null; }
  }
  function intercept(e) {
    e.stopImmediatePropagation();
    if (e.cancelable && (e.type === 'wheel' || e.type === 'contextmenu')) e.preventDefault();
    // the real buttons, so a box drag whose press turned the capture on keeps its held button (main.js drops a drag
    // on a move without it)
    if (typeof e.buttons === 'number') buttons = e.buttons;
    const was = real;
    if (e.type.startsWith('mouse')) real = { x: e.clientX, y: e.clientY };
    if (e.type === 'mousemove') {
      // locked: movementX scaled to CSS px; simulated (debug): how far the real pointer moved
      if (sim) moveBy(was ? e.clientX - was.x : 0, was ? e.clientY - was.y : 0, e);
      else moveBy(e.movementX * ratio, e.movementY * ratio, e);
    } else if (e.type === 'mousedown') press(e);
    else if (e.type === 'mouseup') lift(e);
    else if (e.type === 'wheel') send(target(), 'wheel', e);
  }
  function draw() {
    if (!captured()) return;
    // a panel that appears or vanishes under a still cursor changes what it is over, as a browser's own hover does
    const t = target();
    if (t !== hovered) hover(t, null);
    let name = edgeDir;
    if (!name) { const c = hovered ? getComputedStyle(hovered).cursor : ''; name = /crosshair|cell/.test(c) ? 'cross' : 'arrow'; }
    const s = SPRITES[name];
    if (sprite !== name) { sprite = name; drawn.style.backgroundImage = s.url; }
    drawn.style.transform = `translate(${x - s.x}px, ${y - s.y}px)`;
  }

  for (const type of MOUSE) addEventListener(type, (e) => { if (e.isTrusted) (captured() ? intercept : observe)(e); }, { capture: true, passive: false });
  addEventListener('blur', () => { focused = false; where = 'none'; buttons = 0; });
  addEventListener('focus', () => { focused = true; });
  addEventListener('keydown', () => { focused = true; }, { capture: true });
  document.addEventListener('visibilitychange', () => { if (document.hidden) where = 'none'; });
  addEventListener('resize', () => { x = clamp(x, 0, innerWidth - 1); y = clamp(y, 0, innerHeight - 1); });
  document.addEventListener('pointerlockchange', () => {
    const on = !!document.pointerLockElement;
    if (on === locked) return;
    locked = on;
    // Esc (the browser's unlock) keeps the mouse free until the player asks again, or the next match or fullscreen
    if (!on && !releasing && !document.hidden && document.hasFocus()) suspended = true;
    releasing = false;
    if (!sim) switched(on);
  });
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && mode === 'fullscreen' && locked) release(false);
  });
  if (captureButton) captureButton.onclick = () => {
    mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
    tryStore(() => localStorage.setItem('ww2-capture', mode));
    if (mode === 'off') release(false); else { suspended = false; if (wants()) capture(); }
    preferences();
  };
  // blurred so Space or Enter later does not press it again (a press while captured does not move focus)
  if (captureNow) captureNow.onclick = () => { captureNow.blur(); if (captured()) release(true); else { suspended = false; capture(); } };
  preferences();

  return {
    get x() { return x; }, get y() { return y; }, get buttons() { return buttons; }, get locked() { return captured(); },
    // edge scrolling may run: the window has focus, the tab shows, and the cursor is known to be in or past an edge
    get active() { return focused && !document.hidden && where !== 'none'; },
    get out() { return where === 'out'; },
    // over the battlefield (or past the window edge), not a HUD panel
    get overView() { return where === 'out' || over === view; },
    // camera.js reports the edge push every frame; null when there is none
    frame(dir) {
      if (dir !== edgeDir) {
        edgeDir = dir;
        if (dir) document.documentElement.dataset.edge = dir; else delete document.documentElement.dataset.edge;
      }
      const now = !!playing();
      if (now && !wasPlaying) suspended = false; // a new match: Capture mouse may engage again
      wasPlaying = now;
      if (captured() && !now) release(false);
      draw();
    },
    // call from the fullscreen button before requestFullscreen, which uses up the click's activation
    beforeFullscreen() { if (!document.fullscreenElement && mode !== 'off') { suspended = false; capture(); } },
    release() { release(false); },
    // debug: a captured mouse without pointer lock, moved by the real pointer's motion or by move(dx, dy)
    simulate(on = true) { on = !!on; if (on === sim) return; sim = on; if (!locked) switched(on); },
    move(dx, dy) { if (captured()) moveBy(dx, dy, null); },
    get state() {
      return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, where, focused, locked, sim, suspended, mode, ratio: Math.round(ratio * 100) / 100,
        edge: edgeDir, over: over ? over.id || over.tagName : null, sprite: captured() ? sprite : null };
    },
  };
}
