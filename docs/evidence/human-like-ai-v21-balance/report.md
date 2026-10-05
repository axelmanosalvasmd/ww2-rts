# Historical V21 balance evidence

All 150 original matches finished. The balance gate failed on this older V21 runtime; these results do not establish current R9 acceptance.

| Population | Result | Original gate |
| --- | --- | --- |
| Conquest, 60 matches | USA 25, Germany 22, USSR 13 | Fail: USSR 21.6667%, below 25% |
| Classic, 30 matches | USA 11, Germany 8, USSR 7, four draws | Fail: USA 42.3077% of 26 decisive matches, above 42% |
| Hard versus old Easy, 20 | 15 wins | Pass: at least 14 required |
| Hard versus old Normal, 20 | 16 wins | Report only |
| Hard versus old Hard, 20 | 14 wins | Report only |

All five native jobs exited zero. There were four draws and no timeouts. The native supervisor finished at 2026-10-05 02:16:48 UTC. The archive retains every result in original order, simulation durations, seeds, configuration, checkpoint, final log, protocol and source verification receipt. No matches, merge, public scoring or tests were rerun to create this package.

`original-balance-evidence.zip` contains 59 physical artifacts. `root-copy-manifest.json` maps each member to its original path, resolved physical source, byte size and SHA256. All archive members were byte-compared against their originals. The package includes the complete 2039-file metadata manifest, not the large asset tree. Thirty-five runtime files named by the balance reports were independently hashed and copied, plus frozen legacy provenance. Native receipts report unchanged full-source checks before and after; external dependency contents were not certified.

The actual launch protocol is `human-ai-prospective-v21-final-balance.json`, also copied byte-identically as native `protocol.json`. Its old preparation wording is retained verbatim; final binding and native supervision establish the executed source. Historical AI hash starts `c99be94a`, engine `5e5f4c2d`. Older reference archive paths inside the protocol remain historical references, not bundled physical artifacts. The manifest enumerates everything physically included.

Run `python3 docs/evidence/human-like-ai-v21-balance/verify-evidence.py` from the repository to independently reduce all archived rows and verify native receipts, source bindings and archive hashes. Millisecond medians use the report's three-decimal precision; raw durations remain unchanged. Normal and Hard duel report-only results must not be presented as additional numerical acceptance gates.
