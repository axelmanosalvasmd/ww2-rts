// Keyboard chords and the labels shown on command buttons. Safe to import in Node.
const binding = (id, code, label, help, context = 'global', modifiers = {}) =>
  ({ id, code, shift: false, ctrl: false, alt: false, context, label, help, ...modifiers });

export const bindings = [
  binding('stop', 'KeyX', 'X', 'Stop selected units'),
  binding('retreat', 'KeyR', 'R', 'Retreat selected units'),
  binding('ability', 'KeyF', 'F', 'Use the first ready selected ability'),
  binding('amove', 'KeyG', 'G', 'Aim an attack-move order'),
  binding('cover', 'KeyC', 'Shift+C', 'Selected infantry take cover', 'global', { shift: true }),
  binding('stance:holdFire', 'KeyF', 'Shift+F', 'Toggle hold fire', 'global', { shift: true }),
  binding('stance:holdPos', 'KeyG', 'Shift+G', 'Toggle hold position', 'global', { shift: true }),
  binding('stance:autoRetreat', 'KeyX', 'Shift+X', 'Toggle auto-retreat', 'global', { shift: true }),
  binding('mute', 'KeyM', 'M', 'Toggle audio'),
  binding('alert', 'Space', 'Space', 'Jump to the newest alert, or center the selection'),
  binding('follow', 'Space', 'Shift+Space', 'Follow the selection', 'global', { shift: true }),
  binding('rally', 'KeyH', 'Shift+H', 'Set the army rally point', 'global', { shift: true }),
  binding('home', 'KeyH', 'H', 'Go home and select the Classic HQ'),
  binding('clear', 'Escape', 'Esc', 'Clear the selection', 'army'),
  binding('clear', 'Escape', 'Esc', 'Clear the selection', 'classic'),
  binding('cancelAim', 'Escape', 'Esc', 'Cancel targeting', 'targeting'),
  binding('army', 'KeyA', 'Ctrl+A', 'Select the whole army', 'global', { ctrl: true }),
  binding('idle', 'Period', '.', 'Select and center the next idle ground unit'),
  binding('idleAll', 'Period', 'Shift+.', 'Select all idle ground units', 'global', { shift: true }),
  binding('idleEngineer', 'Comma', ',', 'Select and center the next idle Engineer'),
  ...Object.entries({ recon: 'Z', artillery: 'C', strafe: 'V', smoke: 'B', bombing: 'N', dive: 'U', para: 'P', cover: 'I' })
    .map(([kind, key]) => binding(`support:${kind}`, `Key${key}`, key, `Aim ${kind} support`)),
  ...Object.entries({ trench: 'T', sandbags: 'Y', wire: 'U', traps: 'I', nest: 'O' })
    .map(([kind, key]) => binding(`fort:${kind}`, `Key${key}`, kind === 'trench' ? key : `Shift+${key}`, `Place ${kind}`, 'global', { shift: kind !== 'trench' })),
  binding('entrench:line', 'KeyT', 'Shift+T', 'All selected builders dig a trench line', 'global', { shift: true }),
  ...Object.entries({ depot: 'J', barracks: 'K', motorpool: 'L', airfield: 'O', flakpos: 'Y' })
    .map(([kind, key]) => binding(`build:${kind}`, `Key${key}`, key, `Place a ${kind}`, 'classic')),
  ...Object.entries({ KeyW: 'W', ArrowUp: 'Up', KeyS: 'S', ArrowDown: 'Down', KeyA: 'A', ArrowLeft: 'Left', KeyD: 'D', ArrowRight: 'Right', KeyQ: 'Q', KeyE: 'E' })
    .map(([code, key]) => binding(code === 'KeyQ' ? 'rotateLeft' : code === 'KeyE' ? 'rotateRight' : ['KeyW', 'ArrowUp'].includes(code) ? 'panForward' : ['KeyS', 'ArrowDown'].includes(code) ? 'panBack' : ['KeyA', 'ArrowLeft'].includes(code) ? 'panLeft' : 'panRight', code, key, code === 'KeyQ' || code === 'KeyE' ? 'Rotate the camera' : 'Pan the camera')),
  ...Array.from({ length: 9 }, (_, i) => i + 1).flatMap((n) => [
    binding(`group:recall:${n}`, `Digit${n}`, `${n}`, `Recall group ${n}; tap twice to center`),
    binding(`group:set:${n}`, `Digit${n}`, `Ctrl+${n}`, `Set group ${n}`, 'global', { ctrl: true }),
    binding(`group:append:${n}`, `Digit${n}`, `Shift+${n}`, `Append selection to group ${n}`, 'global', { shift: true }),
    binding(`group:append:${n}`, `Digit${n}`, `Ctrl+Shift+${n}`, `Append selection to group ${n}`, 'global', { ctrl: true, shift: true }),
  ]),
];

export function match(event, context) {
  const active = new Set(typeof context === 'string' ? [context] : context);
  active.add('global');
  const ctrl = !!(event.ctrlKey || event.metaKey);
  const matches = (b) => active.has(b.context) && b.code === event.code &&
    b.shift === !!event.shiftKey && b.ctrl === ctrl && b.alt === !!event.altKey;
  // Targeting owns Escape while an aim is active; mode shortcuts still work.
  return (bindings.find((b) => b.context === 'targeting' && matches(b)) ?? bindings.find(matches))?.id;
}

export const label = (id) => bindings.find((b) => b.id === id)?.label ?? '';
export const badge = (id) => label(id).replace(/^Shift\+/, '\u21e7');
const labels = (prefix) => Object.fromEntries(bindings.filter((b) => b.id.startsWith(prefix)).map((b) => [b.id.slice(prefix.length), b.label]));
export const SUPPORT_KEYS = labels('support:');
export const FORT_KEYS = labels('fort:');
export const FORT_BADGES = Object.fromEntries(Object.keys(FORT_KEYS).map((kind) => [kind, badge(`fort:${kind}`)]));
export const BUILD_KEYS = labels('build:');
