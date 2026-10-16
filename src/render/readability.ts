import * as THREE from 'three';
import { glowTexture } from './env/textures';

/**
 * What keeps a character readable against a busy, colorful ground, seen from a MOBA camera:
 *
 *   rim light       a team-colored fresnel glow on the edges that face away from the camera: the silhouette of every unit is outlined
 *                   in its team's color (blue / red / violet) without a second draw of the mesh. Patched into the standard material, so
 *                   it costs a few shader instructions and no extra draw calls.
 *   contact shadow  a soft dark blob under the feet (heroes also get a faint team-colored pad), so a unit is always grounded
 *                   and always has a dark edge to read against, even where the sun shadow map is too coarse to show one.
 *
 * All the contact decals share one geometry and a few materials.
 */

const RIM_VERT_ENDPOINT = '#include <aomap_fragment>';
const RIM_FRAG = `
{
  float rimNdv = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
  float rim = pow(1.0 - rimNdv, 2.4);
  reflectedLight.indirectDiffuse += uRimColor * (rim * uRimK);
}`;

/** Adds a team-colored rim light to a standard material (call before its first use). `k`: strength, about .3 to .6. */
export function addRim(m: THREE.MeshStandardMaterial, color: number, k: number): void {
  const uniforms = { uRimColor: { value: new THREE.Color(color).lerp(new THREE.Color(1, 1, 1), .12) }, uRimK: { value: k } };
  m.onBeforeCompile = (s: any): void => {
    s.uniforms.uRimColor = uniforms.uRimColor; s.uniforms.uRimK = uniforms.uRimK;
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRimColor;\nuniform float uRimK;')
      .replace(RIM_VERT_ENDPOINT, RIM_VERT_ENDPOINT + RIM_FRAG);
  };
  m.needsUpdate = true;
}

let SHARED: { quad: THREE.BufferGeometry; tex: THREE.DataTexture; blob: THREE.MeshBasicMaterial; pads: Map<number, THREE.MeshBasicMaterial> } | null = null;
function shared(): NonNullable<typeof SHARED> {
  if (SHARED) return SHARED;
  const tex = glowTexture(64, 1);
  SHARED = {
    quad: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), tex, pads: new Map(),
    blob: new THREE.MeshBasicMaterial({ map: tex, color: 0x000000, transparent: true, opacity: .42, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
  };
  return SHARED;
}
function pad(color: number): THREE.MeshBasicMaterial {
  const s = shared();
  let m = s.pads.get(color);
  if (!m) s.pads.set(color, m = new THREE.MeshBasicMaterial({ map: s.tex, color, transparent: true, opacity: .2, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  return m;
}

export interface Contact { group: THREE.Group }

/** The decals under a character whose ground ring has radius `r` (world units). Heroes also get a team-colored pad. Local y is about the ground. */
export function contactShadow(r: number, teamColor: number, hero: boolean): Contact {
  const s = shared(), group = new THREE.Group();
  const blob = new THREE.Mesh(s.quad, s.blob);
  blob.scale.setScalar(r * 2.7); blob.position.y = .08; blob.renderOrder = 3;
  group.add(blob);
  if (hero) {
    const p = new THREE.Mesh(s.quad, pad(teamColor));
    p.scale.setScalar(r * 3.6); p.position.y = .09; p.renderOrder = 4;
    group.add(p);
  }
  return { group };
}

/** Frees the shared decal geometry, texture and materials (the tests). */
export function disposeReadability(): void {
  if (!SHARED) return;
  SHARED.quad.dispose(); SHARED.tex.dispose(); SHARED.blob.dispose(); SHARED.pads.forEach(m => m.dispose());
  SHARED = null;
}
