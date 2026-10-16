import * as THREE from 'three';
import { bush, chunkSphere, crystal, fern, flowers, grass, jungle, mushrooms, oak, pine, rock } from './geometry';
import { plantMaterials } from './materials';
import type { PlantMaterials } from './materials';
import { HUE, SPECIES } from './scatter';
import type { Inst, Lists, Species } from './scatter';

/**
 * Turns the scatter lists into drawable objects, with the three rules that keep a world of ten thousand plants cheap:
 *
 *   one geometry and one material per species, shared by every instance (`InstancedMesh`);
 *   instances are grouped into square chunks, one `InstancedMesh` per species and chunk, placed at the chunk's centre. Three.js
 *     culls an instanced mesh with one bounding sphere, so a single huge mesh would be drawn whole or not at all; chunks are
 *     culled one by one and the camera draws only what is near it;
 *   low growth is also hidden beyond a distance that the quality governor scales (a field of grass is not visible from far away).
 *
 * Nothing is created or destroyed while playing: the only per-frame work is flipping `visible` on the grass chunks.
 */

interface Cfg {
  geo: () => THREE.BufferGeometry;
  mat: keyof Omit<PlantMaterials, 'all'>;
  /** Chunk edge, world units. */
  chunk: number;
  shadow: boolean;
  /** Draw only within this distance of the focus (before the quality scale); 0: always (frustum culling only). */
  cull: number;
}
const CFG: Record<Species, Cfg> = {
  pine: { geo: () => pine(false), mat: 'tree', chunk: 40, shadow: true, cull: 0 },
  oak: { geo: () => oak(false), mat: 'tree', chunk: 40, shadow: true, cull: 0 },
  jungle: { geo: jungle, mat: 'tree', chunk: 40, shadow: true, cull: 0 },
  rock: { geo: () => rock(3), mat: 'stone', chunk: 40, shadow: true, cull: 0 },
  crystal: { geo: crystal, mat: 'glow', chunk: 40, shadow: false, cull: 0 },
  bush: { geo: bush, mat: 'shrub', chunk: 32, shadow: false, cull: 95 },
  mushrooms: { geo: mushrooms, mat: 'glow', chunk: 32, shadow: false, cull: 80 },
  fern: { geo: fern, mat: 'leaf', chunk: 24, shadow: false, cull: 72 },
  grass: { geo: grass, mat: 'leaf', chunk: 24, shadow: false, cull: 64 },
  flowers: { geo: flowers, mat: 'leaf', chunk: 24, shadow: false, cull: 58 },
  pineLow: { geo: () => pine(true), mat: 'tree', chunk: 64, shadow: false, cull: 0 },
  oakLow: { geo: () => oak(true), mat: 'tree', chunk: 64, shadow: false, cull: 0 },
};

const HUES: Record<number, THREE.Color> = { [HUE.cyan]: new THREE.Color(.34, .9, 1), [HUE.violet]: new THREE.Color(.7, .46, 1), [HUE.gold]: new THREE.Color(1, .8, .34) };
/** Instance color: a gentle brightness and hue variation for plants; the crystals' hue; a glow level for mushrooms. */
function tintOf(sp: Species, t: number, out: THREE.Color): THREE.Color {
  if (sp === 'crystal') { const k = t < .3 ? HUE.cyan : t < .7 ? HUE.violet : HUE.gold; return out.copy(HUES[k]).multiplyScalar(.95 + (t * 7 % 1) * .35); }
  if (sp === 'mushrooms') return out.setScalar(.95 + t * .45);
  if (sp === 'pineLow' || sp === 'oakLow') return out.setRGB(.5 + .16 * t, .66 + .12 * Math.sin(t * 12.6), .62 + .2 * (1 - t)); // the far forest: deeper and bluer, so it sits behind the playfield
  if (sp === 'grass' || sp === 'fern' || sp === 'flowers') return out.setRGB(.74 + .24 * t, .8 + .12 * Math.sin(t * 12.6), .7 + .2 * (1 - t));
  return out.setRGB(.84 + .3 * t, .94 + .12 * Math.sin(t * 12.6), .84 + .24 * (1 - t));
}

export interface Chunk { mesh: THREE.InstancedMesh; species: Species; x: number; z: number; count: number; reach: number }

export class Plants {
  readonly group = new THREE.Group();
  readonly chunks: Chunk[] = [];
  readonly materials = plantMaterials();
  private geos: THREE.BufferGeometry[] = [];
  /** Scale of the draw distance of low growth (the quality governor). */
  reach = 1;

  constructor(lists: Lists) {
    this.group.name = 'plants';
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0), C = new THREE.Color();
    for (const sp of SPECIES) {
      const list = lists[sp];
      if (!list.length) continue;
      const cfg = CFG[sp], geo = cfg.geo();
      geo.computeBoundingBox();
      let maxScale = 0;
      for (const i of list) maxScale = Math.max(maxScale, i.s * i.sy, i.s);
      chunkSphere(geo, cfg.chunk, (geo.boundingBox!.max.y) * maxScale + 1);
      this.geos.push(geo);
      const groups = new Map<string, Inst[]>();
      for (const i of list) {
        const key = Math.floor((i.x + 400) / cfg.chunk) + ':' + Math.floor((i.z + 400) / cfg.chunk);
        let a = groups.get(key); if (!a) groups.set(key, a = []);
        a.push(i);
      }
      const mat = this.materials[cfg.mat];
      for (const [key, items] of groups) {
        const [kx, kz] = key.split(':').map(Number), cx = (kx + .5) * cfg.chunk - 400, cz = (kz + .5) * cfg.chunk - 400;
        const mesh = new THREE.InstancedMesh(geo, mat, items.length);
        items.forEach((it, n) => {
          M.compose(P.set(it.x - cx, it.y, it.z - cz), Q.setFromAxisAngle(Y, it.ry), S.set(it.s, it.s * it.sy, it.s));
          mesh.setMatrixAt(n, M); mesh.setColorAt(n, tintOf(sp, it.t, C));
        });
        mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
        if (mesh.instanceColor) mesh.instanceColor.setUsage(THREE.StaticDrawUsage);
        mesh.position.set(cx, 0, cz); mesh.matrixAutoUpdate = false; mesh.updateMatrix();
        mesh.frustumCulled = true; // three r128 turns it off for instanced meshes; the shared chunk sphere (see chunkSphere) makes it safe again
        mesh.castShadow = cfg.shadow; mesh.receiveShadow = cfg.shadow || sp === 'rock';
        mesh.name = sp;
        this.group.add(mesh);
        this.chunks.push({ mesh, species: sp, x: cx, z: cz, count: items.length, reach: cfg.cull ? cfg.cull + cfg.chunk * .75 : 0 });
      }
    }
  }

  /** Hides the low growth that is too far from the focus (world x, z) to matter. `reach` (the quality governor) and the camera distance `dist` scale how far that is: from high up a blade of grass is a speck. */
  update(fx: number, fz: number, dist = 48): void {
    const zoom = Math.min(1, Math.max(.35, 1.6 - dist / 80));
    for (const c of this.chunks) {
      if (!c.reach) continue;
      const dx = c.x - fx, dz = c.z - fz, r = c.reach * this.reach * zoom;
      c.mesh.visible = dx * dx + dz * dz < r * r;
    }
  }

  /** What is built: instances and chunks per species. */
  stats(): { instances: number; chunks: number; bySpecies: Partial<Record<Species, number>> } {
    const by: Partial<Record<Species, number>> = {};
    let n = 0;
    for (const c of this.chunks) { n += c.count; by[c.species] = (by[c.species] ?? 0) + c.count; }
    return { instances: n, chunks: this.chunks.length, bySpecies: by };
  }

  dispose(): void {
    this.geos.forEach(g => g.dispose());
    for (const c of this.chunks) c.mesh.dispose();
    this.materials.all.forEach(m => m.dispose());
    this.group.parent?.remove(this.group);
  }
}
