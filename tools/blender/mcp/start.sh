#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/environment.sh"
for addon in "$BLENDER_USER_EXTENSIONS/ww2_rts/mcp/blender_manifest.toml" \
             "$BLENDER_USER_EXTENSIONS/ww2_rts/blend_ai/blender_manifest.toml" \
             "$BLENDER_USER_SCRIPTS/addons/blender_mcp.py"; do
  if [[ ! -f "$addon" ]]; then
    echo "Missing $addon. Run bash tools/blender/mcp/setup.sh first." >&2
    exit 1
  fi
done
"$MCP_RUNTIME_DIR/venv/bin/python" "$MCP_TOOLS_DIR/preflight.py"
exec "$BLENDER_PATH" --online-mode "$@" --python "$MCP_TOOLS_DIR/activate.py"
