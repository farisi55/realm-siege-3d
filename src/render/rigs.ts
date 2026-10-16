import * as THREE from 'three';
import { HIP_Y } from './animation';
import type { ClipStyle } from './animation';

/**
 * Procedural character rigs: a bone hierarchy plus colored primitives per bone, merged into ONE skinned geometry
 * (rigid skinning: every primitive follows exactly one bone). A character costs two draw calls (lit + unlit glow)
 * instead of one per body part, and the same AnimationMixer drives it as drives a GLB.
 *
 * Rig space: the character faces +Z, y is up, the feet are at y = 0 and the hips (bone `hips`) at y = HIP_Y.
 * Bones every rig has: hips, spine, head, armL, foreL, armR, foreR, legL, shinL, legR, shinR  (L = +X, R = -X).
 */

export type V3 = [number, number, number];
export type Shape = 'box' | 'sph' | 'cyl' | 'cone' | 'oct' | 'tor';
export interface Prim {
  s: Shape;
  /** Palette key. */
  c: string;
  /** Position and size in bone space. box: width/height/depth; sph, oct: radii; cyl, cone: radius x, height, radius z; tor: radius (tube via `k`). */
  p: V3; z: V3;
  /** Euler rotation (XYZ). */
  r?: V3;
  /** Scale of the top / bottom face in x and z (box, cyl, cone): tapered limbs, blades, shields. */
  t?: [number, number]; b?: [number, number];
  /** Unlit and bright: gems, runes, eyes, orbs. */
  g?: boolean;
  /** Torus tube ratio. */
  k?: number;
}
export interface BoneDef { name: string; parent: string | null; pos: V3; prims: Prim[]; }
export interface TrailDef { bone: string; base: V3; tip: V3; }
export interface RigDef {
  id: string;
  style: ClipStyle;
  bones: BoneDef[];
  trails: TrailDef[];
  /** Height of the whole silhouette (hats, horns, plumes included) in rig units: used to scale the rig to its in-game height. */
  height: number;
}
export type Palette = Record<string, number>;

/* ------------------------------------------------------------------ primitive constructors */

type O = Partial<Pick<Prim, 'r' | 't' | 'b' | 'g' | 'k'>>;
export const box = (c: string, p: V3, z: V3, o: O = {}): Prim => ({ s: 'box', c, p, z, ...o });
export const sph = (c: string, p: V3, z: V3, o: O = {}): Prim => ({ s: 'sph', c, p, z, ...o });
export const cyl = (c: string, p: V3, z: V3, o: O = {}): Prim => ({ s: 'cyl', c, p, z, ...o });
export const cone = (c: string, p: V3, z: V3, o: O = {}): Prim => ({ s: 'cone', c, p, z, ...o });
export const oct = (c: string, p: V3, z: V3, o: O = {}): Prim => ({ s: 'oct', c, p, z, ...o });
export const tor = (c: string, p: V3, z: V3, o: O = {}): Prim => ({ s: 'tor', c, p, z, ...o });
/** Left/right mirror of a primitive (x flips; yaw and roll flip). */
export const mir = (q: Prim): Prim => ({ ...q, p: [-q.p[0], q.p[1], q.p[2]], r: q.r && [q.r[0], -q.r[1], -q.r[2]] });
export const both = (...q: Prim[]): Prim[] => [...q, ...q.map(mir)];

/* ------------------------------------------------------------------ humanoid anatomy */

export interface Anatomy {
  /** Chest / shoulder width multiplier. */
  bulk?: number;
  /** Arm and leg thickness multipliers. */
  aw?: number; lw?: number;
  /** Head size multiplier; `skinHead: false` when a helmet or hood replaces the bare head. */
  headR?: number; skinHead?: boolean;
  /** Palette keys for the body parts. */
  torso?: string; pelvis?: string; arm?: string; fore?: string; hand?: string; leg?: string; shin?: string; boot?: string;
  /** Leave the upper arms bare skin and the legs plain. */
  eyes?: string;
}

/** The shared skeleton and a plain body; each rig adds its own armor, cloth, hair and weapons on top. */
export function humanoid(a: Anatomy = {}): Record<string, BoneDef> {
  const bulk = a.bulk ?? 1, aw = a.aw ?? 1, lw = a.lw ?? 1, hr = a.headR ?? 1;
  const T = a.torso ?? 'a', arm = a.arm ?? T, fore = a.fore ?? arm, hand = a.hand ?? 's', leg = a.leg ?? 'b', shin = a.shin ?? leg, boot = a.boot ?? 'd';
  const sx = .31 * bulk + .12, B: Record<string, BoneDef> = {};
  const def = (name: string, parent: string | null, pos: V3, prims: Prim[]) => (B[name] = { name, parent, pos, prims });
  def('hips', null, [0, HIP_Y, 0], [box(a.pelvis ?? 'b', [0, 0, 0], [.46 * bulk, .22, .3]), box('d', [0, .09, 0], [.5 * bulk, .06, .32])]);
  def('spine', 'hips', [0, .12, 0], [box(T, [0, .15, 0], [.44 * bulk, .3, .3], { t: [1.1, 1.05] }), box(T, [0, .38, 0], [.66 * bulk, .34, .36], { b: [.75, .9] })]);
  def('head', 'spine', [0, .56, 0], [
    cyl('s', [0, .04, 0], [.075, .1, .075]),
    ...(a.skinHead === false ? [] : [sph('s', [0, .27, 0], [.2 * hr, .22 * hr, .2 * hr])]),
    box(a.eyes ?? 'd', [-.075 * hr, .29, .185 * hr], [.05, .035, .02], { g: a.eyes !== undefined }), box(a.eyes ?? 'd', [.075 * hr, .29, .185 * hr], [.05, .035, .02], { g: a.eyes !== undefined }),
  ]);
  for (const [S, sg] of [['L', 1], ['R', -1]] as [string, number][]) {
    def('arm' + S, 'spine', [sg * sx, .43, 0], [sph(arm, [0, 0, 0], [.11 * aw, .11 * aw, .11 * aw]), box(arm, [0, -.18, 0], [.15 * aw, .36, .16 * aw], { b: [.82, .82] })]);
    def('fore' + S, 'arm' + S, [0, -.36, 0], [sph(fore, [0, 0, 0], [.08 * aw, .08 * aw, .08 * aw]), box(fore, [0, -.16, 0], [.13 * aw, .32, .14 * aw], { b: [.8, .8] }), sph(hand, [0, -.35, 0], [.075 * aw, .075 * aw, .075 * aw])]);
    def('leg' + S, 'hips', [sg * .15, -.02, 0], [box(leg, [0, -.22, 0], [.2 * lw, .46, .22 * lw], { b: [.85, .85] })]);
    def('shin' + S, 'leg' + S, [0, -.48, 0], [sph(leg, [0, 0, 0], [.09 * lw, .09 * lw, .09 * lw]), box(shin, [0, -.24, 0], [.16 * lw, .48, .17 * lw], { b: [.8, .9] }), box(boot, [0, -.43, .05], [.18 * lw, .14, .32])]);
  }
  return B;
}

export const finish = (id: string, style: ClipStyle, height: number, B: Record<string, BoneDef>, trails: TrailDef[] = []): RigDef =>
  ({ id, style, height, trails, bones: ['hips', 'spine', 'head', 'armL', 'foreL', 'armR', 'foreR', 'legL', 'shinL', 'legR', 'shinR'].map(n => B[n]) });

/* ------------------------------------------------------------------ geometry */

const ni = (g: THREE.BufferGeometry): THREE.BufferGeometry => (g.index ? g.toNonIndexed() : g);
let UNIT: Record<Shape, THREE.BufferGeometry> | null = null;
const unit = (): Record<Shape, THREE.BufferGeometry> => UNIT || (UNIT = {
  box: ni(new THREE.BoxGeometry(1, 1, 1)),
  sph: ni(new THREE.SphereGeometry(1, 10, 7)),
  cyl: ni(new THREE.CylinderGeometry(1, 1, 1, 9)),
  cone: ni(new THREE.ConeGeometry(1, 1, 8)),
  oct: ni(new THREE.OctahedronGeometry(1, 0)),
  tor: ni(new THREE.TorusGeometry(1, .16, 6, 14)),
});
const torusCache = new Map<number, THREE.BufferGeometry>();

const E = new THREE.Euler(), M = new THREE.Matrix4(), Mq = new THREE.Quaternion();
const C = new THREE.Color();

interface Acc { pos: number[]; nor: number[]; col: number[]; idx: number[]; wgt: number[]; }
const acc = (): Acc => ({ pos: [], nor: [], col: [], idx: [], wgt: [] });

/** Appends one primitive, already transformed into rig space, with vertex colors and rigid skin weights. */
function addPrim(a: Acc, q: Prim, origin: V3, bone: number, color: number, lit: boolean): void {
  let g = unit()[q.s];
  if (q.s === 'tor' && q.k) { let t = torusCache.get(q.k); if (!t) torusCache.set(q.k, t = ni(new THREE.TorusGeometry(1, q.k, 6, 14))); g = t; }
  const P = g.attributes.position, N = g.attributes.normal, n = P.count;
  const rot = q.r || [0, 0, 0];
  M.compose(new THREE.Vector3(q.p[0] + origin[0], q.p[1] + origin[1], q.p[2] + origin[2]), Mq.setFromEuler(E.set(rot[0], rot[1], rot[2], 'XYZ')), new THREE.Vector3(1, 1, 1));
  const e = M.elements, tapered = q.s === 'box' || q.s === 'cyl' || q.s === 'cone';
  C.setHex(color);
  const tp = q.t || [1, 1], bt = q.b || [1, 1], v: number[] = [];
  for (let i = 0; i < n; i++) {
    let x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    if (tapered && (q.t || q.b)) { const f = y + .5; x *= bt[0] + (tp[0] - bt[0]) * f; z *= bt[1] + (tp[1] - bt[1]) * f; }
    x *= q.z[0]; y *= q.z[1]; z *= q.z[2];
    v.push(e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]);
  }
  const flat = q.s === 'box' || q.s === 'oct';
  for (let i = 0; i < n; i++) {
    let nx: number, ny: number, nz: number;
    if (flat) { // face normal from the transformed triangle
      const t = i - (i % 3), ax = v[t * 3], ay = v[t * 3 + 1], az = v[t * 3 + 2];
      const ux = v[t * 3 + 3] - ax, uy = v[t * 3 + 4] - ay, uz = v[t * 3 + 5] - az, wx = v[t * 3 + 6] - ax, wy = v[t * 3 + 7] - ay, wz = v[t * 3 + 8] - az;
      nx = uy * wz - uz * wy; ny = uz * wx - ux * wz; nz = ux * wy - uy * wx;
    } else { // smooth: rotate the unit normal and undo the non-uniform scale
      const sx = N.getX(i) / (q.z[0] || 1), sy = N.getY(i) / (q.z[1] || 1), sz = N.getZ(i) / (q.z[2] || 1);
      nx = e[0] * sx + e[4] * sy + e[8] * sz; ny = e[1] * sx + e[5] * sy + e[9] * sz; nz = e[2] * sx + e[6] * sy + e[10] * sz;
    }
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    // Cheap baked shading: down-facing surfaces and low parts are a little darker, so shapes read at a distance.
    const sh = lit ? (.84 + .16 * (ny * .5 + .5)) * (.9 + .1 * Math.min(1, Math.max(0, v[i * 3 + 1] / 2))) : 1;
    a.pos.push(v[i * 3], v[i * 3 + 1], v[i * 3 + 2]); a.nor.push(nx, ny, nz);
    a.col.push(C.r * sh, C.g * sh, C.b * sh);
    a.idx.push(bone, 0, 0, 0); a.wgt.push(1, 0, 0, 0);
  }
}

function toGeometry(a: Acc): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(a.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(a.nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(a.col, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(a.idx, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(a.wgt, 4));
  g.computeBoundingSphere();
  return g;
}

const GEO = new Map<string, { lit: THREE.BufferGeometry; glow: THREE.BufferGeometry | null }>();
/** Merged skinned geometry for a rig + palette. Cached: all characters sharing the look share the geometry. */
export function rigGeometry(def: RigDef, pal: Palette): { lit: THREE.BufferGeometry; glow: THREE.BufferGeometry | null } {
  const key = def.id + '|' + Object.keys(pal).sort().map(k => k + pal[k].toString(16)).join(',');
  let hit = GEO.get(key);
  if (hit) return hit;
  const lit = acc(), glow = acc(), origin: Record<string, V3> = {};
  def.bones.forEach((b, i) => {
    const po = b.parent ? origin[b.parent] : [0, 0, 0];
    origin[b.name] = [po[0] + b.pos[0], po[1] + b.pos[1], po[2] + b.pos[2]];
    for (const q of b.prims) {
      const c = pal[q.c];
      if (c === undefined) throw new Error(`rig ${def.id}: palette has no color "${q.c}"`);
      addPrim(q.g ? glow : lit, q, origin[b.name], i, c, !q.g);
    }
  });
  hit = { lit: toGeometry(lit), glow: glow.pos.length ? toGeometry(glow) : null };
  GEO.set(key, hit);
  return hit;
}

/* ------------------------------------------------------------------ instances */

export interface RigInstance {
  group: THREE.Group;
  bones: Record<string, THREE.Bone>;
  skeleton: THREE.Skeleton;
  lit: THREE.SkinnedMesh;
  glow: THREE.SkinnedMesh | null;
  materials: THREE.Material[];
  trails: { base: THREE.Object3D; tip: THREE.Object3D }[];
  def: RigDef;
}

/** Builds a fresh skeleton + skinned meshes for one character (geometry is shared, bones and materials are not). */
export function instantiateRig(def: RigDef, pal: Palette): RigInstance {
  const geo = rigGeometry(def, pal), group = new THREE.Group(), bones: Record<string, THREE.Bone> = {}, list: THREE.Bone[] = [];
  for (const b of def.bones) {
    const bone = new THREE.Bone();
    bone.name = b.name; bone.position.set(b.pos[0], b.pos[1], b.pos[2]);
    bones[b.name] = bone; list.push(bone);
    if (b.parent) bones[b.parent].add(bone);
  }
  group.add(bones.hips);
  const litMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .72, metalness: .12 });
  litMat.skinning = true;
  const lit = new THREE.SkinnedMesh(geo.lit, litMat);
  lit.name = 'body'; lit.castShadow = true; lit.frustumCulled = false;
  group.add(lit);
  const materials: THREE.Material[] = [litMat];
  let glow: THREE.SkinnedMesh | null = null;
  if (geo.glow) {
    const gm = new THREE.MeshBasicMaterial({ vertexColors: true });
    gm.skinning = true;
    glow = new THREE.SkinnedMesh(geo.glow, gm);
    glow.name = 'glow'; glow.frustumCulled = false;
    group.add(glow); materials.push(gm);
  }
  group.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(list);
  lit.bind(skeleton);
  glow?.bind(skeleton, lit.bindMatrix);
  const trails = def.trails.map((t, i) => {
    const base = new THREE.Object3D(), tip = new THREE.Object3D();
    base.name = 'TrailBase' + i; tip.name = 'TrailTip' + i;
    base.position.set(...t.base); tip.position.set(...t.tip);
    bones[t.bone].add(base, tip);
    return { base, tip };
  });
  return { group, bones, skeleton, lit, glow, materials, trails, def };
}
