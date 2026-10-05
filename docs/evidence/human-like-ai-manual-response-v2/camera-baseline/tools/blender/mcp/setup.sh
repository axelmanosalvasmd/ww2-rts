#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/environment.sh"
mkdir -p "$BLENDER_USER_CONFIG" "$BLENDER_USER_EXTENSIONS"
"$MCP_UV" sync --locked --project "$MCP_TOOLS_DIR"
UV_PROJECT_ENVIRONMENT="$MCP_PROJECT_DIR/.cache/mcp-for-blender/venv" \
  "$MCP_UV" sync --locked --project "$MCP_TOOLS_DIR/community"
UV_PROJECT_ENVIRONMENT="$MCP_PROJECT_DIR/.cache/blend-ai/venv" \
  "$MCP_UV" sync --locked --project "$MCP_TOOLS_DIR/blend-ai"
repo_list="$("$BLENDER_PATH" --background --command extension repo-list)"
if [[ "$repo_list" != *$'\nww2_rts:'* && "$repo_list" != ww2_rts:* ]]; then
  "$BLENDER_PATH" --background --command extension repo-add ww2_rts \
    --name "WW2 RTS" --directory "$BLENDER_USER_EXTENSIONS/ww2_rts"
fi
has_version() {
  "$MCP_RUNTIME_DIR/venv/bin/python" - "$1" "$2" <<'PY'
import sys
import tomllib
from pathlib import Path
manifest = Path(sys.argv[1])
current = tomllib.loads(manifest.read_text()).get("version") if manifest.exists() else None
raise SystemExit(0 if current == sys.argv[2] else 1)
PY
}
addon_zip="$MCP_RUNTIME_DIR/mcp-1.0.3.zip"
if [[ ! -f "$addon_zip" ]]; then
  curl -fsSL https://projects.blender.org/lab/blender_mcp/releases/download/v1.0.3/mcp-1.0.3.zip -o "$addon_zip"
fi
printf '%s  %s\n' a7a9da816192502e5a0a202a396444e266b47d8fc4f74ad4698048bd43040707 "$addon_zip" | shasum -a 256 -c -
if ! has_version "$BLENDER_USER_EXTENSIONS/ww2_rts/mcp/blender_manifest.toml" 1.0.3; then
  "$BLENDER_PATH" --background --online-mode --command extension install-file \
    --repo ww2_rts --enable "$addon_zip"
fi
UV_PROJECT_ENVIRONMENT="$MCP_PROJECT_DIR/.cache/mcp-for-blender/venv" \
  "$MCP_UV" run --frozen --no-sync --project "$MCP_TOOLS_DIR/community" \
  mcp-for-blender install-addon --addons-dir "$BLENDER_USER_SCRIPTS/addons"
blend_ai_zip="$MCP_PROJECT_DIR/.cache/blend-ai/blend_ai-1.7.0.zip"
if [[ ! -f "$blend_ai_zip" ]]; then
  curl -fsSL https://github.com/HoldMyBeer-gg/blend-ai/releases/download/v1.7.0/blend_ai-1.7.0.zip -o "$blend_ai_zip"
fi
printf '%s  %s\n' 5b6228e7624204e99bb66aedb5b89dd1ade6be60d5b18e0a00e8e94495d369b1 "$blend_ai_zip" | shasum -a 256 -c -
if ! has_version "$BLENDER_USER_EXTENSIONS/ww2_rts/blend_ai/blender_manifest.toml" 1.7.0; then
  "$BLENDER_PATH" --background --online-mode --command extension install-file \
    --repo ww2_rts --enable "$blend_ai_zip"
fi
"$BLENDER_PATH" --background --online-mode --python-exit-code 1 --python "$MCP_TOOLS_DIR/configure.py"
