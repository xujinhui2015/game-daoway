import { addLog } from './state.js';

const GROUPS = [
  { id: 'sects', title: '门派游历', iconName: 'sect', thresholds: [1, 3, 'all'] },
  { id: 'equipment', title: '装备收集', iconName: 'equipment', thresholds: [3, 15, 'all'] },
  { id: 'pills', title: '丹药图鉴', iconName: 'pill', thresholds: [2, 12, 'all'] },
  { id: 'origins', title: '出身解锁', iconName: 'lamp', thresholds: [1, 3, 'all'] },
  { id: 'sites', title: '秘境足迹', iconName: 'map', thresholds: [1, 6, 'all'] },
  { id: 'history', title: '命书史册', iconName: 'history', thresholds: [1, 3, 10] }
];

export function achievementProgress(state, data) {
  const collections = state.collections ?? {};
  collections.claimedAchievements ??= [];
  const collected = buildCollectedSets(state, data, collections);
  const groups = GROUPS.map((config) => {
    const source = collected[config.id];
    const total = source.total;
    const done = Math.min(source.done, total);
    const milestones = config.thresholds.map((rawThreshold) => {
      const threshold = rawThreshold === 'all' ? total : Math.min(Number(rawThreshold), total);
      const id = `${config.id}_${threshold}`;
      const claimed = collections.claimedAchievements.includes(id);
      const unlocked = threshold > 0 && done >= threshold;
      return {
        id,
        label: rawThreshold === 'all' ? '圆满' : `${threshold}`,
        threshold,
        unlocked,
        claimed,
        reward: rewardFor(config.id, threshold, total),
        title: `${config.title} ${rawThreshold === 'all' ? '圆满' : threshold}`
      };
    }).filter((milestone, index, list) => milestone.threshold > 0 && list.findIndex((item) => item.id === milestone.id) === index);
    return {
      ...config,
      done,
      total,
      detail: source.detail,
      milestones
    };
  });
  const totalDone = groups.reduce((sum, group) => sum + group.done, 0);
  const totalAll = groups.reduce((sum, group) => sum + group.total, 0);
  const claimable = groups.flatMap((group) => group.milestones.filter((milestone) => milestone.unlocked && !milestone.claimed));
  return { groups, totalDone, totalAll, claimable };
}

export function claimAchievement(state, data, achievementId) {
  const progress = achievementProgress(state, data);
  const milestone = progress.groups.flatMap((group) => group.milestones).find((item) => item.id === achievementId);
  if (!milestone) return { ok: false, reason: 'unknown_achievement' };
  if (!milestone.unlocked) return { ok: false, reason: 'locked' };
  state.collections ??= {};
  state.collections.claimedAchievements ??= [];
  if (state.collections.claimedAchievements.includes(achievementId)) return { ok: false, reason: 'claimed' };
  state.collections.claimedAchievements.push(achievementId);
  state.currencies.fate += milestone.reward.fate;
  state.currencies.immortal += milestone.reward.immortal;
  addLog(state, `领取成就「${milestone.title}」，得机缘${milestone.reward.fate}${milestone.reward.immortal ? `、仙缘${milestone.reward.immortal}` : ''}。`, 'success');
  return { ok: true, milestone };
}

function buildCollectedSets(state, data, collections) {
  const sectIds = new Set(collections.sects ?? []);
  if (state.sect?.id) sectIds.add(state.sect.id);
  const sectDetail = [
    ...data.sects.map((sect) => ({ id: sect.id, name: sect.name, done: sectIds.has(sect.id), kind: 'sect', image: `sects/${sect.name}` })),
    ...(state.sect?.founded ? [{ id: state.sect.customName, name: state.sect.customName, done: true, kind: 'sect', image: 'scenes/sect-inner-court' }] : [])
  ];

  const equipmentIds = new Set([
    ...(collections.equipment ?? []),
    ...(state.inventory?.equipment ?? []),
    ...(state.inventory?.carried ?? []),
    ...Object.values(state.inventory?.equipped ?? {}).filter(Boolean)
  ]);

  const pillIds = new Set([
    ...(collections.pills ?? []),
    ...Object.entries(state.inventory?.pills ?? {}).filter(([, count]) => count > 0).map(([id]) => id)
  ]);

  const originIds = new Set([
    ...(collections.origins ?? []),
    ...Object.entries(state.shop?.unlockedOrigins ?? {}).filter(([, value]) => value).map(([id]) => id)
  ]);

  const siteIds = new Set([...(collections.sites ?? []), ...(state.map?.discoveredSites ?? [])]);

  return {
    sects: {
      done: sectIds.size,
      total: data.sects.length + (state.sect?.founded ? 1 : 0),
      detail: sectDetail
    },
    equipment: {
      done: equipmentIds.size,
      total: data.equipment.length,
      detail: data.equipment.map((item) => ({ id: item.id, name: item.name, done: equipmentIds.has(item.id), kind: 'equipment' }))
    },
    pills: {
      done: pillIds.size,
      total: data.pills.length,
      detail: data.pills.map((pill) => ({ id: pill.id, name: pill.name, done: pillIds.has(pill.id), kind: 'pill' }))
    },
    origins: {
      done: originIds.size,
      total: data.origins.length,
      detail: data.origins.map((origin) => ({ id: origin.id, name: origin.name, done: originIds.has(origin.id), kind: 'origin' }))
    },
    sites: {
      done: siteIds.size,
      total: data.regions.reduce((sum, region) => sum + region.secret_sites.length, 0),
      detail: data.regions.flatMap((region) => region.secret_sites.map((site) => ({ id: site, name: siteLabel(site), done: siteIds.has(site), kind: 'site', regionId: region.region_id })))
    },
    history: {
      done: state.history.length,
      total: Math.max(10, state.history.length),
      detail: state.history.slice(-10).map((entry) => ({ id: String(entry.life_no), name: `第${entry.life_no}世 ${entry.epithet}`, done: true, kind: 'history' }))
    }
  };
}

function rewardFor(groupId, threshold, total) {
  const scale = groupId === 'equipment' || groupId === 'pills' ? 14 : groupId === 'history' ? 32 : 22;
  const final = total > 0 && threshold >= total;
  return {
    fate: Math.max(20, threshold * scale),
    immortal: final && (groupId === 'history' || groupId === 'sites' || groupId === 'equipment' || groupId === 'pills') ? 1 : 0
  };
}

function siteLabel(site) {
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
