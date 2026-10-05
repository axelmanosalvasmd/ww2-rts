// The wind the server reports (snapshot.wx), for everything that drifts: smoke, dust, cloud shade, rain.
// Until the first snapshot it blows the way it always did.
export const wind = { x: 0.55, z: 0.25 };
// a: direction in radians, v: strength 0-1
export function setWind(a, v) {
  const k = 0.25 + 0.6 * v;
  wind.x = Math.cos(a) * k; wind.z = Math.sin(a) * k;
}
