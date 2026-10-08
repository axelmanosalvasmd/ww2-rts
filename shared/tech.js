// HQ tiers and the Armory (DESIGN.md "HQ tiers and Armory"). Only matches created with opts.tech use them.

// the HQ tier a unit or building needs; anything not listed is tier 1
export const TIER = {
  motorpool: 2, shipyard: 2, armory: 2, pillbox: 2,
  halftrack: 2, armoredcar: 2, flaktrack: 2, tank: 2, at: 2, mortar: 2, flak: 2, lcvp: 2, gunboat: 2,
  airfield: 3, medium: 3, tankdestroyer: 3, rocket: 3, howitzer: 3, tiger: 3, churchill: 3, ranger: 3, commando: 3, destroyer: 3,
  fighter: 3, attacker: 3, bomber: 3,
};
export const tierOf = (type) => TIER[type] ?? 1;

// mun is charged only in Classic (the other modes have no Munitions income)
export const TECH = {
  tiers: { 2: { name: 'Company HQ', mp: 250, mun: 50, time: 60 }, 3: { name: 'Battalion HQ', mp: 400, mun: 100, time: 90 } },
  lines: { inf: 'Infantry Weapons', guns: 'Vehicle Guns', armor: 'Vehicle Armor' },
  levels: [{ mp: 100, mun: 25, time: 30 }, { mp: 175, mun: 50, time: 45 }, { mp: 250, mun: 75, time: 60 }],
  step: 0.1, // +10% damage, or 0.9x damage taken, per level
};
export const TIER_NAMES = ['', 'Platoon HQ', 'Company HQ', 'Battalion HQ'];

// what the next step of `kind` ('tier' or an Armory line) costs, or null when it is maxed
export function techCost(p, kind, classic) {
  const c = kind === 'tier' ? TECH.tiers[p.tier + 1] : TECH.levels[p.armory[kind]];
  return c ? { mp: c.mp, mun: classic ? c.mun : 0, time: c.time } : null;
}

const vehicle = (def) => !def.infantry && !def.structure;
// damage multiplier for a hit from a unit of type `by` (owned by a) on unit type `to` (owned by d); a, d are players
export function techMul(a, by, d, to) {
  const up = a?.armory && by ? (vehicle(by) ? a.armory.guns : by.infantry ? a.armory.inf : 0) : 0;
  const down = d?.armory && vehicle(to) ? d.armory.armor : 0;
  return (1 + TECH.step * up) * (1 - TECH.step) ** down;
}
