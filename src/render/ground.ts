import { K, LN } from '../game/config';
import { terrainY } from './env/height';

/** Bridge deck box in world units. The mesh's long axis is local +X, the walkway width is local Z. */
export const DECK = { y: .15, w: 17, h: .35, d: 6 };

/** A bridge deck in logic units. `rot` turns the mesh about Y, so local +X points along (cos rot, -sin rot) in logic x/y. */
export interface BridgeSpan {
  /** Centre of the deck. */
  x: number;
  y: number;
  /** Rotation about Y (radians): local +X is the deck length axis. */
  rot: number;
  /** True when the lane turns at the crossing, so the deck sits inside the elbow. */
  elbow: boolean;
}

/** Half the deck length and width in logic units, and the smoothing distance at the deck edge. */
const HALF_L = DECK.w / K / 2, HALF_W = DECK.d / K / 2, EDGE = 10;

const unit = (x: number, y: number): [number, number] => {
  const l = Math.hypot(x, y);
  return l < 1e-9 ? [0, 0] : [x / l, y / l];
};

/**
 * Bridges from the lane geometry: every lane meets the river at its middle waypoint (all three are on x = y).
 * The middle lane runs straight across, so its deck is centred on that waypoint. The left and right roads turn
 * 90° exactly at the river; no deck centred on the corner can meet both arms, so those decks lie on the chord
 * between the two arms, half a deck length into the elbow along the river. The deck length then ends exactly on
 * each road centre line, and its long axis bisects the turn.
 */
function bridgeSpan(lane: [number, number][]): BridgeSpan {
  const [ax, ay] = lane[0], [cx, cy] = lane[1], [bx, by] = lane[2];
  const [ux, uy] = unit(cx - ax, cy - ay); // direction of travel into the crossing
  const [vx, vy] = unit(bx - cx, by - cy); // direction of travel out of it
  const elbow = Math.abs(ux * vy - uy * vx) > 1e-9;
  const [ix, iy] = unit(vx - ux, vy - uy); // into the turn, used to move the deck off the corner
  const [dx, dy] = unit(vx + ux, vy + uy); // deck axis through both road arms
  return {
    x: cx + (elbow ? ix * HALF_L : 0),
    y: cy + (elbow ? iy * HALF_L : 0),
    rot: Math.atan2(-dy, dx),
    elbow,
  };
}

/** The three decks, in lane order: left, middle, right. Derived from the same waypoints the simulation and painter use. */
export const BRIDGES: BridgeSpan[] = LN.map(l => bridgeSpan(l as [number, number][]));

const DECK_TOP = DECK.y + DECK.h / 2;

/**
 * Height at which a character stands at logic position (x, y): the terrain, or the bridge deck when the position is on one.
 * Render-only: the simulation is flat and never reads the height (see env/height.ts for the terrain itself).
 * Characters used to sink up to a meter into the deck in the middle of the river.
 * The lift fades in over the last 10 logic units of the deck edge so units step onto it smoothly.
 */
export function groundY(x: number, y: number): number {
  const h = terrainY(x, y);
  if (h >= DECK_TOP) return h;
  for (const b of BRIDGES) {
    const dx = x - b.x, dy = y - b.y;
    // Broad phase: the rotated deck reaches at most (HALF_L + HALF_W) / sqrt(2) along either logic axis.
    if (Math.abs(dx) > 260 || Math.abs(dy) > 260) continue;
    // World-to-local: rotate the logic offset by -rot (the deck's local +X is the length axis).
    const c = Math.cos(b.rot), s = Math.sin(b.rot);
    const lx = c * dx - s * dy, lz = s * dx + c * dy;
    const e = Math.min(HALF_L - Math.abs(lx), HALF_W - Math.abs(lz));
    if (e > 0) return h + (DECK_TOP - h) * Math.min(1, e / EDGE);
  }
  return h;
}
