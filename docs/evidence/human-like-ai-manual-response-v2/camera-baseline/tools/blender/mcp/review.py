"""Import and review exact game meshes through all three project Blender MCP servers."""
import asyncio
import base64
import json
import os
import time
from pathlib import Path
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

ROOT = Path(__file__).resolve().parents[3]
CACHE = ROOT / '.cache/blender-mcp'
TOOLS = Path(__file__).resolve().parent

def data_of(response):
    if response.isError:
        raise RuntimeError(response.model_dump_json())
    texts = [c.text for c in response.content if c.type == 'text']
    if not texts: return None
    try: value = json.loads(texts[0])
    except json.JSONDecodeError: return texts[0]
    current = value
    while isinstance(current, dict):
        if current.get('status') == 'error' or current.get('error') or current.get('success') is False:
            raise RuntimeError(json.dumps(value))
        if 'result' not in current: break
        current = current['result']
    return current

async def with_server(launcher, callback):
    env = dict(os.environ, BLENDER_MCP_APPS='1', BLENDER_MCP_OPENAI_FORMS='1')
    parameters = StdioServerParameters(command='/bin/bash', args=[str(TOOLS / launcher)], cwd=str(ROOT), env=env)
    async with stdio_client(parameters) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            return await callback(session)

async def main():
    source = Path(json.loads((CACHE / 'export-summary.json').read_text())['output'])
    code_file = ROOT / 'tools/blender/import-review.py'
    code = f'review_path = {str(source)!r}\n__file__ = {str(code_file)!r}\nexec(compile(open(__file__).read(), __file__, "exec"))'
    async def lab(session):
        report = data_of(await session.call_tool('execute_blender_code', {'code': code}))
        summary = data_of(await session.call_tool('get_objects_summary', {}))
        return report, summary
    report, summary = await with_server('server.sh', lab)
    async def blend(session):
        scene = data_of(await session.call_tool('get_scene_info', {}))
        sample = report['models'][-1]['meshes'][0]['object']
        obj = data_of(await session.call_tool('get_object_info', {'object_name': sample}))
        render = data_of(await session.call_tool('render_image', {'filepath': report['render_file']}))
        return {'scene': scene, 'sample_object': obj, 'render': render}
    blend_result = await with_server('blend-ai/server.sh', blend)
    async def community(session):
        scene = data_of(await session.call_tool('get_scene_info', {'user_prompt': 'Inspect WW2 RTS game mesh QA without changes'}))
        response = await session.call_tool('get_viewport_screenshot', {'max_size': 1000, 'user_prompt': 'Inspect WW2 RTS game mesh QA without changes'})
        data_of(response)
        files = []
        for index, item in enumerate(response.content):
            if item.type != 'image': continue
            suffix = '.png' if item.mimeType == 'image/png' else '.jpg'
            destination = Path(report['render_file']).with_name(f"{Path(report['render_file']).stem}-viewport-{index}{suffix}")
            destination.write_bytes(base64.b64decode(item.data))
            files.append(str(destination))
        if not files: raise RuntimeError('Community viewport returned no image')
        return {'scene': scene, 'viewport_files': files}
    community_result = await with_server('community/server.sh', community)
    result = {'import': report, 'lab_summary': summary, 'blend_ai': blend_result, 'community': community_result}
    destination = CACHE / f"review-mcp-{time.strftime('%Y%m%d-%H%M%S')}.json"
    destination.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'report': str(destination), 'scene': report['scene'], 'blend': report['blend_file'], 'render': report['render_file'], 'viewports': community_result['viewport_files']}, indent=2))

if __name__ == '__main__':
    asyncio.run(asyncio.wait_for(main(), timeout=600))
