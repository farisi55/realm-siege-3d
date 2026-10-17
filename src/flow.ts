import { buildEnvironment, updateEnvironment } from './render/environment';
import './render/input';
import { app, hooks } from './game/state';
import { ST } from './game/storage';
import { startMatch, step } from './game/match';
import { assets } from './assets/AssetManager';
import { fx, ft, resetFx } from './render/vfx';
import { clearR } from './render/units';
import { pvShow, prev, resetStage } from './render/stage';
import { renderFrame } from './render/post';
import { setQuality, tickQuality } from './render/quality';
import type { QualitySetting } from './render/quality';
import { ui, pushFeed } from './ui/store';
import { publishHud } from './ui/hudData';
import { finishMatch, resetSettings } from './ui/commands';
import { initAudio, playSFX, playUI, preloadAudio, stopAll } from './audio/audio';
import { resetCombatAudio, sndEvent } from './audio/combat';
import { worldAudioTick } from './audio/world';

/** Wires the simulation to the renderer and the React UI, preloads models, then opens the menu. */
export async function boot(): Promise<void> {
  initAudio(); void preloadAudio(); // unlock on the first gesture; optional sound files load in the background
  app.sel = ST.get('hero', 0); app.bloom = ST.get('bloom', true);
  setQuality(ST.get('quality', 'auto') as QualitySetting);
  hooks.fx = fx; hooks.ft = ft; hooks.feed = pushFeed; hooks.finish = finishMatch; hooks.snd = sndEvent;
  ui.set({ phase: 'loading', sel: app.sel });
  // models (network) and the world (CPU: ground texture, meshes, plants) load side by side; one bar for both
  let models = [0, 1], world = [0, 1];
  const report = (): void => ui.set({ loading: { done: models[0] + world[0], total: models[1] + world[1] } });
  try {
    await Promise.all([
      assets.preload((done, total) => { models = [done, total]; report(); }),
      buildEnvironment({ onProgress: (done, total) => { world = [done, total]; report(); } }).catch(e => console.warn('Environment unavailable, continuing with an empty world:', e)),
    ]);
  } finally { ui.set({ phase: 'menu' }); }
  pvShow();
}
export function selectHero(i: number): void { app.sel = i; ST.set('hero', i); ui.set({ sel: i }); pvShow(); playUI('uiSelect'); }
export function resetAndShowMenu(): void { resetSettings(); app.sel = 0; ui.set({ sel: 0 }); pvShow(); }
export function play(): void {
  ST.set('hero', app.sel); startMatch();
  stopAll(); // a restart never keeps the previous match's collapse ringing
  resetCombatAudio();
  playSFX('matchStart');
  ui.set({ phase: 'play', paused: false, result: null, shop: false, scoreboard: false, feed: [] });
  publishHud();
}
export function toMenu(): void {
  app.mode = 'menu'; clearR(); resetFx(); app.G = null; resetStage();
  ui.set({ phase: 'menu', paused: false, result: null, shop: false, scoreboard: false, hud: null, feed: [] });
  pvShow();
}
/** One frame: simulation + render sync in a match, hero-stage preview in the menu, then draw (with bloom if enabled). */
export function frame(dt: number): void {
  if (dt > 0) app.fps += (1 / dt - app.fps) * .05;
  if (app.mode === 'play' && app.G) step(dt); else prev(dt);
  updateEnvironment(dt);
  tickQuality(dt);
  worldAudioTick(dt); // phase 4: listener, music scene, ambience, footsteps, rewards (all idempotent)
  renderFrame();
}
