// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { render, screen, fireEvent, act } from '@testing-library/react';

vi.mock('three', async orig => {
  const t: any = await orig();
  return { ...t, WebGLRenderer: class { domElement = document.createElement('canvas'); shadowMap: any = {}; setPixelRatio() {} setSize() {} render() {} } };
});

let F: any, S: any, U: any, C: any;
const frames = (n: number) => { act(() => { for (let i = 0; i < n; i++) F.frame(1 / 30); }); };
const key = (type: string, k: string) => { act(() => { window.dispatchEvent(new KeyboardEvent(type, { key: k })); }); };
const byId = (id: string) => document.getElementById(id);

beforeAll(async () => {
  localStorage.setItem('rs_bloom', 'false'); // tests run on a stubbed renderer: skip the composer
  const html = readFileSync('index.html', 'utf8');
  document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script'));
  const ctx = new Proxy({}, { get: (t: any, k) => (k in t ? t[k] : () => ({ addColorStop() {} })), set: (t: any, k, v) => ((t[k] = v), true) });
  (HTMLCanvasElement.prototype as any).getContext = () => ctx;
  F = await import('../src/flow'); S = await import('../src/game/state'); U = await import('../src/render/units'); C = await import('../src/game/sim/combat');
  const { App } = await import('../src/ui/App');
  render(<App />);
  await act(async () => { await F.boot(); });
});

describe('React UI + 3D scene (jsdom, stubbed WebGL)', () => {
  it('boots through the loading screen into the menu with five heroes', () => {
    expect(screen.queryByText(/Loading models/)).toBeNull();
    expect(document.querySelectorAll('#heroes .hc')).toHaveLength(5);
  });
  it('selecting a hero updates the card, the ability list and the 3D preview', () => {
    fireEvent.click(screen.getByText('Ember Mage'));
    expect(S.app.sel).toBe(2); expect(document.querySelector('.hc.s b')!.textContent).toBe('Ember Mage'); expect(screen.getByText(/Q Fire Bolt/)).toBeTruthy();
  });
  it('Play starts a match: HUD, countdown, render objects, gold growth, animation states', () => {
    fireEvent.click(screen.getByText('Play'));
    expect(S.app.mode).toBe('play'); expect(screen.getByText(/Match begins in/)).toBeTruthy(); expect(screen.getByText(/Ember Mage Lv 1/)).toBeTruthy();
    const g0 = S.app.me.g, seen = new Set<string>();
    for (let i = 0; i < 70; i++) { frames(10); for (const r of U.R.values()) if (r.cv) seen.add(r.cv.state); }
    expect(S.app.me.g).toBeGreaterThan(g0); expect(screen.queryByText(/Match begins in/)).toBeNull(); expect(screen.getByText(/\d+ gold/)).toBeTruthy();
    expect(U.R.size).toBeGreaterThanOrEqual(S.app.all.length);
    for (const s of ['IDLE', 'WALK', 'ATTACK']) expect(seen.has(s)).toBe(true);
  });
  it('characters outside the camera view are not drawn, and the ones in view are (skinned meshes have culling off, so the renderer does not do it for them)', () => {
    const me = S.app.me, mine = U.R.get(me);
    frames(3);
    expect(mine.cv.root.visible).toBe(true);
    const all = [...U.R.entries()].filter(([, r]: any) => r.cv) as [any, any][];
    const near = all.filter(([u]) => !u.dead && Math.hypot(u.x - me.x, u.y - me.y) < 250), far = all.filter(([u]) => Math.hypot(u.x - me.x, u.y - me.y) > 1800);
    expect(near.length).toBeGreaterThan(0); expect(far.length).toBeGreaterThan(0);
    for (const [, r] of near) expect(r.cv.root.visible).toBe(true);
    for (const [, r] of far) expect(r.cv.root.visible).toBe(false);
  });
  it('shop: buy and sell through React buttons change stats, inventory and HUD slots', () => {
    const me = S.app.me; me.g = 5000; frames(4); const d0 = me.dmg;
    fireEvent.click(screen.getByText('Shop (B)'));
    expect(document.querySelectorAll('#shop .card')).toHaveLength(18);
    fireEvent.click(document.querySelectorAll('#shop .card button')[0]);
    expect(me.it).toHaveLength(1); expect(me.dmg).toBe(d0 + 25); expect(screen.getByText(/Inventory \(1\/6\)/)).toBeTruthy();
    frames(4); expect(document.querySelector('#its .sl')!.textContent).toBe('IB');
    fireEvent.click(screen.getByText(/^Sell/)); expect(me.it).toHaveLength(0); expect(me.dmg).toBe(d0);
    fireEvent.click(screen.getByText('Close (B)')); expect(byId('shop')).toBeNull();
  });
  it('keyboard: Tab scoreboard, M minimap size, arrows move relative to the camera, Q casts', () => {
    key('keydown', 'Tab'); frames(3); expect(byId('score')).toBeTruthy(); expect(screen.getByText(/\(You\)/)).toBeTruthy(); key('keyup', 'Tab'); frames(3); expect(byId('score')).toBeNull();
    key('keydown', 'm'); expect(byId('mm')!.className).toBe('big'); key('keydown', 'm'); expect(byId('mm')!.className).toBe('');
    const me = S.app.me; me.x = 1600; me.y = 2200; me.dead = false; me.mv = null; me.tgt = null; frames(5);
    const cy = S.app.cam.cy, x0 = me.x, y0 = me.y; key('keydown', 'ArrowUp'); frames(30); key('keyup', 'ArrowUp');
    const dx = me.x - x0, dy = me.y - y0, n = Math.hypot(dx, dy);
    expect(n).toBeGreaterThan(100); expect((dx * -Math.sin(cy) + dy * -Math.cos(cy)) / n).toBeGreaterThan(.95);
    me.mp = me.mmax; me.acd = [0, 0, 0, 0]; key('keydown', 'q'); expect(me.acd[0]).toBeGreaterThan(0);
  });
  it('right click sets a ground move target under the cursor', () => {
    const cv = document.querySelector('#g canvas')!, me = S.app.me; me.mv = null;
    cv.dispatchEvent(new MouseEvent('pointerdown', { button: 2, clientX: innerWidth / 2, clientY: innerHeight / 2 }));
    expect(me.mv).toBeTruthy(); expect(Math.hypot(me.mv.x - S.app.cam.k.x, me.mv.y - S.app.cam.k.y)).toBeLessThan(400);
  });
  it('effects and camera follow the match: casts are sensed, pools stay bounded, zoom and rotation glide, impacts shake by distance, aiming never wobbles', async () => {
    const V = await import('../src/render/vfx'), C2 = await import('../src/render/camera'), SC = await import('../src/render/scene'), { K } = await import('../src/game/config');
    const cvs = document.querySelector('#g canvas')!, me = S.app.me, cam = S.app.cam, rig = V.fxDebug.rig;
    me.dead = false; me.hp = me.max; me.mp = me.mmax; me.acd = [0, 0, 0, 0]; me.mv = null;
    const c0 = V.fxStats().director.casts;
    key('keydown', 'q'); key('keyup', 'q'); frames(20);
    const st = V.fxStats();
    expect(st.director.casts).toBeGreaterThanOrEqual(c0 + 1); expect(st.director.resolved).toBeGreaterThan(0); expect(st.director.unknown).toBe(0); // totals since the match started
    expect(st.director.tracked.casts).toBeGreaterThanOrEqual(1); // and the cast is still being followed (it is applied .25 s in, then kept for another .5 s)
    expect(st.particles.dropped).toBe(0); expect(st.meshes.created).toBeLessThanOrEqual(256); expect(st.particles.peakAdd).toBeLessThanOrEqual(st.particles.capAdd);
    // wheel zoom glides towards its goal instead of jumping
    const d0 = cam.cd;
    act(() => { cvs.dispatchEvent(new WheelEvent('wheel', { deltaY: -500, cancelable: true })); });
    frames(1); const d1 = cam.cd; frames(60); const d2 = cam.cd;
    expect(d1).toBeLessThan(d0); expect(d1).toBeGreaterThan(d2); expect(d2).toBeCloseTo(Math.max(25, d0 * Math.exp(-.45)), 0);
    // ] turns by one 45 degree step, gliding; Home returns to the classic isometric angle
    const y0 = cam.cy; key('keydown', ']'); frames(1); const y1 = cam.cy; frames(60); const y2 = cam.cy;
    expect(y1).toBeGreaterThan(y0); expect(y2).toBeGreaterThan(y1 + .05); expect(Math.abs(Math.round(y2 / (Math.PI / 4)) * (Math.PI / 4) - y2)).toBeLessThan(.01);
    key('keydown', 'Home'); frames(90); expect(cam.cy).toBeCloseTo(-.785, 2);
    // an impact shakes the camera by how close it is to what is on screen
    rig.shake.clear();
    const wx = rig.fx * K, wz = rig.fy * K;
    V.fxDebug.kit.cam.shake(.8, wx, wz); expect(rig.shake.trauma).toBeGreaterThan(.7);
    rig.shake.clear(); V.fxDebug.kit.cam.shake(.8, wx + 400, wz); expect(rig.shake.trauma).toBe(0);
    rig.shake.clear();
    // ... and the point under the mouse does not move while the picture does (paused, so nothing else changes)
    S.app.G.pause = true; frames(30);
    const at = { clientX: innerWidth / 2 + 120, clientY: innerHeight / 2 - 60 }, p0 = C2.wpt(at);
    rig.addShake(1); rig.addKick(.8, 2, 3);
    let moved = 0, drawn = 0;
    for (let i = 0; i < 12; i++) {
      frames(1); const q = C2.wpt(at);
      moved = Math.max(moved, Math.hypot(q.x - p0.x, q.y - p0.y)); drawn = Math.max(drawn, Math.hypot(SC.cm.position.x - rig.pose.ax, SC.cm.position.y - rig.pose.ay, SC.cm.position.z - rig.pose.az));
    }
    S.app.G.pause = false;
    expect(drawn).toBeGreaterThan(.02); expect(moved).toBeLessThan(1e-6);
    // resetFx (a new match, back to the menu) empties every pool and the timeline
    V.fxDebug.kit.em.burst(wx, 1, wz, 0xffffff, 30, 5, 1); V.fxDebug.kit.mesh.ring({ x: wx, y: 1, z: wz, r0: 1, r1: 2, color: 0xffffff, life: 5 });
    expect(V.fxStats().particles.add).toBeGreaterThan(0);
    V.resetFx();
    const z = V.fxStats();
    expect(z.particles.add + z.particles.alpha + z.timeline + z.trails.active).toBe(0);
    expect(z.meshes.rings + z.meshes.decals + z.meshes.flashes + z.meshes.bolts + z.meshes.domes + z.meshes.pillars).toBe(0); expect(z.director.casts).toBe(0); expect(z.director.tracked).toEqual({ casts: 0, projectiles: 0, auras: 0 });
  });
  it('Escape pauses the simulation and Resume continues it', () => {
    key('keydown', 'Escape'); expect(S.app.G.pause).toBe(true); expect(screen.getByText('Paused')).toBeTruthy();
    const t = S.app.G.t; frames(30); expect(S.app.G.t).toBe(t);
    fireEvent.click(screen.getByText('Resume')); expect(S.app.G.pause).toBe(false); expect(screen.queryByText('Paused')).toBeNull();
  });
  it('victory screen (with the camera finale), Play Again, then Main Menu from the pause screen', async () => {
    const me = S.app.me, V = await import('../src/render/vfx');
    act(() => { S.app.all.filter((u: any) => u.k === 'tower' && u.team === 1).forEach((t: any) => C.hurt(me, t, 1e6)); C.hurt(me, S.app.all.find((u: any) => u.k === 'core' && u.team === 1), 1e6); });
    frames(3); expect(screen.getByText('VICTORY')).toBeTruthy();
    expect(V.fxDebug.rig.finaleActive).toBe(true); expect(V.fxStats().director.deaths).toBeGreaterThan(0);
    fireEvent.click(screen.getByText('Play Again')); expect(S.app.G.t).toBeLessThan(1); expect(S.app.G.over).toBe(false); expect(screen.queryByText('VICTORY')).toBeNull();
    expect(V.fxDebug.rig.finaleActive).toBe(false); expect(V.fxStats().director.deaths).toBe(0); // nothing of the last match's finale carries over
    key('keydown', 'Escape'); fireEvent.click(screen.getByText('Main Menu'));
    expect(S.app.mode).toBe('menu'); expect(U.R.size).toBe(0); expect(document.querySelectorAll('#heroes .hc')).toHaveLength(5);
  });
  it('defeat screen when the own core falls', () => {
    fireEvent.click(screen.getByText('Play')); frames(5);
    act(() => { C.hurt(S.app.all.find((u: any) => u.team === 1 && u.k === 'hero'), S.app.all.find((u: any) => u.k === 'core' && u.team === 0), 1e9); });
    expect(screen.getByText('DEFEAT')).toBeTruthy(); fireEvent.click(screen.getByText('Main Menu'));
  });
  it('settings persist: bloom and camera zoom', () => {
    fireEvent.click(screen.getByLabelText(/Bloom/)); expect(S.app.bloom).toBe(true); expect(localStorage.getItem('rs_bloom')).toBe('true');
    fireEvent.change(screen.getByLabelText(/Camera zoom/), { target: { value: '1.2' } }); expect(localStorage.getItem('rs_zoom')).toBe('1.2');
  });
  it('phase 5: the Settings sliders and mute drive the real audio buses and persist', async () => {
    const A = await import('../src/audio/audio');
    const { DEFAULT_VOLUME } = await import('../src/audio/AudioManager');
    const rows = [...document.querySelectorAll<HTMLLabelElement>('#menu label')];
    const slider = (t: string) => rows.find(l => l.textContent!.startsWith(t))!.querySelector('input[type=range]')!;
    fireEvent.change(slider('SFX'), { target: { value: '.3' } });
    expect(A.audioPrefs().sfx).toBeCloseTo(.3);
    expect(A.audioStats().buses.sfx).toBeCloseTo(.3); // the settings store and the engine agree
    expect(localStorage.getItem('rs_vol_sfx')).toBe('0.3'); // and the change survives a reload
    fireEvent.click(screen.getByLabelText(/Mute audio/));
    expect(A.audioPrefs().muted).toBe(true);
    expect(localStorage.getItem('rs_mute')).toBe('true');
    fireEvent.click(screen.getByLabelText(/Mute audio/)); // leave the suite as it was found
    fireEvent.change(slider('SFX'), { target: { value: String(DEFAULT_VOLUME.sfx) } });
    expect(A.audioPrefs().muted).toBe(false);
    expect(A.audioPrefs().sfx).toBeCloseTo(DEFAULT_VOLUME.sfx);
  });
  it('phase 4: the controls reach the audio facade (select, hover, pause, shop open/buy/sell/close)', async () => {
    const A = await import('../src/audio/audio');
    const played: string[] = [];
    const spy = vi.spyOn(A.snd, 'play').mockImplementation((_bus: any, name: any) => { played.push(name); return true; }); // jsdom has no Web Audio: record the attempts
    try {
      fireEvent.click(screen.getByText('Ember Mage')); // hero card in the menu
      expect(played).toContain('uiSelect');
      act(() => { document.querySelector('#heroes .hc')!.dispatchEvent(new Event('pointerover', { bubbles: true })); });
      expect(played).toContain('uiHover');
      fireEvent.click(screen.getByText('Play'));
      key('keydown', 'Escape');
      expect(played).toContain('uiPause');
      fireEvent.click(screen.getByText('Resume'));
      expect(played).toContain('uiResume');
      S.app.me.g = 5000;
      fireEvent.click(screen.getByText('Shop (B)'));
      expect(played).toContain('shopOpen');
      fireEvent.click(document.querySelectorAll('#shop .card button')[0]);
      expect(played).toContain('shopBuy');
      fireEvent.click(screen.getByText(/^Sell/));
      expect(played).toContain('shopSell');
      fireEvent.click(screen.getByText('Close (B)'));
      expect(played).toContain('shopClose');
    } finally { spy.mockRestore(); }
  });
});
