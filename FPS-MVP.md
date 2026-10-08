# Commander + infantry companion MVP

This branch is a separate preview of Three Crossroads, not a replacement for the original RTS checkout or hosting.

## Play

1. Open the preview `/play` URL in a desktop browser. Create a room and join as commander.
2. Add an AI opponent or invite another commander. Leave the game in Conquest for the simplest demo.
3. A friend can use the lobby's infantry operative role and choose your commander. Companions do not consume an army seat.
4. Or start the battle, then click `Open teammate FPS`. It opens a separate companion tab attached to your army. Share that tab's full URL with a friend if you want the commander and companion on different computers.
5. Click `Capture mouse`, then use WASD, mouse aim, and hold left click to fire. Escape releases the mouse. A click on the capture button is needed after refresh or after leaving capture.

The companion joins the exact RTS battle. The commander still buys, moves and manages the army. Companions see the commander's army and team fog, not an omniscient spectator feed. Up to four companions attach per room. A direct link has the form `/play?role=operative&commander=0#ROOMCODE`; the commander number is the zero-based human army seat. It works after a match has started.

## Rules

One ordinary infantry body, 20 HP. Same 4.5 m/s rifle movement, no sprint/jump. A manually aimed rifle deals 6 infantry damage, at most once per 0.65 seconds, to 36 m. Server terrain, fog and line-of-sight checks govern movement and hits. Walls, water and steep cliffs are not walk-through shortcuts. Friendly bodies stop bullets without friendly damage. Vehicles take only 0.5 damage per rifle hit.

The first soldier is free. Enemy-caused death waits 8 seconds and charges 10 commander manpower to replace the soldier. If the army cannot afford that, the HUD reports waiting for MP. Disconnect immediately expires input and does not pause the commander's battle; refresh reconnects the same companion identity and soldier. The commander cannot redirect this soldier with RTS orders, and the companion cannot order other troops or change the room.

## Verification commands

From this worktree:

```
node test.js
node test-operative.mjs
node test-operative-client.mjs
node test-operative-server.mjs
node tools/test-operative-public.mjs https://YOUR-PREVIEW-HOST
```

The operative simulation, control and server tests are also included in `node test.js`. Public acceptance checks HTTPS assets and actual WSS commander/enemy/companion sessions, fog and role isolation, movement and rifle input.

Real browser acceptance uses Chromium with actual WebGL, a real X11 display and XTest relative mouse input. Headless Chromium does not provide reliable native pointer-lock relative motion, so synthetic `mousemove` is not used as evidence of mouse aim.

```
npm install --prefix /tmp/ww2-fps-browser playwright
node /tmp/ww2-fps-browser/node_modules/playwright/cli.js install chromium
xvfb-run -s '-screen 0 1400x1000x24' node tools/test-operative-browser.mjs
```

`xdotool` and Xvfb must be installed, or their unpacked binaries supplied. `PLAYWRIGHT_MODULE` and `XDOTOOL` override their paths. This implementation environment used unprivileged Debian package downloads extracted under `/tmp/ww2-fps-x11`, display `:97`, and the xdotool path `/tmp/ww2-fps-x11/root/usr/bin/xdotool`, with `LD_LIBRARY_PATH=/tmp/ww2-fps-x11/root/usr/lib/x86_64-linux-gnu`. Xvfb's compiler path was adjusted only in its temporary extracted binary because `/usr/bin/xkbcomp` was unavailable. No system package installation or root access was used.

Acceptance runs a real commander and companion at the same time, plus a connected enemy commander over a real WebSocket. It places the controlled soldier and a real existing enemy rifle in an open area of the original map for deterministic native movement/aim/damage checks, then issues a normal enemy attack command and checks death, paid respawn and refresh preserving the same soldier. The enemy remains connected, so absent-player order rejection is never bypassed. Native input targets the named operative X11 window and movement waits for the authoritative snapshot rather than a fixed rendering delay. Fixtures arrange server entities; they do not synthesize network responses, client positions or hit results. Software rendering uses reduced graphics and test-only animation throttling. Screenshots are written under `evidence/`.

## Isolated preview hosting

```
node tools/serve-mvp.mjs
```

The launcher binds the separate demo to `127.0.0.1:3100`, starts `/home/axel/.local/bin/cloudflared`, discovers a temporary HTTPS URL, then starts the authoritative server with that public URL and a random editor password. It caps the demo at four rooms. It writes `/home/axel/.hermes/ww2-fps-mvp-runtime.json` with URL and process IDs, never the editor secret. `PORT` and `CLOUDFLARED` are optional overrides. SIGINT/SIGTERM stop this demo and its tunnel without touching the original RTS server.

The quick-tunnel URL changes after launcher restart. The preview is process-backed, not a permanent domain or a boot-managed service. A user systemd bus was unavailable in this execution environment and passwordless sudo was not authorized; neither was bypassed. The original RTS checkout was not modified or deployed over.

## Scope and known limits

Desktop keyboard/mouse, HTTPS or localhost, modest room size. No mobile FPS controls, classes, inventory, reload, prone/jump/sprint, per-limb hitboxes, player-controlled vehicles, building damage from the operative rifle, or permanent hosting. World Conquest companion mode is intentionally rejected. Existing RTS modes and normal spectators remain separate. The rifle is a simple stylized model; enemy hitboxes use the existing coarse infantry/vehicle hulls, not exact rendered squad member geometry. FPS art, performance tuning, audio, input reconciliation and balance are still prototype-grade.

Simulation/protocol implementation is in `shared/sim.js` and `server.js`; client control/rendering is in `client/operative-controls.js`, `client/operative-view.js` and `client/operative.css`, integrated through the existing `client/main.js` rather than a separate game engine. `DESIGN.md` and `CHANGELOG.md` describe authority, privacy and rule choices.
