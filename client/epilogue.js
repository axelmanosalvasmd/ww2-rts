// The end of a match on screen. The server holds the ending for 6 s (the sim at half speed, orders refused, the fog
// lifted for everyone) before the lobby comes back with the report. Over those seconds the client slows the picture
// further (unit movement and effects at about a third of their speed), glides the camera to where the match was
// decided and stamps the outcome on the screen. main.js calls snapshot() for every snapshot, frame() once per frame,
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
};
const why = (reason, outcome) => (outcome === 'draw' ? 'No side is left standing.' : WHY[reason]?.[outcome] ?? '');

let end = null, stampEl = null, styled = false;
const smooth = (t) => t * t * (3 - 2 * t);

function stamp(outcome, text) {
  if (!styled) {
    styled = true;
    const st = document.createElement('style');
    st.textContent = `
      #epStamp { position: fixed; left: 50%; top: 30%; z-index: 9; pointer-events: none; padding: 14px 36px 16px; text-align: center;
        color: var(--ink, #2b2418); background: linear-gradient(180deg, rgba(255, 255, 255, 0.16), rgba(0, 0, 0, 0.06)), var(--manila, #d8c69a);
        border: 3px solid currentColor; outline: 1px solid var(--manila-edge, #a08c5f); outline-offset: 4px; box-shadow: 0 12px 44px rgba(0, 0, 0, 0.55);
        transform: translate(-50%, -50%) rotate(-3deg); animation: epStamp 0.45s cubic-bezier(0.2, 0.9, 0.3, 1.15) both; }
      #epStamp.defeat { color: var(--red, #b8322a); }
      #epStamp .word { font: 700 76px/1 var(--stencil, 'Stardos Stencil', Impact, sans-serif); letter-spacing: 0.05em; }
      #epStamp .why { max-width: 440px; margin-top: 8px; font: 400 17px/1.3 var(--type, 'Courier Prime', 'Courier New', monospace); color: var(--ink, #2b2418); }
      @keyframes epStamp { from { opacity: 0; transform: translate(-50%, -50%) rotate(-3deg) scale(1.7); } to { opacity: 1; transform: translate(-50%, -50%) rotate(-3deg) scale(1); } }`;
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
    stamp(outcome, why(s.end.reason, outcome));
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
