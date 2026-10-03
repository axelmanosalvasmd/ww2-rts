// The directory does not open a game socket or load Three.js until a player joins.
const $ = id => document.getElementById(id);
const modes = { conquest: 'Conquest', assault: 'Assault', annihilation: 'Annihilation', classic: 'Classic', horde: 'Horde' };
// Old /#code links, including alternate seats, retain their exact meaning.
if (location.hash) location.replace('/play' + location.search + location.hash);
else {
  let rooms = [], loading = false, navigating = false;
  try { $('nickname').value = localStorage.getItem('ww2-name') || ''; } catch {}
  const notice = message => { $('notice').textContent = message; $('notice').hidden = !message; };
  const code = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), n => n.toString(16).padStart(2, '0')).join('');
  function enter(room, listing) {
    if (navigating) return;
    navigating = true;
    const name = $('nickname').value.trim().slice(0, 16) || 'Soldier';
    try { localStorage.setItem('ww2-name', name); } catch {}
    const query = new URLSearchParams({ name });
    if (listing) { query.set('public', String(listing.public)); query.set('title', listing.title); }
    if (listing?.tutorial) query.set('tutorial', '1');
    location.assign('/play?' + query + '#' + room);
  }
  function create() {
    enter(code(), { public: $('visibility').value === 'public', title: $('matchTitle').value.trim() || 'Open skirmish' });
  }
  function render() {
    const focusedCode = document.activeElement?.dataset.room;
    const rows = rooms.filter(r => (!$('modeFilter').value || r.mode === $('modeFilter').value) && (!$('openOnly').checked || r.joinable));
    const fragment = document.createDocumentFragment();
    for (const room of rows) {
      const row = document.createElement('tr');
      const cell = text => { const td = document.createElement('td'); td.textContent = text; row.append(td); return td; };
      const title = cell(room.title), map = document.createElement('small');
      map.textContent = room.map.replaceAll('-', ' ') + ' · ' + room.code; title.append(map);
      cell(modes[room.mode] || room.mode);
      const seats = cell(`${room.occupied}/${room.capacity}`), counts = document.createElement('small');
      counts.textContent = `${room.humans} human${room.humans === 1 ? '' : 's'}${room.ai ? ` · ${room.ai} AI` : ''}`; seats.append(counts);
      const status = cell(room.state === 'play' ? 'In progress' : room.joinable ? 'Open' : 'Full');
      if (room.joinable) status.className = 'open';
      const action = cell(''), button = document.createElement('button');
      button.textContent = 'Join'; button.disabled = !room.joinable; button.dataset.room = room.code;
      button.setAttribute('aria-label', 'Join ' + room.title);
      button.onclick = () => enter(room.code); action.append(button); fragment.append(row);
    }
    $('matches').replaceChildren(fragment);
    if (focusedCode) [...$('matches').querySelectorAll('button')].find(b => b.dataset.room === focusedCode)?.focus();
    $('empty').hidden = rows.length > 0;
    $('empty').textContent = rooms.length ? 'No matches fit these filters.' : 'No public matches yet. Create one and invite the first players.';
  }
  async function refresh() {
    if (loading) return false;
    loading = true; $('refresh').disabled = true;
    try {
      const response = await fetch('/api/rooms', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error('Directory unavailable');
      const data = await response.json();
      if (!Array.isArray(data.rooms)) throw new Error('Invalid directory');
      rooms = data.rooms; render();
      $('connection').textContent = `${rooms.length} public match${rooms.length === 1 ? '' : 'es'} · Live`;
      return true;
    } catch {
      rooms = []; $('matches').replaceChildren(); $('empty').hidden = false;
      $('empty').textContent = 'Cannot reach the match server. Retry with Refresh.';
      $('connection').textContent = 'Offline';
      return false;
    } finally { loading = false; $('refresh').disabled = false; }
  }
  $('createForm').onsubmit = e => { e.preventDefault(); create(); };
  $('joinForm').onsubmit = e => { e.preventDefault(); enter($('roomCode').value.trim().toLowerCase()); };
  $('modeFilter').onchange = render; $('openOnly').onchange = render;
  $('refresh').onclick = () => { notice(''); refresh(); };
  $('tutorial').onclick = () => enter(code(), { public: false, title: 'Tutorial', tutorial: true });
  $('quickPlay').onclick = async () => {
    $('quickPlay').disabled = true; notice('');
    try {
      if (!await refresh()) { notice('The directory is unavailable or still loading. Please try again.'); return; }
      const room = rooms.filter(r => r.joinable && r.mode === 'conquest').sort((a,b) => b.humans - a.humans || a.code.localeCompare(b.code))[0];
      if (room) enter(room.code);
      else enter(code(), { public: true, title: 'Open skirmish' });
    } finally { $('quickPlay').disabled = false; }
  };
  await refresh();
  setInterval(() => { if (!document.hidden && !navigating) refresh(); }, 5000);
}
