import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { K } from '../src/game/config';
import { BRIDGES, DECK } from '../src/render/ground';
import { WATER_Y, WORLD, terrainAt } from '../src/render/env/height';
import { SHRINES, SPRING, TORCHES } from '../src/render/env/layout';
import { MAGIC } from '../src/render/env/palette';
import { Plants } from '../src/render/env/plants';
import { SPECIES, scatter } from '../src/render/env/scatter';
import type { Scatter, Species } from '../src/render/env/scatter';
import { SHARED } from '../src/render/env/shared';
import { Atmosphere } from '../src/render/env/atmosphere';
import { Props, coreModel, crystalMaterial, disposeStructures, flameMaterial, haloMaterial, poolMaterial, stoneMaterial, towerModel, trimMaterial } from '../src/render/env/structures';
import type { StructureUserData } from '../src/render/env/structures';
import { addRim, contactShadow, disposeReadability } from '../src/render/readability';
import { glowTexture } from '../src/render/env/textures';

// What the world is made of: towers, cores, bridges, props, plants, the air, the readability helpers. No GPU and no DOM: Three.js objects are plain data until a renderer draws them.

const BLUE = 0x3b9cff, RED = 0xff4a5a;
const lights = (o: THREE.Object3D): number => { let n = 0; o.traverse(c => { if ((c as THREE.Light).isLight) n++; }); return n; };
const meshes = (o: THREE.Object3D): THREE.Mesh[] => { const m: THREE.Mesh[] = []; o.traverse(c => { if ((c as THREE.Mesh).isMesh) m.push(c as THREE.Mesh); }); return m; };
const verts = (o: THREE.Object3D): number => meshes(o).reduce((n, m) => n + m.geometry.getAttribute('position').count, 0);
const userData = (g: THREE.Group): StructureUserData => g.userData as StructureUserData;

// ------------------------------------------------------------------------------------------------------------------------ materials

describe('structure materials', () => {
  it('are cached: one material per kind and color, however many towers ask', () => {
    expect(stoneMaterial()).toBe(stoneMaterial());
    expect(trimMaterial(BLUE)).toBe(trimMaterial(BLUE)); expect(trimMaterial(BLUE)).not.toBe(trimMaterial(RED));
    expect(crystalMaterial(BLUE)).toBe(crystalMaterial(BLUE)); expect(haloMaterial(BLUE)).toBe(haloMaterial(BLUE));
    expect(poolMaterial(BLUE)).toBe(poolMaterial(BLUE)); expect(poolMaterial(BLUE, .2)).not.toBe(poolMaterial(BLUE, .4));
    expect(flameMaterial()).toBe(flameMaterial());
  });
  it('stone is lit and takes its color from the vertices; the team trim is unlit and carries the team color exactly', () => {
    const s = stoneMaterial(), t = trimMaterial(RED);
    expect(s.vertexColors).toBe(true); expect(s.roughness).toBeGreaterThan(.7); expect(s.metalness).toBeLessThan(.2);
    expect(t.type).toBe('MeshBasicMaterial'); expect(t.color.getHex()).toBe(RED);
  });
  it('crystals glow from within, but not so much that the bloom would have to hide the shape', () => {
    const c = crystalMaterial(BLUE);
    expect(c.emissive.getHex()).toBe(BLUE); expect(c.emissiveIntensity).toBeGreaterThan(.5); expect(c.emissiveIntensity).toBeLessThanOrEqual(1.2);
  });
  it('halos and light pools are additive, do not write depth, and halos ignore the haze', () => {
    const h = haloMaterial(BLUE), p = poolMaterial(BLUE);
    for (const m of [h, p]) { expect(m.transparent).toBe(true); expect(m.blending).toBe(THREE.AdditiveBlending); expect(m.depthWrite).toBe(false); expect(m.opacity).toBeLessThan(.7); }
    expect(h.fog).toBe(false); expect(p.polygonOffset).toBe(true); expect(p.map).toBeTruthy();
  });
  it('the flame is a shader driven by the shared clock, drawn with normal blending so it cannot burn out to white', () => {
    const f = flameMaterial();
    expect(f.uniforms.uTime).toBe(SHARED.time); expect(f.blending).toBe(THREE.NormalBlending); expect(f.transparent).toBe(true); expect(f.depthWrite).toBe(false);
  });
});

// ------------------------------------------------------------------------------------------------------------------------ towers and cores

describe('towers', () => {
  it('are stone, team trim, a crystal, a halo and a light pool: five things to draw, no light source', () => {
    const t = towerModel(BLUE), d = userData(t);
    expect(lights(t)).toBe(0);
    expect(meshes(t)).toHaveLength(4); // stone, trim, crystal, pool
    expect(t.children.filter(c => (c as THREE.Sprite).isSprite)).toHaveLength(1);
    expect(d.cr).toBeTruthy(); expect(d.gl.isSprite).toBe(true); expect(d.glow).toBeGreaterThan(1); expect(d.rg).toBeUndefined();
    expect(d.gl.scale.x).toBe(d.glow);
  });
  it('are a few thousand vertices, about as tall as the camera expects, and cast shadows', () => {
    const t = towerModel(BLUE);
    expect(verts(t)).toBeGreaterThan(1500); expect(verts(t)).toBeLessThan(4000);
    const box = new THREE.Box3();
    for (const m of meshes(t).slice(0, 2)) { m.geometry.computeBoundingBox(); box.union(m.geometry.boundingBox!); }
    expect(box.min.y).toBeGreaterThanOrEqual(-.01); expect(box.max.y).toBeGreaterThan(4.8); expect(box.max.y).toBeLessThan(6.5);
    expect(Math.max(box.max.x, box.max.z)).toBeLessThan(2.3); // narrower than the pad under it
    const [stone, trim] = meshes(t); expect(stone.castShadow).toBe(true); expect(stone.receiveShadow).toBe(true); expect(trim.castShadow).toBe(true);
    expect(d(t).cr.position.y).toBeGreaterThan(box.max.y - 1.2); // the crystal floats at the top
    function d(g: THREE.Group): StructureUserData { return userData(g); }
  });
  it('share geometry and materials: towers of one team share everything, both teams share the stone material', () => {
    const a = towerModel(BLUE), b = towerModel(BLUE), c = towerModel(RED);
    const [sa, ta] = meshes(a), [sb, tb] = meshes(b), [sc, tc] = meshes(c);
    expect(sb.geometry).toBe(sa.geometry); expect(tb.geometry).toBe(ta.geometry); expect(sb.material).toBe(sa.material); expect(tb.material).toBe(ta.material);
    expect(sc.material).toBe(sa.material); expect(tc.material).not.toBe(ta.material); expect((tc.material as THREE.MeshBasicMaterial).color.getHex()).toBe(RED);
    expect(userData(b).gl.material).toBe(userData(a).gl.material); expect(userData(c).gl.material).not.toBe(userData(a).gl.material);
    expect(userData(a).cr).not.toBe(userData(b).cr); // the mutable parts are not shared: each tower spins its own crystal
  });
  it('the team color is on the trim, the halo and the crystal: readable at a glance', () => {
    const t = towerModel(RED), d = userData(t), [, trim, cr] = meshes(t);
    expect((trim.material as THREE.MeshBasicMaterial).color.getHex()).toBe(RED);
    expect((d.gl.material as THREE.SpriteMaterial).color.getHex()).toBe(RED);
    expect((cr.material as THREE.MeshStandardMaterial).emissive.getHex()).toBe(RED);
  });
});

describe('cores', () => {
  it('are bigger than a tower: a dais, a crystal with a bright heart, two orbit rings, a halo and a large light pool', () => {
    const c = coreModel(RED), t = towerModel(RED), d = userData(c);
    expect(lights(c)).toBe(0);
    expect(d.cr).toBeTruthy(); expect(d.rg).toBeTruthy(); expect(d.gl.isSprite).toBe(true); expect(d.glow).toBeGreaterThan(userData(t).glow);
    expect(d.rg!.children).toHaveLength(2); expect(d.cr.children).toHaveLength(1); // the heart
    const [r1, r2] = d.rg!.children as THREE.Mesh[];
    expect(r1.geometry).toBe(r2.geometry); expect(r1.material).toBe(r2.material);
    expect(verts(c)).toBeLessThan(5000);
    expect(meshes(c).length).toBeLessThanOrEqual(8);
  });
  it('the rings orbit the crystal at its height', () => {
    const d = userData(coreModel(BLUE));
    expect(d.rg!.position.y).toBeCloseTo(d.cr.position.y, 6);
    expect(d.gl.position.y).toBeCloseTo(d.cr.position.y, 6);
  });
  it('the dais has a lighter, wider light pool than the tower\'s', () => {
    const find = (g: THREE.Group): THREE.Mesh => meshes(g).find(m => (m.material as THREE.MeshBasicMaterial).blending === THREE.AdditiveBlending && (m.material as THREE.MeshBasicMaterial).map)!;
    expect(find(coreModel(BLUE)).scale.x).toBeGreaterThan(find(towerModel(BLUE)).scale.x);
  });
});

// ------------------------------------------------------------------------------------------------------------------------ props

describe('world props', () => {
  let props: Props;
  beforeAll(() => { props = new Props(); });

  it('stay inside a draw budget and use no lights: a few dozen meshes, a handful of halos', () => {
    const ms = meshes(props.group), sprites = props.group.children.filter(c => (c as THREE.Sprite).isSprite);
    expect(lights(props.group)).toBe(0);
    expect(ms.length).toBeLessThanOrEqual(40); expect(sprites).toHaveLength(SHRINES.length + 1);
    expect(verts(props.group)).toBeLessThan(30000);
  });
  it('merge the stone of the pylons, braziers, shrines and the spring into one mesh that casts shadows', () => {
    const big = meshes(props.group).filter(m => m.material === stoneMaterial() && m.rotation.y === 0);
    expect(big).toHaveLength(1);
    expect(big[0].castShadow).toBe(true); expect(big[0].receiveShadow).toBe(true);
    big[0].geometry.computeBoundingBox();
    const b = big[0].geometry.boundingBox!;
    expect(b.min.x).toBeGreaterThan(-2); expect(b.min.z).toBeGreaterThan(-2); expect(b.max.x).toBeLessThan(WORLD + 2); expect(b.max.z).toBeLessThan(WORLD + 2);
  });
  it('put one bridge on each crossing, turned across the river, all sharing one geometry', () => {
    const decks = meshes(props.group).filter(m => m.material === stoneMaterial() && Math.abs(m.rotation.y - Math.PI / 4) < 1e-9);
    expect(decks).toHaveLength(BRIDGES.length);
    for (const [bx, by] of BRIDGES) expect(decks.some(m => Math.abs(m.position.x - bx * K) < 1e-9 && Math.abs(m.position.z - by * K) < 1e-9)).toBe(true);
    for (const m of decks) { expect(m.geometry).toBe(decks[0].geometry); expect(m.castShadow).toBe(true); }
  });
  it('bridge planks lie exactly at the height characters stand on (groundY\'s deck top)', () => {
    const deck = meshes(props.group).find(m => m.material === stoneMaterial() && Math.abs(m.rotation.y - Math.PI / 4) < 1e-9)!;
    const p = deck.geometry.getAttribute('position'), n = deck.geometry.getAttribute('normal');
    const top = DECK.y + DECK.h / 2;
    let flat = 0, over = 0;
    for (let i = 0; i < p.count; i++) if (Math.abs(p.getY(i) - top) < 1e-6 && n.getY(i) > .99 && Math.abs(p.getZ(i)) <= DECK.d / 2 + 1e-6) flat++;
    for (let i = 0; i < p.count; i++) if (Math.abs(p.getX(i)) < DECK.w / 2 - 1 && Math.abs(p.getZ(i)) < DECK.d / 2 - .5 && n.getY(i) > .99 && p.getY(i) > top + 1e-6 && p.getY(i) < top + .5) over++;
    expect(flat).toBeGreaterThan(60); // many planks, each with an upward face at the deck height
    expect(over).toBe(0); // and nothing sticks up in the walkway
  });
  it('the lanterns on the bridges are warm, unlit trim', () => {
    const l = meshes(props.group).filter(m => (m.material as THREE.MeshBasicMaterial).color && (m.material as THREE.MeshBasicMaterial).color.getHex() === 0xffc873);
    expect(l).toHaveLength(BRIDGES.length);
  });
  it('light a brazier with a flame and an ember pool at every torch site', () => {
    const flames = meshes(props.group).filter(m => m.material === flameMaterial());
    expect(flames).toHaveLength(TORCHES.length);
    for (const f of flames) expect(f.geometry).toBe(flames[0].geometry);
    for (const t of TORCHES) {
      const x = t.x * K, z = t.y * K;
      expect(flames.some(f => Math.abs(f.position.x - x) < 1e-9 && Math.abs(f.position.z - z) < 1e-9 && f.position.y > terrainAt(x, z) + 1)).toBe(true);
    }
  });
  it('put a floating crystal over every shrine and the spring, and bob and turn them with the clock', () => {
    const gold = meshes(props.group).filter(m => m.material === crystalMaterial(MAGIC.gold)), cyan = meshes(props.group).filter(m => m.material === crystalMaterial(MAGIC.cyan));
    expect(gold).toHaveLength(SHRINES.length); expect(cyan).toHaveLength(1);
    const all = [...gold, ...cyan], y0 = all.map(m => m.position.y);
    props.update(0); const a = all.map(m => m.position.y);
    props.update(1.3); const b = all.map(m => m.position.y), rot = all.map(m => m.rotation.y);
    all.forEach((m, i) => {
      expect(Math.abs(a[i] - y0[i]), 'bob stays small').toBeLessThanOrEqual(.15); expect(Math.abs(b[i] - y0[i])).toBeLessThanOrEqual(.15);
      expect(rot[i]).not.toBe(0);
    });
    expect(b).not.toEqual(a);
    // the spring crystal floats above its basin, which is raised out of the water
    expect(cyan[0].position.x).toBeCloseTo(SPRING.x * K, 6);
    expect(cyan[0].position.y).toBeGreaterThan(WATER_Y + 2);
  });
  it('light pools lie just above the ground and never below it', () => {
    const pools = meshes(props.group).filter(m => (m.material as THREE.MeshBasicMaterial).blending === THREE.AdditiveBlending && (m.material as THREE.MeshBasicMaterial).map);
    expect(pools.length).toBeGreaterThanOrEqual(TORCHES.length + SHRINES.length + 1);
    for (const p of pools) { const g = Math.max(terrainAt(p.position.x, p.position.z), WATER_Y); expect(p.position.y, `${p.position.x},${p.position.z}`).toBeGreaterThan(g); expect(p.position.y - g).toBeLessThan(2.2); }
  });
  it('dispose frees its own geometries and leaves the shared ones to disposeStructures', () => {
    const p = new Props(), parent = new THREE.Group(); parent.add(p.group);
    const own = meshes(p.group).filter(m => m.material !== flameMaterial()).map(m => m.geometry);
    let disposed = 0; own.forEach(g => g.addEventListener('dispose', () => disposed++));
    p.dispose();
    expect(p.group.parent).toBeNull(); expect(disposed).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------------------------------------------------------------------ plants

describe('plants', () => {
  let sc: Scatter, plants: Plants;
  const of = (sp: Species): Plants['chunks'] => plants.chunks.filter(c => c.species === sp);
  beforeAll(() => { sc = scatter(); plants = new Plants(sc.lists); });

  it('draw every scattered instance, grouped into chunks of at most a few hundred', () => {
    const st = plants.stats(), want = SPECIES.reduce((n, k) => n + sc.lists[k].length, 0);
    expect(st.instances).toBe(want); expect(st.chunks).toBe(plants.chunks.length); expect(plants.group.children).toHaveLength(plants.chunks.length);
    for (const sp of SPECIES) expect(st.bySpecies[sp], sp).toBe(sc.lists[sp].length);
    expect(Math.max(...plants.chunks.map(c => c.count))).toBeLessThan(400);
    expect(plants.chunks.length).toBeLessThan(900);
    for (const c of plants.chunks) expect(c.mesh.count).toBe(c.count);
  });
  it('reuse one geometry per species and one material per kind (a few state changes for ten thousand plants)', () => {
    const geos = new Set(plants.chunks.map(c => c.mesh.geometry)), mats = new Set(plants.chunks.map(c => c.mesh.material));
    expect(geos.size).toBe(SPECIES.length);
    expect(mats.size).toBe(5); // trees, shrubs, leaves, stone, glow
    for (const sp of SPECIES) expect(new Set(of(sp).map(c => c.mesh.geometry)).size, sp).toBe(1);
    expect(of('grass')[0].mesh.material).toBe(of('fern')[0].mesh.material); expect(of('pine')[0].mesh.material).toBe(of('oak')[0].mesh.material);
  });
  it('every chunk is frustum culled, with a shared bounding sphere that contains all its instances', () => {
    const m = new THREE.Matrix4(), v = new THREE.Vector3(), c0 = new THREE.Vector3();
    for (const c of plants.chunks) {
      expect(c.mesh.frustumCulled, `${c.species} ${c.x},${c.z}`).toBe(true);
      const s = c.mesh.geometry.boundingSphere!;
      expect(s, c.species).toBeTruthy();
      for (let i = 0; i < c.count; i++) {
        c.mesh.getMatrixAt(i, m); v.setFromMatrixPosition(m);
        expect(v.distanceTo(c0.copy(s.center)), `${c.species} instance ${i}`).toBeLessThanOrEqual(s.radius);
      }
    }
  });
  it('the chunks are placed at their centres and never move (static draw, no matrix updates)', () => {
    for (const c of plants.chunks) {
      expect(c.mesh.matrixAutoUpdate).toBe(false); expect(c.mesh.position.x).toBe(c.x); expect(c.mesh.position.z).toBe(c.z);
      expect(c.mesh.instanceMatrix.usage).toBe(THREE.StaticDrawUsage);
    }
  });
  it('trees and boulders cast shadows; grass, ferns and flowers do not (a shadow for every blade would cost more than it shows)', () => {
    for (const sp of ['pine', 'oak', 'jungle', 'rock'] as const) for (const c of of(sp)) expect(c.mesh.castShadow, sp).toBe(true);
    for (const sp of ['grass', 'fern', 'flowers', 'bush', 'mushrooms', 'pineLow', 'oakLow'] as const) for (const c of of(sp)) expect(c.mesh.castShadow, sp).toBe(false);
    for (const c of of('rock')) expect(c.mesh.receiveShadow).toBe(true);
  });
  it('the far forest is deeper and bluer than the near trees, so it sits behind the playfield', () => {
    const avg = (sp: Species): { l: number; bMinusR: number } => {
      let l = 0, br = 0, n = 0;
      for (const c of of(sp)) { const a = c.mesh.instanceColor!.array as Float32Array; for (let i = 0; i < c.count; i++) { l += (a[i * 3] + a[i * 3 + 1] + a[i * 3 + 2]) / 3; br += a[i * 3 + 2] - a[i * 3]; n++; } }
      return { l: l / n, bMinusR: br / n };
    };
    const far = avg('pineLow'), near = avg('pine');
    expect(far.l).toBeLessThan(near.l); expect(far.bMinusR).toBeGreaterThan(near.bMinusR);
    for (const c of plants.chunks) for (const v of c.mesh.instanceColor!.array as Float32Array) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1.6); }
  });
  it('low growth is hidden beyond a distance that shrinks with the quality level and with the zoom; tall things are never hidden', () => {
    const grass = of('grass')[0], c = grass, d = c.reach * .6;
    plants.reach = 1; plants.update(c.x + d, c.z, 48); expect(c.mesh.visible).toBe(true);
    plants.update(c.x + c.reach * 1.5, c.z, 48); expect(c.mesh.visible).toBe(false);
    plants.reach = .35; plants.update(c.x + d, c.z, 48); expect(c.mesh.visible, 'lowest quality').toBe(false);
    plants.reach = 1; plants.update(c.x + d, c.z, 110); expect(c.mesh.visible, 'zoomed far out').toBe(false);
    plants.update(c.x + d, c.z, 20); expect(c.mesh.visible, 'zoomed in').toBe(true);
    plants.update(-9999, -9999, 48);
    for (const sp of ['pine', 'oak', 'jungle', 'rock', 'crystal', 'pineLow', 'oakLow'] as const) for (const k of of(sp)) expect(k.mesh.visible, sp).toBe(true);
    for (const sp of ['grass', 'fern', 'flowers', 'bush', 'mushrooms'] as const) for (const k of of(sp)) expect(k.mesh.visible, sp).toBe(false);
    plants.reach = 1;
  });
  it('around the focus the low growth is on, and the visible share is a fraction of the whole (the grass is not drawn across the map)', () => {
    plants.reach = 1;
    plants.update(WORLD / 2, WORLD / 2, 48);
    const low = plants.chunks.filter(c => c.reach), on = low.filter(c => c.mesh.visible).length;
    expect(on).toBeGreaterThan(5); expect(on / low.length).toBeLessThan(.7);
  });
  it('from the MOBA camera only a fraction of the chunks is drawn, and zooming out does not make it more (frustum culling plus the reach by zoom)', () => {
    const cam = new THREE.PerspectiveCamera(45, 16 / 9, 1, 600), fr = new THREE.Frustum(), M = new THREE.Matrix4();
    const drawn = (fx: number, fz: number, dist: number, reach = 1): { seen: number; drawn: number; instances: number } => {
      const fh = terrainAt(fx, fz), yaw = -.785, pitch = .95;
      cam.position.set(fx - Math.sin(yaw) * Math.cos(pitch) * dist, fh + Math.sin(pitch) * dist, fz - Math.cos(yaw) * Math.cos(pitch) * dist);
      cam.lookAt(fx, fh, fz); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
      M.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); fr.setFromProjectionMatrix(M);
      plants.reach = reach; plants.update(fx, fz, dist);
      let seen = 0, n = 0, inst = 0;
      for (const c of plants.chunks) { c.mesh.updateWorldMatrix(true, false); const inView = fr.intersectsObject(c.mesh); if (inView) seen++; if (inView && c.mesh.visible) { n++; inst += c.count; } }
      return { seen, drawn: n, instances: inst };
    };
    const centre = drawn(WORLD / 2, WORLD / 2, 48), base = drawn(360 * K, 2840 * K, 48), lane = drawn(400 * K, 1600 * K, 48), wide = drawn(WORLD / 2, WORLD / 2, 110), low = drawn(WORLD / 2, WORLD / 2, 48, .35);
    expect(plants.chunks.length).toBeGreaterThan(400);
    for (const v of [centre, base, lane]) { expect(v.seen, 'in view').toBeLessThan(plants.chunks.length * .4); expect(v.drawn, 'drawn').toBeLessThan(plants.chunks.length * .35); expect(v.instances).toBeLessThan(9000); }
    expect(wide.seen).toBeGreaterThan(centre.seen); // a wider view sees more chunks ...
    expect(wide.drawn).toBeLessThanOrEqual(centre.drawn); // ... but the reach scales down with the zoom, so it does not draw more
    expect(low.drawn).toBeLessThan(centre.drawn * .7); // and the lowest quality level draws far fewer
    plants.reach = 1; plants.update(WORLD / 2, WORLD / 2, 48);
  });
  it('dispose releases the geometries and materials and removes the group', () => {
    const p = new Plants(scatter({ test: true }).lists), parent = new THREE.Group(); parent.add(p.group);
    let n = 0; p.materials.all.forEach(m => m.addEventListener('dispose', () => n++));
    p.dispose();
    expect(p.group.parent).toBeNull(); expect(n).toBe(p.materials.all.length);
  });
});

// ------------------------------------------------------------------------------------------------------------------------ the air

describe('atmosphere', () => {
  const make = (flies = 160): { sc: THREE.Scene; a: Atmosphere } => { const sc = new THREE.Scene(); sc.fog = new THREE.Fog(0xaaaaaa, 60, 220); return { sc, a: new Atmosphere(sc, flies) }; };

  it('the haze follows the zoom: the ground you play on stays clear, what lies beyond fades', () => {
    const [n1, f1] = Atmosphere.fogRange(40, false), [n2, f2] = Atmosphere.fogRange(110, false), [nm, fm] = Atmosphere.fogRange(40, true);
    expect(n1).toBeGreaterThan(40); expect(n1).toBeLessThan(f1); expect(n2).toBeGreaterThan(n1); expect(f2).toBeGreaterThan(f1);
    expect([nm, fm]).toEqual([26, 190]);
    expect(n1).toBeGreaterThan(40 * 1.0); // the far ground of a normal view is not in the haze at all
  });
  it('the sky dome is drawn first, behind everything, and is never culled', () => {
    const { sc, a } = make();
    expect(sc.children).toContain(a.dome); expect(sc.children).toContain(a.flies);
    expect(a.dome.renderOrder).toBeLessThan(-100); expect(a.dome.frustumCulled).toBe(false);
    const m = a.dome.material as THREE.ShaderMaterial; expect(m.depthWrite).toBe(false); expect(m.side).toBe(THREE.BackSide); expect(m.fog).toBe(false);
    a.dispose();
  });
  it('per frame: the clock runs, the dome follows the camera, the haze eases toward the zoom, the fireflies follow the focus', () => {
    const { sc, a } = make();
    const t0 = SHARED.time.value, cam = new THREE.Vector3(10, 40, 20), focus = new THREE.Vector3(5, 1, 6), fog = sc.fog as THREE.Fog;
    const [tn, tf] = Atmosphere.fogRange(60, false);
    for (let i = 0; i < 200; i++) a.update(1 / 60, cam, focus, 60, false, 2);
    expect(SHARED.time.value).toBeCloseTo(t0 + 200 / 60, 6);
    expect(a.dome.position.toArray()).toEqual([10, 40, 20]);
    expect(fog.near).toBeCloseTo(tn, 0); expect(fog.far).toBeCloseTo(tf, 0);
    const u = (a.flies.material as THREE.ShaderMaterial).uniforms;
    expect(u.uFocus.value.toArray()).toEqual([5, 1, 6]); expect(u.uPixel.value).toBe(2); expect(u.uRadius.value).toBeGreaterThan(14);
    a.update(1 / 60, cam, focus, 60, true);
    expect(u.uRadius.value).toBe(14); // the menu keeps the fireflies near the pedestal
    a.dispose();
  });
  it('the number of fireflies is a draw range, not a rebuild; zero hides them', () => {
    const { a } = make(160);
    expect(a.flies.geometry.getAttribute('seed').count).toBe(160);
    a.setFireflyCount(48); expect(a.flies.geometry.drawRange).toEqual({ start: 0, count: 48 }); expect(a.flies.visible).toBe(true);
    a.setFireflyCount(0); expect(a.flies.visible).toBe(false);
    a.setFireflyCount(110.9); expect(a.flies.geometry.drawRange.count).toBe(110); expect(a.flies.visible).toBe(true);
    a.setFireflyCount(-5); expect(a.flies.geometry.drawRange.count).toBe(0);
    a.setFireflies(true); expect(a.flies.visible).toBe(true); a.setFireflies(false); expect(a.flies.visible).toBe(false);
    a.dispose();
  });
  it('the fireflies glow additively, without depth writes, in one draw call', () => {
    const { a } = make();
    const m = a.flies.material as THREE.ShaderMaterial;
    expect(m.blending).toBe(THREE.AdditiveBlending); expect(m.depthWrite).toBe(false); expect(m.transparent).toBe(true);
    expect(a.flies.isPoints).toBe(true);
    a.dispose();
  });
  it('dispose removes the dome and the fireflies from the scene', () => {
    const { sc, a } = make();
    a.dispose();
    expect(sc.children).not.toContain(a.dome); expect(sc.children).not.toContain(a.flies);
  });
});

// ------------------------------------------------------------------------------------------------------------------------ readability

describe('character readability', () => {
  it('the rim light patches a standard material\'s shader and shares its uniforms, with no extra draw', () => {
    const m = new THREE.MeshStandardMaterial();
    addRim(m, BLUE, .4);
    expect(m.onBeforeCompile).toBeTypeOf('function');
    const shader: any = { uniforms: {}, fragmentShader: '#include <common>\nvoid main() {\n#include <aomap_fragment>\n}' };
    (m.onBeforeCompile as any)(shader, null);
    expect(shader.fragmentShader).toContain('uniform vec3 uRimColor;'); expect(shader.fragmentShader).toContain('uniform float uRimK;');
    expect(shader.fragmentShader).toMatch(/#include <aomap_fragment>[\s\S]*rimNdv/); // after the lighting, before the output
    expect(shader.uniforms.uRimK.value).toBe(.4);
    const c = shader.uniforms.uRimColor.value as THREE.Color;
    expect(c.b).toBeGreaterThan(c.r); // a blue unit is outlined in blue (lightened a little)
    const again: any = { uniforms: {}, fragmentShader: shader.fragmentShader.replace(/[\s\S]*/, '#include <common>\n#include <aomap_fragment>') };
    (m.onBeforeCompile as any)(again, null);
    expect(again.uniforms.uRimColor).toBe(shader.uniforms.uRimColor); // the same uniform objects for every compile of this material
  });
  it('the rim is team-colored: red stays red', () => {
    const m = new THREE.MeshStandardMaterial(); addRim(m, RED, .5);
    const s: any = { uniforms: {}, fragmentShader: '#include <common>\n#include <aomap_fragment>' }; (m.onBeforeCompile as any)(s, null);
    const c = s.uniforms.uRimColor.value as THREE.Color; expect(c.r).toBeGreaterThan(c.b); expect(c.r).toBeGreaterThan(c.g);
  });
  it('a contact shadow is a dark soft blob under the feet; heroes also stand on a team-colored pad', () => {
    disposeReadability();
    const creep = contactShadow(.8, BLUE, false), hero = contactShadow(1.2, BLUE, true);
    expect(creep.group.children).toHaveLength(1); expect(hero.group.children).toHaveLength(2);
    const blob = hero.group.children[0] as THREE.Mesh, pad = hero.group.children[1] as THREE.Mesh;
    const bm = blob.material as THREE.MeshBasicMaterial, pm = pad.material as THREE.MeshBasicMaterial;
    expect(bm.color.getHex()).toBe(0); expect(bm.transparent).toBe(true); expect(bm.depthWrite).toBe(false); expect(bm.opacity).toBeGreaterThan(.2); expect(bm.opacity).toBeLessThan(.7);
    expect(pm.blending).toBe(THREE.AdditiveBlending); expect(pm.color.getHex()).toBe(BLUE); expect(pm.opacity).toBeLessThan(.4);
    expect(blob.scale.x).toBeCloseTo(1.2 * 2.7, 9); expect(pad.scale.x).toBeGreaterThan(blob.scale.x);
    for (const m of [blob, pad]) { expect(m.position.y).toBeGreaterThan(0); expect(m.position.y).toBeLessThan(.2); expect(m.renderOrder).toBeGreaterThan(0); }
    expect(pad.renderOrder).toBeGreaterThan(blob.renderOrder);
  });
  it('all contact decals share one quad, one blob material and one pad material per team color', () => {
    const a = contactShadow(1, BLUE, true), b = contactShadow(2, BLUE, true), c = contactShadow(1, RED, true), d = contactShadow(1, BLUE, false);
    const geo = (g: { group: THREE.Group }, i: number): THREE.BufferGeometry => (g.group.children[i] as THREE.Mesh).geometry, mat = (g: { group: THREE.Group }, i: number): THREE.Material => (g.group.children[i] as THREE.Mesh).material as THREE.Material;
    expect(geo(a, 0)).toBe(geo(b, 0)); expect(geo(a, 0)).toBe(geo(c, 1)); expect(mat(a, 0)).toBe(mat(d, 0)); expect(mat(a, 1)).toBe(mat(b, 1)); expect(mat(a, 1)).not.toBe(mat(c, 1));
  });
  it('disposeReadability frees the shared resources; new decals get new ones', () => {
    const a = contactShadow(1, BLUE, false), g = (a.group.children[0] as THREE.Mesh).geometry;
    let freed = false; g.addEventListener('dispose', () => { freed = true; });
    disposeReadability();
    expect(freed).toBe(true);
    expect((contactShadow(1, BLUE, false).group.children[0] as THREE.Mesh).geometry).not.toBe(g);
    disposeReadability();
  });
});

// ------------------------------------------------------------------------------------------------------------------------ textures

describe('glow texture', () => {
  it('is a soft round falloff: opaque white-ish in the middle, nothing at the edge', () => {
    const t = glowTexture(64, 2), d = t.image.data as unknown as ArrayLike<number>, n = 64;
    const a = (x: number, y: number): number => d[(y * n + x) * 4 + 3];
    expect(a(32, 32)).toBeGreaterThan(230); expect(a(0, 0)).toBe(0); expect(a(0, 32)).toBe(0); expect(a(63, 63)).toBe(0);
    expect(a(32, 32)).toBeGreaterThan(a(40, 32)); expect(a(40, 32)).toBeGreaterThan(a(52, 32));
    expect(Math.abs(a(20, 32) - a(43, 32))).toBeLessThanOrEqual(1); expect(Math.abs(a(32, 20) - a(32, 43))).toBeLessThanOrEqual(1); // symmetric about the centre (31.5)
    t.dispose();
  });
});

// This one last: it empties the shared caches.
describe('disposeStructures', () => {
  it('frees the shared materials and geometries, and the next tower gets new ones', () => {
    const t = towerModel(BLUE), [stone] = meshes(t);
    let g = false, m = false;
    stone.geometry.addEventListener('dispose', () => { g = true; }); stone.material instanceof THREE.Material && stone.material.addEventListener('dispose', () => { m = true; });
    disposeStructures();
    expect(g).toBe(true); expect(m).toBe(true);
    const [stone2] = meshes(towerModel(BLUE));
    expect(stone2.geometry).not.toBe(stone.geometry); expect(stone2.material).not.toBe(stone.material);
    disposeStructures();
  });
});
