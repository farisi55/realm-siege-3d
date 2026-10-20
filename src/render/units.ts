import { slug } from '../assets/AssetManager';
import { HR, K, TCOL } from '../game/config';
import { mkBar, mkCore, mkSiege, mkTower } from './models';
import { CharacterVisual } from './character';
import { heroModelSource } from './characterPack';
import { modelHeight } from './heroes';
import type { SelectMode } from './selection';
import { cm, sn } from './scene';
import { FP, FT, fxRespawn, fxStructure, newStructAcc } from './vfx';
import { app } from '../game/state';
import type { Unit } from '../game/types';
import { clamp, wrapA } from '../game/util';
import { groundY } from './ground';
import * as THREE from 'three';

/** Render object per simulation unit. Characters have `cv` (CharacterVisual); structures have `ud`; siege engines neither. */
export const R = new Map<Unit, any>();

/** Which model, height and health-bar layout a character unit uses. */
function characterOf(u: Unit): { key: string; height: number; color: number; by: number; bw: number } {
  const tc = TCOL[u.team];
  if (u.k === 'hero') { const key = slug(u.def.n); return { key, height: modelHeight(key), color: u.def.c, by: 3.2, bw: 2.4 }; }
  if (u.k === 'melee') return { key: 'melee-creep', height: modelHeight('melee-creep'), color: tc, by: 2.4, bw: 1.6 };
  if (u.k === 'ranged') return { key: 'ranged-creep', height: modelHeight('ranged-creep'), color: tc, by: 2.4, bw: 1.6 };
  return u.boss ? { key: 'boss', height: modelHeight('boss'), color: 0xb28cff, by: 7.2, bw: 5 } : { key: 'neutral', height: modelHeight('neutral'), color: 0xb28cff, by: 2.4, bw: 1.6 };
}

export function mkR(u: Unit): any {
  const k = u.k, tc = TCOL[u.team], r: any = { g: new THREE.Group(), f: new THREE.Group(), px: u.x, py: u.y, v: 0, ry: 0 };
  let by = 2.5, bw = 1.7;
  r.g.add(r.f);
  if (k === 'hero' || k === 'melee' || k === 'ranged' || k === 'neutral') {
    const c = characterOf(u);
    r.cv = new CharacterVisual({
      key: c.key, height: c.height, color: c.color, team: u.team, radius: u.r * K, hero: k === 'hero',
      glb: k === 'hero' ? heroModelSource(c.key, c.height) : undefined,
    });
    r.g.add(r.cv.root); // weapon trails are world-space ribbons drawn by the shared trail pool
    by = c.by; bw = c.bw;
  } else if (k === 'siege') {
    r.f.add(mkSiege(tc)); by = 2.2;
  } else {
    const t = k === 'tower' ? mkTower(tc) : mkCore(tc);
    r.f.add(t); r.ud = t.userData; r.sa = newStructAcc();
    by = k === 'tower' ? 6.6 : 6.4; bw = k === 'tower' ? 3.4 : 6;
  }
  r.bar = mkBar(u, bw, by); r.g.add(r.bar); sn.add(r.g);
  return r;
}

export const kill = (r: any): void => { sn.remove(r.g); if (r.cv) r.cv.dispose(); };
export const clearR = (): void => {
  for (const r of R.values()) kill(r);
  R.clear();
  FT.forEach(f => { f.e.style.display = 'none'; FP.push(f.e); });
  FT.length = 0;
};

/** Towers and cores: spinning, bobbing crystal, pulsing halo, shaking and flickering when badly damaged; smoke, fire and arcs come from the VFX system. */
export function struct(u: Unit, r: any, dt: number): void {
  const d = r.ud, lo = u.hp < u.max * .3;
  d.cr.rotation.y += dt * (u.k === 'core' ? .8 : 1.5) * (lo ? 3 : 1);
  if (d.y0 === undefined) d.y0 = d.cr.position.y;
  d.cr.position.y = d.y0 + Math.sin(app.fr * .035 + u.x) * .1;
  if (d.rg) { d.rg.rotation.y += dt * .6; d.rg.rotation.z = Math.sin(app.fr * .012) * .1; }
  if (d.gl) d.gl.scale.setScalar(d.glow * (1 + Math.sin(app.fr * .08 + u.y) * .08) * (lo && Math.random() < .4 ? .55 : 1));
  r.f.position.x = lo ? (Math.random() - .5) * .15 : 0;
  fxStructure(u, r.sa, dt);
}

/** The player's own hero gets the 'player' ring; the enemy the player is attacking gets the 'target' ring. */
function selectionOf(u: Unit): SelectMode {
  const me = app.me;
  if (!me) return 'none';
  if (u === me) return 'player';
  return me.tgt === u && !u.dead && u.team !== me.team ? 'target' : 'none';
}

const VIEW = new THREE.Frustum(), VIEW_M = new THREE.Matrix4(), BALL = new THREE.Sphere();
/** Characters outside the camera's view are not drawn at all (their skinned meshes have frustum culling off, because the bounds of the bind pose do not follow the animation, and every character costs two draws plus a shadow draw). */
function seeView(): void { cm.updateMatrixWorld(); VIEW_M.multiplyMatrices(cm.projectionMatrix, cm.matrixWorldInverse); VIEW.setFromProjectionMatrix(VIEW_M); }

/** Mirrors the simulation into Three.js objects: positions, character visuals, structures and health / mana bars. */
export function sync(dt: number): void {
  app.fr++;
  seeView();
  const over = app.G.over, win = app.G.win;
  for (const u of app.all) {
    let r = R.get(u);
    if (!r) R.set(u, r = mkR(u));
    r.s = app.fr;
    const nr = Math.abs(u.x - app.cam.k.x) < 1900 && Math.abs(u.y - app.cam.k.y) < 1900, dead = u.dead, gy = groundY(u.x, u.y);
    r.g.position.set(u.x * K, gy, u.y * K);
    if (dt > 0) { r.v += (Math.hypot(u.x - r.px, u.y - r.py) / dt - r.v) * .35; r.px = u.x; r.py = u.y; }
    if (r.cv) {
      if (r.wd && !dead) fxRespawn(u); // hero respawned: the simulation emits nothing for it
      r.wd = dead;
      r.cv.update(u, dt, { active: nr || dead, selected: selectionOf(u), over, win }, u.x * K, gy, u.y * K);
      r.cv.root.visible = VIEW.intersectsSphere(BALL.set(r.g.position, r.cv.height * .8 + 2.5));
    } else if (u.k === 'siege') {
      if (u.fa !== undefined && !dead) { r.ry += wrapA(Math.PI / 2 - u.fa - r.ry) * Math.min(1, dt * 10); r.f.rotation.y = r.ry; }
      r.g.position.y += Math.abs(Math.sin(app.fr * .2)) * .06 * Math.min(1, r.v / 50);
    } else if (r.ud) struct(u, r, dt);
    const b = r.bar, d = b.userData, hp = clamp(u.hp / u.max, 0, 1);
    b.visible = !dead && nr;
    if (b.visible) {
      d.fg.scale.x = d.w * hp; d.fg.position.x = -d.w * (1 - hp) / 2;
      if (d.mb) { const mp = clamp(u.mp / u.mmax, 0, 1); d.mb.scale.x = d.w * mp; d.mb.position.x = -d.w * (1 - mp) / 2; }
      b.quaternion.copy(cm.quaternion);
    }
  }
  // Units that left the simulation (dead creeps, destroyed structures) keep a render object for a moment: death animation / explosion.
  for (const [u, r] of R) {
    if (r.s === app.fr) continue;
    r.rm = (r.rm || 0) + dt;
    if (!r.gn) { r.gn = 1; r.bar.visible = false; } // the explosion itself is played by the VFX director when the simulation reports the death
    if (r.cv) {
      r.cv.update(u, dt, { active: true, selected: 'none', over, win }, u.x * K, groundY(u.x, u.y), u.y * K);
      if (r.rm > 1.2) r.cv.root.scale.setScalar(Math.max(.01, (1.6 - r.rm) / .4)); // the body dissolves just before it is removed
    } else {
      r.f.scale.y = Math.max(.05, r.f.scale.y * (1 - dt * 1.6)); r.g.position.y -= dt * .8; r.f.rotation.z += dt * .2;
    }
    if (r.rm > 1.6) { kill(r); R.delete(u); }
  }
}
