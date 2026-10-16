import * as THREE from 'three';
import { K } from '../../game/config';
import { groundY } from '../ground';
import { mat } from '../factory';
import { glowTexture } from './atlas';
import { DECAL_FRAG, DECAL_VERT, DOME_FRAG, DOME_VERT, PILLAR_FRAG, PILLAR_VERT, RING_FRAG, RING_VERT } from './shaders';

/** Decal styles: the numbers `uStyle` takes in DECAL_FRAG. */
export const DECAL = { aim: 0, rune: 1, fire: 2, poison: 3, lightning: 4, heal: 5, scorch: 6, shadow: 7, cracks: 8, wave: 9 } as const;

/** Anything that lives in a pool: `on` while playing, `age` / `life` in seconds, `obj` is hidden when it is free. */
export interface Slot { on: boolean; age: number; life: number; obj: THREE.Object3D; /** Changes every time the slot is handed out: a holder compares it to know the slot was recycled. */ id: number; }

/**
 * Fixed-capacity pool of effect objects. Slots are created on demand up to `cap`, never destroyed, and re-used: spawning an effect
 * costs a few uniform writes, never a new mesh, geometry or material. When it is full the spawn is refused (or, for important
 * effects, the oldest slot is taken over).
 */
export class Pool<T extends Slot> {
  readonly items: T[] = [];
  taken = 0; denied = 0; peak = 0;
  private seq = 0;
  constructor(readonly cap: number, private make: (i: number) => T) {}

  take(steal = false): T | null {
    let free: T | null = null, oldest: T | null = null;
    for (const s of this.items) {
      if (!s.on) { free = s; break; }
      if (!oldest || s.age / s.life > oldest.age / oldest.life) oldest = s;
    }
    if (!free && this.items.length < this.cap) { free = this.make(this.items.length); this.items.push(free); }
    if (!free && steal) free = oldest;
    if (!free) { this.denied++; return null; }
    this.taken++; free.on = true; free.age = 0; free.id = ++this.seq;
    const n = this.active; if (n > this.peak) this.peak = n;
    return free;
  }
  get active(): number { let n = 0; for (const s of this.items) if (s.on) n++; return n; }
  release(s: T): void { s.on = false; s.obj.visible = false; }
  clear(): void { for (const s of this.items) this.release(s); }
}

const fadeEnv = (age: number, life: number, fin: number, fout: number): number =>
  Math.min(fin > 0 ? Math.min(1, age / fin) : 1, fout > 0 ? Math.min(1, (life - age) / fout) : 1);
const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);
const easeOutBack = (t: number): number => { const k = t - 1; return 1 + k * k * (2.7 * k + 1.7); };
const rand = (): number => Math.random();
const C = new THREE.Color(), C2 = new THREE.Color();

const sm = (v: { value: THREE.Color }, hex: number) => v.value.setHex(hex);

// ---- shared geometry (one of each, for every slot of its kind) ----
let GEO: { quad: THREE.PlaneGeometry; pillar: THREE.CylinderGeometry; dome: THREE.SphereGeometry; spike: THREE.ConeGeometry; rock: THREE.BufferGeometry; index: THREE.BufferAttribute; uv: THREE.BufferAttribute; xz: Float32Array; nv: number; boltIndex: THREE.BufferAttribute; boltUv: THREE.BufferAttribute } | null = null;
const POLAR_RINGS = 8, POLAR_SEGS = 40, BOLT_SEG = 12;
function geos() {
  if (GEO) return GEO;
  // Polar disc used by the terrain-conforming decals: vertex 0 is the centre, then POLAR_RINGS rings of POLAR_SEGS vertices.
  const nv = 1 + POLAR_RINGS * POLAR_SEGS, xz = new Float32Array(nv * 2), idx: number[] = [];
  for (let r = 1; r <= POLAR_RINGS; r++) for (let s = 0; s < POLAR_SEGS; s++) {
    const a = s / POLAR_SEGS * Math.PI * 2, i = 1 + (r - 1) * POLAR_SEGS + s;
    xz[i * 2] = Math.cos(a) * r / POLAR_RINGS; xz[i * 2 + 1] = Math.sin(a) * r / POLAR_RINGS;
  }
  for (let s = 0; s < POLAR_SEGS; s++) idx.push(0, 1 + (s + 1) % POLAR_SEGS, 1 + s);
  for (let r = 1; r < POLAR_RINGS; r++) for (let s = 0; s < POLAR_SEGS; s++) {
    const a = 1 + (r - 1) * POLAR_SEGS + s, b = 1 + (r - 1) * POLAR_SEGS + (s + 1) % POLAR_SEGS, c = a + POLAR_SEGS, d = b + POLAR_SEGS;
    idx.push(a, b, c, b, d, c);
  }
  // Lightning ribbon: two strips (glow, core) of BOLT_SEG segments each, drawn with one index buffer shared by every bolt slot.
  const bi: number[] = [], bu: number[] = [];
  for (let st = 0; st < 2; st++) for (let i = 0; i <= BOLT_SEG; i++) {
    bu.push(0, 0, 1, 0);
    if (i < BOLT_SEG) { const o = st * (BOLT_SEG + 1) * 2 + i * 2; bi.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); }
  }
  const rock = new THREE.IcosahedronGeometry(1, 1), p = rock.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) { const k = .78 + .44 * Math.abs(Math.sin(p.getX(i) * 7.3 + p.getY(i) * 4.1 + p.getZ(i) * 9.7)); p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * .85, p.getZ(i) * k); }
  rock.computeVertexNormals();
  const quad = new THREE.PlaneGeometry(2, 2), pillar = new THREE.CylinderGeometry(1, 1, 1, 20, 1, true), spike = new THREE.ConeGeometry(1, 1, 6);
  quad.rotateX(-Math.PI / 2); pillar.translate(0, .5, 0); spike.translate(0, .5, 0); // pillar and spike stand on y = 0
  return GEO = {
    quad, pillar, dome: new THREE.SphereGeometry(1, 24, 16), spike,
    rock, index: new THREE.BufferAttribute(new Uint16Array(idx), 1), nv, xz,
    uv: new THREE.BufferAttribute(new Float32Array(nv * 2), 2), // unused by the decal shader; keeps the attribute set complete
    boltIndex: new THREE.BufferAttribute(new Uint16Array(bi), 1), boltUv: new THREE.BufferAttribute(new Float32Array(bu), 2),
  };
}

let STRIP: THREE.DataTexture | null = null;
/** Soft cross-section for the lightning ribbons (bright in the middle, gone at both edges). */
function stripTexture(): THREE.DataTexture {
  if (STRIP) return STRIP;
  const w = 32, d = new Uint8Array(w * 4 * 4);
  for (let y = 0; y < 4; y++) for (let x = 0; x < w; x++) { const u = (x + .5) / w * 2 - 1, o = (y * w + x) * 4; d[o] = d[o + 1] = d[o + 2] = 255; d[o + 3] = Math.round(Math.exp(-u * u * 3.4) * 255); }
  STRIP = new THREE.DataTexture(d, w, 4, THREE.RGBAFormat);
  STRIP.magFilter = STRIP.minFilter = THREE.LinearFilter; STRIP.generateMipmaps = false; STRIP.needsUpdate = true;
  return STRIP;
}

/**
 * Blend of a ground layer. `soft` layers add light with a "screen" blend (`src + dst * (1 - src)` once the shader has premultiplied its
 * colour, see `EMIT`): on dark ground it is the same as additive, on bright ground it adds less. The frame is 8 bit and bloom keys on
 * luminance, so plain additive stacking of a few big glowing layers over lit terrain used to clip to a white disc that bloom then
 * spread over the whole spell. Screen blending approaches white but cannot reach it. Alpha is left alone (`Zero`, `One`).
 * The other kind is plain alpha blending (scorch marks). It is a state of the material, not of its program: slots switch freely.
 */
function setBlend(m: THREE.ShaderMaterial, soft: boolean): void {
  m.uniforms.uSoft.value = soft ? 1 : 0;
  if (soft) {
    m.blending = THREE.CustomBlending; m.blendEquation = THREE.AddEquation;
    m.blendSrc = THREE.OneMinusDstColorFactor; m.blendDst = THREE.OneFactor;
    m.blendSrcAlpha = THREE.ZeroFactor; m.blendDstAlpha = THREE.OneFactor;
  } else m.blending = THREE.NormalBlending;
}

const shader = (vs: string, fs: string, uniforms: Record<string, THREE.IUniform>, soft = true): THREE.ShaderMaterial => {
  const m = new THREE.ShaderMaterial({ vertexShader: vs, fragmentShader: fs, uniforms: { ...uniforms, uSoft: { value: 1 } }, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide });
  setBlend(m, soft);
  return m;
};

// ---------------------------------------------------------------------------------------------------------------- decals
export interface DecalOpts {
  /** World position of the centre and radius (world units). */
  x: number; z: number; r: number;
  style: number; color: number; color2?: number;
  life: number; fadeIn?: number; fadeOut?: number; alpha?: number;
  /** Additive (default) or normal alpha blending (scorch marks). */
  add?: boolean;
  /** Fixed height instead of following the terrain (the hero-select pedestal). */
  flatY?: number;
  /** The caller drives `prog` itself (and calls `place`) instead of the life clock. */
  manual?: boolean;
  /** Draw order inside the effect layers (lower = under). */
  order?: number;
}
export class DecalSlot implements Slot {
  id = 0; on = false; age = 0; life = 1;
  readonly obj: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  private pos: THREE.BufferAttribute;
  fin = .1; fout = .3; alpha = 1; manual = false; prog = 0; t0 = 0; flatY: number | undefined;
  x = 0; z = 0; r = 1;
  constructor(readonly lift = .13) {
    const g = geos(), geo = new THREE.BufferGeometry(), p = new Float32Array(g.nv * 3);
    for (let i = 0; i < g.nv; i++) { p[i * 3] = g.xz[i * 2]; p[i * 3 + 2] = g.xz[i * 2 + 1]; }
    this.pos = new THREE.BufferAttribute(p, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.pos); geo.setIndex(g.index);
    this.material = shader(DECAL_VERT, DECAL_FRAG, {
      uColor: { value: new THREE.Color() }, uColor2: { value: new THREE.Color() }, uAlpha: { value: 0 }, uT: { value: 0 }, uProg: { value: 0 }, uStyle: { value: 0 },
    });
    this.material.polygonOffset = true; this.material.polygonOffsetFactor = -2; this.material.polygonOffsetUnits = -2;
    this.obj = new THREE.Mesh(geo, this.material);
    this.obj.frustumCulled = false; this.obj.visible = false;
  }
  /** Moves / resizes the decal and drapes it over the terrain (heights are sampled once here, not per frame). */
  place(x: number, z: number, r: number, flatY?: number): void {
    this.x = x; this.z = z; this.r = r; this.flatY = flatY;
    const g = geos(), p = this.pos.array as Float32Array;
    this.obj.position.set(x, 0, z); this.obj.scale.set(r, 1, r);
    for (let i = 0; i < g.nv; i++) {
      p[i * 3 + 1] = flatY !== undefined ? flatY : groundY((x + g.xz[i * 2] * r) / K, (z + g.xz[i * 2 + 1] * r) / K) + this.lift;
    }
    this.pos.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------------------------------------------- rings
export interface RingOpts {
  x: number; y: number; z: number; r0: number; r1: number; color: number; life: number;
  /** Half width as a fraction of the ring radius. */ width?: number;
  alpha?: number; trail?: number; dash?: number;
  /** Height gained over the life (a ring rising up a body / a pillar). */ rise?: number;
  fadeIn?: number; fadeOut?: number;
}
export class RingSlot implements Slot {
  id = 0; on = false; age = 0; life = 1;
  readonly obj: THREE.Mesh; readonly material: THREE.ShaderMaterial;
  r0 = 1; r1 = 1; w = .06; alpha = 1; y0 = 0; rise = 0; fin = .05; fout = .5;
  constructor() {
    this.material = shader(RING_VERT, RING_FRAG, {
      uColor: { value: new THREE.Color() }, uAlpha: { value: 0 }, uR: { value: .9 }, uW: { value: .06 }, uTrail: { value: 6 }, uDash: { value: 0 }, uT: { value: 0 },
    });
    this.obj = new THREE.Mesh(geos().quad, this.material);
    this.obj.frustumCulled = false; this.obj.visible = false; this.obj.renderOrder = 4;
  }
}

// ---------------------------------------------------------------------------------------------------------------- pillars
export interface PillarOpts {
  x: number; y: number; z: number; r: number; h: number; color: number; color2?: number; life: number;
  alpha?: number; fadeIn?: number; fadeOut?: number;
  /** Seconds the column takes to shoot up (0: full height at once). */ rise?: number;
}
export class PillarSlot implements Slot {
  id = 0; on = false; age = 0; life = 1;
  readonly obj: THREE.Mesh; readonly material: THREE.ShaderMaterial;
  r = 1; h = 1; alpha = 1; rise = 0; fin = .05; fout = .4;
  constructor() {
    this.material = shader(PILLAR_VERT, PILLAR_FRAG, { uColor: { value: new THREE.Color() }, uColor2: { value: new THREE.Color() }, uAlpha: { value: 0 }, uT: { value: 0 }, uCut: { value: 1 } });
    this.obj = new THREE.Mesh(geos().pillar, this.material);
    this.obj.frustumCulled = false; this.obj.visible = false; this.obj.renderOrder = 7;
  }
}

// ---------------------------------------------------------------------------------------------------------------- domes
export interface DomeOpts {
  x: number; y: number; z: number; r0: number; r1: number; color: number; color2?: number; life: number;
  /** 0: energy shield, 1: fireball. */ style?: number; alpha?: number; fadeIn?: number; fadeOut?: number;
}
export class DomeSlot implements Slot {
  id = 0; on = false; age = 0; life = 1;
  readonly obj: THREE.Mesh; readonly material: THREE.ShaderMaterial;
  r0 = 1; r1 = 1; alpha = 1; fin = .08; fout = .3;
  constructor() {
    this.material = shader(DOME_VERT, DOME_FRAG, { uColor: { value: new THREE.Color() }, uColor2: { value: new THREE.Color() }, uAlpha: { value: 0 }, uT: { value: 0 }, uProg: { value: 0 }, uStyle: { value: 0 } });
    this.material.side = THREE.FrontSide;
    this.obj = new THREE.Mesh(geos().dome, this.material);
    this.obj.frustumCulled = false; this.obj.visible = false; this.obj.renderOrder = 7;
  }
}

// ---------------------------------------------------------------------------------------------------------------- lightning
export interface BoltOpts {
  ax: number; ay: number; az: number; bx: number; by: number; bz: number;
  color: number; life: number; width?: number; jitter?: number;
  /** Re-rolls of the zig-zag per second. */ rate?: number; alpha?: number;
}
export class BoltSlot implements Slot {
  id = 0; on = false; age = 0; life = .2;
  readonly obj: THREE.Mesh; readonly pos: Float32Array; readonly col: Float32Array;
  readonly a = new THREE.Vector3(); readonly b = new THREE.Vector3();
  color = new THREE.Color(); width = .12; jitter = .6; rate = 30; alpha = 1; since = 0;
  constructor(material: THREE.Material) {
    const g = geos(), geo = new THREE.BufferGeometry(), n = (BOLT_SEG + 1) * 2 * 2;
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('uv', g.boltUv); geo.setIndex(g.boltIndex);
    this.obj = new THREE.Mesh(geo, material);
    this.obj.frustumCulled = false; this.obj.visible = false; this.obj.renderOrder = 9;
  }
}

// ---------------------------------------------------------------------------------------------------------------- flashes
export interface FlashOpts { x: number; y: number; z: number; s0: number; s1: number; color: number; life: number; alpha?: number; }
export class FlashSlot implements Slot {
  id = 0; on = false; age = 0; life = .2;
  readonly obj: THREE.Sprite; readonly material: THREE.SpriteMaterial;
  s0 = 1; s1 = 1; alpha = 1;
  constructor() {
    this.material = new THREE.SpriteMaterial({ map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.obj = new THREE.Sprite(this.material);
    this.obj.frustumCulled = false; this.obj.visible = false; this.obj.renderOrder = 10;
  }
}

// ---------------------------------------------------------------------------------------------------------------- spikes / rocks
export interface SpikeOpts {
  x: number; z: number; h: number; w: number; life: number;
  color: number; emissive?: number; emissiveI?: number;
  delay?: number; rise?: number; sink?: number;
  /** Lean away from vertical (radians) and yaw. */ tilt?: number; yaw?: number;
  /** Fixed ground height, else the terrain. */ y?: number;
}
export class SpikeSlot implements Slot {
  id = 0; on = false; age = 0; life = 1;
  readonly obj: THREE.Mesh;
  h = 1; w = 1; delay = 0; rise = .18; sink = .3; y = 0;
  constructor() {
    this.obj = new THREE.Mesh(geos().spike, mat(0x6a5a48));
    this.obj.castShadow = false; this.obj.frustumCulled = false; this.obj.visible = false;
  }
}
export interface RockOpts {
  fx: number; fy: number; fz: number; tx: number; ty: number; tz: number; size: number; life: number;
  color: number; emissive?: number; emissiveI?: number; spin?: number;
  /** Called every frame with the rock's world position (smoke / fire trail). */ trail?: (x: number, y: number, z: number, dt: number) => void;
}
export class RockSlot implements Slot {
  id = 0; on = false; age = 0; life = 1;
  readonly obj: THREE.Mesh;
  readonly from = new THREE.Vector3(); readonly to = new THREE.Vector3();
  size = 1; spin = 3; trail: RockOpts['trail'];
  constructor() {
    this.obj = new THREE.Mesh(geos().rock, mat(0x4a3a30));
    this.obj.frustumCulled = false; this.obj.visible = false;
  }
}

export interface FxCounts { rings: number; decals: number; pillars: number; domes: number; bolts: number; flashes: number; spikes: number; rocks: number; }

/**
 * Every pooled mesh effect of the VFX system: terrain-conforming decals (targeting circles, runes, pools, scorch marks, shock waves),
 * flat rings, light pillars, shield domes / fireballs, lightning ribbons, glow flashes, ground spikes and falling rocks.
 * Geometry is created once per kind and shared; each slot owns only a small material (same program) and, for decals, its height array.
 * `update` advances everything; nothing is allocated while playing.
 */
export class MeshFx {
  readonly group = new THREE.Group();
  readonly rings: Pool<RingSlot>; readonly decals: Pool<DecalSlot>; readonly pillars: Pool<PillarSlot>; readonly domes: Pool<DomeSlot>;
  readonly bolts: Pool<BoltSlot>; readonly flashes: Pool<FlashSlot>; readonly spikes: Pool<SpikeSlot>; readonly rocks: Pool<RockSlot>;
  private boltMat: THREE.MeshBasicMaterial;
  private cam = new THREE.Vector3(0, 30, 30);
  private v = { dir: new THREE.Vector3(), mid: new THREE.Vector3(), view: new THREE.Vector3(), side: new THREE.Vector3(), up: new THREE.Vector3(), p: new THREE.Vector3() };

  constructor(caps: Partial<Record<keyof FxCounts, number>> = {}) {
    this.boltMat = new THREE.MeshBasicMaterial({ map: stripTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
    const add = <T extends Slot>(p: Pool<T>): Pool<T> => p;
    const mk = <T extends Slot>(cap: number, make: (i: number) => T): Pool<T> => add(new Pool<T>(cap, i => { const s = make(i); this.group.add(s.obj); return s; }));
    this.rings = mk(caps.rings ?? 20, () => new RingSlot());
    this.decals = mk(caps.decals ?? 18, () => new DecalSlot());
    this.pillars = mk(caps.pillars ?? 10, () => new PillarSlot());
    this.domes = mk(caps.domes ?? 8, () => new DomeSlot());
    this.bolts = mk(caps.bolts ?? 22, () => new BoltSlot(this.boltMat));
    this.flashes = mk(caps.flashes ?? 18, () => new FlashSlot());
    this.spikes = mk(caps.spikes ?? 56, () => new SpikeSlot());
    this.rocks = mk(caps.rocks ?? 12, () => new RockSlot());
  }

  // ---- spawning ----

  decal(o: DecalOpts, steal = false): DecalSlot | null {
    const s = this.decals.take(steal); if (!s) return null;
    s.life = o.life; s.fin = o.fadeIn ?? .12; s.fout = o.fadeOut ?? .4; s.alpha = o.alpha ?? 1; s.manual = !!o.manual; s.prog = 0; s.t0 = rand() * 20;
    const u = s.material.uniforms;
    sm(u.uColor, o.color); sm(u.uColor2, o.color2 ?? o.color); u.uStyle.value = o.style; u.uAlpha.value = 0; u.uProg.value = 0;
    setBlend(s.material, o.add !== false);
    s.obj.renderOrder = o.order ?? (o.add === false ? 3 : 4);
    s.place(o.x, o.z, o.r, o.flatY);
    s.obj.visible = true;
    return s;
  }

  ring(o: RingOpts, steal = false): RingSlot | null {
    const s = this.rings.take(steal); if (!s) return null;
    s.life = o.life; s.r0 = o.r0; s.r1 = o.r1; s.w = o.width ?? .07; s.alpha = o.alpha ?? 1; s.y0 = o.y; s.rise = o.rise ?? 0; s.fin = o.fadeIn ?? .04; s.fout = o.fadeOut ?? o.life * .6;
    const u = s.material.uniforms; sm(u.uColor, o.color); u.uTrail.value = o.trail ?? 6; u.uDash.value = o.dash ?? 0; u.uAlpha.value = 0;
    s.obj.position.set(o.x, o.y, o.z); s.obj.scale.setScalar(Math.max(.01, o.r0)); s.obj.visible = true;
    return s;
  }

  pillar(o: PillarOpts, steal = false): PillarSlot | null {
    const s = this.pillars.take(steal); if (!s) return null;
    s.life = o.life; s.r = o.r; s.h = o.h; s.alpha = o.alpha ?? 1; s.rise = o.rise ?? 0; s.fin = o.fadeIn ?? .05; s.fout = o.fadeOut ?? o.life * .5;
    const u = s.material.uniforms; sm(u.uColor, o.color); sm(u.uColor2, o.color2 ?? o.color); u.uAlpha.value = 0; u.uCut.value = s.rise > 0 ? 0 : 1;
    s.obj.position.set(o.x, o.y, o.z); s.obj.scale.set(o.r, o.h, o.r); s.obj.visible = true;
    return s;
  }

  dome(o: DomeOpts, steal = false): DomeSlot | null {
    const s = this.domes.take(steal); if (!s) return null;
    s.life = o.life; s.r0 = o.r0; s.r1 = o.r1; s.alpha = o.alpha ?? 1; s.fin = o.fadeIn ?? .08; s.fout = o.fadeOut ?? o.life * .5;
    const u = s.material.uniforms; sm(u.uColor, o.color); sm(u.uColor2, o.color2 ?? o.color); u.uStyle.value = o.style ?? 0; u.uAlpha.value = 0; u.uProg.value = 0;
    s.obj.position.set(o.x, o.y, o.z); s.obj.scale.setScalar(Math.max(.01, o.r0)); s.obj.visible = true;
    return s;
  }

  bolt(o: BoltOpts, steal = false): BoltSlot | null {
    const s = this.bolts.take(steal); if (!s) return null;
    s.life = o.life; s.width = o.width ?? .12; s.jitter = o.jitter ?? .6; s.rate = o.rate ?? 30; s.alpha = o.alpha ?? 1; s.since = 1e9;
    s.a.set(o.ax, o.ay, o.az); s.b.set(o.bx, o.by, o.bz); s.color.setHex(o.color);
    this.shapeBolt(s, 1); s.obj.visible = true;
    return s;
  }

  flash(o: FlashOpts, steal = false): FlashSlot | null {
    const s = this.flashes.take(steal); if (!s) return null;
    s.life = o.life; s.s0 = o.s0; s.s1 = o.s1; s.alpha = o.alpha ?? 1;
    s.material.color.setHex(o.color); s.material.opacity = 0;
    s.obj.position.set(o.x, o.y, o.z); s.obj.scale.setScalar(o.s0); s.obj.visible = true;
    return s;
  }

  spike(o: SpikeOpts, steal = false): SpikeSlot | null {
    const s = this.spikes.take(steal); if (!s) return null;
    s.life = o.life; s.h = o.h; s.w = o.w; s.delay = o.delay ?? 0; s.rise = o.rise ?? .18; s.sink = o.sink ?? .3;
    s.y = o.y ?? groundY(o.x / K, o.z / K);
    s.obj.material = mat(o.color, o.emissive ?? 0, o.emissiveI ?? 0);
    s.obj.position.set(o.x, s.y, o.z); s.obj.rotation.set((rand() - .5) * (o.tilt ?? .25), o.yaw ?? rand() * 6.28, (rand() - .5) * (o.tilt ?? .25));
    s.obj.scale.set(.001, .001, .001); s.obj.visible = false;
    return s;
  }

  rock(o: RockOpts, steal = false): RockSlot | null {
    const s = this.rocks.take(steal); if (!s) return null;
    s.life = o.life; s.size = o.size; s.spin = o.spin ?? 3; s.trail = o.trail;
    s.from.set(o.fx, o.fy, o.fz); s.to.set(o.tx, o.ty, o.tz);
    s.obj.material = mat(o.color, o.emissive ?? 0, o.emissiveI ?? 0);
    s.obj.position.copy(s.from); s.obj.scale.setScalar(o.size); s.obj.visible = true;
    return s;
  }

  // ---- per frame ----

  /** Builds the zig-zag ribbon of a bolt: a wide soft glow strip and a thin hot core strip, both facing the camera. */
  private shapeBolt(s: BoltSlot, fade: number): void {
    const { dir, mid, view, side, up, p } = this.v, n = BOLT_SEG;
    dir.subVectors(s.b, s.a); const len = dir.length() || 1e-3; dir.multiplyScalar(1 / len);
    mid.addVectors(s.a, s.b).multiplyScalar(.5); view.subVectors(this.cam, mid).normalize();
    side.crossVectors(dir, view); if (side.lengthSq() < 1e-6) side.set(1, 0, 0); side.normalize();
    up.crossVectors(dir, side);
    const k = s.alpha * fade;
    for (let i = 0; i <= n; i++) {
      const t = i / n, env = Math.sin(Math.PI * t) * s.jitter, ox = (rand() - .5) * 2 * env, oy = (rand() - .5) * 1.2 * env;
      p.set(s.a.x + dir.x * len * t + side.x * ox + up.x * oy, s.a.y + dir.y * len * t + side.y * ox + up.y * oy, s.a.z + dir.z * len * t + side.z * ox + up.z * oy);
      const taper = .55 + .45 * Math.sin(Math.PI * t);
      for (let st = 0; st < 2; st++) {
        const w = s.width * (st ? .32 : 1.35) * taper, o = (st * (n + 1) + i) * 6;
        s.pos[o] = p.x - side.x * w; s.pos[o + 1] = p.y - side.y * w; s.pos[o + 2] = p.z - side.z * w;
        s.pos[o + 3] = p.x + side.x * w; s.pos[o + 4] = p.y + side.y * w; s.pos[o + 5] = p.z + side.z * w;
        const r = st ? .55 + s.color.r * .45 : s.color.r, g = st ? .55 + s.color.g * .45 : s.color.g, b = st ? .55 + s.color.b * .45 : s.color.b, c = k * (st ? 1.1 : .75);
        for (let j = 0; j < 2; j++) { s.col[o + j * 3] = r * c; s.col[o + j * 3 + 1] = g * c; s.col[o + j * 3 + 2] = b * c; }
      }
    }
    const geo = (s.obj as THREE.Mesh).geometry as THREE.BufferGeometry;
    (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }

  update(dt: number, camPos?: THREE.Vector3): void {
    if (camPos) this.cam.copy(camPos);
    if (dt <= 0) return;
    for (const s of this.decals.items) {
      if (!s.on) continue;
      if ((s.age += dt) >= s.life) { this.decals.release(s); continue; }
      const u = s.material.uniforms;
      u.uT.value = s.t0 + s.age; u.uProg.value = s.manual ? s.prog : s.age / s.life; u.uAlpha.value = s.alpha * fadeEnv(s.age, s.life, s.fin, s.fout);
    }
    for (const s of this.rings.items) {
      if (!s.on) continue;
      if ((s.age += dt) >= s.life) { this.rings.release(s); continue; }
      const t = s.age / s.life, e = easeOut(t), r = s.r0 + (s.r1 - s.r0) * e, sc = Math.max(.01, r * 1.12), u = s.material.uniforms;
      s.obj.scale.setScalar(sc); s.obj.position.y = s.y0 + s.rise * t;
      u.uR.value = r / sc; u.uW.value = Math.max(.012, s.w * (1 - t * .6) * r / sc); u.uT.value = s.age; u.uAlpha.value = s.alpha * fadeEnv(s.age, s.life, s.fin, s.fout);
    }
    for (const s of this.pillars.items) {
      if (!s.on) continue;
      if ((s.age += dt) >= s.life) { this.pillars.release(s); continue; }
      const u = s.material.uniforms;
      u.uT.value = s.age; u.uCut.value = s.rise > 0 ? Math.min(1.25, s.age / s.rise * 1.25) : 1; u.uAlpha.value = s.alpha * fadeEnv(s.age, s.life, s.fin, s.fout);
      const k = 1 + Math.sin(s.age * 9) * .03; s.obj.scale.set(s.r * k, s.h, s.r * k);
    }
    for (const s of this.domes.items) {
      if (!s.on) continue;
      if ((s.age += dt) >= s.life) { this.domes.release(s); continue; }
      const t = s.age / s.life, u = s.material.uniforms;
      s.obj.scale.setScalar(Math.max(.01, s.r0 + (s.r1 - s.r0) * easeOut(t)));
      u.uT.value = s.age; u.uProg.value = t; u.uAlpha.value = s.alpha * fadeEnv(s.age, s.life, s.fin, s.fout);
    }
    for (const s of this.bolts.items) {
      if (!s.on) continue;
      if ((s.age += dt) >= s.life) { this.bolts.release(s); continue; }
      s.since += dt;
      const f = 1 - s.age / s.life;
      if (s.since >= 1 / s.rate) { s.since = 0; this.shapeBolt(s, f * f * .5 + .5 * f); }
    }
    for (const s of this.flashes.items) {
      if (!s.on) continue;
      if ((s.age += dt) >= s.life) { this.flashes.release(s); continue; }
      const t = s.age / s.life, f = 1 - t;
      s.obj.scale.setScalar(s.s0 + (s.s1 - s.s0) * easeOut(t)); s.material.opacity = s.alpha * f * f;
    }
    for (const s of this.spikes.items) {
      if (!s.on) continue;
      if ((s.age += dt) >= s.life) { this.spikes.release(s); continue; }
      const t = s.age - s.delay;
      if (t < 0) { s.obj.visible = false; continue; }
      s.obj.visible = true;
      const up = Math.min(1, t / s.rise), down = Math.min(1, (s.life - s.age) / s.sink), h = s.h * Math.max(.001, easeOutBack(up) * easeOut(down)), w = s.w * (.55 + .45 * Math.min(1, up));
      s.obj.scale.set(w, h, w);
    }
    for (const s of this.rocks.items) {
      if (!s.on) continue;
      if ((s.age += dt) >= s.life) { this.rocks.release(s); continue; }
      const t = s.age / s.life, e = t * t;
      s.obj.position.lerpVectors(s.from, s.to, e);
      s.obj.rotation.x += dt * s.spin; s.obj.rotation.z += dt * s.spin * .7;
      s.trail?.(s.obj.position.x, s.obj.position.y, s.obj.position.z, dt);
    }
  }

  counts(): FxCounts {
    return { rings: this.rings.active, decals: this.decals.active, pillars: this.pillars.active, domes: this.domes.active, bolts: this.bolts.active, flashes: this.flashes.active, spikes: this.spikes.active, rocks: this.rocks.active };
  }
  /** Total slots ever created (bounded by the caps: the pools never grow past them). */
  created(): number { return [this.rings, this.decals, this.pillars, this.domes, this.bolts, this.flashes, this.spikes, this.rocks].reduce((n, p) => n + p.items.length, 0); }
  denied(): number { return [this.rings, this.decals, this.pillars, this.domes, this.bolts, this.flashes, this.spikes, this.rocks].reduce((n, p) => n + p.denied, 0); }
  /** Refused spawns per pool (a full pool drops the effect instead of growing). */
  deniedBy(): FxCounts {
    return { rings: this.rings.denied, decals: this.decals.denied, pillars: this.pillars.denied, domes: this.domes.denied, bolts: this.bolts.denied, flashes: this.flashes.denied, spikes: this.spikes.denied, rocks: this.rocks.denied };
  }
  /** Most slots alive at once per pool. */
  peaks(): FxCounts {
    return { rings: this.rings.peak, decals: this.decals.peak, pillars: this.pillars.peak, domes: this.domes.peak, bolts: this.bolts.peak, flashes: this.flashes.peak, spikes: this.spikes.peak, rocks: this.rocks.peak };
  }

  clear(): void { for (const p of [this.rings, this.decals, this.pillars, this.domes, this.bolts, this.flashes, this.spikes, this.rocks] as Pool<Slot>[]) p.clear(); }

  dispose(): void {
    for (const p of [this.rings, this.decals, this.pillars, this.domes, this.bolts, this.flashes, this.spikes, this.rocks] as Pool<Slot>[]) {
      for (const s of p.items) {
        const m = s.obj as THREE.Mesh;
        if (s instanceof DecalSlot) { m.geometry.dispose(); s.material.dispose(); }
        else if (s instanceof RingSlot || s instanceof PillarSlot || s instanceof DomeSlot) s.material.dispose();
        else if (s instanceof BoltSlot) m.geometry.dispose();
        else if (s instanceof FlashSlot) s.material.dispose();
      }
      p.clear();
    }
    this.boltMat.dispose();
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}
