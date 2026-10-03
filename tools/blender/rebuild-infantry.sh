#!/bin/bash
# Rebuild the fitted infantry skin through the project's Blender Lab connection.
set -euo pipefail
source "$(dirname "$0")/mcp/environment.sh"
mkdir -p "$MCP_RUNTIME_DIR"
python3 - "$MCP_PROJECT_DIR" "$MCP_RUNTIME_DIR/infantry-rig-args.json" <<'PY'
import json
import sys
from pathlib import Path
root = Path(sys.argv[1])
source = root / 'art/model-reference-2026-10-03/infantry-retopo-v3.glb'
output = root / 'client/models/infantry-authored-data.js'
blend = root / 'art/model-reference-2026-10-03/infantry-rig-v3.blend'
script = root / 'tools/blender/rig-infantry.py'
code = f'infantry_source={str(source)!r}\ninfantry_output={str(output)!r}\ninfantry_blend={str(blend)!r}\nexec(compile(open({str(script)!r}).read(), {str(script)!r}, "exec"))'
Path(sys.argv[2]).write_text(json.dumps({'code': code}))
PY
bash "$MCP_PROJECT_DIR/tools/blender/mcp/call.sh" lab --tool execute_blender_code \
  --args-file "$MCP_RUNTIME_DIR/infantry-rig-args.json" \
  --output "$MCP_RUNTIME_DIR/infantry-rig-result.json"
node "$MCP_PROJECT_DIR/test-infantry-authored.mjs"
