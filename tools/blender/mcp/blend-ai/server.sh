#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/../environment.sh"
export UV_PROJECT_ENVIRONMENT="$MCP_PROJECT_DIR/.cache/blend-ai/venv"
exec "$MCP_UV" run --frozen --no-sync --project "$MCP_TOOLS_DIR/blend-ai" blend-ai
