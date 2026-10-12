# Opt-in WebTransport motion

The default `npm start` and URLs without `transport=webtransport` keep WebSocket commands and snapshots. Optional QUIC datagrams update existing unit interpolation targets; reliable snapshots still include motion for recovery. This is additive motion, not full TCP head-of-line escape or a measured latency improvement.

## Install

From the repository root:

```sh
npm ci --ignore-scripts --no-audit --no-fund
(cd prototype/webtransport && npm ci --ignore-scripts --no-audit --no-fund && npm rebuild @fails-components/webtransport-transport-http3-quiche)
```

The prototype lockfile pins the native HTTP/3 backend. Its explicit local rebuild must actually produce a loadable native addon. Node, OpenSSL, Chromium with native WebTransport and a supported native addon platform are required. No global package installation, trust-store modification or certificate-error bypass is needed.

## Local launch

Only when ports 3100 and UDP 3101 are free:

```sh
./start-webtransport-test.sh
```

Open `http://127.0.0.1:3100/play?transport=webtransport#quictest`. Start normally for a regular match. The indicator shows transport and received/applied counters. Unsupported browsers, spectators and operatives remain on WebSocket. Invite and new-room links retain the opt-in parameter. Ctrl+C stops only this instance.

## Tailnet and IP entry

Only when the separate deployment ports are free:

```sh
./start-webtransport-tailnet.sh
# Separate terminal. Add only this HTTPS endpoint, never reset Serve:
tailscale serve --bg --https=8443 --yes http://127.0.0.1:3200
# Optional separate process for the preferred IP entry:
node tailscale-entry.mjs
```

Friends enter `http://<tailscale-ip>:3202/`, which redirects to `https://<tailnet-hostname>:8443/play?transport=webtransport`. A room fragment stays in the browser across the redirect. HTTP IP entry itself is not a secure WebTransport page. Share the HTTPS URL directly if no redirect process is running. The scripts discover the active tailnet IP and hostname, not hard-coded deployment identifiers.

HTTP/WS listens only on loopback TCP 3200. Tailscale Serve supplies trusted HTTPS/WSS on TCP 8443. Native QUIC binds only the active tailnet IPv4 on UDP 3201; Serve does not forward QUIC. Tailnet policy must allow both TCP 8443 and UDP 3201, plus TCP 3202 if using IP entry. No public Funnel or blanket LAN listener is configured. Disable only this endpoint with `tailscale serve --https=8443 off`. Do not restart existing instances or overwrite their Serve ports.

Remote startup validates the current tailnet IPv4 and exact HTTPS hostname. Both local and remote opt-in listeners enforce the configured WebSocket Origin/Host and native QUIC Origin/path. Five-second single-use grants bind an actual human seat, room and its current WebSocket. Spectators and operatives receive no native seat grant. Authentication generation remains independent of match generation to survive reload/start ordering.

Each game process generates a unique seven-day P-256 certificate in a private temporary directory and delivers its SHA-256 pin through its authorized control connection. Keys have mode 0600 and directories mode 0700. Never publish keys, generated editor credentials, logs or browser network traces. Relaunch the separate instance before certificate expiry; expiration otherwise causes fallback. Certificate pinning does not replace seat authentication.

## Correctness and verification

Motion comes from recipient `snapshotFor` rows before reliable `unitDelta`, not global state. Packets contain only lifecycle generation/revision, tick, ID and whitelisted motion. Reliable membership is acknowledged before datagrams can flow. Unknown/hidden/removed entities never appear from datagrams, stale generations and non-increasing ticks are rejected, and fresher datagrams overlay older reliable motion. Packets are capped at 1000 bytes, with at most 32 pending writes per seat and 32 pending authentication sessions. Commands, durable state, fog, removals and snapshot resynchronization remain reliable.

```sh
WW2_TEST_ONLY=webtransport node test.js
node prototype/webtransport/protocol.test.mjs
node prototype/webtransport/game-motion.test.mjs
node prototype/webtransport/auth.test.mjs
# Bounded actual renderer/QUIC smoke, isolated ephemeral HTTP and UDP 33101:
node prototype/webtransport/game-probe.mjs
```

The browser smoke exercises real join/start/move, datagrams applied to render targets, socket replacement, reload, restart, auth denial and WebSocket fallback. It is not a GPU benchmark. Set `WW2_PROBE_QUIC_PORT` to another free UDP port if needed. Generated artifacts are ignored. Run the full `node test.js` gate only in an idle window, sequentially with other checks.

`WW2_SMOKE_ORIGIN=https://<tailnet-hostname>:8443 node prototype/webtransport/tailnet-smoke.mjs` deliberately creates small test rooms on an already-running authorized endpoint. Do not run against a live deployment without permission. It proves local browser reachability and cross-origin denial, not remote-peer UDP policy.

The previously accepted multiplayer build was reported smoother by the user and friends, with everyone seeing WebTransport. That is user acceptance, not a controlled latency measurement. This publishing worktree does not change the running accepted build. Remote-peer proof of this revised source, comprehensive adversarial multi-team fog tests, sustained congestion and scaling remain outside this verification.
