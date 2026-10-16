import * as THREE from 'three';
import { WATER_Y, WORLD, terrainAt } from './height';
import { ATMO } from './palette';
import { SHARED } from './shared';

/**
 * The river: a ribbon laid along the diagonal of the map that follows the river bed, so it is exactly as wide as the channel.
 * Vertices carry the water depth (surface minus ground), which drives everything in the shader: transparent shallows that show the
 * bed, deeper color, foam at the banks. Triangles over dry ground are not built, so the ribbon costs pixels only where there is water.
 */

const SQ = Math.SQRT1_2;
export const WATER = { half: 270, cross: 12, stepAlong: 1.5, stepAcross: .4 };

export interface WaterData { pos: Float32Array; depth: Float32Array; flow: Float32Array; idx: Uint16Array | Uint32Array }

/** Pure: the ribbon's vertices and the triangles that touch water. `along`, `across`: spacing in world units (larger values for tests). */
export function waterData(along = WATER.stepAlong, across = WATER.stepAcross): WaterData {
  const rows = Math.round(WATER.half * 2 / along) + 1, cols = Math.round(WATER.cross * 2 / across) + 1, V = rows * cols, c0 = WORLD / 2;
  const pos = new Float32Array(V * 3), depth = new Float32Array(V), flow = new Float32Array(V * 2), idx: number[] = [];
  for (let j = 0; j < rows; j++) {
    const s = -WATER.half + j * along;
    for (let i = 0; i < cols; i++) {
      const t = -WATER.cross + i * across, x = c0 + (s - t) * SQ, z = c0 + (s + t) * SQ, k = j * cols + i;
      pos[k * 3] = x; pos[k * 3 + 1] = WATER_Y; pos[k * 3 + 2] = z;
      depth[k] = WATER_Y - terrainAt(x, z);
      flow[k * 2] = t; flow[k * 2 + 1] = s;
    }
  }
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
      if (depth[a] < -.08 && depth[b] < -.08 && depth[c] < -.08 && depth[d] < -.08) continue; // dry
      idx.push(a, b, c, b, d, c);
    }
  }
  return { pos, depth, flow, idx: V < 65536 ? new Uint16Array(idx) : new Uint32Array(idx) };
}

const VERT = `
attribute float depth;
attribute vec2 flow;
varying float vDepth;
varying vec3 vW;
varying vec2 vFlow;
#include <fog_pars_vertex>
void main() {
  vDepth = depth; vFlow = flow;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = `
uniform float uTime;
uniform vec3 uSun, uDeep, uShallow, uSky;
varying float vDepth;
varying vec3 vW;
varying vec2 vFlow;
#include <fog_pars_fragment>
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  float d = vDepth;
  vec2 p = vW.xz;
  vec2 fl = vec2(vFlow.x, vFlow.y - uTime * .6);
  float n1 = vn(fl * vec2(1.7, .8)), n2 = vn(p * 2.3 + vec2(uTime * .4, -uTime * .3)), n3 = vn(p * 5.1 - vec2(uTime * .5, uTime * .2));
  vec3 N = normalize(vec3((n1 + n3 - 1.0) * .32, 1.0, (n2 + n3 - 1.0) * .32));
  vec3 V = normalize(cameraPosition - vW);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  vec3 col = mix(uShallow, uDeep, smoothstep(0.0, 1.0, d));
  col = mix(col, uSky, fres * .5);
  vec3 Hh = normalize(uSun + V);
  col += vec3(1.0, .92, .76) * pow(max(dot(N, Hh), 0.0), 90.0) * .55;
  float shore = d + (vn(p * 3.0 + uTime * .15) - .5) * .12;
  float foam = (1.0 - smoothstep(.0, .16, shore)) * smoothstep(-.05, .03, shore);
  float streak = smoothstep(.62, .9, vn(fl * vec2(2.4, .9) + n1)) * (1.0 - smoothstep(.2, .6, d)) * .35;
  col = mix(col, vec3(.93, .97, 1.0), clamp(foam * .85 + streak, 0.0, 1.0));
  float alpha = mix(.0, .84, smoothstep(.0, .5, d));
  alpha = max(alpha, foam * .9) * smoothstep(-.06, .0, d + .02);
  gl_FragColor = vec4(col, alpha);
  #include <fog_fragment>
}`;

export interface Water { mesh: THREE.Mesh; dispose(): void }

export function buildWater(test = false): Water {
  const w = waterData(test ? 6 : WATER.stepAlong, test ? 2 : WATER.stepAcross);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(w.pos, 3));
  g.setAttribute('depth', new THREE.BufferAttribute(w.depth, 1));
  g.setAttribute('flow', new THREE.BufferAttribute(w.flow, 2));
  g.setIndex(new THREE.BufferAttribute(w.idx, 1));
  const sun = new THREE.Vector3(...ATMO.sunOffset).normalize();
  const m = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: SHARED.time, uSun: { value: sun },
      uDeep: { value: new THREE.Color(0x1b5a82) }, uShallow: { value: new THREE.Color(0x4fb0b8) }, uSky: { value: new THREE.Color(ATMO.horizon) },
    }]),
  });
  // the shared uniform objects must stay the same objects (merge clones them)
  m.uniforms.uTime = SHARED.time;
  const mesh = new THREE.Mesh(g, m);
  mesh.name = 'water'; mesh.renderOrder = 1; mesh.frustumCulled = true;
  return { mesh, dispose() { g.dispose(); m.dispose(); mesh.parent?.remove(mesh); } };
}
