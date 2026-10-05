#!/usr/bin/env python3
"""Read-only verification of archived historical V21 balance evidence."""
import hashlib,json,statistics,zipfile
from pathlib import Path
base=Path(__file__).resolve().parent
manifest=json.loads((base/'root-copy-manifest.json').read_text())
summary=json.loads((base/'root-summary.json').read_text())
sha=lambda data:hashlib.sha256(data).hexdigest()
archive=base/manifest['archive']
assert sha(archive.read_bytes())==manifest['archiveSHA256']
with zipfile.ZipFile(archive)as z:
 entries=manifest['entries'];assert sorted(z.namelist())==sorted(e['member']for e in entries)
 for e in entries:
  data=z.read(e['member']);assert len(data)==e['bytes'] and sha(data)==e['sha256']
 read=lambda name:json.loads(z.read(name))
 protocol=read('native/protocol.json');supervision=read('native/supervision.json')
 assert z.read('native/protocol.json')==z.read('bindings/human-ai-prospective-v21-final-balance.json')
 assert sha(z.read('native/protocol.json'))==supervision['protocolSHA256']
 assert supervision['sourceChanges']==[] and supervision['sourceAfter']['mismatches']==[]
 total=0
 for name,job in protocol['jobs'].items():
  report=read('native/'+name+'.json');checkpoint=read('native/'+name+'-checkpoint.json');rows=report['results'];total+=len(rows)
  native=[json.loads(line[7:])for line in z.read('native/'+name+'.log').decode().splitlines()if line.startswith('RESULT ')]
  assert native==[report] and checkpoint['results']==rows and checkpoint['sourceSHA256']==report['sourceSHA256']
  assert len(rows)==job['matches'] and sorted(r['match']for r in rows)==list(range(1,job['matches']+1))
  assert [r['match']for r in rows]==summary['originalReportOrder'][name]
  for r in rows:assert r['seed']==job['expectedSeeds'][r['match']-1] and abs(r['seconds']-r['ticks']/20)<.001 and 0<=r['seconds']<=job['maxSeconds']
  wins=[r for r in rows if r['winner']is not None and r['winner']>=0];ended=sum(r['winner']is not None for r in rows)
  factions={f:sum(r['winnerFaction']==f for r in wins)for f in ['USA','Germany','USSR']};fractions={f:n/len(wins)for f,n in factions.items()}
  seats=[sum(r['winnerSeat']==i for r in wins)for i in [0,1]]if job['seats']else None
  reduced={'rows':len(rows),'expectedRows':job['matches'],'ended':ended,'draws':ended-len(wins),'timeouts':len(rows)-ended,'winsByFaction':factions,'decisiveFractions':fractions,'winsBySeat':seats,'medianSeconds':round(statistics.median(r['seconds']for r in rows),3),'medianEndedSeconds':round(statistics.median(r['seconds']for r in rows if r['winner']is not None),3),'allFinish':ended==len(rows)}
  gate=job['gate'];reduced['gatePass']=reduced['allFinish'] and (all(gate['fractionMin']<=v<=gate['fractionMax']for v in fractions.values())if 'fractionMin'in gate else seats[0]>=gate['hardMinWins']if 'hardMinWins'in gate else True)
  assert reduced==supervision['jobs'][name]['audit']['independentReduction'];reduced['reportOnly']=bool(gate.get('reportOnly'));assert reduced==summary['reductions'][name]
  assert supervision['jobs'][name]['exitCode']==0
  for original,h in report['sourceSHA256'].items():assert sha(z.read('runtime/'+str(Path(original).relative_to(protocol['commonArchive']['path']))))==h
 assert total==150
print('PASS: 150 original rows, all seeds/durations/checkpoints/logs, runtime bindings and archive bytes. Historical V21 balance gate FAIL retained.')
