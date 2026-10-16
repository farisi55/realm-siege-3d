import { K } from '../../game/config';
import { OB } from '../../game/map';
import { ARENA, RING, RIVER, STAGE, WATER_Y, WORLD, riverDist, terrainAt } from './height';
import { BASES, BOSS_PIT, CAMPS, PAD_R, PLAZA_R, SHRINES, SPRING, TOWERS, nearest } from './layout';
import { hash2, mix, mulberry32, smooth } from './rand';
import { laneDist } from './splat';
import type { Occluder } from './splat';

/**
 * Where every plant, rock and crystal stands. Pure and seeded: the same world on every run, and the tests can check it without a GPU.
 *
 * Tall things (trees, boulders) stand only where the simulation has its 80 obstacle circles (`OB`), so what looks solid is solid:
 * heroes and creeps walk anywhere else, and a trunk in the middle of a lane would be a lie. Everywhere else only low growth
 * (grass, ferns, flowers, bushes) fills the ground that is not a road, a plaza, a pad, a camp clearing or the river shore.
 * Outside the map a forest covers the hills.
 */

export interface Inst {
  /** World position (y is the ground height there). */
  x: number; y: number; z: number;
  /** Uniform scale, extra vertical scale, rotation about y. */
  s: number; sy: number; ry: number;
  /** 0..1: a tint (brightness for plants; the hue for crystals). */
  t: number;
}
export type Species = 'pine' | 'oak' | 'jungle' | 'bush' | 'fern' | 'grass' | 'flowers' | 'rock' | 'crystal' | 'mushrooms' | 'pineLow' | 'oakLow';
export const SPECIES: Species[] = ['pine', 'oak', 'jungle', 'bush', 'fern', 'grass', 'flowers', 'rock', 'crystal', 'mushrooms', 'pineLow', 'oakLow'];
export type Lists = Record<Species, Inst[]>;
export interface Scatter { lists: Lists; occluders: Occluder[] }
/** Crystal hues, as the `t` of an instance. */
export const HUE = { cyan: .1, violet: .5, gold: .9 };

const CAMP_SITES = [...CAMPS, BOSS_PIT];
/** The jungle share of the ground: the same formula the ground painter uses for its dark forest floor. */
export const jungleWeight = (x: number, y: number): number => smooth(110, 330, laneDist(x, y)) * smooth(250, 520, nearest(BASES, x, y)) * smooth(95, 210, nearest(CAMP_SITES, x, y));
/** 0..1: how freely low plants may grow at a logic position with ground height `h`. Zero on roads, plazas, pads, clearings, the arena and the shore. */
export function growth(x: number, y: number, h: number): number {
  return smooth(105, 160, laneDist(x, y))
    * smooth(PLAZA_R + 10, PLAZA_R + 90, nearest(BASES, x, y))
    * smooth(PAD_R + 6, PAD_R + 40, nearest(TOWERS, x, y))
    * smooth(110, 160, nearest(CAMPS, x, y))
    * smooth(ARENA.flat + 25, ARENA.edge + 10, Math.hypot(x - BOSS_PIT.x, y - BOSS_PIT.y))
    * smooth(75, 110, nearest(SHRINES, x, y))
    * smooth(120, 170, Math.hypot(x - SPRING.x, y - SPRING.y))
    * mix(1, smooth(WATER_Y + .55, WATER_Y + .95, h), 1 - smooth(RIVER.bank - 55, RIVER.bank + 8, riverDist(x, y))); // the shore stays bare (only near the channel: low flat ground elsewhere is meadow)
}

const empty = (): Lists => Object.fromEntries(SPECIES.map(s => [s, [] as Inst[]])) as unknown as Lists;
/** How far (world units) a point is outside the playfield; 0 inside. */
export const outsideOf = (u: number, v: number): number => Math.hypot(Math.max(0, -u, u - WORLD), Math.max(0, -v, v - WORLD));

export interface ScatterOpts {
  /** Coarse spacing, for the tests. */
  test?: boolean;
}

export function scatter(o: ScatterOpts = {}): Scatter {
  const R = mulberry32(1337), L = empty(), occ: Occluder[] = [];
  const coarse = o.test ? 3.5 : 1;
  const put = (sp: Species, u: number, v: number, s: number, t = R(), sy = 1, ry = R() * 6.2832, dy = 0): void => {
    L[sp].push({ x: u, y: terrainAt(u, v) + dy, z: v, s, sy, ry, t });
  };
  const shade = (u: number, v: number, r: number, k: number): void => { occ.push({ x: u / K, y: v / K, r: r / K, k }); };

  // ---- the obstacle sites: a tree or a boulder cluster each (boulders in the river), with a little growth around it
  // wet: in or right beside the channel (low flat ground elsewhere is meadow)
  const dry = (u: number, v: number): boolean => terrainAt(u, v) > WATER_Y + .5 || riverDist(u / K, v / K) > RIVER.bank + 8;
  (OB as { x: number; y: number; r: number }[]).forEach((ob, i) => {
    const u = ob.x * K, v = ob.y * K, rad = ob.r * K, jw = jungleWeight(ob.x, ob.y);
    if (i % 3 === 0 || !dry(u, v)) {
      put('rock', u, v, rad * .95, R(), .8 + R() * .35);
      shade(u, v, rad * 1.35, .5);
      for (let k = 0, n = 2 + (R() * 2 | 0); k < n; k++) { const a = R() * 6.2832, d = rad * (.85 + R() * .5); put('rock', u + Math.cos(a) * d, v + Math.sin(a) * d, rad * (.28 + R() * .26), R(), .75 + R() * .4); shade(u + Math.cos(a) * d, v + Math.sin(a) * d, rad * .5, .3); }
    } else {
      const q = hash2(i, 3, 7);
      if (q < .12 + .62 * smooth(.4, .95, jw)) put('jungle', u, v, rad / 2.2 * (.92 + R() * .16));
      else if (hash2(i, 5, 9) < .5) put('oak', u, v, rad / 1.7 * (.92 + R() * .16));
      else put('pine', u, v, Math.min(1.35, rad / 1.3) * (.92 + R() * .16));
      shade(u, v, rad * 1.6, .55);
    }
    for (let k = 0, n = 2 + (R() * 3 | 0); k < n; k++) {
      const a = R() * 6.2832, d = rad * (1.1 + R() * .7), x = u + Math.cos(a) * d, z = v + Math.sin(a) * d, q = R();
      if (!dry(x, z)) continue;
      if (q < .5) put('bush', x, z, .75 + R() * .5); else if (q < .85) put('fern', x, z, .9 + R() * .5); else put('mushrooms', x, z, .9 + R() * .4);
      shade(x, z, .8, .3);
    }
    if (R() < .12 && dry(u + rad * 1.4, v - rad * .5)) put('crystal', u + rad * 1.4, v - rad * .5, .6 + R() * .4, jw > .5 ? HUE.violet : HUE.cyan);
  });

  // ---- low growth over the ground that is free
  const cell = 1.1 * coarse, n = Math.floor(WORLD / cell);
  for (let cz = 0; cz < n; cz++) {
    for (let cx = 0; cx < n; cx++) {
      const u = (cx + R()) * cell, v = (cz + R()) * cell, x = u / K, y = v / K, h = terrainAt(u, v), g = growth(x, y, h);
      if (g < .03) continue;
      const jw = jungleWeight(x, y), keep = R(), q = R();
      if (keep > g * (.45 + .55 * jw)) continue;
      const s = .8 + R() * .6;
      if (jw > .5) {
        if (q < .4) put('fern', u, v, s); else if (q < .72) put('grass', u, v, s); else if (q < .84) put('bush', u, v, .7 + R() * .5);
        else if (q < .9) put('mushrooms', u, v, .8 + R() * .5); else if (q < .95) put('rock', u, v, .22 + R() * .3, R(), .7 + R() * .4); else put('flowers', u, v, s);
      } else if (q < .72) put('grass', u, v, s); else if (q < .83) put('flowers', u, v, s); else if (q < .9) put('fern', u, v, s);
      else if (q < .96) put('bush', u, v, .7 + R() * .5); else if (q < .985) put('rock', u, v, .2 + R() * .28, R(), .7 + R() * .4); else put('mushrooms', u, v, s);
    }
  }

  // ---- the river banks: stones and reeds-like bushes just above the water
  const c0 = WORLD / 2, step = 2.4 * coarse;
  for (let s = -113; s <= 113; s += step) {
    for (const side of [-1, 1]) {
      const t = side * (5.5 + R() * 4.5), u = c0 + (s - t) * Math.SQRT1_2, v = c0 + (s + t) * Math.SQRT1_2;
      if (u < 2 || v < 2 || u > WORLD - 2 || v > WORLD - 2 || R() > .5) continue;
      const h = terrainAt(u, v);
      if (h < WATER_Y + .05 || h > WATER_Y + 1.1 || laneDist(u / K, v / K) < 110) continue; // bridge approaches stay clear
      if (R() < .6) put('rock', u, v, .3 + R() * .55, R(), .6 + R() * .4); else put('bush', u, v, .6 + R() * .4);
    }
  }

  // ---- crystals at the magic places
  const ring = (cx: number, cy: number, r: number, count: number, hue: number, a0 = 0): void => {
    for (let i = 0; i < count; i++) { const a = a0 + i / count * 6.2832, u = cx * K + Math.cos(a) * r, v = cy * K + Math.sin(a) * r; put('crystal', u, v, .8 + R() * .5, hue); shade(u, v, 1, .3); }
  };
  SHRINES.forEach((s, i) => ring(s.x, s.y, 4.6, 4, HUE.gold, i));
  ring(SPRING.x, SPRING.y, 8, 6, HUE.cyan);
  ring(BOSS_PIT.x, BOSS_PIT.y, 9.6, 8, HUE.violet, .3);

  // ---- the forest outside the map
  const fstep = 4 * coarse * (o.test ? 1.4 : 1);
  for (let v = -RING + fstep / 2; v < WORLD + RING; v += fstep) {
    for (let u = -RING + fstep / 2; u < WORLD + RING; u += fstep) {
      const uu = u + (R() - .5) * fstep * .9, vv = v + (R() - .5) * fstep * .9, out = outsideOf(uu, vv);
      if (out < 1.8 || out > RING + 25) continue;
      const sd = Math.hypot(uu - STAGE.x, vv - STAGE.z);
      if (sd < 24) continue; // the glade round the hero-select pedestal
      if (((uu < 0 && vv < 0) || (uu > WORLD && vv > WORLD)) && Math.abs(uu - vv) * Math.SQRT1_2 < 8) continue; // the river valley
      const h = terrainAt(uu, vv), dens = smooth(1.8, 8, out) * (1 - .5 * smooth(RING * .7, RING + 20, out)) * smooth(24, 38, sd) * (1 - .6 * smooth(11, 17, h));
      if (R() > dens * .9) continue;
      const s = (.95 + .75 * smooth(8, 70, out) + R() * .4) * (h > 9 ? .9 : 1);
      if (R() < smooth(1.5, 9, h) * .75 + .1) put('pineLow', uu, vv, s * .95, R(), 1, R() * 6.28, -.15); else put('oakLow', uu, vv, s, R(), 1, R() * 6.28, -.15);
      if (R() < .03) put('rock', uu + 1, vv, .6 + R() * 1.2, R(), .7 + R() * .4);
    }
  }
  // ---- the glade round the hero-select pedestal: a meadow of grass and flowers, clear of the pedestal itself
  const gstep = cell * .85;
  for (let v = STAGE.z - 26; v <= STAGE.z + 26; v += gstep) {
    for (let u = STAGE.x - 26; u <= STAGE.x + 26; u += gstep) {
      const uu = u + (R() - .5) * gstep, vv = v + (R() - .5) * gstep, sd = Math.hypot(uu - STAGE.x, vv - STAGE.z);
      if (sd < 4.6 || sd > 25) continue;
      if (R() > .78 * smooth(4.6, 8, sd) * (1 - .75 * smooth(14, 25, sd))) continue;
      const q = R(), s = .8 + R() * .6;
      if (q < .55) put('grass', uu, vv, s); else if (q < .74) put('flowers', uu, vv, s); else if (q < .86) put('fern', uu, vv, s);
      else if (q < .94) put('bush', uu, vv, .7 + R() * .5); else if (q < .975) put('mushrooms', uu, vv, .9 + R() * .4); else put('rock', uu, vv, .25 + R() * .35, R(), .7 + R() * .4);
    }
  }
  return { lists: L, occluders: occ };
}
