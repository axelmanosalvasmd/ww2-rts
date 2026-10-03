# Ten additional game improvements

Research date: 2026-10-03. The user agreed to the seven engine directions in [RTS engine research](rts-engine-research.md): movement/collision, vehicle handling, projectile physics, impact timing, independent map layers, scenario authoring and large-map navigation.

The user also agreed to additions 1-9 below, then explicitly added [realistic physics and world destruction](physics-destruction-research.md). Addition 10 remains a researched option because it was outside the selected approval. The [implementation spec](engine-game-feel-spec.md) proposes mechanics, delivery order and acceptance checks, with numeric tuning left to implementation. The agreed scope is recorded in [the design roadmap](../DESIGN.md#agreed-improvements-2026-10-03-research-stage).

## Selected additions

| # | Addition | What players should notice | Scope | Inspected reference |
| --- | --- | --- | --- | --- |
| 1 | Persistent combined-arms assaults | Enemy rifles advance with their supporting MGs and guns instead of arriving separately after the first interruption. | Medium for regrouping and support placement; large with flanking phases. | [OpenRA squad regrouping][regroup] |
| 2 | Reevaluate and withdraw from losing fights | Reinforcing a position can force a relatively healthy enemy assault to break off and regroup. | Medium | [OpenRA attack-or-flee evaluation][flee] |
| 3 | Horde Waves with recognizable compositions | An infantry rush, armored push or siege Wave creates a different preparation problem, with a fair advance warning. | Medium | [OpenRA scheduled attack groups][waves] |
| 4 | Editable production queues | Cancel a mistaken waiting recruit and redirect the queue toward the counter you now need. | Medium | [OpenRA production cancellation][production] |
| 5 | Recoverable battle alert history | Review a lost Point or ally ping after its notice fades, then jump to its recorded location. | Small | [OpenRA retained notifications][notifications] |
| 6 | Explicit transfers between control groups | Detach an AT squad into a reserve group without the main group's next order pulling it back. | Small | [OpenRA group assignment][groups] |
| 7 | Damage cues on surviving vehicles | A battered tank emits restrained engine smoke, visibly recovers after repair and hands over to wreck effects on death. | Medium | [OpenRA damage overlays][damage] |
| 8 | Environmental sound tied to place and weather | Rivers, woods and rain sound different as the camera moves through the map. | Medium | [OpenRA ambient sources][ambient] |
| 9 | Earlier camera-interest checks for animation | A small visible fight receives detailed animation while distant armies use cheaper presentation updates. | Medium | [OpenRA view queries][view] |
| 10 | Reserved combat effects and temporary cosmetic load reduction | Heavy shelling reduces decorative dust before it removes useful combat cues; detail returns when load falls. | Medium | [Recoil particle admission][particles] |

Scope estimates describe implementation breadth, not schedules. Player benefits and adaptations are design judgments. The reference mechanisms were inspected in source; third-party games were not benchmarked.

## Current behavior, proposed change and verification

### 1. Persistent combined-arms assaults

The AI already assembles groups, judges force margins, uses smoke and coordinates focus fire on Hard. Its committed operation stores an objective and reason, while the attack dispatch gives individual destinations. Slowest-unit marching also exists and ends on combat or arrival. See [AI assault dispatch](../shared/ai.js#L674) and [operation state](../shared/ai.js#L735).

Extend the operation with persistent membership, reachable staging, support positions and a regroup timeout. A stalled gun must not freeze the whole attack. OpenRA demonstrates leader-based regrouping; assigning Three Crossroads weapon roles is our adaptation.

Verification: rifles and an MG approach by different routes, make first contact, then regroup behind cover before continuing. Confirm that new player orders override the operation and hidden enemy changes cannot affect the AI's choices. [Supporting evidence](research/game-feel-behavior.md#1-keep-an-assault-together-after-the-first-contact).

### 2. Withdraw from losing engagements

Retreat already exists for damaged or severely suppressed units. The AI also avoids poor assaults and remembered armor before dispatching them. The extension is reevaluating an engagement that was viable when it began. See [current retreat](../shared/ai.js#L563) and [armor avoidance](../shared/ai.js#L730).

Use watched weapons, available support and recent losses to break off an untenable AI assault before every member reaches critical health. Keep a regroup interval to prevent repeated retreat/charge oscillation. Begin with clear role mismatches; reproducing OpenRA's fuzzy evaluator is unnecessary.

Verification: visible MG reinforcements make a healthy rifle attack withdraw, while hidden reinforcements produce no response. Also measure abandoned objectives so excessive retreat is not mistaken for better play. [Supporting evidence](research/game-feel-behavior.md#3-withdraw-from-a-losing-engagement-before-health-becomes-critical).

### 3. Recognizable Horde Waves

Our Horde buys randomly from an unlocked weighted roster, within an increasing MP budget, then attack-moves arriving units toward the bunker. A Wave ends only after its fielded units, Reserve and remaining purchase budget are exhausted. See [Wave selection](../shared/sim.js#L716) and [arrival orders](../shared/sim.js#L754).

Add bounded composition profiles within those existing unlocks: infantry-heavy pressure, an armored push or artillery-supported siege. Announce the broad upcoming threat during the existing break so the team can adjust its defenses. Keep some uncertainty in the exact mix. Preserve normal unit stats, spending limits, field caps and the rule that the next Wave waits for this one to end.

OpenRA's survival mission supplies an inspectable table of attack types, target positions and delays, then advances through it. Its separate reinforcement countdown demonstrates a presentation mechanism. It does not prove themed Wave warnings or balanced composition profiles; those are our proposal. See [the schedule][waves], [schedule execution][wave-execution] and [reinforcement countdown][wave-countdown]. This adds Horde content and pacing, independently of the previously agreed generic scenario-authoring engine.

Verification: compare equal-budget mixed, infantry-heavy and armored Waves across one to five defenders. Confirm every purchased unit respects its unlock, the warning matches the profile, the Reserve cap holds and no next Wave starts early. Review whether defenders actually change preparation, alongside survival and unit-loss measurements.

### 4. Editable production queues

Production progress and waiting unit names already appear as text. The existing Cancel action removes an unfinished building, not a queued recruit. See [Command Card](../client/hud.js#L491) and [construction cancellation](../shared/sim.js#L2300).

Start with individually cancelling waiting jobs. Show the refund before activation and give jobs stable identities. Active-job cancellation and its lost progress require a separate refund decision.

Verification: cancel the second waiting rifle while the first trains. Keep the first's progress, preserve the remaining order and refund once even if the request repeats. [Supporting evidence](research/game-feel-ux.md#1-inspect-and-cancel-individual-production-jobs).

### 5. Battle alert history

Alerts already have sounds, map locations and camera jumps. Ordinary notices fade after six seconds, and Space selects the newest surviving location. See [expiry](../client/alerts.js#L224) and [newest alert](../client/alerts.js#L255).

Retain a bounded match-local history with timestamps, a collapsible list and previous-event navigation. Historical locations stay historical; reopening a notice must not refresh information under fog.

Verification: after a Point loss and an ally ping fade, recover both locations from history without replaying sounds. Clear the history at the next match. [Supporting evidence](research/game-feel-ux.md#2-keep-a-short-battle-history-after-alerts-fade).

### 6. Transfer control-group membership

Set, append, recall and camera focus already exist. Set/append change only the destination group, permitting overlap. See [group operations](../client/selection.js#L80).

Add an explicit transfer operation that removes selected squads from other numbered groups before adding them to the destination. Preserve ordinary overlapping assignments as a separate existing choice and show membership on selection rows.

Verification: transfer an AT squad from group 1 into group 2, then move group 1. Only its remaining rifles receive the order. [Supporting evidence](research/game-feel-ux.md#3-transfer-squads-between-control-groups-explicitly).

### 7. Surviving-vehicle damage cues

Visible unit health and changing health-bar colors already exist. Burning wrecks are death effects. See [health updates](../client/main.js#L775) and [wreck emission](../client/fx.js#L846).

Attach light damage smoke to living vehicles, scale it by visible damage state and fade it after repair. Its appearance must differ from tactical smoke, and it remains cosmetic. Stop it when the vehicle leaves visibility and avoid duplicate living/wreck emitters on death.

Verification: damage, turn, repair and destroy a tank on both graphics presets. Smoke follows the hull and repair state without blocking sight or exposing a hidden enemy. [Supporting evidence](research/game-feel-ambience.md#2-show-a-vehicles-damage-before-it-becomes-a-wreck).

### 8. Environmental sound

Camera-relative sound, engines, work foley and weather visuals already exist. The environmental bed is currently one non-positional loop. See [ambience loop](../client/audio.js#L244).

Add sparse terrain-based emitters and public weather beds, crossfading river, woodland, wind and rain sounds as the camera moves. Merge nearby emitter regions rather than creating a sound per cell. Preserve the current no-music direction.

Verification: pan from a road to a river while a public shower arrives and ends. Check panning, fade timing, mute and loop cleanup at match exit. [Supporting evidence](research/game-feel-ambience.md#1-let-the-place-and-weather-shape-what-the-player-hears).

### 9. View-aware animation work

The frame loop animates all client-held units. Soldier drawing later performs frustum rejection, after posture and visual follower updates. Instancing, distance detail and draw culling are already present. See [animation loop](../client/main.js#L1638) and [draw rejection](../client/unit-models.js#L498).

Use conservative view bounds before expensive presentation updates. Keep authoritative state, center smoothing, minimap information and commands current. Rebuild a unit's current pose before drawing it when it returns to view. OpenRA's view partitions support the interest boundary; this particular animation policy is our adaptation.

Verification: compare the same large-army camera path before and after, recording animation CPU time, frame tails and slow frames. Rapid pans must preserve posture, trench seating and click bounds. Adopt only after repeatable benefit. [Supporting evidence](research/game-feel-performance.md#1-spend-animation-work-on-the-current-view).

### 10. Preserve useful effects under load

The common particle cap rejects new emissions when full. High can already fall back to Low after sustained slow frames. See [particle admission](../client/fx.js#L275) and [graphics fallback](../client/gfx.js#L38).

Reserve capacity for useful combat cues, then reduce decorative emissions first. Add bounded, temporary cosmetic load reduction with slower restoration, preserving the saved graphics preference. Recoil demonstrates priority reserves and gradual admission; frame-time-driven restoration is our extension.

Verification: overload the scene with shelling, wrecks and tactical smoke, then let it settle. Measure frame tails and emissions by category, retain tactical smoke and warning markers, and reject distracting quality oscillation. [Supporting evidence](research/game-feel-performance.md#2-reserve-effect-capacity-for-readable-combat-with-reversible-load-control).

## Suggested priority

Start with living-vehicle damage cues, production-job cancellation and a measured view-aware animation experiment. They cover visible realism, control and performance with concrete verification scenes. Alert history and control-group transfer are smaller follow-ups. Coordinated assaults, engagement withdrawal and Horde profiles need balance comparisons before adoption.

The detailed notes retain three alternatives outside this selected ten: lost-contact investigation, adaptive combat sound mixing and content-verified snapshot recovery. They are research alternatives, not additional agreed work.

[regroup]: https://github.com/OpenRA/OpenRA/blob/7d57605bca2cbe963068d42505e00072afe19868/OpenRA.Mods.Common/Traits/BotModules/Squads/States/GroundStates.cs#L167
[flee]: https://github.com/OpenRA/OpenRA/blob/7d57605bca2cbe963068d42505e00072afe19868/OpenRA.Mods.Common/Traits/BotModules/Squads/AttackOrFleeFuzzy.cs#L167
[waves]: https://github.com/OpenRA/OpenRA/blob/7d57605bca2cbe963068d42505e00072afe19868/mods/ra/maps/survival02/survival02.lua#L33
[wave-execution]: https://github.com/OpenRA/OpenRA/blob/7d57605bca2cbe963068d42505e00072afe19868/mods/ra/maps/survival02/survival02.lua#L237
[wave-countdown]: https://github.com/OpenRA/OpenRA/blob/7d57605bca2cbe963068d42505e00072afe19868/mods/ra/maps/survival02/survival02.lua#L113
[production]: https://github.com/OpenRA/OpenRA/blob/7d57605bca2cbe963068d42505e00072afe19868/OpenRA.Mods.Common/Widgets/ProductionPaletteWidget.cs#L367
[notifications]: https://github.com/OpenRA/OpenRA/blob/7d57605bca2cbe963068d42505e00072afe19868/OpenRA.Game/TextNotificationsManager.cs#L84
[groups]: https://github.com/OpenRA/OpenRA/blob/7d57605bca2cbe963068d42505e00072afe19868/OpenRA.Mods.Common/Traits/World/ControlGroups.cs#L48
[damage]: https://github.com/OpenRA/OpenRA/blob/7d57605bca2cbe963068d42505e00072afe19868/OpenRA.Mods.Common/Traits/Render/WithDamageOverlay.cs#L87
[ambient]: https://github.com/OpenRA/OpenRA/blob/7d57605bca2cbe963068d42505e00072afe19868/OpenRA.Mods.Common/Traits/Sound/AmbientSound.cs#L49
[view]: https://github.com/OpenRA/OpenRA/blob/7d57605bca2cbe963068d42505e00072afe19868/OpenRA.Game/Traits/World/ScreenMap.cs#L193
[particles]: https://github.com/beyond-all-reason/RecoilEngine/blob/10baea878c02c4c18cca42545ae4321a4b959d9c/rts/Rendering/Env/NanoParticles/NanoParticleSystem.cpp#L438
