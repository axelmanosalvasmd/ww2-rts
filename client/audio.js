// Game sound: effects, the player's unit voices and alert sounds, under one volume control.
// This is the interface the HUD, alerts and effects code call; the audio slice fills it in with the ElevenLabs set.
// Every call is safe before anything has loaded (it just stays quiet).
export const audio = {
  volume: 1,              // 0..1, saved per browser; 0 is muted
  setVolume(v) { this.volume = Math.max(0, Math.min(1, v)); },
  listener(x, z, dist) {},  // camera focus point and zoom distance, once per frame, for distance falloff
  play(name, pos) {},       // a sound effect by name (see DESIGN.md, Look and feel); pos {x, z} or omitted for UI
  voice(kind) {},           // the player's faction voice: 'move' | 'attack' | 'retreat' | 'fire' | 'lost'
  alert(kind) {},           // 'attack' | 'pointWon' | 'pointLost' | 'unitLost' | 'air' | 'ready'
  ui(kind) {},              // 'click' | 'recruit' | 'error'
};
