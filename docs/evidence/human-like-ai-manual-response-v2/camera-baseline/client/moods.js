import { mapMood } from '/shared/weather.js';

// The light of every map, in one table. client/light.js applies a row (sun, sky fill, haze, exposure) and
// client/atmosphere.js adds the weather and cloud shade that go with it. Adding a look, such as golden hour for a
// map, is one more row here (selected by "mood" in the map file or ?mood=name in the URL).
//
// sunUp      sun height in degrees (the sun sits up and to the right of each player's view, shadows fall to the lower left)
// sun, sunI  sun color and strength
// top, bottom, hemiI   sky fill: color of the light from above, color bounced up from the ground, strength
// haze, hazeK   distance haze color (also the color the scene fades to), and how much closer it sits (1 = the default
//            distances, 1.4 = a thicker air)
// shadow     how dark the sun's shadows get (1 = black, lower lets the sky fill show in them)
// soft       shadow edge softness on High (1 = default)
// exposure   tone mapping exposure
// clouds     strength of the slow cloud shade over the ground
// mist       sheets of low mist over rivers (true / absent)
// weather    'snow' or 'dust' (absent = clear)
export const MOODS = {
  // A warm afternoon sun and cooler sky fill. Bright ground bounce keeps hull undersides and shaded walls readable
  // without a second light or a second shadow map. The direct sun still defines the shape.
  day: { sunUp: 42, sun: 0xffe7c9, sunI: 3.2, top: 0xc3cddd, bottom: 0x8a806b, hemiI: 1.25, haze: 0xb9bdbc, hazeK: 1, shadow: 0.95, soft: 1.6, exposure: 0.9, clouds: 0.085 },
  // Low golden sun, long warm shadows (the cinematic concept). Not used by any map yet: ?mood=golden to look at it.
  golden: { sunUp: 22, sun: 0xffb06a, sunI: 3.9, top: 0xb4b6c4, bottom: 0x7c6a54, hemiI: 1.1, haze: 0xcdb08f, hazeK: 1.15, shadow: 0.95, soft: 1.4, exposure: 0.95, clouds: 0.08 },
  dawn: { sunUp: 21, sun: 0xffd2ae, sunI: 3.3, top: 0xc4cddb, bottom: 0x8d8170, hemiI: 1.2, haze: 0xcdc9c1, hazeK: 1.35, shadow: 0.9, soft: 1.9, exposure: 1.0, clouds: 0.06, mist: true },
  overcast: { sunUp: 52, sun: 0xe9e6de, sunI: 1.9, top: 0xc3cad1, bottom: 0x89857b, hemiI: 1.5, haze: 0xa8aba6, hazeK: 1.25, shadow: 0.6, soft: 2.8, exposure: 1.0, clouds: 0.08 },
  snow: { sunUp: 30, sun: 0xeef0f5, sunI: 2.2, top: 0xd2dae4, bottom: 0x9e9a8e, hemiI: 1.45, haze: 0xb9bfc5, hazeK: 1.4, shadow: 0.65, soft: 2.4, exposure: 0.95, clouds: 0.06, weather: 'snow' },
  dust: { sunUp: 48, sun: 0xffe6bd, sunI: 3.5, top: 0xd5cdbd, bottom: 0x9a886c, hemiI: 1.25, haze: 0xcdb895, hazeK: 1.3, shadow: 0.95, soft: 1.4, exposure: 0.95, clouds: 0.085, weather: 'dust' },
};
// Filmic tone mapping: real highlights and deeper shadows than a flat curve, without the washed-out look
export const TONE = 'ACESFilmic';
export const DEFAULT_MOOD = 'day';
// Weather can choose the light unless the URL supplies an explicit mood.
export function moodFor(map, key, kind = 'clear') {
  const pick = new URLSearchParams(location.search).get('mood');
  if (MOODS[pick]) return pick;
  if (kind === 'snow') return 'snow';
  if (kind === 'rain' || kind === 'mud') return 'overcast';
  if (MOODS[map?.mood]) return map.mood;
  const name = mapMood(map, key);
  return MOODS[name] ? name : DEFAULT_MOOD;
}

// What each weather does to the picture, on top of the mood. haze: haze pulled closer (x); hazeTo, hazeMix: haze and
// sky color moved toward hazeTo by hazeMix; sun, shadow: sun strength and shadow darkness (x); clouds: cloud shade (x).
// wet: darker ground, sheen: puddles, mud: brown ground by the roads, cover: lying snow, banks: fog banks (0-1 each).
export const WEATHER_LOOK = {
  clear: { haze: 1, hazeTo: 0xffffff, hazeMix: 0, sun: 1, shadow: 1, clouds: 1, wet: 0, sheen: 0, mud: 0, cover: 0, banks: 0 },
  fog: { haze: 2.4, hazeTo: 0xc9cbc6, hazeMix: 0.75, sun: 0.62, shadow: 0.45, clouds: 0.2, wet: 0.25, sheen: 0, mud: 0, cover: 0, banks: 1 },
  rain: { haze: 1.6, hazeTo: 0x8e959a, hazeMix: 0.55, sun: 0.6, shadow: 0.5, clouds: 2.6, wet: 1, sheen: 1, mud: 0.35, cover: 0, banks: 0 },
  mud: { haze: 1.15, hazeTo: 0xa29c90, hazeMix: 0.3, sun: 0.85, shadow: 0.8, clouds: 1.6, wet: 0.55, sheen: 0.55, mud: 1, cover: 0, banks: 0 },
  snow: { haze: 1.25, hazeTo: 0xdfe3e8, hazeMix: 0.35, sun: 0.95, shadow: 0.9, clouds: 1, wet: 0, sheen: 0, mud: 0, cover: 1, banks: 0 },
};
