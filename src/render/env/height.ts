import { H } from '../../game/map';
import { K, W } from '../../game/config';
import { fbm, mix, smooth } from './rand';
import { BOSS_PIT } from './layout';

/**
 * The shape of the ground, as the renderer sees it (the simulation is flat 2D and never reads this).
 *
 * Inside the map it is the simulation's rolling hills `H`, with two changes: the river is a continuous channel (in `H` it is only
 * a dip, so the water broke up into separate ponds wherever the hills were high), and the boss camp sits on a raised stone
 * arena. Outside the map the ground rises into a ring of forested hills, so the world no longer ends in a void.
 *
 * `terrainY(x, y)` takes logic units and returns a world height; it is defined for every point of the plane.
 */

export const WORLD = W * K;
/** Water surface and the bottom of the channel. */
export const WATER_Y = -.32;
export const RIVER = { bed: -.85, flat: 45, bank: 185 };
/** Boss arena: top height and the radii (logic units) where the platform ends and where it has fully blended into the ground. */
export const ARENA = { y: .38, flat: 130, edge: 215 };
/** Hero-select pedestal clearing, in world units (see stage.ts). */
export const STAGE = { x: 80, z: -40, y: -.45, flat: 14, edge: 34 };
/** How far the hills reach beyond the edge of the map (world units). */
export const RING = 110;

const SQ2 = Math.SQRT2;
/** Distance from the river's centre line (the diagonal x = y), logic units. */
export const riverDist = (x: number, y: number): number => Math.abs(x - y) / SQ2;

const clampW = (v: number): number => (v < 0 ? 0 : v > W ? W : v);

/** Ground inside the map. */
function inland(x: number, y: number): number {
  const rd = riverDist(x, y);
  // `H` already lowers the ground along the river by up to .9: add that back to get the hills alone.
  const hill0 = H(x, y) + (1 - Math.min(1, Math.max(0, Math.abs(x - y) / 1.414 / 150))) * .9;
  // The hills dip below the water level in places: next to the river that would flood the banks beyond the channel, so there they stay dry
  // (a soft maximum with zero, so no crease appears where they would cross it).
  const dry = 1 - smooth(300, 420, rd), hill = dry > 0 ? mix(hill0, .5 * (hill0 + Math.sqrt(hill0 * hill0 + .12)), dry) : hill0;
  let h = hill;
  const w = 1 - smooth(RIVER.flat, RIVER.bank, rd);
  if (w > 0) h = mix(hill, RIVER.bed + (fbm(x * .012, y * .012, 3, 2) - .5) * .22, w);
  const bd = Math.hypot(x - BOSS_PIT.x, y - BOSS_PIT.y);
  if (bd < ARENA.edge) h = mix(h, ARENA.y, 1 - smooth(ARENA.flat, ARENA.edge, bd));
  return h;
}

/** Ground outside the map: the edge height, a low shoulder, then hills that climb out of sight. `ox`, `oz`: how far outside along each axis (world units). */
function outland(u: number, v: number, ox: number, oz: number): number {
  const d = Math.hypot(ox, oz);
  const edge = inland(clampW(u / K), clampW(v / K));
  // The river does not end at the corners of the map: it goes on as a valley between the hills, its floor climbing slowly so the water
  // thins out and ends far away in the haze. `cw` fades the valley in over a few units from the two corner squares, so heights stay continuous.
  const cw = Math.max(smooth(0, 6, Math.min(-u, -v)), smooth(0, 6, Math.min(u - WORLD, v - WORLD)));
  const vw = cw > 0 ? cw * (1 - smooth(RIVER.flat * K, RIVER.bank * K, Math.abs(u - v) / SQ2)) : 0;
  const rise = (2.5 * smooth(0, 15, d) + 15 * Math.pow(smooth(30, RING - 10, d), 1.25)) * (1 - vw * .9);
  const rough = (fbm(u * .045, v * .045, 5) - .5) * 9 * smooth(6, 45, d) * (1 - vw);
  let h = edge + rise + rough;
  if (vw > 0) h = mix(h, RIVER.bed + 1.1 * smooth(30, RING, d) + (fbm(u * .2, v * .2, 8, 2) - .5) * .12, vw);
  const sd = Math.hypot(u - STAGE.x, v - STAGE.z);
  if (sd < STAGE.edge) h = mix(h, STAGE.y, 1 - smooth(STAGE.flat, STAGE.edge, sd));
  return h;
}

/** Terrain height (world units) at a logic position. */
export function terrainY(x: number, y: number): number {
  const u = x * K, v = y * K;
  const ox = Math.max(0, -u, u - WORLD), oz = Math.max(0, -v, v - WORLD);
  return ox === 0 && oz === 0 ? inland(x, y) : outland(u, v, ox, oz);
}

/** Same, with world coordinates. */
export const terrainAt = (u: number, v: number): number => terrainY(u / K, v / K);

/** Terrain heights on a regular grid over the map: (n + 1)^2 values, row = z, spacing WORLD / n. The terrain mesh, the water and the painter share it. */
export function heightGrid(n: number): Float32Array {
  const g = new Float32Array((n + 1) * (n + 1)), step = WORLD / n;
  for (let iz = 0; iz <= n; iz++) for (let ix = 0; ix <= n; ix++) g[iz * (n + 1) + ix] = terrainAt(ix * step, iz * step);
  return g;
}
