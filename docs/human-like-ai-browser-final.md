# Archived V8 commander browser proof

This evidence predates the current source. Final browser proof is pending an accepted source freeze and performance check.

Captured on 2026-10-04 after the V8 source freeze using a server on port 3106 with `HOST=0.0.0.0` and collaborative
preview tab 9 at `http://100.92.252.116:3106/play?aiOverlay=1#finalqa3106`, 1280x720. Three Normal AIs played a real
Conquest FFA on the default map, with the viewer spectating and Controls closed throughout. No fixture or unit changes
were used.

- Opening: [28.181 second recording](/home/judiazm/.t3/userdata/attachments/mcp-e5a71bd8-d16f-4b65-a318-a54464179920-650ad97a-907a-46df-9ea2-cc5b487fdde6-mp4.mp4), 11,235,189 bytes.
- Battle: [36.155 second recording](/home/judiazm/.t3/userdata/attachments/mcp-e5a71bd8-d16f-4b65-a318-a54464179920-d1af1347-3ebc-4cfc-92e6-765b7885991f-mp4.mp4), 15,599,433 bytes.
- [Opening screenshot](/home/judiazm/.t3/userdata/browser-artifacts/browser-screenshot-100-92-252-116-muth760b-126728ae.png).
- [Battle overview screenshot](/home/judiazm/.t3/userdata/browser-artifacts/browser-screenshot-100-92-252-116-muth8gos-7f199acc.png).
- [Battle close view](/home/judiazm/.t3/userdata/browser-artifacts/browser-screenshot-100-92-252-116-muth9lvy-b4311177.png).
- Inspected contact sheets: `/tmp/human-final-proof/opening-contact-sheet.png` and `/tmp/human-final-proof/fight-contact-sheet.png`.
- Public snapshot timeline: `/tmp/human-final-proof/timeline.json`, 240 samples spanning ticks 36 to 2420.

The opening shows a pause before squads leave, then separate departures. First visible ground clicks were at ticks
83, 87 and 89 (4.15, 4.35 and 4.45 seconds). These are overlay clicks, not a replacement for the command timing
metrics. The clips show moving camera outlines and cursors on the minimap, separate click markers, and cameras
visiting fights and returning to production or idle units. For example, blue visited a fight at tick 1630 around
(73.1, 117.3); chalk visited an alert at tick 1820 around (45.2, 68.5). Units away from the current camera sometimes
continue fighting while its attention stays elsewhere. The recording does not identify the event behind each delay.

The viewer reported no console entries or captured application errors through tick 5624. Spectator snapshots had no
`mp`, `orders`, `queues` or `productionJobs` fields. Production pauses are visible, but floating manpower cannot be
measured from this spectator UI. Use the authoritative match metrics for that claim.

Captured source SHA-256:

```text
shared/ai-hands.js     f51446182d51e6fe0f5e8aea64b15de51b6f8482b1bb40f58e1e4ee87ba6fd9c
client/ai-overlay.js  9042e20afef01299e50d6116eb5f887dfe622dfc4eaaeb04767fd94f20a0845a
server.js             dd361b79121f8cb88162a017e4aa6ac585415cf3cbe3104e23a4457178e699d9
client/main.js        312922caa90e4769e694f73e99b18ff9ba9f0b942bbb5ed0a846f31accd0d71c
```
