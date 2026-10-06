#!/bin/bash
# Run from any directory. Arguments are the export-review.mjs options.
set -euo pipefail
source "$(dirname "$0")/mcp/environment.sh"
mkdir -p "$MCP_RUNTIME_DIR"
node "$MCP_PROJECT_DIR/tools/blender/export-review.mjs" "$@" > "$MCP_RUNTIME_DIR/export-summary.json"
exec "$MCP_UV" run --frozen --no-sync --project "$MCP_TOOLS_DIR" python "$MCP_TOOLS_DIR/review.py"
