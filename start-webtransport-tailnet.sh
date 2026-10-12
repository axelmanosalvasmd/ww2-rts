#!/bin/sh
# Separate tailnet instance. Never restarts ports 3000 or 3100.
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
export HOST=127.0.0.1 PORT=3200 WW2_SHARDS=1 WW2_WEBTRANSPORT=1
export WW2_WT_TAILNET=1 WW2_QUIC_PORT=3201
WW2_QUIC_HOST=$(tailscale ip -4)
PUBLIC_URL=$(tailscale status --json | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>console.log("https://"+JSON.parse(s).Self.DNSName.replace(/\.$/,"")+":8443"))')
export WW2_QUIC_HOST PUBLIC_URL
exec node server.js
