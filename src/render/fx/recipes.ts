import type { Kit } from './kit';
import { DECAL } from './mesh';
import { SPR } from './atlas';
import { COLORS, darken, lighten, mixHex } from './style';
import type { Palette } from './style';

/**
 * Effect recipes: small functions that combine particles, pooled meshes, the timeline, the camera sink and the scene light into one
 * named effect. Positions are WORLD units (y up) and `y` is always the ground height at (x, z). Counts go through `k.n()` so the
 * detail drops with distance and with a low frame rate. The ability-specific recipes live in abilities.ts.
 */

export const TAU = Math.PI * 2;
export const rnd = (a: number, b: number): number => a + Math.random() * (b - a);
/** Where the 'wave' decal's front is after `p` (0..1) of its life; must match DECAL_FRAG. */
export const frontAt = (p: number): number => 1 - Math.pow(1 - p, 2.2);

/** A random point inside a disc of radius `r` (uniform by area). */
export const ranIn = (r: number): [number, number] => { const a = Math.random() * TAU, d = Math.sqrt(Math.random()) * r; return [Math.cos(a) * d, Math.sin(a) * d]; };

/** A ground shock wave: a terrain-hugging ring that races to radius `R`, optionally trailing dust puffs and sparks along its front. */
export function shockwave(k: Kit, x: number, y: number, z: number, R: number, o: { color: number; color2?: number; life?: number; dust?: boolean | number; dustColor?: number; sparks?: number; alpha?: number }): void {
  const life = o.life ?? Math.min(.9, .3 + R * .04);
  k.mesh.decal({ x, z, r: R, style: DECAL.wave, color: o.color, color2: o.color2 ?? lighten(o.color, .6), life, fadeIn: .02, fadeOut: life * .5, alpha: o.alpha ?? 1 });
  const steps = 5, dm = typeof o.dust === 'number' ? o.dust : 1;
  for (let i = 1; i <= steps; i++) {
    const p = i / steps * .9 + .02, rr = R * frontAt(p);
    if (o.dust) k.tl.at(life * p, () => k.em.dustRing(x, y, z, rr, k.n(Math.ceil((2 + rr * .8) * dm), x, z), 2 + R * .12, o.dustColor ?? COLORS.dust, .9 + R * .045));
    if (o.sparks) k.tl.at(life * p, () => k.em.sparkRing(x, y, z, rr, k.n(Math.ceil(o.sparks! / steps * 1.6), x, z), 2.5 + R * .2, lighten(o.color, .3), .45));
  }
}

/** A fireball: layered flashes, a turbulent shell, flames, sparks, embers, smoke and flying debris. `s` is the radius in world units. */
export function explosion(k: Kit, x: number, y: number, z: number, s: number, c: { hot: number; main: number; dark?: number },
  o: { smoke?: number; debris?: number; dome?: boolean; light?: number; sparks?: number; fire?: number; ring?: boolean; rubble?: number } = {}): void {
  const em = k.em, mesh = k.mesh, cy = y + s * .55;
  mesh.flash({ x, y: cy, z, s0: s * 2.2, s1: s * 4.4, color: c.hot, life: .2, alpha: .95 });
  mesh.flash({ x, y: cy, z, s0: s * 3, s1: s * 6.2, color: c.main, life: .4, alpha: .5 });
  em.flash(x, cy, z, s * 2.4, c.hot, .1);
  if (o.dome !== false) mesh.dome({ x, y: cy, z, r0: s * .3, r1: s * 1.45, color: c.main, color2: c.hot, life: .5, style: 1, alpha: .9, fadeIn: .02, fadeOut: .3 });
  if (o.ring !== false) mesh.ring({ x, y: y + .2, z, r0: s * .4, r1: s * 2.6, color: c.hot, life: .4, width: .09, alpha: .9 });
  const nf = k.n((o.fire ?? 10) + s * 5, x, z), ns = k.n((o.sparks ?? 14) + s * 8, x, z);
  for (let i = 0; i < nf; i++) {
    const a = Math.random() * TAU, e = rnd(-.1, 1), v = s * rnd(1.2, 3.4), h = Math.sqrt(1 - e * e * .6);
    em.fire(x, cy, z, Math.cos(a) * v * h, e * v * 1.2 + s * .8, Math.sin(a) * v * h, rnd(.45, .9), s * rnd(.5, .95), c.hot, c.dark ?? darken(c.main, .6));
  }
  for (let i = 0; i < ns; i++) {
    const a = Math.random() * TAU, e = rnd(-.2, 1.1), v = s * rnd(3, 8);
    em.spark(x, cy, z, Math.cos(a) * v, e * v + s, Math.sin(a) * v, c.hot, rnd(.3, .75), rnd(.25, .45));
  }
  const ne = k.n(8 + s * 4, x, z);
  for (let i = 0; i < ne; i++) { const a = Math.random() * TAU, v = s * rnd(.6, 2.2); em.ember(x, cy, z, Math.cos(a) * v, rnd(1, 4) * s * .7, Math.sin(a) * v, c.main, rnd(.9, 1.8), rnd(.2, .34), rnd(1, 2.4)); }
  if (o.smoke !== 0) em.plume(x, cy, z, k.n(o.smoke ?? 5 + s * 2, x, z), s * 2.2, COLORS.smoke, s * .75);
  if (o.debris !== 0) em.debris(x, y + .3, z, k.n(o.debris ?? 5 + s * 3, x, z), s * 3.4, COLORS.rock, 1);
  if (o.rubble) em.dustRing(x, y, z, s * .6, k.n(o.rubble, x, z), s * 2.2, COLORS.dust, s * .8);
  k.lightAt(x, y + s * 2, z, c.main, o.light ?? Math.min(3.2, 1 + s * .5));
}

/** Pillar of light that shoots up and fades: spawns, level up, big casts. */
export function lightColumn(k: Kit, x: number, y: number, z: number, r: number, h: number, c0: number, c1: number, life: number, rise = .2, alpha = .85): void {
  k.mesh.pillar({ x, y, z, r, h, color: c0, color2: c1, life, rise, alpha, fadeIn: .06, fadeOut: life * .55 });
}

/** A bolt from the sky onto a point: ribbon, flash, ground ring and sparks. */
export function lightningStrike(k: Kit, x: number, y: number, z: number, color: number, o: { height?: number; width?: number; sparks?: number } = {}): void {
  const h = o.height ?? 16, ox = rnd(-2.2, 2.2), oz = rnd(-2.2, 2.2);
  k.mesh.bolt({ ax: x + ox, ay: y + h, az: z + oz, bx: x, by: y + .2, bz: z, color, life: .24, width: o.width ?? .24, jitter: 1.1, rate: 40 });
  k.mesh.flash({ x, y: y + .8, z, s0: 1.2, s1: 3.4, color: lighten(color, .6), life: .16, alpha: .9 });
  k.mesh.ring({ x, y: y + .15, z, r0: .3, r1: 2.2, color, life: .3, width: .1, alpha: .9 });
  const n = k.n(o.sparks ?? 8, x, z);
  for (let i = 0; i < n; i++) { const a = Math.random() * TAU, v = rnd(3, 9); k.em.spark(x, y + .3, z, Math.cos(a) * v, rnd(2, 6), Math.sin(a) * v, i % 3 ? color : 0xffffff, rnd(.18, .4), rnd(.2, .35)); }
}

// ---------------------------------------------------------------------------------------------------------------- combat feedback

/** A hit: a handful of sparks, a spark glyph and a tiny flash. `f` = damage as a fraction of max hp, `solid` = stone / metal target. */
export function hitSpark(k: Kit, x: number, y: number, z: number, f: number, magic: boolean, solid: boolean): void {
  const em = k.em, col = magic ? 0xbfe0ff : 0xffe8b8, n = k.n(Math.round(3 + Math.min(1, f * 4) * 9), x, z);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, v = rnd(3, 8) * (1 + f), e = rnd(.2, 1.1);
    em.spark(x, y, z, Math.cos(a) * v, e * v * .9 + 1.5, Math.sin(a) * v, col, rnd(.18, .34), rnd(.22, .4));
  }
  em.flash(x, y, z, .9 + Math.min(1, f * 4) * 2.2, magic ? 0x9fd0ff : 0xffffff, .12);
  em.glyph(SPR.sparkle, x, y, z, 0, 0, 0, col, .16, 1 + Math.min(1, f * 4) * 1.4, 0);
  if (solid) {
    for (let i = 0; i < k.n(3, x, z); i++) { const a = Math.random() * TAU, v = rnd(1.5, 4); em.chunk(x, y, z, Math.cos(a) * v, rnd(2, 5), Math.sin(a) * v, COLORS.rock, rnd(.5, .9), rnd(.14, .24)); }
    em.dust(x, y - .4, z, rnd(-.4, .4), rnd(.3, .8), rnd(-.4, .4), .8, .5, 1.5, COLORS.dust, .35);
  }
}

/** A lane creep, neutral or siege engine falling apart: sparks in its color, drifting embers, one puff of smoke. */
export function minionDeath(k: Kit, x: number, y: number, z: number, color: number, s = 1): void {
  const em = k.em, n = k.n(Math.round(7 * s), x, z);
  for (let i = 0; i < n; i++) { const a = Math.random() * TAU, v = rnd(2, 6) * s; em.spark(x, y + .8 * s, z, Math.cos(a) * v, rnd(1, 5) * s, Math.sin(a) * v, i % 2 ? color : 0xffffff, rnd(.25, .55), rnd(.22, .36)); }
  for (let i = 0; i < k.n(4, x, z); i++) em.ember(x + rnd(-.4, .4), y + .5, z + rnd(-.4, .4), rnd(-.6, .6), rnd(1, 2.4), rnd(-.6, .6), color, rnd(.8, 1.4), rnd(.2, .3), 1.2);
  em.smoke(x, y + .8 * s, z, rnd(-.3, .3), .9, rnd(-.3, .3), 1.2, .8 * s, 2.2 * s, COLORS.smoke, .4, .5);
  k.mesh.ring({ x, y: y + .12, z, r0: .3, r1: 1.7 * s, color, life: .34, width: .12, alpha: .7 });
  em.flash(x, y + .9 * s, z, 2 * s, color, .1);
}

/** A hero falls: wave, soul wisps spiralling upwards, smoke and a thin column. */
export function heroDeath(k: Kit, x: number, y: number, z: number, pal: Palette, mine: boolean): void {
  const em = k.em;
  shockwave(k, x, y, z, 4.2, { color: pal.main, color2: pal.hot, life: .55, dust: .6, sparks: 14 });
  k.mesh.ring({ x, y: y + .3, z, r0: .5, r1: 2.6, color: pal.hot, life: .7, width: .09, rise: 2.4, alpha: .8 });
  em.flash(x, y + 1.2, z, 4, pal.hot, .16);
  const nw = k.n(16, x, z);
  for (let i = 0; i < nw; i++) {
    const a = i / nw * TAU + Math.random() * .5, v = rnd(.8, 2.4);
    em.mote(x + Math.cos(a) * .4, y + rnd(.2, 1.6), z + Math.sin(a) * .4, Math.cos(a) * v + Math.sin(a) * 1.2, rnd(2.2, 4.4), Math.sin(a) * v - Math.cos(a) * 1.2, i % 3 ? pal.main : pal.hot, rnd(.9, 1.6), rnd(.5, .85), pal.dark);
  }
  for (let i = 0; i < k.n(6, x, z); i++) em.smoke(x + rnd(-.5, .5), y + rnd(.3, 1.5), z + rnd(-.5, .5), rnd(-.6, .6), rnd(.6, 1.4), rnd(-.6, .6), rnd(1.1, 1.8), 1.1, 3, darken(pal.dark, .2), .5, .5);
  lightColumn(k, x, y, z, .7, 9, pal.main, pal.hot, .9, .3, .65);
  k.lightAt(x, y + 2, z, pal.main, 1.8);
  k.cam.shake(mine ? .42 : .14, x, z, .3);
}

export function bossDeath(k: Kit, x: number, y: number, z: number, color = COLORS.boss): void {
  const pal = { main: color, hot: lighten(color, .6), dark: darken(color, .6) };
  explosion(k, x, y, z, 3.4, pal, { smoke: 12, debris: 18, light: 3 });
  shockwave(k, x, y, z, 14, { color, life: .85, dust: 1, sparks: 24 });
  lightColumn(k, x, y, z, 1.6, 20, color, 0xffffff, 1.4, .3, .8);
  for (let i = 0; i < k.n(22, x, z); i++) { const a = Math.random() * TAU, v = rnd(1, 3.2); k.em.mote(x + Math.cos(a), y + rnd(0, 3), z + Math.sin(a), Math.cos(a) * v, rnd(2.5, 6), Math.sin(a) * v, i % 2 ? color : 0xffffff, rnd(1.2, 2.2), rnd(.7, 1.2), pal.dark); }
  k.cam.shake(.7, x, z, .5); k.cam.kick(.5, x, z);
}

/** A hero comes back at the fountain: rune circle, light column, converging motes, then a burst. */
export function respawn(k: Kit, x: number, y: number, z: number, pal: Palette, mine: boolean): void {
  const em = k.em;
  k.mesh.decal({ x, z, r: 3.4, style: DECAL.rune, color: pal.main, color2: pal.hot, life: 1.6, fadeIn: .15, fadeOut: .8 });
  lightColumn(k, x, y, z, 1.1, 14, pal.main, pal.hot, 1.3, .3, .8);
  k.mesh.ring({ x, y: y + .15, z, r0: 3.4, r1: .6, color: pal.hot, life: .5, width: .06, alpha: .9 });
  em.gather(x, y + 1.2, z, 3.2, k.n(26, x, z), pal.hot, .45, .45);
  k.tl.at(.4, () => {
    shockwave(k, x, y, z, 5.5, { color: pal.main, color2: pal.hot, life: .55, dust: .5, sparks: 18 });
    k.mesh.ring({ x, y: y + .3, z, r0: .6, r1: 3.2, color: pal.hot, life: .7, width: .08, rise: 2.8, alpha: .85 });
    em.flash(x, y + 1.3, z, 5, pal.hot, .18);
    for (let i = 0; i < k.n(14, x, z); i++) { const a = Math.random() * TAU, v = rnd(2, 5); em.spark(x, y + 1.1, z, Math.cos(a) * v, rnd(1, 5), Math.sin(a) * v, i % 2 ? pal.hot : pal.main, rnd(.4, .8), .34); }
    k.lightAt(x, y + 2, z, pal.main, 2);
  });
  if (mine) k.cam.shake(.12, x, z, .2);
}

export function levelUp(k: Kit, x: number, y: number, z: number): void {
  const em = k.em, g = COLORS.gold;
  k.mesh.ring({ x, y: y + .2, z, r0: .8, r1: 2.8, color: g, life: .8, width: .07, rise: 2.7, alpha: .9 });
  k.tl.at(.16, () => k.mesh.ring({ x, y: y + .2, z, r0: .8, r1: 2.4, color: 0xffffff, life: .7, width: .05, rise: 2.7, alpha: .8 }));
  lightColumn(k, x, y, z, .75, 8, g, 0xffffff, .8, .2, .75);
  for (let i = 0; i < k.n(10, x, z); i++) { const a = Math.random() * TAU; em.glyph(SPR.plus, x + Math.cos(a) * 1.1, y + rnd(.2, 1.4), z + Math.sin(a) * 1.1, 0, rnd(1.6, 3.2), 0, i % 2 ? g : 0xfff2b0, rnd(.7, 1.1), rnd(.5, .8), 2); }
  for (let i = 0; i < k.n(14, x, z); i++) { const a = Math.random() * TAU, v = rnd(1, 2.6); em.mote(x, y + .6, z, Math.cos(a) * v, rnd(1, 4), Math.sin(a) * v, g, rnd(.6, 1.1), rnd(.4, .7), 0xfff2b0); }
  em.flash(x, y + 1.2, z, 3.4, g, .16);
  k.lightAt(x, y + 2, z, g, 1.2);
}

export function campBuff(k: Kit, x: number, y: number, z: number): void {
  const em = k.em, g = COLORS.gold;
  k.mesh.ring({ x, y: y + .2, z, r0: .6, r1: 2.2, color: g, life: .6, width: .08, rise: 2, alpha: .85 });
  for (let i = 0; i < k.n(14, x, z); i++) { const a = Math.random() * TAU, v = rnd(.4, 1.6); em.mote(x + Math.cos(a) * .5, y + rnd(0, 1), z + Math.sin(a) * .5, Math.cos(a) * v, rnd(1.6, 3.4), Math.sin(a) * v, g, rnd(.7, 1.2), rnd(.3, .6), 0xfff2b0); }
  em.flash(x, y + 1.2, z, 2.6, g, .14);
}

export function enrage(k: Kit, x: number, y: number, z: number): void {
  const r = COLORS.blood;
  shockwave(k, x, y, z, 13, { color: r, color2: 0xffb0a0, life: .9, dust: .7, sparks: 22 });
  k.mesh.dome({ x, y: y + 2.4, z, r0: 2, r1: 6.5, color: r, color2: 0xff9a7a, life: .7, style: 0, alpha: .75 });
  k.mesh.ring({ x, y: y + .3, z, r0: 1, r1: 8, color: r, life: .8, width: .07, alpha: .85 });
  const n = k.n(30, x, z);
  for (let i = 0; i < n; i++) { const a = Math.random() * TAU, v = rnd(3, 9); k.em.fire(x + Math.cos(a), y + rnd(.2, 2), z + Math.sin(a), Math.cos(a) * v, rnd(1, 5), Math.sin(a) * v, rnd(.5, 1), rnd(.7, 1.3), 0xff8a6a, 0x9a0a0a); }
  k.lightAt(x, y + 3, z, r, 3);
  k.cam.shake(.55, x, z, .45); k.cam.kick(.35, x, z);
}

export function bossSlam(k: Kit, x: number, y: number, z: number, R: number): void {
  const c = COLORS.boss;
  shockwave(k, x, y, z, R, { color: c, color2: 0xffd0f0, life: .6, dust: 1, sparks: 16 });
  k.mesh.decal({ x, z, r: R * .8, style: DECAL.cracks, color: c, color2: 0xffffff, life: 1.1, fadeOut: .6, alpha: .9 });
  k.em.debris(x, y + .3, z, k.n(12, x, z), 7, COLORS.rock, 1);
  k.mesh.flash({ x, y: y + 1, z, s0: 3, s1: 7, color: c, life: .25, alpha: .8 });
  k.lightAt(x, y + 2, z, c, 2.2);
  k.cam.shake(.4, x, z, .35);
}

// ---------------------------------------------------------------------------------------------------------------- structures

/** A tower blows up: three staggered explosions, a shock wave, flying masonry and crystal shards, then smouldering ruins. */
export function towerDown(k: Kit, x: number, y: number, z: number, crystal: number): void {
  const pal = { main: COLORS.fire, hot: COLORS.fireHot, dark: COLORS.fireDeep };
  explosion(k, x, y + 1, z, 3.2, pal, { smoke: 10, debris: 18, light: 3.6, rubble: 12 });
  shockwave(k, x, y, z, 11, { color: 0xffaa44, color2: 0xfff0c0, life: .75, dust: 1, sparks: 26 });
  k.mesh.decal({ x, z, r: 4.6, style: DECAL.scorch, color: 0xff7a2a, life: 16, fadeIn: .4, fadeOut: 6, alpha: 1, add: false, order: 2 });
  for (let i = 0; i < k.n(22, x, z); i++) {
    const a = Math.random() * TAU, v = rnd(2, 7);
    k.em.glyph(SPR.shard, x, y + 5.2, z, Math.cos(a) * v, rnd(3, 9), Math.sin(a) * v, i % 3 ? crystal : 0xffffff, rnd(.7, 1.3), rnd(.3, .6), 8, true, 12);
  }
  k.tl.at(.14, () => explosion(k, x + rnd(-.8, .8), y + 3.6, z + rnd(-.8, .8), 1.8, pal, { smoke: 4, debris: 8, dome: false, ring: false, light: 2 }));
  k.tl.at(.32, () => { explosion(k, x + rnd(-1.2, 1.2), y + .6, z + rnd(-1.2, 1.2), 2.2, pal, { smoke: 6, debris: 10, dome: false, light: 2.4, rubble: 8 }); k.cam.shake(.25, x, z, .3); });
  for (let i = 0; i < 16; i++) k.tl.at(.4 + i * .14, () => {
    const px = x + rnd(-1.6, 1.6), pz = z + rnd(-1.6, 1.6);
    k.em.fire(px, y + .5, pz, rnd(-.3, .3), rnd(1, 2.4), rnd(-.3, .3), rnd(.5, .9), rnd(.9, 1.5));
    k.em.smoke(px, y + 1, pz, rnd(-.2, .2), rnd(1, 1.8), rnd(-.2, .2), rnd(1.6, 2.4), 1, 3, COLORS.smoke, .45, .7);
  });
  k.cam.shake(.62, x, z, .4); k.cam.kick(.45, x, z);
}

/** The core shatters: a white-out, a column of light, two expanding waves, chain explosions and a rain of shards. */
export function coreDown(k: Kit, x: number, y: number, z: number, crystal: number): void {
  const pal = { main: COLORS.fire, hot: COLORS.fireHot, dark: COLORS.fireDeep };
  k.mesh.flash({ x, y: y + 3.6, z, s0: 8, s1: 22, color: 0xffffff, life: .4, alpha: 1 });
  k.mesh.flash({ x, y: y + 3.6, z, s0: 10, s1: 28, color: crystal, life: .7, alpha: .7 });
  explosion(k, x, y + 1.6, z, 4.4, pal, { smoke: 16, debris: 30, light: 5, rubble: 16, fire: 20, sparks: 40 });
  k.mesh.dome({ x, y: y + 3.6, z, r0: 1.5, r1: 9, color: crystal, color2: 0xffffff, life: .9, style: 1, alpha: .8 });
  lightColumn(k, x, y, z, 2.8, 42, crystal, 0xffffff, 2.4, .35, .85);
  shockwave(k, x, y, z, 20, { color: crystal, color2: 0xffffff, life: 1.1, dust: 1.2, sparks: 40 });
  k.tl.at(.35, () => shockwave(k, x, y, z, 32, { color: 0xffaa44, color2: 0xfff0c0, life: 1.3, dust: 1.2, sparks: 30 }));
  k.mesh.decal({ x, z, r: 7, style: DECAL.scorch, color: 0xff7a2a, life: 20, fadeIn: .5, fadeOut: 8, alpha: 1, add: false, order: 2 });
  for (let i = 0; i < k.n(60, x, z); i++) {
    const a = Math.random() * TAU, v = rnd(3, 11);
    k.em.glyph(SPR.shard, x, y + 3.6, z, Math.cos(a) * v, rnd(4, 13), Math.sin(a) * v, i % 3 ? crystal : 0xffffff, rnd(1, 2), rnd(.35, .8), 9, true, 11);
  }
  for (const [t, s, h] of [[.25, 2.6, 1], [.5, 2.2, 3.4], [.8, 2.8, .6], [1.1, 2.2, 4], [1.5, 3, 1.4], [1.95, 2.4, 2.6]] as const) {
    k.tl.at(t, () => {
      const a = Math.random() * TAU, d = rnd(1.5, 4.5);
      explosion(k, x + Math.cos(a) * d, y + h, z + Math.sin(a) * d, s, pal, { smoke: 5, debris: 10, light: 3, dome: s > 2.5, ring: false });
      k.cam.shake(.5, x, z, .4);
    });
  }
  for (let i = 0; i < 26; i++) k.tl.at(.5 + i * .12, () => {
    const px = x + rnd(-3.2, 3.2), pz = z + rnd(-3.2, 3.2);
    k.em.fire(px, y + .4, pz, rnd(-.3, .3), rnd(1, 2.6), rnd(-.3, .3), rnd(.5, 1), rnd(1, 1.8));
    k.em.smoke(px, y + 1, pz, rnd(-.2, .2), rnd(1.2, 2.2), rnd(-.2, .2), rnd(1.8, 2.8), 1.2, 3.6, COLORS.smoke, .5, .8);
    k.em.ember(px, y + 1, pz, rnd(-.8, .8), rnd(2, 5), rnd(-.8, .8), COLORS.ember, rnd(1, 2), .24, 1.4);
  });
  k.cam.shake(1, x, z, .5); k.cam.kick(.8, x, z);
  k.tl.at(.6, () => k.cam.shake(.7, x, z, .4));
  k.tl.at(1.2, () => k.cam.shake(.5, x, z, .4));
}

/**
 * Per-frame smoke, flames and sparks of a hurt tower / core. `acc` is a small accumulator object kept by the caller between frames.
 * It starts at 62 % health with a thin grey wisp and gets steadily worse: dark smoke, then below 30 % a burning crown with embers, so a
 * building that is about to fall can be told from across the screen.
 */
export function structureDamage(k: Kit, x: number, y: number, z: number, topY: number, hp: number, core: boolean, color: number, dt: number, acc: { s: number; f: number; e: number }): void {
  if (dt <= 0 || hp >= .62 || !k.vis(x, z)) return;
  const bad = hp < .3, sc = core ? 1.7 : 1, em = k.em, q = k.q;
  const w = Math.min(1, Math.max(0, (.62 - hp) / .62)), burn = bad ? Math.min(1, 1 - hp / .3) : 0;
  acc.s += dt * (3.4 + 8 * w) * sc * q; acc.f += dt * (bad ? 8 + 12 * burn : 0) * sc * q; acc.e += dt * (1.2 + 4.5 * w) * q;
  while (acc.s >= 1) { acc.s--; em.smoke(x + rnd(-1, 1) * sc, topY, z + rnd(-1, 1) * sc, rnd(-.3, .3), rnd(1.2, 2), rnd(-.3, .3), rnd(1.6, 2.5), 1.1 * sc, 3.4 * sc, bad ? 0x24242c : 0x5a5a66, bad ? .7 : .5, .7); }
  while (acc.f >= 1) {
    acc.f--;
    em.fire(x + rnd(-1.3, 1.3) * sc, topY - rnd(0, 1.6) * sc, z + rnd(-1.3, 1.3) * sc, rnd(-.2, .2), rnd(.9, 2), rnd(-.2, .2), rnd(.5, .9), rnd(1.1, 1.9) * sc);
    if (Math.random() < .35) em.ember(x + rnd(-1, 1) * sc, topY, z + rnd(-1, 1) * sc, rnd(-.5, .5), rnd(1.5, 3), rnd(-.5, .5), 0xff8a3a, rnd(.9, 1.6), .2, 1.6);
  }
  while (acc.e >= 1) { acc.e--; const a = Math.random() * TAU, v = rnd(2, 5); em.spark(x, topY, z, Math.cos(a) * v, rnd(2, 5), Math.sin(a) * v, mixHex(color, 0xffffff, .5), rnd(.3, .6), .3); }
  if (bad && Math.random() < dt * 3 * q) em.flash(x, topY - .6, z, 2.4 * sc, 0xff7a2a, .14);
}

/** A crystal that is about to give out: a lightning arc from its centre to the ground. */
export function structureArc(k: Kit, x: number, y: number, z: number, topY: number, color: number): void {
  const a = Math.random() * TAU, d = rnd(1.6, 3.2);
  k.mesh.bolt({ ax: x, ay: topY, az: z, bx: x + Math.cos(a) * d, by: y + .3, bz: z + Math.sin(a) * d, color, life: .18, width: .1, jitter: .5, rate: 36 });
}
