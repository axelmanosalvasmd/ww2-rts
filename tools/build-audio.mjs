// Builds the game's sound files from the raw ElevenLabs takes (DESIGN.md, Look and feel: Audio).
// usage: node tools/build-audio.mjs [rawDir] [--report]
// Needs ffmpeg on the PATH. For every effect it takes the chosen take, trims silence at both ends (keeping a
// gunshot's attack), matches loudness within its category, and writes mono 96 kbps MP3 (the ambient loop stays
// stereo). Loops get their tail crossfaded into their head so they repeat without a seam. Voice lines (v2_ files) get
// the same treatment. Output: client/audio/sfx/<id>.mp3, client/audio/voice/<fac>/<voice>_<kind><n>_t<take>.mp3 and
// client/audio/index.json. --report only prints the measurements.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const REPORT = args.includes('--report');
const RAW = args.find(a => !a.startsWith('--')) ?? join(homedir(), '.local/share/ww2-rts/audio-raw/2026-10-01');
const OUT = join(ROOT, 'client/audio');
const SR = 44100;

// the chosen take per effect comes from the manifest; these two were regenerated louder
const OVERRIDE = { rifle: 'rifle2__4.mp3', mortar: 'mortar2__2.mp3' };
// loudness target per category in LUFS: the loudest 400 ms of an effect (momentary max), or the gated average of a
// loop or a voice line. Relative levels between sounds are set in client/audio.js; these keep each category even.
const CATEGORY = {
  weapon: { ids: ['rifle', 'smg', 'mg', 'sniper', 'atgun', 'tankgun', 'mortar', 'ricochet'], target: -14 },
  blast: { ids: ['whistle', 'blast_small', 'blast_large', 'bomb', 'rockets', 'collapse', 'vehicle_destroyed'], target: -13 },
  air: { ids: ['plane_flyby', 'strafe', 'bomber', 'flak'], target: -15 },
  foley: { ids: ['smoke', 'dig', 'build'], target: -18 },
  loop: { ids: ['tank_engine', 'fire_loop', 'ambient'], target: -20, average: true },
  ui: { ids: ['ui_click', 'ui_recruit', 'ui_error'], target: -20 },
  alert: { ids: ['alert_attack', 'alert_point_won', 'alert_point_lost', 'alert_unit_lost', 'alert_air', 'alert_ready', 'match_start'], target: -17 },
};
const VOICE_TARGET = -17;
const CROSSFADE = { tank_engine: 0.3, fire_loop: 0.5, ambient: 2 }; // seconds of tail blended into the head
const CEILING = 10 ** (-1 / 20); // sample peak after gain: -1 dBFS
const MAX_LIMIT = 9; // dB the limiter may take off the loudest peak

const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);

// a 30 Hz high-pass on the way in: some takes carry a DC offset (blast_small sits 0.2 off zero) that only eats headroom
function decode(file, channels) {
  const buf = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-af', 'highpass=f=30', '-f', 'f32le', '-ac', String(channels), '-ar', String(SR), '-'], { maxBuffer: 1 << 28 });
  const all = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
  // split interleaved samples into one array per channel
  return Array.from({ length: channels }, (_, c) => Float32Array.from({ length: all.length / channels }, (_, i) => all[i * channels + c]));
}

function encode(chans, file, kbps) {
  const n = chans[0].length, inter = new Float32Array(n * chans.length);
  for (let i = 0; i < n; i++) for (let c = 0; c < chans.length; c++) inter[i * chans.length + c] = chans[c][i];
  mkdirSync(dirname(file), { recursive: true });
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(SR), '-ac', String(chans.length), '-i', '-',
    '-c:a', 'libmp3lame', '-b:a', `${kbps}k`, '-map_metadata', '-1', '-id3v2_version', '0', file], { input: Buffer.from(inter.buffer) });
}

// BS.1770 K-weighting (high shelf + high pass) for any sample rate, as in pyloudnorm
function biquad(x, [b0, b1, b2, a0, a1, a2]) {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}
function kWeight(x) {
  let w = 2 * Math.PI * 1681.974450955533 / SR, A = 10 ** (3.999843853973347 / 40), al = Math.sin(w) / (2 * 0.7071752369554196), c = Math.cos(w), s = 2 * Math.sqrt(A) * al;
  const shelf = [A * ((A + 1) + (A - 1) * c + s), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - s), (A + 1) - (A - 1) * c + s, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - s];
  w = 2 * Math.PI * 38.13547087602444 / SR; al = Math.sin(w) / (2 * 0.5003270373238773); c = Math.cos(w);
  const hp = [(1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + al, -2 * c, 1 - al];
  return biquad(biquad(x, shelf), hp);
}
// mean square of the K-weighted signal in 400 ms blocks every 100 ms, summed over channels
function blocks(chans) {
  const k = chans.map(kWeight), len = Math.round(0.4 * SR), hop = Math.round(0.1 * SR), n = k[0].length, out = [];
  for (let s = 0; s === 0 || s + len <= n; s += hop) {
    let sum = 0;
    for (const ch of k) for (let i = s; i < Math.min(n, s + len); i++) sum += ch[i] * ch[i];
    out.push(sum / Math.min(len, n - s));
    if (s + len >= n) break;
  }
  return out;
}
const lufs = (ms) => -0.691 + 10 * Math.log10(ms);
function loudness(chans) {
  const b = blocks(chans), max = lufs(Math.max(...b));
  // gated average: absolute gate -70 LUFS, then relative gate 10 LU under the ungated mean
  const abs = b.filter(m => lufs(m) > -70), mean = abs.reduce((a, m) => a + m, 0) / (abs.length || 1);
  const rel = abs.filter(m => lufs(m) > lufs(mean) - 10);
  return { max, avg: rel.length ? lufs(rel.reduce((a, m) => a + m, 0) / rel.length) : -Infinity };
}
const peakOf = (chans) => Math.max(...chans.map(ch => ch.reduce((a, v) => Math.max(a, Math.abs(v)), 0)));

// first sample whose level crosses `thr` (peak), minus a few ms so the attack stays whole
function leadTrim(chans, thrDb, preroll) {
  const thr = 10 ** (thrDb / 20), n = chans[0].length;
  for (let i = 0; i < n; i++) if (chans.some(ch => Math.abs(ch[i]) > thr)) return Math.max(0, i - Math.round(preroll * SR));
  return 0;
}
// last 10 ms window whose RMS is above `thrDb`, plus a little room for the fade
function tailEnd(chans, thrDb, room) {
  const thr = 10 ** (thrDb / 20), w = Math.round(0.01 * SR), n = chans[0].length;
  for (let e = n; e - w > 0; e -= w) {
    let sum = 0;
    for (const ch of chans) for (let i = e - w; i < e; i++) sum += ch[i] * ch[i];
    if (Math.sqrt(sum / (w * chans.length)) > thr) return Math.min(n, e + Math.round(room * SR));
  }
  return n;
}
function fades(chans, inSec, outSec) {
  const n = chans[0].length, fi = Math.round(inSec * SR), fo = Math.min(n, Math.round(outSec * SR));
  for (const ch of chans) {
    for (let i = 0; i < fi; i++) ch[i] *= i / fi;
    for (let i = 0; i < fo; i++) ch[n - 1 - i] *= i / fo;
  }
}
// blend the last `sec` seconds into the first ones (equal power), so sample n-1 runs straight into sample 0
function seamless(chans, sec) {
  const x = Math.round(sec * SR), n = chans[0].length;
  return chans.map(ch => {
    const out = ch.slice(0, n - x);
    for (let i = 0; i < x; i++) { const t = (i + 0.5) / x; out[i] = ch[i] * Math.sin(t * Math.PI / 2) + ch[n - x + i] * Math.cos(t * Math.PI / 2); }
    return out;
  });
}
const scale = (chans, g) => chans.map(ch => ch.map(v => v * g));
// Lookahead peak limiter: the gain at each sample is already low enough for any peak in the next 1.5 ms, recovers
// with a 60 ms time constant, and is averaged over the lookahead window so it never steps. Lets peaky sounds (a
// grenade's crack, fire crackle) reach their loudness target without clipping.
function limit(chans) {
  const n = chans[0].length, L = Math.round(0.0015 * SR), rel = 1 - Math.exp(-1 / (0.06 * SR));
  const need = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let p = 0;
    for (const ch of chans) p = Math.max(p, Math.abs(ch[i]));
    need[i] = p > CEILING ? CEILING / p : 1;
  }
  const g = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = 1;
    for (let j = i; j <= Math.min(n - 1, i + L); j++) m = Math.min(m, need[j]);
    g[i] = m;
  }
  for (let i = 1; i < n; i++) g[i] = Math.min(g[i], g[i - 1] + (1 - g[i - 1]) * rel);
  // moving average of g[i-L..i]; before the start it counts as g[0], which already covers the first peaks
  const s = new Float32Array(n);
  let sum = L * g[0];
  for (let i = 0; i < n; i++) {
    sum += g[i];
    s[i] = sum / (L + 1);
    sum -= i - L >= 0 ? g[i - L] : g[0];
  }
  return chans.map(ch => ch.map((v, i) => v * s[i]));
}

// a loop is limited as if it were already repeating: 200 ms of its tail before it and of its head after it, so the
// limiter's gain at the last sample runs on into the gain at the first
function limitLoop(chans) {
  const n = chans[0].length, x = Math.min(n, Math.round(0.2 * SR));
  const wrapped = chans.map(ch => { const w = new Float32Array(n + 2 * x); w.set(ch.subarray(n - x), 0); w.set(ch, x); w.set(ch.subarray(0, x), n + x); return w; });
  return limit(wrapped).map(ch => ch.slice(x, x + n));
}

// one effect or voice line: trim, level, encode; returns what the index and the report need
function build(src, dst, { loop, xf, stereo, target, average, voice }) {
  let chans = decode(src, stereo ? 2 : 1);
  const rawDur = chans[0].length / SR;
  let lead = 0;
  if (loop) chans = seamless(chans, xf);
  else {
    // voices: soft consonants start low, so a lower threshold and more pre-roll than for gunshots
    lead = leadTrim(chans, voice ? -45 : -50, voice ? 0.03 : 0.002);
    const end = tailEnd(chans, voice ? -50 : -60, voice ? 0.06 : 0.03);
    chans = chans.map(ch => ch.slice(lead, Math.max(lead + 1, end)));
    fades(chans, voice ? 0.005 : 0, voice ? 0.04 : 0.03);
  }
  const level = (c) => { const l = loudness(c); return average ? l.avg : l.max; };
  const measured = level(chans), peak = peakOf(chans);
  // match the category's loudness; peaks above the ceiling go through the limiter, which may take off at most
  // MAX_LIMIT dB. Limiting lowers the loudness, so the gain is corrected over a few passes.
  const most = (CEILING / peak) * 10 ** (MAX_LIMIT / 20);
  let gain = Math.min(10 ** ((target - measured) / 20), most), out;
  for (let pass = 0; pass < 4; pass++) {
    out = scale(chans, gain);
    if (peak * gain > CEILING) out = loop ? limitLoop(out) : limit(out);
    if (pass < 3) gain = Math.min(gain * 10 ** ((target - level(out)) / 20), most);
  }
  const after = level(out);
  const info = { src: src.split('/').pop(), rawDur: +rawDur.toFixed(2), dur: +(out[0].length / SR).toFixed(3), lead: +(lead / SR).toFixed(3),
    lufs: +measured.toFixed(1), peakDb: +db(peak).toFixed(1), gainDb: +db(gain).toFixed(1), limitDb: +Math.max(0, db(peak * gain / CEILING)).toFixed(1),
    final: +after.toFixed(1), shortDb: +(target - after).toFixed(1) };
  if (!REPORT) encode(out, dst, 96);
  return info;
}

const manifest = JSON.parse(readFileSync(join(RAW, 'sfx_manifest.json'), 'utf8'));
const catOf = (id) => Object.entries(CATEGORY).find(([, c]) => c.ids.includes(id));
const index = { sfx: {}, voice: {} };
if (!REPORT) rmSync(OUT, { recursive: true, force: true });
const rows = [];
for (const e of manifest) {
  if (/2$/.test(e.id)) continue; // rifle2 / mortar2 are the regenerations, used through OVERRIDE
  const [cat, c] = catOf(e.id) ?? [];
  if (!c) throw new Error(`no category for ${e.id}`);
  const src = join(RAW, OVERRIDE[e.id] ?? `${e.id}__${e.chosen}.mp3`);
  const info = build(src, join(OUT, 'sfx', `${e.id}.mp3`), { loop: e.loop, xf: CROSSFADE[e.id], stereo: e.id === 'ambient', target: c.target, average: c.average });
  // what the limiter could not reach is left to the player: the client adds it back as gain (its master bus limits)
  index.sfx[e.id] = { dur: info.dur, ...(e.loop ? { loop: true } : {}), ...(info.shortDb >= 1 ? { boost: Math.round(info.shortDb) } : {}) };
  rows.push({ id: e.id, cat, ...info });
}

// voices: v2_<fac>_<voice>_<kind><n>_t<take>.mp3, both takes shipped as variations of the line
for (const f of readdirSync(RAW).filter(f => /^v2_.*\.mp3$/.test(f)).sort()) {
  const [, fac, name, kind, n, take] = /^v2_([a-z]+)_([a-z]+)_([a-z]+)(\d+)_t(\d+)\.mp3$/.exec(f);
  const rel = `${name}_${kind}${n}_t${take}.mp3`;
  const info = build(join(RAW, f), join(OUT, 'voice', fac, rel), { target: VOICE_TARGET, average: true, voice: true });
  const lines = ((index.voice[fac] ??= {})[name] ??= {})[kind] ??= [];
  (lines[n - 1] ??= []).push(rel);
  rows.push({ id: `${fac}/${rel}`, cat: 'voice', ...info });
}

console.table(rows.map(r => ({ id: r.id, cat: r.cat, src: r.src, raw: r.rawDur, dur: r.dur, lead: r.lead, lufs: r.lufs, peak: r.peakDb, gain: r.gainDb, limit: r.limitDb, final: r.final, short: r.shortDb })));
if (!REPORT) {
  writeFileSync(join(OUT, 'index.json'), JSON.stringify(index));
  const size = (d) => readdirSync(d, { withFileTypes: true }).reduce((a, f) => a + (f.isDirectory() ? size(join(d, f.name)) : statSync(join(d, f.name)).size), 0);
  console.log(`wrote ${Object.keys(index.sfx).length} effects and ${rows.length - Object.keys(index.sfx).length} voice files, ${(size(OUT) / 1048576).toFixed(2)} MB`);
}
