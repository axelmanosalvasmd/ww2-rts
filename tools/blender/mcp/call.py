"""Call a discovered Blender MCP tool. Read-only calls are not enforced by this helper."""
import argparse
import asyncio
import base64
import json
import os
from pathlib import Path
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from review import data_of

async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('server', choices=['lab', 'community', 'blend-ai'])
    parser.add_argument('--list', action='store_true')
    parser.add_argument('--tool')
    parser.add_argument('--args-file', type=Path)
    parser.add_argument('--output', type=Path)
    options = parser.parse_args()
    root = Path(__file__).resolve().parent
    launcher = {'lab': 'server.sh', 'community': 'community/server.sh', 'blend-ai': 'blend-ai/server.sh'}[options.server]
    env = dict(os.environ, BLENDER_MCP_APPS='1', BLENDER_MCP_OPENAI_FORMS='1')
    params = StdioServerParameters(command='/bin/bash', args=[str(root / launcher)], cwd=str(root.parents[2]), env=env)
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            if options.list:
                result = (await session.list_tools()).model_dump(mode='json')
                try: result['prompts'] = (await session.list_prompts()).model_dump(mode='json')['prompts']
                except Exception: result['prompts'] = []
            else:
                if not options.tool: parser.error('--tool is required unless --list is given')
                arguments = json.loads(options.args_file.read_text()) if options.args_file else {}
                response = await session.call_tool(options.tool, arguments)
                data_of(response)
                result = response.model_dump(mode='json')
                for index, item in enumerate(result.get('content', [])):
                    if item['type'] == 'image' and options.output:
                        suffix = 'png' if item['mimeType'] == 'image/png' else 'jpg'
                        image_path = options.output.with_name(f'{options.output.stem}-{index}.{suffix}')
                        image_path.parent.mkdir(parents=True, exist_ok=True)
                        image_path.write_bytes(base64.b64decode(item.pop('data')))
                        item['saved_path'] = str(image_path)
                if response.isError: raise RuntimeError(json.dumps(result))
            if options.output:
                options.output.parent.mkdir(parents=True, exist_ok=True)
                options.output.write_text(json.dumps(result, indent=2) + '\n')
                print(json.dumps({'output': str(options.output)}))
            else: print(json.dumps(result, indent=2))

if __name__ == '__main__':
    asyncio.run(asyncio.wait_for(main(), timeout=600))
