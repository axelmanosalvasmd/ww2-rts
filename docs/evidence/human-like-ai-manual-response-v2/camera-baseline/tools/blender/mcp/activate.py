"""Start project bridges using runtime ports without rewriting scene settings."""
import bpy
import blender_mcp
from bl_ext.ww2_rts.blend_ai import server as blend_ai_server


# Create the community listener before its automatic startup timer runs.
community = blender_mcp.BlenderMCPServer(host="127.0.0.1", port=9877)
bpy.types.blendermcp_server = community
community.start()
if not community.running:
    raise RuntimeError("MCP for Blender could not start on port 9877")
blend_ai_server.start_server(host="127.0.0.1", port=9876)
print("Project bridges started: MCP for Blender :9877, Blend AI :9876")
