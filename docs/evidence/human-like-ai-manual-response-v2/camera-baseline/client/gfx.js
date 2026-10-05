// Graphics quality, 'high' or 'low', saved per browser. Low turns off screen shake, cloud shadows, weather and birds,
// and uses cheaper shadows and fewer particles. High is the default; watchFps() drops to Low once (with a notice) when
// the game runs under 45 fps for 5 seconds.
const KEY = 'ww2-gfx', AUTO_KEY = 'ww2-gfx-auto';
const store = (fn) => { try { return fn(); } catch { return null; } };
const subs = new Set();
const goreSubs = new Set();
let level = store(() => localStorage.getItem(KEY)) === 'low' ? 'low' : 'high';
const GORE_KEY = 'ww2-gore';
let gore = store(() => localStorage.getItem(GORE_KEY)) !== 'off';

export const gfx = {
  get level() { return level; },
  get low() { return level === 'low'; },
  set(l) {
    const next = l === 'low' ? 'low' : 'high';
    if (next === level) return;
    level = next;
    store(() => localStorage.setItem(KEY, level));
    subs.forEach((fn) => fn(level));
  },
  // blood and torn bodies when men die in a blast (client/fx.js gore); bodies are thrown either way. On by default.
  get gore() { return gore; },
  setGore(on) {
    const next = !!on;
    if (next === gore) return;
    gore = next;
    store(() => localStorage.setItem(GORE_KEY, gore ? 'on' : 'off'));
    goreSubs.forEach((fn) => fn(gore));
  },
  // Quality changes rebuild terrain and materials. Gore changes only notify their own listeners.
  onChange(fn) { subs.add(fn); return () => subs.delete(fn); },
  onGoreChange(fn) { goreSubs.add(fn); return () => goreSubs.delete(fn); },
};

// Call once per rendered frame with the frame time in seconds. onDrop(message) runs if it switched to Low by itself.
let slowFor = 0;
export function watchFps(dt, onDrop) {
  if (level === 'low' || store(() => localStorage.getItem(AUTO_KEY))) return;
  slowFor = dt > 1 / 45 ? slowFor + dt : Math.max(0, slowFor - dt * 2);
  if (slowFor < 5) return;
  store(() => localStorage.setItem(AUTO_KEY, '1'));
  gfx.set('low');
  onDrop?.('Graphics set to Low to keep the game smooth. Change it in the menu.');
}
