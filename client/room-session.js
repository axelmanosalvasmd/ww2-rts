const safely = (fn) => { try { return fn(); } catch { return null; } };

export function roomAddress(hash, main = 'main') {
  const [code, ...suffix] = hash.replace(/^#/, '').split('&');
  const room = /^[a-z0-9]{3,12}$/.test(code.toLowerCase()) ? code.toLowerCase() : main;
  const requestedSeat = new URLSearchParams(suffix.join('&')).get('seat');
  const seat = /^[a-z0-9_-]{1,32}$/i.test(requestedSeat || '') ? requestedSeat : '';
  const part = (room === main ? '' : room) + (seat ? '&seat=' + seat : '');
  return { room, seat, hash: part ? '#' + part : '' };
}

export function roomToken({ room, seat = '', local, session, create }) {
  const key = 'ww2-token:' + room + (seat ? ':' + seat : '');
  const token = safely(() => local.getItem(key)) || safely(() => session.getItem(key)) || create();
  safely(() => local.setItem(key, token));
  safely(() => session.setItem(key, token));
  return token;
}

export function matchStorage(token, local, session) {
  const key = 'ww2-match:' + token;
  return {
    read() {
      const state = safely(() => JSON.parse(local.getItem(key))) || safely(() => JSON.parse(session.getItem(key)));
      if (!state || !Number.isSafeInteger(state.matchId) || !state.camera || !['x', 'z', 'yaw', 'dist'].every(k => Number.isFinite(state.camera[k]))) return null;
      const camera = Object.fromEntries(['x', 'z', 'yaw', 'dist'].map(k => [k, state.camera[k]]));
      if (Number.isFinite(state.camera.y)) camera.y = state.camera.y;
      const selected = Array.isArray(state.selected) ? state.selected.filter(Number.isSafeInteger) : [];
      const groups = Object.fromEntries(Object.entries(state.groups || {}).filter(([n, ids]) => /^[1-9]$/.test(n) && Array.isArray(ids)).map(([n, ids]) => [n, ids.filter(Number.isSafeInteger)]));
      return { matchId: state.matchId, camera, selected, groups };
    },
    write(state) {
      if (!Number.isSafeInteger(state?.matchId)) return;
      const data = JSON.stringify(state);
      safely(() => local.setItem(key, data));
      safely(() => session.setItem(key, data));
    },
    clear() {
      safely(() => local.removeItem(key));
      safely(() => session.removeItem(key));
    },
  };
}
