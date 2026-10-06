import { CFG, houseKinds, validateMap } from '../shared/sim.js';
import { MATERIALS, worldLayers, composeWorldCell } from '../shared/world-layers.js';
import { STRUCTURE_LIMITS } from '../shared/structures.js';
import { formatWorldAuthoringError, formatMaterialLabel } from './world-authoring-error.js';
import { lang } from './i18n.js';
const label = (en, es) => lang === 'es' ? es : en;

const esc = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
export function inferredSelectionStructure(map, picked) {
  if (!picked || !['B', '='].includes(picked.ch) || picked.cells.length > STRUCTURE_LIMITS.sections) return null;
  const cells = picked.cells.map(([x, y]) => y * map.w + x), local = new Set(cells), kind = picked.ch === '=' ? 'bridge' : 'house';
  const layers = worldLayers(map), physical = layers.ground.map((ch, c) => composeWorldCell(ch, layers.objects[c]));
  const house = houseKinds(physical, map.w, map.buildings), stone = (map.buildings ?? []).some(entry => entry.kind === 'stone bridge' && local.has(entry.y * map.w + entry.x));
  return { id: `edited_${kind}_${Math.min(...cells)}`, kind, sections: cells.map(c => {
    const x = c % map.w, near = [c - map.w, c + map.w, x > 0 ? c - 1 : -1, x < map.w - 1 ? c + 1 : -1].filter(n => n >= 0 && n < map.w * map.h);
    const type = CFG.houses[house[c]];
    return { id: `cell_${c}`, c, hp: kind === 'bridge' ? CFG.terrainHp['='] * (stone ? CFG.stoneBridge : 1) : type.hp,
      material: layers.objectMaterials.get(c) ?? (kind === 'bridge' ? stone ? 'stone' : 'wood' : house[c] >= 2 ? 'stone' : 'wood'),
      anchor: kind === 'house' || near.some(n => !'W='.includes(physical[n])), supports: near.filter(n => local.has(n)).map(n => `cell_${n}`) };
  }) };
}
export function createStructureEditor({ host, getMap, onChange }) {
  let picked = null, draft = null;
  function render(selection) {
    picked = selection; host.replaceChildren();
    if (!picked || !['B', '='].includes(picked.ch)) return;
    const map = getMap(), cells = new Set(picked.cells.map(([x, y]) => y * map.w + x));
    const existing = map.structures?.find(structure => structure.sections.some(section => cells.has(section.c)));
    draft = structuredClone(existing ?? inferredSelectionStructure(map, picked));
    if (!draft) { host.textContent = label('Select up to 128 house or bridge cells to edit support.', 'Selecciona hasta 128 casillas de casa o puente para editar sus apoyos.'); return; }
    host.innerHTML = `<details open><summary>${label('Structural sections', 'Secciones estructurales')}</summary><p class="muted">${label('Each section needs a path to a surviving anchor. Bridge anchors attach to a bank. Supports use adjacent section IDs.', 'Cada sección necesita una cadena de apoyos hasta un anclaje. Los anclajes del puente tocan una orilla. Los apoyos usan IDs de secciones vecinas.')}</p>
      <label>${label('Structure ID', 'ID de estructura')} <input data-structure-id maxlength="48" value="${esc(draft.id)}"></label>
      <div style="max-height:260px;overflow:auto"><table><thead><tr><th>${label('Section / cell', 'Sección / casilla')}</th><th>${label('Health', 'Salud')}</th><th>Material</th><th>${label('Anchor', 'Anclaje')}</th><th>${label('Supports', 'Apoyos')}</th></tr></thead><tbody>${draft.sections.map((section, i) => `<tr data-section="${i}"><td>${esc(section.id)}<br>${section.c % map.w}, ${Math.floor(section.c / map.w)}</td><td><input data-hp type="number" min="1" max="100000" value="${section.hp}" style="width:72px"></td><td><select data-material>${Object.keys(MATERIALS).map(name => `<option value="${name}" ${name === section.material ? 'selected' : ''}>${formatMaterialLabel(name)}</option>`).join('')}</select></td><td><input data-anchor type="checkbox" ${section.anchor ? 'checked' : ''}></td><td><input data-supports value="${esc(section.supports.join(', '))}" aria-label="${esc(label('Support section IDs for ', 'IDs de las secciones que apoyan a ') + section.id)}"></td></tr>`).join('')}</tbody></table></div>
      <div class="row"><button data-apply>${label('Apply sections', 'Aplicar secciones')}</button><button data-reset>${label('Use inferred support', 'Usar apoyos automáticos')}</button></div><div data-error class="muted"></div></details>`;
    host.querySelector('[data-apply]').onclick = () => {
      const next = structuredClone(draft); next.id = host.querySelector('[data-structure-id]').value.trim();
      host.querySelectorAll('[data-section]').forEach(row => {
        const section = next.sections[+row.dataset.section];
        section.hp = +row.querySelector('[data-hp]').value; section.material = row.querySelector('[data-material]').value; section.anchor = row.querySelector('[data-anchor]').checked;
        section.supports = row.querySelector('[data-supports]').value.split(',').map(id => id.trim()).filter(Boolean);
      });
      const current = getMap(), sections = new Set(next.sections.map(section => section.c));
      const candidate = { ...current, structures: [...(current.structures ?? []).filter(structure => !structure.sections.some(section => sections.has(section.c))), next] };
      const error = validateMap(candidate);
      if (error) { host.querySelector('[data-error]').textContent = formatWorldAuthoringError(error); return; }
      onChange(candidate.structures); render(picked);
    };
    host.querySelector('[data-reset]').onclick = () => {
      const current = getMap(); onChange((current.structures ?? []).filter(structure => !structure.sections.some(section => cells.has(section.c)))); render(picked);
    };
  }
  return { render };
}
