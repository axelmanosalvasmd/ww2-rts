# Blender setup for WW2 RTS

This project copies the pinned Blender setup from Subway Zombie into its own runtime.
All three MCP servers connect to the same Blender scene through separate local ports.
Codex and Claude Code read project registrations. Global plugin settings are not changed.

| Integration | Pin | Port | Use |
| --- | --- | --- | --- |
| [Blender Lab MCP](https://www.blender.org/lab/mcp-server/) | 1.0.3 | 9878 | Blender API documentation, mesh inspection and Python imports |
| [MCP for Blender](https://www.mcp-for-blender.com/docs/codex-plugin) | Server 2.1.3 | 9877 | Interactive viewport, screenshots, object mentions and asset browsing |
| [Blend AI](https://github.com/HoldMyBeer-gg/blend-ai) | 1.7.0 | 9876 | Modeling, materials, animation, render settings and image rendering |

## Start and check

The scripts need Blender 5.1 or newer and `uv`. Override `BLENDER_PATH` or `MCP_UV`
if those executables are installed elsewhere. Setup uses the committed lockfiles and
verifies the extension archive checksums. It does not install a system runtime.

```bash
bash tools/blender/mcp/setup.sh
bash tools/blender/mcp/start.sh
# Or open a specific scene:
bash tools/blender/mcp/start.sh /absolute/path/to/scene.blend
bash tools/blender/mcp/check.sh
```

`start.sh` refuses to launch when any of ports 9876, 9877 or 9878 is occupied.
Close the Blender instance that owns those ports before switching projects. Do not
terminate another project's process or replace its scene. Let one client finish scene
edits before another client starts. Model checks and renders do not need audio.

`check.sh` discovers tools, reads the scene through all three servers, reads the
community HTML viewport resource and requests a screenshot without editing objects.
The 2026-10-03 live check found 26 Blender Lab tools, 41 MCP for Blender tools and
186 Blend AI tools against the same isolated WW2 RTS scene on Blender 5.2.2 LTS.
Fresh Codex and Claude runtimes also called native scene tools on all three servers.
The naval import, Blend AI render and community viewport capture completed through
`review.sh`; details are in [verification-2026-10-03.md](../verification-2026-10-03.md).

## Client scope

- `.codex/config.toml` registers all three plain MCP servers in this trusted project.
  The community server enables MCP Apps and OpenAI forms for its viewport.
- `.mcp.json` registers all three for Claude Code. A new client can ask to approve
  these local servers. Local approvals belong in ignored `.claude/settings.local.json`.
- Preferences, add-ons, environments, downloads and check results stay in ignored
  `.cache/`. No API keys are copied from the other project.
- Restart an existing client session or start a new session to load registrations.
  Installing files does not add tools to an already-running chat.

The optional Codex plugin files are preserved under `community/codex-marketplace/`.
The plain registration already exposes the same tools and viewport. Installing that
plugin is a separate choice; disable the direct `mcp-for-blender` registration if
using the plugin to avoid duplicate servers. The project does not install or enable
any plugin in global config.

## Skills and workflows

The local `ww2-model-qa` skill is available to Codex under `.agents/skills/` and to
Claude Code under `.claude/skills/`. Both point to the same project skill source:
[SKILL.md](../skills/ww2-model-qa/SKILL.md).

The upstream integrations do not contain standalone `SKILL.md` skills. Blender Lab
loads built-in server instructions, while Blend AI exposes 12 MCP workflow prompts
that clients can discover with `prompts/list`. MCP for Blender offers tool descriptions
and its viewport resource. `call.sh <server> --list` saves tool schemas and prompt names.
These prompts are not installed agent skills.

For reference images and texture generation, this machine also has the
[codex-image workflow](../../../../agent-skills/codex-image/SKILL.md).
That is an optional machine-local workflow, not a bundled dependency. Preserve its
reference outputs separately from model exports and game textures. Never describe a
reference image as a finished game model.

## Review the actual game meshes

```bash
node tools/blender/export-review.mjs --types lcvp,gunboat,destroyer --factions 0
# Other buildModel units and aircraft main geometry are also supported:
node tools/blender/export-review.mjs --types medium,rifle,fighter --factions 0,1
```

The exporter preserves positions, normals, linear vertex colors, indices, world
transforms, material attributes and morph target arrays. It omits hidden far meshes.
Aircraft export captures the main airframe geometry. It does not include spinning
propellers or the aircraft paint shader. The airfield is not supported by this export.
Buildings use their exact source geometry with browser textures disabled during export.

Use Blender Lab's `execute_blender_code` to run `tools/blender/import-review.py` with
`review_path` set to the export's absolute path. The script creates a new timestamped
QA scene, converts `(x, y, z)` to `(x, -z, y)`, imports colors and normals, keeps mounts
in their world positions, then saves a `.blend` and JSON report beside the export.
It leaves existing scenes intact. Each model is scaled to the same display length
for comparison; the report retains original dimensions and display scale.

For an import, render and viewport capture through all three servers in one command:

```bash
bash tools/blender/review.sh --types lcvp,gunboat,destroyer --factions 0
```

The JSON export retains animation morph arrays; the Blender scene records their counts
and displays the base pose. Blender renders do not reproduce the game's triplanar
texture shader, aircraft camouflage shader or animation. Inspect those in the game viewer.

Useful MCP review sequence:

1. Blender Lab: import with `execute_blender_code`, then inspect `get_objects_summary`.
2. Blend AI: inspect `get_object_info` and render with `render_image`.
3. MCP for Blender: inspect `get_scene_info` and capture `get_viewport_screenshot`.
4. Open the render and viewport image, compare silhouette, colors and mounts, and
   record visible problems. A valid mesh is not proof of visual quality.

The generic helper invokes actual MCP sessions. It can mutate scenes when the chosen
tool mutates them, so read its discovered schema before use:

```bash
bash tools/blender/mcp/call.sh lab --list --output .cache/blender-mcp/lab-tools.json
bash tools/blender/mcp/call.sh blend-ai --tool get_scene_info
bash tools/blender/mcp/call.sh community --tool get_scene_info
bash tools/blender/mcp/call.sh lab --tool execute_blender_code \
  --args-file .cache/blender-mcp/import-args.json \
  --output .cache/blender-mcp/import-result.json
```

`--args-file` is a JSON object containing the tool arguments. Screenshot responses
save images beside `--output` without printing their base64 data.

For Blender authoring that returns finished geometry to the runtime, read
[finishing.md](../finishing.md). That pass exports raw naval parts, applies real Blender
modifiers, and writes a versioned geometry payload with player-color masks.

## Provenance

- Blender Lab source: `projects.blender.org/lab/blender_mcp`, revision
  `2cea8d566dde07fbac28a61d698909d69724e853` (v1.0.3).
- MCP for Blender: `mcp-for-blender==2.1.3`. Optional plugin 2.1.1 files come from
  `ahujasid/mcp-for-blender`, revision `60d2a31b4632a7bc178f3dd636f7e68dfb5c8ae4`.
- Blend AI: `HoldMyBeer-gg/blend-ai`, revision
  `ce8fca24f2cd76db38d30c4bfd5fde7540c343bd` (v1.7.0).

Pins are unchanged from the copied setup. Review official release and migration
notes before upgrading them. Do not copy cached credentials or Blender scenes.
