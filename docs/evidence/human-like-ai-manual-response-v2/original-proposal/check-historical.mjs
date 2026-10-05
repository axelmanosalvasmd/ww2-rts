import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import * as original from '/home/judiazm/.t3/worktrees/ww2-rts/ai-human-commander/tools/ai-humanity.mjs';
import * as candidate from './tools/ai-humanity.mjs';
const {nativeLog}=JSON.parse(readFileSync(new URL('./native-fixture-proof.json',import.meta.url)));
for(const name of ['summarizeSeat','reactionMetrics','reactionScoringComparison','measurementScoringViews'])
  assert.deepEqual(candidate[name](nativeLog,10),original[name](nativeLog,10),`${name} remains unchanged on the native fixture`);
writeFileSync(new URL('./historical-compatibility.json',import.meta.url),JSON.stringify({status:'PASS',scope:'native fixture only; no V15 re-score',reducers:['summarizeSeat','reactionMetrics','reactionScoringComparison','measurementScoringViews'],nativeLogUnchanged:true}));
console.log('Original default reducers remain byte-equivalent on the native fixture. No historical campaign was rescored.');
