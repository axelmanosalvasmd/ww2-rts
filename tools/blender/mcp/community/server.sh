#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/../environment.sh"
export UV_PROJECT_ENVIRONMENT="$MCP_PROJECT_DIR/.cache/mcp-for-blender/venv"
export BLENDERMCP_ADDONS_DIR="$MCP_RUNTIME_DIR/blender/scripts/addons"
export BLENDER_HOST=127.0.0.1
export BLENDER_PORT=9877
export DISABLE_TELEMETRY=true
exec "$MCP_UV" run --frozen --no-sync --project "$MCP_TOOLS_DIR/community" mcp-for-blender --host 127.0.0.1 --port 9877
