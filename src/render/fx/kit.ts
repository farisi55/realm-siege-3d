import * as THREE from 'three';
import { Emitters } from './emitters';
import type { ParticleLayer } from './particles';
import type { MeshFx } from './mesh';

/** What the effects ask of the camera. The real implementation lives in camera.ts; tests pass a recorder. */
export interface CamSink {
  /** Screen shake: `amount` 0..1 (a big explosion is ~.8) from a point in world space; attenuated with the distance to the camera focus. */
  shake(amount: number, x: number, z: number, jitter?: number): void;
  /** Quick push-in (zoom punch) of the same kind of strength, plus an optional vertical screen kick. */
  kick(amount: number, x: number, z: number): void;
  /** Optional: pull the camera toward a world point for a moment (the core finale). */
  focus?(x: number, z: number): void;
}
export const NO_CAM: CamSink = { shake() {}, kick() {} };

/** The request for the scene's one flash light (the renderer keeps a constant light count, so effects share it). */
export interface LightReq { x: number; y: number; z: number; color: number; intensity: number; }

/** Delayed callbacks that run on the effect clock (so they pause with the game and stop at once on reset). */
export class Timeline {
  private q: { t: number; fn: () => void }[] = [];
  private due: (() => void)[] = [];
  at(delay: number, fn: () => void): void { if (delay <= 0) fn(); else this.q.push({ t: delay, fn }); }
  update(dt: number): void {
    if (dt <= 0 || !this.q.length) return;
    const due = this.due; due.length = 0;
    for (let i = 0; i < this.q.length;) { const e = this.q[i]; if ((e.t -= dt) <= 0) { due.push(e.fn); this.q.splice(i, 1); } else i++; }
    for (const fn of due) fn();
    due.length = 0;
  }
  get pending(): number { return this.q.length; }
  clear(): void { this.q.length = 0; }
}

/**
 * Everything an effect recipe needs in one object: the particle emitters, the pooled mesh effects, the delayed-call timeline, the
 * camera sink and the scene light request. Recipes are plain functions of (kit, positions, colors) in WORLD units (y up).
 */
export class Kit {
  readonly em: Emitters;
  readonly tl = new Timeline();
  cam: CamSink = NO_CAM;
  /** Camera focus (world x / z) and the radius of what is visible; effects far outside it are thinned out or skipped. */
  focus = { x: 0, z: 0, r: 70 };
  /** 1 = full detail. The director lowers it when the frame rate drops. */
  q = 1;
  readonly light: LightReq = { x: 0, y: 0, z: 0, color: 0xffaa55, intensity: 0 };
  /** Camera basis in world space (set by the director every frame): lets effects orient sprites along a screen direction. */
  readonly right = new THREE.Vector3(1, 0, 0);
  readonly up = new THREE.Vector3(0, 1, 0);

  constructor(readonly add: ParticleLayer, readonly alp: ParticleLayer, readonly mesh: MeshFx) { this.em = new Emitters(add, alp); }

  /** Particle count scaled by quality and by distance from the camera focus (never below 1 for a positive count). */
  n(count: number, x?: number, z?: number): number {
    let k = this.q;
    if (x !== undefined && z !== undefined) {
      const d = Math.hypot(x - this.focus.x, z - this.focus.z), r = this.focus.r;
      if (d > r * 1.3) k *= .3; else if (d > r * .95) k *= .6;
    }
    return count > 0 ? Math.max(1, Math.round(count * k)) : 0;
  }
  /** Is this world point inside (or just outside) the visible area? */
  vis(x: number, z: number, pad = 1.2): boolean { return Math.hypot(x - this.focus.x, z - this.focus.z) < this.focus.r * pad; }
  /** Asks for a flash of scene light; only the brightest request of a frame wins. */
  lightAt(x: number, y: number, z: number, color: number, intensity: number): void {
    const L = this.light;
    if (intensity < L.intensity * .7) return;
    L.x = x; L.y = y; L.z = z; L.color = color; L.intensity = Math.max(L.intensity, intensity);
  }
  /** Rotation (radians) that makes a streak sprite lie along the world direction (vx, vy, vz) as seen from the camera. */
  screenAngle(vx: number, vy: number, vz: number): number {
    const sx = vx * this.right.x + vy * this.right.y + vz * this.right.z, sy = vx * this.up.x + vy * this.up.y + vz * this.up.z;
    return Math.atan2(-sy, sx);
  }
  reset(): void { this.tl.clear(); this.add.clear(); this.alp.clear(); this.mesh.clear(); this.light.intensity = 0; }
}
