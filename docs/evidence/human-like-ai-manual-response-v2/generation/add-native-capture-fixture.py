from pathlib import Path
p=Path('/tmp/human-ai-manual-response-v2-integrated/test-engine-ai-manual-response-policy.js');s=p.read_text().replace("import { bindings } from './client/keys.js';", "import { bindings } from './client/keys.js';\nimport {createManualCapture} from './tools/ai-manual-response-capture.mjs';")
pos=s.index('  const isolation=[];')
s=s[:pos]+"""
  // The capture adapter observes actual jobs and actual native input receipts, without injected links.
  const captured=fixture('rifle','mg');captured.own.holdFire=true;captured.foe.holdFire=false;captured.foe.x=110;
  const capturedLog={events:[],inputs:[],commands:[],physicalInputsRecorded:true},capturedMemory={human:captured.state};
  let adapter;
  const capturedHands=createHands({slot:0,seed:27,level:'hard',camera:captured.state.camera,startedTick:100,
    log:input=>{capturedLog.inputs.push(structuredClone(input));adapter.input(capturedLog.inputs.at(-1),capturedLog.inputs.length-1);}});
  capturedHands.openingUntil=0;capturedHands.openingDone=true;captured.state.hands=capturedHands;
  adapter=createManualCapture({slot:0,log:capturedLog,memory:capturedMemory,rules:{CELL,CFG,UNITS,SUPPORT,COVER,los,bindings},perceive,
    observer:{measureRaw:()=>null,onMeasurements:()=>{}}});
  const deliver=tick=>{
    captured.g.tick=tick;
    captured.state.view=perceive(viewFor(captured.g,0,captured.memory),0,captured.state,tick,adapter.perceptionMeasurements);
    for(const event of captured.state.events)if(!capturedLog.events.some(row=>row.id===event.id))capturedLog.events.push(structuredClone(event));
    adapter.afterThink(tick);return captured.state.view;
  };
  const capturedView=deliver(100);
  const capturedCmd={t:'retreat',ids:[captured.own.id]};
  assert.ok(enqueueDecision(capturedHands,capturedCmd,capturedView,{}),'natural enqueue needs no grading labels');assertions++;
  adapter.afterThink(100);
  for(let tick=100;tick<200 && !capturedLog.commands.length;tick++) {
    const v=deliver(tick);
    advanceHands(capturedHands,tick,v,cmd=>{const result=command(captured.g,0,cmd);capturedLog.commands.push({tick,command:structuredClone(cmd),accepted:result===undefined});return result;});
    adapter.afterThink(tick);
  }
  const nativeCaptureScore=scoreManualResponses(capturedLog,10,kaplanMeier);
  check(nativeCaptureScore.requiredEvents,1,'the adapter preserves its actual public required creation');
  check(nativeCaptureScore.firstCompletedAction.answered,1,'natural job/start/input receipts establish first-action attribution');
  check(nativeCaptureScore.acceptedCommand.answered,1,'natural native propagation establishes accepted-command attribution');
  check(nativeCaptureScore.audit.invalidNativeReceipt,0,'natural clocks and immutable native descriptors bind correctly');
  const actualCommandOnly=structuredClone(capturedLog);
  actualCommandOnly.inputs.forEach(input=>{input.actor='human';input.kind='command';});
  check(scoreManualResponses(actualCommandOnly,10,kaplanMeier).acceptedCommand.answered,0,'a command-only recorder cannot borrow a natural physical receipt');

"""+s[pos:]
p.write_text(s)
