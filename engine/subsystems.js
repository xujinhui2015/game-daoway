import { clamp, levelThreshold } from './formulas.js';
import { ADVENTURE_START_AGE, SECT_FOUND_MIN_AGE, SECT_JOIN_MIN_AGE } from './constants.js';
import { addCultivation } from './realm.js';
import { addKeyEvent, addLog } from './state.js';

const childNames = ['阿衡', '阿宁', '知微', '望舒', '云起', '照秋', '明河', '归雁'];
const childPaths = ['读书', '习武', '经商', '平庸', '早夭', '横死', '离家出走', '出人头地'];
const regionOpponents = {
  zhongyuan: ['山道恶客', '劫镖悍匪', '破庙邪修', '擂台宿敌'],
  jiangnan: ['水路盗首', '花楼刺客', '湖畔邪修', '夜雨剑客'],
  saiwai: ['边关悍将', '沙场逃卒', '荒原邪修', '黑旗盗众'],
  xiyu: ['雪岭邪修', '驼队盗首', '寒窟守卫', '流沙客'],
  bashu: ['栈道匪首', '雾谷邪修', '毒瘴客', '青崖剑客'],
  lingnan: ['瘴林盗众', '海路凶徒', '古寨邪修', '南荒刀客']
};
const materialDrops = ['破旧兵刃', '残卷页', '兽纹甲片', '药篓', '秘境铜钱', '寒铁碎片'];
const siteLabels = {
  luoxia_cave: '落霞洞',
  ancient_library: '古卷楼',
  rain_lake: '烟雨湖',
  bamboo_manor: '竹里庄',
  wolf_pass: '狼关',
  dust_tomb: '沙尘冢',
  bingfeng_cave: '冰峰洞',
  sand_palace: '流沙宫',
  shu_path: '蜀道',
  fog_valley: '雾谷',
  miasma_marsh: '瘴泽',
  south_sea_ruin: '南海遗墟'
};

function pushMapTrail(state, entry) {
  const map = ensureMapMotion(state);
  const trailEntry = {
    age: Number(state.player.age.toFixed(1)),
    tone: 'map',
    ...entry
  };
  map.trail.push(trailEntry);
  if (map.trail.length > 18) map.trail.splice(0, map.trail.length - 18);
  if (trailEntry.summary) map.lastTrailSummary = trailEntry.summary;
  return trailEntry;
}

export function ensureMapMotion(state) {
  state.map ??= {};
  state.map.discoveredSites ??= [];
  state.map.trail ??= [];
  state.map.travelTick ??= 0;
  state.map.lastSite ??= null;
  return state.map;
}

export function ensureCollections(state) {
  state.collections ??= {};
  state.collections.sects ??= [];
  state.collections.equipment ??= [];
  state.collections.pills ??= [];
  state.collections.sites ??= [];
  state.collections.origins ??= [];
  state.collections.claimedAchievements ??= [];
  if (state.player?.originId) recordCollection(state, 'origins', state.player.originId);
  for (const id of state.inventory?.equipment ?? []) recordCollection(state, 'equipment', id);
  for (const id of state.inventory?.carried ?? []) recordCollection(state, 'equipment', id);
  for (const id of Object.values(state.inventory?.equipped ?? {}).filter(Boolean)) recordCollection(state, 'equipment', id);
  for (const [id, count] of Object.entries(state.inventory?.pills ?? {})) {
    if (count > 0) recordCollection(state, 'pills', id);
  }
  for (const site of state.map?.discoveredSites ?? []) recordCollection(state, 'sites', site);
  if (state.sect?.id) recordCollection(state, 'sects', state.sect.id);
  if (state.sect?.founded && state.sect.customName) recordCollection(state, 'sects', state.sect.customName);
  for (const [id, unlocked] of Object.entries(state.shop?.unlockedOrigins ?? {})) {
    if (unlocked) recordCollection(state, 'origins', id);
  }
  return state.collections;
}

export function recordCollection(state, group, id) {
  if (!id) return false;
  state.collections ??= {};
  state.collections[group] ??= [];
  if (state.collections[group].includes(id)) return false;
  state.collections[group].push(id);
  return true;
}

export function travelToRegion(state, data, regionId, reason = '游历') {
  const map = ensureMapMotion(state);
  const previous = map.regionId;
  const region = data.byId.region[regionId] ?? data.regions[0];
  if (!region) return null;
  map.regionId = region.region_id;
  map.route = region.name;
  map.travelTick += 1;
  const sites = region.secret_sites ?? [];
  const site = sites.length ? sites[map.travelTick % sites.length] : region.name;
  map.lastSite = site;
  if (site && !map.discoveredSites.includes(site)) map.discoveredSites.push(site);
  recordCollection(state, 'sites', site);
  pushMapTrail(state, {
    from: previous,
    to: region.region_id,
    site,
    reason,
    summary: `${state.player.name}动身前往${region.name}，途经${siteLabelFallback(site)}。`
  });
  return region;
}

export function recordMapIncident(state, data, reason = '剧情') {
  const map = ensureMapMotion(state);
  const region = data.byId.region[map.regionId] ?? data.regions[0];
  if (!region) return null;
  const sites = region.secret_sites ?? [];
  map.travelTick += 1;
  const site = sites.length ? sites[(map.travelTick + state.stats.eventsSeen) % sites.length] : region.name;
  map.lastSite = site;
  if (site && !map.discoveredSites.includes(site)) map.discoveredSites.push(site);
  recordCollection(state, 'sites', site);
  pushMapTrail(state, {
    from: region.region_id,
    to: region.region_id,
    site,
    reason,
    summary: `${state.player.name}在${region.name}${siteLabelFallback(site)}留下${reason}的痕迹。`
  });
  return { region, site };
}

export function ensureProgression(state) {
  state.progression ??= {};
  state.progression.level ??= 1;
  state.progression.exp ??= 0;
  state.progression.adventures ??= 0;
  state.progression.victories ??= 0;
  state.progression.defeats ??= 0;
  state.progression.monstersDefeated ??= 0;
  state.progression.insights ??= 0;
  state.progression.nextAdventureAtAge ??= ADVENTURE_START_AGE;
  state.progression.lastAdventure ??= null;
  state.inventory.materials ??= {};
  return state.progression;
}

export function gainExperience(state, amount, reason = '历练') {
  const progression = ensureProgression(state);
  const gained = Math.max(0, Math.floor(amount));
  progression.exp += gained;
  let levels = 0;
  while (progression.level < 120 && progression.exp >= levelThreshold(progression.level)) {
    progression.exp -= levelThreshold(progression.level);
    progression.level += 1;
    levels += 1;
    state.mood = clamp(state.mood + 1, -100, 100);
    addLog(state, `${state.player.name}因${reason}升至${progression.level}级，江湖经验更深一分。`, 'level');
    if (progression.level % 5 === 0) addKeyEvent(state, `历练等级${progression.level}`);
  }
  return { gained, levels };
}

export function selectActiveSkill(state, data, skillId) {
  const known = state.skills.known.find((skill) => skill.id === skillId);
  const skill = data.byId.skill[skillId];
  if (!known || !skill) return { ok: false, reason: 'unknown_skill' };
  if (skill.kind !== 'inner') return { ok: false, reason: 'not_inner_skill' };
  state.skills.activeInner = skillId;
  addLog(state, `${state.player.name}改以${skill.name}为主修内功。`, 'system');
  return { ok: true, skill };
}

export function ensureActiveInner(state, data) {
  const active = state.skills.activeInner;
  if (active && state.skills.known.some((known) => known.id === active && data.byId.skill[known.id]?.kind === 'inner')) return active;
  const fallback = state.skills.known.find((known) => data.byId.skill[known.id]?.kind === 'inner')?.id ?? null;
  state.skills.activeInner = fallback;
  return fallback;
}

function addKnownSkill(state, data, skillId, mastery = 0) {
  if (state.skills.known.some((skill) => skill.id === skillId)) return false;
  state.skills.known.push({ id: skillId, mastery });
  ensureActiveInner(state, data);
  return true;
}

export function updateLifeMilestones(state) {
  const milestones = [
    { age: 6, flag: 'growth_6', text: '六岁识字习礼，初知世间有江湖与仙踪。', tone: 'growth', exp: 8 },
    { age: 12, flag: 'growth_12', text: '十二岁筋骨渐开，开始站桩、读谱、辨认经脉。', tone: 'growth', exp: 18 },
    { age: 14, flag: 'growth_14', text: '十四岁获准离家远行，第一次真正踏入江湖。', tone: 'adventure', exp: 28, key: '少年入江湖' },
    { age: 18, flag: 'growth_18', text: '十八岁行冠礼，拜师、散修或自悟之路都摆在眼前。', tone: 'growth', exp: 38 },
    { age: 25, flag: 'growth_25', text: '二十五岁江湖阅历渐厚，名声与仇怨开始随身而行。', tone: 'adventure', exp: 45 },
    { age: 40, flag: 'growth_40', text: '四十岁以后，心性与筋骨皆成，才真正敢动问天劫之念。', tone: 'choice', exp: 60, key: '四十岁后始问天劫' }
  ];

  for (const milestone of milestones) {
    if (state.player.age < milestone.age || state.events.flags[milestone.flag]) continue;
    state.events.flags[milestone.flag] = true;
    addLog(state, `${state.player.name}${milestone.text}`, milestone.tone);
    if (milestone.key) addKeyEvent(state, milestone.key);
    gainExperience(state, milestone.exp, '成长');
  }
}

export function updateAdventures(state, data, rng) {
  if (state.death || state.isAscended || state.paused) return;
  const progression = ensureProgression(state);
  if (state.player.age < ADVENTURE_START_AGE || state.player.age < progression.nextAdventureAtAge) return;
  resolveAdventure(state, data, rng);
  progression.nextAdventureAtAge = state.player.age + 0.8 + rng.next() * 1.6;
}

export function resolveAdventure(state, data, rng, options = {}) {
  const progression = ensureProgression(state);
  if (state.player.age < ADVENTURE_START_AGE) {
    if (options.manual) addLog(state, `${state.player.name}年岁尚幼，只能在家中打基础。`, 'growth');
    return { ok: false, reason: 'too_young' };
  }
  if (options.manual && state.player.age < progression.nextAdventureAtAge) {
    addLog(state, `${state.player.name}行囊未整，仍需稍候再出门历练。`, 'growth');
    return { ok: false, reason: 'cooldown' };
  }

  const region = data.byId.region[state.map.regionId] ?? data.regions[0];
  const sites = region.secret_sites ?? [];
  const site = sites.length ? sites[(progression.adventures + Math.floor(rng.next() * sites.length)) % sites.length] : region.name;
  const map = ensureMapMotion(state);
  map.travelTick += 1;
  map.lastSite = site;
  if (site && !map.discoveredSites.includes(site)) map.discoveredSites.push(site);
  recordCollection(state, 'sites', site);
  const trailEntry = pushMapTrail(state, {
    from: region.region_id,
    to: region.region_id,
    site,
    reason: options.manual ? '主动历练' : '自动历练'
  });
  const opponents = regionOpponents[region.region_id] ?? regionOpponents.zhongyuan;
  const opponent = opponents[Math.floor(rng.next() * opponents.length)];
  const difficulty = Math.max(1, Math.round(progression.level * 0.85 + state.realm.index * 4 + state.player.age / 12 + rng.next() * 7));
  const power = combatPower(state, data);
  const chance = clamp(0.58 + (power - difficulty) * 0.025 + state.mood * 0.0008, 0.12, 0.94);
  const success = rng.chance(chance);
  const exp = Math.round((success ? 24 : 10) + difficulty * (success ? 6 : 3) + state.realm.index * 5);
  const result = gainExperience(state, exp, success ? '江湖胜战' : '败中求生');

  progression.adventures += 1;
  let foundEquipment = null;
  if (success) {
    progression.victories += 1;
    progression.monstersDefeated += 1 + (rng.chance(0.18) ? 1 : 0);
    state.mood = clamp(state.mood + 2, -100, 100);
    state.sect.reputation += state.sect.id ? 1 + Math.floor(difficulty / 8) : 0;
    const material = materialDrops[Math.floor(rng.next() * materialDrops.length)];
    state.inventory.materials[material] = (state.inventory.materials[material] ?? 0) + 1;
    foundEquipment = maybeDropAdventureEquipment(state, data, rng, region, difficulty);
    addCultivation(state, data, 10 + difficulty * 4);
    maybeSelfComprehendSkill(state, data, rng, difficulty);
    const summary = `${state.player.name}在${region.name}${siteLabelFallback(site)}击退${opponent}，得阅历${exp}${foundEquipment ? `，获${foundEquipment.name}` : ''}。`;
    trailEntry.summary = summary;
    trailEntry.tone = 'adventure';
    trailEntry.opponent = opponent;
    trailEntry.success = true;
    map.lastTrailSummary = summary;
    addLog(state, `${summary}${result.levels ? `连升${result.levels}级。` : ''}`, 'adventure');
  } else {
    progression.defeats += 1;
    state.mood = clamp(state.mood - 4, -100, 100);
    state.effects.injuryUntilAge = Math.max(state.effects.injuryUntilAge, state.player.age + 0.7 + rng.next() * 1.3);
    const summary = `${state.player.name}在${region.name}${siteLabelFallback(site)}遭遇${opponent}失利，负伤脱身，仍得阅历${exp}。`;
    trailEntry.summary = summary;
    trailEntry.tone = 'warning';
    trailEntry.opponent = opponent;
    trailEntry.success = false;
    map.lastTrailSummary = summary;
    addLog(state, summary, 'warning');
  }

  progression.lastAdventure = {
    age: Number(state.player.age.toFixed(1)),
    region: region.name,
    site,
    opponent,
    difficulty,
    chance: Number(chance.toFixed(3)),
    success,
    exp,
    equipmentId: foundEquipment?.id ?? null
  };
  if (options.manual) {
    progression.nextAdventureAtAge = Math.max(progression.nextAdventureAtAge, state.player.age + 0.45);
  }
  if (progression.adventures === 1) addKeyEvent(state, '初次江湖历练');
  return { ok: true, success, exp, difficulty, chance };
}

function siteLabelFallback(site) {
  return site ? `·${siteLabels[site] ?? site}` : '';
}

function maybeDropAdventureEquipment(state, data, rng, region, difficulty) {
  const dropChance = clamp(0.08 + difficulty * 0.004 + (state.progression?.level ?? 1) * 0.0015, 0.08, 0.34);
  if (!rng.chance(dropChance)) return null;
  const preferredWeapons = new Set(region.specialty?.weapons ?? []);
  const owned = new Set(state.inventory.equipment ?? []);
  const regionItems = data.equipment.filter((item) => (
    !owned.has(item.id)
    && (item.source ?? []).includes('relic')
    && (
      (item.slot === 'weapon' && preferredWeapons.has(item.weapon_type))
      || (item.slot !== 'weapon' && rng.chance(0.45))
    )
  ));
  const fallback = data.equipment.filter((item) => !owned.has(item.id) && (item.source ?? []).includes('relic'));
  const pool = regionItems.length ? regionItems : fallback;
  if (!pool.length) return null;
  const item = pool[Math.floor(rng.next() * pool.length)];
  state.inventory.equipment.push(item.id);
  recordCollection(state, 'equipment', item.id);
  return item;
}

function maybeSelfComprehendSkill(state, data, rng, difficulty) {
  if (state.player.age < 18) return false;
  const progression = ensureProgression(state);
  const noSectBonus = state.sect.id || state.sect.founded ? 0 : 0.1;
  const chance = Math.min(0.34, 0.08 + noSectBonus + difficulty * 0.006 + progression.level * 0.002);
  if (!rng.chance(chance)) return false;
  const preferredSources = state.realm.index >= 2 || state.player.age >= 25 ? ['江湖', '秘境'] : ['江湖'];
  const candidates = data.skills.filter((skill) => (
    preferredSources.includes(skill.sect)
    && !state.skills.known.some((known) => known.id === skill.id)
  ));
  if (!candidates.length) return false;
  const skill = candidates[Math.floor(rng.next() * candidates.length)];
  addKnownSkill(state, data, skill.id, 0);
  progression.insights += 1;
  addKeyEvent(state, `自行领悟${skill.name}`);
  addLog(state, `${state.player.name}连番历练后忽有所悟，自行悟出${skill.name}。`, 'level');
  return true;
}

export function combatPower(state, data) {
  const progression = ensureProgression(state);
  const skillPower = state.skills.known.reduce((sum, known) => sum + 0.8 + (known.mastery ?? 0) * 0.9, 0);
  const equipmentPower = Object.values(state.inventory.equipped).reduce((sum, equipmentId) => {
    const item = data.byId.equipment[equipmentId];
    if (!item) return sum;
    const quality = ['凡品', '精品', '宝器', '灵器', '神兵'].indexOf(item.quality);
    const effects = item.effects ?? {};
    const attack = Math.max(0, effects.atk ?? 0) * 0.12;
    const defense = Math.max(0, effects.defense ?? 0) * 0.08;
    return sum + 1 + Math.max(0, quality) * 1.4 + attack + defense;
  }, 0);
  const sectPower = state.sect.id ? Math.max(0, state.sect.rank + 1) * 1.2 : 0;
  return progression.level * 1.15 + state.realm.index * 5 + state.realm.layer * 0.45 + skillPower + equipmentPower + sectPower;
}

export function updateFamily(state, rng, years) {
  if (state.death || state.isAscended) return;
  if (!state.family.spouse && state.player.age >= 18 && state.player.age <= 45 && rng.chance(0.06 * years)) {
    state.family.spouse = {
      name: rng.chance(0.5) ? '柳照雪' : '陈不言',
      bond: 45,
      sinceAge: state.player.age
    };
    state.mood = clamp(state.mood + 6, -100, 100);
    addKeyEvent(state, `与${state.family.spouse.name}结缘`);
    addLog(state, `${state.player.name}与${state.family.spouse.name}结为伴侣，此后江湖路不再独行。`, 'family');
  }
  if (state.family.spouse) {
    state.family.spouse.bond = clamp(state.family.spouse.bond + years * (state.mood >= 0 ? 0.3 : -0.15), 0, 100);
    const canHaveChild = state.player.age >= 18 && state.player.age <= 45 && state.family.children.length < 6;
    if (canHaveChild && rng.chance(0.1 * years * Math.max(0.7, state.family.spouse.bond / 55))) {
      const twins = rng.chance(0.08);
      const count = twins ? 2 : 1;
      for (let i = 0; i < count; i += 1) {
        const child = {
          id: `child_${Date.now()}_${state.family.children.length}_${i}`,
          name: childNames[Math.floor(rng.next() * childNames.length)],
          age: 0,
          path: childPaths[Math.floor(rng.next() * 4)],
          status: '成长',
          moodCoupling: 0
        };
        state.family.children.push(child);
      }
      const text = twins ? '喜得双胞' : '添得一子';
      state.mood = clamp(state.mood + (twins ? 8 : 5), -100, 100);
      addKeyEvent(state, text);
      addLog(state, `${state.player.name}家中${text}，江湖路忽然有了牵挂。`, 'family');
    }
  }

  for (const child of state.family.children) {
    if (child.status === '亡故') continue;
    child.age += years;
    const wholeAge = Math.floor(child.age);
    if (wholeAge > (child.lastCheckedAge ?? -1)) {
      child.lastCheckedAge = wholeAge;
      resolveChildMilestone(state, rng, child);
    }
  }
}

function resolveChildMilestone(state, rng, child) {
  if (child.age < 6 || child.status === '亡故') return;
  if (child.age >= 8 && !child.pathLocked) {
    child.pathLocked = true;
    child.path = childPaths[Math.floor(rng.next() * childPaths.length)];
    addLog(state, `${child.name}走上「${child.path}」之路。`, 'family');
  }
  if (child.path === '早夭' && child.age >= 10 && rng.chance(0.22)) {
    child.status = '亡故';
    state.mood = clamp(state.mood - 18, -100, 100);
    addKeyEvent(state, `${child.name}早夭`);
    addLog(state, `${child.name}早夭，${state.player.name}道心几近崩裂。`, 'danger');
  } else if (child.path === '横死' && child.age >= 14 && rng.chance(0.12)) {
    child.status = '亡故';
    state.mood = clamp(state.mood - 22, -100, 100);
    addKeyEvent(state, `${child.name}横死`);
    addLog(state, `${child.name}卷入江湖仇杀横死，旧恨翻涌。`, 'danger');
  } else if (child.path === '离家出走' && child.age >= 15 && !child.left) {
    child.left = true;
    child.status = '远游';
    state.mood = clamp(state.mood - 7, -100, 100);
    addLog(state, `${child.name}离家远游，只留一封短笺。`, 'family');
  } else if (child.path === '出人头地' && child.age >= 18 && !child.accomplished) {
    child.accomplished = true;
    child.status = '成才';
    state.stats.childrenRaised += 1;
    state.mood = clamp(state.mood + 14, -100, 100);
    addKeyEvent(state, `${child.name}出人头地`);
    addLog(state, `${child.name}在江湖中闯出名声，反哺你的心境。`, 'success');
  }
}

export function updateSkills(state, data, years) {
  for (const known of state.skills.known) {
    const skill = data.byId.skill[known.id];
    if (!skill) continue;
    const key = known.id;
    state.skills.masteryProgress[key] = (state.skills.masteryProgress[key] ?? 0) + years * (1 + state.realm.index * 0.12);
    const threshold = 8 + (known.mastery ?? 0) * 10;
    if (state.skills.masteryProgress[key] >= threshold && (known.mastery ?? 0) < skill.mastery_levels.length - 1) {
      state.skills.masteryProgress[key] = 0;
      known.mastery = (known.mastery ?? 0) + 1;
      addLog(state, `${skill.name}精进至${skill.mastery_levels[known.mastery]}。`, 'system');
    }
  }
}

export function updateAlchemy(state, data, rng, years) {
  const region = data.byId.region[state.map.regionId] ?? data.regions[0];
  const herbs = region.specialty?.herbs ?? [];
  if (herbs.length && rng.chance(Math.min(0.75, years * 0.25))) {
    const herb = herbs[Math.floor(rng.next() * herbs.length)];
    state.inventory.herbs[herb] = (state.inventory.herbs[herb] ?? 0) + 1;
    recordMapIncident(state, data, `采药:${herb}`);
  }
  for (const pill of data.pills) {
    const needed = (pill.recipe?.herbs ?? []).map((entry) => {
      const [name, countText] = entry.split('x');
      return { name, count: Number(countText) || 1 };
    });
    if (!needed.length) continue;
    const canCraft = needed.every((need) => (state.inventory.herbs[need.name] ?? 0) >= need.count);
    if (canCraft && rng.chance((pill.recipe.success_rate ?? 0.5) * Math.min(1, years * 0.2))) {
      for (const need of needed) state.inventory.herbs[need.name] -= need.count;
      state.inventory.pills[pill.id] = (state.inventory.pills[pill.id] ?? 0) + 1;
      recordCollection(state, 'pills', pill.id);
      recordMapIncident(state, data, `炼丹:${pill.name}`);
      addLog(state, `炼成${pill.name}，已收入丹匣。`, 'system');
      break;
    }
  }
}

export function usePill(state, pillOrData, pillIdOrOptions = {}, maybeOptions = {}) {
  const pill = typeof pillOrData === 'object' && pillOrData.id
    ? pillOrData
    : pillOrData?.byId?.pill?.[pillIdOrOptions];
  const options = typeof pillIdOrOptions === 'string' ? maybeOptions : pillIdOrOptions;
  if (!pill) return { ok: false, reason: 'unknown_pill' };
  if ((state.inventory.pills[pill.id] ?? 0) <= 0) return { ok: false, reason: 'missing_pill' };
  recordCollection(state, 'pills', pill.id);
  const effect = pill.effect ?? {};
  let used = false;
  if (effect.heal_injury_years && state.effects.injuryUntilAge > state.player.age) {
    state.effects.injuryUntilAge = Math.max(state.player.age, state.effects.injuryUntilAge - effect.heal_injury_years);
    used = true;
  }
  if (effect.lifespan) {
    state.effects.lifespanBonus += effect.lifespan;
    used = true;
  }
  if (effect.cultivate_speed) {
    state.effects.cultivationBoostUntilAge = Math.max(state.effects.cultivationBoostUntilAge, state.player.age + 1.5);
    used = true;
  }
  if (effect.tribulation) {
    state.effects.tribulationBoostUntilAge = Math.max(state.effects.tribulationBoostUntilAge, state.player.age + 1.2);
    used = true;
  }
  if (effect.mood) {
    state.mood = clamp(state.mood + effect.mood, -100, 100);
    used = true;
  }
  if (used) {
    state.inventory.pills[pill.id] -= 1;
    addLog(state, `${options.automatic ? '自动服用' : '服用'}${pill.name}。`, 'system');
    return { ok: true, pill };
  }
  return { ok: false, reason: 'no_applicable_effect' };
}

export function autoUsePills(state, data) {
  let used = 0;
  let guard = 0;
  while (guard < 20) {
    guard += 1;
    const pill = data.pills.find((item) => (state.inventory.pills[item.id] ?? 0) > 0 && shouldAutoUsePill(state, item));
    if (!pill) break;
    const result = usePill(state, pill, { automatic: true });
    if (!result.ok) break;
    used += 1;
  }
  return used;
}

function shouldAutoUsePill(state, pill) {
  const effect = pill.effect ?? {};
  if (effect.heal_injury_years && state.effects.injuryUntilAge > state.player.age) return true;
  if (effect.lifespan) return true;
  if (effect.cultivate_speed && state.effects.cultivationBoostUntilAge <= state.player.age) return true;
  if (effect.tribulation && state.realm.needsTribulation && state.effects.tribulationBoostUntilAge <= state.player.age) return true;
  if (effect.mood && state.mood < 85) return true;
  return false;
}

export function maybeRequestRouteChoice(state, data) {
  if (state.player.age < state.map.nextRouteChoiceAge || state.events.decisions.some((decision) => decision.system === 'route')) return;
  const discoveredSites = new Set([...(state.collections?.sites ?? []), ...(state.map.discoveredSites ?? [])]);
  state.events.decisions.push({
    id: `route_${Date.now()}`,
    system: 'route',
    rendered: {
      title: '游历方向',
      text: '下一段江湖路要往何处去？时间会暂驻在此，待你定夺后再继续。',
      options: data.regions.slice(0, 6).map((region, index) => {
        const sites = region.secret_sites ?? [];
        const discoveredCount = sites.filter((site) => discoveredSites.has(site)).length;
        const pools = (region.event_pool ?? []).map(routeCategoryLabel).join(' / ');
        const current = region.region_id === state.map.regionId;
        return {
          label: `${region.name}${current ? '（当前）' : ''}`,
          value: region.region_id,
          index,
          hint: `${discoveredCount}/${sites.length} 秘境${discoveredCount ? `，已发现 ${sites.filter((site) => discoveredSites.has(site)).map(routeSiteLabel).join('、')}` : ''} · ${pools}`
        };
      })
    },
    createdAtAge: state.player.age,
    expiresAtAge: state.player.age + 2,
    defaultOption: 'random'
  });
  state.map.nextRouteChoiceAge = state.player.age + 7;
}

export function resolveRouteDecision(state, data, rng, decision, optionIndex = null) {
  const options = decision.rendered.options ?? [];
  const selected = optionIndex == null || optionIndex === 'random'
    ? options[Math.floor(rng.next() * options.length)]
    : options[optionIndex] ?? options[0];
  const region = travelToRegion(state, data, selected?.value ?? state.map.regionId, '改道');
  addLog(state, `${state.player.name}改道${region?.name ?? selected?.label ?? '旧路'}游历。`, 'map');
  return { ok: true, selected };
}

function routeCategoryLabel(category) {
  return String(category ?? '')
    .replace(/^[A-I]_/, '')
    .replace('救命_死里逃生', '死里逃生')
    .replace('人生阶段氛围', '人生氛围');
}

function routeSiteLabel(site) {
  const labels = {
    luoxia_cave: '落霞洞',
    ancient_library: '古卷楼',
    rain_lake: '烟雨湖',
    bamboo_manor: '竹里庄',
    wolf_pass: '狼关',
    dust_tomb: '沙尘冢',
    bingfeng_cave: '冰峰洞',
    sand_palace: '流沙宫',
    shu_path: '蜀道',
    fog_valley: '雾谷',
    miasma_marsh: '瘴泽',
    south_sea_ruin: '南海遗墟'
  };
  return labels[site] ?? site ?? '无名地';
}

export function joinSect(state, data, sectId) {
  const sect = data.byId.sect[sectId];
  if (!sect) return { ok: false, reason: 'unknown_sect' };
  if (state.player.age < SECT_JOIN_MIN_AGE) return { ok: false, reason: 'too_young' };
  if (state.sect.id && !state.sect.betrayed) return { ok: false, reason: 'already_in_sect' };
  state.sect.id = sectId;
  state.sect.rank = 0;
  state.sect.reputation = 0;
  state.sect.betrayed = false;
  recordCollection(state, 'sects', sectId);
  for (const skillId of sect.skills.slice(0, 2)) {
    addKnownSkill(state, data, skillId, 0);
  }
  if (sect.region && sect.region !== state.map.regionId) {
    travelToRegion(state, data, sect.region, `拜山:${sect.name}`);
  } else {
    recordMapIncident(state, data, `拜入:${sect.name}`);
  }
  ensureActiveInner(state, data);
  addKeyEvent(state, `拜入${sect.name}`);
  addLog(state, `${state.player.name}拜入${sect.name}，从${sect.ranks[0]}做起。`, 'sect');
  return { ok: true };
}

export function advanceSect(state, data) {
  if (!state.sect.id) return { ok: false, reason: 'no_sect' };
  const sect = data.byId.sect[state.sect.id];
  if (!sect) return { ok: false, reason: 'unknown_sect' };
  const need = (state.sect.rank + 1) * 20;
  if (state.sect.reputation < need) return { ok: false, reason: 'not_enough_reputation', need };
  if (state.sect.rank >= sect.ranks.length - 1) return { ok: false, reason: 'max_rank' };
  state.sect.reputation -= need;
  state.sect.rank += 1;
  state.stats.sectRank = Math.max(state.stats.sectRank, state.sect.rank);
  recordMapIncident(state, data, `门派晋升:${sect.name}`);
  addKeyEvent(state, `晋升${sect.ranks[state.sect.rank]}`);
  addLog(state, `${state.player.name}在${sect.name}晋升为${sect.ranks[state.sect.rank]}。`, 'sect');
  return { ok: true };
}

export function betraySect(state, data) {
  if (!state.sect.id) return { ok: false, reason: 'no_sect' };
  const sect = data.byId.sect[state.sect.id];
  state.sect.betrayed = true;
  state.sect.id = null;
  state.sect.rank = -1;
  state.mood = clamp(state.mood - 8, -100, 100);
  state.events.flags.betrayed_sect = true;
  recordMapIncident(state, data, `叛门:${sect?.name ?? '旧门'}`);
  addKeyEvent(state, `叛出${sect?.name ?? '门派'}`);
  addLog(state, `${state.player.name}叛出${sect?.name ?? '旧门'}，追杀随之而来。`, 'danger');
  return { ok: true };
}

export function foundSect(state, data = null) {
  if (state.sect.founded) return { ok: false, reason: 'already_founded' };
  if (state.player.age < SECT_FOUND_MIN_AGE) return { ok: false, reason: 'too_young' };
  if (state.realm.index < 2) return { ok: false, reason: 'realm_too_low' };
  state.sect.id = null;
  state.sect.customName = `${state.player.name.slice(0, 1)}山别院`;
  state.sect.rank = 4;
  state.sect.founded = true;
  state.stats.sectRank = Math.max(state.stats.sectRank, 4);
  recordCollection(state, 'sects', state.sect.customName);
  if (data) recordMapIncident(state, data, `开山立派:${state.sect.customName}`);
  addKeyEvent(state, `自立${state.sect.customName}`);
  addLog(state, `${state.player.name}开山立派，号${state.sect.customName}。`, 'sect');
  return { ok: true };
}

export function equipItem(state, data, equipmentId) {
  const item = data.byId.equipment[equipmentId];
  if (!item || !state.inventory.equipment.includes(equipmentId)) return { ok: false, reason: 'missing_equipment' };
  recordCollection(state, 'equipment', equipmentId);
  state.inventory.equipped[item.slot] = equipmentId;
  addLog(state, `装备${item.name}。`, 'system');
  return { ok: true };
}

export function autoEquipBestEquipment(state, data) {
  let changed = 0;
  for (const equipmentId of state.inventory.equipment ?? []) {
    const item = data.byId.equipment[equipmentId];
    if (!item?.slot) continue;
    const currentId = state.inventory.equipped[item.slot];
    if (currentId === equipmentId) continue;
    const current = currentId ? data.byId.equipment[currentId] : null;
    if (!current || equipmentScore(item) > equipmentScore(current)) {
      state.inventory.equipped[item.slot] = equipmentId;
      recordCollection(state, 'equipment', equipmentId);
      addLog(state, `自动换上${item.name}。`, 'system');
      changed += 1;
    }
  }
  return changed;
}

function equipmentScore(item) {
  const qualityScore = Math.max(0, ['凡品', '精品', '宝器', '灵器', '神兵'].indexOf(item.quality)) * 8;
  const effects = item.effects ?? {};
  return qualityScore
    + Math.max(0, effects.atk ?? 0) * 1.2
    + Math.max(0, effects.defense ?? 0)
    + Math.abs(Math.min(0, effects.death_risk ?? 0)) * 9000
    + Math.max(0, effects.cultivate_speed ?? 0) * 120;
}

export function carryAcrossLife(state, data, equipmentId) {
  const item = data.byId.equipment[equipmentId];
  const limit = state.shop.levels.reincarnation_mark ?? 0;
  if (!item?.transferable || limit <= state.inventory.carried.length) return { ok: false };
  if (!state.inventory.carried.includes(equipmentId)) state.inventory.carried.push(equipmentId);
  recordCollection(state, 'equipment', equipmentId);
  return { ok: true };
}
