export const AI_LAB_SCENARIOS = Object.freeze([
  { id: 'contact-threat', description: 'Idle rifles see a nearby MG and choose their ordinary response.' },
  { id: 'armor-pressure', description: 'Ordinary rifles face a medium tank. Its real weapon opens fire after 12 seconds.' },
  { id: 'unseen-heavy-hit', description: 'A rifle receives real fire from an opponent outside the camera.' },
  { id: 'guard', description: 'An owned objective guard can inspect a useful grenade without abandoning its point.' },
  { id: 'hold', description: 'A held objective guard keeps its deliberate position.' },
  { id: 'automatic-retreat', description: 'A vulnerable squad already has automatic retreat enabled.' },
]);
const copy = value => value === undefined ? null : structuredClone(value);
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => { let t = state += 0x6D2B79F5; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function validateLabOptions({ scenario = 'contact-threat', level = 'normal', seed = 1, seconds = 20, ...rest } = {}) {
  if (!AI_LAB_SCENARIOS.some(row => row.id === scenario)) throw Error('Unknown scenario');
  if (!['easy', 'normal', 'hard'].includes(level)) throw Error('Level must be easy, normal or hard');
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw Error('Seed must be an unsigned 32-bit integer');
  if (!Number.isFinite(seconds) || seconds < 1 || seconds > 60) throw Error('Seconds must be between 1 and 60');
  return { scenario, level, seed, seconds, ...rest };
}
export function createAIcase(engine, rawOptions = {}, authored = null) {
  const options = validateLabOptions(rawOptions);
  authored = authored === null && options.scenario === 'armor-pressure' ? defaultScene(options) : authored;
  authored = authored === null ? null : structuredClone(authored);
  const { sim, ai, perception, hands: handsModule, view: viewModule } = engine;
  const random = seededRandom(options.seed);
  const scoped = fn => { const before = Math.random; Math.random = random; try { return fn(); } finally { Math.random = before; } };
  return scoped(() => {

    const map = { w: 96, h: 96, rows: Array(96).fill('.'.repeat(96)), spawns: [{ x: 20, y: 20 }, { x: 85, y: 85 }],
      points: ['guard', 'hold'].includes(options.scenario) ? [{ x: 40, y: 40 }] : [] };
    if (authored?.rows) { if (authored.rows.length !== 96 || authored.rows.some(row => row.length !== 96)) throw Error('Terrain must have 96 rows of 96 cells'); map.rows = [...authored.rows]; }
    if (authored?.points) map.points = authored.points.map(point => ({ x: bounded(point.x / 2, 0, 95), y: bounded(point.z / 2, 0, 95) }));
    const game = sim.createGame(map, ['Lab commander', 'Authored opponent'], false, [0, 1], [0, 1], { weather: false });
    game.units.clear(); game.players.forEach(player => Object.assign(player, { mp: 5000, fuel: 5000 }));
    const buy = (slot, type) => { const error = sim.command(game, slot, { t: 'buy', unit: type }); if (error !== undefined) throw Error(`Fixture purchase: ${error}`); return [...game.units.values()].at(-1); };
    const units = authored?.units ?? defaultScene(options).units;
    if (!Array.isArray(units) || units.length < 1 || units.length > 48) throw Error('Author between 1 and 48 units');
    for (const row of units) {
      if (![0, 1].includes(row.owner) || !sim.UNITS[row.type] || sim.UNITS[row.type].structure) throw Error('Use a troop type and owner 0 or 1');
      const unit = buy(row.owner, row.type);
      Object.assign(unit, { x: bounded(row.x, 1, 191), z: bounded(row.z, 1, 191), hp: bounded(row.hp ?? unit.hp, 1, sim.UNITS[row.type].hpPer * sim.UNITS[row.type].models), auto: false });
      for (const key of ['holdFire', 'holdPos', 'autoRetreat']) if (row[key] !== undefined) unit[key] = !!row[key];
      if (row.cooldown !== undefined) unit.cd = bounded(row.cooldown, 0, 120);
    }
    const own = [...game.units.values()].filter(unit => unit.owner === 0);
    if (!own.length) throw Error('Scene needs one owned squad');
    game.points.forEach((point, index) => { point.owner = authored?.points?.[index]?.owner ?? (['guard', 'hold'].includes(options.scenario) ? 0 : -1); });
    game.players.forEach((player, index) => Object.assign(player, { mp: bounded(authored?.resources?.[index]?.mp ?? 0, 0, 10000),
      fuel: bounded(authored?.resources?.[index]?.fuel ?? 0, 0, 10000), mun: bounded(authored?.resources?.[index]?.mun ?? 200, 0, 10000) }));
    const camera = { x: bounded(authored?.camera?.x ?? 80, 0, 192), z: bounded(authored?.camera?.z ?? 79, 0, 192), yaw: bounded(authored?.camera?.yaw ?? 0, -Math.PI, Math.PI), distance: 60 };
    const initialCamera = copy(camera);
    if (authored?.cues) {
      if (!Array.isArray(authored.cues) || authored.cues.length > 32) throw Error('Use at most 32 authored cues');
      for (const cue of authored.cues) {
        if (!['hit', 'hurt-cue', 'weapon-release'].includes(cue.kind) || !Number.isSafeInteger(cue.tick) || cue.tick < 1 || cue.tick > 12000 || !game.units.has(cue.unitId)) throw Error('Cue needs hit/hurt-cue/weapon-release, tick 1..12000 and a real authored unit ID');
        if (cue.kind === 'hit') bounded(cue.damage ?? 20, 1, 200);
      }
    } const authorEdits = authored ? ['Custom scene authored before tick 0. All prior history was reset.'] : [];
    const memory = { human: { startedTick: 0, camera } }, projection = {};
    const events = [], inputs = [], inputStarts = [], commands = [], frames = [];
    const seenEvents = new Set(), seenActions = new WeakSet();
    let delivered;
    const publicFrame = () => {
      const state = memory.human, view = state.view;
      if (!view) return;
      frames.push({ tick: game.tick, observationTick: view.tick, camera: copy(state.camera), corners: perception.cameraFootprint(state.camera),
        concern: copy(state.concern), selected: [...(state.hands?.selected ?? [])],
        active: state.hands?.active ? { kind: state.hands.active.actions[state.hands.active.index]?.kind,
          reacting: !!state.hands.active.reacting, dueTick: state.hands.active.due, queuedTick: state.hands.active.job.queuedTick } : null,
        queued: state.hands?.queue.length ?? 0, cursor: copy(handsModule.diagnostics(state.hands, game.tick).cursor),
        units: [...view.screenIds].map(id => view.units.get(id)).filter(Boolean).map(unit => ({ id: unit.id, owner: unit.owner,
          type: unit.type, x: unit.x, z: unit.z, hp: unit.hp, hpSource: unit.hpSource ?? 'unknown',
          cdKnown: unit.cdKnown, cooldown: unit.cdKnown ? unit.cd : null, retreating: !!unit.retreating, moving: !!unit.path.length,
          targetId: unit.targetId, cover: unit.cover, holdPos: !!unit.holdPos, holdFire: !!unit.holdFire, autoRetreat: !!unit.autoRetreat })),
        minimap: copy(view.minimap), selectedHUD: copy(view.selectedHUD) });
    };
    let totalSteps = 0;
    function advance(ticks = 1) {
      if (!Number.isSafeInteger(ticks) || ticks < 1 || ticks > 1200) throw Error('Advance between 1 and 1200 ticks');
      return scoped(() => {
      for (let step = 0; step < ticks && totalSteps < 12000 && game.winner === null; step++, totalSteps++) {
      sim.step(game);
      for (const cue of authored?.cues ?? []) if (cue.tick === game.tick) {
        const target = game.units.get(cue.unitId);
        if (!target) continue;
        if (cue.kind === 'hit') { target.hp = Math.max(1, target.hp - bounded(cue.damage ?? 20, 1, 200)); game.shots.push({ k: 'hurt', t: target.id, to: target.owner, x: target.x, z: target.z, kill: false }); }
        else if (cue.kind === 'hurt-cue') game.shots.push({ k: 'hurt', t: target.id, to: target.owner, x: target.x, z: target.z, kill: false });
        else if (cue.kind === 'weapon-release') {
          const error = sim.command(game, target.owner, { t: 'stance', ids: [target.id], key: 'holdFire', on: false });
          if (error !== undefined) throw Error(`Authored weapon release: ${error}`);
        } else throw Error('Cue kind must be hit, hurt-cue or weapon-release');
        authorEdits.push(`Authored ${cue.kind} at tick ${game.tick} for unit ${target.id}`);
      }
      if (!delivered || game.tick % 2 === 0) delivered = viewModule.viewFor(game, 0, projection);
      ai.think(game, 0, { level: options.level, seed: options.seed, memory, view: delivered,
        inputLog: input => inputs.push(copy(input)), submit: command => {
          const issued = copy(command), result = sim.command(game, 0, command);
          commands.push({ tick: game.tick, command: issued, accepted: result === undefined, rejection: result ?? null,
            selected: [...memory.human.hands.selected], planned: copy(memory.human.hands.active?.job.command),
            context: copy(memory.human.hands.active?.job.context) });
          return result;
        } });
      const state = memory.human, active = state.hands?.active, action = active?.actions[active.index];
      if (action && !active.reacting && Number.isSafeInteger(action.startedTick) && !seenActions.has(action)) {
        seenActions.add(action); inputStarts.push({ tick: action.startedTick, registeredTick: game.tick, kind: action.kind,
          dueTick: active.due, fire: !!action.fire, input: copy(action.input), intendedIds: [...active.job.ids],
          planned: copy(active.job.command), context: copy(active.job.context) });
      }
      for (const event of state.events ?? []) if (!seenEvents.has(event.id)) { seenEvents.add(event.id); events.push(copy(event)); }
      if (game.tick % 2 === 0 || game.tick === 1) publicFrame();
      if (game.tick % 2 === 0) { game.shots = []; game.newCells = []; }
    }
      return record();
      });
    }
    function record() {
    const responses = events.filter(event => event.source === 'screen').map(event => {
      const linked = input => input.event?.id === event.id || input.responseEvents?.some(link => link.id === event.id);
      const first = inputs.find(input => input.tick >= event.tick && input.countsAPM !== false && !input.kind.startsWith('camera') && linked(input));
      const accepted = commands.find(command => command.accepted && inputs.some(input => input.tick === command.tick && linked(input) && JSON.stringify(input.command) === JSON.stringify(command.command)));
      return { id: event.id, creationTick: event.tick, firstCompletedInputTick: first?.tick ?? null,
        firstInputSeconds: first ? (first.tick - event.tick) * sim.TICK : null, acceptedCommandTick: accepted?.tick ?? null };
    });
    return { schema: 'ww2-ai-lab-v1', diagnosticOnly: true, notice: 'Authored diagnostic scene. These episode timings are linked input traces, not an acceptance population or score.',
      options: { scenario: options.scenario, level: options.level, seed: options.seed, seconds: options.seconds },
      fixture: { mapSize: { x: game.w * sim.CELL, z: game.h * sim.CELL }, camera: copy(initialCamera), authorEdits: copy(authorEdits), ownIds: own.map(unit => unit.id),
        description: AI_LAB_SCENARIOS.find(row => row.id === options.scenario).description, authoredBeforeRun: true },
      completedTicks: game.tick, events: copy(events), inputStarts: copy(inputStarts), inputs: copy(inputs), commands: copy(commands), responses, frames: copy(frames) };
    }
    return { advance, record, get tick() { return game.tick; }, authorView: () => ({ tick: game.tick, units: [...game.units.values()].map(unit => ({ id: unit.id, owner: unit.owner, type: unit.type, x: unit.x, z: unit.z, hp: unit.hp, cooldown: unit.cd, holdFire: !!unit.holdFire, holdPos: !!unit.holdPos, autoRetreat: !!unit.autoRetreat })), resources: game.players.map(player => ({ mp: player.mp, fuel: player.fuel, mun: player.mun })) }) };
  });
}

function bounded(value, min, max) { if (!Number.isFinite(value) || value < min || value > max) throw Error(`Value must be between ${min} and ${max}`); return value; }
export function defaultScene(options = {}) {
  const scenario = options.scenario ?? 'contact-threat';
  if (scenario === 'armor-pressure') return {
    units: [{ owner: 0, type: 'rifle', x: 78, z: 79 }, { owner: 0, type: 'rifle', x: 82, z: 79 },
      { owner: 1, type: 'medium', x: 96, z: 79, holdFire: true }],
    points: [{ x: 80, z: 80, owner: 0 }], camera: { x: 80, z: 79, yaw: 0 },
    resources: [{ mp: 20, fuel: 0, mun: 200 }, { mp: 0, fuel: 0, mun: 200 }],
    cues: [{ kind: 'weapon-release', tick: 240, unitId: 9 }],
  };
  const units = [{ owner: 0, type: 'rifle', x: scenario === 'unseen-heavy-hit' ? 100 : 78, z: 79, holdFire: true, autoRetreat: scenario === 'automatic-retreat', ...(scenario === 'automatic-retreat' ? { hp: 20 } : {}) }];
  if (!['unseen-heavy-hit', 'automatic-retreat'].includes(scenario)) units.push({ owner: 0, type: 'rifle', x: 82, z: 79, holdFire: true });
  if (scenario === 'hold') units.forEach(unit => { unit.holdPos = true; });
  units.push({ owner: 1, type: options.probeOnly ? options.probeType ?? 'rifle' : 'mg',
    x: options.probeOnly && !options.probeOnScreen ? 168 : scenario === 'unseen-heavy-hit' ? 128 : 96,
    z: options.probeOnly && !options.probeOnScreen ? 168 : 79,
    holdFire: !['unseen-heavy-hit', 'automatic-retreat'].includes(scenario), ...(options.probeHP === undefined ? {} : { hp: options.probeHP }) });
  return { units, points: ['guard', 'hold'].includes(scenario) ? [{ x: 80, z: 80, owner: 0 }] : [], camera: { x: 80, z: 79, yaw: 0 }, resources: [{ mp: 0, fuel: 0, mun: 200 }, { mp: 0, fuel: 0, mun: 200 }], cues: [] };
}
