import { snd } from './audio';
import type { LoopHandle } from './AudioManager';

/**
 * Phase 4: the soundtrack.
 *
 * One scene at a time, driven by the world ticker (`audio/world.ts`) from the same state the UI renders: the menu
 * shows the menu bed, a live match the subdued match bed, and a finished match one of two stingers. Beds are `loop`
 * definitions in the manifest that fade out on their own; `musicTick` restarts a bed that has faded and never starts
 * a second copy of the same scene — `snd.count` is the only source of truth, so a `stopAll()` (a match restart) or a
 * tab suspend can never leave doubled music behind.
 *
 * The stingers play through the same `music` bus and are never looped; the next scene change (or `stopAll`) ends them.
 * Music sits under the ability voices by gain staging alone: bed gain .8/.62 against combat gains near 1, and pausing
 * ducks the whole music bus (see `setDuck`) instead of pretending the world stopped.
 */

export type MusicScene = 'menu' | 'match' | 'victory' | 'defeat';

/** The looping bed per scene; stingers have none. */
const BED: Partial<Record<MusicScene, string>> = { menu: 'musicMenu', match: 'musicMatch' };
const STINGER: Partial<Record<MusicScene, string>> = { victory: 'musicVictory', defeat: 'musicDefeat' };

let scene: MusicScene | null = null;
let bed: { name: string; handle: LoopHandle } | null = null;

/** The scene the world is asking for right now (debug/tests). */
export function musicCurrent(): MusicScene | null { return scene; }

/** Requests a scene: a stingers plays once on entering victory/defeat; beds swap on the next `musicTick`. */
export function musicScene(next: MusicScene): void {
  if (next === scene) return;
  scene = next;
  const name = BED[next];
  if (bed && bed.name !== name) { bed.handle.stop(); bed = null; }
  const sting = STINGER[next];
  if (sting) snd.play('music', sting, { force: true }); // once per transition; `force` beats a lingering minGap only
}

/** Keeps the current bed sounding: starts it, restarts it after its own fade-out, never doubles it. */
export function musicTick(): void {
  const name = scene ? BED[scene] : undefined;
  if (!name) { if (bed) { bed.handle.stop(); bed = null; } return; }
  if (bed && bed.name === name && bed.handle.live) return; // already singing
  bed?.handle.stop();
  const handle = snd.startLoop('music', name, {});
  bed = handle ? { name, handle } : null;
}

/** Stops the bed and forgets the scene (tests, teardown). Stingers keep playing: they are one-shots. */
export function resetMusic(): void {
  bed?.handle.stop();
  bed = null;
  scene = null;
}
