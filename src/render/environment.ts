import * as THREE from 'three';
import { app } from '../game/state';
import { K } from '../game/config';
import { cm, rd, sn } from './scene';
import { rig } from './camera';
import { STAGE, heightGrid } from './env/height';
import { SplatPainter } from './env/splat';
import { detailTexture, splatTexture } from './env/textures';
import { buildTerrain } from './env/terrain';
import type { Terrain } from './env/terrain';
import { buildWater } from './env/water';
import type { Water } from './env/water';
import { Atmosphere } from './env/atmosphere';
import { scatter } from './env/scatter';
import { Plants } from './env/plants';
import { Props, disposeStructures } from './env/structures';
import { SHARED } from './env/shared';

/**
 * The world around the heroes, built once while the game loads (`buildEnvironment`, called by `boot`) and then only animated.
 *
 *   env/height.ts, layout.ts, rand.ts   the shape of the ground and where things stand (pure, shared with the tests)
 *   env/splat.ts                        paints the ground texture
 *   env/terrain.ts, water.ts            the ground and river meshes and their materials
 *   env/scatter.ts, geometry.ts, plants.ts   where plants and rocks stand, their shapes, and the instanced chunks that draw them
 *   env/structures.ts                   towers, the core, bridges, pylons, braziers, shrines, the spring (stone, trim, halos, light pools)
 *   env/atmosphere.ts                   sky, haze, fireflies
 *
 * Nothing here touches the simulation: it reads the camera and the clock, and `groundY` / `terrainY` (render-side heights) stay the
 * single source for where a character stands.
 */

export interface EnvOptions {
  /** Called as the build proceeds: steps done, steps in total. */
  onProgress?: (done: number, total: number) => void;
  /** Small sizes for the unit tests (they run on a stubbed renderer). Defaults to the Vite mode. */
  test?: boolean;
}

const yieldFrame = (): Promise<void> => new Promise(r => setTimeout(r, 0));
const STEPS = 9;

export class Environment {
  readonly group = new THREE.Group();
  terrain!: Terrain;
  water!: Water;
  atmosphere!: Atmosphere;
  plants!: Plants;
  props!: Props;
  /** Nominal splat resolution and height grid used (smaller in tests). */
  readonly sizes: { splat: number; grid: number; ring: number };
  private parts: { dispose(): void }[] = [];

  constructor(readonly test: boolean) {
    this.sizes = test ? { splat: 64, grid: 32, ring: 10 } : { splat: 1024, grid: 160, ring: 2 };
    this.group.name = 'environment';
  }

  async build(onProgress?: EnvOptions['onProgress']): Promise<void> {
    let done = 0;
    const step = async (): Promise<void> => { onProgress?.(++done, STEPS); await yieldFrame(); };
    const { splat: N, grid: n, ring } = this.sizes;
    const hg = heightGrid(n);
    const detail = detailTexture(this.test ? 16 : 128);
    await step();

    const placed = scatter({ test: this.test });
    await step();

    // ground colors, painted in slices so the loading screen keeps moving (the contact shadows of the plants are baked in)
    const painter = new SplatPainter({ size: N, hg, n, occluders: placed.occluders });
    painter.paintBase();
    const slice = Math.max(16, N >> 4);
    for (let y = 0; y < N; y += slice) { painter.rows(y, Math.min(N, y + slice)); if (!this.test) await yieldFrame(); }
    const pixels = painter.finish();
    const maxAniso = (rd as any).capabilities?.getMaxAnisotropy?.() ?? 1;
    const tex = splatTexture(pixels, N, Math.min(8, maxAniso));
    this.parts.push(tex, detail);
    await step();

    this.terrain = buildTerrain({ hg, n, splat: tex, detail, pixels, size: N, ringStep: ring });
    this.group.add(this.terrain.group);
    this.parts.push(this.terrain);
    await step();

    this.water = buildWater(this.test);
    this.group.add(this.water.mesh);
    this.parts.push(this.water);
    await step();

    this.plants = new Plants(placed.lists);
    this.group.add(this.plants.group);
    this.parts.push(this.plants);
    await step();

    this.props = new Props();
    this.group.add(this.props.group);
    this.parts.push(this.props);
    await step();

    this.atmosphere = new Atmosphere(sn, this.test ? 8 : 160);
    this.parts.push(this.atmosphere);
    await step();

    sn.add(this.group);
    await step();
  }

  /** Per frame. `focus`: the ground point the camera looks at, `dist`: how far the camera is from it (world units). */
  update(dt: number, cam: THREE.Vector3, focus: THREE.Vector3, dist: number, menu: boolean): void {
    this.atmosphere.update(dt, cam, focus, dist, menu, rd.getPixelRatio?.() ?? 1);
    this.plants.update(focus.x, focus.z, dist);
    this.props.update(SHARED.time.value);
  }

  /** The quality governor's knobs: how far the low growth reaches, how many fireflies fly, how strongly the runes glow. */
  setQuality(q: { reach: number; flies: number; rune: number }): void {
    this.plants.reach = q.reach;
    this.atmosphere.setFireflyCount(q.flies);
    SHARED.rune.value = q.rune;
  }

  dispose(): void {
    for (const p of this.parts) p.dispose();
    this.parts = [];
    disposeStructures();
    sn.remove(this.group);
  }
}

let current: Environment | null = null;
const F = new THREE.Vector3();

/** Builds the world (once). The loading screen shows `onProgress`. */
export async function buildEnvironment(o: EnvOptions = {}): Promise<Environment> {
  if (current) return current;
  const test = o.test ?? import.meta.env.MODE === 'test';
  const e = new Environment(test);
  await e.build(o.onProgress);
  current = e;
  return e;
}

export const environment = (): Environment | null => current;

/** One frame of the environment (water, wind, haze, fireflies, ...). Called by `frame` after the match or the menu stage placed the camera. */
export function updateEnvironment(dt: number): void {
  const e = current;
  if (!e) return;
  const menu = !(app.mode === 'play' && app.G);
  if (menu) F.set(STAGE.x, 1.2, STAGE.z); else F.set(rig.fx * K, rig.fh, rig.fy * K);
  e.update(dt, cm.position, F, menu ? 12 : rig.dist, menu);
}
