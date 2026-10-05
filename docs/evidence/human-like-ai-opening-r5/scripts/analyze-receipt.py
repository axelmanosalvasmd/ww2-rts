import pathlib,json,collections,hashlib,math
base=pathlib.Path('/tmp/human-ai-opening-receipt-followup')
family=lambda u:{'rifle':'infantry','conscript':'infantry','mg':'machineGun','mortar':'mortar','at':'antiTank','engineer':'engineer'}.get(u,u)
seats={};summaries={}
for treatment in ['base','candidate']:
 rows=[];manifest=json.load(open(base/treatment/'raw-manifest.json'))
 assert len(manifest)==60
 for item in manifest:
  raw=pathlib.Path(item['path']).read_bytes();assert hashlib.sha256(raw).hexdigest()==item['sha256'];match=json.loads(raw);assert match['seconds']==45
  for seat in match['seats']:
   log=match['logs'][seat['slot']];accepted=[c for c in log['commands'] if c['accepted']];buys=[c for c in accepted if c['command']['t']=='buy'];early=[c for c in buys if c['tick']<=900][:5];first=buys[0] if buys else None
   move=lambda c:c['command']['t'] in ['move','amove'] and any(math.hypot(a['x']-b['x'],a['z']-b['z'])>2 for a,b in zip(c['locations'],c['sourceLocations']))
   before=[c for c in accepted if first and c['tick']<first['tick'] and move(c)]
   commands=[i for i in log['inputs'] if i.get('command',{}).get('t')=='buy'];groups=collections.defaultdict(list)
   for i in commands:groups[(i.get('cycle'),i.get('queuedTick'))].append(i)
   duplicates=[{'cycle':k[0],'queuedTick':k[1],'units':[i['command']['unit'] for i in v],'ticks':[i['tick'] for i in v]} for k,v in groups.items() if len(v)>1]
   first_input=next((i for i in commands if first and i['tick']==first['tick']),None);first_group=groups.get((first_input.get('cycle'),first_input.get('queuedTick')),[]) if first_input else []
   row={'level':match['level'],'seed':match['seed'],'slot':seat['slot'],'faction':seat['faction'],'acceptedFamilyPrefix':[family(c['command']['unit']) for c in early],'acceptedUnitsPrefix':[c['command']['unit'] for c in early],'firstFamily':family(first['command']['unit']) if first else None,'firstBuy':first,'firstBuySeconds':first['tick']/20 if first else None,'nontrivialMoveOrdersBeforeFirstBuy':len(before),'rejectedBeforeFirstBuy':[c for c in log['commands'] if not c['accepted'] and c['command']['t']=='buy' and first and c['tick']<first['tick']],'rejectedPurchases':[c for c in log['commands'] if not c['accepted'] and c['command']['t']=='buy'],'acceptedPurchases':len(buys),'acceptedNonBuy':len(accepted)-len(buys),'physicalInputs':len(log['inputs']),'cameraInputs':sum(i['kind'].startswith('camera') for i in log['inputs']),'purchaseSpendMP':sum(c['spend']['mp'] for c in buys),'totalCommandSpendMP':sum(c['spend']['mp'] for c in log['commands']),'finalRecordedMP':log['mp'][-1] if log['mp'] else None,'firstBuyDecisionDuplicateInputs':len(first_group)>1,'queuedDecisionBuyGroups':duplicates,'sourceCheckpointSHA256':match['sourceCheckpointSHA256']}
   rows.append(row)
 seats[treatment]=rows
 groups={}
 for level in ['easy','normal','hard']:
  for faction in ['USA','Germany','USSR']:
   group=[r for r in rows if r['level']==level and r['faction']==faction];assert len(group)==20
   seq=collections.Counter(json.dumps(r['acceptedFamilyPrefix'],separators=(',',':')) for r in group);meaningful=[k for k in seq if k!='[]'];first=collections.Counter(r['firstFamily'] for r in group)
   groups[f'{level}/{faction}']={'distinctMeaningfulPrefixes':len(meaningful),'mostCommonCount':max(seq.values()),'mostCommonShare':max(seq.values())/20,'passesOriginalOpeningGate':len(meaningful)>=3 and max(seq.values())<=10,'prefixCounts':dict(seq),'firstFamilyCounts':dict(first),'missingFirstBuys':first.get(None,0),'seatsWithUsefulNontrivialMoveBeforeFirstBuy':sum(r['nontrivialMoveOrdersBeforeFirstBuy']>0 for r in group),'seatsWithRejectedBuyBeforeFirstAccepted':sum(bool(r['rejectedBeforeFirstBuy']) for r in group),'rejectedPurchases':sum(len(r['rejectedPurchases']) for r in group),'acceptedPurchases':sum(r['acceptedPurchases'] for r in group),'acceptedNonBuy':sum(r['acceptedNonBuy'] for r in group),'physicalInputs':sum(r['physicalInputs'] for r in group),'cameraInputs':sum(r['cameraInputs'] for r in group),'purchaseSpendMP':sum(r['purchaseSpendMP'] for r in group),'totalCommandSpendMP':sum(r['totalCommandSpendMP'] for r in group),'seatsWithFirstBuyDecisionMultipleBuyInputs':sum(r['firstBuyDecisionDuplicateInputs'] for r in group),'allDecisionMultipleBuyGroups':sum(len(r['queuedDecisionBuyGroups']) for r in group)}
 summaries[treatment]=groups
lookup={t:{(r['level'],r['seed'],r['slot']):r for r in rows} for t,rows in seats.items()};assert set(lookup['base'])==set(lookup['candidate'])
paired=[]
for key,before in lookup['base'].items():
 after=lookup['candidate'][key];paired.append({'level':key[0],'seed':key[1],'slot':key[2],'faction':before['faction'],'beforeFirst':before['firstFamily'],'afterFirst':after['firstFamily'],'beforePrefix':before['acceptedFamilyPrefix'],'afterPrefix':after['acceptedFamilyPrefix'],'beforeFirstSeconds':before['firstBuySeconds'],'afterFirstSeconds':after['firstBuySeconds']})
output={'status':'All60matches180seats each treatment complete;opening-only45second diagnosis,unchangedgrading,no180second/performance acceptance','groups':summaries,'paired':paired,'seats':seats,'firstFamilyTransitions':dict(collections.Counter(f"{r['beforeFirst']}->{r['afterFirst']}" for r in paired))}
json.dump(output,open(base/'opening-analysis.json','w'),indent=2);open(base/'opening-analysis.json','a').write('\n')
for key,before in summaries['base'].items():
 after=summaries['candidate'][key];print(f"{key}: base {before['distinctMeaningfulPrefixes']} / {before['mostCommonShare']:.0%} / {before['passesOriginalOpeningGate']} -> candidate {after['distinctMeaningfulPrefixes']} / {after['mostCommonShare']:.0%} / {after['passesOriginalOpeningGate']} | {before['firstFamilyCounts']} -> {after['firstFamilyCounts']}")
print('firstFamilyTransitions',output['firstFamilyTransitions'])
