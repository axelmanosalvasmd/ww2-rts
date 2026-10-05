import pathlib, subprocess, time, json, hashlib, os, signal
root = pathlib.Path('/home/judiazm/.t3/worktrees/ww2-rts/ai-human-commander')
base = pathlib.Path('/tmp/human-ai-r11-world-diagnostic-root')
def hashes():
    return {n: hashlib.sha256((root/n).read_bytes()).hexdigest() for n in ['test-world-teams.js','server.js','test.js']}
before = hashes()
(base/'before.json').write_text(json.dumps(before,indent=2)+'\n')
command = ['taskset','-c','4','node','--require',str(base/'preload.cjs'),'test-world-teams.js']
started = time.monotonic(); timeout = False
with (base/'native.log').open('xb') as output, (base/'diagnostics.jsonl').open('xb') as error, (base/'process-samples.jsonl').open('x') as samples:
    child = subprocess.Popen(command,cwd=root,stdout=output,stderr=error,start_new_session=True)
    (base/'launch.json').write_text(json.dumps({'pid':child.pid,'command':command,'nativeDeadlineMS':180000,'startedAtUnix':time.time()},indent=2)+'\n')
    while child.poll() is None:
        remaining = 180 - (time.monotonic()-started)
        if remaining <= 0:
            timeout = True; child.send_signal(signal.SIGTERM); child.wait(); break
        try:
            status = pathlib.Path(f'/proc/{child.pid}/status').read_text()
            stat = pathlib.Path(f'/proc/{child.pid}/stat').read_text().split()
            samples.write(json.dumps({'elapsedSeconds':time.monotonic()-started,'status':status,'userTicks':stat[13],'systemTicks':stat[14]})+'\n');samples.flush()
        except FileNotFoundError: pass
        try: child.wait(timeout=min(1,remaining))
        except subprocess.TimeoutExpired: pass
    result = {'exitCode':child.returncode,'timedOutAt180s':timeout,'elapsedSeconds':time.monotonic()-started,'naturalCompletion':not timeout,'before':before,'after':hashes()}
    result['sourceIdentical'] = result['before']==result['after']
    result['passes'] = child.returncode==0 and not timeout and result['sourceIdentical']
    (base/'result.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result,indent=2),flush=True)
    raise SystemExit(0 if result['passes'] else 1)
