import * as THREE from 'three';

/** Samples kept per weapon and the cap on pooled ribbons drawn at once. */
const MAX_SAMPLES = 20, SUB = 3, PAIRS = (MAX_SAMPLES - 1) * SUB + 1;

const VERT = /* glsl */`
attribute vec4 aCol;
attribute vec2 aUv;
varying vec4 vC;
varying vec2 vU;
void main() {
  vC = aCol; vU = aUv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const FRAG = /* glsl */`
varying vec4 vC;
varying vec2 vU;
void main() {
  float v = vU.y;                                        // 0 on the hilt side of the swept blade, 1 on the cutting edge
  float body = .16 + .84 * v * v;
  float edge = smoothstep(.78, 1., v);
  vec3 c = vC.rgb * body + vec3(1.) * edge * edge * .5 * vC.a;
  gl_FragColor = vec4(c, vC.a * (.3 + .7 * smoothstep(0., .25, v)));
}`;

let SHARED: { mat: THREE.ShaderMaterial; index: THREE.BufferAttribute } | null = null;
/** One material and one index buffer serve every ribbon: all per-trail data is in vertex attributes, so nothing is created per weapon. */
function shared() {
  if (SHARED) return SHARED;
  const idx = new Uint16Array((PAIRS - 1) * 6);
  for (let i = 0; i < PAIRS - 1; i++) idx.set([2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2], i * 6);
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
  });
  return SHARED = { mat, index: new THREE.BufferAttribute(idx, 1) };
}

/** One drawable ribbon. Slots are created on demand up to the pool's cap and then re-used by whichever weapon is swinging. */
export class RibbonSlot {
  readonly mesh: THREE.Mesh;
  readonly pos = new Float32Array(PAIRS * 2 * 3);
  readonly col = new Float32Array(PAIRS * 2 * 4);
  readonly uv = new Float32Array(PAIRS * 2 * 2);
  owner: WeaponTrail | null = null;
  private geo = new THREE.BufferGeometry();
  constructor() {
    const dyn = (a: Float32Array, n: number) => new THREE.BufferAttribute(a, n).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', dyn(this.pos, 3));
    this.geo.setAttribute('aCol', dyn(this.col, 4));
    this.geo.setAttribute('aUv', dyn(this.uv, 2));
    for (let i = 0; i < PAIRS; i++) { this.uv[i * 4 + 1] = 0; this.uv[i * 4 + 3] = 1; this.uv[i * 4] = this.uv[i * 4 + 2] = i / PAIRS; }
    this.geo.setIndex(shared().index);
    this.geo.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(this.geo, shared().mat);
    this.mesh.frustumCulled = false; this.mesh.visible = false; this.mesh.renderOrder = 6;
  }
  /** Tells the GPU copy how much of each array is in use this frame. */
  commit(pairs: number): void {
    const g = this.geo.attributes;
    for (const [name, size] of [['position', 3], ['aCol', 4], ['aUv', 2]] as const) {
      const a = g[name] as THREE.BufferAttribute;
      a.updateRange.offset = 0; a.updateRange.count = pairs * 2 * size; a.needsUpdate = true;
    }
    this.geo.setDrawRange(0, (pairs - 1) * 6);
    this.mesh.visible = true;
  }
  hide(): void { this.mesh.visible = false; this.geo.setDrawRange(0, 0); }
  dispose(): void { this.geo.dispose(); }
}

/** The ribbons that are being drawn right now. Add `group` to the scene once; a weapon only holds a slot while its ribbon is visible. */
export class TrailPool {
  readonly group = new THREE.Group();
  readonly slots: RibbonSlot[] = [];
  /** Counters for tests and the debug overlay. */
  denied = 0; peak = 0;
  constructor(readonly cap = 24) {}
  get active(): number { let n = 0; for (const s of this.slots) if (s.owner) n++; return n; }
  take(owner: WeaponTrail): RibbonSlot | null {
    let s = this.slots.find(x => !x.owner) || null;
    if (!s) {
      if (this.slots.length >= this.cap) { this.denied++; return null; }
      s = new RibbonSlot(); this.slots.push(s); this.group.add(s.mesh);
    }
    s.owner = owner;
    const n = this.active; if (n > this.peak) this.peak = n;
    return s;
  }
  give(s: RibbonSlot): void { s.owner = null; s.hide(); }
  clear(): void { for (const s of this.slots) if (s.owner) { s.owner.drop(); this.give(s); } }
  dispose(): void { for (const s of this.slots) s.dispose(); this.slots.length = 0; if (this.group.parent) this.group.parent.remove(this.group); }
}

/** The pool every weapon draws into unless it is given another one. The VFX facade adds its group to the scene. */
export const trailPool = new TrailPool();

const cr = (p0: number, p1: number, p2: number, p3: number, t: number): number =>
  .5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t);
const COLOR = new THREE.Color();
const B3 = [0, 0, 0], T3 = [0, 0, 0];

/**
 * Weapon trail: a fading ribbon swept by the blade (base and tip points), sampled every frame while the weapon is mid-swing. The
 * samples are smoothed with a Catmull-Rom spline so a fast arc is round, not faceted, the tail tapers to a point, and the cutting
 * edge is white-hot. The ribbon is in world space, so it stays where the blade was while the character turns. Samples live here
 * (a few floats); the GPU ribbon comes from a shared pool only while there is something to see.
 */
export class WeaponTrail {
  private pos = new Float32Array(MAX_SAMPLES * 6);
  private age = new Float32Array(MAX_SAMPLES);
  private n = 0;
  private slot: RibbonSlot | null = null;
  private r = 1; private g = 1; private b = 1;
  private max: number;

  /** `max` samples are kept (at most 20); a sample fades out over `life` seconds. */
  constructor(color: number, max = 18, private life = .28, private pool: TrailPool = trailPool) {
    this.max = Math.min(MAX_SAMPLES, Math.max(2, max));
    this.setColor(color);
  }

  setColor(c: number): void { COLOR.setHex(c); this.r = COLOR.r; this.g = COLOR.g; this.b = COLOR.b; }
  /** Number of live samples. */
  get length(): number { return this.n; }
  /** Is the ribbon being drawn? */
  get visible(): boolean { return !!this.slot && this.slot.mesh.visible; }

  /**
   * Ages the ribbon and, while `active`, adds a sample from the current blade base / tip (world space).
   * Call once per frame after the character's world matrices are up to date.
   */
  update(dt: number, active: boolean, base?: THREE.Vector3, tip?: THREE.Vector3): void {
    for (let i = 0; i < this.n; i++) this.age[i] += dt;
    while (this.n > 0 && this.age[this.n - 1] > this.life) this.n--;
    if (active && base && tip && dt > 0) {
      const keep = Math.min(this.n, this.max - 1);
      this.pos.copyWithin(6, 0, keep * 6);
      this.age.copyWithin(1, 0, keep);
      this.pos[0] = base.x; this.pos[1] = base.y; this.pos[2] = base.z;
      this.pos[3] = tip.x; this.pos[4] = tip.y; this.pos[5] = tip.z;
      this.age[0] = 0;
      this.n = keep + 1;
    }
    if (this.n < 2) { this.drop(); return; }
    if (!this.slot) { this.slot = this.pool.take(this); if (!this.slot) return; }
    this.build(this.slot);
  }

  /** Writes one pair of ribbon vertices (blade base `b`, tip `t`, sample age `age`) at pair index `v`. */
  private put(s: RibbonSlot, v: number, b: number[], t: number[], age: number): void {
    const f = Math.max(0, 1 - age / this.life), a = f * f, w = .28 + .72 * Math.pow(f, .7);
    const cx = (b[0] + t[0]) * .5, cy = (b[1] + t[1]) * .5, cz = (b[2] + t[2]) * .5, o = v * 6, c = v * 8, u = v * 4;
    s.pos[o] = cx + (b[0] - cx) * w; s.pos[o + 1] = cy + (b[1] - cy) * w; s.pos[o + 2] = cz + (b[2] - cz) * w;
    s.pos[o + 3] = cx + (t[0] - cx) * w; s.pos[o + 4] = cy + (t[1] - cy) * w; s.pos[o + 5] = cz + (t[2] - cz) * w;
    // brightened a little and pushed towards white while the ribbon is young
    const hot = f * f * .35, r = this.r + (1 - this.r) * hot, g = this.g + (1 - this.g) * hot, bl = this.b + (1 - this.b) * hot;
    for (let j = 0; j < 2; j++) { s.col[c + j * 4] = r * 1.15; s.col[c + j * 4 + 1] = g * 1.15; s.col[c + j * 4 + 2] = bl * 1.15; s.col[c + j * 4 + 3] = a; }
    s.uv[u] = s.uv[u + 2] = 1 - f; // u: 0 on the newest edge, 1 on the oldest
  }

  /** Writes the smoothed, tapered ribbon into the slot's arrays. */
  private build(s: RibbonSlot): void {
    const P = this.pos, A = this.age, n = this.n;
    let v = 0;
    for (let i = 0; i < n - 1; i++) {
      const i0 = Math.max(0, i - 1), i2 = i + 1, i3 = Math.min(n - 1, i + 2);
      for (let k = 0; k < SUB; k++) {
        const t = k / SUB;
        for (let c = 0; c < 3; c++) {
          B3[c] = cr(P[i0 * 6 + c], P[i * 6 + c], P[i2 * 6 + c], P[i3 * 6 + c], t);
          T3[c] = cr(P[i0 * 6 + 3 + c], P[i * 6 + 3 + c], P[i2 * 6 + 3 + c], P[i3 * 6 + 3 + c], t);
        }
        this.put(s, v++, B3, T3, A[i] + (A[i2] - A[i]) * t);
      }
    }
    const e = n - 1;
    for (let c = 0; c < 3; c++) { B3[c] = P[e * 6 + c]; T3[c] = P[e * 6 + 3 + c]; }
    this.put(s, v++, B3, T3, A[e]);
    s.commit(v);
  }

  /** Gives the ribbon back to the pool (the samples stay). */
  drop(): void {
    if (!this.slot) return;
    this.pool.give(this.slot); this.slot = null;
  }
  /** Forgets every sample and hides the ribbon at once. */
  clear(): void { this.n = 0; this.drop(); }
  dispose(): void { this.clear(); }
}
