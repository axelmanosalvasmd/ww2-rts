import{regionsFor}from'/tmp/v16-public-tail-counts/shared/sim-regions-probe.js';import{readFileSync,writeFileSync}from'node:fs';import{deserialize}from'node:v8';
const fixtures=deserialize(readFileSync('/tmp/ai-v16-graph-fixtures.bin'));let sink=0;
const sweep=()=>{const rows=[];for(const fixture of fixtures){const g={...fixture};const start=performance.now();const labels=regionsFor(g,g.block);rows.push({tick:g.tick,block:g.block,milliseconds:performance.now()-start});sink+=labels[0];}return rows;};
const warmups=[sweep(),sweep()];const trials=[];for(let k=0;k<12;k++)trials.push(sweep());
const median=values=>values.sort((a,b)=>a-b).slice(5,7).reduce((a,b)=>a+b)/2;
const summaries=fixtures.map((fixture,i)=>({tick:fixture.tick,block:fixture.block,medianMS:median(trials.map(rows=>rows[i].milliseconds))}));
const report={note:'Isolated full-map region connectivity pass on captured native flags/height graphs. CPU1 nice19, all2warmups and12fixed trials retained. No whole-frame timing or acceptance claim. Existing native graph capture used, no new native simulation row.',fixtures:fixtures.length,warmups,trials,summaries,sink};writeFileSync('/tmp/v16-region-cost-probe.json',JSON.stringify(report,null,2));console.log(summaries);
