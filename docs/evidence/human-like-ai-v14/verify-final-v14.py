import gzip,hashlib,json,os,pathlib
base=pathlib.Path('/tmp/human-ai-final-observed-runtime-v14-streaming')
source=pathlib.Path('/tmp/human-ai-final-observed-runtime-v14-source')
def digest(path,decompress=False):
 h=hashlib.sha256();n=0
 with (gzip.open(path,'rb') if decompress else open(path,'rb')) as stream:
  while chunk:=stream.read(1024*1024): h.update(chunk);n+=len(chunk)
 return {'sha256':h.hexdigest(),'bytes':n}
status=json.load(open(base/'status.json'));assert status['state']=='completeEvidenceReadyForReview'
report=json.load(open(base/'final120-compact.json'));manifest=json.load(open(base/'raw-match-manifest.json'))
expected={(mode,level,seed) for mode,count in [('conquest',20),('classic',10),('world',10)] for level in ['easy','normal','hard'] for seed in range(1,count+1)}
assert len(manifest)==120 and {(a['mode'],a['level'],a['seed']) for a in manifest}==expected
assert len(report['results'])==120 and sum(len(m['seats']) for m in report['results'])==360
assert set(report['sourceCheckpoints'])=={status['sourceCheckpointSHA256']}
frames=inputs=events=commands=0
for match in report['results']:
 assert match['sourceCheckpointSHA256']==status['sourceCheckpointSHA256']
 assert match['seconds']==180 or match['ended']
 for seat in match['seats']:
  p=seat['metrics']['measurementPolicyComparison'];assert p['coverage']['originalRecorded'] and p['coverage']['originalFromMatchStart']
  assert seat['metrics']['requiredScreenPopulation']==p['originalOracle']['explicitLinked']['requiredScreenPopulation']
  for policy in ['originalOracle','observed']:
   primary=p[policy]['primaryOnly']['requiredScreenPopulation'];linked=p[policy]['explicitLinked']['requiredScreenPopulation']
   assert (None if primary is None else primary['requiredEvents'])==(None if linked is None else linked['requiredEvents'])
 for log in match['timelineDigests']:
  frames+=log['measurementFrames'];inputs+=log['inputs'];events+=log['events'];commands+=log['commands']
for a in manifest:
 assert digest(base/a['file'])==a['gzip']
 assert digest(base/a['file'],True)==a['raw']
archive=status['evidenceArchive'];assert digest(base/archive['path'])=={'sha256':archive['sha256'],'bytes':archive['bytes']}
assert digest(base/archive['path'],True)=={'sha256':archive['uncompressedSHA256'],'bytes':archive['uncompressedBytes']}
source_manifest=json.load(open(source/'source-archive.json'))
for name,sha in source_manifest['files'].items(): assert digest(source/name)['sha256']==sha,name
proof={'status':'PASS','sourceCheckpointSHA256':status['sourceCheckpointSHA256'],'exactOriginalPairs':120,'seats':360,'allRawArchivesChecked':120,'allPrivateRecordingFromMatchStart':True,'samePopulationAcrossPrimaryExplicitBothPolicies':True,'privateFrames':frames,'nativeInputRows':inputs,'nativeEventRows':events,'nativeCommandRows':commands,'fullArchive':archive,'sourceFilesUnchanged':len(source_manifest['files']),'oracleAndProvenanceRecorded':all(n in source_manifest['files'] for n in ['tools/ai-screen-v1-oracle.js','tools/ai-screen-v1-oracle-provenance.json'])}
json.dump(proof,open(base/'independent-verification.json','w'),indent=2);print(json.dumps(proof))
