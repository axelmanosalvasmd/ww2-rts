"""Save MCP preferences in the configuration selected by environment.sh."""
import bpy

module = "bl_ext.ww2_rts.mcp"
if module not in bpy.context.preferences.addons:
    bpy.ops.preferences.addon_enable(module=module)
prefs = bpy.context.preferences.addons[module].preferences
prefs.host = "127.0.0.1"
prefs.port = 9878
prefs.use_autostart = True
bpy.context.preferences.system.use_online_access = True
for addon in ["blender_mcp", "bl_ext.ww2_rts.blend_ai"]:
    if addon not in bpy.context.preferences.addons:
        bpy.ops.preferences.addon_enable(module=addon)
bpy.ops.wm.save_userpref()
print("Configured Blender Lab :9878, MCP for Blender :9877, Blend AI :9876")
