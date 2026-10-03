# WW2 model references

The later infantry replacement uses `infantry-realism-v3.png`, a generated transparent
A-pose reference. `infantry-face-v3.png` is an additional portrait study, not a runtime
texture. The accepted reduced surface is `infantry-retopo-v3.glb`; the editable rig
is `infantry-rig-v3.blend`. See `tools/blender/infantry.md` for the reconstruction,
Blender fitting and runtime texture workflow. Shared sidecars omit account and request IDs.

Three images generated with the requested Codex Image skill on 2026-10-03. These are visual modeling references, not verified historical blueprints. Runtime model changes should use their proportions and material treatment with judgment.

| File | Subjects | Requested size | Actual size | Requested quality | Resolved quality |
| --- | --- | --- | --- | --- | --- |
| ground-units-multiview.png | US infantry, Sherman tank, BA-64 scout car | 2048x2048 | 1536x1024 | low | medium |
| naval-air-hq-multiview.png | PT boat, P-51 fighter, timber HQ | 2048x2048 | 1536x1024 | low | medium |
| painted-steel-albedo.png | Subtle painted metal grain | 1024x1024 | 1254x1254 | low | low |

The backend reported `gpt-image-2-codex` for every image. Each PNG has a JSON sidecar with the exact prompt, requested settings, backend metadata, and measured dimensions.

Both sheets include front, left, back, right, and top views. The infantry sheet shows compact fitted kit and useful body proportions. The boat and HQ silhouettes are readable. Some fighter front and back wing tips touch or extend beyond their cells, so use the top view for the full wing plan. Small details and agreement between views remain approximate.

The steel texture has restrained grain and scratches with no visible symbols or large rust patches. Its mean RGB value is approximately 118, 117, 115, so it is slightly warm rather than strictly grayscale. Opposite-edge average channel differences are about 6.7 and 7.1 on a 0 to 255 scale. It was requested as seamless, but exact seamlessness is not established. Check repetition at the intended UV scale before using it on models.

All three saved images were opened and inspected. No generated runtime asset or model is implied by these references alone.

## Naval realism revision

`realism-naval-v2.png` was generated for the renewed request for realistic vessels. It shows an LCVP Higgins boat, an 80 foot Elco PT boat, and a Fletcher-inspired destroyer in three-quarter, top, and side views. The image emphasizes hull curvature, thin sides, open interiors, sloped bridges, deck machinery, and gun shields.

The requested size was 2048x2048 at low quality. The backend reported `gpt-image-2-codex`, medium quality, and the saved PNG measures 1536x1024. Its JSON sidecar records both requested and actual settings.

The saved sheet was opened and inspected. The destroyer's stern is clipped in the top view, so use its side and three-quarter views for overall length. Small fittings and armament layouts remain approximate AI reference details rather than verified historical construction.

## Isolated PT boat candidate

`pt-boat-isolated-v2.png` shows one realistic Elco-style PT boat in an elevated three-quarter view for an image-to-3D mesh candidate. It has no water, base, or labels. The stern is close to the right edge, and fine railing wisps touch the frame.

The backend reported `gpt-image-2-codex` at medium quality. The requested settings were low quality and 2048x2048; the actual image is 1774x887. Native RGBA transparency was verified: alpha spans 0 to 255, about 900,000 pixels are fully transparent, and most foreground pixels have alpha 252 or 253. The sidecar records these checks. The saved image was opened and inspected before passing it to mesh evaluation.

The painted-steel reference is used in the game as
`client/textures/models/armor-paint-refined.jpg`, converted to a 512 by 512 JPEG
for the existing texture array. The shader uses its brightness only, preserving
faction colors. The prior `armor-paint.jpg` remains available for comparison.

## Local PT boat mesh evaluation

The isolated PT reference was converted once with local Pixal3D at 8 steps and seed 42. The original textured GLB has 977,972 triangles and a 4096-pixel texture atlas (35.3 MiB). Textured and clay renders show coherent cabin, torpedo tubes, gun tubs, rails, and hull detail, although the mast loses some reference bracing and the guns remain soft. The opposite side was also rendered and inspected. The single mesh has no separate gun mounts or animation clips.

Two copies were reduced with the lab's documented Finish command, preserving the original and transferring its textures. The 24,933-triangle copy collapses the mast and railings into spikes and ribbons. The 99,945-triangle copy retains those parts but introduces visible hull faceting and dark texture-bake fractures. Both copies were rejected after inspecting textured and clay comparisons. No generated GLB from this evaluation is shipped with the game.

The complete local run, source image, hashes, logs, renders, and provenance remain in `/Users/judiazm/Projects/image-to-3dlab/output/agent-runs/ww2-ptboat-realism-20261003-01/`. Read `workflow.json` and `asset.provenance.json` for generation provenance, `finished-25k.retopo-repaint.json` and `finished-100k.retopo-repaint.json` for finishing settings, and the `review-metrics-*.json` files for measured mesh counts. The comparison images are `comparison-textured.jpg`, `comparison-clay.jpg`, `comparison-100k-textured.jpg`, and `comparison-100k-clay.jpg`.

To reproduce the generation, run from the lab checkout and use a new output directory:

```sh
cd /Users/judiazm/Projects/image-to-3dlab
candidate_run="$PWD/output/agent-runs/ww2-ptboat-$(date -u +%Y%m%dT%H%M%SZ)"
.venv/bin/python scripts/agent_asset.py asset \
  --image /Users/judiazm/Projects/ww2-rts/art/model-reference-2026-10-03/pt-boat-isolated-v2.png \
  --output-dir "$candidate_run" --steps 8 --seed 42 \
  --use-case game --distribution public
```

The rejected finishing attempts used the following command with `--faces 25000` and then `--faces 100000`, keeping separate output and stage directories:

```sh
.venv/bin/python scripts/retopo_repaint.py \
  "$candidate_run/asset.glb" "$candidate_run/reference.png" \
  "$candidate_run/finished-25k.glb" \
  --faces 25000 --voxel 0 --atlas 2048 --texture-size 2048 --skip-paint \
  --steps-dir "$candidate_run/finish-25k-stages"
```
