"""Discover each MCP server and read the same Blender scene without editing it."""
import asyncio
import json
import os
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


async def check(name, launcher, tool, arguments, apps=False):
    script_dir = Path(__file__).resolve().parent
    env = dict(os.environ)
    if apps:
        env.update(BLENDER_MCP_APPS="1", BLENDER_MCP_OPENAI_FORMS="1")
    params = StdioServerParameters(
        command="/bin/bash", args=[str(script_dir / launcher)],
        cwd=str(script_dir.parents[2]), env=env,
    )
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            initialization = await session.initialize()
            tools = await session.list_tools()
            scene = await session.call_tool(tool, arguments)
            if scene.isError:
                raise RuntimeError(scene.model_dump_json())
            texts = [item.text for item in scene.content if item.type == "text"]
            if not texts:
                raise RuntimeError(f"{name} returned no scene data")
            data = json.loads(texts[0])
            if data.get("status") == "error" or data.get("error"):
                raise RuntimeError(f"{name}: {data}")
            result = {
                "integration": name,
                "server": initialization.serverInfo.model_dump(),
                "tool_count": len(tools.tools),
                "scene": data,
            }
            if apps:
                resources = await session.list_resources()
                ui = next(resource for resource in resources.resources
                          if str(resource.uri).startswith("ui://"))
                html = await session.read_resource(ui.uri)
                assert any("<html" in item.text.lower() for item in html.contents)
                viewport = await session.call_tool("get_viewport_screenshot", {
                    "max_size": 600, "user_prompt": "Verify the Blender connection",
                })
                if viewport.isError:
                    raise RuntimeError(viewport.model_dump_json())
                images = [item for item in viewport.content if item.type == "image"]
                assert images, "Viewport returned no image"
                result["viewport"] = {
                    "resource": str(ui.uri), "mime_type": ui.mimeType,
                    "image_count": len(images),
                }
            print(json.dumps(result, indent=2))


async def main():
    await check("Blender Lab", "server.sh", "get_objects_summary", {})
    await check("MCP for Blender", "community/server.sh", "get_scene_info", {
        "user_prompt": "Verify project setup without editing the scene",
    }, apps=True)
    await check("Blend AI", "blend-ai/server.sh", "get_scene_info", {})


if __name__ == "__main__":
    asyncio.run(asyncio.wait_for(main(), timeout=90))
