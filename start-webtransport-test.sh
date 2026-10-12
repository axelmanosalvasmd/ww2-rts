#!/bin/sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
export HOST=127.0.0.1 PORT=3100 PUBLIC_URL=http://127.0.0.1:3100
export WW2_WEBTRANSPORT=1 WW2_QUIC_PORT=3101 WW2_SHARDS=1
exec node server.js
