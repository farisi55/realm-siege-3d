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

/**
 * Opt-in character pack v3. Kept OUT of MODEL_FILES on purpose: `preload()` never touches it, so the procedural
 * heroes remain the default until a future selection explicitly calls `loadV3()` / `instantiateV3()`.
 */
export const MODEL_FILES_V3: Record<string, string> = {
  'arcane-knight-v3': 'characters/v3/arcane-knight-v3.glb',
  'shadow-huntress-v3': 'characters/v3/shadow-huntress-v3.glb',
  'ember-mage-v3': 'characters/v3/ember-mage-v3.glb',
  'nature-guardian-v3': 'characters/v3/nature-guardian-v3.glb',
  'storm-warrior-v3': 'characters/v3/storm-warrior-v3.glb',
};

/** Gameplay hero key (e.g. 'arcane-knight') to its opt-in v3 model key. */
export const V3_HERO_KEYS: Record<string, string> = {
  'arcane-knight': 'arcane-knight-v3',
  'shadow-huntress': 'shadow-huntress-v3',
  'ember-mage': 'ember-mage-v3',
  'nature-guardian': 'nature-guardian-v3',
  'storm-warrior': 'storm-warrior-v3',
};

const BASE: string = (import.meta as any).env?.BASE_URL ?? './';
const WORLD = new THREE.Vector3();

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
  loadModel(key: string, url: string = this.root + (MODEL_FILES[key] ?? MODEL_FILES_V3[key] ?? '')): Promise<GLTF | null> {
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

  /** Loads every default model in parallel; returns how many were found. The v3 pack is not included. */
  async preload(onProgress?: (done: number, total: number) => void): Promise<number> {
    const keys = Object.keys(MODEL_FILES);
    let done = 0, found = 0;
    await Promise.all(keys.map(k => this.loadModel(k).then(g => { if (g) found++; onProgress?.(++done, keys.length); })));
    return found;
  }

  /** Lazily loads one v3 hero by its gameplay key. Never rejects: a missing file simply resolves to null. */
  loadV3(heroKey: string): Promise<GLTF | null> {
    const key = V3_HERO_KEYS[heroKey];
    return key ? this.loadModel(key) : Promise.resolve(null);
  }

  /** Loads the whole v3 pack on demand; only for a future opt-in UI. Returns how many were found. */
  async preloadV3(onProgress?: (done: number, total: number) => void): Promise<number> {
    const keys = Object.keys(MODEL_FILES_V3);
    let done = 0, found = 0;
    await Promise.all(keys.map(k => this.loadModel(k).then(g => { if (g) found++; onProgress?.(++done, keys.length); })));
    return found;
  }

  /**
   * Clones an already loaded v3 hero, correcting the pack's -Z art direction and placing its foot bones on y = 0.
   * Null until `loadV3()` has succeeded (or when the file is absent).
   */
  instantiateV3(heroKey: string, height: number): { group: THREE.Group; clips: THREE.AnimationClip[] } | null {
    const key = V3_HERO_KEYS[heroKey];
    const gltf = key ? this.getModel(key) : null;
    return gltf ? this.buildModel(gltf, height, { yaw: Math.PI, feet: true }) : null;
  }

  /** Clones a loaded model (skeleton-safe), scales it to `height` world units and stands it on y = 0. */
  instantiate(key: string, height: number): { group: THREE.Group; clips: THREE.AnimationClip[] } | null {
    const gltf = this.getModel(key);
    return gltf ? this.buildModel(gltf, height) : null;
  }

  /**
   * Shared clone/scale/place step. By default the bind-pose bounds touch the ground (existing behavior); the opt-in v3
   * path uses the foot bones instead, because those files carry capes and robes below the feet.
   */
  private buildModel(
    gltf: GLTF, height: number, o: { yaw?: number; feet?: boolean } = {},
  ): { group: THREE.Group; clips: THREE.AnimationClip[] } {
    const model = SkeletonUtils.clone(gltf.scene);
    if (o.yaw) model.rotation.y = o.yaw;
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    let baseY = box.min.y;
    if (o.feet) {
      let footY = Infinity;
      model.traverse(n => {
        if (n.name === 'LeftFoot' || n.name === 'RightFoot') footY = Math.min(footY, n.getWorldPosition(WORLD).y);
      });
      if (Number.isFinite(footY)) baseY = footY;
    }
    const s = box.max.y > baseY ? height / (box.max.y - baseY) : 1;
    model.scale.multiplyScalar(s);
    model.position.y -= baseY * s;
    model.traverse(o2 => { if ((o2 as THREE.Mesh).isMesh) { o2.castShadow = true; o2.receiveShadow = true; } });
    const group = new THREE.Group();
    group.add(model);
    return { group, clips: gltf.animations };
  }
}

export const assets = new AssetManager();
