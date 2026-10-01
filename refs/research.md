# Procedural miniature models in three.js: research for Three Crossroads

Date: 2026-10-01. Installed three: 0.186.1 (REVISION 186). Everything marked "verified" was run or read in this session
against `node_modules/three` or the repo. Anything taken from a search summary or a page I could not open is marked
"unconfirmed". Scripts used for the measurements: `/tmp/ww2-models/work/` (`proto3.mjs`, `kit-sketch.mjs`, `exports.mjs`;
run from that directory, its `node_modules` is a symlink to the repo's) and `/tmp/ww2-models/measure.mjs` (copy it to the
repo root to run it, so `three` resolves). The Muster files I read are in `/tmp/ww2-models/muster/`. The repo itself was not
modified.

## 0. Read this first

1. **Draw calls, not triangles, are the limit at 1000 soldiers.** Today every soldier is one mesh, so 1000 soldiers is
   1000 draws, and each vehicle is 2 draws (hull and turret) plus 2 more in the shadow pass. Triangles are cheap: one
   rifleman is 608 triangles, so 1000 of them all near is about 0.6M, which a laptop GPU handles. Section 6 has the budget.
2. **The current soldier spends its triangles on the wrong things.** Of its 608 triangles, 388 are the smooth head sphere
   (168) and two helmet domes (110 + 110). The legs, arms and pack that make a silhouette read are missing. A prototype
   with torso loft, two legs, boots, two arms, pack, rifle, helmet and a 12-sided base is 352 triangles (verified).
3. **Vehicles are nearly free today** (tank 108, medium tank 120, Tiger 120, armored car 372, rocket 684 triangles) and
   can grow to 450 to 1200 triangles each. A prototype tank with a sloped side-profile hull, extruded track belts,
   wheel discs and a lofted turret is 460 triangles in two draws (verified).
4. **Everything needed exists in three 0.186.1.** Core build: `LatheGeometry`, `ExtrudeGeometry` (with bevels),
   `TubeGeometry`, `CapsuleGeometry`, `BatchedMesh`, `InstancedMesh`, `LOD`. Addons (examples/jsm):
   `RoundedBoxGeometry`, `LoftGeometry` (present in 0.186.1), `DecalGeometry`,
   `BufferGeometryUtils.{mergeGeometries, mergeVertices, toCreasedNormals}`. The addons import only from `'three'`, so they
   work with a small server mapping (section 2).
5. **Shadow proxies through layers do not work** (verified in `WebGLShadowMap.js`: layers are tested against the main
   camera, not the shadow camera). Do not plan a cheap shadow-only mesh that way.
6. **Best reference found: Muster (Kenton-GMI/muster-ww2, MIT).** It procedurally models WWII tanks, aircraft, guns and
   soldiers in three.js with the same addon set and documents its helpers. It targets collector-grade detail (up to
   500k triangles per tank), so copy its techniques and dimensions, not its triangle counts.

## 1. What the game does now (measured)

Models are built from `part()` objects and baked by `mergeParts()` into one vertex-coloured mesh per soldier, hull or
turret with one shared `MeshLambertMaterial({ vertexColors: true })`. Lighting is a warm directional sun (3.2),
a hemisphere fill (0.9), `NeutralToneMapping`, and a ShaderLib patch that adds 10% saturation. Soldiers cast no shadow;
vehicles do. `client/aircraft.js` has its own `merge()` (non-indexed) and builds fuselages with `LatheGeometry` and wings
as flat extruded planform slabs.

Triangle counts of the current baked models (run in Node from the repo, faction 0, `measure.mjs`):

| Model | Near triangles | Draws | Notes |
|---|---|---|---|
| rifleman | 608 (485 verts) | 1 | far LOD 140. Head sphere 168, two helmet domes 110 each, capsule body 144, base 64, rifle 12 |
| rifle squad (5 men) | 3040 | 5 | |
| tank / medium / tiger | 108 / 120 / 120 | 2 | boxes and one 12-sided barrel |
| armored car / mobile flak | 372 | 2 | 12-sided cylinder wheels (48 each) |
| rocket launcher | 684 | 2 | |
| fighter / attacker / bomber | 546 to 634 / 724 to 914 / 1180 to 1500 | 1 + props | non-indexed |

Source primitives in `unit-models.js`: Box 12, Cylinder(12 sides) 48, Capsule(4,8) 144, helmet hemisphere(10x6) 110,
Sphere(12x8) 168, base cylinder(16) 64.

On-screen size (verified arithmetic, 1080 lines, fov 42 degrees, so 1407 px per metre at 1 m distance). The camera looks
down at 0.95 rad (54 degrees, `PITCH` in main.js:839) and the default distance is 85 m, minimum 25 m. Vertical
features shrink by about cos(54) = 0.59 when seen from above; horizontal ones keep most of their size. Values are pixels
across the object at distance 25 / 50 / 75 / 110 / 150 m:

| Object (world size) | 25 | 50 | 75 | 110 | 150 |
|---|---|---|---|---|---|
| soldier, 2.1 m tall (1.55 model height x 1.35 scale) | 118 | 59 | 39 | 27 | 20 |
| rifle, 1.35 m | 76 | 38 | 25 | 17 | 13 |
| helmet width, 0.73 m | 41 | 21 | 14 | 9 | 7 |
| head, 0.51 m | 29 | 14 | 10 | 7 | 5 |
| base, 0.97 m | 55 | 27 | 18 | 12 | 9 |
| medium tank, 5.0 m | 281 | 141 | 94 | 64 | 47 |
| fighter span, 9.4 m | 529 | 264 | 176 | 120 | 88 |

So the "20 to 40 px soldier" is the default view (about 35 px tall at 85 m, about 21 px after foreshortening).
At 110 m, the far-LOD switch, a 400-triangle soldier is about 1 triangle per pixel; the GPU shades 2x2 quads, so a
triangle that touches one pixel wastes 75% of that quad's work (gamedeveloper.com, "GPU Performance for Game Artists",
opened). That is the reason to keep the far model near 100 triangles.

## 2. What three 0.186.1 provides, and how to use the addons

Verified by `exports.mjs` (import of `three`) and by listing `examples/jsm`.

| Need | Where | Status |
|---|---|---|
| `LatheGeometry(points, segments, phiStart, phiLength)` | build | yes |
| `ExtrudeGeometry(shape, { depth, bevelEnabled, bevelThickness, bevelSize, bevelOffset, bevelSegments, steps, curveSegments, extrudePath })` | build | yes. `extrudePath` disables bevels |
| `TubeGeometry(path, tubularSegments, radius, radialSegments, closed)`, `CapsuleGeometry(r, h, capSegments, radialSegments, heightSegments)` | build | yes |
| `Shape`, `Path` (with `holes`, `absarc`), `ShapeUtils`, `CatmullRomCurve3`, `CubicBezierCurve3` | build | yes |
| `InstancedMesh` (with `setMorphAt`, `morphTexture`), `BatchedMesh` (`addGeometry`, `addInstance`, `setGeometryIdAt`, `setColorAt`, `setVisibleAt`), `LOD` | build | yes. `BatchedMesh` has no morph support |
| `RoundedBoxGeometry(w, h, d, segments, radius)` | `three/addons/geometries/RoundedBoxGeometry.js` | addon, imports only `three`. Clamps the radius itself. Non-indexed |
| `LoftGeometry(sections, { closed, capStart, capEnd })` | `three/addons/geometries/LoftGeometry.js` | addon, imports only `three`. Sections are arrays of `Vector3` with equal point counts |
| `mergeGeometries`, `mergeVertices`, `toCreasedNormals(geometry, creaseAngle = PI/3)`, `computeMorphedAttributes`, `estimateBytesUsed` | `three/addons/utils/BufferGeometryUtils.js` | addon, imports only `three` |
| `DecalGeometry(mesh, position, orientation, size)` | `three/addons/geometries/DecalGeometry.js` | addon, imports only `three` |
| `ConvexGeometry` | `three/addons/geometries/ConvexGeometry.js` | addon, imports `../math/ConvexHull.js` (needs the whole directory mapped) |
| `SceneOptimizer` (experimental auto-batching into `BatchedMesh`) | `three/addons/utils/SceneOptimizer.js` | addon, exists; not evaluated |

`MeshLambertMaterial` has a `flatShading` flag, and `FLAT_SHADED` is handled in `normal_fragment_begin`. With baked
normals you rarely need it: choose crisp or smooth per part with `toCreasedNormals` instead.
Shader detail relevant to team colours: `color_vertex.glsl.js` multiplies `vColor` by the vertex colour and then by
`instanceColor`, so an instance colour tints the whole mesh, not a part of it.

### Serving the addons

`server.js:58` maps `/vendor/` to `node_modules/three/build` and the importmap in `client/index.html:236` only has
`three`. Two ways to get addons:

```js
// server.js: one more static prefix ('/vendor/' does not match '/vendor-addons/', so the two do not collide)
const STATIC = { '/client/': 'client', '/shared/': 'shared', '/vendor/': 'node_modules/three/build',
  '/vendor-addons/': 'node_modules/three/examples/jsm' };
```
```html
<script type="importmap">{ "imports": { "three": "/vendor/three.module.js", "three/addons/": "/vendor-addons/" } }</script>
```

Then `import { LoftGeometry } from 'three/addons/geometries/LoftGeometry.js'` works in the browser. In Node (the tests)
the same specifier resolves through the package `exports` map (`"./addons/*": "./examples/jsm/*"`); verified by
running it. The browser side is not tested here (no browser run), so confirm in Chrome once. The addon files ship in the
npm package (`"files": ["build", "examples/jsm", ...]`), so a normal `npm ci` provides them.

Alternative with no server change: copy `BufferGeometryUtils.js` (37 KB), `LoftGeometry.js` (9 KB) and
`RoundedBoxGeometry.js` (6 KB) into `client/vendor/` and import them relatively. This pins them and loses version
upgrades. Either is fine; the mapping is less code to maintain.

## 3. Recommended techniques, with sketches for `part()` / `mergeParts()`

All helpers below are in `/tmp/ww2-models/work/kit-sketch.mjs` and ran against three 0.186.1 in Node; the triangle
counts quoted are from that run. Suggested home: a new `client/model-kit.js` that `unit-models.js` and `aircraft.js` import.

### 3.1 Build shapes at final size and cache them

A non-uniform `part()` scale stretches a bevel. The thirdfold project says so directly ("shapes are built at world
size before transformation to prevent bevel stretching", github.com/tougenrip/thirdfold/issues/190, opened). Build the
bevelled shape for its real dimensions and call `part(geo, color)` with scale 1.

```js
const memo = new Map();
export const cached = (key, make) => memo.get(key) ?? memo.set(key, make()).get(key);
```

### 3.2 Hard edges where armor meets, smooth where metal curves: `crease()`

`toCreasedNormals(geometry, creaseAngle)` smooths normals between faces closer than the angle and keeps hard edges
above it. It returns non-indexed geometry (verified in the source, line 1315), so re-index with `mergeVertices`. The
forum thread that introduced it warns that UVs and other attributes tied to shared vertices can break
(discourse.threejs.org/t/37679, opened); we use vertex colours merged afterwards, so this does not apply. The Muster
project uses the same recipe with 35 to 55 degrees; thirdfold uses about 50.

```js
import { mergeVertices, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
export const crease = (g, deg = 50) =>
  mergeVertices(toCreasedNormals(g.index ? g.toNonIndexed() : g, THREE.MathUtils.degToRad(deg)), 1e-6);
```

Use about 50 degrees for armor and boxes with bevels (the bevel facets blend, the big faces stay flat) and 60 to 70 for
organic things (helmet, torso). `mergeParts()` already handles indexed and non-indexed input and mirrored parts
(negative determinant flips the winding), so crease output goes straight in.

### 3.3 Bevelled boxes: sparingly

```js
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
export const bevelBox = (w, h, d, r = 0.05) =>
  cached(`bb|${w}|${h}|${d}|${r}`, () => crease(new RoundedBoxGeometry(w, h, d, 1, r), 50));
```

Measured: `RoundedBoxGeometry` with 1 segment is 108 triangles (vs 12 for a plain box), 2 segments 300, 3 segments 588.
Bevelling the two boots, the pack and the rifle took the soldier prototype from 352 to 728 triangles, so use
`bevelBox` only for the 3 to 6 biggest masses of a vehicle and use plain boxes for small parts. At 20 to 40 px a bevel
only shows as a light edge, so also consider faking it with colour (3.8).

### 3.4 Extruded outlines for armor: `plate()`

A hull side view, a gun shield, a fin or a skirt is an outline with thickness. `ExtrudeGeometry` with `bevelSegments: 1`
gives a chamfered slab. The sloped glacis, the stepped engine deck and the nose come from the outline, not from tilted
boxes. Muster's `plate(outline, thickness, plane, bevel)` is the same idea (docs/ASSET_GUIDE.md, opened).

```js
export const plate = (pts, thick, bevel = 0.04) => cached(`pl|${pts.join()}|${thick}|${bevel}`, () => {
  const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y))), b = Math.min(bevel, thick / 2 - 1e-4);
  const g = new THREE.ExtrudeGeometry(s, { depth: thick - 2 * b, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b,
    bevelOffset: -b, bevelSegments: 1, curveSegments: 3 });
  return crease(g.translate(0, 0, -(thick - 2 * b) / 2), 50);   // extruded along z, centred
});
// medium tank hull: side view, x forward, y up, 2.2 m wide
g.add(part(plate([[-2.25, 0.25], [2.4, 0], [2.5, 0.42], [1.4, 1.0], [-2.0, 1.0], [-2.5, 0.7]], 2.2), hull, 1, 1, 1, 0, 0.7, 0));
```

`bevelOffset: -b` keeps the outer size equal to the outline. A 5-point outline is 36 triangles; a 7-point hull profile
with the track belts and wheel discs was 372 (verified). Keep `curveSegments` at 1 to 3, since the default is 12.

### 3.5 Lofts: fuselage, wing, turret, torso

`LoftGeometry` (addon, present in 0.186.1) skins a surface through sections. Each section is an array of `Vector3`
with the same point count. It computes normals itself and averages them across the closed seam. Important: it expects
each ring counterclockwise as seen from the end of the loft looking back, and the result is inside out otherwise. Do
not guess: test it, as `loft()` below does. Muster ships the same guard (`ensureOutward`), and the scottstts skill
describes an "orientation guard that catches inside-out closed bodies".

```js
import { LoftGeometry } from 'three/addons/geometries/LoftGeometry.js';
export const ring = (a, b, n = 8, e = 2.6) => Array.from({ length: n }, (_, i) => {   // superellipse, e=2 ellipse, 4 squarish
  const t = (i + 0.5) / n * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
  return [a * Math.sign(c) * Math.abs(c) ** (2 / e), b * Math.sign(s) * Math.abs(s) ** (2 / e)]; });
const facesOut = (g) => { g.computeBoundingBox(); const c = g.boundingBox.getCenter(new THREE.Vector3()), P = g.attributes.position,
  N = g.attributes.normal, t = new THREE.Vector3(), n = new THREE.Vector3(); let s = 0;
  for (let i = 0; i < P.count; i++) s += Math.sign(t.fromBufferAttribute(P, i).sub(c).dot(n.fromBufferAttribute(N, i))); return s > 0; };
// stations: [{ at: [x, y, z], ring: [[u, v], ...] }]. axis 'x': u = z, v = y (fuselage). axis 'z': u = x chord, v = y (wing, root to tip).
// axis 'y': u = x, v = z (turret, torso, helmet stacked upward).
export const loft = (stations, { axis = 'x', caps = true, deg = 55 } = {}) => {
  const secs = stations.map(({ at: [x, y, z], ring: r }) => r.map(([u, v]) => axis === 'x' ? new THREE.Vector3(x, y + v, z + u)
    : axis === 'z' ? new THREE.Vector3(x + u, y + v, z) : new THREE.Vector3(x + u, y, z + v)));
  let g = new LoftGeometry(secs, { closed: true, capStart: caps, capEnd: caps });
  if (!facesOut(g)) g = new LoftGeometry(secs.map((s) => s.slice().reverse()), { closed: true, capStart: caps, capEnd: caps });
  return crease(g, deg);
};
```

Verified counts: fuselage, 5 stations x 10 points, 96 triangles; wing half, 4 stations x 12-point airfoil, 92 triangles;
turret, 3 rings x 8 points with caps, 44 triangles. All came out outward-facing. Cap vertices are not shared with the wall,
so the cap edge stays hard (stated in the source).

Fuselage recipe (Muster's Bf 109 does it at high detail, `bf-109-g6/fuselage.ts`, opened): keep three tables of
station curves, top height, bottom depth and half width, sample them at 8 to 10 stations bunched toward the nose and
tail, and make a superellipse ring from each. The scottstts `threejs-procedural-geometry` skill adds two tips from its
vehicle reference that apply even at low poly: interpolate the curves with a monotone cubic (Fritsch-Carlson) so a
per-segment ease does not print terraces on the surface, and bias station spacing toward the ends where curvature is
highest. Raise the top curve for two stations to make a cockpit hump instead of adding a dome part.

Wing recipe: a loft along the span axis through airfoil rings. NACA 4-digit half thickness (Wikipedia "NACA airfoil",
opened): `yt = 5t(0.2969 sqrt(x) - 0.1260 x - 0.3516 x^2 + 0.2843 x^3 - 0.1015 x^4)`, x in 0..1 of the chord, t the
thickness ratio. Use cosine spacing so the leading edge gets the points (Muster's `cosSpace`).

```js
export const nacaT = (x, t) => 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1015 * x ** 4);
export const airfoil = (chord, t, n = 6) => { const up = [], lo = [];
  for (let i = 0; i <= n; i++) { const u = 0.5 * (1 - Math.cos(Math.PI * i / n)); up.push([-u * chord, nacaT(u, t) * chord]); lo.push([-u * chord, -nacaT(u, t) * chord]); }
  return [...up.reverse(), ...lo.slice(1, -1)]; };                      // 2n points, leading edge at x = 0, trailing edge at x = -chord
// one wing half: [spanZ, chord, thickness, sweep, rise] per station; at.x is the leading-edge x
const wingR = loft([[0, 3.6, .15, 0, 0], [1.5, 3.2, .14, -.2, .08], [3.2, 2.2, .12, -.55, .3], [4.5, 1.2, .10, -.95, .5]]
  .map(([z, ch, t, sweep, rise]) => ({ at: [sweep + ch / 2, rise, z], ring: airfoil(ch, t) })), { axis: 'z' });
// the other half: part(wingR, color, 1, 1, -1)  (mergeParts flips the winding for negative scale)
```

Dihedral, inverted gull and gull wings are just the `rise` column: Ju 87 has negative dihedral inside and positive
outside (Wikipedia "Junkers Ju 87", opened: "inverted gull, or cranked, wing"); the B-25 has dihedral only inside and a flat
outer wing ("gull wing", Wikipedia B-25, opened).

### 3.6 Lathe, capsule and tapered cylinders

Lathe for rotationally symmetric parts: helmet shell, spinner and cowling, road-wheel discs, shell casings, barrels with
a muzzle brake step, ammo drums. A 5-point profile at 8 segments is 64 triangles (80 for 6 points), counting the one
degenerate triangle per segment that a point on the axis produces. Tapered `CylinderGeometry(rTop, rBottom, h, 5 or 6)` is the cheapest limb or barrel
(24 triangles at 6 sides). Use `CapsuleGeometry` only at 1 cap segment and 6 sides (36 triangles; the current
4-segment, 8-side capsule is 144). `TubeGeometry` has a constant radius, so use it for bent things only (slings, hoses,
a curved trail), not barrels.

### 3.7 Tracks: an extruded belt, not links

A track run is a stadium or convex-hull outline around the wheel circles. Extrude it across the track width with a
1-step bevel. Verified: a solid stadium belt with `curveSegments: 3` and a bevel is 108 triangles including caps. Do not
cut a hole for the inside: the same belt with a hole was 224 triangles, and 288 at `curveSegments: 4`. Put 8-sided `CircleGeometry(r, 8)` wheel discs
(8 triangles each) on the outer face in a darker colour. Muster's track solver (`panzer-iv-h/track.ts`, opened) builds
the path as tangent lines between circles for bottom run, wheels, idler, return rollers and drive sprocket with a small
sag on the upper run; at our scale compute only the convex hull of the sprocket, idler and end wheels, and add a sag
as a slight dip in the top edge if the type has no return rollers worth drawing.

```js
const belt = (L, R, w) => { const s = new THREE.Shape(); s.moveTo(-L, -R); s.lineTo(L, -R); s.absarc(L, 0, R, -Math.PI / 2, Math.PI / 2, false);
  s.lineTo(-L, R); s.absarc(-L, 0, R, Math.PI / 2, -Math.PI / 2, false); const b = 0.04;
  return crease(new THREE.ExtrudeGeometry(s, { depth: w - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 1, curveSegments: 3 })
    .translate(0, 0, -(w - 2 * b) / 2), 50); };
```

Tracks that move: the game has no scrolling tracks and `test.js` limits vehicles to 1 to 3 draws, so keep one painted
belt and let the hull and turret be the two draws.

### 3.8 Paint in the vertex colours: wash, drybrush, edge highlight, AO

The art direction is a painted miniature. The painter's steps map to vertex colours:

| Painter's step (oldguardpainters.com, opened) | Vertex colour equivalent |
|---|---|
| Basecoat | the part colour you already pass to `part()` |
| Wash: shade flows into recesses | baked AO: darken vertices in crevices, under the hull, between arm and torso |
| Drybrush: lighter paint catches raised surfaces | lighten vertices whose normal points up (`ny > 0.7`) by 8 to 14% |
| Edge highlight: a thin light line on sharp edges | lighten the bevel-ring vertices (where the creased normal differs from the face normal) by about 8% |
| Layering: restore light after shading | the sun does this; keep the AO floor at 0.55 or higher |

Thirdfold bakes exactly this for its miniature shader: `toCreasedNormals` at about 50 degrees per part, per-vertex AO
from 24 to 32 cosine-weighted rays marched up to about 0.5 units, a floor plane at y = 0 for contact darkening, and a
"convexity" value (signed mean angle between creased normal and adjacent face normals) that feeds the drybrush (issue
#190, opened). It stores AO and convexity as a byte attribute and applies AO only to ambient light. We can bake into
colours, which also darkens direct light, so use a milder floor.

A cheap value structure that costs nothing: multiply the colour by a height ramp so feet and tracks are darker and the
chest and turret roof lighter (the TF2 paper is reported to use a dark-feet to light-chest gradient; unconfirmed, the
paper is image-only and I could not read it). Valve's own wiki summary, which I opened, confirms the silhouette and rim
rules: each class has a unique silhouette that stays identifiable without lighting.

Runtime AO bake (verified, `bakeAO` in `kit-sketch.mjs`): 12 cosine-weighted rays per vertex, brute-force ray against the
merged triangles with a per-vertex candidate list (triangles whose box is within `reach`), the ground plane at y = 0
counts as a hit, result multiplies the `color` attribute (`floor + (1 - floor) * visibility`). Timings in Node on this
machine: soldier 521 vertices 25 ms (first run includes JIT warm-up), tank hull 536 vertices 7 ms, turret 123 vertices
0.7 ms. Without the candidate list the soldier took 90 ms and the hull 131 ms. Rule: compute AO once per shape key,
independent of owner colour, cache it as a `Float32Array` per vertex and multiply when baking each owner's colour
variant. About 50 shape keys (types x factions x kit) would cost about 1 s in total if baked lazily on first use. It is
deterministic (golden-angle directions), which keeps the Node tests stable.

```js
// signature and contract; full tested body in kit-sketch.mjs
bakeAO(mergedGeometry, { rays: 12, reach: 0.5, floor: 0.55, ground: true });   // mutates attributes.color in place
```

Soldier reach 0.4, vehicle hull 0.8, turret 0.6 (model units). Do not bake AO into the far LOD; its tiny triangles do not
show it, and a flat height ramp is enough.

### 3.9 Markings: colour bands first, quads second, DecalGeometry last

- **Colour bands in lofts**: give each loft station its own colour. Invasion stripes, nose bands, tail tips and the
  national colour on a wingtip then cost zero extra triangles. Split a loft where a band starts so the colour changes at
  a ring.
- **Flat quads**: the aircraft kit already does this (stacked flat boxes offset 0.025). For a star or cross use a 10-triangle
  `ShapeGeometry` star, or two thin boxes for a cross, offset 0.02 to 0.03 from the surface. The camera looks down at 54
  degrees, so put the main marking on the turret roof, the engine deck and the wing tops.
- **`DecalGeometry`** (addon, verified present) clips the target mesh's triangles to a box, so on a low-poly target it
  produces a few large flat pieces that do not wrap. Not worth it here.

### 3.10 Poses: author geometry per pose instead of squashing

The current posture code rotates and scales the whole soldier (crouch is `scale.y = 0.74`) and morphs only the base
vertices to keep the base level. Cleaner: build the same part list once per pose, so all poses have identical topology,
and attach them as morph targets. The base is then identical in every pose and `levelBase()` is not needed.

```js
export function posedGeometry(makeParts, poses) {            // makeParts(pose) -> parts array for mergeParts()
  const gs = poses.map((p) => mergeParts(makeParts(p), true)), g = gs[0];
  for (const o of gs) if (o.attributes.position.count !== g.attributes.position.count) throw new Error('same vertex count needed');
  g.morphAttributes.position = gs.slice(1).map((o) => o.attributes.position);
  g.morphAttributes.normal = gs.slice(1).map((o) => o.attributes.normal);
  return g;
}
```

Morph semantics, verified with `computeMorphedAttributes` (non-relative targets, which is what the game uses): weight 1
gives the target, 0 the base, and -1 gives `2 * base - target`, a mirror about the base. That allows a walk cycle from
one "stride" target with a weight that swings between -1 and 1, if the base has the legs together. Not run in the
browser, so treat the walk as an idea, not a result. Vertex count stays the same, so memory cost is about 4 buffers per
soldier variant (around 48 KB for 500 vertices with normals).

Integration facts to keep: `animate()` still needs a weapon point per pose (the muzzle position `HAND` and `POSES[k][4..5]`),
`levelBase(g, n)` must receive the real vertex count of the base after any change to its geometry, and the base must stay
first in the part list.

### 3.11 LOD and instancing

- Soldiers: keep the two-model swap (110 m on High, 80 m on Low). Far model: a base, a box torso, a box legs block and a
  20-triangle head with helmet. Prototype far soldier: 76 triangles (verified).
- Vehicles: add a far model at 110 m or more (hull block plus turret block plus barrel, 120 to 200 triangles). A medium
  tank is still 64 px long at 110 m, so the silhouette must stay right: keep the glacis slope, the turret offset and the
  barrel.
- Instancing for soldiers, only if draw calls become the bottleneck (section 6): one `InstancedMesh` per
  (type, faction, kit, LOD). `InstancedMesh.setMorphAt(index, mesh)` and `morphTexture` exist in 0.186.1 and carry the
  posture weights per instance (verified in the source and by running it). Allocate the instance count at its maximum
  at construction: `setMorphAt` creates the morph texture with `len * this.count` rows on first use. `BatchedMesh` has
  no morph support, but `setGeometryIdAt` can swap an instance between pose or LOD geometries without a morph.
  Team colour on instanced meshes needs a mask: write a 0/1 `team` vertex attribute and mix `instanceColor` into
  `vColor` through `onBeforeCompile`, because the stock `instanceColor` multiplies everything (verified in
  `color_vertex.glsl.js`).
- A cheaper first step that keeps the scene graph: `matrixAutoUpdate = false` on the static `pose` and `man` nodes and
  update them only when the posture or position changes (forum thread on 100 to 1000 skinned meshes, opened, lists
  `matrixWorldAutoUpdate = false` among the fixes).
- Do not use layers for shadow-only proxies (see section 0, item 5).

## 4. Tips per model family

### 4.1 Soldiers at 20 to 40 px

What reads at 27 to 39 px (110 to 75 m, see section 1): the helmet silhouette (9 to 14 px wide), shoulder width,
the rifle line (17 to 25 px), the pack bump, the gap between the legs, and the base ring. The face is 5 to 10 px: a
light skin patch under the helmet is enough. Fingers, straps and buckles are below one pixel.

- **Heroic proportions.** Tabletop miniatures push head, hands and weapons larger so they read across a table
  (battlehonours3d.com, opened: heroic scale has enlarged heads, hands, thicker barrels and stocks, broader torso).
  A search summary gives about 1.3x head and 1.5x hands; unconfirmed. The current head already is 25% of the model
  height, so do not enlarge it more; spend on shoulders, rifle thickness and boots instead.
- **Silhouette first, one distinct feature per faction** (TF2 rule: unique silhouette per class, wiki opened):
  - USA: round M1 pot with a flat brim; rifle across the body; small rear pack; leggings give a boot step.
  - Germany: Stahlhelm with a flared skirt and a neck guard (Wikipedia "Stahlhelm", opened: flared visor and skirt,
    reduced on the M1935/M1940, ventilator lugs); Y-straps, bread bag and canteen on the right rear hip, gas-mask
    canister, entrenching tool at the left hip (Muster infantry brief, opened).
  - USSR: SSh-40 dome helmet or pilotka cap; the rolled greatcoat (skatka) worn as a loop over the left shoulder is the
    strongest Soviet silhouette cue; a small veshmeshok sack on the back; PPSh drum on the submachine gunner
    (Muster infantry brief, opened).
- **Class cues** the code already has (rifle, SMG, ghillie cape, pack and shovel, ammo box, bazooka tube). Make them
  larger rather than more detailed: an MG team is a bipod gun plus an ammo box (the current box, 0.3 x 0.25 x 0.22 in
  model units, is about 5 px wide at 110 m; make it about 7).
- **Value structure**: boots dark, trousers a step darker than the tunic, helmet crown lighter (already done), skin a
  warm light dot, pack and webbing one step off the uniform. Baked AO under the pack and between arm and torso.
- **Triangle plan, about 350 to 450 near** (prototype, verified at 352): 12-sided base 48, torso loft (4 rings x 8) 60,
  two 6-sided legs 48, two box boots 24, two 5-sided arms 40, icosahedron head (detail 0) 20, helmet lathe 8 segments
  64, pack box 12, rifle box 12, canteen cylinder 24.
- **Poses**: stand, crouch (knees bent, torso forward), prone (lying, head toward the target), lean-forward run, with
  authored geometry (3.10). Keep the base flat in all of them.
- **Gun crews**: the gun is a separate baked mesh (one draw); crew soldiers stay 350 to 450.

### 4.2 Tanks, armored cars, self-propelled guns

Dimensions from Wikipedia pages I opened (length x width x height, metres): M4 Sherman 5.84 to 6.27 x 2.62 x 2.74
(rounded cast upper hull on the M4A1); T-34 6.68 x 3.00 x 2.46 (60 degree glacis, hexagonal turret from 1942,
external fuel tanks on the hull sides, no return rollers); Panzer IV Ausf. H 5.92 (7.02 with gun) x 2.88 x 2.68
(eight small road wheels per side in leaf-sprung bogie pairs, 3 or 4 return rollers, offset turret, 80 mm front, 5 mm hull
skirts and 8 mm turret skirts, later wire mesh); Tiger I 6.316 (8.45 with gun) x 3.56 x 3.00 (flat vertical plates,
interleaved wheels: eight suspension arms per side with three wheels each, 800 mm wheels). The game's hulls are about
80% of real length, the same convention as the aircraft comment, so keep ratios and shrink uniformly.

- **Hull**: side-profile `plate()` (3.4). Sloped types (T-34, T-70, Sherman) get the slope in the outline; Tiger and
  Panzer IV get near-vertical fronts with a small step. Add a second plate or two boxes for fenders and sponsons from
  the top view. An engine deck step at the rear reads from above.
- **Turret**: 3-ring loft (3.5): wide base ring, 0.9 ring at 60% height, 0.65 ring at the roof, offset the roof ring
  forward for a sloped front. A bevelled mantlet box and a hatch cylinder. Panzer IV: turret offset; T-34: hexagonal
  ring (n = 6); Sherman: rounder ring (e = 2.2, n = 10).
- **Barrel**: tapered 8-sided cylinder, length from the table above (Tiger gun reaches 2.1 m past the hull); a muzzle
  brake as a short wider cylinder or two stacked discs on Tiger and Panzer IV. The barrel tip for `fx.js`
  (`barrelTip()` looks for a `GEO.cyl` child rotated by PI/2) must then be set explicitly as `v.fxTip`, because the
  tapered cylinder will not be recognised.
- **Running gear**: belt (3.7) plus wheel discs. Per type: Panzer IV eight small wheels in four pairs and three return
  rollers drawn as 3 small discs on the top run (Wikipedia); Tiger a wall of large overlapping discs in two staggered rows
  (eight suspension arms per side, three wheels each, Wikipedia); T-34 no return rollers (Wikipedia) and five large
  wheels (general knowledge); Sherman six wheels in three bogies (general knowledge, the page I opened did not give the
  count); armored cars: 6 discs (M8) or 4 (Sd.Kfz. 222, BA-64) as 8-sided cylinders (the game's `wheels` field already
  encodes this). Use 8-sided cylinders (32 triangles with caps) or open-ended ones (16) for wheels that are only seen from the side.
- **Skirts**: Panzer IV gets thin side plates with a notched top edge (one `plate()` each side, about 36 to 60 triangles)
  and a turret skirt ring: instant identification and nearly free.
- **Open-top flak and rocket variants**: an 8-sided ring loft without caps for the turret tub, 4 thin barrels (Wirbelwind,
  M16) or a box of tubes with a darker face of 3 x 4 disc ends (Calliope), two rows of 5 for the Panzerwerfer, rails
  for the Katyusha truck.
- **Top-down emphasis**: with the camera 54 degrees above the table, the turret roof, engine deck and glacis are what the
  player sees. Put the markings (US white star, German cross, Soviet star or turret number) there, 10 to 20 triangles.
- **Budgets**: light tank 450 to 600, armored car 400 to 500, medium 700 to 900, Tiger 1000 to 1200, mobile flak and
  rocket 600 to 800. The prototype (side hull 372 including both belts and 10 wheel discs, turret 88 with mantlet and
  barrel) lands at 460.

### 4.3 Aircraft

Today: lathe fuselage (10 radial segments, optionally oval) plus flat extruded planform slabs, 546 to 1500 triangles.
Planes fly at about 20 m, are 8 to 18 m across (88 to 529 px at 150 to 25 m for a fighter), and there are few of them, so
this is the family with the most triangle room: 800 to 1000 fighter, 1000 to 1300 attacker, 1600 to 2200 bomber.

- Fuselage: loft with a superellipse ring (3.5). P-47: deep barrel, e = 2 to 2.2 and a large ring (Wikipedia P-47,
  opened: deep barrel-shaped fuselage, turbosupercharger ducting, exhaust pipes along the cockpit). Bf 109: narrow
  and squarish, e = 3. Add a dark ring at the cowling lip and exhaust stubs as 4 small boxes.
- Wings: airfoil loft (3.5) with taper, sweep and dihedral per station. Elliptical planform for the P-47 and the early
  He 111 (the existing `ellipse()` helper gives the chord; use it to generate stations); straight tapered for the later He 111
  (Wikipedia He 111, opened); inverted gull for the Ju 87 with fixed spatted gear and sirens on the legs; gull wing
  for the B-25, twin fins, glazed nose. Bf 109: short straight-tapered wing (Muster models the F/G rounded tip in
  `bf-109-g6/wing.ts`).
- Cockpit: raise the top curve and paint 2 stations in glass colour (vertex colour), plus a frame stripe; the He 111 has
  a stepless glazed "greenhouse" nose (Wikipedia, opened) which is a few station colours at the front.
- Propeller: keep the thin boxes and the translucent disc, add a lathe spinner (8 to 10 triangles at 5 segments).
- Marking: colour bands in the loft for roundel bands and tail tips; keep the existing flat insignia for the top of the wings.
- Shadow: the soft ground-shadow quad built from `polys` stays.
- Muster notes for accuracy (Bf 109 wing code, opened): NACA 2R1 section at 14.2% root and 11.35% tip, 6.5 degrees
  of dihedral outside a flat centre section, rounded tip.

### 4.4 Artillery and guns (AT gun, flak, mortar, MG)

Values from the Pak 40 (Wikipedia "7.5 cm Pak 40", opened: shield of three flat plates; split-trail carriage; barrel
3.45 m; overall length 6.2 m; width 2.08 m; height 1.2 m) and Muster's `pak-40/layout.ts` (opened, unconfirmed against a
primary source): shield sloped 18 degrees from vertical, side wings folded back 25 degrees, two 4 mm plates 25 mm apart,
trails spread 26 degrees each side when deployed, wheel diameter 885 mm, wheel track about 1.6 m, firing height 960 mm,
barrel with a two-baffle muzzle brake. The ZiS-3 (Wikipedia, opened) is a split-trail gun with a prominent muzzle brake
on a light carriage, 3.4 m barrel, 1.37 m high.

- **Shield**: three `plate()` outlines (centre plate plus two wings folded back 25 degrees, the whole set leaning 18
  degrees), about 40 triangles each, a barrel slot cut as a gap between two box plates instead of a hole (a hole adds
  triangles that are invisible at 30 px). Make it tall: it is the first thing seen from the front and above.
- **Trails**: two long thin plates (or 5-sided tapered cylinders) spread 26 degrees from the carriage, with a dark spade
  block at the end. From above the V of the trails is the identifier of an AT gun.
- **Wheels**: 8-sided cylinder discs (32 triangles) with a lighter hub disc; Pak 40 wheels are full pressed-steel discs
  with solid rubber tyres, so no spokes needed.
- **Barrel and brake**: tapered 8-sided cylinder, brake as two stacked short discs.
- **Mortar**: baseplate (flat 6-sided disc), tube, bipod of two thin cylinders. **MG**: bipod or tripod and an ammo box.
  **Flak**: the gun on a cruciform platform with outriggers, twin barrels pointed up.
- **Budget**: 250 to 400 triangles per gun, as its own baked mesh in one draw, plus crew.

## 5. Skills and repositories found

Local skills: `~/.claude/skills` and `~/.agents/skills` contain no three.js modelling skill. The only three.js file is
`hyperframes-animation/adapters/three.md` (it targets video compositions). `~/.codex/.tmp/plugins/plugins/game-studio`
has `three-webgl-game` and `web-3d-asset-pipeline` (GLB, Rapier, Vite stack; its asset pipeline skill is about GLB cleanup and
LOD, no procedural guidance). Not useful for this task.

Stars, licenses and push dates are from `gh repo view` today. "Opened" means I read the page or files.

| Name and URL | What it is | Stars, license, last push | Install? |
|---|---|---|---|
| Kenton-GMI/muster-ww2, https://github.com/Kenton-GMI/muster-ww2 (opened, files read) | Procedural WWII models in TypeScript three.js: Panzer IV, Tiger, Panther, StuG, T-34-85, KV-1, IS-2, SU-76M, Bf 109, Fw 190, Il-2, La-5, Pak 40, ZiS-3, Flak 36, trucks, infantry. Docs: `docs/ASSET_GUIDE.md`, `docs/briefs/*.md`. Helpers: `src/core/geo/shapes.ts` (rbox, plate, loftZ, superRing, crease, strap), `panzer-iv-h/track.ts` (track solver), `bf-109-g6/wing.ts` (NACA wing planform, dihedral, slats), `pak-40/shield.ts` | 31 stars, MIT, 2026-09-23 | Not a skill; no install. Read for techniques and dimensions. Models are collector-grade (500k triangles), do not import them |
| scottstts/Threejs-Awesome-Graphics-Agent-Skills, https://github.com/scottstts/Threejs-Awesome-Graphics-Agent-Skills (opened, SKILL.md and vehicle reference read) | Skill pack. `threejs-procedural-geometry`: profile extrusion, parameter-curve lofts, revolve, sweep, bevels, "part-specific smooth angle", merge by material slot, orientation guard; example gallery with a race car, motorcycle, humanoid, submarine | 867 stars, MIT, 2026-09-22 | Worth reading, and worth installing as a skill later if you want an agent to follow the craft loop (`npx threejs-awesome-graphics-agent-skills@latest install --agent claude-code`). It aims at photoreal PBR and up to 900k triangles, so tell the agent our budgets. Not installed |
| tougenrip/thirdfold, issue #190, https://github.com/tougenrip/thirdfold/issues/190 (opened) | Design note for baking chamfers, creased normals, vertex AO and convexity into part-list tabletop miniature models in three.js | repository license not stated | Read only. It is the closest match to our pipeline (part lists, vertex AO, a miniature shader) |
| jasonsturges/three-low-poly, https://github.com/jasonsturges/three-low-poly (opened) | Library of parametric low-poly `BufferGeometry` classes, factories and atmosphere (lathe, extrude, flat shading, merge with material groups, instancing). No vehicles or characters | 59 stars, ISC, 2026-09-29 | No. Flat-shaded scenery style, not our painted look |
| CloudAI-X/threejs-skills, https://github.com/CloudAI-X/threejs-skills (opened, plus skills.sh/cloudai-x/threejs-skills/threejs-geometry and raw SKILL.md) | 10 general skills (fundamentals, geometry, materials, lighting, textures, animation, loaders, shaders, postprocessing, interaction) | 3.4k stars, 10.8k installs of the geometry skill, GitHub detects no license file (the README says MIT), 2026-07-09 | No. The geometry skill covers `mergeGeometries`, vertex colours, instancing, lathe, extrude, tube, but not flat shading, LOD or procedural modelling. We already know that API |
| majidmanzarpour/threejs-game-skills, https://github.com/majidmanzarpour/threejs-game-skills (opened) | 9 skills for polished three.js games; `threejs-aaa-graphics-builder` mentions technical art budgets; `threejs-3d-generator` uses the Tripo API for AI-generated models | 2.4k stars, MIT, 2026-09-28 | No. Its model path is paid AI generation, which conflicts with our procedural direction. The debug-profiler skill may help with perf work |
| OpenAEC-Foundation/Three.js-Claude-Skill-Package, https://github.com/OpenAEC-Foundation/Three.js-Claude-Skill-Package (opened) | 24 skills targeting three r160+ incl. performance and a GLTF model optimizer | 19 stars, MIT, 2026-07-08 | No. Generic and low adoption |
| img2threejs (github.com/img2threejs/img2threejs and github.com/hoainho/img2threejs report identical stats), https://img2threejs.org/skill (opened) | Claude Code skill: rebuild an object from a reference image as a procedural three.js model through eight quality-gated stages | 17.3k stars, Apache-2.0, 2026-09-23 | Probably not. Its gates target one hero object per run, and no triangle budgets are documented. It could help turn a reference photo of one tank into code, but our models are 450 triangles |
| sorchosky/airplane-game, https://github.com/sorchosky/airplane-game/pull/53 and /issues/23 (opened) | A procedural Cessna built from elliptical-station lofts, airfoil panels, tubes, merged to one geometry per material (body, stripe, metal, glass), 8 to 9 draws, with hinge-rotated control surfaces | small | Reference only. Confirms the loft-plus-merge approach |
| zinkkrysty/three-js-asset-studio, https://github.com/zinkkrysty/three-js-asset-studio (opened) | Low-poly flat-shaded asset generator that exports ES modules, incl. a car | 2 stars, no license stated | No |
| richtan/3D-Procedural-Airplane-Modeling, https://github.com/richtan/3D-Procedural-Airplane-Modeling (opened, no source visible) | University project, procedural planes from YAML | 0 stars | No |
| gamedev-skills/awesome-gamedev-agent-skills, https://github.com/gamedev-skills/awesome-gamedev-agent-skills (opened) | Index of 74 game skills; three.js entries are scene setup, GLTF loading, materials and lighting | 1.3k stars | No. No modelling or RTS entry |
| dgreenheck/webgpu-claude-skill | WebGPU and TSL skill | 1.2k stars | No. We use `WebGLRenderer`. Seen in search results only, not opened |

If you want one install, it is the scottstts procedural-geometry skill, and only if the agent also receives the budgets
in section 6. Nothing here was installed.

## 6. Budgets for about 1000 soldiers and 100 vehicles at 60 fps

### What is measured in this repo

- Whole-map view on the default map: about 200 draw calls and 105k triangles; about 212k triangles on Monte Cassino XL;
  a village view about 99k (CHANGELOG, round 5). Terrain and structures dominate triangles today.
- Round 3 unit rendering took a Massive Classic 3v3 at 70 s from 885 to about 150 draw calls in the own-army view
  (CHANGELOG), mostly by making each soldier one draw and merging scenery.
- `?perf` in the URL shows fps, `renderer.info.render.calls` and `.triangles` (`client/perf.js`), and the game drops to Low
  when fps stays under 45 for 5 s. Use that box to validate every number below.
- Pop is one per squad or vehicle: the cap is 12 per player (24 in Classic) times the army size (standard 1, large 2.5,
  massive 5; `shared/sim.js` `popCap`, `CFG.armies`). A six-player Massive Classic allows 6 x 120 = 720 units, with squads of 2
  to 7 men, so 1000 or more soldiers and 100 vehicles are reachable in that mode. Standard Conquest tops out near
  300 soldiers.

### What sources say (none is for this exact GPU)

- Three.js maintainer guidance quoted in the Utsubo performance guide (opened): "<100 draw calls and <100,000 vertices if
  you can", as a mobile-safe target; the same guide says desktop handles several hundred to low thousands of draws and
  that triangle count matters less than draw count. The underlying forum post was not located.
- 0 A.D., a shipped open-source RTS, caps humanoid bodies at 1000 triangles and humanoid props at 100
  (trac.wildfiregames.com/wiki/ArtPolyCountGuidelines, opened through Firecrawl; "anything smaller than a human hand should
  not be modeled but included in texturing").
- A Unity forum thread (opened) reports about 110 to 125 units of 1112 triangles with animation, and a reply that modern
  computers render around 1M triangles; the poster's limit was animation cost, not triangles.
- A three.js forum thread (opened) reports 1000 animated skinned meshes at 60 fps on a low-end laptop after throttling
  animation updates and sharing skeletons, and that CPU work (`updateMatrixWorld`, mixers), not triangles, was the limit.
- A forum showcase (opened) renders 100,000 people through one `InstancedMesh` with a per-vertex part id and packed
  instance attributes, at 240 fps on the author's hardware. That is the upper bound for the instancing route.
- LOD guidance for one RTS character in an issue on github.com/sidesliders1983/Pillagers (opened): LOD0 6k to 10k,
  LOD1 3k to 5k, LOD2 (zoomed-out RTS) 800 to 1.5k, LOD3 200 to 500. This is an aspiration for one hero character, not a
  shipped table; our budgets are far lower because 1000 units share the frame.

### Proposed per-model budgets (triangles, near / far)

| Model | Near | Far (beyond 110 m, 80 m on Low) |
|---|---|---|
| soldier | 350 to 450 | 70 to 120 |
| gun (AT, flak, mortar, MG), as its own mesh | 250 to 400 | 80 to 120 |
| light tank, armored car | 450 to 600 | 120 to 160 |
| medium tank | 700 to 900 | 150 to 200 |
| Tiger | 1000 to 1200 | 180 to 220 |
| mobile flak, rocket launcher | 600 to 800 | 150 to 200 |
| fighter / attacker / bomber | 800 to 1000 / 1000 to 1300 / 1600 to 2200 | none needed (about 10 to 20 aloft) |

### Frame totals

| Scenario | Soldiers | Vehicles | Planes | Terrain and props | Main-pass total | Shadow pass |
|---|---|---|---|---|---|---|
| Stress, all near: 1000 x 400, 100 x 800, 15 x 1300 | 400k | 80k | 20k | 100k to 210k | 600k to 710k | vehicles 80k plus structures |
| Wide zoom, typical: 300 near x 400 and 700 far x 100, 50 vehicles near and 50 far (160) | 190k | 48k | 20k | 100k to 210k | 360k to 470k | about 50k |
| Today, stress: 1000 x 608, 100 x about 300 | 608k | 30k | 20k | 100k to 210k | 760k to 870k | 30k |

So the proposal lowers soldier triangles by about 35% and raises vehicle triangles about 2.5 to 3x; the stress frame ends
up about 20% lighter than today's. At 60 fps a 700k-triangle frame is 42M triangles per second. I found no published
triangle rate for the target laptop GPUs, so this is a budget to confirm with `?perf`, not a measured result. The risks
that matter more than triangles are fill cost (MSAA is on, pixel ratio up to 1.5, a 2048 PCF shadow map), the CPU cost of
many draws, and sub-pixel triangles on soldiers (section 1).

### Draw calls

| Stage | Soldiers | Vehicles (main + shadow) | Scenery | Total |
|---|---|---|---|---|
| Now, stress | 1000 | 200 + 200 | 150 to 200 | about 1600 to 1800 |
| Soldiers instanced per (type, faction, kit, LOD) | about 30 to 60 | 200 + 200 | 150 to 200 | about 600 to 700 |
| Vehicles instanced per type, hull and turret separate | about 30 to 60 | about 40 + 40 | 150 to 200 | about 300 to 400 |

Recommended order: (1) change the models only, keep one draw per soldier, and measure with `?perf` in a 6-player
Massive Classic; (2) if draws exceed about 600 or the JS time per frame passes about 8 ms, instance soldiers (3.11);
(3) instance vehicles only if still needed. The instancing steps change how `v.models`, `fx.js` muzzle tips and the
corpse pool use the `man` nodes, so they are a refactor, not a model change.

Memory is small: a 500-vertex soldier with four morph targets and normals is under 100 KB, and there are about 50 shape
keys per owner colour set. `estimateBytesUsed()` from `BufferGeometryUtils` can total it.

## 7. Constraints to respect when changing the models

- `test.js` (around line 3109) asserts: each soldier is exactly one mesh near and one far, soldiers cast no shadow,
  vehicles and structures cast shadows with 1 to 3 draws, `mergeParts` keeps every vertex and bakes transforms, triangle
  winding agrees with the normals (including mirrored parts). Meshes from lofts and creased extrusions passed the same
  winding check in my prototype (0 of 1284 faces disagreed on the tank hull).
- `levelBase(g, n)` expects the base to be the first `n` vertices of the PAINT bucket. Change `n` with the base geometry.
- `barrelTip()` finds the barrel only if it is a `GEO.cyl` rotated by PI/2; any other barrel geometry needs an explicit `v.fxTip`.
- Colours are stored as linear `THREE.Color` values by `colorOf()`; multiply AO in that space (what `bakeAO` does).
- Keep two caches apart: shapes (geometry, colour independent, AO baked once) and owner variants (colours applied).
- `DESIGN.md` and `CHANGELOG.md` must be updated with any visible model change (AGENTS.md), and no em dashes.

## 8. Sources opened

Three.js source in `node_modules/three` (versions 0.186.1): `src/geometries/{Extrude,Lathe,Tube,Capsule}Geometry.js`,
`src/objects/{BatchedMesh,InstancedMesh,LOD}.js`, `src/renderers/webgl/WebGLShadowMap.js`,
`src/renderers/shaders/ShaderChunk/{color_vertex,morphinstance_vertex,normal_fragment_begin}.glsl.js`,
`examples/jsm/geometries/{LoftGeometry,RoundedBoxGeometry,DecalGeometry}.js`, `examples/jsm/utils/BufferGeometryUtils.js`
(`mergeVertices` line 643, `toCreasedNormals` line 1315), `examples/jsm/utils/SceneOptimizer.js`.

Repo files: `client/unit-models.js`, `client/aircraft.js`, `client/light.js`, `client/perf.js`, `client/camera.js`,
`server.js`, `test.js` (unit model section), `CHANGELOG.md`, `DESIGN.md` ("Look and feel").

Web pages (all opened this session):
- https://github.com/Kenton-GMI/muster-ww2 and files fetched through `gh api` (docs/ASSET_GUIDE.md, docs/briefs/human-base.md,
  docs/briefs/infantry.md, src/core/geo/shapes.ts, panzer-iv-h/track.ts, pak-40/shield.ts, pak-40/layout.ts, bf-109-g6/wing.ts,
  bf-109-g6/fuselage.ts)
- https://github.com/tougenrip/thirdfold and https://github.com/tougenrip/thirdfold/issues/190
- https://github.com/scottstts/Threejs-Awesome-Graphics-Agent-Skills (SKILL.md and references/vehicle-loft-and-projector-contract.md via `gh api`)
- https://github.com/CloudAI-X/threejs-skills, https://skills.sh/cloudai-x/threejs-skills/threejs-geometry,
  https://raw.githubusercontent.com/CloudAI-X/threejs-skills/main/skills/threejs-geometry/SKILL.md
- https://github.com/OpenAEC-Foundation/Three.js-Claude-Skill-Package, https://github.com/majidmanzarpour/threejs-game-skills,
  https://github.com/jasonsturges/three-low-poly, https://github.com/img2threejs/img2threejs, https://img2threejs.org/skill,
  https://github.com/zinkkrysty/three-js-asset-studio, https://github.com/richtan/3D-Procedural-Airplane-Modeling,
  https://github.com/gamedev-skills/awesome-gamedev-agent-skills,
  https://github.com/sorchosky/airplane-game/pull/53, https://github.com/sorchosky/airplane-game/issues/23,
  https://github.com/JoshuaLRay/Sandline/pull/116 (no budgets visible), https://github.com/sidesliders1983/Pillagers/issues/6
- https://discourse.threejs.org/t/is-there-a-merge-vertices-smooth-normals-utility-with-a-crease-angle-argument-available/37679
- https://discourse.threejs.org/t/how-would-i-begin-to-bake-lighting-ao-into-vertex-color-data/48689
- https://discourse.threejs.org/t/one-draw-call-massive-crowd-performance-engineering-in-three-js/89928
- https://discourse.threejs.org/t/optimization-of-large-amounts-100-1000-of-skinned-meshes-cpu-bottlenecks/58196
- https://www.utsubo.com/blog/threejs-best-practices-100-tips
- https://www.gamedeveloper.com/programming/gpu-performance-for-game-artists
- https://trac.wildfiregames.com/wiki/ArtPolyCountGuidelines (blocked for WebFetch by Anubis, read through Firecrawl)
- https://discussions.unity.com/threads/rts-polygon-count-for-models-goal.153388/
- https://wiki.teamfortress.com/wiki/Illustrative_Rendering_in_Team_Fortress_2
- https://www.oldguardpainters.com/miniature-painting-techniques-guide/ and
  https://battlehonours3d.com/blogs/what-do-battle-honours-3d-mean-by-true-scale/true-scale-vs-heroic-28mm
- Wikipedia: https://en.wikipedia.org/wiki/M4_Sherman, /T-34, /Panzer_IV, /Tiger_I, /7.5_cm_Pak_40, /ZiS-3, /NACA_airfoil,
  /Junkers_Ju_87, /North_American_B-25_Mitchell, /Republic_P-47_Thunderbolt, /Heinkel_He_111, /Stahlhelm

Not usable: the Codrops "Making of The Aviator" page returned 403, and Valve's NPAR07 TF2 PDF is image-only for the
fetch tool. A search summary (not an opened page) supplied the TF2 dark-feet to light-chest gradient and the 1.3x head and
1.5x hands figure for heroic scale; both are marked unconfirmed above. The Wikipedia Sherman page I opened did not state
the road wheel count, the Pak 40 page did not describe the wheels or brake, and the ZiS-3 page did not describe the
shield; those details come from general knowledge or the Muster source and should be checked against a primary source
before they drive a model.

## 9. Verification log

Run from the repo or `/tmp/ww2-models/work` with the installed three:

- `measure.mjs`: baked triangle counts of every unit type (table in section 1). Rifleman 608 near, 140 far.
- Plane counts by temporarily exporting `model()` from a copy of `aircraft.js` in `/tmp` (repo untouched): 546 to 1500.
- `proto3.mjs`: lean tank 372 + 88 = 460 triangles; lean soldier 352 near and 76 far; AO 25 ms, 7 ms, 0.7 ms.
- `kit-sketch.mjs` (self-checking): bevelBox 108, plate (5 points) 36, fuselage loft 96, wing loft 92, turret loft 44,
  all outward-facing; morph weights 0, 1, -1 give base, target, `2 * base - target`; AO multiplies colours by the 0.55 floor.
- `exports.mjs`: every core class named in section 2 exists in `three.module.js`.
- Addon imports resolve in Node through `three/addons/...`. Not verified in a browser.
