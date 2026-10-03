# Three Crossroads: three additional UI/UX ideas

Research inspected 2026-10-03. These are proposals, not adopted design. Existing cover previews, contextual orders, formation facing, route overlays, Shift order queues, type filtering, idle-unit selection, numbered groups, teammate pings and objective notices already exist and are not counted as new ideas.

All upstream examples below were read from OpenRA commit `7d57605bca2cbe963068d42505e00072afe19868`, the `bleed` head resolved during this inspection. No runtime or performance measurements were taken.

## 1. Inspect and cancel individual production jobs

**Current behavior.** Classic already displays training progress and the names of waiting units, but the queue is text (`client/hud.js:493`, `client/hud.js:515`). Its Cancel button applies only to unfinished buildings (`client/hud.js:491`, `client/hud.js:509`); the matching simulation command likewise refuses completed buildings (`shared/sim.js:2300`). This proposal is about unit jobs, not building cancellation.

**Extension and benefit.** Show each production job as a small selectable card, with an explicit cancel action and a refund shown before activation. Begin with cancelling waiting jobs; handle the active job separately so its lost progress and refund are clear. A player who queued rifles before spotting armor can free the remaining queue and budget for a counter without destroying the Barracks. Refund rules need a design decision, not an assumed copy of the building's 75% refund.

**Verified upstream pattern.** [OpenRA ProductionPaletteWidget.cs:367-423](https://github.com/OpenRA/OpenRA/blob/7d57605bca2cbe963068d42505e00072afe19868/OpenRA.Mods.Common/Widgets/ProductionPaletteWidget.cs#L367-L423) distinguishes cancellation from pausing: right-click cancels eligible jobs or pauses a running item; middle-click cancels directly. [Lines 428-437](https://github.com/OpenRA/OpenRA/blob/7d57605bca2cbe963068d42505e00072afe19868/OpenRA.Mods.Common/Widgets/ProductionPaletteWidget.cs#L428-L437) calculate batch cancellation counts from modifiers. These files prove input dispatch, not Three Crossroads refund economics. Individual queue cards and explicit buttons are our proposed adaptation.

**Acceptance scene.** Queue three rifles and an AT gun. Cancel only the second waiting rifle while the first is training. The first keeps its progress, the remaining jobs keep their order, and the agreed MP/Fuel refund occurs once even if the request is repeated. A different player's building refuses the operation.

**Complexity: medium.** Requires a simulation command, stable job identification, refund accounting and a queue UI.

## 2. Keep a short battle history after alerts fade

**Current behavior.** Alerts already have sound, map locations and clickable camera jumps. The visible list is capped at four (`client/alerts.js:9`, `client/alerts.js:77`), expired rows are removed (`client/alerts.js:224`) and Space targets the newest surviving location (`client/alerts.js:255`). Ordinary lines live six seconds; base and scripted notices have longer lives. Teammate pings already produce named alerts (`client/pings.js:29`), and tutorial goals already persist (`client/objectives.js:20`, `client/objectives.js:62`).

**Extension and benefit.** Retain a bounded, match-local history of emitted alerts with their timestamps and known coordinates. Add a collapsible history panel and a separate previous-event shortcut. The transient list and its sounds can stay as they are. A player managing a fight can review which point was lost after the immediate notice has disappeared. Historical locations must stay historical: reopening a row must not refresh hidden enemy positions.

**Verified upstream pattern.** [OpenRA TextNotificationsManager.cs:26-27](https://github.com/OpenRA/OpenRA/blob/7d57605bca2cbe963068d42505e00072afe19868/OpenRA.Game/TextNotificationsManager.cs#L26-L27) exposes a notification cache; [lines 84-91](https://github.com/OpenRA/OpenRA/blob/7d57605bca2cbe963068d42505e00072afe19868/OpenRA.Game/TextNotificationsManager.cs#L84-L91) append notifications before UI delivery, and [lines 110-114](https://github.com/OpenRA/OpenRA/blob/7d57605bca2cbe963068d42505e00072afe19868/OpenRA.Game/TextNotificationsManager.cs#L110-L114) clear it. This verifies separating retained messages from display delivery. A bounded spatial history and camera cycling are proposed extensions, not behavior demonstrated by that file.

**Acceptance scene.** Lose a point, finish a unit and receive an ally ping while fighting elsewhere. After all three notices fade, open history and jump to the lost point, then the ping. No new sound plays, no enemy information is fetched, and starting another match clears the history.

**Complexity: small.** Client-side retention, panel and shortcut using existing alert coordinates.

## 3. Transfer squads between control groups explicitly

**Current behavior.** Numbered groups already support set, append, recall and rapid repeat recall to focus the camera (`client/selection.js:80`). Set/append update only the destination group's IDs (`client/selection.js:84`), allowing the same squad in multiple groups. Type rows already isolate or remove a type from the current selection (`client/hud.js:271`, `client/selection.js:65`), so type filtering is not new. Group formation settings are already saved and restored (`client/main.js:1317`).

**Extension and benefit.** Add explicit Transfer to group and Remove from groups actions while preserving the existing overlapping-group operations. Transfer removes the selected IDs from other numbered groups, then adds them to the destination. Display group membership on selection rows or unit badges. A player can detach an AT squad from a main assault into a reserve group without an old group recall pulling it back into the assault.

**Verified upstream pattern.** [OpenRA ControlGroups.cs:48-67](https://github.com/OpenRA/OpenRA/blob/7d57605bca2cbe963068d42505e00072afe19868/OpenRA.Mods.Common/Traits/World/ControlGroups.cs#L48-L67) removes selected actors from other groups before creating or adding to a group. [Lines 81-100](https://github.com/OpenRA/OpenRA/blob/7d57605bca2cbe963068d42505e00072afe19868/OpenRA.Mods.Common/Traits/World/ControlGroups.cs#L81-L100) implement removal and membership lookup. OpenRA's exclusive assignment is verified; offering it as a separate action alongside Three Crossroads' overlap is our adaptation.

**Acceptance scene.** Put rifles and an AT squad in group 1, then transfer only the AT squad to group 2. Recall 1 and issue a move: only rifles receive it. Recall 2 and the AT squad remains available. Ordinary append still permits a deliberately overlapping group, and each group's saved formation stays intact.

**Complexity: small.** Selection operations, shortcut binding and membership feedback; no new server command.
