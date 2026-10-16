import * as THREE from 'three';
import { SHARED } from './shared';

/**
 * The few materials all plants, rocks and props share. Vertex colors carry the look, so one material serves every species of a kind.
 * Wind is a vertex-shader displacement driven by the shared clock: it grows with height above the root, and each instance has its own
 * phase (taken from its world position), so a field sways in waves instead of in lockstep.
 */

const WIND_VERT = `
uniform float uTime, uSway;
uniform vec3 uWind;
vec3 windOffset(vec3 p, mat4 model) {
  #ifdef USE_INSTANCING
    vec3 root = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
  #else
    vec3 root = vec3(0.0);
  #endif
  vec3 wp = (model * vec4(root, 1.0)).xyz;
  float h = max(p.y, 0.0);
  float ph = uTime * 1.5 + wp.x * .37 + wp.z * .29;
  float gust = .5 + .5 * sin(uTime * .55 + wp.x * .05 + wp.z * .04);
  float sw = (sin(ph) * .6 + sin(ph * 2.3 + 1.7) * .4) * (.35 + gust) * uSway * h * h;
  return vec3(uWind.x * sw, 0.0, uWind.z * sw);
}`;

/** Trees, bushes: lit by their own (faceted) normals, swaying from the crown. */
function windPatch(sway: number) {
  return (s: any): void => {
    s.uniforms.uSway = { value: sway }; s.uniforms.uTime = SHARED.time; s.uniforms.uWind = SHARED.wind;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\n' + WIND_VERT)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += windOffset(position, modelMatrix);');
  };
}

/** Grass, ferns, flowers: thin double-sided cards, so they are lit as if they faced up (a back face would go dark), and sway from the root. */
function windUpPatch(sway: number) {
  return (s: any): void => {
    s.uniforms.uSway = { value: sway }; s.uniforms.uTime = SHARED.time; s.uniforms.uWind = SHARED.wind;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\n' + WIND_VERT)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += windOffset(position, modelMatrix);');
    s.fragmentShader = s.fragmentShader
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);');
  };
}

export interface PlantMaterials {
  /** Trees: standard lit, vertex colors, sway. */
  tree: THREE.MeshStandardMaterial;
  /** Bushes: the same with a stronger sway. */
  shrub: THREE.MeshStandardMaterial;
  /** Grass, ferns, flowers: double-sided, lit as if facing up. */
  leaf: THREE.MeshStandardMaterial;
  /** Rocks: standard lit, vertex colors, still. */
  stone: THREE.MeshStandardMaterial;
  /** Crystals and mushrooms: unlit, so they glow (the instance color tints them). */
  glow: THREE.MeshBasicMaterial;
  all: THREE.Material[];
}

export function plantMaterials(): PlantMaterials {
  const tree = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .9, metalness: 0 });
  tree.onBeforeCompile = windPatch(.0032);
  const shrub = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .92, metalness: 0 });
  shrub.onBeforeCompile = windPatch(.05);
  const leaf = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide });
  leaf.onBeforeCompile = windUpPatch(.2);
  const stone = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .96, metalness: 0 });
  const glow = new THREE.MeshBasicMaterial({ vertexColors: true });
  return { tree, shrub, leaf, stone, glow, all: [tree, shrub, leaf, stone, glow] };
}
