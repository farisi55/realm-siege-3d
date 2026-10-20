import * as THREE from 'three';
import { K } from '../../game/config';
import { BRIDGES, DECK } from '../ground';
import { GeoBuilder, box, c3, cone, cyl, ico, lerp3, place, placeAxis } from './geometry';
import type { ColorFn, Rgb } from './geometry';
import { terrainAt, WATER_Y, WORLD } from './height';
import { BASES, PLAZA_R, SHRINES, SPRING, TEAM_COLOR, TORCHES } from './layout';
import { MAGIC } from './palette';
import { SHARED } from './shared';
import { laneDist } from './splat';
import { glowTexture } from './textures';

/**
 * The things people build in this world: towers, cores, the three bridges, the pylons and banners round each base, the braziers, the
 * shrines and the spring. All of it is made of a few merged, vertex-colored geometries and a handful of shared materials:
 *
 *   stone (lit, vertex colors)    towers, core, bridges, pylons, braziers, shrine and spring bases
 *   trim (unlit, one per team)    the colored bands, banners and gems that make the team readable from the camera's height
 *   crystal / halo / pool         the glowing parts: a lit emissive crystal, an additive sprite and an additive ground decal
 *
 * Nothing here uses a dynamic light: a halo sprite and a light pool on the ground give the same impression for the price of two
 * quads, and the number of lights in the scene stays the same on every frame (so shaders are never recompiled).
 */

const WHITE = new THREE.Color(1, 1, 1);
const W: ColorFn = () => [1, 1, 1];
const hash3 = (x: number, y: number, z: number): number => { const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453; return s - Math.floor(s); };

/** Stone: dark at the foot, lighter towards the top, a little of the team's color, brighter on upward faces, a grain from the position. */
function stoneRamp(y0: number, y1: number, tint: Rgb, k: number, a = 0x2b3040, b = 0x5f677f): ColorFn {
  const A = c3(a), B = c3(b);
  return (x, y, z, ny) => {
    const t = Math.min(1, Math.max(0, (y - y0) / (y1 - y0)));
    const c = lerp3(lerp3(A, B, t), tint, k), lit = 1 + Math.max(0, ny - .55) * .3 + (hash3(x, y, z) - .5) * .12;
    return [c[0] * lit, c[1] * lit, c[2] * lit];
  };
}

// ---------------------------------------------------------------------------------------------------------------- shared resources
const cache = new Map<string, THREE.Material>();
function cached<T extends THREE.Material>(key: string, make: () => T): T {
  let m = cache.get(key) as T | undefined;
  if (!m) cache.set(key, m = make());
  return m;
}
let GLOW: THREE.DataTexture | null = null;
const glowTex = (): THREE.DataTexture => GLOW || (GLOW = glowTexture(64, 1.5));
let POOL: THREE.BufferGeometry | null = null;
const poolGeo = (): THREE.BufferGeometry => POOL || (POOL = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
let CRYSTAL: THREE.BufferGeometry | null = null;
/** An elongated octahedron, radius about 1 and twice as tall. Flat faces. */
const crystalGeo = (): THREE.BufferGeometry => CRYSTAL || (CRYSTAL = new THREE.OctahedronGeometry(1, 0).scale(1, 1.6, 1));

export const stoneMaterial = (): THREE.MeshStandardMaterial => cached('stone', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .88, metalness: .04 }));
export const trimMaterial = (tc: number): THREE.MeshBasicMaterial => cached('trim' + tc, () => new THREE.MeshBasicMaterial({ color: new THREE.Color(tc) }));
export const crystalMaterial = (tc: number): THREE.MeshStandardMaterial => cached('crystal' + tc, () => new THREE.MeshStandardMaterial({ color: new THREE.Color(tc).lerp(WHITE, .3), emissive: new THREE.Color(tc), emissiveIntensity: .95, roughness: .22, metalness: .1 }));
export const haloMaterial = (tc: number): THREE.SpriteMaterial => cached('halo' + tc, () => new THREE.SpriteMaterial({ map: glowTex(), color: tc, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: .55, fog: false }));
export const poolMaterial = (tc: number, opacity = .4): THREE.MeshBasicMaterial => cached('pool' + tc + opacity, () => new THREE.MeshBasicMaterial({ map: glowTex(), color: tc, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));

const FLAME_VERT = `
uniform float uTime;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 p = position;
  float ph = modelMatrix[3].x * 1.7 + modelMatrix[3].z * 2.3, h = uv.y;
  p.x += sin(uTime * 9.0 + ph + h * 6.0) * .07 * h;
  p.z += cos(uTime * 7.3 + ph * 1.3 + h * 5.0) * .07 * h;
  p.y *= 1.0 + sin(uTime * 13.0 + ph) * .08;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const FLAME_FRAG = `
varying vec2 vUv;
void main() {
  float h = vUv.y;
  vec3 col = mix(vec3(1.0, .82, .36), vec3(1.0, .36, .06), smoothstep(.0, .8, h));
  float a = (1.0 - h) * (.3 + .7 * smoothstep(.0, .3, 1.0 - h));
  gl_FragColor = vec4(col, a);
}`;
export const flameMaterial = (): THREE.ShaderMaterial => cached('flame', () => new THREE.ShaderMaterial({
  uniforms: { uTime: SHARED.time }, vertexShader: FLAME_VERT, fragmentShader: FLAME_FRAG,
  transparent: true, depthWrite: false, side: THREE.DoubleSide,
}));

/** Frees the shared materials, textures and geometries (the tests and `Environment.dispose`). */
export function disposeStructures(): void {
  cache.forEach(m => m.dispose()); cache.clear();
  GLOW?.dispose(); GLOW = null;
  POOL?.dispose(); POOL = null;
  CRYSTAL?.dispose(); CRYSTAL = null;
  geoCache.forEach(g => { g.stone.dispose(); g.trim.dispose(); }); geoCache.clear();
}

// ---------------------------------------------------------------------------------------------------------------- small parts
/** A hanging banner with a pointed tail, in the trim geometry. Faces along (cos yaw, sin yaw) outward. */
function banner(trim: GeoBuilder, x: number, y: number, z: number, yaw: number, s = 1): void {
  trim.add(box(.05, .6 * s, .5 * s), place(x, y, z, 1, 1, 1, 0, yaw), W);
  trim.add(cone(.25 * s, .32 * s, 3), place(x, y - .46 * s, z, .22, 1, 1, 0, yaw, Math.PI), W);
}

interface Geos { stone: THREE.BufferGeometry; trim: THREE.BufferGeometry }
const geoCache = new Map<string, Geos>();

function towerGeos(tc: number): Geos {
  const key = 'tower' + tc, hit = geoCache.get(key);
  if (hit) return hit;
  const T = c3(tc), S = new GeoBuilder(), G = new GeoBuilder();
  const st = (y0: number, y1: number, k = .08, a?: number, b?: number): ColorFn => stoneRamp(y0, y1, T, k, a, b);
  S.add(cyl(1.62, 1.9, .5, 8), place(0, .25, 0, 1, 1, 1, 0, Math.PI / 8), st(0, .5, .05, 0x252a39, 0x464d63));
  S.add(cyl(1.3, 1.5, .42, 8), place(0, .71, 0), st(.5, .92));
  S.add(cyl(.86, 1.12, 2.55, 8), place(0, 2.2, 0, 1, 1, 1, 0, Math.PI / 8), st(.9, 3.4, .1));
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; S.add(box(.36, 1.5, .62), place(Math.cos(a) * 1.12, 1.45, Math.sin(a) * 1.12, 1, 1, 1, 0, -a, .16), st(.7, 2.2, .06)); }
  S.add(cyl(1.5, 1.08, .5, 8), place(0, 3.7, 0, 1, 1, 1, 0, Math.PI / 8), st(3.45, 3.95, .14));
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; S.add(box(.46, .42, .4), place(Math.cos(a) * 1.3, 4.16, Math.sin(a) * 1.3, 1, 1, 1, 0, -a), st(3.95, 4.4, .16)); }
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4, c = Math.cos(a), s = Math.sin(a); S.add(box(.15, 1.5, .15), placeAxis(c * .66, 4.55, s * .66, -s, 0, c, .2), st(3.9, 5.1, .1, 0x3f465a, 0x7a839c)); }
  // team trim: two bands, a ring on the crown, four rune slits, four banners
  G.add(cyl(1.1, 1.1, .1, 8), place(0, 1.55, 0, 1, 1, 1, 0, Math.PI / 8), W);
  G.add(cyl(.96, .96, .1, 8), place(0, 3.05, 0, 1, 1, 1, 0, Math.PI / 8), W);
  G.add(new THREE.TorusGeometry(1.12, .05, 4, 32), place(0, 3.97, 0, 1, 1, 1, Math.PI / 2), W);
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4, b = i * Math.PI / 2;
    G.add(box(.1, .75, .07), place(Math.cos(a) * .99, 2.3, Math.sin(a) * .99, 1, 1, 1, 0, -a), W);
    banner(G, Math.cos(b) * .96, 2.8, Math.sin(b) * .96, -b);
  }
  const g = { stone: S.build(), trim: G.build() };
  geoCache.set(key, g);
  return g;
}

function coreGeos(tc: number): Geos {
  const key = 'core' + tc, hit = geoCache.get(key);
  if (hit) return hit;
  const T = c3(tc), S = new GeoBuilder(), G = new GeoBuilder();
  const st = (y0: number, y1: number, k = .08, a?: number, b?: number): ColorFn => stoneRamp(y0, y1, T, k, a, b);
  S.add(cyl(3.5, 3.85, .42, 12), place(0, .21, 0, 1, 1, 1, 0, Math.PI / 12), st(0, .42, .05, 0x252a39, 0x464d63));
  S.add(cyl(2.95, 3.25, .38, 12), place(0, .61, 0), st(.42, .8, .08));
  S.add(cyl(1.55, 1.9, .34, 12), place(0, .97, 0, 1, 1, 1, 0, Math.PI / 12), st(.8, 1.14, .14));
  G.add(cyl(3.52, 3.52, .06, 12), place(0, .44, 0, 1, 1, 1, 0, Math.PI / 12), W);
  G.add(cyl(2.97, 2.97, .06, 12), place(0, .82, 0), W);
  G.add(cyl(1.57, 1.57, .06, 12), place(0, 1.16, 0, 1, 1, 1, 0, Math.PI / 12), W);
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + i * Math.PI / 2, x = Math.cos(a) * 2.6, z = Math.sin(a) * 2.6;
    S.add(cyl(.5, .6, .3, 8), place(x, .95, z), st(.8, 1.1, .1));
    S.add(box(.5, 1.9, .5), place(x, 2.05, z, 1, 1, 1, 0, -a), st(1.1, 3.0, .1));
    S.add(box(.74, .22, .74), place(x, 3.11, z, 1, 1, 1, 0, -a), st(3.0, 3.22, .16, 0x3f465a, 0x7a839c));
    G.add(box(.56, .12, .56), place(x, 2.35, z, 1, 1, 1, 0, -a), W);
    G.add(new THREE.OctahedronGeometry(.2, 0).scale(1, 1.5, 1), place(x, 3.62, z), W);
    banner(G, x + Math.cos(a) * .27, 1.75, z + Math.sin(a) * .27, -a, 1.1);
  }
  const g = { stone: S.build(), trim: G.build() };
  geoCache.set(key, g);
  return g;
}

export interface StructureUserData {
  /** The floating crystal (spun by `struct`). */
  cr: THREE.Object3D;
  /** The orbiting rings of the core (spun by `struct`). */
  rg?: THREE.Object3D;
  /** The halo sprite; `struct` pulses its scale. */
  gl: THREE.Sprite;
  /** Rest scale of the halo. */
  glow: number;
}

/** A tower: about 5.8 world units high, two draw calls of stone and trim, a crystal, a halo and a light pool. Local y = 0 is the ground. */
export function towerModel(tc: number): THREE.Group {
  const g = new THREE.Group(), p = towerGeos(tc);
  const stone = new THREE.Mesh(p.stone, stoneMaterial()), trim = new THREE.Mesh(p.trim, trimMaterial(tc));
  stone.castShadow = stone.receiveShadow = true; trim.castShadow = true;
  const cr = new THREE.Mesh(crystalGeo(), crystalMaterial(tc));
  cr.position.y = 5.0; cr.scale.set(.5, .5, .5); cr.castShadow = true;
  const gl = new THREE.Sprite(haloMaterial(tc)); gl.position.y = 5.0; gl.scale.setScalar(3.6);
  const pool = new THREE.Mesh(poolGeo(), poolMaterial(tc)); pool.position.y = .07; pool.scale.setScalar(8.5);
  g.add(stone, trim, cr, gl, pool);
  const d: StructureUserData = { cr, gl, glow: 3.6 };
  g.userData = d;
  return g;
}

/** The core: a three-step dais with four banner pillars, a floating crystal with a bright heart, two orbiting rings, a halo and a large light pool. */
export function coreModel(tc: number): THREE.Group {
  const g = new THREE.Group(), p = coreGeos(tc);
  const stone = new THREE.Mesh(p.stone, stoneMaterial()), trim = new THREE.Mesh(p.trim, trimMaterial(tc));
  stone.castShadow = stone.receiveShadow = true; trim.castShadow = true;
  const cr = new THREE.Mesh(crystalGeo(), crystalMaterial(tc));
  cr.position.y = 3.9; cr.scale.set(1.0, 1.0, 1.0); cr.castShadow = true;
  const heart = new THREE.Mesh(crystalGeo(), trimMaterial(0xffffff));
  heart.scale.set(.42, .42, .42); cr.add(heart);
  const rg = new THREE.Group(); rg.position.y = 3.9;
  const ringGeo = new THREE.TorusGeometry(2.25, .06, 5, 48), ringMat = trimMaterial(tc);
  const r1 = new THREE.Mesh(ringGeo, ringMat), r2 = new THREE.Mesh(ringGeo, ringMat);
  r1.rotation.x = Math.PI / 2 + .35; r2.rotation.x = Math.PI / 2 - .35; r2.scale.setScalar(.82);
  rg.add(r1, r2);
  const gl = new THREE.Sprite(haloMaterial(tc)); gl.position.y = 3.9; gl.scale.setScalar(9);
  const pool = new THREE.Mesh(poolGeo(), poolMaterial(tc)); pool.position.y = .07; pool.scale.setScalar(15); pool.material = poolMaterial(tc, .34);
  g.add(stone, trim, cr, rg, gl, pool);
  const d: StructureUserData = { cr, rg, gl, glow: 9 };
  g.userData = d;
  return g;
}

// ---------------------------------------------------------------------------------------------------------------- bridges
function bridgeGeos(): Geos {
  const hit = geoCache.get('bridge');
  if (hit) return hit;
  const S = new GeoBuilder(), G = new GeoBuilder(), L = DECK.w, Wd = DECK.d, top = DECK.y + DECK.h / 2;
  const wood = (k: number): ColorFn => (x, y, z, ny) => { const j = .86 + (hash3(x * .3, k, 1) - .5) * .26 + (ny > .5 ? .08 : 0); return [.5 * j, .36 * j, .22 * j]; };
  const dark: ColorFn = (_x, y) => [.27 + y * .04, .19 + y * .03, .12 + y * .02];
  const n = Math.round(L / .56), pw = L / n;
  for (let i = 0; i < n; i++) S.add(box(pw * .92, .17, Wd), place(-L / 2 + (i + .5) * pw, top - .085, 0), wood(i));
  for (const z of [-Wd / 2 + .45, Wd / 2 - .45, 0]) S.add(box(L + .3, .26, .3), place(0, top - .3, z), dark);
  for (const z of [-Wd / 2 + .12, Wd / 2 - .12]) {
    for (let x = -L / 2 + .3; x <= L / 2 - .29; x += 2.2) {
      S.add(box(.22, 1.1, .22), place(x, top + .55, z), (_x, y) => [.36 + (y - top) * .05, .26 + (y - top) * .04, .17]);
      G.add(box(.2, .16, .2), place(x, top + 1.18, z), W);
    }
    S.add(box(L - .5, .13, .13), place(0, top + .96, z), dark);
    S.add(box(L - .5, .1, .1), place(0, top + .5, z), dark);
  }
  for (const x of [-5.6, 0, 5.6]) for (const z of [-Wd / 2 + .45, Wd / 2 - .45]) S.add(cyl(.2, .25, 1.6, 6), place(x, -.5, z), (_x, y) => [.2 + (y + 1) * .08, .15 + (y + 1) * .06, .1 + (y + 1) * .04]);
  for (const sx of [-1, 1]) S.add(box(1.5, .95, Wd + .6), place(sx * (L / 2 - .5), -.12, 0, 1, 1, 1, 0, 0, 0), stoneRamp(-.6, .35, [0, 0, 0], 0, 0x2a2f3f, 0x4f566b));
  const g = { stone: S.build(), trim: G.build() };
  geoCache.set('bridge', g);
  return g;
}

// ---------------------------------------------------------------------------------------------------------------- the world's props

/** Lantern yellow for bridge trim. */
export const LANTERN = 0xffc873;

export class Props {
  readonly group = new THREE.Group();
  /** Floating crystals that bob and turn (shrines, spring). */
  private floaters: { m: THREE.Object3D; y: number; phase: number }[] = [];
  private own: THREE.BufferGeometry[] = [];

  constructor() {
    this.group.name = 'props';
    const stone = stoneMaterial();
    const bg = bridgeGeos();
    for (const b of BRIDGES) {
      const m = new THREE.Mesh(bg.stone, stone);
      m.position.set(b.x * K, 0, b.y * K);
      m.rotation.set(0, b.rot, 0);
      m.castShadow = m.receiveShadow = true;
      const l = new THREE.Mesh(bg.trim, trimMaterial(LANTERN));
      l.position.copy(m.position);
      l.rotation.set(0, b.rot, 0);
      this.group.add(m, l);
    }

    // world-space stone for everything else: one mesh
    const S = new GeoBuilder(), trims = new Map<number, GeoBuilder>();
    const trim = (c: number): GeoBuilder => { let b = trims.get(c); if (!b) trims.set(c, b = new GeoBuilder()); return b; };
    const st = (y0: number, y1: number, tint: Rgb = [0, 0, 0], k = 0, a?: number, b?: number): ColorFn => stoneRamp(y0, y1, tint, k, a, b);

    // pylons with banners on the rim of each base plaza, where no lane enters
    BASES.forEach((base, t) => {
      const tc = TEAM_COLOR[t], T = c3(tc), cx = base.x * K, cz = base.y * K, R = PLAZA_R * K + .7, G = trim(tc);
      for (let i = 0; i < 14; i++) {
        const a = i / 14 * Math.PI * 2 + .12, x = cx + Math.cos(a) * R, z = cz + Math.sin(a) * R;
        if (x < 1.5 || z < 1.5 || x > WORLD - 1.5 || z > WORLD - 1.5 || laneDist(x / K, z / K) < 150) continue;
        const y = terrainAt(x, z), inward = a + Math.PI;
        S.add(cyl(.55, .72, .4, 6), place(x, y + .2, z), st(y, y + .4, T, .05, 0x252a39, 0x464d63));
        S.add(cyl(.3, .45, 2.4, 6), place(x, y + 1.6, z, 1, 1, 1, 0, a), st(y + .4, y + 2.8, T, .1));
        S.add(cyl(.52, .34, .24, 6), place(x, y + 2.9, z), st(y + 2.8, y + 3.05, T, .14, 0x3f465a, 0x7a839c));
        G.add(new THREE.OctahedronGeometry(.2, 0).scale(1, 1.5, 1), place(x, y + 3.5, z), W);
        G.add(cyl(.34, .34, .08, 6), place(x, y + 1.0, z), W);
        banner(G, x + Math.cos(inward) * .4, y + 1.95, z + Math.sin(inward) * .4, -inward, 1.2);
      }
    });

    // braziers along the base approaches
    const flame = flameMaterial(), flameGeo = new THREE.ConeGeometry(.42, 1.4, 7, 3, true).translate(0, .7, 0);
    this.own.push(flameGeo);
    for (const p of TORCHES) {
      const x = p.x * K, z = p.y * K, y = terrainAt(x, z);
      S.add(cyl(.34, .5, 1.1, 6), place(x, y + .55, z), st(y, y + 1.1, [0, 0, 0], 0, 0x2f3446, 0x5f6780));
      S.add(cyl(.78, .4, .4, 8), place(x, y + 1.3, z), st(y + 1.1, y + 1.5, [0, 0, 0], 0, 0x2f3446, 0x5a627a));
      const f = new THREE.Mesh(flameGeo, flame); f.position.set(x, y + 1.46, z); f.renderOrder = 2;
      const pool = new THREE.Mesh(poolGeo(), poolMaterial(0xff8a3a, .3)); pool.position.set(x, y + .08, z); pool.scale.setScalar(6);
      this.group.add(f, pool);
    }

    // shrines: a low dais and an obelisk, a floating crystal above
    SHRINES.forEach((s, i) => {
      const x = s.x * K, z = s.y * K, y = terrainAt(x, z);
      S.add(cyl(2.3, 2.6, .3, 8), place(x, y + .15, z, 1, 1, 1, 0, Math.PI / 8), st(y, y + .3, [1, .8, .35], .03, 0x2b3040, 0x4f566b));
      S.add(cyl(.45, .7, 1.5, 6), place(x, y + 1.05, z), st(y + .3, y + 1.8, [1, .8, .35], .05, 0x30364a, 0x5a627a));
      S.add(cyl(.62, .45, .22, 6), place(x, y + 1.9, z), st(y + 1.8, y + 2.0, [1, .8, .35], .08, 0x3a4156, 0x6e7790));
      trim(MAGIC.gold).add(new THREE.TorusGeometry(2.15, .05, 4, 8), place(x, y + .31, z, 1, 1, 1, Math.PI / 2, 0, Math.PI / 8), W);
      const c = new THREE.Mesh(crystalGeo(), crystalMaterial(MAGIC.gold)); c.scale.setScalar(.42); c.position.set(x, y + 2.9, z);
      const h = new THREE.Sprite(haloMaterial(MAGIC.gold)); h.scale.setScalar(2.2); h.position.set(x, y + 2.9, z);
      const pool = new THREE.Mesh(poolGeo(), poolMaterial(MAGIC.gold, .2)); pool.position.set(x, y + .09, z); pool.scale.setScalar(8);
      this.group.add(c, h, pool);
      this.floaters.push({ m: c, y: y + 2.9, phase: i * 1.7 });
    });

    // the spring: a stone basin and a floating cyan orb
    {
      const x = SPRING.x * K, z = SPRING.y * K, y = Math.max(terrainAt(x, z), WATER_Y + .05) - .1; // the basin stands in the river and rises above it
      S.add(cyl(3.0, 3.35, .9, 10), place(x, y + .3, z, 1, 1, 1, 0, Math.PI / 10), st(y - .15, y + .75, [.3, .8, 1], .05, 0x2b3040, 0x4f566b));
      S.add(cyl(.5, .8, 1.2, 8), place(x, y + 1.3, z), st(y + .75, y + 1.9, [.3, .8, 1], .06, 0x30364a, 0x5a627a));
      trim(MAGIC.cyan).add(new THREE.TorusGeometry(2.85, .06, 4, 10), place(x, y + .77, z, 1, 1, 1, Math.PI / 2, 0, Math.PI / 10), W);
      const c = new THREE.Mesh(crystalGeo(), crystalMaterial(MAGIC.cyan)); c.scale.setScalar(.6); c.position.set(x, y + 3.1, z);
      const h = new THREE.Sprite(haloMaterial(MAGIC.cyan)); h.scale.setScalar(3); h.position.set(x, y + 3.1, z);
      const pool = new THREE.Mesh(poolGeo(), poolMaterial(MAGIC.cyan, .3)); pool.position.set(x, y + .95, z); pool.scale.setScalar(8);
      this.group.add(c, h, pool);
      this.floaters.push({ m: c, y: y + 3.1, phase: 0 });
    }

    const sg = S.build(); this.own.push(sg);
    const sm = new THREE.Mesh(sg, stone); sm.castShadow = sm.receiveShadow = true; this.group.add(sm);
    for (const [c, b] of trims) { const g = b.build(); this.own.push(g); this.group.add(new THREE.Mesh(g, trimMaterial(c))); }
  }

  /** Per frame: the floating crystals bob and turn. */
  update(t: number): void {
    for (const f of this.floaters) { f.m.position.y = f.y + Math.sin(t * 1.3 + f.phase) * .14; f.m.rotation.y = t * .7 + f.phase; }
  }

  dispose(): void {
    this.own.forEach(g => g.dispose());
    this.own = [];
    this.group.parent?.remove(this.group);
  }
}
