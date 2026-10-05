import argparse, hashlib, json, os, pathlib, shutil, signal, subprocess, time

ROOT = pathlib.Path('/home/judiazm/.t3/worktrees/ww2-rts/ai-human-commander')
LABEL = 'v15'
BASELINE_PID = 1178676
BASELINE_START = '10407892'
BASELINE_ARGV = ['node', '/tmp/human-ai-selected-hud-v14-balance-source/tools/ai-balance.mjs', '--root', '/tmp/human-ai-selected-hud-v14-balance-source', '--ai', '/tmp/human-ai-selected-hud-v14-balance-source/shared/ai.js', '--mode', 'classic', '--map', 'default', '--matches', '30', '--seed', '1', '--workers', '4', '--factions', '3', '--army', 'standard', '--checkpoint', '/tmp/human-ai-selected-hud-v14-balance/classic-checkpoint.json']
PREREG = pathlib.Path('/tmp/human-ai-performance-v15-predeclared.json')
DRAFT = pathlib.Path('/tmp/human-ai-performance-v15-startup-preregistration-draft.json')
OUTPUT = pathlib.Path('/tmp/human-ai-final-performance-protocol-v15.json')
ARCHIVE = pathlib.Path('/tmp/human-ai-perf-v15-frozen')
HISTORICAL = [pathlib.Path('/tmp/human-ai-performance-v14-predeclared.json'), pathlib.Path('/tmp/human-ai-final-performance-protocol-v14.json'), pathlib.Path('/tmp/human-ai-performance-selected-hud-v13-predeclared.json'), pathlib.Path('/tmp/human-ai-final-performance-protocol-selected-hud-v13.json')]
EXPLICIT = ['tools/ai-screen-v1-oracle.js', 'tools/ai-screen-v1-oracle-provenance.json', 'tools/legacy-ai/provenance.json', 'shared/ai-priority.js', 'tools/json-stream.mjs']

def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def canonical(value): return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
def write_new(path, value):
    with path.open('x') as handle: json.dump(value, handle, indent=2); handle.write('\n')

def process(pid):
    path = pathlib.Path(f'/proc/{pid}'); fields = (path / 'stat').read_text().split(') ', 1)[1].split()
    return {'pid': pid, 'state': fields[0], 'ppid': int(fields[1]), 'startTime': fields[19], 'uid': path.stat().st_uid,
        'argv': [s.decode() for s in (path / 'cmdline').read_bytes().split(b'\0')[:-1]], 'cwd': str((path / 'cwd').resolve()), 'affinity': sorted(os.sched_getaffinity(pid))}

def owned_tree(pid):
    result = [pid]
    for task in pathlib.Path(f'/proc/{pid}/task').iterdir():
        children = task / 'children'
        if children.exists():
            for child in children.read_text().split():
                for descendant in owned_tree(int(child)):
                    if descendant not in result: result.append(descendant)
    return result

def source_files(root):
    names = {n for n in ['package.json', 'pnpm-lock.yaml', 'server.js', 'tickmeter.js', 'tools/bench-engine.mjs'] if (root / n).is_file()}
    for directory in ['tools', 'shared', 'client']:
        for pattern in ['*.js', '*.mjs', '*.json']:
            names.update(str(p.relative_to(root)) for p in (root / directory).rglob(pattern) if p.is_file())
    names.update(str(p.relative_to(root)) for p in (root / 'maps').glob('*.json'))
    names.update(str(p.relative_to(root)) for p in (root / 'tools/legacy-ai').glob('*') if p.is_file())
    for name in EXPLICIT:
        if not (root / name).is_file(): raise RuntimeError(f'Missing explicit runtime/oracle provenance source: {name}')
        names.add(name)
    return sorted(names)

def sources(root): return {name: digest(root / name) for name in source_files(root)}
def named_sources(root, names): return {name: digest(root / name) for name in names}

def instrument(original):
    needle = 'return { count: values.length, p50:'
    if original.count(needle) != 1: raise RuntimeError('Unexpected benchmark stats helper')
    changed = original.replace(needle, 'return { count: values.length, over40MS: values.filter(value => value > 40).length, p50:')
    start = '    for (let n = 0; n < ticks && g.winner === null; n++) {'; end = "    if (name === 'collapse') {"
    def loop(text):
        at = text.index(start); return text[at:text.index(end, at)]
    if loop(original) != loop(changed): raise RuntimeError('Measured loop changed')
    return changed

def rows():
    result = []
    for counts, script, suffix in [(False, 'bench-engine.mjs', ''), (True, 'bench-engine-counts.mjs', '-counts')]:
        for seat in ['before', 'after']:
            out = pathlib.Path(f'/tmp/human-ai-bench-{LABEL}-{seat}{suffix}.json')
            argv = ['taskset', '-c', '6', 'node', str(ARCHIVE / 'tools' / script), '--case', 'ai', '--ticks', '1000', '--out', str(out)]
            if seat == 'before': argv += ['--ai', str(ARCHIVE / 'tools/legacy-ai/ai.js')]
            result.append({'seat': seat, 'counts': counts, 'argv': argv, 'out': str(out)})
    return result

def draft():
    return {'label': LABEL, 'status': 'draft, source freeze not taken, no benchmark launched', 'preparedAt': time.time(),
        'case': 'ai', 'ticks': 1000, 'seats': 6, 'map': 'six-fronts', 'cpu': 6, 'expectedThreadSiblings': '6-7', 'supervisorCPU': 0,
        'order': ['exact legacy', 'exact current', 'counts legacy', 'counts current'], 'rows': rows(),
        'gate': 'Each pair: AI-phase p95 and max increase <= max(2 ms, 10% baseline). Counts pair: timed step+AI+snapshot ticks >40 ms must not increase. Both gate distributions preserve the original 10-tick warmup exclusion.',
        'startupAccounting': {'method': 'Retain every startupMilliseconds field from every bench-engine row and display startup ai milliseconds separately in each pair. No startup numerical gate is introduced.', 'current': 'Six public-start calls at simulation tick 0 before the timed loop; unit observation begins at tick 2.', 'legacy': 'Pre-loop humanCommander branch is not executed. startupMilliseconds.ai is zero for that branch, not a measurement of all legacy initialization. Initial legacy observation is inside the excluded warmup.', 'coverage': {'startupInNumericGates': False, 'first10TicksInNumericGates': False, 'all1000TicksInNumericGates': False, 'warmTickSamplesExpected': 990, 'currentCommanderStartedTick2': False, 'currentCommanderExpectedStartedTick': 0, 'firstFullObservationExpectedTick': 2, 'startTickBasis': 'Source-derived from frozen public-start helper and benchmark loop, not runtime diagnostics.'}, 'otherTool': 'tools/bench.mjs startupMicroseconds.ai includes initial snapshotCache plus setup/observe calls; its loop distributions retain all ticks. It is archived but is not a fifth performance row or the source of these gates.'},
        'draftSupersedes': {'path': '/tmp/human-ai-performance-v15-preregistration-draft.json', 'sha256': digest(pathlib.Path('/tmp/human-ai-performance-v15-preregistration-draft.json'))},
        'retention': 'One row per combination, fixed order, all results including failures retained. No selective repeats or overwrites. All V13/V14 artifacts remain untouched.',
        'pause': {'pid': BASELINE_PID, 'startTime': BASELINE_START, 'argv': BASELINE_ARGV, 'cwd': str(ROOT),
            'policy': 'Pause only this verified owned Classic runner and its descendants if still live. Restore only signals sent by this supervisor, with PID start-time guards, in finally. No foreign work is signaled.'},
        'supervision': 'Background supervisor polls child completion and production/archive source hashes at one-second intervals. No outer wall-time kill or per-row timeout. Expected quiet window about 30 seconds; actual elapsed time is recorded.',
        'sourceCoverage': 'All tools/shared/client JS, MJS and JSON; map JSON; root runtime/package files; explicit oracle, oracle provenance, legacy provenance, priority runtime and public JSON streaming helper.',
        'baselineMapping': {'legacyCommit': '5293ddb1a0267f90e9ddba5a1d2cc725ba3f7bd3', 'masterReference': 'a3564a6a7bcd733900953b57854ba2d5bd885147', 'comparison': 'AI-only switch on the identical frozen current engine, terrain, helpers and six-fronts map. Legacy AI/view/mind come from tools/legacy-ai with import adaptations recorded in provenance.json. Current shared/sim.js differs from master reference; this is not a whole-master engine before/after.'},
        'additionalPauseTargets': [],
        'additionalPausePolicy': 'Only explicit root-authorized PID identities passed to freeze with --pause-owned-pid. Require current UID and an affinity containing CPU 6 or 7. Capture exact argv, cwd and start time. No automatic process-name matching or foreign signaling.',
        'historicalManifests': {str(p): digest(p) for p in HISTORICAL}, 'scriptSHA256': digest(pathlib.Path(__file__)),
        'freezeCommand': ['python3', str(pathlib.Path(__file__)), '--freeze-after-root-approval'],
        'runCommand': ['python3', str(pathlib.Path(__file__)), '--run-after-root-freeze']}

def freeze(extra_pids=()):
    if PREREG.exists() or ARCHIVE.exists() or OUTPUT.exists(): raise RuntimeError('V15 freeze/run paths already exist; preserve them')
    proposal = json.loads(DRAFT.read_text())
    if proposal['scriptSHA256'] != digest(pathlib.Path(__file__)): raise RuntimeError('Script changed after draft preregistration')
    initial = sources(ROOT)
    targets = []
    for pid in extra_pids:
        identity = process(pid)
        if identity['uid'] != os.getuid() or not set(identity['affinity']) & {6, 7}: raise RuntimeError('Additional authorized pause process is not owned or does not share CPU 6/7')
        targets.append(identity)
    proposal['additionalPauseTargets'] = targets
    proposal['headAtFreeze'] = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    proposal['masterReferenceSources'] = {}
    for name in ['shared/sim.js', 'shared/ai.js', 'tools/bench-engine.mjs']:
        try: proposal['masterReferenceSources'][name] = hashlib.sha256(subprocess.check_output(['git', 'show', proposal['baselineMapping']['masterReference'] + ':' + name], cwd=ROOT, stderr=subprocess.DEVNULL)).hexdigest()
        except subprocess.CalledProcessError: proposal['masterReferenceSources'][name] = None
    ARCHIVE.mkdir()
    for name in initial:
        target = ARCHIVE / name; target.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(ROOT / name, target)
    os.symlink(ROOT / 'node_modules', ARCHIVE / 'node_modules', target_is_directory=True)
    counter = ARCHIVE / 'tools/bench-engine-counts.mjs'; counter.write_text(instrument((ARCHIVE / 'tools/bench-engine.mjs').read_text()))
    if initial != sources(ROOT) or initial != named_sources(ARCHIVE, initial): raise RuntimeError('Source changed during freeze')
    proposal.update({'status': 'frozen, no benchmark launched', 'frozenAt': time.time(), 'checkpointRoot': str(ARCHIVE),
        'sourceCopies': initial, 'sourceCheckpointSHA256': canonical(initial), 'draftSHA256': digest(DRAFT),
        'statsInstrumentation': {'file': str(counter), 'sha256': digest(counter), 'change': 'Only final stats helper adds over40MS; measured loop byte-identical'},
        'dependencyLink': {'path': str(ARCHIVE / 'node_modules'), 'target': str(ROOT / 'node_modules')}})
    for target in ARCHIVE.rglob('*'):
        if not target.is_symlink(): target.chmod(0o555 if target.is_dir() else 0o444)
    ARCHIVE.chmod(0o555); write_new(PREREG, proposal); PREREG.chmod(0o444)
    print(json.dumps({'preregistration': str(PREREG), 'sha256': digest(PREREG), 'runCommand': proposal['runCommand']}, indent=2))

def accounting(report):
    item = report['cases'][0]
    return {'startupMilliseconds': item.get('startupMilliseconds'),
        'startupFieldAvailable': 'startupMilliseconds' in item,
        'warmupTicksExcluded': item.get('warmupTicksExcluded'),
        'requestedTicks': report['requestedTicks'], 'completedTicks': item['ticks'],
        'aiLatencySamples': item['milliseconds']['ai']['count'],
        'tickLatencySamples': item['milliseconds']['tick']['count'],
        'timedTickScope': 'step+AI+snapshot serialization within each sampled tick, excluding subsequent peak-count housekeeping and pre-loop initialization',
        'over40MSScope': 'strictly greater than 40 milliseconds on raw sampled tick durations before rounding; first ten loop ticks excluded',
        'startupInNumericGates': False, 'first10TicksInNumericGates': False,
        'aiCommander': report.get('aiCommander')}

def pair(before_path, after_path, counts):
    a = json.loads(before_path.read_text()); b = json.loads(after_path.read_text())
    if a['sourceSHA256'] != b['sourceSHA256']: raise RuntimeError('Pair source hashes differ')
    for row in [a, b]:
        if row['requestedTicks'] != 1000 or row['selectedCases'] != ['ai'] or len(row['cases']) != 1: raise RuntimeError('Wrong benchmark case/ticks')
        if row['cases'][0]['ticks'] != 1000: raise RuntimeError('Benchmark ended before 1000 ticks')
        if row['cases'][0]['fixture']['map'] != 'six-fronts' or row['cases'][0]['fixture']['players'] != 6: raise RuntimeError('Wrong map or seat count')
    before_accounting = accounting(a); after_accounting = accounting(b)
    a = a['cases'][0]; b = b['cases'][0]; checks = {}
    for metric in ['p95', 'max']:
        baseline = a['milliseconds']['ai'][metric]; candidate = b['milliseconds']['ai'][metric]; tolerance = max(2, baseline * .1)
        checks[metric] = {'beforeMS': baseline, 'afterMS': candidate, 'toleranceMS': tolerance, 'passes': candidate <= baseline + tolerance}
    if counts:
        old = a['milliseconds']['tick']['over40MS']; new = b['milliseconds']['tick']['over40MS']
        checks['ticksOver40MS'] = {'before': old, 'after': new, 'passes': new <= old}
    return {'files': [str(before_path), str(after_path)], 'checks': checks, 'sourceHashesMatch': True,
        'accounting': {'before': before_accounting, 'after': after_accounting},
        'startupAISeparateMS': {'before': (a.get('startupMilliseconds') or {}).get('ai'), 'after': (b.get('startupMilliseconds') or {}).get('ai'), 'numericalGate': None, 'legacyZeroInterpretation': 'Unexecuted pre-loop startup branch, not proof of cost-free legacy initialization.'},
        'beforeThinkCalls': a['events']['aiThinkCalls'], 'afterThinkCalls': b['events']['aiThinkCalls'],
        'beforeFinalStateSHA256': a['finalStateSHA256'], 'afterFinalStateSHA256': b['finalStateSHA256'],
        'reportSHA256': {str(p): digest(p) for p in [before_path, after_path]}}

def cpu_states():
    return {row[0]: [int(v) for v in row[1:]] for line in pathlib.Path('/proc/stat').read_text().splitlines()
        if (row := line.split()) and row[0] in ['cpu6', 'cpu7']}

def workloads():
    result = []
    for entry in pathlib.Path('/proc').iterdir():
        if not entry.name.isdigit(): continue
        try:
            identity = process(int(entry.name)); argv = identity['argv']
            if argv and pathlib.Path(argv[0]).name == 'node' and any('tools/ai-' in a or 'tools/bench-' in a or a == 'test.js' for a in argv[1:]): result.append(identity)
        except (OSError, UnicodeError, ValueError): pass
    return result

def run():
    if OUTPUT.exists(): raise RuntimeError('V15 manifest already exists; preserve it')
    prepared = json.loads(PREREG.read_text()); initial = prepared['sourceCopies']; stopped = []; child = None
    if prepared['scriptSHA256'] != digest(pathlib.Path(__file__)): raise RuntimeError('Supervisor changed after preregistration')
    if prepared['supervisorCPU'] not in os.sched_getaffinity(0): raise RuntimeError('Predeclared supervisor CPU unavailable')
    os.sched_setaffinity(0, {prepared['supervisorCPU']})
    record = {'label': LABEL, 'startedAt': time.time(), 'predeclaredProtocolSHA256': digest(PREREG), 'sourceCopies': initial,
        'checkpointRoot': str(ARCHIVE), 'supervisorCPU': prepared['supervisorCPU'], 'nodeVersion': subprocess.check_output(['node', '--version'], text=True).strip(), 'rows': [], 'pairs': [], 'pauseTarget': prepared['pause'], 'baselineResumed': False}
    def verify():
        if initial != sources(ROOT): raise RuntimeError('Production runtime source changed')
        if initial != named_sources(ARCHIVE, initial): raise RuntimeError('Archived runtime source changed')
        if digest(ARCHIVE / 'tools/bench-engine-counts.mjs') != prepared['statsInstrumentation']['sha256']: raise RuntimeError('Stats instrumentation changed')
    def stop(identity):
        live = process(identity['pid'])
        if live['startTime'] != identity['startTime'] or live['uid'] != os.getuid() or live['cwd'] != identity['cwd'] or live['argv'] != identity['argv']: raise RuntimeError('Owned process identity changed')
        if live['state'] not in ['T', 't']:
            os.kill(identity['pid'], signal.SIGSTOP); stopped.append(identity)
    try:
        verify()
        for row in prepared['rows']:
            if pathlib.Path(row['out']).exists(): raise RuntimeError('Predeclared row already exists; do not overwrite')
        if pathlib.Path(f'/proc/{BASELINE_PID}').exists():
            owner = process(BASELINE_PID)
            if owner['startTime'] != BASELINE_START or owner['argv'] != BASELINE_ARGV or owner['cwd'] != str(ROOT) or owner['uid'] != os.getuid(): raise RuntimeError('Classic runner is not the predeclared owned process')
            record['baselineIdentity'] = owner; stop(owner)
            for pid in owned_tree(BASELINE_PID):
                if pid != BASELINE_PID: stop(process(pid))
            deadline = time.monotonic() + 5
            while any(process(i['pid'])['state'] not in ['T', 't'] for i in stopped):
                if time.monotonic() > deadline: raise RuntimeError('Owned runner did not stop promptly')
                time.sleep(.02)
            record['pausedAt'] = time.time(); print('OWNED_CLASSIC_PAUSED', [i['pid'] for i in stopped], flush=True)
        else: record['baselineComplete'] = True
        record['additionalPausedRoots'] = []
        for identity in prepared['additionalPauseTargets']:
            if not pathlib.Path(f"/proc/{identity['pid']}").exists(): continue
            stop(identity)
            for pid in owned_tree(identity['pid']):
                if pid != identity['pid']: stop(process(pid))
            record['additionalPausedRoots'].append(identity['pid'])
        if stopped:
            deadline = time.monotonic() + 5
            while any(pathlib.Path(f"/proc/{i['pid']}").exists() and process(i['pid'])['state'] not in ['T', 't'] for i in stopped):
                if time.monotonic() > deadline: raise RuntimeError('Authorized owned processes did not stop promptly')
                time.sleep(.02)
        siblings = pathlib.Path('/sys/devices/system/cpu/cpu6/topology/thread_siblings_list').read_text().strip()
        if siblings != prepared['expectedThreadSiblings']: raise RuntimeError('CPU sibling topology differs from preregistration')
        record['cpuAffinity'] = 6; record['threadSiblings'] = siblings; record['loadBefore'] = pathlib.Path('/proc/loadavg').read_text().strip(); record['cpuStatesBefore'] = cpu_states(); record['relevantProcessesBefore'] = workloads()
        for row in prepared['rows']:
            verify(); start = time.time(); log = pathlib.Path(row['out']).with_suffix('.log')
            if log.exists(): raise RuntimeError('Row log already exists')
            with log.open('xb') as handle:
                child = subprocess.Popen(row['argv'], cwd=ARCHIVE, stdout=handle, stderr=subprocess.STDOUT)
                entry = {**row, 'pid': child.pid, 'startedAt': start, 'log': str(log)}; record['rows'].append(entry)
                print('RUN_PID', child.pid, json.dumps(row['argv']), flush=True)
                while child.poll() is None:
                    time.sleep(1); verify()
                entry.update({'exit': child.returncode, 'finishedAt': time.time(), 'logSHA256': digest(log)})
                if pathlib.Path(row['out']).exists():
                    entry['reportSHA256'] = digest(pathlib.Path(row['out']))
                    entry['accounting'] = accounting(json.loads(pathlib.Path(row['out']).read_text()))
                    print('ROW_STARTUP_ACCOUNTING', json.dumps(entry['accounting']), flush=True)
                if child.returncode: raise RuntimeError(f'Benchmark exited {child.returncode}')
                child = None
        verify()
        for counts, suffix in [(False, ''), (True, '-counts')]: record['pairs'].append(pair(pathlib.Path(f'/tmp/human-ai-bench-{LABEL}-before{suffix}.json'), pathlib.Path(f'/tmp/human-ai-bench-{LABEL}-after{suffix}.json'), counts))
        record.update({'productionSourcesAfterMatch': True, 'archiveSourcesAfterMatch': True, 'passes': all(c['passes'] for p in record['pairs'] for c in p['checks'].values()), 'loadAfter': pathlib.Path('/proc/loadavg').read_text().strip(), 'cpuStatesAfter': cpu_states(), 'relevantProcessesAfter': workloads()})
    except BaseException as error:
        record['error'] = f'{type(error).__name__}: {error}'
        if child and child.poll() is None: child.terminate(); child.wait()
        raise
    finally:
        resumed = []; errors = []
        for identity in reversed(stopped):
            try:
                live = process(identity['pid'])
                if live['startTime'] == identity['startTime'] and live['uid'] == identity['uid'] and live['argv'] == identity['argv'] and live['cwd'] == identity['cwd']:
                    os.kill(identity['pid'], signal.SIGCONT); resumed.append(identity['pid'])
            except (ProcessLookupError, FileNotFoundError): pass
            except Exception as error: errors.append(str(error))
        record.update({'resumedPIDs': resumed, 'resumeErrors': errors, 'baselineResumed': BASELINE_PID in resumed,
            'finishedAt': time.time(), 'historicalManifestsAfter': {str(p): digest(p) for p in HISTORICAL}})
        write_new(OUTPUT, record); print('FINISHED', str(OUTPUT), 'RESUMED', resumed, flush=True)

def main():
    parser = argparse.ArgumentParser(); group = parser.add_mutually_exclusive_group()
    group.add_argument('--draft', action='store_true'); group.add_argument('--freeze-after-root-approval', action='store_true'); group.add_argument('--run-after-root-freeze', action='store_true')
    parser.add_argument('--pause-owned-pid', action='append', type=int, default=[])
    args = parser.parse_args()
    if args.pause_owned_pid and not args.freeze_after_root_approval: parser.error('--pause-owned-pid is only valid during explicitly authorized freeze')
    if args.draft: write_new(DRAFT, draft()); print('DRAFT_ONLY', DRAFT)
    elif args.freeze_after_root_approval: freeze(args.pause_owned_pid)
    elif args.run_after_root_freeze:
        def interrupted(signum, frame): raise KeyboardInterrupt(f'Interrupted by signal {signum}')
        signal.signal(signal.SIGTERM, interrupted); signal.signal(signal.SIGINT, interrupted); run()
    else: print('Prepared only. Root freeze and launch authorization remain required.')

if __name__ == '__main__': main()
