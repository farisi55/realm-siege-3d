// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { AssetManager, MODEL_FILES, MODEL_FILES_V3, V3_HERO_KEYS, assets } from '../src/assets/AssetManager';
import { CharacterVisual } from '../src/render/character';
import { heroModelSource } from '../src/render/characterPack';
import { app } from '../src/game/state';

const PACK_DIR = join(process.cwd(), 'public/assets/characters/v3');
const PACK = ['arcane-knight-v3', 'shadow-huntress-v3', 'ember-mage-v3', 'nature-guardian-v3', 'storm-warrior-v3'];
const BONES = [
  'Root', 'Pelvis', 'Spine', 'Chest', 'Neck', 'Head',
  'LeftUpperArm', 'LeftLowerArm', 'LeftHand', 'RightUpperArm', 'RightLowerArm', 'RightHand',
  'LeftUpperLeg', 'LeftLowerLeg', 'LeftFoot', 'RightUpperLeg', 'RightLowerLeg', 'RightFoot',
];
/** Durations discovered from the supplied files (the pack manifest lists the wrong Cast duration for two heroes). */
const CLIPS: Record<string, Record<string, number>> = {
  'arcane-knight-v3': { Idle: 2, Walk: 1, Run: .68, Attack: .82, Cast: 1.15, Hit: .42, Death: 1.25, Victory: 1.45 },
  'shadow-huntress-v3': { Idle: 2, Walk: 1, Run: .68, Attack: .72, Cast: 1.1, Hit: .42, Death: 1.25, Victory: 1.45 },
  'ember-mage-v3': { Idle: 2, Walk: 1, Run: .68, Attack: .78, Cast: 1.2, Hit: .42, Death: 1.25, Victory: 1.45 },
  'nature-guardian-v3': { Idle: 2, Walk: 1, Run: .68, Attack: .86, Cast: 1.15, Hit: .42, Death: 1.25, Victory: 1.45 },
  'storm-warrior-v3': { Idle: 2, Walk: 1, Run: .68, Attack: .92, Cast: 1.15, Hit: .42, Death: 1.25, Victory: 1.45 },
};

const bytesOf = (file: string): Uint8Array => readFileSync(join(PACK_DIR, file + '.glb'));
const arrayBufferOf = (file: string): ArrayBuffer => {
  const b = bytesOf(file);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const parse = (file: string): Promise<GLTF> =>
  new Promise((res, rej) => new GLTFLoader().parse(arrayBufferOf(file), '', res, rej));

const loaded = new Map<string, GLTF>();
beforeAll(async () => {
  for (const f of PACK) loaded.set(f, await parse(f));
}, 30000);

describe('character pack v3 files', () => {
  it('all five files are glTF 2.0 with a scene, skinned meshes, a full skin and inverse bind matrices', () => {
    for (const f of PACK) {
      const g = loaded.get(f)!;
      expect((g.parser as any).json.asset.version).toBe('2.0');
      expect(g.scene).toBeTruthy();

      const meshes: THREE.Mesh[] = [];
      g.scene.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
      expect(meshes.length).toBeGreaterThan(0);
      const skinned = meshes.filter((m): m is THREE.SkinnedMesh => (m as THREE.SkinnedMesh).isSkinnedMesh);
      expect(skinned).toHaveLength(meshes.length);

      const skin = skinned[0].skeleton;
      expect(skin.bones.map(b => b.name)).toEqual(BONES);
      expect(skin.boneInverses).toHaveLength(BONES.length);
      for (const m of skinned) {
        expect(m.geometry.getAttribute('skinIndex')).toBeTruthy();
        expect(m.geometry.getAttribute('skinWeight')).toBeTruthy();
        expect(m.skeleton.bones).toHaveLength(BONES.length);
        const pos = m.geometry.getAttribute('position');
        const idx = m.geometry.getAttribute('skinIndex');
        const w = m.geometry.getAttribute('skinWeight');
        expect(idx.count).toBe(pos.count);
        expect(w.count).toBe(pos.count);
        for (let i = 0; i < pos.count; i++) {
          expect(idx.getX(i)).toBeLessThan(BONES.length);
          expect(w.getX(i) + w.getY(i) + w.getZ(i) + w.getW(i)).toBeCloseTo(1, 3);
        }
      }
    }
  });

  it('each file has exactly the eight expected clips, with real non-zero durations', () => {
    for (const f of PACK) {
      const g = loaded.get(f)!;
      expect(g.animations.map(c => c.name).sort()).toEqual(Object.keys(CLIPS[f]).sort());
      for (const clip of g.animations) {
        expect(clip.tracks.length).toBeGreaterThan(0);
        expect(clip.duration).toBeCloseTo(CLIPS[f][clip.name], 2);
      }
    }
  });

  it('every clip track targets a bone of that model\'s skeleton', () => {
    for (const f of PACK) {
      const g = loaded.get(f)!;
      const bones = new Set<string>();
      g.scene.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) (o as THREE.SkinnedMesh).skeleton.bones.forEach(b => bones.add(b.name)); });
      for (const clip of g.animations) {
        expect(clip.tracks.length).toBeGreaterThan(0);
        for (const t of clip.tracks) {
          const [node, prop] = t.name.split('.');
          expect(bones.has(node)).toBe(true);
          expect(['position', 'quaternion', 'scale']).toContain(prop);
          expect(Array.from(t.values).every(Number.isFinite)).toBe(true);
        }
      }
    }
  });

  it('all five share the same 18-bone humanoid rig and expose the four sockets in their extras', () => {
    for (const f of PACK) {
      const g = loaded.get(f)!;
      const extras = (g.parser as any).json.asset.extras;
      expect(extras.rig).toBe('Humanoid_18Bone_SkinnedMesh');
      expect(extras.skinJoints).toBe(18);
      expect(extras.forwardAxis).toBe('-Z');
      expect(extras.sockets).toEqual(['WeaponSocket', 'HeadSocket', 'ChestSocket', 'RootSocket']);
      const sockets: string[] = [];
      g.scene.traverse(n => { if (/Socket$/.test(n.name)) sockets.push(n.name); });
      expect(sockets.sort()).toEqual([...extras.sockets].sort());
    }
  });

  it('the bind-pose bounds have a plausible human height and the feet sit just above the origin', () => {
    for (const f of PACK) {
      const g = loaded.get(f)!;
      const box = new THREE.Box3().setFromObject(g.scene), size = box.getSize(new THREE.Vector3());
      expect(size.y).toBeGreaterThan(2);
      expect(size.y).toBeLessThan(3);
      let first: THREE.SkinnedMesh | undefined;
      g.scene.traverse(o => { if (!first && (o as THREE.SkinnedMesh).isSkinnedMesh) first = o as THREE.SkinnedMesh; });
      const skinned = first!;
      const byName = new Map(skinned.skeleton.bones.map(b => [b.name, b]));
      g.scene.updateMatrixWorld(true);
      for (const name of ['LeftFoot', 'RightFoot']) {
        const y = byName.get(name)!.getWorldPosition(new THREE.Vector3()).y;
        expect(y).toBeGreaterThan(0);
        expect(y).toBeLessThan(box.max.y * .25);
      }
    }
  });
});

describe('v3 registration stays opt-in', () => {
  it('keeps the v3 manifest separate from the default MODEL_FILES', () => {
    expect(Object.keys(MODEL_FILES_V3)).toEqual(PACK);
    for (const key of PACK) {
      expect(MODEL_FILES[key]).toBeUndefined();
      expect(MODEL_FILES_V3[key]).toBe(`characters/v3/${key}.glb`);
    }
    expect(MODEL_FILES['arcane-knight']).toBe('characters/arcane-knight.glb');
    expect(Object.keys(V3_HERO_KEYS).sort()).toEqual(['arcane-knight', 'ember-mage', 'nature-guardian', 'shadow-huntress', 'storm-warrior']);
  });

  it('default preload never requests the v3 directory, so procedural models remain the default', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (req: Request) => {
      urls.push(typeof req === 'string' ? req : req.url);
      return new Response('not found', { status: 404 });
    });
    try {
      const am = new AssetManager('http://test.local/assets/');
      expect(await am.preload()).toBe(0);
      expect(urls).toHaveLength(Object.keys(MODEL_FILES).length);
      expect(urls.some(u => u.includes('/characters/v3/'))).toBe(false);
      expect(am.instantiate('arcane-knight', 2.3)).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('the default hero visual still builds the procedural rig', () => {
    const v = new CharacterVisual({ key: 'arcane-knight', height: 2.55, color: 0x6aa8ff, team: 0, radius: .9, hero: true });
    expect(v.glb).toBe(false);
    expect(v.rig.getObjectByName('armR')).toBeTruthy();
    v.dispose();
  });

  it('lazy loading + cloning reuses AssetManager cache and SkeletonUtils', async () => {
    vi.stubGlobal('fetch', async (req: Request) => {
      const url = typeof req === 'string' ? req : req.url;
      const f = PACK.find(k => url.endsWith(`/characters/v3/${k}.glb`));
      return f ? new Response(arrayBufferOf(f)) : new Response('not found', { status: 404 });
    });
    try {
      const am = new AssetManager('http://test.local/assets/');
      const g = await am.loadV3('arcane-knight');
      expect(g).not.toBeNull();
      expect(am.getModel('arcane-knight-v3')).toBe(g);
      expect(am.getModel('arcane-knight')).toBeNull();

      const a = am.instantiateV3('arcane-knight', 2.3)!, b = am.instantiateV3('arcane-knight', 2.3)!;
      expect(a).not.toBeNull(); expect(b).not.toBeNull();
      expect(a.clips).toHaveLength(8);
      const box = new THREE.Box3().setFromObject(a.group);
      expect(box.max.y).toBeCloseTo(2.3, 1); // standing height, measured to the top of the model
      expect(box.min.y).toBeLessThan(0); // the cape may extend below the feet
      expect(a.group.children[0].rotation.y).toBeCloseTo(Math.PI, 5); // v3 art faces -Z; the game expects +Z
      a.group.updateMatrixWorld(true);
      expect(a.group.getObjectByName('LeftFoot')!.getWorldPosition(new THREE.Vector3()).y).toBeCloseTo(0, 1);
      expect(a.group.getObjectByName('Spine')).not.toBe(b.group.getObjectByName('Spine'));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('routes hero visuals to v3 only while that pack is selected', async () => {
    vi.stubGlobal('fetch', async (req: Request) => {
      const url = typeof req === 'string' ? req : req.url;
      return url.endsWith('/characters/v3/arcane-knight-v3.glb')
        ? new Response(arrayBufferOf('arcane-knight-v3'))
        : new Response('not found', { status: 404 });
    });
    const before = app.pack;
    try {
      app.pack = 'procedural';
      expect(heroModelSource('arcane-knight', 2.55)).toBeUndefined();
      await assets.loadV3('arcane-knight');
      app.pack = 'v3';
      const src = heroModelSource('arcane-knight', 2.55);
      expect(src).toBeTruthy();
      expect(src!.clips).toHaveLength(8);
      expect(src!.group.children[0].rotation.y).toBeCloseTo(Math.PI, 5);
      expect(heroModelSource('ember-mage', 2.6)).toBeUndefined(); // not loaded: per-hero procedural fallback
    } finally {
      app.pack = before;
      vi.unstubAllGlobals();
    }
  });

  it('two units built from the same v3 file own separate skeletons and mixers', async () => {
    vi.stubGlobal('fetch', async (req: Request) => {
      const url = typeof req === 'string' ? req : req.url;
      return url.endsWith('/characters/v3/arcane-knight-v3.glb')
        ? new Response(arrayBufferOf('arcane-knight-v3'))
        : new Response('not found', { status: 404 });
    });
    try {
      const am = new AssetManager('http://test.local/assets/');
      await am.loadV3('arcane-knight');
      const opt = { key: 'arcane-knight', height: 2.55, color: 0x6aa8ff, team: 0, radius: .9, hero: true } as const;
      const a = new CharacterVisual({ ...opt, glb: am.instantiateV3('arcane-knight', 2.55)! });
      const b = new CharacterVisual({ ...opt, glb: am.instantiateV3('arcane-knight', 2.55)! });
      expect(a.anim.mixer).not.toBe(b.anim.mixer);
      const ca = a.rig.getObjectByName('Chest')!, cb = b.rig.getObjectByName('Chest')!;
      expect(ca).not.toBe(cb);
      a.anim.playIdle(); b.anim.playIdle(); a.anim.update(.4); b.anim.update(.4);
      const rest = cb.quaternion.clone();
      a.anim.playAttack(); a.anim.update(.3);
      expect(ca.quaternion.angleTo(new THREE.Quaternion())).toBeGreaterThan(0); // A swings
      expect(cb.quaternion.angleTo(rest)).toBeLessThan(1e-6); // B keeps its own pose
      a.dispose(); b.dispose();
    } finally { vi.unstubAllGlobals(); }
  });

  it('missing v3 files resolve to null and never break the app', async () => {
    vi.stubGlobal('fetch', async () => new Response('not found', { status: 404 }));
    try {
      const am = new AssetManager('http://test.local/assets/');
      expect(await am.loadV3('ember-mage')).toBeNull();
      expect(await am.loadV3('not-a-hero')).toBeNull();
      expect(am.instantiateV3('ember-mage', 2.3)).toBeNull();
      expect(await am.preloadV3()).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

/* ------------------------------------------------------------------ rig quality */

const component = (a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, i: number, c: number): number =>
  c === 0 ? a.getX(i) : c === 1 ? a.getY(i) : c === 2 ? a.getZ(i) : a.getW(i);

/** Every skinned vertex of the scene at the pose its skeleton currently holds, in the mesh's own space. */
function skinnedPositions(meshes: THREE.SkinnedMesh[]): Float32Array[] {
  const v = new THREE.Vector3();
  return meshes.map(m => {
    const p = m.geometry.getAttribute('position'), out = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      m.boneTransform(i, v.fromBufferAttribute(p, i));
      out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z;
    }
    return out;
  });
}

const mover = (a: Float32Array, b: Float32Array): { frac: number; max: number } => {
  let moved = 0, max = 0;
  for (let i = 0; i < a.length; i += 3) {
    const d = Math.hypot(b[i] - a[i], b[i + 1] - a[i + 1], b[i + 2] - a[i + 2]);
    if (d > .01) moved++;
    max = Math.max(max, d);
  }
  return { frac: moved / (a.length / 3), max };
};

/**
 * The pack's skins are weight-painted onto the body bones (rigid per body part), not locked to Root: this is what
 * makes the eight clips visible in game. If a future pack replaces these files, a root-locked skin fails here instead
 * of shipping five heroes that slide around in their bind pose.
 */
describe('v3 rig deforms: the skin follows the body bones', () => {
  it('keeps Root out of the dominant slot for (almost) every vertex', () => {
    for (const f of PACK) {
      const g = loaded.get(f)!;
      const meshes: THREE.SkinnedMesh[] = [];
      g.scene.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh); });
      const root = meshes[0].skeleton.bones.findIndex(b => b.name === 'Root');
      expect(root).toBeGreaterThanOrEqual(0);
      let atRoot = 0, total = 0;
      for (const m of meshes) {
        const idx = m.geometry.getAttribute('skinIndex'), w = m.geometry.getAttribute('skinWeight');
        for (let i = 0; i < idx.count; i++) {
          let best = -1, bw = -1;
          for (let c = 0; c < 4; c++) { const x = component(w, i, c); if (x > bw) { bw = x; best = component(idx, i, c); } }
          if (best === root) atRoot++;
          total++;
        }
      }
      expect(atRoot / total, `${f}: ${atRoot}/${total} vertices bound to Root`).toBeLessThan(.05);
    }
  });

  it('moves a meaningful part of the body in every clip, with a visible amplitude', () => {
    for (const f of PACK) {
      const g = loaded.get(f)!;
      const meshes: THREE.SkinnedMesh[] = [];
      g.scene.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh); });
      const bones = meshes[0].skeleton.bones;
      const rest = bones.map(b => [b.position.clone(), b.quaternion.clone(), b.scale.clone()] as const);
      const bind = skinnedPositions(meshes);
      const mixer = new THREE.AnimationMixer(g.scene);
      try {
        for (const clip of g.animations) {
          mixer.stopAllAction();
          const a = mixer.clipAction(clip); a.reset(); a.play();
          mixer.setTime(clip.duration / 2);
          g.scene.updateMatrixWorld(true);
          const posed = skinnedPositions(meshes);
          let frac = 0, max = 0, total = 0;
          for (let mi = 0; mi < meshes.length; mi++) {
            const r = mover(bind[mi], posed[mi]), n = bind[mi].length / 3;
            frac += r.frac * n; total += n; max = Math.max(max, r.max);
          }
          expect(frac / total, `${f} ${clip.name}: ${Math.round(100 * frac / total)}% of vertices moved`).toBeGreaterThan(.4);
          expect(max, `${f} ${clip.name}: max displacement ${max.toFixed(3)}`).toBeGreaterThan(.03);
        }
      } finally {
        mixer.stopAllAction();
        bones.forEach((b, i) => { b.position.copy(rest[i][0]); b.quaternion.copy(rest[i][1]); b.scale.copy(rest[i][2]); });
        g.scene.updateMatrixWorld(true);
      }
    }
  });
});
