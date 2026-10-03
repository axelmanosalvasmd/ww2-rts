// Language option (English or Spanish). The game code keeps writing English; in Spanish this module rewrites what
// reaches the page: text, tooltips and labels, through a MutationObserver, plus the few canvas labels that call t().
// The dictionary (client/es.js) is keyed by the English text. A key with {0}, {1}... is a pattern: each hole matches
// any text, which is translated in turn, so 'Enemy {0} incoming' also translates the unit name it carries.
// ponytail: whole-text matching only; a text the dictionary misses stays English. /?i18n=log lists misses in
// window.i18nMisses so they can be added.
import ES from './es.js';

// a real page, not Node or a test's stand-in document
const page = !!globalThis.document?.documentElement && typeof MutationObserver === 'function';
const KEY = 'ww2rts-lang';
const stored = (() => { try { return localStorage.getItem(KEY); } catch { return null; } })();
export const lang = stored === 'es' || stored === 'en' ? stored
  : page && navigator.language?.startsWith('es') ? 'es' : 'en'; // tests stay English whatever the machine
export function setLang(l) { try { localStorage.setItem(KEY, l); } catch { /* private window: this page only */ } location.reload(); }

// a hole never spans a sentence break: a longer text is split into sentences instead (see core)
const HOLE = '((?:(?![.!?] ).)+?)';
const exact = new Map(), patterns = [];
for (const [en, es] of Object.entries(ES)) {
  if (!/\{\d\}/.test(en)) { exact.set(en, es); continue; }
  const order = [];
  const src = en.replace(/[.*+?^$()|[\]\\]/g, '\\$&') // a hole before % is a number, so 'Training {0} {1}%' splits right
    .replace(/\{(\d)\}(%?)/g, (_, n, pc) => (order.push(+n), pc ? '([\\d.,]+)%' : HOLE));
  patterns.push({ re: new RegExp(`^${src}$`, 's'), order, es, lit: en.replace(/\{\d\}/g, '').length });
}
patterns.sort((a, b) => b.lit - a.lit); // the most specific pattern first

const memo = new Map();
const log = /[?&]i18n=log\b/.test(globalThis.location?.search ?? '');
if (log) window.i18nMisses = new Set();

function core(s) {
  const hit = exact.get(s) ?? (/[.!?]$/.test(s) ? exact.get(s.slice(0, -1)) : undefined); // with or without its full stop
  if (hit !== undefined) return hit === exact.get(s) ? hit : hit + s.slice(-1);
  for (const p of patterns) {
    const m = p.re.exec(s);
    if (!m) continue;
    const args = [];
    p.order.forEach((n, i) => { args[n] = spanish(m[i + 1]); });
    return typeof p.es === 'function' ? p.es(...args) : p.es.replace(/\{(\d)\}/g, (_, n) => args[n] ?? '');
  }
  // texts the game glues together (a name, its hotkey, a description, a cost): sentence by sentence, then around
  // the first ': ' or ' · ', then a trailing (hotkey)
  let m = /^(.+?[.!?]) (\S.*)$/s.exec(s);
  if (m) return spanish(m[1]) + ' ' + spanish(m[2]);
  m = /^(.+?)(: | · )(.+)$/s.exec(s);
  if (m) return spanish(m[1]) + m[2] + spanish(m[3]);
  m = /^(.+) \(([^()]+)\)$/s.exec(s);
  if (m) return spanish(m[1]) + ' (' + spanish(m[2]) + ')';
  if (log && /[a-z]{2}/.test(s)) window.i18nMisses.add(s);
  return s;
}

// translate one string to the chosen language, keeping its surrounding whitespace
export const t = (s) => (lang === 'es' ? spanish(s) : s);
export function spanish(s) {
  if (typeof s !== 'string' || !/[A-Za-z]/.test(s)) return s;
  let out = memo.get(s);
  if (out === undefined) {
    const [, pre, body, post] = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
    out = pre + core(body) + post;
    if (memo.size > 20000) memo.clear(); // ponytail: crude bound, numbers in live texts keep minting new strings
    memo.set(s, out); memo.set(out, out); // our own Spanish comes back through the observer: leave it be
  }
  return out;
}

const ATTRS = ['title', 'aria-label', 'placeholder'];
function attrs(el) {
  for (const a of ATTRS) { const v = el.getAttribute(a); if (v) { const w = t(v); if (w !== v) el.setAttribute(a, w); } }
}
function node(n) {
  if (n.nodeType === 3) {
    const p = n.parentNode?.nodeName;
    if (p === 'SCRIPT' || p === 'STYLE') return;
    const v = t(n.nodeValue);
    if (v !== n.nodeValue) n.nodeValue = v;
  } else if (n.nodeType === 1) {
    attrs(n);
    if (n.nodeName !== 'SCRIPT' && n.nodeName !== 'STYLE') for (let c = n.firstChild; c; c = c.nextSibling) node(c);
  }
}

if (lang === 'es' && page) {
  document.documentElement.lang = 'es';
  document.title = t(document.title);
  const start = () => {
    node(document.body);
    new MutationObserver((list) => {
      for (const r of list) {
        if (r.type === 'childList') r.addedNodes.forEach(node);
        else if (r.type === 'attributes') attrs(r.target);
        else node(r.target);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  };
  if (document.body) start(); else addEventListener('DOMContentLoaded', start);
}

// the English / Español picker: a <select id="langSel"> on the page
const sel = page && document.getElementById('langSel');
if (sel) {
  sel.innerHTML = '<option value="en">English</option><option value="es">Español</option>';
  sel.value = lang;
  sel.addEventListener('change', () => setLang(sel.value));
}
