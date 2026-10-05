# Blender authoring and runtime geometry

The authoring pass runs real Blender bevel and weighted-normal modifiers on raw naval
parts and exports the result for synchronous use in the game. It keeps each hull and
turret in its original local coordinate system. Gun mounts and muzzle-tip coordinates
come from the raw builder and remain unchanged.

## Rebuild

Run the authoring pass after the naval source is stable. Use one Blender client at a
time. The pass creates a new timestamped scene and leaves existing scenes intact.

```bash
node tools/blender/export-naval-source.mjs
node tools/blender/finish-naval.mjs \
  --source .cache/blender-mcp/naval-source.json \
  --output client/models/naval-finished-data.js
node tools/blender/check-finished-naval.mjs \
  client/models/naval-finished-data.js \
  .cache/blender-mcp/naval-finished-check.json
```

Export the raw `navalModel` geometry. The `buildModel` output already carries mounted
transforms and baked grime, so it would apply both twice if used as authoring input.
After integration, run `review.sh` and inspect the game viewer to check the finished
runtime geometry, materials and gun movement.

## What the modifiers change

Vertices split only for shading are welded when position, color, tint masks and
material class match. Source colors and sharp material boundaries remain separate.
The bevel pass selects broad connected components in painted armor, cast armor or
aluminum. Components narrower than six bevel widths, glass, wood, canvas and gunmetal
are excluded. Qualifying edges meet at 65 degrees or more. Two segments and a default
width of 0.035 soften those edges; overlap is clamped to the available surface.

Weighted normals retain sharp edges and use face area and corner angle to preserve
flat panels. The exporter normalizes every corner normal and keeps it in the triangle's
outward hemisphere. It drops numerical slivers at the runtime area threshold, and
uses exact vertex records when indexing. No subdivision, remesh or deformation changes
the model's proportions.
Bevels refine edge highlights. Hull profile, cabin shape and visible fittings still
need an authored design and comparison with the reference image.

## Paint and material preservation

The raw exporter uses temporary owner and vehicle paint sentinels to create normalized
tint weights, then removes those sentinels from the fixed linear RGB colors. Blender
interpolates the color and tint weights on new geometry. Runtime reconstruction adds
owner and vehicle colors through their masks, so the finished asset can still use
any player color and vehicle look.

Material IDs travel as integer source-face material slots. New bevel faces inherit
an adjacent source slot. The exporter assigns that exact integer to each output face
corner and never interpolates a material ID as a float attribute. The game applies
its usual grime and material shader after reconstructing the geometry.

## Payload and verification

`naval-finished-data.js` exports a `ww2-blender-naval-v1` payload with hull and optional
turret records for each type and faction. Attributes use Float32 values and indices use
UInt16 or UInt32 values. The shared array table is compressed with gzip and stored as
base64, then decompressed by the runtime helper through the native
`DecompressionStream` API while the ES module loads; model reconstruction then remains
synchronous. Exact identical arrays are shared across variants, without assuming
that faction topology must match. Source hashes, Blender version and finishing settings
are included. Reports and `.blend` authoring files stay beside the ignored raw export.

The validation helper loads the actual payload through the runtime adapter. It checks
current source hashes, finite attributes, triangle indices, normalized normals, valid
integer material IDs, outward face normals, geometry bounds, unchanged mounts and tips,
geometry caching and separate paint variants. Complete instances may not exceed 15,000 LCVP, 30,000 gunboat
or 50,000 destroyer triangles. Lower counts are preferred when the design permits them.

The final 2026-10-03 authored payload contains 7,422 LCVP, 15,680 gunboat and
38,252 to 38,329 destroyer triangles per complete instance. Its 75 unique arrays replace
140 references across 12 faction/type variants. The array table is 11,836,039 bytes
before compression and 2,829,632 bytes after gzip; the complete module is 3,776,929 bytes.
The validator passed all 12 variants after loading them through the actual adapter.

A validation pass does not establish visual realism. Open the render and game viewer,
compare the source design with the reference, and inspect the result at the intended
camera distance before committing the generated asset.
