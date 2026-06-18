import {
  CULTIVATION_AWAKENING_AGE,
  FIRST_ASCENSION_MIN_REINCARNATIONS,
  LATE_GAME_TRIBULATION_MIN_AGE,
  LATE_GAME_TRIBULATION_PEAK_REALM,
  LATE_GAME_TRIBULATION_REINCARNATIONS,
  TRIBULATION_MIN_AGE
} from './constants.js';
import { sumShopEffect } from './shop.js';

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function lifeStage(age) {
  if (age <= 12) return '童年';
  if (age <= 18) return '少年';
  if (age <= 35) return '青年';
  if (age <= 55) return '中年';
  return '晚年';
}

export function cultivationMaturityFactor(state) {
  const age = state.player.age;
  if (age < CULTIVATION_AWAKENING_AGE) return 0;
  if (age < 13) return 0.08;
  if (age < 19) return 0.35;
  if (age < 36) return 0.72;
  return 1;
}

export function levelThreshold(level) {
  return Math.round(80 * Math.max(1, level) ** 1.45);
}

export function levelCultivationFactor(state) {
  const level = state.progression?.level ?? 1;
  return 1 + Math.min(1.1, Math.max(0, level - 1) * 0.018);
}

export function tribulationMinimumAge(state) {
  const isLateGame = state.meta.ascensions > 0
    || state.meta.reincarnations >= LATE_GAME_TRIBULATION_REINCARNATIONS
    || state.realm.peakIndex >= LATE_GAME_TRIBULATION_PEAK_REALM;
  return isLateGame ? LATE_GAME_TRIBULATION_MIN_AGE : TRIBULATION_MIN_AGE;
}

export function canOpenTribulationGate(state) {
  return state.player.age >= tribulationMinimumAge(state);
}

export function moodFactor(mood) {
  if (mood >= 0) return 1 + mood * 0.003;
  return 1 + mood * 0.0018;
}

export function originModifier(state, data, key, fallback = 0) {
  const origin = data.byId.origin[state.player.originId] ?? data.origins[0];
  return origin.modifiers?.[key] ?? fallback;
}

export function activeSkillMultiplier(state, data) {
  let multiplier = 1;
  for (const known of state.skills.known) {
    const skill = data.byId.skill[known.id];
    if (!skill) continue;
    const masteryIndex = Math.max(0, known.mastery ?? 0);
    const base = (skill.effects_per_level?.cultivate_speed ?? 0) * (masteryIndex + 1);
    const focus = skill.kind === 'inner' && known.id === state.skills.activeInner ? 1 : skill.kind === 'inner' ? 0.25 : 0.35;
    multiplier += base * focus;
  }
  return multiplier;
}

export function skillTribulationBonus(state, data) {
  let bonus = 0;
  for (const known of state.skills.known) {
    const skill = data.byId.skill[known.id];
    if (!skill) continue;
    const masteryIndex = Math.max(0, known.mastery ?? 0);
    const base = (skill.effects_per_level?.tribulation ?? 0) * (masteryIndex + 1);
    const focus = skill.kind === 'inner' && known.id === state.skills.activeInner ? 1 : skill.kind === 'inner' ? 0.25 : 0.45;
    bonus += base * focus;
  }
  return Math.min(0.12, bonus);
}

export function equipmentMultiplier(state, data) {
  let multiplier = 1;
  for (const equipmentId of Object.values(state.inventory.equipped)) {
    const item = data.byId.equipment[equipmentId];
    if (!item) continue;
    multiplier += item.effects?.cultivate_speed ?? 0;
  }
  return multiplier;
}

export function cultivationRate(state, data) {
  const realm = data.realms[state.realm.index] ?? data.realms[0];
  const realmFactor = 1 + state.realm.index * 0.18 + state.realm.layer * 0.025;
  const originFactor = originModifier(state, data, 'cultivation', 1);
  const shopFactor = 1 + sumShopEffect(state, data, 'cultivation') + sumShopEffect(state, data, 'aptitude') + sumShopEffect(state, data, 'global_mult');
  const ascensionFactor = 1 + state.meta.ascensions * state.meta.ascensionMultiplier;
  const pillFactor = state.effects.cultivationBoostUntilAge > state.player.age ? 1.12 : 1;
  const injuryFactor = state.effects.injuryUntilAge > state.player.age ? 0.75 : 1;
  return 5 * realmFactor * originFactor * shopFactor * ascensionFactor * moodFactor(state.mood) * activeSkillMultiplier(state, data) * equipmentMultiplier(state, data) * levelCultivationFactor(state) * pillFactor * injuryFactor;
}

export function maxLifespan(state, data) {
  const realm = data.realms[state.realm.index] ?? data.realms[0];
  const base = 62;
  const originLife = originModifier(state, data, 'lifespan', 0);
  const shopLife = sumShopEffect(state, data, 'lifespan');
  return Math.round(base + originLife + shopLife + realm.lifespan_bonus + state.effects.lifespanBonus);
}

export function deathRiskPerYear(state, data) {
  const age = state.player.age;
  const ageRisk = age < 14 ? 0.004 : age < 35 ? 0.012 : age < 55 ? 0.018 : 0.03;
  const originRisk = originModifier(state, data, 'death_risk', 0);
  const moodRisk = state.mood < -60 ? 0.014 : state.mood > 60 ? -0.006 : 0;
  const realmRisk = Math.max(0, 0.01 - state.realm.index * 0.0012);
  const reincarnationDecay = Math.min(0.018, state.meta.reincarnations * 0.00008);
  const shopReduction = -sumShopEffect(state, data, 'death_risk');
  const equipmentReduction = Object.values(state.inventory.equipped).reduce((sum, equipmentId) => {
    const item = data.byId.equipment[equipmentId];
    return sum + Math.abs(item?.effects?.death_risk ?? 0);
  }, 0);
  const levelReduction = Math.min(0.018, Math.max(0, (state.progression?.level ?? 1) - 1) * 0.00045);
  return clamp(ageRisk + originRisk + moodRisk + realmRisk - reincarnationDecay - shopReduction - equipmentReduction - levelReduction, 0.0005, 0.12);
}

export function tribulationChance(state, data) {
  const realm = data.realms[state.realm.index] ?? data.realms[0];
  const base = realm.tribulation_base ?? 0.5;
  const mood = state.mood * 0.0015;
  const origin = originModifier(state, data, 'tribulation', 0);
  const shop = sumShopEffect(state, data, 'tribulation');
  const skills = skillTribulationBonus(state, data);
  const stability = Math.min(0.12, state.realm.stability * 0.01);
  const pill = state.effects.tribulationBoostUntilAge > state.player.age ? 0.06 : 0;
  const ascensionGatePenalty = realm.tribulation_to === 'feisheng' && !canAscend(state) ? -0.9 : 0;
  return clamp(base + mood + origin + shop + skills + stability + pill + ascensionGatePenalty, 0.03, 0.97);
}

export function canAscend(state) {
  return state.meta.reincarnations >= FIRST_ASCENSION_MIN_REINCARNATIONS;
}

export function lifeCurrencyGain(state) {
  const peak = state.realm.peakIndex + 1;
  const ageScore = Math.max(1, Math.floor(state.player.age / 4));
  const achievement = state.stats.eventsSeen + state.stats.tribulationsWon * 8 + state.stats.childrenRaised * 3 + state.stats.sectRank * 4;
  const adventureScore = Math.floor((state.progression?.victories ?? 0) / 3) + Math.floor((state.progression?.level ?? 1) / 2);
  const deathBonus = state.stats.currencyOnDeathBonus;
  return Math.max(5, Math.floor((peak ** 2) * 8 + ageScore + achievement + adventureScore + deathBonus));
}

export function immortalCurrencyGain(state) {
  return Math.max(1, Math.floor(3 + state.realm.peakIndex * 0.8 + state.meta.ascensions * 0.25));
}

export function epithetFor(state) {
  if (state.death?.cause === '飞升') return '举霞飞升';
  if (state.mood < -70 && state.stats.karma < -10) return '血海魔头';
  if (state.family.children.length > 0 && state.death?.cause === '寿尽') return '情深不寿';
  if (state.stats.sectRank >= 3 && state.mood > 35) return '一代大侠';
  if (state.realm.peakIndex <= 1 && state.death?.cause === '寿尽') return '庸碌一生';
  if (state.death?.cause === '陨落') return '劫灰未冷';
  return state.mood >= 0 ? '心灯不灭' : '旧恨难消';
}
