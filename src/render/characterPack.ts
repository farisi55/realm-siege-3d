import { assets } from '../assets/AssetManager';
import { app } from '../game/state';
import type { GlbSource } from './character';

/**
 * The opt-in v3 source for one hero, or undefined to keep the existing default/fallback path.
 * Missing v3 files resolve to undefined, so a partially installed pack degrades per hero instead of breaking.
 */
export function heroModelSource(heroKey: string, height: number): GlbSource | undefined {
  if (app.pack !== 'v3') return undefined;
  return assets.instantiateV3(heroKey, height) ?? undefined;
}
