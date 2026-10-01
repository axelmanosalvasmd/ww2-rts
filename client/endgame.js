// Match state uses public scores and the receiving player's snapshot only.
import { CFG, TICK, winVp } from '/shared/sim.js';

const RATE_WINDOW = 8, RATE_MIN = 2, NOTICE_LIFE = 6;
const COLORS = ['Blue', 'Red', 'Chalk', 'Orange', 'Violet', 'Cyan'];
const now = () => performance.now() / 1000;
const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const write = (el, value) => { if (el && el.textContent !== value) el.textContent = value; };

let hooks = null, strip = null, rateEl = null, bonusEl = null, noticeEl = null, outEl = null;
let samples = [], leader = null, suddenDeath = false, lastKind = null, lastTick = null;
let notice = '', until = 0, state = { rate: '', bonus: '', notice: '', out: false };

// main.js provides me() and teams(). The public snapshot method also accepts fabricated snapshots for visual QA.
function init(h) {
  hooks = h;
  if (!document.getElementById('endgame-css')) {
    const css = document.createElement('link'); css.id = 'endgame-css'; css.rel = 'stylesheet'; css.href = '/client/endgame.css';
    document.head.append(css);
  }
  const top = document.getElementById('top');
  if (!top) return;
  strip = document.getElementById('match-strip');
  if (!strip) {
    strip = document.createElement('div'); strip.id = 'match-strip';
    strip.innerHTML = '<span class="match-rate"></span><span class="match-bonus"></span><span class="match-notice" aria-live="polite"></span>';
    document.getElementById('scores').after(strip);
  }
  rateEl = strip.querySelector('.match-rate'); bonusEl = strip.querySelector('.match-bonus'); noticeEl = strip.querySelector('.match-notice');
  outEl = document.getElementById('eliminated-banner');
  if (!outEl) {
    outEl = document.createElement('div'); outEl.id = 'eliminated-banner'; outEl.setAttribute('role', 'status'); strip.after(outEl);
  }
  reset();
}

function reset() {
  samples = []; leader = null; suddenDeath = false; lastKind = null; lastTick = null; notice = ''; until = 0;
  state = { rate: '', bonus: '', notice: '', out: false };
  render();
}

function render() {
  write(rateEl, state.rate); write(bonusEl, state.bonus); write(noticeEl, state.notice);
  write(outEl, state.out ? "You are out. Watching with your team's vision" : '');
  if (strip) strip.hidden = !(state.rate || state.bonus || state.notice);
  if (outEl) outEl.hidden = !state.out;
}

function announce(text) { notice = text; until = now() + NOTICE_LIFE; }

function snapshot(s) {
  if (!hooks) return;
  const kind = s.mode?.kind ?? 'conquest', teams = hooks.teams(), me = hooks.me();
  if (kind !== lastKind || (lastTick !== null && s.tick < lastTick)) reset();
  lastKind = kind; lastTick = s.tick;
  state.rate = ''; state.bonus = ''; state.out = !!s.out?.[me] && s.winner == null;
  if (s.winner != null) { notice = ''; state.notice = ''; render(); return; }
  if (kind === 'conquest') {
    const ids = [...new Set(teams)], totals = new Map(ids.map(t => [t, teams.reduce((n, team, slot) => n + (team === t ? s.vp?.[slot] ?? 0 : 0), 0)]));
    const teamName = (t) => hooks.teamName?.(t) ?? COLORS[teams.indexOf(t)] ?? `Team ${t + 1}`;
    const highest = Math.max(0, ...totals.values()), leaders = ids.filter(t => totals.get(t) === highest);
    const leading = leaders.length === 1 ? leaders[0] : null;
    if (leading !== null) {
      if (leader !== null && leader !== leading) announce(`${teamName(leading)} takes the lead`);
      leader = leading;
    }
    const seconds = s.tick * TICK;
    samples.push({ seconds, totals });
    while (samples.length > 1 && samples[1].seconds <= seconds - RATE_WINDOW) samples.shift();
    const first = samples[0], elapsed = seconds - first.seconds;
    if (leading !== null) {
      const rate = elapsed >= RATE_MIN ? Math.max(0, totals.get(leading) - first.totals.get(leading)) / elapsed : 0;
      const left = Math.max(0, winVp(teams) - highest);
      if (rate > 0) {
        const eta = Math.ceil(left / rate);
        state.rate = eta > 3599 ? `${teamName(leading)} leads, victory is over an hour away at this rate`
          : `${teamName(leading)} wins in ${clock(eta)} at this rate`;
      } else state.rate = `${teamName(leading)} leads. ${elapsed >= RATE_MIN ? 'No VP gain at this rate' : 'Measuring victory rate'}`;
    } else state.rate = 'Scores tied';
    const myTeam = teams[me], trailing = ids.filter(t => totals.get(t) < highest);
    const bonusTeam = trailing.includes(myTeam) ? myTeam : trailing.sort((a, b) => totals.get(a) - totals.get(b))[0];
    if (bonusTeam !== undefined) {
      const income = s.army?.income ?? CFG.armies.standard.income;
      const bonus = Math.min(CFG.catchupMax, (highest - totals.get(bonusTeam)) / CFG.catchupPer) * income;
      // This is per player, matching the income calculation in step().
      if (bonus > 0 && !(bonusTeam === myTeam && s.online?.[me] === false)) state.bonus = `${teamName(bonusTeam)} catch-up +${bonus < 0.1 ? '<0.1' : bonus.toFixed(1)} MP/s each`;
    }
  } else if (kind === 'assault' && s.mode.timeLeft <= 60) {
    const left = Math.max(0, Math.ceil(s.mode.timeLeft));
    state.rate = `Assault ends in ${clock(left)}`;
  }
  if (s.mode?.suddenDeath) {
    if (!suddenDeath) announce('Sudden Death begins. Production has stopped');
    suddenDeath = true;
    state.rate = 'Sudden Death: Production Buildings are crumbling';
  }
  state.notice = now() < until ? notice : '';
  render();
}

function frame() {
  if (!state.notice || now() < until) return;
  state.notice = ''; notice = ''; render();
}

export const endgame = { init, snapshot, frame, reset, get state() { return { ...state }; } };
