import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
if (!process.argv[2]) {
  for (const language of ['en', 'es']) execFileSync(process.execPath, [import.meta.filename, language], { stdio: 'inherit' });
  process.exit(0);
}
const language = process.argv[2];
globalThis.localStorage = { getItem: () => language };
const { formatWorldAuthoringError, formatMaterialLabel } = await import('./client/world-authoring-error.js');
const { validateMap } = await import('./shared/sim.js');
const resolve = name => new URL(name, import.meta.url).href;
const code = readFileSync(new URL('./client/scenario-editor.js', import.meta.url), 'utf8')
  .replace("'/shared/sim.js'", JSON.stringify(resolve('./shared/sim.js')))
  .replace("'./i18n.js'", JSON.stringify(resolve('./client/i18n.js')))
  .replace("'./world-authoring-error.js'", JSON.stringify(resolve('./client/world-authoring-error.js')));
const { createScenarioEditor } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
class Host {
  dataset = {}; handlers = {}; innerHTML = '';
  panel = { addEventListener() {} };
  feedback = { textContent: '', classList: { toggle() {} } };
  json = { value: '' };
  addEventListener(name, callback) { this.handlers[name] = callback; }
  contains() { return true; }
  querySelector(selector) { return selector === '#scenarioPanel' ? this.panel : selector === '#scenarioFeedback' ? this.feedback : this.json; }
  click(attribute, dataset = {}) { const button = { dataset, hasAttribute: name => name === attribute }; this.handlers.click({ target: { closest: () => button } }); }
  change(path, value) { this.handlers.change({ target: { dataset: { field: path }, value } }); }
}
const map = { name: 'Locale test', w: 24, h: 24, rows: Array(24).fill('.'.repeat(24)), spawns: [{ x: 2, y: 2 }, { x: 21, y: 21 }], points: [{ id: 'Road', x: 12, y: 12 }], scenario: { version: 1, areas: [], groups: [], objectives: [], triggers: [] } };
const host = new Host(), editor = createScenarioEditor({ host, getMap: () => map, onChange: () => validateMap(map) });
assert.match(host.innerHTML, language === 'es' ? /Eventos del escenario/ : /Scenario events/);
assert.match(host.innerHTML, language === 'es' ? /Aplicar JSON/ : /Apply JSON/);
assert.ok(!host.innerHTML.includes('${'), 'rendered empty-state help contains no unevaluated template');
// Exercise the actual delegated Add/category/condition/JSON/pick bindings, then inspect resulting messages and saved data.
host.click('data-add');
assert.equal(map.scenario.triggers.length, 1);
assert.match(host.innerHTML, language === 'es' ? /Máximo de ejecuciones/ : /Maximum runs/);
host.change('condition.kind', 'capture');
assert.match(host.innerHTML, language === 'es' ? /Elegir punto en el mapa/ : /Pick point on map/);
assert.ok(host.innerHTML.includes('value="Road"'), 'translated choices preserve authored reference values');
assert.ok(host.innerHTML.includes('(Road)'), 'authored IDs retain their displayed spelling');
host.click('data-pick', { pick: 'condition.target' });
assert.match(host.feedback.textContent, language === 'es' ? /Haz clic en una casilla o punto/ : /Click a cell or point/);
assert.equal(editor.consumePick({ x: 12, y: 12 }), true);
assert.equal(map.scenario.triggers[0].condition.target, 'Road');
host.change('category', 'areas'); host.click('data-add');
host.click('data-pick', { pick: 'box' });
editor.consumePick({ x: 5, y: 5 });
assert.match(host.feedback.textContent, language === 'es' ? /esquina opuesta/ : /opposite corner/);
editor.consumePick({ x: 7, y: 7 });
assert.deepEqual(map.scenario.areas[0].box, [5, 5, 7, 7]);
host.json.value = '{'; host.click('data-apply-json');
assert.match(host.feedback.textContent, language === 'es' ? /JSON sin aplicar: La sintaxis JSON no es válida/ : /JSON not applied: JSON syntax is invalid/);
assert.equal(map.scenario.areas.length, 1, 'syntax failure preserves the authored scenario');
host.json.value = JSON.stringify({ version: 1, areas: [], groups: [], objectives: [], triggers: [] }); host.click('data-apply-json');
assert.equal(map.scenario.triggers.length, 0);
for (const [material, en, es] of [['wood', 'Wood', 'Madera'], ['concrete', 'Concrete', 'Hormigón'], ['soil', 'Soil', 'Tierra']]) assert.equal(formatMaterialLabel(material), language === 'es' ? es : en);
const broken = structuredClone(map); broken.scenario.triggers.push({ id: 'Road', scope: 'match', condition: { kind: 'unitLost', unit: 'absent' }, actions: [{ kind: 'say', text: 'Ready' }], repeat: { mode: 'once' } });
const error = validateMap(broken);
assert.match(error, /invalid condition or reference/);
const text = formatWorldAuthoringError(error);
assert.match(text, language === 'es' ? /evento Road tiene una condición o referencia no válida/ : /trigger Road has an invalid condition or reference/);
assert.ok(text.includes('Road'), 'validation never translates authored IDs');
const { createStructureEditor } = await import('./client/structure-editor.js');
const structureMap = structuredClone(map); structureMap.rows[8] = '.'.repeat(8) + 'B' + '.'.repeat(15);
const structureHost = {
  innerHTML: '', error: { textContent: '' }, apply: {}, reset: {},
  replaceChildren() { this.innerHTML = ''; },
  querySelector(selector) {
    if (selector === '[data-apply]') return this.apply;
    if (selector === '[data-reset]') return this.reset;
    if (selector === '[data-error]') return this.error;
    return { value: 'house-test' };
  },
  querySelectorAll() { return [{ dataset: { section: '0' }, querySelector: selector => selector === '[data-hp]' ? { value: '150' } : selector === '[data-material]' ? { value: 'wood' } : selector === '[data-anchor]' ? { checked: false } : { value: '' } }]; },
};
const structureEditor = createStructureEditor({ host: structureHost, getMap: () => structureMap, onChange: () => assert.fail('unsupported structure must be rejected') });
structureEditor.render({ ch: 'B', cells: [[8, 8]] });
assert.match(structureHost.innerHTML, language === 'es' ? /Secciones estructurales/ : /Structural sections/);
assert.ok(structureHost.innerHTML.includes('value="wood"'), 'readable material options retain saved enum values');
assert.match(structureHost.innerHTML, language === 'es' ? />Madera<\/option>/ : />Wood<\/option>/);
structureHost.apply.onclick();
assert.match(structureHost.error.textContent, language === 'es' ? /anclaje/ : /anchor/);
console.log(`${language} editor bindings passed: Add, condition/reference options, area picking, advanced JSON error/apply, material labels, support Apply validation and authoritative validation`);
