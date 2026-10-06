import { lang, spanish } from './i18n.js';

const errors = {
  'worldVersion must be 2': 'La versión del mundo debe ser 2.',
  'version 2 needs world layers': 'La versión 2 necesita capas de terreno y objetos.',
  'world layers need worldVersion 2': 'Las capas de terreno y objetos necesitan la versión 2.',
  'rows must match the composed world layers': 'Las filas del mapa deben coincidir con sus capas de terreno y objetos.',
  'bridge sections need water below them': 'Pinta agua debajo de cada sección del puente.',
  'layers.mines must contain valid rows of mine markers': 'La capa de minas necesita filas del tamaño del mapa con N para minas y puntos para casillas vacías.',
  'mines need dry ground': 'Las minas necesitan terreno seco debajo.',
  'land objects need dry ground': 'Los objetos terrestres necesitan terreno seco debajo.',
  'materials need unique valid cells and material names': 'Cada material necesita una casilla válida y única, y un nombre de material permitido.',
  'structures must be a bounded list': 'El mapa puede tener hasta 2048 estructuras.',
  'structure ids must be unique short identifiers': 'Cada estructura necesita un ID único de hasta 48 caracteres, con letras, números o guiones.',
  'a structure needs a kind and 1-128 sections': 'Elige casa o puente y entre 1 y 128 secciones.',
  'section ids must be unique short identifiers': 'Cada sección necesita un ID único de hasta 48 caracteres dentro de su estructura.',
  'section footprints must be unique cells inside the map': 'Cada sección debe ocupar una casilla distinta dentro del mapa.',
  'section footprint must match its structure': 'Las secciones de una casa deben estar sobre casas, y las del puente sobre puentes.',
  'sections need health, material, an anchor flag and bounded support references': 'Cada sección necesita salud de 1 a 100000, un material válido, un anclaje y hasta 8 apoyos distintos.',
  'supports must reference neighboring sections in the same structure': 'Los apoyos deben indicar IDs de secciones vecinas de la misma estructura.',
  'every starting section needs a path to an anchor': 'Cada sección inicial necesita una cadena de apoyos hasta un anclaje. Un ciclo aislado no sostiene la estructura.',
  'bridge anchors must attach to a bank': 'Los anclajes del puente deben tocar una orilla.',
};
export function formatWorldAuthoringError(error, language = lang) {
  if (language !== 'es' || !error) return error;
  if (errors[error]) return errors[error];
  if (error.startsWith('scenario: ')) return formatScenarioError(error.slice(10));
  const row = /^layers\.(ground|objects) must contain (\d+) rows of (\d+) valid cells$/.exec(error);
  if (row) return `La capa de ${row[1] === 'ground' ? 'terreno' : 'objetos'} necesita ${row[2]} filas de ${row[3]} casillas válidas.`;
  return error;
}


export function formatMaterialLabel(material, language = lang) {
  const labels = { soil: 'Soil', road: 'Road', wood: 'Wood', stone: 'Stone', concrete: 'Concrete', steel: 'Steel', water: 'Water' };
  const text = labels[material] ?? material;
  return language === 'es' ? spanish(text) : text;
}

function formatScenarioError(detail) {
  const fixed = {
    'version must be 1': 'La versión debe ser 1.',
    'too many authored units': 'Hay demasiadas unidades iniciales. El límite es 128.',
    'capture targets need stable IDs': 'Los puntos de captura necesitan IDs válidos y estables.',
    'capture targets need unique IDs': 'Los puntos de captura necesitan IDs únicos.',
    'objective or trigger dependencies form a cycle': 'Las dependencias de objetivos o eventos forman un ciclo. Quita una referencia circular.',
    'objective side is absent from this match': 'El bando de un objetivo no participa en esta partida.',
    'a trigger target or side is absent from this match': 'El destino o bando de un evento no existe en esta partida.',
    'authored unit is unavailable in this match': 'Una unidad inicial no está disponible con estos bandos, facciones o modo.',
    'reinforcements are unavailable in this match': 'Los refuerzos no están disponibles con estos bandos, facciones o modo.',
  };
  if (fixed[detail]) return `Escenario: ${fixed[detail]}`;
  const labels = { triggers: 'eventos', objectives: 'objetivos', groups: 'grupos', areas: 'áreas' };
  let match = /^(triggers|objectives|groups|areas) exceeds (\d+)$/.exec(detail);
  if (match) return `Escenario: el límite de ${labels[match[1]]} es ${match[2]}.`;
  match = /^(triggers|objectives|groups|areas) needs unique stable IDs$/.exec(detail);
  if (match) return `Escenario: ${match[1] === 'areas' ? 'las' : 'los'} ${labels[match[1]]} necesitan IDs únicos y estables.`;
  match = /^area (.+) needs a valid box of up to (\d+) cells$/.exec(detail);
  if (match) return `Escenario: el área ${match[1]} necesita un rectángulo válido de hasta ${match[2]} casillas.`;
  match = /^objective (.+) needs text and valid recipients$/.exec(detail);
  if (match) return `Escenario: el objetivo ${match[1]} necesita texto y destinatarios válidos.`;
  match = /^group (.+) has an invalid unit$/.exec(detail);
  if (match) return `Escenario: el grupo ${match[1]} tiene una unidad con ID, tipo, bando o ubicación no válidos.`;
  match = /^total trigger work exceeds (\d+)$/.exec(detail);
  if (match) return `Escenario: los eventos superan el límite de trabajo de ${match[1]} por actualización. Reduce las acciones y las áreas.`;
  match = /^trigger (.+?) (.+)$/.exec(detail);
  if (match) {
    const suffixes = {
      'has invalid scope or recipients': 'tiene un ámbito o destinatarios no válidos.',
      'needs a positive cooldown and finite execution limit': 'necesita un intervalo positivo y un máximo de ejecuciones.',
      'has an invalid condition or reference': 'tiene una condición o referencia no válida.',
      'has invalid action recipients': 'tiene destinatarios no válidos en una acción.',
      'has invalid announcement': 'necesita un mensaje no vacío y destinatarios válidos.',
      'references an unknown objective': 'hace referencia a un objetivo que no existe.',
      'has invalid reinforcements': 'tiene refuerzos no válidos. Revisa el grupo, bando, unidades, llegada, orden y caducidad.',
      'has an invalid damage area': 'tiene un área de daño no válida. Elige un rectángulo dentro del mapa y un daño positivo.',
      'has an unknown action': 'tiene una acción desconocida. Elige uno de los tipos disponibles.',
    };
    if (suffixes[match[2]]) return `Escenario: el evento ${match[1]} ${suffixes[match[2]]}`;
    const actions = /^needs 1-(\d+) actions$/.exec(match[2]);
    if (actions) return `Escenario: el evento ${match[1]} necesita entre 1 y ${actions[1]} acciones.`;
  }
  return `Escenario: ${detail}`;
}
