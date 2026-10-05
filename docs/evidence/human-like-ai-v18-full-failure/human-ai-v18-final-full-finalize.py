import argparse, hashlib, json, os, pathlib, re, shutil, signal, subprocess, sys, time

ROOT = pathlib.Path('/home/judiazm/.t3/worktrees/ww2-rts/ai-human-commander')
BASE = pathlib.Path('/tmp')
SCRIPT = pathlib.Path(__file__).resolve()
DRAFT = BASE / 'human-ai-v18-final-full-preregistration-draft.json'
ORIGINAL_DRAFT = BASE / 'human-ai-v16-full-preregistration-draft.json'
ORIGINAL_SUPERVISOR = BASE / 'human-ai-v16-full-finalize.py'
PREREG = BASE / 'human-ai-v18-final-full-predeclared.json'
ARCHIVE = BASE / 'human-ai-v18-final-full-source'
BEFORE = BASE / 'ai-v18-final-full-before.json'
AFTER = BASE / 'ai-v18-final-full-after.json'
SENTINEL = BASE / 'human-ai-v18-final-full-test.exit'
LOG = BASE / 'human-ai-v18-final-full-test.log'
SUMMARY = BASE / 'human-ai-v18-final-full-verification.json'
LAUNCH = BASE / 'human-ai-v18-final-full-launch.json'
COMPLETION = BASE / 'human-ai-v18-final-full-completion.json'
CHECKS = BASE / 'human-ai-v18-final-full-checks.jsonl'
CONTROLLER = BASE / 'human-ai-v18-final-full-controller.log'
BACKGROUND = BASE / 'human-ai-v18-final-full-background-launch.json'
FINAL_COLLECTOR_TESTS = {'test-engine-ai-manual-response-policy.js', 'test-engine-ai-manual-response-isolation.js', 'test-engine-ai-attended-guard.js', 'test-engine-ai-guard-ability-choice.js', 'test-engine-ai-hesitation.js'}
HISTORICAL = [BASE / name for name in ['ai-v14-full-before.json', 'ai-v14-full-after.json', 'human-ai-v14-full-verification.json',
    'ai-v15-full-before.json', 'ai-v15-full-after.json', 'human-ai-v15-full-verification.json', 'human-ai-v15-full-test.log']]
HISTORICAL += [ORIGINAL_DRAFT, ORIGINAL_SUPERVISOR, BASE / 'human-ai-v16-full-revised-finalize.py', BASE / 'human-ai-v16-full-revised-preregistration-draft.json', BASE / 'human-ai-v16-directory-link-failed-freeze-preservation.json', BASE / 'human-ai-v16-full-v3-finalize.py', BASE / 'human-ai-v16-full-v3-preregistration-draft.json']

HISTORICAL += [BASE / name for name in ['human-ai-v16-full-v4-finalize.py', 'human-ai-v16-full-v4-preregistration-draft.json', 'ai-v16-full-before.json', 'ai-v16-full-after.json', 'human-ai-v16-full-predeclared.json', 'human-ai-v16-full-test.log', 'human-ai-v16-full-test.exit', 'human-ai-v16-full-verification.json', 'human-ai-v16-full-launch.json', 'human-ai-v16-full-completion.json', 'human-ai-v16-full-checks.jsonl', 'human-ai-v16-full-background-launch.json']]

HISTORICAL += [BASE / name for name in ['human-ai-v17-full-finalize.py', 'human-ai-v17-full-preregistration-draft.json', 'ai-v17-full-before.json', 'ai-v17-full-after.json', 'human-ai-v17-full-predeclared.json', 'human-ai-v17-full-test.log', 'human-ai-v17-full-test.exit', 'human-ai-v17-full-verification.json', 'human-ai-v17-full-launch.json', 'human-ai-v17-full-completion.json', 'human-ai-v17-full-checks.jsonl', 'human-ai-v17-full-background-launch.json']]

HISTORICAL += [BASE / 'human-ai-v18-full-finalize.py']

HISTORICAL += [BASE / 'human-ai-v18-guard-full-finalize.py', BASE / 'human-ai-v18-guard-full-preregistration-draft.json']


def digest(data): return hashlib.sha256(data).hexdigest()
def file_digest(path): return digest(path.read_bytes())
def canonical(value): return digest(json.dumps(value, sort_keys=True, separators=(',', ':')).encode())
def write_new(path, value):
    with path.open('x') as handle:
        json.dump(value, handle, indent=2); handle.write('\n'); handle.flush(); os.fsync(handle.fileno())
def git(*args): return subprocess.check_output(['git', *args], cwd=ROOT)


def entry(path):
    if path.is_symlink():
        target = os.readlink(path)
        return {'kind': 'symlink', 'target': target, 'sha256': digest(os.fsencode(target))}
    if path.is_file(): return {'kind': 'file', 'sha256': file_digest(path), 'bytes': path.stat().st_size}
    raise RuntimeError(f'Manifest member missing or unsupported: {path}')


def snapshot():
    names = sorted(set(os.fsdecode(git('ls-files', '--cached', '--others', '--exclude-standard', '-z')).split('\0')) - {''})
    return {'capturedAtUnix': time.time(), 'head': git('rev-parse', 'HEAD').decode().strip(),
        'files': {name: entry(ROOT / name) for name in names}}


def archive_snapshot():
    files = {}
    for current, directories, names in os.walk(ARCHIVE, followlinks=False):
        directory = pathlib.Path(current)
        for name in list(directories):
            path = directory / name
            if path == ARCHIVE / 'node_modules': directories.remove(name); continue
            if path.is_symlink(): files[str(path.relative_to(ARCHIVE))] = entry(path); directories.remove(name)
        for name in names:
            path = directory / name
            if path != ARCHIVE / 'node_modules': files[str(path.relative_to(ARCHIVE))] = entry(path)
    return dict(sorted(files.items()))


def captured_source_links(files, root):
    declared = {}
    for name, metadata in files.items():
        if metadata['kind'] != 'symlink': continue
        if pathlib.Path(metadata['target']).is_absolute(): raise RuntimeError(f'Absolute source symlink requires review: {name}')
        try: resolved = (root / name).resolve(strict=True)
        except (OSError, RuntimeError) as error: raise RuntimeError(f'Missing or cyclic source symlink target: {name}') from error
        if not resolved.is_relative_to(root): raise RuntimeError(f'External source symlink target: {name}')
        relative = str(resolved.relative_to(root))
        if resolved.is_file():
            if files.get(relative) != entry(resolved): raise RuntimeError(f'Source symlink file target is not captured: {name}')
            declared[name] = {'kind': 'file', 'path': relative}
        elif resolved.is_dir():
            subtree = {}
            for current, directories, names in os.walk(resolved, followlinks=False):
                directory = pathlib.Path(current)
                for child in list(directories):
                    path = directory / child
                    if path.is_symlink(): subtree[str(path.relative_to(root))] = entry(path); directories.remove(child)
                for child in names:
                    path = directory / child; subtree[str(path.relative_to(root))] = entry(path)
            captured = {path: value for path, value in files.items() if path.startswith(relative + '/')}
            if not subtree or subtree != captured: raise RuntimeError(f'Source symlink directory subtree is not fully captured: {name}')
            declared[name] = {'kind': 'directory', 'path': relative, 'members': sorted(subtree)}
        else: raise RuntimeError(f'Unsupported source symlink target: {name}')
    return declared


def archive_permissions():
    writable = []
    for current, directories, names in os.walk(ARCHIVE, followlinks=False):
        directory = pathlib.Path(current)
        if directory.stat().st_mode & 0o222: writable.append(str(directory.relative_to(ARCHIVE)) or '.')
        for name in names:
            path = directory / name
            if not path.is_symlink() and path.stat().st_mode & 0o222: writable.append(str(path.relative_to(ARCHIVE)))
    dependency = ARCHIVE / 'node_modules'
    return {'readOnly': not writable, 'writable': writable,
        'dependencyLinkMatches': dependency.is_symlink() and os.readlink(dependency) == str(ROOT / 'node_modules')}


def registration():
    source = (ROOT / 'test.js').read_text()
    block = re.search(r'for \(const file of \[(.*?)\]\) \{\s*execFileSync\(process.execPath, \[file\], \{(.*?)\}\);', source, re.S)
    if not block or not re.search(r'\btimeout:\s*180000\b', block[2]): raise RuntimeError('Original native child timeout or registration changed')
    children = re.findall(r"['\"](test[^'\"]+\.(?:js|mjs))['\"]", block[1])
    imports = re.findall(r"await import\(['\"]\./(test[^'\"]+\.(?:js|mjs))['\"]\)", source)
    if not children or len(set(children)) != len(children): raise RuntimeError('Review missing or duplicate native child registration')
    original = json.loads(ORIGINAL_DRAFT.read_text())['registrationAtPreparation']['children']
    if set(original) - set(children): raise RuntimeError('An original native child was silently dropped')
    covered = set(children + imports + ['test.js'])
    ai = sorted(path.name for path in ROOT.glob('test-engine-ai*.js'))
    think = sorted(path.name for pattern in ['test*.js', 'test*.mjs'] for path in ROOT.glob(pattern) if re.search(r'\bthink\s*\(', path.read_text()))
    if set(ai + think + ['test-world-observation.js']) - covered: raise RuntimeError('Required native AI or think test not registered')
    if any(not (ROOT / name).is_file() for name in children + imports): raise RuntimeError('Registered native test missing')
    return {'children': children, 'childCount': len(children), 'directImports': imports, 'allAITests': ai,
        'thinkPatternTests': think, 'focusedChildTimeoutMS': 180000, 'testJSSHA256': file_digest(ROOT / 'test.js')}


def runtime():
    node = shutil.which('node')
    if not node: raise RuntimeError('Node executable missing')
    return {'nodeExecutable': os.path.realpath(node), 'nodeVersion': subprocess.check_output([node, '--version'], text=True).strip(),
        'npmVersion': subprocess.check_output(['npm', '--version'], text=True).strip(), 'pythonVersion': sys.version,
        'packageSHA256': file_digest(ROOT / 'package.json'), 'lockfileSHA256': file_digest(ROOT / 'package-lock.json'),
        'installedPackageMetadata': {name: file_digest(ROOT / 'node_modules' / name / 'package.json') for name in ['three', 'ws']}}


def historical_hashes(): return {str(path): file_digest(path) for path in HISTORICAL}


def draft():
    native = runtime(); tests = registration()
    if FINAL_COLLECTOR_TESTS - set(tests['children']):
        raise RuntimeError('Required current native fixture registration not present; preserve prior draft and wait')
    gameplay = {name: file_digest(ROOT / name) for name in ['shared/ai.js', 'shared/ai-commander.js', 'shared/ai-hands.js', 'shared/sim.js', 'tools/ai-humanity.mjs', 'tools/ai-manual-response-policy.mjs', 'tools/ai-manual-response-capture.mjs', 'shared/ai-perception.js', 'test-engine-ai-manual-response-policy.js', 'test-engine-ai-bridge-repair.js', 'test-engine-traffic-privacy.js', 'test-engine-ai-attended-guard.js', 'test-engine-ai-guard-ability-choice.js', 'test-engine-ai-hesitation.js', 'test-engine-ai-measurement-streams.js', 'test-engine-ai-measurement-start.js', 'test-ai-humanity-storage.js']}
    return {'label': 'v18-final', 'status': 'unapproved provisional draft only; final source and registration bind exclusively at explicit root freeze', 'preparedAtUnix': time.time(),
        'root': str(ROOT), 'command': ['taskset', '-c', '4', native['nodeExecutable'], 'test.js'], 'supervisorCPU': 0,
        'runtimeAtPreparation': native, 'gameplayAndCollectorAtPreparation': gameplay, 'registrationAtPreparation': tests, 'rootApprovedFinalChildCount': None, 'rootApproved': False, 'outerTimeout': None,
        'focusedChildTimeoutMS': 180000, 'pollSeconds': 5, 'scriptSHA256': file_digest(SCRIPT),
        'timeoutPolicy': 'Preserve all original 180000 ms native child limits. No outer timeout kill and no automatic retry.',
        'coverage': 'All tracked and nonignored untracked git source files, including source, tests, workflow, docs and evidence. Deleted tracked members fail closed. Preserve symlink identity. Relative in-root directory aliases require a nonempty fully captured physical subtree; external or absolute links remain rejected. node_modules is linked separately and is not source-certified; record lockfile and installed package metadata.',
        'freezePolicy': 'Only after explicit root final-source authorization. Preparation hashes and registration are unapproved and provisional; explicit root freeze captures and binds the actual final source, runtime and exact native list. Already declared native children must remain registered. Exclusive V18-final paths never replace V14, V15, V16 or V17 evidence.',
        'supervision': 'Every five seconds compare complete source and archive file sets, bytes and source HEAD; append every check and any change. Source, archive or historical evidence changes invalidate proof even if native tests exit 0.',
        'historicalManifests': historical_hashes(), 'freezeCommand': [sys.executable, str(SCRIPT), '--freeze-after-root-approval'],
        'detachedLaunchCommand': [sys.executable, str(SCRIPT), '--launch-detached-after-root-freeze'],
        'runCommand': [sys.executable, str(SCRIPT), '--run-after-root-freeze'], 'finalizeCommand': [sys.executable, str(SCRIPT), '--finalize']}


def freeze():
    for path in [PREREG, ARCHIVE, BEFORE, AFTER, SENTINEL, LOG, SUMMARY, LAUNCH, COMPLETION, CHECKS, CONTROLLER, BACKGROUND]:
        if path.exists() or path.is_symlink(): raise RuntimeError(f'Existing V18-final artifact, preserve it: {path}')
    proposal = json.loads(DRAFT.read_text())
    if proposal['scriptSHA256'] != file_digest(SCRIPT): raise RuntimeError('Supervisor changed since draft')
    if historical_hashes() != proposal['historicalManifests']: raise RuntimeError('Historical proof changed since draft')
    before = snapshot(); native = runtime(); tests = registration()
    if set(proposal['registrationAtPreparation']['children']) - set(tests['children']):
        raise RuntimeError('A provisionally declared native child was removed before explicit root freeze')
    if FINAL_COLLECTOR_TESTS - set(tests['children']): raise RuntimeError('Required native fixtures missing at explicit root freeze')
    final_bindings = {name: before['files'][name]['sha256'] for name in proposal['gameplayAndCollectorAtPreparation']}
    source_links = captured_source_links(before['files'], ROOT)
    ARCHIVE.mkdir()
    for name, metadata in before['files'].items():
        target = ARCHIVE / name; target.parent.mkdir(parents=True, exist_ok=True)
        if metadata['kind'] == 'symlink':
            target.symlink_to(metadata['target'])
        else: shutil.copyfile(ROOT / name, target)
    (ARCHIVE / 'node_modules').symlink_to(ROOT / 'node_modules', target_is_directory=True)
    after_copy = snapshot()
    if before['files'] != after_copy['files'] or before['head'] != after_copy['head'] or archive_snapshot() != before['files']: raise RuntimeError('Source or archive differs during freeze')
    if captured_source_links(before['files'], ARCHIVE) != source_links: raise RuntimeError('Copied source link target declarations differ')
    before.update({'sourceLinkTargets': source_links, 'root': str(ROOT), 'archive': str(ARCHIVE), 'fileManifestDigest': canonical(before['files']),
        'bytes': sum(value.get('bytes', 0) for value in before['files'].values()), 'dependencyLink': str(ROOT / 'node_modules')})
    write_new(BEFORE, before); BEFORE.chmod(0o444)
    for current, directories, names in os.walk(ARCHIVE, followlinks=False):
        for name in names:
            path = pathlib.Path(current) / name
            if not path.is_symlink(): path.chmod(0o444)
        for name in directories:
            path = pathlib.Path(current) / name
            if not path.is_symlink(): path.chmod(0o555)
    ARCHIVE.chmod(0o555)
    permissions = archive_permissions()
    if not permissions['readOnly'] or not permissions['dependencyLinkMatches']: raise RuntimeError('Archive is not read-only or dependency link differs')
    proposal.update({'status': 'root-approved frozen, no tests launched', 'rootApproved': True,
        'rootApprovedFinalChildCount': tests['childCount'], 'gameplayAndCollectorAtFreeze': final_bindings, 'frozenAtUnix': time.time(), 'runtime': native, 'registration': tests,
        'command': ['taskset', '-c', '4', native['nodeExecutable'], 'test.js'], 'beforeManifest': str(BEFORE),
        'beforeManifestSHA256': file_digest(BEFORE), 'files': len(before['files']), 'bytes': before['bytes'],
        'head': before['head'], 'fileManifestDigest': before['fileManifestDigest'], 'archive': str(ARCHIVE), 'draftSHA256': file_digest(DRAFT)})
    write_new(PREREG, proposal); PREREG.chmod(0o444)
    print(json.dumps({'status': 'frozen only', 'preregistration': str(PREREG), 'files': proposal['files'], 'registration': len(tests['children']), 'launch': proposal['detachedLaunchCommand']}, indent=2))


def validate_prepared():
    prepared = json.loads(PREREG.read_text()); before = json.loads(BEFORE.read_text())
    if prepared['scriptSHA256'] != file_digest(SCRIPT) or prepared['beforeManifestSHA256'] != file_digest(BEFORE): raise RuntimeError('Frozen tool or before manifest changed')
    if prepared['draftSHA256'] != file_digest(DRAFT): raise RuntimeError('Prospective draft changed after freeze')
    if archive_snapshot() != before['files']: raise RuntimeError('Frozen archive changed')
    if captured_source_links(before['files'], ARCHIVE) != before['sourceLinkTargets']: raise RuntimeError('Frozen source link declarations changed')
    permissions = archive_permissions()
    if not permissions['readOnly'] or not permissions['dependencyLinkMatches']: raise RuntimeError('Archive mode or dependency link changed')
    if registration() != prepared['registration'] or prepared['registration']['childCount'] != prepared['rootApprovedFinalChildCount'] or not prepared['rootApproved']:
        raise RuntimeError('Final approved native registration or test.js hash changed before launch')
    return prepared, before


def changes(expected, actual): return [name for name in sorted(set(expected) | set(actual)) if expected.get(name) != actual.get(name)]


def verify_during(before, prepared):
    source = snapshot(); archive = archive_snapshot(); history = historical_hashes(); permissions = archive_permissions()
    return {'atUnix': time.time(), 'head': source['head'], 'headMatches': source['head'] == before['head'],
        'sourceFiles': len(source['files']), 'archiveFiles': len(archive), 'sourceDigest': canonical(source['files']), 'archiveDigest': canonical(archive),
        'sourceChanged': changes(before['files'], source['files']), 'archiveChanged': changes(before['files'], archive),
        'historyMatches': history == prepared['historicalManifests'], 'archiveReadOnly': permissions['readOnly'],
        'archiveWritable': permissions['writable'], 'archiveDependencyLinkMatches': permissions['dependencyLinkMatches']}


def finalize():
    if AFTER.exists() or SUMMARY.exists(): raise RuntimeError('V18-final finalization exists, preserve it')
    prepared, before = json.loads(PREREG.read_text()), json.loads(BEFORE.read_text())
    if not SENTINEL.exists() or not COMPLETION.exists(): raise RuntimeError('Native completion receipt not available, do not invent exit status')
    completed = json.loads(COMPLETION.read_text()); launch = json.loads(LAUNCH.read_text())
    exit_code = int(SENTINEL.read_text().strip().removeprefix('EXIT_CODE=')); after = snapshot(); write_new(AFTER, after)
    changed = changes(before['files'], after['files']); archive_changes = changes(before['files'], archive_snapshot())
    checks = [json.loads(line) for line in CHECKS.read_text().splitlines()]
    invalid = [check for check in checks if check.get('error') or not check.get('headMatches', False)
        or check.get('sourceChanged') or check.get('archiveChanged') or not check.get('historyMatches', False)
        or not check.get('archiveReadOnly', False) or not check.get('archiveDependencyLinkMatches', False)]
    integrity = (prepared['scriptSHA256'] == file_digest(SCRIPT) and prepared['beforeManifestSHA256'] == file_digest(BEFORE)
        and prepared['draftSHA256'] == file_digest(DRAFT) and launch['predeclaredProtocolSHA256'] == file_digest(PREREG))
    history_matches = historical_hashes() == prepared['historicalManifests']; permissions = archive_permissions()
    summary = {'exitCode': exit_code, 'filesBefore': len(before['files']), 'filesAfter': len(after['files']), 'hashesIdentical': not changed,
        'headIdentical': before['head'] == after['head'], 'archiveReadOnly': permissions['readOnly'],
        'archiveWritable': permissions['writable'], 'archiveDependencyLinkMatches': permissions['dependencyLinkMatches'], 'changed': changed, 'archiveChanged': archive_changes, 'archiveSourcesMatch': not archive_changes,
        'duringChecks': len(checks), 'invalidDuringChecks': invalid, 'historicalManifestsUnchanged': history_matches, 'supervisorIntegrity': integrity,
        'runtimeMatchesAtLaunch': completed['runtimeMatchesAtLaunch'], 'registration': prepared['registration'],
        'beforeManifestSHA256': file_digest(BEFORE), 'afterManifestSHA256': file_digest(AFTER), 'predeclaredProtocolSHA256': file_digest(PREREG),
        'logSHA256': file_digest(LOG), 'logBytes': LOG.stat().st_size, 'checksSHA256': file_digest(CHECKS), 'launchRecordSHA256': file_digest(LAUNCH),
        'completionRecordSHA256': file_digest(COMPLETION), 'startedAtUnix': launch['startedAtUnix'], 'finalizedAtUnix': time.time(),
        'passes': exit_code == 0 and exit_code == completed['exitCode'] and not changed and not archive_changes and not invalid
            and before['head'] == after['head'] and history_matches and integrity and completed['runtimeMatchesAtLaunch'] and not completed.get('error')
            and permissions['readOnly'] and permissions['dependencyLinkMatches']}
    write_new(SUMMARY, summary); print(json.dumps(summary, indent=2))


def run():
    prepared, before = validate_prepared()
    for path in [LOG, LAUNCH, SENTINEL, AFTER, SUMMARY, COMPLETION, CHECKS]:
        if path.exists(): raise RuntimeError(f'Existing V18-final run artifact, preserve it: {path}')
    initial = verify_during(before, prepared)
    if initial['sourceChanged'] or not initial['headMatches'] or initial['archiveChanged'] or not initial['historyMatches'] or not initial['archiveReadOnly'] or not initial['archiveDependencyLinkMatches']: raise RuntimeError('Source or archive changed before native launch')
    native = runtime()
    if native != prepared['runtime']: raise RuntimeError('Runtime changed before native launch')
    os.sched_setaffinity(0, {prepared['supervisorCPU']})
    completed = {'runtimeMatchesAtLaunch': True}; interrupted = None; child = None
    with CHECKS.open('x') as checks, LOG.open('xb') as output:
        checks.write(json.dumps(initial) + '\n'); checks.flush()
        try:
            child = subprocess.Popen(prepared['command'], cwd=ROOT, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
            write_new(LAUNCH, {'startedAtUnix': time.time(), 'pid': child.pid, 'command': prepared['command'], 'cwd': str(ROOT), 'outerTimeout': None,
                'supervisorPID': os.getpid(), 'supervisorCPU': prepared['supervisorCPU'], 'runtime': native, 'predeclaredProtocolSHA256': file_digest(PREREG)})
            print('FULL_SUITE_PID', child.pid, flush=True)
            while child.poll() is None:
                time.sleep(prepared['pollSeconds'])
                try: check = verify_during(before, prepared)
                except Exception as error: check = {'atUnix': time.time(), 'error': f'{type(error).__name__}: {error}'}
                checks.write(json.dumps(check) + '\n'); checks.flush()
            completed['exitCode'] = child.returncode
        except BaseException as error:
            interrupted = error; completed['error'] = f'{type(error).__name__}: {error}'
            if child and child.poll() is None:
                os.killpg(child.pid, signal.SIGTERM); child.wait()
            completed['exitCode'] = child.returncode if child else 125
        finally:
            completed['finishedAtUnix'] = time.time(); write_new(COMPLETION, completed)
            with SENTINEL.open('x') as receipt: receipt.write(f"EXIT_CODE={completed['exitCode']}\n")
    if LAUNCH.exists(): finalize()
    if interrupted: raise interrupted


def detached_launch():
    prepared, before = validate_prepared()
    for path in [CONTROLLER, BACKGROUND, LOG, LAUNCH, COMPLETION, SENTINEL, CHECKS, AFTER, SUMMARY]:
        if path.exists(): raise RuntimeError(f'Existing V18-final launch artifact, preserve it: {path}')
    with CONTROLLER.open('xb') as output:
        command = [sys.executable, str(SCRIPT), '--run-after-root-freeze']
        process = subprocess.Popen(command, cwd=ROOT, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
    receipt = {'launchedAtUnix': time.time(), 'supervisorPID': process.pid, 'command': command, 'cwd': str(ROOT),
        'controllerLog': str(CONTROLLER), 'predeclaredProtocolSHA256': file_digest(PREREG), 'outerTimeout': None}
    write_new(BACKGROUND, receipt); print(json.dumps(receipt, indent=2))


def main():
    parser = argparse.ArgumentParser(); modes = parser.add_mutually_exclusive_group()
    for flag in ['draft', 'freeze-after-root-approval', 'launch-detached-after-root-freeze', 'run-after-root-freeze', 'finalize']:
        modes.add_argument('--' + flag, action='store_true')
    args = parser.parse_args()
    if args.draft: write_new(DRAFT, draft()); print('DRAFT_ONLY', DRAFT)
    elif args.freeze_after_root_approval: freeze()
    elif args.launch_detached_after_root_freeze: detached_launch()
    elif args.run_after_root_freeze:
        def interrupted(signum, frame): raise KeyboardInterrupt(f'Interrupted by signal {signum}')
        signal.signal(signal.SIGTERM, interrupted); signal.signal(signal.SIGINT, interrupted); run()
    elif args.finalize: finalize()
    else: print('Prepared only. No source freeze or test launch without explicit root authorization.')


if __name__ == '__main__': main()
