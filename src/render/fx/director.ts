import { app } from '../../game/state';
import { HR, K, TCOL } from '../../game/config';
import type { Ability, AbilityType, Unit } from '../../game/types';
import { groundY } from '../ground';
import type { Kit } from './kit';
import type { DecalSlot } from './mesh';
import { DECAL } from './mesh';
import { abilityFx, auraStep, boltImpact, healOne } from './abilities';
import type { AbilityFx, AuraKind, CastCtx } from './abilities';
import { endProj, newVis, stepProj } from './projectiles';
import type { ProjVis } from './projectiles';
import {
  bossDeath, bossSlam, campBuff, coreDown, enrage, heroDeath, hitSpark, levelUp, minionDeath, respawn, rnd, shockwave, structureArc, structureDamage, towerDown,
} from './recipes';
import { COLORS, paletteOf } from './style';

/** One ability cast being tracked from its first frame until the simulation applies it (0.25 s later). */
interface Cast {
  h: Unit; i: number; ab: Ability; fn: AbilityFx; ctx: CastCtx;
  /** Simulation time at the start and when the simulation applies the ability. */ t0: number; tEv: number;
  /** Aim angle and distance to the aimed point (logic units), as the simulation computed them. */ an: number; dd: number;
  resolved: boolean;
  /** Caster position on the previous frame (a dash starts there). */ lx: number; ly: number;
  tele: DecalSlot | null; teleId: number;
}

/** The kinds of things the unit-at-a-point scans look for. */
const aim0 = { x: 0, y: 0, sx: 0, sy: 0, t: -1 };

/** Approximate body height of a unit in world units, for placing effects on it. */
export function bodyHeight(u: Unit): number {
  switch (u.k) {
    case 'hero': return 2.5;
    case 'tower': return 6;
    case 'core': return 5;
    case 'siege': return 1.5;
    case 'neutral': return u.boss ? 5.6 : 2;
    default: return 1.7;
  }
}

/** Per-structure fractional emission counts, kept by units.ts on the render object. */
export interface StructAcc { s: number; f: number; e: number; arc: number; i: number; }
export const newStructAcc = (): StructAcc => ({ s: 0, f: 0, e: 0, arc: 0, i: 0 });

/**
 * Turns what the simulation does into effects without the simulation knowing effects exist.
 *
 *  - `onFx` receives the untyped ring / flash calls of `hooks.fx` and recognises each by its signature (radius, duration, colour) and by
 *    what is standing at that point (a dead hero, a tower, a hero that has just cast), then plays the matching recipe.
 *  - `update` senses ability casts from the cooldown arrays (a cooldown that jumps up is a cast), shows a telegraph, and plays the
 *    ability's recipe at the moment the simulation applies it, at the exact centre it computed. It also gives every projectile a look and
 *    runs the buff auras.
 *
 * It only READS the simulation (`app`); it never writes to it.
 */
export class Director {
  private pacd = new Map<Unit, number[]>();
  private casts: Cast[] = [];
  private proj = new Map<any, ProjVis>();
  private auras = new Map<Unit, { kind: AuraKind; acc: { a: number; b: number; c: number } }>();
  private stamp = 0; private tick = 0; private hitBudget = 16;
  private lastDmg = { x: -1, amount: 0, magic: false };
  private impacts: { x: number; z: number }[] = [];
  private aim = aim0;
  /** Counters for tests and the debug overlay. */
  stats = { casts: 0, resolved: 0, cancelled: 0, hits: 0, deaths: 0, unknown: 0 };

  constructor(readonly k: Kit) {}

  // ------------------------------------------------------------------------------------------------------------ simulation hooks

  /** `hooks.ft`: damage numbers come right before the hit flash of the same `hurt()` call; remember them so the hit can be sized. */
  onFt(x: number, _y: number, s: string | number, c: string): void {
    if (typeof s === 'number' && (c === '#ffffff' || c === '#9fd0ff')) { this.lastDmg.x = x; this.lastDmg.amount = s; this.lastDmg.magic = c === '#9fd0ff'; }
  }

  /** `hooks.fx(x, y, r, l, c)`: x / y logic units, r logic radius, l seconds, c colour. Recognised by signature, see the table in the README. */
  onFx(x: number, y: number, r: number, l: number, c: number): void {
    const is = (v: number, t: number) => Math.abs(v - t) < .011;
    if (is(l, .25) && r === 12 && c === 0xffffff) return this.hit(x, y);
    if (is(l, .3) && r === 40) return this.castRingOrImpact(x, y, c);
    if (is(l, .5)) return r === 30 && c === 0x6fff8a ? this.healAlly(x, y) : this.blast(x, y, r, c);
    if (is(l, .6)) {
      if (r === 70) return this.buff(x, y, c);
      if (r === 50 && c === 0xffd04a) { if (this.k.vis(x * K, y * K)) campBuff(this.k, x * K, groundY(x, y), y * K); return; }
      return this.death(x, y, r, c);
    }
    if (is(l, .8) && r === 60 && c === 0xffe066) { if (this.k.vis(x * K, y * K, 1.5)) levelUp(this.k, x * K, groundY(x, y), y * K); return; }
    if (is(l, .9) && r === 160 && c === 0xffaa44) return this.towerDestroyed(x, y);
    if (is(l, 1) && r === 260 && c === 0xff2a2a) { enrage(this.k, x * K, groundY(x, y), y * K); return; }
    this.stats.unknown++;
    shockwave(this.k, x * K, groundY(x, y), y * K, Math.max(1.5, r * K), { color: c, life: Math.max(.3, l) });
  }

  /** The player is about to cast at (x, y): the exact aim point and the caster position at that moment (input.ts calls this). */
  setAim(x: number, y: number): void {
    const me = app.me;
    if (!me || !app.G) return;
    this.aim = { x, y, sx: me.x, sy: me.y, t: app.G.t };
  }

  /** A hero that was dead has come back (units.ts senses it from the render side: the simulation emits nothing for it). */
  heroRespawn(u: Unit): void {
    const k = this.k, x = u.x * K, z = u.y * K;
    respawn(k, x, groundY(u.x, u.y), z, paletteOf(u.def?.n, u.def?.c ?? TCOL[u.team]), u === app.me);
  }

  // ------------------------------------------------------------------------------------------------------------ recognising calls

  private unitAt(x: number, y: number, dead?: boolean): Unit | null {
    for (const u of app.all) if (u.x === x && u.y === y && (dead === undefined || !!u.dead === dead)) return u;
    return null;
  }

  private hit(x: number, y: number): void {
    const k = this.k, wxp = x * K, wzp = y * K, d = this.lastDmg;
    const ok = d.amount > 0 && Math.abs(d.x - x) < 1e-6, dmg = ok ? d.amount : 0, magic = ok && d.magic;
    d.amount = 0;
    if (this.hitBudget <= 0 || !k.vis(wxp, wzp, 1.35)) return;
    this.hitBudget--; this.stats.hits++;
    const u = this.unitAt(x, y), f = u ? dmg / Math.max(1, u.max) : .05, gy = groundY(x, y);
    hitSpark(k, wxp, gy + (u ? bodyHeight(u) * .6 : 1), wzp, f, magic, !!u && (u.k === 'tower' || u.k === 'core'));
    if (u && u === app.me && f > .07) k.cam.shake(Math.min(.3, f * .9), wxp, wzp, .6);
  }

  /** (40, .3): either the ring at a caster's feet (the cast itself is sensed in `update`) or the impact of a hero bolt. */
  private castRingOrImpact(x: number, y: number, c: number): void {
    for (const u of app.all) {
      if (u.k !== 'hero' || u.dead || u.x !== x || u.y !== y || u.def.c !== c) continue;
      for (let i = 0; i < 4; i++) if (u.acd[i] === u.def.ab[i][3]) return; // this hero has just cast
    }
    const k = this.k, def = HR.find(d => d.c === c), wxp = x * K, wzp = y * K;
    this.impacts.push({ x: wxp, z: wzp });
    if (!k.vis(wxp, wzp, 1.35)) return;
    boltImpact(k, def?.n, wxp, groundY(x, y) + 1.4, wzp, paletteOf(def?.n, c));
    if (app.me && Math.hypot(app.me.x - x, app.me.y - y) < 60) k.cam.shake(.06, wxp, wzp, .5);
  }

  /** (r, .5): the blast of an aoe / tgt / dash ability (exact centre), or a boss slam. */
  private blast(x: number, y: number, r: number, c: number): void {
    const q = this.match(['aoe', 'tgt', 'dash'], x, y, r, c);
    if (q) return this.resolve(q, x, y);
    const k = this.k, wxp = x * K, wzp = y * K, gy = groundY(x, y);
    if (r === 170 && c === COLORS.boss) { bossSlam(k, wxp, gy, wzp, r * K); return; }
    this.stats.unknown++;
    shockwave(k, wxp, gy, wzp, Math.max(1.5, r * K), { color: c, dust: 1, sparks: 12 });
  }

  /** (70, .6, hero colour): the caster's buff takes hold. */
  private buff(x: number, y: number, c: number): void {
    const q = this.match(['buff'], x, y, null, c);
    if (q) return this.resolve(q, x, y);
    this.k.mesh.ring({ x: x * K, y: groundY(x, y) + .3, z: y * K, r0: .6, r1: 3, color: c, life: .6, width: .08, rise: 2.4, alpha: .8 });
  }

  /** (30, .5, green): one ally healed. The first one of a heal cast also plays the caster's area effect. */
  private healAlly(x: number, y: number): void {
    const k = this.k, G = app.G;
    if (k.vis(x * K, y * K, 1.4)) healOne(k, x * K, groundY(x, y), y * K);
    for (const q of this.casts) {
      if (q.resolved || q.ab[2] !== 'heal' || G.t < q.tEv - .03 || q.h.dead) continue;
      if (Math.hypot(q.h.x - x, q.h.y - y) <= q.ab[6] + 1) { this.resolve(q, q.h.x, q.h.y); break; }
    }
  }

  /** (r = 3 x unit radius, .6): a unit died. What it was decides the show. */
  private death(x: number, y: number, _r: number, c: number): void {
    const k = this.k, u = this.unitAt(x, y, true), wxp = x * K, wzp = y * K, gy = groundY(x, y);
    this.stats.deaths++;
    if (!u) { shockwave(k, wxp, gy, wzp, 2, { color: c, life: .4 }); return; }
    const near = k.vis(wxp, wzp, 1.35);
    switch (u.k) {
      case 'hero': if (near) heroDeath(k, wxp, gy, wzp, paletteOf(u.def.n, u.def.c), u === app.me); break;
      case 'tower': break; // the destroyed-tower call that follows plays the explosion
      case 'core': coreDown(k, wxp, gy, wzp, TCOL[u.team]); k.cam.focus?.(wxp, wzp); break;
      case 'neutral': if (u.boss) bossDeath(k, wxp, gy, wzp); else if (near) minionDeath(k, wxp, gy, wzp, 0xb28cff, 1.1); break;
      case 'siege': if (near) minionDeath(k, wxp, gy, wzp, TCOL[u.team], 1.5); break;
      default: if (near) minionDeath(k, wxp, gy, wzp, TCOL[u.team], 1);
    }
  }

  private towerDestroyed(x: number, y: number): void {
    const u = this.unitAt(x, y, true);
    towerDown(this.k, x * K, groundY(x, y), y * K, TCOL[u ? u.team : 0]);
  }

  // ------------------------------------------------------------------------------------------------------------ casts

  /** The pending cast the simulation is resolving right now: right type, hero colour, radius, time reached, nearest centre. */
  private match(types: AbilityType[], x: number, y: number, r: number | null, c: number): Cast | null {
    const G = app.G;
    let best: Cast | null = null, bd = 1e12;
    for (const q of this.casts) {
      if (q.resolved || !types.includes(q.ab[2]) || q.h.def.c !== c || G.t < q.tEv - .03) continue;
      const T = q.ab[2];
      if (r !== null && Math.abs((T === 'dash' ? 130 : q.ab[6]) - r) > .5) continue;
      const [cx, cy] = this.center(q), d = (cx - x) ** 2 + (cy - y) ** 2;
      if (d < bd) { bd = d; best = q; }
    }
    return best;
  }

  /** Where the simulation will centre this cast, from the caster's current position (the same formula the simulation uses). */
  private center(q: Cast): [number, number] {
    const h = q.h, T = q.ab[2];
    if (T === 'tgt') { const d = Math.min(q.dd, 650); return [h.x + Math.cos(q.an) * d, h.y + Math.sin(q.an) * d]; }
    if (T === 'dash') { const d = Math.min(q.dd, q.ab[6]); return [h.x + Math.cos(q.an) * d, h.y + Math.sin(q.an) * d]; }
    return [h.x, h.y];
  }

  private begin(h: Unit, i: number): void {
    const k = this.k, G = app.G, def = h.def, ab: Ability = def.ab[i], T = ab[2], pal = paletteOf(def.n, def.c);
    let tx: number, ty: number, sx = h.x, sy = h.y;
    const a = this.aim;
    if (h === app.me && a.t >= 0 && G.t - a.t < .15) { tx = a.x; ty = a.y; sx = a.sx; sy = a.sy; }
    else if (h.tgt && !h.tgt.dead) { tx = h.tgt.x; ty = h.tgt.y; }
    else { const an = h.fa ?? 0; tx = h.x + Math.cos(an) * 350; ty = h.y + Math.sin(an) * 350; }
    const dd = Math.hypot(tx - sx, ty - sy), an = Math.atan2(ty - sy, tx - sx);
    const ctx: CastCtx = {
      type: T, idx: i, name: ab[0], pal, team: h.team, x: h.x * K, y: groundY(h.x, h.y), z: h.y * K, tx: 0, ty: 0, tz: 0,
      dx: Math.cos(an), dz: Math.sin(an),
      R: T === 'dash' ? 130 * K : T === 'aoe' || T === 'tgt' || T === 'heal' ? ab[6] * K : 0,
      range: T === 'bolt' || T === 'dash' ? ab[6] * K : 0, stun: (T === 'aoe' || T === 'tgt' ? ab[7] || 0 : 0) / 1000, mine: h === app.me, fx: h.x * K, fz: h.y * K,
    };
    const q: Cast = { h, i, ab, fn: abilityFx(def.n, i, T), ctx, t0: G.t, tEv: G.t + .25, an, dd, resolved: false, lx: h.x, ly: h.y, tele: null, teleId: 0 };
    const [cx, cy] = this.center(q);
    ctx.tx = cx * K; ctx.tz = cy * K; ctx.ty = groundY(cx, cy);
    this.stats.casts++;
    if (k.vis(ctx.x, ctx.z, 1.4)) {
      q.fn.wind?.(k, ctx);
      if (T === 'aoe' || T === 'tgt' || T === 'dash' || T === 'heal') {
        const t = k.mesh.decal({ x: ctx.tx, z: ctx.tz, r: Math.max(1.5, ctx.R), style: T === 'heal' ? DECAL.rune : DECAL.aim, color: pal.main, color2: pal.hot, life: .38, fadeIn: .04, fadeOut: .14, alpha: T === 'heal' ? .5 : .85, manual: true });
        if (t) { q.tele = t; q.teleId = t.id; }
      }
    }
    this.casts.push(q);
  }

  private teleOf(q: Cast): DecalSlot | null { const t = q.tele; return t && t.on && t.id === q.teleId ? t : null; }

  private resolve(q: Cast, cx: number, cy: number): void {
    const k = this.k, c = q.ctx, h = q.h, T = q.ab[2];
    q.resolved = true; this.stats.resolved++;
    c.x = h.x * K; c.z = h.y * K; c.y = groundY(h.x, h.y);
    if (T === 'dash') { c.fx = q.lx * K; c.fz = q.ly * K; }
    if (T === 'aoe' || T === 'tgt' || T === 'dash') { c.tx = cx * K; c.tz = cy * K; c.ty = groundY(cx, cy); } else { c.tx = c.x; c.tz = c.z; c.ty = c.y; }
    const tele = this.teleOf(q); if (tele) tele.life = Math.min(tele.life, tele.age + .1);
    if (k.vis(c.x, c.z, 1.5) || k.vis(c.tx, c.tz, 1.5)) q.fn.resolve(k, c);
  }

  private updateCasts(dt: number): void {
    const G = app.G;
    // detect: a cooldown that went up is a cast (the simulation sets `acd[i]` to the full cooldown when it starts one)
    if (dt > 0) for (const h of app.all) {
      if (h.k !== 'hero' || !h.acd) continue;
      let p = this.pacd.get(h);
      if (!p) { this.pacd.set(h, p = h.acd.slice()); continue; }
      for (let i = 0; i < 4; i++) { if (h.acd[i] > p[i] + 1e-4 && !h.dead) this.begin(h, i); p[i] = h.acd[i]; }
    }
    for (let n = this.casts.length - 1; n >= 0; n--) {
      const q = this.casts[n], h = q.h;
      if (!q.resolved) {
        const tele = this.teleOf(q);
        if (tele) {
          const [cx, cy] = this.center(q);
          tele.prog = Math.min(1, (G.t - q.t0) / .25);
          tele.place(cx * K, cy * K, tele.r);
        }
        if (dt > 0) { q.lx = h.x; q.ly = h.y; }
        const T = q.ab[2];
        if (G.t >= q.tEv - 1e-6) {
          // bolts, heals and buffs apply on time; aoe / tgt / dash are resolved by their blast call, and never come if the caster died
          if (!h.dead && (T === 'bolt' || T === 'heal' || T === 'buff') && G.t >= q.tEv + (T === 'bolt' ? 0 : .06)) this.resolve(q, h.x, h.y);
          else if (G.t > q.tEv + .08) { q.resolved = true; this.stats.cancelled++; const t2 = this.teleOf(q); if (t2) t2.life = Math.min(t2.life, t2.age + .08); }
        }
      }
      if (G.t > q.tEv + .5) this.casts.splice(n, 1);
    }
  }

  // ------------------------------------------------------------------------------------------------------------ projectiles

  private updateProjectiles(dt: number): void {
    const k = this.k, st = ++this.stamp;
    for (const p of app.P) {
      if (p.dead) continue;
      let v = this.proj.get(p);
      if (!v) { v = newVis(p, paletteOf(p.mg ? p.s?.def?.n : undefined, p.col)); this.proj.set(p, v); }
      v.seen = st;
      let dx: number, dz: number;
      if (p.t) {
        dx = p.t.x - p.x; dz = p.t.y - p.y; const d = Math.hypot(dx, dz) || 1;
        if (!v.d0) v.d0 = Math.max(60, d);
        dx /= d; dz /= d;
        const f = 1 - Math.min(1, d / v.d0), hy = v.h0 + (v.h1 - v.h0) * f * f;
        this.stepOne(v, p.x, p.y, hy, dx, dz, dt);
      } else {
        const sp = Math.hypot(p.vx, p.vy) || 1; dx = p.vx / sp; dz = p.vy / sp;
        this.stepOne(v, p.x, p.y, v.h0, dx, dz, dt);
      }
    }
    for (const [p, v] of this.proj) {
      if (v.seen === st) continue;
      let hit = false;
      for (const im of this.impacts) if (Math.hypot(im.x - v.x, im.z - v.z) < 3.2) { hit = true; break; }
      if (!p.mg) hit = true; // basic attacks have no fizzle
      if (k.vis(v.x, v.z, 1.4)) endProj(k, v, hit);
      this.proj.delete(p);
    }
  }

  private stepOne(v: ProjVis, lx: number, ly: number, h: number, dx: number, dz: number, dt: number): void {
    const k = this.k, x = lx * K, z = ly * K;
    if (!k.vis(x, z, 1.3)) { v.x = x; v.y = groundY(lx, ly) + h; v.z = z; v.init = true; return; }
    stepProj(k, v, x, groundY(lx, ly) + h, z, dx, dz, dt);
  }

  // ------------------------------------------------------------------------------------------------------------ auras and structures

  private updateAuras(dt: number): void {
    const k = this.k;
    for (const h of app.all) {
      if (h.k !== 'hero') continue;
      const on = !h.dead && h.bf > 0 && h.bm > 1;
      let a = this.auras.get(h);
      if (!on) { if (a) this.auras.delete(h); continue; }
      if (!a) this.auras.set(h, a = { kind: 'camp', acc: { a: 0, b: 0, c: 0 } });
      a.kind = h.def.n === 'Shadow Huntress' && h.bm >= 1.55 ? 'smoke' : h.def.n === 'Storm Warrior' && h.bm >= 1.7 ? 'storm' : 'camp';
      auraStep(k, a.kind, h.x * K, groundY(h.x, h.y), h.y * K, paletteOf(h.def.n, h.def.c), dt, a.acc);
    }
  }

  /** Per-frame smoke, fire, sparks and arcs of one tower / core (units.ts calls this for each structure that is on screen). */
  structure(u: Unit, acc: StructAcc, dt: number): void {
    const k = this.k, x = u.x * K, z = u.y * K, y = groundY(u.x, u.y), hp = u.hp / u.max, core = u.k === 'core', col = TCOL[u.team];
    if (dt <= 0 || !k.vis(x, z, 1.1)) return;
    const top = y + (core ? 6.4 : 5.8);
    structureDamage(k, x, y, z, top, hp, core, col, dt, acc);
    if (hp < .3) { acc.arc += dt * (core ? 2.2 : 1.1) * k.q; if (acc.arc >= 1) { acc.arc = 0; structureArc(k, x, y, z, top - (core ? 2.6 : 1.4), col); } }
    // idle: a few motes drifting around the crystal
    acc.i += dt * (core ? 7 : 2.4) * k.q;
    while (acc.i >= 1) {
      acc.i--;
      const a = Math.random() * Math.PI * 2, r = core ? rnd(2.4, 3.4) : rnd(.8, 1.3), cy = y + (core ? 3.6 : 5.2);
      k.em.mote(x + Math.cos(a) * r, cy + rnd(-.8, .8), z + Math.sin(a) * r, -Math.sin(a) * 1.1, rnd(.2, 1), Math.cos(a) * 1.1, col, rnd(.8, 1.5), core ? .5 : .34, 0xffffff);
    }
  }

  // ------------------------------------------------------------------------------------------------------------ frame

  /** Advances casts, projectiles and auras. Particle / mesh / timeline stepping is the facade's job (vfx.ts). */
  update(dt: number): void {
    this.tick++; this.hitBudget = 16;
    if (!app.G) { this.impacts.length = 0; return; }
    this.updateCasts(dt);
    if (dt > 0) { this.updateProjectiles(dt); this.updateAuras(dt); }
    this.impacts.length = 0;
  }

  reset(): void {
    this.pacd.clear(); this.casts.length = 0; this.proj.clear(); this.auras.clear(); this.impacts.length = 0;
    this.lastDmg.amount = 0; this.aim = aim0; this.hitBudget = 16;
    this.stats = { casts: 0, resolved: 0, cancelled: 0, hits: 0, deaths: 0, unknown: 0 };
  }

  /** Number of casts and projectiles being tracked (tests). */
  get tracked(): { casts: number; projectiles: number; auras: number } { return { casts: this.casts.length, projectiles: this.proj.size, auras: this.auras.size }; }
}
