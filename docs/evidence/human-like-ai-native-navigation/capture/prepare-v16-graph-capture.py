from pathlib import Path
import shutil
src=Path('/tmp/human-ai-perf-v16-frozen');dst=Path('/tmp/ai-v16-graph-capture')
if not dst.exists():shutil.copytree(src,dst,symlinks=True)
for p in dst.rglob("*"):
 if p.is_file() and not p.is_symlink():p.chmod(0o644)
p=dst/'shared/navigation.js';s=p.read_text();needle='  const W = g.w, H = g.h, N = W * H, flags = g.flags, height = g.height;'
assert s.count(needle)==1
s=s.replace(needle,"  globalThis.__graphFixtures?.push(structuredClone({tick:g.tick,w:g.w,h:g.h,flags:g.flags,height:g.height,block,chunkSize,infantryRegionVersion:g.infantryRegionVersion,navalRegionVersion:g.navalRegionVersion,vehicleRegionVersion:g.vehicleRegionVersion,obstructionVersion:g.obstructionVersion,navigationKnowledge:g.navigationKnowledge,navigationKnowledgeVersion:g.navigationKnowledgeVersion}));\n"+needle);p.write_text(s)
p=dst/'tools/bench-engine.mjs';s=p.read_text();s="import {serialize} from 'node:v8';\nglobalThis.__graphFixtures=[];\n"+s;s=s.replace('await writeFile(output, JSON.stringify(report, null, 2)',"await writeFile('/tmp/ai-v16-graph-fixtures.bin',serialize(globalThis.__graphFixtures));\nawait writeFile(output, JSON.stringify(report, null, 2)");p.write_text(s)
