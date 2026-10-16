import * as THREE from 'three';
import { COLS, atlasTexture } from './atlas';

/** Fields of one particle to emit. A single spec object is filled and re-used, so emitting never allocates. */
export interface PSpec {
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  life: number; s0: number; s1: number;
  r0: number; g0: number; b0: number; r1: number; g1: number; b1: number;
  /** Peak alpha. */ a: number;
  /** Fraction of the life spent fading in (0: starts at full alpha). */ fadeIn: number;
  /** Atlas cell (see SPR). */ tex: number;
  /** Gravity (units / s^2, positive pulls down) and exponential drag (1 / s). */ g: number; drag: number;
  rot: number; vrot: number;
}
export const newSpec = (): PSpec => ({
  x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, s0: 1, s1: 1, r0: 1, g0: 1, b0: 1, r1: 1, g1: 1, b1: 1,
  a: 1, fadeIn: 0, tex: 0, g: 0, drag: 0, rot: 0, vrot: 0,
});

// Slots inside one particle record of the simulation array.
const AGE = 0, LIFE = 1, VX = 2, VY = 3, VZ = 4, GR = 5, DRAG = 6, S0 = 7, S1 = 8, R0 = 9, G0 = 10, B0 = 11, R1 = 12, G1 = 13, B1 = 14,
  AL = 15, FADE = 16, ROT = 17, VROT = 18, TEX = 19, X = 20, Y = 21, Z = 22, STRIDE = 24;

export type Blend = 'add' | 'alpha';

const VERT = /* glsl */`
attribute vec4 aColor;
attribute vec3 aParam;
uniform float uScale;
uniform float uMax;
varying vec4 vColor;
varying float vTex;
varying float vRot;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(aParam.x * uScale / max(0.001, -mv.z), 0.0, uMax);
  vColor = aColor; vTex = aParam.y; vRot = aParam.z;
}`;
const FRAG = /* glsl */`
uniform sampler2D uMap;
uniform float uCols;
varying vec4 vColor;
varying float vTex;
varying float vRot;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float c = cos(vRot), s = sin(vRot);
  vec2 q = vec2(c * p.x + s * p.y, -s * p.x + c * p.y) + 0.5;
  if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) discard;
  float idx = floor(vTex + 0.5);
  vec2 cell = vec2(mod(idx, uCols), floor(idx / uCols));
  vec4 t = texture2D(uMap, (q + cell) / uCols);
  gl_FragColor = vec4(vColor.rgb * t.rgb, vColor.a * t.a);
}`;

const sm = (a: number, b: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * A pool of billboard point sprites drawn in ONE draw call. Particles live in flat typed arrays; dead ones are swap-removed, so the
 * live ones are always contiguous and the draw range is exactly `count`. Nothing is allocated after construction.
 * 'add' layers (sparks, fire, magic) blend additively; 'alpha' layers (smoke, dust) use normal alpha blending.
 */
export class ParticleLayer {
  readonly points: THREE.Points;
  readonly cap: number;
  count = 0;
  /** Counters for tests and the debug overlay. */
  emitted = 0; dropped = 0; peak = 0;
  private d: Float32Array;
  private geo = new THREE.BufferGeometry();
  private pos: Float32Array; private col: Float32Array; private par: Float32Array;
  private uScale = { value: 1000 };
  private uMax = { value: 128 };

  constructor(cap: number, readonly blend: Blend) {
    this.cap = cap;
    this.d = new Float32Array(cap * STRIDE);
    this.pos = new Float32Array(cap * 3); this.col = new Float32Array(cap * 4); this.par = new Float32Array(cap * 3);
    const dyn = (a: Float32Array, n: number) => new THREE.BufferAttribute(a, n).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', dyn(this.pos, 3));
    this.geo.setAttribute('aColor', dyn(this.col, 4));
    this.geo.setAttribute('aParam', dyn(this.par, 3));
    this.geo.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: atlasTexture() }, uCols: { value: COLS }, uScale: this.uScale, uMax: this.uMax },
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, fog: false,
      blending: blend === 'add' ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = blend === 'add' ? 9 : 8;
    this.points.visible = false;
  }

  /** Free slots left. */
  get free(): number { return this.cap - this.count; }

  /** Pixel size of one world unit at distance 1 for the current camera and viewport (point sizes are in world units). */
  setViewport(heightPx: number, fovRad: number): void { this.uScale.value = heightPx * .5 / Math.tan(fovRad * .5); }
  /** Largest point size (px) the GPU can draw; bigger sprites are clamped instead of being clipped by the driver. */
  setMaxPoint(px: number): void { this.uMax.value = Math.max(16, Math.min(512, px)); }

  emit(s: PSpec): boolean {
    if (this.count >= this.cap) { this.dropped++; return false; }
    const d = this.d, o = this.count++ * STRIDE;
    d[o + AGE] = 0; d[o + LIFE] = Math.max(.016, s.life);
    d[o + VX] = s.vx; d[o + VY] = s.vy; d[o + VZ] = s.vz; d[o + GR] = s.g; d[o + DRAG] = s.drag;
    d[o + S0] = s.s0; d[o + S1] = s.s1;
    d[o + R0] = s.r0; d[o + G0] = s.g0; d[o + B0] = s.b0; d[o + R1] = s.r1; d[o + G1] = s.g1; d[o + B1] = s.b1;
    d[o + AL] = s.a; d[o + FADE] = s.fadeIn; d[o + ROT] = s.rot; d[o + VROT] = s.vrot; d[o + TEX] = s.tex;
    d[o + X] = s.x; d[o + Y] = s.y; d[o + Z] = s.z;
    this.emitted++;
    if (this.count > this.peak) this.peak = this.count;
    return true;
  }

  update(dt: number): void {
    const d = this.d, add = this.blend === 'add';
    let n = this.count;
    if (dt > 0) {
      for (let i = 0; i < n;) {
        const o = i * STRIDE;
        const age = d[o + AGE] + dt, life = d[o + LIFE];
        if (age >= life) { // swap-remove: the last live particle takes this slot and is processed next
          n--;
          if (i < n) d.copyWithin(o, n * STRIDE, n * STRIDE + STRIDE);
          continue;
        }
        d[o + AGE] = age;
        const k = d[o + DRAG] > 0 ? Math.exp(-d[o + DRAG] * dt) : 1;
        d[o + VY] -= d[o + GR] * dt;
        d[o + VX] *= k; d[o + VY] *= k; d[o + VZ] *= k;
        d[o + X] += d[o + VX] * dt; d[o + Y] += d[o + VY] * dt; d[o + Z] += d[o + VZ] * dt;
        d[o + ROT] += d[o + VROT] * dt;
        i++;
      }
      this.count = n;
    }
    // Write the GPU arrays for every live particle (also when paused, so a re-created context keeps drawing).
    const pos = this.pos, col = this.col, par = this.par;
    for (let i = 0; i < n; i++) {
      const o = i * STRIDE, t = d[o + AGE] / d[o + LIFE], fi = d[o + FADE];
      const up = fi > 0 ? sm(0, fi, t) : 1, down = add ? 1 - t * t : 1 - t;
      pos[i * 3] = d[o + X]; pos[i * 3 + 1] = d[o + Y]; pos[i * 3 + 2] = d[o + Z];
      col[i * 4] = d[o + R0] + (d[o + R1] - d[o + R0]) * t;
      col[i * 4 + 1] = d[o + G0] + (d[o + G1] - d[o + G0]) * t;
      col[i * 4 + 2] = d[o + B0] + (d[o + B1] - d[o + B0]) * t;
      col[i * 4 + 3] = d[o + AL] * up * down;
      par[i * 3] = d[o + S0] + (d[o + S1] - d[o + S0]) * t; par[i * 3 + 1] = d[o + TEX]; par[i * 3 + 2] = d[o + ROT];
    }
    this.points.visible = n > 0;
    if (n > 0) {
      const g = this.geo.attributes;
      for (const [name, size] of [['position', 3], ['aColor', 4], ['aParam', 3]] as const) {
        const a = g[name] as THREE.BufferAttribute;
        a.updateRange.offset = 0; a.updateRange.count = n * size; a.needsUpdate = true;
      }
      this.geo.setDrawRange(0, n);
    }
  }

  clear(): void { this.count = 0; this.points.visible = false; this.geo.setDrawRange(0, 0); }

  /** Position of live particle `i` (tests). */
  at(i: number, out: THREE.Vector3): THREE.Vector3 { const o = i * STRIDE; return out.set(this.d[o + X], this.d[o + Y], this.d[o + Z]); }

  dispose(): void { this.geo.dispose(); (this.points.material as THREE.Material).dispose(); }
}
