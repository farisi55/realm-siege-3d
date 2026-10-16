import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { K, LN, W } from '../src/game/config';
import { OB } from '../src/game/map';
import { ARENA, RING, RIVER, STAGE, WATER_Y, WORLD, heightGrid, riverDist, terrainAt, terrainY } from '../src/render/env/height';
import { BASES, BOSS_PIT, CAMPS, PAD_R, PLAZA_R, SHRINES, SPRING, TORCHES, TOWERS, dist2, nearest } from '../src/render/env/layout';
import { clamp01, fbm, hash2, mix, mulberry32, rgb, smooth, tnoise, vnoise } from '../src/render/env/rand';
import { SPECIES, growth, jungleWeight, outsideOf, scatter } from '../src/render/env/scatter';
import type { Scatter, Species } from '../src/render/env/scatter';
import { SplatPainter, laneDist, paintSplat, shade } from '../src/render/env/splat';
import { WATER, waterData } from '../src/render/env/water';
import * as G from '../src/render/env/geometry';

// The world as data: the shape of the ground, where things stand, how the ground is painted. Everything here is pure (no GPU, no DOM).

const OBSTACLES = OB as unknown as { x: number; y: number; r: number }[];

// ------------------------------------------------------------------------------------------------------------------------ rand

describe('rand helpers', () => {
  it('mulberry32 is seeded: same seed, same sequence, values in [0, 1)', () => {
    const a = mulberry32(7), b = mulberry32(7), c = mulberry32(8);
    const sa = Array.from({ length: 50 }, a), sb = Array.from({ length: 50 }, b), sc = Array.from({ length: 50 }, c);
    expect(sa).toEqual(sb); expect(sa).not.toEqual(sc);
    for (const v of sa) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
  });
  it('hash2, vnoise, fbm and tnoise stay in [0, 1] and never change for the same input', () => {
    for (let i = 0; i < 400; i++) {
      const x = (i * 7.31) % 97 - 40, y = (i * 3.77) % 89 - 30;
      for (const v of [hash2(i, -i, 3), vnoise(x, y, 2), fbm(x, y, 5, 4), tnoise(x, y, 8, 1)]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
      expect(vnoise(x, y, 2)).toBe(vnoise(x, y, 2));
    }
  });
  it('vnoise is continuous: nearby points give nearby values', () => {
    for (let i = 0; i < 200; i++) { const x = i * .37, y = i * .53; expect(Math.abs(vnoise(x, y) - vnoise(x + .01, y))).toBeLessThan(.05); }
  });
  it('tnoise repeats with its period, so ground and detail textures can tile', () => {
    for (let i = 0; i < 100; i++) { const x = i * .41, y = i * .29; expect(tnoise(x, y, 8, 4)).toBeCloseTo(tnoise(x + 8, y, 8, 4), 9); expect(tnoise(x, y, 8, 4)).toBeCloseTo(tnoise(x, y + 16, 8, 4), 9); }
  });
  it('smooth, mix, clamp01 and rgb', () => {
    expect(smooth(2, 4, 1)).toBe(0); expect(smooth(2, 4, 5)).toBe(1); expect(smooth(2, 4, 3)).toBeCloseTo(.5, 9);
    expect(mix(2, 6, .25)).toBe(3); expect(clamp01(-1)).toBe(0); expect(clamp01(2)).toBe(1);
    expect(rgb(1, 0, 0)).toBe(0xff0000); expect(rgb(0, 1, 0)).toBe(0x00ff00); expect(rgb(0, 0, 1)).toBe(0x0000ff); expect(rgb(2, -1, .5)).toBe(0xff0080);
  });
});

// ------------------------------------------------------------------------------------------------------------------------ layout

describe('layout', () => {
  it('the map is point-symmetric: bases, towers, shrines and braziers mirror through the centre', () => {
    expect(BASES[0].x + BASES[1].x).toBe(W); expect(BASES[0].y + BASES[1].y).toBe(W);
    expect(TOWERS).toHaveLength(12);
    for (let i = 0; i < 6; i++) {
      expect(TOWERS[i].team).toBe(0); expect(TOWERS[i + 6].team).toBe(1);
      expect(TOWERS[i].x + TOWERS[i + 6].x).toBe(W); expect(TOWERS[i].y + TOWERS[i + 6].y).toBe(W);
    }
    for (const list of [SHRINES, TORCHES]) for (const s of list) expect(list.some(o => Math.abs(o.x + s.x - W) < 1e-6 && Math.abs(o.y + s.y - W) < 1e-6)).toBe(true);
    expect(BOSS_PIT.x + SPRING.x).toBe(W); expect(BOSS_PIT.y + SPRING.y).toBe(W);
  });
  it('the camps, the boss pit and the spring stand on the map, and the bases are at the corners the lanes start from', () => {
    for (const p of [...CAMPS, BOSS_PIT, SPRING, ...SHRINES, ...TORCHES, ...BASES, ...TOWERS]) { expect(p.x).toBeGreaterThan(0); expect(p.x).toBeLessThan(W); expect(p.y).toBeGreaterThan(0); expect(p.y).toBeLessThan(W); }
    expect(laneDist(BASES[0].x, BASES[0].y)).toBeLessThan(PLAZA_R); expect(laneDist(BASES[1].x, BASES[1].y)).toBeLessThan(PLAZA_R);
  });
  it('nearest picks the closest site; dist2 is the Euclidean distance', () => {
    const list = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 4, y: 9 }];
    expect(nearest(list, 9, 1)).toBeLessThan(2.5); // the distance to the closest, not an index
    expect(nearest(list, 4, 8)).toBeCloseTo(1, 9);
    expect(dist2(3, 4, { x: 0, y: 0 })).toBe(5);
  });
});

// ------------------------------------------------------------------------------------------------------------------------ ground height

describe('terrain height', () => {
  it('terrainAt is terrainY in world units', () => {
    for (const [u, v] of [[10, 10], [80, 40], [-12, 30], [170, 90]]) expect(terrainAt(u, v)).toBe(terrainY(u / K, v / K));
    expect(WORLD).toBeCloseTo(W * K, 9);
  });
  it('is finite everywhere, near and far outside the map', () => {
    for (let i = 0; i < 500; i++) { const x = (i * 97.13) % 5200 - 1000, y = (i * 61.7) % 5200 - 1000; expect(Number.isFinite(terrainY(x, y)), `${x},${y}`).toBe(true); }
  });
  it('is continuous across every edge of the map: no step where the playfield meets the hills', () => {
    let worst = 0;
    for (let t = 0; t <= W; t += 20) for (const [a, b, c, d] of [[t, 0, t, -.5], [t, W, t, W + .5], [0, t, -.5, t], [W, t, W + .5, t]]) worst = Math.max(worst, Math.abs(terrainY(a, b) - terrainY(c, d)));
    expect(worst).toBeLessThan(.01);
  });
  it('the slopes stay walkable-looking: nothing is a cliff', () => {
    let worst = 0;
    for (let x = 0; x < W; x += 20) for (let y = 0; y < W; y += 20) worst = Math.max(worst, Math.hypot(terrainY(x + 10, y) - terrainY(x - 10, y), terrainY(x, y + 10) - terrainY(x, y - 10)) / (20 * K * 2));
    expect(worst).toBeLessThan(.8);
  });
  it('the river is one continuous channel below the water line, from corner to corner and on into the valley outside', () => {
    for (let x = 0; x <= W; x += 10) {
      if (Math.hypot(x - BOSS_PIT.x, x - BOSS_PIT.y) < ARENA.edge) continue; // the boss arena stands on a raised platform
      expect(terrainY(x, x), `x=${x}`).toBeLessThan(WATER_Y - .3);
    }
    for (let d = 5; d < 400; d += 5) { expect(terrainY(-d, -d)).toBeLessThan(WATER_Y - .3); expect(terrainY(W + d, W + d)).toBeLessThan(WATER_Y - .3); }
  });
  it('the banks beyond the channel are dry: no pond cut off from the river, no flooded meadow', () => {
    let lowest = 1e9;
    for (let x = 0; x <= W; x += 20) for (let y = 0; y <= W; y += 20) {
      const rd = riverDist(x, y);
      if (rd < RIVER.bank + 8 || rd > 300) continue;
      lowest = Math.min(lowest, terrainY(x, y));
    }
    expect(lowest).toBeGreaterThan(WATER_Y + .3);
  });
  it('the river is a diagonal: riverDist is zero on it, symmetric and in logic units', () => {
    expect(riverDist(700, 700)).toBe(0); expect(riverDist(900, 500)).toBeCloseTo(400 / Math.SQRT2, 9); expect(riverDist(500, 900)).toBe(riverDist(900, 500));
  });
  it('the boss arena is a flat raised platform and the pedestal clearing a flat hollow', () => {
    for (const [dx, dy] of [[0, 0], [90, 0], [0, -110], [-70, 70]]) expect(terrainY(BOSS_PIT.x + dx, BOSS_PIT.y + dy)).toBeCloseTo(ARENA.y, 6);
    expect(terrainAt(STAGE.x, STAGE.z)).toBeCloseTo(STAGE.y, 6);
    for (let a = 0; a < 6.3; a += .7) expect(terrainAt(STAGE.x + Math.cos(a) * STAGE.flat * .9, STAGE.z + Math.sin(a) * STAGE.flat * .9)).toBeCloseTo(STAGE.y, 6);
  });
  it('outside the map the ground climbs into a ring of hills, so the world never ends in a void', () => {
    for (const [u, v] of [[WORLD / 2, 0], [WORLD / 2, WORLD], [0, WORLD / 2], [WORLD, WORLD / 2]]) {
      const sx = u === 0 ? -1 : u === WORLD ? 1 : 0, sz = v === 0 ? -1 : v === WORLD ? 1 : 0;
      expect(terrainAt(u + sx * (RING - 10), v + sz * (RING - 10))).toBeGreaterThan(terrainAt(u, v) + 8);
    }
  });
  it('heightGrid holds the terrain on a regular grid', () => {
    const n = 16, g = heightGrid(n), step = WORLD / n;
    expect(g).toHaveLength((n + 1) * (n + 1));
    for (const [ix, iz] of [[0, 0], [3, 5], [16, 16], [8, 0], [0, 12]]) expect(g[iz * (n + 1) + ix]).toBeCloseTo(terrainAt(ix * step, iz * step), 5);
  });
});

// ------------------------------------------------------------------------------------------------------------------------ geometry

describe('plant and rock shapes', () => {
  const makers: Record<Species, () => THREE.BufferGeometry> = {
    pine: () => G.pine(), pineLow: () => G.pine(true), oak: () => G.oak(), oakLow: () => G.oak(true), jungle: G.jungle, bush: G.bush, fern: G.fern, grass: G.grass,
    flowers: G.flowers, rock: () => G.rock(3), crystal: G.crystal, mushrooms: G.mushrooms,
  };
  const budget: Record<Species, number> = { pine: 500, pineLow: 300, oak: 1500, oakLow: 400, jungle: 1500, bush: 300, fern: 300, grass: 150, flowers: 200, rock: 400, crystal: 800, mushrooms: 800 };

  for (const sp of SPECIES) {
    it(`${sp}: one vertex-colored geometry with finite data, standing on the ground, within its triangle budget`, () => {
      const g = makers[sp]();
      for (const name of ['position', 'normal', 'color']) expect(g.getAttribute(name), name).toBeTruthy();
      const n = g.getAttribute('position').count;
      expect(n % 3).toBe(0); expect(n).toBeGreaterThan(30); expect(n).toBeLessThanOrEqual(budget[sp]);
      expect(g.getAttribute('normal').count).toBe(n); expect(g.getAttribute('color').count).toBe(n);
      for (const a of ['position', 'normal', 'color']) for (const v of g.getAttribute(a).array as Float32Array) if (!Number.isFinite(v)) throw new Error(`${a} not finite`);
      g.computeBoundingBox();
      expect(g.boundingBox!.min.y).toBeGreaterThan(-.3); expect(g.boundingBox!.min.y).toBeLessThan(.1); // roots at the ground
      expect(g.boundingBox!.max.y).toBeLessThan(7);
      g.dispose();
    });
  }
  it('the far forest is cheaper than the near one', () => {
    expect(G.pine(true).getAttribute('position').count).toBeLessThan(G.pine(false).getAttribute('position').count);
    expect(G.oak(true).getAttribute('position').count).toBeLessThan(G.oak(false).getAttribute('position').count / 2);
  });
  it('rocks differ by seed but are repeatable', () => {
    const a = G.rock(3).getAttribute('position').array as Float32Array, b = G.rock(3).getAttribute('position').array as Float32Array, c = G.rock(4).getAttribute('position').array as Float32Array;
    expect(Array.from(a)).toEqual(Array.from(b)); expect(Array.from(a)).not.toEqual(Array.from(c));
  });
  it('trees are darker at the foot than at the crown (a cheap ambient occlusion)', () => {
    for (const g of [G.pine(), G.oak(), G.jungle()]) {
      const p = g.getAttribute('position'), c = g.getAttribute('color');
      let lo = 0, hi = 0, nl = 0, nh = 0;
      for (let i = 0; i < p.count; i++) { const l = c.getX(i) + c.getY(i) + c.getZ(i); if (p.getY(i) < 1.2) { lo += l; nl++; } else if (p.getY(i) > 3.6) { hi += l; nh++; } }
      expect(hi / nh).toBeGreaterThan(lo / nl);
    }
  });
  it('GeoBuilder merges primitives into one non-indexed geometry with the colors of the color function', () => {
    const g = new G.GeoBuilder().add(G.box(1, 1, 1), G.place(0, .5, 0), () => [1, 0, 0]).add(G.box(1, 1, 1), G.place(3, .5, 0), () => [0, 0, 1]).build();
    expect(g.index).toBeNull(); expect(g.getAttribute('position').count).toBe(72);
    const c = g.getAttribute('color'), p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) expect([c.getX(i), c.getY(i), c.getZ(i)]).toEqual(p.getX(i) < 2 ? [1, 0, 0] : [0, 0, 1]);
    // flat shading: the normals of a cube are axis-aligned
    const n = g.getAttribute('normal'); for (let i = 0; i < n.count; i++) expect(Math.max(Math.abs(n.getX(i)), Math.abs(n.getY(i)), Math.abs(n.getZ(i)))).toBeCloseTo(1, 5);
  });
  it('chunkSphere gives instanced chunks one bounding sphere that reaches the corners and the tallest instance', () => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    G.chunkSphere(g, 40, 6);
    const s = g.boundingSphere!;
    expect(s.center.y).toBe(3); expect(s.radius).toBeGreaterThan(Math.hypot(20 * Math.SQRT2, 3));
    expect(g.boundingBox).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------------------------------ scatter

describe('where things stand', () => {
  let A: Scatter, B: Scatter, F: Scatter;
  beforeAll(() => { A = scatter({ test: true }); B = scatter({ test: true }); F = scatter(); });

  const inside = (i: { x: number; z: number }): boolean => outsideOf(i.x, i.z) === 0;
  const lowGrowth: Species[] = ['grass', 'flowers'];
  const total = (s: Scatter): number => SPECIES.reduce((n, k) => n + s.lists[k].length, 0);

  it('is deterministic: the same world on every run', () => { expect(A.lists).toEqual(B.lists); expect(A.occluders).toEqual(B.occluders); });
  it('the shipping density stays inside the instance budget (a field of grass, not a million blades)', () => {
    expect(total(F)).toBeGreaterThan(8000); expect(total(F)).toBeLessThan(25000);
    expect(total(A)).toBeLessThan(total(F) / 4); // the test world is a coarse version
    for (const sp of SPECIES) expect(F.lists[sp].length, sp).toBeGreaterThan(0);
  });
  it('trees stand only at the simulation\'s obstacle circles, so what looks solid is solid', () => {
    const sites = new Set(OBSTACLES.map(o => `${o.x * K}:${o.y * K}`));
    const trees = [...F.lists.pine, ...F.lists.oak, ...F.lists.jungle];
    expect(trees.length).toBeGreaterThan(20); expect(trees.length).toBeLessThanOrEqual(OBSTACLES.length);
    for (const t of trees) expect(sites.has(`${t.x}:${t.z}`), `${t.x},${t.z}`).toBe(true);
  });
  it('every obstacle circle is marked by a tree or a boulder', () => {
    const marks = [...F.lists.pine, ...F.lists.oak, ...F.lists.jungle, ...F.lists.rock];
    for (const o of OBSTACLES) expect(marks.some(m => Math.abs(m.x - o.x * K) < 1e-9 && Math.abs(m.z - o.y * K) < 1e-9), `${o.x},${o.y}`).toBe(true);
  });
  it('the biggest instance of an obstacle matches its circle (a boulder or crown about as wide as the circle that stops units)', () => {
    for (const o of OBSTACLES) {
      const m = [...F.lists.pine, ...F.lists.oak, ...F.lists.jungle, ...F.lists.rock].find(i => Math.abs(i.x - o.x * K) < 1e-9 && Math.abs(i.z - o.y * K) < 1e-9)!;
      expect(m.s * 1.7).toBeGreaterThan(o.r * K * .3); // not a speck
      expect(m.s).toBeLessThan(o.r * K * 1.2); // not wider than the thing that blocks
    }
  });
  it('low growth stays off the roads, plazas, tower pads, camp clearings, the arena, the shrines and the spring', () => {
    for (const sp of lowGrowth) for (const i of F.lists[sp]) {
      if (!inside(i)) continue;
      const x = i.x / K, y = i.z / K;
      expect(laneDist(x, y), 'lane').toBeGreaterThan(105);
      expect(nearest(BASES, x, y), 'plaza').toBeGreaterThan(PLAZA_R);
      expect(nearest(TOWERS, x, y), 'pad').toBeGreaterThan(PAD_R);
      expect(nearest(CAMPS, x, y), 'camp').toBeGreaterThan(110);
      expect(Math.hypot(x - BOSS_PIT.x, y - BOSS_PIT.y), 'arena').toBeGreaterThan(ARENA.flat);
      expect(nearest(SHRINES, x, y), 'shrine').toBeGreaterThan(75);
      expect(Math.hypot(x - SPRING.x, y - SPRING.y), 'spring').toBeGreaterThan(120);
    }
  });
  it('nothing but boulders and crystals stands in the river or on its wet shore (low meadow far from the river is fine)', () => {
    for (const sp of ['grass', 'flowers', 'fern', 'bush', 'mushrooms', 'pine', 'oak', 'jungle'] as const) for (const i of F.lists[sp]) {
      if (!inside(i) || riverDist(i.x / K, i.z / K) >= RIVER.bank + 8) continue;
      expect(i.y, `${sp} at ${i.x},${i.z}`).toBeGreaterThan(WATER_Y);
    }
    for (const sp of lowGrowth) for (const i of F.lists[sp]) if (inside(i) && riverDist(i.x / K, i.z / K) < RIVER.bank - 55) expect(i.y, 'the shore stays bare').toBeGreaterThan(WATER_Y + .5);
  });
  it('some boulders stand in the river (the obstacle circles there are rocks, not trees)', () => {
    expect(F.lists.rock.filter(r => r.y < WATER_Y + .5 && riverDist(r.x / K, r.z / K) < RIVER.bank).length).toBeGreaterThan(3);
  });
  it('growth() is zero on a lane, a plaza, a camp, the arena; one-ish in open meadow', () => {
    const h = (x: number, y: number): number => terrainY(x, y);
    for (const [x, y] of [[400, 1600], [1600, 400], [BASES[0].x, BASES[0].y], [BASES[1].x, BASES[1].y], [CAMPS[0].x, CAMPS[0].y], [BOSS_PIT.x, BOSS_PIT.y], [SPRING.x, SPRING.y], [SHRINES[0].x, SHRINES[0].y]]) expect(growth(x, y, h(x, y)), `${x},${y}`).toBe(0);
    let best = 0;
    for (let x = 100; x < W; x += 50) for (let y = 100; y < W; y += 50) best = Math.max(best, growth(x, y, h(x, y)));
    expect(best).toBeGreaterThan(.9);
  });
  it('the jungle is away from the lanes, the bases and the camps', () => {
    expect(jungleWeight(400, 1600)).toBe(0); expect(jungleWeight(BASES[0].x, BASES[0].y)).toBe(0); expect(jungleWeight(CAMPS[1].x, CAMPS[1].y)).toBe(0);
    let top = 0; for (let x = 100; x < W; x += 100) for (let y = 100; y < W; y += 100) top = Math.max(top, jungleWeight(x, y));
    expect(top).toBeGreaterThan(.9);
  });
  it('every instance stands on the ground (the far forest sinks a little into it)', () => {
    for (const sp of SPECIES) for (const i of F.lists[sp]) {
      const d = i.y - terrainAt(i.x, i.z);
      if (sp === 'pineLow' || sp === 'oakLow') expect(d).toBeCloseTo(-.15, 6); else expect(d).toBeCloseTo(0, 9);
    }
  });
  it('the far forest stays outside the map, clear of the pedestal glade and the river valley', () => {
    for (const i of [...F.lists.pineLow, ...F.lists.oakLow]) {
      expect(outsideOf(i.x, i.z)).toBeGreaterThanOrEqual(1.8);
      expect(Math.hypot(i.x - STAGE.x, i.z - STAGE.z)).toBeGreaterThanOrEqual(24);
      if ((i.x < 0 && i.z < 0) || (i.x > WORLD && i.z > WORLD)) expect(Math.abs(i.x - i.z) * Math.SQRT1_2).toBeGreaterThanOrEqual(8);
    }
    expect(F.lists.pineLow.length + F.lists.oakLow.length).toBeGreaterThan(1500);
  });
  it('a meadow of grass and flowers surrounds the hero-select pedestal, clear of the pedestal itself', () => {
    const glade = [...F.lists.grass, ...F.lists.flowers].filter(i => Math.hypot(i.x - STAGE.x, i.z - STAGE.z) < 25);
    expect(glade.length).toBeGreaterThan(200);
    for (const i of glade) expect(Math.hypot(i.x - STAGE.x, i.z - STAGE.z)).toBeGreaterThanOrEqual(4.6);
  });
  it('instance sizes and tints are sane', () => {
    for (const sp of SPECIES) for (const i of F.lists[sp]) {
      expect(i.s, sp).toBeGreaterThan(0); expect(i.s, sp).toBeLessThan(7);
      expect(i.sy, sp).toBeGreaterThan(.4); expect(i.sy, sp).toBeLessThan(2);
      expect(i.t, sp).toBeGreaterThanOrEqual(0); expect(i.t, sp).toBeLessThanOrEqual(1);
      expect(Number.isFinite(i.x + i.y + i.z + i.ry), sp).toBe(true);
    }
  });
  it('the baked contact shadows are sane and cover every obstacle', () => {
    expect(F.occluders.length).toBeGreaterThanOrEqual(OBSTACLES.length);
    for (const o of F.occluders) { expect(o.r).toBeGreaterThan(0); expect(o.k).toBeGreaterThan(0); expect(o.k).toBeLessThanOrEqual(1); expect(Number.isFinite(o.x + o.y)).toBe(true); }
  });
});

// ------------------------------------------------------------------------------------------------------------------------ ground painter

describe('ground painter', () => {
  const N = 256, n = 64;
  let hg: Float32Array, px: Uint8Array;
  const at = (x: number, y: number): [number, number, number, number] => {
    const ix = Math.min(N - 1, Math.floor(x * K / (WORLD / N))), iy = Math.min(N - 1, Math.floor(y * K / (WORLD / N))), i = (iy * N + ix) * 4;
    return [px[i], px[i + 1], px[i + 2], px[i + 3]];
  };
  const lum = (c: number[]): number => (c[0] + c[1] + c[2]) / 3;
  const maxRune = (cx: number, cy: number, r: number): number => {
    let m = 0;
    for (let a = 0; a < 360; a += 4) for (let d = 0; d <= r; d += 12) m = Math.max(m, at(cx + Math.cos(a * Math.PI / 180) * d, cy + Math.sin(a * Math.PI / 180) * d)[3]);
    return m;
  };
  let meadow: [number, number];
  beforeAll(() => {
    hg = heightGrid(n); px = paintSplat({ size: N, hg, n });
    let best = -1; meadow = [0, 0];
    for (let x = 100; x < W; x += 50) for (let y = 100; y < W; y += 50) { const g = growth(x, y, terrainY(x, y)) * (1 - jungleWeight(x, y)); if (g > best) { best = g; meadow = [x, y]; } }
  });

  it('paints one RGBA texel per pixel, and keeps the rune mask sparse (runes are lines, not a wash)', () => {
    expect(px).toHaveLength(N * N * 4);
    let lit = 0; for (let i = 3; i < px.length; i += 4) if (px[i] > 0) lit++;
    expect(lit / (N * N)).toBeGreaterThan(.002); expect(lit / (N * N)).toBeLessThan(.1);
  });
  it('meadows are green, and the jungle floor is darker and bluer-green', () => {
    const m = at(...meadow);
    expect(m[1]).toBeGreaterThan(m[0] * 1.6); expect(m[1]).toBeGreaterThan(m[2] * 1.6); expect(m[3]).toBe(0);
    let checked = 0;
    for (let x = 100; x < W; x += 100) for (let y = 100; y < W; y += 100) {
      if (jungleWeight(x, y) < .95 || growth(x, y, terrainY(x, y)) < .9) continue;
      const j = at(x, y); checked++;
      expect(j[1], `${x},${y}`).toBeGreaterThan(j[0] * 1.5); expect(lum(j)).toBeLessThan(lum(m)); expect(j[3]).toBe(0);
    }
    expect(checked).toBeGreaterThan(20);
  });
  it('lanes are dirt roads: warm, lighter than the grass, brown not green', () => {
    let checked = 0;
    for (const lane of LN) for (let s = 0; s < 2; s++) {
      const a = lane[s], b = lane[s + 1], x = (a[0] + b[0]) / 2, y = (a[1] + b[1]) / 2;
      if (nearest(TOWERS, x, y) < 200 || nearest(BASES, x, y) < 450 || nearest(CAMPS, x, y) < 200 || riverDist(x, y) < 250) continue; // keep to the plain stretches
      const c = at(x, y); checked++;
      expect(c[0] / c[1], `${x},${y}`).toBeGreaterThan(1.1); expect(c[1] / c[2]).toBeGreaterThan(1.25); expect(c[0]).toBeGreaterThan(100);
    }
    expect(checked).toBeGreaterThanOrEqual(3);
  });
  it('the road stops at the water: where a lane crosses the river the bed shows, not dirt', () => {
    for (const [x, y] of [[1600, 1600]]) { const c = at(x, y); expect(c[2], 'bed is cool').toBeGreaterThan(c[0]); }
  });
  it('base plazas are paved in stone with a hint of the team color, and carry rune lines', () => {
    const a = at(BASES[0].x, BASES[0].y), b = at(BASES[1].x, BASES[1].y);
    for (const c of [a, b]) for (let k = 0; k < 3; k++) { expect(c[k]).toBeGreaterThan(40); expect(c[k]).toBeLessThan(150); }
    expect(b[0] - b[2]).toBeGreaterThan(a[0] - a[2] + 20); // the red base is warmer than the blue one
    expect(maxRune(BASES[0].x, BASES[0].y, PLAZA_R)).toBeGreaterThan(150); expect(maxRune(BASES[1].x, BASES[1].y, PLAZA_R)).toBeGreaterThan(150);
  });
  it('tower pads and shrines carry rune lines too', () => {
    expect(maxRune(TOWERS[3].x, TOWERS[3].y, PAD_R)).toBeGreaterThan(100);
    expect(maxRune(SHRINES[0].x, SHRINES[0].y, 80)).toBeGreaterThan(100);
  });
  it('the river bed is cool and grey-blue, never green', () => {
    for (const x of [700, 1300, 2000, 2400]) { const c = at(x, x); expect(c[2], `${x}`).toBeGreaterThan(c[0]); expect(c[1] - c[2]).toBeLessThan(20); }
  });
  it('the boss arena is dark basalt with runes', () => {
    const c = at(BOSS_PIT.x, BOSS_PIT.y);
    expect(lum(c)).toBeLessThan(80); expect(c[2]).toBeGreaterThan(c[1]);
    expect(maxRune(BOSS_PIT.x, BOSS_PIT.y, ARENA.flat)).toBeGreaterThan(20);
  });
  it('is deterministic', () => {
    const again = paintSplat({ size: N, hg, n });
    expect(Buffer.compare(Buffer.from(px.buffer, px.byteOffset, px.byteLength), Buffer.from(again.buffer))).toBe(0);
  });
  it('painted in slices (as the loader does) it is the same picture', () => {
    const p = new SplatPainter({ size: N, hg, n });
    p.paintBase();
    for (let y = 0; y < N; y += 48) p.rows(y, Math.min(N, y + 48));
    const sliced = p.finish();
    expect(Buffer.compare(Buffer.from(px.buffer, px.byteOffset, px.byteLength), Buffer.from(sliced.buffer))).toBe(0);
  });
  it('contact shadows darken inside their disc only, most at the centre', () => {
    const t = new Uint8Array(N * N * 4).fill(200);
    shade(t, N, [{ x: 1000, y: 2000, r: 60, k: .5 }]);
    const ci = (iy: number, ix: number): number => (iy * N + ix) * 4;
    const cx = Math.floor(1000 * K / (WORLD / N)), cy = Math.floor(2000 * K / (WORLD / N));
    expect(t[ci(cy, cx)]).toBeCloseTo(100, -1); expect(t[ci(cy, cx + 2)]).toBeGreaterThan(t[ci(cy, cx)]); expect(t[ci(cy, cx + 2)]).toBeLessThan(200);
    expect(t[ci(cy, cx + 12)]).toBe(200); expect(t[0]).toBe(200); expect(t[3]).toBe(200);
  });
  it('the occluders handed to the painter are baked in', () => {
    const [mx, my] = meadow, plain = at(mx, my);
    const dark = paintSplat({ size: N, hg, n, occluders: [{ x: mx, y: my, r: 80, k: .6 }] });
    const ix = Math.min(N - 1, Math.floor(mx * K / (WORLD / N))), iy = Math.min(N - 1, Math.floor(my * K / (WORLD / N))), i = (iy * N + ix) * 4;
    expect(dark[i + 1]).toBeLessThan(plain[1] * .75);
  });
  it('lane distance is zero on a lane and grows with the distance from it', () => {
    expect(laneDist(400, 1600)).toBeCloseTo(0, 6); expect(laneDist(450, 1600)).toBeCloseTo(50, 6); expect(laneDist(1600, 1600)).toBeCloseTo(0, 6);
    expect(laneDist(1000, 2200)).toBeCloseTo(0, 6); // on the diagonal lane
    expect(laneDist(1000, 1900)).toBeCloseTo(300 / Math.SQRT2, 6); // beside it, nearer to it than to the side lanes
  });
});

// ------------------------------------------------------------------------------------------------------------------------ water

describe('river ribbon', () => {
  const w = waterData(6, 2), V = w.pos.length / 3;

  it('has valid indices: whole triangles over existing vertices, 16-bit while the vertex count allows', () => {
    expect(w.idx.length % 3).toBe(0); expect(w.idx.length).toBeGreaterThan(300);
    for (const i of w.idx) expect(i).toBeLessThan(V);
    expect(w.idx).toBeInstanceOf(Uint16Array);
    expect(w.depth).toHaveLength(V); expect(w.flow).toHaveLength(V * 2);
  });
  it('switches to 32-bit indices for a ribbon too fine for 16 bits', () => {
    const fine = waterData(.5, .2);
    expect(fine.pos.length / 3).toBeGreaterThan(65535); expect(fine.idx).toBeInstanceOf(Uint32Array);
  });
  it('every triangle faces up, so the single-sided water is visible from the camera', () => {
    for (let i = 0; i < w.idx.length; i += 3) {
      const a = w.idx[i], b = w.idx[i + 1], c = w.idx[i + 2], P = w.pos;
      const ux = P[b * 3] - P[a * 3], uz = P[b * 3 + 2] - P[a * 3 + 2], vx = P[c * 3] - P[a * 3], vz = P[c * 3 + 2] - P[a * 3 + 2];
      expect(uz * vx - ux * vz, `triangle ${i / 3}`).toBeGreaterThan(0);
    }
  });
  it('the surface is flat at the water level; the depth is the surface minus the ground', () => {
    for (let k = 0; k < V; k++) { expect(w.pos[k * 3 + 1]).toBeCloseTo(WATER_Y, 6); expect(w.depth[k]).toBeCloseTo(WATER_Y - terrainAt(w.pos[k * 3], w.pos[k * 3 + 2]), 3); expect(Number.isFinite(w.flow[k * 2] + w.flow[k * 2 + 1])).toBe(true); }
  });
  it('the channel is deep along the centre line and dry at the edges of the ribbon', () => {
    const cols = Math.round(WATER.cross * 2 / 2) + 1, rows = V / cols, mid = (cols - 1) / 2;
    let deep = 0, centre = 0;
    for (let j = 0; j < rows; j++) {
      expect(w.depth[j * cols], 'left edge dry').toBeLessThan(0); expect(w.depth[j * cols + cols - 1], 'right edge dry').toBeLessThan(0);
      if (Math.abs(-WATER.half + j * 6) > 110) continue; // beyond the corners of the map the valley floor climbs and the water thins out
      centre++; if (w.depth[j * cols + mid] > .3) deep++;
    }
    expect(centre).toBeGreaterThan(30);
    expect(deep / centre).toBeGreaterThan(.85); // all but the boss arena platform
  });
  it('triangles over dry ground are not built (the ribbon costs pixels only where there is water)', () => {
    const f = waterData(), quads = (f.pos.length / 3 / (Math.round(WATER.cross * 2 / WATER.stepAcross) + 1) - 1) * Math.round(WATER.cross * 2 / WATER.stepAcross);
    expect(f.idx.length / 3).toBeLessThan(quads * 2 * .5); expect(f.idx.length / 3).toBeGreaterThan(quads * 2 * .1);
  });
});
