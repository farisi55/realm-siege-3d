import { rd, rsz } from './scene';
import { setShadowSize } from './lighting';
import { allowBloom, resizePost } from './post';
import { environment } from './environment';
import { Governor, LEVELS } from './governor';

/**
 * Keeps the frame rate at the target by trading the things the eye misses last: render resolution, shadow resolution, how far the
 * grass reaches, fireflies, the strength of the runes and the bloom. The geometry, the lighting and the colors never change, so the
 * picture looks like itself on every level, only a little softer on the lower ones.
 *
 * `Governor` is pure (frame times in, level out), so the tests can drive it without a GPU. It reacts quickly to a slow patch, climbs back
 * slowly, and doubles its patience whenever a climb was followed by a fall (so it does not oscillate between two levels).
 */

export { GOVERNOR, Governor, LEVELS, MAX_LEVEL } from './governor';
export type { GovernorConfig, Level } from './governor';

// ---------------------------------------------------------------------------------------------------------------- the running game
export type QualitySetting = 'auto' | 0 | 1 | 2 | 3;
export const governor = new Governor();
let applied = -1;
let envApplied = false;

/** Applies a level to the renderer, the shadow map, the post-processing and the environment. */
export function applyLevel(l: number): void {
  const L = LEVELS[l];
  const dpr = Math.min(window.devicePixelRatio || 1, L.dpr);
  if (rd.getPixelRatio?.() !== dpr) { rd.setPixelRatio?.(dpr); rsz(); resizePost(); }
  setShadowSize(L.shadow);
  allowBloom(L.bloom);
  const e = environment();
  if (e) { e.setQuality(L); envApplied = true; }
  applied = l;
}

/** Called once per frame with the frame time in seconds. */
export function tickQuality(dt: number): void {
  const l = governor.sample(dt * 1000);
  if (l !== applied) applyLevel(l);
  else if (!envApplied && environment()) applyLevel(l);
}

/** The player's choice: 'auto' lets the governor decide, a level fixes it. */
export function setQuality(mode: QualitySetting): void {
  governor.lock(mode === 'auto' ? null : mode);
  applyLevel(governor.level);
}

export const qualityLevel = (): number => governor.level;
