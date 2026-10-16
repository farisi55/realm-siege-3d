import * as THREE from 'three';
import { app } from '../game/state';
import { K } from '../game/config';
import { clamp } from '../game/util';
import type { Unit } from '../game/types';
import { cm, fl, rd, sn } from './scene';
import { V3 } from './scratch';
import { groundY } from './ground';
import { camReset, camSink, rig } from './camera';
import { trailPool } from './trail';
import { ParticleLayer } from './fx/particles';
import { MeshFx } from './fx/mesh';
import { Kit } from './fx/kit';
import { Director, newStructAcc } from './fx/director';
import type { StructAcc } from './fx/director';
import { SPR } from './fx/atlas';

/**
 * The visual-effects system, one entry point for the rest of the renderer (the simulation reaches it only through `hooks.fx` / `hooks.ft`).
 *
 *   fx/particles.ts   two particle layers (additive, alpha), one draw call each, swap-remove arrays
 *   fx/mesh.ts        pooled mesh effects: terrain decals, rings, light pillars, domes, lightning ribbons, glow flashes, spikes, rocks
 *   fx/kit.ts         what recipes use: emitters + meshes + timeline + camera sink + the one shared scene light
 *   fx/recipes.ts, fx/abilities.ts, fx/projectiles.ts   the effects themselves
 *   fx/director.ts    turns what the simulation does into effects (casts, hits, deaths, projectiles, auras, buildings)
 *   fx/stage.ts       the hero-select pedestal
 *
 * Everything is created once here; playing an effect never allocates a mesh, geometry or material.
 */

const add = new ParticleLayer(2600, 'add'), alp = new ParticleLayer(900, 'alpha');
const meshFx = new MeshFx();
export const kit = new Kit(add, alp, meshFx);
kit.cam = camSink;
export const director = new Director(kit);
sn.add(alp.points, add.points, meshFx.group, trailPool.group);

/** Floating combat text (DOM): the live entries and the spare elements. */
export const FT: any[] = [];
export const FP: HTMLElement[] = [];
export { newStructAcc };
export type { StructAcc };

// ---------------------------------------------------------------------------------------------------------------- hooks for the simulation

/** `hooks.fx`: a ring / flash call of the simulation. The director recognises what it is and plays the matching effect. */
export function fx(x: number, y: number, r: number, l: number, c: number): void { director.onFx(x, y, r, l, c); }

/** `hooks.ft`: a floating number or text. The director reads damage numbers (they size the hit sparks); the text itself is DOM. */
export function ft(x: number, y: number, s: string | number, c: string): void {
  director.onFt(x, y, s, c);
  if (!app.G || FT.length > 30 || Math.abs(x - app.cam.k.x) > 1500 || Math.abs(y - app.cam.k.y) > 1500) return;
  const e = FP.pop() || document.getElementById('ftl')!.appendChild(Object.assign(document.createElement('div'), { className: 'ft' }));
  const n = typeof s === 'number' ? s : NaN;
  e.textContent = String(s); e.style.color = c; e.style.display = 'block';
  e.style.fontSize = (Number.isFinite(n) ? clamp(13 + Math.sqrt(n) * .75, 13, 30) : 15) + 'px';
  FT.push({ e, x, y: groundY(x, y) + 3, z: y, t: 0, dx: (Math.random() - .5) * 38 });
}

/** A quick spray of sparks (kept for callers that want one): `n` sparks of `color` at (x, y, z), world units. */
export function burst(x: number, y: number, z: number, color: number, n: number, speed: number, life: number): void { kit.em.burst(x, y, z, color, n, speed, life); }

// ---------------------------------------------------------------------------------------------------------------- hooks for the renderer

/** The player is about to cast at this ground point (input.ts): lets the telegraph land exactly where the spell will. */
export function fxAim(x: number, y: number): void { director.setAim(x, y); }
/** A hero that was dead is alive again. */
export function fxRespawn(u: Unit): void { director.heroRespawn(u); }
/** Per frame for a tower / core: smoke, fire, sparks and arcs when it is damaged, drifting motes when it is not. */
export function fxStructure(u: Unit, acc: StructAcc, dt: number): void { director.structure(u, acc, dt); }
/** A click on the ground (`move`) or on an enemy (`attack`): a small marker that closes in on the point. */
export function fxPing(x: number, y: number, kind: 'move' | 'attack' = 'move'): void {
  const wx = x * K, wz = y * K, gy = groundY(x, y) + .22, c = kind === 'attack' ? 0xff5a4a : 0x8ad0ff;
  kit.mesh.ring({ x: wx, y: gy, z: wz, r0: 1.7, r1: .3, color: c, life: .3, width: .13, alpha: .95, fadeOut: .15 });
  kit.mesh.ring({ x: wx, y: gy, z: wz, r0: .3, r1: kind === 'attack' ? 1.6 : 1.1, color: c, life: .5, width: .08, alpha: .7 });
  for (let i = 0; i < 3; i++) { const a = Math.random() * 6.283; kit.em.glyph(SPR.sparkle, wx + Math.cos(a) * .5, gy + .3, wz + Math.sin(a) * .5, 0, .9, 0, c, .35, .45, 2); }
}

// ---------------------------------------------------------------------------------------------------------------- the frame

const BX = new THREE.Vector3(), BY = new THREE.Vector3(), BZ = new THREE.Vector3(), MAX_LIGHT = 2.4;
let last = 0, ready = false, lockQ: number | null = null;
const resets: (() => void)[] = [];
/** Other modules (the stage) register what must be cleared when effects are reset. */
export function fxOnReset(fn: () => void): void { resets.push(fn); }

/** Largest point size the GPU can draw (queried once from the real context; the test renderer has none). */
function gpuLimits(): void {
  ready = true;
  try {
    const gl = (rd as any).getContext?.() as WebGLRenderingContext | undefined;
    const r = gl && gl.getParameter ? gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) : null;
    if (r && r[1] > 0) { add.setMaxPoint(Math.min(256, r[1])); alp.setMaxPoint(Math.min(256, r[1])); }
  } catch { /* keep the default */ }
}

/** Camera basis, viewport, focus and quality for this frame. `menu`: the hero-select stage camera, not the match camera. */
function prepare(menu: boolean): void {
  if (!ready) gpuLimits();
  cm.updateMatrixWorld();
  cm.matrixWorld.extractBasis(BX, BY, BZ);
  kit.right.copy(BX); kit.up.copy(BY);
  const hpx = (typeof innerHeight === 'number' ? innerHeight : 800) * Math.min((typeof devicePixelRatio === 'number' && devicePixelRatio) || 1, 2), fov = cm.fov * Math.PI / 180;
  add.setViewport(hpx, fov); alp.setViewport(hpx, fov);
  if (menu) { kit.focus.x = 80; kit.focus.z = -40; kit.focus.r = 40; }
  else { kit.focus.x = rig.fx * K; kit.focus.z = rig.fy * K; kit.focus.r = rig.visible; }
  kit.q = lockQ ?? clamp((app.fps - 26) / 24, .4, 1);
}

/** Steps everything that is time-based: delayed calls, pooled meshes, particles, the scene light. `dt` is the effect clock. */
function advance(dt: number): void {
  kit.tl.update(dt);
  meshFx.update(dt, cm.position);
  add.update(dt); alp.update(dt);
  const L = kit.light;
  if (L.intensity > .01) {
    if (dt > 0) L.intensity = Math.max(0, L.intensity - dt * 5);
    fl.position.set(L.x, L.y, L.z); fl.color.setHex(L.color); fl.intensity = Math.min(L.intensity, MAX_LIGHT); // 8-bit frame + bloom: beyond this the lit ground only clips
  } else { L.intensity = 0; fl.intensity = 0; }
}

/** Floating text: pops in, drifts up with a little sideways spread, fades out. */
function updateText(dt: number): void {
  for (let i = FT.length - 1; i >= 0; i--) {
    const f = FT[i], e: HTMLElement = f.e;
    f.t += dt;
    const rise = .8 * (1 - Math.pow(1 - Math.min(1, f.t / .8), 2)) * 2.75; // eased: fast at first, slow at the end
    V3.set(f.x * K, f.y + rise, f.z * K).project(cm);
    const pop = 1 + .55 * Math.max(0, 1 - f.t / .14);
    e.style.transform = 'translate(' + ((V3.x * .5 + .5) * innerWidth + f.dx * Math.min(1, f.t * 3)) + 'px,' + ((-V3.y * .5 + .5) * innerHeight) + 'px) translate(-50%,-50%) scale(' + pop.toFixed(3) + ')';
    e.style.opacity = String(clamp(1.6 - f.t * 2, 0, 1));
    if (f.t > .8 || V3.z > 1) { e.style.display = 'none'; FP.push(e); FT.splice(i, 1); }
  }
}

/**
 * One match frame (called by `step`). `dt` is the simulation time that passed: 0 while paused or after the match ended. The
 * effects pause with the game, but keep playing after the end so the core's finale is seen.
 */
export function fxu(dt: number): void {
  const now = typeof performance !== 'undefined' ? performance.now() : 0, real = clamp((now - last) / 1000, 0, .05); last = now;
  const edt = dt > 0 ? dt : app.G && app.G.over ? real : 0;
  prepare(false);
  director.update(dt);
  advance(edt);
  updateText(dt);
}

/** One menu frame: the hero-select stage steps the same pools (the match loop that normally does it is not running). */
export function fxMenu(dt: number): void {
  prepare(true);
  advance(dt);
}

/** Clears every effect (a new match, back to the menu). */
export function resetFx(): void {
  kit.reset(); director.reset(); camReset(); trailPool.clear();
  fl.intensity = 0;
  for (const fn of resets) fn();
}

// ---------------------------------------------------------------------------------------------------------------- debugging / tests

/** Pins the detail level (1 = full) regardless of the frame rate, or releases it with `null`. For tests and screenshots. */
export function fxQuality(q: number | null): void { lockQ = q; }

/** Counters of the pools: what is alive now, the most that was alive at once, and what was refused. Nothing here grows without bound. */
export function fxStats() {
  return {
    particles: { add: add.count, alpha: alp.count, capAdd: add.cap, capAlpha: alp.cap, peakAdd: add.peak, peakAlpha: alp.peak, dropped: add.dropped + alp.dropped, emitted: add.emitted + alp.emitted },
    meshes: { ...meshFx.counts(), created: meshFx.created(), denied: meshFx.denied(), deniedBy: meshFx.deniedBy(), peaks: meshFx.peaks() },
    trails: { active: trailPool.active, created: trailPool.slots.length, denied: trailPool.denied, peak: trailPool.peak },
    director: { ...director.stats, tracked: director.tracked },
    timeline: kit.tl.pending, quality: kit.q,
  };
}

export const fxDebug = { kit, director, mesh: meshFx, add, alp, rig, trails: trailPool, stats: fxStats, quality: fxQuality };
