import assert from 'node:assert/strict';import{readFileSync,writeFileSync}from'node:fs';import{pathToFileURL}from'node:url';
const root='/home/judiazm/.t3/worktrees/ww2-rts/ai-human-commander',candidate='/tmp/ai-v16-fresh-root';
for(const name of ['test-engine-ai-perception.js','test-engine-ai-privacy.js']) {
 await import(candidate+'/'+name);
}
writeFileSync('/tmp/public-copy-root-controls.json',JSON.stringify({candidate,existingPerceptionControls:true,existingPrivacyControls:true},null,2));
