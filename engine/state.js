import { ADVENTURE_START_AGE, BASE_YEARS_PER_SECOND, MAX_HISTORY_EVENTS, MAX_LOG, RANDOM_EVENT_START_AGE, VERIFY_YEARS_PER_SECOND, defaultNames } from './constants.js';
import { getShopLevel, sumShopEffect } from './shop.js';

export function randomName(rng, gender = 'male') {
  const list = gender === 'female' ? defaultNames.female : defaultNames.male;
  return list[Math.floor(rng.next() * list.length)] ?? list[0];
}

export function addLog(state, text, tone = 'normal', details = {}) {
  state.events.log.push({
    at: Date.now(),
    life: state.meta.reincarnations + 1,
    age: Number(state.player.age.toFixed(1)),
    text,
    tone,
    rewards: details.rewards ?? []
  });
  if (state.events.log.length > MAX_LOG) state.events.log.splice(0, state.events.log.length - MAX_LOG);
}

export function addKeyEvent(state, text) {
  state.stats.keyEvents.push(text);
  if (state.stats.keyEvents.length > MAX_HISTORY_EVENTS) state.stats.keyEvents.shift();
}

export function createInitialState(data, rng, options = {}, previous = null) {
  const gender = options.gender ?? previous?.setup?.gender ?? (rng.chance(0.5) ? 'male' : 'female');
  const originId = options.originId ?? previous?.setup?.originId ?? 'hanmen';
  const regionId = options.regionId ?? previous?.setup?.regionId ?? 'zhongyuan';
  const name = options.name?.trim() || randomName(rng, gender);
  const origin = data.byId.origin[originId] ?? data.origins[0];

  const meta = previous?.meta ? structuredClone(previous.meta) : {
    reincarnations: 0,
    ascensions: 0,
    ascensionMultiplier: 0.045,
    lastSavedAt: Date.now()
  };
  const shop = previous?.shop ? structuredClone(previous.shop) : {
    levels: {},
    unlockedOrigins: { hanmen: true }
  };
  const currencies = previous?.currencies ? structuredClone(previous.currencies) : { fate: 0, immortal: 0 };
  const history = previous?.history ? structuredClone(previous.history) : [];
  const inheritedTraces = previous?.events?.traces ? structuredClone(previous.events.traces) : [];
  const carry = previous?.inventory?.carried ?? [];
  const collections = previous?.collections ? structuredClone(previous.collections) : {
    sects: [],
    equipment: [],
    pills: [],
    sites: [],
    origins: [],
    claimedAchievements: []
  };
  collections.origins ??= [];
  collections.equipment ??= [];
  collections.pills ??= [];
  collections.sects ??= [];
  collections.sites ??= [];
  collections.claimedAchievements ??= [];
  if (!collections.origins.includes(originId)) collections.origins.push(originId);
  for (const equipmentId of carry) {
    if (!collections.equipment.includes(equipmentId)) collections.equipment.push(equipmentId);
  }

  const jadeCharms = getShopLevel({ shop }, 'jade_charm');
  const lotus = getShopLevel({ shop }, 'lotus_throne');
  const startingMood = Math.round((origin.modifiers?.mood_start ?? 0) + sumShopEffect({ shop }, data, 'mood_start'));
  const verify = options.verify ?? previous?.settings?.verify ?? false;

  const state = {
    setup: { gender, originId, regionId },
    settings: {
      verify,
      running: true,
      speed: verify ? 16 : 1,
      yearsPerSecond: verify ? VERIFY_YEARS_PER_SECOND : BASE_YEARS_PER_SECOND
    },
    player: {
      name,
      gender,
      originId,
      regionId,
      age: 0,
      lifeYears: 0,
      lifespan: 62
    },
    progression: {
      level: 1,
      exp: 0,
      adventures: 0,
      victories: 0,
      defeats: 0,
      monstersDefeated: 0,
      insights: 0,
      nextAdventureAtAge: ADVENTURE_START_AGE,
      lastAdventure: null
    },
    realm: {
      index: 0,
      layer: 0,
      progress: 0,
      stability: 0,
      needsTribulation: false,
      tribulationDeferredUntilAge: 0,
      peakIndex: 0
    },
    mood: Math.max(-100, Math.min(100, startingMood)),
    sect: {
      id: null,
      customName: null,
      rank: -1,
      reputation: 0,
      betrayed: false,
      founded: false
    },
    family: {
      spouse: null,
      children: [],
      lastFamilyYear: 0
    },
    meta,
    currencies,
    shop,
    inventory: {
      jadeCharms,
      lotus,
      equipment: [...carry],
      equipped: { weapon: null, armor: null, accessory: null },
      pills: {},
      herbs: {},
      carried: carry,
      materials: {}
    },
    skills: {
      activeInner: null,
      known: [],
      masteryProgress: {}
    },
    map: {
      regionId,
      route: 'auto',
      discoveredSites: [],
      nextRouteChoiceAge: 14,
      trail: [],
      travelTick: 0,
      lastSite: null,
      lastTrailSummary: null
    },
    collections,
    effects: {
      cultivationBoostUntilAge: 0,
      tribulationBoostUntilAge: 0,
      injuryUntilAge: 0,
      lifespanBonus: 0
    },
    events: {
      flags: {},
      traces: inheritedTraces,
      log: [],
      decisions: [],
      modal: null,
      nextEventAtAge: RANDOM_EVENT_START_AGE,
      queued: []
    },
    history,
    stats: {
      eventsSeen: 0,
      tribulationsWon: 0,
      childrenRaised: 0,
      sectRank: 0,
      currencyOnDeathBonus: 0,
      keyEvents: [],
      karma: 0,
      deathsEscaped: 0
    },
    death: null,
    isAscended: false,
    paused: false
  };

  state.player.lifespan = 62 + (origin.modifiers?.lifespan ?? 0) + sumShopEffect(state, data, 'lifespan');
  const martialSeedLevel = getShopLevel(state, 'martial_seed');
  if (martialSeedLevel > 0) {
    state.skills.known.push({ id: 'skill_wandering_heal', mastery: Math.min(4, Math.floor((martialSeedLevel - 1) / 8)) });
  }
  addLog(state, `${state.player.name}投胎为${origin.name}，在${data.byId.region[regionId]?.name ?? '中原'}睁眼。`, 'birth');
  return state;
}
