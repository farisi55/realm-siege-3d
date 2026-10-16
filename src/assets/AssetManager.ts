import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { SkeletonUtils } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { HR } from '../game/config';

export const slug = (n: string): string => n.toLowerCase().replace(/\s+/g, '-');

/** Every model the game can use, relative to public/assets/. A missing file simply keeps the procedural placeholder. */
export const MODEL_FILES: Record<string, string> = {
  ...Object.fromEntries(HR.map(h => [slug(h.n), `characters/${slug(h.n)}.glb`])),
  'melee-creep': 'creeps/melee-creep.glb',
  'ranged-creep': 'creeps/ranged-creep.glb',
  neutral: 'monsters/neutral.glb',
  boss: 'monsters/boss.glb',
};

const BASE: string = (import.meta as any).env?.BASE_URL ?? './';

export class AssetManager {
  readonly loader = new GLTFLoader();
  private cache = new Map<string, GLTF | null>();
  private pending = new Map<string, Promise<GLTF | null>>();

  constructor(private root = BASE + 'assets/', private timeoutMs = 8000) {
    const draco = new DRACOLoader();
    draco.setDecoderPath(BASE + 'draco/');
    this.loader.setDRACOLoader(draco);
  }

  /** Loads and caches one model. Resolves to null (never rejects) when the file is missing, invalid or slow. */
  loadModel(key: string, url: string = this.root + MODEL_FILES[key]): Promise<GLTF | null> {
    let p = this.pending.get(key);
    if (!p) {
      p = this.fetchGltf(url).then(g => { this.cache.set(key, g); return g; });
      this.pending.set(key, p);
    }
    return p;
  }

  private async fetchGltf(url: string): Promise<GLTF | null> {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, { signal: ctl.signal });
      // A 404, or a dev server answering with its index.html, both mean "no model": keep the placeholder.
      if (!res.ok || /text\/html/i.test(res.headers.get('content-type') || '')) return null;
      const data = await res.arrayBuffer();
      return await new Promise<GLTF | null>(done => this.loader.parse(data, url.slice(0, url.lastIndexOf('/') + 1), g => done(g), () => done(null)));
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  getModel(key: string): GLTF | null { return this.cache.get(key) ?? null; }

  /** Loads every known model in parallel; returns how many were found. */
  async preload(onProgress?: (done: number, total: number) => void): Promise<number> {
    const keys = Object.keys(MODEL_FILES);
    let done = 0, found = 0;
    await Promise.all(keys.map(k => this.loadModel(k).then(g => { if (g) found++; onProgress?.(++done, keys.length); })));
    return found;
  }

  /** Clones a loaded model (skeleton-safe), scales it to `height` world units and stands it on y = 0. */
  instantiate(key: string, height: number): { group: THREE.Group; clips: THREE.AnimationClip[] } | null {
    const gltf = this.getModel(key);
    if (!gltf) return null;
    const model = SkeletonUtils.clone(gltf.scene);
    const box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3());
    const s = size.y > 0 ? height / size.y : 1;
    model.scale.multiplyScalar(s);
    model.position.y -= box.min.y * s;
    model.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    const group = new THREE.Group();
    group.add(model);
    return { group, clips: gltf.animations };
  }
}

export const assets = new AssetManager();
