// Game sound: effects, the player's unit voices and alert sounds, under one volume control.
// This is the interface the HUD, alerts and effects code call. The files are built by tools/build-audio.mjs into
// client/audio/ (index.json lists them) and load when a match starts, not in the lobby.
// Every call is safe before anything has loaded (it just stays quiet).
const DIR = new URL('./audio/', import.meta.url);
// voice folders by faction index (USA, Germany, USSR, UK); a faction with no voices yet (the UK) speaks American
const FACS = ['us', 'de', 'ru', 'uk'];
const voiceFac = (f) => (index.voice[FACS[f]] ? FACS[f] : 'us');
const KEY = 'ww2-volume';
const store = (fn) => { try { return fn(); } catch { return null; } };

// Mix per effect: gain (the files are already loudness-matched per category), range in meters where it fades out,
// how many may play at once, the shortest gap between two starts, and how much pitch and volume vary per play.
const MIX = {
  rifle: { gain: 0.42, range: 120, max: 6, gap: 0.04, pitch: 0.08 },
  smg: { gain: 0.42, range: 120, max: 4, gap: 0.06, pitch: 0.06 },
  mg: { gain: 0.42, range: 130, max: 3, gap: 0.15, pitch: 0.05 },
  sniper: { gain: 0.65, range: 180, max: 2, pitch: 0.04 },
  atgun: { gain: 0.75, range: 180, max: 3, pitch: 0.06 },
  tankgun: { gain: 0.8, range: 200, max: 4, pitch: 0.07 },
  mortar: { gain: 0.6, range: 160, max: 3, pitch: 0.08 },
  whistle: { gain: 0.4, range: 140, max: 3, pitch: 0.06 },
  blast_small: { gain: 0.6, range: 170, max: 5, gap: 0.05, pitch: 0.12 },
  blast_large: { gain: 0.85, range: 220, max: 4, gap: 0.08, pitch: 0.1 },
  bomb: { gain: 1, range: 260, max: 4, gap: 0.1, pitch: 0.08 },
  rockets: { gain: 0.8, range: 200, max: 2, pitch: 0.05 },
  plane_flyby: { gain: 0.75, range: 300, max: 2, pitch: 0.05 },
  strafe: { gain: 0.75, range: 220, max: 2, pitch: 0.04 },
  bomber: { gain: 0.8, range: 320, max: 1, pitch: 0.03 },
  flak: { gain: 0.55, range: 200, max: 2, pitch: 0.08 },
  collapse: { gain: 0.8, range: 200, max: 2, gap: 0.3, pitch: 0.08 },
  smoke: { gain: 0.45, range: 140, max: 3, gap: 0.1, pitch: 0.1 },
  dig: { gain: 0.35, range: 70, max: 2, gap: 0.5, pitch: 0.1 },
  build: { gain: 0.35, range: 70, max: 2, gap: 0.5, pitch: 0.08 },
  vehicle_destroyed: { gain: 1, range: 220, max: 2, gap: 0.2, pitch: 0.06 },
  ricochet: { gain: 0.3, range: 90, max: 2, gap: 0.2, pitch: 0.15 },
  fire_loop: { gain: 0.45, range: 90, max: 3 },
  tank_engine: { gain: 0.5, range: 110 },
  ambient: { gain: 0.3 },
  match_start: { gain: 0.8 },
};
const UI = { click: { gain: 0.45, gap: 0.05 }, recruit: { gain: 0.5, gap: 0.1 }, error: { gain: 0.5, gap: 0.3 } };
// alerts: the sound, how long before the same alert may sound again, and a voice line that follows it
const ALERTS = {
  attack: { name: 'alert_attack', gap: 6, voice: 'fire' },
  pointWon: { name: 'alert_point_won', gap: 1 },
  pointLost: { name: 'alert_point_lost', gap: 1 },
  unitLost: { name: 'alert_unit_lost', gap: 4, voice: 'lost' },
  air: { name: 'alert_air', gap: 4 },
  ready: { name: 'alert_ready', gap: 1.5 },
  event: { name: 'alert_air', gap: 1 }, // a map's scripted event (trigger)
};
const MAX_PLAYING = 32, VOICE_GAP = 2.5;

let ctx = null, master, comp, buses, index = null, loading = null, started = false, match = 0;
let player = { faction: 0, slot: 0 }, voiceName = null;
const buffers = new Map(), playing = [], lastStart = new Map(), lastAlert = new Map(), lastLine = new Map();
let ear = { x: 0, z: 0, dist: 85, yaw: 0 }, earAt = 0, voiceUntil = 0, mutedFrom = 0.8, slider = null;
const beds = new Map(); // loops driven by a set of positions (tank engines): name -> { src, gain, pan }

const now = () => ctx.currentTime;
const rnd = (a) => 1 + (Math.random() * 2 - 1) * a;

function ensureContext() {
  if (ctx) return;
  ctx = new AudioContext();
  // a gentle limiter on the master so a bombing run under gunfire never clips
  comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -10; comp.knee.value = 6; comp.ratio.value = 8; comp.attack.value = 0.003; comp.release.value = 0.25;
  master = ctx.createGain(); master.gain.value = curve(audio.volume);
  master.connect(comp).connect(ctx.destination);
  buses = Object.fromEntries(['sfx', 'amb', 'voice', 'ui'].map(k => { const g = ctx.createGain(); g.connect(master); return [k, g]; }));
  buses.voice.gain.value = 1.2;
  // browsers start audio suspended until the player clicks or presses a key
  const wake = () => { if (ctx.state === 'suspended') ctx.resume(); };
  addEventListener('pointerdown', wake); addEventListener('keydown', wake);
  wake();
}
const curve = (v) => v * v; // the slider feels even when gain follows its square

async function load(file) {
  const res = await fetch(new URL(file, DIR));
  if (!res.ok) throw new Error(`${file}: ${res.status}`);
  return ctx.decodeAudioData(await res.arrayBuffer());
}
// fetch and decode a list of [key, file] a few at a time
async function loadAll(list) {
  let i = 0;
  const worker = async () => {
    while (i < list.length) {
      const [key, file, dur] = list[i++];
      try {
        const b = await load(file);
        buffers.set(key, b);
        if (dur) b.loopFrom = loopStartOf(b, dur);
      } catch (e) { console.warn('audio:', e.message); }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
}
// some browsers keep the MP3 encoder's lead-in silence; a loop then has to skip it to stay seamless
function loopStartOf(b, dur) {
  if (b.duration - dur < 0.01) return 0;
  const d = b.getChannelData(0);
  let i = 0;
  while (i < d.length && Math.abs(d[i]) < 1e-4) i++;
  return i / b.sampleRate;
}

function voiceFiles(fac, name) {
  const lines = index.voice[fac]?.[name] ?? {};
  return Object.values(lines).flat(2).map(f => [`voice:${f}`, `voice/${fac}/${f}`]);
}

// distance falloff from the camera's focus point, quieter as the camera pulls back; and left/right from its yaw
function place(pos, range) {
  if (!pos) return { gain: 1, pan: 0 };
  const dx = pos.x - ear.x, dz = pos.z - ear.z, d = Math.hypot(dx, dz);
  const zoom = 1 - 0.35 * Math.min(1, Math.max(0, (ear.dist - 25) / 125));
  const gain = Math.max(0, 1 - d / range) ** 1.6 * zoom;
  const side = dx * Math.cos(ear.yaw) - dz * Math.sin(ear.yaw); // along the camera's right vector
  return { gain, pan: Math.max(-1, Math.min(1, side / (d + 25))) * 0.8 };
}

function stop(p, fade = 0.05) {
  if (p.done) return;
  p.done = true;
  const t = now();
  p.gain.gain.cancelScheduledValues(t);
  p.gain.gain.setValueAtTime(p.gain.gain.value, t);
  p.gain.gain.linearRampToValueAtTime(0, t + fade);
  try { p.src.stop(t + fade + 0.01); } catch { /* not started yet */ }
}

function launch(key, { bus = 'sfx', pos, mix = {}, gain = 1, rate = 1, delay = 0, offset = 0, dur, name = key }) {
  const buf = buffers.get(key);
  // a suspended context (no click yet) would save every sound up and play them all at once later
  if (!ctx || !buf || !started || ctx.state !== 'running') return null;
  const t = now(), t0 = t + delay;
  if (mix.gap && Math.abs(t0 - (lastStart.get(name) ?? -9)) < mix.gap) return null;
  // what the build's limiter could not reach comes back here, at most 6 dB (the master compressor catches the peaks)
  const boost = Math.min(6, index.sfx[name]?.boost ?? 0);
  const at = place(pos, mix.range ?? 150), level = gain * (mix.gain ?? 1) * at.gain * 10 ** (boost / 20);
  if (level < 0.005) return null;
  // too many of this sound: replace the quietest one if the new one is louder, else skip it
  const live = playing.filter(p => !p.done), same = live.filter(p => p.name === name);
  if (mix.max && same.length >= mix.max) {
    const quiet = same.reduce((a, p) => (p.level < a.level ? p : a));
    if (quiet.level >= level) return null;
    stop(quiet);
  }
  if (live.length >= MAX_PLAYING) {
    const quiet = live.reduce((a, p) => (p.level < a.level ? p : a));
    if (quiet.level >= level) return null;
    stop(quiet, 0.02);
  }
  const src = ctx.createBufferSource(), g = ctx.createGain(), pan = ctx.createStereoPanner();
  src.buffer = buf; src.playbackRate.value = rate * rnd(mix.pitch ?? 0);
  const v = level * rnd(mix.vol ?? 0.15);
  g.gain.value = v; pan.pan.value = at.pan;
  if (dur) {
    // a loop that plays for a while (a burning wreck): its own fade in and out, ahead of the distance gain
    const env = ctx.createGain(), end = Math.max(0.7, dur);
    src.loop = true; src.loopStart = buf.loopFrom ?? 0; src.loopEnd = buf.duration;
    env.gain.setValueAtTime(0, t0); env.gain.linearRampToValueAtTime(1, t0 + 0.6);
    env.gain.setValueAtTime(1, t0 + Math.max(0.6, end - 1.5)); env.gain.linearRampToValueAtTime(0, t0 + end);
    src.connect(env).connect(g);
    src.start(t0, buf.loopFrom ?? 0); src.stop(t0 + end + 0.05);
  } else {
    src.connect(g);
    src.start(t0, Math.min(offset, buf.duration - 0.05));
  }
  g.connect(pan).connect(buses[bus]);
  const p = { name, src, gain: g, pan, pos, mix, level: v, base: v / Math.max(at.gain, 1e-3) };
  playing.push(p);
  lastStart.set(name, t0);
  src.onended = () => { p.done = true; const i = playing.indexOf(p); if (i >= 0) playing.splice(i, 1); };
  return p;
}

// sounds that last (fires, planes, the bomber) follow the camera as it moves
function refresh() {
  for (const p of playing) {
    if (p.done || !p.pos) continue;
    const at = place(p.pos, p.mix.range ?? 150);
    p.gain.gain.setTargetAtTime(p.base * at.gain, now(), 0.08);
    p.pan.pan.setTargetAtTime(at.pan, now(), 0.08);
  }
}

// the saved volume; a browser that had muted the old voice button starts muted
const saved = parseFloat(store(() => localStorage.getItem(KEY)));
const firstVolume = Number.isFinite(saved) ? Math.max(0, Math.min(1, saved)) : store(() => localStorage.getItem('ww2-muted')) === '1' ? 0 : 0.8;

export const audio = {
  volume: firstVolume,
  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, +v || 0));
    if (this.volume > 0) mutedFrom = this.volume;
    store(() => localStorage.setItem(KEY, String(this.volume)));
    if (master) master.gain.setTargetAtTime(curve(this.volume), now(), 0.03);
    if (slider) slider.value = Math.round(this.volume * 100);
  },
  // M key: mute, or back to the volume before muting
  toggleMute() { this.setVolume(this.volume > 0 ? 0 : mutedFrom || 0.8); },
  // a range input (0-100) that shows and sets the volume
  bind(input) {
    slider = input;
    input.value = Math.round(this.volume * 100);
    input.addEventListener('input', () => this.setVolume(input.value / 100));
    input.addEventListener('change', () => input.blur()); // hotkeys skip a focused input; hand them back
    this.setVolume(this.volume); // remember the starting volume as the one M unmutes to
  },

  // match start: load the files (once), pick this player's voice, start the ambience
  start({ faction = 0, slot = 0 } = {}) {
    ensureContext();
    player = { faction, slot };
    this.end();
    started = true;
    const t0 = performance.now(), mine = ++match; // a restart before loading finishes must not start a second ambience
    loading ??= fetch(new URL('index.json', DIR)).then(r => r.json()).then(async (ix) => {
      index = ix;
      await loadAll(Object.entries(ix.sfx).map(([id, s]) => [id, `sfx/${id}.mp3`, s.loop ? s.dur : 0]));
    }).catch(e => { console.warn('audio: index', e.message); loading = null; }); // the next match tries again
    loading.then(async () => {
      if (!index || mine !== match) return;
      const fac = voiceFac(faction), names = Object.keys(index.voice[fac] ?? {}).sort();
      voiceName = names.length ? names[slot % names.length] : null;
      if (voiceName) await loadAll(voiceFiles(fac, voiceName).filter(([k]) => !buffers.has(k)));
      if (mine !== match) return;
      this.ambience();
      if (performance.now() - t0 < 4000) this.play('match_start', null, { bus: 'ui' });
    });
  },
  // back to the lobby: everything fades out
  end() {
    started = false; match++;
    for (const p of playing) stop(p, 0.4);
    for (const b of beds.values()) stop(b, 0.4);
    beds.clear();
  },
  ambience() {
    const buf = buffers.get('ambient');
    if (!buf) return;
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = buf; src.loop = true; src.loopStart = buf.loopFrom ?? 0; src.loopEnd = buf.duration;
    g.gain.setValueAtTime(0, now()); g.gain.linearRampToValueAtTime(MIX.ambient.gain, now() + 4);
    src.connect(g).connect(buses.amb);
    src.start(now(), Math.random() * buf.duration);
    beds.set('ambient', { src, gain: g, name: 'ambient' });
  },

  // camera focus point, zoom distance and yaw, once per frame
  listener(x, z, dist = 85, yaw = 0) {
    ear = { x, z, dist, yaw };
    if (ctx && performance.now() - earAt > 100) { earAt = performance.now(); refresh(); }
  },
  // an effect by name; pos {x, z} or omitted for UI. opts: gain, rate, delay and offset (seconds), dur (loops only)
  play(name, pos, opts = {}) {
    if (!ctx || !started) return null;
    return launch(name, { pos, mix: MIX[name] ?? {}, name, bus: opts.bus ?? (pos ? 'sfx' : 'ui'), ...opts });
  },
  // a loop that swells with how many of its sources are near: tank engines
  bed(name, points) {
    if (!ctx || !started || ctx.state !== 'running') return;
    const buf = buffers.get(name), mix = MIX[name] ?? {};
    if (!buf) return;
    let sum = 0, side = 0;
    for (const p of points) { const at = place(p, mix.range ?? 120); sum += at.gain; side += at.gain * at.pan; }
    const level = Math.min(1, Math.sqrt(sum)) * (mix.gain ?? 1);
    let b = beds.get(name);
    if (!b && level > 0.01) {
      const src = ctx.createBufferSource(), g = ctx.createGain(), pan = ctx.createStereoPanner();
      src.buffer = buf; src.loop = true; src.loopStart = buf.loopFrom ?? 0; src.loopEnd = buf.duration;
      g.gain.value = 0;
      src.connect(g).connect(pan).connect(buses.sfx);
      src.start(now(), Math.random() * buf.duration);
      beds.set(name, b = { src, gain: g, pan, name });
    }
    if (!b) return;
    b.gain.gain.setTargetAtTime(level, now(), 0.25);
    b.pan.pan.setTargetAtTime(sum ? side / sum : 0, now(), 0.25);
    b.src.playbackRate.setTargetAtTime(0.92 + 0.12 * Math.min(1, sum), now(), 0.5);
  },

  // the player's faction voice: 'move' | 'attack' | 'retreat' | 'fire' | 'lost'; one line at a time, 2.5 s apart
  voice(kind) {
    if (!ctx || !started || !voiceName || !index) return;
    const t = now();
    if (t < voiceUntil || t - (lastLine.get('any') ?? -9) < VOICE_GAP) return;
    const lines = index.voice[voiceFac(player.faction)]?.[voiceName]?.[kind];
    if (!lines?.length) return;
    // a different line than last time when there is a choice, and either take of it
    let n = Math.floor(Math.random() * lines.length);
    if (lines.length > 1 && n === lastLine.get(kind)) n = (n + 1) % lines.length;
    const takes = lines[n], file = takes[Math.floor(Math.random() * takes.length)];
    const p = launch(`voice:${file}`, { bus: 'voice', name: 'voice', mix: { gain: 1, vol: 0.05 } });
    if (!p) return;
    lastLine.set(kind, n); lastLine.set('any', t);
    voiceUntil = t + p.src.buffer.duration;
  },
  // 'attack' | 'pointWon' | 'pointLost' | 'unitLost' | 'air' | 'ready'
  alert(kind) {
    const a = ALERTS[kind];
    if (!a || !ctx || !started || ctx.state !== 'running') return;
    const t = now();
    if (t - (lastAlert.get(kind) ?? -99) < a.gap) return;
    lastAlert.set(kind, t);
    launch(a.name, { bus: 'ui', name: a.name, mix: { gain: 0.7 } });
    if (a.voice) setTimeout(() => audio.voice(a.voice), 600);
  },
  // seconds a loaded effect lasts (0 until it has loaded)
  length(name) { return buffers.get(name)?.duration ?? 0; },
  // for checks from devtools and the headless tests
  stats() { return { state: ctx?.state ?? 'none', loaded: buffers.size, playing: playing.filter(p => !p.done).length, beds: [...beds.keys()], voice: voiceName, volume: this.volume }; },
  // 'click' | 'recruit' | 'error'
  ui(kind) {
    const u = UI[kind] ?? UI.click;
    launch(`ui_${UI[kind] ? kind : 'click'}`, { bus: 'ui', mix: u });
  },
};
