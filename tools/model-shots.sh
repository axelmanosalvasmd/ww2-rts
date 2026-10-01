#!/usr/bin/env bash
# Screenshots of the unit model viewer (client/viewer.html), one PNG per type and faction.
#
#   tools/model-shots.sh <port> <outdir> [types] [facs]
#
# Starts nothing: a game server must already listen on <port> (for example `PORT=3702 node server.js`).
# types and facs are space or comma separated. Defaults: the main combat types, and factions 0 1 2.
# The type "all" shoots the lineup of every type (?all=1) as <outdir>/all-<fac>.png.
# Faction-locked types (ranger, tiger, conscript) only shoot for their own faction unless ALL_FACS=1.
# Writes <outdir>/<type>-<fac>.png. If /tmp/ww2-models/refs/<type>-<fac>.png exists (REFS overrides the folder), also
# writes <outdir>/<type>-<fac>-vs-ref.png: the shot and the reference side by side (ImageMagick).
# Extra viewer options go in EXTRA, for example EXTRA='&posture=2'. Viewport: VIEWPORT='1920 1080'.
set -euo pipefail

if [ $# -lt 2 ]; then
  sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
fi
port=$1 out=$2
types=$(echo "${3:-tank medium tiger rifle mg at flak fighter attacker armoredcar rocket}" | tr ',' ' ')
facs=$(echo "${4:-0 1 2}" | tr ',' ' ')
refs=${REFS:-/tmp/ww2-models/refs}
read -r vw vh <<< "${VIEWPORT:-1920 1080}"
# SESSION picks the agent-browser session, so several builders can shoot in parallel
ab() { agent-browser --session "${SESSION:-model-shots}" "$@"; }
declare -A lock=([ranger]=0 [tiger]=1 [conscript]=2)

curl -sf -o /dev/null "http://127.0.0.1:$port/client/viewer.html" || { echo "no server with the viewer on port $port" >&2; exit 1; }
mkdir -p "$out"
ab set viewport "$vw" "$vh" > /dev/null
trap 'ab close > /dev/null 2>&1 || true' EXIT

shots=0 failed=0
for type in $types; do
  for fac in $facs; do
    if [ -z "${ALL_FACS:-}" ] && [ -n "${lock[$type]:-}" ] && [ "${lock[$type]}" != "$fac" ]; then continue; fi
    if [ "$type" = all ]; then query="all=1&fac=$fac"; else query="type=$type&fac=$fac"; fi
    url="http://127.0.0.1:$port/client/viewer.html?$query${EXTRA:-}"
    png="$out/$type-$fac.png"
    ab open "$url" > /dev/null
    if ! ab wait --fn "window.__viewerReady === true" --timeout 60000 > /dev/null; then
      echo "$type-$fac: viewer not ready after 60 s" >&2; failed=$((failed + 1)); continue
    fi
    # a browser still closing from an earlier run can drop the viewport setting: set it again and reload once
    if ! ab wait --fn "innerWidth === $vw && innerHeight === $vh" --timeout 1000 > /dev/null 2>&1; then
      ab set viewport "$vw" "$vh" > /dev/null
      ab open "$url" > /dev/null
      if ! ab wait --fn "window.__viewerReady === true && innerWidth === $vw && innerHeight === $vh" --timeout 60000 > /dev/null; then
        echo "$type-$fac: viewer not ready at ${vw}x$vh after 60 s" >&2; failed=$((failed + 1)); continue
      fi
    fi
    err=$(ab eval "window.__viewerError || ''" 2> /dev/null | tr -d '"' || true)
    ab screenshot "$png" > /dev/null
    shots=$((shots + 1))
    stats=$(ab eval "(document.getElementById('stats')?.textContent || '').slice(0, 160)" 2> /dev/null | tr -d '"' || true)
    echo "$png  $stats"
    if [ -n "$err" ]; then echo "  error on page: $err" >&2; failed=$((failed + 1)); fi
    ref="$refs/$type-$fac.png"
    if [ -f "$ref" ]; then
      # both scaled to the shot's height, labeled, side by side
      montage -background '#15171a' -fill '#e8e2d4' -pointsize 22 \
        -label 'viewer' "$png" -label 'reference' "$ref" \
        -tile 2x1 -geometry "x${vh}+6+6" "$out/$type-$fac-vs-ref.png"
      echo "$out/$type-$fac-vs-ref.png"
    fi
  done
done
echo "$shots screenshots in $out${failed:+, $failed problems}" | sed 's/, 0 problems//'
[ "$failed" -eq 0 ]
