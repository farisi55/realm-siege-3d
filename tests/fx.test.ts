import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CELL, COLS, SIZE, SPR, atlasTexture, buildAtlas, glowTexture } from '../src/render/fx/atlas';
import { ParticleLayer, newSpec } from '../src/render/fx/particles';
import type { PSpec } from '../src/render/fx/particles';
import { DECAL, MeshFx, Pool } from '../src/render/fx/mesh';
import type { FxCounts, Slot } from '../src/render/fx/mesh';
import { DECAL_FRAG, DECAL_VERT, DOME_FRAG, DOME_VERT, EMIT, PILLAR_FRAG, PILLAR_VERT, RING_FRAG, RING_VERT } from '../src/render/fx/shaders';
import { Kit, Timeline } from '../src/render/fx/kit';
import type { CamSink } from '../src/render/fx/kit';
import { Director, newStructAcc } from '../src/render/fx/director';
import { StageFx } from '../src/render/fx/stage';
import { COLORS, paletteOf } from '../src/render/fx/style';
import { createWorld, stepSim } from '../src/game/sim/world';
import { app, hooks } from '../src/game/state';
import { cast, hurt } from '../src/game/sim/combat';
import { mk } from '../src/game/sim/units';
import { HR, K } from '../src/game/config';
import { groundY } from '../src/render/ground';

// Everything here runs without a DOM or a GPU: the pools, the shader sources and the Director are plain objects.

const spec = (o: Partial<PSpec> = {}): PSpec => Object.assign(newSpec(), o);
const attr = (l: ParticleLayer, n: string) => l.points.geometry.getAttribute(n) as THREE.BufferAttribute;
const sum = (o: object): number => (Object.values(o) as number[]).reduce((a, b) => a + b, 0);
const geo = (s: Slot) => (s.obj as THREE.Mesh).geometry as THREE.BufferGeometry;

// ------------------------------------------------------------------------------------------------------------------------ atlas

describe('particle atlas', () => {
  const data = buildAtlas();
  const cellStats = (cell: number) => {
    const cx = (cell % COLS) * CELL, cy = Math.floor(cell / COLS) * CELL;
    let max = 0, edge = 0, total = 0;
    for (let py = 0; py < CELL; py++) for (let px = 0; px < CELL; px++) {
      const a = data[((cy + py) * SIZE + cx + px) * 4 + 3];
      max = Math.max(max, a); total += a;
      if (px === 0 || py === 0 || px === CELL - 1 || py === CELL - 1) edge = Math.max(edge, a);
    }
    return { max, edge, total };
  };

  it('is a 4 x 4 grid of 64 px RGBA cells', () => {
    expect(SIZE).toBe(COLS * CELL); expect(data).toHaveLength(SIZE * SIZE * 4);
  });
  it('draws every named sprite, each different from the others', () => {
    const totals = new Set<number>();
    for (const [name, cell] of Object.entries(SPR)) {
      const s = cellStats(cell);
      expect(s.max, name).toBeGreaterThan(120);
      totals.add(s.total);
    }
    expect(totals.size).toBe(Object.keys(SPR).length);
  });
  it('keeps the outer pixel ring of every cell empty, so linear filtering never bleeds into the neighbour', () => {
    for (const [name, cell] of Object.entries(SPR)) expect(cellStats(cell).edge, name).toBe(0);
  });
  it('shares one texture, unfiltered by mipmaps (which would smear the cells together)', () => {
    expect(atlasTexture()).toBe(atlasTexture()); expect(glowTexture()).toBe(glowTexture());
    for (const t of [atlasTexture(), glowTexture()]) { expect(t.generateMipmaps).toBe(false); expect(t.minFilter).toBe(THREE.LinearFilter); }
  });
});

// ------------------------------------------------------------------------------------------------------------------------ particles

describe('ParticleLayer', () => {
  it('never holds more than its capacity, counts what it had to drop and remembers its peak', () => {
    const l = new ParticleLayer(8, 'add');
    for (let i = 0; i < 20; i++) l.emit(spec({ life: 5 }));
    expect(l.count).toBe(8); expect(l.free).toBe(0); expect(l.emitted).toBe(8); expect(l.dropped).toBe(12); expect(l.peak).toBe(8);
    expect(l.emit(spec())).toBe(false);
    l.update(10);
    expect(l.count).toBe(0); expect(l.peak).toBe(8); // a high-water mark, not the current count
    expect(l.emit(spec())).toBe(true);
  });

  it('swap-removes the dead: survivors stay contiguous, keep their own data, and the draw range follows', () => {
    const l = new ParticleLayer(8, 'add'), p = new THREE.Vector3();
    for (const [x, life, a] of [[1, .1, .3], [2, 1, .5], [3, .1, .4], [4, 1, .8]]) l.emit(spec({ x, life, a }));
    l.update(.2);
    expect(l.count).toBe(2);
    expect([l.at(0, p).x, l.at(1, p).x].sort()).toEqual([2, 4]);
    const pos = attr(l, 'position').array, col = attr(l, 'aColor').array;
    for (let i = 0; i < 2; i++) expect(col[i * 4 + 3]).toBeCloseTo((pos[i * 3] === 4 ? .8 : .5) * (1 - .2 * .2), 4); // each survivor kept ITS alpha
    expect(l.points.geometry.drawRange.count).toBe(2); expect(l.points.visible).toBe(true);
    l.update(1);
    expect(l.count).toBe(0); expect(l.points.visible).toBe(false);
  });

  it('integrates gravity and exponential drag', () => {
    const p = new THREE.Vector3(), a = new ParticleLayer(4, 'add'), b = new ParticleLayer(4, 'add');
    a.emit(spec({ vx: 10, vy: 10, g: 10, life: 5 })); a.update(.1);
    expect(a.at(0, p).x).toBeCloseTo(1, 4); expect(a.at(0, p).y).toBeCloseTo(.9, 4); // vy: 10 - 10 * .1
    b.emit(spec({ vx: 10, vy: 10, g: 10, drag: 10, life: 5 })); b.update(.1);
    const k = Math.exp(-1);
    expect(b.at(0, p).x).toBeCloseTo(10 * k * .1, 4); expect(b.at(0, p).y).toBeCloseTo(9 * k * .1, 4);
  });

  it('fades additive layers quadratically and alpha layers linearly; fade-in particles start invisible', () => {
    const a = new ParticleLayer(4, 'add'), b = new ParticleLayer(4, 'alpha');
    for (const l of [a, b]) { l.emit(spec({ life: 1, a: 1 })); l.emit(spec({ life: 1, a: 1, fadeIn: .5 })); l.update(0); }
    expect(attr(a, 'aColor').array[3]).toBe(1); expect(attr(a, 'aColor').array[7]).toBe(0);
    a.update(.5); b.update(.5);
    expect(attr(a, 'aColor').array[3]).toBeCloseTo(.75, 5); expect(attr(b, 'aColor').array[3]).toBeCloseTo(.5, 5);
    expect(attr(a, 'aColor').array[7]).toBeCloseTo(.75, 5); // fully faded in by now
  });

  it('keeps showing its particles while paused (dt = 0) without ageing them', () => {
    const l = new ParticleLayer(4, 'alpha');
    l.emit(spec({ life: .5, x: 3 }));
    for (let i = 0; i < 10; i++) l.update(0);
    expect(l.count).toBe(1); expect(attr(l, 'position').array[0]).toBe(3); expect(l.points.visible).toBe(true);
    l.update(.4); expect(l.count).toBe(1);
    l.update(.2); expect(l.count).toBe(0);
  });

  it('gives every particle a minimum life, so a zero life cannot divide by zero', () => {
    const l = new ParticleLayer(4, 'add');
    l.emit(spec({ life: 0 })); l.update(.01);
    expect(l.count).toBe(1); expect(Number.isFinite(attr(l, 'aColor').array[3])).toBe(true);
    l.update(.01); expect(l.count).toBe(0);
  });

  it('allocates nothing while playing: the GPU arrays keep their identity and size', () => {
    const l = new ParticleLayer(64, 'add'), pos = attr(l, 'position'), arr = pos.array;
    for (let f = 0; f < 600; f++) { for (let i = 0; i < 5; i++) l.emit(spec({ life: .4 + (i % 3) * .1, vx: 1 })); l.update(1 / 60); }
    expect(attr(l, 'position').array).toBe(arr); expect(arr).toHaveLength(64 * 3);
    expect(l.count).toBeGreaterThan(0); expect(l.count).toBeLessThanOrEqual(64);
    expect(l.emitted + l.dropped).toBe(3000);
    expect(pos.updateRange.count).toBe(l.count * 3); // only the live part is uploaded
  });

  it('limits the point size to what the GPU can draw and converts the viewport to pixels per world unit', () => {
    const l = new ParticleLayer(4, 'add'), u = (l.points.material as THREE.ShaderMaterial).uniforms;
    l.setMaxPoint(4); expect(u.uMax.value).toBe(16);
    l.setMaxPoint(9999); expect(u.uMax.value).toBe(512);
    l.setMaxPoint(100); expect(u.uMax.value).toBe(100);
    l.setViewport(800, Math.PI / 2); expect(u.uScale.value).toBeCloseTo(400, 6);
  });

  it('clear() drops every particle and hides the draw call', () => {
    const l = new ParticleLayer(4, 'add');
    l.emit(spec({ life: 5 })); l.update(.1); l.clear();
    expect(l.count).toBe(0); expect(l.points.visible).toBe(false); expect(l.points.geometry.drawRange.count).toBe(0);
  });
});

describe('emitters', () => {
  it('route glowing things to the additive layer and smoke, dust and rubble to the alpha layer, and never overflow', () => {
    const add = new ParticleLayer(100, 'add'), alp = new ParticleLayer(100, 'alpha'), em = new Kit(add, alp, new MeshFx()).em;
    em.spark(0, 0, 0, 0, 1, 0, 0xffffff); em.fire(0, 0, 0, 0, 1, 0); em.ember(0, 0, 0, 0, 1, 0, 0xffaa00); em.mote(0, 0, 0, 0, 1, 0, 0x88ff88); em.flash(0, 0, 0, 1, 0xffffff);
    expect([add.count, alp.count]).toEqual([5, 0]);
    em.smoke(0, 0, 0, 0, 1, 0); em.dust(0, 0, 0, 0, 1, 0); em.chunk(0, 0, 0, 0, 1, 0, 0x665544);
    expect([add.count, alp.count]).toEqual([5, 3]);
    em.glyph(SPR.leaf, 0, 0, 0, 0, 0, 0, 0x44ff44, 1, .5, 1, false);
    expect(alp.count).toBe(4);
    em.burst(0, 0, 0, 0xffffff, 1000, 5, 1); em.gather(0, 0, 0, 2, 1000, 0xffffff);
    expect(add.count).toBe(100); expect(add.dropped).toBe(0); // composites trim themselves to the free slots
  });
});

// ------------------------------------------------------------------------------------------------------------------------ pools

class S implements Slot { on = false; age = 0; life = 1; id = 0; obj = new THREE.Object3D(); }

describe('Pool', () => {
  it('creates slots on demand up to its cap, refuses beyond it and counts the refusals', () => {
    let made = 0;
    const p = new Pool<S>(3, () => { made++; return new S(); });
    expect([p.take(), p.take(), p.take()].every(Boolean)).toBe(true);
    expect(made).toBe(3);
    expect(p.take()).toBeNull(); expect(p.denied).toBe(1); expect(made).toBe(3);
    expect(p.peak).toBe(3); expect(p.active).toBe(3);
  });
  it('re-uses a released slot, with a new id so a stale holder can tell it was recycled', () => {
    const p = new Pool<S>(1, () => new S()), a = p.take()!, id = a.id;
    p.release(a);
    expect(a.on).toBe(false); expect(a.obj.visible).toBe(false);
    const b = p.take()!;
    expect(b).toBe(a); expect(b.id).not.toBe(id); expect(p.items).toHaveLength(1);
  });
  it('can take over the slot nearest the end of its life instead of refusing', () => {
    const p = new Pool<S>(3, () => new S()), [a, b, c] = [p.take()!, p.take()!, p.take()!];
    a.age = .2; b.age = .9; c.age = .5;
    const d = p.take(true)!;
    expect(d).toBe(b); expect(d.age).toBe(0); expect(p.denied).toBe(0); expect(p.items).toHaveLength(3);
  });
  it('clear() releases everything', () => {
    const p = new Pool<S>(2, () => new S());
    p.take(); p.take(); p.clear();
    expect(p.active).toBe(0);
  });
});

const BIG: FxCounts = { rings: 3, decals: 2, pillars: 2, domes: 1, bolts: 4, flashes: 3, spikes: 5, rocks: 2 };

/** Asks a MeshFx for `n` effects of every kind. */
function spamAll(m: MeshFx, n: number): void {
  for (let i = 0; i < n; i++) {
    m.ring({ x: 0, y: 0, z: 0, r0: 1, r1: 3, color: 0xffffff, life: 1 });
    m.decal({ x: 0, z: 0, r: 2, style: DECAL.rune, color: 0xffffff, life: 1 });
    m.pillar({ x: 0, y: 0, z: 0, r: 1, h: 5, color: 0xffffff, life: 1 });
    m.dome({ x: 0, y: 0, z: 0, r0: 1, r1: 2, color: 0xffffff, life: 1 });
    m.bolt({ ax: 0, ay: 0, az: 0, bx: 5, by: 0, bz: 0, color: 0xffffff, life: 1 });
    m.flash({ x: 0, y: 0, z: 0, s0: 1, s1: 2, color: 0xffffff, life: 1 });
    m.spike({ x: 0, z: 0, h: 2, w: 1, life: 1, color: 0x886644 });
    m.rock({ fx: 0, fy: 5, fz: 0, tx: 3, ty: 0, tz: 0, size: 1, life: 1, color: 0x554433 });
  }
}

describe('MeshFx pooling', () => {
  it('never grows past its caps, however many effects are asked for, and accounts for every refusal', () => {
    const m = new MeshFx(BIG);
    spamAll(m, 50);
    expect(m.counts()).toEqual(BIG); expect(m.created()).toBe(sum(BIG)); expect(m.group.children).toHaveLength(sum(BIG)); expect(m.peaks()).toEqual(BIG);
    const denied = m.deniedBy();
    for (const k of Object.keys(BIG)) expect(denied[k as keyof FxCounts], k).toBe(50 - BIG[k as keyof FxCounts]);
    expect(m.denied()).toBe(sum(denied));
  });

  it('gives every slot back when its life is over and re-uses it for the next effects', () => {
    const m = new MeshFx(BIG);
    spamAll(m, 10);
    const created = m.created();
    m.update(2);
    expect(sum(m.counts())).toBe(0);
    for (const o of m.group.children) expect(o.visible).toBe(false);
    spamAll(m, 10);
    expect(m.created()).toBe(created); expect(m.counts()).toEqual(BIG);
  });

  it('keeps the default pools inside a fixed budget of scene objects', () => {
    const m = new MeshFx();
    spamAll(m, 200);
    expect(m.created()).toBeLessThanOrEqual(256); expect(m.created()).toBe(sum(m.counts()));
  });

  it('shares geometry, buffers and textures between the slots of a kind, and one program per kind', () => {
    const m = new MeshFx();
    spamAll(m, 2);
    const same = (p: Pool<any>, f: (s: any) => unknown) => expect(f(p.items[0])).toBe(f(p.items[1]));
    for (const p of [m.rings, m.pillars, m.domes, m.spikes, m.rocks]) same(p, geo);
    same(m.spikes, s => s.obj.material); same(m.rocks, s => s.obj.material); // the factory caches materials by colour
    same(m.decals, s => geo(s).index); // one index buffer for every draped disc
    same(m.bolts, s => geo(s).index); same(m.bolts, s => geo(s).getAttribute('uv')); same(m.bolts, s => s.obj.material);
    same(m.flashes, s => s.material.map);
    for (const p of [m.rings, m.decals, m.pillars, m.domes]) {
      same(p, s => s.material.fragmentShader); same(p, s => s.material.vertexShader);
      // no per-slot defines: switching colour or blend must never mean compiling another program
      for (const s of p.items) expect(Object.keys(s.material.defines ?? {})).toHaveLength(0);
    }
  });

  it('draws light layers with screen blending and switches a decal slot to alpha blending without a new material', () => {
    const m = new MeshFx({ decals: 1, rings: 1, pillars: 1, domes: 1 });
    spamAll(m, 1);
    for (const mat of [m.rings.items[0].material, m.pillars.items[0].material, m.domes.items[0].material]) {
      expect(mat.blending).toBe(THREE.CustomBlending); expect(mat.uniforms.uSoft.value).toBe(1);
    }
    const a = m.decals.items[0], mat = a.material;
    expect(mat.blending).toBe(THREE.CustomBlending); expect(mat.blendSrc).toBe(THREE.OneMinusDstColorFactor); expect(mat.blendDst).toBe(THREE.OneFactor);
    expect(mat.blendSrcAlpha).toBe(THREE.ZeroFactor); expect(mat.blendDstAlpha).toBe(THREE.OneFactor); expect(a.obj.renderOrder).toBe(4);
    m.decals.release(a);
    const b = m.decal({ x: 0, z: 0, r: 2, style: DECAL.scorch, color: 0x000000, life: 1, add: false })!;
    expect(b).toBe(a); expect(b.material).toBe(mat);
    expect(mat.blending).toBe(THREE.NormalBlending); expect(mat.uniforms.uSoft.value).toBe(0); expect(b.obj.renderOrder).toBe(3);
    m.decals.release(b);
    const c = m.decal({ x: 0, z: 0, r: 2, style: DECAL.rune, color: 0xffffff, life: 1, add: true })!;
    expect(c.material.blending).toBe(THREE.CustomBlending); expect(c.material.uniforms.uSoft.value).toBe(1); expect(c.obj.renderOrder).toBe(4);
  });

  it('drapes decals over the terrain, or holds a fixed height when asked to', () => {
    const m = new MeshFx({ decals: 2 }), x = 30, z = 20, r = 6;
    const d = m.decal({ x, z, r, style: DECAL.aim, color: 0xffffff, life: 1 })!, p = geo(d).getAttribute('position') as THREE.BufferAttribute;
    expect(p.getY(0)).toBeCloseTo(groundY(x / K, z / K) + d.lift, 5); // centre vertex sits on the ground, a hair above it
    const ys = new Set<number>();
    for (let i = 0; i < p.count; i++) ys.add(Math.round(p.getY(i) * 1000));
    expect(ys.size).toBeGreaterThan(20); // follows the hills instead of being a flat disc
    expect(d.obj.position.x).toBe(x); expect(d.obj.scale.x).toBe(r);
    const f = m.decal({ x, z, r, style: DECAL.rune, color: 0xffffff, life: 1, flatY: .5 })!, q = geo(f).getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < q.count; i++) expect(q.getY(i)).toBeCloseTo(.5, 6);
  });

  it('runs decals on their life clock, or on the caller\'s clock when manual, and fades them in and out', () => {
    const m = new MeshFx({ decals: 2 });
    const a = m.decal({ x: 0, z: 0, r: 2, style: DECAL.wave, color: 0xffffff, life: 2, fadeIn: .1, fadeOut: .5, alpha: .8 })!;
    const b = m.decal({ x: 0, z: 0, r: 2, style: DECAL.aim, color: 0xffffff, life: 2, manual: true })!;
    b.prog = .3;
    expect(a.material.uniforms.uAlpha.value).toBe(0); // starts invisible
    m.update(1);
    expect(a.material.uniforms.uProg.value).toBeCloseTo(.5, 5); expect(b.material.uniforms.uProg.value).toBeCloseTo(.3, 5);
    expect(a.material.uniforms.uAlpha.value).toBeCloseTo(.8, 5);
    m.update(.8);
    expect(a.material.uniforms.uAlpha.value).toBeCloseTo(.8 * .4, 5); // (2 - 1.8) / .5 of the way out
    m.update(.3);
    expect(a.on).toBe(false); expect(a.obj.visible).toBe(false);
  });

  it('builds a lightning ribbon from A to B and re-rolls its zig-zag while it lives', () => {
    const m = new MeshFx({ bolts: 1 });
    const b = m.bolt({ ax: 0, ay: 1, az: 0, bx: 10, by: 1, bz: 0, color: 0x88ccff, life: .3, width: .2, jitter: .8 })!;
    const mid = (i: number, strip = 0) => { const o = (strip * 13 + i) * 6; return [0, 1, 2].map(j => (b.pos[o + j] + b.pos[o + 3 + j]) / 2); };
    for (const strip of [0, 1]) { // glow and core
      const [x0, y0, z0] = mid(0, strip), [x1, y1, z1] = mid(12, strip);
      expect([x0, y0, z0].map(v => +v.toFixed(4))).toEqual([0, 1, 0]); expect([x1, y1, z1].map(v => +v.toFixed(4))).toEqual([10, 1, 0]);
    }
    expect(b.col.every(v => Number.isFinite(v) && v >= 0)).toBe(true); expect(b.col.some(v => v > 0)).toBe(true);
    const before = Float32Array.from(b.pos);
    m.update(1 / 60);
    expect(Array.from(b.pos)).not.toEqual(Array.from(before));
    m.update(.5);
    expect(b.on).toBe(false);
  });

  it('grows and fades flashes, delays spikes until their turn and flies rocks along their path', () => {
    const m = new MeshFx({ flashes: 1, spikes: 1, rocks: 1 }), trail: number[][] = [];
    const f = m.flash({ x: 0, y: 0, z: 0, s0: 1, s1: 5, color: 0xffffff, life: 1, alpha: .8 })!;
    const s = m.spike({ x: 0, z: 0, h: 3, w: 1, life: 2, color: 0x886644, delay: .5 })!;
    const r = m.rock({ fx: 0, fy: 10, fz: 0, tx: 8, ty: 0, tz: 0, size: 1, life: 1, color: 0x554433, trail: (x, y, z) => trail.push([x, y, z]) })!;
    expect(s.obj.visible).toBe(false);
    m.update(.25);
    expect(f.obj.scale.x).toBeGreaterThan(1); expect(f.obj.scale.x).toBeLessThan(5); expect(f.material.opacity).toBeLessThan(.8);
    expect(s.obj.visible).toBe(false);
    m.update(.25);
    expect(trail).toHaveLength(2); expect(r.obj.position.x).toBeCloseTo(8 * .25, 5); expect(r.obj.position.y).toBeCloseTo(10 - 10 * .25, 5); // t = .5 -> e = t^2
    m.update(.25); // age .75: past the delay
    expect(s.obj.visible).toBe(true); expect(s.obj.scale.y).toBeGreaterThan(.01);
    m.update(1);
    expect(sum(m.counts())).toBe(sum({ spikes: 1 })); // flash and rock are over, the spike (life 2) is not
  });

  it('clear() hides everything and dispose() detaches the group', () => {
    const m = new MeshFx(BIG), parent = new THREE.Group();
    parent.add(m.group); spamAll(m, 2); m.clear();
    expect(sum(m.counts())).toBe(0);
    for (const o of m.group.children) expect(o.visible).toBe(false);
    m.dispose();
    expect(m.group.parent).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------------------------------ shaders

describe('effect shaders', () => {
  const FRAG = { DECAL_FRAG, RING_FRAG, PILLAR_FRAG, DOME_FRAG }, VERT = { DECAL_VERT, RING_VERT, PILLAR_VERT, DOME_VERT };
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const depth = (s: string, open: string, close: string) => { let d = 0; for (const ch of strip(s)) { if (ch === open) d++; else if (ch === close && --d < 0) return -1; } return d; };
  const uniformsOf = (...src: string[]) => [...strip(src.join('\n')).matchAll(/uniform\s+(?:\w+\s+)?\w+\s+(\w+)\s*(?:\[\d+\])?\s*;/g)].map(m => m[1]);

  for (const [name, src] of Object.entries({ ...FRAG, ...VERT })) {
    it(`${name} has one main() and balanced brackets`, () => {
      expect(strip(src).match(/void\s+main\s*\(/g)).toHaveLength(1);
      for (const [o, c] of [['{', '}'], ['(', ')'], ['[', ']']]) expect(depth(src, o, c), o).toBe(0);
    });
  }
  for (const [name, src] of Object.entries(FRAG)) {
    it(`${name} writes its colour only through emit(), which handles screen vs alpha blending`, () => {
      const code = strip(src);
      expect(code.split(EMIT.trim()).length - 1).toBe(1); // EMIT included exactly once
      expect(code.match(/gl_FragColor/g)).toHaveLength(1); // ... and that is the only write
      expect(code.match(/\bemit\s*\(/g)!.length).toBeGreaterThanOrEqual(2); // the definition and at least one call
      expect(code).toContain('uniform float uSoft;');
    });
  }

  it('every uniform a shader declares is supplied by the material of its slot', () => {
    const m = new MeshFx(); spamAll(m, 1);
    const pairs: [string, THREE.ShaderMaterial][] = [['decal', m.decals.items[0].material], ['ring', m.rings.items[0].material], ['pillar', m.pillars.items[0].material], ['dome', m.domes.items[0].material]];
    for (const [name, mat] of pairs) {
      const need = uniformsOf(mat.vertexShader, mat.fragmentShader);
      expect(need.length, name).toBeGreaterThan(3);
      for (const u of need) expect(Object.keys(mat.uniforms), `${name} needs ${u}`).toContain(u);
    }
  });

  it('the particle shader reads only the uniforms and attributes its layer provides', () => {
    const l = new ParticleLayer(4, 'add'), mat = l.points.material as THREE.ShaderMaterial;
    for (const u of uniformsOf(mat.vertexShader, mat.fragmentShader)) expect(Object.keys(mat.uniforms), u).toContain(u);
    for (const a of [...mat.vertexShader.matchAll(/attribute\s+\w+\s+(\w+)\s*;/g)].map(x => x[1])) expect(l.points.geometry.getAttribute(a), a).toBeTruthy();
  });
});

// ------------------------------------------------------------------------------------------------------------------------ kit

describe('Kit and Timeline', () => {
  const kit = () => new Kit(new ParticleLayer(50, 'add'), new ParticleLayer(50, 'alpha'), new MeshFx());

  it('scales particle counts by quality and thins them out away from the camera focus, but never to zero', () => {
    const k = kit(); k.focus = { x: 0, z: 0, r: 70 };
    expect(k.n(10)).toBe(10); expect(k.n(10, 0, 0)).toBe(10); expect(k.n(10, 80, 0)).toBe(6); expect(k.n(10, 200, 0)).toBe(3);
    k.q = .5; expect(k.n(10)).toBe(5);
    expect(k.n(1, 500, 0)).toBe(1); expect(k.n(0, 500, 0)).toBe(0);
    expect(k.vis(0, 0)).toBe(true); expect(k.vis(200, 0)).toBe(false);
  });

  it('lets only the brightest flash light request of a frame set the scene light', () => {
    const k = kit();
    k.lightAt(1, 1, 1, 0xff0000, 1);
    k.lightAt(9, 9, 9, 0x00ff00, .5); // under 70 % of the current one: ignored
    expect(k.light.x).toBe(1);
    k.lightAt(5, 5, 5, 0x0000ff, 2);
    expect(k.light.x).toBe(5); expect(k.light.intensity).toBe(2); expect(k.light.color).toBe(0x0000ff);
  });

  it('turns a world direction into a sprite angle as seen from the camera', () => {
    const k = kit();
    expect(Math.abs(k.screenAngle(1, 0, 0))).toBeCloseTo(0, 6); expect(k.screenAngle(0, 1, 0)).toBeCloseTo(-Math.PI / 2, 6);
  });

  it('reset() clears particles, meshes, timers and light', () => {
    const k = kit();
    k.em.spark(0, 0, 0, 0, 1, 0, 0xffffff); k.mesh.ring({ x: 0, y: 0, z: 0, r0: 1, r1: 2, color: 0xffffff, life: 1 }); k.tl.at(1, () => {}); k.lightAt(0, 0, 0, 0xffffff, 2);
    k.reset();
    expect(k.add.count).toBe(0); expect(sum(k.mesh.counts())).toBe(0); expect(k.tl.pending).toBe(0); expect(k.light.intensity).toBe(0);
  });

  it('Timeline runs every callback once, in time, and not at all while paused', () => {
    const tl = new Timeline(), ran: number[] = [];
    for (let i = 0; i < 50; i++) tl.at(i * .1 + .05, () => ran.push(i));
    tl.at(0, () => ran.push(-1)); // no delay: immediately
    expect(ran).toEqual([-1]);
    tl.update(0); expect(ran).toHaveLength(1);
    for (let t = 0; t < 6; t += 1 / 37) tl.update(1 / 37);
    expect(ran.slice(1)).toEqual(Array.from({ length: 50 }, (_, i) => i)); expect(tl.pending).toBe(0);
    tl.at(1, () => ran.push(99)); tl.clear(); tl.update(5);
    expect(ran).not.toContain(99);
  });
});

// ------------------------------------------------------------------------------------------------------------------------ director

/** The effect system without a renderer: real pools, a recording camera, hooked up to the real simulation. */
function makeRig() {
  const add = new ParticleLayer(2600, 'add'), alp = new ParticleLayer(900, 'alpha'), mesh = new MeshFx(), kit = new Kit(add, alp, mesh);
  const log = { shake: [] as number[][], kick: [] as number[][], focus: [] as number[][] };
  const cam: CamSink = { shake: (a, x, z, j) => { log.shake.push([a, x, z, j ?? .5]); }, kick: (a, x, z) => { log.kick.push([a, x, z]); }, focus: (x, z) => { log.focus.push([x, z]); } };
  kit.cam = cam; kit.focus = { x: 0, z: 0, r: 1e6 }; // everything counts as on screen
  const dir = new Director(kit);
  hooks.fx = (x, y, r, l, c) => dir.onFx(x, y, r, l, c); hooks.ft = (x, y, s, c) => dir.onFt(x, y, s, c);
  hooks.feed = () => {}; hooks.finish = w => { app.G.over = true; app.G.win = w; };
  /** The effect half of a frame (what vfx.ts does after the simulation step). */
  const fxFrame = (dt = 1 / 30) => { dir.update(dt); kit.tl.update(dt); mesh.update(dt); add.update(dt); alp.update(dt); };
  const frame = (dt = 1 / 30) => { stepSim(dt); fxFrame(dt); };
  const run = (sec: number) => { for (let i = 0; i < Math.round(sec * 30); i++) frame(); };
  const fxRun = (sec: number) => { for (let i = 0; i < Math.round(sec * 30); i++) fxFrame(); };
  const made = () => add.emitted + alp.emitted + mesh.created();
  return { add, alp, mesh, kit, log, dir, frame, fxFrame, run, fxRun, made };
}
const start = (sel = 0) => { app.sel = sel; createWorld(); const r = makeRig(); r.run(11); return r; };

describe('Director against the real simulation', () => {
  it.each(HR.map((h, i) => [h.n, i] as const))('%s: all four abilities are sensed, resolved and played, and everything ends', (name, idx) => {
    const r = start(idx), me = app.me;
    for (const h of app.all) if (h.k === 'hero' && h !== me) { h.dead = true; h.rs = 1e9; } // the caster's effects only
    me.x = 1300; me.y = 1300; me.lv = 5;
    const en = mk({ k: 'melee', team: 1, L: 1, wp: 1, x: me.x + 200, y: me.y, hp: 1e6, dmg: 0, rng: 75, as: 1000, ar: 0, r: 12, g: 0, xp: 0 });
    for (let i = 0; i < 4; i++) {
      me.mp = me.mmax; me.hp = me.max; me.acd = [0, 0, 0, 0]; me.dead = false;
      const s0 = { ...r.dir.stats }, m0 = r.made();
      cast(me, i, en.x, en.y);
      r.run(1.5);
      const s1 = r.dir.stats;
      expect(s1.casts - s0.casts, `${name} ability ${i}: cast sensed`).toBe(1);
      expect(s1.resolved - s0.resolved, `${name} ability ${i}: resolved`).toBe(1);
      expect(s1.cancelled - s0.cancelled, `${name} ability ${i}: cancelled`).toBe(0);
      expect(r.made() - m0, `${name} ability ${i}: something was drawn`).toBeGreaterThan(0);
    }
    expect(r.dir.stats.unknown).toBe(0); // the simulation never made a ring / flash call the Director could not name
    expect(r.add.dropped + r.alp.dropped).toBe(0);
    // freeze the simulation and let the effects run out: every effect has a finite life (buffs end with the simulation clock, so end them here)
    app.P = []; for (const h of app.all) h.bf = 0;
    r.fxRun(25);
    expect(sum(r.mesh.counts())).toBe(0); expect(r.add.count + r.alp.count).toBe(0); expect(r.kit.tl.pending).toBe(0);
    expect(r.dir.tracked).toEqual({ casts: 0, projectiles: 0, auras: 0 });
  }, 30000);

  it('gives a bolt in flight a visual and lets go of it when it lands', () => {
    const idx = HR.findIndex(h => h.ab.some(a => a[2] === 'bolt')), r = start(idx), me = app.me, i = me.def.ab.findIndex(a => a[2] === 'bolt');
    for (const h of app.all) if (h.k === 'hero' && h !== me) { h.dead = true; h.rs = 1e9; }
    me.x = 1300; me.y = 1300; me.mp = me.mmax;
    cast(me, i, me.x + 400, me.y);
    r.run(.6);
    expect(app.P.some(p => p.s === me)).toBe(true); expect(r.dir.tracked.projectiles).toBeGreaterThanOrEqual(1);
    r.run(3);
    expect(app.P.some(p => p.s === me)).toBe(false); expect(r.dir.tracked.projectiles).toBe(0);
  });

  const SIGNATURES: [string, number, number, number][] = [
    ['a hit', 12, .25, 0xffffff], ['a cast ring or bolt impact', 40, .3, HR[0].c], ['one ally healed', 30, .5, 0x6fff8a], ['a buff taking hold', 70, .6, HR[1].c],
    ['a camp buff', 50, .6, 0xffd04a], ['a death', 54, .6, 0xff5555], ['a level up', 60, .8, 0xffe066], ['a tower destroyed', 160, .9, 0xffaa44],
    ['the boss enraging', 260, 1, 0xff2a2a], ['a boss slam', 170, .5, COLORS.boss],
  ];
  it.each(SIGNATURES)('recognises %s by its signature and plays an effect for it', (_n, r, l, c) => {
    const rig = start(), m0 = rig.made();
    hooks.fx(1600, 1600, r, l, c);
    expect(rig.dir.stats.unknown).toBe(0); expect(rig.made()).toBeGreaterThan(m0);
  });

  it('falls back to a plain shockwave for a call it does not know, and counts it', () => {
    const r = start(), m0 = r.made();
    hooks.fx(1600, 1600, 77, 1.23, 0x123456);
    hooks.fx(1600, 1600, 90, .5, 0x123456); // a blast nobody cast
    expect(r.dir.stats.unknown).toBe(2); expect(r.made()).toBeGreaterThan(m0); expect(r.mesh.counts().rings + r.mesh.counts().decals).toBeGreaterThan(0);
  });

  it('sizes hit sparks by the damage and allows at most 16 hits per frame', () => {
    const r = start(), en = mk({ k: 'melee', team: 1, L: 1, wp: 1, x: 1300, y: 1300, hp: 1000, dmg: 0, rng: 75, as: 1000, ar: 0, r: 12, g: 0, xp: 0 });
    const e0 = r.add.emitted; hurt(app.me, en, 5); const small = r.add.emitted - e0;
    r.dir.update(.01);
    const e1 = r.add.emitted; hurt(app.me, en, 500); const big = r.add.emitted - e1;
    expect(small).toBeGreaterThan(0); expect(big).toBeGreaterThan(small);
    r.dir.update(.01);
    const h0 = r.dir.stats.hits; en.hp = 1e6; en.max = 1e6;
    for (let i = 0; i < 40; i++) hurt(app.me, en, 10);
    expect(r.dir.stats.hits - h0).toBe(16);
    r.dir.update(.01); hurt(app.me, en, 10);
    expect(r.dir.stats.hits - h0).toBe(17); // the budget is per frame
  });

  it('plays a death for a hero (the player\'s own shakes the camera harder), a creep, and the respawn at the fountain', () => {
    const r = start(), me = app.me, foes = app.all.filter(u => u.k === 'hero' && u.team === 1);
    r.log.shake.length = 0;
    hurt(me, foes[0], 1e6);
    expect(foes[0].dead).toBe(true); expect(r.dir.stats.deaths).toBe(1);
    const enemy = Math.max(...r.log.shake.map(s => s[0]));
    r.log.shake.length = 0;
    hurt(foes[1], me, 1e6);
    expect(me.dead).toBe(true);
    const own = Math.max(...r.log.shake.map(s => s[0]));
    expect(enemy).toBeGreaterThan(0); expect(own).toBeGreaterThan(enemy);
    r.mesh.update(.01);
    const c0 = r.mesh.counts();
    r.dir.heroRespawn(me);
    const c1 = r.mesh.counts();
    expect(c1.decals).toBeGreaterThan(c0.decals); expect(c1.pillars).toBeGreaterThan(c0.pillars); expect(c1.rings).toBeGreaterThan(c0.rings);
    const creep = mk({ k: 'melee', team: 1, L: 1, wp: 1, x: 1300, y: 1300, hp: 10, dmg: 0, rng: 75, as: 1000, ar: 0, r: 12, g: 0, xp: 0 }), m0 = r.made();
    hurt(me, creep, 1e6);
    expect(creep.dead).toBe(true); expect(r.dir.stats.deaths).toBe(3); expect(r.made()).toBeGreaterThan(m0);
  });

  it('destroys a tower with an explosion, a scorch mark, camera feedback and staggered fires that burn out on schedule', () => {
    const r = start(), tower = app.all.find(u => u.k === 'tower' && u.team === 1)!;
    hurt(app.me, tower, 1e6);
    expect(tower.dead).toBe(true);
    expect(Math.max(...r.log.shake.map(s => s[0]))).toBeGreaterThanOrEqual(.6); expect(r.log.kick.length).toBeGreaterThan(0);
    const scorch = r.mesh.decals.items.find(d => d.on && d.material.uniforms.uStyle.value === DECAL.scorch)!;
    expect(scorch).toBeTruthy(); expect(scorch.material.blending).toBe(THREE.NormalBlending); // a dark mark: alpha-blended, never added
    expect(r.mesh.counts().flashes + r.mesh.counts().domes + r.mesh.counts().rings).toBeGreaterThan(0);
    expect(r.kit.tl.pending).toBeGreaterThan(10);
    r.fxRun(3);
    expect(r.kit.tl.pending).toBe(0);
  });

  it('breaks the core with a white-out and camera finale, then ends the match', () => {
    const r = start(), core = app.all.find(u => u.k === 'core' && u.team === 1)!;
    hurt(app.me, core, 1e9);
    expect(app.G.over).toBe(true);
    expect(r.log.focus).toHaveLength(1); expect(r.log.focus[0][0]).toBeCloseTo(core.x * K, 5); expect(r.log.focus[0][1]).toBeCloseTo(core.y * K, 5);
    expect(r.mesh.counts().flashes).toBeGreaterThanOrEqual(2); expect(Math.max(...r.log.shake.map(s => s[0]))).toBe(1);
    r.fxRun(4); // chain explosions up to 2 s, fires to 3.5 s
    expect(r.kit.tl.pending).toBe(0);
  });

  it('shows a damaged tower by how much smoke, fire and sparks it gives off, and nothing for a distant one', () => {
    const tower = app.all.find(u => u.k === 'tower') ?? (createWorld(), app.all.find(u => u.k === 'tower')!);
    const emitted = (hp: number, far = false) => {
      createWorld(); const r = makeRig(), t = app.all.find(u => u.k === 'tower' && u.team === 1)!, acc = newStructAcc();
      r.kit.focus = far ? { x: 1e5, z: 1e5, r: 70 } : { x: t.x * K, z: t.y * K, r: 70 };
      t.hp = t.max * hp;
      for (let i = 0; i < 180; i++) { r.dir.structure(t, acc, 1 / 30); r.alp.update(1 / 30); r.add.update(1 / 30); }
      return { smoke: r.alp.emitted, glow: r.add.emitted };
    };
    expect(tower).toBeTruthy();
    const healthy = emitted(1), hurtish = emitted(.5), dying = emitted(.2);
    expect(healthy.smoke).toBe(0); // only the idle motes
    expect(hurtish.smoke).toBeGreaterThan(10); expect(dying.smoke).toBeGreaterThan(hurtish.smoke);
    expect(dying.glow).toBeGreaterThan(hurtish.glow * 2); // below 30 %: flames, embers and sparks join in
    expect(emitted(.2, true)).toEqual({ smoke: 0, glow: 0 });
  });
});

// ------------------------------------------------------------------------------------------------------------------------ stage

describe('hero-select stage effects', () => {
  const pal = (n: string) => paletteOf(n, 0xffffff);

  it('holds its pedestal decals while shown, swaps them for a new hero and lets go on hide', () => {
    const r = makeRig(), st = new StageFx(r.kit, 80, -40);
    st.show('Ember Mage', pal('Ember Mage'), 1.6, false);
    expect(st.visible).toBe(true); expect(st.decals).toBe(2); // rune circle + the fire halo
    st.show('Arcane Knight', pal('Arcane Knight'), 1.6, false);
    expect(st.decals).toBe(1); // the arcane theme has no halo
    r.mesh.update(.3); // the old pair fades out and is freed
    expect(r.mesh.counts().decals).toBe(1);
    st.hide(); r.mesh.update(.4);
    expect(st.visible).toBe(false); expect(st.decals).toBe(0); expect(r.mesh.counts().decals).toBe(0);
  });

  it('ignores delayed effects of a hero that is gone, but plays them while it stays', () => {
    const r = makeRig(), st = new StageFx(r.kit, 80, -40);
    st.show('Storm Warrior', pal('Storm Warrior'), 1.6, true); // the summon schedules a second ring at +.12 s
    const rings = r.mesh.counts().rings;
    st.hide(); r.kit.tl.update(1);
    expect(r.mesh.counts().rings).toBe(rings);
    st.show('Storm Warrior', pal('Storm Warrior'), 1.6, false);
    st.cue('attack'); // the strike lands .22 s in
    const flashes = r.mesh.counts().flashes;
    r.kit.tl.update(.3);
    expect(r.mesh.counts().flashes).toBeGreaterThan(flashes);
    st.cue('attack2'); st.hide();
    const f1 = r.mesh.counts().flashes; r.kit.tl.update(1);
    expect(r.mesh.counts().flashes).toBe(f1);
  });

  it('streams theme particles while shown and nothing once reset', () => {
    const r = makeRig(), st = new StageFx(r.kit, 80, -40);
    st.show('Nature Guardian', pal('Nature Guardian'), 1.6, false);
    for (let i = 0; i < 60; i++) st.update(1 / 30);
    expect(r.add.emitted + r.alp.emitted).toBeGreaterThan(20);
    st.reset();
    const n = r.add.emitted + r.alp.emitted;
    for (let i = 0; i < 30; i++) st.update(1 / 30);
    expect(r.add.emitted + r.alp.emitted).toBe(n);
  });
});
