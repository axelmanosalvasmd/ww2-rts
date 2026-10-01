// The land past the map edge: an apron of ground around the playable area, so the camera never sees a void or a hard
// edge, wherever it points and however far out it zooms.
//
// One mesh, one draw call. A ring of columns runs around the map (a column every half metre along every edge), and each column is a strip of rows that grow outward (half a metre next to the edge, hundreds of metres at
// the rim). The first row sits exactly on the map's edge height, so the apron meets the terrain with no step; farther
// out, hills at the edge settle into gentle rolling land, while rivers and seas that leave the map stay low and keep
// going (client/water.js extends the water). A narrow strip tucked just under the map's edge and a skirt hanging below
// the first row cover any crack between the two meshes, seen from either side.
//
// The ground is painted in the fragment shader the way client/ground.js paints the map, so the two look alike: the
// same tinted tiles, the same noisy blend between the materials of the four nearest cells, with every cell past the
// edge taking the materials of the edge cell next to it. Far from the map the paint settles into plain grass and dirt
// and fields fade out. Just past the edge the ground is darker and greyer, easing in over 14 m, which
// marks the playable area without a line. The fog of war reaches out over it too, with its own overlay mesh like the
// map's: ground you cannot see is as dim past the edge as inside it, so an unexplored map runs into the land around it
// with no line, and what your units see stands out. The scene's fog and haze do the rest.
import * as THREE from 'three';
import { CELL } from '../shared/sim.js';
import { groundLook } from './ground.js';
import { fogOverlayShader } from './surfaces.js'; // the fog of war's uniforms and vertex code

// ground.js material id -> apron class: 0 grass, 1 dirt, 2 mud, 3 field, 4 road, 5 water, 6 field turned 90 degrees
const CLASS = [0, 1, 2, 3, 4, 5, 1, 2, 2, 6];
const ROWS = [0, 0.5, 1, 2, 3.5, 6, 10, 16, 25, 38, 55, 80, 115, 165, 235, 330, 460, 640, 900, 1250]; // metres out from the edge (the farthest the camera can see, with room to spare)
const COLUMN = 0.5; // metres between columns along an edge that is not flat: the finest step of the map's own surface
const TWIN = 1e-3; // a cliff meets the edge at a cell boundary: two columns, this far to each side of it, take the two heights
const SKIRT = 6; // metres the skirt hangs below the edge
const LIP = 0.3, LIP_DROP = 0.3; // a strip tucked under the map's edge: 0.3 m inside it and 0.3 m below its surface
const SETTLE = 48; // metres over which a hill at the edge settles to the base land
const WINDOW = 24; // widest smoothing of the edge profile, in metres (counted in columns, so it widens where the edge is flat)
const CLOUD_REACH = 700; // the cloud shade covers the rows out to this distance
const UNSEEN = 185 / 255; // the fog overlay's alpha over ground nobody sees
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------- gentle rolling land (value noise, a fixed pattern) ----------
const hash = (x, z) => { const v = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return v - Math.floor(v); };
function valueNoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz, sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return (a + (b - a) * sx) * (1 - sz) + (c + (d - c) * sx) * sz;
}
const rolling = (x, z) => 0.55 * (valueNoise(x / 150, z / 150) * 2 - 1) + 0.3 * (valueNoise(x / 58 + 7.3, z / 58 + 1.9) * 2 - 1) + 0.15 * (valueNoise(x / 23 + 3.1, z / 23 + 9.7) * 2 - 1);
const amplitude = (d) => 0.22 * smooth(0, 22, d) + 4.4 * smooth(12, 330, d); // metres: nearly flat at the edge, up to about 4.5 m far out

// ---------- shared textures (the tinted ground tiles and the noise tables) ----------
let noiseTexture = null, looks = null;
function noiseTex(noise) {
  if (noiseTexture) return noiseTexture;
  const n = noise.size, data = new Uint8Array(n * n * 4);
  for (let i = 0; i < n * n; i++) { data[i * 4] = noise.NP[i] * 255; data[i * 4 + 1] = (noise.NA[i] * 0.5 + 0.5) * 255; data[i * 4 + 3] = 255; }
  noiseTexture = new THREE.DataTexture(data, n, n);
  noiseTexture.wrapS = noiseTexture.wrapT = THREE.RepeatWrapping;
  noiseTexture.magFilter = noiseTexture.minFilter = THREE.LinearFilter;
  noiseTexture.needsUpdate = true;
  return noiseTexture;
}
// grass, dirt, mud, field, road, water, as the map is painted from them (ground.js ids 0 to 5)
function tileTextures(look) {
  if (looks && looks.tiles === look.tiles && looks.ready === look.ready) return looks.textures;
  looks?.textures.forEach(t => t.dispose());
  const textures = [0, 1, 2, 3, 4, 5].map((m) => {
    const t = look.ready ? look.tiles?.[m] : null;
    const tex = t?.data ? new THREE.DataTexture(t.data, t.T, t.T) : new THREE.DataTexture(new Uint8Array([...look.flat[m].map(Math.round), 255]), 1, 1);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true; tex.anisotropy = 8;
    tex.needsUpdate = true;
    return tex;
  });
  looks = { tiles: look.tiles, ready: look.ready, textures };
  return textures;
}

// ---------- shared GLSL ----------
const STEP_GLSL = /* glsl */`float apStep( float x ) { x = clamp( x, 0.0, 1.0 ); return x * x * ( 3.0 - 2.0 * x ); }`;

// ---------- the ground paint ----------
const VERT_PARS = /* glsl */`varying vec3 vApronWorld;`;
const VERT_MAIN = /* glsl */`vApronWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;`;
const FRAG_PARS = /* glsl */`
${STEP_GLSL}
varying vec3 vApronWorld;
uniform sampler2D uGrass, uDirt, uMud, uField, uRoad, uWater, uCells, uNoise;
uniform vec3 uMetersA; // metres per tile: grass, dirt, mud
uniform vec3 uMetersB; // field, road, water
uniform vec2 uMapSize; // metres
uniform vec2 uCellDim; // cells
uniform float uCell;   // metres per cell

// the noise table: r is the equalized patch noise, g the fBm (0..1); u is a position in table texels
vec2 apNoise( vec2 u ) { return texture2D( uNoise, ( u + 0.5 ) / 512.0 ).rg; }
vec3 apLinear( vec3 c ) { return mix( pow( c * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), c * 0.0773993808, vec3( lessThanEqual( c, vec3( 0.04045 ) ) ) ); }
`;
const FRAG_COLOR = /* glsl */`
vec2 apw = vApronWorld.xz;
vec2 apu = apw / uCell;
// the four nearest cell centres, looked up at a warped position (the same warp and patch noise as ground.js)
vec2 apwarp = vec2( apNoise( vec2( apu.x * 16.0 + 1101.0, apu.y * 16.0 + 37.0 ) ).g, apNoise( vec2( apu.x * 16.0 + 311.0, apu.y * 16.0 + 1211.0 ) ).g ) * 2.0 - 1.0;
vec2 apf = apu + apwarp * 0.32 - 0.5;
vec2 api = floor( apf );
vec2 apt = apf - api;
float appn = apNoise( apu * 6.0 + vec2( 57.0, 213.0 ) ).r;
vec4 apk = vec4( ( 1.0 - apt.x ) * ( 1.0 - apt.y ), apt.x * ( 1.0 - apt.y ), ( 1.0 - apt.x ) * apt.y, apt.x * apt.y );
apk *= apk; apk /= apk.x + apk.y + apk.z + apk.w;
float apwt[7];
for ( int i = 0; i < 7; i ++ ) apwt[i] = 0.0;
for ( int k = 0; k < 4; k ++ ) {
	ivec2 cc = clamp( ivec2( api ) + ivec2( k & 1, k >> 1 ), ivec2( 0 ), ivec2( uCellDim ) - 1 );
	vec4 cell = texelFetch( uCells, cc, 0 ) * 255.0;
	int prim = int( cell.r + 0.5 ), sec = int( cell.g + 0.5 );
	float amt = cell.b / 255.0;
	if ( amt > 0.0 ) {
		float s = apStep( ( amt - appn ) * 5.5 + 0.5 );
		apwt[sec] += apk[k] * s; apwt[prim] += apk[k] * ( 1.0 - s );
	} else apwt[prim] += apk[k];
}
// distance from the map: fields fade out, then everything settles into plain grass and dirt (water keeps going)
float apd = length( apw - clamp( apw, vec2( 0.0 ), uMapSize ) );
float apFieldFade = apStep( ( apd - 14.0 ) / 22.0 );
float apFields = apwt[3] + apwt[6];
apwt[0] += apFields * apFieldFade; apwt[3] *= 1.0 - apFieldFade; apwt[6] *= 1.0 - apFieldFade;
float apFar = apStep( ( apd - 40.0 ) / 200.0 ), apDry = 1.0 - apwt[5], apPatch = 0.6 * apStep( ( 0.11 - appn ) * 5.5 + 0.5 );
for ( int i = 0; i < 7; i ++ ) if ( i != 5 ) apwt[i] *= 1.0 - apFar;
apwt[0] += apFar * apDry * ( 1.0 - apPatch ); apwt[1] += apFar * apDry * apPatch;

// Only the tiles that count are sampled (most of the apron is grass and dirt). The derivatives are taken first, so
// the texture filtering stays right inside the branches.
vec2 apdx = dFdx( apw ), apdy = dFdy( apw );
vec3 apc = vec3( 0.0 );
if ( apwt[0] > 0.003 ) apc += apwt[0] * textureGrad( uGrass, apw / uMetersA.x, apdx / uMetersA.x, apdy / uMetersA.x ).rgb;
if ( apwt[1] > 0.003 ) apc += apwt[1] * textureGrad( uDirt, apw / uMetersA.y, apdx / uMetersA.y, apdy / uMetersA.y ).rgb;
if ( apwt[2] > 0.003 ) apc += apwt[2] * textureGrad( uMud, apw / uMetersA.z, apdx / uMetersA.z, apdy / uMetersA.z ).rgb;
if ( apwt[3] > 0.003 ) apc += apwt[3] * textureGrad( uField, apw / uMetersB.x, apdx / uMetersB.x, apdy / uMetersB.x ).rgb;
if ( apwt[6] > 0.003 ) apc += apwt[6] * textureGrad( uField, apw.yx / uMetersB.x, apdx.yx / uMetersB.x, apdy.yx / uMetersB.x ).rgb;
if ( apwt[4] > 0.003 ) apc += apwt[4] * textureGrad( uRoad, apw / uMetersB.y, apdx / uMetersB.y, apdy / uMetersB.y ).rgb;
if ( apwt[5] > 0.003 ) apc += apwt[5] * textureGrad( uWater, apw / uMetersB.z, apdx / uMetersB.z, apdy / uMetersB.z ).rgb;
// broad light and dark sweeps, so the repeat of the tiles doesn't show
apc *= 1.0 + 0.14 * ( apNoise( apu * 2.3 + vec2( 900.0, 431.0 ) ).g * 2.0 - 1.0 );
// a pale line where water meets land
float apWet = apwt[5];
if ( apWet > 0.06 && apWet < 0.94 ) { float kk = 1.0 - abs( apWet - 0.5 ) * 2.2; if ( kk > 0.0 ) apc = mix( apc, vec3( 0.7216, 0.698, 0.5725 ), kk * kk * 0.45 ); }
apc = mix( vec3( dot( apc, vec3( 0.3, 0.59, 0.11 ) ) ), apc, 1.0 - 0.25 * apStep( apd / 14.0 ) );
diffuseColor.rgb = apLinear( clamp( apc, 0.0, 1.0 ) );
// the same warm lift with height as the map's relief paint, so the two match at the edge
diffuseColor.rgb *= mix( vec3( 1.01, 0.98, 0.92 ), vec3( 1.12, 1.05, 0.98 ), smoothstep( -5.0, 10.0, vApronWorld.y ) );
// the playable area's edge: past it the ground is darker and greyer, easing in over 14 m (a soft margin, no line)
diffuseColor.rgb *= 1.0 - 0.2 * apStep( apd / 14.0 );
`;

// ---------- the apron ----------
// ground: createGround()'s result; relief: createRelief()'s; grid: the live terrain rows; map: { w, h } in cells.
export function createApron({ ground, relief, grid, map }) {
  const W = map.w * CELL, H = map.h * CELL;
  // Columns around the map: a twin pair at every cell boundary (so a cliff at the edge keeps both of its heights), a
  // column every half metre between them (the finest step of the map's own surface, so the
  // first row follows it), and one column in each corner that leaves along the diagonal.
  const cols = [];
  const side = (x0, z0, dx, dz, length, nx, nz) => {
    const cells = Math.round(length / CELL), steps = Math.round(CELL / COLUMN);
    for (let k = 0; k < cells; k++) {
      for (let i = 0; i <= steps; i++) {
        const at = k * CELL + (i === 0 ? TWIN : i === steps ? CELL - TWIN : i * COLUMN);
        cols.push({ x: x0 + dx * at, z: z0 + dz * at, nx, nz, len: 1 });
      }
    }
  };
  const corner = (x, z, nx, nz) => cols.push({ x, z, nx, nz, len: Math.SQRT2 });
  corner(0, 0, -1, -1);
  side(0, 0, 1, 0, W, 0, -1); corner(W, 0, 1, -1);
  side(W, 0, 0, 1, H, 1, 0); corner(W, H, 1, 1);
  side(W, H, -1, 0, W, 0, 1); corner(0, H, -1, 1);
  side(0, H, 0, -1, H, -1, 0);
  const N = cols.length, K = ROWS.length, R = K + 2; // row K of each column is the skirt, row K + 1 the strip under the map's edge
  const wetRow = (c) => {
    const x = Math.min(map.w - 1, Math.max(0, Math.floor(cols[c].x / CELL))), z = Math.min(map.h - 1, Math.max(0, Math.floor(cols[c].z / CELL)));
    return 'WF='.includes(grid[z]?.[x] ?? '.') ? 1 : 0;
  };

  const position = new Float32Array(N * R * 3), normal = new Float32Array(N * R * 3);
  const edge = new Float32Array(N), wet = new Float32Array(N); // the map's height along its edge, and where water meets it
  const edgeSum = new Float64Array(3 * N + 1), wetSum = new Float64Array(3 * N + 1); // running sums over the ring, repeated three times
  const mean = (sum, c, r) => (sum[c + r + N + 1] - sum[c - r + N]) / (2 * r + 1);

  // Heights from the edge profile outward. Hills at the edge settle over SETTLE metres; water stays low; the profile is
  // smoothed more the farther out, so a cliff at the edge flares into a ramp instead of a fin.
  function shape() {
    for (let c = 0; c < N; c++) { edge[c] = relief.hAt(Math.min(W, Math.max(0, cols[c].x)), Math.min(H, Math.max(0, cols[c].z))); wet[c] = wetRow(c); }
    for (let i = 0; i < 3 * N; i++) { edgeSum[i + 1] = edgeSum[i] + edge[i % N]; wetSum[i + 1] = wetSum[i] + wet[i % N]; }
    for (let c = 0; c < N; c++) {
      const col = cols[c];
      for (let k = 0; k < K; k++) {
        const d = ROWS[k], euclid = d * col.len, r = Math.min(N - 1, Math.round(WINDOW / 0.4), Math.round(euclid * 1.2 / 0.4));
        const e = r ? mean(edgeSum, c, r) : edge[c], w = r ? mean(wetSum, c, r) : wet[c], t = smooth(0, SETTLE, euclid);
        const x = col.x + col.nx * d, z = col.z + col.nz * d;
        const h = (e > 0 ? e * (1 - t) : e * (1 - t * (1 - w))) + amplitude(euclid) * (1 - w) * rolling(x, z);
        position.set([x, h, z], (c * R + k) * 3);
      }
      const row0 = (c * R) * 3, inside = [Math.min(W, Math.max(0, col.x - col.nx * LIP)), Math.min(H, Math.max(0, col.z - col.nz * LIP))];
      position.set([col.x, position[row0 + 1] - SKIRT, col.z], (c * R + K) * 3);
      position.set([inside[0], relief.hAt(inside[0], inside[1]) - LIP_DROP, inside[1]], (c * R + K + 1) * 3);
    }
    // normals from the neighbours in the grid: along the ring and outward (one-sided at the rim)
    const p = (c, k, o) => position[(((c + N) % N) * R + k) * 3 + o];
    for (let c = 0; c < N; c++) for (let k = 0; k < K; k++) {
      const k0 = Math.max(0, k - 1), k1 = Math.min(K - 1, k + 1);
      const ux = p(c + 1, k, 0) - p(c - 1, k, 0), uy = p(c + 1, k, 1) - p(c - 1, k, 1), uz = p(c + 1, k, 2) - p(c - 1, k, 2);
      const vx = p(c, k1, 0) - p(c, k0, 0), vy = p(c, k1, 1) - p(c, k0, 1), vz = p(c, k1, 2) - p(c, k0, 2);
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
      const inv = 1 / (Math.hypot(nx, ny, nz) || 1), o = (c * R + k) * 3;
      normal[o] = nx * inv; normal[o + 1] = ny * inv; normal[o + 2] = nz * inv;
    }
    for (let c = 0; c < N; c++) for (const row of [K, K + 1]) normal.copyWithin((c * R + row) * 3, (c * R) * 3, (c * R) * 3 + 3); // lit like the edge
  }

  // triangles: the ground rows first (the cloud shade uses the first rows only), then the strip under the map's
  // edge (it covers any crack between the two meshes seen from the map side), then the skirt (the same from outside)
  const rowsTo = (reach) => { const k = ROWS.findIndex(d => d > reach); return k < 0 ? K - 1 : k; }; // rows 0..k are within reach
  const cloudRows = rowsTo(CLOUD_REACH);
  const index = new Uint32Array((N * (K - 1) + 2 * N) * 6);
  let n = 0, cloudCount = 0;
  for (let k = 0; k < K - 1; k++) {
    if (k === cloudRows) cloudCount = n;
    for (let c = 0; c < N; c++) {
      const a = c * R + k, b = ((c + 1) % N) * R + k, a2 = a + 1, b2 = b + 1;
      index[n++] = a; index[n++] = b; index[n++] = a2; index[n++] = b; index[n++] = b2; index[n++] = a2;
    }
  }
  if (!cloudCount) cloudCount = n;
  for (let c = 0; c < N; c++) {
    const a = c * R + K + 1, b = ((c + 1) % N) * R + K + 1, a2 = c * R, b2 = ((c + 1) % N) * R;
    index[n++] = a; index[n++] = b; index[n++] = a2; index[n++] = b; index[n++] = b2; index[n++] = a2;
  }
  for (let c = 0; c < N; c++) {
    const a = c * R, b = ((c + 1) % N) * R, s = a + K, s2 = b + K; // the wall faces outward
    index[n++] = s; index[n++] = a; index[n++] = s2; index[n++] = s2; index[n++] = a; index[n++] = b;
  }

  const geometry = new THREE.BufferGeometry();
  const positions = new THREE.BufferAttribute(position, 3), normals = new THREE.BufferAttribute(normal, 3);
  geometry.setAttribute('position', positions); geometry.setAttribute('normal', normals);
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  const rim = ROWS[K - 1] + Math.hypot(W, H);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(W / 2, 0, H / 2), rim);
  geometry.boundingBox = new THREE.Box3(new THREE.Vector3(-ROWS[K - 1], -SKIRT - 12, -ROWS[K - 1]), new THREE.Vector3(W + ROWS[K - 1], 40, H + ROWS[K - 1]));
  // the same ground with only the near rows, for the cloud shade (it shares the buffers above)
  const overlayGeometry = new THREE.BufferGeometry();
  overlayGeometry.setAttribute('position', positions); overlayGeometry.setAttribute('normal', normals);
  overlayGeometry.setIndex(new THREE.BufferAttribute(index.subarray(0, cloudCount), 1));
  overlayGeometry.boundingSphere = geometry.boundingSphere; overlayGeometry.boundingBox = geometry.boundingBox;

  // which materials each cell has, for the paint
  const cellData = new Uint8Array(map.w * map.h * 4);
  const cellTexture = new THREE.DataTexture(cellData, map.w, map.h);
  cellTexture.magFilter = cellTexture.minFilter = THREE.NearestFilter;
  let cellVersion = -1;
  function readCells() {
    const cells = ground.cells();
    if (!cells) return;
    for (let i = 0; i < map.w * map.h; i++) {
      cellData[i * 4] = CLASS[cells.prim[i]]; cellData[i * 4 + 1] = CLASS[cells.sec[i]];
      cellData[i * 4 + 2] = Math.min(255, Math.round(cells.amt[i] * 255)); cellData[i * 4 + 3] = 255;
    }
    cellTexture.needsUpdate = true;
    cellVersion = ground.version();
  }

  const look = groundLook();
  const tiles = tileTextures(look);
  const uniforms = {
    uGrass: { value: tiles[0] }, uDirt: { value: tiles[1] }, uMud: { value: tiles[2] }, uField: { value: tiles[3] }, uRoad: { value: tiles[4] }, uWater: { value: tiles[5] },
    uCells: { value: cellTexture }, uNoise: { value: noiseTex(look.noise) },
    uMetersA: { value: new THREE.Vector3(look.meters[0], look.meters[1], look.meters[2]) },
    uMetersB: { value: new THREE.Vector3(look.meters[3], look.meters[4], look.meters[5]) },
    uMapSize: { value: new THREE.Vector2(W, H) }, uCellDim: { value: new THREE.Vector2(map.w, map.h) }, uCell: { value: CELL },
    uUnseen: { value: UNSEEN },
  };
  const material = new THREE.MeshLambertMaterial({ color: 0xffffff });
  material.onBeforeCompile = (shader) => {
    material.userData.shader = shader; // for poking at the uniforms from devtools
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${VERT_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <map_fragment>', FRAG_COLOR);
  };
  material.customProgramCacheKey = () => 'apron-v8';

  // The fog of war over the apron: a copy of the map's overlay (main.js) on the apron's own surface, all the way out, so the
  // two meet along the edge with no gap and no overlap, and it darkens whatever lies on the apron (the water that leaves
  // the map). The map's edge cells carry on outward for a few metres, so what a unit near the edge sees is lit past it;
  // beyond that the ground counts as unseen (alpha 185 of 255), as dark as unexplored ground inside the map.
  const fogMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(10 / 255, 10 / 255, 10 / 255), transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6,
  });
  fogMaterial.onBeforeCompile = (shader) => fogOverlayShader(shader, {
    uMapSize: uniforms.uMapSize, uUnseen: uniforms.uUnseen,
  });
  fogMaterial.customProgramCacheKey = () => 'apron-fog-v3';
  const fogMesh = new THREE.Mesh(geometry, fogMaterial);
  fogMesh.name = 'apron-fog'; fogMesh.renderOrder = 1; fogMesh.frustumCulled = false; fogMesh.raycast = () => {};

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'apron';
  mesh.receiveShadow = true;
  mesh.frustumCulled = false; // always on screen somewhere; the draw is one call either way
  mesh.raycast = () => {}; // clicks past the map edge land on the flat plane in main.js's groundAt

  shape(); readCells();
  let disposed = false;
  const loaded = look.loading.then(() => {
    if (disposed) return;
    const fresh = groundLook(), set = tileTextures(fresh);
    ['uGrass', 'uDirt', 'uMud', 'uField', 'uRoad', 'uWater'].forEach((key, i) => { uniforms[key].value = set[i]; });
    uniforms.uMetersA.value.set(fresh.meters[0], fresh.meters[1], fresh.meters[2]);
    uniforms.uMetersB.value.set(fresh.meters[3], fresh.meters[4], fresh.meters[5]);
  });

  let watched = relief.mesh.geometry;
  return {
    mesh, fogMesh, overlayGeometry, loaded,
    // Call once a frame: follows craters that change the edge heights and cells that change the paint.
    update() {
      if (relief.mesh.geometry !== watched) {
        watched = relief.mesh.geometry;
        let changed = false;
        for (let c = 0; c < N && !changed; c++) {
          const h = relief.hAt(Math.min(W, Math.max(0, cols[c].x)), Math.min(H, Math.max(0, cols[c].z)));
          changed = Math.abs(h - edge[c]) > 1e-4 || wetRow(c) !== wet[c];
        }
        if (changed) { shape(); positions.needsUpdate = normals.needsUpdate = true; }
      }
      if (ground.version() !== cellVersion) readCells();
    },
    dispose() {
      disposed = true;
      mesh.removeFromParent();
      fogMesh.removeFromParent();
      geometry.dispose(); overlayGeometry.dispose(); material.dispose(); fogMaterial.dispose(); cellTexture.dispose();
    },
  };
}
