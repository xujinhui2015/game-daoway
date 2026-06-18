import { AUTOSAVE_INTERVAL_MS } from '../engine/constants.js';
import { achievementProgress, claimAchievement } from '../engine/achievements.js';
import { applyOfflineProgress, createGame, endLife } from '../engine/engine.js';
import { eventCandidates, resolveDecision, resolveModalEvent } from '../engine/events.js';
import { currentRealmName, layerThreshold } from '../engine/realm.js';
import { saveGame, clearSave } from '../engine/save.js';
import { addLog } from '../engine/state.js';
import { canAscend, canOpenTribulationGate, deathRiskPerYear, levelThreshold, lifeStage, maxLifespan, tribulationChance, tribulationMinimumAge } from '../engine/formulas.js';
import { isOriginUnlocked, purchaseShopItem, shopCost } from '../engine/shop.js';
import { advanceSect, betraySect, carryAcrossLife, equipItem, foundSect, joinSect, resolveAdventure, selectActiveSkill, travelToRegion, usePill } from '../engine/subsystems.js';

const ASSET_ROOT = 'assets/generated';
const ASSET_EXTENSION = 'png';
const SIMULATION_SPEEDS = [1, 4];
const regionSceneVariants = {
  zhongyuan: ['zhongyuan-market', 'zhongyuan-temple-road', 'zhongyuan-ancient-library', 'zhongyuan-luoxia-cave'],
  jiangnan: ['jiangnan-rain-lake', 'jiangnan-bamboo-manor', 'jiangnan-water-town', 'jiangnan-night-bridge'],
  saiwai: ['saiwai-wolf-pass', 'saiwai-dust-tomb', 'saiwai-border-camp', 'saiwai-storm-steppe'],
  xiyu: ['xiyu-bingfeng-cave', 'xiyu-sand-palace', 'xiyu-snow-pass', 'xiyu-caravan-inn'],
  bashu: ['bashu-shu-path', 'bashu-fog-valley', 'bashu-cliff-village', 'bashu-plank-rain'],
  lingnan: ['lingnan-miasma-marsh', 'lingnan-south-sea-ruin', 'lingnan-banyan-village', 'lingnan-tide-temple']
};
const cultivationScenes = ['cultivation', 'cave-meditation', 'sword-terrace', 'alchemy-hall', 'spirit-spring', 'sect-inner-court'];
const immortalScenes = ['immortal', 'immortal-cloud-gate', 'immortal-moon-palace', 'immortal-star-river', 'immortal-jade-terrace'];
const heroPortraits = {
  male: {
    child: ['hero-youth'],
    youth: ['hero-youth', 'hero-wanderer'],
    adult: ['hero-mortal', 'hero-wanderer', 'hero-sect-disciple'],
    elder: ['hero-weathered', 'hero-grandmaster'],
    cultivation: ['hero-cultivation', 'hero-sword-cultivator', 'hero-alchemist', 'hero-grandmaster', 'hero-tribulation'],
    immortal: ['hero-immortal', 'hero-cloud-immortal', 'hero-moon-robed', 'hero-ascended-warrior']
  },
  female: {
    child: ['hero-female-child'],
    youth: ['hero-female-youth', 'hero-female-wanderer'],
    adult: ['hero-female-mortal', 'hero-female-wanderer', 'hero-female-sect-disciple'],
    elder: ['hero-female-weathered', 'hero-female-grandmaster'],
    cultivation: ['hero-female-cultivation', 'hero-female-grandmaster'],
    immortal: ['hero-female-immortal']
  }
};
const mapNodes = {
  zhongyuan: { x: 52, y: 34, scene: 'zhongyuan-ancient-library' },
  jiangnan: { x: 76, y: 48, scene: 'jiangnan-rain-lake' },
  lingnan: { x: 68, y: 74, scene: 'lingnan-south-sea-ruin' },
  bashu: { x: 36, y: 68, scene: 'bashu-fog-valley' },
  saiwai: { x: 26, y: 34, scene: 'saiwai-wolf-pass' },
  xiyu: { x: 18, y: 56, scene: 'xiyu-sand-palace' }
};
const siteNodes = {
  luoxia_cave: { x: 48, y: 43 },
  ancient_library: { x: 58, y: 27 },
  rain_lake: { x: 71, y: 55 },
  bamboo_manor: { x: 82, y: 40 },
  wolf_pass: { x: 20, y: 28 },
  dust_tomb: { x: 31, y: 43 },
  bingfeng_cave: { x: 14, y: 50 },
  sand_palace: { x: 24, y: 63 },
  shu_path: { x: 30, y: 73 },
  fog_valley: { x: 43, y: 62 },
  miasma_marsh: { x: 61, y: 80 },
  south_sea_ruin: { x: 76, y: 70 }
};

export function initApp(root, data, initialGame, options = {}) {
  let game = initialGame;
  let activeTab = 'log';
  let lastRender = 0;
  let lastSave = 0;
  let lastFrame = performance.now();
  let lastStructuralSignature = '';
  let lastPanelSignature = '';
  let lastPendingDecisionSignature = '';
  let lastHeroSignature = '';
  let mapOpen = false;
  let imagePreview = null;
  let historyPreview = null;
  let deathOpen = false;
  let helpOpen = false;
  let clearConfirmOpen = false;

  if (game) {
    normalizeSpeed(game.state);
    applyOfflineProgress(game);
  }

  root.addEventListener('error', (event) => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement)) return;
    const fallback = image.dataset.fallbackSrc;
    if (!fallback) return;
    const fallbackUrl = new URL(fallback, window.location.href).href;
    if (image.src !== fallbackUrl) {
      image.src = fallback;
      delete image.dataset.fallbackSrc;
    }
  }, true);

  function setGame(nextGame) {
    game = nextGame;
    if (game) normalizeSpeed(game.state);
    if (game) saveGame(game.state);
    renderNow();
  }

  function setSpeed(speed) {
    if (!game) return;
    game.state.settings.speed = speed;
    saveGame(game.state);
    refreshLiveDom();
  }

  function cycleSpeed(direction) {
    if (!game) return;
    const current = SIMULATION_SPEEDS.indexOf(game.state.settings.speed);
    const currentIndex = current >= 0 ? current : nearestSpeedIndex(game.state.settings.speed);
    const nextIndex = Math.max(0, Math.min(SIMULATION_SPEEDS.length - 1, currentIndex + direction));
    setSpeed(SIMULATION_SPEEDS[nextIndex] ?? game.state.settings.speed);
  }

  function manualAdventure() {
    if (!game) return;
    resolveAdventure(game.state, data, game.rng, { manual: true });
    saveGame(game.state);
    renderNow();
  }

  function switchTab(tabId, { focusNav = false } = {}) {
    if (!tabs().some((tab) => tab.id === tabId)) return false;
    activeTab = tabId;
    renderPanelNow();
    refreshLiveDom();
    syncTabNavigation(focusNav);
    return true;
  }

  function cycleTab(direction) {
    const list = tabs();
    const current = Math.max(0, list.findIndex((tab) => tab.id === activeTab));
    const next = list[(current + direction + list.length) % list.length];
    if (next) switchTab(next.id, { focusNav: true });
  }

  function openImagePreview(target) {
    imagePreview = {
      src: target.dataset.previewSrc,
      title: target.dataset.previewTitle ?? target.alt ?? '图片'
    };
    renderNow();
  }

  root.addEventListener('click', (event) => {
    const previewTarget = event.target.closest('[data-preview-src]');
    if (previewTarget) {
      openImagePreview(previewTarget);
      return;
    }
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    if (action === 'start') {
      const form = root.querySelector('[data-role="setup"]');
      const formData = new FormData(form);
      setGame(createGame(data, {
        name: formData.get('name'),
        gender: formData.get('gender'),
        originId: formData.get('originId'),
        regionId: formData.get('regionId'),
        verify: options.verify
      }));
      return;
    }
    if (!game) return;
    let renderMode = 'full';
    if (action === 'tab') {
      switchTab(target.dataset.tab);
      return;
    }
    if (action === 'open-decisions') {
      switchTab('decisions', { focusNav: true });
      return;
    }
    if (action === 'speed') {
      game.state.settings.speed = Number(target.dataset.speed);
      renderMode = 'live';
    }
    if (action === 'advance') game.advanceYears(Number(target.dataset.years), { force: true });
    if (action === 'adventure') resolveAdventure(game.state, data, game.rng, { manual: true });
    if (action === 'tribulation') game.resolveTribulation(target.dataset.tribulation);
    if (action === 'modal-option') resolveModalEvent(game.state, data, game.rng, Number(target.dataset.option));
    if (action === 'decision-option') resolveDecision(game.state, data, game.rng, target.dataset.decision, Number(target.dataset.option));
    if (action === 'open-map') {
      mapOpen = true;
      renderNow();
      return;
    }
    if (action === 'close-map') {
      mapOpen = false;
      renderNow();
      return;
    }
    if (action === 'open-help') {
      helpOpen = true;
      renderNow();
      return;
    }
    if (action === 'close-help') {
      helpOpen = false;
      renderNow();
      return;
    }
    if (action === 'open-clear-confirm') {
      clearConfirmOpen = true;
      renderNow();
      return;
    }
    if (action === 'close-clear-confirm') {
      clearConfirmOpen = false;
      renderNow();
      return;
    }
    if (action === 'confirm-clear-save') {
      clearConfirmOpen = false;
      clearSave();
      game = null;
      renderNow();
      return;
    }
    if (action === 'grant-fate') {
      game.state.currencies.fate += 5000000;
      addLog(game.state, '命书拨转，额外获得机缘5000000。', 'success');
      saveGame(game.state);
      renderNow();
      return;
    }
    if (action === 'grant-immortal') {
      game.state.currencies.immortal += 5000000;
      addLog(game.state, '命书拨转，额外获得仙缘5000000。', 'success');
      saveGame(game.state);
      renderNow();
      return;
    }
    if (action === 'close-image-preview') {
      imagePreview = null;
      renderNow();
      return;
    }
    if (action === 'history-detail') {
      historyPreview = game.state.history.find((entry) => String(entry.life_no) === target.dataset.life) ?? null;
      renderNow();
      return;
    }
    if (action === 'close-history-preview') {
      historyPreview = null;
      renderNow();
      return;
    }
    if (action === 'open-death') {
      deathOpen = true;
      renderNow();
      return;
    }
    if (action === 'close-death') {
      deathOpen = false;
      renderNow();
      return;
    }
    if (action === 'shop-buy') purchaseShopItem(game.state, data, target.dataset.item);
    if (action === 'claim-achievement') claimAchievement(game.state, data, target.dataset.achievement);
    if (action === 'reincarnate') {
      deathOpen = false;
      historyPreview = null;
      helpOpen = false;
      game.reincarnate({ originId: selectedOrigin(), regionId: selectedRegion() });
    }
    if (action === 'join-sect') joinSect(game.state, data, target.dataset.sect);
    if (action === 'advance-sect') advanceSect(game.state, data);
    if (action === 'betray-sect') betraySect(game.state, data);
    if (action === 'found-sect') foundSect(game.state, data);
    if (action === 'active-skill') selectActiveSkill(game.state, data, target.dataset.skill);
    if (action === 'equip') equipItem(game.state, data, target.dataset.item);
    if (action === 'carry') carryAcrossLife(game.state, data, target.dataset.item);
    if (action === 'use-pill') usePill(game.state, data, target.dataset.pill);
    if (action === 'route') {
      const region = travelToRegion(game.state, data, target.dataset.region, '手动改道');
      addLog(game.state, `${game.state.player.name}手动改道${region?.name ?? '旧路'}游历。`, 'map');
    }
    saveGame(game.state);
    if (renderMode === 'full') {
      renderNow();
    } else {
      refreshLiveDom();
    }
  });

  window.addEventListener('keydown', (event) => {
    if (isTextEntry(event.target)) return;
    const previewTarget = event.target?.closest?.('[data-preview-src]');
    if (previewTarget && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      openImagePreview(previewTarget);
      return;
    }
    if (event.key === 'Escape') {
      if (imagePreview || historyPreview || mapOpen || deathOpen || helpOpen || clearConfirmOpen) {
        imagePreview = null;
        historyPreview = null;
        mapOpen = false;
        deathOpen = false;
        helpOpen = false;
        clearConfirmOpen = false;
        renderNow();
      }
      return;
    }
    if (!game) return;
    const lowerKey = event.key.toLowerCase();
    if (lowerKey === 'a') {
      event.preventDefault();
      manualAdventure();
      return;
    }
    if (event.key === ',' || event.key === '<') {
      event.preventDefault();
      cycleSpeed(-1);
      return;
    }
    if (event.key === '.' || event.key === '>') {
      event.preventDefault();
      cycleSpeed(1);
      return;
    }
    if (lowerKey === 'm') {
      event.preventDefault();
      mapOpen = !mapOpen;
      renderNow();
      return;
    }
    if (lowerKey === 'h') {
      event.preventDefault();
      helpOpen = !helpOpen;
      renderNow();
      return;
    }
    if (lowerKey === 'q') {
      event.preventDefault();
      cycleTab(-1);
      return;
    }
    if (lowerKey === 'e') {
      event.preventDefault();
      cycleTab(1);
      return;
    }
    if (/^[1-9]$/.test(event.key)) {
      const tab = tabs()[Number(event.key) - 1];
      if (!tab) return;
      event.preventDefault();
      switchTab(tab.id, { focusNav: true });
    }
  });

  function selectedOrigin() {
    return root.querySelector('[name="nextOriginId"]')?.value ?? game?.state.player.originId ?? 'hanmen';
  }

  function selectedRegion() {
    return root.querySelector('[name="nextRegionId"]')?.value ?? game?.state.player.regionId ?? 'zhongyuan';
  }

  function isTextEntry(target) {
    if (!target) return false;
    const tag = target.tagName;
    return target.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

  function normalizeSpeed(state) {
    if (SIMULATION_SPEEDS.includes(state.settings.speed)) return;
    state.settings.speed = SIMULATION_SPEEDS[nearestSpeedIndex(state.settings.speed)] ?? 1;
  }

  function nearestSpeedIndex(speed) {
    return SIMULATION_SPEEDS.reduce((bestIndex, candidate, index) => (
      Math.abs(candidate - speed) < Math.abs(SIMULATION_SPEEDS[bestIndex] - speed) ? index : bestIndex
    ), 0);
  }

  function loop(now) {
    const delta = (now - lastFrame) / 1000;
    lastFrame = now;
    if (game?.state.settings.running && !game.state.paused && !game.state.death && !game.state.isAscended) {
      game.advanceSeconds(Math.min(1, delta));
    }
    if (game && now - lastSave > AUTOSAVE_INTERVAL_MS) {
      saveGame(game.state);
      lastSave = now;
    }
    if (game && now - lastRender > 250) {
      refreshFrame();
      lastRender = now;
    }
    requestAnimationFrame(loop);
  }

  function isFormControlActive() {
    const element = document.activeElement;
    return element instanceof HTMLInputElement
      || element instanceof HTMLSelectElement
      || element instanceof HTMLTextAreaElement
      || element?.isContentEditable;
  }

  function renderNow() {
    const panelState = capturePanelState();
    root.innerHTML = game ? renderGame(game, data, activeTab, mapOpen, imagePreview, historyPreview, deathOpen, helpOpen, clearConfirmOpen) : renderSetup(data, options.verify);
    restorePanelState(panelState);
    lastStructuralSignature = structuralSignature();
    lastPanelSignature = panelSignature();
    lastPendingDecisionSignature = game ? pendingDecisionSignature(game.state) : '';
    lastHeroSignature = game ? heroSignature(game.state) : '';
  }

  function renderPanelNow() {
    if (!game) return;
    const panelState = capturePanelState();
    const panel = root.querySelector('.panel');
    if (panel) panel.innerHTML = renderTab(game, data, activeTab);
    syncTabNavigation(false);
    restorePanelState(panelState);
    lastPanelSignature = panelSignature();
  }

  function syncTabNavigation(focusActive = false) {
    const activeButton = root.querySelector(`.tabs [data-action="tab"][data-tab="${CSS.escape(activeTab)}"]`);
    root.querySelectorAll('.tabs [data-action="tab"]').forEach((button) => {
      button.classList.toggle('active', button === activeButton);
      button.setAttribute('aria-current', button === activeButton ? 'page' : 'false');
    });
    if (focusActive) activeButton?.focus?.({ preventScroll: true });
  }

  function capturePanelState() {
    const panel = root.querySelector('.panel');
    if (!panel) return null;
    const activeElement = document.activeElement;
    return {
      tab: activeTab,
      scrollTop: panel.scrollTop,
      scrollLeft: panel.scrollLeft,
      focusedAction: activeElement?.closest?.('.panel [data-action]')?.dataset.action ?? null,
      focusedValue: activeElement?.closest?.('.panel [data-action]')?.dataset.item
        ?? activeElement?.closest?.('.panel [data-action]')?.dataset.sect
        ?? activeElement?.closest?.('.panel [data-action]')?.dataset.skill
        ?? activeElement?.closest?.('.panel [data-action]')?.dataset.life
        ?? null
    };
  }

  function restorePanelState(panelState) {
    if (!panelState || panelState.tab !== activeTab) return;
    requestAnimationFrame(() => {
      const panel = root.querySelector('.panel');
      if (!panel) return;
      panel.scrollTop = panelState.scrollTop;
      panel.scrollLeft = panelState.scrollLeft;
      if (!panelState.focusedAction) return;
      const selector = panelState.focusedValue
        ? `[data-action="${CSS.escape(panelState.focusedAction)}"][data-item="${CSS.escape(panelState.focusedValue)}"], [data-action="${CSS.escape(panelState.focusedAction)}"][data-sect="${CSS.escape(panelState.focusedValue)}"], [data-action="${CSS.escape(panelState.focusedAction)}"][data-skill="${CSS.escape(panelState.focusedValue)}"], [data-action="${CSS.escape(panelState.focusedAction)}"][data-life="${CSS.escape(panelState.focusedValue)}"]`
        : `[data-action="${CSS.escape(panelState.focusedAction)}"]`;
      panel.querySelector(selector)?.focus?.({ preventScroll: true });
    });
  }

  function refreshFrame() {
    if (!game) return;
    const nextStructuralSignature = structuralSignature();
    if (nextStructuralSignature !== lastStructuralSignature) {
      if (!isFormControlActive()) renderNow();
      return;
    }
    const nextPanelSignature = panelSignature();
    if (nextPanelSignature !== lastPanelSignature && !isFormControlActive()) {
      renderPanelNow();
    }
    refreshLiveDom();
  }

  function structuralSignature() {
    if (!game) return 'setup';
    const { state } = game;
    const modal = state.events.modal;
    return [
      stageClass(state),
      state.player.name,
      state.player.originId,
      state.map.regionId,
      state.isAscended ? 'ascended' : 'mortal',
      modal ? `${modal.type}:${modal.eventId ?? modal.title ?? ''}` : 'no-modal',
      state.death?.settled ? `${state.death.cause}:${state.history.length}` : 'alive',
      state.meta.reincarnations,
      state.meta.ascensions
    ].join('|');
  }

  function panelSignature() {
    if (!game) return 'setup';
    const { state } = game;
    const progression = state.progression ?? {};
    const materialSignature = Object.entries(state.inventory.materials ?? {})
      .filter(([, count]) => count > 0)
      .map(([name, count]) => `${name}:${count}`)
      .join(',');
    const base = [activeTab];
    if (activeTab === 'log') base.push(state.events.log.length, state.events.log.at(-1)?.text ?? '', JSON.stringify(state.events.log.at(-1)?.rewards ?? []));
    if (activeTab === 'decisions') base.push(state.events.decisions.map((decision) => decision.id).join(','));
    if (activeTab === 'adventure') base.push(
      progression.level,
      progression.exp,
      progression.adventures,
      progression.victories,
      progression.defeats,
      progression.insights,
      progression.monstersDefeated,
      progression.nextAdventureAtAge,
      progression.lastAdventure ? JSON.stringify(progression.lastAdventure) : '',
      materialSignature
    );
    if (activeTab === 'realm') base.push(state.realm.index, state.realm.layer, state.realm.needsTribulation, canOpenTribulationGate(state));
    if (activeTab === 'shop') base.push(JSON.stringify(state.shop.levels), Math.floor(state.currencies.fate), Math.floor(state.currencies.immortal));
    if (activeTab === 'sects') base.push(state.sect.id, state.sect.rank, state.sect.reputation, state.sect.founded, Math.floor(state.player.age), state.realm.index);
    if (activeTab === 'skills') base.push(state.skills.activeInner, state.skills.known.map((skill) => `${skill.id}:${skill.mastery}`).join(','));
    if (activeTab === 'equipment') base.push(state.inventory.equipment.join(','), JSON.stringify(state.inventory.equipped));
    if (activeTab === 'pills') base.push(JSON.stringify(state.inventory.pills), JSON.stringify(state.inventory.herbs));
    if (activeTab === 'achievements') base.push(JSON.stringify(state.collections ?? {}), state.history.length, JSON.stringify(state.inventory?.pills ?? {}), state.inventory?.equipment?.join(','));
    if (activeTab === 'relations') base.push(JSON.stringify(state.family), state.sect.id, state.sect.rank, state.skills.activeInner, JSON.stringify(state.events.traces ?? []));
    if (activeTab === 'family') base.push(JSON.stringify(state.family));
    if (activeTab === 'history') base.push(state.history.length);
    if (activeTab === 'immortal') base.push(state.isAscended);
    return base.join('|');
  }

  function refreshLiveDom() {
    if (!game) return;
    const { state } = game;
    const threshold = layerThreshold(state, data);
    const cultivationProgress = threshold === Infinity ? 100 : Math.min(100, (state.realm.progress / threshold) * 100);
    const progression = state.progression ?? { level: 1, exp: 0 };
    const nextLevel = levelThreshold(progression.level);
    const expProgress = Math.min(100, (progression.exp / nextLevel) * 100);

    updateLiveText('currency-fate', Math.floor(state.currencies.fate));
    updateLiveText('currency-immortal', Math.floor(state.currencies.immortal));
    updateLiveText('currency-reincarnations', state.meta.reincarnations);
    updateLiveText('currency-ascensions', state.meta.ascensions);
    updateLiveText('life-stage', lifeStage(state.player.age));
    updateLiveText('level', `Lv.${progression.level}`);
    updateLiveText('realm-name', currentRealmName(state, data));
    updateLiveText('lifespan', `${state.player.age.toFixed(1)} / ${Math.floor(maxLifespan(state, data))}`);
    updateLiveText('mood', state.mood);
    updateLiveText('sect-name', sectName(state, data));
    updateLiveText('death-risk', `${(deathRiskPerYear(state, data) * 100).toFixed(2)}%/年`);
    updateProgress('cultivation', cultivationProgress, `修为 ${Math.floor(cultivationProgress)}%`);
    updateProgress('exp', expProgress, `阅历 ${progression.exp}/${nextLevel}`);
    updateHeroDom(state);
    updatePendingDecision(state);
    updateControlsLive(state);
    updateDecisionCountdowns(state);
  }

  function updatePendingDecision(state) {
    const panel = root.querySelector('[data-pending-decision]');
    if (!panel) return;
    const nextSignature = pendingDecisionSignature(state);
    panel.hidden = state.events.decisions.length === 0;
    if (nextSignature === lastPendingDecisionSignature) return;
    panel.innerHTML = pendingDecisionContent(state);
    lastPendingDecisionSignature = nextSignature;
  }

  function updateHeroDom(state) {
    const nextSignature = heroSignature(state);
    if (nextSignature === lastHeroSignature) return;
    const scene = root.querySelector('.scene-asset');
    const portrait = root.querySelector('.portrait');
    const route = root.querySelector('[data-testid="scene-route-overlay"]');
    const caption = root.querySelector('.scene-caption');
    const scenePath = sceneAsset(state);
    const portraitPath = portraitAsset(state);
    if (scene) updateAssetImage(scene, scenePath, `${stageLabel(state)}场景`);
    if (portrait) updateAssetImage(portrait, portraitPath, `${state.player.name}立绘`);
    if (route) route.outerHTML = renderSceneRouteOverlay(state, data);
    if (caption) caption.textContent = `${stageLabel(state)} · ${data.byId.region[state.map.regionId]?.name ?? '中原'}${state.map.lastSite ? ` · ${siteLabel(state.map.lastSite)}` : ''}`;
    lastHeroSignature = nextSignature;
  }

  function updateControlsLive(state) {
    root.querySelectorAll('[data-action="speed"]').forEach((button) => {
      button.classList.toggle('active', Number(button.dataset.speed) === state.settings.speed);
    });
    const progression = state.progression ?? {};
    const canAdventure = state.player.age >= 13 && state.player.age >= (progression.nextAdventureAtAge ?? 13);
    root.querySelectorAll('[data-action="adventure"]').forEach((button) => {
      button.disabled = !canAdventure;
    });
  }

  function updateDecisionCountdowns(state) {
    const decisionsById = new Map(state.events.decisions.map((decision) => [decision.id, decision]));
    root.querySelectorAll('[data-decision-id]').forEach((card) => {
      const decision = decisionsById.get(card.dataset.decisionId);
      if (!decision) return;
      const left = Math.max(0, decision.expiresAtAge - state.player.age).toFixed(1);
      const label = card.querySelector('[data-live="decision-left"]');
      if (label) label.textContent = `余 ${left} 年，过期自断`;
      const line = card.querySelector('[data-live-countdown]');
      if (line) line.style.setProperty('--left', `${Math.max(0, Math.min(100, Number(left) * 12))}%`);
    });
  }

  function pendingDecisionSignature(state) {
    const decision = state.events.decisions[0];
    if (!decision) return 'none';
    return [
      state.events.decisions.length,
      decision.id,
      decision.rendered?.title,
      decision.rendered?.text,
      Math.max(0, decision.expiresAtAge - state.player.age).toFixed(1),
      (decision.rendered?.options ?? []).map((option) => `${option.index}:${option.label}:${optionEffectSummary(option)}`).join(',')
    ].join('|');
  }

  function heroSignature(state) {
    const latest = (state.map.trail ?? []).at(-1);
    return [
      sceneAsset(state),
      portraitAsset(state),
      stageLabel(state),
      state.player.name,
      state.player.age.toFixed(1),
      state.map.regionId,
      state.map.lastSite ?? '',
      state.map.lastTrailSummary ?? '',
      latest ? `${latest.from}:${latest.to}:${latest.site}:${latest.reason}:${latest.summary}:${latest.tone}` : 'no-trail',
      state.map.travelTick ?? 0
    ].join('|');
  }

  function updateAssetImage(image, path, title) {
    const src = assetUrl(path);
    if (image.getAttribute('src') === src) return;
    image.src = src;
    image.alt = title;
    if (image.dataset.previewSrc) {
      image.dataset.previewSrc = src;
      image.dataset.previewTitle = title || imageTitle(path);
    }
  }

  function updateLiveText(key, value) {
    const element = root.querySelector(`[data-live="${key}"]`);
    if (element) element.textContent = String(value);
  }

  function updateProgress(key, width, text) {
    const bar = root.querySelector(`[data-live-progress="${key}"] i`);
    if (bar) bar.style.width = `${width}%`;
    updateLiveText(`${key}-progress`, text);
  }

  renderNow();
  requestAnimationFrame(loop);

  window.daowayTest = {
    get game() {
      return game;
    },
    snapshot() {
      if (!game) return null;
      return structuredClone({
        player: game.state.player,
        realm: game.state.realm,
        mood: game.state.mood,
        currencies: game.state.currencies,
        history: game.state.history,
        death: game.state.death,
        progression: game.state.progression,
        map: game.state.map,
        decisions: game.state.events.decisions.length,
        modal: game.state.events.modal?.type ?? null,
        shop: game.state.shop
      });
    },
    start() {
      if (!game) setGame(createGame(data, { verify: true, name: '验道者', gender: 'male', originId: 'hanmen', regionId: 'zhongyuan' }));
      return this.snapshot();
    },
    advanceYears(years) {
      game.advanceYears(years, { force: true });
      if (game.state.death && !game.state.death.settled) game.state.death.settled = true;
      saveGame(game.state);
      renderNow();
      return this.snapshot();
    },
    endLife(cause = '寿尽') {
      endLife(game.state, data, cause);
      saveGame(game.state);
      renderNow();
      return this.snapshot();
    },
    reincarnate() {
      game.reincarnate();
      saveGame(game.state);
      renderNow();
      return this.snapshot();
    },
    forceTribulation() {
      game.state.player.age = Math.max(game.state.player.age, tribulationMinimumAge(game.state));
      game.state.realm.index = Math.max(0, Math.min(2, game.state.realm.index));
      game.state.realm.layer = data.realms[game.state.realm.index].layers.length - 1;
      game.state.realm.needsTribulation = true;
      game.state.settings.running = false;
      game.state.paused = true;
      game.state.events.modal = {
        type: 'tribulation',
        title: '验证渡劫',
        options: [{ label: '渡劫', action: 'attempt' }, { label: '暂缓', action: 'defer' }, { label: '暂缓五年', action: 'defer5' }]
      };
      renderNow();
      return this.snapshot();
    },
    resolveTribulation(action = 'attempt') {
      const result = game.resolveTribulation(action);
      saveGame(game.state);
      renderNow();
      return { result, snapshot: this.snapshot() };
    },
    grantFate(amount = 1000) {
      game.state.currencies.fate += amount;
      saveGame(game.state);
      renderNow();
      return this.snapshot();
    },
    buy(itemId = 'cultivation_speed') {
      const result = purchaseShopItem(game.state, data, itemId);
      saveGame(game.state);
      renderNow();
      return result;
    },
    adventure() {
      const result = resolveAdventure(game.state, data, game.rng, { manual: true });
      saveGame(game.state);
      renderNow();
      return { result, snapshot: this.snapshot() };
    },
    triggerDecisionType(type) {
      const event = eventCandidates(game.state, data, (item) => item.type === type)[0]
        ?? data.events.find((item) => item.type === type);
      if (!event) return null;
      const { triggerEvent } = window.__daowayEvents;
      return triggerEvent(game.state, data, game.rng, event, { forced: true });
    }
  };
}

function renderSetup(data, verify) {
  const name = verify ? '验道者' : '沈知玄';
  return `
    <main class="start book-cover" data-testid="app-ready">
      ${assetImage('scenes/mortal', 'start-bg', '', 'aria-hidden="true"')}
      <form class="start-panel book-page" data-role="setup">
        <div class="chapter-head">
          <p class="eyebrow">命书初启</p>
          <h1>批命投胎</h1>
          <p class="brush-note">姓名、性别、出身与地区写入命书，来世从此落笔。</p>
        </div>
        <div class="destiny-grid">
          <label>姓名<input name="name" value="${escapeHtml(name)}" maxlength="8"></label>
          <label>性别<select name="gender"><option value="male">男</option><option value="female">女</option></select></label>
          <label>出身<select name="originId">${data.origins.map((origin) => `<option value="${origin.id}" ${origin.id !== 'hanmen' ? 'disabled' : ''}>${origin.name}${origin.id !== 'hanmen' ? '（未解锁）' : ''}</option>`).join('')}</select></label>
          <label>地区<select name="regionId">${data.regions.map((region) => `<option value="${region.region_id}">${region.name}</option>`).join('')}</select></label>
        </div>
        <button class="primary ink-button cinnabar-action" type="button" data-action="start" data-testid="start-game">落笔入世</button>
      </form>
    </main>
  `;
}

function renderGame(game, data, activeTab, mapOpen = false, imagePreview = null, historyPreview = null, deathOpen = false, helpOpen = false, clearConfirmOpen = false) {
  const { state } = game;
  const stage = stageClass(state);
  return `
    <main class="shell game-screen ${stage}" data-testid="app-ready">
      <header class="topbar">
        <div class="title-block">
          <p class="eyebrow">命书 · 第${state.history.length + 1}世</p>
          <h1>${escapeHtml(state.player.name)}</h1>
          <span class="chapter-line">${data.byId.origin[state.player.originId]?.name ?? '寒门子弟'} · ${data.byId.region[state.map.regionId]?.name ?? '中原'}</span>
        </div>
        <div class="topbar-actions">
          <div class="currencies">
            ${state.death?.settled ? `<button class="death-chip" data-action="open-death" data-testid="open-death">${icon('jade')}<b>已身故</b><strong>${escapeHtml(state.death.cause)}</strong></button>` : ''}
            ${metricChip('fate', '机缘', Math.floor(state.currencies.fate), 'currency-fate')}
            ${metricChip('immortal', '仙缘', Math.floor(state.currencies.immortal), 'currency-immortal')}
            ${metricChip('history', '轮回', state.meta.reincarnations, 'currency-reincarnations')}
            ${metricChip('realm', '飞升', state.meta.ascensions, 'currency-ascensions')}
          </div>
          <button class="ink-button topbar-command grant-fate-action" data-action="grant-fate" data-testid="grant-fate">${icon('fate')}<span>获取机缘</span></button>
          <button class="ink-button topbar-command grant-immortal-action" data-action="grant-immortal" data-testid="grant-immortal">${icon('immortal')}<span>获取仙缘</span></button>
          <button class="ink-button topbar-command danger-action" data-action="open-clear-confirm" data-testid="open-clear-data">${icon('mood')}<span>清除数据</span></button>
        </div>
      </header>
      <section class="hero">
        <div class="scene-wrap split-scene">
          <div class="portrait-panel">
            ${assetImage(portraitAsset(state), 'portrait', `${state.player.name}立绘`)}
            <div class="portrait-meta">
              <b>${escapeHtml(state.player.name)}</b>
              <span>${state.player.age.toFixed(1)} / ${Math.floor(maxLifespan(state, data))}岁</span>
            </div>
          </div>
          <div class="scene-panel">
            ${assetImage(sceneAsset(state), 'scene-asset', `${stageLabel(state)}场景`)}
            ${renderSceneRouteOverlay(state, data)}
            <div class="scene-caption">${stageLabel(state)} · ${data.byId.region[state.map.regionId]?.name ?? '中原'}${state.map.lastSite ? ` · ${escapeHtml(siteLabel(state.map.lastSite))}` : ''}</div>
          </div>
        </div>
        ${renderPendingDecision(state)}
        ${renderStatus(game, data)}
      </section>
      ${renderControls(state)}
      ${renderModal(game, data)}
      ${deathOpen && state.death?.settled ? renderDeathDialog(game, data) : ''}
      ${imagePreview ? renderImagePreview(imagePreview) : ''}
      ${historyPreview ? renderHistoryPreview(historyPreview) : ''}
      ${helpOpen ? renderHelpOverlay() : ''}
      ${mapOpen ? renderMapWindow(game, data) : ''}
      ${clearConfirmOpen ? renderClearSaveDialog() : ''}
      <section class="workspace book-page">
        <nav class="tabs" aria-label="命书章节">
          <div class="tab-shortcuts"><kbd>Q</kbd><span>章节</span><kbd>E</kbd></div>
          ${tabs().map((tab, index) => `<button data-action="tab" data-tab="${tab.id}" class="${activeTab === tab.id ? 'active' : ''}" aria-current="${activeTab === tab.id ? 'page' : 'false'}"><kbd>${tabShortcutLabel(index)}</kbd>${icon(tab.icon)}<span>${tab.label}</span></button>`).join('')}
        </nav>
        <div class="panel">${renderTab(game, data, activeTab)}</div>
      </section>
    </main>
  `;
}

function renderSceneRouteOverlay(state, data) {
  const latest = (state.map.trail ?? []).at(-1);
  const currentRegion = data.byId.region[state.map.regionId] ?? data.regions[0];
  const fromName = latest ? regionName(data, latest.from) : currentRegion?.name ?? '中原';
  const toName = latest ? regionName(data, latest.to) : currentRegion?.name ?? '中原';
  const site = latest?.site ?? state.map.lastSite ?? currentRegion?.secret_sites?.[0] ?? currentRegion?.name ?? '旧路';
  const reason = latest?.reason ?? '初入江湖';
  const summary = latest?.summary ?? state.map.lastTrailSummary ?? '';
  const sameRegion = fromName === toName;
  const travelerOffset = 42 + ((state.map.travelTick ?? 0) % 4) * 5;
  return `
    <aside class="scene-route" data-testid="scene-route-overlay">
      <div class="scene-route-map">
        <span class="route-dot start"></span>
        <i></i>
        <span class="route-dot end"></span>
        <div class="route-traveler" style="--offset:${travelerOffset}%">
          ${assetImage(portraitAsset(state), 'scene-route-avatar', state.player.name, 'data-no-preview')}
        </div>
      </div>
      <div class="scene-route-text">
        <b>${escapeHtml(sameRegion ? toName : `${fromName} → ${toName}`)}</b>
        <span>${escapeHtml(siteLabel(site))} · ${escapeHtml(reason)}</span>
        ${summary ? `<em>${escapeHtml(summary)}</em>` : ''}
      </div>
    </aside>
  `;
}

function renderStatus(game, data) {
  const { state } = game;
  const threshold = layerThreshold(state, data);
  const progress = threshold === Infinity ? 100 : Math.min(100, (state.realm.progress / threshold) * 100);
  const progression = state.progression ?? { level: 1, exp: 0 };
  const nextLevel = levelThreshold(progression.level);
  const expProgress = Math.min(100, (progression.exp / nextLevel) * 100);
  return `
    <aside class="status">
      ${statusRow('history', '阶段', lifeStage(state.player.age), 'life-stage')}
      ${statusRow('skill', '等级', `Lv.${progression.level}`, 'level')}
      ${statusRow('realm', '境界', currentRealmName(state, data), 'realm-name')}
      ${statusRow('lamp', '寿元', `${state.player.age.toFixed(1)} / ${Math.floor(maxLifespan(state, data))}`, 'lifespan')}
      ${statusRow('mood', '心境', state.mood, 'mood')}
      ${statusRow('sect', '门派', sectName(state, data), 'sect-name')}
      ${statusRow('jade', '横死率', `${(deathRiskPerYear(state, data) * 100).toFixed(2)}%/年`, 'death-risk')}
      <div class="ink-progress" data-live-progress="cultivation" aria-label="修为进度"><i style="width:${progress}%"></i><span data-live="cultivation-progress">修为 ${Math.floor(progress)}%</span></div>
      <div class="ink-progress exp-progress" data-live-progress="exp" aria-label="阅历进度"><i style="width:${expProgress}%"></i><span data-live="exp-progress">阅历 ${progression.exp}/${nextLevel}</span></div>
    </aside>
  `;
}

function renderPendingDecision(state) {
  return `<section class="pending-decision" data-pending-decision ${state.events.decisions.length ? '' : 'hidden'}>${pendingDecisionContent(state)}</section>`;
}

function pendingDecisionContent(state) {
  const decision = state.events.decisions[0];
  if (!decision) return '';
  const left = Math.max(0, decision.expiresAtAge - state.player.age).toFixed(1);
  const options = (decision.rendered.options ?? []).slice(0, 3);
  return `
    <article class="pending-card" data-decision-id="${escapeHtml(decision.id)}">
      ${assetImage(eventArt(decision.rendered), 'pending-art', decision.rendered.title)}
      <div>
        <p class="eyebrow">待批江湖事 · ${state.events.decisions.length}件</p>
        <h3>${escapeHtml(decision.rendered.title)}</h3>
        <small data-live="decision-left">余 ${left} 年，过期自断</small>
      </div>
      <div class="pending-actions">
        ${options.map((option) => `<button class="ink-button decision-action" data-action="decision-option" data-decision="${escapeHtml(decision.id)}" data-option="${option.index}"><span>${escapeHtml(option.label)}</span><small>${escapeHtml(optionEffectSummary(option))}</small></button>`).join('')}
        ${decision.rendered.options.length > options.length || state.events.decisions.length > 1 ? `<button class="ink-button quiet" data-action="open-decisions">更多</button>` : ''}
      </div>
      <div class="countdown-line" data-live-countdown style="--left:${Math.max(0, Math.min(100, Number(left) * 12))}%"></div>
    </article>
  `;
}

function renderControls(state) {
  const progression = state.progression ?? {};
  const canAdventure = state.player.age >= 13 && state.player.age >= (progression.nextAdventureAtAge ?? 13);
  return `
    <section class="controls">
      ${SIMULATION_SPEEDS.map((speed) => `<button class="ink-button speed-button ${state.settings.speed === speed ? 'active' : ''}" data-action="speed" data-speed="${speed}" title=", / . 调速"><span>${speed}x</span></button>`).join('')}
      <button class="ink-button control-button" data-action="advance" data-years="1" data-testid="advance-year">${icon('fate')}<span>推演一年</span></button>
      <button class="ink-button control-button" data-action="advance" data-years="10" data-testid="advance-10-years">${icon('realm')}<span>推演十年</span></button>
      <button class="ink-button control-button" data-action="adventure" data-testid="manual-adventure" title="A" ${canAdventure ? '' : 'disabled'}>${icon('skill')}<span>外出历练</span><kbd>A</kbd></button>
      <button class="ink-button control-button" data-action="open-map" data-testid="open-map" title="M">${icon('map')}<span>江湖地图</span><kbd>M</kbd></button>
      <button class="ink-button control-button" data-action="open-help" data-testid="open-help" title="H">${icon('history')}<span>操作</span><kbd>H</kbd></button>
    </section>
  `;
}

function renderMiniMap(game, data) {
  const { state } = game;
  const currentId = state.map.regionId;
  const trail = [...(state.map.trail ?? [])].slice(-6).reverse();
  const discoveredSites = new Set([...(state.collections?.sites ?? []), ...(state.map.discoveredSites ?? [])]);
  const totalSites = data.regions.reduce((sum, region) => sum + (region.secret_sites?.length ?? 0), 0);
  const currentRegion = data.byId.region[currentId] ?? data.regions[0];
  const currentNode = mapNodes[currentId] ?? { x: 50, y: 50, scene: 'mortal' };
  const latestTrail = trail[0];
  const avatarMotion = mapAvatarMotion(state, currentNode, latestTrail);
  const recentRoutes = [...(state.map.trail ?? [])].slice(-5).map((step) => ({
    d: mapRoutePath(step),
    current: step === (state.map.trail ?? []).at(-1)
  })).filter((route) => route.d);
  return `
    <section class="mini-map map-widget">
      <div class="chapter-head compact">
        <p class="eyebrow">江湖行迹</p>
        <h2>${currentRegion?.name ?? '中原'}</h2>
        <p class="map-progress-note">秘境 ${discoveredSites.size}/${totalSites} · 行迹 ${(state.map.trail ?? []).length}</p>
      </div>
      <div class="pool-line">${(data.byId.region[currentId]?.event_pool ?? []).map((category) => `<span>${escapeHtml(categoryLabel(category))}</span>`).join('')}</div>
      <div class="map-board">
        <svg class="map-routes" viewBox="0 0 100 100" aria-hidden="true">
          <path d="M26 34 C35 28 43 29 52 34 S68 42 76 48" />
          <path d="M18 56 C25 61 30 65 36 68 S57 74 68 74" />
          <path d="M26 34 C20 41 18 48 18 56" />
          <path d="M52 34 C47 46 42 58 36 68" />
          <path d="M76 48 C75 58 72 67 68 74" />
          ${recentRoutes.map((route) => `<path class="${route.current ? 'current-route' : 'history-route'}" d="${route.d}" />`).join('')}
        </svg>
        ${(currentRegion?.secret_sites ?? []).map((site) => {
          const node = siteNodes[site] ?? currentNode;
          const active = site === state.map.lastSite;
          const discovered = discoveredSites.has(site);
          return `<span class="site-pin ${active ? 'active' : ''} ${discovered ? 'discovered' : ''}" style="--x:${node.x}%;--y:${node.y}%"><i></i><b>${escapeHtml(siteLabel(site))}</b></span>`;
        }).join('')}
        ${data.regions.map((region) => {
          const node = mapNodes[region.region_id] ?? { x: 50, y: 50, scene: 'mortal' };
          const active = region.region_id === currentId;
          const visited = (region.secret_sites ?? []).some((site) => discoveredSites.has(site));
          return `<button class="map-node ${active ? 'active' : ''} ${visited ? 'visited' : ''}" style="--x:${node.x}%;--y:${node.y}%" data-action="route" data-region="${region.region_id}" aria-label="前往${region.name}"><i></i><span>${region.name}</span><small>${region.sects.slice(0, 2).join(' / ')}</small></button>`;
        }).join('')}
        <div class="map-avatar ${avatarMotion.traveling ? 'traveling' : ''}" data-testid="map-avatar" style="--x:${currentNode.x}%;--y:${currentNode.y}%;--from-x:${avatarMotion.from.x}%;--from-y:${avatarMotion.from.y}%;--to-x:${avatarMotion.to.x}%;--to-y:${avatarMotion.to.y}%;--tick:${state.map.travelTick ?? 0}">
          ${assetImage(portraitAsset(state), 'map-avatar-art', state.player.name)}
          <span>${escapeHtml(state.player.name)}</span>
        </div>
        <div class="map-current-card">
          ${assetImage(`scenes/${mapNodes[currentId]?.scene ?? sceneAsset(state).replace('scenes/', '')}`, 'map-card-art', '', 'aria-hidden="true"')}
          <div>
            <b>${escapeHtml(currentRegion?.name ?? '中原')}</b>
            <span>${escapeHtml(latestTrail?.summary ?? state.map.lastTrailSummary ?? (state.map.lastSite ? `${siteLabel(state.map.lastSite)} · ${latestTrail?.reason ?? '行中'}` : (currentRegion?.secret_sites ?? []).map(siteLabel).join(' / ')))}</span>
          </div>
        </div>
      </div>
      <div class="trail-list">
        ${trail.length ? trail.map((step, index) => `<p class="${index === 0 ? 'current' : ''} ${escapeHtml(step.tone ?? 'map')}"><span>${step.age}岁</span><b>${escapeHtml(regionName(data, step.from))}${step.from !== step.to ? ` → ${escapeHtml(regionName(data, step.to))}` : ''} · ${escapeHtml(siteLabel(step.site))} · ${escapeHtml(step.reason)}</b>${step.summary ? `<em>${escapeHtml(step.summary)}</em>` : ''}</p>`).join('') : '<p><span>初行</span><b>尚未留下江湖足迹</b></p>'}
      </div>
      <div class="map-region-strip">
        ${data.regions.map((region) => renderMapRegionTile(region, state, discoveredSites, currentId)).join('')}
      </div>
    </section>
  `;
}

function mapAvatarMotion(state, currentNode, latestTrail) {
  if (!latestTrail) return { from: currentNode, to: currentNode, traveling: false };
  const from = mapNodes[latestTrail.from] ?? currentNode;
  const toRegion = mapNodes[latestTrail.to] ?? currentNode;
  const site = siteNodes[latestTrail.site];
  const to = latestTrail.from === latestTrail.to && site ? site : toRegion;
  return {
    from,
    to,
    traveling: true
  };
}

function mapRoutePath(step) {
  if (!step) return '';
  const fromNode = mapNodes[step.from] ?? mapNodes[step.to];
  const toNode = mapNodes[step.to] ?? fromNode;
  if (!fromNode || !toNode) return '';
  const lift = step.from === step.to ? -10 : -14;
  const spread = step.from === step.to ? 10 : 12;
  return `M${fromNode.x} ${fromNode.y} C${(fromNode.x + toNode.x) / 2} ${Math.min(fromNode.y, toNode.y) + lift} ${(fromNode.x + toNode.x) / 2} ${Math.max(fromNode.y, toNode.y) + spread} ${toNode.x} ${toNode.y}`;
}

function renderMapRegionTile(region, state, discoveredSites, currentId) {
  const node = mapNodes[region.region_id] ?? { scene: 'mortal' };
  const discoveredCount = (region.secret_sites ?? []).filter((site) => discoveredSites.has(site)).length;
  const active = region.region_id === currentId;
  return `
    <article class="map-region-tile ${active ? 'active' : ''}">
      ${assetImage(`scenes/${node.scene}`, 'map-region-art', `${region.name}场景`)}
      <div>
        <h3>${escapeHtml(region.name)}</h3>
        <p>${region.sects.join(' / ')}</p>
        <small>${discoveredCount}/${region.secret_sites.length} 秘境 · ${(region.event_pool ?? []).map(categoryLabel).join(' / ')}</small>
      </div>
      <button class="ink-button" data-action="route" data-region="${region.region_id}">${active ? '驻留' : '前往'}</button>
    </article>
  `;
}

function renderHelpOverlay() {
  const bindings = [
    ['Q / E', '切换上一章 / 下一章'],
    ['1-9', '直达前九个章节'],
    ['A', '外出历练'],
    ['M', '打开 / 关闭江湖地图'],
    [', / .', '降低 / 提高推演速度'],
    ['Enter', '放大当前聚焦图片'],
    ['Esc', '关闭弹窗或地图']
  ];
  return `
    <section class="help-layer" data-testid="help-overlay">
      <div class="help-window book-page">
        <header class="dialog-head">
          <div>
            <p class="eyebrow">PC 操作</p>
            <h2>键位札记</h2>
          </div>
          <button class="ink-button" data-action="close-help" data-testid="close-help">关闭</button>
        </header>
        <div class="help-bindings">
          ${bindings.map(([key, text]) => `<div><kbd>${escapeHtml(key)}</kbd><span>${escapeHtml(text)}</span></div>`).join('')}
        </div>
      </div>
    </section>
  `;
}

function renderClearSaveDialog() {
  return `
    <section class="clear-confirm-layer" data-testid="clear-confirm">
      <div class="clear-confirm book-page" role="dialog" aria-modal="true" aria-labelledby="clear-confirm-title">
        <div class="chapter-head compact">
          <p class="eyebrow">危险操作</p>
          <h2 id="clear-confirm-title">确认清除数据？</h2>
          <p class="brush-note">这会删除当前存档、轮回记录、解锁进度和资源数据，操作后无法恢复。</p>
        </div>
        <div class="row decision-option-row">
          <button class="ink-button danger-action" data-action="confirm-clear-save" data-testid="confirm-clear-data">确认清除数据</button>
          <button class="ink-button" data-action="close-clear-confirm" data-testid="cancel-clear-data">取消</button>
        </div>
      </div>
    </section>
  `;
}

function renderMapWindow(game, data) {
  return `
    <section class="map-window-layer" data-testid="map-window">
      <div class="map-window book-page">
        <header class="map-window-head">
          <div>
            <p class="eyebrow">地图窗口</p>
            <h2>江湖行迹</h2>
          </div>
          <button class="ink-button" data-action="close-map" data-testid="close-map">收起</button>
        </header>
        <div class="map-window-body">${renderMiniMap(game, data)}</div>
      </div>
    </section>
  `;
}

function renderImagePreview(preview) {
  return `
    <section class="image-preview-layer" data-testid="image-preview">
      <div class="image-preview-window">
        <button class="image-preview-close ink-button" data-action="close-image-preview" data-testid="close-image-preview">关闭</button>
        <img src="${escapeHtml(preview.src)}" alt="${escapeHtml(preview.title)}">
      </div>
    </section>
  `;
}

function renderModal(game, data) {
  const modal = game.state.events.modal;
  if (!modal) return '';
  if (modal.type === 'tribulation') {
    return `
      <section class="modal tribulation-sky">
        <div class="modal-panel ritual-modal">
          ${assetImage('events/tribulation', 'event-art', '', 'aria-hidden="true"')}
          <p class="eyebrow">天机压卷</p>
          <h2>${modal.title ?? '渡劫'}</h2>
          <p>成败率 ${(tribulationChance(game.state, data) * 100).toFixed(1)}%${canAscend(game.state) ? '' : ' · 飞升机缘未足'}</p>
          <div class="row">
            <button class="primary ink-button cinnabar-action" data-action="tribulation" data-tribulation="attempt" data-testid="attempt-tribulation">引劫入身</button>
            <button class="ink-button" data-action="tribulation" data-tribulation="defer">暂缓固境</button>
            <button class="ink-button" data-action="tribulation" data-tribulation="defer5">暂缓五年</button>
          </div>
        </div>
      </section>
    `;
  }
  return `
    <section class="modal">
      <div class="modal-panel ritual-modal">
        ${assetImage(eventArt(modal.rendered), 'event-art modal-event-art', modal.rendered.title)}
        <h2>${escapeHtml(modal.rendered.title)}</h2>
        <p>${escapeHtml(modal.rendered.text)}</p>
        <div class="row decision-option-row">${modal.rendered.options.map((option) => `<button class="ink-button decision-action" data-action="modal-option" data-option="${option.index}"><span>${escapeHtml(option.label)}</span><small>${escapeHtml(optionEffectSummary(option))}</small></button>`).join('')}</div>
      </div>
    </section>
  `;
}

function renderDeathDialog(game, data) {
  const { state } = game;
  if (!state.death?.settled) return '';
  const entry = state.history[state.history.length - 1];
  const currentOriginId = state.player.originId;
  const currentRegionId = state.map.regionId;
  const originOptions = data.origins.map((origin) => {
    const unlocked = isOriginUnlocked(state, origin);
    return `<option value="${origin.id}" ${origin.id === currentOriginId ? 'selected' : ''} ${unlocked ? '' : 'disabled'}>${origin.name}${unlocked ? '' : '（未解锁）'}</option>`;
  }).join('');
  const regionOptions = data.regions.map((region) => `<option value="${region.region_id}" ${region.region_id === currentRegionId ? 'selected' : ''}>${region.name}</option>`).join('');
  return `
    <section class="death-layer" data-testid="life-ended">
      <div class="death-dialog book-page stamp-scene">
        <header class="dialog-head">
          <div>
            <p class="eyebrow">${state.death.cause}</p>
            <h2>命书落款</h2>
          </div>
          <button class="ink-button" data-action="close-death">关闭</button>
        </header>
        <div class="death-summary">
          <div class="seal" aria-label="谥号">${entry?.epithet ?? '一世已尽'}</div>
          <div class="end-copy">
            <p>享年 ${Math.floor(state.death.atAge)}，最高 ${entry?.peak_realm ?? '后天'}，得机缘 ${entry?.currency_gained ?? 0}${entry?.immortal_gained ? `，仙缘 ${entry.immortal_gained}` : ''}</p>
            <p>${escapeHtml((entry?.key_events ?? []).slice(-3).join('、') || '此世无大事，仍入史册。')}</p>
          </div>
        </div>
        <div class="death-actions">
          <label>来世出身<select name="nextOriginId">${originOptions}</select></label>
          <label>来世地区<select name="nextRegionId">${regionOptions}</select></label>
          <button class="primary ink-button cinnabar-action" data-action="reincarnate" data-testid="reincarnate">拓印来世</button>
        </div>
      </div>
    </section>
  `;
}

function tabs() {
  return [
    ['log', '日志', 'history'],
    ['decisions', '江湖事', 'map'],
    ['adventure', '历练', 'skill'],
    ['realm', '境界', 'realm'],
    ['shop', '造化阁', 'fate'],
    ['origins', '出身', 'lamp'],
    ['sects', '门派', 'sect'],
    ['skills', '功法', 'skill'],
    ['equipment', '装备', 'equipment'],
    ['pills', '丹药', 'pill'],
    ['achievements', '成就', 'fate'],
    ['relations', '关系', 'family'],
    ['family', '婚育', 'family'],
    ['history', '史册', 'history'],
    ['immortal', '仙界', 'immortal']
  ].map(([id, label, iconName]) => ({ id, label, icon: iconName }));
}

function tabShortcutLabel(index) {
  return index < 9 ? String(index + 1) : String(index + 1);
}

function renderTab(game, data, tab) {
  const map = {
    log: renderLog,
    decisions: renderDecisions,
    adventure: renderAdventure,
    realm: renderRealm,
    shop: renderShop,
    origins: renderOrigins,
    sects: renderSects,
    skills: renderSkills,
    equipment: renderEquipment,
    pills: renderPills,
    achievements: renderAchievements,
    relations: renderRelations,
    family: renderFamily,
    history: renderHistory,
    immortal: renderImmortal
  };
  return (map[tab] ?? renderLog)(game, data);
}

function renderLog(game) {
  const items = [...game.state.events.log].slice(-80).reverse();
  return `<section class="chapter-head compact"><p class="eyebrow">命书手札</p><h2>本世行录</h2></section><div class="log scroll-log">${items.map((item) => `<p class="${item.tone}"><span>${item.age}岁</span><b>${escapeHtml(item.text)}</b>${renderLogRewards(item.rewards)}</p>`).join('')}</div>`;
}

function renderDecisions(game) {
  const { state } = game;
  if (!state.events.decisions.length) return '<p class="empty">案头清净，暂无待批江湖事。</p>';
  return state.events.decisions.map((decision) => {
    const left = Math.max(0, decision.expiresAtAge - state.player.age).toFixed(1);
    return `
      <article class="item writ-strip" data-decision-id="${escapeHtml(decision.id)}">
        ${assetImage(eventArt(decision.rendered), 'decision-art', decision.rendered.title)}
        <div class="decision-copy">
          <h3>${escapeHtml(decision.rendered.title)}</h3>
          <p>${escapeHtml(decision.rendered.text)}</p>
          <small data-live="decision-left">余 ${left} 年，过期自断</small>
          <div class="countdown-line" data-live-countdown style="--left:${Math.max(0, Math.min(100, Number(left) * 12))}%"></div>
          <div class="row decision-option-row">${decision.rendered.options.map((option) => `<button class="ink-button decision-action" data-action="decision-option" data-decision="${decision.id}" data-option="${option.index}"><span>${escapeHtml(option.label)}</span><small>${escapeHtml(optionEffectSummary(option))}</small></button>`).join('')}</div>
        </div>
      </article>
    `;
  }).join('');
}

function optionEffectSummary(optionOrEffects = {}) {
  if (optionOrEffects.hint) return optionOrEffects.hint;
  const effects = optionOrEffects.successEffects ?? optionOrEffects.effects ?? optionOrEffects;
  const parts = [];
  if (typeof optionOrEffects.successRate === 'number') parts.push(`成率${Math.round(optionOrEffects.successRate * 100)}%`);
  if (typeof effects.cultivation === 'number' && effects.cultivation) parts.push(`修为${signed(effects.cultivation)}`);
  if (typeof effects.experience === 'number' && effects.experience) parts.push(`阅历${signed(effects.experience)}`);
  if (typeof effects.mood === 'number' && effects.mood) parts.push(`心境${signed(effects.mood)}`);
  if (typeof effects.lifespan === 'number' && effects.lifespan) parts.push(`寿元${signed(effects.lifespan)}`);
  if (typeof effects.currency_on_death_bonus === 'number' && effects.currency_on_death_bonus) parts.push(`机缘${signed(effects.currency_on_death_bonus)}`);
  if (typeof effects.sect_reputation === 'number' && effects.sect_reputation) parts.push(`声望${signed(effects.sect_reputation)}`);
  if (typeof effects.injury_years === 'number' && effects.injury_years) parts.push(`负伤${effects.injury_years}年`);
  if (effects.gain_skill) parts.push('可能习得功法');
  if (effects.gain_item?.kind === 'equipment') parts.push('可能获得装备');
  if (effects.family?.action === 'meet_spouse') parts.push('可能结缘');
  if (effects.family?.action === 'child_branch') parts.push('影响子嗣');
  if (effects.leave_trace) parts.push('留下因果');
  if (effects.next_event) parts.push('引出后续');
  return parts.slice(0, 3).join(' · ') || '走向未知';
}

function renderLogRewards(rewards = []) {
  if (!rewards.length) return '';
  return `<em class="log-rewards">${rewards.map((reward) => {
    const value = Number(reward.value ?? 0);
    const sign = value > 0 ? '+' : '';
    const className = reward.kind === 'loss' || value < 0 ? 'loss' : 'gain';
    return `<i class="${className}">${escapeHtml(reward.label ?? '')}${sign}${formatNumber(value)}</i>`;
  }).join('')}</em>`;
}

function signed(value) {
  return value > 0 ? `+${value}` : String(value);
}

function renderAdventure(game, data) {
  const { state } = game;
  const progression = state.progression ?? { level: 1, exp: 0, adventures: 0, victories: 0, defeats: 0, monstersDefeated: 0, insights: 0 };
  const nextLevel = levelThreshold(progression.level);
  const expProgress = Math.min(100, (progression.exp / nextLevel) * 100);
  const last = progression.lastAdventure;
  const lastEquipment = last?.equipmentId ? data.byId.equipment[last.equipmentId] : null;
  const materials = Object.entries(state.inventory.materials ?? {}).filter(([, count]) => count > 0);
  const regionName = data.byId.region[state.map.regionId]?.name ?? '中原';
  const nextAdventureAtAge = progression.nextAdventureAtAge ?? 13;
  const canAdventure = state.player.age >= 13 && state.player.age >= nextAdventureAtAge;
  const adventureText = state.player.age < 13
    ? '童年先养筋骨，十三岁后才可真正离家历练。'
    : canAdventure
      ? '刀光在外，行囊已备，阅历与名声都写在脚下。'
      : `行囊未整，约 ${nextAdventureAtAge.toFixed(1)} 岁后再出门。`;
  return `
    <section class="adventure-board">
      <article class="item adventure-hero">
        ${assetImage('events/encounter', 'event-art', '', 'aria-hidden="true"')}
        <div>
          <p class="eyebrow">${lifeStage(state.player.age)} · ${regionName}</p>
          <h3>${icon('skill')}江湖历练</h3>
          <p>${adventureText}</p>
          <button class="primary ink-button cinnabar-action" data-action="adventure" ${canAdventure ? '' : 'disabled'}>外出历练</button>
        </div>
      </article>
      <div class="grid four">
        <article class="item stat-tile"><span>等级</span><strong>Lv.${progression.level}</strong></article>
        <article class="item stat-tile"><span>胜场</span><strong>${progression.victories ?? 0}</strong></article>
        <article class="item stat-tile"><span>领悟</span><strong>${progression.insights ?? 0}</strong></article>
        <article class="item stat-tile"><span>击退</span><strong>${progression.monstersDefeated ?? 0}</strong></article>
      </div>
      <article class="item">
        <h3>${icon('fate')}阅历</h3>
        <div class="ink-progress exp-progress"><i style="width:${expProgress}%"></i><span>${progression.exp}/${nextLevel}</span></div>
      </article>
      <div class="grid two">
        <article class="item">
          <h3>上次遭遇</h3>
          ${last ? `<p>${last.age}岁 · ${escapeHtml(last.region)} · ${escapeHtml(last.opponent)} · 难度 ${last.difficulty} · ${last.success ? '胜' : '败'}</p>` : '<p>尚无战斗记录。</p>'}
          ${lastEquipment ? `<div class="adventure-loot">${assetImage(`equipment/${lastEquipment.id}`, 'equipment-thumb', lastEquipment.name)}<div><strong>${escapeHtml(lastEquipment.name)}</strong><p>${lastEquipment.quality} · ${equipmentSlotLabel(lastEquipment.slot)}</p></div></div>` : ''}
        </article>
        <article class="item">
          <h3>战利</h3>
          ${materials.length ? materials.map(([name, count]) => `<p>${escapeHtml(name)} x${count}</p>`).join('') : '<p>尚无材料。</p>'}
        </article>
      </div>
    </section>
  `;
}

function renderRealm(game, data) {
  const { state } = game;
  const canTribulate = canOpenTribulationGate(state);
  const minAge = tribulationMinimumAge(state);
  return `
    <div class="grid two">
      <article class="item"><h3>${icon('realm')}${currentRealmName(state, data)}</h3><p>修为 ${Math.floor(state.realm.progress)} / ${layerThreshold(state, data)}</p><p>${canTribulate ? `渡劫率 ${(tribulationChance(state, data) * 100).toFixed(1)}%` : `问劫年龄 ${minAge}岁后`}</p></article>
      <article class="item"><h3>${icon('lotus')}渡劫</h3><p>${state.realm.needsTribulation ? (canTribulate ? '劫机已至' : `${minAge}岁前不可引劫`) : tribulationDeferNote(state)}</p><button class="ink-button cinnabar-action" data-action="tribulation" data-tribulation="attempt" ${state.realm.needsTribulation && canTribulate ? '' : 'disabled'}>引劫</button><button class="ink-button" data-action="tribulation" data-tribulation="defer" ${state.realm.needsTribulation ? '' : 'disabled'}>暂缓</button><button class="ink-button" data-action="tribulation" data-tribulation="defer5" ${state.realm.needsTribulation ? '' : 'disabled'}>暂缓五年</button></article>
    </div>
    <div class="realm-list">${data.realms.map((realm, index) => `<span class="${index <= state.realm.peakIndex ? 'done' : ''}">${realm.name}</span>`).join('')}</div>
  `;
}

function tribulationDeferNote(state) {
  const remaining = Math.max(0, (state.realm.tribulationDeferredUntilAge ?? 0) - state.player.age);
  if (remaining > 0) return `暂缓固境中，约 ${remaining.toFixed(1)} 年后再问劫`;
  return '尚在积累';
}

function renderShop(game, data) {
  const groups = groupBy(data.shop, 'category');
  return Object.entries(groups).map(([category, items]) => `
    <section class="shop-group">
      <h3>${icon(shopIcon(category))}${category}</h3>
      <div class="grid three treasure-grid">${items.map((item) => {
        const level = game.state.shop.levels[item.id] ?? 0;
        const cost = shopCost(item, level);
        const currency = item.currency === 'immortal' ? '仙缘' : '机缘';
        return `<article class="item treasure-cell">${assetImage(`icons/${shopIcon(category)}`, '', '', 'aria-hidden="true"')}<h4>${escapeHtml(item.name)}</h4><p class="shop-desc">${escapeHtml(item.description ?? shopItemDescription(item, data))}</p><p class="shop-effect">${escapeHtml(shopEffectText(item, data))}</p><p class="shop-meta">Lv ${level}/${item.max_level} · ${Number.isFinite(cost) ? `${currency} ${cost}` : '已满'}</p><button class="ink-button" data-action="shop-buy" data-item="${item.id}" ${Number.isFinite(cost) ? '' : 'disabled'}>购入</button></article>`;
      }).join('')}</div>
    </section>
  `).join('');
}

function renderOrigins(game, data) {
  return `<div class="grid three">${data.origins.map((origin) => `<article class="item origin-slip"><h3>${icon('lamp')}${origin.name}</h3><p>${isOriginUnlocked(game.state, origin) ? '命书已载' : '尚未显现'}</p></article>`).join('')}</div>`;
}

function renderSects(game, data) {
  const state = game.state;
  const current = state.sect.id ? data.byId.sect[state.sect.id] : null;
  const canJoin = state.player.age >= 14;
  const canFound = state.player.age >= 30 && state.realm.index >= 2;
  return `
    <article class="item"><h3>${icon('sect')}${sectName(state, data)}</h3><p>声望 ${state.sect.reputation} · 位阶 ${current?.ranks[state.sect.rank] ?? (state.sect.founded ? '开山祖师' : '无')}</p><div class="row"><button class="ink-button" data-action="advance-sect">晋升</button><button class="ink-button" data-action="betray-sect">叛出</button><button class="ink-button" data-action="found-sect" ${canFound ? '' : 'disabled'}>自立</button></div></article>
    <div class="grid four sect-grid">${data.sects.map((sect) => `<article class="item sect-card">${assetImage(`sects/${sect.name}`, '', `${sect.name}山门`)}<h4>${sect.name}</h4><p>${sect.style}</p><button class="ink-button" data-action="join-sect" data-sect="${sect.id}" ${canJoin ? '' : 'disabled'}>拜入山门</button></article>`).join('')}</div>
  `;
}

function renderSkills(game, data) {
  const known = game.state.skills.known;
  return `
    <div class="grid two">
      <article class="item"><h3>${icon('skill')}已修</h3>${known.length ? known.map((knownSkill) => {
        const skill = data.byId.skill[knownSkill.id];
        const active = knownSkill.id === game.state.skills.activeInner;
        return `<div class="skill-row ${active ? 'active' : ''}"><div><strong>${skill?.name ?? knownSkill.id}</strong><p>${skillKindLabel(skill?.kind)} · ${skill?.mastery_levels[knownSkill.mastery ?? 0] ?? '入门'} · ${escapeHtml(skillEffectText(skill, knownSkill))}</p></div>${skill?.kind === 'inner' ? `<button class="ink-button" data-action="active-skill" data-skill="${escapeHtml(knownSkill.id)}" ${active ? 'disabled' : ''}>${active ? '主修中' : '设主修'}</button>` : ''}</div>`;
      }).join('') : '<p>尚未习得功法，静待机缘或拜入山门。</p>'}</article>
      <article class="item"><h3>典籍目录</h3>${data.skills.slice(0, 18).map((skill) => `<p>${skill.name} · ${skill.grade} · ${skill.sect} · ${skillKindLabel(skill.kind)}</p>`).join('')}</article>
    </div>
  `;
}

function renderEquipment(game, data) {
  const owned = game.state.inventory.equipment;
  return `
    <article class="item equipped-panel"><h3>${icon('equipment')}已装备</h3>${Object.entries(game.state.inventory.equipped).map(([slot, id]) => {
      const item = id ? data.byId.equipment[id] : null;
      return `<div class="equipped-row">${item ? assetImage(`equipment/${item.id}`, 'equipment-thumb', item.name) : icon('equipment')}<span>${equipmentSlotLabel(slot)}</span><strong>${item?.name ?? '无'}</strong></div>`;
    }).join('')}</article>
    <div class="grid three item-gallery">${owned.length ? owned.map((id) => {
      const item = data.byId.equipment[id];
      return `<article class="item equipment-card">${assetImage(`equipment/${id}`, 'equipment-art', item?.name ?? id)}<h4>${item?.name ?? id}</h4><p>${item?.quality ?? ''} · ${equipmentSlotLabel(item?.slot)}</p><p class="pool-meta">${escapeHtml(equipmentEffectText(item))}</p><div class="row"><button class="ink-button" data-action="equip" data-item="${id}">佩用</button><button class="ink-button" data-action="carry" data-item="${id}">烙印</button></div></article>`;
    }).join('') : '<article class="item"><h4>行囊</h4><p>尚无装备，游历或奇遇可得。</p></article>'}</div>
  `;
}

function renderPills(game, data) {
  const pills = Object.entries(game.state.inventory.pills).filter(([, count]) => count > 0);
  const herbs = Object.entries(game.state.inventory.herbs).filter(([, count]) => count > 0);
  return `
    <div class="grid two">
      <article class="item"><h3>${icon('pill')}丹药</h3>${pills.length ? pills.map(([id, count]) => {
        const pill = data.byId.pill[id];
        return `<div class="pill-row">${assetImage(`pills/${id}`, 'pill-thumb', pill?.name ?? id)}<div><strong>${escapeHtml(pill?.name ?? id)} x${count}</strong><p>${escapeHtml(pillEffectText(pill))}</p></div><button class="ink-button" data-action="use-pill" data-pill="${escapeHtml(id)}">服用</button></div>`;
      }).join('') : '<p>丹炉暂空，采药后会炼制入丹匣；成丹后可在此手动服用。</p>'}</article>
      <article class="item"><h3>药材</h3>${herbs.length ? herbs.map(([name, count]) => `<p>${name} x${count}</p>`).join('') : '<p>暂无药材。</p>'}</article>
    </div>
    <div class="grid three item-gallery">${data.pills.map((pill) => `<article class="item pill-card">${assetImage(`pills/${pill.id}`, 'pill-art', pill.name)}<h4>${pill.name}</h4><p>${pill.type}</p><p class="pool-meta">${escapeHtml(pillEffectText(pill))}</p></article>`).join('')}</div>
  `;
}

function renderAchievements(game, data) {
  const { groups, totalDone, totalAll, claimable } = achievementProgress(game.state, data);
  return `
    <section class="achievements-board">
      <article class="item achievement-total">
        <h3>${icon('fate')}成就进度</h3>
        <strong>${totalDone}/${totalAll}</strong>
        <div class="ink-progress"><i style="width:${Math.min(100, totalAll ? (totalDone / totalAll) * 100 : 0)}%"></i><span>总解锁 ${Math.floor(totalAll ? (totalDone / totalAll) * 100 : 0)}%</span></div>
      </article>
      <article class="item achievement-rewards">
        <h3>${icon('immortal')}可领取奖励</h3>
        ${claimable.length ? claimable.map((milestone) => `<div class="achievement-reward-row"><div><strong>${escapeHtml(milestone.title)}</strong><p>机缘 ${milestone.reward.fate}${milestone.reward.immortal ? ` · 仙缘 ${milestone.reward.immortal}` : ''}</p></div><button class="ink-button cinnabar-action" data-action="claim-achievement" data-achievement="${escapeHtml(milestone.id)}">领取</button></div>`).join('') : '<p class="empty">暂无可领取成就，继续游历、收集和转世会开启新奖励。</p>'}
      </article>
      <div class="achievement-summary">
        ${groups.map((group) => `<article class="achievement-stat"><span>${icon(group.iconName)}${group.title}</span><strong>${group.done}/${group.total}</strong></article>`).join('')}
      </div>
      <div class="grid two">
        ${groups.map((group) => {
          const percent = Math.min(100, group.total ? (group.done / group.total) * 100 : 0);
          return `<article class="item achievement-card"><h3>${icon(group.iconName)}${group.title}</h3><strong>${group.done}/${group.total}</strong><div class="ink-progress"><i style="width:${percent}%"></i><span>${Math.floor(percent)}%</span></div><div class="achievement-milestones">${group.milestones.map((milestone) => `<span class="${milestone.claimed ? 'claimed' : milestone.unlocked ? 'unlocked' : ''}">${escapeHtml(milestone.label)}</span>`).join('')}</div>${renderAchievementCodex(group)}<div class="achievement-tags">${group.detail.slice(0, 18).map((detail) => `<span class="${detail.done ? 'done' : ''}">${escapeHtml(detail.name)}</span>`).join('')}</div></article>`;
        }).join('')}
      </div>
    </section>
  `;
}

function renderAchievementCodex(group) {
  const shown = [...group.detail]
    .sort((a, b) => Number(b.done) - Number(a.done))
    .slice(0, 10);
  if (!shown.length) return '<div class="achievement-codex empty"><span>暂无图鉴</span></div>';
  return `
    <div class="achievement-codex" data-testid="achievement-codex-${escapeHtml(group.id)}">
      ${shown.map((detail) => {
        const image = achievementDetailImage(group.id, detail);
        return `<figure class="${detail.done ? 'unlocked' : 'locked'}">${assetImage(image, 'achievement-codex-art', detail.name, detail.done ? '' : 'data-no-preview')}<figcaption>${escapeHtml(detail.done ? detail.name : '未解锁')}</figcaption></figure>`;
      }).join('')}
    </div>
  `;
}

function achievementDetailImage(groupId, detail) {
  if (detail.image) return detail.image;
  if (groupId === 'sects') {
    const sect = detail.id ? dataSectName(detail) : detail.name;
    return sect ? `sects/${sect}` : 'icons/sect';
  }
  if (groupId === 'equipment') return `equipment/${detail.id}`;
  if (groupId === 'pills') return `pills/${detail.id}`;
  if (groupId === 'sites') return `scenes/${siteScene(detail)}`;
  if (groupId === 'history') return 'events/encounter';
  return 'icons/lamp';
}

function dataSectName(detail) {
  return detail.name;
}

function siteScene(detail) {
  const bySite = {
    luoxia_cave: 'zhongyuan-luoxia-cave',
    ancient_library: 'zhongyuan-ancient-library',
    rain_lake: 'jiangnan-rain-lake',
    bamboo_manor: 'jiangnan-bamboo-manor',
    wolf_pass: 'saiwai-wolf-pass',
    dust_tomb: 'saiwai-dust-tomb',
    bingfeng_cave: 'xiyu-bingfeng-cave',
    sand_palace: 'xiyu-sand-palace',
    shu_path: 'bashu-shu-path',
    fog_valley: 'bashu-fog-valley',
    miasma_marsh: 'lingnan-miasma-marsh',
    south_sea_ruin: 'lingnan-south-sea-ruin'
  };
  return bySite[detail.id] ?? mapNodes[detail.regionId]?.scene ?? 'mortal';
}

function renderRelations(game, data) {
  const { state } = game;
  const spouse = state.family.spouse;
  const children = state.family.children ?? [];
  const sect = state.sect.id ? data.byId.sect[state.sect.id] : null;
  const foundedSect = state.sect.founded ? {
    name: state.sect.customName,
    rank: '开山祖师',
    image: 'scenes/sect-inner-court',
    reputation: state.sect.reputation
  } : null;
  const activeSkill = state.skills.activeInner ? data.byId.skill[state.skills.activeInner] : null;
  const traceNodes = relationTraceNodes(state);
  const nodes = [
    { role: '本世', name: state.player.name, meta: `${lifeStage(state.player.age)} · ${currentRealmName(state, data)}`, image: portraitAsset(state), primary: true, strength: '命主' },
    spouse ? { role: '配偶', name: spouse.name, meta: `情分 ${Math.floor(spouse.bond)}`, image: relationPortrait('spouse', state), strength: `情分 ${Math.floor(spouse.bond)}` } : null,
    sect ? { role: '门派', name: sect.name, meta: sect.ranks[state.sect.rank] ?? '弟子', image: `sects/${sect.name}`, strength: `声望 ${state.sect.reputation}` } : null,
    !sect && foundedSect ? { role: '自立门派', name: foundedSect.name, meta: foundedSect.rank, image: foundedSect.image, strength: `声望 ${foundedSect.reputation}` } : null,
    activeSkill ? { role: '主修', name: activeSkill.name, meta: `${activeSkill.sect} · ${skillKindLabel(activeSkill.kind)}`, image: relationPortrait('mentor', state), strength: '道统' } : null,
    ...children.slice(0, 6).map((child, index) => ({ role: '子嗣', name: child.name, meta: `${child.age.toFixed(1)}岁 · ${child.path}`, image: relationPortrait('child', state, index), strength: child.status ?? '家脉' })),
    ...traceNodes
  ].filter(Boolean);
  const center = nodes[0];
  const satellites = nodes.slice(1, 13).map((node, index, list) => ({
    ...node,
    angle: list.length ? (-90 + (360 / list.length) * index) : -90
  }));
  const summary = [
    `配偶 ${spouse ? 1 : 0}`,
    `子嗣 ${children.length}`,
    `门派 ${sect || foundedSect ? 1 : 0}`,
    `跨世留痕 ${traceNodes.length}`
  ].join(' · ');
  return `
    <section class="relations-board">
      <div class="relation-graph" data-testid="relation-graph">
        <svg class="relation-lines" viewBox="0 0 100 100" aria-hidden="true">
          ${satellites.map((node) => {
            const point = relationPoint(node.angle);
            return `<line x1="50" y1="50" x2="${point.x}" y2="${point.y}" />`;
          }).join('')}
        </svg>
        ${relationNodeMarkup(center, 'center', 0)}
        ${satellites.map((node, index) => relationNodeMarkup(node, 'satellite', index)).join('')}
      </div>
      <article class="item">
        <h3>${icon('history')}关系概览</h3>
        <p>${summary}。关系图会随本世修行、家族、门派和前世因果实时变化，头像随主角性别和人物类型切换。</p>
      </article>
    </section>
  `;
}

function relationNodeMarkup(node, kind, index) {
  const point = kind === 'center' ? { x: 50, y: 50 } : relationPoint(node.angle);
  return `
    <article class="relation-node ${kind} ${node.primary ? 'primary' : ''}" style="--x:${point.x}%;--y:${point.y}%">
      ${assetImage(node.image, 'relation-avatar', `${node.name}头像`)}
      <div>
        <span>${escapeHtml(node.role)}</span>
        <h3>${escapeHtml(node.name)}</h3>
        <p>${escapeHtml(node.meta)}</p>
        <small>${escapeHtml(node.strength ?? relationStrengthLabel(index))}</small>
      </div>
    </article>
  `;
}

function relationPoint(angle) {
  const rad = (angle * Math.PI) / 180;
  return {
    x: Number((50 + Math.cos(rad) * 28).toFixed(2)),
    y: Number((50 + Math.sin(rad) * 30).toFixed(2))
  };
}

function relationStrengthLabel(index) {
  return index % 2 === 0 ? '因果牵连' : '命线相接';
}

function relationTraceNodes(state) {
  const traces = [...(state.events.traces ?? [])].slice(-5).reverse();
  return traces.map((trace, index) => ({
    role: traceRoleLabel(trace.type),
    name: traceNameLabel(trace.type),
    meta: trace.summary ?? '前世因果尚未显形',
    image: relationPortrait(trace.type, state, index),
    strength: trace.type === 'nemesis' ? '旧怨' : trace.type === 'descendant' ? '血脉' : '留痕'
  }));
}

function traceRoleLabel(type) {
  const labels = {
    nemesis: '前世恩怨',
    descendant: '前世血脉',
    relic: '前世遗宝',
    legend: '前世传闻'
  };
  return labels[type] ?? '前世留痕';
}

function traceNameLabel(type) {
  const labels = {
    nemesis: '旧敌余波',
    descendant: '血脉回声',
    relic: '遗宝线索',
    legend: '江湖传闻'
  };
  return labels[type] ?? '未了因果';
}

function renderMap(game, data) {
  const currentId = game.state.map.regionId;
  return `
    <section class="map-overview">
      <div class="map-panel-large">${renderMiniMap(game, data)}</div>
      <div class="region-card-grid">${data.regions.map((region) => {
        const active = region.region_id === currentId;
        const sites = region.secret_sites.map(siteLabel).join('、');
        const pools = (region.event_pool ?? []).map(categoryLabel).join(' / ');
        const node = mapNodes[region.region_id] ?? { scene: 'mortal' };
        return `<article class="item map-slip ${active ? 'active' : ''}">${assetImage(`scenes/${node.scene}`, 'region-thumb', '', 'aria-hidden="true"')}<h3>${icon('map')}${region.name}</h3><p>${region.sects.join(' / ')}</p><p>${sites}</p><p class="pool-meta">${escapeHtml(pools)}</p><button class="ink-button" data-action="route" data-region="${region.region_id}">${active ? '驻留此地' : '改道前往'}</button></article>`;
      }).join('')}</div>
    </section>
  `;
}

function renderFamily(game) {
  const { state } = game;
  const { family } = state;
  return `
    <article class="item family-panel">${assetImage(relationPortrait('spouse', state), '', family.spouse?.name ?? '配偶')}<div><h3>配偶</h3><p>${family.spouse ? `${family.spouse.name} · 情分 ${Math.floor(family.spouse.bond)}` : '未婚'}</p></div></article>
    <div class="grid three">${family.children.length ? family.children.map((child, index) => `<article class="item child-card">${assetImage(relationPortrait('child', state, index), '', child.name)}<h4>${child.name}</h4><p>${child.age.toFixed(1)}岁 · ${child.path} · ${child.status}</p></article>`).join('') : '<article class="item"><h4>子嗣</h4><p>暂无子嗣，情缘事件或许会改写命书。</p></article>'}</div>
  `;
}

function renderHistory(game) {
  return game.state.history.length ? `<div class="history chronicle">${[...game.state.history].reverse().map((entry) => `<button class="item chronicle-page history-button" data-action="history-detail" data-life="${entry.life_no}"><div class="seal small">${entry.epithet}</div><div><h3>第${entry.life_no}世</h3><p>${entry.name} / ${entry.sect} / ${entry.peak_realm} / ${entry.death_cause} / ${entry.died_at_age}岁</p><p>${entry.key_events.map(escapeHtml).join('、')}</p></div></button>`).join('')}</div>` : '<p class="empty">史册未开，待一世落幕后朱印成页。</p>';
}

function renderHistoryPreview(entry) {
  return `
    <section class="history-preview-layer" data-testid="history-preview">
      <div class="history-preview book-page stamp-scene">
        <header class="dialog-head">
          <div>
            <p class="eyebrow">第${entry.life_no}世 · ${escapeHtml(entry.epithet)}</p>
            <h2>${escapeHtml(entry.name)}的一世概览</h2>
          </div>
          <button class="ink-button" data-action="close-history-preview" data-testid="close-history-preview">关闭</button>
        </header>
        <div class="history-summary-grid">
          <div class="seal">${escapeHtml(entry.epithet)}</div>
          <div>
            <p>${escapeHtml(entry.sect)} / ${escapeHtml(entry.peak_realm)} / ${escapeHtml(entry.death_cause)} / ${entry.died_at_age}岁</p>
            <p>机缘 ${entry.currency_gained ?? 0}${entry.immortal_gained ? ` · 仙缘 ${entry.immortal_gained}` : ''}</p>
          </div>
        </div>
        <div class="history-events">${(entry.key_events ?? []).map((event) => `<p>${escapeHtml(event)}</p>`).join('') || '<p>此世平淡无波。</p>'}</div>
      </div>
    </section>
  `;
}

function renderImmortal(game, data) {
  const { state } = game;
  const immortalItems = data.shop.filter((item) => item.currency === 'immortal');
  const latestAscension = [...state.history].reverse().find((entry) => entry.death_cause === '飞升');
  if (!state.isAscended) {
    const ready = canAscend(state);
    const percent = Math.min(100, Math.max(0, (state.meta.reincarnations / 20) * 100));
    return `
      <section class="immortal-board">
        <article class="item immortal-empty">
          ${assetImage('events/ascension', 'immortal-scene-art', '天门')}
          <div>
            <h3>${icon('immortal')}天门未开</h3>
            <p>飞升至少需要二十世轮回积累。当前第 ${state.meta.reincarnations} 次轮回，${ready ? '已具登天资粮，只待渡劫叩门。' : '仍需继续转世积累。'}</p>
            <div class="ink-progress"><i style="width:${percent}%"></i><span>飞升准备 ${Math.floor(percent)}%</span></div>
          </div>
        </article>
        <div class="grid two">${immortalItems.map((item) => renderImmortalShopCard(state, data, item)).join('')}</div>
      </section>
    `;
  }
  return `
    <section class="immortal-board">
      <article class="item immortal">
        ${assetImage('events/ascension', 'immortal-scene-art', '仙界逍遥')}
        <div>
          <p class="eyebrow">第 ${state.meta.ascensions} 次飞升</p>
          <h3>${icon('immortal')}仙界逍遥</h3>
          <p>云海无岸，旧世因果在脚下翻涌。此刻可用仙缘购入仙阶造化，再拓印来世。</p>
          <div class="immortal-stats">
            <span>仙缘 <b>${Math.floor(state.currencies.immortal)}</b></span>
            <span>机缘 <b>${Math.floor(state.currencies.fate)}</b></span>
            <span>轮回 <b>${state.meta.reincarnations}</b></span>
          </div>
          <button class="primary ink-button" data-action="reincarnate" data-testid="immortal-reincarnate">继续轮回</button>
        </div>
      </article>
      ${latestAscension ? `<article class="item immortal-record"><h3>${icon('history')}最近飞升</h3><p>${escapeHtml(latestAscension.name)} · ${latestAscension.died_at_age}岁 · 得仙缘 ${latestAscension.immortal_gained ?? 0}</p><p>${latestAscension.key_events.map(escapeHtml).join('、')}</p></article>` : ''}
      <div class="grid two immortal-shop-grid">${immortalItems.map((item) => renderImmortalShopCard(state, data, item)).join('')}</div>
    </section>
  `;
}

function renderImmortalShopCard(state, data, item) {
  const level = state.shop.levels[item.id] ?? 0;
  const cost = shopCost(item, level);
  const disabled = !Number.isFinite(cost) || state.currencies.immortal < cost;
  return `
    <article class="item immortal-shop-card">
      ${assetImage(`icons/${shopIcon(item.category)}`, 'immortal-shop-icon', item.name, 'data-no-preview')}
      <div>
        <h4>${escapeHtml(item.name)}</h4>
        <p>${escapeHtml(item.description ?? shopItemDescription(item, data))}</p>
        <p class="shop-effect">${escapeHtml(shopEffectText(item, data))}</p>
        <p class="shop-meta">Lv ${level}/${item.max_level} · ${Number.isFinite(cost) ? `仙缘 ${cost}` : '已满'}</p>
      </div>
      <button class="ink-button cinnabar-action" data-action="shop-buy" data-item="${item.id}" ${disabled ? 'disabled' : ''}>购入</button>
    </article>
  `;
}

function icon(name) {
  return assetImage(`icons/${name}`, 'ui-icon', '', 'aria-hidden="true"');
}

function metricChip(iconName, label, value, liveKey = '') {
  const liveAttribute = liveKey ? ` data-live="${liveKey}"` : '';
  return `<span class="metric-chip">${icon(iconName)}<b>${label}</b><strong${liveAttribute}>${value}</strong></span>`;
}

function statusRow(iconName, label, value, liveKey = '') {
  const liveAttribute = liveKey ? ` data-live="${liveKey}"` : '';
  return `<div class="status-row">${icon(iconName)}<span>${label}</span><strong${liveAttribute}>${value}</strong></div>`;
}

function stageClass(state) {
  if (state.isAscended || state.realm.index >= 9) return 'stage-immortal';
  if (state.realm.index >= 3) return 'stage-cultivation';
  return 'stage-mortal';
}

function stageLabel(state) {
  if (state.isAscended || state.realm.index >= 9) return '月白仙境';
  if (state.realm.index >= 3) return '黛青仙途';
  return '人间江湖';
}

function sceneAsset(state) {
  const tick = state.map.travelTick ?? state.progression?.adventures ?? 0;
  if (state.isAscended || state.realm.index >= 9) return `scenes/${pickAsset(immortalScenes, tick)}`;
  if (state.realm.index >= 3) return `scenes/${pickAsset(cultivationScenes, tick + state.realm.index)}`;
  const variants = regionSceneVariants[state.map.regionId] ?? ['mortal'];
  return `scenes/${pickAsset(variants, tick + Math.floor(state.player.age / 8))}`;
}

function portraitAsset(state) {
  const set = heroPortraits[state.player.gender] ?? heroPortraits.male;
  if (state.isAscended || state.realm.index >= 9) return `portraits/${pickAsset(set.immortal, state.meta.ascensions + state.realm.index)}`;
  if (state.realm.index >= 3) return `portraits/${pickAsset(set.cultivation, state.realm.index + (state.map.travelTick ?? 0))}`;
  if (state.player.age < 13) return `portraits/${pickAsset(set.child, state.meta.reincarnations)}`;
  if (state.player.age < 25) return `portraits/${pickAsset(set.youth, Math.floor(state.player.age / 5) + (state.map.travelTick ?? 0))}`;
  if (state.player.age >= 55) return `portraits/${pickAsset(set.elder, Math.floor(state.player.age / 10) + state.realm.index)}`;
  return `portraits/${pickAsset(set.adult, Math.floor(state.player.age / 12) + (state.sect.id ? 2 : 0))}`;
}

function relationPortrait(role, state, seed = 0) {
  const feminine = state.player.gender === 'female' || seed % 2 === 1;
  const suffix = feminine ? '-female' : '';
  if (role === 'spouse') return `portraits/spouse${state.player.gender === 'male' ? '-female' : ''}`;
  if (role === 'child') return `portraits/child${suffix}`;
  if (role === 'mentor') return `portraits/mentor${suffix}`;
  if (role === 'nemesis') return `portraits/nemesis${suffix}`;
  if (role === 'descendant') return `portraits/child${suffix}`;
  if (role === 'relic' || role === 'legend') return `portraits/benefactor${suffix}`;
  if (role === 'benefactor') return `portraits/benefactor${suffix}`;
  return 'portraits/benefactor';
}

function pickAsset(list, seed = 0) {
  return list[Math.abs(Math.floor(seed)) % list.length] ?? list[0];
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

function regionName(data, regionId) {
  return data.byId.region[regionId]?.name ?? regionId ?? '旧路';
}

function categoryLabel(category) {
  return String(category ?? '')
    .replace(/^[A-I]_/, '')
    .replace('救命_死里逃生', '死里逃生')
    .replace('人生阶段氛围', '人生氛围');
}

function assetImage(path, className, alt = '', extraAttributes = '') {
  const classAttribute = className ? ` class="${className}"` : '';
  const previewable = isPreviewableAsset(path, extraAttributes);
  const src = assetUrl(path);
  const preview = previewable ? ` data-preview-src="${src}" data-preview-title="${escapeHtml(alt || imageTitle(path))}" role="button" tabindex="0"` : '';
  const extra = extraAttributes ? ` ${extraAttributes}` : '';
  return `<img${classAttribute} src="${src}" alt="${escapeHtml(alt)}"${preview}${extra}>`;
}

function assetUrl(path, extension = ASSET_EXTENSION) {
  return `${ASSET_ROOT}/${path}.${extension}`;
}

function isPreviewableAsset(path, extraAttributes = '') {
  if (extraAttributes.includes('data-no-preview')) return false;
  return !path.startsWith('icons/') && !path.startsWith('ui/');
}

function imageTitle(path) {
  return path.split('/').at(-1)?.replace(/[-_]/g, ' ') ?? '图片';
}

function eventArt(rendered = {}) {
  const text = `${rendered.category ?? ''} ${rendered.title ?? ''} ${rendered.text ?? ''}`;
  if (/飞升|仙界|天门/.test(text)) return 'events/ascension';
  if (/渡劫|陨落|横死|灾厄|救命|死里逃生/.test(text)) return 'events/tribulation';
  if (/婚姻|子嗣|家|配偶|情感/.test(text)) return 'events/family';
  return 'events/encounter';
}

function shopIcon(category) {
  const map = {
    修行: 'skill',
    命数: 'lamp',
    渡劫: 'lotus',
    福缘: 'fate',
    道心: 'mood',
    出身: 'sect',
    仙阶: 'immortal'
  };
  return map[category] ?? 'fate';
}

function shopItemDescription(item, data) {
  const effect = item.effect ?? {};
  if (effect.unlock_origin) {
    const originName = data.byId.origin[effect.unlock_origin]?.name ?? '新出身';
    return `解锁${originName}，后续轮回可选择该出身。`;
  }
  if (effect.carry_slot) return '增加可跨世保留的神兵数量。';
  if (effect.jade_charm_per_life) return '每世开局获得护身玉符，抵消意外横死。';
  if (effect.lotus_per_life) return '每世开局获得护道莲台，渡劫失败时先保命。';
  if (effect.tribulation) return '提高大境界渡劫成功率。';
  if (effect.lifespan) return '延长寿元上限。';
  if (effect.death_risk) return '降低每年的横死风险。';
  if (effect.mood_start) return '提高每世开局心境。';
  if (effect.mood_damping) return '减少事件造成的心境波动。';
  return '提供永久成长加成。';
}

function shopEffectText(item, data) {
  const effect = item.effect ?? {};
  if (item.id === 'foundation_stability') return '每12级：渡劫失败少倒退1层';
  if (item.id === 'calamity_talisman') return '每10级：渡劫失败少倒退1层';
  if (effect.starting_skill) return '1级习得功法，每8级提高初始熟练度';
  if (effect.cultivation) return `每级修行速度 +${formatPercent(effect.cultivation)}`;
  if (effect.minor_breakthrough) return `每级小境界门槛 -${formatPercent(effect.minor_breakthrough)}`;
  if (effect.lifespan) return `每级寿元 +${formatNumber(effect.lifespan)}年`;
  if (effect.death_risk) return `每级横死率 -${formatPercent(Math.abs(effect.death_risk))}/年`;
  if (effect.jade_charm_per_life) return `每级每世玉符 +${effect.jade_charm_per_life}`;
  if (effect.tribulation) return `每级渡劫率 +${formatPercent(effect.tribulation)}`;
  if (effect.lotus_per_life) return `每级每世莲台 +${effect.lotus_per_life}`;
  if (effect.event_weight) return `每级事件权重 +${formatPercent(effect.event_weight)}`;
  if (effect.aptitude) return `每级修行悟性 +${formatPercent(effect.aptitude)}`;
  if (effect.mood_start) return `每级开局心境 +${formatNumber(effect.mood_start)}`;
  if (effect.mood_damping) return `每级心境波动 -${formatPercent(effect.mood_damping)}`;
  if (effect.unlock_origin) {
    const originName = data.byId.origin[effect.unlock_origin]?.name ?? '新出身';
    return `解锁出身：${originName}`;
  }
  if (effect.global_mult) return `每级全局修行 +${formatPercent(effect.global_mult)}`;
  if (effect.carry_slot) return `每级传承栏位 +${effect.carry_slot}`;
  return '永久生效';
}

function formatPercent(value) {
  return `${formatNumber(value * 100)}%`;
}

function formatNumber(value) {
  return Number(value).toFixed(1).replace(/\.0$/, '');
}

function skillKindLabel(kind) {
  const map = {
    inner: '内功',
    outer: '外功',
    movement: '身法',
    support: '辅助'
  };
  return map[kind] ?? '功法';
}

function skillEffectText(skill, knownSkill = {}) {
  const effect = skill?.effects_per_level ?? {};
  const level = Math.max(1, (knownSkill.mastery ?? 0) + 1);
  const parts = [];
  if (effect.cultivate_speed) parts.push(`修行 ${formatPercent(effect.cultivate_speed * level)}`);
  if (effect.internal_cap) parts.push(`内力 +${formatNumber(effect.internal_cap * level)}`);
  if (effect.tribulation) parts.push(`渡劫 ${formatPercent(effect.tribulation * level)}`);
  return parts.join(' · ') || skill?.attribute || '静候参悟';
}

function equipmentSlotLabel(slot) {
  const map = {
    weapon: '兵刃',
    armor: '护具',
    accessory: '佩饰'
  };
  return map[slot] ?? '装备';
}

function equipmentEffectText(item) {
  const effect = item?.effects ?? {};
  const parts = [];
  if (effect.atk) parts.push(`攻 ${formatNumber(effect.atk)}`);
  if (effect.defense) parts.push(`护 ${formatNumber(effect.defense)}`);
  if (effect.death_risk) parts.push(`避险 ${formatPercent(Math.abs(effect.death_risk))}`);
  if (effect.cultivate_speed) parts.push(`修行 ${formatPercent(effect.cultivate_speed)}`);
  if (item?.transferable) parts.push('可烙印');
  return parts.join(' · ') || item?.special || '江湖器物';
}

function pillEffectText(pill) {
  const effect = pill?.effect ?? {};
  const parts = [];
  if (effect.heal_injury_years) parts.push(`疗伤 ${effect.heal_injury_years}年`);
  if (effect.lifespan) parts.push(`寿元 +${effect.lifespan}`);
  if (effect.cultivate_speed) parts.push(`修行加速 ${formatPercent(effect.cultivate_speed)}`);
  if (effect.tribulation) parts.push(`渡劫率 +${formatPercent(effect.tribulation)}`);
  if (effect.mood) parts.push(`心境 +${effect.mood}`);
  return parts.join(' · ') || '温养根基';
}

function sectName(state, data) {
  if (state.sect.founded) return state.sect.customName;
  if (state.sect.id) return data.byId.sect[state.sect.id]?.name ?? '旧门';
  return '无门无派';
}

function groupBy(items, key) {
  return items.reduce((groups, item) => {
    const value = item[key];
    groups[value] ??= [];
    groups[value].push(item);
    return groups;
  }, {});
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}
