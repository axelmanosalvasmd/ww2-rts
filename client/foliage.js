// Trees, bushes, hedgerow shrubs and grass at real size. Trunks and limbs are tapered tubes in bark; crowns are
// clusters of alpha-tested leaf cards cut from one 1024 px atlas (client/textures/foliage.webp: oak leaves, hawthorn,
// a spruce bough and a grass tuft). A card's normal points out of its crown rather than off its own face, so a crown
// shades as one leafy mass, lit on the sun side and darker underneath, instead of as a stack of flat planes.
// A tree species is one bark geometry and one leaf geometry, a bush, hedge stretch, grass patch or wheat cell one leaf
// geometry, all drawn as InstancedMeshes (client/props.js, client/structures.js), so a whole forest costs a handful of
// draw calls.
import * as THREE from 'three';
import { fogShader, loadTexture } from './surfaces.js';

// sprite rectangles in the atlas as uv [u0, v0, u1, v1] (v up), from pixel boxes measured on the 1024 px image
const px = (x0, y0, x1, y1) => [x0 / 1024, 1 - y1 / 1024, x1 / 1024, 1 - y0 / 1024];
const SPRITE = {
  oak: px(10, 15, 502, 497),
  shrub: px(522, 10, 1014, 502),
  pine: px(10, 666, 502, 869), // the bough runs from its stem on the left to its tip on the right
  grass: px(540, 522, 995, 1014), // the tuft grows from the bottom edge
};

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
// small seeded generator, so every client builds the same trees
function random(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const clamp01 = (v) => Math.max(0, Math.min(1, v));
function unit(rand) {
  const y = rand() * 2 - 1, a = rand() * Math.PI * 2, r = Math.sqrt(1 - y * y);
  return V(Math.cos(a) * r, y, Math.sin(a) * r);
}
// two axes across a card facing n, turned by spin
function across(n, spin) {
  const ref = Math.abs(n.y) > 0.9 ? V(1, 0, 0) : UP;
  const a = V().crossVectors(ref, n).normalize(), b = V().crossVectors(n, a);
  return [a.clone().multiplyScalar(Math.cos(spin)).addScaledVector(b, Math.sin(spin)), b.multiplyScalar(Math.cos(spin)).addScaledVector(a, -Math.sin(spin))];
}

// indexed geometry under construction: position, normal, uv, grey vertex shade
class Shape {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.i = []; }
  vert(p, n, u, v, c) {
    this.p.push(p.x, p.y, p.z); this.n.push(n.x, n.y, n.z); this.uv.push(u, v); this.c.push(c, c, c);
    return this.p.length / 3 - 1;
  }
  // a leaf card centred on c with half-axes a (across the sprite) and b (up the sprite); normal(p) and shade(p) per corner
  card(c, a, b, rect, normal, shade) {
    const [u0, v0, u1, v1] = rect;
    const ids = [[-1, -1, u0, v0], [1, -1, u1, v0], [1, 1, u1, v1], [-1, 1, u0, v1]].map(([sa, sb, u, v]) => {
      const p = c.clone().addScaledVector(a, sa).addScaledVector(b, sb);
      return this.vert(p, normal(p), u, v, shade(p));
    });
    this.i.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
  }
  // a tapered tube through points with a radius at each; bark uv in metres (1.2 m per repeat)
  tube(points, radii, sides, shade = 1) {
    const rings = [], wraps = Math.max(1, Math.round(2 * Math.PI * radii[0] / 1.2));
    let along = 0;
    points.forEach((p, s) => {
      const next = points[Math.min(s + 1, points.length - 1)], prev = points[Math.max(s - 1, 0)];
      const dir = V().subVectors(next, prev).normalize();
      if (s) along += p.distanceTo(prev);
      const ax = V().crossVectors(dir, Math.abs(dir.y) < 0.95 ? UP : V(1, 0, 0)).normalize(), ay = V().crossVectors(dir, ax);
      const ring = [];
      for (let k = 0; k <= sides; k++) {
        const t = k / sides * Math.PI * 2, n = ax.clone().multiplyScalar(Math.cos(t)).addScaledVector(ay, Math.sin(t));
        ring.push(this.vert(p.clone().addScaledVector(n, radii[s]), n, k / sides * wraps, along / 1.2, shade));
      }
      rings.push(ring);
    });
    for (let s = 0; s + 1 < rings.length; s++) for (let k = 0; k < sides; k++) {
      const a = rings[s][k], b = rings[s][k + 1], c = rings[s + 1][k + 1], d = rings[s + 1][k];
      this.i.push(a, b, c, a, c, d);
    }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.i);
    g.computeBoundingSphere();
    return g;
  }
}

// the normal of a crown point: half from its own clump's centre, half from the crown's, tipped toward the sky
const crownNormal = (lobe, crown, lift = 0.3) => (p) =>
  V().subVectors(p, lobe).normalize().add(V().subVectors(p, crown).normalize()).addScaledVector(UP, lift).normalize();

// Broadleaf (oak, elm, ash): about 12.5 m tall, a 9 to 10 m crown of six clumps on limbs from a 5 m trunk.
function broadleaf(seed) {
  const rand = random(seed), bark = new Shape(), leaves = new Shape();
  const top = 5.0, lx = (rand() - 0.5) * 0.5, lz = (rand() - 0.5) * 0.5;
  const T = (y) => V(lx * y / top, y, lz * y / top);
  bark.tube([T(-0.3), T(0.35), T(2.4), T(top)], [0.5, 0.34, 0.29, 0.22], 7);
  const crown = V(lx * 1.5, 8.6, lz * 1.5);
  const lobes = [{ c: V(lx * 1.7, 10.4, lz * 1.7), r: 2.3 }];
  for (let k = 0; k < 5; k++) {
    const a = k / 5 * Math.PI * 2 + (rand() - 0.5) * 0.9, d = 1.9 + rand() * 0.8;
    lobes.push({ c: V(crown.x + Math.cos(a) * d, 7.1 + rand() * 1.8, crown.z + Math.sin(a) * d), r: 1.9 + rand() * 0.5 });
  }
  for (const L of lobes) {
    // a limb from the upper trunk into each clump
    const start = T(top - 0.3 - rand() * 1.4), end = L.c.clone().lerp(crown, 0.3);
    const mid = start.clone().lerp(end, 0.45).add(V(0, 0.7, 0));
    bark.tube([start, mid, end], [0.13, 0.09, 0.04], 4);
    const out = L === lobes[0] ? UP : V().subVectors(L.c, crown).setY(0.25).normalize(), normal = crownNormal(L.c, crown);
    const shade = (p) => (0.5 + 0.5 * clamp01((p.y - 5.5) / 6.5)) * (0.78 + 0.22 * clamp01(p.distanceTo(crown) / 4.2));
    for (let i = 0; i < 6; i++) {
      const d = unit(rand);
      if (d.dot(out) < 0) d.addScaledVector(out, 1.1).normalize();
      const c = L.c.clone().addScaledVector(d, L.r * (0.45 + rand() * 0.3));
      const n = d.clone().add(unit(rand).multiplyScalar(0.45)).normalize(), size = 1.35 + rand() * 0.4;
      const [a, b] = across(n, rand() * Math.PI * 2);
      leaves.card(c, a.multiplyScalar(size), b.multiplyScalar(size), SPRITE.oak, normal, shade);
    }
  }
  // shadowed leaves inside the crown, seen through its gaps
  for (let i = 0; i < 3; i++) {
    const c = crown.clone().add(unit(rand).multiplyScalar(1.2)), [a, b] = across(unit(rand), rand() * 6.28);
    leaves.card(c, a.multiplyScalar(1.7), b.multiplyScalar(1.7), SPRITE.oak, crownNormal(crown, crown, 0), () => 0.45);
  }
  return { bark: bark.geometry(), leaves: leaves.geometry() };
}

// Spruce: about 14 m, boughs in whorls that droop and shorten toward a thin leader.
function pine(seed) {
  const rand = random(seed), bark = new Shape(), leaves = new Shape(), H = 14;
  bark.tube([V(0, -0.3, 0), V(0, 0.3, 0), V(0, H * 0.5, 0), V(0, H - 0.6, 0)], [0.36, 0.26, 0.16, 0.03], 6);
  const tiers = 10, y0 = 2.0, y1 = H - 1.6;
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1), y = y0 + (y1 - y0) * t + (rand() - 0.5) * 0.3, len = 0.7 + 2.9 * Math.pow(1 - t, 0.85);
    const n = i > tiers - 3 ? 4 : 5;
    for (let j = 0; j < n; j++) {
      const ang = i * 2.39996 + j / n * Math.PI * 2 + (rand() - 0.5) * 0.5, out = V(Math.cos(ang), 0, Math.sin(ang));
      const droop = 0.18 + 0.2 * rand(), dir = out.clone().setY(-droop).normalize();
      const half = len / 2, c = V(0, y, 0).addScaledVector(dir, half + 0.1), side = V(-out.z, 0, out.x).multiplyScalar(half / 2.4 * 1.35);
      const normal = (p) => V(p.x, 0, p.z).normalize().multiplyScalar(0.55).add(V(0, 0.85, 0)).normalize();
      const shade = (p) => (0.55 + 0.45 * clamp01(p.y / H)) * (0.7 + 0.3 * clamp01(Math.hypot(p.x, p.z) / 2.5));
      // tilt the bough a little about its own axis so whorls do not read as flat plates
      leaves.card(c, dir.clone().multiplyScalar(half), side.applyAxisAngle(dir, (rand() - 0.5) * 0.7), SPRITE.pine, normal, shade);
    }
  }
  // the leader: two crossed upright sprigs
  for (const ang of [0, Math.PI / 2]) {
    const a = V(Math.cos(ang), 0, Math.sin(ang)).multiplyScalar(0.55);
    leaves.card(V(0, H - 0.9, 0), V(0, 1.1, 0), a, SPRITE.pine, (p) => V(p.x, 0.8, p.z).normalize(), () => 1);
  }
  return { bark: bark.geometry(), leaves: leaves.geometry() };
}

// Lombardy poplar: about 17 m, a narrow column of small leaves from 2.5 m to the top.
function poplar(seed) {
  const rand = random(seed), bark = new Shape(), leaves = new Shape(), H = 17;
  bark.tube([V(0, -0.3, 0), V(0, 0.3, 0), V(0, 6, 0), V(0, 13, 0)], [0.42, 0.3, 0.2, 0.06], 6);
  for (let k = 0; k < 4; k++) {
    const a = k * 1.7 + rand(), s = V(0, 3.5 + k * 1.8, 0), e = V(Math.cos(a) * 0.9, s.y + 4.5, Math.sin(a) * 0.9);
    bark.tube([s, e], [0.09, 0.03], 4);
  }
  const radius = (y) => 0.4 + 1.0 * Math.sin(Math.PI * clamp01((y - 2.2) / (H - 1.8)) ** 0.75);
  const axis = (y) => V(0, y, 0);
  const shade = (p) => (0.5 + 0.4 * clamp01(p.y / H)) * (0.75 + 0.25 * clamp01(Math.hypot(p.x, p.z) / 1.6));
  const cards = 34;
  for (let i = 0; i < cards; i++) {
    const y = 3.2 + (H - 4.4) * (i + rand() * 0.6) / cards, ang = i * 2.39996 + rand() * 0.4, r = radius(y) * (0.55 + rand() * 0.3);
    const out = V(Math.cos(ang), 0, Math.sin(ang)), c = axis(y).addScaledVector(out, r);
    const n = out.clone().setY(0.15 + rand() * 0.3).normalize(), w = 0.75 + radius(y) * 0.12;
    const [a] = across(n, 0), b = V().crossVectors(n, a).normalize();
    const normal = (p) => V(p.x, 0, p.z).normalize().add(V(0, 0.35, 0)).normalize();
    leaves.card(c, a.multiplyScalar(w), b.multiplyScalar(1.1 + rand() * 0.25), SPRITE.shrub, normal, shade);
  }
  return { bark: bark.geometry(), leaves: leaves.geometry() };
}

// a field bush about 1.5 m tall and 2.5 m across: three overlapping clumps of hawthorn and oak cards
function bush(seed) {
  const rand = random(seed), leaves = new Shape(), centre = V(0, 0.15, 0);
  const shade = (p) => 0.5 + 0.5 * clamp01(p.y / 1.4);
  const normal = (p) => V().subVectors(p, centre).normalize().addScaledVector(UP, 0.3).normalize();
  for (const [c, r, n] of [[V(0, 0.62, 0), 0.6, 6], [V(0.62, 0.42, 0.28), 0.42, 4], [V(-0.5, 0.36, -0.36), 0.4, 3]]) {
    for (let i = 0; i < n; i++) {
      const d = unit(rand);
      d.y = Math.abs(d.y) * 0.8 + 0.1;
      d.normalize();
      const p = c.clone().addScaledVector(d, r * 0.7), size = r * (0.8 + rand() * 0.3);
      const [a, b] = across(d.clone().add(unit(rand).multiplyScalar(0.4)).normalize(), rand() * Math.PI * 2);
      leaves.card(p, a.multiplyScalar(size), b.multiplyScalar(size), rand() < 0.25 ? SPRITE.oak : SPRITE.shrub, normal, shade);
    }
  }
  return leaves.geometry();
}

// a stretch of hedgerow about 2 m long on its centre (local x runs along the hedge): fourteen cards around the
// hedge's spine, the odd sprig standing proud of the top, so neighbouring stretches merge into one ragged wall
function hedge(seed) {
  const rand = random(seed), leaves = new Shape();
  const shade = (p) => 0.48 + 0.52 * clamp01((p.y + 0.8) / 1.9);
  const normal = (p) => V(0, p.y + 0.4, p.z).normalize().addScaledVector(UP, 0.35).normalize();
  for (let i = 0; i < 14; i++) {
    const x = -1.05 + 2.1 * (i + rand()) / 14, d = unit(rand);
    d.x *= 0.3; d.y = Math.abs(d.y) * 0.9 + 0.05; d.normalize();
    const c = V(x, d.y * 0.55 - 0.05 + (rand() < 0.2 ? 0.35 : 0), d.z * 0.62), size = 0.5 + rand() * 0.25;
    const [a, b] = across(d.clone().add(unit(rand).multiplyScalar(0.35)).normalize(), rand() * Math.PI * 2);
    leaves.card(c, a.multiplyScalar(size), b.multiplyScalar(size), rand() < 0.3 ? SPRITE.oak : SPRITE.shrub, normal, shade);
  }
  return leaves.geometry();
}

// a patch of meadow grass across about 2 m: five tufts of two crossed cards
function grass(seed) {
  const rand = random(seed), leaves = new Shape();
  for (let i = 0; i < 5; i++) {
    const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * 0.85, base = V(Math.cos(a) * r, 0, Math.sin(a) * r);
    const h = 0.24 + rand() * 0.16, w = h * 0.6, turn = rand() * Math.PI;
    for (const q of [0, Math.PI / 2]) {
      const side = V(Math.cos(turn + q), 0, Math.sin(turn + q)).multiplyScalar(w);
      const normal = () => V(0, 1, 0), shade = (p) => 0.72 + 0.4 * clamp01(p.y / h);
      leaves.card(base.clone().setY(h), side, V(0, h, 0), SPRITE.grass, normal, shade);
    }
  }
  return leaves.geometry();
}

// a 2 m cell of standing wheat about 0.8 m tall: three rows of long cards along local x, crossed by short ones
function crop(seed) {
  const rand = random(seed), leaves = new Shape();
  const normal = () => V(0, 1, 0), shade = (p) => 0.7 + 0.45 * clamp01(p.y / 0.8);
  for (const z of [-0.66, 0, 0.66]) {
    const h = 0.36 + rand() * 0.08;
    for (const lean of [-0.12, 0.12]) {
      const top = V(0, h, lean * h).normalize().multiplyScalar(h);
      leaves.card(V((rand() - 0.5) * 0.3, h, z + lean * 0.3), V(1.02, 0, 0), top, SPRITE.grass, normal, shade);
    }
    for (const x of [-0.6, 0.6]) leaves.card(V(x + (rand() - 0.5) * 0.2, h, z), V(0, 0, 0.36), V(0, h, 0), SPRITE.grass, normal, shade);
  }
  return leaves.geometry();
}

const cache = new Map();
const once = (key, make) => cache.get(key) ?? cache.set(key, make()).get(key);
// { bark, leaves } geometries for 'broadleaf', 'pine' and 'poplar'; plain leaf geometries for 'bush', 'hedge', 'grass', 'crop'
export function treeGeometry(kind) {
  return once(kind, () => kind === 'pine' ? pine(7) : kind === 'poplar' ? poplar(11) : broadleaf(3));
}
export function leafGeometry(kind) {
  return once(kind, () => kind === 'grass' ? grass(5) : kind === 'crop' ? crop(17) : kind === 'hedge' ? hedge(13) : bush(9));
}

// Fog of war on foliage darkens it, as the fog overlay darkens the ground under it, instead of greying it like the
// walls: a grey wood would read as a cut-out.
const FOG_MIX = 'gl_FragColor.rgb = mix( gl_FragColor.rgb, vec3( 0.22 ), texture2D( fowMap, vFowUv ).a );';
function foliageFog(shader) {
  fogShader(shader);
  shader.fragmentShader = shader.fragmentShader.replace(FOG_MIX, 'gl_FragColor.rgb *= 1.0 - 0.6 * texture2D( fowMap, vFowUv ).a;');
}

let leafMat = null, barkMat = null;
// Alpha-tested and double-sided; both faces of a card take its crown normal. Mipmaps average leaf alpha toward
// nothing, so distant crowns would thin out to twigs: the alpha is raised with the mip level to keep them full.
export function leafMaterial() {
  if (leafMat) return leafMat;
  // the colour mutes the photographed leaves toward the olive of a summer seen through haze
  const m = leafMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(0.8, 0.78, 0.66), vertexColors: true, side: THREE.DoubleSide, alphaTest: 0.5 });
  m.visible = false; // bare cards would draw as solid squares until the atlas arrives
  m.onBeforeCompile = (shader) => {
    foliageFog(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <map_fragment>', `#include <map_fragment>
	vec2 leafDx = dFdx( vMapUv * 1024.0 ), leafDy = dFdy( vMapUv * 1024.0 );
	diffuseColor.a *= 1.0 + 0.3 * max( 0.0, 0.5 * log2( max( dot( leafDx, leafDx ), dot( leafDy, leafDy ) ) ) );`)
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n\tnormal = normalize( vNormal );');
  };
  loadTexture('foliage.webp', (tex) => {
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    m.map = tex; m.visible = true; m.needsUpdate = true;
  });
  return m;
}
export function barkMaterial() {
  if (barkMat) return barkMat;
  const m = barkMat = new THREE.MeshLambertMaterial({ vertexColors: true, color: 0x5e5246 });
  m.onBeforeCompile = foliageFog;
  loadTexture('bark', (tex) => { m.map = tex; m.color.setRGB(0.95, 0.92, 0.88); m.needsUpdate = true; });
  return m;
}
