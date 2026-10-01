const ROLES = { rifle: 'Captures, all-round', mg: 'Pins infantry, sets up', at: 'Kills tanks, sets up', tank: 'Kills infantry, weak rear', rocket: 'Rocket salvos, breaks garrisons',
  ranger: 'Elite, bazookas, satchel charges', tiger: 'Heavy tank, thick front armor (max 1)', conscript: 'Cheap waves, Ura! sprint', engineer: 'Builds depots, weak rifles',
  mortar: 'Arcing fire, out-ranges MGs', sniper: 'One shot, one kill; hides when still', armoredcar: 'Fast scout and raider', medium: 'Mainline tank',
  flak: 'Shoots down enemy air support' };

// Both recruitment panels use the unit name when a role description is missing.
export const unitRole = (type, name) => Object.hasOwn(ROLES, type) ? ROLES[type] : name || 'Unit';
