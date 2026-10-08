// The end of a match on screen. The server holds the ending for 6 s (the sim at half speed, orders refused, the fog
// lifted for everyone) before the lobby comes back with the report. Over those seconds the client slows the picture
// further (unit movement and effects at about a third of their speed), glides the camera to where the match was
// decided and shows the outcome on the screen. main.js calls snapshot() for every snapshot, frame() once per frame,
// active() when it draws the fog, and reset() when a match starts or the lobby shows.
import { audio } from './audio.js';

const SLOW = 0.35; // how fast time runs on screen once the match is decided
const EASE_IN = 0.6; // seconds to slow down to that
const GLIDE = 2.2; // seconds for the camera to reach the decisive spot
const VIEW = 70; // how far the camera pulls back (or in) to show that spot

const WORD = { victory: 'Victory', defeat: 'Defeat', draw: 'Draw' };
// why it ended, by the reason the server sends (snapshot.end.reason) and how it ended for this player
const WHY = {
  vp: { victory: 'Your side reached the victory points first.', defeat: 'The enemy reached the victory points first.' },
  bunkers: { victory: 'Your bunkers are the last ones standing.', defeat: "The enemy's bunkers are the last ones standing." },
  structures: { victory: 'Every defending structure has fallen.', defeat: 'Every structure you defended has fallen.' },
  timer: { victory: 'The defenses held until the clock ran out.', defeat: 'The clock ran out before the defenses fell.' },
  hq: { victory: 'Your side has the last Production Buildings standing.', defeat: 'The enemy has the last Production Buildings standing.' },
  tutorial: { victory: 'The bridge is ours. Training complete: you are ready for a real match.' },
};
const why = (reason, outcome) => (outcome === 'draw' ? 'No side is left standing.' : WHY[reason]?.[outcome] ?? '');

let end = null, stampEl = null, styled = false;
const smooth = (t) => t * t * (3 - 2 * t);

function stamp(outcome, text) {
  if (!styled) {
    styled = true;
    const st = document.createElement('style');
    st.textContent = `
      #epStamp { position: fixed; left: 50%; top: 30%; z-index: 9; pointer-events: none; min-width: 320px; padding: 16px 32px 18px; text-align: center;
        color: var(--brass, #d6b25e); background: rgba(25, 28, 30, 0.92); border: 1px solid var(--line, rgba(176, 164, 122, 0.46)); border-radius: 2px;
        transform: translate(-50%, -50%); animation: epStamp 0.5s ease-out both; }
      #epStamp.defeat { color: var(--red-hi, #ee8a7b); border-color: rgba(200, 72, 59, 0.8); }
      #epStamp.draw { color: var(--text, #e2dfd3); }
      #epStamp .word { font: 600 44px/1 var(--type, sans-serif); }
      #epStamp .why { max-width: 440px; margin-top: 8px; font: 500 16px/1.35 var(--type, sans-serif); color: var(--text, #e2dfd3); }
      @keyframes epStamp { from { opacity: 0; } to { opacity: 1; } }
      @media (prefers-reduced-motion: reduce) { #epStamp { animation: none; } }`;
    document.head.append(st);
  }
  stampEl = document.createElement('div');
  stampEl.id = 'epStamp';
  stampEl.className = outcome;
  stampEl.setAttribute('role', 'status');
  stampEl.innerHTML = `<div class="word"></div><div class="why"></div>`;
  stampEl.querySelector('.word').textContent = WORD[outcome];
  stampEl.querySelector('.why').textContent = text;
  document.body.append(stampEl);
}

// existing sounds only: the point-won call and the match horn for a win, the point-lost call (lower) otherwise
function sound(outcome) {
  if (outcome === 'victory') {
    audio.play('alert_point_won', null, { gain: 0.9 });
    audio.play('match_start', null, { delay: 0.7, gain: 0.8 });
  } else {
    audio.play('alert_point_lost', null, { gain: 0.9, rate: outcome === 'defeat' ? 0.85 : 1 });
    if (outcome === 'defeat') audio.play('alert_point_lost', null, { delay: 0.55, gain: 0.6, rate: 0.7 });
  }
}

export const epilogue = {
  // team: this player's team id. The first snapshot with a winner starts the ending.
  snapshot(s, team) {
    if (end || s.winner == null || !s.end) return;
    const outcome = s.winner === -1 ? 'draw' : s.winner === team ? 'victory' : 'defeat';
    end = { x: s.end.x, z: s.end.z, outcome, t: 0, start: performance.now(), from: null };
    stamp(outcome, s.mode?.kind === 'world' ? (outcome === 'draw' ? 'No side controls the continent.' : s.end.reason === 'nations' ? (outcome === 'victory' ? 'Every rival nation has fallen.' : 'Your nation has fallen.') : outcome === 'victory' ? 'Your side controls the continent.' : 'Another side controls the continent.') : s.mode?.kind === 'horde' ? `The bunker fell on wave ${s.mode.wave}.` : why(s.end.reason, outcome));
    sound(outcome);
  },
  // real seconds in, screen seconds out (slowed once the match is decided); moves the camera during the glide.
  // The glide runs on the clock, not on dt (main.js caps dt), so it takes 2.2 s even at a low frame rate.
  frame(dt, cam) {
    if (!end) return dt;
    const was = end.t;
    end.t = (performance.now() - end.start) / 1000;
    end.from ??= { x: cam.x, z: cam.z, dist: cam.dist };
    if (was < GLIDE) {
      const k = smooth(Math.min(1, end.t / GLIDE)), f = end.from;
      cam.x = f.x + (end.x - f.x) * k;
      cam.z = f.z + (end.z - f.z) * k;
      cam.dist = f.dist + (VIEW - f.dist) * k;
    }
    end.speed = 1 - (1 - SLOW) * smooth(Math.min(1, end.t / EASE_IN));
    return dt * end.speed;
  },
  // the fog stays lifted while the ending plays (the server sends every unit then)
  active() { return !!end; },
  // for checks from devtools: how fast screen time runs (1 during a match)
  speed() { return end?.speed ?? 1; },
  reset() {
    end = null;
    stampEl?.remove(); stampEl = null;
  },
};
