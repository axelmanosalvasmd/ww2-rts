from pathlib import Path
import subprocess,json,hashlib,datetime
base=Path('/home/judiazm/.t3/worktrees/ww2-rts/ai-human-commander')
files=['test-engine-ai-local-engineer.js','test-engine-ai-accepted-destinations.js','test-engine-ai-attended-danger.js','test-engine-ai-causal-orders.js','test-engine-ai-tactical-reaction.js','test-engine-ai-response.js','test-engine-ai-selected-hud.js']
source={str(p.relative_to(base)):hashlib.sha256(p.read_bytes()).hexdigest() for p in [base/'shared/ai.js',base/'shared/ai-commander.js',base/'shared/ai-hands.js',base/'test.js']}
rows=[]
for file in files:
 start=datetime.datetime.now(datetime.timezone.utc).isoformat()
 log=Path('/tmp/r6-root-consolidated-'+file+'.log')
 with log.open('xb') as f:
  result=subprocess.run(['/usr/bin/node',file],cwd=base,stdin=subprocess.DEVNULL,stdout=f,stderr=subprocess.STDOUT)
 rows.append({'file':file,'exitCode':result.returncode,'start':start,'end':datetime.datetime.now(datetime.timezone.utc).isoformat(),'log':str(log),'logSha256':hashlib.sha256(log.read_bytes()).hexdigest()})
 Path('/tmp/r6-root-consolidated-progress.json').write_text(json.dumps({'source':source,'rows':rows},indent=2)+'\n')
 if result.returncode:break
unchanged=all(hashlib.sha256((base/name).read_bytes()).hexdigest()==sha for name,sha in source.items())
Path('/tmp/r6-root-consolidated-result.json').write_text(json.dumps({'source':source,'sourceUnchanged':unchanged,'rows':rows},indent=2)+'\n')
