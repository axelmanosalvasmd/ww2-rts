# V15 browser evidence, 2026-10-04 UTC

This captures the frozen V15 runtime through ordinary room Join, Watch, add three Normal AI players, Start, and confirmed Restart. It provides visual evidence of an actual spectator match and its opt-in AI hands overlay. It does not establish release readiness. The parent reported that the quiet performance gate still failed.

## Source and process provenance

- Worktree: `/home/judiazm/.t3/worktrees/ww2-rts/ai-human-commander`.
- Frozen archive: `/tmp/human-ai-v15-full-source`.
- `shared/ai.js`: `1e601a848c53b1d31493d3fff18648ead11721d5c4a389a50ea1a14aa691a2e0`.
- `shared/ai-hands.js`: `69eb15070dbf3e3839f4a264bc24d5010033f6d745bc1cf53ba285fc362323d6`.
- `source-before.json` and `source-after.json` cover server.js and all shared/client JavaScript, 108 files. They are byte-identical. Both manifest hashes are `c43e2558368490737ea9e27b76deaf4a9e736a3db7dba745aeef3412f7f92cd3`.
- Server used `HOST=0.0.0.0 PORT=3106 node server.js`, initially pinned to CPU 10 for native preview, later CPU 4 for fallback. No game fixtures or unit/resource injection were used.
- Both owned server sessions were stopped. The fallback browser session was closed. Port 3106 was checked clear. Native preview disconnected after its recordings were stopped; its external tab could not be closed through the unavailable host.
- No worktree files were created or edited for this capture. Evidence and tooling output are in this directory.

## Primary artifacts

- `opening-original.mp4`: native T3 preview, 55.7917 seconds, 1600 by 900, 24,539,529 bytes. Includes the ordinary Restart confirmation and real early match.
- `opening-35s.mp4`: 34.987 second copy trim from 2 seconds into the original, 16,033,703 bytes. This is the preferred opening clip.
- `opening-frame-6s.png`, `opening-after.png`, `opening-contact-sheet.png`: inspected native opening frames. Original movie frames retain 1600 by 900; the native snapshot PNG was downscaled by the preview tool.
- `battle-attempt-original.mp4`: native T3 preview, 30.7272 seconds, 1600 by 900, 13,796,689 bytes. The initial camera was not the best active fight location. Keep as supplementary evidence.
- `battle-attempt-frame-14s.png`: inspected native frame with real infantry and a large artillery blast clear of the HUD.
- `linux-lobby.png`: inspected ordinary UI setup confirming three Normal AI seats on separate teams, USA/Germany/USSR, Default map, Conquest, Standard army.
- `linux-battle-live.png`: inspected clear battle screenshot with actual infantry, fires and smoke around the central capture point. Alert history is collapsed; the compact minimap does not cover the central fight. Camera footprints and pointer markers are visible on the minimap.
- `linux-battle-40s.mp4`: 40.000 seconds, 1600 by 900, 11,592,143 bytes, cut from the fallback recording. Shows real aircraft/paratroops, infantry and smoke/fire around the same point.
- `linux-battle-frame-1s.png`, `linux-battle-frame-20s.png`, `linux-battle-frame-38s.png`, `linux-battle-contact-sheet.png`: all inspected from the actual fallback movie.
- `linux-battle-original.webm`: retained uncut fallback capture, 143.534 seconds, 13,916,109 bytes. CLI latency made this much longer than the intended recording.

## Ordinary flow and console results

Native preview was checked first, then opened through T3. The actual room was `v15joined310` because the Join field limits names to 12 characters. Joining drops the `aiOverlay=1` query parameter, so the same room URL was navigated again with that opt-in query restored before capture. Watch, three AI additions, Start and Restart used the ordinary UI.

The first start's captured packet metadata orders `start` before the first state packet: outgoing start at 34668.70 ms, incoming pause at 34795.40 ms, lobby state play at 34798.10 ms, start matchId 1 at 34909.70 ms, then state tick 2 at 36534.80 ms. See `native-flow-observations.json`. Native readbacks reported zero application errors at tick 42, after Restart at tick 6, and through the last inspected tick 2686. The previous startup TypeError did not recur in these observed flows. The full in-page native timeline was lost when the preview host disconnected, so this file preserves only metadata actually returned before disconnection.

The exact native host failure is in `native-preview-unavailable.txt`. It explicitly reported no preview automation host and instructed no retries. Parent authorized the Linux Playwright fallback after that result. No further native preview calls were made after the already submitted batch completed.

The fallback used a fresh ordinary room `v15linux`. Its current-page console ended with zero messages, zero errors, zero warnings, saved in `linux-console.txt`; captured error and unhandled-rejection listeners are also empty in `linux-evidence.json`. The first fallback page, before navigation to the fresh room, logged four WebGL GPU readback stall warnings in `.playwright-cli/console-2026-10-04T15-02-01-901Z.log`. A failed instrumentation expression and CLI timeout messages were automation failures, not application exceptions.

## Overlay observations and limits

`linux-evidence.json` contains only delivered spectator snapshot observations, AI hands diagnostics, camera pose and visible shot rows. `observed-summary.json` summarizes 90 samples from ticks 1364 through 10052, with final readback tick 10136. All seats showed camera concerns including fight, point, production, alert and idle. Samples caught active cursor travel for all three seats and changing click markers. These observations support working diagnostics and visible serial physical activity. They are incomplete samples, not command counts or a reaction-time measurement.

The sampled spectator snapshots contained no MP, munition, orders, queues, productionJobs or acceptedCommands fields. This is a readback check of this spectator flow, not a replacement for the automated normal-player privacy tests.

Camera framing changed only spectator view: the native opening used overview x/z 80/80 and distance 135; battle framing used delivered visible shot locations. The final fallback camera was near x 74.15, z 86, distance 65. Controls and Alert history were closed for the final fight. No unit or game state was manufactured. Fallback Graphics was changed through the existing UI setting to Low. Direct DOM button activation and spectator camera adjustment were needed because software rendering made several CLI clicks time out.

The fallback software renderer ran at a visibly low frame rate and delivered delayed public updates. Its 40 second wall-clock clip is useful for scene and overlay inspection, but does not demonstrate real-time AI response latency, native pointer speed, performance acceptance, exact resource float or human-calibrated timing. The native clips are the better motion evidence. Screenshots cannot prove exact resources or reaction time. Neither these films nor sampled concern labels establish that every requested fight received a timely response.

The opening frames show an initial quiet observation period followed by squad movement and capture progress. The battle images show an actual contested point with casualties, smoke, fire and airborne activity. A separate simulation/log analysis is needed to judge late answers, resource float, skill realism and causal response accuracy quantitatively.
