import { BASE, CAMP, SP, TCOL, TW, W } from '../../game/config';
import { mir } from '../../game/util';

/** Where things stand on the map, in logic units (the simulation's coordinates): one place for the painter, the scatter and the structures. */
export interface Site { x: number; y: number; team: number }

export const BASES: Site[] = BASE.map((b, i) => ({ x: b[0], y: b[1], team: i }));
export const SPAWNS: Site[] = SP.map((b, i) => ({ x: b[0], y: b[1], team: i }));
/** The twelve towers: the first team's list, then its point mirror for the second team (as createWorld places them). */
export const TOWERS: Site[] = [
  ...TW.flat().map(p => ({ x: p[0], y: p[1], team: 0 })),
  ...TW.flat().map(p => { const m = mir(p); return { x: m[0], y: m[1], team: 1 }; }),
];
export const CAMPS: { x: number; y: number }[] = CAMP.map(p => ({ x: p[0], y: p[1] }));
/** The boss camp (see createWorld) and the quiet clearing that mirrors it. */
export const BOSS_PIT = { x: 1000, y: 1000 };
export const SPRING = { x: W - 1000, y: W - 1000 };
export const SHRINES: { x: number; y: number }[] = [[1300, 1500], [1500, 1300], [1900, 1700], [1700, 1900]].map(p => ({ x: p[0], y: p[1] }));
/** Braziers along the base approaches, in both halves of the map. */
export const TORCHES: { x: number; y: number }[] = [[300, 2500], [560, 2960], [200, 2950]].flatMap(p => { const m = mir(p); return [{ x: p[0], y: p[1] }, { x: m[0], y: m[1] }]; });

/** Radius of the paved base plaza and of the small pads under the towers (logic units). */
export const PLAZA_R = 330;
export const PAD_R = 70;
/** Team colors as 0xRRGGBB. */
export const TEAM_COLOR: number[] = [TCOL[0], TCOL[1]];

export const dist2 = (x: number, y: number, s: { x: number; y: number }): number => Math.hypot(x - s.x, y - s.y);
/** Distance from (x, y) to the closest site of a list. */
export function nearest(list: { x: number; y: number }[], x: number, y: number): number {
  let m = Infinity;
  for (const s of list) { const dx = x - s.x, dy = y - s.y, d = dx * dx + dy * dy; if (d < m) m = d; }
  return Math.sqrt(m);
}
