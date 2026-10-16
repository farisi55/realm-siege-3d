// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('three', async orig => {
  const t: any = await orig();
  return { ...t, WebGLRenderer: class { domElement = document.createElement('canvas'); shadowMap: any = {}; setPixelRatio() {} setSize() {} render() {} } };
});

let F: any, S: any, U: any, C: any;
const el = (id: string) => document.getElementById(id)!;
const click = (sel: string) => (document.querySelector(sel) as HTMLElement).click();
const frames = (n: number) => { for (let i = 0; i < n; i++) F.frame(1 / 30); };
const key = (type: string, k: string) => window.dispatchEvent(new KeyboardEvent(type, { key: k }));

beforeAll(async () => {
  localStorage.setItem('rs_bloom', 'false'); // tests run on a stubbed renderer: skip the composer
  const html = readFileSync('index.html', 'utf8');
  document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script'));
  const ctx = new Proxy({}, { get: (t: any, k) => (k in t ? t[k] : () => ({ addColorStop() {} })), set: (t: any, k, v) => ((t[k] = v), true) });
  (HTMLCanvasElement.prototype as any).getContext = () => ctx;
  await import('../src/render/environment');
  F = await import('../src/flow'); S = await import('../src/game/state'); U = await import('../src/render/units'); C = await import('../src/game/sim/combat');
  await F.boot();
});

describe('UI + 3D scene (jsdom, stubbed WebGL)', () => {
  it('asset preload finishes, hides the loading screen and the bloom option persists', () => {
    expect(el('loading').classList.contains('hid')).toBe(true);
    const box = el('bloomc') as HTMLInputElement; box.checked = false; box.dispatchEvent(new Event('change', { bubbles: true }));
    expect(S.app.bloom).toBe(false); expect(localStorage.getItem('rs_bloom')).toBe('false');
  });
  it('menu lists five heroes; selecting one swaps the 3D preview', () => {
    expect(document.querySelectorAll('#heroes .hc')).toHaveLength(5);
    click('#heroes [data-act="select"][data-n="2"]');
    expect(S.app.sel).toBe(2); expect(document.querySelector('#heroes .hc.s b')!.textContent).toBe('Ember Mage');
  });
  it('Play starts a match: HUD shown, render objects created, gold grows, animation states change', () => {
    click('[data-act="play"]');
    expect(S.app.mode).toBe('play'); expect(el('menu').classList.contains('hid')).toBe(true); expect(el('hud').classList.contains('hid')).toBe(false);
    const g0 = S.app.me.g, seen = new Set<string>();
    for (let i = 0; i < 700; i++) { F.frame(1 / 30); for (const r of U.R.values()) if (r.an) seen.add(r.an.cur); }
    expect(S.app.me.g).toBeGreaterThan(g0); expect(el('gd').textContent).toMatch(/gold/);
    expect(U.R.size).toBeGreaterThanOrEqual(S.app.all.length);
    for (const s of ['idle', 'walk', 'attack']) expect(seen.has(s)).toBe(true);
  });
  it('shop buy/sell via delegated buttons changes stats and inventory', () => {
    const me = S.app.me; me.g = 5000; const d0 = me.dmg;
    click('[data-act="toggleShop"]'); expect(el('shop').classList.contains('hid')).toBe(false);
    click('#shop [data-act="buy"][data-n="0"]'); expect(me.it).toHaveLength(1); expect(me.dmg).toBe(d0 + 25);
    frames(10); expect(el('s0').textContent).toBe('IB');
    click('#shop [data-act="sell"][data-n="0"]'); expect(me.it).toHaveLength(0); expect(me.dmg).toBe(d0);
    click('#shop [data-act="toggleShop"]'); expect(el('shop').classList.contains('hid')).toBe(true);
  });
  it('arrow keys move the hero relative to the camera', () => {
    const me = S.app.me; me.x = 1600; me.y = 2200; me.dead = false; me.mv = null; me.tgt = null; frames(5);
    const cy = S.app.cam.cy, x0 = me.x, y0 = me.y;
    key('keydown', 'ArrowUp'); frames(30); key('keyup', 'ArrowUp');
    const dx = me.x - x0, dy = me.y - y0, n = Math.hypot(dx, dy);
    expect(n).toBeGreaterThan(100); expect((dx * -Math.sin(cy) + dy * -Math.cos(cy)) / n).toBeGreaterThan(.95);
  });
  it('right click sets a ground move target under the cursor', () => {
    const cv = document.querySelector('#g canvas')!, me = S.app.me; me.mv = null;
    cv.dispatchEvent(new MouseEvent('pointerdown', { button: 2, clientX: innerWidth / 2, clientY: innerHeight / 2 }));
    expect(me.mv).toBeTruthy(); expect(Math.hypot(me.mv.x - S.app.cam.k.x, me.mv.y - S.app.cam.k.y)).toBeLessThan(400);
  });
  it('Q casts an ability at the cursor', () => {
    const me = S.app.me; me.mp = me.mmax; me.acd = [0, 0, 0, 0]; key('keydown', 'q');
    expect(me.acd[0]).toBeGreaterThan(0);
  });
  it('Escape pauses, Resume continues', () => {
    key('keydown', 'Escape'); expect(S.app.G.pause).toBe(true);
    const t = S.app.G.t; frames(30); expect(S.app.G.t).toBe(t);
    click('[data-act="resume"]'); expect(S.app.G.pause).toBe(false);
  });
  it('Victory screen, Play Again, Main Menu', () => {
    const me = S.app.me; S.app.all.filter((u: any) => u.k === 'tower' && u.team === 1).forEach((t: any) => C.hurt(me, t, 1e6));
    C.hurt(me, S.app.all.find((u: any) => u.k === 'core' && u.team === 1), 1e6); frames(3);
    expect(el('res').textContent).toBe('VICTORY'); expect(el('end').classList.contains('hid')).toBe(false);
    click('[data-act="again"]'); expect(S.app.G.t).toBeLessThan(1); expect(S.app.G.over).toBe(false);
    click('[data-act="toMenu"]'); expect(S.app.mode).toBe('menu'); expect(U.R.size).toBe(0); expect(el('menu').classList.contains('hid')).toBe(false);
  });
});
