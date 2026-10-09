import { t as tr } from './i18n.js';

export function createFeedback(hint, errorSound) {
  let timer, saved = '', message = '';
  const clear = () => { clearTimeout(timer); timer = null; };
  return {
    show(reason) {
      if (!timer) saved = hint.textContent;
      clear(); message = tr(reason); hint.textContent = message; errorSound();
      timer = setTimeout(() => { if (hint.textContent === message) hint.textContent = saved; timer = null; }, 2000);
    },
    reset() { clear(); saved = ''; },
  };
}

// Greyed actions remain focusable and clickable so a click can explain the reason.
export function setAvailability(button, result) {
  button.disabled = false;
  button.setAttribute('aria-disabled', String(!result.ok));
  button._availability = result;
  button._baseTip ??= button._tooltip ?? button.title;
  button._tooltip = result.ok ? button._baseTip : result.reason;
  if (!button._tipActive) button.title = button._tooltip;
}

export function installTooltips(root) {
  const style = document.createElement('style');
  style.textContent = `#hud button[aria-disabled="true"] { opacity: .48; cursor: pointer; }
    #commandTooltip { position: fixed; z-index: 20; max-width: min(340px, calc(100vw - 16px)); padding: 6px 10px;
      background: rgba(25, 28, 30, 0.97); color: #e2dfd3; border: 1px solid rgba(176, 164, 122, 0.46); border-radius: 2px;
      font: 500 14px/1.35 'Barlow Semi Condensed', 'Arial Narrow', sans-serif; pointer-events: none; }
    #hint { max-width: calc(var(--vw, 100vw) - 32px); white-space: normal; text-align: center; background: rgba(25, 28, 30, 0.96); }`;
  document.head.append(style);
  const tip = document.createElement('div'); tip.id = 'commandTooltip'; tip.role = 'tooltip'; tip.hidden = true; document.body.append(tip);
  let active;
  const hide = () => {
    if (active) { active.removeAttribute('aria-describedby'); active._tipActive = false; active.title = active._tooltip; }
    active = null; tip.hidden = true;
  };
  const update = () => {
    if (!active?.isConnected || !active._tooltip || root.classList.contains('hidden')) return hide();
    tip.textContent = active._tooltip; tip.hidden = false;
    const r = active.getBoundingClientRect(), t = tip.getBoundingClientRect();
    tip.style.left = `${Math.max(8, Math.min(innerWidth - t.width - 8, r.left + r.width / 2 - t.width / 2))}px`;
    const above = r.top - t.height - 6, top = above >= 8 ? above : r.bottom + 6;
    tip.style.top = `${Math.max(8, Math.min(innerHeight - t.height - 8, top))}px`;
  };
  const enter = (e) => {
    const b = e.target.closest('button'); if (!b || !(b._tooltip || b.title)) return;
    if (b === active) return;
    hide(); active = b; b._tooltip ??= b.title; b._tipActive = true;
    b.removeAttribute('title'); b.setAttribute('aria-describedby', tip.id); update();
  };
  root.addEventListener('pointerover', enter); root.addEventListener('focusin', enter);
  root.addEventListener('pointerout', (e) => { if (active && !active.contains(e.relatedTarget)) hide(); });
  root.addEventListener('focusout', hide); root.addEventListener('pointerdown', hide);
  addEventListener('resize', hide);
  return { update };
}
