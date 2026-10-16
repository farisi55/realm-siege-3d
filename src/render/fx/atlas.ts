import * as THREE from 'three';

/**
 * Procedural sprite atlas for the particle layers: 4 x 4 cells of 64 px, drawn once in JS (no canvas, no image files).
 * RGB holds a little shading, A holds the shape. Particles multiply it by their own color.
 */
export const COLS = 4, CELL = 64, SIZE = COLS * CELL;

/** Cell index of each sprite in the atlas. */
export const SPR = {
  glow: 0, core: 1, star: 2, puffA: 3, puffB: 4, flame: 5, leaf: 6, plus: 7,
  ring: 8, shard: 9, bubble: 10, square: 11, streak: 12, ember: 13, puffC: 14, sparkle: 15,
} as const;
export type SprId = typeof SPR[keyof typeof SPR];

const sm = (a: number, b: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const hash = (x: number, y: number, s: number): number => { const h = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453; return h - Math.floor(h); };
const vnoise = (x: number, y: number, s: number): number => {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, s), b = hash(ix + 1, iy, s), c = hash(ix, iy + 1, s), d = hash(ix + 1, iy + 1, s);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
};
const fbm = (x: number, y: number, s: number): number => vnoise(x, y, s) * .55 + vnoise(x * 2.1, y * 2.1, s + 3) * .3 + vnoise(x * 4.3, y * 4.3, s + 7) * .15;
const edge = (r: number): number => 1 - sm(.78, 1, r);

/** Shape functions: (x, y) in [-1, 1] -> [alpha, shade]. Written into a scratch pair to avoid allocating per pixel. */
const out = { a: 0, s: 1 };
type Shape = (x: number, y: number, r: number) => void;

const puff = (seed: number): Shape => (x, y, r) => {
  const n = fbm(x * 1.9 + seed * 5.3, y * 1.9 + seed * 2.1, seed), body = sm(1, .15, r) * (.35 + n * 1.15);
  out.a = Math.min(1, body * edge(r) * 1.25);
  const light = .7 + .3 * (-x * .45 - y * .55) + (n - .5) * .35; // light from the top left: rounded, volumetric smoke
  out.s = Math.min(1, Math.max(.35, light));
};

const SHAPES: Shape[] = [];
SHAPES[SPR.glow] = (x, y, r) => { out.a = Math.exp(-r * r * 4.2) * edge(r); out.s = 1; };
SHAPES[SPR.core] = (x, y, r) => { out.a = (Math.exp(-r * r * 15) + .3 * Math.exp(-r * r * 3.2)) * edge(r); out.s = 1; };
SHAPES[SPR.star] = (x, y, r) => {
  const ax = Math.abs(x), ay = Math.abs(y);
  out.a = Math.min(1, (Math.exp(-r * r * 11) * .9 + Math.exp(-ax * 16) * Math.exp(-ay * 2.4) * .85 + Math.exp(-ay * 16) * Math.exp(-ax * 2.4) * .85) * edge(r)); out.s = 1;
};
SHAPES[SPR.puffA] = puff(1);
SHAPES[SPR.puffB] = puff(2);
SHAPES[SPR.puffC] = puff(3);
SHAPES[SPR.flame] = (x, y, r) => {
  const w = .3 + .22 * (y + 1), u = x / w, v = (y + .12) / .86, d = u * u + v * v;
  out.a = Math.exp(-d * 2.1) * edge(r) * (1 - sm(.55, 1, -y + .0) * .0) * sm(1, .78, Math.abs(y)); out.s = 1;
};
SHAPES[SPR.leaf] = (x, y) => {
  const u = (x + y) * .7071, v = (x - y) * .7071, l = .92, w = .36 * Math.max(0, 1 - Math.abs(u / l)) * 1.25;
  out.a = Math.abs(u) < l ? sm(w, w * .55, Math.abs(v)) : 0; out.s = .78 + .22 * Math.abs(v) / (w + .001) * -1 + .22;
};
SHAPES[SPR.plus] = (x, y, r) => {
  const bar = (a: number, b: number) => sm(.2, .09, Math.abs(a)) * sm(.78, .62, Math.abs(b));
  out.a = Math.min(1, Math.max(bar(y, x), bar(x, y)) + Math.exp(-r * r * 5) * .25) * edge(r); out.s = 1;
};
SHAPES[SPR.ring] = (x, y, r) => { out.a = sm(.2, .0, Math.abs(r - .72)) * edge(r) + Math.exp(-r * r * 6) * .08; out.s = 1; };
SHAPES[SPR.shard] = (x, y) => { out.a = sm(.92, .6, Math.abs(x) * 1.7 + Math.abs(y) * .95); out.s = .75 + .25 * (x > 0 ? 1 : .6); };
SHAPES[SPR.bubble] = (x, y, r) => {
  const rim = sm(.14, .0, Math.abs(r - .72)), spot = Math.exp(-((x + .3) * (x + .3) + (y + .3) * (y + .3)) * 40) * .9;
  out.a = Math.min(1, rim * .85 + spot + sm(.72, .0, r) * .08) * edge(r); out.s = 1;
};
SHAPES[SPR.square] = (x, y) => { out.a = sm(.66, .5, Math.max(Math.abs(x), Math.abs(y))); out.s = .7 + .3 * (x * .5 - y * .5 + .5); };
SHAPES[SPR.streak] = (x, y) => { out.a = Math.exp(-y * y * 70) * (1 - sm(.55, .95, Math.abs(x))) * (.4 + .6 * sm(-.9, .3, x)); out.s = 1; };
SHAPES[SPR.ember] = (x, y, r) => { out.a = (sm(.34, .16, r) + Math.exp(-r * r * 7) * .25) * edge(r); out.s = 1; };
SHAPES[SPR.sparkle] = (x, y, r) => {
  const ax = Math.abs(x), ay = Math.abs(y), d = Math.abs(ax - ay) * .7071, s = Math.abs(ax + ay) * .7071;
  out.a = Math.min(1, (Math.exp(-r * r * 18) + Math.exp(-ax * 30) * Math.exp(-ay * 3.2) * .9 + Math.exp(-ay * 30) * Math.exp(-ax * 3.2) * .9 + Math.exp(-d * 36) * Math.exp(-s * 5) * .35) * edge(r)); out.s = 1;
};

/** Builds the RGBA bytes of the atlas (exported so tests can inspect them without a GPU). */
export function buildAtlas(): Uint8Array<ArrayBuffer> {
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let cell = 0; cell < COLS * COLS; cell++) {
    const shape = SHAPES[cell];
    if (!shape) continue;
    const cx = (cell % COLS) * CELL, cy = Math.floor(cell / COLS) * CELL;
    for (let py = 0; py < CELL; py++) for (let px = 0; px < CELL; px++) {
      const x = (px + .5) / CELL * 2 - 1, y = (py + .5) / CELL * 2 - 1, r = Math.hypot(x, y);
      if (r >= 1.4142) continue;
      shape(x, y, r);
      const o = ((cy + py) * SIZE + cx + px) * 4, a = Math.min(1, Math.max(0, out.a)), s = Math.min(1, Math.max(0, out.s));
      // The outermost pixel ring of every cell stays empty so bilinear filtering never bleeds into the neighbour cell.
      const border = px === 0 || py === 0 || px === CELL - 1 || py === CELL - 1;
      data[o] = data[o + 1] = data[o + 2] = Math.round(s * 255);
      data[o + 3] = border ? 0 : Math.round(a * 255);
    }
  }
  return data;
}

let TEX: THREE.DataTexture | null = null;
/** The shared atlas texture (created on first use, never recreated). */
export function atlasTexture(): THREE.DataTexture {
  if (TEX) return TEX;
  const t = new THREE.DataTexture(buildAtlas(), SIZE, SIZE, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; t.needsUpdate = true;
  return TEX = t;
}

let GLOW: THREE.DataTexture | null = null;
/** A single soft radial glow (64 px) for Sprite flashes, which cannot select a cell of the atlas. */
export function glowTexture(): THREE.DataTexture {
  if (GLOW) return GLOW;
  const n = 64, d = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = (x + .5) / n * 2 - 1, v = (y + .5) / n * 2 - 1, r = Math.hypot(u, v), a = Math.exp(-r * r * 3.6) * (1 - sm(.7, 1, r)) + Math.exp(-r * r * 22) * .6;
    const o = (y * n + x) * 4; d[o] = d[o + 1] = d[o + 2] = 255; d[o + 3] = Math.round(Math.min(1, a) * 255);
  }
  GLOW = new THREE.DataTexture(d, n, n, THREE.RGBAFormat);
  GLOW.magFilter = THREE.LinearFilter; GLOW.minFilter = THREE.LinearFilter; GLOW.generateMipmaps = false; GLOW.needsUpdate = true;
  return GLOW;
}
