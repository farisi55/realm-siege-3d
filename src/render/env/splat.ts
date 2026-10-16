import { K, LN } from '../../game/config';
import { ARENA, RIVER, WATER_Y, WORLD, riverDist } from './height';
import { BASES, BOSS_PIT, CAMPS, PAD_R, PLAZA_R, SHRINES, SPAWNS, SPRING, TEAM_COLOR, TOWERS, nearest } from './layout';
import { fbm, hash2, mix, smooth, vnoise } from './rand';

/**
 * The ground colors, painted once into a texture that covers the whole map (the terrain mesh only carries the shape).
 * Painting per pixel gives crisp lane edges, riverbanks and paving that vertex colors on a 1-unit grid cannot.
 *
 *   rgb  albedo: meadow, jungle floor, lanes, shore and riverbed, paved plazas, the boss arena, ...
 *   a    rune glow mask: lines the terrain shader makes glow softly (base plazas, tower pads, shrines, the arena)
 *
 * Two phases keep it fast. The slow, smooth fields (meadow and jungle tones, river bed and shore, rock on steep ground) are
 * painted once at a quarter of the resolution; the full-resolution pass blends them in bilinearly and adds only what needs
 * crisp edges: the lanes, the camp clearings, the paving and the rune lines. The structures are small functions looked up
 * from a per-row list of the zones that touch the row, so the pixel loop stays small and the JIT settles quickly.
 *
 * Pure function of its inputs (no Three.js): the tests paint a small map and check where things end up.
 */

/** A soft contact shadow baked under a tree, rock or building: logic position, radius (logic units) and darkness 0..1. */
export interface Occluder { x: number; y: number; r: number; k: number }
export interface SplatOpts {
  size: number;
  /** Terrain heights on a regular grid over the map: (n + 1)^2 values, row = z. */
  hg: Float32Array;
  n: number;
  occluders?: Occluder[];
}

type RGB = [number, number, number];
const rgbOf = (h: number): RGB => [(h >> 16 & 255) / 255, (h >> 8 & 255) / 255, (h & 255) / 255];
/** Albedo palette. Sun and sky light add up to a little over 1, so these sit below what the eye should see. */
export const PAL = {
  grassShade: rgbOf(0x1f4f2b), grass: rgbOf(0x2f6c33), grassLit: rgbOf(0x58923b), grassDry: rgbOf(0x768338),
  jungleDeep: rgbOf(0x103a2f), jungle: rgbOf(0x1a4c33), moss: rgbOf(0x31602d),
  dirt: rgbOf(0x7a5f3d), dirtWorn: rgbOf(0x927a52), dirtEdge: rgbOf(0x4f3e29), pebble: rgbOf(0x67635d), camp: rgbOf(0x5a4934),
  sand: rgbOf(0x9d8859), wet: rgbOf(0x4e4536), bedA: rgbOf(0x344449), bedB: rgbOf(0x4a5a4b),
  stoneA: rgbOf(0x565c6d), stoneB: rgbOf(0x464c5f), joint: rgbOf(0x20242f),
  rock: rgbOf(0x565c69), rockDark: rgbOf(0x3a3e4a),
  basalt: rgbOf(0x302c3d), basaltLit: rgbOf(0x433e53), basaltJoint: rgbOf(0x16121f),
  teamBlue: rgbOf(TEAM_COLOR[0]), teamRed: rgbOf(TEAM_COLOR[1]),
};
const TEAM_PAL: RGB[] = [PAL.teamBlue, PAL.teamRed];

// Working colors: the pixel loops allocate nothing. All are plain arrays of doubles from the start.
const col: RGB = [.5, .5, .5];
const ROAD: RGB = [.5, .5, .5], BED: RGB = [.5, .5, .5], TILE: RGB = [.5, .5, .5];
const to = (c: RGB, t: number): void => { if (t <= 0) return; if (t > 1) t = 1; col[0] += (c[0] - col[0]) * t; col[1] += (c[1] - col[1]) * t; col[2] += (c[2] - col[2]) * t; };
const scale = (s: number): void => { col[0] *= s; col[1] *= s; col[2] *= s; };
/** 1 on a line of half-width `w` around `c`, fading to 0 over `aa` (world units): an anti-aliased stroke. */
const stroke = (v: number, c: number, w: number, aa: number): number => 1 - smooth(w, w + aa, Math.abs(v - c));

/** The six lane segments as (ax, ay, dx, dy, 1 / length^2): the lane distance is the hot spot, so it works on squares. */
const SEG = new Float64Array(LN.flatMap(l => [0, 1].flatMap(i => { const a = l[i], b = l[i + 1], dx = b[0] - a[0], dy = b[1] - a[1]; return [a[0], a[1], dx, dy, 1 / (dx * dx + dy * dy)]; })));
/** Distance (logic units) to the closest lane centre line. */
export function laneDist(x: number, y: number): number {
  let m = 1e18;
  for (let i = 0; i < SEG.length; i += 5) {
    const dx = SEG[i + 2], dy = SEG[i + 3], ax = x - SEG[i], ay = y - SEG[i + 1];
    let t = (ax * dx + ay * dy) * SEG[i + 4]; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = ax - t * dx, ey = ay - t * dy, d = ex * ex + ey * ey;
    if (d < m) m = d;
  }
  return Math.sqrt(m);
}
const CAMP_SITES = [...CAMPS, BOSS_PIT];

/** Polar paving: slabs in concentric rings. Writes the slab tone and the joint strength (both 0..1) to `slab`. */
const slab = { tone: 0, joint: 0 };
function polarSlabs(ru: number, th: number, cell: number, seed: number): void {
  const k = Math.floor(ru / cell), fr = ru / cell - k, m = Math.max(5, Math.round(6.2832 * (k + .5) / 1.15)), fa = (th + Math.PI) / 6.2832 * m, ia = Math.floor(fa), fb = fa - ia;
  slab.tone = hash2(k, ia % m, seed);
  slab.joint = Math.max(1 - smooth(.035, .085, Math.min(fr, 1 - fr)), 1 - smooth(.03, .07, Math.min(fb, 1 - fb)));
}

// ---------------------------------------------------------------------------------------------------------------- what is painted on top of the base
// Each function paints into `col` (the pixel so far) and returns the rune glow it adds (0..1). (x, y) are logic units.

const camp = (i: number, x: number, y: number, n3: number, n4: number): number => {
  const S = CAMP_SITES[i], d = Math.hypot(x - S.x, y - S.y);
  if (d >= 150) return 0;
  const cw = 1 - smooth(92, 138, d + (fbm(x * K * .3 + 7, y * K * .3 - 5, 6, 2) - .5) * 30);
  to(PAL.camp, cw * .85);
  to(PAL.pebble, cw * smooth(.74, .9, n3 * .5 + n4 * .5) * .45);
  return 0;
};

/** The paved disc under a tower, with a team rune ring. */
const tower = (i: number, x: number, y: number): number => {
  const S = TOWERS[i], dx = x - S.x, dy = y - S.y, r = Math.hypot(dx, dy), pw = 1 - smooth(PAD_R - 8, PAD_R + 4, r);
  if (pw <= 0) return 0;
  const ru = r * K, tc = TEAM_PAL[S.team];
  polarSlabs(ru, Math.atan2(dy, dx), 1, 40 + i);
  const stone = slab.tone > .5 ? PAL.stoneA : PAL.stoneB, sh = .86 + .22 * slab.tone;
  for (let k = 0; k < 3; k++) {
    const v0 = stone[k] * sh, v1 = v0 + (tc[k] - v0) * (.08 + .06 * slab.tone);
    TILE[k] = v1 + (PAL.joint[k] - v1) * slab.joint * .6;
  }
  to(TILE, pw);
  const rr = stroke(ru, 44 * K, .09, .07) * .8 * pw;
  to(tc, rr * .22);
  return rr;
};

/** Small gold-lit paving. */
const shrine = (i: number, x: number, y: number): number => {
  const S = SHRINES[i], dx = x - S.x, dy = y - S.y, r = Math.hypot(dx, dy);
  if (r > 84) return 0;
  const pw = 1 - smooth(58, 80, r), ru = r * K;
  polarSlabs(ru, Math.atan2(dy, dx), .9, 70 + i);
  const stone = slab.tone > .5 ? PAL.stoneA : PAL.stoneB, sh = .85 + .2 * slab.tone;
  TILE[0] = stone[0] * sh; TILE[1] = stone[1] * sh; TILE[2] = stone[2] * sh;
  to(TILE, pw);
  to(PAL.joint, slab.joint * pw * .55);
  return Math.max(stroke(ru, 3.1, .1, .07), stroke(ru, 1.9, .07, .06) * .75) * pw * .8;
};

/** The quiet clearing across the river from the boss pit. */
const spring = (x: number, y: number, n3: number): number => {
  const r = Math.hypot(x - SPRING.x, y - SPRING.y);
  if (r >= 190) return 0;
  const ru = r * K, cw = 1 - smooth(110, 160, r);
  to(PAL.moss, cw * .6);
  const ring = stroke(ru, 4.4, .16, .1) + stroke(ru, 3.0, .08, .08) * .7;
  to(PAL.stoneA, Math.min(1, ring) * .8 * (1 - smooth(.55, .85, n3)));
  return stroke(ru, 3.7, .06, .08) * .5;
};

/** The boss arena: dark stone slabs, violet rune rings. */
const arena = (x: number, y: number): number => {
  const dx = x - BOSS_PIT.x, dy = y - BOSS_PIT.y, r = Math.hypot(dx, dy), aw = 1 - smooth(ARENA.flat - 16, ARENA.flat + 14, r);
  if (aw <= 0) return 0;
  const ru = r * K, th = Math.atan2(dy, dx);
  polarSlabs(ru, th, 1.5, 90);
  for (let k = 0; k < 3; k++) TILE[k] = mix(PAL.basalt[k], PAL.basaltLit[k], slab.tone);
  to(TILE, aw);
  to(PAL.basaltJoint, slab.joint * aw * .85);
  const rr = Math.max(stroke(ru, 6.0, .13, .09), stroke(ru, 3.4, .1, .08), Math.pow(Math.abs(Math.cos(th * 3)), 60) * smooth(1.2, 1.7, ru) * (1 - smooth(5.0, 5.6, ru)) * .9);
  return rr * aw * .95;
};

/** A base plaza: paved, with rune circles; covers whatever lies below. */
const plaza = (i: number, x: number, y: number, n3: number): number => {
  const S = BASES[i], dx = x - S.x, dy = y - S.y, r = Math.hypot(dx, dy), pw = 1 - smooth(PLAZA_R - 16, PLAZA_R + 4, r);
  if (pw <= 0) return 0;
  const ru = r * K, th = Math.atan2(dy, dx);
  polarSlabs(ru, th, 2.2, 50 + i);
  const stone = slab.tone > .5 ? PAL.stoneA : PAL.stoneB, sh = .88 + .22 * slab.tone + .06 * (n3 - .5), tc = TEAM_PAL[i], apron = smooth(PLAZA_R - 46, PLAZA_R - 8, r) * .5;
  for (let q = 0; q < 3; q++) {
    let v1 = stone[q] * sh;
    v1 += (tc[q] - v1) * .09; // a breath of team color in the stone
    v1 += (PAL.joint[q] - v1) * slab.joint * .7; // darker joints
    TILE[q] = v1 + (PAL.dirtEdge[q] - v1) * apron; // an earthy apron toward the grass
  }
  to(TILE, pw);
  const r1 = stroke(ru, 215 * K, .11, .08) * (Math.sin(th * 12) > -.35 ? 1 : 0), r2 = stroke(ru, 118 * K, .09, .07);
  const spokes = Math.pow(Math.abs(Math.cos(th * 4)), 40) * smooth(40 * K, 52 * K, ru) * (1 - smooth(104 * K, 112 * K, ru));
  const sp = Math.hypot(x - SPAWNS[i].x, y - SPAWNS[i].y) * K, ring = stroke(sp, 62 * K, .1, .08);
  return Math.max(r1 * .85, r2 * .7, spokes * .6, ring * .6) * pw;
};

/** A square of the texture (pixels) that one structure can touch, and which painter handles it. */
interface Zone { kind: number; i: number; x0: number; x1: number; y0: number; y1: number }
const Z_CAMP = 0, Z_TOWER = 1, Z_SHRINE = 2, Z_SPRING = 3, Z_ARENA = 4, Z_PLAZA = 5;

export class SplatPainter {
  /** RGBA bytes, `N` x `N`, row 0 = north edge of the map (z = 0). */
  readonly out: Uint8Array<ArrayBuffer>;
  readonly N: number;
  private readonly M: number;
  /** Quarter-resolution fields, 4 floats per cell: r, g, b and the mid-frequency noise the full pass reuses. */
  private readonly base: Float32Array;
  private readonly hg: Float32Array;
  private readonly hn: number;
  private readonly occ: Occluder[];
  private readonly zones: Zone[] = [];
  private readonly act: Zone[] = [];
  private ready = false;

  constructor(o: SplatOpts, out?: Uint8Array<ArrayBuffer>) {
    this.N = o.size; this.M = Math.max(32, o.size >> 2);
    this.out = out ?? new Uint8Array(o.size * o.size * 4);
    this.base = new Float32Array(this.M * this.M * 4);
    this.hg = o.hg; this.hn = o.n; this.occ = o.occluders ?? [];
    // Painting order matters (later zones cover earlier ones): camps, tower pads, shrines, the clearing, the arena, the plazas.
    const N = this.N, px = WORLD / N;
    const add = (kind: number, i: number, x: number, y: number, r: number): void => {
      const cx = x * K / px, cy = y * K / px, rp = r * K / px;
      this.zones.push({ kind, i, x0: Math.max(0, Math.floor(cx - rp)), x1: Math.min(N - 1, Math.ceil(cx + rp)), y0: Math.max(0, Math.floor(cy - rp)), y1: Math.min(N - 1, Math.ceil(cy + rp)) });
    };
    CAMP_SITES.forEach((s, i) => add(Z_CAMP, i, s.x, s.y, 150));
    TOWERS.forEach((s, i) => add(Z_TOWER, i, s.x, s.y, PAD_R + 12));
    SHRINES.forEach((s, i) => add(Z_SHRINE, i, s.x, s.y, 90));
    add(Z_SPRING, 0, SPRING.x, SPRING.y, 190);
    add(Z_ARENA, 0, BOSS_PIT.x, BOSS_PIT.y, ARENA.edge);
    BASES.forEach((s, i) => add(Z_PLAZA, i, s.x, s.y, PLAZA_R + 24));
  }

  /** Terrain height at a world position (bilinear over the shared grid). */
  private hAt(u: number, v: number): number {
    const hn = this.hn, hg = this.hg, stride = hn + 1, s = hn / WORLD;
    const x = Math.min(hn - 1e-3, Math.max(0, u * s)), z = Math.min(hn - 1e-3, Math.max(0, v * s)), ix = x | 0, iz = z | 0, fx = x - ix, fz = z - iz;
    const a = hg[iz * stride + ix], b = hg[iz * stride + ix + 1], c = hg[(iz + 1) * stride + ix], d = hg[(iz + 1) * stride + ix + 1];
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
  }

  /** Phase 1: the smooth fields, a quarter of the resolution. */
  paintBase(): void {
    const M = this.M, cs = WORLD / M, B = this.base;
    for (let cy = 0; cy < M; cy++) {
      const v = (cy + .5) * cs, y = v / K;
      for (let cx = 0; cx < M; cx++) {
        const u = (cx + .5) * cs, x = u / K, i = (cy * M + cx) * 4;
        const h = this.hAt(u, v), slope = Math.hypot(this.hAt(u + 1, v) - this.hAt(u - 1, v), this.hAt(u, v + 1) - this.hAt(u, v - 1)) * .5;
        const ld = laneDist(x, y), baseD = nearest(BASES, x, y), campD = nearest(CAMP_SITES, x, y), rd = riverDist(x, y);
        const n1 = fbm(u * .05, v * .05, 1, 3), n2 = fbm(u * .21, v * .21, 2, 2);

        // meadow, and the darker jungle floor away from the lanes, the bases and the camps
        col[0] = PAL.grassShade[0]; col[1] = PAL.grassShade[1]; col[2] = PAL.grassShade[2];
        to(PAL.grass, smooth(.28, .6, n1));
        to(PAL.grassLit, smooth(.55, .88, n2) * .55);
        to(PAL.grassDry, smooth(.64, .9, vnoise(u * .09 + 40, v * .09, 5)) * .3);
        let jw = smooth(110, 330, ld) * smooth(250, 520, baseD) * smooth(95, 210, campD);
        if (jw > 0) {
          jw *= .85 + .15 * n1;
          to(PAL.jungle, jw * .9);
          to(PAL.jungleDeep, jw * smooth(.5, .8, n2) * .8);
          to(PAL.moss, jw * smooth(.6, .85, vnoise(u * .45 + 9, v * .45 - 3, 6)) * .55);
        }

        // the river: bed under the water, wet sand and pebbles along the shore (only near the channel: flat low ground elsewhere stays grass)
        const near = 1 - smooth(RIVER.bank - 55, RIVER.bank + 8, rd);
        if (near > 0 && h < WATER_Y + .9) {
          const shore = (vnoise(u * .5, v * .5, 11) - .5) * .12;
          const wb = 1 - smooth(WATER_Y - .14, WATER_Y + .06, h), ws = (1 - smooth(WATER_Y + .1, WATER_Y + .62 + shore, h)) * (1 - wb) * near;
          BED[0] = mix(PAL.bedA[0], PAL.bedB[0], n2); BED[1] = mix(PAL.bedA[1], PAL.bedB[1], n2); BED[2] = mix(PAL.bedA[2], PAL.bedB[2], n2);
          to(BED, wb);
          to(PAL.sand, ws * (.85 - .25 * n2));
          to(PAL.wet, (1 - smooth(WATER_Y + .02, WATER_Y + .26, h)) * (1 - wb) * near * .75);
        }

        // steep ground turns to rock
        const rw = smooth(.5, 1.05, slope);
        if (rw > 0) { to(PAL.rock, rw * .9); to(PAL.rockDark, rw * smooth(.4, .8, n2) * .5); }

        B[i] = col[0]; B[i + 1] = col[1]; B[i + 2] = col[2]; B[i + 3] = n2;
      }
    }
    this.ready = true;
  }

  /** Phase 2: paints rows `y0..y1` of the texture. The loader calls it slice by slice and yields to the browser in between. */
  rows(y0 = 0, y1 = this.N): void {
    if (!this.ready) this.paintBase();
    const N = this.N, M = this.M, B = this.base, out = this.out, px = WORLD / N, ms = M / N, zones = this.zones, act = this.act;
    for (let py = y0; py < y1; py++) {
      const v = (py + .5) * px, y = v / K;
      const fy = Math.min(M - 1.001, Math.max(0, (py + .5) * ms - .5)), iy = fy | 0, ty = fy - iy;
      let na = 0;
      for (let z = 0; z < zones.length; z++) if (py >= zones[z].y0 && py <= zones[z].y1) act[na++] = zones[z];
      for (let pxl = 0; pxl < N; pxl++) {
        const u = (pxl + .5) * px, x = u / K, i = (py * N + pxl) * 4;

        // the smooth fields, bilinear
        const fx = Math.min(M - 1.001, Math.max(0, (pxl + .5) * ms - .5)), ix = fx | 0, tx = fx - ix;
        const a = (iy * M + ix) * 4, b = a + 4, c = a + M * 4, d = c + 4, w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
        col[0] = B[a] * w00 + B[b] * w10 + B[c] * w01 + B[d] * w11;
        col[1] = B[a + 1] * w00 + B[b + 1] * w10 + B[c + 1] * w01 + B[d + 1] * w11;
        col[2] = B[a + 2] * w00 + B[b + 2] * w10 + B[c + 2] * w01 + B[d + 2] * w11;
        const n2 = B[a + 3] * w00 + B[b + 3] * w10 + B[c + 3] * w01 + B[d + 3] * w11;
        // fine speckle, below the resolution of the smooth fields
        const n3 = vnoise(u * 1.3, v * 1.3, 3), n4 = hash2(pxl, py, 9);
        scale(.93 + .14 * n3 + .06 * (n4 - .5));

        // lanes: dirt roads with a ragged edge (the noise matters only where the edge can be)
        const ld = laneDist(x, y);
        if (ld < 112) {
          const lde = ld + (ld > 33 ? (fbm(u * .33, v * .33, 4, 2) - .5) * 30 : 0);
          let dw = 1 - smooth(66, 94, lde);
          if (dw > 0) {
            dw *= smooth(WATER_Y - .05, WATER_Y + .16, this.hAt(u, v)); // the road stops at the water's edge
            // worn lighter in the middle, darker soil at the rim, pebbles
            const worn = (1 - smooth(0, 60, ld)) * smooth(.3, .75, n2), rim = smooth(48, 80, lde) * .65;
            for (let k = 0; k < 3; k++) { const e = PAL.dirt[k] + (PAL.dirtWorn[k] - PAL.dirt[k]) * worn; ROAD[k] = e + (PAL.dirtEdge[k] - e) * rim; }
            to(ROAD, dw);
            to(PAL.pebble, dw * smooth(.78, .9, n3 * .6 + n4 * .4) * .5);
            scale(1 - dw * .05 * n4);
          }
        }

        // structures, in painting order
        let rune = 0;
        for (let k = 0; k < na; k++) {
          const z = act[k];
          if (pxl < z.x0 || pxl > z.x1) continue;
          let r = 0;
          switch (z.kind) {
            case Z_CAMP: r = camp(z.i, x, y, n3, n4); break;
            case Z_TOWER: r = tower(z.i, x, y); break;
            case Z_SHRINE: r = shrine(z.i, x, y); break;
            case Z_SPRING: r = spring(x, y, n3); break;
            case Z_ARENA: r = arena(x, y); break;
            default: r = plaza(z.i, x, y, n3);
          }
          if (r > rune) rune = r;
        }

        out[i] = col[0] * 255 + .5; out[i + 1] = col[1] * 255 + .5; out[i + 2] = col[2] * 255 + .5; out[i + 3] = rune * 255 + .5;
      }
    }
  }

  /** Last step, after every row: bakes the contact shadows of trees, rocks and buildings. */
  finish(): Uint8Array<ArrayBuffer> { shade(this.out, this.N, this.occ); return this.out; }
}

/** The whole texture in one go (tests, tools). The loader paints in slices instead. */
export function paintSplat(o: SplatOpts, out?: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const p = new SplatPainter(o, out);
  p.paintBase(); p.rows(0, p.N);
  return p.finish();
}

/** Multiplies soft dark discs into the texture: the contact shadows under trees, rocks and buildings. */
export function shade(out: Uint8Array, N: number, occ: Occluder[]): void {
  const px = WORLD / N;
  for (const o of occ) {
    const rp = o.r * K / px, cx = o.x * K / px, cy = o.y * K / px, x0 = Math.max(0, Math.floor(cx - rp)), x1 = Math.min(N - 1, Math.ceil(cx + rp)), y0 = Math.max(0, Math.floor(cy - rp)), y1 = Math.min(N - 1, Math.ceil(cy + rp));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x + .5 - cx, y + .5 - cy) / rp;
      if (d >= 1) continue;
      const f = 1 - o.k * (1 - smooth(.1, 1, d));
      const i = (y * N + x) * 4;
      out[i] *= f; out[i + 1] *= f; out[i + 2] *= f;
    }
  }
}
