import { BASE_YEARS_PER_SECOND, deathCauseMap } from './constants.js';
import { clamp, lifeStage } from './formulas.js';
import { addCultivation } from './realm.js';
import { addKeyEvent, addLog } from './state.js';
import { weightedChoice } from './rng.js';
import { gainExperience, recordCollection, recordMapIncident, resolveRouteDecision } from './subsystems.js';

const rarityWeight = { common: 1, rare: 0.42, legendary: 0.16 };
const reservedRandomCategories = new Set(['救命_死里逃生', '渡劫剧情']);
const decisionLabels = {
  A: [['闭关强冲', '借势运功', '翻检旧诀', '引气入脉'], ['稳住气海', '暂避躁动', '散功重理', '请益旁门']],
  B: [['拔剑迎敌', '设伏试锋', '追索线索', '以战破局'], ['藏锋观望', '绕路避祸', '结伴同行', '以退为进']],
  C: [['递帖拜山', '揽下差事', '结交同门', '争取功名'], ['暗中周旋', '守拙避嫌', '另投人情', '静待风向']],
  D: [['坦然赴约', '赠物结缘', '护其周全', '顺水推舟'], ['点到为止', '托词暂别', '守礼观心', '缓缓相处']],
  E: [['扶持家业', '严加教导', '托人照看', '倾囊相助'], ['放手历练', '暂缓家事', '另寻出路', '保全根基']],
  F: [['冒险探查', '破局求生', '先发制人', '硬闯险关'], ['避其锋芒', '藏身待援', '弃物脱困', '绕开死地']],
  G: [['守住本心', '斩断杂念', '直面心魔', '静坐观照'], ['借酒消愁', '随缘化解', '移情别处', '暂避执念']],
  H: [['深入遗迹', '开匣验宝', '追寻异光', '以血认主'], ['封存线索', '请人掌眼', '先取外物', '谨慎退回']],
  I: [['承接因果', '追问旧事', '祭告前尘', '循迹而行'], ['斩断牵连', '藏起旧物', '另托他人', '暂且搁置']]
};
const genericDecisionLabels = [['正面应对', '试探推进', '借机行事', '主动追查'], ['谨慎处理', '改走旁路', '拖延观望', '保守收束']];
const successPhrases = ['此举恰中要害，局面随之打开', '你抓住一线机会，将纷乱因果纳入掌中', '事态虽险，终究被你稳稳压下', '旁人尚在犹疑时，你已抢得先机'];
const failurePhrases = ['局势反噬得比预想更快，你只得吞下苦果', '一念之差让线索断裂，余波仍缠在身上', '此路并未走通，反倒耗去不少心力', '变数横生，你未能拿到想要的结果'];

export function templateVars(state, data) {
  const region = data.byId.region[state.map.regionId] ?? data.regions[0];
  const sect = state.sect.id ? data.byId.sect[state.sect.id]?.name : '江湖散人';
  const realm = data.realms[state.realm.index]?.name ?? '后天';
  const child = state.family.children[0]?.name ?? '未名子嗣';
  const nemesis = state.events.traces.find((trace) => trace.type === 'nemesis')?.summary ?? '旧日仇敌';
  return {
    主角名: state.player.name,
    门派: sect,
    地点: region?.name ?? '中原',
    境界: realm,
    子嗣名: child,
    仇敌名: nemesis
  };
}

export function renderTemplate(text, state, data) {
  const vars = templateVars(state, data);
  return String(text ?? '').replace(/\{([^}]+)\}/g, (_, key) => vars[key] ?? key);
}

function realmRankByName(data, name) {
  if (!name || name === 'any') return -1;
  return data.realms.findIndex((realm) => realm.name === name || realm.id === name);
}

function triggerMatches(event, state, data) {
  const trigger = event.trigger ?? {};
  const stage = lifeStage(state.player.age);
  if (trigger.life_stage?.length) {
    const specificStages = trigger.life_stage.filter((item) => item !== '任意期');
    if (specificStages.length && !specificStages.includes(stage)) return false;
    if (!specificStages.length && !trigger.life_stage.includes('任意期') && !trigger.life_stage.includes(stage)) return false;
  }
  if (trigger.age_range && (state.player.age < trigger.age_range[0] || state.player.age > trigger.age_range[1])) return false;
  if (trigger.mood_range && (state.mood < trigger.mood_range[0] || state.mood > trigger.mood_range[1])) return false;
  const currentRealmRank = state.realm.index;
  const minRealm = realmRankByName(data, trigger.realm_min);
  const maxRealm = realmRankByName(data, trigger.realm_max);
  if (minRealm >= 0 && currentRealmRank < minRealm) return false;
  if (maxRealm >= 0 && currentRealmRank > maxRealm) return false;
  if (trigger.origin && trigger.origin !== 'any' && trigger.origin !== state.player.originId) return false;
  const sectName = state.sect.id ? data.byId.sect[state.sect.id]?.name : null;
  if (trigger.sect && trigger.sect !== 'any' && trigger.sect !== sectName && trigger.sect !== state.sect.id) return false;
  if (trigger.region && trigger.region !== 'any' && trigger.region !== state.map.regionId) return false;
  for (const flag of trigger.requires_flags ?? []) {
    if (!state.events.flags[flag]) return false;
  }
  for (const flag of trigger.excludes_flags ?? []) {
    if (state.events.flags[flag]) return false;
  }
  return true;
}

export function eventCandidates(state, data, predicate = null) {
  return data.events.filter((event) => {
    if (predicate && !predicate(event)) return false;
    return triggerMatches(event, state, data);
  });
}

export function regionEventAffinity(event, state, data) {
  const region = data.byId.region[state.map?.regionId] ?? data.regions[0];
  const pool = region?.event_pool ?? [];
  if (event.trigger?.region && event.trigger.region === state.map?.regionId) return 3.2;
  if (pool.includes(event.category)) return 2.4;
  if (event.category === '人生阶段氛围' || event.category === '成长_主线阶段') return 1.15;
  if (event.category === '链式剧情线' || event.category === '跨世留痕') return 1;
  return 0.72;
}

function eventWeight(event, state, data) {
  const fortune = 1 + ((state.shop.levels.fortune_weight ?? 0) * 0.025);
  const base = event.trigger?.weight ?? 10;
  return base * (rarityWeight[event.rarity] ?? 1) * fortune * regionEventAffinity(event, state, data);
}

export function triggerRandomEvent(state, data, rng, predicate = null) {
  const candidates = eventCandidates(state, data, (event) => {
    if (reservedRandomCategories.has(event.category)) return false;
    return predicate ? predicate(event) : true;
  });
  const event = weightedChoice(candidates, (item) => eventWeight(item, state, data), rng);
  if (!event) return null;
  return triggerEvent(state, data, rng, event);
}

export function triggerEventById(state, data, rng, eventId) {
  const event = data.byId.event[eventId];
  if (!event) return null;
  return triggerEvent(state, data, rng, event, { forced: true });
}

export function triggerEvent(state, data, rng, event, options = {}) {
  const renderedText = renderTemplate(event.text, state, data);
  const rendered = {
    id: event.id,
    title: event.title,
    category: event.category,
    type: event.type,
    text: renderedText,
    options: event.type === 'choice_listed'
      ? buildDynamicDecisionOptions(event, state, data, rng)
      : (event.options ?? []).map((option, index) => ({ ...option, index }))
  };

  if (!options.forced && event.type !== 'auto' && state.events.decisions.some((item) => item.eventId === event.id)) return null;

  if (event.type === 'choice_modal') {
    state.events.modal = { type: 'event', eventId: event.id, rendered };
    state.paused = true;
    addLog(state, `关键抉择：${event.title}`, 'choice');
    return rendered;
  }

  if (event.type === 'choice_listed') {
    const timeout = Number(event.timeout ?? 60);
    const timeoutYears = Math.max(0.1, timeout * BASE_YEARS_PER_SECOND);
    state.events.decisions.push({
      id: `${event.id}_${Date.now()}_${Math.floor(rng.next() * 10000)}`,
      eventId: event.id,
      rendered,
      createdAtAge: state.player.age,
      expiresAtAge: state.player.age + timeoutYears,
      defaultOption: event.default_option ?? 0
    });
    addLog(state, `决策进入列表：${event.title}`, 'choice');
    return rendered;
  }

  applyEventEffects(state, data, rng, event, event.effects ?? {});
  state.stats.eventsSeen += 1;
  recordMapIncident(state, data, eventMapReason(event));
  addLog(state, renderedText, 'event');
  return rendered;
}

export function resolveDecision(state, data, rng, decisionId, optionIndex = null) {
  const index = state.events.decisions.findIndex((decision) => decision.id === decisionId);
  if (index < 0) return { ok: false, reason: 'missing_decision' };
  const [decision] = state.events.decisions.splice(index, 1);
  if (decision.system === 'route') {
    return resolveRouteDecision(state, data, rng, decision, optionIndex ?? decision.defaultOption);
  }
  const event = data.byId.event[decision.eventId];
  const selectedIndex = optionIndex ?? defaultOptionIndex(event, decision.defaultOption, rng);
  const option = decision.rendered?.options?.[selectedIndex] ?? event.options?.[selectedIndex] ?? event.options?.[0];
  const outcome = resolveDecisionOutcome(state, data, rng, event, option);
  applyEventEffects(state, data, rng, event, outcome.effects);
  if (!outcome.dynamic && event.effects) applyPassiveCommonEffects(state, data, rng, event);
  state.stats.eventsSeen += 1;
  recordMapIncident(state, data, eventMapReason(event));
  const label = option?.label ?? '默认';
  addLog(state, `处理江湖事「${event.title}」：${label}，${outcome.success ? '事成' : '失手'}。${outcome.text}`, outcome.success ? 'success' : 'warning', { rewards: outcome.rewards });
  return { ok: true, event, option, outcome };
}

export function processDecisionTimeouts(state, data, rng) {
  const due = state.events.decisions.filter((decision) => state.player.age >= decision.expiresAtAge);
  for (const decision of due) {
    resolveDecision(state, data, rng, decision.id, null);
  }
}

export function resolveModalEvent(state, data, rng, optionIndex = 0) {
  if (!state.events.modal || state.events.modal.type !== 'event') return { ok: false, reason: 'missing_modal' };
  const event = data.byId.event[state.events.modal.eventId];
  const option = event.options?.[optionIndex] ?? event.options?.[0];
  state.events.modal = null;
  state.paused = false;
  applyEventEffects(state, data, rng, event, option?.effects ?? event.effects ?? {});
  if (event.effects) applyPassiveCommonEffects(state, data, rng, event);
  state.stats.eventsSeen += 1;
  recordMapIncident(state, data, eventMapReason(event));
  addLog(state, `完成关键抉择「${event.title}」：${option?.label ?? '默认'}`, 'choice');
  return { ok: true, event, option };
}

function eventMapReason(event) {
  const category = String(event.category ?? '剧情')
    .replace(/^[A-I]_/, '')
    .replace('人生阶段氛围', '人生')
    .replace('成长_主线阶段', '成长');
  const title = String(event.title ?? '无名事').slice(0, 8);
  return `${category}:${title}`;
}

function defaultOptionIndex(event, defaultOption, rng) {
  if (defaultOption === 'random') return Math.floor(rng.next() * (event.options?.length || 1));
  return Number(defaultOption) || 0;
}

function buildDynamicDecisionOptions(event, state, data, rng) {
  const source = event.options?.length ? event.options : [{ label: '应对', effects: {} }, { label: '暂避', effects: {} }];
  return source.slice(0, Math.max(2, source.length)).map((option, index) => {
    const original = source[index] ?? source[source.length - 1] ?? {};
    const label = dynamicDecisionLabel(event, index, rng);
    const risk = index === 0 ? 1.12 : 0.72;
    const successRate = decisionSuccessRate(event, state, index, risk);
    const rewards = dynamicOutcomeEffects(event, original, state, rng, index, true, risk);
    const penalties = dynamicOutcomeEffects(event, original, state, rng, index, false, risk);
    return {
      ...original,
      index,
      label,
      successRate,
      successText: dynamicOutcomeText(event, rng, true),
      failureText: dynamicOutcomeText(event, rng, false),
      successEffects: rewards,
      failureEffects: penalties,
      effects: rewards
    };
  });
}

function dynamicDecisionLabel(event, index, rng) {
  const code = String(event.category ?? '').match(/^([A-I])_/)?.[1];
  const bank = decisionLabels[code] ?? genericDecisionLabels;
  const labels = bank[index % bank.length] ?? genericDecisionLabels[index % genericDecisionLabels.length];
  return labels[Math.floor(rng.next() * labels.length)] ?? labels[0];
}

function decisionSuccessRate(event, state, index, risk) {
  const rarityPenalty = event.rarity === 'legendary' ? -0.1 : event.rarity === 'rare' ? -0.05 : 0;
  const levelBonus = Math.min(0.16, ((state.progression?.level ?? 1) - 1) * 0.012);
  const realmBonus = Math.min(0.18, (state.realm?.index ?? 0) * 0.025);
  const moodBonus = clamp((state.mood ?? 0) * 0.0012, -0.1, 0.1);
  const riskPenalty = (risk - 0.7) * 0.18;
  const base = index === 0 ? 0.58 : 0.72;
  return Number(clamp(base + levelBonus + realmBonus + moodBonus + rarityPenalty - riskPenalty, 0.18, 0.92).toFixed(2));
}

function dynamicOutcomeText(event, rng, success) {
  const phrase = (success ? successPhrases : failurePhrases)[Math.floor(rng.next() * (success ? successPhrases : failurePhrases).length)];
  const category = String(event.category ?? '江湖事').replace(/^[A-I]_/, '');
  return `${phrase}，${category}的余波就此改写。`;
}

function dynamicOutcomeEffects(event, option, state, rng, index, success, risk) {
  const code = String(event.category ?? '').match(/^([A-I])_/)?.[1] ?? 'I';
  const scale = success ? risk : -Math.max(0.45, risk * 0.62);
  const magnitude = 1 + rng.next() * 0.55 + (event.rarity === 'legendary' ? 0.45 : event.rarity === 'rare' ? 0.22 : 0);
  const effects = {
    set_flags: [
      ...(event.effects?.set_flags ?? []),
      ...(option.effects?.set_flags ?? []),
      `decision_${event.id}_${index}_${success ? 'success' : 'failure'}`
    ],
    next_event: success ? (option.effects?.next_event ?? event.effects?.next_event ?? null) : null,
    leave_trace: success ? (option.effects?.leave_trace ?? event.effects?.leave_trace ?? null) : null
  };
  const add = (key, value) => {
    if (!value) return;
    effects[key] = Math.round((effects[key] ?? 0) + value);
  };
  const addFloat = (key, value) => {
    if (!value) return;
    effects[key] = Number(((effects[key] ?? 0) + value).toFixed(3));
  };
  if (['A', 'B'].includes(code)) add('cultivation', scale * magnitude * (18 + (state.realm.index + 1) * 5 + rng.next() * 16));
  if (['B', 'F', 'H'].includes(code)) add('experience', scale * magnitude * (12 + (state.progression?.level ?? 1) * 3 + rng.next() * 10));
  if (code === 'C') add('sect_reputation', scale * magnitude * (2 + rng.next() * 5));
  if (code === 'D' || code === 'E') add('mood', scale * magnitude * (4 + rng.next() * 7));
  if (code === 'F') add('injury_years', success ? 0 : Math.abs(scale) * (1 + rng.next() * 3));
  if (code === 'G') add('mood', scale * magnitude * (7 + rng.next() * 8));
  if (code === 'H') {
    if (success && option.effects?.gain_item) effects.gain_item = option.effects.gain_item;
    else add('currency_on_death_bonus', scale * magnitude * (4 + rng.next() * 8));
  }
  if (code === 'I') add('currency_on_death_bonus', scale * magnitude * (6 + rng.next() * 12));
  if (!effects.cultivation && !effects.experience && !effects.mood && !effects.sect_reputation && !effects.currency_on_death_bonus && !effects.injury_years) {
    addFloat('exp_mult', success ? 0.08 + rng.next() * 0.12 : 0);
    add('mood', scale * magnitude * 4);
  }
  if (success && option.effects?.gain_skill) effects.gain_skill = option.effects.gain_skill;
  if (success && option.effects?.family) effects.family = option.effects.family;
  return effects;
}

function resolveDecisionOutcome(state, data, rng, event, option = {}) {
  if (!option.successEffects && !option.failureEffects) {
    return {
      dynamic: false,
      success: true,
      text: '此事照原先所择落定。',
      effects: option.effects ?? event.effects ?? {},
      rewards: effectRewards(option.effects ?? event.effects ?? {})
    };
  }
  const successRate = typeof option.successRate === 'number' ? option.successRate : 0.65;
  const success = rng.next() < successRate;
  const effects = success ? (option.successEffects ?? {}) : (option.failureEffects ?? {});
  return {
    dynamic: true,
    success,
    text: success ? (option.successText ?? '此事顺利收束。') : (option.failureText ?? '此事未能如愿。'),
    effects,
    rewards: effectRewards(effects)
  };
}

function effectRewards(effects = {}) {
  const rewards = [];
  const push = (label, value, kind = null) => {
    if (!value) return;
    rewards.push({ label, value: Number(value), kind: kind ?? (value > 0 ? 'gain' : 'loss') });
  };
  push('修为', effects.cultivation);
  push('阅历', effects.experience);
  push('心境', effects.mood);
  push('寿元', effects.lifespan);
  push('机缘', effects.currency_on_death_bonus);
  push('声望', effects.sect_reputation);
  if (effects.injury_years) push('负伤', effects.injury_years, 'loss');
  if (effects.exp_mult) push('顿悟', Math.round(effects.exp_mult * 100));
  return rewards;
}

function applyPassiveCommonEffects(state, data, rng, event) {
  const common = { ...(event.effects ?? {}) };
  delete common.next_event;
  delete common.leave_trace;
  if (Object.keys(common).length) applyEventEffects(state, data, rng, event, common, { skipChain: true });
}

export function applyEventEffects(state, data, rng, event, effects, options = {}) {
  const damping = 1 - Math.min(0.7, (state.shop.levels.still_heart ?? 0) * 0.01);
  if (typeof effects.mood === 'number') state.mood = clamp(state.mood + Math.round(effects.mood * damping), -100, 100);
  if (typeof effects.cultivation === 'number') addCultivation(state, data, effects.cultivation);
  if (typeof effects.experience === 'number') gainExperience(state, effects.experience, event.title ?? '事件');
  if (typeof effects.exp_mult === 'number' && effects.exp_mult !== 1) {
    state.effects.cultivationBoostUntilAge = Math.max(state.effects.cultivationBoostUntilAge, state.player.age + 2);
  }
  if (typeof effects.lifespan === 'number') state.effects.lifespanBonus += effects.lifespan;
  if (typeof effects.currency_on_death_bonus === 'number') state.stats.currencyOnDeathBonus += effects.currency_on_death_bonus;
  if (typeof effects.sect_reputation === 'number') {
    state.sect.reputation += effects.sect_reputation;
    state.stats.sectRank = Math.max(state.stats.sectRank, state.sect.rank);
  }
  if (typeof effects.injury_years === 'number') {
    state.effects.injuryUntilAge = Math.max(state.effects.injuryUntilAge, state.player.age + effects.injury_years);
  }
  for (const flag of effects.set_flags ?? []) {
    state.events.flags[flag] = true;
  }
  if (effects.gain_skill) learnSkill(state, data, effects.gain_skill);
  if (effects.gain_item?.kind === 'equipment') gainEquipment(state, effects.gain_item.id);
  if (effects.family) applyFamilyEffect(state, rng, effects.family);
  if (effects.leave_trace) leaveTrace(state, effects.leave_trace);
  if (!options.skipChain && effects !== event.effects && event.effects?.leave_trace) leaveTrace(state, event.effects.leave_trace);
  if (!options.skipChain && event.effects?.next_event) {
    state.events.queued.push({ eventId: event.effects.next_event, age: state.player.age + 0.25 });
  }
  if (!options.skipChain && effects.next_event) {
    state.events.queued.push({ eventId: effects.next_event, age: state.player.age + 0.25 });
  }
}

function learnSkill(state, data, skillId) {
  if (!state.skills.known.some((skill) => skill.id === skillId)) {
    const skill = data.byId.skill[skillId];
    state.skills.known.push({ id: skillId, mastery: 0 });
    if (!state.skills.activeInner && skill?.kind === 'inner') state.skills.activeInner = skillId;
    addKeyEvent(state, `习得${skill?.name ?? skillId}`);
  }
}

function gainEquipment(state, equipmentId) {
  if (!state.inventory.equipment.includes(equipmentId)) {
    state.inventory.equipment.push(equipmentId);
  }
  recordCollection(state, 'equipment', equipmentId);
}

function applyFamilyEffect(state, rng, family) {
  if (family.action === 'meet_spouse' && !state.family.spouse && state.player.age >= 16) {
    state.family.spouse = {
      name: rng.chance(0.5) ? '柳照雪' : '陈不言',
      bond: 30,
      sinceAge: state.player.age
    };
    addKeyEvent(state, `与${state.family.spouse.name}结缘`);
  }
  if (family.action === 'child_branch' && state.family.children.length > 0) {
    const child = state.family.children[Math.floor(rng.next() * state.family.children.length)];
    child.path = family.branch ?? child.path;
    child.moodCoupling = (child.moodCoupling ?? 0) + 1;
  }
}

function leaveTrace(state, trace) {
  if (!trace) return;
  const normalized = {
    trace_id: trace.trace_id ?? `trace_${Date.now()}_${state.events.traces.length}`,
    type: trace.type ?? 'legend',
    summary: trace.summary ?? '上一世留下未尽因果',
    spawn_condition: trace.spawn_condition ?? { next_life_stage: '青年', prob: 0.35 },
    spawn_event: trace.spawn_event ?? null
  };
  state.events.traces.push(normalized);
  state.events.flags[`trace_${normalized.type}`] = true;
}

export function processQueuedEvents(state, data, rng) {
  const ready = state.events.queued.filter((item) => state.player.age >= item.age);
  state.events.queued = state.events.queued.filter((item) => state.player.age < item.age);
  for (const item of ready.slice(0, 4)) {
    triggerEventById(state, data, rng, item.eventId);
  }
}

export function processTraceSpawns(state, data, rng) {
  const traces = state.events.traces ?? [];
  for (const trace of traces.slice(-12)) {
    const traceId = trace.trace_id ?? `${trace.type}_${traces.indexOf(trace)}`;
    const attemptFlag = `trace_attempt_${safeFlagId(traceId)}`;
    const spawnedFlag = `trace_spawned_${safeFlagId(traceId)}`;
    if (state.events.flags[attemptFlag] || state.events.flags[spawnedFlag]) continue;
    if (!traceSpawnConditionMatches(trace.spawn_condition, state)) continue;
    state.events.flags[attemptFlag] = true;
    const probability = trace.spawn_condition?.prob ?? 0.35;
    if (!rng.chance(probability)) continue;
    state.events.flags[spawnedFlag] = true;
    state.events.flags[`trace_${trace.type ?? 'legend'}`] = true;
    if (trace.spawn_event && data.byId.event[trace.spawn_event]) {
      triggerEventById(state, data, rng, trace.spawn_event);
      return true;
    }
    const spawned = triggerRandomEvent(state, data, rng, (event) => event.category === '跨世留痕' && (!event.trace_type || event.trace_type === trace.type));
    if (!spawned) {
      addLog(state, `前世留痕应验：${trace.summary ?? '旧因果重新浮现。'}`, 'event');
      recordMapIncident(state, data, `留痕:${traceName(trace.type)}`);
    }
    return true;
  }
  return false;
}

function traceSpawnConditionMatches(condition = {}, state) {
  if (condition.next_life_stage) {
    const stages = Array.isArray(condition.next_life_stage) ? condition.next_life_stage : [condition.next_life_stage];
    if (!stages.includes(lifeStage(state.player.age))) return false;
  }
  if (condition.age_range && (state.player.age < condition.age_range[0] || state.player.age > condition.age_range[1])) return false;
  return true;
}

function safeFlagId(id) {
  return String(id).replace(/[^a-zA-Z0-9_\u4e00-\u9fa5-]/g, '_');
}

function traceName(type) {
  const labels = {
    descendant: '血脉',
    relic: '遗宝',
    nemesis: '恩怨',
    legend: '传闻'
  };
  return labels[type] ?? '因果';
}

export function rescueEventForCause(data, cause, rng) {
  const textCause = deathCauseMap[cause] ?? cause;
  const candidates = data.events.filter((event) => event.category === '救命_死里逃生' && event.rescue_cause === textCause);
  return candidates.length ? candidates[Math.floor(rng.next() * candidates.length)] : data.events.find((event) => event.category === '救命_死里逃生');
}
