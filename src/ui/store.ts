import { useSyncExternalStore } from 'react';
import { ST } from '../game/storage';

export interface FeedItem { id: number; msg: string; color: string }
export interface ScoreRow { team: number; name: string; lv: number; kills: number; deaths: number; me: boolean }
/** Numbers the HUD needs, copied from the simulation ~10x per second (never every frame). */
export interface HudSnap {
  hero: number; lv: number; hp: number; max: number; mp: number; mmax: number; xp: number; xpNext: number; gold: number;
  cds: number[]; items: (string | null)[]; kills: [number, number]; time: number; towers: [number, number];
  countdown: string; score: ScoreRow[] | null;
}
export interface UiState {
  phase: 'loading' | 'menu' | 'play'; loading: { done: number; total: number };
  paused: boolean; result: 'victory' | 'defeat' | null; shop: boolean; scoreboard: boolean; minimapBig: boolean;
  sel: number; zoom: number; showFps: boolean; bloom: boolean; quality: string; fps: number;
  feed: FeedItem[]; hud: HudSnap | null; rev: number;
}

let state: UiState = {
  phase: 'loading', loading: { done: 0, total: 1 }, paused: false, result: null, shop: false, scoreboard: false, minimapBig: false,
  sel: 0, zoom: ST.get('zoom', 1), showFps: ST.get('fps', false), bloom: ST.get('bloom', true), quality: String(ST.get('quality', 'auto')), fps: 60, feed: [], hud: null, rev: 0,
};
const subs = new Set<() => void>();

/** Tiny external store: the game (Three.js side) writes, React reads. */
export const ui = {
  get: (): UiState => state,
  set(patch: Partial<UiState>): void { state = { ...state, ...patch }; subs.forEach(f => f()); },
  subscribe(f: () => void): () => void { subs.add(f); return () => { subs.delete(f); }; },
};

/** Re-renders the component only when the selected slice changes (use primitives or stable references). */
export function useUi<T>(select: (s: UiState) => T): T {
  return useSyncExternalStore(ui.subscribe, () => select(state));
}

let feedId = 0;
export function pushFeed(msg: string, color: string): void {
  const id = ++feedId;
  ui.set({ feed: [...state.feed.slice(-5), { id, msg, color }] });
  setTimeout(() => ui.set({ feed: state.feed.filter(f => f.id !== id) }), 4500);
}
