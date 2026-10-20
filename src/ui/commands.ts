import { app, hooks } from '../game/state';
import { IT } from '../game/config';
import { ST } from '../game/storage';
import { rc } from '../game/sim/units';
import { ui } from './store';
import { publishHud } from './hudData';
import { setQuality } from '../render/quality';
import type { QualitySetting } from '../render/quality';
import { audioPrefs, playUI, resetAudio, setMuted, setVolume } from '../audio/audio';
import type { Bus } from '../audio/AudioManager';

export function setPause(v: boolean): void { if (!app.G || app.G.over) return; app.G.pause = v; ui.set({ paused: v }); playUI(v ? 'uiPause' : 'uiResume'); }
export function toggleShop(): void {
  if (!app.G || app.G.over) return;
  const open = !ui.get().shop;
  ui.set({ shop: open });
  playUI(open ? 'shopOpen' : 'shopClose');
}
export function finishMatch(winner: number): void { app.G.over = true; app.G.win = winner; ui.set({ result: winner === 0 ? 'victory' : 'defeat', shop: false }); }

/** Audio settings (menu): the manager persists and applies the change; the store refresh keeps every control in sync. */
export function setAudioVolume(bus: Bus, volume: number): void { setVolume(bus, volume); ui.set({ audio: audioPrefs() }); }
export function setAudioMuted(muted: boolean): void { setMuted(muted); ui.set({ audio: audioPrefs() }); }

const refresh = () => { publishHud(); ui.set({ rev: ui.get().rev + 1 }); };
export function buy(n: number): void {
  const it = IT[n], me = app.me;
  if (me.g < it[1] || me.it.length >= 6) { hooks.ft(me.x, me.y - 40, me.it.length >= 6 ? 'Inventory full' : 'Not enough gold', '#ffe066'); playUI('uiError'); return; }
  me.g -= it[1]; me.it.push({ n: it[0], c: it[1], b: it[2] }); rc(me); refresh();
  playUI('shopBuy');
}
export function sell(n: number): void {
  const it = app.me.it.splice(n, 1)[0];
  if (it) { app.me.g += Math.floor(it.c * .6); rc(app.me); refresh(); playUI('shopSell'); return; }
  playUI('uiError'); // an empty slot: a rejected action, not silence
}

export function setSetting(key: 'zoom' | 'showFps' | 'bloom', value: number | boolean): void {
  if (key === 'zoom') ST.set('zoom', value); else if (key === 'showFps') ST.set('fps', value); else { app.bloom = value as boolean; ST.set('bloom', value); }
  ui.set({ [key]: value } as Partial<ReturnType<typeof ui.get>>);
}
/** Graphics quality: 'auto' (the governor decides) or a fixed level 0 (minimum) to 3 (high). */
export function setGraphics(value: string): void {
  const mode: QualitySetting = value === 'auto' ? 'auto' : (Math.max(0, Math.min(3, +value || 0)) as QualitySetting);
  ST.set('quality', mode); setQuality(mode);
  ui.set({ quality: String(mode) });
}
export function resetSettings(): void {
  ['zoom', 'fps', 'hero', 'pack', 'bloom', 'quality', 'vol', 'vol_sfx', 'vol_music', 'vol_amb', 'vol_ui', 'mute'].forEach(k => { try { localStorage.removeItem('rs_' + k); } catch { /* storage unavailable */ } });
  app.bloom = true; app.pack = 'procedural'; setQuality('auto'); resetAudio();
  ui.set({ zoom: 1, showFps: false, bloom: true, quality: 'auto', audio: audioPrefs(), pack: 'procedural', packLoading: false, packMissing: 0 });
}
