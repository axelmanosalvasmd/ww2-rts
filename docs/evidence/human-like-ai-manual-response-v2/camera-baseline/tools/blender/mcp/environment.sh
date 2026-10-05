#!/bin/bash
# Source this file from Bash to use the project's isolated Blender configuration.
MCP_TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MCP_PROJECT_DIR="$(cd "$MCP_TOOLS_DIR/../../.." && pwd)"
MCP_RUNTIME_DIR="$MCP_PROJECT_DIR/.cache/blender-mcp"
export UV_PROJECT_ENVIRONMENT="$MCP_RUNTIME_DIR/venv"
export UV_CACHE_DIR="$MCP_RUNTIME_DIR/uv-cache"
export BLENDER_USER_RESOURCES="$MCP_RUNTIME_DIR/blender"
export BLENDER_USER_CONFIG="$MCP_RUNTIME_DIR/blender/config"
export BLENDER_USER_EXTENSIONS="$MCP_RUNTIME_DIR/blender/extensions"
export BLENDER_USER_SCRIPTS="$MCP_RUNTIME_DIR/blender/scripts"
export BLENDER_MCP_HOST=127.0.0.1
export BLENDER_MCP_PORT=9878
export BLENDER_PATH="${BLENDER_PATH:-/Applications/Blender.app/Contents/MacOS/Blender}"
export DISABLE_TELEMETRY=true
unset VIRTUAL_ENV
MCP_UV="${MCP_UV:-$HOME/.local/bin/uv}"
if [[ ! -x "$MCP_UV" ]]; then MCP_UV="$(command -v uv)"; fi
