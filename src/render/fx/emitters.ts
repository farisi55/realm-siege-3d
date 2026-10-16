import * as THREE from 'three';
import { SPR } from './atlas';
import { ParticleLayer, newSpec } from './particles';
import type { PSpec } from './particles';

const C0 = new THREE.Color(), C1 = new THREE.Color();
const rnd = (a: number, b: number): number => a + Math.random() * (b - a);

/**
 * Typed particle emitters on top of the two layers: the vocabulary the effect recipes use (spark, flame, ember, smoke, dust, mote, ...).
 * Each call fills the one shared spec and emits a single particle; positions are world units (y up), colors are hex numbers.
 */
export class Emitters {
  private sp: PSpec = newSpec();
  constructor(readonly add: ParticleLayer, readonly alp: ParticleLayer) {}

  private base(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, s0: number, s1: number, c0: number, c1: number, a: number, tex: number): PSpec {
    const s = this.sp;
    s.x = x; s.y = y; s.z = z; s.vx = vx; s.vy = vy; s.vz = vz; s.life = life; s.s0 = s0; s.s1 = s1; s.a = a; s.tex = tex;
    s.fadeIn = 0; s.g = 0; s.drag = 0; s.rot = 0; s.vrot = 0;
    C0.setHex(c0); C1.setHex(c1);
    s.r0 = C0.r; s.g0 = C0.g; s.b0 = C0.b; s.r1 = C1.r; s.g1 = C1.g; s.b1 = C1.b;
    return s;
  }
  private dim(c: number, k: number): number { C0.setHex(c).multiplyScalar(k); return C0.getHex(); }

  /** Short bright streak that falls: hit sparks, debris sparks, electricity. */
  spark(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: number, life = .4, size = .3): void {
    const s = this.base(x, y, z, vx, vy, vz, life, size, size * .25, 0xffffff, color, 1, SPR.star);
    s.g = 14; s.drag = .8; s.rot = Math.random() * 6.28;
    this.add.emit(s);
  }
  /** A flame lick: rises, shrinks and cools from `c0` to `c1`. */
  fire(x: number, y: number, z: number, vx: number, vy: number, vz: number, life = .6, size = 1, c0 = 0xffe9a0, c1 = 0xff3a08): void {
    const s = this.base(x, y, z, vx, vy, vz, life, size * .55, size * 1.1, c0, c1, .95, SPR.flame);
    s.g = -3.5; s.drag = 1.2; s.fadeIn = .12; s.rot = (Math.random() - .5) * .5; s.vrot = (Math.random() - .5) * 1.2;
    this.add.emit(s);
  }
  /** A glowing round particle that drifts: embers, souls, pollen. */
  ember(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: number, life = 1, size = .22, rise = 1.5): void {
    const s = this.base(x, y, z, vx, vy, vz, life, size, size * .3, 0xffffff, color, 1, SPR.ember);
    s.g = -rise; s.drag = .9;
    this.add.emit(s);
  }
  /** A soft glow dot: healing motes, magic dust, the trail of a projectile. */
  mote(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: number, life = 1, size = .5, c1 = color): void {
    const s = this.base(x, y, z, vx, vy, vz, life, size, size * .4, color, c1, .85, SPR.glow);
    s.drag = 1.1; s.fadeIn = .15;
    this.add.emit(s);
  }
  /** A glyph from the atlas (plus, leaf, bubble, shard, ring, star) with spin. */
  glyph(tex: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, color: number, life = 1, size = .6, spin = 2, additive = true, gravity = 0, c1 = color): void {
    const s = this.base(x, y, z, vx, vy, vz, life, size, size * (additive ? .7 : 1), color, c1, additive ? .95 : .9, tex);
    s.g = gravity; s.drag = .7; s.fadeIn = .1; s.rot = Math.random() * 6.28; s.vrot = (Math.random() - .5) * spin * 2;
    (additive ? this.add : this.alp).emit(s);
  }
  /** A sprite with a fixed rotation (streaks and arrows lying along a direction: see `Kit.screenAngle`). */
  oriented(tex: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, color: number, life: number, size: number, rot: number, additive = true, c1 = color): void {
    const s = this.base(x, y, z, vx, vy, vz, life, size, size * .8, color, c1, additive ? .95 : .9, tex);
    s.rot = rot;
    (additive ? this.add : this.alp).emit(s);
  }
  /** Soft smoke that grows and fades (alpha-blended, so it can be dark). */
  smoke(x: number, y: number, z: number, vx: number, vy: number, vz: number, life = 1.6, s0 = .8, s1 = 2.4, color = 0x3a3a46, alpha = .55, rise = .6): void {
    const s = this.base(x, y, z, vx, vy, vz, life, s0, s1, color, this.dim(color, .7), alpha, SPR.puffA + ((Math.random() * 3) | 0));
    s.g = -rise; s.drag = 1.4; s.fadeIn = .2; s.rot = Math.random() * 6.28; s.vrot = (Math.random() - .5) * 1.1;
    this.alp.emit(s);
  }
  /** Dust and dirt: like smoke but heavier and lighter-colored. */
  dust(x: number, y: number, z: number, vx: number, vy: number, vz: number, life = 1.1, s0 = .9, s1 = 2.8, color = 0x9a8a6c, alpha = .5): void {
    const s = this.base(x, y, z, vx, vy, vz, life, s0, s1, color, this.dim(color, .85), alpha, Math.random() < .5 ? SPR.puffB : SPR.puffC);
    s.g = -.1; s.drag = 2.4; s.fadeIn = .12; s.rot = Math.random() * 6.28; s.vrot = (Math.random() - .5) * .8;
    this.alp.emit(s);
  }
  /** A chunk of rubble: falls with gravity and spins. */
  chunk(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: number, life = 1, size = .35): void {
    const s = this.base(x, y, z, vx, vy, vz, life, size, size * .6, color, this.dim(color, .5), .95, Math.random() < .5 ? SPR.square : SPR.shard);
    s.g = 16; s.drag = .35; s.rot = Math.random() * 6.28; s.vrot = (Math.random() - .5) * 14;
    this.alp.emit(s);
  }
  /** A very short, big, bright glow: the flash of an explosion (use Sprites for the very big ones). */
  flash(x: number, y: number, z: number, size: number, color: number, life = .16): void {
    const s = this.base(x, y, z, 0, 0, 0, life, size, size * 1.5, 0xffffff, color, .9, SPR.core);
    this.add.emit(s);
  }

  // ---- composites ----

  /** Radial spray with an upward bias and gravity: the classic `burst`. */
  burst(x: number, y: number, z: number, color: number, n: number, speed: number, life: number): void {
    n = Math.min(n, this.add.free);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, e = Math.random() * 1.3, v = speed * (.4 + Math.random());
      this.spark(x, y, z, Math.cos(a) * v, e * v + speed * .3, Math.sin(a) * v, color, life * (.6 + Math.random() * .7), .34);
    }
  }
  /** `n` sparks flying out in a flat disc at ground level (a shockwave's debris). */
  sparkRing(x: number, y: number, z: number, radius: number, n: number, speed: number, color: number, life = .5): void {
    for (let i = 0; i < n; i++) {
      const a = i / n * 6.283 + Math.random() * .3, v = speed * (.7 + Math.random() * .6), c = Math.cos(a), s = Math.sin(a);
      this.spark(x + c * radius, y + .15, z + s * radius, c * v, speed * .22 * Math.random(), s * v, color, life * (.7 + Math.random() * .6), .28);
    }
  }
  /** A ring of dust puffs that races outwards and settles. */
  dustRing(x: number, y: number, z: number, radius: number, n: number, speed: number, color = 0x9a8a6c, size = 1.4): void {
    for (let i = 0; i < n; i++) {
      const a = i / n * 6.283 + Math.random() * .4, v = speed * (.75 + Math.random() * .5), c = Math.cos(a), s = Math.sin(a);
      this.dust(x + c * radius, y + .25, z + s * radius, c * v, .5 + Math.random() * .8, s * v, .9 + Math.random() * .6, size * .6, size * 1.9, color, .5);
    }
  }
  /** Pieces flying up and out. */
  debris(x: number, y: number, z: number, n: number, speed: number, color = 0x6a5a48, spread = 1): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, v = speed * (.3 + Math.random() * .7) * spread;
      this.chunk(x + Math.cos(a) * .3, y + .3, z + Math.sin(a) * .3, Math.cos(a) * v, speed * (.7 + Math.random() * .8), Math.sin(a) * v, color, .8 + Math.random() * .7, .25 + Math.random() * .3);
    }
  }
  /** A rising column of smoke puffs. */
  plume(x: number, y: number, z: number, n: number, height: number, color = 0x2c2c34, size = 1.2): void {
    for (let i = 0; i < n; i++) {
      this.smoke(x + rnd(-.8, .8), y + rnd(0, .6), z + rnd(-.8, .8), rnd(-.4, .4), height * rnd(.25, .5), rnd(-.4, .4), rnd(1.4, 2.4), size * rnd(.7, 1), size * rnd(2, 3.2), color, .5, .4);
    }
  }
  /** `n` particles converging on a point from a ring (charge-up). */
  gather(x: number, y: number, z: number, radius: number, n: number, color: number, life = .25, size = .4): void {
    n = Math.min(n, this.add.free);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, e = rnd(-.4, .9), r = radius * rnd(.7, 1.1), px = Math.cos(a) * r, pz = Math.sin(a) * r, py = e * radius * .5;
      this.mote(x + px, y + py, z + pz, -px / life * .9, -py / life * .9, -pz / life * .9, color, life, size);
    }
  }
}
