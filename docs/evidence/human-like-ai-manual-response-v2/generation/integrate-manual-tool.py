from pathlib import Path
p=Path('/tmp/human-ai-manual-response-v2-integrated/tools/ai-humanity.mjs');s=p.read_text()
s=s.replace("import assert from 'node:assert/strict';", "import assert from 'node:assert/strict';\nimport {createManualResponsePolicy,MANUAL_RESPONSE_POLICY} from './ai-manual-response-policy.mjs';\nimport {createManualCapture} from './ai-manual-response-capture.mjs';\nexport {createManualResponsePolicy,MANUAL_RESPONSE_POLICY,MANUAL_RESPONSE_STREAM} from './ai-manual-response-policy.mjs';\nexport function manualResponseMetrics(log,seconds,rules) {return createManualResponsePolicy(rules).scoreManualResponses(log,seconds,kaplanMeier);}")
s=s.replace("['tools/ai-humanity.mjs', 'tools/json-stream.mjs'", "['tools/ai-humanity.mjs', 'tools/ai-manual-response-policy.mjs', 'tools/ai-manual-response-capture.mjs', 'tools/json-stream.mjs'")
s=s.replace('async function runMatch(options, task)', 'export async function runMatch(options, task)')
s=s.replace("const viewModule = oracle ? await import('../shared/ai-view.js') : null;", "const viewModule = oracle ? await import('../shared/ai-view.js') : null;\n  const manualEnabled=options.manualPolicy===MANUAL_RESPONSE_POLICY;\n  if(options.manualPolicy && !manualEnabled || manualEnabled && !ai.humanCommander) throw Error('Unsupported manual policy or controller');\n  const publicModule=manualEnabled ? await import('../shared/ai-perception.js') : null;\n  const handsModule=manualEnabled ? await import('../shared/ai-hands.js') : null;\n  const keyModule=manualEnabled ? await import('../client/keys.js') : null;")
s=s.replace('    const views = g.players.map', "    const manualMemories=manualEnabled ? g.players.map(()=>({})) : null;\n    const manualCaptures=manualEnabled ? g.players.map((_,slot)=>createManualCapture({slot,log:logs[slot],memory:manualMemories[slot],\n      rules:{...sim,bindings:keyModule.bindings},perceive:publicModule.perceive,observer:privateObservers[slot]})) : null;\n    const views = g.players.map")
s=s.replace('level: task.level, seed: task.seed }); return null;', 'level: task.level, seed: task.seed },manualMemories ? {memory:manualMemories[slot]} : {}); return null;')
s=s.replace('      logs[slot].inputs.push(row);','      logs[slot].inputs.push(row);\n      manualCaptures?.[slot].input(row,logs[slot].inputs.length-1);')
s=s.replace("...(privateObservers ? { perceptionMeasurements: privateObservers[slot] } : {})", "...(privateObservers ? { perceptionMeasurements: manualCaptures?.[slot].perceptionMeasurements ?? privateObservers[slot] } : {}),\n          ...(manualMemories ? {memory:manualMemories[slot]} : {})")
s=s.replace('        const diagnostic = ai.aiDiagnostics?.(g, slot);', "        manualCaptures?.[slot].afterThink(g.tick);\n        const manualState=manualMemories?.[slot].human;\n        const diagnostic = manualState?.hands ? {slot,...handsModule.diagnostics(manualState.hands,g.tick),persona:manualState.persona?.family,\n          attention:manualState.concern ? {id:manualState.concern.id,kind:manualState.concern.kind,since:manualState.concern.since,until:manualState.concern.until} : null,\n          screenIds:[...(manualState.view?.screenIds ?? [])],events:(manualState.events ?? []).map(event=>({...event})),\n          production:manualState.production ? structuredClone(manualState.production) : null} : ai.aiDiagnostics?.(g, slot);")
s=s.replace("    return { ...task, seconds:", "    options.nativeIsolationCapture?.(g,logs,Math.random());\n    return { ...task, seconds:")
s=s.replace('metrics: summarizeSeat(log, seconds, cameraSpan)', 'metrics: {...summarizeSeat(log, seconds, cameraSpan),...(manualEnabled ? {manualResponsePolicy:manualResponseMetrics(log,seconds,{...sim,bindings:keyModule.bindings})} : {})}')
s=s.replace("'package', 'archive'].includes(key)", "'package', 'archive', 'manual-policy'].includes(key)")
s=s.replace("  options.seconds = Number(options.seconds);", "  if(options['manual-policy']) {if(options['manual-policy']!==MANUAL_RESPONSE_POLICY || options.legacy) throw Error('--manual-policy requires screen-manual-v2 and current commander'); options.manualPolicy=MANUAL_RESPONSE_POLICY;options.logs=true;}\n  options.seconds = Number(options.seconds);")
s=s.replace("screenSpan: options.screenSpan }, definitions:", "screenSpan: options.screenSpan,...(options.manualPolicy ? {manualPolicy:options.manualPolicy} : {}) }, definitions:")
# Original reducers stay unchanged. The new field is present only in prospective, opted-in results.
s=s.replace("    if (seats.some(seat => seat.reactionScoringComparison)) {", """    if(seats.some(seat=>seat.manualResponsePolicy)) {
      const measured=seats.map(seat=>seat.manualResponsePolicy).filter(Boolean);
      const pooled=endpoint=>kaplanMeier(measured.flatMap(score=>score[endpoint].survival.curve.flatMap(row=>[
        ...Array.from({length:row.observed},()=>({seconds:row.seconds,observed:true})),
        ...Array.from({length:row.censored},()=>({seconds:row.seconds,observed:false}))])));
      groups[`${mode}/${level}`].manualResponsePolicy={policy:MANUAL_RESPONSE_POLICY,totalSeats:seats.length,recordedSeats:measured.length,
        evaluableSeats:measured.filter(score=>score.evaluable).length,
        ...Object.fromEntries(['creationEvents','requiredEvents','monitoringEvents','unknownEvents'].map(key=>[key,measured.reduce((n,score)=>n+score[key],0)])),
        firstCompletedAction:{answered:measured.reduce((n,score)=>n+score.firstCompletedAction.answered,0),censored:measured.reduce((n,score)=>n+score.firstCompletedAction.censored,0),survival:pooled('firstCompletedAction')},
        acceptedCommand:{answered:measured.reduce((n,score)=>n+score.acceptedCommand.answered,0),censored:measured.reduce((n,score)=>n+score.acceptedCommand.censored,0),survival:pooled('acceptedCommand')},
        audit:Object.fromEntries(Object.keys(measured[0].audit).map(key=>[key,measured.reduce((n,score)=>n+score.audit[key],0)]))};
    }
    if (seats.some(seat => seat.reactionScoringComparison)) {""")
p.write_text(s)
