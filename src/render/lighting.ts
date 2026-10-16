import * as THREE from 'three';
import { sun } from './scene';
import { ATMO } from './env/palette';

/**
 * The sun and its shadow box. The box follows the point the camera looks at and is sized from the zoom, so the shadow map's texels
 * go where the picture needs them (a close zoom gets crisper shadows, a wide one reaches farther). Its centre is snapped to whole
 * texels in light space, so shadows do not shimmer as the camera glides.
 */

const OFF = new THREE.Vector3(...ATMO.sunOffset), DIR = OFF.clone().normalize(), DIST = OFF.length();
/** Light space axes (fixed: the sun never turns, it only follows). */
const RIGHT = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), DIR).normalize();
const UP = new THREE.Vector3().crossVectors(DIR, RIGHT).normalize();
const P = new THREE.Vector3();

export const shadowState = { extent: 44, size: 2048 };

/** Half-size of the shadow box for the zoom: about three quarters of the ground that is on screen, kept between a sharp minimum and a cap. */
export const shadowExtent = (visible: number): number => Math.round(Math.min(78, Math.max(36, visible * .72)) / 2) * 2;

/** Points the sun at (x, y, z) with a box for `visible` (the radius of the ground on screen, world units). */
export function followSun(x: number, y: number, z: number, visible: number): void {
  const e = shadowExtent(visible), cam = sun.shadow.camera as THREE.OrthographicCamera;
  if (e !== shadowState.extent) {
    shadowState.extent = e;
    cam.left = -e; cam.right = e; cam.top = e; cam.bottom = -e; cam.updateProjectionMatrix();
  }
  const texel = e * 2 / shadowState.size;
  P.set(x, y, z);
  const a = Math.round(P.dot(RIGHT) / texel) * texel, b = Math.round(P.dot(UP) / texel) * texel, c = P.dot(DIR);
  sun.target.position.copy(RIGHT).multiplyScalar(a).addScaledVector(UP, b).addScaledVector(DIR, c);
  sun.position.copy(sun.target.position).addScaledVector(DIR, DIST);
}

/** Changes the shadow map resolution (the quality governor). The old map is released; three makes the new one on the next frame. */
export function setShadowSize(px: number): void {
  if (px === shadowState.size) return;
  shadowState.size = px;
  sun.shadow.mapSize.set(px, px);
  const s = sun.shadow as unknown as { map: THREE.WebGLRenderTarget | null };
  if (s.map) { s.map.dispose(); s.map = null; }
}
