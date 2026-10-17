import * as THREE from 'three';
import { app } from '../game/state';
import { K, W } from '../game/config';
import { RC, cm, pl0 } from './scene';
import { followSun } from './lighting';
import { V3 } from './scratch';
import { groundY } from './ground';
import { terrainY } from './env/height';
import { CamRig, impactAttenuation } from './camrig';
import type { CamSink } from './fx/kit';

/** Pointer state shared with input.ts: position, whether it is inside the window, whether the middle button is rotating the view, and whether the last battlefield pointer was a touch (edge scroll stays off for touch, or the camera would crawl away from the last tap). */
export const MS = { x: 0, y: 0, in: 0, drag: 0, touch: 0 };

/** The MOBA camera: an isometric view that glides (see camrig.ts for the maths). `app.cam` stays the public state the simulation reads. */
export const rig = new CamRig(W, K);
try { if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) rig.motion = .25; } catch { /* no media queries */ }

/** Picking camera: the same pose as `cm` without shake or punch, so the point under the mouse never wobbles. */
const aim = new THREE.PerspectiveCamera();
const ndc = new THREE.Vector2();

/** Share of an impact at world point (x, z) that reaches the picture (see `impactAttenuation`). */
const attenuation = (x: number, z: number): number => impactAttenuation(Math.hypot(x - rig.fx * K, z - rig.fy * K), rig.visible);

/** What the effects ask of the camera (the VFX kit calls this; tests replace it with a recorder). */
export const camSink: CamSink = {
  shake(amount, x, z, jitter = .5) { const a = amount * attenuation(x, z); if (a > .004) rig.addShake(a, jitter); },
  kick(amount, x, z) { const a = amount * attenuation(x, z); if (a > .004) rig.addKick(a, rig.fx * K - x, rig.fy * K - z); },
  focus(x, z) { rig.finale(x / K, z / K); },
};

// ---- inputs (input.ts) ----
/** Mouse wheel (`deltaY` in pixels): smooth multiplicative zoom between 25 and 110. */
export const camZoom = (deltaY: number): void => rig.zoomBy(deltaY);
/** Middle-button drag by `dx` pixels: smooth rotation. */
export const camRotate = (dx: number): void => rig.rotateBy(-dx * .006);
/** `[` / `]`: a quarter-turn step to the next of the eight isometric directions. */
export const camRotateStep = (dir: number): void => rig.rotateStep(dir);
/** Home: back to the classic isometric angle. */
export const camHome = (): void => rig.resetYaw();
/** Space: drop the edge-scroll offset; the camera glides back to the hero. */
export const camRecenter = (): void => { app.cam.o.x = app.cam.o.y = 0; };
/** A new match or leaving one: no shake, punch or finale left over. */
export const camReset = (): void => rig.reset();

/** Runs every frame of a match: edge scrolling, the rig, then the pose of the real camera, the picking camera, the sun and the minimap view. */
export function camUpd(dt: number): void {
  const m = app.me, c = app.cam;
  if (MS.in && !MS.drag && !MS.touch && dt) {
    const e = 36, ax = (MS.x > innerWidth - e ? 1 : 0) - (MS.x < e ? 1 : 0), ay = (MS.y > innerHeight - e ? 1 : 0) - (MS.y < e ? 1 : 0);
    c.o.x += (ax * Math.cos(c.cy) + ay * Math.sin(c.cy)) * 900 * dt;
    c.o.y += (-ax * Math.sin(c.cy) + ay * Math.cos(c.cy)) * 900 * dt;
    const d = Math.hypot(c.o.x, c.o.y);
    if (d > 800) { c.o.x *= 800 / d; c.o.y *= 800 / d; }
  }
  rig.sync(c);
  const P = rig.update(dt, m.x + c.o.x, m.y + c.o.y, c.cp, groundY, terrainY);
  rig.publish(c);
  cm.position.set(P.px, P.py, P.pz); cm.lookAt(P.lx, P.ly, P.lz);
  if (P.roll) cm.rotateZ(P.roll);
  aim.position.set(P.ax, P.ay, P.az); aim.lookAt(P.alx, P.aly, P.alz);
  aim.projectionMatrix.copy(cm.projectionMatrix); aim.projectionMatrixInverse.copy(cm.projectionMatrixInverse); aim.updateMatrixWorld();
  followSun(P.alx, P.aly, P.alz, rig.visible); pl0.constant = -P.aly;
  const w = app.view, hw = c.cd * 1.1 / K * Math.max(1, cm.aspect * .55), hh = c.cd * .8 / K;
  w.x = c.k.x - hw; w.y = c.k.y - hh; w.width = hw * 2; w.height = hh * 2;
}

/** The ground point (logic units) under a screen position. Picks with the un-shaken camera and corrects once for the ground height under the first hit. */
export function wpt(e: { clientX: number; clientY: number }): { x: number; y: number } {
  ndc.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  RC.setFromCamera(ndc, aim);
  let p = RC.ray.intersectPlane(pl0, V3);
  if (!p) return { x: app.cam.k.x, y: app.cam.k.y };
  const g = groundY(p.x / K, p.z / K);
  if (Math.abs(g + pl0.constant) > .05) {
    const c0 = pl0.constant; pl0.constant = -g;
    p = RC.ray.intersectPlane(pl0, V3) || p;
    pl0.constant = c0;
  }
  return { x: p.x / K, y: p.z / K };
}
