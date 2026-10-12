# Standalone WebTransport fixture

`prototype/webtransport/server.mjs`, `client.mjs` and `protocol.mjs` form the earlier standalone transport experiment. This artificial one-entity fixture is not game state. The playable integration separately uses `game-server.mjs` and the real recipient snapshots, documented in [webtransport-playable.md](webtransport-playable.md).

The isolated package and lockfile use a native HTTP/3-only backend, no HTTP/2 fallback. Browser clients require unreliable datagrams and short-lived P-256 certificate pins. The fixture starts loopback HTTP/WS and QUIC on ephemeral ports and closes them after a probe. Its ephemeral seat credential is deliberately development-only, not production authentication.

From the repository root, install the local prototype dependencies as documented in the playable guide, then run:

```sh
node prototype/webtransport/protocol.test.mjs
node prototype/webtransport/auth.test.mjs
node prototype/webtransport/probe.mjs
python prototype/webtransport/analyze.py
```

The protocol tests cover 12 deterministic cases: independent motion under loss/reorder, zero future-row buffering, hidden/removed membership, epoch/session replacement, stale reliable merge, bounds, atomic baseline validation, fallback and recipient field whitelisting. Authentication tests cover invalid credentials, replacement, old-session denial and reliable resync. Browser probes require an installed Chromium; the executable defaults to `/usr/bin/chromium`.

Optional comparisons delay/drop messages at the application layer. They do not emulate TCP retransmission or network packet loss and cannot establish TCP head-of-line blocking or a game latency advantage. The fixture cannot determine real team visibility and must not be fed global units. Production requires authorized secure control origins and reachable UDP, not merely a TCP proxy.

Artifacts and private development certificates are ignored, not publishing payloads. Raw browser NetLog may contain ephemeral credentials; analysis reduces it to sanitized event counts and deletes the raw trace. Keep private keys and credentials out of source control. Historical test measurements belong to their original evidence, not fresh verification of a later build.
