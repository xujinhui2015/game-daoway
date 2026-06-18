import { loadGameData } from './engine/data-loader.js';
import { createGame } from './engine/engine.js';
import { loadSave } from './engine/save.js';
import { initApp } from './ui/app.js';
import { triggerEvent } from './engine/events.js';

const root = document.querySelector('#app');
const params = new URLSearchParams(location.search);
const verify = params.has('verify');

try {
  const data = await loadGameData();
  const saved = loadSave();
  const game = saved ? createGame(data, { state: saved, verify }) : null;
  window.__daowayEvents = { triggerEvent };
  initApp(root, data, game, { verify });
} catch (error) {
  console.error(error);
  root.innerHTML = `<main class="start"><section class="start-panel"><h1>载入失败</h1><pre>${String(error.stack ?? error)}</pre></section></main>`;
}
