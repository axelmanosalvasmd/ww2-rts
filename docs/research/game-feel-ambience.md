# Additional ambience and combat presentation candidates

Research checked on 2026-10-03. These are proposals, not adopted design decisions. This note covers extensions to existing presentation, with no balance changes, new projectile simulation, scenario triggers or map-layer work. Source inspection supports the mechanisms below; player benefits are design judgments, not measured results.

## Existing systems to preserve

- `client/audio.js:116-123` already attenuates and pans sounds from the camera; `:182-189` updates lasting sound positions. `:136-156` already limits simultaneous sounds and replaces quieter ones. Positional audio and basic voice limits are not new work.
- `client/battle-sound.js:13-29` already drives moving-vehicle engines and digging/building foley. `client/fx.js:721-750` already synchronizes gun sounds, muzzle effects and visible shot presentation; `:846-884` burns and smolders wrecks.
- `client/atmosphere.js:498-502,574-583` already animates circling birds. `:524-544` eases weather appearance and drifts cloud shade. `client/moods.js:18-27,46-52` defines lighting moods and weather treatments. `client/weather-view.js:55-74` already explains weather and warns about changes.
- `client/unit-models.js:217-226` already gives infantry suppression postures. `DESIGN.md:1731-1736` documents individual marching, aiming and fallen bodies. `DESIGN.md:792-799` rules out damage numbers, a kill feed and music in the current design.

## 1. Let the place and weather shape what the player hears

**Scope: medium.** Add environmental sound sources derived from the current map, plus weather sound beds. Water edges can carry a quiet river or shore loop; woods can occasionally play birds; rain can rise with the already public shower strength; exposed open ground can carry wind. Crossfade these sources as the camera moves. Keep emitters sparse and merge nearby cells into a few regions. This extends the single non-positional `ambient` loop in `client/audio.js:244-252`, using its existing camera placement and sound buses. `client/atmosphere.js:589-596` already receives rain strength and exposes current weather.

**Player benefit:** a river crossing, quiet woodland and rain-soaked road should feel different even before combat starts. Visible weather gains an audible counterpart.

**Verified source mechanism:** OpenRA's `AmbientSound` chooses among sound files, supports randomized delays and intervals, distinguishes actor-position sound from world sound, updates moving source positions and stops sounds when the trait disables or actor leaves. See [AmbientSound.cs:18-30](https://github.com/OpenRA/OpenRA/blob/7d57605bca2cbe963068d42505e00072afe19868/OpenRA.Mods.Common/Traits/Sound/AmbientSound.cs#L18-L30), [49-92](https://github.com/OpenRA/OpenRA/blob/7d57605bca2cbe963068d42505e00072afe19868/OpenRA.Mods.Common/Traits/Sound/AmbientSound.cs#L49-L92) and [97-108](https://github.com/OpenRA/OpenRA/blob/7d57605bca2cbe963068d42505e00072afe19868/OpenRA.Mods.Common/Traits/Sound/AmbientSound.cs#L97-L108), pinned to `7d57605bca2cbe963068d42505e00072afe19868`.

**Our extension:** deriving emitter regions from Three Crossroads terrain and blending public weather intensity. OpenRA's trait does not implement this terrain-driven setup.

**Acceptance scene:** pan from a quiet road to a river, rotate the camera, then watch a public rain shower arrive and end. River sound follows the correct side, rain fades with its visuals, and no loop survives returning to the lobby. Muting silences all layers. No enemy location or hidden terrain destruction contributes a sound source.

## 2. Show a vehicle's damage before it becomes a wreck

**Scope: medium.** Add restrained smoke from a living vehicle's engine position below a proposed 50% health threshold, with darker intermittent smoke below a proposed 25%. The thresholds are starting art-direction values, not balance changes. Fade emission when repairs raise health, stop it when the vehicle leaves visibility, and hand over to the existing wreck effect on death. Keep living damage smoke visibly thinner than the opaque white tactical smoke screen.

`client/main.js:775-799` already supplies visible-unit health and calculates its fraction. `client/fx.js:846-884` provides smoke and fire for destroyed vehicles, but its wreck emitter is a stationary death effect. `client/fx.js:986-1020` currently routes shot effects, fires, tactical smoke and movement dust without a persistent living-vehicle damage emitter.

**Player benefit:** battered armor becomes readable in the world while the player scans a crowded front. A repaired tank visibly recovers, and destruction has a clearer preceding state.

**Verified source mechanism:** OpenRA attaches an orientation-relative overlay within configured damage-state bounds and stops it outside those bounds. See [WithDamageOverlay.cs:33-59](https://github.com/OpenRA/OpenRA/blob/7d57605bca2cbe963068d42505e00072afe19868/OpenRA.Mods.Common/Traits/Render/WithDamageOverlay.cs#L33-L59) and [87-128](https://github.com/OpenRA/OpenRA/blob/7d57605bca2cbe963068d42505e00072afe19868/OpenRA.Mods.Common/Traits/Render/WithDamageOverlay.cs#L87-L128). BAR also samples live unit health and emits smoke below 65%, with a health-dependent sleep interval: [damagedsmoke.h:13-28](https://github.com/beyond-all-reason/Beyond-All-Reason/blob/f92aaf2545ec1a677b1e1bb801e614af20b59685/scripts/damagedsmoke.h#L13-L28), pinned to `f92aaf2545ec1a677b1e1bb801e614af20b59685`.

**Our extension:** the engine attachment points, proposed two-stage appearance, repair fade and distinction from tactical smoke. Neither source establishes our thresholds or art treatment. Smoke remains cosmetic and cannot block sight.

**Acceptance scene:** a tank takes damage, moves and turns while smoking, repairs above the threshold, then returns to combat and dies. Smoke follows its hull, clears after repair and does not double with wreck emission. Repeat with an enemy tank disappearing into fog and on Graphics Low. Health bars and unit badges remain readable.

## 3. Make quiet intervals and intense fighting sound different

**Scope: medium.** Add a client-only combat-intensity envelope derived from visible shot and blast events already being presented. Use it to reduce quiet-world bird calls during fighting, lower the environmental bed under nearby gunfire, and let the environment recover gradually after combat. During command speech or a critical alert, briefly lower ordinary effects and ambience, then restore them. This retains the existing recorded weapons and adds no music or invented distant combat.

`client/audio.js:70-74` has a master compressor and separate sound buses, but fixed bus gains. `:288-312` schedules speech and alert sounds without lowering other buses. `client/fx.js:986-1016` is an existing event seam for the activity meter. `client/battle-sound.js:13-29` currently handles engines and work foley rather than intensity. `DESIGN.md:799` explicitly specifies no music.

**Player benefit:** an attack should interrupt the quiet landscape, command cues should remain understandable during a barrage, and a ceasefire should provide audible relief.

**Verified source mechanism:** BAR accumulates a damage-driven war meter, caps individual contributions at maximum unit health, decays the meter and resets it after inactivity. Different thresholds control switches between peaceful and battle music, with different entry and exit conditions. See [gui_advplayerslist_music_new.lua:1675-1683](https://github.com/beyond-all-reason/Beyond-All-Reason/blob/f92aaf2545ec1a677b1e1bb801e614af20b59685/luaui/Widgets/gui_advplayerslist_music_new.lua#L1675-L1683), [1706-1715](https://github.com/beyond-all-reason/Beyond-All-Reason/blob/f92aaf2545ec1a677b1e1bb801e614af20b59685/luaui/Widgets/gui_advplayerslist_music_new.lua#L1706-L1715) and [1763-1774](https://github.com/beyond-all-reason/Beyond-All-Reason/blob/f92aaf2545ec1a677b1e1bb801e614af20b59685/luaui/Widgets/gui_advplayerslist_music_new.lua#L1763-L1774).

**Our extension:** apply that accumulating-and-decaying control mechanism to environmental balance instead of BAR's soundtrack, and add speech/alert ducking. Ducking is our proposal, not a claim about the cited BAR code. Use presented events rather than global damage so the mix cannot disclose hidden fighting. Keep the envelope bounded and use different rise and recovery rates to avoid rapid volume changes.

**Acceptance scene:** hold the camera beside an MG skirmish, add an artillery barrage, issue a retreat command and then stop firing. Environmental sound recedes, the voice and alert remain intelligible, and quiet returns smoothly. Pan to an unrelated quiet area and verify that unseen combat does not drive its mix. Repeated alerts cannot keep the world permanently quiet; master mute remains effective.

## Suggested order

Start with living-vehicle damage cues for the clearest visual improvement. Contextual environmental sound is the strongest ambience extension. Add combat-driven mixing after those sound layers exist, using a recorded comparison of quiet, skirmish, barrage and recovery scenes to tune it.
