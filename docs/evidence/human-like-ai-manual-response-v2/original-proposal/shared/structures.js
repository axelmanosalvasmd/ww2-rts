import { MATERIALS, worldLayers, composeWorldCell } from './world-layers.js';

export const STRUCTURE_LIMITS = Object.freeze({ structures: 2048, sections: 128, falling: 96, contacts: 2048 });
export function supportedSections(structure) {
  const live = new Map(structure.sections.filter(section => section.state !== 'failed' && section.hp > 0).map(section => [section.id, section]));
  const supported = new Set(), queue = [];
  for (const section of live.values()) if (section.anchor) { supported.add(section.id); queue.push(section.id); }
  // Support is undirected physical adjacency. Every live path must end at an anchor.
  const links = new Map([...live.keys()].map(id => [id, new Set()]));
  for (const section of live.values()) for (const id of section.supports) if (live.has(id)) { links.get(section.id).add(id); links.get(id).add(section.id); }
  for (let n = 0; n < queue.length; n++) for (const id of links.get(queue[n])) if (!supported.has(id)) { supported.add(id); queue.push(id); }
  return supported;
}
export function validateStructures(map) {
  if (map.structures === undefined) return null;
  if (!Array.isArray(map.structures) || map.structures.length > STRUCTURE_LIMITS.structures) return 'structures must be a bounded list';
  const { ground, objects } = worldLayers(map), chars = ground.map((ch, c) => composeWorldCell(ch, objects[c]));
  const cells = new Set(), ids = new Set();
  for (const structure of map.structures) {
    if (!structure || typeof structure.id !== 'string' || !/^[a-zA-Z0-9_-]{1,48}$/.test(structure.id) || ids.has(structure.id)) return 'structure ids must be unique short identifiers';
    ids.add(structure.id);
    if (!['house', 'bridge'].includes(structure.kind) || !Array.isArray(structure.sections) || !structure.sections.length || structure.sections.length > STRUCTURE_LIMITS.sections) return 'a structure needs a kind and 1-128 sections';
    const local = new Set();
    for (const section of structure.sections) {
      if (!section || typeof section.id !== 'string' || !/^[a-zA-Z0-9_-]{1,48}$/.test(section.id) || local.has(section.id)) return 'section ids must be unique short identifiers';
      local.add(section.id);
      if (!Number.isInteger(section.c) || section.c < 0 || section.c >= map.w * map.h || cells.has(section.c)) return 'section footprints must be unique cells inside the map';
      cells.add(section.c);
      const ch = chars[section.c];
      if (ch !== (structure.kind === 'bridge' ? '=' : 'B')) return 'section footprint must match its structure';
      if (!Number.isFinite(section.hp) || section.hp <= 0 || section.hp > 100000 || !Object.hasOwn(MATERIALS, section.material) || typeof section.anchor !== 'boolean' || !Array.isArray(section.supports) || section.supports.length > 8 || new Set(section.supports).size !== section.supports.length) return 'sections need health, material, an anchor flag and bounded support references';
    }
    const byId = new Map(structure.sections.map(section => [section.id, section]));
    for (const section of structure.sections) for (const id of section.supports) {
      const to = byId.get(id), dx = Math.abs(section.c % map.w - (to?.c ?? -map.w) % map.w), dy = Math.abs(Math.floor(section.c / map.w) - Math.floor((to?.c ?? -map.w) / map.w));
      if (!to || id === section.id || dx + dy !== 1) return 'supports must reference neighboring sections in the same structure';
    }
    if (supportedSections({ sections: structure.sections.map(section => ({ ...section, state: 'intact' })) }).size !== structure.sections.length) return 'every starting section needs a path to an anchor';
    if (structure.kind === 'bridge') for (const section of structure.sections.filter(section => section.anchor)) {
      const x = section.c % map.w, near = [section.c - map.w, section.c + map.w, x > 0 ? section.c - 1 : -1, x < map.w - 1 ? section.c + 1 : -1];
      if (!near.some(c => c >= 0 && c < map.w * map.h && !'W='.includes(chars[c]))) return 'bridge anchors must attach to a bank';
    }
  }
  return null;
}
