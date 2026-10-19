import { AudioManager } from './AudioManager';
import type { Bus, PlayOptions } from './AudioManager';
import { SOUNDS } from './synth';

/**
 * The one audio facade the rest of the game imports — the mirror image of `render/vfx.ts` for sound:
 *
 *   AudioManager.ts   the engine: context, buses, voices, asset cache, persisted volumes
 *   synth.ts          the built-in synthesized sounds (the fallback when no file is loaded)
 *   audio.ts          this facade: gesture unlock, tab suspends, page cleanup, delegated UI clicks, the play API
 *
 * The simulation never imports this module; gameplay and UI code call it from the places that already touch the UI
 * (`flow.play`), and volume changes flow through `ui/commands.ts` into the settings menu.
 */

export const snd = new AudioManager(SOUNDS);

let wired = false;

/**
 * Called once from `boot()`: unlocks the context on the first gesture, suspends it in a hidden tab, stops every voice
 * when the page goes away, and plays the UI click for any control (one delegated listener, no per-button wiring).
 */
export function initAudio(): void {
  if (wired) return;
  wired = true;
  const unlock = (): void => snd.gesture();
  addEventListener('pointerdown', unlock, { capture: true, passive: true });
  addEventListener('keydown', unlock, { capture: true });
  document.addEventListener('visibilitychange', () => { if (document.hidden) snd.suspend(); else snd.resume(); });
  addEventListener('pagehide', () => snd.stopAll());
  // Capture phase so the click is heard even when a handler stops propagation; buttons, form controls and hero cards.
  document.addEventListener('click', e => {
    const el = e.target as HTMLElement | null;
    if (el?.closest?.('button, input, select, .hc')) snd.play('ui', 'uiClick');
  }, true);
  // Hover feedback where it means something (hero cards, settings rows) — never on every element of the page, and never
  // on touch: a tap would otherwise tick a hover voice on top of its own click.
  document.addEventListener('pointerover', e => {
    if ((e as PointerEvent).pointerType === 'touch') return;
    const el = e.target as HTMLElement | null;
    if (el?.closest?.('.hc, summary')) snd.play('ui', 'uiHover');
  }, true);
}

/** True when the context is running: sounds may play (the first user gesture got us here). */
export function isAudioUnlocked(): boolean { return snd.unlocked; }

export function playSFX(name: string, opts?: PlayOptions): boolean { return snd.play('sfx', name, opts); }
export function playUI(name: string, opts?: PlayOptions): boolean { return snd.play('ui', name, opts); }
export function playMusic(name: string, opts?: PlayOptions): boolean { return snd.play('music', name, opts); }
export function playAmbient(name: string, opts?: PlayOptions): boolean { return snd.play('ambient', name, opts); }

export function setVolume(bus: Bus, volume: number): void { snd.setVolume(bus, volume); }
export function setMuted(muted: boolean): void { snd.setMuted(muted); }
export function stopAll(bus?: Bus): void { snd.stopAll(bus); }
/** Moves the audio listener: the world layer pushes the camera focus and yaw every frame (`audio/world.ts`). */
export function setListener(x: number, y: number, yaw: number): void { snd.setListener(x, y, yaw); }
/** Ducks or restores the gameplay buses (music, sfx, ambient); the UI bus is never touched. */
export function setDuck(scale: number): void { snd.setDuck(scale); }
/** Clears every bus back to its default in memory (the caller removes the stored keys first). */
export function resetAudio(): void { snd.reset(); }
export function preloadAudio(): Promise<number> { return snd.preload(); }
export function audioPrefs() { return snd.prefs(); }
export function audioStats() { return snd.snapshot(); }
/** Page cleanup: stops voices, closes the context (the app keeps working; a later gesture rebuilds it). */
export function disposeAudio(): void { snd.dispose(); }

export type { Bus, PlayOptions } from './AudioManager';
