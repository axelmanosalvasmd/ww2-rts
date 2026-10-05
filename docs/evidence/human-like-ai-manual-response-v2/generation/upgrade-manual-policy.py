from pathlib import Path
p=Path('/tmp/human-ai-manual-response-v2-integrated/tools/ai-manual-response-policy.mjs')
s=p.read_text().replace('screen-manual-v2-proposal','screen-manual-v2').replace('ww2-public-manual-response-v2-proposal','ww2-public-manual-response-v2')
s=s.replace('function paidProtection(scene, event, unit, flights) {','function paidProtection(scene, event, unit, flights, authority) {')
s=s.replace("return flights.find(flight => flight.kind", "return flights.find(flight => authority?.nativeCreations?.some(cause => isDeepStrictEqual(cause,flight.cause))\n    && authority?.records?.some(record => isDeepStrictEqual(record,flight.causeRecord))\n    && authority?.physicalStarts?.some(start => start.id === flight.startReceiptId && start.operationId === flight.operationId\n      && start.queuedTick === flight.queuedTick && start.startedTick === flight.inputStartedTick\n      && start.kind === flight.kind && isDeepStrictEqual(start.input,flight.input)\n      && isDeepStrictEqual(start.actualSelectedIds,flight.actualSelectedIds)\n      && isDeepStrictEqual(start.command,flight.command)\n      && start.events.some(cause=>isDeepStrictEqual(cause,flight.cause)))\n    && flight.kind")
s=s.replace('function classifyManualCreation(event, scene, previous = null, flights = []) {','function classifyManualCreation(event, scene, previous = null, flights = [], authority = null) {')
s=s.replace('&& !UNITS[unit.type].structure;','&& !UNITS[unit.type].structure && !UNITS[unit.type].air && !(unit.flags & 32768);')
s=s.replace('paidProtection(scene, event, unit, flights)','paidProtection(scene, event, unit, flights, authority)')
s=s.replace('function defensiveEffect(receipt, record) {','function defensiveEffect(receipt, record, stream, log) {\n  const frame = stream.publicFrames?.find(row=>row.id === receipt.publicAfterFrameId);\n  const first = stream.publicFrames?.find(row=>row.scene.observationTick > receipt.publicScene.observationTick && row.tick > receipt.tick);\n  if (!frame || frame !== first || !isDeepStrictEqual(frame.scene,receipt.publicAfter)\n    || (log.commands ?? []).some((row,index)=>index > receipt.commandIndex && row.tick <= frame.tick\n      && idsOf(row.command).some(id=>idsOf(receipt.command).includes(id)))) return false;')
s=s.replace("const supplied = stream.creations ?? [], records = supplied.map(row => classifyManualCreation(row.creation,\n    row.publicProof, row.publicBaseline, row.inFlightProof));", "const supplied = stream.creations ?? [], records = [];\n  const nativeCreations=log.events ?? [];\n  for (const row of supplied) records.push(classifyManualCreation(row.creation,row.publicProof,row.publicBaseline,row.inFlightProof,\n    {nativeCreations,records,physicalStarts:stream.physicalStarts ?? []}));")
s=s.replace('missingOperationProof: 0, belowReactionFloor: 0','missingOperationProof: 0, invalidNativeReceipt: 0, belowReactionFloor: 0')
a=s.index('      const responses = operation.inputIndexes?');b=s.index('      if (!first) audit.missingOperationProof',a)
s=s[:a]+'''      const responses = [];
      for (const receipt of stream.inputReceipts ?? []) {
        if (receipt.operationId !== operation.id) continue;
        const input=log.inputs?.[receipt.inputIndex], start=(stream.physicalStarts ?? []).find(row=>row.id === receipt.startReceiptId);
        const valid=input && start && Number.isSafeInteger(receipt.inputIndex)
          && [input.tick,input.inputStartedTick,input.queuedTick,start.startedTick,start.queuedTick,receipt.tick].every(Number.isSafeInteger)
          && start.operationId === operation.id && receipt.tick === input.tick
          && input.queuedTick === operation.queuedTick && start.queuedTick === operation.queuedTick
          && input.inputStartedTick === start.startedTick && input.inputStartedTick >= operation.inputStartedTick
          && input.tick >= input.inputStartedTick && input.tick <= end
          && start.kind === input.kind && isDeepStrictEqual(start.input ?? null,input.input ?? null)
          && isDeepStrictEqual(start.command,operation.command) && isDeepStrictEqual(start.events,operation.events)
          && isDeepStrictEqual(receipt.nativeDescriptor,input) && isDeepStrictEqual(receipt.recipe,operation.command)
          && receipt.inputIndex === (stream.inputReceipts ?? []).find(row=>row.inputIndex === receipt.inputIndex)?.inputIndex
          && (stream.inputReceipts ?? []).filter(row=>row.inputIndex === receipt.inputIndex).length === 1;
        if (!valid) { audit.invalidNativeReceipt++; continue; }
        responses.push({input,receipt,start});
      }
      let first = responses.find(({input,start}) => {
        if (input.countsAPM === false || input.kind === 'beat' || input.actor === 'human' && input.kind === 'command'
          || input.kind?.startsWith('camera-')) return false;
        if (input.command) return start.fire === true && input.command.t === operation.command.t;
        const selection = ['select-click','select-add-click','select-box','group-recall'].includes(input.kind);
        return selection && isDeepStrictEqual(start.intendedIds,idsOf(operation.command));
      })?.input;
''' +s[b:]
s=s.replace('for (const input of responses) {','for (const {input,receipt:inputReceipt,start} of responses) {')
s=s.replace("const proof = (stream.receipts ?? []).find(row => row.commandIndex === commandIndex);", "const proof = (stream.receipts ?? []).find(row => row.commandIndex === commandIndex && row.inputIndex === inputReceipt.inputIndex\n          && row.operationId === operation.id && row.startReceiptId === start.id);")
s=s.replace("{ ...nativeReceipt, publicScene: proof.publicScene, publicAfter: proof.publicAfter }", "{ ...nativeReceipt, ...proof, commandIndex }")
s=s.replace("if (receipt?.accepted === true", "if (start.fire === true && input.command?.t === operation.command.t && receipt?.accepted === true")
s=s.replace('defensiveEffect(receipt, record)','defensiveEffect(receipt, record, stream, log)')
p.write_text(s)
