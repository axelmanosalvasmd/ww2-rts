---
name: ww2-model-qa
description: Review WW2 RTS game models through the project's three isolated Blender MCP integrations, using source mesh exports, rendered images and the game viewer.
---

# WW2 RTS model QA

Read `tools/blender/mcp/README.md` for runtime scope, pinned integrations and limitations.
Inspect current game source before attributing a visual defect or choosing a model family.
Use the same source geometry the renderer uses. Keep game mechanics, mounts and cached
geometry reuse intact when editing models. Record player-facing changes in `CHANGELOG.md`.

## Project runtime

Use `bash tools/blender/mcp/check.sh` for a read-only connection check. If Blender is
closed, run `start.sh`; run `setup.sh` first only when dependencies or add-ons are missing.
Never replace another project's preferences, close an unrelated Blender process or
clear an existing scene. Only one client may edit the shared scene at a time.
All tests and renders must remain silent on the Mac.

Codex and Claude project registrations expose Blender Lab, MCP for Blender and Blend AI.
Existing sessions need a restart to load newly installed registrations. Their upstream
workflow prompts and server instructions are distinct from this standalone agent skill.
Discover tool schemas instead of guessing names or supported Blender enum values.

## Use all three integrations for useful review

For the complete import, render and capture sequence, run
`bash tools/blender/review.sh --types <types> --factions <0,1,2,3>`, then inspect its saved images.
The manual sequence below exposes each integration's role.

1. Export selected models with `node tools/blender/export-review.mjs --types <types>
   --factions <0,1,2,3>`. Inspect export counts and bounds before importing.
2. Use Blender Lab `execute_blender_code` to run `tools/blender/import-review.py` against
   the export. Supply an absolute `review_path` and preserve other scenes. Read its
   JSON report for finite geometry, indices, degenerate triangles and original bounds.
3. Use Blend AI `get_object_info` to inspect the imported hierarchy and mounts, then
   `render_image` to produce a review image from the QA camera.
4. Use MCP for Blender `get_scene_info` and `get_viewport_screenshot` to confirm the
   same scene and inspect the visible result. Save and open the screenshot and render.
5. Compare bow, tracks, wheels, cabin, weapon direction, faction colors and silhouette
   at game scale. Report actual visual defects and their source location.
6. Check the model in `client/viewer.html` through the user's requested browser for
   game textures, shaders and animation. Blender export keeps attribute and morph data
   but displays the base geometry with vertex colors. Do not claim runtime shader parity.

The generic `tools/blender/mcp/call.sh` helper creates a real MCP client session. Its
`--list` output includes tool schemas and available prompts. Use `--args-file` for tool
arguments and `--output` to retain results or screenshot images under `.cache/`.
Read the response's nested status as well as the MCP `isError` flag.

## Blender authoring

For real game geometry finishing, read `tools/blender/finishing.md`. Export raw naval
parts with tint masks, apply crease-limited bevels and weighted normals through Blender
Lab, and validate the generated payload through the actual runtime adapter. Do not bake
already-mounted `buildModel` geometry or interpolate shader material IDs. Compare the
finished silhouette with its reference and inspect the actual game render.

For the fitted textured infantry source and its 15-bone skin, read `tools/blender/infantry.md`.

## Reference workflows

When the user asks for generated reference images or tileable textures, use their
requested image skill. This machine has `/Users/judiazm/Projects/agent-skills/codex-image/SKILL.md`.
Read that skill before use. It is machine-local and is not copied into this project.
Keep original reference images, Blender QA outputs and game-ready assets separate.
Generated reference artwork does not replace source model or live game validation.

## Verification

Run the checks relevant to changed geometry and `node test.js` before committing.
Inspect renders instead of relying on tool success alone. Keep `DESIGN.md` aligned
with gameplay changes. Stage only your files and inspect other sessions' work.
