#!/usr/bin/env python3
"""Read-only independent qualification and byte comparison of recorded R11 evidence."""
import hashlib,json,os,pathlib,re,subprocess,sys,tarfile,time
ROOT=pathlib.Path('/home/judiazm/.t3/worktrees/ww2-rts/ai-human-commander')
BASE=pathlib.Path('/tmp'); PREFIX='human-ai-r11-final-full'; FROZEN=BASE/(PREFIX+'-source')
EXPECTED_HEAD='bbff3fae04e67a2647523d8625a8bbe9f36434bf'
EXACT={'CHANGELOG.md','DESIGN.md','docs/human-like-ai-spec.md'}
SUFFIXES={'prospective':'.json','predeclared':'.json','before':'.json','after':'.json','checks':'.jsonl','test':'.log','test-exit':'.txt','launch':'.json','completion':'.json','verification':'.json','controller':'.log','background-launch':'.json','run':'.py'}
P={k:BASE/(PREFIX+'-'+k+s) for k,s in SUFFIXES.items()}
ORIGINAL=BASE/'human-ai-v21-final-full-predeclared.json'
def sha(b): return hashlib.sha256(b).hexdigest()
def digest(p): return sha(p.read_bytes())
def canon(x): return sha(json.dumps(x,sort_keys=True,separators=(',',':')).encode())
def meta(n): return n in EXACT or n.startswith('docs/evidence/')
def entry(p):
 if p.is_symlink():
  target=os.readlink(p);return {'kind':'symlink','target':target,'sha256':sha(os.fsencode(target))}
 return {'kind':'file','bytes':p.stat().st_size,'sha256':digest(p)}
def git(*args): return subprocess.check_output(['git',*args],cwd=ROOT).decode()
def read(k): return json.loads(P[k].read_text())
def qualify():
 b,a,p,l,c,v,s,bg=(read(k) for k in ['before','after','predeclared','launch','completion','verification','prospective','background-launch'])
 checks=[json.loads(line) for line in P['checks'].read_text().splitlines()]
 names=sorted(set(git('ls-files','--cached','--others','--exclude-standard','-z').split('\0'))-{''})
 current={n:entry(ROOT/n) for n in names if not meta(n)}
 frozen={}
 writable=[]
 for cur,dirs,files in os.walk(FROZEN,followlinks=False):
  d=pathlib.Path(cur)
  if d.stat().st_mode&0o222:writable.append(str(d))
  for name in list(dirs):
   path=d/name
   if path.is_symlink():
    dirs.remove(name)
    if name!='node_modules':frozen[str(path.relative_to(FROZEN))]=entry(path)
  for name in files:
   path=d/name
   if not path.is_symlink() and path.stat().st_mode&0o222:writable.append(str(path))
   frozen[str(path.relative_to(FROZEN))]=entry(path)
 locked=b['lockedFiles']; after={n:x for n,x in a['files'].items() if not meta(n)}
 test=(FROZEN/'test.js').read_text()
 block=re.search(r'for \(const file of \[(.*?)\]\) \{\s*execFileSync\(process.execPath, \[file\], \{(.*?)\}\);',test,re.S)
 assert block,'registration source structure missing'
 children=re.findall(r"['\"](test[^'\"]+\.(?:js|mjs))['\"]",block[1])
 direct=re.findall(r"await import\(['\"]\./(test[^'\"]+\.(?:js|mjs))['\"]\)",test)
 ai=sorted(path.name for path in FROZEN.glob('test-engine-ai*.js'))
 think=sorted(path.name for pat in ['test*.js','test*.mjs'] for path in FROZEN.glob(pat) if re.search(r'\bthink\s*\(',path.read_text()))
 additional=re.findall(r"execFileSync\(process.execPath, \[['\"]([^'\"]+)['\"]\], \{[^}]*?timeout:\s*(\d+)",test)
 reg={'children':children,'childCount':len(children),'directImports':direct,'allAITests':ai,'thinkPatternTests':think,'focusedChildTimeoutMS':180000,'additionalNativeProcesses':[{'file':f,'timeoutMS':int(t)} for f,t in additional],'testJSSHA256':digest(FROZEN/'test.js'),'assertCallCountDiagnostic':len(re.findall(r'\bassert(?:\.[A-Za-z]+)?\s*\(',test))}
 historic=json.loads(ORIGINAL.read_text())['registration']; covered=set(children+direct+['test.js'])
 fullruntime={'nodeExecutable':os.path.realpath(subprocess.check_output(['which','node'],text=True).strip()),'packageSHA256':digest(ROOT/'package.json'),'lockfileSHA256':digest(ROOT/'package-lock.json'),'installedPackageMetadata':{n:digest(ROOT/'node_modules'/n/'package.json') for n in ['three','ws']},'nodeVersion':subprocess.check_output(['node','--version'],text=True).strip(),'nodeExecutableSHA256':digest(pathlib.Path(p['runtime']['nodeExecutable'])),'pythonVersion':sys.version}
 observations=[]
 for i,x in enumerate(checks):
  expected={'headMatches':True,'sourceFiles':684,'sourceDigest':canon(locked),'sourceChanged':[],'archiveChanged':[],'runtimeMatches':True,'registrationMatches':True,'supervisorMatches':True,'readOnly':True,'writable':[],'dependencyLinkMatches':True,'valid':True}
  mismatches={k:{'expected':y,'actual':x.get(k)} for k,y in expected.items() if x.get(k)!=y}
  observations.append({'index':i,'atUnix':x.get('atUnix'),'recordConsistent':not mismatches,'mismatches':mismatches})
 times=[x.get('atUnix',0) for x in checks]
 invariants={
 'nativeExitZero':c['exitCode']==v['nativeExitCode']==0,
 'nativeNaturalCompletionRecorded':c['naturalCompletion'] is True and v['nativeNaturalCompletion'] is True,
 'nativePIDMatches':c['nativePID']==l['pid']==2137849,
 'supervisorPIDMatches':l['supervisorPID']==bg['supervisorPID']==2137842,
 'noOuterTimeout':all(x['outerTimeout'] is None for x in [p,l,s,bg]),
 'literalCommand':p['command']==l['command']==s['command']==['taskset','-c','4','node','test.js'] and p['nativeLiteralCommand']=='node test.js',
 'expectedHead':b['head']==a['head']==git('rev-parse','HEAD').strip()==EXPECTED_HEAD,
 'locked684':len(locked)==len(current)==len(after)==684,
 'lockedSourceBeforeAfterCurrentExact':locked==after==current,
 'fullFrozenArchiveExact':frozen==b['archiveFiles'],
 'fullFrozenArchiveReadonly':not writable,
 'frozenDependencyLink':os.readlink(FROZEN/'node_modules')==str(ROOT/'node_modules'),
 'registrationExact':reg==p['registration']==p['registrationAtPreparation']==s['registrationAtPreparation']==v['registration'],
 'children102Unique':len(children)==len(set(children))==102,
 'originalV21Coverage':set(historic['children'])<=set(children) and set(historic['directImports'])<=set(direct),
 'allAIThinkWorldCoverage':set(ai+think+['test-world-observation.js'])<=covered,
 'registeredFilesExist':all((FROZEN/n).is_file() for n in children+direct),
 'originalChildTimeout':bool(re.search(r'\btimeout:\s*180000\b',block[2])),
 'additionalSubprocessTimeouts':reg['additionalNativeProcesses']==[{'file':'test-public-lobby.js','timeoutMS':30000},{'file':'test-performance.mjs','timeoutMS':240000}],
 'runtimeExact':fullruntime==p['runtime']==p['runtimeAtPreparation']==s['runtimeAtPreparation'],
 'runnerHash':digest(P['run'])==p['scriptSHA256']==s['scriptSHA256'],
 'beforeHash':digest(P['before'])==p['beforeSHA256'],
 'prospectiveHash':digest(P['prospective'])==p['prospectiveSHA256'],
 'predeclaredHash':digest(P['predeclared'])==l['predeclaredSHA256'],
 'historicalHash':digest(ORIGINAL)==p['historicalReference']['sha256']==s['historicalReference']['sha256'],
 'allSummaryArtifactHashes':all(digest(P[k])==h for k,h in v['artifactSHA256'].items()),
 'allContinuousChecksConsistent':all(x['recordConsistent'] for x in observations),
 'checkCountMatches':len(checks)==v['duringChecks'],
 'checkTimesOrdered':times==sorted(times) and times[0]<=l['startedAtUnix']<=times[-1]<=c['finishedAtUnix'],
 'completionTimeMatches':l['startedAtUnix']==v['startedAtUnix'] and c['finishedAtUnix']==v['finishedAtUnix'],
 'logSizeMatches':P['test'].stat().st_size==c['nativeLogBytes'],
 'exitSentinelExact':P['test-exit'].read_bytes()==b'EXIT_CODE=0\n',
 'summaryPassIntegrity':v['passes'] is True and v['sourceHashesIdentical'] is True and v['headIdentical'] is True and v['runtimeBeforeAfterMatches'] is True and v['runnerProtocolIntegrity'] is True and not v['sourceChanged'] and not v['archiveChanged'] and not v['invalidChecks'],
 'exactMetadataExceptions':p['metadataExceptions']=={'exactFiles':sorted(EXACT),'prefixes':['docs/evidence/']},
 }
 return {'schema':'ww2-r11-independent-full-evidence-v1','verifiedAtUnix':time.time(),'nativeExitCode':c['exitCode'],'nativeNaturalCompletion':c['naturalCompletion'],'elapsedSeconds':c['finishedAtUnix']-l['startedAtUnix'],'head':b['head'],'lockedFileCount':len(locked),'frozenFileCountIncludingPriorEvidence':len(frozen),'frozenNonEvidenceCount':sum(not n.startswith('docs/evidence/') for n in frozen),'coverage':reg,'invariants':invariants,'continuousCheckRecords':observations,'allIndependentChecksPass':all(invariants.values()),'allowedMetadataChanged':v['allowedMetadataChanged'],'naturalCompletionEvidenceLimit':'Completion is the native subprocess poll/wait result recorded by the unchanged supervisor. Historical per-check runtime observations are verified for record consistency, with current bytes checked independently. No historical observation can be re-observed after the fact.'}
def verify_payload(bundle):
 m=json.loads((bundle/'manifest.json').read_text());actual=[]
 with tarfile.open(bundle/'original-files.tar.gz','r:gz') as t:
  for member in t.getmembers():
   data=os.fsencode(member.linkname) if member.issym() else t.extractfile(member).read()
   actual.append({'member':member.name,'bytes':len(data),'sha256':sha(data),'kind':'symlink' if member.issym() else 'file'})
 expected=[{k:x[k] for k in ['member','bytes','sha256','kind']} for x in m['members']]
 assert actual==expected,'payload differs from manifest'
 for x in m['members']:
  path=pathlib.Path(x['originalPhysicalPath']); data=os.fsencode(os.readlink(path)) if x['kind']=='symlink' else path.read_bytes()
  assert len(data)==x['bytes'] and sha(data)==x['sha256'],x['member']
 assert digest(bundle/'original-files.tar.gz')==m['archiveSHA256'],'compressed archive hash differs'
 print(json.dumps({'allPayloadMembersEqualOriginalBytes':True,'members':len(actual),'archiveSHA256':m['archiveSHA256']}))
if __name__=='__main__':
 if len(sys.argv)==3 and sys.argv[1]=='--bundle':verify_payload(pathlib.Path(sys.argv[2]))
 else:
  q=qualify();print(json.dumps(q,indent=2));sys.exit(0 if q['allIndependentChecksPass'] else 1)
