from pathlib import Path
p=Path('/tmp/human-ai-manual-response-v2-integrated/test-engine-ai-manual-response-policy.js');s=p.read_text()
insert="""
function bindNativeReceipts(log) {
 const stream=log.manualMeasurements;stream.physicalStarts=[];stream.inputReceipts=[];stream.publicFrames??=[];
 for(const [opIndex,op] of stream.operations.entries()) {
  op.id=`fixture-operation:${opIndex}`;
  for(const inputIndex of op.inputIndexes ?? []) {
   const input=log.inputs[inputIndex],id=`fixture-start:${opIndex}:${inputIndex}`;
   stream.physicalStarts.push({id,operationId:op.id,registeredAtTick:input.inputStartedTick,startedTick:input.inputStartedTick,queuedTick:input.queuedTick,
    kind:input.kind,input:structuredClone(input.input ?? null),fire:!!input.command,intendedIds:op.command.orders?.map(row=>row[0]) ?? op.command.ids ?? [],
    actualSelectedIds:input.ids ?? [],command:structuredClone(op.command),events:structuredClone(op.events)});
   stream.inputReceipts.push({inputIndex,operationId:op.id,startReceiptId:id,tick:input.tick,nativeDescriptor:structuredClone(input),recipe:structuredClone(op.command)});
   if(input.command) {
    const commandIndex=log.commands.findIndex(row=>row.tick===input.tick);
    Object.assign(stream.receipts.find(row=>row.commandIndex===commandIndex),{inputIndex,operationId:op.id,startReceiptId:id,tick:input.tick});
   }
  }
 }
 return log;
}
"""
s=s.replace('let assertions = 0;',insert+'\nlet assertions = 0;')
s=s.replace('  const scored=scoreManualResponses(log,10,kaplanMeier);','  bindNativeReceipts(log);\n  const scored=scoreManualResponses(log,10,kaplanMeier);')
s=s.replace("    result.inputs.forEach(input=>{input.tick+=offset;input.inputStartedTick+=offset;});", "    result.inputs.forEach(input=>{input.tick+=offset;input.inputStartedTick+=offset;if(moveQueue)input.queuedTick+=offset;});")
s=s.replace('    return result;\n  };','    bindNativeReceipts(result);return result;\n  };')
s=s.replace("grouped.manualMeasurements.operations[0].events.push(second.creation);", "grouped.manualMeasurements.operations[0].events.push(second.creation);bindNativeReceipts(grouped);")
s=s.replace("check(classifyManualCreation(later,laterScene,null,[flight]).coverage", "const authority={nativeCreations:[flight.cause,later],records:[flight.causeRecord],physicalStarts:[{id:'paid-start',operationId:'paid-job',queuedTick:flight.queuedTick,startedTick:flight.inputStartedTick,kind:flight.kind,input:flight.input,actualSelectedIds:flight.actualSelectedIds,command:flight.command,events:[flight.cause]}]};\n  flight.startReceiptId='paid-start';flight.operationId='paid-job';\n  check(classifyManualCreation(later,laterScene,null,[flight],authority).coverage")
for n in ['wrongKey','falseCause','queuedOnly','selecting','unrelatedFlight']:
 s=s.replace('null,['+n+']).decision', 'null,['+n+'],authority).decision')
s=s.replace("const coverInput={kind:'cover-key',tick:104,inputStartedTick:102,command:coverCommand,ids:coverCommand.ids};", "const coverInput={kind:'cover-key',tick:104,inputStartedTick:102,queuedTick:100,command:coverCommand,ids:coverCommand.ids};")
s=s.replace("publicAfter:{...publicAfter,recordedTick:104}","publicAfter:{...publicAfter,observationTick:106,recordedTick:106}")
s=s.replace("  check(scoreManualResponses(coverLog,10,kaplanMeier).acceptedCommand.answered,1,", "  coverLog.manualMeasurements.publicFrames=[{id:'cover-frame',tick:106,scene:coverReceipt.publicAfter}];coverLog.manualMeasurements.receipts[0].publicAfterFrameId='cover-frame';bindNativeReceipts(coverLog);\n  check(scoreManualResponses(coverLog,10,kaplanMeier).acceptedCommand.answered,1,")
s=s.replace("twoCensored.manualMeasurements.operations[0].events=[structuredClone(record.creation)];", "twoCensored.manualMeasurements.operations[0].events=[structuredClone(record.creation)];bindNativeReceipts(twoCensored);")
# Add neighboring receipt negatives without inferring or changing the creation population.
pos=s.index('  const unlinked=structuredClone(log);')
s=s[:pos]+"""  for(const field of ['queuedTick','inputStartedTick']) {
    const absent=structuredClone(log);delete absent.inputs[0][field];
    check(scoreManualResponses(absent,10,kaplanMeier).firstCompletedAction.answered,0,`missing native ${field} fails closed`);
  }
  const borrowed=structuredClone(log);borrowed.manualMeasurements.inputReceipts[0].operationId='another-job';
  check(scoreManualResponses(borrowed,10,kaplanMeier).firstCompletedAction.answered,0,'another operation cannot lend its selection');
  const wrongQueue=structuredClone(log);wrongQueue.inputs[0].queuedTick++;
  check(scoreManualResponses(wrongQueue,10,kaplanMeier).firstCompletedAction.answered,0,'a mismatched actual enqueue clock rejects selection');
  const wrongReceipt=structuredClone(log);wrongReceipt.manualMeasurements.inputReceipts[0].nativeDescriptor.ids=[999];
  check(scoreManualResponses(wrongReceipt,10,kaplanMeier).firstCompletedAction.answered,0,'immutable native descriptor mismatch rejects selection');
"""+s[pos:]
s=s.replace("  const wrongKey=structuredClone(flight);", "  check(classifyManualCreation(later,laterScene,null,[flight]).decision,'required','unregistered physical start cannot excuse the cue');\n  const forgedRegistry={...authority,nativeCreations:[]};check(classifyManualCreation(later,laterScene,null,[flight],forgedRegistry).decision,'required','an unseen earlier native cause cannot cover creation');\n  const wrongKey=structuredClone(flight);")
s=s.replace("  const noEffect=structuredClone(coverLog);", "  const intervening=structuredClone(coverLog);intervening.commands.push({tick:105,command:{t:'move',orders:[[nativeCover.own.id,79,80]]},accepted:true});\n  check(scoreManualResponses(intervening,10,kaplanMeier).acceptedCommand.answered,0,'a later cover path after another actor command is unrelated');\n  const delayedCover=structuredClone(coverLog);delayedCover.manualMeasurements.publicFrames.unshift({id:'earlier-frame',tick:105,scene:{...coverScene,recordedTick:105,observationTick:105}});\n  check(scoreManualResponses(delayedCover,10,kaplanMeier).acceptedCommand.answered,0,'defensive effect must use the first next delivered receipt');\n  const noEffect=structuredClone(coverLog);")
p.write_text(s)
