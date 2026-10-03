#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/environment.sh"
if [[ ! -x "$UV_PROJECT_ENVIRONMENT/bin/python" ]]; then
  echo "Blender MCP is not installed. Run: bash tools/blender/mcp/setup.sh" >&2
  exit 1
fi
exec "$MCP_UV" run --frozen --no-sync --project "$MCP_TOOLS_DIR" blender-mcp --transport stdio
