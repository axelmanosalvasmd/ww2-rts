// Graphics quality, 'high' or 'low', saved per browser. Low turns off the far-edge blur and screen shake and uses
// cheaper shadows and fewer particles. High is the default; watchFps() drops to Low once (with a notice) when the game
// runs under 45 fps for 5 seconds.
const KEY = 'ww2-gfx', AUTO_KEY = 'ww2-gfx-auto';
const store = (fn) => { try { return fn(); } catch { return null; } };
const subs = new Set();
let level = store(() => localStorage.getItem(KEY)) === 'low' ? 'low' : 'high';

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
  // fn(level) runs whenever the setting changes; returns an unsubscribe function
  onChange(fn) { subs.add(fn); return () => subs.delete(fn); },
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
