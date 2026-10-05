Room lifecycle native delivery race.

The server finishMatch() synchronously sets room.state=lobby and calls async lobby(room). lobby awaits current maps and Horde discovery before broadcasting. The test harness client.send() only settles for a short period, not an acknowledgement on every other client. last(invite,lobby) can therefore still refer to the running-match hello.

Prospective fix: record invite.messages.length before each hostEnd/sit/spectate transition, wait for a matching NEW native lobby message, then keep every original assertion unchanged. No arbitrary sleeps or weakened expected phase. Patch changes only this spectator test block.

Native causal control: pause spectator TCP read before actual hostEnd. Server is lobby, client last received lobby is play. Original entire11-scenario check fails at the exact original assertion. Patched entire check waits; while read remains paused, the barrier is explicitly unresolved. Resume native read and the original lobby/sit/spectate assertions and all11 scenarios pass. Normal delivery passes all11 too. Existing neighboring spectator-command denial and all-AI spectator hosting controls remain unchanged.

See proof.json, four preserved run logs, original/candidate extracted fixtures, complete test.js.candidate, and room-lifecycle-delivery.patch. All files are scratch under/tmp. ROOT source unchanged.
