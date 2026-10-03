#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/environment.sh"
exec "$MCP_UV" run --frozen --no-sync --project "$MCP_TOOLS_DIR" python "$MCP_TOOLS_DIR/check.py"
