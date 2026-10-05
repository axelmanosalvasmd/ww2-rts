import argparse, hashlib, json, os, pathlib, shutil, signal, subprocess, time

ROOT = pathlib.Path('/home/judiazm/.t3/worktrees/ww2-rts/ai-human-commander')
DRAFT = pathlib.Path('/tmp/human-ai-v15-full-preregistration-draft.json')
PREREG = pathlib.Path('/tmp/human-ai-v15-full-predeclared.json')
ARCHIVE = pathlib.Path('/tmp/human-ai-v15-full-source')
BEFORE = pathlib.Path('/tmp/ai-v15-full-before.json')
AFTER = pathlib.Path('/tmp/ai-v15-full-after.json')
SENTINEL = pathlib.Path('/tmp/human-ai-v15-full-test.exit')
LOG = pathlib.Path('/tmp/human-ai-v15-full-test.log')
SUMMARY = pathlib.Path('/tmp/human-ai-v15-full-verification.json')
LAUNCH = pathlib.Path('/tmp/human-ai-v15-full-launch.json')
HISTORICAL = [pathlib.Path('/tmp/ai-v14-full-before.json'), pathlib.Path('/tmp/ai-v14-full-after.json'), pathlib.Path('/tmp/human-ai-v14-full-verification.json')]


def digest(data): return hashlib.sha256(data).hexdigest()
def file_digest(path): return digest(path.read_bytes())
def canonical(value): return digest(json.dumps(value, sort_keys=True, separators=(',', ':')).encode())
def write_new(path, value):
    with path.open('x') as handle: json.dump(value, handle, indent=2); handle.write('\n')

def snapshot():
    raw = subprocess.check_output(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], cwd=ROOT)
    names = sorted(set(raw.decode().split('\0')) - {''})
    files = {name: file_digest(ROOT / name) for name in names if (ROOT / name).is_file()}
    return {'capturedAtUnix': time.time(), 'head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(), 'files': files}

def draft():
    test = (ROOT / 'test.js').read_text()
    if "timeout: 180000" not in test: raise RuntimeError('Existing focused-test timeout changed; inspect before preregistering')
    return {'label': 'v15', 'status': 'draft, no source freeze and no tests launched', 'preparedAtUnix': time.time(),
        'root': str(ROOT), 'command': ['taskset', '-c', '4', 'node', 'test.js'], 'supervisorCPU': 0,
        'outerTimeout': None, 'focusedChildTimeoutMS': 180000,
        'timeoutPolicy': 'Keep test.js focused-child timeout unchanged. No outer wall-time kill. Do not change child timeout without observed meaningful test durations and a new prospective registration.',
        'coverage': 'Every existing tracked and nonignored untracked file returned by git ls-files --cached --others --exclude-standard, including docs/evidence/human-like-ai-v14 and tools/json-stream.mjs. Archive copies file bytes; node_modules is linked and is not part of this git file manifest.',
        'freezePolicy': 'Take only after root explicitly confirms all source and documentation edits are finished. Exclusive output paths and immutable full archive. Never adopt V14 results as V15 proof.',
        'supervision': 'Background supervisor polls child completion, production file manifest and HEAD every five seconds. Records every observed source change without a wall-time kill. Current and archived bytes are compared before and after; source changes invalidate proof even if the test exits successfully.',
        'retention': 'Single complete node test.js run. All output and failure status retained. No automatic repeat, no overwrites. V14 artifacts untouched.',
        'historicalManifests': {str(p): file_digest(p) for p in HISTORICAL}, 'scriptSHA256': file_digest(pathlib.Path(__file__)),
        'freezeCommand': ['python3', str(pathlib.Path(__file__)), '--freeze-after-root-approval'],
        'runCommand': ['python3', str(pathlib.Path(__file__)), '--run-after-root-freeze'],
        'finalizeCommand': ['python3', str(pathlib.Path(__file__)), '--finalize']}

def archive_hashes(names): return {name: file_digest(ARCHIVE / name) for name in names}

def freeze():
    for path in [PREREG, ARCHIVE, BEFORE, AFTER, SENTINEL, LOG, SUMMARY, LAUNCH]:
        if path.exists(): raise RuntimeError(f'Existing V15 verification artifact: {path}')
    proposal = json.loads(DRAFT.read_text())
    if proposal['scriptSHA256'] != file_digest(pathlib.Path(__file__)): raise RuntimeError('Script changed since draft')
    before = snapshot(); ARCHIVE.mkdir()
    for name in before['files']:
        target = ARCHIVE / name; target.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(ROOT / name, target)
    os.symlink(ROOT / 'node_modules', ARCHIVE / 'node_modules', target_is_directory=True)
    after_copy = snapshot()
    if before['files'] != after_copy['files'] or before['head'] != after_copy['head'] or before['files'] != archive_hashes(before['files']): raise RuntimeError('Source changed during full freeze')
    before.update({'startedAtUnix': before['capturedAtUnix'], 'command': proposal['command'], 'root': str(ROOT), 'scriptSHA256': proposal['scriptSHA256'],
        'archive': str(ARCHIVE), 'fileManifestDigest': canonical(before['files']), 'bytes': sum((ARCHIVE / n).stat().st_size for n in before['files']),
        'dependencyLink': {'path': str(ARCHIVE / 'node_modules'), 'target': str(ROOT / 'node_modules')}})
    write_new(BEFORE, before); BEFORE.chmod(0o444)
    for target in ARCHIVE.rglob('*'):
        if not target.is_symlink(): target.chmod(0o555 if target.is_dir() else 0o444)
    ARCHIVE.chmod(0o555)
    proposal.update({'status': 'frozen, no tests launched', 'frozenAtUnix': time.time(), 'beforeManifest': str(BEFORE), 'beforeManifestSHA256': file_digest(BEFORE),
        'files': len(before['files']), 'bytes': before['bytes'], 'head': before['head'], 'fileManifestDigest': before['fileManifestDigest'], 'archive': str(ARCHIVE), 'draftSHA256': file_digest(DRAFT)})
    write_new(PREREG, proposal); PREREG.chmod(0o444)
    print(json.dumps({'preregistration': str(PREREG), 'sha256': file_digest(PREREG), 'files': proposal['files'], 'bytes': proposal['bytes'], 'runCommand': proposal['runCommand']}, indent=2))

def validate_prepared():
    prepared = json.loads(PREREG.read_text()); before = json.loads(BEFORE.read_text())
    if file_digest(pathlib.Path(__file__)) != prepared['scriptSHA256'] or file_digest(BEFORE) != prepared['beforeManifestSHA256']: raise RuntimeError('Frozen tool or before manifest changed')
    if archive_hashes(before['files']) != before['files']: raise RuntimeError('Frozen archive changed')
    return prepared, before

def finalize():
    if AFTER.exists() or SUMMARY.exists(): raise RuntimeError('V15 finalization already exists; preserve it')
    prepared, before = validate_prepared()
    while not SENTINEL.exists(): time.sleep(1)
    raw_exit = SENTINEL.read_text().strip(); prefix = 'EXIT_CODE='
    exit_code = int(raw_exit[len(prefix):] if raw_exit.startswith(prefix) else raw_exit)
    after = snapshot(); write_new(AFTER, after)
    files = after['files']; changed = [name for name in sorted(set(before['files']) | set(files)) if before['files'].get(name) != files.get(name)]
    launch = json.loads(LAUNCH.read_text()) if LAUNCH.exists() else None
    archive_matches = archive_hashes(before['files']) == before['files']
    historical = {str(p): file_digest(p) for p in HISTORICAL}
    history_matches = historical == prepared['historicalManifests']
    observed_changes = launch.get('observedSourceChanges', []) if launch else ['Missing launch supervisor record']
    summary = {'exit': raw_exit, 'exitCode': exit_code, 'filesBefore': len(before['files']), 'filesAfter': len(files),
        'hashesIdentical': before['files'] == files, 'headIdentical': before['head'] == after['head'], 'changed': changed,
        'archiveSourcesMatch': archive_matches, 'observedSourceChanges': observed_changes, 'historicalManifestsUnchanged': history_matches,
        'fileManifestDigest': canonical(files), 'beforeManifestSHA256': file_digest(BEFORE), 'afterManifestSHA256': file_digest(AFTER),
        'predeclaredProtocolSHA256': file_digest(PREREG), 'logSHA256': file_digest(LOG), 'logBytes': LOG.stat().st_size,
        'launchRecordSHA256': file_digest(LAUNCH) if launch else None, 'startedAtUnix': launch['startedAtUnix'] if launch else before['startedAtUnix'],
        'finalizedAtUnix': after['capturedAtUnix'], 'passes': exit_code == 0 and not changed and before['head'] == after['head'] and archive_matches and history_matches and not observed_changes}
    write_new(SUMMARY, summary); print(json.dumps(summary, indent=2))

def run():
    prepared, before = validate_prepared()
    for path in [LOG, LAUNCH, SENTINEL, AFTER, SUMMARY]:
        if path.exists(): raise RuntimeError(f'Existing V15 run artifact: {path}')
    state = snapshot()
    if state['files'] != before['files'] or state['head'] != before['head']: raise RuntimeError('Source changed before test launch')
    os.sched_setaffinity(0, {prepared['supervisorCPU']})
    record = {'startedAtUnix': time.time(), 'command': prepared['command'], 'cwd': str(ROOT), 'supervisorCPU': prepared['supervisorCPU'],
        'outerTimeout': None, 'nodeVersion': subprocess.check_output(['node', '--version'], text=True).strip(), 'observedSourceChanges': []}
    child = None; interrupted = None
    try:
        with LOG.open('xb') as handle:
            child = subprocess.Popen(prepared['command'], cwd=ROOT, stdout=handle, stderr=subprocess.STDOUT, start_new_session=True)
            record['pid'] = child.pid
            print('FULL_SUITE_PID', child.pid, flush=True)
            while child.poll() is None:
                time.sleep(5)
                state = snapshot()
                if state['files'] != before['files'] or state['head'] != before['head']:
                    changed = [n for n in sorted(set(state['files']) | set(before['files'])) if state['files'].get(n) != before['files'].get(n)]
                    record['observedSourceChanges'].append({'atUnix': time.time(), 'changed': changed, 'head': state['head']})
            record['exitCode'] = child.returncode
    except BaseException as error:
        record['error'] = f'{type(error).__name__}: {error}'; interrupted = error
        if child and child.poll() is None:
            os.killpg(child.pid, signal.SIGTERM); child.wait()
        record['exitCode'] = child.returncode if child else 125
    finally:
        record['finishedAtUnix'] = time.time(); write_new(LAUNCH, record)
        with SENTINEL.open('x') as handle: handle.write(f"EXIT_CODE={record['exitCode']}\n")
    finalize()
    if interrupted: raise interrupted

def main():
    parser = argparse.ArgumentParser(); modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--draft', action='store_true'); modes.add_argument('--freeze-after-root-approval', action='store_true')
    modes.add_argument('--run-after-root-freeze', action='store_true'); modes.add_argument('--finalize', action='store_true')
    args = parser.parse_args()
    if args.draft: write_new(DRAFT, draft()); print('DRAFT_ONLY', DRAFT)
    elif args.freeze_after_root_approval: freeze()
    elif args.run_after_root_freeze:
        def interrupted(signum, frame): raise KeyboardInterrupt(f'Interrupted by signal {signum}')
        signal.signal(signal.SIGTERM, interrupted); signal.signal(signal.SIGINT, interrupted); run()
    elif args.finalize: finalize()
    else: print('Prepared only. Root freeze and launch authorization remain required.')

if __name__ == '__main__': main()
