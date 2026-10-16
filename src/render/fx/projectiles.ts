import type { Kit } from './kit';
import type { BoltSlot, FlashSlot } from './mesh';
import { SPR } from './atlas';
import { COLORS, lighten } from './style';
import type { Palette } from './style';
import { TAU, rnd } from './recipes';

/** The looks of a projectile: the four hero spells (the only ones with `mg`) and the basic attacks of everything that shoots. */
export type ProjStyle = 'arcane' | 'poison' | 'fire' | 'storm' | 'orb' | 'tower' | 'core' | 'siege';

export interface ProjVis {
  style: ProjStyle; color: number; pal: Palette; hero?: string;
  /** Last head position (world). */ x: number; y: number; z: number;
  init: boolean; seen: number; age: number;
  /** Fractional emission counts per emitter. */ acc: number[];
  glow: FlashSlot | null; glowId: number;
  bolts: (BoltSlot | null)[]; boltIds: number[];
  /** Start distance (homing shots) and the heights of source and target, to arc the head between them. */ d0: number; h0: number; h1: number;
}

/** Source height of a shot, by the kind of unit firing it, and the height it aims at. */
const SRC_H: Record<string, number> = { hero: 1.5, ranged: 1.25, siege: 1.4, tower: 5.4, core: 4.4, neutral: 1.4, melee: 1.3 };
const DST_H: Record<string, number> = { hero: 1.3, ranged: 1, melee: 1, siege: 1, neutral: 1.1, tower: 3, core: 2.6 };

const BOLTS: Record<string, ProjStyle> = { 'Arcane Knight': 'arcane', 'Shadow Huntress': 'poison', 'Ember Mage': 'fire', 'Storm Warrior': 'storm' };

/** Which look a simulation projectile gets (the shooter `p.s` decides; a hero's `mg` bolt is its ability). */
export function projStyleOf(p: any): ProjStyle {
  const s = p.s;
  if (p.mg && s?.def) return BOLTS[s.def.n] ?? 'arcane';
  if (s?.k === 'tower') return 'tower';
  if (s?.k === 'core') return 'core';
  if (s?.k === 'siege') return 'siege';
  return 'orb';
}

export function newVis(p: any, pal: Palette): ProjVis {
  const s = p.s, t = p.t;
  return {
    style: projStyleOf(p), color: p.col, pal, hero: p.mg ? s?.def?.n : undefined,
    x: 0, y: 0, z: 0, init: false, seen: 0, age: 0, acc: [0, 0, 0, 0], glow: null, glowId: 0, bolts: [null, null], boltIds: [0, 0],
    d0: 0, h0: p.mg ? 1.5 : SRC_H[s?.k] ?? 1.4, h1: p.mg || !t ? 1.5 : DST_H[t.k] ?? 1.1,
  };
}

const emit = (v: ProjVis, i: number, perSec: number, dt: number, k: Kit): number => { v.acc[i] += perSec * dt * k.q; const n = Math.floor(v.acc[i]); v.acc[i] -= n; return n; };

function holdGlow(k: Kit, v: ProjVis, x: number, y: number, z: number, size: number, color: number, alpha: number): void {
  let g = v.glow;
  if (!g || !g.on || g.id !== v.glowId) { g = k.mesh.flash({ x, y, z, s0: size, s1: size, color, life: .12, alpha }); v.glow = g; v.glowId = g ? g.id : 0; if (!g) return; }
  g.age = 0; g.obj.position.set(x, y, z);
}
function holdBolt(k: Kit, v: ProjVis, i: number, a: [number, number, number], b: [number, number, number], color: number, width: number, jitter: number): void {
  let s = v.bolts[i];
  if (!s || !s.on || s.id !== v.boltIds[i]) { s = k.mesh.bolt({ ax: a[0], ay: a[1], az: a[2], bx: b[0], by: b[1], bz: b[2], color, life: .2, width, jitter, rate: 70 }); v.bolts[i] = s; v.boltIds[i] = s ? s.id : 0; if (!s) return; }
  s.age = 0; s.a.set(a[0], a[1], a[2]); s.b.set(b[0], b[1], b[2]);
}

/** One frame of a projectile: head glow, trail and, for the muzzle on the first frame, a flash. (x, y, z) is the head in world units, (dx, dz) its unit direction. */
export function stepProj(k: Kit, v: ProjVis, x: number, y: number, z: number, dx: number, dz: number, dt: number): void {
  const em = k.em, first = !v.init, px = first ? x : v.x, py = first ? y : v.y, pz = first ? z : v.z, pal = v.pal, col = v.color;
  v.age += dt;
  if (first) { v.init = true; muzzleFlash(k, v, x, y, z, dx, dz); }
  const head = Math.max(.025, dt * 1.6);
  const at = (): [number, number, number] => { const t = Math.random(); return [px + (x - px) * t, py + (y - py) * t, pz + (z - pz) * t]; };
  switch (v.style) {
    case 'arcane': {
      holdGlow(k, v, x, y, z, 2.6, pal.main, .55);
      em.mote(x, y, z, 0, 0, 0, pal.hot, head, 1.5, pal.main); em.flash(x, y, z, .9, 0xffffff, head);
      for (let i = emit(v, 0, 70, dt, k); i > 0; i--) { const [a, b, c] = at(); em.mote(a + rnd(-.18, .18), b + rnd(-.18, .18), c + rnd(-.18, .18), -dx * 1.4, rnd(-.3, .6), -dz * 1.4, i % 3 ? pal.main : pal.hot, rnd(.25, .42), rnd(.4, .62), pal.dark); }
      for (let i = emit(v, 1, 14, dt, k); i > 0; i--) { const [a, b, c] = at(); em.glyph(SPR.ring, a, b, c, 0, 0, 0, pal.hot, .3, 1.15, 0, true, 0); }
      for (let i = emit(v, 2, 18, dt, k); i > 0; i--) { const [a, b, c] = at(), r = rnd(.2, .55), ang = rnd(0, TAU); em.glyph(SPR.sparkle, a + Math.cos(ang) * r, b + Math.sin(ang) * r * .6, c + Math.sin(ang) * r, 0, 0, 0, pal.hot, rnd(.2, .35), rnd(.35, .6), 2); }
      break;
    }
    case 'poison': {
      holdGlow(k, v, x, y, z, 2.2, pal.main, .5);
      const rot = k.screenAngle(dx, 0, dz);
      em.oriented(SPR.streak, x, y, z, 0, 0, 0, pal.hot, head, 2.8, rot, true, pal.main);
      em.mote(x, y, z, 0, 0, 0, pal.main, head, 1.1, pal.dark);
      for (let i = emit(v, 0, 34, dt, k); i > 0; i--) { const [a, b, c] = at(); em.oriented(SPR.streak, a, b, c, -dx * 2, 0, -dz * 2, i % 2 ? pal.main : COLORS.poison, rnd(.18, .3), rnd(1.1, 1.8), rot, true, pal.dark); }
      for (let i = emit(v, 1, 30, dt, k); i > 0; i--) { const [a, b, c] = at(); em.ember(a + rnd(-.15, .15), b, c + rnd(-.15, .15), -dx * .8 + rnd(-.4, .4), rnd(-.2, .6), -dz * .8 + rnd(-.4, .4), COLORS.poison, rnd(.4, .7), rnd(.18, .3), -9); }
      for (let i = emit(v, 2, 12, dt, k); i > 0; i--) { const [a, b, c] = at(); em.smoke(a, b, c, rnd(-.3, .3), rnd(.2, .6), rnd(-.3, .3), rnd(.7, 1.1), .5, 1.5, 0x3a7a3a, .3, .3); }
      for (let i = emit(v, 3, 7, dt, k); i > 0; i--) { const [a, b, c] = at(); em.glyph(SPR.bubble, a, b, c, rnd(-.3, .3), rnd(.5, 1.2), rnd(-.3, .3), COLORS.poison, rnd(.4, .7), rnd(.3, .5), 1, true, 0); }
      break;
    }
    case 'fire': {
      holdGlow(k, v, x, y, z, 3, COLORS.fire, .6);
      em.fire(x, y, z, 0, 0, 0, head * 2, 1.5, COLORS.fireHot, COLORS.fire); em.flash(x, y, z, 1.1, COLORS.fireHot, head);
      for (let i = emit(v, 0, 55, dt, k); i > 0; i--) { const [a, b, c] = at(); em.fire(a + rnd(-.15, .15), b + rnd(-.1, .2), c + rnd(-.15, .15), -dx * 1.4 + rnd(-.4, .4), rnd(.2, 1), -dz * 1.4 + rnd(-.4, .4), rnd(.25, .45), rnd(.8, 1.3)); }
      for (let i = emit(v, 1, 40, dt, k); i > 0; i--) { const [a, b, c] = at(); em.ember(a, b, c, rnd(-.8, .8) - dx, rnd(.2, 1.8), rnd(-.8, .8) - dz, COLORS.ember, rnd(.4, .9), rnd(.16, .26), 2); }
      for (let i = emit(v, 2, 16, dt, k); i > 0; i--) { const [a, b, c] = at(); em.smoke(a, b, c, rnd(-.3, .3), rnd(.3, .9), rnd(-.3, .3), rnd(.8, 1.3), .7, 1.9, COLORS.smoke, .32, .5); }
      for (let i = emit(v, 3, 22, dt, k); i > 0; i--) { const [a, b, c] = at(); em.spark(a, b, c, rnd(-1.5, 1.5) - dx * 2, rnd(.4, 2.4), rnd(-1.5, 1.5) - dz * 2, COLORS.fireHot, rnd(.2, .4), .24); }
      break;
    }
    case 'storm': {
      holdGlow(k, v, x, y, z, 2.6, pal.main, .55);
      em.flash(x, y, z, 1.5, 0xffffff, head); em.mote(x, y, z, 0, 0, 0, pal.main, head, 1.3, pal.main);
      const tx = x - dx * 3, tz = z - dz * 3;
      holdBolt(k, v, 0, [x, y, z], [tx, y - .1, tz], pal.main, .14, .45);
      holdBolt(k, v, 1, [x, y, z], [x - dx * 2, y + .05, z - dz * 2], COLORS.electric, .09, .5);
      for (let i = emit(v, 0, 50, dt, k); i > 0; i--) { const [a, b, c] = at(); em.spark(a, b, c, rnd(-2.4, 2.4) - dx * 2, rnd(-1, 2.4), rnd(-2.4, 2.4) - dz * 2, i % 3 ? pal.main : 0xffffff, rnd(.15, .32), .26); }
      break;
    }
    case 'tower': {
      em.mote(x, y, z, 0, 0, 0, col, head, 1.7, lighten(col, .3)); em.flash(x, y, z, 1, 0xffffff, head);
      for (let i = emit(v, 0, 60, dt, k); i > 0; i--) { const [a, b, c] = at(); em.mote(a + rnd(-.12, .12), b + rnd(-.12, .12), c + rnd(-.12, .12), -dx, rnd(-.2, .4), -dz, i % 3 ? col : lighten(col, .6), rnd(.25, .4), rnd(.45, .7), col); }
      for (let i = emit(v, 1, 24, dt, k); i > 0; i--) { const [a, b, c] = at(); em.spark(a, b, c, rnd(-1.4, 1.4), rnd(-.4, 1.8), rnd(-1.4, 1.4), lighten(col, .5), rnd(.2, .35), .26); }
      break;
    }
    case 'core': {
      holdGlow(k, v, x, y, z, 3.4, col, .5);
      em.mote(x, y, z, 0, 0, 0, col, head, 2.4, lighten(col, .3)); em.flash(x, y, z, 1.5, 0xffffff, head);
      for (let i = emit(v, 0, 70, dt, k); i > 0; i--) { const [a, b, c] = at(); em.mote(a + rnd(-.2, .2), b + rnd(-.2, .2), c + rnd(-.2, .2), -dx, rnd(-.2, .4), -dz, i % 3 ? col : lighten(col, .6), rnd(.3, .5), rnd(.6, 1), col); }
      for (let i = emit(v, 1, 30, dt, k); i > 0; i--) { const [a, b, c] = at(); em.spark(a, b, c, rnd(-1.8, 1.8), rnd(-.4, 2), rnd(-1.8, 1.8), lighten(col, .5), rnd(.2, .4), .3); }
      break;
    }
    case 'siege': {
      em.smoke(x, y, z, 0, 0, 0, head * 1.4, .9, 1, 0x2a2a30, .9, 0);
      for (let i = emit(v, 0, 26, dt, k); i > 0; i--) { const [a, b, c] = at(); em.smoke(a, b, c, rnd(-.3, .3), rnd(.1, .6), rnd(-.3, .3), rnd(.6, 1), .5, 1.6, 0x4a4a54, .4, .2); }
      for (let i = emit(v, 1, 20, dt, k); i > 0; i--) { const [a, b, c] = at(); em.spark(a, b, c, rnd(-1, 1) - dx, rnd(0, 1.6), rnd(-1, 1) - dz, COLORS.ember, rnd(.2, .4), .24); }
      break;
    }
    default: { // orb: ranged creeps and heroes' basic attacks
      em.mote(x, y, z, 0, 0, 0, lighten(col, .4), head, .9, col);
      for (let i = emit(v, 0, 34, dt, k); i > 0; i--) { const [a, b, c] = at(); em.mote(a, b, c, -dx * .6 + rnd(-.2, .2), rnd(-.1, .4), -dz * .6 + rnd(-.2, .2), col, rnd(.15, .26), rnd(.25, .4), col); }
    }
  }
  v.x = x; v.y = y; v.z = z;
}

/** A little flash and spray where a shot leaves its source. */
function muzzleFlash(k: Kit, v: ProjVis, x: number, y: number, z: number, dx: number, dz: number): void {
  const em = k.em, col = v.color;
  if (v.style === 'tower' || v.style === 'core') {
    const big = v.style === 'core';
    k.mesh.flash({ x, y, z, s0: big ? 2 : 1.4, s1: big ? 5 : 3.4, color: col, life: .18, alpha: .85 });
    for (let i = 0; i < k.n(big ? 10 : 6, x, z); i++) { const a = Math.random() * TAU, s = rnd(2, 5); em.spark(x, y, z, Math.cos(a) * s, rnd(0, 3), Math.sin(a) * s, lighten(col, .5), rnd(.2, .4), .28); }
  } else if (v.style === 'siege') {
    for (let i = 0; i < k.n(5, x, z); i++) em.smoke(x + dx * .5, y, z + dz * .5, dx * rnd(.5, 2) + rnd(-.5, .5), rnd(.2, 1), dz * rnd(.5, 2) + rnd(-.5, .5), rnd(.6, 1), .6, 1.8, 0x5a5a64, .5, .3);
    em.flash(x, y, z, 1.6, COLORS.ember, .1);
  } else if (v.style === 'orb') em.flash(x, y, z, .9, lighten(col, .4), .08);
}

/** The projectile left the simulation. A bolt that hit has its own impact (the `fx` hook); one that ran out of range just fizzles. */
export function endProj(k: Kit, v: ProjVis, hit: boolean): void {
  for (let i = 0; i < v.bolts.length; i++) { const b = v.bolts[i]; if (b && b.on && b.id === v.boltIds[i]) b.life = Math.min(b.life, b.age + .05); }
  if (!v.init || hit) return;
  if (v.style === 'arcane' || v.style === 'poison' || v.style === 'fire' || v.style === 'storm') {
    const em = k.em, { x, y, z } = v;
    k.mesh.flash({ x, y, z, s0: 1.4, s1: 2.8, color: v.pal.main, life: .2, alpha: .6 });
    for (let i = 0; i < k.n(7, x, z); i++) { const a = Math.random() * TAU, s = rnd(1, 3.4); em.mote(x, y, z, Math.cos(a) * s, rnd(0, 2), Math.sin(a) * s, i % 2 ? v.pal.hot : v.pal.main, rnd(.3, .6), rnd(.3, .5), v.pal.dark); }
  }
}
