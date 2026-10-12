import json, pathlib, collections
root = pathlib.Path(__file__).resolve().parent / 'artifacts'
runs = [json.loads(line) for line in (root / 'runs.jsonl').read_text().splitlines()]
assert len(runs) == 12
out = []
def quantile(values, p):
    values = sorted(values)
    return round(values[min(len(values)-1, int(len(values)*p))], 3)
for impair in [False, True]:
    for transport in ['websocket', 'webtransport']:
        group = [r for r in runs if r['impair'] == impair and r['transport'] == transport]
        assert len(group) == 3
        row = dict(transport=transport, impair=impair, runs=len(group), sent=sum(r['count'] for r in group), delivered=sum(len(r['received']) for r in group), orderAcks=sum(r['orderAcks'] for r in group), finalSeqs=[r['finalSeq'] for r in group])
        row['metrics'] = {k: {str(p): quantile([v for r in group for v in r[k]], p) for p in [.5, .95, .99]} for k in ['rtts', 'ages', 'gaps']}
        out.append(row)
(root / 'comparison.json').write_text(json.dumps(out, indent=2))
netlog = root / 'chromium-netlog.json'
if netlog.exists():
    data = json.loads(netlog.read_text())
    names = {v: k for k, v in data['constants']['logEventTypes'].items()}
    counts = collections.Counter(names.get(e['type'], str(e['type'])) for e in data['events'])
    proof = {k: v for k, v in counts.items() if k.startswith('QUIC_SESSION')}
    assert proof.get('QUIC_SESSION_MESSAGE_FRAME_SENT', 0) > 0
    assert proof.get('QUIC_SESSION_MESSAGE_FRAME_RECEIVED', 0) > 0
    (root / 'quic-netlog-evidence.json').write_text(json.dumps(proof, indent=2))
    netlog.unlink()  # retain sanitized event counts, not connection headers or ephemeral grants
print(json.dumps(out, indent=2))
