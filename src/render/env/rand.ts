/**
 * Small deterministic helpers for the environment: the same map on every run, in the game and in the tests.
 * Nothing here touches Three.js or the DOM.
 */

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
export const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Hermite smooth step: 0 below `a`, 1 above `b`. */
export const smooth = (a: number, b: number, x: number): number => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/** Seeded generator (mulberry32): returns a function that yields floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer lattice hash to [0, 1). */
export function hash2(ix: number, iy: number, seed = 0): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1]; one lattice cell per unit. */
export function vnoise(x: number, y: number, seed = 0): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed), c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/** Fractal noise in [0, 1]: `oct` octaves of value noise. */
export function fbm(x: number, y: number, seed = 0, oct = 4): number {
  let s = 0, amp = .5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += amp * vnoise(x * f, y * f, seed + i * 17); n += amp; amp *= .5; f *= 2.03; }
  return s / n;
}

/** Value noise that repeats every `period` cells (for seamless tiling textures). */
export function tnoise(x: number, y: number, period: number, seed = 0): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const w = (v: number): number => ((v % period) + period) % period;
  const a = hash2(w(ix), w(iy), seed), b = hash2(w(ix + 1), w(iy), seed), c = hash2(w(ix), w(iy + 1), seed), d = hash2(w(ix + 1), w(iy + 1), seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/** Packs r, g, b in 0..1 into 0xRRGGBB. */
export const rgb = (r: number, g: number, b: number): number => ((clamp01(r) * 255 + .5) << 16) | ((clamp01(g) * 255 + .5) << 8) | ((clamp01(b) * 255 + .5) | 0);
