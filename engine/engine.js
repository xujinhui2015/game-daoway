import { EVENT_INTERVAL_YEARS, OFFLINE_EFFICIENCY, RANDOM_EVENT_START_AGE } from './constants.js';
import { rescueEventForCause, processDecisionTimeouts, processQueuedEvents, processTraceSpawns, triggerEvent, triggerRandomEvent } from './events.js';
import { cultivationRate, deathRiskPerYear, epithetFor, immortalCurrencyGain, lifeCurrencyGain, maxLifespan } from './formulas.js';
import { addCultivation, currentRealmName, resolveTribulation } from './realm.js';
import { createRng } from './rng.js';
import { addKeyEvent, addLog, createInitialState } from './state.js';
import { autoEquipBestEquipment, autoUsePills, ensureActiveInner, ensureCollections, ensureMapMotion, ensureProgression, maybeRequestRouteChoice, updateAdventures, updateAlchemy, updateFamily, updateLifeMilestones, updateSkills } from './subsystems.js';

const accidentalCauses = ['blade', 'fall', 'water', 'poison', 'disease', 'accident', 'war', 'cultivation'];

export function createGame(data, options = {}) {
  const rng = createRng(options.seed ?? options.state?.meta?.lastSavedAt ?? Date.now());
  const state = options.state ? migrateState(options.state, data) : createInitialState(data, rng, options);
  return {
    data,
    rng,
    state,
    lastTick: performance.now(),
    advanceSeconds(seconds, advanceOptions = {}) {
      return advanceSeconds(this, seconds, advanceOptions);
    },
    advanceYears(years, advanceOptions = {}) {
      const scale = Math.max(0.001, this.state.settings.yearsPerSecond * Math.max(1, this.state.settings.speed));
      return advanceSeconds(this, years / scale, { ...advanceOptions, force: true });
    },
    reincarnate(choices = {}) {
      return reincarnate(this, choices);
    },
    resolveTribulation(action = 'attempt') {
      const result = resolveTribulation(this.state, this.data, this.rng, action);
      if (this.state.death && !this.state.death.settled) settleLife(this.state, this.data);
      return result;
    }
  };
}

function migrateState(state, data) {
  state.settings ??= { running: true, speed: 1, yearsPerSecond: 0.04, verify: false };
  state.events ??= { flags: {}, traces: [], log: [], decisions: [], modal: null, nextEventAtAge: 0.25, queued: [] };
  state.events.queued ??= [];
  state.events.decisions ??= [];
  state.events.flags ??= {};
  state.realm.tribulationDeferredUntilAge ??= 0;
  state.history ??= [];
  state.inventory.carried ??= [];
  state.inventory.materials ??= {};
  state.inventory.equipped ??= { weapon: null, armor: null, accessory: null };
  state.family.lastFamilyYear ??= Math.floor(state.player.age);
  ensureProgression(state);
  ensureMapMotion(state);
  ensureCollections(state);
  ensureActiveInner(state, data);
  state.player.lifespan = maxLifespan(state, data);
  return state;
}

export function applyOfflineProgress(game) {
  const lastSavedAt = game.state.meta.lastSavedAt;
  if (!lastSavedAt || game.state.death) return 0;
  const elapsedSeconds = Math.max(0, Math.min(60 * 60 * 12, (Date.now() - lastSavedAt) / 1000));
  if (elapsedSeconds < 10) return 0;
  advanceSeconds(game, elapsedSeconds * OFFLINE_EFFICIENCY, { offline: true, force: true });
  const gain = Math.floor(elapsedSeconds * 0.003 * (1 + game.state.realm.index));
  game.state.currencies.fate += gain;
  addLog(game.state, `离线${Math.floor(elapsedSeconds / 60)}分钟，按效率${Math.round(OFFLINE_EFFICIENCY * 100)}%结算修为与${gain}机缘。`, 'system');
  return elapsedSeconds;
}

export function advanceSeconds(game, seconds, options = {}) {
  const state = game.state;
  if (state.death && !state.death.settled) settleLife(state, game.data);
  if (!seconds || seconds <= 0 || state.death || state.isAscended) return state;
  if (state.paused && !options.force) return state;
  const speed = options.offline ? 1 : Math.max(0, state.settings.speed);
  const totalYears = seconds * state.settings.yearsPerSecond * speed;
  if (totalYears <= 0) return state;
  const totalCultivation = cultivationRate(state, game.data) * seconds * speed * (options.offline ? OFFLINE_EFFICIENCY : 1);
  let progressed = 0;
  let guard = 0;
  while (progressed < totalYears && guard < 2000 && !state.death && !state.isAscended) {
    guard += 1;
    if (state.paused && !options.force) break;
    const step = Math.min(0.1, totalYears - progressed);
    const ratio = step / totalYears;
    progressed += step;
    state.player.age += step;
    state.player.lifeYears += step;
    addCultivation(state, game.data, totalCultivation * ratio);
    autoUsePills(state, game.data);
    autoResolveTribulation(state, game);
    if (state.death || state.isAscended) break;
    updateLifeMilestones(state);
    updateSkills(state, game.data, step);
    updateFamily(state, game.rng, step);
    updateAlchemy(state, game.data, game.rng, step);
    autoUsePills(state, game.data);
    updateAdventures(state, game.data, game.rng);
    autoEquipBestEquipment(state, game.data);
    maybeRequestRouteChoice(state, game.data);
    if (state.paused) break;
    processQueuedEvents(state, game.data, game.rng);
    autoEquipBestEquipment(state, game.data);
    if (state.paused) break;
    processDecisionTimeouts(state, game.data, game.rng);
    autoEquipBestEquipment(state, game.data);
    if (state.paused) break;
    processTraceSpawns(state, game.data, game.rng);
    autoEquipBestEquipment(state, game.data);
    if (state.paused) break;
    maybeGateMoodEvents(state, game.data, game.rng);
    if (state.paused) break;
    maybeTriggerRandomLifeEvent(state, game.data, game.rng);
    autoEquipBestEquipment(state, game.data);
    if (state.paused) break;
    maybeAccidentalDeath(state, game.data, game.rng, step);
    maybeLifespanDeath(state, game.data);
  }
  autoResolveTribulation(state, game);
  return state;
}

function autoResolveTribulation(state, game) {
  if (!state.realm.needsTribulation || state.death || state.isAscended) return;
  resolveTribulation(state, game.data, game.rng, 'attempt');
  if (state.death && !state.death.settled) settleLife(state, game.data);
}

function maybeTriggerRandomLifeEvent(state, data, rng) {
  if (state.paused || state.player.age < RANDOM_EVENT_START_AGE || state.player.age < state.events.nextEventAtAge || state.death) return;
  triggerRandomEvent(state, data, rng);
  state.events.nextEventAtAge = state.player.age + EVENT_INTERVAL_YEARS + rng.next() * 0.65;
}

function maybeGateMoodEvents(state, data, rng) {
  if (state.mood <= -80 && !state.events.flags.demonic_gate_seen) {
    state.events.flags.demonic_gate_seen = true;
    triggerRandomEvent(state, data, rng, (event) => event.category === 'G_心境道心' && event.trigger?.mood_range?.[1] <= -35);
  }
  if (state.mood >= 80 && !state.events.flags.insight_gate_seen) {
    state.events.flags.insight_gate_seen = true;
    triggerRandomEvent(state, data, rng, (event) => event.category === 'G_心境道心' && event.trigger?.mood_range?.[0] >= 35);
  }
}

function maybeAccidentalDeath(state, data, rng, years) {
  if (state.death || state.player.age < 13) return;
  const risk = deathRiskPerYear(state, data) * years;
  if (!rng.chance(risk)) return;
  const cause = accidentalCauses[Math.floor(rng.next() * accidentalCauses.length)];
  if (state.inventory.jadeCharms > 0) {
    state.inventory.jadeCharms -= 1;
    state.stats.deathsEscaped += 1;
    const rescue = rescueEventForCause(data, cause, rng);
    if (rescue) triggerEvent(state, data, rng, rescue, { forced: true });
    state.effects.injuryUntilAge = Math.max(state.effects.injuryUntilAge, state.player.age + 3);
    addKeyEvent(state, '护身玉符救命');
    addLog(state, '护身玉符化去横死命数，代价随之而来。', 'warning');
    return;
  }
  endLife(state, data, '横死', cause);
}

function maybeLifespanDeath(state, data) {
  if (state.death) return;
  state.player.lifespan = maxLifespan(state, data);
  if (state.player.age >= state.player.lifespan) {
    endLife(state, data, '寿尽');
  }
}

export function endLife(state, data, cause, detail = null) {
  if (state.death?.settled) return;
  state.death = {
    cause,
    detail,
    atAge: state.player.age,
    settled: false
  };
  state.paused = false;
  state.events.modal = null;
  settleLife(state, data);
}

export function settleLife(state, data) {
  if (!state.death || state.death.settled) return state.death;
  const fate = lifeCurrencyGain(state);
  const immortal = state.death.cause === '飞升' ? immortalCurrencyGain(state) : 0;
  state.currencies.fate += fate;
  state.currencies.immortal += immortal;
  if (state.death.cause === '飞升') {
    state.meta.ascensions += 1;
    state.isAscended = true;
  }
  const epithet = epithetFor(state);
  const peakRealm = data.realms[state.realm.peakIndex]?.name ?? currentRealmName(state, data);
  const sectName = state.sect.id ? data.byId.sect[state.sect.id]?.name : state.sect.customName ?? '无门无派';
  const entry = {
    life_no: state.history.length + 1,
    name: state.player.name,
    sect: sectName,
    born: data.byId.origin[state.player.originId]?.name ?? '寒门子弟',
    died_at_age: Math.floor(state.death.atAge),
    death_cause: state.death.cause,
    peak_realm: peakRealm,
    epithet,
    key_events: [...state.stats.keyEvents],
    currency_gained: fate,
    immortal_gained: immortal
  };
  state.history.push(entry);
  state.death.settled = true;
  addLog(state, `本世以「${state.death.cause}」告终，谥曰「${epithet}」，得机缘${fate}${immortal ? `、仙缘${immortal}` : ''}。`, 'death');
  return state.death;
}

export function reincarnate(game, choices = {}) {
  const previous = structuredClone(game.state);
  if (!previous.death?.settled) return { ok: false, reason: 'life_not_finished' };
  previous.meta.reincarnations += 1;
  previous.events.traces = previous.events.traces.slice(-60);
  if (previous.death.cause === '飞升') {
    previous.events.traces.push({
      trace_id: `ascension_${Date.now()}`,
      type: 'legend',
      summary: '上一世举霞飞升，仙界仍有余辉。',
      spawn_condition: { next_life_stage: '青年', prob: 0.45 },
      spawn_event: null
    });
  }
  const inheritedChoices = {
    ...previous.setup,
    originId: previous.player.originId,
    regionId: previous.map.regionId,
    ...choices,
    verify: previous.settings.verify
  };
  game.state = createInitialState(game.data, game.rng, inheritedChoices, previous);
  return { ok: true };
}
