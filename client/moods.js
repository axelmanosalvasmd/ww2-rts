// The light of every map, in one table. client/light.js applies a row (sun, sky fill, haze, exposure) and
// client/atmosphere.js adds the weather and cloud shade that go with it. Adding a look, such as golden hour for a
// map, is one more row here (and a line in RULES, or "mood" in the map file, or ?mood=name in the URL).
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
  // The default: a clear afternoon. A real, slightly warm sun with soft shadows that stay present (the sky fill is about
  // a fifth of the sun's strength, enough to keep shaded sides readable), natural muted color, a pale haze in the distance.
  day: { sunUp: 42, sun: 0xffe0b8, sunI: 3.5, top: 0xb2c1d4, bottom: 0x5f4f3b, hemiI: 0.74, haze: 0xb9bdbc, hazeK: 1, shadow: 1, soft: 1.6, exposure: 0.9, clouds: 0.11 },
  // Low golden sun, long warm shadows (the cinematic concept). Not used by any map yet: ?mood=golden to look at it.
  golden: { sunUp: 22, sun: 0xffb06a, sunI: 3.9, top: 0xb4b6c4, bottom: 0x4f4132, hemiI: 0.6, haze: 0xcdb08f, hazeK: 1.15, shadow: 1, soft: 1.4, exposure: 0.95, clouds: 0.1 },
  dawn: { sunUp: 21, sun: 0xffd2ae, sunI: 3.3, top: 0xc4cddb, bottom: 0x5e5446, hemiI: 0.95, haze: 0xcdc9c1, hazeK: 1.35, shadow: 0.9, soft: 1.9, exposure: 1.0, clouds: 0.06, mist: true },
  overcast: { sunUp: 52, sun: 0xe9e6de, sunI: 1.9, top: 0xc3cad1, bottom: 0x5b564e, hemiI: 1.25, haze: 0xa8aba6, hazeK: 1.25, shadow: 0.6, soft: 2.8, exposure: 1.0, clouds: 0.08 },
  snow: { sunUp: 30, sun: 0xeef0f5, sunI: 2.2, top: 0xd2dae4, bottom: 0x67645e, hemiI: 1.2, haze: 0xb9bfc5, hazeK: 1.4, shadow: 0.65, soft: 2.4, exposure: 0.95, clouds: 0.06, weather: 'snow' },
  dust: { sunUp: 48, sun: 0xffe6bd, sunI: 3.5, top: 0xd5cdbd, bottom: 0x6b5a40, hemiI: 0.7, haze: 0xcdb895, hazeK: 1.3, shadow: 1, soft: 1.4, exposure: 0.95, clouds: 0.1, weather: 'dust' },
};
// Filmic tone mapping: real highlights and deeper shadows than a flat curve, without the washed-out look
export const TONE = 'ACESFilmic';
export const DEFAULT_MOOD = 'day';
const RULES = [
  ['snow', /ardennes|bastogne|bulge|winter|snow/i],
  ['dust', /kasserine|desert|tobruk|alamein|africa|tunis/i],
  ['dawn', /pegasus|polder|river|canal|marsh/i],
  ['overcast', /bocage|cassino|stalingrad|seawall|rain|storm/i],
];
// ?mood=snow in the URL or a "mood" field in the map file wins; otherwise the map's name picks; the default light if none
export function moodFor(map, key) {
  const pick = new URLSearchParams(location.search).get('mood') || map?.mood;
  if (MOODS[pick]) return pick;
  const text = `${map?.name ?? ''} ${key ?? ''}`;
  return RULES.find(([, re]) => re.test(text))?.[0] ?? DEFAULT_MOOD;
}
