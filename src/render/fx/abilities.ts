import type { AbilityType } from '../../game/types';
import type { Kit } from './kit';
import { DECAL } from './mesh';
import { SPR } from './atlas';
import { COLORS, darken, lighten } from './style';
import type { Palette } from './style';
import { TAU, explosion, frontAt, lightColumn, lightningStrike, ranIn, rnd, shockwave } from './recipes';

/**
 * What one cast of one ability looks like. The simulation resolves an ability 0.25 s after it starts; the director calls `wind` at the
 * start (telegraph, charge-up) and `resolve` at the moment the simulation applies it, with the exact blast centre.
 * All coordinates are world units (y up).
 */
export interface CastCtx {
  type: AbilityType; idx: number; name: string; pal: Palette; team: number;
  /** Caster position and ground height. */ x: number; y: number; z: number;
  /** Blast / landing centre (tgt, dash, aoe) or the aimed point (bolt): exact in `resolve`, predicted in `wind`. */ tx: number; ty: number; tz: number;
  /** Unit direction caster -> aim on the ground plane. */ dx: number; dz: number;
  /** Radius in world units (aoe, tgt, heal; dash: the landing blast). */ R: number;
  /** Range in world units (bolt, dash). */ range: number;
  /** Stun seconds of the ability (0 when it has none). */ stun: number;
  /** The caster is the player's hero. */ mine: boolean;
  /** Where a dash started (resolve only). */ fx: number; fz: number;
}
export type CastFn = (k: Kit, c: CastCtx) => void;
export interface AbilityFx { wind?: CastFn; resolve: CastFn; }

const chest = 1.3;
const at = (c: CastCtx, d = 0, h = chest): [number, number, number] => [c.x + c.dx * d, c.y + h, c.z + c.dz * d];

/** Charge-up that every cast shares: a ring at the feet and motes converging on the chest. */
function charge(k: Kit, c: CastCtx, o: { n?: number; color?: number; hot?: number; rune?: boolean; size?: number } = {}): void {
  k.mesh.ring({ x: c.x, y: c.y + .15, z: c.z, r0: .5, r1: 2.4, color: o.color ?? c.pal.main, life: .3, width: .1, alpha: .85 });
  k.em.gather(c.x, c.y + chest, c.z, 2, k.n(o.n ?? 10, c.x, c.z), o.hot ?? c.pal.hot, .25, o.size ?? .36);
  if (o.rune) k.mesh.decal({ x: c.x, z: c.z, r: 2.7, style: DECAL.rune, color: o.color ?? c.pal.main, color2: o.hot ?? c.pal.hot, life: .55, fadeIn: .06, fadeOut: .25, alpha: .9 });
}

/** A ring of rock / thorn spikes bursting out of the ground. */
function spikeRing(k: Kit, x: number, z: number, R: number, n: number, o: { h: number; w: number; life: number; color: number; emissive?: number; emissiveI?: number; step?: number; tilt?: number; jitter?: number }): void {
  const a0 = Math.random() * TAU;
  for (let i = 0; i < n; i++) {
    const a = a0 + i / n * TAU + rnd(-.1, .1), r = R * (1 + rnd(-(o.jitter ?? .06), o.jitter ?? .06));
    k.mesh.spike({ x: x + Math.cos(a) * r, z: z + Math.sin(a) * r, h: o.h * rnd(.75, 1.2), w: o.w * rnd(.8, 1.2), life: o.life, color: o.color, emissive: o.emissive, emissiveI: o.emissiveI, delay: i * (o.step ?? .012), rise: .16, sink: .35, tilt: o.tilt ?? .35 });
  }
}

/** A glowing rock dropped from the sky; `land` runs on the timeline when it arrives. */
function meteor(k: Kit, x: number, y: number, z: number, fall: number, size: number, from: { dx: number; dz: number; h: number }, land: () => void): void {
  k.mesh.rock({
    fx: x + from.dx, fy: y + from.h, fz: z + from.dz, tx: x, ty: y + size * .4, tz: z, size, life: fall, color: 0x4a3a30, emissive: 0xff5a1a, emissiveI: 1.8, spin: 4,
    trail: (px, py, pz) => {
      k.em.fire(px, py, pz, rnd(-.4, .4), rnd(.5, 1.6), rnd(-.4, .4), rnd(.25, .5), size * rnd(1.2, 1.9));
      k.em.smoke(px, py, pz, rnd(-.3, .3), rnd(.2, .8), rnd(-.3, .3), rnd(.7, 1.2), size, size * 2.4, COLORS.smoke, .4, .3);
      k.em.spark(px, py, pz, rnd(-1.4, 1.4), rnd(.4, 2), rnd(-1.4, 1.4), COLORS.fireHot, rnd(.2, .4), .24);
    },
  });
  k.tl.at(fall, land);
}

/** Several short arcs radiating from a point (impact of lightning). */
function arcs(k: Kit, x: number, y: number, z: number, n: number, len: number, color: number, life = .18): void {
  for (let i = 0; i < n; i++) {
    const a = i / n * TAU + rnd(-.3, .3), l = len * rnd(.6, 1);
    k.mesh.bolt({ ax: x, ay: y, az: z, bx: x + Math.cos(a) * l, by: y + rnd(-.3, .8), bz: z + Math.sin(a) * l, color, life, width: .08, jitter: .35, rate: 34 });
  }
}

/** Rising leaves / petals around a point (nature spells). */
function leaves(k: Kit, x: number, y: number, z: number, n: number, spread: number, color: number, rise = 2.4, size = .55): void {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, d = Math.sqrt(Math.random()) * spread;
    k.em.glyph(SPR.leaf, x + Math.cos(a) * d, y + rnd(.1, 1), z + Math.sin(a) * d, rnd(-.6, .6), rise * rnd(.6, 1.3), rnd(-.6, .6), i % 3 ? color : lighten(color, .5), rnd(.9, 1.6), size * rnd(.7, 1.2), 4, false, 0);
  }
}

// ---------------------------------------------------------------------------------------------------------------- projectiles (bolts)

/** Bolt abilities fire when the cast resolves: the flash at the caster's hand. The projectile itself is drawn by projectiles.ts. */
const muzzle = (color: number, hot: number, kind: 'arc' | 'poison' | 'fire' | 'bolt'): CastFn => (k, c) => {
  const [x, y, z] = at(c, 1.1, 1.45), em = k.em;
  k.mesh.flash({ x, y, z, s0: 1, s1: 3.2, color, life: .16, alpha: .9 });
  em.flash(x, y, z, 1.8, hot, .1);
  const n = k.n(kind === 'fire' ? 12 : 9, x, z);
  for (let i = 0; i < n; i++) {
    const s = rnd(-.55, .55), v = rnd(4, 10), vx = c.dx * v - c.dz * s * v, vz = c.dz * v + c.dx * s * v;
    if (kind === 'fire') em.fire(x, y, z, vx * .5, rnd(0, 1.6), vz * .5, rnd(.25, .45), rnd(.6, 1), hot, color);
    else em.spark(x, y, z, vx, rnd(-.5, 2), vz, i % 2 ? hot : color, rnd(.18, .34), .28);
  }
  if (kind === 'poison') for (let i = 0; i < k.n(4, x, z); i++) em.mote(x, y, z, c.dx * rnd(1, 3) + rnd(-.5, .5), rnd(.2, 1.4), c.dz * rnd(1, 3) + rnd(-.5, .5), COLORS.poison, rnd(.4, .7), .5, COLORS.poisonDeep);
  if (kind === 'bolt') k.mesh.bolt({ ax: x, ay: y, az: z, bx: x + c.dx * 2.8, by: y + .1, bz: z + c.dz * 2.8, color, life: .12, width: .12, jitter: .3, rate: 40 });
  k.mesh.ring({ x: c.x, y: c.y + .15, z: c.z, r0: .6, r1: 2.2, color, life: .28, width: .1, alpha: .7 });
};

/** Where a bolt ends: one recipe per hero (the hero's bolt is the only projectile with `mg`). `x, y, z` is the impact point. */
export function boltImpact(k: Kit, hero: string | undefined, x: number, y: number, z: number, pal: Palette): void {
  const em = k.em;
  switch (hero) {
    case 'Shadow Huntress': { // poison splash
      k.mesh.decal({ x, z, r: 2.8, style: DECAL.poison, color: COLORS.poisonDeep, color2: COLORS.poison, life: 1.5, fadeIn: .08, fadeOut: .8, alpha: .8 });
      k.mesh.decal({ x, z, r: 2.2, style: DECAL.wave, color: pal.main, color2: pal.hot, life: .35, fadeOut: .2 });
      for (let i = 0; i < k.n(14, x, z); i++) { const a = Math.random() * TAU, v = rnd(1.5, 5); em.mote(x, y, z, Math.cos(a) * v, rnd(2, 6), Math.sin(a) * v, i % 2 ? COLORS.poison : pal.main, rnd(.5, .95), rnd(.3, .55), COLORS.poisonDeep); }
      for (let i = 0; i < k.n(5, x, z); i++) { const a = Math.random() * TAU, v = rnd(.5, 2); em.glyph(SPR.bubble, x, y, z, Math.cos(a) * v, rnd(1.5, 3.4), Math.sin(a) * v, COLORS.poison, rnd(.7, 1.2), rnd(.4, .7), 1, true, -.5); }
      for (let i = 0; i < k.n(3, x, z); i++) em.smoke(x + rnd(-.3, .3), y, z + rnd(-.3, .3), rnd(-.4, .4), rnd(.4, 1), rnd(-.4, .4), rnd(1, 1.6), .8, 2.4, 0x3a8a3a, .4, .4);
      em.flash(x, y, z, 2.6, COLORS.poison, .14);
      break;
    }
    case 'Ember Mage': { // fire burst + scorch
      explosion(k, x, y - .6, z, 1.5, { main: COLORS.fire, hot: COLORS.fireHot, dark: COLORS.fireDeep }, { smoke: 2, debris: 0, light: 1.8, dome: true });
      k.mesh.decal({ x, z, r: 2, style: DECAL.scorch, color: 0xff7a2a, life: 4, fadeIn: .1, fadeOut: 2.2, alpha: 1, add: false, order: 2 });
      break;
    }
    case 'Storm Warrior': { // electric burst
      arcs(k, x, y, z, 5, 2.6, COLORS.lightning);
      k.mesh.flash({ x, y, z, s0: 1.6, s1: 4, color: 0xffffff, life: .14, alpha: .95 });
      k.mesh.ring({ x, y: y - .8, z, r0: .4, r1: 2.6, color: COLORS.lightning, life: .3, width: .08, dash: 16, alpha: .9 });
      for (let i = 0; i < k.n(16, x, z); i++) { const a = Math.random() * TAU, v = rnd(3, 9); em.spark(x, y, z, Math.cos(a) * v, rnd(-1, 4), Math.sin(a) * v, i % 3 ? COLORS.lightning : 0xffffff, rnd(.2, .4), .3); }
      k.lightAt(x, y + 1, z, COLORS.lightning, 1.6);
      break;
    }
    default: { // arcane
      k.mesh.decal({ x, z, r: 2.6, style: DECAL.wave, color: pal.main, color2: pal.hot, life: .4, fadeOut: .22 });
      k.mesh.flash({ x, y, z, s0: 1.4, s1: 4, color: pal.hot, life: .16, alpha: .9 });
      em.glyph(SPR.ring, x, y, z, 0, 0, 0, pal.hot, .3, 1.2, 0, true, 0);
      for (let i = 0; i < k.n(16, x, z); i++) { const a = Math.random() * TAU, v = rnd(2, 7); em.spark(x, y, z, Math.cos(a) * v, rnd(0, 4), Math.sin(a) * v, i % 2 ? pal.hot : pal.main, rnd(.25, .5), .3); }
      k.lightAt(x, y + 1, z, pal.main, 1.2);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------- the 20 abilities

const GROUND_SLAM: AbilityFx = {
  wind: (k, c) => charge(k, c, { n: 16, rune: true, size: .42 }),
  resolve: (k, c) => {
    const { tx: x, ty: y, tz: z, R, pal } = c;
    shockwave(k, x, y, z, R, { color: pal.main, color2: pal.hot, life: .55, dust: 1.1, dustColor: 0x8a8296, sparks: 22 });
    k.mesh.decal({ x, z, r: R * .95, style: DECAL.cracks, color: pal.main, color2: 0xffffff, life: 1.4, fadeIn: .03, fadeOut: .8, alpha: .95 });
    k.mesh.flash({ x, y: y + 1.2, z, s0: 3, s1: 8, color: pal.hot, life: .24, alpha: .9 });
    spikeRing(k, x, z, R * .42, 9, { h: 1.7, w: .5, life: .9, color: 0x6a6a7a, emissive: pal.main, emissiveI: .5, step: .01 });
    spikeRing(k, x, z, R * .72, 13, { h: 2.2, w: .6, life: .9, color: 0x5e5e6e, emissive: pal.main, emissiveI: .5, step: .018 });
    k.em.debris(x, y + .3, z, k.n(16, x, z), 8, COLORS.rock, 1.4);
    k.em.dustRing(x, y, z, R * .25, k.n(10, x, z), 6, 0x8a8296, 1.6);
    k.lightAt(x, y + 2, z, pal.main, 2.4);
    k.cam.shake(.58, x, z, .2); k.cam.kick(.5, x, z);
  },
};

const METEOR_PRISON: AbilityFx = {
  wind: (k, c) => {
    charge(k, c, { n: 14, rune: true, color: COLORS.fire, hot: COLORS.fireHot });
    meteor(k, c.tx, c.ty, c.tz, .25, 1.5, { dx: -5, dz: -3.5, h: 24 }, () => {});
  },
  resolve: (k, c) => {
    const { tx: x, ty: y, tz: z, R } = c, pal = { main: COLORS.fire, hot: COLORS.fireHot, dark: COLORS.fireDeep };
    explosion(k, x, y, z, 3.6, pal, { smoke: 10, debris: 18, light: 4, rubble: 12 });
    shockwave(k, x, y, z, R, { color: 0xff8a3a, color2: 0xfff0c0, life: .7, dust: 1.1, sparks: 26 });
    k.mesh.decal({ x, z, r: R * .9, style: DECAL.cracks, color: 0xff6a1a, color2: 0xffe08a, life: Math.max(1.6, c.stun), fadeIn: .04, fadeOut: .9, alpha: .95 });
    k.mesh.decal({ x, z, r: R * .8, style: DECAL.scorch, color: 0xff7a2a, life: 8, fadeIn: .2, fadeOut: 4, alpha: 1, add: false, order: 2 });
    const hold = Math.max(.6, c.stun);
    spikeRing(k, x, z, R * .45, 10, { h: 4.2, w: .85, life: hold, color: 0x4a3a30, emissive: 0xff5a1a, emissiveI: .9, step: .014, tilt: .18 });
    spikeRing(k, x, z, R * .86, 15, { h: 3, w: .8, life: hold, color: 0x4a3a30, emissive: 0xff5a1a, emissiveI: .7, step: .02, tilt: .22 });
    lightColumn(k, x, y, z, 1.3, 12, 0xff8a3a, 0xffe08a, .8, .15, .7);
    k.cam.shake(.85, x, z, .3); k.cam.kick(.7, x, z);
  },
};

const SHIELD_WALL: AbilityFx = {
  wind: (k, c) => charge(k, c, { n: 12, rune: true, color: c.pal.accent, hot: 0xffffff }),
  resolve: (k, c) => {
    const { x, y, z, R, pal } = c;
    k.mesh.dome({ x, y: y + 1.3, z, r0: 1.4, r1: 3.8, color: pal.main, color2: pal.accent, life: 1.5, style: 0, alpha: .85, fadeIn: .08, fadeOut: .8 });
    k.mesh.decal({ x, z, r: R, style: DECAL.rune, color: pal.main, color2: pal.accent, life: 1.1, fadeIn: .1, fadeOut: .6, alpha: .8 });
    k.mesh.decal({ x, z, r: R, style: DECAL.wave, color: pal.accent, color2: 0xffffff, life: .65, fadeOut: .35, alpha: .75 });
    k.mesh.ring({ x, y: y + .3, z, r0: .8, r1: 3.4, color: pal.accent, life: .8, width: .07, rise: 2.6, alpha: .85 });
    for (let i = 0; i < k.n(22, x, z); i++) { const a = Math.random() * TAU, d = rnd(.8, 3.4); k.em.mote(x + Math.cos(a) * d, y + rnd(0, 1.2), z + Math.sin(a) * d, -Math.sin(a) * 1.4, rnd(1.4, 3.4), Math.cos(a) * 1.4, i % 2 ? pal.accent : pal.hot, rnd(.8, 1.4), rnd(.4, .7), pal.main); }
    k.em.flash(x, y + 1.3, z, 4, pal.hot, .16);
    k.lightAt(x, y + 2, z, pal.main, 1.6);
  },
};

const ARCANE: AbilityFx[] = [
  { wind: (k, c) => charge(k, c, { n: 8 }), resolve: muzzle(0x6aa8ff, 0xd6e8ff, 'arc') },
  SHIELD_WALL, GROUND_SLAM, METEOR_PRISON,
];

// -- Shadow Huntress
const SHADOW_DASH: AbilityFx = {
  wind: (k, c) => {
    k.mesh.ring({ x: c.x, y: c.y + .15, z: c.z, r0: 2.2, r1: .4, color: c.pal.main, life: .25, width: .1, alpha: .85 });
    for (let i = 0; i < k.n(6, c.x, c.z); i++) k.em.smoke(c.x + rnd(-.6, .6), c.y + rnd(.2, 1.6), c.z + rnd(-.6, .6), rnd(-.5, .5), rnd(.2, .8), rnd(-.5, .5), rnd(.5, .9), .6, 1.8, darken(c.pal.dark, .2), .5, .3);
    k.em.gather(c.x, c.y + chest, c.z, 1.6, k.n(8, c.x, c.z), c.pal.main, .22, .34);
  },
  resolve: (k, c) => {
    const { pal } = c, ex = c.tx - c.fx, ez = c.tz - c.fz, len = Math.hypot(ex, ez) || 1, nx = ex / len, nz = ez / len;
    for (let i = 0; i < k.n(10, c.fx, c.fz); i++) k.em.smoke(c.fx + rnd(-.5, .5), c.y + rnd(.2, 1.8), c.fz + rnd(-.5, .5), rnd(-1.2, 1.2), rnd(.2, 1.2), rnd(-1.2, 1.2), rnd(.7, 1.2), .9, 2.8, darken(pal.dark, .2), .55, .3);
    k.mesh.flash({ x: c.fx, y: c.y + 1.3, z: c.fz, s0: 2, s1: 4, color: pal.main, life: .18, alpha: .8 });
    const steps = Math.max(4, Math.min(18, Math.round(len * 1.1)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, px = c.fx + ex * t, pz = c.fz + ez * t, py = c.y + 1.2;
      k.em.smoke(px, py + rnd(-.3, .5), pz, rnd(-.3, .3), rnd(.1, .5), rnd(-.3, .3), rnd(.5, .9), .8, 2, darken(pal.dark, .1), .45, .2);
      if (i % 2 === 0) k.em.glyph(SPR.streak, px, py + rnd(-.5, .6), pz, -nx * 2, 0, -nz * 2, i % 4 ? pal.main : pal.hot, rnd(.25, .4), rnd(1.3, 2.2), 0, true, 0);
      if (i % 3 === 0) k.em.mote(px, py, pz, rnd(-.5, .5), rnd(.2, 1), rnd(-.5, .5), pal.main, rnd(.3, .6), .5, pal.dark);
    }
    const { tx: x, ty: y, tz: z } = c;
    k.mesh.decal({ x, z, r: c.R, style: DECAL.shadow, color: pal.dark, color2: pal.main, life: .8, fadeIn: .04, fadeOut: .5, alpha: .9 });
    shockwave(k, x, y, z, c.R, { color: pal.main, color2: pal.hot, life: .45, dust: .8, dustColor: 0x6a5a86, sparks: 14 });
    k.mesh.flash({ x, y: y + 1.2, z, s0: 2, s1: 5, color: pal.hot, life: .2, alpha: .9 });
    for (let i = 0; i < k.n(14, x, z); i++) { const a = Math.random() * TAU, v = rnd(2, 6); k.em.spark(x, y + .4, z, Math.cos(a) * v, rnd(1, 4), Math.sin(a) * v, i % 2 ? pal.hot : pal.main, rnd(.25, .5), .3); }
    k.lightAt(x, y + 1.5, z, pal.main, 1.5);
    k.cam.shake(.26, x, z, .3);
  },
};

const SMOKE_VEIL: AbilityFx = {
  wind: (k, c) => charge(k, c, { n: 10, color: c.pal.dark, hot: c.pal.main }),
  resolve: (k, c) => {
    const { x, y, z, pal } = c;
    for (let i = 0; i < k.n(18, x, z); i++) { const a = Math.random() * TAU, v = rnd(1, 4.2); k.em.smoke(x + Math.cos(a) * .4, y + rnd(.2, 1.8), z + Math.sin(a) * .4, Math.cos(a) * v, rnd(.2, 1.4), Math.sin(a) * v, rnd(1.2, 2), 1.2, rnd(3.4, 5), i % 3 ? darken(pal.dark, .1) : pal.dark, .6, .4); }
    k.mesh.decal({ x, z, r: 3.8, style: DECAL.shadow, color: pal.dark, color2: pal.main, life: 1.3, fadeIn: .1, fadeOut: .8, alpha: .85 });
    k.mesh.ring({ x, y: y + .3, z, r0: .6, r1: 4, color: pal.main, life: .6, width: .08, alpha: .8 });
    for (let i = 0; i < k.n(10, x, z); i++) { const a = Math.random() * TAU, d = rnd(.5, 2.4); k.em.glyph(SPR.sparkle, x + Math.cos(a) * d, y + rnd(.3, 2.2), z + Math.sin(a) * d, 0, rnd(.4, 1.4), 0, pal.hot, rnd(.5, .9), rnd(.4, .7), 1); }
    k.lightAt(x, y + 1.5, z, pal.main, .9);
  },
};

const DEATH_MARK: AbilityFx = {
  wind: (k, c) => charge(k, c, { n: 12, rune: true }),
  resolve: (k, c) => {
    const { tx: x, ty: y, tz: z, R, pal } = c;
    lightColumn(k, x, y, z, .95, 20, pal.main, 0xffffff, .55, .1, .9);
    k.mesh.decal({ x, z, r: R, style: DECAL.shadow, color: pal.dark, color2: pal.main, life: 1.1, fadeIn: .03, fadeOut: .7, alpha: 1 });
    k.mesh.decal({ x, z, r: R, style: DECAL.rune, color: pal.main, color2: 0xffffff, life: .9, fadeIn: .03, fadeOut: .5, alpha: .85 });
    shockwave(k, x, y, z, R * 1.35, { color: pal.main, color2: pal.hot, life: .5, dust: .8, dustColor: 0x6a5a86, sparks: 20 });
    spikeRing(k, x, z, R * .55, 9, { h: 3.4, w: .42, life: .75, color: 0x2a1a3a, emissive: pal.main, emissiveI: 1.1, step: .01, tilt: .12 });
    spikeRing(k, x, z, R * .2, 4, { h: 4.6, w: .5, life: .75, color: 0x2a1a3a, emissive: pal.hot, emissiveI: 1.2, step: .02, tilt: .08 });
    for (let i = 0; i < 3; i++) { const a = rnd(0, TAU); k.mesh.bolt({ ax: x + Math.cos(a) * 4.2, ay: y + 4, az: z + Math.sin(a) * 4.2, bx: x - Math.cos(a) * 4.2, by: y + .3, bz: z - Math.sin(a) * 4.2, color: pal.hot, life: .16, width: .14, jitter: .15, rate: 40 }); }
    k.mesh.flash({ x, y: y + 1.5, z, s0: 3, s1: 8, color: pal.hot, life: .22, alpha: .95 });
    for (let i = 0; i < k.n(30, x, z); i++) { const a = Math.random() * TAU, v = rnd(2, 9); k.em.spark(x, y + .5, z, Math.cos(a) * v, rnd(1, 7), Math.sin(a) * v, i % 3 ? pal.main : 0xffffff, rnd(.3, .7), .34); }
    for (let i = 0; i < k.n(10, x, z); i++) k.em.smoke(x + rnd(-1, 1), y + rnd(.3, 1.4), z + rnd(-1, 1), rnd(-1.2, 1.2), rnd(.6, 2), rnd(-1.2, 1.2), rnd(1.2, 1.9), 1.2, 3.6, pal.dark, .6, .5);
    k.lightAt(x, y + 2, z, pal.main, 2.6);
    k.cam.shake(.5, x, z, .5); k.cam.kick(.3, x, z);
  },
};

const SHADOW: AbilityFx[] = [
  SHADOW_DASH,
  { wind: (k, c) => charge(k, c, { n: 8 }), resolve: muzzle(0xb06bff, 0xeed4ff, 'poison') },
  SMOKE_VEIL, DEATH_MARK,
];

// -- Ember Mage
const FLAME_WAVE: AbilityFx = {
  wind: (k, c) => {
    charge(k, c, { n: 10, color: COLORS.fire, hot: COLORS.fireHot });
    for (let i = 0; i < k.n(8, c.x, c.z); i++) { const a = i / 8 * TAU; k.em.fire(c.x + Math.cos(a) * 1.4, c.y + .3, c.z + Math.sin(a) * 1.4, 0, rnd(1, 2.4), 0, rnd(.3, .5), rnd(.7, 1.1)); }
  },
  resolve: (k, c) => {
    const { x, y, z, R } = c, life = .7;
    shockwave(k, x, y, z, R, { color: COLORS.fire, color2: COLORS.fireHot, life, sparks: 30 });
    k.mesh.decal({ x, z, r: R * .92, style: DECAL.fire, color: COLORS.fire, color2: COLORS.fireHot, life: 1.5, fadeIn: .08, fadeOut: .9, alpha: .9 });
    k.mesh.decal({ x, z, r: R * .8, style: DECAL.scorch, color: 0xff7a2a, life: 6, fadeIn: .2, fadeOut: 3, alpha: .9, add: false, order: 2 });
    k.mesh.dome({ x, y: y + 1.2, z, r0: .8, r1: 3.6, color: COLORS.fire, color2: COLORS.fireHot, life: .5, style: 1, alpha: .9, fadeOut: .3 });
    for (let s = 1; s <= 5; s++) {
      const p = s / 5 * .92, rr = R * frontAt(p);
      k.tl.at(life * p, () => { const n = k.n(Math.ceil(5 + rr * 1.4), x, z); for (let i = 0; i < n; i++) { const a = i / n * TAU + rnd(-.2, .2); k.em.fire(x + Math.cos(a) * rr, y + .3, z + Math.sin(a) * rr, Math.cos(a) * 1.5, rnd(1.4, 3.4), Math.sin(a) * 1.5, rnd(.45, .8), rnd(1, 1.7)); } });
    }
    k.mesh.flash({ x, y: y + 1.2, z, s0: 3, s1: 7, color: COLORS.fireHot, life: .22, alpha: .9 });
    k.lightAt(x, y + 2, z, COLORS.fire, 2.4);
    k.cam.shake(.32, x, z, .2);
  },
};

const BURNING_ZONE: AbilityFx = {
  wind: (k, c) => charge(k, c, { n: 10, rune: true, color: COLORS.fire, hot: COLORS.fireHot }),
  resolve: (k, c) => {
    const { tx: x, ty: y, tz: z, R } = c, dur = 2.6;
    k.mesh.decal({ x, z, r: R * .92, style: DECAL.fire, color: COLORS.fire, color2: COLORS.fireHot, life: dur, fadeIn: .15, fadeOut: 1.1, alpha: .95 });
    k.mesh.decal({ x, z, r: R * .9, style: DECAL.scorch, color: 0xff7a2a, life: 8, fadeIn: .2, fadeOut: 4, alpha: 1, add: false, order: 2 });
    shockwave(k, x, y, z, R, { color: COLORS.fire, color2: COLORS.fireHot, life: .5, dust: .5, sparks: 18 });
    explosion(k, x, y, z, 2.2, { main: COLORS.fire, hot: COLORS.fireHot, dark: COLORS.fireDeep }, { smoke: 3, debris: 4, light: 2.2 });
    for (let i = 0; i < 24; i++) k.tl.at(.1 + i * .1, () => {
      for (let j = 0; j < 3; j++) { const [ox, oz] = ranIn(R * .85); k.em.fire(x + ox, y + .2, z + oz, rnd(-.2, .2), rnd(1.4, 3.2), rnd(-.2, .2), rnd(.5, .95), rnd(.9, 1.7)); }
      const [ex, ez] = ranIn(R * .85); k.em.ember(x + ex, y + .5, z + ez, rnd(-.5, .5), rnd(1.4, 3.4), rnd(-.5, .5), COLORS.ember, rnd(.9, 1.6), .22, 1.8);
      if (i % 3 === 0) { const [sx, sz] = ranIn(R * .7); k.em.smoke(x + sx, y + 1, z + sz, rnd(-.3, .3), rnd(1, 1.8), rnd(-.3, .3), rnd(1.4, 2.2), 1.1, 3, COLORS.smoke, .4, .8); }
    });
    k.cam.shake(.24, x, z, .2);
  },
};

const INFERNO_STORM: AbilityFx = {
  wind: (k, c) => {
    charge(k, c, { n: 14, rune: true, color: COLORS.fire, hot: COLORS.fireHot });
    meteor(k, c.tx, c.ty, c.tz, .25, 2.1, { dx: -6, dz: -4, h: 26 }, () => {});
    for (let i = 0; i < 3; i++) { const [ox, oz] = ranIn(c.R * .7); meteor(k, c.tx + ox, c.ty, c.tz + oz, .2 + i * .02, 1.2, { dx: -5, dz: -3.5, h: 20 }, () => explosion(k, c.tx + ox, c.ty, c.tz + oz, 1.4, { main: COLORS.fire, hot: COLORS.fireHot, dark: COLORS.fireDeep }, { smoke: 2, debris: 3, dome: false, light: 1.4 })); }
  },
  resolve: (k, c) => {
    const { tx: x, ty: y, tz: z, R } = c, pal = { main: COLORS.fire, hot: COLORS.fireHot, dark: COLORS.fireDeep };
    explosion(k, x, y, z, 5, pal, { smoke: 14, debris: 22, light: 4.5, rubble: 14, fire: 16, sparks: 30 });
    shockwave(k, x, y, z, R, { color: 0xff7a1a, color2: 0xfff0c0, life: .85, dust: 1.1, sparks: 36 });
    k.mesh.decal({ x, z, r: R * .9, style: DECAL.fire, color: COLORS.fire, color2: COLORS.fireHot, life: 2.8, fadeIn: .15, fadeOut: 1.4, alpha: .95 });
    k.mesh.decal({ x, z, r: R * .88, style: DECAL.scorch, color: 0xff7a2a, life: 10, fadeIn: .3, fadeOut: 5, alpha: 1, add: false, order: 2 });
    k.mesh.decal({ x, z, r: R * .8, style: DECAL.cracks, color: 0xff6a1a, color2: 0xffe08a, life: 1.8, fadeOut: 1, alpha: .85 });
    for (let i = 0; i < 4; i++) { const [ox, oz] = ranIn(R * .7); k.mesh.pillar({ x: x + ox, y, z: z + oz, r: 1.1, h: 8, color: 0xff6a1a, color2: 0xffe08a, life: 1.3, rise: .28, alpha: .7, fadeIn: .08, fadeOut: .7 }); }
    for (let i = 0; i < 9; i++) {
      const [ox, oz] = ranIn(R * .88), d = .06 + i * .055;
      k.tl.at(d, () => meteor(k, x + ox, y, z + oz, .2, rnd(.8, 1.3), { dx: -4, dz: -2.8, h: 17 }, () => {
        explosion(k, x + ox, y, z + oz, rnd(1.2, 1.9), pal, { smoke: 2, debris: 3, dome: false, light: 1.8 });
        k.cam.shake(.1, x + ox, z + oz, .3);
      }));
    }
    k.cam.shake(.92, x, z, .3); k.cam.kick(.65, x, z);
  },
};

const EMBER: AbilityFx[] = [
  { wind: (k, c) => charge(k, c, { n: 8, color: COLORS.fire, hot: COLORS.fireHot }), resolve: muzzle(COLORS.fire, COLORS.fireHot, 'fire') },
  FLAME_WAVE, BURNING_ZONE, INFERNO_STORM,
];

// -- Nature Guardian
const HEALING_SEED: AbilityFx = {
  wind: (k, c) => charge(k, c, { n: 12, rune: true, color: COLORS.heal, hot: 0xe8ffee }),
  resolve: (k, c) => {
    const { x, y, z, R, pal } = c;
    k.mesh.decal({ x, z, r: R, style: DECAL.heal, color: pal.main, color2: pal.hot, life: 1.6, fadeIn: .1, fadeOut: .9, alpha: .85 });
    k.mesh.decal({ x, z, r: R, style: DECAL.wave, color: pal.main, color2: 0xffffff, life: .8, fadeOut: .5, alpha: .8 });
    lightColumn(k, x, y, z, .9, 9, pal.main, pal.hot, .9, .25, .7);
    k.mesh.ring({ x, y: y + .3, z, r0: .8, r1: 3, color: pal.hot, life: .8, width: .07, rise: 2.6, alpha: .85 });
    leaves(k, x, y, z, k.n(18, x, z), 3.4, pal.main, 2.6);
    for (let i = 0; i < k.n(14, x, z); i++) { const a = Math.random() * TAU, v = rnd(1, 3); k.em.mote(x, y + .6, z, Math.cos(a) * v, rnd(1, 3.6), Math.sin(a) * v, i % 2 ? pal.main : pal.hot, rnd(.7, 1.3), rnd(.4, .7), pal.dark); }
    k.em.flash(x, y + 1.3, z, 3.6, pal.hot, .16);
    k.lightAt(x, y + 2, z, pal.main, 1.4);
  },
};

const ROOT_TRAP: AbilityFx = {
  wind: (k, c) => charge(k, c, { n: 10, rune: true }),
  resolve: (k, c) => {
    const { tx: x, ty: y, tz: z, R, pal } = c, hold = Math.max(.8, c.stun);
    k.mesh.decal({ x, z, r: R, style: DECAL.poison, color: pal.dark, color2: pal.main, life: hold + .5, fadeIn: .1, fadeOut: .7, alpha: .85 });
    k.mesh.decal({ x, z, r: R, style: DECAL.wave, color: pal.main, color2: pal.hot, life: .5, fadeOut: .3 });
    spikeRing(k, x, z, R * .8, 14, { h: 2.4, w: .38, life: hold, color: 0x2f6a2a, emissive: pal.main, emissiveI: .55, step: .016, tilt: .5 });
    spikeRing(k, x, z, R * .45, 8, { h: 3.2, w: .42, life: hold, color: 0x2f6a2a, emissive: pal.main, emissiveI: .6, step: .02, tilt: .45 });
    spikeRing(k, x, z, R * .1, 3, { h: 3.8, w: .46, life: hold, color: 0x3a7a2a, emissive: pal.hot, emissiveI: .6, step: .03, tilt: .3 });
    leaves(k, x, y, z, k.n(16, x, z), R * .8, pal.main, 2.2, .5);
    k.em.dustRing(x, y, z, R * .3, k.n(8, x, z), 3.4, 0x6a8a4a, 1.2);
    for (let i = 0; i < k.n(10, x, z); i++) { const a = Math.random() * TAU, d = rnd(0, R * .8); k.em.mote(x + Math.cos(a) * d, y + .3, z + Math.sin(a) * d, rnd(-.3, .3), rnd(1, 2.6), rnd(-.3, .3), COLORS.poison, rnd(.8, 1.4), rnd(.3, .5), pal.dark); }
    k.lightAt(x, y + 1.5, z, pal.main, 1.3);
    k.cam.shake(.2, x, z, .2);
  },
};

const NATURE_BARRIER: AbilityFx = {
  wind: (k, c) => charge(k, c, { n: 12, rune: true, color: COLORS.heal, hot: 0xe8ffee }),
  resolve: (k, c) => {
    const { x, y, z, R, pal } = c;
    k.mesh.dome({ x, y: y + 1.3, z, r0: 1.4, r1: 3.6, color: pal.main, color2: pal.hot, life: 1.7, style: 0, alpha: .85, fadeIn: .1, fadeOut: .9 });
    k.mesh.decal({ x, z, r: R, style: DECAL.heal, color: pal.main, color2: pal.hot, life: 1.3, fadeIn: .1, fadeOut: .7, alpha: .85 });
    k.mesh.ring({ x, y: y + .3, z, r0: .8, r1: 3.2, color: pal.hot, life: .8, width: .07, rise: 2.6, alpha: .85 });
    leaves(k, x, y, z, k.n(22, x, z), 3, pal.main, 2.4);
    k.em.flash(x, y + 1.3, z, 4, pal.hot, .16);
    k.lightAt(x, y + 2, z, pal.main, 1.6);
  },
};

const FOREST_REBIRTH: AbilityFx = {
  wind: (k, c) => charge(k, c, { n: 18, rune: true, color: COLORS.heal, hot: 0xffffff, size: .46 }),
  resolve: (k, c) => {
    const { x, y, z, R, pal } = c;
    lightColumn(k, x, y, z, 2.4, 30, pal.main, 0xffffff, 1.9, .5, .85);
    k.mesh.decal({ x, z, r: R, style: DECAL.wave, color: pal.main, color2: 0xffffff, life: 1.4, fadeOut: .8, alpha: .85 });
    k.mesh.decal({ x, z, r: R * .95, style: DECAL.heal, color: pal.main, color2: pal.hot, life: 2.8, fadeIn: .3, fadeOut: 1.4, alpha: .65 });
    k.mesh.decal({ x, z, r: 8, style: DECAL.rune, color: pal.main, color2: pal.hot, life: 2.2, fadeIn: .2, fadeOut: 1, alpha: .9 });
    k.mesh.dome({ x, y: y + 1.3, z, r0: 1.6, r1: 5, color: pal.main, color2: pal.hot, life: 1.4, style: 0, alpha: .7, fadeOut: .8 });
    k.em.flash(x, y + 1.3, z, 7, pal.hot, .22);
    for (let i = 0; i < 14; i++) k.tl.at(i * .1, () => {
      for (let j = 0; j < 7; j++) { const [ox, oz] = ranIn(R * .85); k.em.glyph(SPR.leaf, x + ox, y + rnd(5, 13), z + oz, rnd(-.8, .8), rnd(-2.4, -1), rnd(-.8, .8), j % 3 ? pal.main : pal.hot, rnd(1.4, 2.2), rnd(.5, .9), 4, false, 0); }
      for (let j = 0; j < 4; j++) { const [ox, oz] = ranIn(R * .8); k.em.mote(x + ox, y + .3, z + oz, 0, rnd(1.6, 3.8), 0, j % 2 ? pal.main : pal.hot, rnd(.9, 1.5), rnd(.5, .8), pal.dark); }
    });
    k.lightAt(x, y + 3, z, pal.main, 3);
    k.cam.shake(.14, x, z, .1); k.cam.kick(.28, x, z);
  },
};

const NATURE: AbilityFx[] = [HEALING_SEED, ROOT_TRAP, NATURE_BARRIER, FOREST_REBIRTH];

// -- Storm Warrior
const STATIC_FIELD: AbilityFx = {
  wind: (k, c) => { charge(k, c, { n: 10, color: COLORS.lightning, hot: 0xffffff }); arcs(k, c.x, c.y + chest, c.z, 3, 1.8, COLORS.lightning, .22); },
  resolve: (k, c) => {
    const { x, y, z, R, pal } = c;
    k.mesh.decal({ x, z, r: R, style: DECAL.lightning, color: pal.main, color2: COLORS.electric, life: 1, fadeIn: .04, fadeOut: .6, alpha: .95 });
    shockwave(k, x, y, z, R, { color: pal.main, color2: 0xffffff, life: .5, sparks: 28 });
    const n = 9;
    for (let i = 0; i < n; i++) { const a = i / n * TAU + rnd(-.2, .2), d = R * rnd(.8, .95); k.mesh.bolt({ ax: x, ay: y + 1.4, az: z, bx: x + Math.cos(a) * d, by: y + .3, bz: z + Math.sin(a) * d, color: i % 2 ? pal.main : COLORS.electric, life: .26, width: .13, jitter: 1.1, rate: 32 }); }
    for (let i = 0; i < 6; i++) { const [ox, oz] = ranIn(R * .85); k.tl.at(i * .045, () => lightningStrike(k, x + ox, y, z + oz, i % 2 ? pal.main : COLORS.electric, { height: 14, sparks: 6 })); }
    k.mesh.flash({ x, y: y + 1.3, z, s0: 3, s1: 8, color: 0xffffff, life: .2, alpha: .95 });
    k.lightAt(x, y + 2.5, z, pal.main, 2.6);
    k.cam.shake(.4, x, z, .95);
  },
};

const THUNDER_CHARGE: AbilityFx = {
  wind: (k, c) => { charge(k, c, { n: 10, color: COLORS.lightning, hot: 0xffffff }); arcs(k, c.x, c.y + chest, c.z, 2, 1.6, COLORS.lightning, .22); },
  resolve: (k, c) => {
    const { pal } = c, ex = c.tx - c.fx, ez = c.tz - c.fz, len = Math.hypot(ex, ez) || 1, nx = ex / len, nz = ez / len;
    for (let b = 0; b < 3; b++) k.mesh.bolt({ ax: c.fx, ay: c.y + 1.3, az: c.fz, bx: c.tx, by: c.y + 1.3, bz: c.tz, color: b ? COLORS.electric : pal.main, life: .26, width: .16, jitter: .9, rate: 32 });
    const steps = Math.max(4, Math.min(20, Math.round(len * 1.2)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, px = c.fx + ex * t, pz = c.fz + ez * t;
      k.em.glyph(SPR.streak, px, c.y + 1.2 + rnd(-.5, .5), pz, -nx * 3, 0, -nz * 3, i % 2 ? pal.main : 0xffffff, rnd(.2, .35), rnd(1.4, 2.4), 0, true, 0);
      if (i % 2 === 0) k.em.spark(px, c.y + 1, pz, rnd(-2, 2), rnd(1, 4), rnd(-2, 2), pal.main, rnd(.2, .4), .3);
    }
    k.mesh.flash({ x: c.fx, y: c.y + 1.3, z: c.fz, s0: 2, s1: 5, color: pal.main, life: .18, alpha: .9 });
    const { tx: x, ty: y, tz: z } = c;
    k.mesh.decal({ x, z, r: c.R, style: DECAL.lightning, color: pal.main, color2: COLORS.electric, life: .7, fadeIn: .03, fadeOut: .4, alpha: .95 });
    shockwave(k, x, y, z, c.R * 1.3, { color: pal.main, color2: 0xffffff, life: .45, sparks: 18 });
    lightningStrike(k, x, y, z, pal.main, { height: 18, width: .3, sparks: 12 });
    arcs(k, x, y + 1, z, 5, 3.4, COLORS.electric);
    k.lightAt(x, y + 2, z, pal.main, 2.2);
    k.cam.shake(.42, x, z, .9);
  },
};

const STORM_RAGE: AbilityFx = {
  wind: (k, c) => { charge(k, c, { n: 14, color: COLORS.lightning, hot: 0xffffff, rune: true }); arcs(k, c.x, c.y + chest, c.z, 4, 2, COLORS.lightning, .24); },
  resolve: (k, c) => {
    const { x, y, z, pal } = c;
    lightColumn(k, x, y, z, 1.4, 30, pal.main, 0xffffff, .55, .08, .95);
    k.mesh.bolt({ ax: x + .6, ay: y + 28, az: z - .4, bx: x, by: y + .3, bz: z, color: 0xffffff, life: .3, width: .3, jitter: 1.2, rate: 36 });
    k.mesh.flash({ x, y: y + 1.4, z, s0: 3, s1: 10, color: 0xffffff, life: .26, alpha: 1 });
    k.mesh.decal({ x, z, r: 5, style: DECAL.lightning, color: pal.main, color2: COLORS.electric, life: .9, fadeOut: .5, alpha: .95 });
    shockwave(k, x, y, z, 6.5, { color: pal.main, color2: 0xffffff, life: .5, sparks: 22 });
    k.mesh.ring({ x, y: y + .3, z, r0: .8, r1: 3.2, color: pal.main, life: .7, width: .06, rise: 2.6, alpha: .9 });
    arcs(k, x, y + 1.3, z, 7, 3.2, COLORS.electric);
    for (let i = 0; i < k.n(30, x, z); i++) { const a = Math.random() * TAU, v = rnd(3, 10); k.em.spark(x, y + 1.2, z, Math.cos(a) * v, rnd(0, 6), Math.sin(a) * v, i % 3 ? pal.main : 0xffffff, rnd(.3, .65), .32); }
    k.lightAt(x, y + 3, z, pal.main, 3.4);
    k.cam.shake(.42, x, z, 1);
  },
};

const STORM: AbilityFx[] = [
  { wind: (k, c) => charge(k, c, { n: 8, color: COLORS.lightning, hot: 0xffffff }), resolve: muzzle(COLORS.lightning, 0xffffff, 'bolt') },
  STATIC_FIELD, THUNDER_CHARGE, STORM_RAGE,
];

// -- Fallbacks for any hero definition that is not one of the five
const generic = (type: AbilityType): AbilityFx => {
  switch (type) {
    case 'bolt': return { wind: (k, c) => charge(k, c, { n: 8 }), resolve: (k, c) => muzzle(c.pal.main, c.pal.hot, 'arc')(k, c) };
    case 'aoe': return { wind: (k, c) => charge(k, c, { n: 12, rune: true }), resolve: (k, c) => { shockwave(k, c.tx, c.ty, c.tz, c.R, { color: c.pal.main, color2: c.pal.hot, dust: 1, sparks: 18 }); k.mesh.flash({ x: c.tx, y: c.ty + 1.2, z: c.tz, s0: 3, s1: 7, color: c.pal.hot, life: .22 }); k.cam.shake(.35, c.tx, c.tz); } };
    case 'tgt': return { wind: (k, c) => charge(k, c, { n: 12, rune: true }), resolve: (k, c) => { explosion(k, c.tx, c.ty, c.tz, Math.max(1.5, c.R * .25), c.pal); shockwave(k, c.tx, c.ty, c.tz, c.R, { color: c.pal.main, color2: c.pal.hot, dust: 1, sparks: 18 }); k.cam.shake(.5, c.tx, c.tz); } };
    case 'dash': return { wind: (k, c) => charge(k, c, { n: 8 }), resolve: (k, c) => { shockwave(k, c.tx, c.ty, c.tz, c.R, { color: c.pal.main, dust: .6 }); k.cam.shake(.25, c.tx, c.tz); } };
    case 'heal': return { wind: (k, c) => charge(k, c, { n: 10, rune: true }), resolve: (k, c) => { k.mesh.decal({ x: c.x, z: c.z, r: c.R, style: DECAL.heal, color: COLORS.heal, color2: 0xe8ffee, life: 1.2, fadeOut: .7 }); leaves(k, c.x, c.y, c.z, 14, 3, COLORS.heal); } };
    default: return { wind: (k, c) => charge(k, c, { n: 10 }), resolve: (k, c) => { k.mesh.dome({ x: c.x, y: c.y + 1.3, z: c.z, r0: 1.2, r1: 3.2, color: c.pal.main, color2: c.pal.hot, life: 1, style: 0 }); } };
  }
};

/** Ability effects by hero name and ability index (0..3 = Q W E R); heroes the table does not know fall back to one recipe per type. */
export const ABILITY_FX: Record<string, AbilityFx[]> = {
  'Arcane Knight': ARCANE, 'Shadow Huntress': SHADOW, 'Ember Mage': EMBER, 'Nature Guardian': NATURE, 'Storm Warrior': STORM,
};
export const abilityFx = (hero: string | undefined, idx: number, type: AbilityType): AbilityFx => (hero && ABILITY_FX[hero]?.[idx]) || generic(type);

// ---------------------------------------------------------------------------------------------------------------- per-ally heal / buff auras

/** The heal landing on one ally: a column and rising plus signs. */
export function healOne(k: Kit, x: number, y: number, z: number, color = COLORS.heal): void {
  k.mesh.ring({ x, y: y + .2, z, r0: .6, r1: 1.6, color, life: .6, width: .08, rise: 2.2, alpha: .85 });
  k.mesh.pillar({ x, y, z, r: .8, h: 4, color, color2: 0xe8ffee, life: .65, rise: .15, alpha: .55, fadeIn: .05, fadeOut: .4 });
  for (let i = 0; i < k.n(4, x, z); i++) { const a = Math.random() * TAU; k.em.glyph(SPR.plus, x + Math.cos(a) * .7, y + rnd(.3, 1.2), z + Math.sin(a) * .7, 0, rnd(1.2, 2.4), 0, i % 2 ? color : 0xe8ffee, rnd(.7, 1.1), rnd(.45, .7), 1); }
  for (let i = 0; i < k.n(5, x, z); i++) { const a = Math.random() * TAU, v = rnd(.4, 1.2); k.em.mote(x, y + .5, z, Math.cos(a) * v, rnd(1.4, 3), Math.sin(a) * v, color, rnd(.6, 1), rnd(.3, .5), 0xe8ffee); }
  k.em.flash(x, y + 1.2, z, 2, color, .12);
}

/** Smoke Veil / Storm Rage / camp-buff loops, one call per hero per frame. `acc` keeps the fractional emission counts between frames. */
export type AuraKind = 'smoke' | 'storm' | 'camp';
export function auraStep(k: Kit, kind: AuraKind, x: number, y: number, z: number, pal: Palette, dt: number, acc: { a: number; b: number; c: number }): void {
  if (dt <= 0 || !k.vis(x, z)) return;
  const q = k.q, em = k.em;
  if (kind === 'smoke') {
    acc.a += dt * 12 * q; acc.b += dt * 5 * q;
    while (acc.a >= 1) { acc.a--; const a = Math.random() * TAU, d = rnd(.2, .8); em.smoke(x + Math.cos(a) * d, y + rnd(.2, 2), z + Math.sin(a) * d, rnd(-.3, .3), rnd(.4, 1), rnd(-.3, .3), rnd(.9, 1.5), .7, 1.9, darken(pal.dark, .1), .35, .5); }
    while (acc.b >= 1) { acc.b--; const a = Math.random() * TAU; em.mote(x + Math.cos(a) * .7, y + rnd(.2, 2), z + Math.sin(a) * .7, 0, rnd(.4, 1.2), 0, pal.main, rnd(.5, .9), rnd(.3, .5), pal.dark); }
  } else if (kind === 'storm') {
    acc.a += dt * 14 * q; acc.b += dt * 3.2 * q; acc.c += dt * 5 * q;
    while (acc.a >= 1) { acc.a--; const a = Math.random() * TAU, d = rnd(.5, 1); em.spark(x + Math.cos(a) * d, y + rnd(.1, 2.4), z + Math.sin(a) * d, rnd(-1.2, 1.2), rnd(.2, 2), rnd(-1.2, 1.2), Math.random() < .5 ? pal.main : 0xffffff, rnd(.15, .35), .26); }
    while (acc.b >= 1) {
      acc.b--; const a = Math.random() * TAU, d = rnd(.9, 1.4), a2 = a + rnd(.8, 2.2);
      k.mesh.bolt({ ax: x + Math.cos(a) * d, ay: y + rnd(.2, 2.3), az: z + Math.sin(a) * d, bx: x + Math.cos(a2) * d, by: y + rnd(.2, 2.3), bz: z + Math.sin(a2) * d, color: COLORS.electric, life: .12, width: .06, jitter: .22, rate: 34 });
    }
    while (acc.c >= 1) { acc.c--; em.mote(x + rnd(-.6, .6), y + rnd(.2, 1.8), z + rnd(-.6, .6), 0, rnd(.6, 1.6), 0, pal.main, rnd(.4, .7), rnd(.3, .5), 0xffffff); }
  } else {
    acc.a += dt * 7 * q;
    while (acc.a >= 1) { acc.a--; const a = Math.random() * TAU, d = rnd(.3, .8); em.mote(x + Math.cos(a) * d, y + rnd(0, .8), z + Math.sin(a) * d, 0, rnd(.9, 2), 0, COLORS.gold, rnd(.6, 1), rnd(.25, .4), 0xfff2b0); }
  }
}
