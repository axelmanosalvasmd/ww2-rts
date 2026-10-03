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

## Actual naval model review

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
