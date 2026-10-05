import subprocess,json,time
from pathlib import Path
b=Path("/tmp/manual-v2-root-adoption")
rows=[]
for test in ["test-engine-ai-manual-response-policy.js","test-engine-ai-humanity.js","test-engine-ai-humanity-multievent.js","test-engine-ai-measurement-streams.js"]:
 with (b/(test+".log")).open("xb") as log:
  started=time.time();r=subprocess.run(["taskset","-c","1","node",test],stdout=log,stderr=subprocess.STDOUT)
 rows.append({"test":test,"exitCode":r.returncode,"startedUnix":started,"finishedUnix":time.time()})
 (b/"results.json").write_text(json.dumps(rows,indent=2)+"\n")
 if r.returncode:break
