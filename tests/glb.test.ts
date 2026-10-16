// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from 'vitest';
import * as THREE from 'three';
import { writeFileSync } from 'node:fs';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { AssetManager, MODEL_FILES, assets } from '../src/assets/AssetManager';
import { CharacterAnimationController, mapClips } from '../src/render/animation';
import { CharacterVisual } from '../src/render/character';

/** A skinned 3-unit-tall figure with two bones and Blender-style clip names. */
function makeModel(withDeath: boolean) {
  const root = new THREE.Group(); root.name = 'Root';
  const geo = new THREE.BoxGeometry(1, 3, 1, 1, 3, 1), pos = geo.attributes.position, n = pos.count;
  const idx = new Uint16Array(n * 4), w = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { idx[i * 4] = pos.getY(i) > 0 ? 1 : 0; w[i * 4] = 1; }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(w, 4));
  const hips = new THREE.Bone(), spine = new THREE.Bone(); hips.name = 'Hips'; spine.name = 'Spine'; spine.position.y = .5; hips.add(spine);
  const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial({ color: 0x8888ff })); mesh.name = 'Body';
  mesh.add(hips); mesh.bind(new THREE.Skeleton([hips, spine])); root.add(mesh);
  const q = (a: number) => new THREE.Quaternion().setFromEuler(new THREE.Euler(a, 0, 0)).toArray();
  const clip = (name: string, a: number) => new THREE.AnimationClip(name, 1, [new THREE.QuaternionKeyframeTrack('Spine.quaternion', [0, 1], [...q(0), ...q(a)])]);
  const names = ['Idle', 'Walk', 'Run', 'Attack_01', 'Attack_02', 'Cast', 'Hit', ...(withDeath ? ['Death'] : [])];
  return { root, anims: names.map((nm, i) => clip(nm, .25 * (i + 1))) };
}
const exportGlb = (m: { root: THREE.Object3D; anims: THREE.AnimationClip[] }) =>
  new Promise<ArrayBuffer>(res => new GLTFExporter().parse(m.root, r => res(r as ArrayBuffer), { binary: true, animations: m.anims } as any));

let knight: ArrayBuffer, mage: ArrayBuffer;
beforeAll(async () => {
  knight = await exportGlb(makeModel(true)); mage = await exportGlb(makeModel(false));
  if (process.env.GLB_OUT) writeFileSync(process.env.GLB_OUT, Buffer.from(knight));
  vi.stubGlobal('fetch', async (req: Request) => {
    const url = typeof req === 'string' ? req : req.url;
    if (url.endsWith('arcane-knight.glb')) return new Response(knight.slice(0));
    if (url.endsWith('ember-mage.glb')) return new Response(mage.slice(0));
    return new Response('not found', { status: 404 });
  });
});

describe('GLB pipeline', () => {
  it('preload finds the files that exist and falls back (null) for the rest, reporting progress', async () => {
    const am = new AssetManager('http://test.local/assets/'); const calls: number[] = [];
    const found = await am.preload(d => calls.push(d));
    expect(found).toBe(2); expect(calls).toHaveLength(Object.keys(MODEL_FILES).length);
    expect(am.getModel('arcane-knight')).not.toBeNull(); expect(am.getModel('boss')).toBeNull();
  });
  it('instantiate scales to the requested height, stands on the ground, and clones skeletons independently', async () => {
    const am = new AssetManager('http://test.local/assets/'); await am.preload();
    const a = am.instantiate('arcane-knight', 2.5)!, b = am.instantiate('arcane-knight', 2.5)!;
    const box = new THREE.Box3().setFromObject(a.group), size = box.getSize(new THREE.Vector3());
    expect(size.y).toBeCloseTo(2.5, 1); expect(box.min.y).toBeCloseTo(0, 1);
    const an = new CharacterAnimationController(a.group, mapClips(a.clips)); an.playAttack(); an.update(.5);
    const sa = a.group.getObjectByName('Spine')!, sb = b.group.getObjectByName('Spine')!;
    expect(sa).not.toBe(sb); expect(Math.abs(sa.quaternion.x)).toBeGreaterThan(.01); expect(sb.quaternion.x).toBe(0);
  });
  it('maps flexible clip names to game states and fills missing ones', async () => {
    const am = new AssetManager('http://test.local/assets/'); await am.preload();
    const k = mapClips(am.getModel('arcane-knight')!.animations);
    expect([k.idle, k.walk, k.run, k.attack, k.attack2, k.cast, k.hit, k.death].map(c => c.name)).toEqual(['Idle', 'Walk', 'Run', 'Attack_01', 'Attack_02', 'Cast', 'Hit', 'Death']);
    expect(k.victory).toBe(k.cast);
    const m = mapClips(am.getModel('ember-mage')!.animations);
    expect(m.death.tracks.map(t => t.name)).toEqual(['.quaternion', '.position']);
    const none = mapClips([]); expect(Object.keys(none).sort()).toEqual(['attack', 'attack2', 'cast', 'channel', 'death', 'hit', 'idle', 'respawn', 'run', 'stun', 'victory', 'walk']);
  });
  it('GLB characters animate with cross-fade blending and a GLB without a death clip still dies', async () => {
    await assets.loadModel('arcane-knight', 'http://test.local/arcane-knight.glb'); await assets.loadModel('ember-mage', 'http://test.local/ember-mage.glb');
    const opt = { height: 2.5, color: 0x6aa8ff, team: 0, radius: .9 };
    const k = new CharacterVisual({ key: 'arcane-knight', ...opt });
    expect(k.glb).toBe(true); k.anim.playAttack(); k.anim.update(.3); k.anim.playIdle(); k.anim.update(.1);
    const wa = k.anim.weight('ATTACK'), wi = k.anim.weight('IDLE');
    expect(wa).toBeGreaterThan(0); expect(wi).toBeGreaterThan(0); expect(wa + wi).toBeCloseTo(1, 1);
    const m = new CharacterVisual({ key: 'ember-mage', ...opt }); m.anim.playDeath(.05); m.anim.update(1.2);
    expect(Math.abs(m.rig.rotation.x)).toBeGreaterThan(1.2);
  });
  it('GLB instances own their materials: a hit flash on one does not light up its clones', async () => {
    await assets.loadModel('arcane-knight', 'http://test.local/arcane-knight.glb');
    const opt = { key: 'arcane-knight', height: 2.5, color: 0x6aa8ff, team: 0, radius: .9 };
    const a = new CharacterVisual(opt), b = new CharacterVisual(opt), emissiveOf = (v: CharacterVisual) => (v.rig.getObjectByName('Body') as THREE.Mesh).material as THREE.MeshStandardMaterial;
    expect(emissiveOf(a)).not.toBe(emissiveOf(b));
    a.react(.3); a.preview(.016);
    expect(emissiveOf(a).emissive.r).toBeGreaterThan(.3); expect(emissiveOf(b).emissive.r).toBe(0);
  });
  it('keeps the procedural placeholder when no model exists', () => {
    const b = new CharacterVisual({ key: 'boss', height: 5.6, color: 0xb28cff, team: 2, radius: 2 });
    expect(b.glb).toBe(false); expect(b.rig.getObjectByName('armR')).toBeTruthy();
    b.anim.playWalk(); b.anim.update(.1); expect(b.state).toBe('WALK');
  });
  it('a GLB with TrailBase / TrailTip nodes gets weapon trails', () => {
    const m = makeModel(true), tip = new THREE.Object3D(), base = new THREE.Object3D();
    tip.name = 'TrailTip'; base.name = 'TrailBase'; tip.position.y = 2; m.root.add(base, tip);
    const v = new CharacterVisual({ key: 'x', height: 3, color: 0xffffff, team: 0, radius: .9, glb: { group: m.root, clips: m.anims } });
    expect(v.glb).toBe(true); expect(v.hasTrails).toBe(true);
  });
});
