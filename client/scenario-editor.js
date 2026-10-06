import { UNITS } from '/shared/sim.js';
import { t as tr } from './i18n.js';
import { formatWorldAuthoringError } from './world-authoring-error.js';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
const options = (values, current) => values.map(([value, label, translate = true]) => {
  const text = translate && label !== value ? tr(label) : label;
  // Native option labels keep authored IDs intact when the page observer translates surrounding text.
  return `<option value="${esc(value)}" label="${esc(text)}" ${value === current ? 'selected' : ''}>${esc(text)}</option>`;
}).join('');
const field = (name, value, type = 'text', extra = '') => `<label>${esc(tr(name))}<input data-field="${extra || name}" type="${type}" value="${esc(value)}"></label>`;
const select = (name, value, values, path = name) => `<label>${esc(tr(name))}<select data-field="${path}">${options(values, value)}</select></label>`;
const pickButton = (path, label) => `<button type="button" data-pick="${path}">${esc(tr(label))}</button>`;
const refs = (items) => items.map((item) => [item.id, item.id]);
const recipientOptions = [['public', 'Everyone'], ['side', 'One side'], ['team', 'One team']];
const sideOptions = [['', 'Any side'], ['0', 'Side 1'], ['1', 'Side 2'], ['2', 'Side 3'], ['3', 'Side 4'], ['4', 'Side 5'], ['5', 'Side 6']];
const conditionKinds = [['time', 'Time reached'], ['ownership', 'Point owned'], ['capture', 'Point captured'], ['unitLost', 'Unit lost'], ['groupLost', 'Group lost'], ['groupCount', 'Group count'], ['areaEntry', 'Area entered'], ['objectiveComplete', 'Objective complete'], ['triggerComplete', 'Trigger complete'], ['all', 'All conditions'], ['any', 'Any condition']];
const actionKinds = [['say', 'Show message'], ['objectiveActivate', 'Activate objective'], ['objectiveComplete', 'Complete objective'], ['reinforce', 'Send reinforcements'], ['damage', 'Damage area'], ['destroy', 'Destroy area']];
const unitTypes = Object.keys(UNITS).filter((type) => !UNITS[type].structure && !UNITS[type].building && !UNITS[type].air).map((type) => [type, UNITS[type].name || type]);
const fresh = () => ({ version: 1, areas: [], groups: [], objectives: [], triggers: [] });
const idFor = (items, stem) => { let i = 1; while (items.some((v) => v.id === `${stem}-${i}`)) i++; return `${stem}-${i}`; };
const number = (value) => value === '' ? undefined : Number(value);
const byId = (items, id) => items.find((item) => item.id === id);
const safeList = (value) => Array.isArray(value) ? value : [];

export function createScenarioEditor({ host, getMap, onChange }) {
  let category = 'triggers', selected = '', pick = null, boxStart = null;
  const scenario = () => getMap()?.scenario;
  const ensure = () => {
    const value = getMap().scenario ??= fresh();
    for (const key of ['areas', 'groups', 'objectives', 'triggers']) value[key] ??= [];
    return value;
  };
  const list = () => safeList(scenario()?.[category]);
  const item = () => byId(list(), selected);
  const unitId = () => {
    const used = new Set(safeList(scenario()?.groups).flatMap((group) => safeList(group.units).map((unit) => unit.id)));
    let index = 1;
    while (used.has(`unit-${index}`)) index++;
    return `unit-${index}`;
  };
  const pointRefs = () => [
    ...getMap().points.map((point, i) => [point.id || `point:${i}`, `${tr(`Point ${i + 1}`)}${point.id ? ` (${point.id})` : ''}`, false]),
    ...safeList(getMap().world?.regions).map((region) => [`region:${region.id}`, tr(`Region ${region.id}`), false]),
  ];
  const refSelect = (label, value, choices, path) => select(label, value, [['', 'Choose...'], ...choices], path);
  const sideField = (value, path = 'side') => select('Side', value === undefined ? '' : String(value), sideOptions, path);
  const recipients = (value, path = 'recipients') => select('Recipients', value || 'public', recipientOptions, path);
  const boxLine = (box, path) => `<div class="row"><span>${esc(box?.join(', ') || tr('No area selected'))}</span>${pickButton(path, 'Pick two corners')}</div>`;
  const cellLine = (at, path, label = 'Location') => `<div class="row"><span>${esc(tr(label))}: ${esc(at?.join(', ') || tr('Not selected'))}</span>${pickButton(path, 'Pick on map')}</div>`;

  function conditionFields(condition) {
    const c = condition || { kind: 'time', seconds: 30 };
    let detail = '';
    switch (c.kind) {
      case 'time': detail = field('Seconds', c.seconds ?? 30, 'number', 'condition.seconds'); break;
      case 'ownership': case 'capture':
        detail = refSelect('Point', c.target, pointRefs(), 'condition.target') + sideField(c.side, 'condition.side') + pickButton('condition.target', 'Pick point on map'); break;
      case 'unitLost': detail = refSelect('Unit', c.unit, safeList(scenario()?.groups).flatMap((g) => safeList(g.units).map((u) => [u.id, `${g.id}: ${u.id}`])), 'condition.unit'); break;
      case 'groupLost': case 'groupCount':
        detail = refSelect('Group', c.group, refs(scenario()?.groups || []), 'condition.group');
        if (c.kind === 'groupCount') detail += select('Compare', c.op || 'atMost', [['atMost', 'At most'], ['atLeast', 'At least'], ['equal', 'Equal']], 'condition.op') + field('Count', c.count ?? 0, 'number', 'condition.count');
        break;
      case 'areaEntry': detail = refSelect('Area', c.area, refs(scenario()?.areas || []), 'condition.area') + sideField(c.side, 'condition.side') + refSelect('Group (optional)', c.group, refs(scenario()?.groups || []), 'condition.group'); break;
      case 'objectiveComplete': detail = refSelect('Objective', c.objective, refs(scenario()?.objectives || []), 'condition.objective'); break;
      case 'triggerComplete': detail = refSelect('Trigger', c.trigger, refs(scenario()?.triggers || []), 'condition.trigger'); break;
      case 'all': case 'any': detail = `<label>${esc(tr('Conditions JSON'))}<textarea data-json="condition.conditions" rows="5">${esc(JSON.stringify(c.conditions || [], null, 2))}</textarea></label><span class="muted">${esc(tr('Use condition objects from the kinds above. Each must have a kind.'))}</span>`; break;
    }
    return select('When', c.kind, conditionKinds, 'condition.kind') + detail;
  }

  function actionFields(action, i) {
    const path = `actions.${i}`;
    let detail = '';
    if (action.kind === 'say') detail = field('Message in English', action.text?.en || '', 'text', `${path}.text.en`) + field('Message in Spanish', action.text?.es || '', 'text', `${path}.text.es`) + recipients(action.recipients, `${path}.recipients`) + sideField(action.side, `${path}.side`);
    if (action.kind === 'objectiveActivate' || action.kind === 'objectiveComplete') detail = refSelect('Objective', action.objective, refs(scenario()?.objectives || []), `${path}.objective`);
    if (action.kind === 'reinforce') detail = refSelect('Group', action.group, refs(scenario()?.groups || []), `${path}.group`) + sideField(action.side, `${path}.side`) + cellLine(action.at, `${path}.at`, 'Arrival') + `<label>${esc(tr('Roster JSON'))}<textarea data-json="${path}.roster" rows="3">${esc(JSON.stringify(action.roster || [], null, 2))}</textarea></label><p class="muted">${esc(tr('Roster entries use a unit type and count. Example: [{"type":"rifle","count":2}]'))}</p>` + select('Order', action.order?.kind || 'hold', [['hold', 'Hold'], ['move', 'Move'], ['attackMove', 'Attack move']], `${path}.order.kind`) + cellLine(action.order?.at, `${path}.order.at`, 'Order target') + field('Expires after seconds', action.expires ?? 300, 'number', `${path}.expires`);
    if (action.kind === 'damage' || action.kind === 'destroy') detail = boxLine(action.box, `${path}.box`) + (action.kind === 'damage' ? field('Damage', action.damage ?? 100, 'number', `${path}.damage`) : '');
    return `<div class="scenario-card"><div class="row"><strong>${esc(tr(`Action ${i + 1}`))}</strong><button type="button" data-remove-action="${i}">${esc(tr('Remove'))}</button></div>${select('Do', action.kind, actionKinds, `${path}.kind`)}${detail}</div>`;
  }

  function details(record) {
    if (!record) return '';
    let content = field('ID', record.id, 'text', 'id');
    if (category === 'areas') content += boxLine(record.box, 'box');
    if (category === 'groups') {
      content += `<div class="row"><strong>${esc(tr('Units'))}</strong><button type="button" data-add-unit>${esc(tr('Add unit'))}</button></div>`;
      content += safeList(record.units).map((unit, i) => `<div class="scenario-card"><div class="row"><strong>${esc(tr(`Unit ${i + 1}`))}</strong><button type="button" data-remove-unit="${i}">${esc(tr('Remove'))}</button></div>${field('ID', unit.id, 'text', `units.${i}.id`)}${select('Type', unit.type, unitTypes, `units.${i}.type`)}${sideField(unit.side, `units.${i}.side`)}${cellLine([unit.x, unit.y], `units.${i}.cell`, 'Cell')}</div>`).join('');
    }
    if (category === 'objectives') content += field('English', record.text?.en || '', 'text', 'text.en') + field('Message in Spanish', record.text?.es || '', 'text', 'text.es') + recipients(record.recipients) + sideField(record.side);
    if (category === 'triggers') content += select('Scope', record.scope || 'match', [['match', 'Whole match'], ['player', 'Each player'], ['team', 'Each team']], 'scope') + sideField(record.side) + recipients(record.recipients) + conditionFields(record.condition) + select('Repeat', record.repeat?.mode || 'once', [['once', 'Once'], ['risingEdge', 'When it becomes true'], ['whileTrue', 'While true']], 'repeat.mode') + field('Cooldown seconds', record.repeat?.cooldown ?? 0, 'number', 'repeat.cooldown') + field('Maximum runs', record.repeat?.max ?? 1, 'number', 'repeat.max') + `<div class="row"><strong>${esc(tr('Actions'))}</strong><button type="button" data-add-action>${esc(tr('Add action'))}</button></div>` + safeList(record.actions).map(actionFields).join('');
    return `<div class="scenario-fields">${content}<button type="button" data-remove>${esc(tr(`Remove ${category.slice(0, -1)}`))}</button></div>`;
  }

  function render() {
    const s = scenario(), items = list();
    if (!items.some((v) => v.id === selected)) selected = items[0]?.id || '';
    host.innerHTML = `<details id="scenarioPanel" ${host.dataset.open === 'true' ? 'open' : ''}><summary>${esc(tr('Scenario events'))}</summary>
      <div class="scenario-body"><p class="muted">${esc(tr('Add objectives and events to this map. Choose a location on the battlefield when a Pick button is active.'))}</p>
      <div class="row">${select('Edit', category, [['areas', 'Areas'], ['groups', 'Unit groups'], ['objectives', 'Objectives'], ['triggers', 'Triggers']], 'category')}<button type="button" data-add>${esc(tr('Add'))}</button></div>
      ${items.length ? select('Selected', selected, items.map((v) => [v.id, v.id]), 'selected') : `<p class="muted">${esc(tr('No entries yet.'))}</p>`}
      ${details(item())}
      <div id="scenarioFeedback" role="status" class="muted">${esc(tr(s ? `${safeList(s.areas).length} areas, ${safeList(s.groups).length} groups, ${safeList(s.objectives).length} objectives, ${safeList(s.triggers).length} triggers` : 'No scenario on this map.'))}</div>
      <details class="scenario-advanced"><summary>${esc(tr('Scenario JSON'))}</summary><p class="muted">${esc(tr('For nested conditions or bulk edits. Apply checks JSON syntax before replacing the scenario.'))}</p><textarea id="scenarioJson" spellcheck="false" rows="10">${esc(JSON.stringify(s || fresh(), null, 2))}</textarea><button type="button" data-apply-json>${esc(tr('Apply JSON'))}</button></details>
      </div></details>`;
    host.querySelector('#scenarioPanel').addEventListener('toggle', (event) => { host.dataset.open = String(event.target.open); });
  }

  function setPath(root, path, value) {
    const parts = path.split('.'), end = parts.pop();
    let target = root;
    for (const part of parts) target = target[part] ??= {};
    if (value === undefined || value === '') delete target[end]; else target[end] = value;
  }
  function changed() {
    const error = onChange();
    render();
    if (error) feedback(`${formatWorldAuthoringError(error).replace(/[.]$/, '')}. ${tr('Check the scenario data.')}`, true);
  }
  function add() {
    const s = ensure(), items = s[category], id = idFor(items, category.slice(0, -1));
    const defaults = {
      areas: { id, box: [0, 0, 0, 0] },
      groups: { id, units: [] },
      objectives: { id, text: { en: '', es: '' }, recipients: 'public' },
      triggers: { id, scope: 'match', recipients: 'public', condition: { kind: 'time', seconds: 30 }, repeat: { mode: 'once', cooldown: 0, max: 1 }, actions: [{ kind: 'say', text: { en: '', es: '' }, recipients: 'public' }] },
    };
    items.push(defaults[category]); selected = id; changed();
  }
  function replaceKind(root, path, kind) {
    if (path === 'condition.kind') setPath(root, 'condition', { kind, ...(kind === 'time' ? { seconds: 30 } : (kind === 'all' || kind === 'any') ? { conditions: [] } : {}) });
    else if (/^actions\.\d+\.kind$/.test(path)) {
      const index = +path.split('.')[1];
      root.actions[index] = kind === 'say' ? { kind, text: { en: '', es: '' }, recipients: 'public' } : kind === 'reinforce' ? { kind, roster: [], order: { kind: 'hold' }, expires: 300 } : { kind };
    }
  }
  host.addEventListener('click', (event) => {
    const button = event.target.closest('button'); if (!button || !host.contains(button)) return;
    const record = item();
    if (button.hasAttribute('data-add')) return add();
    if (button.hasAttribute('data-remove') && record) { ensure()[category].splice(list().indexOf(record), 1); selected = ''; return changed(); }
    if (button.hasAttribute('data-add-unit') && record) { record.units.push({ id: unitId(), type: 'rifle', side: 0, x: 0, y: 0 }); return changed(); }
    if (button.hasAttribute('data-remove-unit') && record) { record.units.splice(+button.dataset.removeUnit, 1); return changed(); }
    if (button.hasAttribute('data-add-action') && record) { record.actions.push({ kind: 'say', text: { en: '', es: '' }, recipients: 'public' }); return changed(); }
    if (button.hasAttribute('data-remove-action') && record) { record.actions.splice(+button.dataset.removeAction, 1); return changed(); }
    if (button.hasAttribute('data-pick') && record) {
      pick = { category, id: record.id, path: button.dataset.pick };
      boxStart = null;
      feedback(button.dataset.pick.endsWith('box') ? 'Click two corners. Esc cancels.' : 'Click a cell or point. Esc cancels.');
      return;
    }
    if (button.hasAttribute('data-apply-json')) {
      try {
        const parsed = JSON.parse(host.querySelector('#scenarioJson').value);
        if (!parsed || parsed.version !== 1 || !['areas', 'groups', 'objectives', 'triggers'].every((key) => Array.isArray(parsed[key]))) throw new Error('Expected version 1 with areas, groups, objectives and triggers lists.');
        if (!parsed.areas.every((entry) => entry && typeof entry.id === 'string') || !parsed.groups.every((entry) => entry && typeof entry.id === 'string' && Array.isArray(entry.units)) || !parsed.objectives.every((entry) => entry && typeof entry.id === 'string') || !parsed.triggers.every((entry) => entry && typeof entry.id === 'string' && entry.condition && Array.isArray(entry.actions))) throw new Error('Every entry needs an ID and its required lists.');
        getMap().scenario = parsed; selected = ''; changed();
      } catch (error) { feedback(tr(`JSON not applied: ${error instanceof SyntaxError ? tr('JSON syntax is invalid. Check commas, brackets and quotation marks.') : tr(error.message)}`), true); }
    }
  });
  host.addEventListener('change', (event) => {
    const target = event.target, path = target.dataset.field, jsonPath = target.dataset.json;
    if (!path && !jsonPath) return;
    if (path === 'category') { category = target.value; selected = ''; return render(); }
    if (path === 'selected') { selected = target.value; return render(); }
    const record = item(); if (!record) return;
    if (jsonPath) {
      try { setPath(record, jsonPath, JSON.parse(target.value)); changed(); }
      catch (error) { feedback(tr(`JSON not applied: ${error instanceof SyntaxError ? tr('JSON syntax is invalid. Check commas, brackets and quotation marks.') : tr(error.message)}`), true); }
      return;
    }
    if (path === 'id') {
      const value = target.value.trim();
      if (!/^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,63}$/.test(value) || list().some((v) => v !== record && v.id === value)) return feedback('Use a unique ID with letters, numbers, colons, underscores or dashes.', true);
      selected = value;
    }
    if (path === 'condition.kind' || /^actions\.\d+\.kind$/.test(path)) replaceKind(record, path, target.value);
    else if (path.endsWith('.cell')) { return; }
    else if (path === 'repeat.mode') {
      setPath(record, path, target.value);
      if (target.value !== 'once' && !(record.repeat.cooldown > 0)) record.repeat.cooldown = 1;
      if (target.value !== 'once' && !(record.repeat.max > 0)) record.repeat.max = 1;
    }
    else {
      const numeric = target.type === 'number' || path === 'side' || path.endsWith('.side');
      setPath(record, path, numeric ? number(target.value) : target.value);
    }
    changed();
  });

  function feedback(message, error = false) {
    const node = host.querySelector('#scenarioFeedback');
    if (node) { node.textContent = tr(message); node.classList.toggle('danger', error); }
  }
  function consumePick(cell) {
    if (!pick) return false;
    const target = byId(safeList(scenario()?.[pick.category]), pick.id);
    if (!target) { pick = null; return false; }
    const path = pick.path;
    if (path === 'condition.target') {
      const point = getMap().points.findIndex((p) => Math.hypot(p.x - cell.x, p.y - cell.y) <= 3);
      if (point < 0) { feedback('Click a capture point.', true); return true; }
      setPath(target, path, getMap().points[point].id || `point:${point}`);
    } else if (path.endsWith('box')) {
      if (!boxStart) { boxStart = cell; feedback('Click the opposite corner.'); return true; }
      setPath(target, path, [Math.min(boxStart.x, cell.x), Math.min(boxStart.y, cell.y), Math.max(boxStart.x, cell.x), Math.max(boxStart.y, cell.y)]);
    } else if (path.endsWith('.cell')) {
      const parts = path.split('.'), unit = target.units[+parts[1]];
      unit.x = cell.x; unit.y = cell.y;
    } else setPath(target, path, [cell.x, cell.y]);
    pick = null; boxStart = null; changed(); return true;
  }
  function cancelPick() { if (!pick) return false; pick = null; boxStart = null; feedback('Selection cancelled.'); return true; }
  render();
  return { render, consumePick, cancelPick, isPicking: () => !!pick };
}
