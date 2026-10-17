// @vitest-environment jsdom
// Drives the real UI the way a player does. The screens are React: mount() renders them (main.ts does
// this just before boot()) and every state change is followed by `await flush()` so the DOM assertions
// read a committed render. Buttons carry no test-only ids, so they are found by their label.
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('three', async orig => {
  const t: any = await orig();
  return { ...t, WebGLRenderer: class { domElement = document.createElement('canvas'); shadowMap: any = {}; setPixelRatio() {} setSize() {} render() {} } };
});

let F: any, S: any, U: any, C: any;
const el = (id: string) => document.getElementById(id)!;
const $ = (sel: string) => document.querySelector(sel) as HTMLElement;
const $$ = (sel: string) => Array.from(document.querySelectorAll(sel)) as HTMLElement[];
const frames = (n: number) => { for (let i = 0; i < n; i++) F.frame(1 / 30); };
const key = (type: string, k: string) => window.dispatchEvent(new KeyboardEvent(type, { key: k }));
/** Lets React commit the render it scheduled for the state change that just happened. */
const flush = (): Promise<void> => new Promise(r => setTimeout(r, 0));
/** The button whose label is exactly `text`. */
const button = (text: string, root: ParentNode = document): HTMLButtonElement =>
  Array.from(root.querySelectorAll('button')).find(b => b.textContent?.trim() === text)!;
/** The checkbox of the labelled setting row whose text contains `text`. */
const settingBox = (text: string): HTMLInputElement =>
  Array.from($('#menu').querySelectorAll('label')).find(l => l.textContent?.includes(text))!.querySelector('input')!;

beforeAll(async () => {
  localStorage.setItem('rs_bloom', 'false'); // tests run on a stubbed renderer: skip the composer
  const html = readFileSync('index.html', 'utf8');
  document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script'));
  const ctx = new Proxy({}, { get: (t: any, k) => (k in t ? t[k] : () => ({ addColorStop() {} })), set: (t: any, k, v) => ((t[k] = v), true) });
  (HTMLCanvasElement.prototype as any).getContext = () => ctx;
  await import('../src/render/environment');
  const M = await import('../src/ui/mount');
  F = await import('../src/flow'); S = await import('../src/game/state'); U = await import('../src/render/units'); C = await import('../src/game/sim/combat');
  M.mount(); // the React root, exactly as main.ts does before boot()
  await F.boot();
  await flush(); // boot finished: the menu is committed
}, 30000);

describe('UI + 3D scene (jsdom, stubbed WebGL)', () => {
  it('asset preload finishes, hides the loading screen and the bloom option persists', async () => {
    expect(document.getElementById('loading')).toBeNull(); // boot done: the loading overlay is unmounted
    expect(el('menu').className).toContain('ov');
    const box = settingBox('Bloom');
    expect(box.checked).toBe(false); // rs_bloom was saved as false
    box.click(); await flush();
    expect(S.app.bloom).toBe(true); expect(localStorage.getItem('rs_bloom')).toBe('true');
    box.click(); await flush(); // back off again: the stubbed renderer stays on the simple path
    expect(S.app.bloom).toBe(false); expect(localStorage.getItem('rs_bloom')).toBe('false');
  });
  it('menu lists five heroes; selecting one swaps the 3D preview', async () => {
    expect($$('#heroes .hc')).toHaveLength(5);
    $$('#heroes .hc')[2].click(); await flush();
    expect(S.app.sel).toBe(2); expect($('#heroes .hc.s b')!.textContent).toBe('Ember Mage');
  });
  it('Play starts a match: HUD shown, render objects created, gold grows, animation states change', { timeout: 30000 }, async () => {
    button('Play').click(); await flush();
    expect(S.app.mode).toBe('play'); expect(document.getElementById('menu')).toBeNull(); expect(document.getElementById('hud')).toBeTruthy();
    const g0 = S.app.me.g, seen = new Set<string>();
    for (let i = 0; i < 700; i++) { F.frame(1 / 30); for (const r of U.R.values()) if (r.cv) seen.add(r.cv.state); }
    await flush();
    expect(S.app.me.g).toBeGreaterThan(g0); expect(el('gd').textContent).toMatch(/gold/);
    expect(U.R.size).toBeGreaterThanOrEqual(S.app.all.length);
    for (const s of ['IDLE', 'WALK', 'ATTACK']) expect(seen.has(s)).toBe(true);
  });
  it('shop buy/sell changes stats, inventory and the HUD item slots', async () => {
    const me = S.app.me; me.g = 5000; const d0 = me.dmg;
    button('Shop (B)').click(); await flush(); expect(document.getElementById('shop')).toBeTruthy();
    ($$('#shop .cards')[0].children[0].querySelector('button') as HTMLElement).click(); await flush();
    expect(me.it).toHaveLength(1); expect(me.dmg).toBe(d0 + 25);
    frames(10); await flush(); expect($$('#its .sl')[0].textContent).toBe('IB'); // Iron Blade -> its initials
    Array.from($$('#shop button')).find(b => b.textContent!.startsWith('Sell'))!.click(); await flush();
    expect(me.it).toHaveLength(0); expect(me.dmg).toBe(d0);
    button('Close (B)').click(); await flush(); expect(document.getElementById('shop')).toBeNull();
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
  it('Escape pauses, Resume continues', async () => {
    key('keydown', 'Escape'); await flush(); expect(S.app.G.pause).toBe(true);
    const t = S.app.G.t; frames(30); expect(S.app.G.t).toBe(t);
    button('Resume').click(); await flush(); expect(S.app.G.pause).toBe(false);
  });
  it('Victory screen, Play Again, Main Menu', async () => {
    const me = S.app.me; S.app.all.filter((u: any) => u.k === 'tower' && u.team === 1).forEach((t: any) => C.hurt(me, t, 1e6));
    C.hurt(me, S.app.all.find((u: any) => u.k === 'core' && u.team === 1), 1e6); frames(3); await flush();
    expect(el('res').textContent).toBe('VICTORY'); expect(document.getElementById('end')).toBeTruthy();
    button('Play Again').click(); await flush(); expect(S.app.G.t).toBeLessThan(1); expect(S.app.G.over).toBe(false);
    key('keydown', 'Escape'); await flush(); // pause, as a player would: the Main Menu lives in the pause overlay
    button('Main Menu').click(); await flush();
    expect(S.app.mode).toBe('menu'); expect(U.R.size).toBe(0); expect(document.getElementById('menu')).toBeTruthy();
  });
});
