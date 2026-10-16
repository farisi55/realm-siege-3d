import { app, hooks } from '../game/state';
import { IT } from '../game/config';
import { ST } from '../game/storage';
import { rc } from '../game/sim/units';
import { ui } from './store';
import { publishHud } from './hudData';
import { setQuality } from '../render/quality';
import type { QualitySetting } from '../render/quality';

export function setPause(v: boolean): void { if (!app.G || app.G.over) return; app.G.pause = v; ui.set({ paused: v }); }
export function toggleShop(): void { if (!app.G || app.G.over) return; ui.set({ shop: !ui.get().shop }); }
export function finishMatch(winner: number): void { app.G.over = true; app.G.win = winner; ui.set({ result: winner === 0 ? 'victory' : 'defeat', shop: false }); }

const refresh = () => { publishHud(); ui.set({ rev: ui.get().rev + 1 }); };
export function buy(n: number): void {
  const it = IT[n], me = app.me;
  if (me.g < it[1] || me.it.length >= 6) { hooks.ft(me.x, me.y - 40, me.it.length >= 6 ? 'Inventory full' : 'Not enough gold', '#ffe066'); return; }
  me.g -= it[1]; me.it.push({ n: it[0], c: it[1], b: it[2] }); rc(me); refresh();
}
export function sell(n: number): void {
  const it = app.me.it.splice(n, 1)[0];
  if (it) { app.me.g += Math.floor(it.c * .6); rc(app.me); refresh(); }
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
  ['zoom', 'fps', 'hero', 'bloom', 'quality'].forEach(k => { try { localStorage.removeItem('rs_' + k); } catch { /* storage unavailable */ } });
  app.bloom = true; setQuality('auto'); ui.set({ zoom: 1, showFps: false, bloom: true, quality: 'auto' });
}
