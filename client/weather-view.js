// Weather on screen: the lobby's Weather select and one quiet line under the score strip. The server decides the
// weather and what it does (shared/weather.js, and the living ground's showers in shared/sim.js); this only shows it.
// main.js calls lobby() from renderLobby, mapDefault() from the map preview, start() and snapshot() during a match.
import { WEATHER, WEATHER_CHOICES, mapWeather, weatherEffects } from '/shared/weather.js';

const LABEL = { map: 'Map default', clear: 'Clear', fog: 'Ground fog', rain: 'Rain', mud: 'Mud', snow: 'Snow', random: 'Random' };
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const said = (kind) => `${WEATHER[kind].name}: ${weatherEffects(kind).join(', ') || 'no effect'}`;
// the planned change in a few words, "Lifts at 4:00" (for the tooltip); the select itself is short: "Fog until 4:00"
const plannedChange = (p) => `${p.next === 'clear' ? 'Lifts' : `Turns to ${WEATHER[p.next].name.toLowerCase()}`} at ${clock(p.at)}`;
const planShort = (p) => (p.next ? `${p.now === 'fog' ? 'Fog' : WEATHER[p.now].name} until ${clock(p.at)}` : WEATHER[p.now].name);
// the warning line's tail: "Fog lifts in 8 s", "Mud in 8 s"
const turnText = (now, next, s) => (next === 'clear' ? `${now === 'fog' ? 'Fog lifts' : 'Clearing'} in ${s} s` : `${WEATHER[next].name} in ${s} s`);
// showers come and go in Clear, Fog and Mud (snapshot.wx: [rain 0-1, wet ground 0-1, ...]); Rain is one all match and
// Snow has none. Only there when it matters.
const SHOWERS = (kind) => kind !== 'snow' && !WEATHER[kind]?.rains;
const showerText = (rain, wet) => (rain > 0.3 ? 'Rain: vehicles slow off the road, fords deeper, sight shorter'
  : wet > 0.15 ? `Wet ground (${Math.round(wet * 100)}%): vehicles slow off the road` : '');
const withShowers = (kind, text) => (SHOWERS(kind) ? `${text}. Showers come and go` : text);

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
      : v === 'map' ? (mapPlan ? withShowers(mapPlan.now, `${said(mapPlan.now)}${mapPlan.next ? `. ${plannedChange(mapPlan)}` : ''}`) : 'The weather this map brings')
        : withShowers(v, said(v));
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
    // (the map editor has no match weather: leave the atmosphere on its own, so a winter map still snows there)
    start(r, a) { row = Array.isArray(r) ? r : ['clear']; atmos = a; shown = ''; if (Array.isArray(r)) atmos?.setWeather(row); },
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
      const [now, next, left] = row, base = next ? `${said(now)}. ${turnText(now, next, left)}` : said(now);
      // (Mud's soaked ground is Mud itself, so only a shower's rain is news there)
      const shower = SHOWERS(now) && Array.isArray(s.wx) ? showerText(s.wx[0], WEATHER[now]?.soaks ? 0 : s.wx[1]) : '';
      // a shower on a clear day is the whole story; on top of fog or mud it is added to it
      const text = !shower ? base : now === 'clear' && !next ? shower : `${base}. ${shower}`;
      if (text !== shown) {
        shown = text; line.textContent = text;
        line.classList.toggle('turning', !!next);
        // the whole line too, since a narrow strip cuts a long one short
        line.title = `${text}. ${next ? `Then ${said(next)}` : 'Weather for this match. Planes and recon flights fly above it'}`;
      }
    },
    get now() { return row[0]; },
  };
}
