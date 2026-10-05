const ROLES = { rifle: 'Captures, all-round', mg: 'Pins infantry, sets up', at: 'Kills tanks, sets up', tank: 'Kills infantry, weak rear', rocket: 'Rocket salvos, breaks garrisons',
  ranger: 'Elite, bazookas, satchel charges', tiger: 'Heavy tank, thick front armor (max 1)', conscript: 'Cheap waves, Ura! sprint', churchill: 'Slow infantry tank, thickest front armor (max 1)', commando: 'Raiders, Stens and satchels; hide when still', engineer: 'Builds depots, weak rifles',
  mortar: 'Arcing fire, out-ranges MGs', sniper: 'One shot, one kill; hides when still', armoredcar: 'Fast scout and raider', medium: 'Mainline tank',
  flak: 'Shoots down enemy air support', flaktrack: 'Flak that keeps up with the army', fighter: 'Clears the sky, escorts',
  attacker: 'Rockets and bombs on ground targets', halftrack: 'Carries one squad; infantry reinforce beside it', medic: 'Unarmed; heals squads out of the fight', lcvp: 'Carries one squad over water, lands it on a beach', gunboat: 'Fast; hunts boats, torpedoes ships',
  destroyer: 'Shells whatever your side spots, 120 m (max 2)', tankdestroyer: 'Long gun, hunts tanks; weak vs infantry',
  howitzer: 'Heavy shells at 95 m; slow, sets up, blind up close', flamer: 'Burns out houses and trenches; short range', bomber: 'Drops bomb sticks on crowds and dug-in positions' };

// Both recruitment panels use the unit name when a role description is missing.
export const unitRole = (type, name) => Object.hasOwn(ROLES, type) ? ROLES[type] : name || 'Unit';
