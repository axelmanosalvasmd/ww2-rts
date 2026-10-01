// Weather on screen: the lobby's Weather select, one quiet line under the score strip, and the sight multiplier the
// fog overlay uses. The server decides the weather and what it does (shared/weather.js); this only shows it.
// main.js calls lobby() from renderLobby, mapDefault() from the map preview, start() and snapshot() during a match.
import { UNITS } from '/shared/sim.js';
import { WEATHER, WEATHER_CHOICES, mapWeather, weatherEffects } from '/shared/weather.js';

const LABEL = { map: 'Map default', clear: 'Clear', fog: 'Ground fog', rain: 'Rain', mud: 'Mud', snow: 'Snow', random: 'Random' };
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const said = (kind) => `${WEATHER[kind].name}: ${weatherEffects(kind).join(', ') || 'no effect'}`;
// a plan in a few words: "Snow", "Ground fog, lifts at 4:00"; short enough for the select: "Fog until 4:00"
const planText = (p) => WEATHER[p.now].name + (p.next ? `, ${p.next === 'clear' ? 'lifts' : `turns to ${WEATHER[p.next].name.toLowerCase()}`} at ${clock(p.at)}` : '');
const planShort = (p) => (p.next ? `${p.now === 'fog' ? 'Fog' : WEATHER[p.now].name} until ${clock(p.at)}` : WEATHER[p.now].name);
// the warning line's tail: "Fog lifts in 8 s", "Mud in 8 s"
const turnText = (now, next, s) => (next === 'clear' ? `${now === 'fog' ? 'Fog lifts' : 'Clearing'} in ${s} s` : `${WEATHER[next].name} in ${s} s`);

export function createWeatherView({ sendCmd }) {
  const $ = (id) => document.getElementById(id);
  const sel = $('weatherSel');
  let mapPlan = null, row = ['clear'], line = null, shown = '', atmos = null;
  if (sel) {
    sel.innerHTML = WEATHER_CHOICES.map(k => `<option value="${k}">${LABEL[k]}</option>`).join('');
    sel.onchange = () => sendCmd({ t: 'weather', v: sel.value });
  }
  // the select's tooltip spells out what the picked weather does
  function explain() {
    if (!sel) return;
    const v = sel.value;
    sel.title = v === 'random' ? 'Picked when the match starts. Fog may lift or rain may turn to mud partway through'
      : v === 'map' ? (mapPlan ? `${said(mapPlan.now)}${mapPlan.next ? `. ${planText(mapPlan)}` : ''}` : 'The weather this map brings')
        : said(v);
  }

  return {
    lobby(m, canEdit) {
      if (!sel) return;
      sel.value = WEATHER_CHOICES.includes(m.weather) ? m.weather : 'map';
      sel.disabled = !canEdit;
      explain();
    },
    // the Map default option names the map's own weather
    mapDefault(map, key) {
      if (!sel) return;
      mapPlan = mapWeather(map, key);
      sel.options[0].textContent = `Map default: ${planShort(mapPlan)}`;
      explain();
    },
    start(r, a) { row = Array.isArray(r) ? r : ['clear']; atmos = a; shown = ''; atmos?.setWeather(row); },
    // the line under the score strip, re-added when the HUD rebuilds the strip
    snapshot(s) {
      if (!Array.isArray(s.weather)) return;
      if (s.weather[0] !== row[0] || s.weather[1] !== row[1]) atmos?.setWeather(s.weather);
      row = s.weather;
      const strip = $('scores');
      if (!strip) return;
      if (!line || line.parentNode !== strip) {
        line = line ?? Object.assign(document.createElement('p'), { className: 'sc-wx' });
        strip.appendChild(line);
      }
      const [now, next, left] = row, text = next ? `${said(now)}. ${turnText(now, next, left)}` : said(now);
      if (text !== shown) {
        shown = text; line.textContent = text;
        line.classList.toggle('turning', !!next);
        line.title = next ? `Then ${said(next)}` : 'Weather for this match. Planes and recon flights fly above it';
      }
    },
    // how far a unit of this type sees in the current weather (the fog overlay's circles)
    sight(type) { return UNITS[type]?.air ? 1 : WEATHER[row[0]]?.sight ?? 1; },
    get now() { return row[0]; },
  };
}
