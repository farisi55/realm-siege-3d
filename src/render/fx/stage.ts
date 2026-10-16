import type { Kit } from './kit';
import type { DecalSlot } from './mesh';
import { DECAL } from './mesh';
import { SPR } from './atlas';
import { COLORS, lighten } from './style';
import type { Palette } from './style';
import { TAU, lightColumn, lightningStrike, rnd } from './recipes';

/** The show-off moves of the hero-select pedestal (see CUES in stage.ts). */
export type StageCue = 'attack' | 'attack2' | 'cast' | 'run' | 'victory' | 'idle';
type Theme = 'arcane' | 'shadow' | 'fire' | 'nature' | 'storm';

/** Perceived brightness of a hex colour, 0..1. */
const lum = (c: number): number => (((c >> 16) & 255) * .3 + ((c >> 8) & 255) * .59 + (c & 255) * .11) / 255;

const THEME: Record<string, Theme> = {
  'Arcane Knight': 'arcane', 'Shadow Huntress': 'shadow', 'Ember Mage': 'fire', 'Nature Guardian': 'nature', 'Storm Warrior': 'storm',
};

/**
 * Effects of the hero-select stage: a rune circle on the pedestal, a summoning burst when another hero is picked, a slow stream of
 * motes in the hero's theme (arcane glyphs, shadow wisps, embers, leaves, static) and a matching effect for every move of the
 * pedestal's show-off loop. It draws with the shared pools of the VFX kit, so it costs nothing extra in memory; in the menu the facade
 * steps those pools (the match loop that normally does it is not running).
 */
export class StageFx {
  private base: DecalSlot | null = null; private baseId = 0;
  private halo: DecalSlot | null = null; private haloId = 0;
  private pal: Palette | null = null;
  private theme: Theme = 'arcane';
  private t = 0; private yaw = 0; private scale = 1;
  private running = false; private on = false;
  /** Bright hero colours (the Storm Warrior's gold) are dimmed so stacked additive layers do not burn out to white. */
  private dim = 1;
  /** Bumped when the pedestal changes hero or hides: delayed callbacks of an earlier hero see it and do nothing. */
  private epoch = 0;
  private acc = { a: 0, b: 0, c: 0, d: 0 };

  /** `x` / `z` is the centre of the pedestal, `top` the height of its top face, `R` the radius of the rune circle. */
  constructor(private k: Kit, readonly x: number, readonly z: number, readonly top = .08, readonly R = 3.3) {}

  get visible(): boolean { return this.on; }
  /** Pedestal decals that are currently drawn (tests). */
  get decals(): number { return (this.held(this.base, this.baseId) ? 1 : 0) + (this.held(this.halo, this.haloId) ? 1 : 0); }

  private held(s: DecalSlot | null, id: number): DecalSlot | null { return s && s.on && s.id === id ? s : null; }
  private fade(s: DecalSlot | null, id: number, t = .25): void { const d = this.held(s, id); if (d) { d.fout = t; d.life = Math.min(d.life, d.age + t); } }

  /** The hero on the pedestal changed (or the stage came back): rebuild the decals, and play the summoning burst when `summon`. */
  show(name: string | undefined, pal: Palette, scale = 1.6, summon = true): void {
    const k = this.k;
    this.fade(this.base, this.baseId, .2); this.fade(this.halo, this.haloId, .2);
    this.pal = pal; this.theme = (name && THEME[name]) || 'arcane'; this.scale = scale; this.on = true; this.running = false; this.epoch++;
    this.dim = Math.max(.62, Math.min(1, 1.3 - lum(pal.main) * .7));
    const dim = this.dim;
    const d = (r: number, style: number, c1: number, c2: number, alpha: number, order: number) =>
      k.mesh.decal({ x: this.x, z: this.z, r, style, color: c1, color2: c2, life: 1e6, fadeIn: .45, fadeOut: .25, alpha: alpha * dim, flatY: this.top, order }, true);
    this.base = d(this.R, DECAL.rune, pal.main, pal.hot, .8, 4);
    this.baseId = this.base ? this.base.id : 0;
    // a second, softer layer in the theme's own pattern: the pedestal looks different for each hero
    const style = ({ arcane: -1, shadow: DECAL.shadow, fire: DECAL.fire, nature: DECAL.heal, storm: DECAL.lightning } as const)[this.theme];
    this.halo = style < 0 ? null : d(this.R * .86, style, pal.main, pal.hot, .4, 3);
    this.haloId = this.halo ? this.halo.id : 0;
    if (summon) this.summon();
  }

  hide(): void {
    this.fade(this.base, this.baseId, .15); this.fade(this.halo, this.haloId, .15);
    this.on = false; this.running = false; this.epoch++;
  }

  /** Facing of the hero (rotation.y of the stage root): effects that come out of its front follow it. */
  setYaw(yaw: number): void { this.yaw = yaw; }

  /** Light pillar, two rings, a flash and a fan of sparks: "a new hero is summoned onto the pedestal". */
  summon(): void {
    const k = this.k, p = this.pal, x = this.x, z = this.z, y = this.top;
    if (!p) return;
    const dim = this.dim, ep = this.epoch;
    lightColumn(k, x, y, z, 1.9, 12, p.main, p.hot, .9, .16, .7 * dim);
    k.mesh.ring({ x, y: y + .1, z, r0: .8, r1: this.R * 1.5, color: p.hot, life: .65, width: .06, alpha: .95 });
    k.tl.at(.12, () => { if (ep === this.epoch) k.mesh.ring({ x, y: y + .1, z, r0: .6, r1: this.R * 1.2, color: p.main, life: .7, width: .08, alpha: .8 }); });
    k.mesh.flash({ x, y: y + 2.2, z, s0: 3, s1: 8, color: p.hot, life: .4, alpha: .7 * dim });
    k.em.flash(x, y + 2.2, z, 3.6, p.hot, .18);
    k.em.sparkRing(x, y, z, 1.2, k.n(26), 5, p.hot, .6);
    for (let i = 0; i < k.n(30); i++) {
      const a = Math.random() * TAU, v = rnd(.6, 2.6);
      k.em.mote(x + Math.cos(a) * rnd(0, 1.6), y + rnd(.1, 1), z + Math.sin(a) * rnd(0, 1.6), Math.cos(a) * v, rnd(2, 6), Math.sin(a) * v, i % 3 ? p.main : p.hot, rnd(.9, 1.8), rnd(.4, .75), p.dark);
    }
    k.lightAt(x, y + 3, z, p.main, 1.8 * dim);
  }

  /** One of the show-off moves starts; its effect lands when the animation's strike does (a quarter of a second in). */
  cue(c: StageCue): void {
    const k = this.k, p = this.pal;
    this.running = c === 'run';
    if (!p || !this.on) return;
    const x = this.x, z = this.z, y = this.top, s = this.scale, fx = Math.sin(this.yaw), fz = Math.cos(this.yaw), ep = this.epoch;
    switch (c) {
      case 'attack':
      case 'attack2': {
        const side = c === 'attack' ? 1 : -1;
        k.tl.at(.22, () => {
          if (ep !== this.epoch) return;
          const hx = x + fx * 1.5 * s * .8, hz = z + fz * 1.5 * s * .8, hy = y + 1.5 * s;
          k.mesh.flash({ x: hx, y: hy, z: hz, s0: 1.4, s1: 4, color: p.hot, life: .18, alpha: .9 });
          const rot = k.screenAngle(-fz * side, .3, fx * side);
          for (let i = 0; i < 3; i++) k.em.oriented(SPR.streak, hx, hy + i * .12 - .12, hz, -fz * side * 3, .6, fx * side * 3, i ? p.main : p.hot, .22, 3.4 - i * .6, rot, true, p.dark);
          for (let i = 0; i < k.n(16); i++) {
            const a = rnd(-.9, .9), vx = fx * Math.cos(a) - fz * Math.sin(a), vz = fz * Math.cos(a) + fx * Math.sin(a), v = rnd(3, 8);
            k.em.spark(hx, hy, hz, vx * v, rnd(-1, 3.4), vz * v, i % 2 ? p.hot : p.main, rnd(.2, .45), .3);
          }
          this.accent(hx, hy, hz, .6);
          k.lightAt(hx, hy, hz, p.main, 1.4);
        });
        break;
      }
      case 'cast': {
        k.mesh.ring({ x, y: y + .1, z, r0: this.R * 1.1, r1: .8, color: p.hot, life: .3, width: .06, alpha: .9 });
        k.em.gather(x, y + 1.6 * s, z, 2.4, k.n(24), p.hot, .26, .42);
        k.tl.at(.28, () => { if (ep === this.epoch) this.castBurst(); });
        break;
      }
      case 'victory': {
        for (let n = 0; n < 4; n++) k.tl.at(.15 + n * .32, () => { if (ep === this.epoch) this.firework(n); });
        break;
      }
      default: break;
    }
  }

  /** The theme's own special on top of the generic burst. */
  private accent(x: number, y: number, z: number, k2: number): void {
    const k = this.k, p = this.pal!;
    switch (this.theme) {
      case 'arcane': for (let i = 0; i < k.n(3); i++) k.em.glyph(SPR.sparkle, x + rnd(-.5, .5), y + rnd(-.3, .5), z + rnd(-.5, .5), 0, rnd(.4, 1.4), 0, p.hot, rnd(.3, .5), rnd(.5, .9), 3); break;
      case 'shadow': for (let i = 0; i < k.n(3); i++) k.em.smoke(x, y, z, rnd(-.8, .8), rnd(.2, 1), rnd(-.8, .8), rnd(.7, 1.1), .6, 1.8, p.dark, .45 * k2 + .1, .3); break;
      case 'fire': for (let i = 0; i < k.n(6); i++) k.em.fire(x, y, z, rnd(-1.4, 1.4), rnd(.4, 2.2), rnd(-1.4, 1.4), rnd(.3, .5), rnd(.7, 1.1)); break;
      case 'nature': for (let i = 0; i < k.n(4); i++) k.em.glyph(SPR.leaf, x, y, z, rnd(-1.6, 1.6), rnd(.4, 1.8), rnd(-1.6, 1.6), i % 2 ? p.main : p.accent, rnd(.6, 1), rnd(.45, .7), 4, true, 1.5); break;
      case 'storm': for (let i = 0; i < 2; i++) k.mesh.bolt({ ax: x, ay: y, az: z, bx: x + rnd(-2, 2), by: y + rnd(-1.2, 1), bz: z + rnd(-2, 2), color: p.main, life: .14, width: .1, jitter: .5, rate: 40 }); break;
    }
  }

  private castBurst(): void {
    const k = this.k, p = this.pal;
    if (!p || !this.on) return;
    const x = this.x, z = this.z, y = this.top, cy = y + 1.8 * this.scale;
    const dim = this.dim;
    k.mesh.flash({ x, y: cy, z, s0: 2, s1: 6.5, color: p.hot, life: .3, alpha: .6 * dim });
    k.em.flash(x, cy, z, 3, p.hot, .14);
    k.mesh.ring({ x, y: y + .12, z, r0: .6, r1: this.R * 1.7, color: p.main, life: .6, width: .07, alpha: .95 });
    lightColumn(k, x, y, z, 1.1, 11, p.main, p.hot, .8, .12, .5 * dim);
    switch (this.theme) {
      case 'arcane':
        k.mesh.dome({ x, y: cy - .3, z, r0: 1.4, r1: 3.1, color: p.main, color2: p.hot, life: .7, style: 0, alpha: .75, fadeOut: .45 });
        k.mesh.decal({ x, z, r: this.R, style: DECAL.rune, color: p.hot, color2: p.main, life: .9, fadeIn: .05, fadeOut: .5, alpha: 1, flatY: this.top + .01, order: 5 });
        break;
      case 'shadow':
        k.mesh.decal({ x, z, r: this.R * 1.2, style: DECAL.shadow, color: p.main, color2: p.hot, life: 1, fadeIn: .08, fadeOut: .55, alpha: .95, flatY: this.top + .01, order: 5 });
        k.em.plume(x, cy - 1.2, z, k.n(7), 3, p.dark, 1.1);
        break;
      case 'fire':
        for (let i = 0; i < k.n(26); i++) { const a = Math.random() * TAU, v = rnd(1.2, 4.4); k.em.fire(x + Math.cos(a) * .6, y + .3, z + Math.sin(a) * .6, Math.cos(a) * v * .5, rnd(3, 7.5), Math.sin(a) * v * .5, rnd(.5, .9), rnd(.8, 1.4)); }
        for (let i = 0; i < k.n(14); i++) { const a = Math.random() * TAU, v = rnd(.5, 2.2); k.em.ember(x, y + 1, z, Math.cos(a) * v, rnd(2, 6), Math.sin(a) * v, COLORS.ember, rnd(1, 1.8), rnd(.18, .28), 2.2); }
        k.mesh.decal({ x, z, r: this.R, style: DECAL.fire, color: COLORS.fire, color2: COLORS.fireHot, life: .9, fadeIn: .08, fadeOut: .45, alpha: .9, flatY: this.top + .01, order: 5 });
        break;
      case 'nature':
        k.mesh.decal({ x, z, r: this.R, style: DECAL.heal, color: p.main, color2: p.hot, life: 1.1, fadeIn: .08, fadeOut: .6, alpha: .95, flatY: this.top + .01, order: 5 });
        for (let i = 0; i < k.n(22); i++) { const a = Math.random() * TAU, v = rnd(.6, 3); k.em.glyph(i % 4 ? SPR.leaf : SPR.plus, x + Math.cos(a) * .8, y + .6, z + Math.sin(a) * .8, Math.cos(a) * v, rnd(2, 5), Math.sin(a) * v, i % 2 ? p.main : p.hot, rnd(.9, 1.5), rnd(.4, .7), 4, true, 2.4); }
        break;
      case 'storm':
        for (let i = 0; i < 3; i++) k.tl.at(i * .1, () => lightningStrike(k, x + Math.cos(i * 2.1 + this.t) * 2.2, y, z + Math.sin(i * 2.1 + this.t) * 2.2, i % 2 ? COLORS.electric : p.main, { height: 11, width: .2, sparks: 10 }));
        k.mesh.decal({ x, z, r: this.R * 1.05, style: DECAL.lightning, color: p.main, color2: 0xffffff, life: .8, fadeIn: .04, fadeOut: .45, alpha: .95, flatY: this.top + .01, order: 5 });
        break;
    }
    for (let i = 0; i < k.n(24); i++) { const a = Math.random() * TAU, v = rnd(2.5, 7); k.em.spark(x, cy, z, Math.cos(a) * v, rnd(-1, 5), Math.sin(a) * v, i % 2 ? p.hot : p.main, rnd(.3, .6), .32); }
    k.lightAt(x, cy, z, p.main, 2 * dim);
  }

  /** Victory pose: golden / hero-coloured shells of sparks bursting over the pedestal. */
  private firework(n: number): void {
    const k = this.k, p = this.pal;
    if (!p || !this.on) return;
    const a0 = n * 1.9 + this.t, x = this.x + Math.cos(a0) * 1.7, z = this.z + Math.sin(a0) * 1.7, y = this.top + 4.4 + (n % 2) * 1.1;
    const c1 = n % 2 ? p.main : COLORS.gold, c2 = n % 2 ? p.hot : 0xfff2b0;
    k.mesh.flash({ x, y, z, s0: 1.2, s1: 4.2, color: c2, life: .24, alpha: .7 });
    k.em.flash(x, y, z, 2.2, c2, .1);
    const m = k.n(34);
    for (let i = 0; i < m; i++) {
      const u = rnd(-1, 1), a = i * 2.399963, r = Math.sqrt(1 - u * u), v = rnd(3.4, 5.4);
      k.em.spark(x, y, z, Math.cos(a) * r * v, u * v, Math.sin(a) * r * v, i % 3 ? c1 : c2, rnd(.7, 1.1), .3);
    }
    for (let i = 0; i < k.n(10); i++) { const a = Math.random() * TAU, v = rnd(1, 3); k.em.glyph(SPR.sparkle, x, y, z, Math.cos(a) * v, rnd(-1, 2.4), Math.sin(a) * v, c2, rnd(.6, 1), rnd(.5, .9), 3, true, 1.2); }
    k.lightAt(x, y, z, c1, 1.8);
  }

  /** Per frame (menu clock): the slow stream of theme motes, dust under a running hero. */
  update(dt: number): void {
    if (!this.on || dt <= 0 || !this.pal) return;
    const k = this.k, p = this.pal, a = this.acc, x = this.x, z = this.z, y = this.top;
    this.t += dt;
    a.a += dt * 11 * k.q;
    while (a.a >= 1) { // motes drifting up from the rune circle
      a.a--;
      const ang = Math.random() * TAU, r = rnd(.4, this.R * .92);
      k.em.mote(x + Math.cos(ang) * r, y + .1, z + Math.sin(ang) * r, rnd(-.12, .12), rnd(.7, 1.7), rnd(-.12, .12), Math.random() < .35 ? p.hot : p.main, rnd(1.4, 2.4), rnd(.3, .55), p.dark);
    }
    a.b += dt * 5 * k.q;
    while (a.b >= 1) {
      a.b--;
      const ang = Math.random() * TAU, r = rnd(.6, this.R * .85), px = x + Math.cos(ang) * r, pz = z + Math.sin(ang) * r;
      switch (this.theme) {
        case 'arcane': k.em.glyph(SPR.sparkle, px, y + rnd(.4, 3), pz, 0, rnd(.1, .5), 0, p.hot, rnd(.6, 1), rnd(.35, .6), 2); break;
        case 'shadow': k.em.smoke(px, y + .2, pz, rnd(-.2, .2), rnd(.5, 1), rnd(-.2, .2), rnd(1.2, 1.9), .8, 2.1, p.dark, .4, .4); break;
        case 'fire': k.em.ember(px, y + .2, pz, rnd(-.2, .2), rnd(.8, 1.6), rnd(-.2, .2), COLORS.ember, rnd(1.1, 1.9), rnd(.14, .24), 1.4); k.em.fire(px, y + .1, pz, 0, rnd(.4, 1), 0, rnd(.35, .6), rnd(.5, .85)); break;
        case 'nature': k.em.glyph(SPR.leaf, px, y + rnd(2.5, 4.5), pz, rnd(-.3, .3), rnd(-.2, .2), rnd(-.3, .3), Math.random() < .5 ? p.main : p.accent, rnd(1.6, 2.6), rnd(.4, .6), 3, true, .55); break;
        case 'storm': k.em.spark(px, y + .2, pz, rnd(-1, 1), rnd(1, 3), rnd(-1, 1), p.main, rnd(.2, .4), .26); break;
      }
    }
    if (this.theme === 'storm') { // now and then a small arc jumps between two points of the rim
      a.c += dt * 1.4 * k.q;
      if (a.c >= 1) {
        a.c = 0;
        const a1 = Math.random() * TAU, a2 = a1 + rnd(.8, 2.2), r = this.R * .9;
        k.mesh.bolt({ ax: x + Math.cos(a1) * r, ay: y + .25, az: z + Math.sin(a1) * r, bx: x + Math.cos(a2) * r, by: y + .25, bz: z + Math.sin(a2) * r, color: p.main, life: .16, width: .09, jitter: .55, rate: 50, alpha: .9 });
      }
    }
    if (this.running) { // dust kicked up under the feet of the running hero
      a.d += dt * 14 * k.q;
      while (a.d >= 1) {
        a.d--;
        const ang = Math.random() * TAU, r = rnd(.2, .9 * this.scale);
        k.em.dust(x + Math.cos(ang) * r, y + .15, z + Math.sin(ang) * r, rnd(-.5, .5), rnd(.2, .6), rnd(-.5, .5), rnd(.5, .8), .3, 1.1, lighten(0x6a6a7a, .1), .3);
      }
    }
  }

  reset(): void { this.base = this.halo = null; this.baseId = this.haloId = 0; this.on = false; this.running = false; this.pal = null; this.t = 0; this.epoch++; this.acc.a = this.acc.b = this.acc.c = this.acc.d = 0; }
}
