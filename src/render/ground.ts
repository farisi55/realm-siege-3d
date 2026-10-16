import { K } from '../game/config';
import { terrainY } from './env/height';

/** Bridge decks across the river: centers in logic units, box size in world units (long side across the river, turned 45 degrees). */
export const BRIDGES: [number, number][] = [[400, 400], [1600, 1600], [2800, 2800]];
export const DECK = { y: .15, w: 17, h: .35, d: 6 };
const DECK_TOP = DECK.y + DECK.h / 2, HALF_L = DECK.w / K / 2, HALF_W = DECK.d / K / 2, SQ = Math.SQRT1_2;

/**
 * Height at which a character stands at logic position (x, y): the terrain, or the bridge deck when the position is on one.
 * Render-only: the simulation is flat and never reads the height (see env/height.ts for the terrain itself).
 * Characters used to sink up to a meter into the deck in the middle of the river.
 * The lift fades in over the last 10 logic units of the deck edge so units step onto it smoothly.
 */
export function groundY(x: number, y: number): number {
  const h = terrainY(x, y);
  if (h >= DECK_TOP) return h;
  for (const [bx, by] of BRIDGES) {
    const dx = x - bx, dy = y - by;
    if (Math.abs(dx) > 260 || Math.abs(dy) > 260) continue;
    const e = Math.min(HALF_L - Math.abs(dx - dy) * SQ, HALF_W - Math.abs(dx + dy) * SQ);
    if (e > 0) return h + (DECK_TOP - h) * Math.min(1, e / 10);
  }
  return h;
}
