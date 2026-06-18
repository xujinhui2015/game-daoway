export function getShopLevel(state, itemId) {
  return state.shop.levels[itemId] ?? 0;
}

export function shopCost(item, level) {
  if (level >= item.max_level) return Infinity;
  return Math.ceil(item.c0 * (item.b ** level));
}

export function purchaseShopItem(state, data, itemId) {
  const item = data.byId.shop[itemId];
  if (!item) return { ok: false, reason: 'unknown_item' };
  const level = getShopLevel(state, itemId);
  if (level >= item.max_level) return { ok: false, reason: 'max_level' };
  const cost = shopCost(item, level);
  const currency = item.currency === 'immortal' ? 'immortal' : 'fate';
  if (state.currencies[currency] < cost) return { ok: false, reason: 'not_enough_currency', cost };
  state.currencies[currency] -= cost;
  state.shop.levels[itemId] = level + 1;
  if (item.effect?.unlock_origin) {
    state.shop.unlockedOrigins[item.effect.unlock_origin] = true;
    state.collections ??= {};
    state.collections.origins ??= [];
    if (!state.collections.origins.includes(item.effect.unlock_origin)) {
      state.collections.origins.push(item.effect.unlock_origin);
    }
  }
  return { ok: true, item, cost, level: level + 1 };
}

export function sumShopEffect(state, data, effectName) {
  return data.shop.reduce((sum, item) => {
    const level = getShopLevel(state, item.id);
    const value = item.effect?.[effectName];
    return sum + (typeof value === 'number' ? value * level : 0);
  }, 0);
}

export function isOriginUnlocked(state, origin) {
  if (origin.id === 'hanmen') return true;
  return Boolean(state.shop.unlockedOrigins[origin.id]);
}
