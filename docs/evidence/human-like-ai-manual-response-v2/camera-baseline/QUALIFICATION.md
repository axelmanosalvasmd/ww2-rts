# Latest public screen baseline

The preceding public screen means the latest actual perceive call, including a camera or selection refresh that reuses the same delivered observation tick. Keep both clocks: recordedTick identifies when the screen was read, and observationTick identifies the snapshot it used. The adapter replaces its baseline when the observation clock is equal or newer. The damage classifier still requires a strictly newer observation for a damage creation, exactly as before.

The native paid-camera witness completes one camera-minimap input at tick14, first reveals the actor at tick15 using snapshot14, then sees displayed30% damage at snapshot16. Native perception emits a damage creation. The old adapter wrongly keeps the off-camera screen as its baseline and reports unknown. The candidate records the visible actor at15 and classifies the same creation as required. Native event descriptors and the paid input are unchanged. Never revealing the actor and unchanged health are adjacent negatives.

This is an adapter completeness correction before the prospective campaign. It changes no creation threshold, exemption rule, timing band, native action or historical result. The original adapter, failing regression log, native reproduction and corrected regression log are retained. No broad campaign was run.
