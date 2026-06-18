import { addKeyEvent, addLog } from './state.js';
import { canAscend, canOpenTribulationGate, clamp, cultivationMaturityFactor, tribulationChance, tribulationMinimumAge } from './formulas.js';
import { sumShopEffect } from './shop.js';

export function currentRealm(state, data) {
  return data.realms[state.realm.index] ?? data.realms[0];
}

export function currentRealmName(state, data) {
  const realm = currentRealm(state, data);
  const layer = realm.layers[state.realm.layer] ?? realm.layers[0];
  return realm.terminal ? realm.name : `${realm.name}${layer}`;
}

export function layerThreshold(state, data) {
  const realm = currentRealm(state, data);
  if (realm.terminal) return Infinity;
  const breakthroughDiscount = Math.min(0.28, sumShopEffect(state, data, 'minor_breakthrough'));
  return Math.round(realm.threshold * (1 + state.realm.layer * 0.25) * (1 + state.realm.index * 0.16) * (1 - breakthroughDiscount));
}

export function addCultivation(state, data, amount) {
  if (amount <= 0 || state.death || state.isAscended || state.realm.needsTribulation) return;
  let remaining = amount * cultivationMaturityFactor(state);
  if (remaining <= 0) return;
  let guard = 0;
  while (remaining > 0 && guard < 100) {
    guard += 1;
    const threshold = layerThreshold(state, data);
    const missing = threshold - state.realm.progress;
    if (remaining < missing) {
      state.realm.progress += remaining;
      break;
    }
    if (isAtTribulationGate(state, data) && !canOpenTribulationGate(state)) {
      holdAtMortalBottleneck(state, data, threshold);
      break;
    }
    remaining -= missing;
    state.realm.progress = 0;
    advanceLayer(state, data);
    if (state.realm.needsTribulation || state.isAscended || state.death) break;
  }
}

function isAtTribulationGate(state, data) {
  const realm = currentRealm(state, data);
  return !realm.terminal && state.realm.layer >= realm.layers.length - 1;
}

function holdAtMortalBottleneck(state, data, threshold) {
  const realm = currentRealm(state, data);
  const minAge = tribulationMinimumAge(state);
  state.realm.progress = Math.min(threshold - 1, Math.max(state.realm.progress, Math.floor(threshold * 0.96)));
  const flag = `tribulation_wait_${realm.id}`;
  const lastNoted = Number(state.events.flags[flag] ?? -100);
  if (state.player.age - lastNoted >= 3) {
    state.events.flags[flag] = state.player.age;
    addLog(state, `${state.player.name}在${realm.name}圆满前停下脚步，需先入世历练，至少至${minAge}岁后再问天劫。`, 'growth');
  }
}

function advanceLayer(state, data) {
  const realm = currentRealm(state, data);
  if (state.realm.layer < realm.layers.length - 1) {
    state.realm.layer += 1;
    state.realm.stability = Math.min(20, state.realm.stability + 1);
    addLog(state, `${state.player.name}水到渠成，突破至${currentRealmName(state, data)}。`, 'realm');
    return;
  }
  const deferredUntilAge = state.realm.tribulationDeferredUntilAge ?? 0;
  if (state.player.age < deferredUntilAge) {
    state.realm.progress = Math.min(layerThreshold(state, data) - 1, Math.max(state.realm.progress, Math.floor(layerThreshold(state, data) * 0.98)));
    return;
  }
  state.realm.needsTribulation = true;
  state.realm.stability = Math.min(20, state.realm.stability + 2);
  state.paused = true;
  state.events.modal = {
    id: `tribulation_${realm.id}_${Date.now()}`,
    type: 'tribulation',
    title: `${realm.name}圆满`,
    text: `${state.player.name}已至${realm.name}圆满，再进一步便要渡劫。`,
    options: [
      { label: '渡劫', action: 'attempt' },
      { label: '暂缓巩固', action: 'defer' },
      { label: '暂缓五年', action: 'defer5' }
    ]
  };
  addLog(state, `${realm.name}圆满，天机震动，渡劫抉择已至。`, 'choice');
}

function regression(state, data) {
  const reduction = Math.floor((state.shop.levels.foundation_stability ?? 0) / 12) + Math.floor((state.shop.levels.calamity_talisman ?? 0) / 10);
  let layers = Math.max(1, 3 - reduction);
  while (layers > 0) {
    if (state.realm.layer > 0) {
      state.realm.layer -= 1;
    } else if (state.realm.index > 0) {
      state.realm.index -= 1;
      const realm = currentRealm(state, data);
      state.realm.layer = Math.max(0, realm.layers.length - 2);
    }
    layers -= 1;
  }
  state.realm.progress = 0;
  state.realm.stability = 0;
  state.realm.needsTribulation = false;
}

export function resolveTribulation(state, data, rng, action = 'attempt') {
  if (!state.realm.needsTribulation || state.death) return { outcome: 'none' };
  state.paused = false;
  state.events.modal = null;

  const realm = currentRealm(state, data);
  if (action === 'attempt' && !canOpenTribulationGate(state)) {
    const threshold = layerThreshold(state, data);
    state.realm.needsTribulation = false;
    state.realm.progress = Math.min(threshold - 1, Math.max(state.realm.progress, Math.floor(threshold * 0.94)));
    addLog(state, `天机未开，${state.player.name}尚不足${tribulationMinimumAge(state)}岁，只能暂缓入世磨炼。`, 'warning');
    return { outcome: 'too_young' };
  }
  if (action === 'defer') {
    state.realm.stability = Math.min(20, state.realm.stability + 3);
    state.realm.needsTribulation = false;
    state.realm.progress = Math.floor(layerThreshold(state, data) * 0.82);
    addLog(state, `${state.player.name}暂缓渡劫，闭关巩固根基。`, 'choice');
    return { outcome: 'defer' };
  }
  if (action === 'defer5') {
    state.realm.stability = Math.min(20, state.realm.stability + 5);
    state.realm.needsTribulation = false;
    state.realm.tribulationDeferredUntilAge = state.player.age + 5;
    state.realm.progress = Math.floor(layerThreshold(state, data) * 0.98);
    addLog(state, `${state.player.name}暂缓渡劫五年，封炉固境，待${state.realm.tribulationDeferredUntilAge.toFixed(1)}岁后再问天劫。`, 'choice');
    return { outcome: 'defer5' };
  }

  const chance = tribulationChance(state, data);
  const roll = rng.next();
  const nextRealmId = realm.tribulation_to;
  const nextIndex = data.realms.findIndex((item) => item.id === nextRealmId);
  if (roll <= chance && nextIndex >= 0) {
    if (data.realms[nextIndex].id === 'feisheng') {
      if (!canAscend(state)) {
        state.realm.stability = Math.max(0, state.realm.stability - 2);
        state.realm.needsTribulation = false;
        state.realm.progress = 0;
        addLog(state, '天门只开一线，又复闭合。此世积累尚浅，飞升机缘未至。', 'warning');
        return { outcome: 'not_ready' };
      }
      state.realm.index = nextIndex;
      state.realm.layer = 0;
      state.realm.peakIndex = Math.max(state.realm.peakIndex, nextIndex);
      state.realm.needsTribulation = false;
      state.isAscended = true;
      state.death = { cause: '飞升', atAge: state.player.age };
      state.stats.tribulationsWon += 1;
      addKeyEvent(state, '叩开天门，举霞飞升');
      addLog(state, `${state.player.name}破开天门，入仙界逍遥。`, 'success');
      return { outcome: 'ascend' };
    }
    state.realm.index = nextIndex;
    state.realm.layer = 0;
    state.realm.progress = 0;
    state.realm.stability = 2;
    state.realm.peakIndex = Math.max(state.realm.peakIndex, nextIndex);
    state.realm.needsTribulation = false;
    state.mood = clamp(state.mood + 6, -100, 100);
    state.stats.tribulationsWon += 1;
    addKeyEvent(state, `渡劫成功，入${data.realms[nextIndex].name}`);
    addLog(state, `${state.player.name}渡劫成功，踏入${data.realms[nextIndex].name}。`, 'success');
    return { outcome: 'success' };
  }

  if (state.inventory.lotus > 0) {
    state.inventory.lotus -= 1;
    regression(state, data);
    state.mood = clamp(state.mood - 10, -100, 100);
    addKeyEvent(state, '护道莲台碎裂，劫后倒退');
    addLog(state, '护道莲台替你挡下死劫，莲台碎裂，境界倒退。', 'warning');
    return { outcome: 'regress' };
  }

  state.death = { cause: '陨落', atAge: state.player.age };
  state.realm.needsTribulation = false;
  state.paused = false;
  state.mood = clamp(state.mood - 20, -100, 100);
  addKeyEvent(state, `渡${realm.name}之劫陨落`);
  addLog(state, `${state.player.name}渡劫失败，劫雷焚身，本世陨落。`, 'danger');
  return { outcome: 'death' };
}
