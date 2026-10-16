import * as THREE from 'three';
import { ATMO } from './palette';

/**
 * Uniforms shared by every environment material, so one assignment per frame animates all of them (wind, water, rune pulse) and
 * the fog color the terrain fades into always equals the scene fog. Objects are created once, never replaced.
 */
export const SHARED = {
  /** Seconds since the environment was built. */
  time: { value: 0 },
  /** Wind direction (x, z) times strength in .xz; .y unused. */
  wind: { value: new THREE.Vector3(.8, 0, .5) },
  /** The scene's fog color (see atmosphere.ts, which keeps it in sync with `scene.fog`). */
  haze: { value: new THREE.Color(ATMO.fog) },
  /** Strength of the rune glow on the ground (the quality governor and the menu stage may lower it). */
  rune: { value: .62 },
};
