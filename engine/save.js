import { SAVE_KEY, SAVE_VERSION } from './constants.js';

export function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.version !== SAVE_VERSION) return null;
    return parsed.state;
  } catch (error) {
    console.warn('Failed to load save', error);
    return null;
  }
}

export function saveGame(state) {
  const snapshot = structuredClone(state);
  snapshot.meta.lastSavedAt = Date.now();
  localStorage.setItem(SAVE_KEY, JSON.stringify({ version: SAVE_VERSION, state: snapshot }));
  state.meta.lastSavedAt = snapshot.meta.lastSavedAt;
}

export function clearSave() {
  localStorage.removeItem(SAVE_KEY);
}
