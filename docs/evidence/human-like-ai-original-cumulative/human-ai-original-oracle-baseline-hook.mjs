import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({ load(url, context, nextLoad) {
  const loaded = nextLoad(url, context);
  if (url !== 'file:///tmp/human-ai-original-oracle-cumulative/tools/ai-humanity.mjs') return loaded;
  const line = '      detached.original.events = oracle.detachedCopy(state.events ?? []);\n';
  const source = String(loaded.source);
  assert.equal(source.split(line).length, 2);
  return { ...loaded, source: source.replace(line, '') };
} });
