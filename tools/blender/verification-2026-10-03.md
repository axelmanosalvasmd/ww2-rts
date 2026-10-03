# Blender verification, 2026-10-03

The WW2 RTS setup used Blender 5.2.2 LTS and project-scoped pinned Python environments.
No external project's preferences or scene files were changed. The Subway Zombie
Codex plugin remained disabled in user config, and no WW2 plugin was installed globally.

## Connections and fresh clients

The read-only `check.sh` discovered 26 Blender Lab tools, 41 MCP for Blender tools
and 186 Blend AI tools. It read the same blank scene through all three, opened the
community HTML viewport resource and received a screenshot. Tool discovery also found
12 Blend AI MCP workflow prompts. These upstream integrations contain no standalone
agent skill; the project's `ww2-model-qa` skill documents their combined workflow.

After importing the naval models, fresh Codex and Claude runtimes each completed
native calls to Blender Lab `get_objects_summary`, MCP for Blender `get_scene_info`
and Blend AI `get_scene_info`. All three returned the same current QA scene name.

The first Codex attempt used its read-only sandbox. It blocked the community and
Blend AI calls because their schemas lacked read-only annotations. A second attempt
used the authorized full-access runtime with the same read-only prompt and completed
exactly those three calls without editing the scene. Claude's fresh verification used
the project `.mcp.json`, strict MCP config and an allowlist of the three read-only tools.
A normal new Claude session can still ask to trust the project and approve its MCPs.

## Initial connection review (superseded models)

This first pass established the import and review workflow. The realism revision below replaces these models.

`bash tools/blender/review.sh --types lcvp,gunboat,destroyer --factions 0` exported the
current game `buildModel` output and completed the following MCP operations:

- Blender Lab imported exact meshes, transforms, normals and vertex colors into a
  new timestamped QA scene, then read the object summary.
- Blend AI inspected the imported destroyer hull and rendered the scene to PNG.
- MCP for Blender read the scene and captured the visible viewport.

| Model | Meshes | Triangles | Zero-area triangles |
| --- | ---: | ---: | ---: |
| LCVP | 1 | 940 | 0 |
| Gunboat | 2 | 1,984 | 0 |
| Destroyer | 5 | 3,634 | 0 |

The importer rejected non-finite positions and out-of-range indices. It kept all
five destroyer parts, including the four gun mounts, at the exported positions.
The 6,558-triangle review render and viewport were opened and inspected. The LCVP's
open well, ribs, ramp and two pintle barrels, the gunboat's shaped bow, cabin, rigging
and torpedo tubes, and the destroyer's rails, funnels, four mounts and lifeboats were visible. No missing or
inverted parts were seen at the rendered angle.

Each ship was scaled to the same display length for comparison. Original bounds and
display scales are retained in the JSON report. Blender renders show mesh geometry
and vertex colors; game texture shaders and animation require the game viewer.

The reusable exporter also completed a smoke export of the US medium tank, rifle
squad, fighter and HQ. This verifies export support for armor, infantry, main aircraft
geometry and actual building geometry; those four models were not rendered in Blender
as part of this connection and naval review check.

Local evidence is ignored under `.cache/blender-mcp/`: `review-last.json` points to the
latest saved `.blend`, render, viewport and detailed MCP report. `codex-fresh-authorized.jsonl`
and `claude-fresh.json` hold fresh-client evidence. The source review images and game
assets remain separate from these temporary QA files. All checks were silent.

## Realism revision and shipped Blender geometry

The final revision uses Blender Lab to apply bevel and weighted-normal modifiers to raw
naval parts. The export normalizes corner normals, keeps them in each triangle's outward
hemisphere, and rejects degenerate triangles before writing the runtime payload. Separate
owner and vehicle tint masks preserve paint changes. See `finishing.md` for rebuilding.

The compressed runtime module is 3,776,929 bytes. Its shared array JSON is 11,836,039 bytes
before gzip and 2,829,632 bytes after gzip, with base64 transport in the ES module.
The exact payload passes the runtime adapter check for all twelve type/faction combinations.
It retains 1 / 2 / 5 meshes, original bounds, muzzle tips and gun mounts.

| Final model | Triangles per complete instance | Degenerate triangles |
| --- | ---: | ---: |
| LCVP, all factions | 7,422 | 0 |
| Gunboat, all factions | 15,680 | 0 |
| Destroyer, USA | 38,277 | 0 |
| Destroyer, Germany | 38,252 | 0 |
| Destroyer, USSR | 38,264 | 0 |
| Destroyer, UK | 38,329 | 0 |

The final three-integration review ran on the actual game builder output:
`review-mcp-20261003-163316.json`, scene `WW2_RTS_QA_20261003-163311`.
Blender Lab imported the finished meshes, Blend AI rendered them, and MCP for Blender
captured the same scene. The saved render and viewport were opened and inspected.
Curved hulls, open interiors, shaped bridges, torpedo tubes and all moving gun mounts
were present. The Blender materials now retain the model surface roughness and metalness,
but the game viewer remains the check for texture mapping and animation.

The in-app browser rendered all three ships on High without GPU errors. It also verified
bare-metal aircraft on Low, then restored High. Instanced infantry, morphed geometry and
fading bodies compiled and rendered through High, Low and High again, with no shader logs
or GL errors. Infantry and boat movement recordings contain H.264 video and no audio.
A small three-unit World Conquest scene measured 60.1 FPS over 300 sampled frames; this is
not a large-army performance claim. Volume remained zero throughout testing.

The local image-to-3D PT boat experiment is documented with the reference art. Its reduced
meshes were rejected after visual inspection and are not used in the runtime.

## Textured infantry replacement

The direct 8k soldier reduction was rejected for torn features and detached triangles.
The accepted input was rebuilt with a voxel surface and reduced to 5,984 triangles.
Blender Lab created a fitted 15-bone armature, solved and filtered its weights, then
exported the same weighted surface to the runtime and the retained editable `.blend`.
Blend AI rendered the new source; MCP for Blender captured its material viewport.
Both were opened for visual review. `infantry.md` records the retained inputs and rebuild.

The in-app browser checked all factions, crouching, prone and moving poses. The final
German and US close views retained the atlas and closed weapon grips. High to Low to
High returned GL error 0. A fresh three-unit Conquest match with Ground fog completed
a move from (27, 115) to (35, 111), with 60.1 FPS, 1.4 ms client work and 0.6 ms server
tick in the sampled settled frame. This is a small-scene sample, not a stress benchmark.
The audio module reported volume 0; console errors and GL errors were absent.

The source and all poses pass checks for normalized weights, bounded geometry, atlas
retention, distant meshes and stretched tiny triangles. Factions still share one face
and base uniform cut. Independently authored historical uniforms remain future work.
