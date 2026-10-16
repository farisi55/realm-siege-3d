// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';

// The renderer-side modules (sun and shadows, the post-processing chain, the quality levels, the environment) on a stub of the WebGL renderer.
// The stub records what is drawn into which target, so the tests can see the wiring of the passes without a GPU.

type Mode = 'webgl2' | 'webgl1' | 'broken';
const STUB = vi.hoisted(() => ({
  mode: 'webgl2' as 'webgl2' | 'webgl1' | 'broken',
  renders: [] as { scene: any; camera: any; target: any }[],
  pixelRatios: [] as number[],
}));

vi.mock('three', async orig => {
  const t: any = await orig();
  class StubRenderer {
    domElement = document.createElement('canvas');
    shadowMap: any = {};
    autoClear = true; autoClearColor = true; autoClearDepth = true; autoClearStencil = true;
    state = { buffers: { stencil: { setTest() {} } } };
    private pr = 1; private target: any = null; private cc = new t.Color(0);
    get capabilities(): any { if (STUB.mode === 'broken') throw new Error('no WebGL here'); return { isWebGL2: STUB.mode === 'webgl2', getMaxAnisotropy: () => 8 }; }
    setPixelRatio(v: number): void { this.pr = v; STUB.pixelRatios.push(v); }
    getPixelRatio(): number { return this.pr; }
    setSize(): void {}
    getSize(v: any): any { return v.set(innerWidth, innerHeight); }
    render(scene: any, camera: any): void { STUB.renders.push({ scene, camera, target: this.target }); }
    setRenderTarget(t: any): void { this.target = t; }
    getRenderTarget(): any { return this.target; }
    clear(): void {}
    setClearColor(): void {}
    getClearColor(c: any): any { return c.copy(this.cc); }
    getClearAlpha(): number { return 1; }
    getContext(): any { return {}; }
  }
  return { ...t, WebGLRenderer: StubRenderer };
});

const BODY = ((): string => { const html = readFileSync('index.html', 'utf8'); return html.slice(html.indexOf('<body>') + 6, html.indexOf('<script')); })();

/** A fresh copy of the renderer modules on a stub in the given mode (every call gets its own scene, renderer, post chain and governor). */
async function load(mode: Mode) {
  STUB.mode = mode; STUB.renders.length = 0; STUB.pixelRatios.length = 0;
  Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
  vi.resetModules();
  document.body.innerHTML = BODY;
  const THREE = await import('three');
  const scene = await import('../src/render/scene');
  const lighting = await import('../src/render/lighting');
  const post = await import('../src/render/post');
  const quality = await import('../src/render/quality');
  const environment = await import('../src/render/environment');
  const governor = await import('../src/render/governor');
  const state = await import('../src/game/state');
  const shared = await import('../src/render/env/shared');
  const palette = await import('../src/render/env/palette');
  return { THREE, scene, lighting, post, quality, environment, governor, state, shared, palette };
}
type Mods = Awaited<ReturnType<typeof load>>;

const frameRenders = (M: Mods): number => { STUB.renders.length = 0; M.post.renderFrame(); return STUB.renders.length; };

// ------------------------------------------------------------------------------------------------------------------------ the WebGL2 path

describe('renderer on WebGL2', () => {
  let M: Mods, env: Awaited<ReturnType<Mods['environment']['buildEnvironment']>>;
  const progress: [number, number][] = [];
  beforeAll(async () => { M = await load('webgl2'); });

  // ---------------------------------------------------------------------------------------------------------------- scene basics
  describe('scene', () => {
    it('has the lights that never go away: a sun, a sky fill and one flash; nothing else will ever be added (so shaders are never recompiled)', () => {
      let n = 0; const kinds: string[] = [];
      M.scene.sn.traverse(o => { if ((o as any).isLight) { n++; kinds.push(o.type); } });
      expect(n).toBe(3); expect(kinds.sort()).toEqual(['DirectionalLight', 'HemisphereLight', 'PointLight']);
      expect(M.scene.fl.intensity).toBe(0);
    });
    it('the sun is the only shadow caster; its map is made once', () => {
      expect(M.scene.sun.castShadow).toBe(true); expect(M.scene.hemi.castShadow).toBeFalsy(); expect(M.scene.fl.castShadow).toBeFalsy();
      expect(M.scene.rd.shadowMap.enabled).toBe(true); expect(M.scene.rd.shadowMap.type).toBe(M.THREE.PCFSoftShadowMap);
      expect(M.scene.sun.shadow.mapSize.x).toBe(2048);
    });
    it('the haze and the background are one color, so the ground fades into the sky without a seam', () => {
      expect((M.scene.sn.background as any).getHex()).toBe(M.palette.ATMO.fog);
      expect((M.scene.sn.fog as any).color.getHex()).toBe(M.palette.ATMO.fog);
    });
    it('the pixel ratio starts at the device ratio, capped at 2', () => { expect(M.scene.rd.getPixelRatio()).toBe(2); });
  });

  // ---------------------------------------------------------------------------------------------------------------- sun and shadows
  describe('sun and shadow box', () => {
    const e = (visible: number): number => M.lighting.shadowExtent(visible);

    it('the box is sized from the zoom: sharp when close, wide when far, always a whole even number between 36 and 78', () => {
      expect(e(5)).toBe(36); expect(e(50)).toBe(36); expect(e(300)).toBe(78);
      let prev = 0;
      for (let v = 0; v <= 200; v += 2.5) { const x = e(v); expect(x).toBeGreaterThanOrEqual(36); expect(x).toBeLessThanOrEqual(78); expect(x % 2).toBe(0); expect(x).toBeGreaterThanOrEqual(prev); prev = x; }
      expect(e(100)).toBeGreaterThan(e(60));
    });
    it('followSun keeps the sun at its fixed offset from the point it looks at: the light never turns, it only follows', () => {
      const off = new M.THREE.Vector3(...M.palette.ATMO.sunOffset);
      for (const [x, y, z] of [[0, 0, 0], [80, 0, 80], [13.7, 2.2, 151.3], [-20, -1, 90]]) {
        M.lighting.followSun(x, y, z, 60);
        const d = M.scene.sun.position.clone().sub(M.scene.sun.target.position);
        expect(d.distanceTo(off)).toBeLessThan(1e-9);
      }
    });
    it('the target is the focus snapped to whole shadow texels in light space: no shimmer while the camera glides', () => {
      const THREE = M.THREE, dir = new THREE.Vector3(...M.palette.ATMO.sunOffset).normalize(), right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
      const focus = new THREE.Vector3(60, 0, 70);
      M.lighting.followSun(focus.x, focus.y, focus.z, 61);
      const { extent, size } = M.lighting.shadowState, texel = extent * 2 / size;
      const t0 = M.scene.sun.target.position.clone();
      // a focus that is already on the grid and moves by a third of a texel: the target does not move at all
      for (const f of [.3, -.3, .45]) {
        M.lighting.followSun(t0.x + right.x * texel * f, t0.y + right.y * texel * f, t0.z + right.z * texel * f, 61);
        expect(M.scene.sun.target.position.distanceTo(t0), `shift ${f}`).toBeLessThan(1e-9);
      }
      // a whole texel: it moves by exactly one texel along the light's right axis
      M.lighting.followSun(t0.x + right.x * texel, t0.y + right.y * texel, t0.z + right.z * texel, 61);
      const d = M.scene.sun.target.position.clone().sub(t0);
      expect(d.length()).toBeCloseTo(texel, 9); expect(d.dot(right)).toBeCloseTo(texel, 9);
      // and the position along the light's direction is the focus's own (nothing to snap there)
      expect(M.scene.sun.target.position.dot(dir)).toBeCloseTo(new THREE.Vector3(t0.x + right.x * texel, t0.y + right.y * texel, t0.z + right.z * texel).dot(dir), 9);
    });
    it('the shadow camera follows the zoom: its bounds and projection change only when the box size does', () => {
      const cam = M.scene.sun.shadow.camera as any, upd = vi.spyOn(cam, 'updateProjectionMatrix');
      M.lighting.followSun(80, 0, 80, 200); // far: 78
      expect(M.lighting.shadowState.extent).toBe(78); expect([cam.left, cam.right, cam.top, cam.bottom]).toEqual([-78, 78, 78, -78]);
      const n = upd.mock.calls.length;
      M.lighting.followSun(90, 0, 85, 210); expect(upd.mock.calls.length).toBe(n); // same box: no matrix work
      M.lighting.followSun(90, 0, 85, 30); expect(M.lighting.shadowState.extent).toBe(36); expect(cam.left).toBe(-36); expect(upd.mock.calls.length).toBe(n + 1);
      upd.mockRestore();
    });
    it('a close box has finer shadow texels than a far one, at the same map size', () => {
      const texel = (v: number): number => M.lighting.shadowExtent(v) * 2 / M.lighting.shadowState.size;
      expect(texel(30)).toBeLessThan(texel(200));
    });
    it('setShadowSize resizes the map and releases the old one; the same size is a no-op', () => {
      const dispose = vi.fn(), sh = M.scene.sun.shadow as any;
      M.lighting.setShadowSize(2048); sh.map = { dispose };
      M.lighting.setShadowSize(2048); expect(dispose).not.toHaveBeenCalled(); expect(sh.map).toBeTruthy();
      M.lighting.setShadowSize(1024);
      expect(dispose).toHaveBeenCalledTimes(1); expect(sh.map).toBeNull();
      expect(M.lighting.shadowState.size).toBe(1024); expect([sh.mapSize.x, sh.mapSize.y]).toEqual([1024, 1024]);
      M.lighting.setShadowSize(2048); expect([sh.mapSize.x, sh.mapSize.y]).toEqual([2048, 2048]);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------- the environment
  describe('environment', () => {
    beforeAll(async () => { env = await M.environment.buildEnvironment({ test: true, onProgress: (d, t) => { progress.push([d, t]); } }); });

    it('reports its progress step by step, to the end', () => {
      expect(progress).toHaveLength(9); expect(progress[0]).toEqual([1, 9]); expect(progress[8]).toEqual([9, 9]);
      for (let i = 1; i < progress.length; i++) expect(progress[i][0]).toBe(progress[i - 1][0] + 1);
    });
    it('is built once: asking again returns the same world', async () => {
      expect(await M.environment.buildEnvironment({ test: true })).toBe(env); expect(M.environment.environment()).toBe(env);
    });
    it('puts the ground, the river, the plants, the props, the sky and the fireflies in the scene', () => {
      expect(env.group.parent).toBe(M.scene.sn);
      expect(env.terrain.playfield.name).toBe('terrain'); expect(env.terrain.ring.length).toBeGreaterThan(0); expect(env.terrain.playfield.receiveShadow).toBe(true);
      expect(env.water.mesh.name).toBe('water'); expect(env.plants.group.name).toBe('plants'); expect(env.props.group.name).toBe('props');
      expect(env.group.children).toContain(env.terrain.group); expect(env.group.children).toContain(env.water.mesh); expect(env.group.children).toContain(env.plants.group); expect(env.group.children).toContain(env.props.group);
      expect(M.scene.sn.children).toContain(env.atmosphere.dome); expect(M.scene.sn.children).toContain(env.atmosphere.flies);
    });
    it('the test world is the small one', () => { expect(env.sizes).toEqual({ splat: 64, grid: 32, ring: 10 }); expect(env.test).toBe(true); });
    it('adds no lights, whatever it builds', () => {
      let n = 0; M.scene.sn.traverse(o => { if ((o as any).isLight) n++; });
      expect(n).toBe(3);
    });
    it('every drawable thing of the world is either frustum culled, or deliberately not (the sky dome and the fireflies)', () => {
      const off: string[] = [];
      env.group.traverse(o => { if (((o as any).isMesh || (o as any).isPoints || (o as any).isSprite) && !o.frustumCulled) off.push(o.name || o.type); });
      // sprites are culled by three through their own bounds
      expect(off.filter(n => n !== 'Sprite')).toEqual([]);
    });
    it('the haze eases toward the zoom and the dome follows the camera, frame by frame', () => {
      const { app } = M.state; app.mode = 'menu';
      const t0 = M.shared.SHARED.time.value;
      M.scene.cm.position.set(3, 20, 7);
      for (let i = 0; i < 300; i++) M.environment.updateEnvironment(1 / 60);
      expect(M.shared.SHARED.time.value).toBeCloseTo(t0 + 5, 6);
      expect(env.atmosphere.dome.position.toArray()).toEqual([3, 20, 7]);
      const fog = M.scene.sn.fog as any;
      expect(fog.near).toBeCloseTo(26, 0); expect(fog.far).toBeCloseTo(190, 0); // the menu stage's haze
    });
    it('setQuality sets the three knobs: the reach of the grass, the number of fireflies, the glow of the runes', () => {
      env.setQuality({ reach: .5, flies: 20, rune: .4 });
      expect(env.plants.reach).toBe(.5); expect(env.atmosphere.flies.geometry.drawRange.count).toBe(20); expect(env.atmosphere.flies.visible).toBe(true); expect(M.shared.SHARED.rune.value).toBe(.4);
      env.setQuality({ reach: 1, flies: 0, rune: .62 });
      expect(env.atmosphere.flies.visible).toBe(false);
    });
    it('a separate world can be built and disposed of without touching the shared one', async () => {
      const other = new M.environment.Environment(true);
      await other.build();
      expect(M.scene.sn.children).toContain(other.group);
      other.dispose();
      expect(M.scene.sn.children).not.toContain(other.group);
      expect(M.environment.environment()).toBe(env);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------- post-processing
  describe('post-processing', () => {
    it('is built on the first frame, not before: scene, bloom and the finishing pass, multisampled, with no FXAA', () => {
      expect(M.post.postInfo()).toEqual({ active: false, msaa: false, fxaa: false, bloom: false, passes: 0 });
      M.post.renderFrame();
      expect(M.post.postInfo()).toEqual({ active: true, msaa: true, fxaa: false, bloom: true, passes: 3 });
    });
    it('draws the scene once, into a multisampled target, and the last pass to the screen', () => {
      STUB.renders.length = 0; M.post.renderFrame();
      const r = STUB.renders;
      expect(r[0].scene).toBe(M.scene.sn); expect(r[0].camera).toBe(M.scene.cm); expect(r[0].target.isWebGLMultisampleRenderTarget).toBe(true);
      expect(r.filter(x => x.scene === M.scene.sn)).toHaveLength(1);
      expect(r[r.length - 1].target).toBeNull();
      expect(r.length).toBeGreaterThan(10); // bloom: bright pass, five blur levels, composite, blend; then the finishing quad
    });
    it('the Bloom setting and the quality governor each switch the whole bloom chain off', () => {
      const on = frameRenders(M);
      M.state.app.bloom = false; const off1 = frameRenders(M); expect(M.post.postInfo().bloom).toBe(false);
      M.state.app.bloom = true; M.post.allowBloom(false); const off2 = frameRenders(M); expect(M.post.postInfo().bloom).toBe(false);
      M.post.allowBloom(true); const on2 = frameRenders(M); expect(M.post.postInfo().bloom).toBe(true);
      expect(off1).toBe(2); expect(off2).toBe(2); // the scene and the finishing quad: the picture keeps its look without bloom
      expect(on2).toBe(on); expect(on).toBeGreaterThan(off1 + 8);
    });
    it('the targets follow the pixel ratio and the window', () => {
      M.scene.rd.setPixelRatio(1.5); M.post.resizePost();
      STUB.renders.length = 0; M.post.renderFrame();
      expect(STUB.renders[0].target.width).toBe(Math.round(innerWidth * 1.5)); expect(STUB.renders[0].target.height).toBe(Math.round(innerHeight * 1.5));
      (window as any).innerWidth = 800; (window as any).innerHeight = 600;
      window.dispatchEvent(new Event('resize'));
      expect(M.scene.cm.aspect).toBeCloseTo(800 / 600, 9);
      STUB.renders.length = 0; M.post.renderFrame();
      expect(STUB.renders[0].target.width).toBe(1200); expect(STUB.renders[0].target.height).toBe(900);
      (window as any).innerWidth = 1024; (window as any).innerHeight = 768; window.dispatchEvent(new Event('resize'));
      M.scene.rd.setPixelRatio(2); M.post.resizePost();
    });
    it('the finishing pass is gentle: a light vignette, a grade that can be turned off, an opaque result', () => {
      const f = M.post.FinishShader, u = f.uniforms;
      expect(u.uVignette.value).toBeGreaterThan(.1); expect(u.uVignette.value).toBeLessThan(.35); expect(u.uGrade.value).toBe(1);
      expect(f.fragmentShader).toContain('uVignette'); expect(f.fragmentShader).toContain('uGrade'); expect(f.fragmentShader).toContain('uSeed');
      expect(f.fragmentShader).toMatch(/gl_FragColor\s*=\s*vec4\(max\(c, 0\.0\), 1\.0\)/); // opaque: the alpha is exactly 1
      expect(f.fragmentShader.match(/gl_FragColor\s*=/g)).toHaveLength(1);
      expect(f.vertexShader).toContain('gl_Position');
    });
    it('the bloom is kept low: a glow on the brightest magic only, never a haze over the picture', () => {
      const B = M.post.BLOOM;
      expect(B.strength).toBeGreaterThan(.1); expect(B.strength).toBeLessThanOrEqual(.5); expect(B.threshold).toBeGreaterThanOrEqual(.8); expect(B.radius).toBeLessThanOrEqual(.8);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------- quality levels
  describe('quality levels', () => {
    it('each level sets the resolution, the shadow map, the bloom, the reach of the grass, the fireflies and the runes', () => {
      M.state.app.bloom = true;
      for (const [i, L] of M.governor.LEVELS.entries()) {
        M.quality.setQuality(i as 0 | 1 | 2 | 3);
        expect(M.quality.qualityLevel()).toBe(i); expect(M.quality.governor.isLocked).toBe(true);
        expect(M.scene.rd.getPixelRatio()).toBeCloseTo(Math.min(2, L.dpr), 9);
        expect(M.lighting.shadowState.size).toBe(L.shadow); expect(M.scene.sun.shadow.mapSize.x).toBe(L.shadow);
        expect(env.plants.reach).toBe(L.reach);
        expect(env.atmosphere.flies.visible).toBe(L.flies > 0); if (L.flies) expect(env.atmosphere.flies.geometry.drawRange.count).toBe(L.flies);
        expect(M.shared.SHARED.rune.value).toBe(L.rune);
        M.post.renderFrame(); expect(M.post.postInfo().bloom).toBe(L.bloom);
      }
    });
    it('the pixel ratio is also capped by the device: a 1x screen is never rendered above 1', () => {
      Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true });
      M.quality.setQuality(3); expect(M.scene.rd.getPixelRatio()).toBe(1);
      M.quality.setQuality(0); expect(M.scene.rd.getPixelRatio()).toBe(M.governor.LEVELS[0].dpr);
      Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
    });
    it('changing the pixel ratio resizes the canvas and the post chain together', () => {
      M.quality.setQuality(3);
      STUB.renders.length = 0; M.post.renderFrame();
      expect(STUB.renders[0].target.width).toBe(Math.round(innerWidth * 2));
      M.quality.setQuality(1);
      STUB.renders.length = 0; M.post.renderFrame();
      expect(STUB.renders[0].target.width).toBeCloseTo(innerWidth * 1.1, 6);
    });
    it('a locked level ignores slow frames', () => {
      M.quality.setQuality(3);
      for (let i = 0; i < 1500; i++) M.quality.tickQuality(1 / 20);
      expect(M.quality.qualityLevel()).toBe(3);
    });
    it('"auto" lets the governor decide: sustained slow frames lower the level and the new level is applied at once', () => {
      M.quality.setQuality(3); M.quality.setQuality('auto');
      expect(M.quality.governor.isLocked).toBe(false);
      for (let i = 0; i < 400; i++) M.quality.tickQuality(1 / 30); // 13 s at 30 fps
      const l = M.quality.qualityLevel(), L = M.governor.LEVELS[l];
      expect(l).toBeLessThan(3);
      expect(M.scene.rd.getPixelRatio()).toBeCloseTo(Math.min(2, L.dpr), 9); expect(M.lighting.shadowState.size).toBe(L.shadow); expect(env.plants.reach).toBe(L.reach);
    });
    it('and fast frames bring the quality back, slowly', () => {
      M.quality.setQuality(0); M.quality.setQuality('auto');
      for (let i = 0; i < 120 * 20; i++) M.quality.tickQuality(1 / 120); // 20 s at 120 fps: one climb, after the grace period and the wait
      expect(M.quality.qualityLevel()).toBe(1);
      for (let i = 0; i < 120 * 20; i++) M.quality.tickQuality(1 / 120); // 20 s more: the next one
      expect(M.quality.qualityLevel()).toBe(2);
      expect(M.scene.rd.getPixelRatio()).toBeCloseTo(Math.min(2, M.governor.LEVELS[2].dpr), 9); // and it is applied
    });
  });
});

// ------------------------------------------------------------------------------------------------------------------------ a level chosen before the world exists

describe('quality before the environment is built', () => {
  it('the world gets the chosen level on the first tick after it appears', async () => {
    const M = await load('webgl2');
    M.quality.setQuality(1);
    expect(M.environment.environment()).toBeNull();
    const env = await M.environment.buildEnvironment({ test: true });
    expect(env.plants.reach).toBe(1); // the build's own default, not yet the level
    M.quality.tickQuality(1 / 60);
    expect(env.plants.reach).toBe(M.governor.LEVELS[1].reach); expect(env.atmosphere.flies.geometry.drawRange.count).toBe(M.governor.LEVELS[1].flies);
    env.plants.reach = 1;
    M.quality.tickQuality(1 / 60); expect(env.plants.reach).toBe(1); // applied once, not on every frame
  });
});

// ------------------------------------------------------------------------------------------------------------------------ WebGL1 and no WebGL

describe('renderer on WebGL1', () => {
  it('antialiases with FXAA where the target cannot be multisampled', async () => {
    const M = await load('webgl1');
    M.post.renderFrame();
    expect(M.post.postInfo()).toEqual({ active: true, msaa: false, fxaa: true, bloom: true, passes: 4 });
    STUB.renders.length = 0; M.post.renderFrame();
    expect(STUB.renders[0].target.isWebGLMultisampleRenderTarget).toBeFalsy();
    M.post.allowBloom(false);
    expect(frameRenders(M)).toBe(3); // the scene, FXAA and the finishing quad
  });
});

describe('when the post-processing chain cannot be built', () => {
  it('draws the scene straight to the screen, says so once, and never tries again', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const M = await load('broken');
    STUB.renders.length = 0;
    M.post.renderFrame();
    expect(STUB.renders).toHaveLength(1); expect(STUB.renders[0].scene).toBe(M.scene.sn); expect(STUB.renders[0].camera).toBe(M.scene.cm); expect(STUB.renders[0].target).toBeNull();
    expect(M.post.postInfo()).toEqual({ active: false, msaa: false, fxaa: false, bloom: false, passes: 0 });
    expect(warn).toHaveBeenCalledTimes(1);
    M.post.renderFrame(); M.post.renderFrame();
    expect(STUB.renders).toHaveLength(3); expect(warn).toHaveBeenCalledTimes(1);
    M.post.resizePost(); M.post.allowBloom(false); // harmless without a chain
    warn.mockRestore();
  });
});
